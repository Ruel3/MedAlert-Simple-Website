import { api } from './api.js';
import { clear, field, h, icon, svg, telLink, toast } from './ui.js';
import {
  cleanScanned, formatDateTime, isEmail, isNationalId, isPhone, joinList, passwordProblems, qrPath, splitList,
} from './utils.js';

const BLOOD = ['Unknown', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const INSURANCE = [
  ['none', 'No insurance (self-pay)'], ['national', 'National / public scheme'], ['private', 'Private insurance'],
  ['employer', 'Employer / group cover'], ['travel', 'Travel insurance'],
];

const input = (props) => h('input', props);
const select = (id, options, value) =>
  h('select', { id, name: id }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

function showFieldErrors(form, fields) {
  form.querySelectorAll('.field').forEach((f) => {
    f.classList.remove('has-error');
    f.querySelector('.error-text').textContent = '';
  });
  for (const [key, msg] of Object.entries(fields || {})) {
    const el = form.querySelector(`[name="${CSS.escape(key)}"]`);
    const wrap = el && el.closest('.field');
    if (wrap) {
      wrap.classList.add('has-error');
      wrap.querySelector('.error-text').textContent = msg;
    }
  }
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  button.textContent = busy ? 'Please wait…' : label;
}

// ------------------------------------------------------------------ home
export function homeView(ctx) {
  const feature = (ic, title, text) =>
    h('article', { class: 'card feature' }, h('div', { class: 'feature-icon' }, icon(ic, 26)), h('h3', {}, title), h('p', {}, text));
  const step = (n, title, text) =>
    h('li', { class: 'step' }, h('span', { class: 'step-num' }, n), h('div', {}, h('h3', {}, title), h('p', {}, text)));
  return h('div', {},
    h('section', { class: 'hero' },
      h('div', { class: 'container hero-inner' },
        h('div', { class: 'hero-copy' },
          h('p', { class: 'eyebrow' }, 'Emergency Medical Risk Profile'),
          h('h1', {}, 'The facts that save lives, ready in seconds.'),
          h('p', { class: 'lead' }, 'Keep your allergies, conditions, medications, blood type, emergency contact and insurance in one profile. Hospital staff can open it with a QR code when every second counts.'),
          h('div', { class: 'hero-actions' },
            h('a', { class: 'btn btn-primary btn-lg', href: '#/register' }, 'Create your profile'),
            h('a', { class: 'btn btn-ghost btn-lg', href: '#/login' }, 'Sign in'))),
        h('div', { class: 'hero-card card', 'aria-hidden': 'true' },
          h('div', { class: 'mock-head' }, icon('shield', 22), h('strong', {}, 'Emergency profile')),
          h('div', { class: 'mock-row danger' }, h('span', {}, 'Allergy'), h('strong', {}, 'Penicillin')),
          h('div', { class: 'mock-row' }, h('span', {}, 'Condition'), h('strong', {}, 'Type 2 diabetes')),
          h('div', { class: 'mock-row' }, h('span', {}, 'Blood type'), h('strong', {}, 'O+')),
          h('div', { class: 'mock-row' }, h('span', {}, 'Insurance'), h('strong', {}, 'Private cover')),
          h('div', { class: 'mock-foot' }, icon('lock', 16), 'Access logged')))),
    h('section', { class: 'section' },
      h('div', { class: 'container' },
        h('h2', { class: 'section-title' }, 'Built for the first minutes of an emergency'),
        h('div', { class: 'grid grid-3' },
          feature('heart', 'Critical facts first', 'Allergies, conditions and medications are shown before anything else, so responders can act safely.'),
          feature('insurance', 'Insurance ready', 'Choose your insurance category and policy details so admission is faster, with no billing data stored.'),
          feature('lock', 'Understand what you share', 'Your QR code contains only a secure reference. Medical details are returned to signed-in staff only when sharing is enabled, and access is recorded.')))),
    h('section', { class: 'section section-alt' },
      h('div', { class: 'container' },
        h('h2', { class: 'section-title' }, 'How it works'),
        h('ol', { class: 'steps' },
          step('1', 'Create your profile', 'Add your medical facts, emergency contact and insurance once.'),
          step('2', 'Keep your QR code', 'It contains only a secure reference, not your medical details.'),
          step('3', 'Staff look you up', 'Signed-in ER doctors, nurses and paramedics scan the code or search by national ID or phone when you have enabled sharing.'),
          step('4', 'Review your access log', 'See who viewed your profile, when and from which hospital.')))));
}

// ------------------------------------------------------------------ auth
export function loginView(ctx) {
  const form = h('form', { novalidate: true, autocomplete: 'on' });
  const email = input({ id: 'email', name: 'email', type: 'email', autocomplete: 'username', required: true, maxlength: 254 });
  const password = input({ id: 'password', name: 'password', type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
  const message = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Sign in');
  form.append(field('Email', email, { id: 'email' }), field('Password', password, { id: 'password' }), message, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.textContent = '';
    if (!isEmail(email.value) || !password.value) { message.textContent = 'Enter your email and password.'; return; }
    setBusy(submit, true, 'Sign in');
    try {
      const data = await api('/auth/login', { method: 'POST', body: { email: email.value.trim(), password: password.value } });
      password.value = '';
      ctx.setUser(data.user);
      ctx.go('#/dashboard');
    } catch (err) {
      message.textContent = err.message;
    } finally { setBusy(submit, false, 'Sign in'); }
  });
  return authShell('Welcome back', 'Sign in to manage your profile or look up a patient.', form,
    h('p', { class: 'auth-switch' }, 'New to MedAlert? ', h('a', { href: '#/register' }, 'Create an account')));
}

export function registerView(ctx) {
  let kind = 'patient';
  const holder = h('div', {});
  const tabs = h('div', { class: 'segmented', role: 'tablist' });
  const draw = () => {
    clear(tabs); clear(holder);
    [['patient', 'I am a patient'], ['staff', 'I am medical staff']].forEach(([k, label]) =>
      tabs.append(h('button', { type: 'button', role: 'tab', 'aria-selected': k === kind, class: k === kind ? 'active' : '', onclick: () => { kind = k; draw(); } }, label)));
    holder.append(registerForm(ctx, kind));
  };
  draw();
  return authShell('Create your account', 'Free and instant. Choose patient or medical staff.',
    h('div', {}, tabs, holder), h('p', { class: 'auth-switch' }, 'Already registered? ', h('a', { href: '#/login' }, 'Sign in')));
}

function registerForm(ctx, kind) {
  const form = h('form', { novalidate: true });
  const f = (id, label, props = {}) => field(label, input({ id, name: id, ...props }), { id, hint: props.hint });
  const mk = (id, label, type, extra = {}) => field(label, input({ id, name: id, type, maxlength: extra.maxlength ?? 120, ...extra }), { id });
  form.append(mk('name', 'Full name', 'text', { autocomplete: 'name' }), mk('email', 'Email', 'email', { autocomplete: 'email', maxlength: 254 }),
    mk('phone', 'Phone number', 'tel', { autocomplete: 'tel', placeholder: '+254700000000', maxlength: 30 }));
  if (kind === 'patient') form.append(mk('national_id', 'National ID number', 'text', {
    maxlength: 8, minlength: 8, inputmode: 'numeric', pattern: '[0-9]{8}', required: true,
  }));
  else {
    form.append(field('Role', select('staff_type', [['doctor', 'ER doctor'], ['nurse', 'Nurse'], ['paramedic', 'Paramedic']], 'doctor'), { id: 'staff_type' }),
      mk('hospital', 'Hospital or organisation', 'text'));
  }
  const pw = input({ id: 'password', name: 'password', type: 'password', autocomplete: 'new-password', minlength: 6, maxlength: 12, required: true });
  form.append(field('Password', pw, { id: 'password', hint: 'Use 6 to 12 characters.' }));
  const message = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Create account');
  form.append(message, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.textContent = '';
    const body = Object.fromEntries(new FormData(form).entries());
    const local = {};
    if (!body.name?.trim()) local.name = 'Full name is required.';
    if (!isEmail(body.email)) local.email = 'Enter a valid email address.';
    if (!isPhone(body.phone)) local.phone = 'Enter 7 to 15 digits, optionally starting with +.';
    if (kind === 'patient' && !isNationalId(body.national_id)) local.national_id = 'Enter an 8-digit National ID number.';
    const pwProblems = passwordProblems(body.password);
    if (pwProblems.length) local.password = pwProblems[0];
    if (Object.keys(local).length) { showFieldErrors(form, local); return; }
    showFieldErrors(form, {});
    setBusy(submit, true, 'Create account');
    try {
      await api(kind === 'patient' ? '/auth/register-patient' : '/auth/register-staff', { method: 'POST', body });
      toast('Account created. Please sign in.', 'success');
      ctx.go('#/login');
    } catch (err) {
      showFieldErrors(form, err.fields);
      message.textContent = err.fields?.form || (Object.keys(err.fields).length ? '' : err.message);
    } finally { setBusy(submit, false, 'Create account'); }
  });
  return form;
}

function authShell(title, subtitle, ...content) {
  return h('section', { class: 'auth' },
    h('div', { class: 'auth-card card' }, h('h1', {}, title), h('p', { class: 'muted' }, subtitle), ...content));
}

// ------------------------------------------------------------------ dashboard router
export function dashboardView(ctx) {
  const u = ctx.user;
  const head = h('div', { class: 'page-head' },
    h('div', {}, h('p', { class: 'eyebrow' }, u.label), h('h1', {}, `Hello, ${u.name}`)));
  const body = u.role === 'patient' ? patientDash(ctx) : staffDash(ctx);
  return h('div', { class: 'container page' }, head, body);
}

// ------------------------------------------------------------------ patient
function patientDash(ctx) {
  const tabs = ['Profile', 'QR code', 'Access history'];
  let active = 0;
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  const panel = h('div', { class: 'tab-panel', role: 'tabpanel' });
  let profile = null;
  const draw = async () => {
    clear(bar); clear(panel);
    tabs.forEach((t, i) => bar.append(h('button', { type: 'button', role: 'tab', 'aria-selected': i === active, class: i === active ? 'active' : '', onclick: () => { active = i; draw(); } }, t)));
    if (active === 0) panel.append(profileForm(profile, (p) => { profile = p; draw(); }));
    if (active === 1) panel.append(await qrPanel(profile));
    if (active === 2) panel.append(await accessPanel());
  };
  const start = async () => {
    try { profile = (await api('/profile')).profile; } catch (err) { if (err.status !== 404) toast(err.message, 'error'); }
    draw();
  };
  start();
  return h('div', {}, bar, panel);
}

function profileForm(profile, onSaved) {
  const p = profile || { blood_type: 'Unknown', allergies: [], conditions: [], medications: [], emergency_contact: {}, insurance: { category: 'none' }, consent: true };
  const form = h('form', { novalidate: true, class: 'stack' });
  const ta = (id, label, items, hint) => field(label, h('textarea', { id, name: id, rows: 3, maxlength: 1600 }, joinList(items)), { id, hint });
  const ic = p.emergency_contact || {};
  const ins = p.insurance || { category: 'none' };

  const medical = h('section', { class: 'card' }, h('h2', {}, 'Medical information'),
    h('div', { class: 'grid grid-2' },
      field('Blood type', select('blood_type', BLOOD.map((b) => [b, b]), p.blood_type), { id: 'blood_type' }), h('div', {})),
    h('div', { class: 'grid grid-3' },
      ta('allergies', 'Allergies', p.allergies, 'One per line'), ta('conditions', 'Medical conditions', p.conditions, 'One per line'),
      ta('medications', 'Current medications', p.medications, 'One per line')));

  const contact = h('section', { class: 'card' }, h('h2', {}, 'Emergency contact'),
    h('div', { class: 'grid grid-3' },
      field('Name', input({ id: 'emergency_contact.name', name: 'emergency_contact.name', value: ic.name || '', maxlength: 100 }), { id: 'emergency_contact.name' }),
      field('Phone', input({ id: 'emergency_contact.phone', name: 'emergency_contact.phone', type: 'tel', value: ic.phone || '', maxlength: 30 }), { id: 'emergency_contact.phone' }),
      field('Relationship', input({ id: 'emergency_contact.relationship', name: 'emergency_contact.relationship', value: ic.relationship || '', maxlength: 50 }), { id: 'emergency_contact.relationship' })));

  const insFields = h('div', { class: 'grid grid-3' },
    field('Provider', input({ id: 'insurance.provider', name: 'insurance.provider', value: ins.provider || '', maxlength: 100 }), { id: 'insurance.provider' }),
    field('Policy / member number', input({ id: 'insurance.policy_number', name: 'insurance.policy_number', value: ins.policy_number || '', maxlength: 50 }), { id: 'insurance.policy_number' }),
    field('Valid until', input({ id: 'insurance.valid_until', name: 'insurance.valid_until', type: 'date', value: ins.valid_until || '' }), { id: 'insurance.valid_until' }));
  const cat = select('insurance.category', INSURANCE, ins.category || 'none');
  cat.name = 'insurance.category';
  const toggleIns = () => insFields.classList.toggle('hidden', cat.value === 'none');
  cat.addEventListener('change', toggleIns);
  const insurance = h('section', { class: 'card' }, h('h2', {}, 'Insurance'),
    h('p', { class: 'muted' }, 'Shown to verified staff after your critical medical facts. Only the details below are stored.'),
    h('div', { class: 'grid grid-3' }, field('Insurance category', cat, { id: 'insurance.category' })), insFields);
  toggleIns();

  const consent = input({ id: 'consent', type: 'checkbox', checked: p.consent !== false, role: 'switch' });
  const privacy = h('section', { class: 'card consent' },
    h('div', {}, h('h2', {}, 'Sharing consent'), h('p', { class: 'muted' }, 'This controls whether signed-in medical staff can retrieve your profile through MedAlert. Your QR contains only a secure reference, not medical details. Saved immediately.')),
    h('label', { class: 'switch' }, consent, h('span', { class: 'slider' }), h('span', { class: 'sr-only' }, 'Allow verified staff to view my profile')));
  consent.addEventListener('change', async () => {
    if (!profile) { toast('Save your profile first.', 'info'); consent.checked = true; return; }
    try { await api('/profile/consent', { method: 'PUT', body: { consent: consent.checked } }); toast(consent.checked ? 'Sharing enabled.' : 'Sharing turned off.', 'success'); }
    catch (err) { consent.checked = !consent.checked; toast(err.message, 'error'); }
  });

  const message = h('p', { class: 'form-error', role: 'alert' });
  const save = h('button', { class: 'btn btn-primary btn-lg', type: 'submit' }, profile ? 'Save changes' : 'Create my profile');
  form.append(medical, contact, insurance, privacy, message, save);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.textContent = '';
    const g = (n) => form.querySelector(`[name="${CSS.escape(n)}"]`).value;
    const body = {
      blood_type: g('blood_type'), allergies: splitList(g('allergies')), conditions: splitList(g('conditions')), medications: splitList(g('medications')),
      emergency_contact: { name: g('emergency_contact.name'), phone: g('emergency_contact.phone'), relationship: g('emergency_contact.relationship') },
      insurance: { category: g('insurance.category'), provider: g('insurance.provider'), policy_number: g('insurance.policy_number'), valid_until: g('insurance.valid_until') },
    };
    setBusy(save, true, profile ? 'Save changes' : 'Create my profile');
    try {
      const res = await api('/profile', { method: 'PUT', body });
      showFieldErrors(form, {});
      toast('Profile saved.', 'success');
      onSaved(res.profile);
    } catch (err) {
      showFieldErrors(form, err.fields);
      message.textContent = err.message;
    } finally { setBusy(save, false, profile ? 'Save changes' : 'Create my profile'); }
  });
  return form;
}

