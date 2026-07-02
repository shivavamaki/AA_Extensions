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
  function isPharmacyWorklist(){ return location.href.includes('dispenseworkbench/pharmacy/dispense'); }

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
    if (_step7FillInProgress) { L('fillWorklistHNSearch skipped (already running)'); return false; }
    _step7FillInProgress = true;
    try {
      return await _doFillWorklistHNSearch(hn, L);
    } finally {
      _step7FillInProgress = false;
    }
  }

  async function _doFillWorklistHNSearch(hn, L) {
    L(`fillWorklistHNSearch hn="${hn}"`);

    // 1. Find patient search wrapper (not the order-item wrapper)
    const wrapper = Array.from(document.querySelectorAll('.mgs-wrapper')).find(
      w => w.textContent.includes('Search MRN or Name')
    );
    L(`wrapper: ${wrapper ? '#' + wrapper.id : 'NOT FOUND'}`);
    if (!wrapper) return false;

    // baseId: "defaultPatWidId2MgsWrapper" → "defaultPatWidId2"
    const baseId      = (wrapper.id || '').replace('MgsWrapper', '');
    const hasParamsId = baseId ? `${baseId}MgsHasParamsSearchInput0` : null;

    // 2. Open search mode only if suggestion chips are not already visible.
    // Clicking when already open would TOGGLE it off.
    const chipsVisible = () => document.querySelectorAll('span.sugsear-title').length > 0;
    if (!chipsVisible()) {
      wrapper.click();
      await sleep(500);
    }

    // 3. Click the "MRN" chip (class sugsear-title, different widget ID than wrapper).
    const mrnChip = Array.from(document.querySelectorAll('span.sugsear-title'))
                      .find(el => el.textContent.trim() === 'MRN');
    L(`MRN chip: ${mrnChip ? '#' + mrnChip.id : 'NOT FOUND'}`);
    if (!mrnChip) return false;
    mrnChip.click();

    // 4. Wait for hasParams input to appear (Angular needs a digest cycle after chip click).
    let input = null;
    for (let i = 0; i < 8; i++) {
      await sleep(150);
      input = (hasParamsId && document.getElementById(hasParamsId))
            || document.querySelector('[id*="MgsHasParamsSearchInput0"]');
      if (input) break;
    }
    L(`hasParams input: ${input ? '#' + input.id : 'NOT FOUND after 1.2s'}`);
    if (!input) return false;

    // 5. Set value via native setter so Angular ng-model + ng-change pick it up.
    input.focus();
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) nativeSetter.call(input, hn);
    else input.value = hn;
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);

    // 6. Click the Search button (not Enter — Enter doesn't trigger dispensing search).
    const searchBtn = document.getElementById('searchdispense');
    L(`searchBtn: ${searchBtn ? 'found' : 'NOT FOUND'}`);
    if (searchBtn) {
      searchBtn.click();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', keyCode: 13, bubbles: true }));
    }
    L(`HN "${hn}" dispatched to #${input.id}`);

    // 7. Wait for the first result row and click it to select the patient.
    const rowId = hasParamsId ? hasParamsId.replace('MgsHasParamsSearchInput0', 'MgsGridOneRow0') : null;
    let row = null;
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      row = (rowId && document.getElementById(rowId))
          || document.querySelector('[id*="MgsGridOneRow0"]');
      if (row) break;
    }
    L(`result row: ${row ? '#' + row.id : 'NOT FOUND after 4s'}`);
    if (row) row.click();

    // Stop re-processing — job is handed off to the pharmacist now.
    _step7NoJob = true;
    return true;
  }

  // ── HMR inline auto-dispense (ported from Automate extension) ──────────

  let _hmrAutoRunning = false;
  let _hmrAutoStop    = false;

  // Utilities (ported from Automate/content/shared.js)
  function _hmrIsVisible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || el.disabled) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  async function _hmrClick(el) {
    if (!el) return false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await sleep(250);
    for (const t of ['mouseover','mouseenter','mousedown','mouseup','click']) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
    if (typeof el.click === 'function') el.click();
    return true;
  }
  function _hmrText(el) {
    return ((el && (el.innerText || el.textContent)) || '').replace(/\s+/g, ' ').trim();
  }
  async function _hmrWaitFor(fn, timeout = 12000, interval = 300) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (_hmrAutoStop) return null;
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }
  function _hmrQueryFirst(selectors, root = document) {
    for (const sel of (Array.isArray(selectors) ? selectors : [selectors])) {
      try { const el = root.querySelector(sel); if (el && _hmrIsVisible(el)) return el; } catch (_) {}
    }
    return null;
  }
  function _hmrIsWorkbench()   { return location.href.includes('dispenseworkbench/pharmacy/dispense'); }
  function _hmrIsAllocate()    { return location.href.includes('allocatedispense'); }
  function _hmrIsDispenseDept(){ return location.href.includes('dispensetodept'); }

  function _hmrFindDialog() {
    for (const sel of ['body > div.md-dialog-container.ng-scope > md-dialog',
                        'body > div.md-dialog-container > md-dialog',
                        '.md-dialog-container md-dialog', 'md-dialog', "[role='dialog']"]) {
      try { const el = document.querySelector(sel); if (el && _hmrIsVisible(el)) return el; } catch (_) {}
    }
    return null;
  }
  function _hmrIsAlertDialog(d = _hmrFindDialog()) {
    if (!d) return false;
    const t = _hmrText(d).toLowerCase();
    return t.includes('alerts') || !!d.querySelector('#closeBtn');
  }
  function _hmrIsOverrideDialog(d = _hmrFindDialog()) {
    if (!d) return false;
    const t = _hmrText(d).toLowerCase();
    return ['override','reason','select reason','please select'].some(h => t.includes(h));
  }

  async function _hmrGetWorkbenchContainer() {
    const selectors = ['body > div.full-height.ng-scope.layout-row > div > md-content > md-content > div > md-card > md-content > div',
                        'md-card md-content > div', 'md-table-container'];
    for (const sel of selectors) { try { const el = document.querySelector(sel); if (el) return el; } catch(_) {} }
    return null;
  }
  async function _hmrWaitWorkbench() {
    const c = await _hmrWaitFor(() => _hmrIsWorkbench() ? _hmrGetWorkbenchContainer() : null, 20000, 300);
    if (!c) return null;
    await sleep(700);
    return c;
  }
  async function _hmrWaitAllocateSave() {
    const SELS = ['#actiondiv > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple',
                  '#actiondiv button.md-primary', "button.md-primary[ng-click*='save']", 'button.md-primary'];
    const btn = await _hmrWaitFor(() => _hmrIsAllocate() ? _hmrQueryFirst(SELS) : null, 20000, 300);
    if (!btn) return null;
    await sleep(700);
    return btn;
  }
  async function _hmrWaitDispenseSave() {
    const SELS = ['body > div.full-height.ng-scope.layout-row > div > md-content > md-card > md-card-content > div.layout-xs-column.layout-sm-column.layout-row > div > div > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple',
                  '#actiondiv button.md-primary', 'md-card-content button.md-primary',
                  "button.md-primary[ng-click*='save']", 'button.md-primary'];
    const btn = await _hmrWaitFor(() => _hmrIsDispenseDept() ? _hmrQueryFirst(SELS) : null, 20000, 300);
    if (!btn) return null;
    await sleep(700);
    return btn;
  }
  async function _hmrCloseAlertDialog() {
    const d = _hmrFindDialog();
    if (!d || !_hmrIsAlertDialog(d)) return false;
    const hideAll = document.querySelector('#hideAllAlerts');
    if (hideAll && _hmrIsVisible(hideAll)) { await _hmrClick(hideAll); await sleep(500); }
    else {
      for (const btn of Array.from(d.querySelectorAll('button[id^="dontshow"]')).filter(_hmrIsVisible)) {
        await _hmrClick(btn); await sleep(200);
      }
    }
    const close = _hmrQueryFirst(['#closeBtn', "button[aria-label='Close']"], d);
    if (close) { await _hmrClick(close); await sleep(900); }
    return true;
  }
  async function _hmrCloseToolbarDialog() {
    const d = _hmrFindDialog();
    if (!d) return false;
    const icon = _hmrQueryFirst(['body > div.md-dialog-container.ng-scope > md-dialog > form > md-toolbar > div > button > md-icon',
                                  '.md-dialog-container md-toolbar button md-icon', 'md-dialog md-toolbar button']);
    if (!icon) return false;
    await _hmrClick(icon); await sleep(900);
    return true;
  }
  async function _hmrWaitOverrideCompletion() {
    const end = Date.now() + 180000;
    while (Date.now() < end) {
      if (_hmrAutoStop) return { ok: false, reason: 'stopped' };
      const d = _hmrFindDialog();
      if (!d) {
        await sleep(1200);
        if (_hmrIsAllocate() || _hmrIsDispenseDept() || _hmrIsWorkbench())
          return { ok: true, reason: 'override dialog closed' };
      }
      await sleep(500);
    }
    return { ok: false, reason: 'timeout waiting for override' };
  }

  // Dispense-workbench row helpers
  function _hmrGetCellText(row, col) {
    const td = row.querySelector(`td:nth-child(${col}) > span`) || row.querySelector(`td:nth-child(${col})`);
    return td ? _hmrText(td) : '';
  }
  function _hmrNormStatus(v) { return String(v || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function _hmrFindDischargeRows(targetStatus) {
    const wanted = _hmrNormStatus(targetStatus);
    return Array.from(document.querySelectorAll(
      "tr[id^='slectDispense'], tr[id^='selectDispense'], [id^='slectDispense'], [id^='selectDispense']"
    )).filter(row => {
      if (!_hmrIsVisible(row)) return false;
      if (_hmrNormStatus(_hmrGetCellText(row, 8)) !== wanted) return false;
      if (!/^I/i.test(String(_hmrGetCellText(row, 10) || '').trim())) return false;
      return _hmrText(row).toUpperCase().includes('DISCHARGE MEDICATION');
    });
  }

  async function _hmrAllocateRow(row, setStatus) {
    setStatus('Clicking row…');
    await _hmrClick(row); await sleep(1000);
    const d = _hmrFindDialog();
    if (d && _hmrIsAlertDialog(d)) { await _hmrCloseAlertDialog(); await sleep(500); }

    setStatus('Clicking Allocate…');
    const allocBtn = await _hmrWaitFor(() => _hmrQueryFirst('#allocatedispense'), 18000, 300);
    if (!allocBtn) return { ok: false, reason: '#allocatedispense not found' };
    await _hmrClick(allocBtn); await sleep(1500);
    await _hmrWaitFor(() => location.href.includes('allocatedispense'), 20000, 300);

    setStatus('Saving allocation…');
    const saveBtn = await _hmrWaitAllocateSave();
    if (!saveBtn) return { ok: false, reason: 'allocate save button not found' };
    await _hmrClick(saveBtn); await sleep(1800);

    const d2 = _hmrFindDialog();
    if (d2 && _hmrIsOverrideDialog(d2)) {
      setStatus('Manual override needed — select reason & Save…');
      const ow = await _hmrWaitOverrideCompletion();
      if (!ow.ok) return ow;
    } else if (d2) {
      await _hmrCloseToolbarDialog();
    }
    await _hmrWaitWorkbench();
    return { ok: true };
  }

  async function _hmrDispenseRow(row, setStatus) {
    setStatus('Clicking row…');
    await _hmrClick(row); await sleep(1000);
    const d = _hmrFindDialog();
    if (d && _hmrIsAlertDialog(d)) { await _hmrCloseAlertDialog(); await sleep(500); }

    setStatus('Clicking Dispense To Dept…');
    const dispBtn = await _hmrWaitFor(() => _hmrQueryFirst('#dispensetodept'), 18000, 300);
    if (!dispBtn) return { ok: false, reason: '#dispensetodept not found' };
    await _hmrClick(dispBtn); await sleep(1500);
    await _hmrWaitFor(() => location.href.includes('dispensetodept'), 20000, 300);

    setStatus('Saving dispense…');
    const saveBtn = await _hmrWaitDispenseSave();
    if (!saveBtn) return { ok: false, reason: 'dispensetodept save button not found' };
    await _hmrClick(saveBtn); await sleep(1800);

    const d2 = _hmrFindDialog();
    if (d2 && _hmrIsOverrideDialog(d2)) {
      setStatus('Manual override needed — select reason & Save…');
      const ow = await _hmrWaitOverrideCompletion();
      if (!ow.ok) return ow;
    } else if (d2) {
      await _hmrCloseToolbarDialog();
      await _hmrCloseAlertDialog();
    }
    await _hmrWaitWorkbench();
    return { ok: true };
  }

  async function runHmrAutoDispense(setStatus) {
    if (_hmrAutoRunning) { setStatus('Auto dispense already running.'); return; }
    _hmrAutoRunning = true;
    _hmrAutoStop    = false;
    try {
      // ── Pass 1: Allocate all Ordered DISCHARGE MEDICATION rows ─────────
      for (let pass = 0; pass < 30; pass++) {
        if (_hmrAutoStop) break;
        const rows = _hmrFindDischargeRows('Ordered');
        if (!rows.length) break;
        setStatus(`Allocating… (${rows.length} Ordered row(s) remain)`);
        const r = await _hmrAllocateRow(rows[0], setStatus);
        if (!r.ok) { setStatus(`Allocate failed: ${r.reason}`); break; }
        await sleep(900);
      }
      if (_hmrAutoStop) { setStatus('Stopped.'); return; }

      // ── Pass 2: Dispense all Allocated DISCHARGE MEDICATION rows ───────
      for (let pass = 0; pass < 30; pass++) {
        if (_hmrAutoStop) break;
        // Refresh the workbench list before each dispense pass
        const searchBtn = document.getElementById('searchdispense');
        if (searchBtn) { searchBtn.click(); await sleep(1500); }
        const rows = _hmrFindDischargeRows('Allocated');
        if (!rows.length) break;
        setStatus(`Dispensing… (${rows.length} Allocated row(s) remain)`);
        const r = await _hmrDispenseRow(rows[0], setStatus);
        if (!r.ok) { setStatus(`Dispense failed: ${r.reason}`); break; }
        await sleep(900);
      }

      if (!_hmrAutoStop) setStatus('Auto dispense complete. Click ✓ Done — Close when ready.');
    } finally {
      _hmrAutoRunning = false;
    }
  }

  // ── Step 7 floating overlay (shown on Pharmacy Worklist) ─────────────

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
          <button class="hmrs7-fin-btn" id="hmrs7-done-all" style="opacity:1">✓ Done — Close</button>
          <button class="hmrs7-cancel-btn" id="hmrs7-cancel">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    makeDraggable(el, el.querySelector('.hmrs7-hdr'));
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

      await runHmrAutoDispense(setStatus);

      if (dispBtn) dispBtn.disabled = false;
    });

    document.getElementById('hmrs7-done-all')?.addEventListener('click', async () => {
      _hmrAutoStop = true;
      await serverSave(job.visitid, {
        steps: { allocateDispensed: 'done' },
      }, makeLog('step 7: allocate/dispense completed'));
      await clearStep7Job();
      document.getElementById('hmr-step7-overlay')?.remove();
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
      let actionTag;
      if (st === 'done') {
        actionTag = `<button class="hmr-step-override-btn" data-step="${s.key}" title="Mark as pending">↺</button>`;
      } else if (s.runnable) {
        actionTag = `<button class="hmr-step-run-btn" data-step="${s.key}">▶ Run</button>`;
      } else {
        actionTag = `<span class="hmr-step-tag">AUTO</span><button class="hmr-step-done-btn" data-step="${s.key}" title="Mark as done manually">✓</button>`;
      }
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

    // AUTO step manual override: ✓ button marks pending AUTO step as done
    document.querySelectorAll('.hmr-step-done-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.step;
        if (!key) return;
        _state.steps[key] = 'done';
        rerender(visitid, _state);
        await serverSave(visitid, { steps: _state.steps }, makeLog(`step ${key} manually marked done`));
      });
    });

    // ↺ button reverts a done step back to pending
    document.querySelectorAll('.hmr-step-override-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const key = btn.dataset.step;
        if (!key) return;
        _state.steps[key] = 'pending';
        rerender(visitid, _state);
        await serverSave(visitid, { steps: _state.steps }, makeLog(`step ${key} reset to pending`));
      });
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

  let _step7ObsScheduled  = false;
  let _step7NoJob         = false;   // true once we confirmed no pending job — stops spam
  let _step7FillInProgress = false;  // mutex: prevent concurrent fillWorklistHNSearch

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
