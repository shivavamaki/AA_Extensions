/* ═══════════════════════════════════════════════════════════════════════════
   background.js — BKN Pharmacy Portal (merged extension)
   MV3 Service Worker

   Combines:
     • rx_menu        — drug delivery bridge, PDF relay, ext fetch proxy, etc.
     • AAOverlay      — feature-page tab router, Jasper XLS fetch, MAIN-world
                        Angular context extraction, XHR tap install
     • Shared layer   — BKN_SERVER_PROXY (pharmacy server fetches with no CORS)
═══════════════════════════════════════════════════════════════════════════ */
'use strict';

const DRUGDELIVERY_URL_PART = '10.134.10.91:8809/drugdelivery/web/ipfill';

/* Allowlist for BKN_SERVER_PROXY and extFetch — prevents SSRF from a
   compromised content script or XSS exploit using the extension as a proxy.
   Only hostnames explicitly listed here are forwarded. */
const _PROXY_ALLOWED_HOSTS = new Set([
  'arcusair.bdms.co.th',
  'aa-report.bdms.co.th',
  // translate.googleapis.com removed — the translation engine is fully offline
  // (patterns + glossary + curated overrides), no external MT calls.
  'localhost',
  '10.134.10.5',
  '10.134.10.91',
  '10.134.110.81',
]);
function _isAllowedProxyUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try { return _PROXY_ALLOWED_HOSTS.has(new URL(url).hostname); } catch (_) { return false; }
}

/* Med-reconcile / capture data is persisted to the PHARMACY SERVER (shared
   cross-workstation, 24h TTL) by src/main-world/capture-persist.js, and read
   back by the Home Med Sheet via BKNData.loadCapture(). Background no longer
   keeps a per-browser store — see HM_REFRESH_RECON_CTX below, which only does
   best-effort LIVE enrichment from an open ArcusAir tab. */

/* ── AAOverlay feature-tab registry ──────────────────────────────────────── */
const MSG = Object.freeze({
  LOAD_MED_TABLE:          'LOAD_MED_TABLE',
  OPEN_STICKER:            'OPEN_STICKER',
  OPEN_PATIENT_STICKER:    'OPEN_PATIENT_STICKER',
  OPEN_MED_RECONCILE:      'OPEN_MED_RECONCILE',
  OPEN_ALLERGY_CARD:       'OPEN_ALLERGY_CARD',
  OPEN_MEDICATION_JOURNEY: 'OPEN_MEDICATION_JOURNEY',
  OPEN_MED_JOURNEY:        'OPEN_MED_JOURNEY',
});

const tabRegistry = {
  aa_sheet:             null,
  aa_sticker:           null,
  aa_patientSticker:    null,
  aa_medReconcile:      null,
  aa_allergyCard:       null,
  aa_medicationJourney: null,
  aa_medJourney:        null,
};

const ROUTE_MAP = {
  [MSG.LOAD_MED_TABLE]:          { key: 'aa_sheet',             url: 'src/features/home-med/page-home-med.html' },
  [MSG.OPEN_STICKER]:            { key: 'aa_sticker',            url: 'src/features/med-sticker/page-med-sticker.html' },
  [MSG.OPEN_PATIENT_STICKER]:    { key: 'aa_patientSticker',     url: 'src/features/patient-sticker/page-patient-sticker.html' },
  [MSG.OPEN_MED_RECONCILE]:      { key: 'aa_medReconcile',       url: 'src/features/patient-sticker/page-med-reconcile.html' },
  [MSG.OPEN_ALLERGY_CARD]:       { key: 'aa_allergyCard',        url: 'src/features/patient-sticker/page-allergy-card.html' },
  [MSG.OPEN_MEDICATION_JOURNEY]: { key: 'aa_medicationJourney',  url: 'src/features/adrtimeline/page-adrtimeline.html' },
  [MSG.OPEN_MED_JOURNEY]:        { key: 'aa_medJourney',         url: 'src/features/med-journey/page-med-journey.html' },
};

chrome.tabs.onRemoved.addListener(tabId => {
  for (const k of Object.keys(tabRegistry)) {
    if (tabRegistry[k] === tabId) tabRegistry[k] = null;
  }
});