async function qrPanel(profile) {
  if (!profile) return h('div', { class: 'card empty' }, icon('qr', 32), h('h2', {}, 'No QR code yet'), h('p', {}, 'Save your profile first and your QR code is created automatically.'));
  const holder = h('div', { class: 'qr-holder' });
  const render = (qr) => {
    clear(holder);
    const n = qr.matrix.length + 8;
    holder.append(svg('svg', { viewBox: `0 0 ${n} ${n}`, class: 'qr', role: 'img', 'aria-label': 'Your MedAlert QR code', 'shape-rendering': 'crispEdges' },
      svg('rect', { width: n, height: n, fill: '#fff' }), svg('path', { d: qrPath(qr.matrix), fill: '#000' })));
  };
  try { render((await api('/profile/qr')).qr); } catch (err) { return h('div', { class: 'card' }, err.message); }
  const print = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => window.print() }, 'Print QR card');
  return h('div', { class: 'grid grid-2 qr-layout' },
    h('section', { class: 'card qr-card', id: 'print-card' }, h('p', { class: 'eyebrow' }, 'MedAlert emergency card'), holder,
      h('p', { class: 'qr-caption' }, 'This code contains no medical information. It is a secure reference that signed-in medical staff can use to request your profile when sharing is enabled.')),
    h('section', { class: 'card stack no-print' }, h('h2', {}, 'Your QR code'),
      h('p', {}, 'The QR contains only a secure reference, not your medical details. Staff must sign in and sharing must be enabled to retrieve your profile.'),
      h('div', { class: 'row' }, print),
      h('p', { class: 'muted' }, 'Treat the QR as private. Updating your profile changes the information staff receive when this code is scanned, but it cannot invalidate copies you already printed or shared.')));
}

