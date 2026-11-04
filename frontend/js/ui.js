// Small DOM helpers. User data is only ever inserted as text nodes, never as HTML.
const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'required' || key === 'open') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) if (c) el.append(c);
  return el;
}

const ICONS = {
  shield: 'M12 2 4 5v6c0 5 3.400 9.300 8 11 4.600-1.700 8-6 8-11V5l-8-3z',
  qr: 'M3 3h7v7H3V3zm2 2v3h3V5H5zm9-2h7v7h-7V3zm2 2v3h3V5h-3zM3 14h7v7H3v-7zm2 2v3h3v-3H5zm9-2h2v2h-2v-2zm4 0h3v3h-2v-1h-1v-2zm-4 4h2v3h-2v-3zm4 1h3v2h-3v-2z',
  lock: 'M6 10V8a6 6 0 1 1 12 0v2h1a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h1zm2 0h8V8a4 4 0 1 0-8 0v2z',
  clock: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5v5.400l4 2.300-1 1.700-5-3V7h2z',
  heart: 'M12 21s-8-5.300-8-11a4.500 4.500 0 0 1 8-2.800A4.500 4.500 0 0 1 20 10c0 5.700-8 11-8 11z',
  user: 'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-4.400 0-8 2.200-8 5v2h16v-2c0-2.800-3.600-5-8-5z',
  check: 'M9 16.200 4.800 12l-1.400 1.400L9 19 21 7l-1.400-1.400L9 16.200z',
  phone: 'M6.600 10.800a15 15 0 0 0 6.600 6.600l2.200-2.200a1 1 0 0 1 1-.25c1.100.37 2.300.57 3.600.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.500a1 1 0 0 1 1 1c0 1.300.2 2.500.57 3.600a1 1 0 0 1-.25 1l-2.200 2.200z',
  insurance: 'M12 2 4 5v6c0 5 3.400 9.300 8 11 4.600-1.700 8-6 8-11V5l-8-3zm-1 14-3-3 1.400-1.400L11 13.200l4.600-4.600L17 10l-6 6z',
};

export function icon(name, size = 20) {
  const s = svg('svg', { viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': 'true', class: 'icon' });
  s.append(svg('path', { d: ICONS[name] || ICONS.shield, fill: 'currentColor' }));
  return s;
}

export function toast(message, type = 'info') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: `toast toast-${type}` }, message);
  while (box.children.length >= 3) box.firstChild.remove();   // keep the stack short
  box.append(t);
  setTimeout(() => t.remove(), 4000);
}

/** Link that is only created for a phone number that passes strict validation. */
export function telLink(phone, label) {
  const digits = String(phone || '').replace(/[\s\-().]/g, '');
  const a = h('a', { class: 'tel' }, icon('phone', 16), label || phone);
  if (/^\+?\d{7,15}$/.test(digits)) a.setAttribute('href', `tel:${digits}`);
  return a;
}

export function field(label, input, { id, error, hint } = {}) {
  return h('div', { class: error ? 'field has-error' : 'field' },
    h('label', { for: id }, label),
    input,
    hint ? h('p', { class: 'hint' }, hint) : null,
    h('p', { class: 'error-text', role: 'alert' }, error || ''));
}