function openOrReuseTab(key, relativeUrl, payload) {
  const fullUrl    = chrome.runtime.getURL(relativeUrl);
  const storageKey = 'payload_' + key.replace(/^aa_/, '');

  function sendPayload(tabId) {
    chrome.tabs.sendMessage(tabId, payload, () => void chrome.runtime.lastError);
  }
  function createNewTab() {
    chrome.tabs.create({ url: fullUrl, active: true }, tab => {
      if (chrome.runtime.lastError || !tab) return;
      tabRegistry[key] = tab.id;
    });
  }

  function openAfterPayloadStored() {
    const currentId = tabRegistry[key];
    if (currentId !== null) {
      chrome.tabs.get(currentId, tab => {
        if (chrome.runtime.lastError || !tab) {
          tabRegistry[key] = null;
          createNewTab();
        } else {
          chrome.tabs.update(currentId, { active: true }, () => sendPayload(currentId));
        }
      });
    } else {
      createNewTab();
    }
  }

  chrome.storage.session.set({ [storageKey]: payload }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[BKN] Could not store feature payload:', chrome.runtime.lastError.message);
    }
    openAfterPayloadStored();
  });
}

/* ── Jasper XLS fetch (AAOverlay) ────────────────────────────────────────── */
function handleFetchXls(msg, sendResponse) {
  const url = msg.url || '';
  if (!url.startsWith('https://aa-report.bdms.co.th/')) {
    sendResponse({ ok: false, error: 'URL not allowed' });
    return;
  }
  const controller = new AbortController();
  let settled = false;
  const finish = (response) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    sendResponse(response);
  };
  const timeout = setTimeout(() => {
    controller.abort();
    finish({ ok: false, error: 'timeout' });
  }, 30000);
  fetch(url, {
    credentials: 'include',
    headers: { Accept: 'application/vnd.ms-excel,*/*' },
    signal: controller.signal,
  })
    .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
    .then(buf => finish({ ok: true, data: Array.from(new Uint8Array(buf)) }))
    .catch(e => finish({ ok: false, error: String(e) }));
}

