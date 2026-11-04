import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatrix } from './qr.js';

const BACKEND_ROOT = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(BACKEND_ROOT, '..');
const FRONTEND_ROOT = join(PROJECT_ROOT, 'frontend');
const DB_PATH = resolve(process.env.MEDALERT_DB_PATH || join(PROJECT_ROOT, 'data', 'medalert.sqlite'));
const TLS_PFX_PATH = resolve(process.env.MEDALERT_TLS_PFX || join(PROJECT_ROOT, 'data', 'localhost.pfx'));
const TLS_PASSPHRASE_PATH = `${TLS_PFX_PATH}.pass`;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(process.env.PORT || 8000);
const SESSION_DAYS = 7;
const MAX_LOG = 200;
const MAX_BODY_BYTES = 16_384;
const BLOOD = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-', 'Unknown'];
const INSURANCE = {
  none: 'No insurance (self-pay)', national: 'National / public scheme', private: 'Private insurance',
  employer: 'Employer / group cover', travel: 'Travel insurance',
};
const STAFF = { doctor: 'ER doctor', nurse: 'Nurse', paramedic: 'Paramedic' };
const MIME = {
  '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};

function loadTlsCertificate() {
  if (!existsSync(TLS_PFX_PATH)) {
    if (process.platform !== 'win32') {
      throw new Error('Set MEDALERT_TLS_PFX to a TLS certificate file before starting MedAlert.');
    }
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', join(BACKEND_ROOT, 'create-dev-cert.ps1'),
      '-OutputPath', TLS_PFX_PATH,
    ], { stdio: 'inherit' });
  }
  const passphrase = process.env.MEDALERT_TLS_PASSPHRASE
    ?? (existsSync(TLS_PASSPHRASE_PATH) ? readFileSync(TLS_PASSPHRASE_PATH, 'utf8').trimEnd() : '');
  return { pfx: readFileSync(TLS_PFX_PATH), passphrase };
}

