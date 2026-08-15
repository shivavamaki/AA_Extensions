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
  // Re-render cadence for the New-Case age alerts, so the row colour/badge
  // updates as time passes without waiting for the (slower) server poll.
  const AGE_TICK_MS = 30000;
  // New-Case age thresholds (minutes): warn (light orange) then overdue (light red).
  const AGE_WARN_MIN = 15;
  const AGE_LATE_MIN = 60;

  // ── Display-only name (keep stored data intact) ──────────────────────────
  // Names are stored "ENGLISH NAME - ไทย" (e.g. "MRS. A - วรัญญา"). The queue
  // row shows only the Thai part; the stored entry + the log modal keep the
  // full name. If there's no " - " separator, show the name unchanged.
  function displayName(full) {
    const s = norm(full || '');
    const i = s.indexOf(' - ');
    if (i >= 0) {
      const thai = s.slice(i + 3).trim();
      if (thai) return thai;
    }
    return s;
  }

  // Minutes elapsed since an ISO timestamp (UTC). null if unparseable.
  function ageMinutes(iso) {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((Date.now() - t) / 60000));
  }

  // Human-friendly age label: "42m" or "1h 12m".
  function ageLabel(min) {
    if (min == null) return '';
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h ${min % 60}m`;
  }

  // Bangkok-local date (UTC+7, no DST). The server keys the queue by Bangkok
  // day, so the client must query the same day — using the UTC date instead
  // caused the queue to appear empty during the 00:00–07:00 Bangkok window
  // (where UTC is still the previous day).
  function todayStr() {
    return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }

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

  // `extra` carries additional fields for non-status actions (e.g. update-loc
  // passes { ward, room }); status transitions pass no extra.
  // Returns the serverFetch result ({ok, status, json}) or, on a thrown
  // error / missing BKNData, a synthetic { ok:false, error } so callers can
  // surface WHY a transition did nothing instead of failing silently.
  async function putTransition(id, action, extra) {
    if (!window.BKNData || typeof window.BKNData.serverFetch !== 'function') {
      console.warn('[BKN-HMQ] putTransition: window.BKNData.serverFetch unavailable');
      return { ok: false, error: 'BKNData unavailable' };
    }
    try {
      const r = await window.BKNData.serverFetch(`/api/hmq/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, user: detectUsername(), ...(extra || {}) }),
      });
      if (!r || !r.ok) {
        console.warn(`[BKN-HMQ] putTransition ${action} #${id} → HTTP ${r ? r.status : '?'}`, r && r.json);
      }
      return r || { ok: false, error: 'no response' };
    } catch (e) {
      console.warn(`[BKN-HMQ] putTransition ${action} #${id} threw:`, e);
      return { ok: false, error: String(e && e.message || e) };
    }
  }

  // ── Position + width persistence (per browser/workstation) ─────────────
  const POS_KEY = 'bkn:hmqPopupPos';

  function loadSavedPos() {
    try { return JSON.parse(localStorage.getItem(POS_KEY) || 'null'); } catch (_) { return null; }
  }
  function patchSavedPos(patch) {
    try { localStorage.setItem(POS_KEY, JSON.stringify({ ...(loadSavedPos() || {}), ...patch })); } catch (_) {}
  }

  // ── Draggable header (same pattern as content-hmr.js's Step 7 overlay) ──
  // `handle` may itself be a <button> (the minimized FAB) — in that case a
  // plain click still needs to work, so a real drag is only recognized once
  // the pointer has moved past a small threshold; a click-sized mousedown+up
  // fires `opts.onClick` instead of saving a position.
  function makeDraggable(el, handle, opts = {}) {
    let ox = 0, oy = 0, startX = 0, startY = 0, moved = false;
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', e => {
      const btn = e.target.closest('button');
      if (btn && btn !== handle) return;
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      moved = false;
      const r = el.getBoundingClientRect();
      ox = r.left; oy = r.top;
      handle.style.cursor = 'grabbing';
      function onMove(e) {
        if (!moved && (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3)) moved = true;
        if (!moved) return;
        el.style.right = 'auto';
        el.style.left = (ox + e.clientX - startX) + 'px';
        el.style.top  = (oy + e.clientY - startY) + 'px';
      }
      function onUp() {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
          const r2 = el.getBoundingClientRect();
          patchSavedPos({ left: Math.round(r2.left), top: Math.round(r2.top) });
        } else if (typeof opts.onClick === 'function') {
          opts.onClick();
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Native CSS `resize: horizontal` (see hmq.css) gives the user a drag handle
  // to widen the card; ResizeObserver just persists whatever width they land on.
  function watchResize(el) {
    if (!window.ResizeObserver) return;
    let saveTimer = null;
    const ro = new ResizeObserver(() => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (el.classList.contains('min')) return;
        patchSavedPos({ width: Math.round(el.getBoundingClientRect().width) });
      }, 400);
    });
    ro.observe(el);
  }

  // Default anchor (first run, before the user has ever dragged the popup):
  // sit just to the right of Ward View's "Ward Board" toolbar title instead
  // of an arbitrary fixed corner. Only present on Ward View — falls back to
  // the CSS default (top-right corner) on the Return workbench.
  function findWardBoardTitle() {
    for (const span of document.querySelectorAll('h3.toolBarTitleCont span.toolbar-title')) {
      if (norm(span.textContent) === 'Ward Board') return span.closest('h3');
    }
    return null;
  }

  function applySavedPos(el) {
    const saved = loadSavedPos();
    if (saved && saved.left != null && saved.top != null) {
      el.style.right = 'auto';
      el.style.left  = saved.left + 'px';
      el.style.top   = saved.top + 'px';
    } else {
      const anchor = findWardBoardTitle();
      if (anchor) {
        const r = anchor.getBoundingClientRect();
        el.style.right = 'auto';
        el.style.left  = (r.right + 16) + 'px';
        el.style.top   = Math.max(8, r.top - 4) + 'px';
      }
    }
    if (saved && saved.width) el.style.width = saved.width + 'px';
  }

  // ── Popup DOM ────────────────────────────────────────────────────────────
  let _queue      = [];
  let _pollTimer  = null;
  let _ageTimer   = null;

  const SECTIONS = [
    { status: 'process', key: 'proc', label: '🔵 กำลังดำเนินการ · On Process' },
    { status: 'new',     key: 'new',  label: '🆕 เคสใหม่ · New Case' },
    { status: 'done',    key: 'done', label: '✅ เสร็จสิ้น · Completed' },
  ];

  // Defensive room cleanup: earlier detection could concatenate the bed id with
  // adjacent UI text (e.g. "CCU06Start" from the "▶ Start" button). A real bed
  // id is a single token; strip a trailing "Start" and keep the leading
  // alphanumeric token so stored bad values still render clean.
  function cleanRoom(raw) {
    let r = String(raw || '').trim();
    if (!r) return '';
    r = r.replace(/Start$/i, '');                       // drop trailing button text
    const m = r.match(/^[A-Za-z0-9-]+/);                // leading bed-id token
    return m ? m[0] : r;
  }

  /* "ตัวอย่าง มงคล, ภก." → "ตัวอย่าง มงคล". Keeps the queue chip short; the
     full stored value is still shown in the per-case log modal. */
  function shortUser(u) {
    const s = String(u || '').trim();
    if (!s || s === 'Unknown') return '';
    return s.split(',')[0].trim() || s;
  }

  function rowHtml(entry) {
    const hn   = escapeHtml(entry.hn || '');
    const name = escapeHtml(displayName(entry.name));
    const room = escapeHtml(cleanRoom(entry.room));
    const ward = escapeHtml(entry.ward || '');

    // ── New-Case age alert ──────────────────────────────────────────────
    // Only New-Case rows are timed against createdAt: >15m → warn (orange),
    // >1h → late (red). The small popup badge shows the elapsed time.
    let ageClass = '';
    let alertHtml = '';
    if (entry.status === 'new') {
      const min = ageMinutes(entry.createdAt);
      if (min != null && min >= AGE_LATE_MIN) {
        ageClass = ' hmq-age-late';
        alertHtml = `<span class="hmq-age-alert late" title="Waiting over 1 hour">⏰ ${escapeHtml(ageLabel(min))}</span>`;
      } else if (min != null && min >= AGE_WARN_MIN) {
        ageClass = ' hmq-age-warn';
        alertHtml = `<span class="hmq-age-alert warn" title="Waiting over 15 minutes">⚠ ${escapeHtml(ageLabel(min))}</span>`;
      }
    }
    // Room is shown as a standout badge next to the queue number so it's easy to
    // spot at a glance; the ward stays in the info line. A missing room shows a
    // muted placeholder badge rather than nothing.
    const roomBadge = room
      ? `<span class="hmq-room" title="Room / Bed">${room}</span>`
      : `<span class="hmq-room hmq-room-none" title="Room not detected">—</span>`;
    let actionHtml;
    if (entry.status === 'new') {
      actionHtml = `<button class="hmq-action-btn hmq-action-start" data-id="${entry.id}">▶ Start</button>`;
    } else if (entry.status === 'process') {
      actionHtml = `<button class="hmq-revert-btn" data-id="${entry.id}" data-revert="revert-new" title="Revert to New Case">↺</button>
        <button class="hmq-action-btn hmq-action-done" data-id="${entry.id}">✓ Complete</button>`;
    } else {
      const t = (entry.completedAt || '').slice(11, 16);
      actionHtml = `<button class="hmq-revert-btn" data-id="${entry.id}" data-revert="revert-process" title="Revert to On Process">↺</button>
        <span class="hmq-done-check">✓</span><span class="hmq-done-time">${t}</span>`;
    }
    // Who is working this case — shown only on On Process rows, right after the
    // HN, so the ward can see at a glance who picked it up. 'new' rows have no
    // owner yet and 'done' rows already show a completion time.
    // detectUsername() captures ArcusAir's banner form "ชื่อ สกุล, ภก." —
    // drop the ", ภก./ภญ." title so the chip stays short in a 300px popup.
    const startedBy = escapeHtml(shortUser(entry.startedBy));
    const byHtml = (entry.status === 'process' && startedBy)
      ? `<span class="hmq-by" title="Started by">👤 ${startedBy}</span>`
      : '';

    return `<div class="hmq-row${ageClass}" data-id="${entry.id}">
      <span class="hmq-qnum">Q${entry.queueNum != null ? entry.queueNum : '?'}</span>
      ${roomBadge}
      <div class="hmq-row-info">
        <div class="hmq-row-name"><span class="hmq-name-text">${name}</span><span class="hmq-hn">HN ${hn}</span>${byHtml}</div>
        <div class="hmq-row-loc">${ward || '&mdash;'}${alertHtml}</div>
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
    const fabBadge = card.querySelector('#hmq-fab-badge');
    if (fabBadge) fabBadge.textContent = String(_queue.length);

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
      <button class="hmq-fab" id="hmq-fab" title="Expand HM Process Queue">
        📋<span class="hmq-fab-badge" id="hmq-fab-badge">0</span>
      </button>
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
    applySavedPos(el);
    if ((loadSavedPos() || {}).minimized) el.classList.add('min');
    makeDraggable(el, document.getElementById('hmq-hdr'));
    // The FAB is itself the drag handle while minimized — a real drag (past
    // the movement threshold) repositions it, a plain click re-expands it.
    makeDraggable(el, document.getElementById('hmq-fab'), {
      onClick: () => {
        el.classList.remove('min');
        patchSavedPos({ minimized: false });
      },
    });
    watchResize(el);
    wirePopup();
  }

  function wirePopup() {
    document.getElementById('hmq-min-btn').addEventListener('click', () => {
      document.getElementById('hmq-card').classList.add('min');
      patchSavedPos({ minimized: true });
    });

    document.querySelectorAll('#hmq-card .hmq-sec-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => hdr.closest('.hmq-section').classList.toggle('collapsed'));
    });

    // Delegated: rows re-render on every poll, so Start/Complete/Log are wired
    // once on the card container rather than per-row.
    document.getElementById('hmq-card').addEventListener('click', async (e) => {
      const startBtn  = e.target.closest('.hmq-action-start');
      const doneBtn   = e.target.closest('.hmq-action-done');
      const logBtn    = e.target.closest('.hmq-log-btn');
      const revertBtn = e.target.closest('.hmq-revert-btn');

      // Shared runner: disable the button, run the transition, and ONLY on
      // failure re-enable it + tell the user why (on success the row re-renders
      // into the next section, replacing the button). Prevents the "click does
      // nothing, button stuck disabled" symptom on a server/transition error.
      const runTransition = async (btn, action) => {
        const id = btn.dataset.id;
        console.log(`[BKN-HMQ] ${action} clicked for #${id}`);
        btn.disabled = true;
        const r = await putTransition(id, action);
        if (!r || !r.ok) {
          btn.disabled = false;   // let the pharmacist retry
          const why = (r && (r.error || (r.json && r.json.error))) || `HTTP ${r ? r.status : '?'}`;
          alert(`[HM Process Queue] Could not ${action} this case — ${why}\n\nCheck the pharmacy server connection and try again.`);
          return;
        }
        await refreshQueue();
      };

      if (startBtn)       await runTransition(startBtn, 'start');
      else if (doneBtn)   await runTransition(doneBtn, 'complete');
      else if (revertBtn) await runTransition(revertBtn, revertBtn.dataset.revert);
      else if (logBtn)    showLog(logBtn.dataset.id);
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
    // Lighter re-render (no server fetch) so New-Case age colours/badges tick
    // up between polls using the already-loaded _queue.
    if (!_ageTimer) _ageTimer = setInterval(renderPopup, AGE_TICK_MS);
  }

  function teardownPopupIfIrrelevant() {
    // The popup persists across Ward View <-> Return navigation (both are
    // "relevant" pages) — only torn down once neither page is active.
    if (isRelevantPage()) return;
    document.getElementById('hmq-card')?.remove();
    document.getElementById('hmq-modal-overlay')?.remove();
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
    if (_ageTimer) { clearInterval(_ageTimer); _ageTimer = null; }
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
    // The Return workbench has two different "Ward ..." rows: the dispense
    // details header (2nd cell = the dispensing/pharmacy location, e.g.
    // "Inpatient Pharmacy (Floor G)" — NOT a room) and the "Bed Details" row
    // further down (2nd cell = the patient's actual bed/room number, always
    // observed as plain digits, e.g. "510"). Skip any row whose 2nd cell
    // isn't numeric so the wrong one never gets picked.
    const rows = Array.from(document.querySelectorAll('tr.md-row'));
    for (const row of rows) {
      const cells = row.querySelectorAll('td.md-cell');
      if (cells.length < 2 || !/^ward\b/i.test(norm(cells[0].textContent))) continue;
      const room = norm(cells[1].textContent);
      // A real bed id is a SINGLE token — plain digits (510) or alphanumeric for
      // special-care units (CCU06, ICU-3, NICU2). The wrong row (dispensing
      // location, e.g. "Inpatient Pharmacy (Floor G)") has spaces/parens, so the
      // single-token test both validates the room and skips the wrong row.
      if (/^[A-Za-z0-9-]+$/.test(room)) return { ward: norm(cells[0].textContent), room };
    }
    return { ward: '', room: '' };
  }

  // Shared add-case logic — used by this file's own "Add new case" button
  // (Return workbench) and exposed via window.BKN_HMQ for other content
  // scripts (e.g. content-hmr.js's Ward View "+ Add to Queue" button) to
  // reuse the exact same server call + duplicate handling.
  async function addCaseFlow({ hn, name, ward, room }) {
    const L = s => console.log(`[BKN-HMQ] ${s}`);
    if (!hn || !name) return { ok: false, reason: 'Patient name/HN missing.' };
    L(`adding case hn=${hn} name="${name}" ward="${ward || ''}" room="${room || ''}"`);
    const r = await postAddCase({ hn, name, ward: ward || '', room: room || '', addedBy: detectUsername() });
    if (r && r.status === 409) {
      const existing = r.json && r.json.existing;
      // The patient is already queued. Backfill the existing entry's location
      // when we now have ward/room and the stored one is missing OR dirty
      // (e.g. an old "CCU06Start" — cleanRoom differs from the raw value).
      if (existing && existing.id && (ward || room)) {
        const exRoom = (existing.room || '').trim();
        const exWard = (existing.ward || '').trim();
        const roomDirty = exRoom && exRoom !== cleanRoom(exRoom);
        if (!exWard || !exRoom || roomDirty) {
          try {
            await putTransition(existing.id, 'update-loc', { ward, room });
            await refreshQueue();
          } catch (_) { /* best-effort */ }
        }
      }
      const where = existing && existing.status === 'process' ? 'On Process' : 'New Case';
      return {
        ok: false, duplicate: true, existing,
        reason: `HN ${hn} (${name}) is already in the queue — ${where}. Complete it first, or wait for it to finish.`,
      };
    }
    if (!r || !r.ok) return { ok: false, reason: 'Failed to add case — check the pharmacy server connection.' };
    ensurePopup();
    await refreshQueue();
    return { ok: true, entry: r.json };
  }

  async function onAddCaseClick() {
    const patient = extractPatientFromBanner();
    if (!patient) {
      alert('[HM Process Queue] Could not detect the patient name/HN — make sure a patient is selected.');
      return;
    }
    const { ward, room } = extractWardRoom();
    const result = await addCaseFlow({ hn: patient.hn, name: patient.name, ward, room });
    if (!result.ok) alert(`[HM Process Queue] ${result.reason}`);
  }

  // Complete the active ("process") queue entry for this HN, if any — shared
  // by the popup's own ✓ Complete button and exposed via window.BKN_HMQ so
  // content-hmr.js's Ward View card can complete the same entry directly.
  async function completeActiveByHn(hn) {
    if (!hn) return { ok: false, reason: 'HN missing.' };
    const list = await fetchQueue();
    const entry = list.find(e => e.hn === hn && e.status === 'process');
    if (!entry) return { ok: false, reason: `No active (On Process) queue entry found for HN ${hn} today.` };
    const r = await putTransition(entry.id, 'complete');
    if (!r || !r.ok) return { ok: false, reason: 'Failed to complete the queue entry.' };
    await refreshQueue();
    return { ok: true, entry: r.json };
  }

  window.BKN_HMQ = { addCase: addCaseFlow, completeActiveByHn };

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