/* ── MAIN-world Angular context extractor (AAOverlay) ────────────────────── */
function _arcusExtractAngularCtx() {
  var out = { stateParams: {}, userCtx: {}, patientCtx: {}, _raw: {} };
  try {
    var $r = angular.element(document.documentElement).scope().$root; // eslint-disable-line no-undef

    function _safeParams(obj) {
      if (!obj || typeof obj !== 'object') return {};
      var safe = {};
      Object.keys(obj).forEach(function (k) {
        var v = obj[k];
        if (v !== null && v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
          safe[k] = String(v);
        }
      });
      return safe;
    }

    var sp = _safeParams($r.$stateParams && Object.keys($r.$stateParams).length ? $r.$stateParams : null) ||
             _safeParams($r.LastUIStateParams) ||
             _safeParams($r.AutoLoginStateParams) || {};
    var lastP = _safeParams($r.LastUIStateParams);
    var autoP = _safeParams($r.AutoLoginStateParams);
    Object.keys(lastP).forEach(function (k) { if (!sp[k]) sp[k] = lastP[k]; });
    Object.keys(autoP).forEach(function (k) { if (!sp[k]) sp[k] = autoP[k]; });
    out.stateParams = sp;
    out._raw.stateParams         = sp;
    out._raw.LastUIStateParams   = lastP;
    out._raw.AutoLoginStateParams = autoP;

    var uc = $r.UserContext || $r.userContext || {};
    var safeUc = {};
    Object.keys(uc).forEach(function (k) {
      var v = uc[k];
      if (v !== null && v !== undefined && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
        safeUc[k] = v;
      }
    });
    out._raw.UserContext = safeUc;
    out.userCtx = {
      loginuid:           String(uc.UserUID || uc.loginuid || uc.loginUid || uc.LoginUid || uc.UserId || ''),
      roleuid:            String(uc.RoleUID || uc.roleuid || uc.roleUid || uc.RoleUid || uc.RoleId || ''),
      organisationuid:    String(uc.OrgUID  || uc.organisationuid || uc.orgUid || uc.OrgUid || ''),
      parentorguid:       String(uc.ParentOrgUID || uc.parentorguid || uc.parentOrguid || ''),
      logindepartmentuid: String(uc.DepartmentUID || uc.logindepartmentuid || uc.deptUid || uc.DeptUid || ''),
      _pp:                String(uc.pp || uc._pp || ''),
      pharmacistName:     String(uc.UserName || uc.userName || uc.DisplayName || uc.displayName || ''),
    };

    function _pickPatient(o, allowBareUid) {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
      function _str(v) { return (v && typeof v === 'string') ? v : ''; }
      var uid = _str(o.patientuid) || _str(o.patientUid) || _str(o.PatientUID) || _str(o.PatientUid)
             || _str(o.patientid)  || _str(o.PatientID)  || _str(o.patient_id)
             || _str(o.pid)        || _str(o.puid)
             || (allowBareUid ? _str(o.uid) : '');
      var vid = _str(o.patientvisituid) || _str(o.patientVisitUid) || _str(o.PatientVisitUID)
             || _str(o.PatientVisitUid)  || _str(o.visituid)        || _str(o.visitUid);
      if (!uid && !vid) return null;
      return {
        patientuid:      uid, patientvisituid: vid,
        patientId:       String(o.patientId  || o.hn || o.patientid  || o.PatientID  || ''),
        patientVisitId:  String(o.patientVisitId || o.an || o.patientvisitid || o.PatientVisitID || ''),
        patientName:     String(o.patientName || o.name || o.fullName || o.PatientName || ''),
      };
    }

    function _fromScope(sc) {
      if (!sc) return null;
      var r = _pickPatient(sc);
      if (r && r.patientuid) return r;
      var keys = ['patient','patientData','patientInfo','patientContext','PatientContext',
                  'currentPatient','selectedPatient','patientVisit','currentVisit','visit',
                  'patientVisitContext','emrContext','EmrContext','emrData',
                  'vm','ctrl','model','data','scope','viewModel'];
      for (var i = 0; i < keys.length; i++) {
        var sub = sc[keys[i]];
        if (!sub || typeof sub !== 'object') continue;
        r = _pickPatient(sub, true);
        if (r && r.patientuid) return r;
        var nested = ['patient','patientData','patientInfo','patientContext','currentPatient','selectedPatient'];
        for (var ni = 0; ni < nested.length; ni++) {
          r = _pickPatient(sub[nested[ni]], true);
          if (r && r.patientuid) return r;
        }
      }
      r = _pickPatient(sc);
      if (r) return r;
      for (var j = 0; j < keys.length; j++) {
        r = _pickPatient(sc[keys[j]], true);
        if (r) return r;
      }
      return null;
    }

    function _merge(pc, candidate) {
      if (!candidate) return pc;
      if (!pc) return candidate;
      if (candidate.patientuid      && !pc.patientuid)      pc.patientuid      = candidate.patientuid;
      if (candidate.patientvisituid && !pc.patientvisituid) pc.patientvisituid = candidate.patientvisituid;
      if (candidate.patientName     && !pc.patientName)     pc.patientName     = candidate.patientName;
      if (candidate.patientId       && !pc.patientId)       pc.patientId       = candidate.patientId;
      return pc;
    }

    var pc = _fromScope($r);

    if (!pc || !pc.patientuid) {
      var views = document.querySelectorAll('ui-view, [ui-view]');
      for (var vi = 0; vi < views.length && !(pc && pc.patientuid); vi++) {
        try {
          var vsc = angular.element(views[vi]).scope(); // eslint-disable-line no-undef
          pc = _merge(pc, _fromScope(vsc));
          if (!pc || !pc.patientuid) {
            var sc2 = vsc;
            for (var depth = 0; depth < 4 && sc2; depth++) {
              sc2 = sc2.$parent;
              var pCand = _fromScope(sc2);
              if (pCand && pCand.patientuid) { pc = _merge(pc, pCand); break; }
            }
          }
        } catch (_) {}
      }
    }

    if (!pc || !pc.patientuid) {
      var ctrlEls = document.querySelectorAll('[ng-controller]');
      for (var ci = 0; ci < ctrlEls.length && !(pc && pc.patientuid); ci++) {
        var ctrlName = (ctrlEls[ci].getAttribute('ng-controller') || '').toLowerCase();
        if (!/emr|order|patient|visit|drug|med/.test(ctrlName)) continue;
        try { pc = _merge(pc, _fromScope(angular.element(ctrlEls[ci]).scope())); } catch (_) {} // eslint-disable-line no-undef
      }
    }

    if (!pc || !pc.patientuid) {
      try {
        var inj = angular.element(document.documentElement).injector(); // eslint-disable-line no-undef
        var svcs = ['PatientVisitService','PatientService','PatientContextService',
                    'VisitService','CurrentVisitService','EmrService','PatientContext'];
        for (var si = 0; si < svcs.length && !(pc && pc.patientuid); si++) {
          try { pc = _merge(pc, _fromScope(inj.get(svcs[si]))); } catch (_) {}
        }
      } catch (_) {}
    }

    try {
      var xhrCtx = window.__arcus_pctx__ || {};
      if (!pc) pc = { patientuid: '', patientvisituid: '', patientId: '', patientVisitId: '', patientName: '' };
      if (xhrCtx.patientuid      && !pc.patientuid)      pc.patientuid      = xhrCtx.patientuid;
      if (xhrCtx.patientvisituid && !pc.patientvisituid) pc.patientvisituid = xhrCtx.patientvisituid;
      out._raw.xhrTap = xhrCtx;
      // Read live XHR header values directly from window (always current, even after
      // extension reload when early-sec-relay.js may have stopped receiving postMessages).
      out._raw.arcusHdrs = window.__arcus_hdrs__ ? Object.assign({}, window.__arcus_hdrs__) : {};
      out._raw.medreconMap   = window.__arcus_medrecon__   || {};
      out._raw.medhistoryMap = window.__arcus_medhistory__ || {};
      out._raw.opd           = window.__arcus_opd__        || {};   // { orderid }
    } catch (_) {}

    if (pc && (pc.patientuid || pc.patientvisituid)) out.patientCtx = pc;

  } catch (e) { out._error = String(e); }
  return out;
}

