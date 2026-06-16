/* MAIN-world XHR/fetch tap — declared directly in manifest.json content_scripts
 * (world: "MAIN", run_at: "document_start") so the hooks are installed before
 * ArcusAir's Angular app bootstraps and fires its first authenticated API
 * calls. Previously this same code only ran on-demand via
 * chrome.scripting.executeScript, triggered from an ISOLATED content script
 * at document_idle — by then ArcusAir had often already sent the XHR
 * carrying the incus-token header, so the token was missed for the rest of
 * the tab session. Keeping the function self-contained (no shared scope with
 * background.js) since MAIN-world scripts run in the page's own JS context.
 */
(function _arcusSetupXhrTap() {
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
             the isolated content script (early-sec-relay.js) via postMessage,
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
  var ID24 = /([a-f0-9]{24})/i;

  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      _scan(String(url));
      // Tag this XHR if it's a medreconcile call so send() can grab the uid.
      this.__bkn_medrecon = /\/medreconcile\//i.test(String(url));
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
        try { var jb = JSON.parse(body); mu = jb.medreconcileuid || ''; } catch (_) {}
        if (!mu) { var mm = ID24.exec(body); if (mm) mu = mm[1]; }
        var vid = window.__arcus_pctx__.patientvisituid || '';
        if (mu && vid) window.__arcus_medrecon__[vid] = String(mu);
      }
    } catch (_) {}
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
})();
