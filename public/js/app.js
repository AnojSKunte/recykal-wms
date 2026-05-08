// ═══════════════════════════════════════════════════════════════════
//  Recykal WMS — Main App
//  Handles: auth, routing, API calls, shared state
// ═══════════════════════════════════════════════════════════════════

// ── Global state ──────────────────────────────────────────────────
export const G = {
  user:     null,
  poData:   null,
  attData:  null,
  procData: null,
  drafts:   [],
  currentPage: null,
};

// ── Nav definition ─────────────────────────────────────────────────
const NAVDEF = [
  { key:'dashboard',  label:'Dashboard',      perm: null,              icon:'M3 3h7v7H3zm0 11h7v7H3zm11-11h7v7h-7zm0 11h7v7h-7z' },
  { key:'po',         label:'PO Requisition', perm:'PO form',          icon:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { key:'attendance', label:'Attendance',      perm:'Attendance form',  icon:'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { key:'processing', label:'Processing',      perm:'Processing form',  icon:'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

// ── API layer ──────────────────────────────────────────────────────
export const API = {
  async get(path) {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (res.status === 401) { App.showLogin(); return null; }
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) { App.showLogin(); return null; }
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

// ── Router ─────────────────────────────────────────────────────────
export const Nav = {
  async go(key) {
    // Lazy-load the page module
    const pages = {
      dashboard:  () => import('./pages/dashboard.js'),
      po:         () => import('./pages/po.js'),
      attendance: () => import('./pages/attendance.js'),
      processing: () => import('./pages/processing.js'),
      drafts:     () => import('./pages/processing.js'),
    };

    document.querySelectorAll('.nav-item, .nav-sub').forEach(n => n.classList.remove('active'));
    const navEl = document.getElementById('nav-' + key);
    if (navEl) navEl.classList.add('active');

    G.currentPage = key;

    const loader = pages[key];
    if (!loader) return;

    const mod = await loader();
    if (mod && mod.render) {
      const main = document.getElementById('main');
      main.innerHTML = '';
      await mod.render(main, G);
    }

    window.scrollTo(0, 0);
  }
};

// ── App init ───────────────────────────────────────────────────────
export const App = {
  async init() {
    // Check auth
    const user = await API.get('/api/user');
    if (!user) { this.showLogin(); return; }

    G.user = user;
    this.showApp(user);

    // Navigate to dashboard
    await Nav.go('dashboard');

    // Parallel background data loads
    this.loadFormData(user);
  },

  showLogin() {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-shell').style.display    = 'none';
  },

  showApp(user) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-shell').style.display    = 'flex';

    // Fill sidebar user info
    document.getElementById('su-name').textContent  = user.name  || user.email;
    document.getElementById('su-role').textContent  = user.role  || '—';
    document.getElementById('su-email').textContent = user.email || '';

    // Build nav
    const nav = document.getElementById('nav-list');
    nav.innerHTML = '';
    NAVDEF.forEach(item => {
      if (item.perm && user.permissions && !user.permissions[item.perm]) return;
      const el = document.createElement('div');
      el.className = 'nav-item'; el.id = 'nav-' + item.key;
      el.innerHTML = ico(item.icon) + '<span>' + item.label + '</span>';
      el.addEventListener('click', () => Nav.go(item.key));
      nav.appendChild(el);
      // Drafts sub-item under processing
      if (item.key === 'processing') {
        const sub = document.createElement('div');
        sub.className = 'nav-sub'; sub.id = 'nav-drafts';
        sub.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>Drafts';
        sub.addEventListener('click', () => Nav.go('drafts'));
        nav.appendChild(sub);
      }
    });

    // Hide loader
    const loader = document.getElementById('app-loader');
    loader.classList.add('out');
    setTimeout(() => loader.style.display = 'none', 450);
  },

  async loadFormData(user) {
    const perms = user.permissions || {};
    const loads = [];
    if (!user.permissions || perms['PO form'] !== false) {
      loads.push(API.get('/api/formdata/po').then(d => { if (d) G.poData = d; }));
    }
    if (!user.permissions || perms['Attendance form'] !== false) {
      loads.push(API.get('/api/formdata/attendance').then(d => { if (d) G.attData = d; }));
    }
    if (!user.permissions || perms['Processing form'] !== false) {
      loads.push(API.get('/api/formdata/processing').then(d => { if (d) G.procData = d; }));
      loads.push(API.get('/api/processing/drafts').then(d => { if (d) { G.drafts = d; updateDraftBadge(d.length); } }));
    }
    await Promise.allSettled(loads);
  },

  async logout() {
    await API.post('/api/auth/logout', {});
    this.showLogin();
  },
};

function updateDraftBadge(n) {
  const el = document.getElementById('nav-drafts');
  if (!el) return;
  let b = el.querySelector('.nav-badge');
  if (n > 0) {
    if (!b) { b = document.createElement('span'); b.className = 'nav-badge'; el.appendChild(b); }
    b.textContent = n;
  } else if (b) {
    b.remove();
  }
}

function ico(d) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}

// Shared form utilities (used by all page modules)
export function xe(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
export function fmt(n) {
  return Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
}
export function filterCenters(all, user) {
  if (!user?.length) return all || [];
  return (all||[]).filter(c => user.map(u=>String(u).trim()).includes(String(c).trim()));
}

// ── Boot ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => App.init());
