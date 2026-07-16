"use strict";
// src/features/hmr/content-hmr.js
// Home Medication Review (HMR) workstation — ward view injection + step 7 automation.
//
// Key design:
//   • visitid (I48-xx-xxxxxx) primary key, hn secondary.
//   • Discharge status + home-med-ordered + open-orders-processed fetched from
//     the real ArcusAir discharge process API.
//   • Step 7 (Allocate/Dispense) navigates to Pharmacy Worklist, fills HN,
//     shows a floating overlay, and triggers the Automate panel's dispense
//     button (#arcus-btn-dispense is in the shared DOM across both extensions).
//   • Step 7 job survives navigation via chrome.storage.session.
//   • All checklist/step state persists to the pharmacy server.

(function () {
  if (window.__BKN_HMR_LOADED__) return;
  window.__BKN_HMR_LOADED__ = true;

  const { norm } = window.CoreDom;

  const VISITID_RE = /\b(I48-\d{2}-\d{6})\b/;
  const HN_RE      = /\b(48-\d{2}-\d{6})\b/;

  const DISCHARGE_API   = 'https://arcusair.bdms.co.th/inpatient/dischargeprocess/getdischargeprocess';
  const WORKLIST_ROUTE  = '#!/pharmacy/dispenseworkbench';
  const STEP7_STORE_KEY = 'bkn_hmr_step7';

  // ── Runtime state ────────────────────────────────────────────────────
  let _currentVisitId = null;
  let _currentHN      = null;
  let _currentUser    = null;
  let _state          = null;
  let _lastH4         = null;
  let _step7JobMem    = null;   // in-memory fast path; chrome.storage.local is the durable copy

  // ── Username detection ───────────────────────────────────────────────

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

  // ── ID detection ─────────────────────────────────────────────────────

  function detectInPanel(re) {
    const h4 = findVisitDetailsH4();
    if (h4) {
      let el = h4.parentElement;
      for (let i = 0; i < 14 && el; i++) {
        const m = re.exec(el.textContent);
        if (m) return m[1];
        el = el.parentElement;
      }
    }
    const m = re.exec(document.body.textContent);
    return m ? m[1] : null;
  }

  function detectVisitId() { return detectInPanel(VISITID_RE); }
  function detectHN()      { return detectInPanel(HN_RE); }

  // ── ArcusAir discharge process API ──────────────────────────────────

  // Ask arcus-xhr-tap.js (MAIN world) to scan the Angular scope of the element
  // currently showing visitid text — reliable even when XHR responses use _id.
  function getAngularScopeUIDs(visitid) {
    return new Promise(resolve => {
      const rid = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => { window.removeEventListener('message', h); resolve({}); }, 1500);
      function h(e) {
        if (e.source === window && e.data?.__bkn_hmr_scope_res__ === 1 && e.data.rid === rid) {
          clearTimeout(timer); window.removeEventListener('message', h); resolve(e.data);
        }
      }
      window.addEventListener('message', h);
      window.postMessage({ __bkn_hmr_scope__: 1, rid, visitid }, '*');
    });
  }

  // dischargestage → human label (fallback when timestamps are null)
  const DISCHARGE_STAGE = { 1: 'Discharge Advice', 2: 'Discharge Order', 3: 'Medical Discharge', 4: 'Final Discharge' };

  async function fetchDischargeInfo() {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(1200);
      try {
        const ctx = await new Promise(resolve =>
          chrome.runtime.sendMessage({ type: 'MJ_EXTRACT_ANGULAR_CTX' }, r => resolve(r))
        );
        if (!ctx?.ok) continue;

        const hdrs    = ctx.data?._raw?.arcusHdrs || {};
        const visitMap = ctx.data?._raw?.xhrTap?.visitMap || {};
        const mapped   = _currentVisitId ? visitMap[_currentVisitId] : null;
        let patientuid, patientvisituid;
        if (mapped?.patientvisituid) {
          patientuid      = mapped.patientuid;
          patientvisituid = mapped.patientvisituid;
        } else {
          const sd = await getAngularScopeUIDs(_currentVisitId);
          if (sd.patientvisituid) {
            patientuid      = sd.patientuid;
            patientvisituid = sd.patientvisituid;
          } else {
            const pc2 = ctx.data?.patientCtx || {};
            patientuid      = pc2.patientuid;
            patientvisituid = pc2.patientvisituid;
          }
        }
        if (!patientuid || !patientvisituid) continue;

        const body = JSON.stringify({ patientuid, patientvisituid });
        const r = await new Promise(resolve =>
          chrome.runtime.sendMessage({
            type:    'BKN_SERVER_PROXY',
            url:     DISCHARGE_API,
            method:  'POST',
            headers: {
              'Content-Type':           'application/json',
              'incus-token':            hdrs['incus-token']            || '',
              'appname':                hdrs['appname']                || 'ARCUSAIR',
              'utcoffset':              hdrs['utcoffset']              || '420',
              'departmentuid':          hdrs['departmentuid']          || '',
              'orguid':                 hdrs['orguid']                 || '',
              'parentorguid':           hdrs['parentorguid']           || '',
              'roleuid':                hdrs['roleuid']                || '',
              'useruid':                hdrs['useruid']                || '',
              'hasanonymouspermission': hdrs['hasanonymouspermission'] || 'false',
              'cache-control':          'no-cache',
              'if-modified-since':      '0',
            },
            body,
          }, r => resolve(r))
        );
        if (!r?.ok || !r.json) continue;

        const dp = r.json.dischargeprocess;
        if (dp === null && attempt < 2) continue;
        if (dp === null) return { status: 'Not ready', homemedordered: null, openordersprocessed: null };

        let status;
        if (dp.finaldischargedon)        status = 'Final Discharge';
        else if (dp.medicaldischargedon) status = 'Medical Discharge';
        else if (dp.dischargeorderedon)  status = 'Discharge Order';
        else if (dp.dischargeadvicedon)  status = 'Discharge Advice';
        else                             status = DISCHARGE_STAGE[dp.dischargestage] || 'In Progress';

        return {
          status,
          homemedordered:      typeof dp.homemedordered      === 'boolean' ? dp.homemedordered      : null,
          openordersprocessed: typeof dp.openordersprocessed === 'boolean' ? dp.openordersprocessed : null,
        };
      } catch (_) { continue; }
    }
    return _emptyDi();
  }

  function _emptyDi() {
    return { status: null, homemedordered: null, openordersprocessed: null };
  }

  function applyDischargeInfo(state, di) {
    state.checklist.dischargeStatus  = di.status;
    state.checklist.homemedordered   = di.homemedordered;
    state.steps.continueOrdersOff    = di.openordersprocessed === true ? 'done' : 'pending';
  }

  // ── Server persistence ───────────────────────────────────────────────

  async function serverLoad(visitid) {
    if (!window.BKNData) return null;
    try {
      const r = await window.BKNData.serverFetch(`/api/hmr/${encodeURIComponent(visitid)}`);
      return (r?.ok && r.json?.visitid) ? r.json : null;
    } catch (_) { return null; }
  }

  async function serverSave(visitid, patch, logEntry) {
    if (!window.BKNData) return false;
    try {
      const r = await window.BKNData.serverFetch(`/api/hmr/${encodeURIComponent(visitid)}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          ...patch,
          lastModifiedBy: detectUsername(),
          lastModifiedAt: new Date().toISOString(),
          auditLog: logEntry ? [logEntry] : [],
        }),
      });
      return !!(r?.ok);
    } catch (_) { return false; }
  }

  function makeLog(action) {
    return { ts: new Date().toISOString(), user: detectUsername(), action };
  }

  // ── Step 7 session storage ───────────────────────────────────────────

  async function saveStep7Job(job) {
    _step7JobMem = job;
    try { await chrome.storage.local.set({ [STEP7_STORE_KEY]: job }); } catch (_) {}
    console.log(`[BKN-HMR S7] saveStep7Job: mem=${JSON.stringify(_step7JobMem)}`);
  }

  async function getStep7Job() {
    if (_step7JobMem) return _step7JobMem;
    try {
      const r = await chrome.storage.local.get(STEP7_STORE_KEY);
      const job = r?.[STEP7_STORE_KEY] || null;
      if (job) _step7JobMem = job;
      return job;
    } catch (_) { return null; }
  }

  async function clearStep7Job() {
    _step7JobMem = null;
    try { await chrome.storage.local.remove(STEP7_STORE_KEY); } catch (_) {}
  }

  // ── Page detection helpers ───────────────────────────────────────────

  function isWardView()        { return location.href.includes('inpatient/wardview'); }
  function isPharmacyWorklist(){ return location.href.includes('dispenseworkbench'); }

  function findVisitDetailsH4() {
    for (const h of document.querySelectorAll('h4')) {
      if (norm(h.textContent) === 'Visit Details') return h;
    }
    return null;
  }

  function findPatientTrackingRow() {
    for (const h of document.querySelectorAll('h4')) {
      if (norm(h.textContent) === 'Patient Tracking') {
        return h.closest('[layout="row"]') || h.parentElement;
      }
    }
    return null;
  }

  // ── Side-menu navigation helpers ─────────────────────────────────────

  function findSideMenuButton(label) {
    for (const span of document.querySelectorAll('button.side-menu-link span.ng-binding')) {
      if (norm(span.textContent) === label) return span.closest('button');
    }
    return null;
  }

  async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function navigateToPharmacyWorklist() {
    const L = s => console.log(`[BKN-HMR S7] ${s}`);
    const pharmacyBtn = findSideMenuButton('Pharmacy');
    L(`pharmacyBtn found: ${!!pharmacyBtn}`);
    if (!pharmacyBtn) return false;
    if (!findSideMenuButton('Pharmacy Worklist')) {
      L('expanding Pharmacy submenu');
      pharmacyBtn.click();
      await sleep(600);
    }
    const worklistBtn = findSideMenuButton('Pharmacy Worklist');
    L(`worklistBtn found: ${!!worklistBtn}`);
    if (!worklistBtn) return false;
    worklistBtn.click();
    L('clicked Pharmacy Worklist');
    return true;
  }

  async function navigateToDischargeList() {
    let btn = findSideMenuButton('Discharge List');
    if (!btn) {
      // Submenu may need opening
      const pharmBtn = findSideMenuButton('Pharmacy');
      if (pharmBtn) { pharmBtn.click(); await sleep(500); }
      btn = findSideMenuButton('Discharge List');
    }
    if (!btn) return false;
    btn.click();
    return true;
  }

  // ── Worklist search helper ───────────────────────────────────────────

  async function fillWorklistHNSearch(hn) {
    const L = s => console.log(`[BKN-HMR S7] ${s}`);
    L(`fillWorklistHNSearch hn="${hn}"`);

    // The search widget is a custom MGS directive — must click the wrapper first
    // to open search mode, then the real input appears inside it.
    const wrapper = document.querySelector('#defaultPatWidId4MgsWrapper, .mgs-wrapper');
    L(`mgs-wrapper: ${wrapper ? wrapper.id || wrapper.className : 'NOT FOUND'}`);
    if (!wrapper) return false;

    wrapper.click();
    await sleep(500);

    // Input appears inside the wrapper after click
    const input = wrapper.querySelector('input');
    L(`input after click: ${input ? 'FOUND type=' + input.type : 'NOT FOUND'}`);
    if (!input) return false;

    input.focus();
    // Use native setter so Angular's ng-model picks up the value
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, hn);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      input.value = hn;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(300);
    input.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Enter', keyCode: 13, bubbles: true }));
    L('HN dispatched to mgs-wrapper input');
    return true;
  }

  // ── Step 7 row filter helper (Automate panel) ────────────────────────

  function setAutomateFilterToDischarge() {
    const sel = document.querySelector('#arcus-mode-select');
    if (!sel) return;
    sel.value = 'discharge';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Step 7 floating overlay (shown on Pharmacy Worklist) ─────────────

  function showStep7Overlay(job) {
    document.getElementById('hmr-step7-overlay')?.remove();

    const el = document.createElement('div');
    el.id = 'hmr-step7-overlay';
    el.innerHTML = `
      <div class="hmrs7-hdr">
        💊 HMR Step 7 — ${job.hn ? 'HN ' + job.hn : job.visitid}
        <button class="hmrs7-close" id="hmrs7-close">✕</button>
      </div>
      <div class="hmrs7-body">
        <div class="hmrs7-row" id="hmrs7-alloc-row">
          <span class="hmrs7-num">A</span>
          <span class="hmrs7-lbl">Allocate DISCHARGE MEDICATION<br>
            <small>Do this manually in the worklist, then click Done</small>
          </span>
          <button class="hmrs7-btn" id="hmrs7-done-alloc">Done ✓</button>
        </div>
        <div class="hmrs7-row hmrs7-disabled" id="hmrs7-disp-row">
          <span class="hmrs7-num">D</span>
          <span class="hmrs7-lbl">Auto Dispense DISCHARGE MEDICATION</span>
          <button class="hmrs7-btn" id="hmrs7-run-disp" disabled>▶ Run</button>
        </div>
        <div class="hmrs7-status" id="hmrs7-status">HN filled. Please allocate first.</div>
        <div class="hmrs7-footer">
          <button class="hmrs7-fin-btn" id="hmrs7-done-all" disabled>→ Discharge List</button>
          <button class="hmrs7-cancel-btn" id="hmrs7-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    wireStep7Overlay(job);
  }

  function wireStep7Overlay(job) {
    const setStatus = msg => {
      const el = document.getElementById('hmrs7-status');
      if (el) el.textContent = msg;
    };

    document.getElementById('hmrs7-close')?.addEventListener('click', () => {
      document.getElementById('hmr-step7-overlay')?.remove();
    });

    document.getElementById('hmrs7-cancel')?.addEventListener('click', async () => {
      document.getElementById('hmr-step7-overlay')?.remove();
      await clearStep7Job();
    });

    document.getElementById('hmrs7-done-alloc')?.addEventListener('click', () => {
      // Enable dispense row
      const dispRow = document.getElementById('hmrs7-disp-row');
      if (dispRow) dispRow.classList.remove('hmrs7-disabled');
      const dispBtn = document.getElementById('hmrs7-run-disp');
      if (dispBtn) dispBtn.disabled = false;
      document.getElementById('hmrs7-done-alloc').disabled = true;
      setStatus('Allocate done. Set filter to DISCHARGE MEDICATION, then click ▶ Run.');
    });

    document.getElementById('hmrs7-run-disp')?.addEventListener('click', async () => {
      const dispBtn = document.getElementById('hmrs7-run-disp');
      if (dispBtn) dispBtn.disabled = true;

      // Try to use the Automate extension's dispense button
      setAutomateFilterToDischarge();
      await sleep(300);

      const arcusDispBtn = document.querySelector('#arcus-btn-dispense');
      if (arcusDispBtn && !arcusDispBtn.disabled) {
        setStatus('Running Auto Dispense via Automate panel…');
        arcusDispBtn.click();
        setStatus('Dispense running. Click → Discharge List when done.');
        document.getElementById('hmrs7-done-all').disabled = false;
      } else if (arcusDispBtn && arcusDispBtn.disabled) {
        setStatus('Automate is already running. Wait for it to finish, then click → Discharge List.');
        document.getElementById('hmrs7-done-all').disabled = false;
      } else {
        setStatus('Automate panel not found. Please run dispense manually, then click → Discharge List.');
        if (dispBtn) dispBtn.disabled = false;
        document.getElementById('hmrs7-done-all').disabled = false;
      }
    });

    document.getElementById('hmrs7-done-all')?.addEventListener('click', async () => {
      setStatus('Saving and navigating to Discharge List…');
      // Mark step 7 done on server
      await serverSave(job.visitid, {
        steps: { allocateDispensed: 'done' },
      }, makeLog('step 7: allocate/dispense completed'));
      await clearStep7Job();
      document.getElementById('hmr-step7-overlay')?.remove();
      await navigateToDischargeList();
    });
  }

  // ── Step 7 entry point (called from ward-view workstation) ───────────

  async function launchStep7(visitid, hn) {
    console.log(`[BKN-HMR S7] launchStep7 visitid=${visitid} hn=${hn}`);
    _step7NoJob = false;
    await saveStep7Job({ visitid, hn });
    const ok = await navigateToPharmacyWorklist();
    console.log(`[BKN-HMR S7] navigateToPharmacyWorklist returned ${ok}`);
    if (!ok) {
      alert('[HMR] Could not find Pharmacy Worklist menu item.');
      await clearStep7Job();
    }
  }

  // ── State factory ────────────────────────────────────────────────────

  function newState(visitid, hn) {
    return {
      visitid,
      hn: hn || null,
      startedAt: new Date().toISOString(),
      checklist: {
        dischargeStatus:     null,
        homemedordered:      null,
        hasAtb:              null,
        medReturned:         null,
        controlledRemaining: null,
      },
      steps: {
        continueOrdersOff: 'pending',
        allocateDispensed: 'pending',
        reportsPrinted:    'pending',
      },
      lastModifiedBy: detectUsername(),
      lastModifiedAt: new Date().toISOString(),
      auditLog:    [],
      completedAt: null,
    };
  }

  // ── Render ───────────────────────────────────────────────────────────

  const CHECKS = [
    { key: 'hasAtb',              th: 'มี ATB ก่อน D/C?',        en: 'ATB before discharge?' },
    { key: 'medReturned',         th: 'คืนยาเหลือแล้ว?',         en: 'Unused meds returned?' },
    { key: 'controlledRemaining', th: 'ยาเสพติด/วอ. ค้างอยู่?', en: 'Controlled drugs remaining?' },
  ];

  const STEPS = [
    { key: 'continueOrdersOff', num: 6, label: 'Off continue orders' },
    { key: 'allocateDispensed', num: 7, label: 'Allocate / Dispense', runnable: true },
    { key: 'reportsPrinted',    num: 8, label: 'Print reports' },
  ];

  function renderWS(state) {
    const { checklist, steps, visitid, hn, lastModifiedBy } = state;
    const allChecked = CHECKS.every(c => checklist[c.key] !== null);
    const dc  = checklist.dischargeStatus;
    const hmo = checklist.homemedordered;

    const dcHtml = !dc
      ? `<span class="hmr-dc-badge hmr-dc-warn">D/C status not detected</span>`
      : dc === 'Not ready'
        ? `<span class="hmr-dc-badge hmr-dc-warn">Not ready</span>`
        : `<span class="hmr-dc-badge hmr-dc-ok">${dc} ✓</span>`;

    const hmoHtml = hmo === true
      ? `<span class="hmr-hmo-badge hmr-hmo-yes">Home Med ✓</span>`
      : hmo === false
        ? `<span class="hmr-hmo-badge hmr-hmo-no">Home Med ✗</span>`
        : `<span class="hmr-hmo-badge hmr-hmo-null">Home Med —</span>`;

    const checkHtml = CHECKS.map(c => {
      const v = checklist[c.key];
      return `<div class="hmr-check-row">
        <div class="hmr-check-text">
          <div class="hmr-ck-th">${c.th}</div>
          <div class="hmr-ck-en">${c.en}</div>
        </div>
        <div class="hmr-yn-pair">
          <button class="hmr-yn hmr-yn-yes ${v === true  ? 'hmr-yn-on' : ''}" data-ck="${c.key}" data-v="true">YES</button>
          <button class="hmr-yn hmr-yn-no  ${v === false ? 'hmr-yn-on' : ''}" data-ck="${c.key}" data-v="false">NO</button>
        </div>
      </div>`;
    }).join('');

    const stepHtml = STEPS.map(s => {
      const st  = steps[s.key];
      const cls = st === 'done' ? 'hmr-step-done' : st === 'skip' ? 'hmr-step-skip' : 'hmr-step-pend';
      const ic  = st === 'done' ? '✓' : st === 'skip' ? '—' : s.num;
      const actionTag = s.runnable && st !== 'done'
        ? `<button class="hmr-step-run-btn" data-step="${s.key}">▶ Run</button>`
        : `<span class="hmr-step-tag">AUTO</span>`;
      return `<div class="hmr-step-row ${cls}">
        <span class="hmr-step-num">${ic}</span>
        <span class="hmr-step-name">${s.label}</span>
        ${actionTag}
      </div>`;
    }).join('');

    const chipLabel = visitid + (hn ? ` · HN ${hn}` : '');
    const modInfo   = lastModifiedBy && lastModifiedBy !== 'Unknown'
      ? `Last saved by ${lastModifiedBy}` : '';

    return `<div class="hmr-card">
      <div class="hmr-hdr">
        <span class="hmr-title">💊 HM Process</span>
        <span class="hmr-room-chip" title="${chipLabel}">${chipLabel}</span>
        <button class="hmr-btn-start" id="hmr-btn-start" ${allChecked ? '' : 'disabled'}>▶ Start Process</button>
        <button class="hmr-x-btn" id="hmr-x-btn">✕</button>
      </div>
      <div class="hmr-body">

        <div class="hmr-statusbar" id="hmr-statusbar">
          ${allChecked ? '✓ Ready — click Start Process' : 'Complete all 3 manual checks above'}
          ${modInfo ? `<span class="hmr-mod-info"> · ${modInfo}</span>` : ''}
        </div>

        <div class="hmr-sec-lbl">Discharge Status <span class="hmr-auto-tag">AUTO</span></div>
        <div class="hmr-dc-row">
          ${dcHtml}
          ${hmoHtml}
          <button class="hmr-detect-btn" id="hmr-detect-btn">↻ Detect</button>
        </div>

        <div class="hmr-sec-lbl">Manual Checks</div>
        <div class="hmr-checklist">${checkHtml}</div>

        <div class="hmr-sec-lbl">Process Steps</div>
        <div class="hmr-steps">${stepHtml}</div>

        <div class="hmr-actions">
          <button class="hmr-btn-reset" id="hmr-btn-reset">Reset</button>
        </div>

      </div>
    </div>`;
  }

  // ── Toggle button ────────────────────────────────────────────────────

  function setTriggerOpen(open) {
    const btn = document.getElementById('hmr-trig-btn');
    if (!btn) return;
    btn.classList.toggle('hmr-trig-open', open);
    btn.title = open ? 'Close HM Process workstation' : 'Open HM Process workstation';
  }

  function injectTriggerBtn(h4) {
    if (document.getElementById('hmr-trig-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'hmr-trig-btn'; btn.className = 'hmr-trig-btn';
    btn.title = 'Open HM Process workstation';
    btn.textContent = 'HM Process';
    btn.addEventListener('click', onTriggerClick);
    const parent = h4.parentElement;
    if (parent && getComputedStyle(parent).display === 'block') {
      parent.style.cssText += ';display:flex;align-items:center;flex-wrap:wrap;gap:8px;';
    }
    h4.after(btn);
  }

  async function onTriggerClick() {
    if (document.getElementById('hmr-workstation')) {
      document.getElementById('hmr-workstation').remove();
      setTriggerOpen(false);
      if (_currentVisitId) await serverSave(_currentVisitId, {}, makeLog('closed workstation'));
      return;
    }
    const visitid = detectVisitId();
    if (!visitid) {
      const ws = document.createElement('div');
      ws.id = 'hmr-workstation';
      ws.innerHTML = `<div class="hmr-card"><div class="hmr-body" style="padding:12px">
        <span style="color:#c62828">Visit ID (I48-xx-xxxxxx) not found on page.</span>
      </div></div>`;
      const tr = findPatientTrackingRow();
      if (tr) tr.before(ws);
      setTimeout(() => ws.remove(), 3000);
      return;
    }
    _currentVisitId = visitid;
    _currentHN      = detectHN();

    _showSkeleton();
    setTriggerOpen(true);

    let state = await serverLoad(visitid);
    if (!state) state = newState(visitid, _currentHN);
    else if (_currentHN && !state.hn) state.hn = _currentHN;

    setLoadingStatus('Fetching discharge status…');
    const di = await fetchDischargeInfo();
    applyDischargeInfo(state, di);
    _state = state;

    showWorkstation(visitid, state);
    await serverSave(visitid, { ...state, auditLog: [] }, makeLog('opened workstation'));
  }

  function _showSkeleton() {
    const tr = findPatientTrackingRow();
    if (!tr) return;
    document.getElementById('hmr-workstation')?.remove();
    const ws = document.createElement('div');
    ws.id = 'hmr-workstation';
    ws.innerHTML = `<div class="hmr-card"><div class="hmr-hdr">
      <span class="hmr-title">💊 HM Process</span>
      <span style="color:#e3f2fd;font-size:11px;margin-left:8px">Loading…</span>
    </div></div>`;
    tr.before(ws);
  }

  // ── Workstation DOM ──────────────────────────────────────────────────

  function showWorkstation(visitid, state) {
    const existing = document.getElementById('hmr-workstation');
    const tr = findPatientTrackingRow();
    if (!tr) return;
    if (existing) {
      existing.innerHTML = renderWS(state);
      wireWS(visitid, state);
    } else {
      const ws = document.createElement('div');
      ws.id = 'hmr-workstation';
      ws.innerHTML = renderWS(state);
      tr.before(ws);
      wireWS(visitid, state);
    }
  }

  // Resolve HN: state (closure) → module var → DOM scan → server load
  async function resolveHN(visitid, state) {
    if (state?.hn)   return state.hn;
    if (_currentHN)  return _currentHN;
    const fromDom = detectHN();
    if (fromDom)     return fromDom;
    const srv = await serverLoad(visitid);
    return srv?.hn || null;
  }

  function wireWS(visitid, state) {
    document.getElementById('hmr-x-btn')?.addEventListener('click', async () => {
      document.getElementById('hmr-workstation')?.remove();
      setTriggerOpen(false);
      await serverSave(visitid, {}, makeLog('closed workstation'));
    });

    document.getElementById('hmr-detect-btn')?.addEventListener('click', async () => {
      setLoadingStatus('Fetching discharge status…');
      document.getElementById('hmr-detect-btn').disabled = true;
      const di = await fetchDischargeInfo();
      applyDischargeInfo(_state, di);
      rerender(visitid, _state);
      const log = makeLog(
        `D/C re-detected: ${di.status || '—'}, ` +
        `Home Med: ${di.homemedordered === true ? 'YES' : di.homemedordered === false ? 'NO' : '—'}, ` +
        `Open Orders: ${di.openordersprocessed === true ? 'YES' : di.openordersprocessed === false ? 'NO' : '—'}`
      );
      await serverSave(visitid, { checklist: _state.checklist, steps: _state.steps }, log);
    });

    document.querySelectorAll('.hmr-yn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const ckKey = btn.dataset.ck;
        const val   = btn.dataset.v === 'true';
        const label = CHECKS.find(c => c.key === ckKey)?.th || ckKey;
        _state.checklist[ckKey] = val;
        rerender(visitid, _state);
        await serverSave(visitid, { checklist: _state.checklist }, makeLog(`${label} = ${val ? 'YES' : 'NO'}`));
      });
    });

    document.getElementById('hmr-btn-start')?.addEventListener('click', async () => {
      const hn = await resolveHN(visitid, state);
      if (!hn) { setLoadingStatus('HN not detected — cannot start.'); return; }
      setLoadingStatus('Launching Step 7: Allocate / Dispense…');
      await serverSave(visitid, {}, makeLog('start process → step 7 launched'));
      await launchStep7(visitid, hn);
    });

    document.getElementById('hmr-btn-reset')?.addEventListener('click', async () => {
      const fresh = newState(visitid, _currentHN);
      _state = fresh;
      rerender(visitid, fresh);
      await serverSave(visitid, { ...fresh, auditLog: [] }, makeLog('workstation reset'));
    });

    // Step 7 ▶ Run button
    document.querySelector('.hmr-step-run-btn[data-step="allocateDispensed"]')
      ?.addEventListener('click', async () => {
        const hn = await resolveHN(visitid, state);
        if (!hn) return;
        await serverSave(visitid, {}, makeLog('step 7: launched from workstation'));
        await launchStep7(visitid, hn);
      });
  }

  function rerender(visitid, state) {
    const ws = document.getElementById('hmr-workstation');
    if (!ws) return;
    ws.innerHTML = renderWS(state);
    wireWS(visitid, state);
  }

  function setLoadingStatus(msg) {
    const el = document.getElementById('hmr-statusbar');
    if (el) el.textContent = msg;
  }

  // ── MutationObserver loop ────────────────────────────────────────────

  let _step7ObsScheduled = false;
  let _step7NoJob        = false;   // true once we confirmed no pending job — stops spam

  async function handleStep7OnWorklist() {
    const L = s => console.log(`[BKN-HMR S7] ${s}`);
    if (_step7ObsScheduled || _step7NoJob) return;
    _step7ObsScheduled = true;
    L(`handleStep7OnWorklist entered url=${location.hash}`);

    const job = await getStep7Job();
    L(`job: ${JSON.stringify(job)}`);
    if (!job) {
      _step7NoJob = true;   // no pending job — stop polling until next launchStep7
      _step7ObsScheduled = false; return;
    }

    if (document.getElementById('hmr-step7-overlay')) {
      L('overlay already visible, skipping');
      _step7ObsScheduled = false; return;
    }

    L('waiting 1500ms for page to settle');
    await sleep(1500);
    L(`after settle — inputs on page: ${document.querySelectorAll('input').length}`);

    const filled = await fillWorklistHNSearch(job.hn || job.visitid);
    L(`fillWorklistHNSearch returned ${filled}`);

    await sleep(800);
    setAutomateFilterToDischarge();

    showStep7Overlay(job);
    L('overlay shown');
    _step7ObsScheduled = false;
  }

  function syncUI() {
    // ── Pharmacy Worklist: handle pending step 7 job ──────────────────
    if (isPharmacyWorklist()) {
      if (!document.getElementById('hmr-step7-overlay')) {
        handleStep7OnWorklist();
      }
      return;
    }

    // ── Ward view: workstation trigger button ─────────────────────────
    if (!isWardView()) {
      if (_lastH4) cleanup();
      return;
    }
    const h4 = findVisitDetailsH4();
    if (!h4) {
      if (_lastH4) cleanup();
      return;
    }
    if (h4 === _lastH4) {
      if (!document.getElementById('hmr-trig-btn')) {
        injectTriggerBtn(h4);
        if (document.getElementById('hmr-workstation')) setTriggerOpen(true);
      }
      return;
    }
    // Different room selected
    _lastH4 = h4; _currentVisitId = null; _currentHN = null; _state = null;
    document.getElementById('hmr-trig-btn')?.remove();
    document.getElementById('hmr-workstation')?.remove();
    injectTriggerBtn(h4);
  }

  function cleanup() {
    _lastH4 = null; _currentVisitId = null; _currentHN = null; _state = null;
    document.getElementById('hmr-trig-btn')?.remove();
    document.getElementById('hmr-workstation')?.remove();
  }

  // ── Init ─────────────────────────────────────────────────────────────
  const obs = new MutationObserver(() => syncUI());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => { _step7ObsScheduled = false; setTimeout(syncUI, 700); });
  syncUI();

})();