async function accessPanel() {
  let entries = [];
  try { entries = (await api('/profile/access-log')).entries; } catch (err) { return h('div', { class: 'card' }, err.message); }
  if (!entries.length) return h('div', { class: 'card empty' }, icon('clock', 32), h('h2', {}, 'No access yet'), h('p', {}, 'When medical staff view your profile it will appear here.'));
  const label = { qr: 'QR code', national_id: 'National ID', phone: 'Phone number' };
  return h('div', { class: 'card table-wrap' }, h('h2', {}, 'Who viewed your profile'),
    h('table', {}, h('thead', {}, h('tr', {}, ['When', 'Who', 'Role', 'Hospital', 'Method'].map((t) => h('th', { scope: 'col' }, t)))),
      h('tbody', {}, entries.map((e) => h('tr', {}, h('td', {}, formatDateTime(e.at)), h('td', {}, e.staff_name), h('td', {}, e.staff_role), h('td', {}, e.hospital), h('td', {}, label[e.method] || e.method))))));
}

// ------------------------------------------------------------------ staff
function staffDash(ctx) {
  const isDoctor = ctx.user.staff_type === 'doctor';
  const result = h('div', { 'aria-live': 'polite' });
  const methods = [
    ...(isDoctor ? [['qr', 'QR code']] : []),
    ['national_id', 'National ID'],
    ['phone', 'Phone number'],
  ];
  const method = select('method', methods, isDoctor ? 'qr' : 'national_id');
  const value = input({ id: 'value', name: 'value', type: 'text', required: true, maxlength: 1000, autocomplete: 'off' });
  method.addEventListener('change', () => {
    if (method.value !== 'qr') scanHelp?.querySelector('.scan-stop')?.click();
    value.placeholder = { qr: 'Use the camera scanner below', national_id: 'National ID number', phone: '+254700000000' }[method.value];
    value.maxLength = method.value === 'national_id' ? 8 : 1000;
    value.inputMode = method.value === 'national_id' ? 'numeric' : 'text';
    value.readOnly = method.value === 'qr';
    value.value = '';
    lookupSubmit.classList.toggle('hidden', method.value === 'qr');
    scanHelp?.classList.toggle('hidden', method.value !== 'qr');
  });
  const message = h('p', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Look up profile');
  const lookupSubmit = h('div', { class: 'lookup-submit' }, submit);
  const scanHelp = isDoctor
    ? (navigator.mediaDevices?.getUserMedia
      ? scanButton(value, () => form.requestSubmit())
      : h('p', { class: 'muted small' }, 'Camera scanning requires a secure connection (HTTPS) and browser camera access. Use National ID or phone instead.'))
    : null;
  const form = h('form', { class: 'card lookup-form', novalidate: true },
    h('h2', {}, 'Emergency lookup'),
    h('div', { class: 'lookup-row' }, field('Search by', method, { id: 'method' }), field('Search value', value, { id: 'value' }), lookupSubmit),
    scanHelp || '', message);
  method.dispatchEvent(new Event('change'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    message.textContent = ''; clear(result);
    if (method.value === 'qr' && !value.value.trim()) {
      message.textContent = 'Scan a QR code with the camera to continue.';
      return;
    }
    if (!value.value.trim()) { message.textContent = 'Enter a value to search.'; return; }
    if (method.value === 'national_id' && !isNationalId(value.value)) {
      message.textContent = 'Enter an 8-digit National ID number.';
      return;
    }
    setBusy(submit, true, 'Look up profile');
    try {
      const res = await api('/lookup', { method: 'POST', body: { method: method.value, value: cleanScanned(value.value) } });
      result.append(profileResult(res.result));
      value.value = '';
    } catch (err) { message.textContent = err.message; }
    finally { setBusy(submit, false, 'Look up profile'); }
  });
  return h('div', { class: 'stack' }, form, result,
    h('p', { class: 'muted small' }, 'Only doctors signed in to MedAlert can scan QR codes. QR lookups require profile sharing to be enabled. Staff access is recorded in the patient’s access history.'));
}

function scanButton(valueInput, submit) {
  const btn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Scan with camera');
  btn.addEventListener('click', async () => {
    let stream;
    const video = h('video', { class: 'scan-video', playsinline: true, muted: true });
    const stop = h('button', { class: 'btn btn-ghost scan-stop', type: 'button', onclick: () => {
      stream?.getTracks().forEach((t) => t.stop());
      video.remove();
      stop.remove();
      btn.disabled = false;
      btn.textContent = 'Scan with camera';
    } }, 'Stop scanning');
    btn.disabled = true;
    btn.textContent = 'Opening camera…';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (!btn.isConnected) { stream.getTracks().forEach((t) => t.stop()); return; }
      video.srcObject = stream;
      btn.after(video, stop);
      btn.textContent = 'Camera active';
      await video.play();
      if (!video.isConnected) { stop.click(); return; }
      const detector = typeof window.BarcodeDetector === 'function'
        ? new window.BarcodeDetector({ formats: ['qr_code'] })
        : null;
      const canvas = detector ? null : document.createElement('canvas');
      const context = canvas?.getContext('2d', { willReadFrequently: true });
      if (canvas && !context) throw new Error('Canvas QR decoding is unavailable.');
      const tick = async () => {
        if (!video.isConnected) { stream?.getTracks().forEach((t) => t.stop()); return; }
        let rawValue;
        try {
          if (detector) {
            rawValue = (await detector.detect(video))[0]?.rawValue;
          } else if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth) {
            canvas.width = Math.min(video.videoWidth, 640);
            canvas.height = Math.round(video.videoHeight * canvas.width / video.videoWidth);
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            rawValue = window.jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data;
          }
        }
        catch {
          stop.click();
          toast('Could not read a QR code. Check camera access and try again.', 'error');
          return;
        }
        if (rawValue) {
          valueInput.value = rawValue;
          stop.click();
          submit();
          return;
        }
        if (video.isConnected) {
          if (detector) requestAnimationFrame(tick);
          else setTimeout(tick, 100);
        }
      };
      tick();
    } catch (error) {
      stream?.getTracks().forEach((t) => t.stop());
      video.remove();
      stop.remove();
      btn.disabled = false;
      btn.textContent = 'Scan with camera';
      const message = error.name === 'NotAllowedError'
        ? 'Camera access was denied. Allow camera access and try again.'
        : error.name === 'NotFoundError'
          ? 'No camera was found on this device.'
          : 'Camera could not be started. Check browser camera access and try again.';
      toast(message, 'error');
    }
  });
  return h('div', { class: 'scan-controls' }, btn);
}

