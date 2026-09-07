(() => {
  if (window.__ARCUS_HMR_LOADED__) return;
  window.__ARCUS_HMR_LOADED__ = true;

  const STORAGE_KEY = 'hmr_process_v1';

  let _allState = {};
  let _stateReady = false;
  let _lastVisitH4 = null;

  // ── Storage ──────────────────────────────────────────────────────────

  function loadState(cb) {
    // Reloading the extension while this page stays open kills the connection:
    // chrome.storage still exists but calling it throws.
    try {
      chrome.storage.local.get([STORAGE_KEY], r => {
      _allState = r[STORAGE_KEY] || {};
      _stateReady = true;
      if (cb) cb();
      });
    } catch (_) {
      _stateReady = true;      // carry on with empty state
      if (cb) cb();
    }
  }

  function saveRoomData(key, data) {
    _allState[key] = data;
    try {
      chrome.storage.local.set({ [STORAGE_KEY]: _allState });
    } catch (_) {}
  }

  function getRoomData(key) {
    return key ? (_allState[key] || null) : null;
  }

  // ── Page helpers ──────────────────────────────────────────────────────

  function isWardView() {
    return location.href.includes('inpatient/wardview');
  }

  function findVisitDetailsH4() {
    for (const h of document.querySelectorAll('h4')) {
      if (h.textContent.trim() === 'Visit Details') return h;
    }
    return null;
  }

  function findPatientTrackingRow() {
    for (const h of document.querySelectorAll('h4')) {
      if (h.textContent.trim() === 'Patient Tracking') {
        return h.closest('[layout="row"]') || h.parentElement;
      }
    }
    return null;
  }

  // ── Room identification ───────────────────────────────────────────────

  function detectRoomInfo() {
    const h4 = findVisitDetailsH4();
    if (!h4) return { key: 'hmr_default', label: '—' };

    // Walk up the tree looking for HN / room / visit number
    let el = h4.parentElement;
    for (let depth = 0; depth < 14 && el; depth++) {
      for (const bound of el.querySelectorAll('[ng-bind]')) {
        const attr = (bound.getAttribute('ng-bind') || '').toLowerCase();
        const text = bound.textContent.trim();
        if (!text || text.length > 30 || ['Visit Details', 'Patient Tracking'].includes(text)) continue;
        if (/hn|room|bed|visit|ward/.test(attr)) {
          return { key: `hmr_${text.replace(/\s+/g, '_')}`, label: text };
        }
      }
      el = el.parentElement;
    }

    // Pattern fallback: anything that looks like HN (7+ digits) or room code
    const panel = h4.closest('md-card') || h4.closest('[md-whiteframe]') || h4.parentElement?.parentElement;
    if (panel) {
      for (const child of panel.querySelectorAll('*')) {
        if (child.children.length > 0) continue;
        const t = child.textContent.trim();
        if (/^\d{7,}$/.test(t)) return { key: `hmr_hn_${t}`, label: `HN ${t}` };
        if (/^[A-Z]{1,4}-?\d{1,4}[A-Z]?$/.test(t)) return { key: `hmr_room_${t}`, label: t };
      }
    }

    return { key: `hmr_anon_${Date.now()}`, label: 'Patient' };
  }

  function detectDischargeStatus() {
    const keywords = ['Discharge Order', 'Discharge Advice'];
    for (const el of document.querySelectorAll('[ng-bind], [ng-bind-html]')) {
      const t = el.textContent.trim();
      for (const kw of keywords) {
        if (t === kw || t.startsWith(kw)) return kw;
      }
    }
    const h4 = findVisitDetailsH4();
    if (h4) {
      let c = h4.parentElement;
      for (let i = 0; i < 8 && c; i++) {
        for (const kw of keywords) {
          if (c.textContent.includes(kw)) return kw;
        }
        c = c.parentElement;
      }
    }
    return null;
  }

  // ── State factory ─────────────────────────────────────────────────────

  function newRoomState(roomKey, roomLabel) {
    return {
      roomKey,
      roomLabel,
      startedAt: new Date().toISOString(),
      checklist: {
        hasAtb: null,
        medReturned: null,
        controlledRemaining: null,
        dischargeStatus: detectDischargeStatus(),
      },
      steps: {
        homeMedOrdered: 'pending',
        continueOrdersOff: 'pending',
        allocateDispensed: 'pending',
        reportsPrinted: 'pending',
      },
      statusMsg: null,
      completedAt: null,
    };
  }

  // ── Render ────────────────────────────────────────────────────────────

  const CHECKS = [
    { key: 'hasAtb',              th: 'มี ATB ก่อน D/C?',        en: 'ATB before discharge?' },
    { key: 'medReturned',         th: 'คืนยาเหลือแล้ว?',         en: 'Unused meds returned?' },
    { key: 'controlledRemaining', th: 'ยาเสพติด/วอ. ค้างอยู่?', en: 'Controlled drugs remaining?' },
  ];

  const STEPS = [
    { key: 'homeMedOrdered',    num: 5, label: 'Home med order' },
    { key: 'continueOrdersOff', num: 6, label: 'Off continue orders' },
    { key: 'allocateDispensed', num: 7, label: 'Allocate / Dispense' },
    { key: 'reportsPrinted',    num: 8, label: 'Print reports' },
  ];

  function renderWS(state) {
    const { checklist, steps, roomLabel, statusMsg } = state;
    const allChecked = CHECKS.every(c => checklist[c.key] !== null);
    const dc = checklist.dischargeStatus;

    const dcHtml = dc
      ? `<span class="hmr-dc-badge hmr-dc-ok">${dc} ✓</span>`
      : `<span class="hmr-dc-badge hmr-dc-warn">D/C status not detected</span>`;

    const checkHtml = CHECKS.map(c => {
      const v = checklist[c.key];
      const yesOn = v === true;
      const noOn  = v === false;
      return `<div class="hmr-check-row">
        <div class="hmr-check-text">
          <div class="hmr-ck-th">${c.th}</div>
          <div class="hmr-ck-en">${c.en}</div>
        </div>
        <div class="hmr-yn-pair">
          <button class="hmr-yn hmr-yn-yes ${yesOn ? 'hmr-yn-on' : ''}" data-ck="${c.key}" data-v="true">YES</button>
          <button class="hmr-yn hmr-yn-no  ${noOn  ? 'hmr-yn-on' : ''}" data-ck="${c.key}" data-v="false">NO</button>
        </div>
      </div>`;
    }).join('');

    const stepHtml = STEPS.map(s => {
      const st  = steps[s.key];
      const cls = st === 'done' ? 'hmr-step-done' : st === 'skip' ? 'hmr-step-skip' : 'hmr-step-pend';
      const ic  = st === 'done' ? '✓' : st === 'skip' ? '—' : s.num;
      return `<div class="hmr-step-row ${cls}">
        <span class="hmr-step-num">${ic}</span>
        <span class="hmr-step-name">${s.label}</span>
        <span class="hmr-step-tag">AUTO</span>
      </div>`;
    }).join('');

    const label = roomLabel.length > 22 ? roomLabel.slice(0, 20) + '…' : roomLabel;

    return `<div class="hmr-card">
      <div class="hmr-hdr">
        <span class="hmr-title">💊 HM Process</span>
        <span class="hmr-room-chip" title="${roomLabel}">${label}</span>
        <button class="hmr-x-btn" id="hmr-x-btn">✕</button>
      </div>
      <div class="hmr-body">

        <div class="hmr-sec-lbl">Discharge Status <span class="hmr-auto-tag">AUTO</span></div>
        <div class="hmr-dc-row">
          ${dcHtml}
          <button class="hmr-detect-btn" id="hmr-detect-btn">↻ Detect</button>
        </div>

        <div class="hmr-sec-lbl">Manual Checks</div>
        <div class="hmr-checklist">${checkHtml}</div>

        <div class="hmr-sec-lbl">Process Steps</div>
        <div class="hmr-steps">${stepHtml}</div>

        <div class="hmr-statusbar" id="hmr-statusbar">
          ${statusMsg || (allChecked ? '✓ Ready — click Start Process' : 'Complete all 3 manual checks above')}
        </div>
        <div class="hmr-actions">
          <button class="hmr-btn-start" id="hmr-btn-start" ${allChecked ? '' : 'disabled'}>Start Process</button>
          <button class="hmr-btn-reset" id="hmr-btn-reset">Reset</button>
        </div>

      </div>
    </div>`;
  }

  // ── Injection ─────────────────────────────────────────────────────────

  function injectTriggerBtn(h4, existingState) {
    if (document.getElementById('hmr-trig-btn')) return;
    const active = !!existingState;
    const btn = document.createElement('button');
    btn.id = 'hmr-trig-btn';
    btn.className = 'hmr-trig-btn' + (active ? ' hmr-trig-active' : '');
    btn.title = 'Home Medication Review Process';
    btn.textContent = active ? 'HM Process ●' : 'HM Process';
    btn.addEventListener('click', onTriggerClick);

    // Insert after h4; nudge parent to flex so they sit side-by-side
    const parent = h4.parentElement;
    if (parent && getComputedStyle(parent).display === 'block') {
      parent.style.display = 'flex';
      parent.style.alignItems = 'center';
      parent.style.flexWrap = 'wrap';
      parent.style.gap = '8px';
    }
    h4.after(btn);
  }

  function onTriggerClick() {
    if (document.getElementById('hmr-workstation')) {
      document.getElementById('hmr-workstation').remove();
      return;
    }
    const info = detectRoomInfo();
    let state = getRoomData(info.key);
    if (!state) {
      state = newRoomState(info.key, info.label);
      saveRoomData(info.key, state);
    } else {
      const dc = detectDischargeStatus();
      if (dc && dc !== state.checklist.dischargeStatus) {
        state = { ...state, checklist: { ...state.checklist, dischargeStatus: dc } };
        saveRoomData(info.key, state);
      }
    }
    showWorkstation(info.key, state);
  }

  function showWorkstation(roomKey, state) {
    const trackingRow = findPatientTrackingRow();
    if (!trackingRow) {
      console.warn('[HMR] Patient Tracking row not found — cannot inject workstation');
      return;
    }
    const ws = document.createElement('div');
    ws.id = 'hmr-workstation';
    ws.innerHTML = renderWS(state);
    trackingRow.before(ws);
    wireWS(roomKey);

    const btn = document.getElementById('hmr-trig-btn');
    if (btn) { btn.classList.add('hmr-trig-active'); btn.textContent = 'HM Process ●'; }
  }

  function wireWS(roomKey) {
    document.getElementById('hmr-x-btn')?.addEventListener('click', () => {
      document.getElementById('hmr-workstation')?.remove();
    });

    document.getElementById('hmr-detect-btn')?.addEventListener('click', () => {
      const s = JSON.parse(JSON.stringify(getRoomData(roomKey)));
      s.checklist.dischargeStatus = detectDischargeStatus();
      saveRoomData(roomKey, s);
      rerender(roomKey, s);
    });

    document.querySelectorAll('.hmr-yn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = JSON.parse(JSON.stringify(getRoomData(roomKey)));
        s.checklist[btn.dataset.ck] = btn.dataset.v === 'true';
        s.statusMsg = null;
        saveRoomData(roomKey, s);
        rerender(roomKey, s);
      });
    });

    document.getElementById('hmr-btn-start')?.addEventListener('click', () => {
      startProcess(roomKey);
    });

    document.getElementById('hmr-btn-reset')?.addEventListener('click', () => {
      const info = { key: roomKey, label: getRoomData(roomKey)?.roomLabel || roomKey };
      const fresh = newRoomState(info.key, info.label);
      saveRoomData(roomKey, fresh);
      rerender(roomKey, fresh);
    });
  }

  function rerender(roomKey, state) {
    const ws = document.getElementById('hmr-workstation');
    if (!ws) return;
    ws.innerHTML = renderWS(state);
    wireWS(roomKey);
  }

  function setStatus(msg) {
    const el = document.getElementById('hmr-statusbar');
    if (el) el.textContent = msg;
  }

  async function startProcess(roomKey) {
    setStatus('Starting HM process… (automation steps coming in next phase)');
    const s = JSON.parse(JSON.stringify(getRoomData(roomKey)));
    s.statusMsg = 'Process started — auto steps pending implementation';
    saveRoomData(roomKey, s);
  }

  // ── MutationObserver loop ─────────────────────────────────────────────

  function syncUI() {
    if (!_stateReady || !isWardView()) {
      if (!isWardView()) cleanup();
      return;
    }

    const h4 = findVisitDetailsH4();

    if (!h4) {
      if (_lastVisitH4) cleanup();
      return;
    }

    // Re-inject trigger button if AngularJS re-rendered it away
    if (h4 === _lastVisitH4) {
      if (!document.getElementById('hmr-trig-btn')) {
        const info = detectRoomInfo();
        injectTriggerBtn(h4, getRoomData(info.key));
      }
      return;
    }

    // Different room panel opened
    _lastVisitH4 = h4;
    document.getElementById('hmr-trig-btn')?.remove();
    document.getElementById('hmr-workstation')?.remove();

    const info = detectRoomInfo();
    const existing = getRoomData(info.key);
    injectTriggerBtn(h4, existing);

    // Auto-reopen workstation if this room has an in-progress state
    if (existing && !existing.completedAt) {
      setTimeout(() => {
        if (!document.getElementById('hmr-workstation')) {
          showWorkstation(info.key, existing);
        }
      }, 200);
    }
  }

  function cleanup() {
    _lastVisitH4 = null;
    document.getElementById('hmr-trig-btn')?.remove();
    document.getElementById('hmr-workstation')?.remove();
  }

  // ── Init ──────────────────────────────────────────────────────────────

  loadState(() => {
    const obs = new MutationObserver(() => syncUI());
    obs.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('hashchange', () => setTimeout(syncUI, 600));
    syncUI();
  });

})();
