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
  // Second, separate endpoint. getdischargeprocess carries the STAGE timestamps
  // (dischargeadvicedon → finaldischargedon); getdischargeorder carries the
  // per-task completion flags the auto-checklist reads. They are NOT the same
  // shape: getdischargeorder returns BOTH `openordersprocessed` and
  // `continuousordersprocessed`, and they disagree (seen live: open=false,
  // continuous=true), so "Off standing order" must read `continuousordersprocessed`.
  const DISCHARGE_ORDER_API = 'https://arcusair.bdms.co.th/inpatient/dischargeprocess/getdischargeorder';
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

  /* The logged-in user, straight from ArcusAir's header user button.
     .headUserDetBtn is a semantic class on the button itself, so this works on
     every ArcusAir page regardless of toolbar layout — unlike scanning every
     span for "ภก."/"ภญ.", which can just as easily match a PATIENT whose name
     carries a title. Returns '' when the header isn't rendered yet. */
  function detectHeaderUser() {
    const el = document.querySelector('.headUserDetBtn span.ng-binding');
    return el ? norm(el.textContent) : '';
  }

  function detectUsername() {
    if (_currentUser) return _currentUser;
    const header = detectHeaderUser();
    if (header) { _currentUser = header; return header; }
    // Fallback for a page where the header hasn't rendered: scan for a span
    // that looks like a pharmacist credential.
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

  // Best-effort patient name for the HM Process Queue "Add" button — same
  // banner class ArcusAir uses on the Return workbench (content-hmq.js reads
  // it there too).
  function detectPatientNameForQueue() {
    const h4 = document.querySelector('h4.patientbannername');
    if (!h4) return null;
    const full = norm(h4.textContent);
    const m = /\(48-\d{2}-\d{6,7}\)/.exec(full);
    return norm(m ? full.slice(0, m.index) : full);
  }

  // Ward View's "Visit Details" panel shows a "Ward / Bed :  Ward 8 / 805" line.
  // The bed token is usually numeric (805, 510…) but special-care units use
  // alphanumeric bed ids (CCU06, ICU-3, NICU2), so the room group accepts
  // letters/digits/hyphen. Separators in the panel are non-breaking spaces
  // ( ), which \s matches. This label-regex is the FALLBACK — the primary
  // source is the bedoccupancy DOM element below.
  const WARD_BED_RE = /Ward\s*\/\s*Bed\s*:?\s*(.+?)\s*\/\s*([A-Za-z0-9-]+)(?=\s|$)/i;

  // ArcusAir renders the current bed as an ng-repeat over the patient's
  // bedoccupancy, filtered to the row with no end date (the active bed). Each
  // row is TWO spans — ward and room — separated by "/":
  //   <div ng-repeat="occupancy in vm.patientvisit.bedoccupancy | filter:{enddate:'!'}">
  //     <span>Cardiac Care Unit</span>&nbsp;/&nbsp;<span>CCU06</span>
  //   </div>
  // Read the two spans directly (ward = 1st span, room = 2nd span). Using the
  // *2nd* span — not "last" — matters: a stray/nested span (or reading the
  // whole panel) previously let button text ("Start") bleed into the room.
  // Returns null when the element isn't present or the room looks invalid.
  function readBedOccupancy() {
    const nodes = document.querySelectorAll('[ng-repeat*="bedoccupancy"]');
    for (const node of nodes) {
      // Only spans that are direct children of this row — never descend into
      // sibling UI (queue buttons etc.).
      const spans = Array.from(node.children).filter(c => c.tagName === 'SPAN');
      if (spans.length >= 2) {
        const ward = norm(spans[0].textContent);
        const room = norm(spans[1].textContent);
        // A bed id is a single alphanumeric token — reject anything with spaces
        // or unexpected trailing text.
        if (ward && /^[A-Za-z0-9-]+$/.test(room)) return { ward, room };
      }
    }
    return null;
  }

  function detectWardBed() {
    // 1) Authoritative: the current bedoccupancy DOM element.
    const occ = readBedOccupancy();
    if (occ) return occ;
    // 2) Fallback: the "Ward / Bed :" text line in the Visit Details panel.
    //    Scoped to the panel around the Visit Details heading — NEVER the whole
    //    document.body, whose concatenated text runs the bed id into adjacent
    //    UI ("CCU06" + "Start" → "CCU06Start").
    const h4 = findVisitDetailsH4();
    if (h4) {
      let el = h4.parentElement;
      for (let i = 0; i < 14 && el; i++) {
        const m = WARD_BED_RE.exec(el.textContent);
        if (m) return { ward: norm(m[1]), room: norm(m[2]) };
        el = el.parentElement;
      }
    }
    return { ward: '', room: '' };
  }

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

        // Second call, same patient/visit + same headers: the per-task flags.
        // Best-effort — the stage timestamps above are what gate the card, so a
        // failure here just leaves the auto-checklist rows unknown ("—").
        const hdrsCommon = {
          'Content-Type':           'application/json',
          'incus-token':            hdrs['incus-token']            || '',
          'appname':                hdrs['appname']                || 'ARCUSAIR',
          'departmentuid':          hdrs['departmentuid']          || '',
          'orguid':                 hdrs['orguid']                 || '',
          'parentorguid':           hdrs['parentorguid']           || '',
          'roleuid':                hdrs['roleuid']                || '',
          'useruid':                hdrs['useruid']                || '',
          'hasanonymouspermission': hdrs['hasanonymouspermission'] || 'false',
          'cache-control':          'no-cache',
          'if-modified-since':      '0',
        };
        let dord = null;
        try {
          const r2 = await new Promise(resolve =>
            chrome.runtime.sendMessage({
              type: 'BKN_SERVER_PROXY', url: DISCHARGE_ORDER_API,
              method: 'POST', headers: hdrsCommon, body,
            }, x => resolve(x))
          );
          if (r2?.ok && r2.json) dord = r2.json.dischargeorder || null;
        } catch (_) { /* leave dord null */ }

        const dp = r.json.dischargeprocess;
        if (dp === null && attempt < 2) continue;
        if (dp === null) return { ..._emptyDi(), status: 'Not ready', ...(_orderFlags(dord)) };

        let status, dischargeStage;
        if (dp.finaldischargedon)        { status = 'Final Discharge';   dischargeStage = 4; }
        else if (dp.medicaldischargedon) { status = 'Medical Discharge'; dischargeStage = 3; }
        else if (dp.dischargeorderedon)  { status = 'Discharge Order';   dischargeStage = 2; }
        else if (dp.dischargeadvicedon)  { status = 'Discharge Advice';  dischargeStage = 1; }
        else {
          dischargeStage = dp.dischargestage ?? null;
          status = DISCHARGE_STAGE[dischargeStage] || 'In Progress';
        }

        // getdischargeorder is the authority on the per-task flags when it
        // answered; fall back to getdischargeprocess's copies otherwise.
        const fromProcess = {
          homemedordered:            _bool(dp.homemedordered),
          openordersprocessed:       _bool(dp.openordersprocessed),
          pharmacyreturnscompleted:  _bool(dp.pharmacyreturnscompleted),
          continuousordersprocessed: _bool(dp.continuousordersprocessed),
        };
        return { status, dischargeStage, ...fromProcess, ..._orderFlags(dord) };
      } catch (_) { continue; }
    }
    return _emptyDi();
  }

  const _bool = v => (typeof v === 'boolean' ? v : null);

  /* Pick out only the flags getdischargeorder actually returned, so a missing
     key never overwrites a value the other endpoint supplied. */
  function _orderFlags(dord) {
    if (!dord || typeof dord !== 'object') return {};
    const out = {};
    for (const k of ['homemedordered', 'openordersprocessed',
                     'pharmacyreturnscompleted', 'continuousordersprocessed']) {
      const v = _bool(dord[k]);
      if (v !== null) out[k] = v;
    }
    return out;
  }

  /* Build the context object page-home-med.js expects, using the SAME
     resolution chain fetchDischargeInfo() uses (xhrTap visitMap → Angular
     scope → patient context). The sheet hard-requires patientvisituid and
     incusToken — it refuses to fetch without them — so return null rather
     than opening a sheet that can only show an error. */
  async function buildHomeMedContext(visitid, state) {
    try {
      const ctx = await new Promise(resolve =>
        chrome.runtime.sendMessage({ type: 'MJ_EXTRACT_ANGULAR_CTX' }, r => resolve(r))
      );
      if (!ctx?.ok) return null;
      const hdrs     = ctx.data?._raw?.arcusHdrs || {};
      const visitMap = ctx.data?._raw?.xhrTap?.visitMap || {};
      const mapped   = visitid ? visitMap[visitid] : null;

      let patientuid, patientvisituid;
      if (mapped?.patientvisituid) {
        patientuid      = mapped.patientuid;
        patientvisituid = mapped.patientvisituid;
      } else {
        const sd = await getAngularScopeUIDs(visitid);
        if (sd.patientvisituid) {
          patientuid      = sd.patientuid;
          patientvisituid = sd.patientvisituid;
        } else {
          const pc = ctx.data?.patientCtx || {};
          patientuid      = pc.patientuid;
          patientvisituid = pc.patientvisituid;
        }
      }
      if (!patientvisituid) return null;

      // Fall back to the per-visit capture bag saved during Allocate / Dispense
      // (saveSessionCapture) when this tab has not tapped a live request yet —
      // e.g. Ward View freshly reloaded, or a different workstation. The server
      // drops the stored token after 24h, so a stale bag yields no token and
      // the caller reports that rather than opening a sheet that would hang.
      let cap = null;
      if (patientuid && window.BKNData && window.BKNData.loadCapture) {
        try { cap = await window.BKNData.loadCapture(patientuid, patientvisituid); }
        catch (_) { cap = null; }
      }

      // Step 5 persists medreconcileuid / medreconcileSnapshot onto the HMR
      // RECORD (keyed by visitid), not only onto the capture bag. The server's
      // _resolve_reconcile_meds() needs one of them in this context or the
      // sheet's Med Reconciliation panel renders empty — which is exactly what
      // happens after a completed Med Reconcile if we don't carry them through.
      let rec = null;
      try { rec = await serverLoad(visitid); } catch (_) { rec = null; }
      const incusToken = hdrs['incus-token'] || (cap && cap.incusToken) || '';
      if (!incusToken) return null;

      // The server rebuilds ArcusAir's session headers from THIS object
      // (_arcus_headers: useruid←loginuid, roleuid, orguid←organisationuid,
      // parentorguid, departmentuid). Sending only the token made every one of
      // those blank, and ArcusAir then never answers getallorderitem — the
      // sheet sat on "กำลังโหลด…" while the request hung. The dispense-workbench
      // button works precisely because its extractor carries all of them, so
      // carry the same set here.
      const pc = ctx.data?.patientCtx || {};
      // Live tap first, then the normalised context, then the saved capture.
      const pick = (...keys) => {
        for (const k of keys) {
          const v = hdrs[k] || pc[k] || ctx.data?.[k] || (cap && cap[k]);
          if (v) return String(v);
        }
        return '';
      };

      return {
        patientuid:      patientuid || '',
        patientvisituid,
        incusToken,
        loginuid:         pick('useruid', 'loginuid'),
        roleuid:          pick('roleuid'),
        organisationuid:  pick('orguid', 'organisationuid'),
        parentorguid:     pick('parentorguid'),
        departmentuid:    pick('departmentuid', 'logindepartmentuid'),
        hn:              state?.hn || _currentHN || '',
        patientVisitId:  visitid || '',
        patientName:     detectPatientNameForQueue() || '',
        // ผู้ตรวจสอบรายการยา on the printed sheet. The sheet runs in an
        // extension page with no access to ArcusAir's DOM, so the name has to
        // travel in the context — read from the header user button, which is
        // present on every ArcusAir page.
        pharmacistName:  detectHeaderUser(),
        // Med Reconciliation panel input. HMR record first (Step 5 writes it
        // there), then the shared capture bag as a cross-workstation fallback.
        medreconcileuid:      (rec && rec.medreconcileuid) || (cap && cap.medreconcileuid) || null,
        medreconcileSnapshot: (rec && rec.medreconcileSnapshot) || (cap && cap.medreconcileSnapshot) || null,
      };
    } catch (_) { return null; }
  }

  function _emptyDi() {
    return {
      status: null, dischargeStage: null, homemedordered: null,
      openordersprocessed: null, pharmacyreturnscompleted: null,
      continuousordersprocessed: null,
    };
  }

  /* Log an ArcusAir-side flag flipping false→true onto the HMQ case.

     Unlike the medicine return — where we hear the pharmacist's actual click
     on ArcusAir's Verify Return button — nothing in the UI tells us WHEN the
     ward stopped the standing orders or WHO did it. All we observe is the API
     flag changing between two polls. So the line is labelled "(detected)" and
     carries no user: recording whoever happened to have the card open would
     name the wrong person in a clinical audit trail. */
  const _flagSeen = {};
  async function logFlagFlip(state, key, before, after, text) {
    if (before === after || after !== true) return;   // only false/null → true
    const hn = state && state.hn;
    if (!hn) return;
    const seenKey = `${hn}|${key}`;
    if (_flagSeen[seenKey]) return;
    _flagSeen[seenKey] = true;
    try {
      if (window.BKN_HMQ && window.BKN_HMQ.logEvent) {
        await window.BKN_HMQ.logEvent(hn, { action: text, user: '' });
      }
    } catch (_) { /* best-effort */ }
  }

  function applyDischargeInfo(state, di) {
    const prevReturn   = state.checklist.medReturned;
    const prevStanding = state.checklist.standingOrdersOff;
    state.checklist.dischargeStatus  = di.status;
    state.checklist.dischargeStage   = di.dischargeStage ?? null;
    state.checklist.homemedordered   = di.homemedordered;
    state.checklist.medReturned      = di.pharmacyreturnscompleted;
    // "Off standing order" reads continuousordersprocessed — NOT
    // openordersprocessed. getdischargeorder returns both and they disagree.
    state.checklist.standingOrdersOff = di.continuousordersprocessed;
    state.steps.continueOrdersOff     = di.continuousordersprocessed === true ? 'done' : 'pending';

    // Fallback only. content-hmq listens to ArcusAir's own buttons (Verify
    // Return / Close Continuous Orders) and logs the REAL click time and
    // actor. These lines cover the case where the action happened on a machine
    // that never had the relevant page open, so all we ever saw was the API
    // flag change — hence "(detected)" and no user. Deduped per HN, and the
    // real entry is written by whichever workstation saw the click.
    logFlagFlip(state, 'medReturned', prevReturn, di.pharmacyreturnscompleted,
                'คืนยาเรียบร้อย · Pharmacy return completed (detected)');
    logFlagFlip(state, 'standingOrdersOff', prevStanding, di.continuousordersprocessed,
                'หยุดยาต่อเนื่อง · Standing orders stopped (detected)');
  }

  // Discharge stage 1 (Discharge Advice) / 2 (Discharge Order) means the ward
  // has started the discharge process — auto-enqueue the patient into the HM
  // Process Queue instead of waiting for the pharmacist to click "+ Add to
  // Queue" by hand. Best-effort/silent: the server's own duplicate guard
  // (active 'new'/'process' entry for this HN today) makes this safe to call
  // every time discharge info is (re)fetched, so failures are just logged.
  async function maybeAutoAddToQueue(visitid, state, di) {
    if (di.dischargeStage !== 1 && di.dischargeStage !== 2) return;
    if (!window.BKN_HMQ) return;
    try {
      const hn = await resolveHN(visitid, state);
      if (!hn) return;
      const name = detectPatientNameForQueue() || hn;
      const { ward, room } = detectWardBed();
      const result = await window.BKN_HMQ.addCase({ hn, name, ward, room });
      if (result.ok) {
        await serverSave(visitid, {}, makeLog(`Auto-added to HM Process Queue (Q${result.entry.queueNum}) — ${di.status}`));
      } else {
        console.log(`[BKN-HMR] auto-add to queue skipped: ${result.reason}`);
      }
    } catch (e) {
      console.log(`[BKN-HMR] auto-add to queue failed: ${e}`);
    }
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

  // Every automated click that changes the DOM/URL (page nav, menu switch,
  // search, row select…) can pop a native/AngularMD alert or confirm dialog
  // that would otherwise block the rest of the sequence. Escape closes
  // AngularMaterial dialogs by default and is harmless when nothing is open,
  // so fire it a few times after each such click rather than trying to
  // detect every possible dialog shape.
  async function dismissAlerts(times = 3, delay = 250) {
    for (let i = 0; i < times; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      document.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
      await sleep(delay);
    }
  }

  async function navigateToPharmacyWorklist() {
    const L = s => console.log(`[BKN-HMR S7] ${s}`);
    const pharmacyBtn = findSideMenuButton('Pharmacy');
    L(`pharmacyBtn found: ${!!pharmacyBtn}`);
    if (!pharmacyBtn) return false;
    if (!findSideMenuButton('Pharmacy Worklist')) {
      L('expanding Pharmacy submenu');
      pharmacyBtn.click();
      await dismissAlerts();
      await sleep(600);
    }
    const worklistBtn = findSideMenuButton('Pharmacy Worklist');
    L(`worklistBtn found: ${!!worklistBtn}`);
    if (!worklistBtn) return false;
    worklistBtn.click();
    await dismissAlerts();
    L('clicked Pharmacy Worklist');
    return true;
  }

  async function navigateToDischargeList() {
    let btn = findSideMenuButton('Discharge List');
    if (!btn) {
      // Submenu may need opening
      const pharmBtn = findSideMenuButton('Pharmacy');
      if (pharmBtn) { pharmBtn.click(); await dismissAlerts(); await sleep(500); }
      btn = findSideMenuButton('Discharge List');
    }
    if (!btn) return false;
    btn.click();
    await dismissAlerts();
    return true;
  }

  // Generic "wait until fn() returns truthy" poll — unlike _hmrWaitFor (defined
  // further down), this one doesn't bail out when _hmrAutoStop is set, since it
  // is used after the auto-dispense run has already finished.
  async function _waitForEl(fn, timeout = 15000, interval = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(interval);
    }
    return null;
  }

  // Step 7 finale: return to Ward View and re-search the same patient by HN
  // so the pharmacist can continue on to Step 8 (print reports).
  async function navigateToWardViewAndSearchHN(hn) {
    const L = s => console.log(`[BKN-HMR S7] ${s}`);
    L(`navigateToWardViewAndSearchHN hn=${hn}`);

    // Setting location.hash directly trips ArcusAir's "back button navigation"
    // security guard — must navigate via the side-menu link's own ng-click.
    const wardBoardBtn = await _waitForEl(() => findSideMenuButton('Ward Board'), 10000, 300);
    L(`wardBoardBtn found: ${!!wardBoardBtn}`);
    if (!wardBoardBtn) return false;
    wardBoardBtn.click();
    await dismissAlerts();
    L('clicked Ward Board');

    const sidebarBtn = await _waitForEl(() => document.getElementById('LNDOpenSidebarBtn'), 20000, 300);
    L(`sidebarBtn found: ${!!sidebarBtn}`);
    if (!sidebarBtn) return false;
    await sleep(500);
    sidebarBtn.click();
    await dismissAlerts();

    const wrapper = await _waitForEl(() => document.getElementById('ipdWardViewPatientWidgetMgsWrapper'), 10000, 300);
    L(`wardview wrapper found: ${!!wrapper}`);
    if (!wrapper) return false;
    // "ipdWardViewPatientWidgetMgsWrapper" → "ipdWardViewPatientWidgetMgs"
    const baseId = wrapper.id.replace(/Wrapper$/, '');

    // Open search mode only if the suggestions/selected-params box isn't
    // already showing — clicking an already-open widget toggles it closed.
    let suggBox = document.getElementById(`${baseId}SuggestedSearches`);
    if (!suggBox) {
      await sleep(400);
      wrapper.click();
      await dismissAlerts();
      suggBox = await _waitForEl(() => document.getElementById(`${baseId}SuggestedSearches`), 8000, 200);
    }
    L(`suggested-searches box found: ${!!suggBox}`);
    if (!suggBox) return false;

    // The widget pre-selects a blank "defaultQuery" param (a free-text field
    // that does NOT search by MRN) — explicitly pick the "MRN" suggestion
    // chip so the value goes into the right search parameter.
    const selectedContainer = document.getElementById(`${baseId}SelectedSearches`);
    let mrnSpan = selectedContainer
      && Array.from(selectedContainer.querySelectorAll('.selsear-title')).find(el => el.textContent.trim() === 'MRN');
    if (!mrnSpan) {
      const mrnChip = Array.from(suggBox.querySelectorAll('*'))
        .find(el => el.children.length === 0 && el.textContent.trim() === 'MRN');
      L(`MRN suggestion chip found: ${!!mrnChip}`);
      if (!mrnChip) return false;
      mrnChip.click();
      await dismissAlerts();
      const found = await _waitForEl(() => {
        const c = document.getElementById(`${baseId}SelectedSearches`);
        return c && Array.from(c.querySelectorAll('.selsear-title')).find(el => el.textContent.trim() === 'MRN');
      }, 5000, 150);
      mrnSpan = found || null;
    }
    L(`MRN selected-search span found: ${!!mrnSpan}`);
    if (!mrnSpan) return false;

    const input = mrnSpan.parentElement.querySelector('input.selsear-value');
    L(`wardview MRN input found: ${!!input}`);
    if (!input) return false;

    const existing = (input.value || '').trim();
    if (existing && existing.includes(hn)) {
      L(`input already contains "${existing}", skipping fill`);
    } else {
      input.focus();
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(input, hn);
      else input.value = hn;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', keyCode: 13, bubbles: true }));
    await dismissAlerts();
    L('Enter dispatched on wardview MRN search');

    // Enter alone fills+submits the filter but the ward board doesn't always
    // resolve to the single patient — the pharmacist otherwise has to click the
    // result row manually ("stuck, need more click"). So wait for the first
    // result row and click it, same as the dispense-workbench search does.
    const row = await _waitForEl(() =>
      document.querySelector('[id*="MgsGridOneRow0"]') ||
      document.querySelector('.mgs-grid-row, tr.mgs-row, .patient-search-result'),
      6000, 200);
    L(`wardview result row: ${row ? '#' + (row.id || row.className) : 'NOT FOUND after 6s'}`);
    if (row) {
      row.click();
      await dismissAlerts();
      L('clicked wardview result row');
    }
    return true;
  }

  // ── Step 5: Med Reconcile automation (captures medreconcileuid) ─────
  // Drives EMR → Med Reconcile, then STOPS on the Med Reconcile page and
  // waits for the pharmacist to review the list and click an injected
  // "Continue" button — only then does it open the reconciliation record
  // (firing the getdetail XHR) and capture medreconcileuid. The MAIN-world
  // tap (arcus-xhr-tap.js) already scans that call's body for
  // medreconcileuid and stores it in window.__arcus_medrecon__, keyed by
  // patientvisituid — same map content-home-med.js reads for the Home
  // Medication Sheet's reconciliation panel.
  //
  // Job survives the EMR navigation via chrome.storage.local, same pattern
  // as the Step 7 (Allocate/Dispense) job below.

  const MEDRECON_STORE_KEY = 'bkn_hmr_medrecon';

  async function saveMedReconJob(job) {
    try { await chrome.storage.local.set({ [MEDRECON_STORE_KEY]: job }); } catch (_) {}
  }
  async function getMedReconJob() {
    try {
      const r = await chrome.storage.local.get(MEDRECON_STORE_KEY);
      return r?.[MEDRECON_STORE_KEY] || null;
    } catch (_) { return null; }
  }
  async function clearMedReconJob() {
    try { await chrome.storage.local.remove(MEDRECON_STORE_KEY); } catch (_) {}
  }

  function isMedReconcilePage() { return location.href.includes('/emr/emrview/emr/medreconcile'); }

  async function _hmrWaitForUrl(substr, timeout = 15000, interval = 300) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (location.href.includes(substr)) return true;
      await sleep(interval);
    }
    return false;
  }

  async function _hmrWaitForEl(selectorFn, timeout = 15000, interval = 250) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const el = selectorFn();
      if (el) return el;
      await sleep(interval);
    }
    return null;
  }

  async function _extractAngularCtx() {
    return new Promise(resolve =>
      chrome.runtime.sendMessage({ type: 'MJ_EXTRACT_ANGULAR_CTX' }, r => resolve(r))
    );
  }

  async function resolvePatientVisitUid(visitid) {
    // Same 3-tier fallback + retry as fetchDischargeInfo() (which reliably
    // resolves patientuid/patientvisituid for this same card) — visitMap and
    // getAngularScopeUIDs can both legitimately come up empty, but
    // ctx.data.patientCtx (a separate, broader Angular-scope walk done by
    // _arcusExtractAngularCtx in background.js) is already sitting in the
    // same ctx response and was previously never checked here.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(1200);
      const ctx = await _extractAngularCtx();
      if (!ctx?.ok) continue;

      const visitMap = ctx.data?._raw?.xhrTap?.visitMap || {};
      const mapped    = visitid ? visitMap[visitid] : null;
      if (mapped?.patientvisituid) return mapped.patientvisituid;

      const sd = await getAngularScopeUIDs(visitid);
      if (sd.patientvisituid) return sd.patientvisituid;

      const pc = ctx.data?.patientCtx || {};
      if (pc.patientvisituid) return pc.patientvisituid;
    }
    return null;
  }

  async function fetchMedReconcileUid(patientvisituid) {
    const ctx = await _extractAngularCtx();
    const map = ctx?.data?._raw?.medreconMap || {};
    return map[patientvisituid] || null;
  }

  // The Med Reconcile page's medication list actually loads via
  // emr/medicationhistory/getdetails, fired automatically as soon as the page
  // renders — before any button on it can be clicked. arcus-xhr-tap.js caches
  // that response verbatim (there's no standalone reconcile ID in the request
  // to "steal" — just patientuid + a date range), so read it back here
  // instead of trying to trigger/await a fresh call.
  async function fetchMedHistorySnapshot(patientvisituid) {
    const ctx = await _extractAngularCtx();
    const map = ctx?.data?._raw?.medhistoryMap || {};
    return map[patientvisituid] || null;
  }

  // Phase 1 (triggered by the ▶ Run button): navigate EMR → Med Reconcile,
  // then save the job and stop — the pharmacist reviews the list and clicks
  // the injected "Continue" button (phase 2) when ready.
  async function launchMedReconcileStep5(visitid, hn, setStatus) {
    const L = s => console.log(`[BKN-HMR MedRecon] ${s}`);

    // Resolve patientvisituid NOW, while still on Ward View — visitMap /
    // Angular-scope scanning both depend on the "Visit Details" panel DOM
    // that only exists here. Trying to re-resolve it later on the EMR pages
    // (different route, different DOM) is what was failing with "Could not
    // resolve patientvisituid for this visit" — so carry it through the job
    // instead of re-deriving it after navigating away.
    setStatus('Med Reconcile: resolving patient visit…');
    const patientvisituid = await resolvePatientVisitUid(visitid);
    L(`patientvisituid resolved up front: ${patientvisituid}`);
    if (!patientvisituid) return { ok: false, reason: 'Could not resolve patientvisituid for this visit — try re-opening the patient in Ward View' };

    setStatus('Med Reconcile: opening EMR…');
    const viewEmrBtn = document.getElementById('opdvisitviewemrlanding');
    L(`viewEmrBtn found: ${!!viewEmrBtn}`);
    if (!viewEmrBtn) return { ok: false, reason: 'View EMR button not found — select the patient in Ward View first' };
    if (viewEmrBtn.disabled) return { ok: false, reason: 'View EMR button is disabled for this patient' };
    viewEmrBtn.click();
    await dismissAlerts();

    const onLanding = await _hmrWaitForUrl('/emr/emrview/emr/ipdlanding');
    L(`reached ipdlanding: ${onLanding}`);
    if (!onLanding) return { ok: false, reason: 'Timed out waiting for the EMR landing page' };
    await sleep(700);

    setStatus('Med Reconcile: opening Med Reconcile menu…');
    const medReconBtn = await _hmrWaitForEl(() =>
      document.querySelector('button[aria-label="Med Reconcile"]') || document.getElementById('emrsidemenus6')
    );
    L(`medReconBtn found: ${!!medReconBtn}`);
    if (!medReconBtn) return { ok: false, reason: 'Med Reconcile menu button not found' };
    medReconBtn.click();
    await dismissAlerts();

    const onMedRecon = await _hmrWaitForUrl('/emr/emrview/emr/medreconcile');
    L(`reached medreconcile: ${onMedRecon}`);
    if (!onMedRecon) return { ok: false, reason: 'Timed out waiting for the Med Reconcile page' };

    _medreconNoJob = false;
    await saveMedReconJob({ visitid, hn, patientvisituid });
    setStatus('Med Reconcile: review the list, then click Continue on this page.');
    return { ok: true, waiting: true };
  }

  // Force ordermanagement/medreconcile/getdetail to fire by clicking the
  // most recent reconciliation record's "View" button (viewMedReconcile0 —
  // the list is newest-first, so index 0 is the current admission's record).
  // Unlike medicationhistory/getdetails (auto-fired, no id in the request),
  // this call only carries {"medreconcileuid": "..."} in its OWN request
  // body if something actually triggers it — the MAIN-world tap
  // (arcus-xhr-tap.js/background.js) can only grab it once this click
  // happens. Best-effort: if the button is missing or disabled (no
  // reconciliation record has been prepared for this admission yet), this
  // just no-ops and the caller falls back to the medicationhistory snapshot.
  async function _clickFirstMedReconcileViewButton() {
    const btn = document.getElementById('viewMedReconcile0');
    if (!btn || btn.disabled) return false;
    btn.click();
    await dismissAlerts();
    return true;
  }

  // Phase 2 (▶ Continue button injected on the Med Reconcile page): click the
  // current reconciliation record's View button to capture medreconcileuid,
  // fall back to the medicationhistory/getdetails snapshot arcus-xhr-tap.js
  // already cached when the page loaded, persist whichever was captured +
  // mark the step done, then return to Ward View.
  async function _continueMedReconcile(job) {
    const L = s => console.log(`[BKN-HMR MedRecon] ${s}`);
    const btn = document.getElementById('hmr-medrecon-continue-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Working…'; }

    const fail = (reason) => {
      L(`failed: ${reason}`);
      alert(`[HM Process] Med Reconcile: ${reason}`);
      if (btn) { btn.disabled = false; btn.textContent = '▶ Continue'; }
    };

    // Resolved up front in launchMedReconcileStep5 while still on Ward View
    // (see that function's comment) — re-resolving it here on the EMR page
    // is what used to fail with "Could not resolve patientvisituid".
    const patientvisituid = job.patientvisituid || await resolvePatientVisitUid(job.visitid);
    L(`patientvisituid: ${patientvisituid}`);
    if (!patientvisituid) return fail('Could not resolve patientvisituid for this visit — re-run this step from Ward View');

    const clickedView = await _clickFirstMedReconcileViewButton();
    L(`viewMedReconcile0 clicked: ${clickedView}`);
    let mu = clickedView ? null : await fetchMedReconcileUid(patientvisituid);
    for (let i = 0; clickedView && i < 6 && !mu; i++) { await sleep(400); mu = await fetchMedReconcileUid(patientvisituid); }
    L(`medreconcileuid captured: ${mu || '(none)'}`);

    // The list's own getdetails call already fired when the page rendered,
    // so this should already be cached — poll briefly in case it's still in
    // flight (slow network, or the page just finished navigating). Kept as a
    // fallback source only — the server prefers medreconcileuid when both
    // are present (see _resolve_reconcile_meds in bkn_ks_server.py).
    let snapshot = await fetchMedHistorySnapshot(patientvisituid);
    for (let i = 0; i < 8 && !snapshot; i++) { await sleep(500); snapshot = await fetchMedHistorySnapshot(patientvisituid); }
    L(`medhistory snapshot captured: ${!!snapshot}`);

    if (!mu && !snapshot) return fail('Reconciliation data was not captured — reload this Med Reconcile page and try again');

    // Read-merge-write: don't clobber other steps that may already be saved.
    const doc   = (await serverLoad(job.visitid)) || {};
    const steps = { ...(doc.steps || {}), medReconcile: 'done' };
    const patch = { steps };
    if (snapshot) patch.medreconcileSnapshot = snapshot;
    if (mu)       patch.medreconcileuid      = mu;
    const captured = [mu && 'medreconcileuid', snapshot && 'reconciliation snapshot'].filter(Boolean).join(' + ');
    await serverSave(job.visitid, patch, makeLog(`Med Reconcile: captured ${captured}`));

    // ALSO write to the per-visit capture bag. The HMR record is keyed by
    // visitid, but the Home Med Sheet looks the reconciliation up by
    // patientuid+patientvisituid — so a uid saved only on the HMR record left
    // the sheet's Med Reconciliation panel empty even though Step 5 had run.
    // Best-effort and merge-only, so it can never blank another PC's capture.
    try {
      const puid = window.__arcus_pctx__?.patientuid || '';
      if (puid && patientvisituid && window.BKNData?.saveCapture) {
        const bag = {};
        if (mu)       bag.medreconcileuid      = mu;
        if (snapshot) bag.medreconcileSnapshot = snapshot;
        if (Object.keys(bag).length) {
          await window.BKNData.saveCapture(puid, patientvisituid, bag);
        }
      }
    } catch (_) { /* the HMR record above is still the source of truth */ }

    await clearMedReconJob();
    document.getElementById('hmr-medrecon-continue-btn')?.remove();
    await navigateToWardViewAndSearchHN(job.hn || job.visitid);
  }

  // ── Med Reconcile page: inject the "Continue" button next to eConsent ──

  let _medreconObsScheduled = false;
  let _medreconNoJob        = false;

  function _findEconsentAnchor() {
    return document.querySelector('span[aria-label="eConsent"]');
  }

  async function handleMedReconOnPage() {
    if (_medreconObsScheduled || _medreconNoJob) return;
    _medreconObsScheduled = true;

    const job = await getMedReconJob();
    if (!job) { _medreconNoJob = true; _medreconObsScheduled = false; return; }
    if (document.getElementById('hmr-medrecon-continue-btn')) { _medreconObsScheduled = false; return; }

    const anchor = _findEconsentAnchor();
    if (!anchor) { _medreconObsScheduled = false; return; }   // try again on next mutation tick

    const btn = document.createElement('button');
    btn.id = 'hmr-medrecon-continue-btn';
    btn.type = 'button';
    btn.className = 'hmr-medrecon-continue-btn';
    btn.textContent = '▶ Continue';
    btn.title = 'Open the reconciliation record and capture it for the HM Process';
    btn.addEventListener('click', () => _continueMedReconcile(job));
    anchor.after(btn);
    _medreconObsScheduled = false;
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

    // 1. Find patient search wrapper (id like "defaultPatWidId8MgsWrapper") —
    // NOT the order-item wrapper ("orderItemWidget4MgsWrapper"), which shares
    // the same "Search MRN or Name" placeholder text.
    const wrapper = Array.from(document.querySelectorAll('.mgs-wrapper')).find(
      w => /PatWid/i.test(w.id) && w.textContent.includes('Search MRN or Name')
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
      await dismissAlerts();
      await sleep(500);
    }

    // 3. Click the "MRN" chip (class sugsear-title, different widget ID than wrapper).
    const mrnChip = Array.from(document.querySelectorAll('span.sugsear-title'))
                      .find(el => el.textContent.trim() === 'MRN');
    L(`MRN chip: ${mrnChip ? '#' + mrnChip.id : 'NOT FOUND'}`);
    if (!mrnChip) return false;
    mrnChip.click();
    await dismissAlerts();

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
    await dismissAlerts();
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
    if (row) { row.click(); await dismissAlerts(); }

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

  // ── Passive Alerts auto-dismiss ──────────────────────────────────────────
  // ArcusAir pops its "Alerts" dialog (billing/general alerts) on many DOM
  // changes and page navigations, blocking the pharmacist. This closes ONLY the
  // Alerts dialog the moment it appears — the safe way: click its own close
  // button (#closeBtn / toolbar ✕), then fall back to Escape. It deliberately
  // does NOT touch the Override / reason dialogs (those are intentional), and
  // stands down while the HM Process automation is running (that sequence closes
  // alerts itself). It never clicks "#hideAllAlerts" — we only dismiss the
  // current popup, we don't permanently suppress future alerts.
  //
  // Fires synchronously the instant the modal is detected (in the same tick),
  // driven by BOTH the debounced MutationObserver and a light 150ms poll, so it
  // closes immediately even when the alert renders in stages or appears during
  // a mutation burst.
  // Stricter than _hmrIsAlertDialog: require the alert-modal's own controls so a
  // passive auto-close never touches an unrelated md-dialog that merely contains
  // the word "alerts".
  function _hmrIsAlertModal(d) {
    if (!d || _hmrIsOverrideDialog(d)) return false;
    return !!(d.querySelector('#closeBtn') || d.querySelector('#hideAllAlerts'));
  }
  // Fire the alert modal's close button IMMEDIATELY — no scrollIntoView/smooth
  // animation and no pre-click sleep (that's what made _hmrClick lag ~250ms+).
  // The modal is already on-screen; a plain synthetic click closes it at once.
  function _hmrFireClose(el) {
    if (!el) return;
    for (const t of ['mousedown', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    }
    if (typeof el.click === 'function') el.click();
  }
  function _hmrDispatchEscape() {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  }
  function _hmrAutoDismissAlertsOnce() {
    // Never touch dialogs while HM Process automation runs (it handles alerts).
    if (_hmrAutoRunning) return;
    const d = _hmrFindDialog();
    if (!_hmrIsAlertModal(d)) return;
    // Close synchronously so the modal is gone in the same tick it's detected —
    // no async gap where a mutation burst could delay a follow-up attempt.
    const close = _hmrQueryFirst(
      ['#closeBtn', "button[aria-label='Close']",
       'md-dialog md-toolbar button', 'md-dialog .md-icon-button'], d);
    if (close) _hmrFireClose(close);
    // Belt-and-suspenders: Escape also closes AngularMaterial dialogs.
    _hmrDispatchEscape();
  }

  // Short polling fallback (in addition to the MutationObserver): the alert can
  // render in stages (container first, #closeBtn a moment later) or appear
  // mid-mutation-burst, where the debounced observer tick lags. A light 150ms
  // poll guarantees the modal is caught promptly regardless of mutation timing.
  // Cheap: _hmrFindDialog is a few querySelectors and returns null instantly
  // when no dialog is present.
  setInterval(() => {
    try { _hmrAutoDismissAlertsOnce(); } catch (_) { /* best-effort */ }
  }, 150);
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
        <button class="hmrs7-min" id="hmrs7-min-btn" title="Minimize">−</button>
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
          <button class="hmrs7-fin-btn" id="hmrs7-done-all" style="opacity:1">→ Discharge List</button>
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

    document.getElementById('hmrs7-min-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      const el     = document.getElementById('hmr-step7-overlay');
      const minBtn = document.getElementById('hmrs7-min-btn');
      if (!el || !minBtn) return;
      const minimized = el.classList.toggle('hmrs7-minimized');
      minBtn.textContent = minimized ? '+' : '−';
      minBtn.title       = minimized ? 'Expand' : 'Minimize';
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
      // Read the CURRENT record first and merge, rather than sending a bare
      // {steps:{allocateDispensed:'done'}}. Step 7 runs on a different page
      // from the Ward View card, so the in-memory _state here is stale — and a
      // partial patch used to wipe the other steps outright (a completed Med
      // Reconcile reverted to pending). The server also deep-merges `steps`
      // now; this keeps the client correct on its own.
      let mergedSteps = { allocateDispensed: 'done' };
      try {
        const fresh = await serverLoad(job.visitid);
        if (fresh?.steps) mergedSteps = { ...fresh.steps, allocateDispensed: 'done' };
      } catch (_) { /* fall back to the single-key patch */ }
      await serverSave(job.visitid, {
        steps: mergedSteps,
      }, makeLog('step 7: allocate/dispense completed'));
      await clearStep7Job();
      document.getElementById('hmr-step7-overlay')?.remove();
      await navigateToWardViewAndSearchHN(job.hn || job.visitid);
    });
  }

  // ── Step 7 entry point (called from ward-view workstation) ───────────

  /* Persist the ArcusAir session ids onto the per-visit capture bag.

     Step 7 runs while the pharmacist is deep in ArcusAir, so every session uid
     is on the wire and resolvable here. Saving them means the 🖨 Sheet button
     works later from Ward View — even after a reload, or from another
     workstation — instead of depending on whatever this tab happens to have
     tapped. The server merges non-empty fields only, so a partial capture can
     never blank out one another PC already stored. */
  async function saveSessionCapture(visitid, state) {
    try {
      const ctx = await buildHomeMedContext(visitid, state);
      if (!ctx || !ctx.patientuid || !ctx.patientvisituid) return false;
      if (!window.BKNData || !window.BKNData.saveCapture) return false;
      const payload = {};
      for (const k of ['incusToken', 'loginuid', 'roleuid',
                       'organisationuid', 'parentorguid', 'departmentuid']) {
        if (ctx[k]) payload[k] = ctx[k];
      }
      if (!payload.loginuid) return false;     // nothing worth storing yet
      return await window.BKNData.saveCapture(ctx.patientuid, ctx.patientvisituid, payload);
    } catch (_) { return false; }
  }

  async function launchStep7(visitid, hn) {
    console.log(`[BKN-HMR S7] launchStep7 visitid=${visitid} hn=${hn}`);
    _step7NoJob = false;
    // Capture the session BEFORE navigating away — this is the moment the uids
    // are guaranteed resolvable, and it is what makes 🖨 Sheet usable later.
    await saveSessionCapture(visitid, _state);
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
        medReconcile:      'pending',
        continueOrdersOff: 'pending',   // auto (API flag) — shown in the auto checklist
        allocateDispensed: 'pending',
        // Retired as a visible step (the Home Med Sheet prints from within
        // Allocate / Dispense). Kept in the shape so records saved by an older
        // build still load without losing a key.
        reportsPrinted:    'pending',
      },
      medreconcileuid: null,
      medreconcileSnapshot: null,
      lastModifiedBy: detectUsername(),
      lastModifiedAt: new Date().toISOString(),
      auditLog:    [],
      completedAt: null,
    };
  }

  // ── Render ───────────────────────────────────────────────────────────

  // 'medReturned' is auto-detected from the discharge process API
  // (pharmacyreturnscompleted) — see applyDischargeInfo() — so it's no
  // longer a manual YES/NO check here.
  const CHECKS = [
    { key: 'hasAtb',              th: 'มี ATB ก่อน D/C?',              en: 'ATB before discharge?' },
    { key: 'controlledRemaining', th: 'จัดการยาเสพติดค้างจ่าย',        en: 'Controlled drugs completed?', singleComplete: true },
  ];

  /* MANUAL checklist — the two semi-automated steps the pharmacist drives.
     "Print reports" was removed: the Home Medication Sheet is printed from
     within Allocate / Dispense, so a separate step was a second place to
     forget. Off-continue-orders moved to the AUTO checklist (it is an API
     flag, never something the pharmacist clicks). */
  const STEPS = [
    { key: 'medReconcile',      num: 1, label: 'Med Reconcile',
      hint: 'ตรวจสอบรายการยาเดิม · capture reconcile token', runnable: true },
    { key: 'allocateDispensed', num: 2, label: 'Allocate / Dispense',
      hint: 'จัดยา + พิมพ์ Home Medication Sheet', runnable: true, print: true },
  ];

  /* AUTO checklist — every row is a boolean straight off the discharge APIs.
     Nothing here is clickable by design; if a row is not ticked the ward has
     not done that task yet. */
  const AUTO_ROWS = [
    { key: 'dischargeStage',   th: 'สถานะจำหน่าย',        en: 'Discharge stage',   stage: true },
    { key: 'medReturned',      th: 'คืนยาเรียบร้อย',       en: 'Pharmacy return',   api: 'pharmacyreturnscompleted' },
    { key: 'homemedordered',   th: 'สั่งยากลับบ้าน',        en: 'Discharge order',   api: 'homemedordered' },
    { key: 'standingOrdersOff', th: 'หยุดยาต่อเนื่อง',      en: 'Off standing order', api: 'continuousordersprocessed' },
  ];

  /* Progress bar: the ward's own four discharge stages. */
  const STAGE_LABELS = [
    { n: 1, en: 'Discharge Advice',   th: 'แนะนำจำหน่าย' },
    { n: 2, en: 'Discharge Order',    th: 'สั่งจำหน่าย' },
    { n: 3, en: 'Medical Discharge',  th: 'จำหน่ายทางการแพทย์' },
    { n: 4, en: 'Final Discharge',    th: 'จำหน่ายสมบูรณ์' },
  ];

  function renderWS(state) {
    const { checklist, steps, visitid, hn, lastModifiedBy } = state;
    const allChecked = CHECKS.every(c => checklist[c.key] !== null) && checklist.medReturned !== null;
    const dc  = checklist.dischargeStatus;
    const hmo = checklist.homemedordered;
    const mr  = checklist.medReturned;

    // ── SECTION 1: discharge progression ──────────────────────────────
    // The ward's four stages as a progress bar. The CURRENT stage is the first
    // one not yet reached — that is the step still outstanding, so it is the
    // one called out by name rather than the last completed one.
    const stage   = Number(checklist.dischargeStage) || 0;
    const nextIdx = STAGE_LABELS.findIndex(s => s.n > stage);
    const nextSt  = nextIdx === -1 ? null : STAGE_LABELS[nextIdx];
    const pct     = Math.max(0, Math.min(100, (stage / STAGE_LABELS.length) * 100));

    const segHtml = STAGE_LABELS.map(s => {
      const cls = s.n <= stage ? 'is-done' : (nextSt && s.n === nextSt.n ? 'is-current' : 'is-todo');
      return `<div class="hmr-pg-seg ${cls}" title="${s.en}">
        <span class="hmr-pg-dot">${s.n <= stage ? '✓' : s.n}</span>
        <span class="hmr-pg-lbl">${s.th}</span>
      </div>`;
    }).join('');

    const pgCaption = !dc || dc === 'Not ready'
      ? `<span class="hmr-pg-warn">ยังไม่เริ่มกระบวนการจำหน่าย · not started</span>`
      : nextSt
        ? `<span class="hmr-pg-next">กำลังรอ · waiting for <b>${nextSt.en}</b></span>`
        : `<span class="hmr-pg-ok">จำหน่ายสมบูรณ์ · fully discharged ✓</span>`;

    const progressHtml = `<div class="hmr-sec hmr-sec-progress">
      <div class="hmr-sec-hd"><span class="hmr-sec-t">1 · ความคืบหน้าการจำหน่าย</span>
        <span class="hmr-sec-en">Discharge progress</span></div>
      <div class="hmr-pg-track"><div class="hmr-pg-fill" style="width:${pct}%"></div></div>
      <div class="hmr-pg-segs">${segHtml}</div>
      <div class="hmr-pg-cap">${pgCaption}</div>
    </div>`;

    // ── SECTION 2: automatic checklist (API-driven, read-only) ────────
    const autoHtml = AUTO_ROWS.map(r => {
      let v, detail;
      if (r.stage) {
        v = dc && dc !== 'Not ready' ? true : (dc === 'Not ready' ? false : null);
        detail = dc || 'not detected';
      } else {
        v = checklist[r.key];
        detail = r.api;
      }
      const cls = v === true ? 'is-ok' : v === false ? 'is-no' : 'is-unk';
      const mark = v === true ? '✓' : v === false ? '✗' : '—';
      return `<div class="hmr-auto-row ${cls}">
        <span class="hmr-auto-mark">${mark}</span>
        <span class="hmr-auto-text">
          <span class="hmr-auto-th">${r.th}</span>
          <span class="hmr-auto-en">${r.en}</span>
        </span>
        <span class="hmr-auto-api">${detail}</span>
      </div>`;
    }).join('');

    const autoSection = `<div class="hmr-sec hmr-sec-auto">
      <div class="hmr-sec-hd"><span class="hmr-sec-t">2 · ตรวจสอบอัตโนมัติ</span>
        <span class="hmr-sec-en">Auto checklist · from ArcusAir</span>
        <span class="hmr-sec-tag">AUTO</span></div>
      ${autoHtml}
    </div>`;

    const checkHtml = CHECKS.map(c => {
      const v = checklist[c.key];
      // Row highlight mirrors the Process Steps: an answered/completed check
      // gets the same green "done" treatment so the pharmacist can see at a
      // glance which rows are resolved. A YES/NO check counts as done when
      // affirmatively YES; answering NO marks it resolved but not "done-green".
      const rowCls = v === true
        ? 'hmr-check-done'
        : (v === false ? 'hmr-check-answered' : 'hmr-check-pend');
      const actionHtml = c.singleComplete
        ? `<button class="hmr-yn hmr-yn-yes ${v === true ? 'hmr-yn-on' : ''}" data-ck="${c.key}" data-v="true">${v === true ? '✓ Completed' : 'Completed'}</button>`
        : `<button class="hmr-yn hmr-yn-yes ${v === true  ? 'hmr-yn-on' : ''}" data-ck="${c.key}" data-v="true">YES</button>
           <button class="hmr-yn hmr-yn-no  ${v === false ? 'hmr-yn-on' : ''}" data-ck="${c.key}" data-v="false">NO</button>`;
      return `<div class="hmr-check-row ${rowCls}">
        <div class="hmr-check-text">
          <div class="hmr-ck-th">${c.th}</div>
          <div class="hmr-ck-en">${c.en}</div>
        </div>
        <div class="hmr-yn-pair">
          ${actionHtml}
        </div>
      </div>`;
    }).join('');

    // ── SECTION 3: manual checklist (the two steps the pharmacist drives) ──
    const stepHtml = STEPS.map(s => {
      const st  = steps[s.key];
      const cls = st === 'done' ? 'hmr-step-done' : st === 'skip' ? 'hmr-step-skip' : 'hmr-step-pend';
      const ic  = st === 'done' ? '✓' : st === 'skip' ? '—' : s.num;
      const actionTag = st === 'done'
        ? `<button class="hmr-step-override-btn" data-step="${s.key}" title="Mark as pending">↺</button>`
        : `<button class="hmr-step-run-btn" data-step="${s.key}">▶ Run</button>`;
      // Allocate / Dispense also prints the Home Medication Sheet, so the
      // print action lives on that row instead of a separate step.
      // 🖨 Sheet needs the ArcusAir session (token + loginuid). That is captured
      // when Allocate / Dispense runs, so the button stays DISABLED until this
      // step is done — clicking it before then could only produce a sheet that
      // hangs waiting on ArcusAir.
      const sheetReady = st === 'done';
      const printBtn = s.print
        ? `<button class="hmr-step-print-btn${sheetReady ? '' : ' is-locked'}"
             data-step="${s.key}"${sheetReady ? '' : ' disabled'}
             title="${sheetReady
               ? 'Print the Home Medication Sheet'
               : 'ต้องทำ Allocate / Dispense ก่อน · run Allocate / Dispense first'}">🖨 Sheet</button>`
        : '';
      return `<div class="hmr-step-row ${cls}">
        <span class="hmr-step-num">${ic}</span>
        <span class="hmr-step-name">${s.label}
          ${s.hint ? `<span class="hmr-step-hint">${s.hint}</span>` : ''}</span>
        ${printBtn}${actionTag}
      </div>`;
    }).join('');

    const chipLabel = visitid + (hn ? ` · HN ${hn}` : '');
    const modInfo   = lastModifiedBy && lastModifiedBy !== 'Unknown'
      ? `Last saved by ${lastModifiedBy}` : '';

    return `<div class="hmr-card">
      <div class="hmr-hdr">
        <button class="hmr-queue-btn" id="hmr-queue-btn" title="Add this patient to the HM Process Queue">➕</button>
        <span class="hmr-title">💊 HM Process</span>
        <span class="hmr-room-chip" title="${chipLabel}">${chipLabel}</span>
        <button class="hmr-btn-start" id="hmr-btn-start" ${allChecked ? '' : 'disabled'}>▶ Start Process</button>
        <button class="hmr-x-btn" id="hmr-x-btn">✕</button>
      </div>
      <div class="hmr-body">

        <div class="hmr-statusbar" id="hmr-statusbar">
          ${allChecked ? '✓ Ready — click Start Process' : 'Complete all manual checks above'}
          ${modInfo ? `<span class="hmr-mod-info"> · ${modInfo}</span>` : ''}
        </div>

        ${progressHtml}

        ${autoSection}
        <div class="hmr-detect-row">
          <button class="hmr-detect-btn" id="hmr-detect-btn">↻ Detect</button>
        </div>

        <div class="hmr-sec hmr-sec-manual">
          <div class="hmr-sec-hd"><span class="hmr-sec-t">3 · ขั้นตอนที่ต้องทำ</span>
            <span class="hmr-sec-en">Manual checklist</span></div>
          <div class="hmr-checklist">${checkHtml}</div>
          <div class="hmr-steps">${stepHtml}</div>
        </div>

        <div class="hmr-actions">
          <button class="hmr-btn-reset" id="hmr-btn-reset">Reset</button>
          <button class="hmr-btn-complete" id="hmr-btn-complete" title="Mark this patient's HM Process Queue entry as Completed">✓ Complete</button>
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

  // The card is open-by-default (see syncUI's auto-open). This flag records a
  // MANUAL close so auto-open doesn't immediately reopen it; it's reset when the
  // pharmacist switches to a different room/visit.
  let _userClosed = false;
  let _autoOpening = false;

  async function onTriggerClick() {
    if (document.getElementById('hmr-workstation')) {
      document.getElementById('hmr-workstation').remove();
      setTriggerOpen(false);
      _userClosed = true;   // respect the manual close until the visit changes
      if (_currentVisitId) await serverSave(_currentVisitId, {}, makeLog('closed workstation'));
      return;
    }
    _userClosed = false;
    await openWorkstation();
  }

  // Open (or re-open) the workstation for the current visit. Shared by the
  // trigger click and the auto-open path.
  async function openWorkstation() {
    if (document.getElementById('hmr-workstation')) return;
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
    await maybeAutoAddToQueue(visitid, state, di);
  }

  // Auto-open the workstation once the trigger is in place (open-by-default),
  // unless the pharmacist manually closed it for this visit. Guarded so the
  // MutationObserver can't fire concurrent opens.
  async function autoOpenWorkstation() {
    if (_userClosed || _autoOpening) return;
    if (document.getElementById('hmr-workstation')) return;
    if (!detectVisitId()) return;   // wait until the visit is resolvable
    _autoOpening = true;
    try { await openWorkstation(); }
    finally { _autoOpening = false; }
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

    document.getElementById('hmr-queue-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('hmr-queue-btn');
      if (!window.BKN_HMQ) { alert('[HM Process Queue] Not loaded yet — reload the page and try again.'); return; }
      const hn = await resolveHN(visitid, state);
      if (!hn) { alert('[HM Process Queue] HN not detected.'); return; }
      const name = detectPatientNameForQueue() || hn;
      const { ward, room } = detectWardBed();
      if (btn) btn.disabled = true;
      const result = await window.BKN_HMQ.addCase({ hn, name, ward, room });
      if (btn) btn.disabled = false;
      if (!result.ok) { alert(`[HM Process Queue] ${result.reason}`); return; }
      await serverSave(visitid, {}, makeLog(`Added to HM Process Queue (Q${result.entry.queueNum})`));
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
        `Open Orders: ${di.openordersprocessed === true ? 'YES' : di.openordersprocessed === false ? 'NO' : '—'}, ` +
        `Meds Returned: ${di.pharmacyreturnscompleted === true ? 'YES' : di.pharmacyreturnscompleted === false ? 'NO' : '—'}`
      );
      await serverSave(visitid, { checklist: _state.checklist, steps: _state.steps }, log);
      await maybeAutoAddToQueue(visitid, _state, di);
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

    // 🖨 Sheet — open the Home Medication Sheet for THIS patient directly from
    // Ward View. Sends the same LOAD_MED_TABLE message content-home-med.js
    // sends, so background.js's openOrReuseTab handles it: the payload is
    // written to chrome.storage.session BEFORE the tab opens, and an already
    // open sheet is reused rather than duplicated. Opening the page URL raw
    // would give a sheet with no patient context.
    document.querySelector('.hmr-step-print-btn')?.addEventListener('click', async () => {
      const btn = document.querySelector('.hmr-step-print-btn');
      if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
      try {
        const context = await buildHomeMedContext(visitid, state);
        if (!context) {
          alert('[HM Process] ไม่พบข้อมูลผู้ป่วย (patientuid / visit / token)\n\n'
              + 'Could not resolve this patient on ArcusAir — open the patient once, then retry.');
          return;
        }
        // Without loginuid the server sends ArcusAir a blank useruid header and
        // getallorderitem never answers — the sheet would hang on "loading".
        // The button is already disabled until Allocate / Dispense has run, so
        // this is the belt-and-braces case: the step is done but the stored
        // session has since aged out (the server drops the token after 24h).
        if (!context.loginuid) {
          alert('[HM Process] ยังไม่พบ session ของผู้ใช้ (loginuid)\n\n'
              + 'กรุณากด ▶ Run ที่ขั้นตอน Allocate / Dispense อีกครั้ง\n'
              + 'ArcusAir session not available — run Allocate / Dispense again, '
              + 'then press 🖨 Sheet.');
          return;
        }
        await serverSave(visitid, {}, makeLog('Home Medication Sheet opened'));
        chrome.runtime.sendMessage({ type: 'LOAD_MED_TABLE', context });
      } finally {
        // Restore the button's own enabled state, not an unconditional true —
        // the row re-renders with .is-locked when Allocate / Dispense is not
        // done, and forcing disabled=false here would defeat that lock.
        if (btn) {
          btn.textContent = '🖨 Sheet';
          btn.disabled = btn.classList.contains('is-locked');
        }
      }
    });

    document.getElementById('hmr-btn-reset')?.addEventListener('click', async () => {
      const fresh = newState(visitid, _currentHN);
      _state = fresh;
      rerender(visitid, fresh);
      await serverSave(visitid, { ...fresh, auditLog: [] }, makeLog('workstation reset'));
    });

    document.getElementById('hmr-btn-complete')?.addEventListener('click', async () => {
      const btn = document.getElementById('hmr-btn-complete');
      if (!window.BKN_HMQ) { alert('[HM Process Queue] Not loaded yet — reload the page and try again.'); return; }
      const hn = await resolveHN(visitid, state);
      if (!hn) { alert('[HM Process Queue] HN not detected.'); return; }
      if (btn) btn.disabled = true;
      const result = await window.BKN_HMQ.completeActiveByHn(hn);
      if (btn) btn.disabled = false;
      if (!result.ok) { alert(`[HM Process Queue] ${result.reason}`); return; }
      await serverSave(visitid, {}, makeLog(`HM Process Queue: Q${result.entry.queueNum} marked Completed`));
    });

    // Step 5 ▶ Run button — Med Reconcile: navigates to the Med Reconcile
    // page and stops there; the pharmacist reviews the list and clicks the
    // injected "Continue" button, which finishes the capture and marks this
    // step done (see _continueMedReconcile / handleMedReconOnPage).
    document.querySelector('.hmr-step-run-btn[data-step="medReconcile"]')
      ?.addEventListener('click', async () => {
        const runBtn = document.querySelector('.hmr-step-run-btn[data-step="medReconcile"]');
        if (runBtn) { runBtn.disabled = true; runBtn.textContent = '⏳ Checking…'; }

        // Server first — a fresh load (not the possibly-stale in-memory
        // _state) in case a different workstation already captured this
        // visit's reconciliation data since we opened this card.
        const fresh = await serverLoad(visitid);
        if (fresh?.medreconcileSnapshot || fresh?.medreconcileuid) {
          _state.steps.medReconcile     = 'done';
          _state.medreconcileuid        = fresh.medreconcileuid || null;
          _state.medreconcileSnapshot   = fresh.medreconcileSnapshot || null;
          rerender(visitid, _state);
          await serverSave(visitid, { steps: _state.steps }, makeLog('Med Reconcile: already captured (found on server)'));
          return;
        }

        if (runBtn) runBtn.textContent = '⏳ Running…';
        const hn = await resolveHN(visitid, state);
        const r = await launchMedReconcileStep5(visitid, hn, setLoadingStatus);
        if (!r.ok) {
          alert(`[HMR] Med Reconcile automation failed: ${r.reason}`);
          setLoadingStatus(`Med Reconcile failed: ${r.reason}`);
          if (runBtn) { runBtn.disabled = false; runBtn.textContent = '▶ Run'; }
        }
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
    // ── Passive: close ArcusAir's Alerts popup whenever it shows ──────
    _hmrAutoDismissAlertsOnce();

    // ── Med Reconcile page: inject the pending "Continue" button ──────
    if (isMedReconcilePage()) {
      if (!document.getElementById('hmr-medrecon-continue-btn')) {
        handleMedReconOnPage();
      }
      return;
    }

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
      // Open-by-default: bring the card up automatically unless manually closed.
      autoOpenWorkstation();
      return;
    }
    // Different room/visit selected — reset per-visit state (incl. the manual
    // close flag) so the card auto-opens for the newly-selected patient.
    _lastH4 = h4; _currentVisitId = null; _currentHN = null; _state = null;
    _userClosed = false;
    document.getElementById('hmr-trig-btn')?.remove();
    document.getElementById('hmr-workstation')?.remove();
    injectTriggerBtn(h4);
    autoOpenWorkstation();
  }

  function cleanup() {
    _lastH4 = null; _currentVisitId = null; _currentHN = null; _state = null;
    document.getElementById('hmr-trig-btn')?.remove();
    document.getElementById('hmr-workstation')?.remove();
  }

  // ── Init ─────────────────────────────────────────────────────────────
  // Debounce to one syncUI per animation frame: ArcusAir (AngularJS) mutates the
  // DOM in tight bursts, and syncUI now also runs the passive Alerts dismisser,
  // so coalescing keeps it cheap without delaying alert close by more than a frame.
  let _syncScheduled = false;
  const obs = new MutationObserver(() => {
    if (_syncScheduled) return;
    _syncScheduled = true;
    requestAnimationFrame(() => { _syncScheduled = false; syncUI(); });
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('hashchange', () => { _step7ObsScheduled = false; setTimeout(syncUI, 700); });
  syncUI();

})();
