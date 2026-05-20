'use strict';

// ── Storage keys ───────────────────────────────────────────────
const KEYS = {
  faqs:    'bkn_ks.faqs.v1',
  items:   'bkn_ks.items.v1',
  vdos:    'bkn_ks.vdos.v1',
};

// ── Server URL ────────────────────────────────────────────────
const SERVER_URL = 'http://10.134.110.81:8765';

// ── Built-in category presets (label + badge colour) ──────────
const FAQ_CAT_PRESETS = {
  general:  { label: 'ทั่วไป',         cls: '' },
  drug:     { label: 'ยาและสูตร',      cls: 'orange' },
  process:  { label: 'กระบวนงาน',      cls: 'teal' },
  safety:   { label: 'ความปลอดภัย',   cls: 'purple' },
  clinical: { label: 'Clinical',        cls: 'green' },
};

const ITEM_CAT_PRESETS = {
  analgesic:     { label: 'Analgesic',     cls: 'orange' },
  antibiotic:    { label: 'Antibiotic',    cls: 'green' },
  cardiac:       { label: 'Cardiac',       cls: 'purple' },
  respiratory:   { label: 'Respiratory',   cls: 'teal' },
  gi:            { label: 'GI',            cls: 'amber' },
  anticoagulant: { label: 'Anticoagulant', cls: 'orange' },
  antidiabetic:  { label: 'Antidiabetic',  cls: 'green' },
  oncology:      { label: 'Oncology',      cls: 'purple' },
  other:         { label: 'Other',         cls: '' },
};

const DOSAGE_FORMS = ['Tablet','Capsule','Injection','Solution','Suspension','Inhaler','Patch','Cream/Ointment','Drops','Other'];

// ── App state ──────────────────────────────────────────────────
const state = {
  page:        'faqs',
  isAdmin:     false,
  authToken:   null,
  authUser:    null,
  authRole:    null,
  search:      '',
  filterCat:   'all',
  editType:    null,
  editId:      null,
  delType:     null,
  delId:       null,
  serverOk:    false,
};

// ── Utilities ──────────────────────────────────────────────────
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function esc(v) {
  return String(v ?? '').replace(/[&<>'"]/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[s])
  );
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso.slice(0, 10); }
}

function now() { return new Date().toISOString(); }

// ── Category helpers ───────────────────────────────────────────
function faqCat(key) {
  return FAQ_CAT_PRESETS[key] ?? { label: key || 'ทั่วไป', cls: '' };
}
function itemCat(key) {
  return ITEM_CAT_PRESETS[key] ?? { label: key || 'Other', cls: '' };
}

function allFaqCats() {
  const custom = [...new Set(getData(KEYS.faqs).map(f => f.category).filter(c => c && !FAQ_CAT_PRESETS[c]))];
  return { ...FAQ_CAT_PRESETS, ...Object.fromEntries(custom.map(c => [c, { label: c, cls: '' }])) };
}

function allItemCats() {
  const custom = [...new Set(getData(KEYS.items).map(i => i.category).filter(c => c && !ITEM_CAT_PRESETS[c]))];
  return { ...ITEM_CAT_PRESETS, ...Object.fromEntries(custom.map(c => [c, { label: c, cls: '' }])) };
}

// ── Storage ────────────────────────────────────────────────────
const cache = { faqs: null, items: null, vdos: null };

const KEY_COL = {
  [KEYS.faqs]:  'faqs',
  [KEYS.items]: 'items',
  [KEYS.vdos]:  'vdos',
};

function getServerUrl() { return SERVER_URL; }

async function pingServer(url, timeoutMs = 2000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/ping`, { signal: ctrl.signal });
    clearTimeout(t);
    return await r.json();
  } catch { clearTimeout(t); return null; }
}

function getData(key) {
  const col = KEY_COL[key];
  if (col && cache[col] !== null) return cache[col];
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}

function saveData(key, data) {
  const col = KEY_COL[key];
  if (col) cache[col] = data;
  localStorage.setItem(key, JSON.stringify(data));

  const base = getServerUrl();
  if (!base || !col) return;
  const headers = { 'Content-Type': 'application/json' };
  if (state.authToken) headers['Authorization'] = `Bearer ${state.authToken}`;
  fetch(`${base}/api/${col}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(data),
  }).catch(() => showToast('⚠ Server sync failed — data saved locally', 'error'));
}

async function loadAllFromServer() {
  const base = getServerUrl();
  if (!base) return false;
  try {
    const [faqs, items, vdos] = await Promise.all([
      fetch(`${base}/api/faqs`).then(r  => r.ok  ? r.json()  : Promise.reject()),
      fetch(`${base}/api/items`).then(r => r.ok  ? r.json()  : Promise.reject()),
      fetch(`${base}/api/vdos`).then(r  => r.ok  ? r.json()  : Promise.reject()),
    ]);
    cache.faqs  = Array.isArray(faqs)  ? faqs  : [];
    cache.items = Array.isArray(items) ? items : [];
    cache.vdos  = Array.isArray(vdos)  ? vdos  : [];
    return true;
  } catch {
    return false;
  }
}

function updateServerBar(configured, ok) {
  const el = document.getElementById('serverBar');
  if (!el) return;
  if (!configured) {
    el.innerHTML = '<div class="server-bar-off"><span class="server-dot-icon"></span>No server</div>';
    return;
  }
  const url = getServerUrl();
  const copyBtn = url
    ? `<button onclick="navigator.clipboard?.writeText('${url}')" style="margin-left:6px;background:none;border:none;cursor:pointer;font-size:10px;color:inherit;opacity:.7;" title="Copy URL">⧉</button>`
    : '';
  el.innerHTML = ok
    ? `<div class="server-bar-ok"><span class="server-dot-icon"></span>Server connected${copyBtn}</div>`
    : `<div class="server-bar-err"><span class="server-dot-icon"></span>Server unreachable${copyBtn}</div>`;
}