/* ── MAIN-world XHR tap installer (AAOverlay) ────────────────────────────── */
function _arcusSetupXhrTap() {
  if (window.__arcus_xhr_tap_installed__) return;
  window.__arcus_xhr_tap_installed__ = true;
  window.__arcus_pctx__ = window.__arcus_pctx__ || {};
  var UID_RE = /[?&]patientuid=([a-f0-9]{24})/i;
  var VID_RE = /[?&]patientvisituid=([a-f0-9]{24})/i;

  /* Session/role UIDs needed to authenticate Jasper reports. These appear in
     dispense-workbench request URLs and/or JSON bodies under varying casings. */
  var SESSION_KEYS = [
    'loginuid', 'roleuid', 'organisationuid', 'parentorguid', 'parentorganisationuid',
    'logindepartmentuid', 'departmentuid', 'careprovideruid'
  ];
  /* alias map: lowercased source key -> canonical key */
  var KEY_ALIASES = {
    loginuid: 'loginuid', loginid: 'loginuid', userid: 'loginuid', uid: 'loginuid',
    roleuid: 'roleuid', roleid: 'roleuid',
    organisationuid: 'organisationuid', orguid: 'organisationuid', organizationuid: 'organisationuid',
    parentorguid: 'parentorguid', parentorganisationuid: 'parentorguid',
    logindepartmentuid: 'logindepartmentuid', deptuid: 'logindepartmentuid',
    departmentuid: 'departmentuid',
    careprovideruid: 'careprovideruid', careproviderid: 'careprovideruid'
  };

  function _store(canonKey, val) {
    if (!val) return;
    val = String(val);
    if (!/^[a-f0-9]{24}$/i.test(val)) return;           // only accept 24-hex ids
    if (!window.__arcus_pctx__[canonKey]) window.__arcus_pctx__[canonKey] = val;
  }

  function _scanUrlSession(url) {
    SESSION_KEYS.forEach(function (k) {
      var re = new RegExp('[?&]' + k + '=([a-f0-9]{24})', 'i');
      var m = re.exec(url);
      if (m && m[1]) _store(k, m[1]);
    });
  }

  function _scanObjSession(obj) {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach(function (k) {
      var canon = KEY_ALIASES[k.toLowerCase()];
      if (canon) _store(canon, obj[k]);
    });
  }

  function _scan(url) {
    if (!url) return;
    var m;
    m = UID_RE.exec(url); if (m && m[1]) window.__arcus_pctx__.patientuid      = m[1];
    m = VID_RE.exec(url); if (m && m[1]) window.__arcus_pctx__.patientvisituid = m[1];
    try { _scanUrlSession(url); } catch (_) {}
  }
  function _scanBody(body) {
    if (!body || typeof body !== 'string') return;
    try {
      var b = JSON.parse(body);
      if (b.patientuid)      window.__arcus_pctx__.patientuid      = String(b.patientuid);
      if (b.patientvisituid) window.__arcus_pctx__.patientvisituid = String(b.patientvisituid);
      if (b.PatientUID && !window.__arcus_pctx__.patientuid)      window.__arcus_pctx__.patientuid      = String(b.PatientUID);
      if (b.PatientVisitUID && !window.__arcus_pctx__.patientvisituid) window.__arcus_pctx__.patientvisituid = String(b.PatientVisitUID);
      _scanObjSession(b);
    } catch (_) {
      /* Not JSON — scan raw text for the 24-hex ids. */
      var m;
      m = UID_RE.exec(body); if (m && m[1]) window.__arcus_pctx__.patientuid      = m[1];
      m = VID_RE.exec(body); if (m && m[1]) window.__arcus_pctx__.patientvisituid = m[1];
      try { _scanUrlSession(body); } catch (_) {}
    }
  }
  /* Capture the per-session auth/header values ArcusAir's own API requires
     (incus-token + appname/utcoffset). These ride as XHR request HEADERS, not
     URL/body, so hook setRequestHeader. Stored in window.__arcus_hdrs__. */
  window.__arcus_hdrs__ = window.__arcus_hdrs__ || {};
  var HDR_KEYS = { 'incus-token': 1, 'appname': 1, 'utcoffset': 1,
                   'hasanonymouspermission': 1 };
  var _origSetHdr = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      var k = String(name || '').toLowerCase();
      if (HDR_KEYS[k] && value != null && value !== '') {
        if (k === 'incus-token') {
          /* Never store the session auth token in window — relay immediately to
             the isolated content script (content-adrtimeline.js) via postMessage,
             which ships it to chrome.storage.session where page scripts cannot read it. */
          window.postMessage({ __bkn_sec__: 1, k: k, v: String(value) }, '*');
        } else {
          window.__arcus_hdrs__[k] = String(value);
        }
      }
    } catch (_) {}
    return _origSetHdr.apply(this, arguments);
  };

  /* Map of patientvisituid → medreconcileuid, captured when the pharmacist
     opens the Med Reconcile screen (the only place the uid appears). Later, on
     the Dispense Workbench in the same SPA tab, the journey can look it up. */
  window.__arcus_medrecon__ = window.__arcus_medrecon__ || {};
  /* The Med Reconcile page's medication list actually loads via
     emr/medicationhistory/getdetails, fired automatically as soon as the page
     starts rendering — before any button on that page can be clicked. Its
     request body carries no standalone reconcile ID (just patientuid + a
     date range), so we cache the RESPONSE verbatim instead of trying to
     replay the query ourselves later. Keyed by patientvisituid. */
  window.__arcus_medhistory__ = window.__arcus_medhistory__ || {};
  var ID24 = /([a-f0-9]{24})/i;

  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      _scan(String(url));
      // Tag this XHR if it's a medreconcile call so send() can grab the uid.
      this.__bkn_medrecon   = /\/medreconcile\//i.test(String(url));
      this.__bkn_medhistory = /\/medicationhistory\/getdetails/i.test(String(url));
    } catch (_) {}
    return _origOpen.apply(this, arguments);
  };
  /* Dispense Workbench passes patientuid/patientvisituid in the XHR request
     BODY (e.g. getallorderitem), not the URL — scan send() bodies too. */
  var _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try { _scanBody(typeof body === 'string' ? body : null); } catch (_) {}
    // Capture medreconcileuid from a medreconcile request body, keyed by the
    // patientvisituid currently in context (set by the screen's own list call).
    try {
      if (this.__bkn_medrecon && typeof body === 'string') {
        var mu = '';
        var jb = null;
        try { jb = JSON.parse(body); mu = jb.medreconcileuid || ''; } catch (_) {}
        // Only fall back to a bare-ID scan when the body has no patientuid
        // object of its own — otherwise this wrongly grabs patientuid._id.
        if (!mu && !(jb && jb.patientuid)) { var mm = ID24.exec(body); if (mm) mu = mm[1]; }
        var vid = window.__arcus_pctx__.patientvisituid || '';
        if (mu && vid) window.__arcus_medrecon__[vid] = String(mu);
      }
    } catch (_) {}
    // Cache the medicationhistory/getdetails RESPONSE verbatim (see comment
    // above) — fires on page load, not a button click, so it's captured
    // passively here rather than awaited after the fact.
    if (this.__bkn_medhistory) {
      var _xhr2 = this;
      _xhr2.addEventListener('load', function () {
        if (_xhr2.status !== 200) return;
        try {
          var vid2 = window.__arcus_pctx__.patientvisituid || '';
          if (vid2) window.__arcus_medhistory__[vid2] = JSON.parse(_xhr2.responseText);
        } catch (_) {}
      }, { once: true, passive: true });
    }
    // Also capture medreconcileuid + full list from the medreconcile RESPONSE
    // (the EMR Med Reconcile view loads without a uid in the request body, so
    // the request-body path misses it — see src/main-world/arcus-xhr-tap.js).
    if (this.__bkn_medrecon) {
      var _xhr3 = this;
      _xhr3.addEventListener('load', function () {
        if (_xhr3.status !== 200) return;
        try {
          var resp = JSON.parse(_xhr3.responseText);
          var mr = (resp && resp.medreconcile) || null;
          if (!mr) return;
          var vid3 = window.__arcus_pctx__.patientvisituid || '';
          var ruid = mr.medreconcileuid || mr.medReconcileUid || '';
          if (typeof ruid === 'object' && ruid) ruid = ruid._id || '';
          if (vid3 && ruid && /^[a-f0-9]{24}$/i.test(String(ruid))) {
            window.__arcus_medrecon__[vid3] = String(ruid);
          }
          if (vid3 && Array.isArray(mr.medicationitems)) {
            window.__arcus_medhistory__[vid3] = resp;
          }
        } catch (_) {}
      }, { once: true, passive: true });
    }
    return _origSend.apply(this, arguments);
  };
  var _origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      _scan(typeof input === 'string' ? input : (input && input.url) || '');
      if (init && typeof init.body === 'string') {
        try {
          var b = JSON.parse(init.body);
          if (b.patientuid)      window.__arcus_pctx__.patientuid      = String(b.patientuid);
          if (b.patientvisituid) window.__arcus_pctx__.patientvisituid = String(b.patientvisituid);
          if (b.PatientUID && !window.__arcus_pctx__.patientuid) window.__arcus_pctx__.patientuid = String(b.PatientUID);
        } catch (_) {}
      }
    } catch (_) {}
    return _origFetch.apply(this, arguments);
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   Unified message listener
───────────────────────────────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  /* ════════════════════════════════════════════════════════════════════
     1. SHARED LAYER — pharmacy server proxy
  ════════════════════════════════════════════════════════════════════ */
  if (msg && msg.type === 'BKN_SERVER_PROXY') {
    if (!_isAllowedProxyUrl(msg.url)) {
      sendResponse({ ok: false, status: 403, error: 'URL not in proxy allowlist' });
      return true;
    }
    (async () => {
      try {
        const method  = msg.method  || 'GET';
        const headers = msg.headers || {};
        let body;
        if (msg.body !== null && msg.body !== undefined) {
          body = (typeof msg.body === 'string') ? msg.body : JSON.stringify(msg.body);
        }
        const res = await fetch(msg.url, { method, headers, body, redirect: 'follow' });
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) {}
        sendResponse({ ok: res.ok, status: res.status, text, json });
      } catch (e) {
        sendResponse({ ok: false, status: 0, error: String(e) });
      }
    })();
    return true;
  }

  /* ════════════════════════════════════════════════════════════════════
     2. AAOverlay — Jasper XLS fetch
  ════════════════════════════════════════════════════════════════════ */
  if (msg && msg.type === 'MJ_FETCH_XLS') {
    handleFetchXls(msg, sendResponse);
    return true;
  }

  /* ════════════════════════════════════════════════════════════════════
     3. AAOverlay — XHR tap installer (MAIN world)
  ════════════════════════════════════════════════════════════════════ */
  if (msg && msg.type === 'MJ_SETUP_XHR_TAP') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ ok: false }); return true; }
    chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: _arcusSetupXhrTap,
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true });
      }
    });
    return true;
  }

  /* ════════════════════════════════════════════════════════════════════
     3b. Auth header relay — content script bridges MAIN-world postMessage
         into chrome.storage.session (incus-token never stored in window)
  ════════════════════════════════════════════════════════════════════ */
  if (msg && msg.type === 'BKN_SEC_HDR_RELAY') {
    const tabId = sender.tab?.id;
    if (tabId && msg.k && msg.v) {
      const storKey = `_bkn_hdrs_${tabId}`;
      chrome.storage.session.get(storKey, res => {
        const hdrs = (res && res[storKey]) || {};
        hdrs[msg.k] = msg.v;
        chrome.storage.session.set({ [storKey]: hdrs });
      });
    }
    return false;
  }


  /* ════════════════════════════════════════════════════════════════════
     4. AAOverlay — extract Angular patient context (MAIN world)
  ════════════════════════════════════════════════════════════════════ */
  if (msg && msg.type === 'MJ_EXTRACT_ANGULAR_CTX') {
    const tabId = sender.tab && sender.tab.id;
    if (!tabId) { sendResponse({ ok: false }); return true; }
    chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: _arcusExtractAngularCtx,
    }, results => {
      if (chrome.runtime.lastError || !results || !results[0]) {
        sendResponse({ ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
        return;
      }
      const data = results[0].result || {};
      chrome.storage.session.get(`_bkn_hdrs_${tabId}`, res => {
        data._raw = data._raw || {};
        // Live window headers (from XHR tap, always current) take priority.
        // Storage fills any gaps — useful on first load before XHR tap fires.
        const storHdrs    = (res && res[`_bkn_hdrs_${tabId}`]) || {};
        const windowHdrs  = data._raw.arcusHdrs || {};
        data._raw.arcusHdrs = Object.assign({}, storHdrs, windowHdrs);
        sendResponse({ ok: true, data });
      });
    });
    return true;
  }

  /* Best-effort LIVE med-reconcile enrichment from an open ArcusAir tab. The
     durable copy lives on the pharmacy server (persisted by capture-persist.js,
     read via BKNData.loadCapture) — this only adds anything freshly captured in
     a currently-open ArcusAir tab that may not have reached the server yet
     (e.g. a newer incus-token). Returns the live medreconMap/medhistoryMap +
     headers keyed by patientvisituid; the sheet merges the server copy first. */
  if (msg && msg.type === 'HM_REFRESH_RECON_CTX') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({});
        const aaTab = tabs.find(t => t.url && t.url.includes('arcusair.bdms.co.th'));

        const finish = (live) => {
          const raw = (live && live.raw) || {};
          sendResponse({
            ok: true,
            medreconMap:   Object.assign({}, raw.medreconMap   || {}),
            medhistoryMap: Object.assign({}, raw.medhistoryMap || {}),
            arcusHdrs:     Object.assign({}, (live && live.hdrs) || {}),
          });
        };

        if (!aaTab || !aaTab.id) { finish(null); return; }
        chrome.scripting.executeScript({
          target: { tabId: aaTab.id }, world: 'MAIN', func: _arcusExtractAngularCtx,
        }, results => {
          if (chrome.runtime.lastError || !results || !results[0]) { finish(null); return; }
          const data = results[0].result || {};
          const raw  = data._raw || {};
          chrome.storage.session.get(`_bkn_hdrs_${aaTab.id}`, res => {
            const storHdrs   = (res && res[`_bkn_hdrs_${aaTab.id}`]) || {};
            const windowHdrs = raw.arcusHdrs || {};
            finish({ raw, hdrs: Object.assign({}, storHdrs, windowHdrs) });
          });
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  /* Manual trigger for the daily auto-report (testing / on-demand refresh). */
  if (msg && msg.type === 'BKN_TRIGGER_AUTO_REPORT') {
    _runAutoStockPicking()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: String(e) }));
    return true;
  }

  /* ════════════════════════════════════════════════════════════════════
     5. AAOverlay — feature page tab router
  ════════════════════════════════════════════════════════════════════ */
  if (msg && msg.type && ROUTE_MAP[msg.type]) {
    const route = ROUTE_MAP[msg.type];
    openOrReuseTab(route.key, route.url, msg);
    sendResponse({ ok: true });
    return true;
  }

  /* ════════════════════════════════════════════════════════════════════
     6. rx_menu legacy handlers (preserved verbatim)
  ════════════════════════════════════════════════════════════════════ */
  if (msg && msg.action === 'OPEN_PDF_PAGE') {
    chrome.storage.local.set({ pdf_data: msg.payload }, () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('src/features/beedee-pdf/pdf.html') });
    });
    return true;
  }

  if (msg && msg.action === 'sendToDrugDelivery') {
    handleSendToDrugDelivery(msg.visitId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
    return true;
  }

  if (msg && msg.action === 'drugDeliveryReady') {
    sendResponse && sendResponse({ ok: true });
    return false;
  }

  if (msg && msg.action === 'drugDeliveryResult') {
    chrome.runtime.sendMessage({
      action: 'drugDeliveryResult',
      visitId: msg.visitId, ok: !!msg.ok, errorText: msg.errorText || '',
    }).catch && chrome.runtime.sendMessage({}).catch(() => {});
    sendResponse && sendResponse({ ok: true });
    return false;
  }

  return false;
});

