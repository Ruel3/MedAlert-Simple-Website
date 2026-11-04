import { api } from './api.js';
import { clear, h, toast } from './ui.js';
import { dashboardView, homeView, loginView, registerView } from './views.js';

const app = document.getElementById('app');
const nav = document.getElementById('nav');
const state = { user: null };

const ctx = {
  get user() { return state.user; },
  setUser(user) { state.user = user; renderNav(); },
  go(hash) { if (location.hash === hash) render(); else location.hash = hash; },
};

function renderNav() {
  clear(nav);
  if (state.user) {
    nav.append(h('a', { href: '#/dashboard' }, 'Dashboard'), h('span', { class: 'nav-user' }, state.user.name),
      h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: signOut }, 'Sign out'));
  } else {
    nav.append(h('a', { href: '#/login' }, 'Sign in'), h('a', { class: 'btn btn-primary btn-sm', href: '#/register' }, 'Get started'));
  }
}

async function signOut() {
  try {
    await api('/auth/logout', { method: 'POST' });
    ctx.setUser(null);
    ctx.go('#/');
  } catch (err) {
    toast(err.message, 'error');
  }
}

function render() {
  const route = location.hash.replace(/^#/, '') || '/';
  clear(app);
  let view;
  if (route === '/login') view = state.user ? redirect('#/dashboard') : loginView(ctx);
  else if (route === '/register') view = state.user ? redirect('#/dashboard') : registerView(ctx);
  else if (route === '/dashboard') view = state.user ? dashboardView(ctx) : redirect('#/login');
  else view = homeView(ctx);
  if (view) app.append(view);
  window.scrollTo(0, 0);
}

function redirect(hash) { queueMicrotask(() => ctx.go(hash)); return null; }

window.addEventListener('hashchange', render);

(async function start() {
  try {
    const data = await api('/auth/me');
    state.user = data.user;
  } catch { /* not signed in */ }
  renderNav();
  render();
})();