// ── File upload helper ─────────────────────────────────────────
async function uploadKsFile(file) {
  const ext      = file.name.split('.').pop().toLowerCase() || 'bin';
  const filename = `${uid()}.${ext}`;
  const buf      = await file.arrayBuffer();
  const headers  = { 'Content-Type': file.type || 'application/octet-stream' };
  if (state.authToken) headers['Authorization'] = `Bearer ${state.authToken}`;
  const r = await fetch(`${SERVER_URL}/api/ks-files/${filename}`, {
    method: 'PUT',
    headers,
    body: buf,
  });
  if (!r.ok) throw new Error('Upload failed');
  return `${SERVER_URL}/ks-files/${filename}`;
}

// ── Navigation ─────────────────────────────────────────────────
function navigateTo(page) {
  state.page      = page;
  state.search    = '';
  state.filterCat = 'all';
  renderPage();
  renderSidebar();
  updateNavActive();
}

function updateNavActive() {
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === state.page);
  });
}

// ── Sidebar ────────────────────────────────────────────────────
function renderSidebar() {
  const footer = document.getElementById('sidebarFooter');
  if (!footer) return;

  if (state.isAdmin) {
    footer.innerHTML = `
      <div class="admin-nav-label">Admin</div>
      <button class="nav-item ${state.page === 'admin-faqs'  ? 'active' : ''}" data-page="admin-faqs">
        <span class="nav-icon">✏️</span><span>Manage FAQs</span>
      </button>
      <button class="nav-item ${state.page === 'admin-items' ? 'active' : ''}" data-page="admin-items">
        <span class="nav-icon">💊</span><span>Manage Items</span>
      </button>
      <button class="nav-item ${state.page === 'admin-vdos'  ? 'active' : ''}" data-page="admin-vdos">
        <span class="nav-icon">🎬</span><span>Manage Vdos</span>
      </button>
      <button class="nav-item nav-admin-btn" id="btnAdminConsole">
        <span class="nav-icon">⚙️</span><span>Admin Console</span>
      </button>
      <button class="nav-item nav-logout" id="btnLogout">
        <span class="nav-icon">🚪</span><span>Logout (${esc(state.authUser || '')})</span>
      </button>
    `;
    document.getElementById('btnLogout')?.addEventListener('click', doLogout);
    document.getElementById('btnAdminConsole')?.addEventListener('click', () => {
      window.open(SERVER_URL, '_blank');
    });
  } else {
    footer.innerHTML = `
      <button class="nav-item nav-admin-btn" id="btnShowLogin">
        <span class="nav-icon">🔐</span><span>Admin</span>
      </button>
    `;
    document.getElementById('btnShowLogin')?.addEventListener('click', showLoginModal);
  }

  footer.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

// ── Page render dispatch ───────────────────────────────────────
function renderPage() {
  const el = document.getElementById('mainContent');
  switch (state.page) {
    case 'faqs':        el.innerHTML = buildFaqsPage();       break;
    case 'items':       el.innerHTML = buildItemsPage();      break;
    case 'vdos':        el.innerHTML = buildVdosPage();       break;
    case 'admin-faqs':  el.innerHTML = buildAdminFaqsPage();  break;
    case 'admin-items': el.innerHTML = buildAdminItemsPage(); break;
    case 'admin-vdos':  el.innerHTML = buildAdminVdosPage();  break;
    default:            el.innerHTML = buildFaqsPage();
  }
  bindPageEvents();
}

// ════════════════════════════════════════════════════════════════
// PUBLIC PAGES
// ════════════════════════════════════════════════════════════════

// ── FAQs page ──────────────────────────────────────────────────
function buildFaqsPage() {
  const all  = getData(KEYS.faqs);
  const cats = allFaqCats();
  const usedCats = [...new Set(all.map(f => f.category).filter(Boolean))];

  const pills = ['all', ...usedCats].map(c => {
    const label = c === 'all' ? 'ทั้งหมด' : (cats[c]?.label ?? c);
    return `<button class="filter-pill ${state.filterCat === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(label)}</button>`;
  }).join('');

  let visible = all;
  if (state.filterCat !== 'all') visible = visible.filter(f => f.category === state.filterCat);
  if (state.search) {
    const q = state.search.toLowerCase();
    visible = visible.filter(f =>
      (f.question || '').toLowerCase().includes(q) || (f.answer || '').toLowerCase().includes(q)
    );
  }

  const items = visible.length
    ? visible.map(f => buildFaqCard(f)).join('')
    : `<div class="empty-state"><div class="empty-icon">🔍</div><div class="empty-title">ไม่พบคำถามที่ค้นหา</div></div>`;

  return `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <div class="page-title">❓ FAQs <span class="count-badge">${all.length}</span></div>
          <div class="page-sub">คลังคำถาม-คำตอบเกี่ยวกับงานเภสัชกรรม</div>
        </div>
      </div>
    </div>
    <div class="page-body">
      <div class="search-row">
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input" id="searchInput" placeholder="ค้นหาคำถาม…" value="${esc(state.search)}">
        </div>
        <div class="filter-pills">${pills}</div>
      </div>
      <div class="faq-list" id="faqList">${items}</div>
    </div>`;
}

function buildFaqCard(f) {
  const cat      = faqCat(f.category);
  const adminBtns = state.isAdmin ? `
    <div class="faq-admin-actions">
      <button class="btn btn-icon btn-icon-edit"   data-edit-faq="${esc(f.id)}" title="Edit">✏️</button>
      <button class="btn btn-icon btn-icon-delete" data-del-faq="${esc(f.id)}"  title="Delete">🗑️</button>
    </div>` : '';

  const images = (f.images || []).map(u =>
    `<img src="${esc(u)}" class="faq-inline-img" loading="lazy" onerror="this.style.display='none'">`
  ).join('');

  const attachments = (f.attachments || []).map(a =>
    `<a href="${esc(a.url)}" target="_blank" class="ks-attach-link">📎 ${esc(a.name)}</a>`
  ).join('');

  return `
    <div class="faq-item" id="faq-${esc(f.id)}">
      <button class="faq-question" data-toggle-faq="${esc(f.id)}">
        <span class="faq-q-icon">💬</span>
        <span class="faq-q-text">${esc(f.question)}</span>
        <span class="cat-badge ${esc(cat.cls)}">${esc(cat.label)}</span>
        ${adminBtns}
        <span class="faq-chevron">▾</span>
      </button>
      <div class="faq-answer">
        <div class="faq-answer-html">${f.answer || ''}</div>
        ${images ? `<div class="faq-images">${images}</div>` : ''}
        ${attachments ? `<div class="faq-attachments">${attachments}</div>` : ''}
        <div class="faq-answer-meta">เพิ่มเมื่อ ${fmtDate(f.createdAt)}${f.updatedAt && f.updatedAt !== f.createdAt ? ' · แก้ไข ' + fmtDate(f.updatedAt) : ''}</div>
      </div>
    </div>`;
}

// ── New Items page ─────────────────────────────────────────────
function buildItemsPage() {
  const all  = getData(KEYS.items);
  const cats = allItemCats();
  const usedCats = [...new Set(all.map(i => i.category).filter(Boolean))];

  const pills = ['all', ...usedCats].map(c => {
    const label = c === 'all' ? 'ทั้งหมด' : (cats[c]?.label ?? c);
    return `<button class="filter-pill ${state.filterCat === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(label)}</button>`;
  }).join('');

  let visible = [...all].sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
  if (state.filterCat !== 'all') visible = visible.filter(i => i.category === state.filterCat);
  if (state.search) {
    const q = state.search.toLowerCase();
    visible = visible.filter(i =>
      (i.name || '').toLowerCase().includes(q) || (i.generic || '').toLowerCase().includes(q) ||
      (i.indication || '').toLowerCase().includes(q)
    );
  }

  const cards = visible.length
    ? `<div class="items-grid">${visible.map(i => buildDrugCard(i)).join('')}</div>`
    : `<div class="empty-state"><div class="empty-icon">💊</div><div class="empty-title">ยังไม่มีรายการยาใหม่</div><div class="empty-sub">Admin สามารถเพิ่มยาใหม่ได้ในหน้า Manage Items</div></div>`;

  return `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <div class="page-title">💊 New Items <span class="count-badge">${all.length}</span></div>
          <div class="page-sub">รายการยาและเวชภัณฑ์ใหม่ที่เข้าบัญชีโรงพยาบาล</div>
        </div>
      </div>
    </div>
    <div class="page-body">
      <div class="search-row">
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input" id="searchInput" placeholder="ค้นหาชื่อยา…" value="${esc(state.search)}">
        </div>
        <div class="filter-pills">${pills}</div>
      </div>
      ${cards}
    </div>`;
}

function buildDrugCard(item) {
  const cat      = itemCat(item.category);
  const adminBtns = state.isAdmin ? `
    <div class="drug-card-admin">
      <button class="btn btn-icon btn-icon-edit"   data-edit-item="${esc(item.id)}" title="Edit">✏️</button>
      <button class="btn btn-icon btn-icon-delete" data-del-item="${esc(item.id)}"  title="Delete">🗑️</button>
    </div>` : '';

  const imgHtml = item.image
    ? `<div class="drug-card-image"><img src="${esc(item.image)}" alt="${esc(item.name)}" loading="lazy" onerror="this.parentElement.style.display='none'"></div>`
    : '';

  const attachments = (item.attachments || []).map(a =>
    `<a href="${esc(a.url)}" target="_blank" class="ks-attach-link">📎 ${esc(a.name)}</a>`
  ).join('');

  return `
    <div class="drug-card">
      ${adminBtns}
      ${imgHtml}
      <div class="drug-card-header">
        <div class="drug-card-icon">💊</div>
        <div class="drug-card-meta">
          <div class="drug-card-name">${esc(item.name)}</div>
          ${item.generic ? `<div class="drug-card-generic">${esc(item.generic)}</div>` : ''}
        </div>
      </div>
      ${item.indication ? `<div class="drug-card-body">${esc(item.indication)}</div>` : ''}
      ${attachments ? `<div class="drug-card-attachments">${attachments}</div>` : ''}
      <div class="drug-card-footer">
        <span class="cat-badge ${esc(cat.cls)}">${esc(cat.label)}</span>
        ${item.dosageForm ? `<span class="cat-badge">${esc(item.dosageForm)}</span>` : ''}
        <span>เพิ่ม ${fmtDate(item.addedDate)}</span>
      </div>
    </div>`;
}

// ── New Vdos page ──────────────────────────────────────────────
function buildVdosPage() {
  const all = getData(KEYS.vdos);

  let visible = [...all].sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
  if (state.search) {
    const q = state.search.toLowerCase();
    visible = visible.filter(v =>
      (v.title || '').toLowerCase().includes(q) || (v.description || '').toLowerCase().includes(q)
    );
  }

  const cards = visible.length
    ? `<div class="vdos-grid">${visible.map(v => buildVdoCard(v)).join('')}</div>`
    : `<div class="empty-state"><div class="empty-icon">🎬</div><div class="empty-title">ยังไม่มีวิดีโอ</div><div class="empty-sub">Admin สามารถเพิ่มวิดีโอได้ในหน้า Manage Vdos</div></div>`;

  return `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <div class="page-title">🎬 New Vdos <span class="count-badge">${all.length}</span></div>
          <div class="page-sub">วิดีโอความรู้ด้านเภสัชกรรม</div>
        </div>
      </div>
    </div>
    <div class="page-body">
      <div class="search-row">
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input class="search-input" id="searchInput" placeholder="ค้นหาวิดีโอ…" value="${esc(state.search)}">
        </div>
      </div>
      ${cards}
    </div>`;
}

function buildVdoCard(v) {
  const ytId  = extractYtId(v.url);
  const thumb = v.thumbnail || (ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : '');

  const adminBtns = state.isAdmin ? `
    <div class="vdo-admin">
      <button class="btn btn-icon btn-icon-edit"   data-edit-vdo="${esc(v.id)}" title="Edit">✏️</button>
      <button class="btn btn-icon btn-icon-delete" data-del-vdo="${esc(v.id)}"  title="Delete">🗑️</button>
    </div>` : '';

  return `
    <div class="vdo-card" data-open-vdo="${esc(v.id)}">
      ${adminBtns}
      <div class="vdo-thumb">
        ${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
        <div class="vdo-play">▶️</div>
        ${v.duration ? `<div class="vdo-duration">${esc(v.duration)}</div>` : ''}
      </div>
      <div class="vdo-body">
        <div class="vdo-title">${esc(v.title)}</div>
        ${v.description ? `<div class="vdo-desc">${esc(v.description)}</div>` : ''}
        <div class="vdo-meta">เพิ่ม ${fmtDate(v.addedDate)}</div>
      </div>
    </div>`;
}

function extractYtId(url) {
  if (!url) return null;
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

// ════════════════════════════════════════════════════════════════
// ADMIN PAGES
// ════════════════════════════════════════════════════════════════

// ── Admin FAQs ─────────────────────────────────────────────────
function buildAdminFaqsPage() {
  const all  = getData(KEYS.faqs);
  const cats = allFaqCats();
  const rows = all.length ? all.map(f => {
    const cat = cats[f.category] ?? { label: f.category || '—', cls: '' };
    const hasMedia = (f.images?.length || f.attachments?.length)
      ? '<span title="Has images/attachments" style="color:var(--orange);font-size:11px">📎</span>' : '';
    return `
      <tr>
        <td class="td-truncate" style="max-width:280px">${esc(f.question)}</td>
        <td><span class="cat-badge ${esc(cat.cls)}">${esc(cat.label)}</span> ${hasMedia}</td>
        <td style="white-space:nowrap;color:var(--text-soft);font-size:12px">${fmtDate(f.createdAt)}</td>
        <td class="td-actions"><div class="td-actions-inner">
          <button class="btn btn-icon btn-icon-edit"   data-edit-faq="${esc(f.id)}">✏️</button>
          <button class="btn btn-icon btn-icon-delete" data-del-faq="${esc(f.id)}">🗑️</button>
        </div></td>
      </tr>`;
  }).join('') : `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-soft)">ยังไม่มีข้อมูล</td></tr>`;

  return `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <div class="page-title">✏️ Manage FAQs <span class="count-badge">${all.length}</span></div>
          <div class="page-sub">เพิ่ม / แก้ไข / ลบคำถาม-คำตอบ · รองรับ HTML ตาราง รูปภาพ และไฟล์ PDF</div>
        </div>
        <button class="btn btn-primary" id="btnAddFaq">+ Add FAQ</button>
      </div>
    </div>
    <div class="page-body">
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>Question</th><th>Category</th><th>Date</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Admin Items ────────────────────────────────────────────────
function buildAdminItemsPage() {
  const all  = getData(KEYS.items);
  const cats = allItemCats();
  const rows = all.length ? all.map(i => {
    const cat = cats[i.category] ?? { label: i.category || '—', cls: '' };
    const hasMedia = (i.image || i.attachments?.length)
      ? '<span title="Has image/attachments" style="color:var(--orange);font-size:11px">📎</span>' : '';
    return `
      <tr>
        <td>
          ${i.image ? `<img src="${esc(i.image)}" style="width:32px;height:32px;object-fit:cover;border-radius:4px;vertical-align:middle;margin-right:6px" onerror="this.style.display='none'">` : ''}
          <strong>${esc(i.name)}</strong><br><span style="font-size:11px;color:var(--text-soft)">${esc(i.generic || '')}</span>
        </td>
        <td><span class="cat-badge ${esc(cat.cls)}">${esc(cat.label)}</span> ${hasMedia}</td>
        <td style="font-size:12px;color:var(--text-soft);white-space:nowrap">${fmtDate(i.addedDate)}</td>
        <td class="td-actions"><div class="td-actions-inner">
          <button class="btn btn-icon btn-icon-edit"   data-edit-item="${esc(i.id)}">✏️</button>
          <button class="btn btn-icon btn-icon-delete" data-del-item="${esc(i.id)}">🗑️</button>
        </div></td>
      </tr>`;
  }).join('') : `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-soft)">ยังไม่มีข้อมูล</td></tr>`;

  return `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <div class="page-title">💊 Manage Items <span class="count-badge">${all.length}</span></div>
          <div class="page-sub">เพิ่ม / แก้ไข / ลบยาใหม่ · รองรับรูปภาพและไฟล์ PDF</div>
        </div>
        <button class="btn btn-primary" id="btnAddItem">+ Add Item</button>
      </div>
    </div>
    <div class="page-body">
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>Drug Name</th><th>Category</th><th>Date Added</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Admin Vdos ─────────────────────────────────────────────────
function buildAdminVdosPage() {
  const all = getData(KEYS.vdos);
  const rows = all.length ? all.map(v => `
    <tr>
      <td class="td-truncate">${esc(v.title)}</td>
      <td style="font-size:12px"><a href="${esc(v.url)}" target="_blank" style="color:var(--blue-dim);word-break:break-all">${esc(v.url.length > 45 ? v.url.slice(0,45)+'…' : v.url)}</a></td>
      <td style="font-size:12px;color:var(--text-soft);white-space:nowrap">${fmtDate(v.addedDate)}</td>
      <td class="td-actions"><div class="td-actions-inner">
        <button class="btn btn-icon btn-icon-edit"   data-edit-vdo="${esc(v.id)}">✏️</button>
        <button class="btn btn-icon btn-icon-delete" data-del-vdo="${esc(v.id)}">🗑️</button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--text-soft)">ยังไม่มีข้อมูล</td></tr>`;

  return `
    <div class="page-header">
      <div class="page-header-row">
        <div>
          <div class="page-title">🎬 Manage Vdos <span class="count-badge">${all.length}</span></div>
          <div class="page-sub">เพิ่ม / แก้ไข / ลบวิดีโอความรู้</div>
        </div>
        <button class="btn btn-primary" id="btnAddVdo">+ Add Video</button>
      </div>
    </div>
    <div class="page-body">
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr>
            <th>Title</th><th>URL</th><th>Date</th><th style="text-align:right">Actions</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════════
// PAGE EVENT BINDING
// ════════════════════════════════════════════════════════════════
function bindPageEvents() {
  const mc = document.getElementById('mainContent');

  mc.querySelector('#searchInput')?.addEventListener('input', e => {
    state.search = e.target.value;
    renderPage();
  });

  mc.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.filterCat = pill.dataset.cat;
      renderPage();
    });
  });

  mc.querySelectorAll('[data-toggle-faq]').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.closest('[data-edit-faq],[data-del-faq]')) return;
      const item = document.getElementById('faq-' + btn.dataset.toggleFaq);
      item?.classList.toggle('open');
    });
  });

  mc.querySelectorAll('[data-open-vdo]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-edit-vdo],[data-del-vdo]')) return;
      const vdo = getData(KEYS.vdos).find(v => v.id === card.dataset.openVdo);
      if (vdo?.url) window.open(vdo.url, '_blank');
    });
  });

  mc.querySelector('#btnAddFaq')?.addEventListener('click',  () => openEditModal('faq',  null));
  mc.querySelector('#btnAddItem')?.addEventListener('click', () => openEditModal('item', null));
  mc.querySelector('#btnAddVdo')?.addEventListener('click',  () => openEditModal('vdo',  null));

  mc.querySelectorAll('[data-edit-faq]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); openEditModal('faq',  btn.dataset.editFaq);  }));
  mc.querySelectorAll('[data-edit-item]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openEditModal('item', btn.dataset.editItem); }));
  mc.querySelectorAll('[data-edit-vdo]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); openEditModal('vdo',  btn.dataset.editVdo);  }));

  mc.querySelectorAll('[data-del-faq]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); openConfirmModal('faq',  btn.dataset.delFaq);  }));
  mc.querySelectorAll('[data-del-item]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openConfirmModal('item', btn.dataset.delItem); }));
  mc.querySelectorAll('[data-del-vdo]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); openConfirmModal('vdo',  btn.dataset.delVdo);  }));
}

// ════════════════════════════════════════════════════════════════
// EDIT MODAL
// ════════════════════════════════════════════════════════════════
function openEditModal(type, id) {
  state.editType = type;
  state.editId   = id;

  const isNew  = !id;
  const titles = { faq: 'FAQ', item: 'Drug Item', vdo: 'Video' };
  document.getElementById('editModalTitle').textContent = (isNew ? 'Add ' : 'Edit ') + titles[type];

  document.getElementById('editModalBody').innerHTML = buildEditForm(type, id);
  document.getElementById('editModal').hidden = false;

  _bindEditFormEvents(type);
}

function _catDatalist(id, cats, currentVal) {
  const opts = Object.entries(cats).map(([v, c]) =>
    `<option value="${esc(v)}">${esc(c.label)}</option>`
  ).join('');
  return `
    <input class="form-input" id="${id}" list="${id}-list" value="${esc(currentVal || '')}" placeholder="เลือกหรือพิมพ์ category ใหม่">
    <datalist id="${id}-list">${opts}</datalist>`;
}

function buildEditForm(type, id) {
  if (type === 'faq') {
    const d    = id ? (getData(KEYS.faqs).find(f => f.id === id) || {}) : {};
    const cats = allFaqCats();
    return `
      <div class="form-group">
        <label class="form-label">Question *</label>
        <input class="form-input" id="ef-question" value="${esc(d.question || '')}" placeholder="คำถาม…">
      </div>
      <div class="form-group">
        <label class="form-label">Answer (HTML supported — ตาราง &lt;table&gt; และ &lt;img&gt; ได้) *</label>
        <div style="display:flex;gap:6px;margin-bottom:4px">
          <button type="button" class="btn btn-ghost btn-sm" id="efBtnInsertTable">⊞ Insert Table</button>
        </div>
        <textarea class="form-textarea" id="ef-answer" style="min-height:160px;font-family:monospace;font-size:12px" placeholder="คำตอบ… (รองรับ HTML)">${esc(d.answer || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        ${_catDatalist('ef-cat', cats, d.category || 'general')}
        <div class="form-hint">พิมพ์ชื่อ category ใหม่เพื่อสร้าง</div>
      </div>
      <div class="form-group">
        <label class="form-label">รูปภาพ (เพิ่มได้หลายรูป)</label>
        <input type="file" id="ef-img-upload" class="form-input" accept="image/*" multiple>
        <div id="ef-img-preview" class="ks-upload-preview">${
          (d.images || []).map((u, i) => `
            <div class="ks-preview-item" data-img-idx="${i}">
              <img src="${esc(u)}" onerror="this.src=''">
              <button type="button" class="ks-remove-btn" data-rm-img="${i}">✕</button>
            </div>`).join('')
        }</div>
        <input type="hidden" id="ef-images-json" value="${esc(JSON.stringify(d.images || []))}">
      </div>
      <div class="form-group">
        <label class="form-label">ไฟล์แนบ PDF</label>
        <input type="file" id="ef-pdf-upload" class="form-input" accept=".pdf" multiple>
        <div id="ef-attach-list" class="ks-attach-edit-list">${
          (d.attachments || []).map((a, i) => `
            <div class="ks-attach-edit-item" data-attach-idx="${i}">
              📎 ${esc(a.name)}
              <button type="button" class="ks-remove-btn" data-rm-attach="${i}">✕</button>
            </div>`).join('')
        }</div>
        <input type="hidden" id="ef-attachments-json" value="${esc(JSON.stringify(d.attachments || []))}">
      </div>`;
  }

  if (type === 'item') {
    const d    = id ? (getData(KEYS.items).find(i => i.id === id) || {}) : {};
    const cats = allItemCats();
    const formOpts = DOSAGE_FORMS.map(f =>
      `<option ${d.dosageForm === f ? 'selected' : ''}>${f}</option>`
    ).join('');
    return `
      <div class="form-group-row">
        <div class="form-group">
          <label class="form-label">Trade / Brand Name *</label>
          <input class="form-input" id="ef-name" value="${esc(d.name || '')}" placeholder="เช่น Entresto">
        </div>
        <div class="form-group">
          <label class="form-label">Generic Name</label>
          <input class="form-input" id="ef-generic" value="${esc(d.generic || '')}" placeholder="เช่น Sacubitril/Valsartan">
        </div>
      </div>
      <div class="form-group-row">
        <div class="form-group">
          <label class="form-label">Category</label>
          ${_catDatalist('ef-cat', cats, d.category || 'other')}
          <div class="form-hint">พิมพ์ชื่อ category ใหม่เพื่อสร้าง</div>
        </div>
        <div class="form-group">
          <label class="form-label">Dosage Form</label>
          <select class="form-select" id="ef-form"><option value="">—</option>${formOpts}</select>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Indication / Description</label>
        <textarea class="form-textarea" id="ef-indication" placeholder="สรรพคุณ / ข้อบ่งใช้…">${esc(d.indication || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-textarea" id="ef-notes" style="min-height:60px" placeholder="หมายเหตุเพิ่มเติม…">${esc(d.notes || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Date Added</label>
        <input type="date" class="form-input" id="ef-date" value="${(d.addedDate || now()).slice(0,10)}">
      </div>
      <div class="form-group">
        <label class="form-label">รูปภาพยา</label>
        <input type="file" id="ef-img-upload" class="form-input" accept="image/*">
        <div id="ef-img-preview" class="ks-upload-preview">${
          d.image ? `<div class="ks-preview-item"><img src="${esc(d.image)}"><button type="button" class="ks-remove-btn" data-rm-single-img>✕</button></div>` : ''
        }</div>
        <input type="hidden" id="ef-image-url" value="${esc(d.image || '')}">
      </div>
      <div class="form-group">
        <label class="form-label">ไฟล์แนบ PDF</label>
        <input type="file" id="ef-pdf-upload" class="form-input" accept=".pdf" multiple>
        <div id="ef-attach-list" class="ks-attach-edit-list">${
          (d.attachments || []).map((a, i) => `
            <div class="ks-attach-edit-item" data-attach-idx="${i}">
              📎 ${esc(a.name)}
              <button type="button" class="ks-remove-btn" data-rm-attach="${i}">✕</button>
            </div>`).join('')
        }</div>
        <input type="hidden" id="ef-attachments-json" value="${esc(JSON.stringify(d.attachments || []))}">
      </div>`;
  }

  if (type === 'vdo') {
    const d = id ? (getData(KEYS.vdos).find(v => v.id === id) || {}) : {};
    return `
      <div class="form-group">
        <label class="form-label">Title *</label>
        <input class="form-input" id="ef-title" value="${esc(d.title || '')}" placeholder="ชื่อวิดีโอ…">
      </div>
      <div class="form-group">
        <label class="form-label">URL *</label>
        <input class="form-input" id="ef-url" value="${esc(d.url || '')}" placeholder="https://youtube.com/watch?v=…">
        <div class="form-hint">รองรับ YouTube, และ URL ทั่วไป</div>
      </div>
      <div class="form-group-row">
        <div class="form-group">
          <label class="form-label">Duration</label>
          <input class="form-input" id="ef-duration" value="${esc(d.duration || '')}" placeholder="เช่น 5:30">
        </div>
        <div class="form-group">
          <label class="form-label">Date Added</label>
          <input type="date" class="form-input" id="ef-date" value="${(d.addedDate || now()).slice(0,10)}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <textarea class="form-textarea" id="ef-desc" placeholder="คำอธิบายวิดีโอ…">${esc(d.description || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Custom Thumbnail URL (optional)</label>
        <input class="form-input" id="ef-thumb" value="${esc(d.thumbnail || '')}" placeholder="https://…/image.jpg">
      </div>`;
  }
  return '';
}

function _bindEditFormEvents(type) {
  const mb = document.getElementById('editModalBody');
  if (!mb) return;

  // Insert table template for FAQ
  mb.querySelector('#efBtnInsertTable')?.addEventListener('click', () => {
    const ta = document.getElementById('ef-answer');
    if (!ta) return;
    const tpl = `\n<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%">\n  <thead><tr><th>หัวข้อ 1</th><th>หัวข้อ 2</th></tr></thead>\n  <tbody>\n    <tr><td>ข้อมูล</td><td>ข้อมูล</td></tr>\n  </tbody>\n</table>\n`;
    const pos = ta.selectionStart;
    ta.value = ta.value.slice(0, pos) + tpl + ta.value.slice(pos);
    ta.focus();
  });

  // Image upload (multi for FAQ, single for item)
  mb.querySelector('#ef-img-upload')?.addEventListener('change', async function () {
    const files = [...this.files];
    if (!files.length) return;
    const preview  = document.getElementById('ef-img-preview');
    const jsonInp  = document.getElementById('ef-images-json');
    const singleInp = document.getElementById('ef-image-url');

    showToast('กำลังอัปโหลดรูป…', 'info');
    try {
      for (const file of files) {
        const url = await uploadKsFile(file);
        if (singleInp) {
          // single image (item)
          singleInp.value = url;
          preview.innerHTML = `<div class="ks-preview-item"><img src="${esc(url)}"><button type="button" class="ks-remove-btn" data-rm-single-img>✕</button></div>`;
          break; // only one image for items
        } else if (jsonInp) {
          // multi images (FAQ)
          const list = JSON.parse(jsonInp.value || '[]');
          list.push(url);
          jsonInp.value = JSON.stringify(list);
          const idx = list.length - 1;
          preview.insertAdjacentHTML('beforeend', `
            <div class="ks-preview-item" data-img-idx="${idx}">
              <img src="${esc(url)}" onerror="this.src=''">
              <button type="button" class="ks-remove-btn" data-rm-img="${idx}">✕</button>
            </div>`);
        }
      }
      showToast('อัปโหลดรูปสำเร็จ ✓', 'success');
    } catch (e) {
      showToast('❌ อัปโหลดรูปล้มเหลว: ' + e.message, 'error');
    }
    this.value = '';
  });

  // PDF upload
  mb.querySelector('#ef-pdf-upload')?.addEventListener('change', async function () {
    const files = [...this.files];
    if (!files.length) return;
    const list    = document.getElementById('ef-attach-list');
    const jsonInp = document.getElementById('ef-attachments-json');
    if (!list || !jsonInp) return;

    showToast('กำลังอัปโหลด PDF…', 'info');
    try {
      for (const file of files) {
        const url  = await uploadKsFile(file);
        const attaches = JSON.parse(jsonInp.value || '[]');
        const idx  = attaches.length;
        attaches.push({ name: file.name, url });
        jsonInp.value = JSON.stringify(attaches);
        list.insertAdjacentHTML('beforeend', `
          <div class="ks-attach-edit-item" data-attach-idx="${idx}">
            📎 ${esc(file.name)}
            <button type="button" class="ks-remove-btn" data-rm-attach="${idx}">✕</button>
          </div>`);
      }
      showToast('อัปโหลด PDF สำเร็จ ✓', 'success');
    } catch (e) {
      showToast('❌ อัปโหลด PDF ล้มเหลว: ' + e.message, 'error');
    }
    this.value = '';
  });

  // Remove image buttons (delegated)
  mb.querySelector('#ef-img-preview')?.addEventListener('click', e => {
    const rmBtn = e.target.closest('[data-rm-img],[data-rm-single-img]');
    if (!rmBtn) return;

    if (rmBtn.hasAttribute('data-rm-single-img')) {
      const inp = document.getElementById('ef-image-url');
      if (inp) inp.value = '';
      rmBtn.closest('.ks-preview-item')?.remove();
      return;
    }

    const idx = Number(rmBtn.dataset.rmImg);
    const jsonInp = document.getElementById('ef-images-json');
    if (!jsonInp) return;
    const list = JSON.parse(jsonInp.value || '[]');
    list.splice(idx, 1);
    jsonInp.value = JSON.stringify(list);
    rmBtn.closest('.ks-preview-item')?.remove();
  });

  // Remove attachment buttons (delegated)
  mb.querySelector('#ef-attach-list')?.addEventListener('click', e => {
    const rmBtn = e.target.closest('[data-rm-attach]');
    if (!rmBtn) return;
    const idx = Number(rmBtn.dataset.rmAttach);
    const jsonInp = document.getElementById('ef-attachments-json');
    if (!jsonInp) return;
    const list = JSON.parse(jsonInp.value || '[]');
    list.splice(idx, 1);
    jsonInp.value = JSON.stringify(list);
    rmBtn.closest('.ks-attach-edit-item')?.remove();
  });
}

async function doSaveEdit() {
  const type = state.editType;
  const id   = state.editId;
  const get  = sel => document.getElementById(sel)?.value?.trim() ?? '';

  if (type === 'faq') {
    const question = get('ef-question');
    const answer   = get('ef-answer');
    if (!question || !answer) { showToast('กรุณากรอก Question และ Answer', 'error'); return; }
    const images     = JSON.parse(get('ef-images-json') || '[]');
    const attachments = JSON.parse(get('ef-attachments-json') || '[]');
    const category   = get('ef-cat') || 'general';
    const list = getData(KEYS.faqs);
    if (id) {
      const idx = list.findIndex(f => f.id === id);
      if (idx >= 0) list[idx] = { ...list[idx], question, answer, category, images, attachments, updatedAt: now() };
    } else {
      list.push({ id: uid(), question, answer, category, images, attachments, createdAt: now(), updatedAt: now() });
    }
    saveData(KEYS.faqs, list);
  }

  if (type === 'item') {
    const name = get('ef-name');
    if (!name) { showToast('กรุณากรอกชื่อยา', 'error'); return; }
    const image       = get('ef-image-url');
    const attachments = JSON.parse(get('ef-attachments-json') || '[]');
    const list = getData(KEYS.items);
    const entry = {
      name,
      generic:     get('ef-generic'),
      category:    get('ef-cat') || 'other',
      dosageForm:  get('ef-form'),
      indication:  get('ef-indication'),
      notes:       get('ef-notes'),
      addedDate:   get('ef-date') || now().slice(0,10),
      image:       image || undefined,
      attachments: attachments.length ? attachments : undefined,
      updatedAt:   now(),
    };
    if (id) {
      const idx = list.findIndex(i => i.id === id);
      if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    } else {
      list.push({ id: uid(), ...entry });
    }
    saveData(KEYS.items, list);
  }

  if (type === 'vdo') {
    const title = get('ef-title');
    const url   = get('ef-url');
    if (!title || !url) { showToast('กรุณากรอก Title และ URL', 'error'); return; }
    const list = getData(KEYS.vdos);
    const entry = {
      title, url,
      duration:    get('ef-duration'),
      description: get('ef-desc'),
      thumbnail:   get('ef-thumb'),
      addedDate:   get('ef-date') || now().slice(0,10),
      updatedAt:   now(),
    };
    if (id) {
      const idx = list.findIndex(v => v.id === id);
      if (idx >= 0) list[idx] = { ...list[idx], ...entry };
    } else {
      list.push({ id: uid(), ...entry });
    }
    saveData(KEYS.vdos, list);
  }

  closeEditModal();
  showToast(id ? 'แก้ไขสำเร็จ ✓' : 'เพิ่มรายการสำเร็จ ✓', 'success');
  renderPage();
  renderSidebar();
}

function closeEditModal() {
  document.getElementById('editModal').hidden = true;
  state.editType = null;
  state.editId   = null;
}

// ════════════════════════════════════════════════════════════════
// CONFIRM DELETE MODAL
// ════════════════════════════════════════════════════════════════
function openConfirmModal(type, id) {
  state.delType = type;
  state.delId   = id;
  const labels = { faq: 'FAQ นี้', item: 'รายการยานี้', vdo: 'วิดีโอนี้' };
  document.getElementById('confirmMsg').textContent = `ต้องการลบ${labels[type] || 'รายการนี้'} ใช่ไหม? การลบไม่สามารถย้อนกลับได้`;
  document.getElementById('confirmModal').hidden = false;
}

function doDelete() {
  const { delType: type, delId: id } = state;
  const keyMap = { faq: KEYS.faqs, item: KEYS.items, vdo: KEYS.vdos };
  const key    = keyMap[type];
  if (!key || !id) return;

  const list     = getData(key);
  const filtered = list.filter(x => x.id !== id);
  saveData(key, filtered);

  closeConfirmModal();
  showToast('ลบรายการสำเร็จ', 'success');
  renderPage();
  renderSidebar();
}

function closeConfirmModal() {
  document.getElementById('confirmModal').hidden = true;
  state.delType = null;
  state.delId   = null;
}

// ════════════════════════════════════════════════════════════════
// LOGIN / LOGOUT  — uses server auth API
// ════════════════════════════════════════════════════════════════
function showLoginModal() {
  document.getElementById('loginUnInput').value  = '';
  document.getElementById('loginPwInput').value  = '';
  document.getElementById('loginError').hidden   = true;
  document.getElementById('loginModal').hidden   = false;
  setTimeout(() => document.getElementById('loginUnInput').focus(), 60);
}

async function doLogin() {
  const un    = document.getElementById('loginUnInput').value.trim();
  const pw    = document.getElementById('loginPwInput').value;
  const errEl = document.getElementById('loginError');
  errEl.hidden = true;

  if (!un || !pw) {
    errEl.textContent = 'กรุณากรอก Username และ Password';
    errEl.hidden = false;
    return;
  }

  try {
    const r = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: un, password: pw }),
    });
    const j = await r.json();
    if (!r.ok) {
      errEl.textContent = j.error || 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
      errEl.hidden = false;
      document.getElementById('loginPwInput').select();
      return;
    }
    state.authToken = j.token;
    state.authUser  = j.username;
    state.authRole  = j.role;
    state.isAdmin   = true;
    document.getElementById('loginModal').hidden = true;
    renderSidebar();
    showToast(`เข้าสู่ระบบสำเร็จ (${j.username}) ✓`, 'success');
  } catch (_) {
    errEl.textContent = 'ไม่สามารถเชื่อมต่อ Server ได้';
    errEl.hidden = false;
  }
}

