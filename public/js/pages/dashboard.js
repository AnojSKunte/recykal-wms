import { API, Nav, G, xe, fmt } from '../app.js';

const NAVDEF = [
  { key:'po',         label:'PO Requisition', perm:'PO form',         d:'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
  { key:'attendance', label:'Attendance',      perm:'Attendance form', d:'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
  { key:'processing', label:'Processing',      perm:'Processing form', d:'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
];

let _activeCenters = [];
let _allPCs        = [];
let _pillsBuilt    = false;

export async function render(container, G) {
  const now = new Date();
  container.innerHTML = `
    <div class="pg-header">
      <div>
        <h1>Dashboard</h1>
        <div class="pg-header-sub">Recykal Warehouse Management System</div>
      </div>
      <div class="pg-date">${now.toLocaleDateString('en-IN',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</div>
    </div>
    <div class="pg-body">
      <div class="pc-filter" id="pc-filter" style="display:none">
        <span class="pc-filter-lbl">Center:</span>
      </div>
      <div class="dash-grid" id="dash-grid">
        ${statCard('dc-att',   '',     'Attendance Today',    'Submissions logged',   '')}
        ${statCard('dc-po',    'amber','Pending POs',         'Awaiting approval',    '')}
        ${statCard('dc-appr',  'blue', 'POs Approved Today',  'Approved this day',    '')}
        ${statCard('dc-wkr',   '',     'Total Workers',       'Across centers',       '')}
        ${statCard('dc-lots',  'purple','Active Lots',        'In inventory',         '')}
      </div>
      <div class="card">
        <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:12px">Quick Actions</div>
        <div class="quick-grid" id="quick-grid"></div>
      </div>
      <div class="card" id="gemini-card" style="display:none">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div style="font-size:13px;font-weight:600">AI Summary</div>
          <button class="btn-secondary" onclick="loadGeminiSummary()" style="height:30px;font-size:12px">Refresh</button>
        </div>
        <div id="gemini-summary" style="font-size:13.5px;color:var(--muted);line-height:1.8">Click refresh to generate a summary…</div>
      </div>
    </div>`;

  // Quick action cards
  const qg = container.querySelector('#quick-grid');
  NAVDEF.forEach(item => {
    if (item.perm && G.user?.permissions && !G.user.permissions[item.perm]) return;
    const btn = document.createElement('div');
    btn.className = 'quick-btn';
    btn.innerHTML = `<div class="quick-icon">${ico(item.d)}</div><div class="quick-name">${xe(item.label)}</div><div class="quick-sub">Open form →</div>`;
    btn.addEventListener('click', () => Nav.go(item.key));
    qg.appendChild(btn);
  });

  // Show Gemini card if API key available
  if (G.procData) container.querySelector('#gemini-card').style.display = 'block';

  // Load stats
  await loadStats([]);

  // Expose for inline onclick
  window.loadGeminiSummary = () => geminiSummary(container);
}

async function loadStats(centers) {
  _activeCenters = centers;
  const qs = centers.length ? '?centers=' + encodeURIComponent(centers.join(',')) : '';
  const d  = await API.get('/api/dashboard' + qs);
  if (!d) return;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };
  set('dc-att',  d.todayAttendance);
  set('dc-po',   d.pendingPOs);
  set('dc-appr', d.approvedToday);
  set('dc-wkr',  d.totalWorkers);
  set('dc-lots', d.activeLots);

  // Build PC pills once
  _allPCs = d.allPCs || [];
  if (_allPCs.length > 1 && !_pillsBuilt) {
    _pillsBuilt = true;
    buildPills(_allPCs);
  }
}

function buildPills(pcs) {
  const wrap = document.getElementById('pc-filter');
  if (!wrap) return;
  wrap.style.display = 'flex';

  const allPill = makePill('All', true, () => {
    const anyOff = pills.slice(1).some(p => !p.classList.contains('on'));
    pills.forEach(p => p.classList.toggle('on', anyOff));
    if (!anyOff) pills[0].classList.add('on');
    loadStats(anyOff ? [] : pcs);
  });
  wrap.appendChild(allPill);
  const pills = [allPill];

  pcs.forEach(pc => {
    const p = makePill(pc, true, () => {
      p.classList.toggle('on');
      const selected = pills.slice(1).filter(x => x.classList.contains('on')).map(x => x.dataset.pc);
      pills[0].classList.toggle('on', selected.length === pcs.length);
      loadStats(selected);
    });
    p.dataset.pc = pc;
    wrap.appendChild(p);
    pills.push(p);
  });
}

function makePill(label, on, onClick) {
  const el = document.createElement('span');
  el.className = 'pc-pill' + (on ? ' on' : '');
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

async function geminiSummary(container) {
  const el = container.querySelector('#gemini-summary');
  if (!el) return;
  el.textContent = 'Generating summary…';
  try {
    const res = await API.post('/api/gemini', { prompt: 'Summarise today\'s warehouse activity', mode: 'summarise', sheetContext: 'lots' });
    el.innerHTML = (res?.result || 'No summary available.').replace(/\n/g, '<br>');
  } catch (e) {
    el.textContent = 'Could not generate summary.';
  }
}

function statCard(id, cls, label, sub) {
  return `<div class="dash-card ${cls}">
    <div class="dc-lbl">${label}</div>
    <div class="dc-val" id="${id}">—</div>
    <div class="dc-sub">${sub}</div>
  </div>`;
}

function ico(d) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
}