function chips(items, kind) {
  if (!items.length) return h('p', { class: 'muted' }, 'None recorded');
  return h('div', { class: 'chips' }, items.map((i) => h('span', { class: `chip chip-${kind}` }, i)));
}

function profileResult(r) {
  const ic = r.emergency_contact, ins = r.insurance;
  return h('div', { class: 'result stack' },
    h('div', { class: 'result-head' }, h('div', {}, h('p', { class: 'eyebrow' }, 'Patient'), h('h2', {}, r.patient.name)),
      h('div', { class: 'blood' }, h('span', {}, 'Blood type'), h('strong', {}, r.blood_type))),
    h('section', { class: 'card critical' }, h('h3', {}, 'Critical information'),
      h('div', { class: 'grid grid-3' },
        h('div', {}, h('h4', {}, 'Allergies'), chips(r.allergies, 'danger')),
        h('div', {}, h('h4', {}, 'Conditions'), chips(r.conditions, 'warn')),
        h('div', {}, h('h4', {}, 'Medications'), chips(r.medications, 'info')))),
    h('div', { class: 'grid grid-2' },
      h('section', { class: 'card' }, h('h3', {}, 'Emergency contact'), h('p', { class: 'big' }, ic.name || 'Not provided'),
        h('p', { class: 'muted' }, ic.relationship), ic.phone ? telLink(ic.phone) : null),
      h('section', { class: 'card' }, h('h3', {}, 'Insurance'), h('p', { class: 'big' }, ins.label || 'Not provided'),
        ins.category !== 'none' ? h('dl', { class: 'dl' }, h('dt', {}, 'Provider'), h('dd', {}, ins.provider), h('dt', {}, 'Policy number'), h('dd', {}, ins.policy_number),
          ins.valid_until ? [h('dt', {}, 'Valid until'), h('dd', {}, ins.valid_until)] : null) : null)),
    r.updated_at ? h('p', { class: 'muted small' }, `Profile last updated ${formatDateTime(r.updated_at)}.`) : null);
}