/* ── Lifecycle ──────────────────────────────────────────────────────────── */
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.tabs.create({ url: 'welcome.html' });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   Daily auto-report — Stock Picking (RT_COMMON_917) at 15:00 Asia/Bangkok
   ──────────────────────────────────────────────────────────────────────────
   The XLS parser (BIFF8/HTML) is DOM/JS and can't run in the service worker, so
   the actual fetch+parse+save runs in a headless OFFSCREEN document (which loads
   popup.js's functions). A chrome.alarms trigger fires daily at 15:00 BKK; on
   fire we open the offscreen doc, ask it to run the report, and close it. The
   rendered rows are saved to the pharmacy server's report cache (source:'auto'),
   so every workstation opening the Report tab that day sees them without
   re-fetching.
════════════════════════════════════════════════════════════════════════════ */
const AUTO_REPORT_ALARM = 'bkn-auto-stock-picking';

/* ms until the next 15:00 Asia/Bangkok from now. Bangkok = UTC+7, no DST, so we
   compute against a UTC clock shifted +7h and target 15:00 in that frame. */
function _msUntilNextBkk1500() {
  const nowBkk = new Date(Date.now() + 7 * 3600 * 1000);      // "wall clock" in BKK
  const targetBkk = new Date(nowBkk);
  targetBkk.setUTCHours(15, 0, 0, 0);                          // 15:00 BKK wall time
  if (targetBkk <= nowBkk) targetBkk.setUTCDate(targetBkk.getUTCDate() + 1);
  return targetBkk.getTime() - nowBkk.getTime();
}

function _scheduleAutoReportAlarm() {
  // periodInMinutes as a safety net; when the alarm fires we also re-arm the
  // precise next-15:00 delay so drift can't accumulate.
  chrome.alarms.create(AUTO_REPORT_ALARM, {
    when: Date.now() + _msUntilNextBkk1500(),
    periodInMinutes: 24 * 60,
  });
}

/* Stock Picking default range mirrors the popup's init: from = yesterday, to =
   today (in Bangkok local date). */
function _stk917AutoRange() {
  const bkk = new Date(Date.now() + 7 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const to = new Date(bkk);
  const from = new Date(bkk); from.setUTCDate(from.getUTCDate() - 1);
  return { from: fmt(from), to: fmt(to) };
}

let _offscreenCreating = null;   // de-dupe concurrent createDocument calls
async function _ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen-report.html');
  // Already open?
  if (chrome.runtime.getContexts) {
    const ctxs = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url],
    });
    if (ctxs && ctxs.length) return;
  }
  if (_offscreenCreating) { await _offscreenCreating; return; }
  _offscreenCreating = chrome.offscreen.createDocument({
    url,
    reasons: ['DOM_PARSER'],
    justification: 'Parse the daily Jasper XLS report (BIFF8/HTML) which requires DOM APIs.',
  });
  try { await _offscreenCreating; } finally { _offscreenCreating = null; }
}

