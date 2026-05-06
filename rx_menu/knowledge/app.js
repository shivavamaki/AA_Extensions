'use strict';

// ── Storage keys ───────────────────────────────────────────────
const KEYS = {
  faqs:    'bkn_ks.faqs.v1',
  items:   'bkn_ks.items.v1',
  vdos:    'bkn_ks.vdos.v1',
  adminPw: 'bkn_ks.admin_pw.v1',
};

const DEFAULT_PW = 'pharmacy2024';

// ── Category labels ────────────────────────────────────────────
const FAQ_CATS = {
  general:  { label: 'ทั่วไป',         cls: '' },
  drug:     { label: 'ยาและสูตร',      cls: 'orange' },
  process:  { label: 'กระบวนงาน',      cls: 'teal' },
  safety:   { label: 'ความปลอดภัย',   cls: 'purple' },
  clinical: { label: 'Clinical',        cls: 'green' },
};

const ITEM_CATS = {
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
  search:      '',
  filterCat:   'all',
  editType:    null,
  editId:      null,
  delType:     null,
  delId:       null,
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

// ── Storage ────────────────────────────────────────────────────
function getData(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch { return []; }
}
function saveData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}
function getAdminPw() {
  return localStorage.getItem(KEYS.adminPw) || DEFAULT_PW;
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
      <button class="nav-item ${state.page === 'admin-settings' ? 'active' : ''}" data-page="admin-settings">
        <span class="nav-icon">⚙️</span><span>Settings</span>
      </button>
      <button class="nav-item nav-logout" id="btnLogout">
        <span class="nav-icon">🚪</span><span>Logout</span>
      </button>
    `;
    document.getElementById('btnLogout')?.addEventListener('click', doLogout);
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
    case 'faqs':           el.innerHTML = buildFaqsPage();          break;
    case 'items':          el.innerHTML = buildItemsPage();         break;
    case 'vdos':           el.innerHTML = buildVdosPage();          break;
    case 'admin-faqs':     el.innerHTML = buildAdminFaqsPage();     break;
    case 'admin-items':    el.innerHTML = buildAdminItemsPage();    break;
    case 'admin-vdos':     el.innerHTML = buildAdminVdosPage();     break;
    case 'admin-settings': el.innerHTML = buildAdminSettingsPage(); break;
    default:               el.innerHTML = buildFaqsPage();
  }
  bindPageEvents();
}

// ════════════════════════════════════════════════════════════════
// PUBLIC PAGES
// ════════════════════════════════════════════════════════════════

// ── FAQs page ──────────────────────────────────────────────────
function buildFaqsPage() {
  const all  = getData(KEYS.faqs);
  const cats = [...new Set(all.map(f => f.category).filter(Boolean))];

  const pills = ['all', ...cats].map(c => {
    const label = c === 'all' ? 'ทั้งหมด' : (FAQ_CATS[c]?.label ?? c);
    return `<button class="filter-pill ${state.filterCat === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(label)}</button>`;
  }).join('');

  let visible = all;
  if (state.filterCat !== 'all') visible = visible.filter(f => f.category === state.filterCat);
  if (state.search) {
    const q = state.search.toLowerCase();
    visible = visible.filter(f =>
      f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q)
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
  const cat = FAQ_CATS[f.category] ?? { label: f.category, cls: '' };
  const adminBtns = state.isAdmin ? `
    <div class="faq-admin-actions">
      <button class="btn btn-icon btn-icon-edit"   data-edit-faq="${esc(f.id)}" title="Edit">✏️</button>
      <button class="btn btn-icon btn-icon-delete" data-del-faq="${esc(f.id)}"  title="Delete">🗑️</button>
    </div>` : '';

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
        ${esc(f.answer).replace(/\n/g, '<br>')}
        <div class="faq-answer-meta">เพิ่มเมื่อ ${fmtDate(f.createdAt)}${f.updatedAt && f.updatedAt !== f.createdAt ? ' · แก้ไข ' + fmtDate(f.updatedAt) : ''}</div>
      </div>
    </div>`;
}

// ── New Items page ─────────────────────────────────────────────
function buildItemsPage() {
  const all  = getData(KEYS.items);
  const cats = [...new Set(all.map(i => i.category).filter(Boolean))];

  const pills = ['all', ...cats].map(c => {
    const label = c === 'all' ? 'ทั้งหมด' : (ITEM_CATS[c]?.label ?? c);
    return `<button class="filter-pill ${state.filterCat === c ? 'active' : ''}" data-cat="${esc(c)}">${esc(label)}</button>`;
  }).join('');

  let visible = [...all].sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
  if (state.filterCat !== 'all') visible = visible.filter(i => i.category === state.filterCat);
  if (state.search) {
    const q = state.search.toLowerCase();
    visible = visible.filter(i =>
      i.name.toLowerCase().includes(q) || (i.generic || '').toLowerCase().includes(q) ||
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
  const cat = ITEM_CATS[item.category] ?? { label: item.category || 'Other', cls: '' };
  const adminBtns = state.isAdmin ? `
    <div class="drug-card-admin">
      <button class="btn btn-icon btn-icon-edit"   data-edit-item="${esc(item.id)}" title="Edit">✏️</button>
      <button class="btn btn-icon btn-icon-delete" data-del-item="${esc(item.id)}"  title="Delete">🗑️</button>
    </div>` : '';

  return `
    <div class="drug-card">
      ${adminBtns}
      <div class="drug-card-header">
        <div class="drug-card-icon">💊</div>
        <div class="drug-card-meta">
          <div class="drug-card-name">${esc(item.name)}</div>
          ${item.generic ? `<div class="drug-card-generic">${esc(item.generic)}</div>` : ''}
        </div>
      </div>
      ${item.indication ? `<div class="drug-card-body">${esc(item.indication)}</div>` : ''}
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
      v.title.toLowerCase().includes(q) || (v.description || '').toLowerCase().includes(q)
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
  const all = getData(KEYS.faqs);
  const rows = all.length ? all.map(f => {
    const cat = FAQ_CATS[f.category] ?? { label: f.category || '—', cls: '' };
    return `
      <tr>
        <td class="td-truncate" style="max-width:280px">${esc(f.question)}</td>
        <td><span class="cat-badge ${esc(cat.cls)}">${esc(cat.label)}</span></td>
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
          <div class="page-sub">เพิ่ม / แก้ไข / ลบคำถาม-คำตอบ</div>
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
  const all = getData(KEYS.items);
  const rows = all.length ? all.map(i => {
    const cat = ITEM_CATS[i.category] ?? { label: i.category || '—', cls: '' };
    return `
      <tr>
        <td><strong>${esc(i.name)}</strong><br><span style="font-size:11px;color:var(--text-soft)">${esc(i.generic || '')}</span></td>
        <td><span class="cat-badge ${esc(cat.cls)}">${esc(cat.label)}</span></td>
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
          <div class="page-sub">เพิ่ม / แก้ไข / ลบยาใหม่ในบัญชีโรงพยาบาล</div>
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

// ── Admin Settings ─────────────────────────────────────────────
function buildAdminSettingsPage() {
  return `
    <div class="page-header">
      <div class="page-title">⚙️ Settings</div>
      <div class="page-sub">ตั้งค่าระบบ Admin</div>
    </div>
    <div class="page-body">
      <div class="settings-section">
        <div class="settings-section-title">🔐 เปลี่ยนรหัสผ่าน Admin</div>
        <div class="form-group">
          <label class="form-label">รหัสผ่านเดิม</label>
          <input type="password" id="setPwCurrent" class="form-input" placeholder="Current password">
        </div>
        <div class="settings-gap"></div>
        <div class="form-group">
          <label class="form-label">รหัสผ่านใหม่</label>
          <input type="password" id="setPwNew" class="form-input" placeholder="New password (min 6 chars)">
        </div>
        <div class="settings-gap"></div>
        <div class="form-group">
          <label class="form-label">ยืนยันรหัสผ่านใหม่</label>
          <input type="password" id="setPwConfirm" class="form-input" placeholder="Confirm new password">
          <div class="form-error" id="setPwError" hidden></div>
        </div>
        <div class="settings-gap"></div>
        <button class="btn btn-primary" id="btnChangePw">💾 Save Password</button>
      </div>
    </div>`;
}

// ════════════════════════════════════════════════════════════════
// PAGE EVENT BINDING
// ════════════════════════════════════════════════════════════════
function bindPageEvents() {
  const mc = document.getElementById('mainContent');

  // Search input
  mc.querySelector('#searchInput')?.addEventListener('input', e => {
    state.search = e.target.value;
    renderPage();
  });

  // Filter pills
  mc.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      state.filterCat = pill.dataset.cat;
      renderPage();
    });
  });

  // FAQ accordion toggle
  mc.querySelectorAll('[data-toggle-faq]').forEach(btn => {
    btn.addEventListener('click', e => {
      // don't toggle if admin edit/delete btn clicked
      if (e.target.closest('[data-edit-faq],[data-del-faq]')) return;
      const id   = btn.dataset.toggleFaq;
      const item = document.getElementById('faq-' + id);
      item?.classList.toggle('open');
    });
  });

  // Video card click
  mc.querySelectorAll('[data-open-vdo]').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-edit-vdo],[data-del-vdo]')) return;
      const id  = card.dataset.openVdo;
      const vdo = getData(KEYS.vdos).find(v => v.id === id);
      if (vdo?.url) window.open(vdo.url, '_blank');
    });
  });

  // ── Admin add buttons ──
  mc.querySelector('#btnAddFaq')?.addEventListener('click',  () => openEditModal('faq',  null));
  mc.querySelector('#btnAddItem')?.addEventListener('click', () => openEditModal('item', null));
  mc.querySelector('#btnAddVdo')?.addEventListener('click',  () => openEditModal('vdo',  null));

  // Admin edit buttons (delegated)
  mc.querySelectorAll('[data-edit-faq]').forEach(btn  => btn.addEventListener('click',  e => { e.stopPropagation(); openEditModal('faq',  btn.dataset.editFaq);  }));
  mc.querySelectorAll('[data-edit-item]').forEach(btn => btn.addEventListener('click',  e => { e.stopPropagation(); openEditModal('item', btn.dataset.editItem); }));
  mc.querySelectorAll('[data-edit-vdo]').forEach(btn  => btn.addEventListener('click',  e => { e.stopPropagation(); openEditModal('vdo',  btn.dataset.editVdo);  }));

  // Admin delete buttons (delegated)
  mc.querySelectorAll('[data-del-faq]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); openConfirmModal('faq',  btn.dataset.delFaq);  }));
  mc.querySelectorAll('[data-del-item]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); openConfirmModal('item', btn.dataset.delItem); }));
  mc.querySelectorAll('[data-del-vdo]').forEach(btn  => btn.addEventListener('click', e => { e.stopPropagation(); openConfirmModal('vdo',  btn.dataset.delVdo);  }));

  // Settings page
  mc.querySelector('#btnChangePw')?.addEventListener('click', doChangePassword);
}

// ════════════════════════════════════════════════════════════════
// EDIT MODAL
// ════════════════════════════════════════════════════════════════
function openEditModal(type, id) {
  state.editType = type;
  state.editId   = id;

  const isNew   = !id;
  const titles  = { faq: 'FAQ', item: 'Drug Item', vdo: 'Video' };
  document.getElementById('editModalTitle').textContent = (isNew ? 'Add ' : 'Edit ') + titles[type];

  document.getElementById('editModalBody').innerHTML = buildEditForm(type, id);
  document.getElementById('editModal').hidden = false;
}

function buildEditForm(type, id) {
  if (type === 'faq') {
    const d = id ? (getData(KEYS.faqs).find(f => f.id === id) || {}) : {};
    const catOpts = Object.entries(FAQ_CATS).map(([v, c]) =>
      `<option value="${v}" ${d.category === v ? 'selected' : ''}>${c.label}</option>`
    ).join('');
    return `
      <div class="form-group">
        <label class="form-label">Question *</label>
        <input class="form-input" id="ef-question" value="${esc(d.question || '')}" placeholder="คำถาม…">
      </div>
      <div class="form-group">
        <label class="form-label">Answer *</label>
        <textarea class="form-textarea" id="ef-answer" style="min-height:120px" placeholder="คำตอบ…">${esc(d.answer || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label">Category</label>
        <select class="form-select" id="ef-cat">
          ${catOpts}
        </select>
      </div>`;
  }

  if (type === 'item') {
    const d = id ? (getData(KEYS.items).find(i => i.id === id) || {}) : {};
    const catOpts = Object.entries(ITEM_CATS).map(([v, c]) =>
      `<option value="${v}" ${d.category === v ? 'selected' : ''}>${c.label}</option>`
    ).join('');
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
          <select class="form-select" id="ef-cat">${catOpts}</select>
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

function doSaveEdit() {
  const type = state.editType;
  const id   = state.editId;

  const get = sel => document.getElementById(sel)?.value?.trim() ?? '';

  if (type === 'faq') {
    const question = get('ef-question');
    const answer   = get('ef-answer');
    if (!question || !answer) { showToast('กรุณากรอก Question และ Answer', 'error'); return; }
    const list = getData(KEYS.faqs);
    if (id) {
      const idx = list.findIndex(f => f.id === id);
      if (idx >= 0) { list[idx] = { ...list[idx], question, answer, category: get('ef-cat'), updatedAt: now() }; }
    } else {
      list.push({ id: uid(), question, answer, category: get('ef-cat'), createdAt: now(), updatedAt: now() });
    }
    saveData(KEYS.faqs, list);
  }

  if (type === 'item') {
    const name = get('ef-name');
    if (!name) { showToast('กรุณากรอกชื่อยา', 'error'); return; }
    const list = getData(KEYS.items);
    const entry = {
      name,
      generic:    get('ef-generic'),
      category:   get('ef-cat'),
      dosageForm: get('ef-form'),
      indication: get('ef-indication'),
      notes:      get('ef-notes'),
      addedDate:  get('ef-date') || now().slice(0,10),
      updatedAt:  now(),
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
      title,
      url,
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

  const list    = getData(key);
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
// LOGIN / LOGOUT
// ════════════════════════════════════════════════════════════════
function showLoginModal() {
  document.getElementById('loginPwInput').value = '';
  document.getElementById('loginError').hidden  = true;
  document.getElementById('loginModal').hidden  = false;
  setTimeout(() => document.getElementById('loginPwInput').focus(), 60);
}

function doLogin() {
  const pw = document.getElementById('loginPwInput').value;
  if (pw === getAdminPw()) {
    state.isAdmin = true;
    document.getElementById('loginModal').hidden = true;
    renderSidebar();
    showToast('เข้าสู่ระบบสำเร็จ ✓', 'success');
  } else {
    document.getElementById('loginError').hidden = false;
    document.getElementById('loginPwInput').select();
  }
}

function doLogout() {
  state.isAdmin = false;
  if (state.page.startsWith('admin-')) navigateTo('faqs');
  else { renderSidebar(); }
  showToast('ออกจากระบบแล้ว', 'info');
}

function doChangePassword() {
  const cur     = document.getElementById('setPwCurrent')?.value ?? '';
  const newPw   = document.getElementById('setPwNew')?.value ?? '';
  const confirm = document.getElementById('setPwConfirm')?.value ?? '';
  const errEl   = document.getElementById('setPwError');

  if (cur !== getAdminPw()) {
    errEl.textContent = 'รหัสผ่านเดิมไม่ถูกต้อง'; errEl.hidden = false; return;
  }
  if (newPw.length < 6) {
    errEl.textContent = 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร'; errEl.hidden = false; return;
  }
  if (newPw !== confirm) {
    errEl.textContent = 'รหัสผ่านใหม่ไม่ตรงกัน'; errEl.hidden = false; return;
  }

  localStorage.setItem(KEYS.adminPw, newPw);
  errEl.hidden = true;
  document.getElementById('setPwCurrent').value  = '';
  document.getElementById('setPwNew').value      = '';
  document.getElementById('setPwConfirm').value  = '';
  showToast('เปลี่ยนรหัสผ่านสำเร็จ ✓', 'success');
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
  setTimeout(() => el.remove(), 3000);
}

// ════════════════════════════════════════════════════════════════
// SEED SAMPLE DATA (first run only)
// ════════════════════════════════════════════════════════════════
function seedSampleData() {
  if (localStorage.getItem('bkn_ks.seeded')) return;

  saveData(KEYS.faqs, [
    {
      id: uid(), category: 'drug',
      question: 'ยา Warfarin ต้องติดตาม INR ทุกนานแค่ไหน?',
      answer: 'ในช่วงเริ่มต้นหรือปรับขนาดยา ควรตรวจ INR ทุก 1–3 วัน จนกว่าค่าจะอยู่ใน therapeutic range แล้วค่อยขยายเป็นทุก 4 สัปดาห์ในผู้ป่วยที่ stable แล้ว',
      createdAt: now(), updatedAt: now(),
    },
    {
      id: uid(), category: 'process',
      question: 'Medication Reconciliation ควรทำเมื่อไหร่?',
      answer: 'ควรทำใน 3 จุดหลัก ได้แก่\n1. Admission — เปรียบเทียบยาที่ใช้อยู่กับ order แรกรับ\n2. Transfer — เมื่อย้ายหอผู้ป่วย\n3. Discharge — อธิบายยาที่จะนำกลับบ้านให้ผู้ป่วยเข้าใจ',
      createdAt: now(), updatedAt: now(),
    },
    {
      id: uid(), category: 'safety',
      question: 'ยา High Alert ในโรงพยาบาลของเรามีอะไรบ้าง?',
      answer: 'ยาที่จัดเป็น High Alert ได้แก่ Concentrated Electrolytes (KCl, NaCl 3%), Insulin, Heparin, Warfarin, Opioids, Neuromuscular Blocking Agents และยาเคมีบำบัด ต้องมีกระบวนการ double-check ก่อนจ่าย',
      createdAt: now(), updatedAt: now(),
    },
    {
      id: uid(), category: 'clinical',
      question: 'NSAIDs ควรระวังในผู้ป่วยกลุ่มใด?',
      answer: 'ควรระวังในผู้ป่วย CKD (GFR < 30), ผู้สูงอายุ > 65 ปี, ผู้ที่มีประวัติ peptic ulcer, ผู้ที่รับ anticoagulant และผู้ที่มีภาวะหัวใจล้มเหลว ควรพิจารณาใช้ Paracetamol แทนเมื่อเป็นไปได้',
      createdAt: now(), updatedAt: now(),
    },
  ]);

  saveData(KEYS.items, [
    {
      id: uid(), name: 'Sacubitril/Valsartan (Entresto)', generic: 'Sacubitril + Valsartan',
      category: 'cardiac', dosageForm: 'Tablet',
      indication: 'รักษาภาวะหัวใจล้มเหลวชนิด HFrEF (EF ≤ 40%) ลดการนอน รพ. และอัตราตาย',
      notes: 'เริ่มได้หลัง ACEi/ARB washout 36 ชั่วโมง',
      addedDate: new Date(Date.now() - 7 * 86400e3).toISOString().slice(0,10), updatedAt: now(),
    },
    {
      id: uid(), name: 'Apixaban (Eliquis)', generic: 'Apixaban',
      category: 'anticoagulant', dosageForm: 'Tablet',
      indication: 'ป้องกัน stroke ใน NVAF, รักษา DVT/PE; ไม่ต้องติดตาม INR',
      notes: 'ปรับขนาดใน CrCl < 25 mL/min, ระวังใน renal failure รุนแรง',
      addedDate: new Date(Date.now() - 14 * 86400e3).toISOString().slice(0,10), updatedAt: now(),
    },
    {
      id: uid(), name: 'Empagliflozin (Jardiance)', generic: 'Empagliflozin',
      category: 'antidiabetic', dosageForm: 'Tablet',
      indication: 'เบาหวานชนิดที่ 2, ลดความเสี่ยง CV events และ HF hospitalization',
      notes: 'ระวัง DKA, ไม่แนะนำเมื่อ eGFR < 30, แจ้งผู้ป่วยเรื่อง genital infections',
      addedDate: new Date(Date.now() - 21 * 86400e3).toISOString().slice(0,10), updatedAt: now(),
    },
  ]);

  saveData(KEYS.vdos, [
    {
      id: uid(), title: 'การจัดการยา High Alert ในหน่วยงาน',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      duration: '8:42', description: 'อธิบายกระบวนการตรวจสอบและจัดการยา High Alert อย่างปลอดภัย รวมถึง double-check process',
      thumbnail: '', addedDate: new Date(Date.now() - 5 * 86400e3).toISOString().slice(0,10), updatedAt: now(),
    },
    {
      id: uid(), title: 'ความรู้เรื่อง Anticoagulant ในผู้ป่วย AF',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      duration: '12:15', description: 'เปรียบเทียบ Warfarin vs DOAC, การติดตามผู้ป่วย และ bleeding management',
      thumbnail: '', addedDate: new Date(Date.now() - 10 * 86400e3).toISOString().slice(0,10), updatedAt: now(),
    },
    {
      id: uid(), title: 'แนวทางจัดการ Drug Shortages',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      duration: '6:05', description: 'ขั้นตอนและแนวทางการหายาทดแทนเมื่อเกิดการขาดแคลน พร้อมแหล่งข้อมูลอ้างอิง',
      thumbnail: '', addedDate: new Date(Date.now() - 18 * 86400e3).toISOString().slice(0,10), updatedAt: now(),
    },
  ]);

  localStorage.setItem('bkn_ks.seeded', '1');
}

// ════════════════════════════════════════════════════════════════
// INIT
// ════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  seedSampleData();

  // Sidebar public nav
  document.querySelectorAll('#sidebarNav .nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });

  // Login modal
  document.getElementById('btnLoginConfirm').addEventListener('click', doLogin);
  document.getElementById('btnLoginCancel').addEventListener('click',  () => {
    document.getElementById('loginModal').hidden = true;
  });
  document.getElementById('loginPwInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
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

  // Read hash for deep-linking from popup
  const hash = location.hash.replace('#', '');
  if (['faqs','items','vdos'].includes(hash)) state.page = hash;

  renderPage();
  renderSidebar();
  updateNavActive();
});
