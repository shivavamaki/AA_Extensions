"use strict";
// src/features/hmq/content-hmq.js
// HM Process Queue — floating popup shared across Ward View and the Pharmacy
// Return workbench. Tracks patients through New Case -> On Process -> Completed.
// Data lives on the pharmacy server (/api/hmq in bkn_ks_server.py) so every
// workstation sees the same queue; the popup polls for refreshes.

(function () {
  if (window.__BKN_HMQ_LOADED__) return;
  window.__BKN_HMQ_LOADED__ = true;

  const { norm, escapeHtml } = window.CoreDom;

  const POLL_MS = 8000;

  function todayStr() { return new Date().toISOString().slice(0, 10); }

  function isWardView()     { return location.href.includes('inpatient/wardview'); }
  function isReturnPage()   { return location.href.includes('dispenseworkbench/pharmacy/return'); }
  function isRelevantPage() { return isWardView() || isReturnPage(); }

  // ── Username detection (same heuristic as content-hmr.js) ────────────
  let _currentUser = null;
  function detectUsername() {
    if (_currentUser) return _currentUser;
    for (const el of document.querySelectorAll('span.ng-binding.ng-scope, span.ng-binding')) {
      const t = norm(el.textContent);
      if (t && t.includes(',') && (t.includes('ภก.') || t.includes('ภญ.'))) {
        _currentUser = t; return t;
      }
    }
    return 'Unknown';
  }

  // ── Server I/O ─────────────────────────────────────────────────────────
  async function fetchQueue() {
    if (!window.BKNData) return [];
    const d = todayStr();
    try {
      const r = await window.BKNData.serverFetch(`/api/hmq?from=${d}&to=${d}`);
      return (r && r.ok && Array.isArray(r.json)) ? r.json : [];
    } catch (_) { return []; }
  }

  async function postAddCase(payload) {
    try {
      return await window.BKNData.serverFetch('/api/hmq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (_) { return null; }
  }

  async function putTransition(id, action) {
    try {
      return await window.BKNData.serverFetch(`/api/hmq/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, user: detectUsername() }),
      });
    } catch (_) { return null; }
  }

  // ── Draggable header (same pattern as content-hmr.js's Step 7 overlay) ──
  function makeDraggable(el, handle) {
    let ox = 0, oy = 0, startX = 0, startY = 0;
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', e => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      el.style.right = 'auto';
      el.style.left = ox + 'px';
      el.style.top  = oy + 'px';
      handle.style.cursor = 'grabbing';
      function onMove(e) {
        el.style.left = (ox + e.clientX - startX) + 'px';
        el.style.top  = (oy + e.clientY - startY) + 'px';
      }
      function onUp() {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // ── Popup DOM ────────────────────────────────────────────────────────────
  let _queue      = [];
  let _pollTimer  = null;

  const SECTIONS = [
    { status: 'process', key: 'proc', label: '🔵 กำลังดำเนินการ · On Process' },
    { status: 'new',     key: 'new',  label: '🆕 เคสใหม่ · New Case' },
    { status: 'done',    key: 'done', label: '✅ เสร็จสิ้น · Completed' },
  ];

  function rowHtml(entry) {
    const hn   = escapeHtml(entry.hn || '');
    const name = escapeHtml(entry.name || '');
    const loc  = [entry.ward, entry.room].filter(Boolean).map(escapeHtml).join(' · ');
    let actionHtml;
    if (entry.status === 'new') {
      actionHtml = `<button class="hmq-action-btn hmq-action-start" data-id="${entry.id}">▶ Start</button>`;
    } else if (entry.status === 'process') {
      actionHtml = `<button class="hmq-action-btn hmq-action-done" data-id="${entry.id}">✓ Complete</button>`;
    } else {
      const t = (entry.completedAt || '').slice(11, 16);
      actionHtml = `<span class="hmq-done-check">✓</span><span class="hmq-done-time">${t}</span>`;
    }
    return `<div class="hmq-row" data-id="${entry.id}">
      <span class="hmq-qnum">Q${entry.queueNum != null ? entry.queueNum : '?'}</span>
      <div class="hmq-row-info">
        <div class="hmq-row-name">${name}<span class="hmq-hn">HN ${hn}</span></div>
        <div class="hmq-row-loc">${loc || '&mdash;'}</div>
      </div>
      <button class="hmq-log-btn" data-id="${entry.id}" title="View log">🕒</button>
      ${actionHtml}
    </div>`;
  }

  function renderPopup() {
    const card = document.getElementById('hmq-card');
    if (!card) return;
    const totalBadge = card.querySelector('#hmq-total-badge');
    if (totalBadge) totalBadge.textContent = String(_queue.length);

    SECTIONS.forEach(sec => {
      const rows = _queue
        .filter(e => e.status === sec.status)
        .sort((a, b) => (a.queueNum || 0) - (b.queueNum || 0));
      const rowsEl  = card.querySelector(`#hmq-rows-${sec.key}`);
      const countEl = card.querySelector(`#hmq-count-${sec.key}`);
      if (countEl) countEl.textContent = String(rows.length);
      if (rowsEl) {
        rowsEl.innerHTML = rows.length
          ? rows.map(rowHtml).join('')
          : `<div class="hmq-empty">— none —</div>`;
      }
    });
  }

  function buildPopup() {
    const el = document.createElement('div');
    el.id = 'hmq-card';
    el.innerHTML = `
      <div class="hmq-hdr" id="hmq-hdr">
        <span class="hmq-title">📋 HM Process Queue</span>
        <span class="hmq-total-badge" id="hmq-total-badge">0</span>
        <button class="hmq-min-btn" id="hmq-min-btn" title="Minimize">−</button>
      </div>
      <div class="hmq-body" id="hmq-body">
        ${SECTIONS.map(sec => `
          <div class="hmq-section" data-section="${sec.key}">
            <div class="hmq-sec-hdr ${sec.key}">
              <button class="hmq-sec-caret">▾</button>
              <span class="hmq-sec-label">${sec.label}</span>
              <span class="hmq-sec-count" id="hmq-count-${sec.key}">0</span>
            </div>
            <div class="hmq-rows" id="hmq-rows-${sec.key}"></div>
          </div>`).join('')}
      </div>`;
    document.body.appendChild(el);
    makeDraggable(el, document.getElementById('hmq-hdr'));
    wirePopup();
  }

  function wirePopup() {
    document.getElementById('hmq-min-btn').addEventListener('click', () => {
      const card = document.getElementById('hmq-card');
      const btn  = document.getElementById('hmq-min-btn');
      const minimized = card.classList.toggle('min');
      btn.textContent = minimized ? '+' : '−';
      btn.title       = minimized ? 'Expand' : 'Minimize';
    });

    document.querySelectorAll('#hmq-card .hmq-sec-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => hdr.closest('.hmq-section').classList.toggle('collapsed'));
    });

    // Delegated: rows re-render on every poll, so Start/Complete/Log are wired
    // once on the card container rather than per-row.
    document.getElementById('hmq-card').addEventListener('click', async (e) => {
      const startBtn = e.target.closest('.hmq-action-start');
      const doneBtn  = e.target.closest('.hmq-action-done');
      const logBtn   = e.target.closest('.hmq-log-btn');
      if (startBtn) {
        startBtn.disabled = true;
        await putTransition(startBtn.dataset.id, 'start');
        await refreshQueue();
      } else if (doneBtn) {
        doneBtn.disabled = true;
        await putTransition(doneBtn.dataset.id, 'complete');
        await refreshQueue();
      } else if (logBtn) {
        showLog(logBtn.dataset.id);
      }
    });
  }

  // ── Per-patient log modal ────────────────────────────────────────────────
  function ensureLogModal() {
    if (document.getElementById('hmq-modal-overlay')) return;
    const el = document.createElement('div');
    el.id = 'hmq-modal-overlay';
    el.className = 'hmq-modal-overlay';
    el.innerHTML = `
      <div class="hmq-modal">
        <div class="hmq-modal-hdr">
          <div>
            <div class="hmq-modal-title" id="hmq-modal-title">Log</div>
            <div class="hmq-modal-sub" id="hmq-modal-sub"></div>
          </div>
          <button class="hmq-modal-close" id="hmq-modal-close" title="Close">✕</button>
        </div>
        <div class="hmq-modal-body" id="hmq-modal-body"></div>
      </div>`;
    document.body.appendChild(el);
    document.getElementById('hmq-modal-close').addEventListener('click', () => el.classList.remove('open'));
    el.addEventListener('click', (e) => { if (e.target === el) el.classList.remove('open'); });
  }

  function showLog(id) {
    const entry = _queue.find(e => e.id === id);
    if (!entry) return;
    ensureLogModal();
    document.getElementById('hmq-modal-title').textContent = entry.name || 'Patient';
    document.getElementById('hmq-modal-sub').textContent   = `HN ${entry.hn || '—'} · Q${entry.queueNum != null ? entry.queueNum : '?'}`;
    const logs = entry.auditLog || [];
    document.getElementById('hmq-modal-body').innerHTML = logs.length
      ? logs.map(l => `<div class="hmq-log-entry"><span class="hmq-log-time">${(l.ts || '').slice(11, 16)}</span><div class="hmq-log-text">${escapeHtml(l.action || '')}<div class="hmq-log-user">${escapeHtml(l.user || '')}</div></div></div>`).join('')
      : `<div class="hmq-log-entry"><span class="hmq-log-text">No log entries yet.</span></div>`;
    document.getElementById('hmq-modal-overlay').classList.add('open');
  }

  // ── Refresh loop ─────────────────────────────────────────────────────────
  async function refreshQueue() {
    _queue = await fetchQueue();
    renderPopup();
  }

  function ensurePopup() {
    if (document.getElementById('hmq-card')) return;
    buildPopup();
    refreshQueue();
    if (!_pollTimer) _pollTimer = setInterval(refreshQueue, POLL_MS);
  }

  function teardownPopupIfIrrelevant() {
    // The popup persists across Ward View <-> Return navigation (both are
    // "relevant" pages) — only torn down once neither page is active.
    if (isRelevantPage()) return;
    document.getElementById('hmq-card')?.remove();
    document.getElementById('hmq-modal-overlay')?.remove();
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── "Add new case" button (Return workbench only) ───────────────────────
  function findPrintPrescriptionBtn() {
    return document.getElementById('printprescription');
  }

  function extractPatientFromBanner() {
    const h4 = document.querySelector('h4.patientbannername');
    if (!h4) return null;
    const full = norm(h4.textContent);
    const m = /\((48-\d{2}-\d{6,7})\)/.exec(full);
    if (!m) return null;
    const hn   = m[1];
    const name = norm(full.slice(0, m.index));
    return { hn, name };
  }

  // Return workbench shows a small details table (Ward / Location / Nurse /
  // Date) for the currently selected dispense — first two cells are ward + room.
  function extractWardRoom() {
    const rows = Array.from(document.querySelectorAll('tr.md-row'));
    for (const row of rows) {
      const cells = row.querySelectorAll('td.md-cell');
      if (cells.length >= 2 && /^ward\b/i.test(norm(cells[0].textContent))) {
        return { ward: norm(cells[0].textContent), room: norm(cells[1].textContent) };
      }
    }
    return { ward: '', room: '' };
  }

  async function onAddCaseClick() {
    const L = s => console.log(`[BKN-HMQ] ${s}`);
    const patient = extractPatientFromBanner();
    if (!patient) {
      alert('[HM Process Queue] Could not detect the patient name/HN — make sure a patient is selected.');
      return;
    }
    const { ward, room } = extractWardRoom();
    L(`adding case hn=${patient.hn} name="${patient.name}" ward="${ward}" room="${room}"`);
    const r = await postAddCase({ hn: patient.hn, name: patient.name, ward, room, addedBy: detectUsername() });
    if (r && r.status === 409) {
      const existing = r.json && r.json.existing;
      const where = existing && existing.status === 'process' ? 'On Process' : 'New Case';
      alert(`[HM Process Queue] HN ${patient.hn} (${patient.name}) is already in the queue — ${where}.\nComplete it first, or wait for it to finish.`);
      return;
    }
    if (!r || !r.ok) {
      alert('[HM Process Queue] Failed to add case — check the pharmacy server connection.');
      return;
    }
    ensurePopup();
    await refreshQueue();
  }

  function injectAddCaseButton() {
    if (document.getElementById('hmq-add-btn')) return;
    const printBtn = findPrintPrescriptionBtn();
    if (!printBtn) return;
    const btn = document.createElement('button');
    btn.id = 'hmq-add-btn';
    btn.type = 'button';
    btn.className = printBtn.className;
    btn.setAttribute('aria-label', 'Add new case to HM Process Queue');
    btn.title = 'Add new case to HM Process Queue';
    btn.innerHTML = '<span class="hmq-add-icon">➕</span>';
    btn.addEventListener('click', onAddCaseClick);
    printBtn.before(btn);
  }

  // ── Page sync ────────────────────────────────────────────────────────────
  function syncUI() {
    if (isRelevantPage()) {
      ensurePopup();
    } else {
      teardownPopupIfIrrelevant();
    }
    if (isReturnPage()) {
      injectAddCaseButton();
    }
  }

  const obs = new MutationObserver(() => syncUI());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => setTimeout(syncUI, 600));
  syncUI();
})();