// Send with a few retries — the offscreen document may still be loading
// popup.js when we first message it (no listener yet → "connection" error).
async function _sendToOffscreen(payload, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await chrome.runtime.sendMessage(payload);
      if (resp !== undefined) return resp;
    } catch (_) { /* listener not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return { ok: false, error: 'offscreen document did not respond' };
}

async function _runAutoStockPicking() {
  const { from, to } = _stk917AutoRange();
  try {
    await _ensureOffscreen();
    const resp = await _sendToOffscreen({
      type: 'BKN_RUN_AUTO_REPORT', report: 'stk917', from, to,
    });
    if (resp && resp.ok) {
      console.log(`[auto-report] stock-picking saved: ${resp.rows} rows (${from}→${to})`);
    } else {
      console.warn('[auto-report] stock-picking failed:', resp && resp.error);
    }
  } catch (e) {
    console.warn('[auto-report] stock-picking error:', e && e.message || e);
  } finally {
    try { await chrome.offscreen.closeDocument(); } catch (_) { /* not open */ }
    _scheduleAutoReportAlarm();   // re-arm the precise next-15:00 delay
  }
}

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === AUTO_REPORT_ALARM) _runAutoStockPicking();
});

// Arm the alarm on worker startup / install (idempotent — create replaces).
_scheduleAutoReportAlarm();
chrome.runtime.onStartup.addListener(_scheduleAutoReportAlarm);

/* ── Drug Delivery helper (rx_menu) ─────────────────────────────────────── */
async function handleSendToDrugDelivery(visitId) {
  if (!visitId) throw new Error('Missing visitId');
  const tabs = await chrome.tabs.query({});
  const drugTab = tabs.find(t => t.url && t.url.includes(DRUGDELIVERY_URL_PART));
  if (!drugTab?.id) throw new Error('Drug Delivery page not found. Please open ipfill page first.');
  await chrome.tabs.update(drugTab.id, { active: true });
  const resp = await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(drugTab.id, { action: 'fillAndSubmit', visitId }, r => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      resolve(r);
    });
  });
  if (!resp) throw new Error('No response from drug delivery content script');
  if (resp.ok === false) throw new Error(resp.error || 'Drug delivery rejected request');
  return true;
}