class ApiError extends Error {
  constructor(status, message, fields = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('patient', 'staff')),
    name TEXT NOT NULL,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    phone TEXT NOT NULL,
    national_id TEXT,
    staff_type TEXT,
    hospital TEXT,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    blood_type TEXT NOT NULL,
    allergies TEXT NOT NULL,
    conditions TEXT NOT NULL,
    medications TEXT NOT NULL,
    emergency_name TEXT NOT NULL,
    emergency_phone TEXT NOT NULL,
    emergency_relationship TEXT NOT NULL,
    insurance_category TEXT NOT NULL,
    insurance_provider TEXT NOT NULL,
    insurance_policy_number TEXT NOT NULL,
    insurance_valid_until TEXT NOT NULL,
    consent INTEGER NOT NULL DEFAULT 1,
    qr_token TEXT NOT NULL UNIQUE,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS access_log (
    id INTEGER PRIMARY KEY,
    patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    staff_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    method TEXT NOT NULL,
    accessed_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS access_log_patient_time ON access_log(patient_id, accessed_at DESC);
`);

const statements = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  profileByUser: db.prepare('SELECT * FROM profiles WHERE user_id = ?'),
  insertSession: db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`
    SELECT users.* FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  updateConsent: db.prepare('UPDATE profiles SET consent = ? WHERE user_id = ?'),
};

const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const normalizePhone = (value) => String(value ?? '').replace(/[\s\-().]/g, '');
const sessionDigest = (token) => createHash('sha256').update(token).digest('hex');

function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, expected) {
  const actual = Buffer.from(hashPassword(password, salt).hash, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function token() {
  return randomBytes(32).toString('hex');
}

function seedDemoAccounts() {
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) return;
  const insertUser = db.prepare(`
    INSERT INTO users(role, name, email, phone, national_id, staff_type, hospital, password_salt, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const patientPassword = hashPassword('demo123');
  const staffPassword = hashPassword('demo123');
  db.exec('BEGIN');
  try {
    const patient = insertUser.run(
      'patient', 'Demo Patient', 'demo@medalert.demo', '+254700000001', '12345678', null, null,
      patientPassword.salt, patientPassword.hash,
    );
    insertUser.run(
      'staff', 'Dr. Demo', 'doctor@medalert.demo', '+254700000002', null, 'doctor', 'Demo Hospital',
      staffPassword.salt, staffPassword.hash,
    );
    db.prepare(`
      INSERT INTO profiles(
        user_id, blood_type, allergies, conditions, medications,
        emergency_name, emergency_phone, emergency_relationship,
        insurance_category, insurance_provider, insurance_policy_number, insurance_valid_until,
        consent, qr_token, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `).run(
      Number(patient.lastInsertRowid), 'O+', JSON.stringify(['Penicillin']),
      JSON.stringify(['Type 2 diabetes']), JSON.stringify(['Metformin 500mg']),
      'Jane Demo', '+254700000003', 'Sister', 'private', 'Demo Insurance', 'DM-123456', '',
      token(), new Date().toISOString(),
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

if (process.env.NODE_ENV !== 'production') seedDemoAccounts();

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    staff_type: user.role === 'staff' ? user.staff_type : null,
    verified: true,
    label: user.role === 'staff' ? STAFF[user.staff_type] : 'Patient',
  };
}

function profileFromRow(row) {
  return {
    blood_type: row.blood_type,
    allergies: JSON.parse(row.allergies),
    conditions: JSON.parse(row.conditions),
    medications: JSON.parse(row.medications),
    emergency_contact: {
      name: row.emergency_name,
      phone: row.emergency_phone,
      relationship: row.emergency_relationship,
    },
    insurance: {
      category: row.insurance_category,
      label: INSURANCE[row.insurance_category],
      provider: row.insurance_provider,
      policy_number: row.insurance_policy_number,
      valid_until: row.insurance_valid_until,
    },
    consent: Boolean(row.consent),
    qr: row.qr_token,
    updated_at: row.updated_at,
  };
}

function buildProfile(body) {
  const list = (value) => (Array.isArray(value) ? value.map((item) => clean(item, 100)).filter(Boolean).slice(0, 50) : []);
  const contact = body.emergency_contact || {};
  const insurance = body.insurance || {};
  const category = INSURANCE[insurance.category] ? insurance.category : 'none';
  return {
    blood_type: BLOOD.includes(body.blood_type) ? body.blood_type : 'Unknown',
    allergies: list(body.allergies),
    conditions: list(body.conditions),
    medications: list(body.medications),
    emergency_contact: {
      name: clean(contact.name, 100),
      phone: clean(contact.phone, 30),
      relationship: clean(contact.relationship, 50),
    },
    insurance: category === 'none'
      ? { category, provider: '', policy_number: '', valid_until: '' }
      : {
        category,
        provider: clean(insurance.provider, 100),
        policy_number: clean(insurance.policy_number, 50),
        valid_until: clean(insurance.valid_until, 10),
      },
  };
}

function saveProfile(userId, body) {
  const profile = buildProfile(body);
  const old = statements.profileByUser.get(userId);
  const values = [
    profile.blood_type, JSON.stringify(profile.allergies), JSON.stringify(profile.conditions),
    JSON.stringify(profile.medications), profile.emergency_contact.name, profile.emergency_contact.phone,
    profile.emergency_contact.relationship, profile.insurance.category, profile.insurance.provider,
    profile.insurance.policy_number, profile.insurance.valid_until, old?.consent ?? 1,
    old?.qr_token || token(), new Date().toISOString(),
  ];
  db.prepare(`
    INSERT INTO profiles(
      user_id, blood_type, allergies, conditions, medications,
      emergency_name, emergency_phone, emergency_relationship, insurance_category,
      insurance_provider, insurance_policy_number, insurance_valid_until, consent, qr_token, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      blood_type = excluded.blood_type, allergies = excluded.allergies,
      conditions = excluded.conditions, medications = excluded.medications,
      emergency_name = excluded.emergency_name, emergency_phone = excluded.emergency_phone,
      emergency_relationship = excluded.emergency_relationship, insurance_category = excluded.insurance_category,
      insurance_provider = excluded.insurance_provider, insurance_policy_number = excluded.insurance_policy_number,
      insurance_valid_until = excluded.insurance_valid_until, updated_at = excluded.updated_at
  `).run(userId, ...values);
  return profileFromRow(statements.profileByUser.get(userId));
}

function register(body, role) {
  const errors = {};
  const name = clean(body.name, 100);
  const email = clean(body.email, 254).toLowerCase();
  const phone = normalizePhone(body.phone);
  const password = String(body.password ?? '');
  if (!name) errors.name = 'Full name is required.';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.email = 'Enter a valid email address.';
  if (!/^\+?\d{7,15}$/.test(phone)) errors.phone = 'Enter 7 to 15 digits, optionally starting with +.';
  if (password.length < 6) errors.password = 'Use at least 6 characters.';
  else if (password.length > 12) errors.password = 'Use no more than 12 characters.';

  const nationalId = role === 'patient' ? String(body.national_id ?? '').trim() : null;
  const staffType = role === 'staff' ? (STAFF[body.staff_type] ? body.staff_type : 'doctor') : null;
  const hospital = role === 'staff' ? clean(body.hospital) : null;
  if (role === 'patient' && !nationalId) errors.national_id = 'National ID is required.';
  else if (role === 'patient' && !/^\d{8}$/.test(nationalId)) errors.national_id = 'Enter an 8-digit National ID number.';
  if (role === 'staff' && !hospital) errors.hospital = 'Hospital or organisation is required.';
  if (Object.keys(errors).length) throw new ApiError(400, 'Please correct the highlighted fields.', errors);
  if (statements.userByEmail.get(email)) {
    throw new ApiError(400, 'That email is already registered.', { email: 'That email is already registered.' });
  }

  const passwordData = hashPassword(password);
  db.prepare(`
    INSERT INTO users(role, name, email, phone, national_id, staff_type, hospital, password_salt, password_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(role, name, email, phone, nationalId, staffType, hospital, passwordData.salt, passwordData.hash);
  return { ok: true };
}

function qrFor(profile) {
  const payload = `MEDALERT:${profile.qr}`;
  return { qr: { matrix: makeMatrix(payload) } };
}

function profileResult(user, profile) {
  return {
    patient: { name: user.name },
    blood_type: profile.blood_type,
    allergies: profile.allergies,
    conditions: profile.conditions,
    medications: profile.medications,
    emergency_contact: profile.emergency_contact,
    insurance: profile.insurance,
    updated_at: profile.updated_at,
  };
}

function qrReference(value) {
  return String(value).trim().match(/^MEDALERT:([a-f0-9]{64})$/i)?.[1].toLowerCase() || null;
}

function recordAccess(patientId, staffId, method) {
  db.prepare('INSERT INTO access_log(patient_id, staff_id, method, accessed_at) VALUES (?, ?, ?, ?)')
    .run(patientId, staffId, method, new Date().toISOString());
  db.prepare(`
    DELETE FROM access_log
    WHERE patient_id = ? AND id NOT IN (
      SELECT id FROM access_log WHERE patient_id = ? ORDER BY accessed_at DESC, id DESC LIMIT ?
    )
  `).run(patientId, patientId, MAX_LOG);
}

function lookup(user, body) {
  const method = body.method;
  if (method === 'qr' && user.staff_type !== 'doctor') {
    throw new ApiError(403, 'Only doctors can look up profiles by QR code.');
  }
  const value = clean(body.value, method === 'qr' ? 1000 : 100);
  let patient;
  if (method === 'qr') {
    const reference = qrReference(value);
    if (!reference) throw new ApiError(404, 'No accessible profile found.');
    patient = db.prepare(`
      SELECT users.*, profiles.* FROM profiles JOIN users ON users.id = profiles.user_id
      WHERE users.role = 'patient' AND profiles.qr_token = ?
    `).get(reference);
  } else if (method === 'national_id') {
    if (!/^\d{8}$/.test(value)) throw new ApiError(400, 'Enter an 8-digit National ID number.');
    patient = db.prepare(`
      SELECT users.*, profiles.* FROM users JOIN profiles ON profiles.user_id = users.id
      WHERE users.role = 'patient' AND lower(users.national_id) = lower(?)
    `).get(value);
  } else if (method === 'phone') {
    patient = db.prepare(`
      SELECT users.*, profiles.* FROM users JOIN profiles ON profiles.user_id = users.id
      WHERE users.role = 'patient' AND users.phone = ?
    `).get(normalizePhone(value));
  } else {
    throw new ApiError(400, 'Choose QR code, national ID, or phone number.');
  }
  if (!patient || !patient.consent) throw new ApiError(404, 'No accessible profile found.');
  recordAccess(patient.id, user.id, method);
  return { result: profileResult(patient, profileFromRow(patient)) };
}

function getCookie(req, name) {
  const prefix = `${name}=`;
  return (req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(prefix))?.slice(prefix.length) || '';
}

function sessionUser(req) {
  const sessionToken = getCookie(req, 'medalert_session');
  if (!/^[a-f0-9]{64}$/i.test(sessionToken)) return null;
  const row = statements.sessionUser.get(sessionDigest(sessionToken), new Date().toISOString());
  if (!row) statements.deleteSession.run(sessionDigest(sessionToken));
  return row || null;
}

function setSessionCookie(res, value, maxAge) {
  res.setHeader('Set-Cookie', `medalert_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}; Secure`);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ApiError(413, 'Request is too large.');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON.');
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host !== req.headers.host) throw new ApiError(403, 'Cross-origin requests are not allowed.');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(403, 'Invalid request origin.');
  }
}

async function handleApi(req, res, pathname) {
  const method = req.method;
  const route = pathname.slice('/api'.length) || '/';
  const body = method === 'POST' || method === 'PUT' ? await readJson(req) : {};
  if (method === 'POST' || method === 'PUT') assertSameOrigin(req);

  if (route === '/auth/register-patient' && method === 'POST') return register(body, 'patient');
  if (route === '/auth/register-staff' && method === 'POST') return register(body, 'staff');
  if (route === '/auth/login' && method === 'POST') {
    const email = clean(body.email, 254).toLowerCase();
    const password = String(body.password ?? '');
    const user = statements.userByEmail.get(email);
    if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
      throw new ApiError(401, 'Incorrect email or password.');
    }
    const sessionToken = token();
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString();
    statements.insertSession.run(sessionDigest(sessionToken), user.id, expiresAt);
    setSessionCookie(res, sessionToken, SESSION_DAYS * 86_400);
    return { user: publicUser(user) };
  }
  if (route === '/auth/logout' && (method === 'POST' || method === 'GET')) {
    const sessionToken = getCookie(req, 'medalert_session');
    if (/^[a-f0-9]{64}$/i.test(sessionToken)) statements.deleteSession.run(sessionDigest(sessionToken));
    setSessionCookie(res, '', 0);
    return { ok: true };
  }

  const user = sessionUser(req);
  if (route === '/auth/me' && method === 'GET') {
    if (!user) throw new ApiError(401, 'Not signed in.');
    return { user: publicUser(user) };
  }
  if (!user) throw new ApiError(401, 'Please sign in.');

  if (route === '/profile' && method === 'GET') {
    const row = statements.profileByUser.get(user.id);
    if (!row) throw new ApiError(404, 'No profile yet.');
    const { qr, ...profile } = profileFromRow(row);
    return { profile };
  }
  if (route === '/profile' && method === 'PUT') {
    if (user.role !== 'patient') throw new ApiError(403, 'Patients only.');
    const profile = saveProfile(user.id, body);
    const { qr, ...publicProfile } = profile;
    return { profile: publicProfile };
  }
  if (route === '/profile/consent' && method === 'PUT') {
    const profile = statements.profileByUser.get(user.id);
    if (!profile) throw new ApiError(404, 'Save your profile first.');
    statements.updateConsent.run(body.consent ? 1 : 0, user.id);
    return { ok: true };
  }
  if (route === '/profile/qr' && method === 'GET') {
    const row = statements.profileByUser.get(user.id);
    if (!row) throw new ApiError(404, 'Save your profile first.');
    return qrFor(profileFromRow(row));
  }
  if (route === '/profile/access-log' && method === 'GET') {
    const entries = db.prepare(`
      SELECT access_log.accessed_at AS at, users.name AS staff_name, users.staff_type, users.hospital, access_log.method
      FROM access_log JOIN users ON users.id = access_log.staff_id
      WHERE access_log.patient_id = ? ORDER BY access_log.accessed_at DESC, access_log.id DESC LIMIT ?
    `).all(user.id, MAX_LOG).map((entry) => ({
      at: entry.at,
      staff_name: entry.staff_name || 'Unknown',
      staff_role: STAFF[entry.staff_type] || 'Staff',
      hospital: entry.hospital || '',
      method: entry.method,
    }));
    return { entries };
  }
  if (route === '/lookup' && method === 'POST') {
    if (user.role !== 'staff') throw new ApiError(403, 'Medical staff only.');
    return lookup(user, body);
  }
  if (route.startsWith('/auth/') || route.startsWith('/profile') || route === '/lookup') {
    throw new ApiError(405, 'Method not allowed.');
  }
  throw new ApiError(404, 'Not found.');
}

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') throw new ApiError(405, 'Method not allowed.');
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw new ApiError(400, 'Invalid URL path.');
  }
  const root = resolve(FRONTEND_ROOT);
  let file = resolve(root, `.${decoded}`);
  if (file !== root && !file.startsWith(`${root}${sep}`)) throw new ApiError(403, 'Forbidden.');
  if (statSync(file, { throwIfNoEntry: false })?.isDirectory()) file = resolve(file, 'index.html');
  let contents;
  try {
    contents = readFileSync(file);
  } catch {
    throw new ApiError(404, 'Not found.');
  }
  res.writeHead(200, {
    'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : contents);
}

const handleRequest = async (req, res) => {
  let pathname;
  try {
    pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
    if (pathname === '/health' && req.method === 'GET') {
      db.prepare('SELECT 1').get();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (pathname.startsWith('/api/')) {
      const data = await handleApi(req, res, pathname);
      if (!res.headersSent) sendJson(res, 200, data);
      return;
    }
    if (pathname === '/api') throw new ApiError(404, 'Not found.');
    serveStatic(req, res, pathname);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    if (error instanceof ApiError) {
      sendJson(res, error.status, { error: error.message, fields: error.fields });
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: 'The server could not complete this request.' });
  }
};

const server = process.env.NODE_ENV === 'production'
  ? createHttpServer(handleRequest)
  : createHttpsServer(loadTlsCertificate(), handleRequest);

server.listen(PORT, HOST, () => {
  const protocol = process.env.NODE_ENV === 'production' ? 'http' : 'https';
  console.log(`MedAlert listening on ${protocol}://${HOST}:${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});

function close() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
