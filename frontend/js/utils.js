// Pure helper functions (no DOM access) so they can be unit tested in Node.

export const EMAIL_RE = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
export const PHONE_RE = /^\+?\d{7,15}$/;

export function normalizePhone(value) {
  return String(value ?? '').replace(/[\s\-().]/g, '');
}

export function isEmail(value) {
  return EMAIL_RE.test(String(value ?? '').trim());
}

export function isPhone(value) {
  return PHONE_RE.test(normalizePhone(value));
}

export function isNationalId(value) {
  return /^\d{8}$/.test(String(value ?? '').trim());
}

/** Returns a list of problems; an empty list means the password is acceptable. */
export function passwordProblems(password) {
  const length = String(password ?? '').length;
  if (length < 6) return ['Use at least 6 characters.'];
  if (length > 12) return ['Use no more than 12 characters.'];
  return [];
}

/** One entry per line (commas also separate). Trims, drops blanks and duplicates. */
export function splitList(text) {
  const seen = new Set();
  const out = [];
  for (const part of String(text ?? '').split(/[\n,]+/)) {
    const item = part.trim();
    if (item && !seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      out.push(item);
    }
  }
  return out;
}

export function joinList(items) {
  return Array.isArray(items) ? items.join('\n') : '';
}

export function formatDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Strip the MEDALERT: prefix and whitespace from scanned or pasted QR text. */
export function cleanScanned(text) {
  return String(text ?? '').trim();
}

/** Build one SVG path covering every dark module of a QR matrix (array of '0'/'1' strings). */
export function qrPath(matrix, quiet = 4) {
  const parts = [];
  matrix.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === '1') parts.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
  });
  return parts.join('');
}