async function doLogout() {
  if (state.authToken) {
    fetch(`${SERVER_URL}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.authToken}` },
    }).catch(() => {});
  }
  state.isAdmin   = false;
  state.authToken = null;
  state.authUser  = null;
  state.authRole  = null;
  if (state.page.startsWith('admin-')) navigateTo('faqs');
  else renderSidebar();
  showToast('ออกจากระบบแล้ว', 'info');
}

// ════════════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════════════
function showToast(msg, type = 'info') {
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  const el    = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span>${icons[type] ?? ''}</span> ${esc(msg)}`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  const ok = await loadAllFromServer();
  state.serverOk = ok;
  updateServerBar(true, ok);
  if (!ok) showToast('⚠ Server ไม่ตอบกลับ — ใช้ข้อมูลสำรองในเครื่อง', 'error');

  document.querySelectorAll('#sidebarNav .nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Login modal
  document.getElementById('btnLoginConfirm').addEventListener('click', doLogin);
  document.getElementById('btnLoginCancel').addEventListener('click', () => {
    document.getElementById('loginModal').hidden = true;
  });
  document.getElementById('loginPwInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });
  document.getElementById('loginUnInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('loginPwInput').focus();
  });

  // Edit modal
  document.getElementById('btnEditSave').addEventListener('click',   doSaveEdit);
  document.getElementById('btnEditCancel').addEventListener('click', closeEditModal);
  document.getElementById('btnEditClose').addEventListener('click',  closeEditModal);
  document.getElementById('editModal').addEventListener('click', e => {
    if (e.target === document.getElementById('editModal')) closeEditModal();
  });

  // Confirm modal
  document.getElementById('btnConfirmDelete').addEventListener('click', doDelete);
  document.getElementById('btnConfirmCancel').addEventListener('click', closeConfirmModal);
  document.getElementById('confirmModal').addEventListener('click', e => {
    if (e.target === document.getElementById('confirmModal')) closeConfirmModal();
  });

  const hash = location.hash.replace('#', '');
  if (['faqs','items','vdos'].includes(hash)) state.page = hash;

  renderPage();
  renderSidebar();
  updateNavActive();
});
