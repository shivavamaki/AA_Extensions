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
  // Response body scanner: ward-view embeds UIDs in URL *path* segments, so they
  // never appear in request URLs/bodies. We scan response JSON instead.
  // The ward board loads ALL rooms — we deep-scan to build a visitMap that correctly
  // associates each human-readable visit ID with its own patientvisituid.
  window.__arcus_pctx__.visitMap = window.__arcus_pctx__.visitMap || {};
  var VISIT_HRE = /^I48-\d{2}-\d{6}$/;   // human-readable visit ID (BKN format)
  var HEX24 = /^[a-f0-9]{24}$/i;

  /* Single validated writer for the two ids that end up in a URL path.
     ArcusAir sometimes carries an OBJECT in a patientuid/PatientUID field;
     String()-ing that yields the literal "[object Object]", which was then
     stored as if it were a real id and sent as
     PUT /api/patients/[object Object]/captures/... — a route the server
     cannot parse. Never assign these fields directly; go through here. */
  function _setPctxId(field, val) {
    if (val === null || val === undefined) return false;
    if (typeof val === 'object') return false;      // the actual bug
    var s = String(val);
    if (!HEX24.test(s)) return false;
    window.__arcus_pctx__[field] = s;
    return true;
  }

  function _deepPatients(obj, d) {
    if (!obj || typeof obj !== 'object' || d > 5) return;
    // Check this object for a patient visit UID (multiple field name variants)
    var pvid = obj.patientvisituid || obj.PatientVisitUID || obj.visituid;
    var puid = obj.patientuid      || obj.PatientUID;
    if (pvid && HEX24.test(String(pvid))) {
      pvid = String(pvid);
      window.__arcus_pctx__.patientvisituid = pvid;
      if (puid && HEX24.test(String(puid))) {
        puid = String(puid); window.__arcus_pctx__.patientuid = puid;
      } else { puid = null; }
      // Scan ALL string values in this object for a visit ID — field name-agnostic.
      // ArcusAir uses various names (admno, visitno, admissionnumber, visitId, etc.)
      for (var fk in obj) {
        var fv = obj[fk];
        if (typeof fv === 'string' && VISIT_HRE.test(fv)) {
          var vm = window.__arcus_pctx__.visitMap;
          vm[fv] = { patientvisituid: pvid };
          // puid is only a validated 24-hex STRING here (set to null above when
          // it failed HEX24) — never store a raw object, or it reaches a URL as
          // the literal "[object Object]" and the write is rejected.
          if (puid && HEX24.test(String(puid))) vm[fv].patientuid = String(puid);
        }
      }
    }
    // Recurse (capped to avoid perf issues on large responses)
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length && i < 300; i++) {
        if (obj[i] && typeof obj[i] === 'object') _deepPatients(obj[i], d + 1);
      }
    } else {
      for (var k in obj) {
        if (obj[k] && typeof obj[k] === 'object') _deepPatients(obj[k], d + 1);
      }
    }
  }

  // Patient UID lookup via postMessage bridge (isolated world → MAIN world → isolated world).
  // Finds the DOM element currently showing the visitid text, then tries 3 strategies:
  //   A. Scan <a href> links in the panel for ?patientvisituid= (ui-sref compiled URLs)
  //   B. Walk Angular scope chain looking for patientvisituid property
  //   C. Walk Angular scope chain looking in nested patient/detail objects
  function _findScopeForVisitId(visitid) {
    try {
      if (!visitid) return null;
      // XPath: find any text node containing the visit ID
      var xr = document.evaluate('//text()[contains(.,\'' + visitid + '\')]',
        document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      var node = xr.singleNodeValue;
      if (!node) return null;

      var el = node.parentElement;
      while (el && el !== document.body) {

        // ── Strategy A: compiled ui-sref hrefs ────────────────────────
        // ArcusAir icon buttons (discharge process, print, etc.) use ui-sref which
        // compiles to href="#!/inpatient/dischargeprocess?patientvisituid=xxx"
        try {
          var links = el.querySelectorAll('a[href]');
          for (var li = 0; li < links.length; li++) {
            var href = links[li].getAttribute('href') || '';
            var lm = /[?&]patientvisituid=([a-f0-9]{24})/i.exec(href);
            if (lm && lm[1]) return { patientvisituid: lm[1], patientuid: null };
          }
        } catch (_) {}

        // ── Strategy B+C: Angular scope chain ─────────────────────────
        if (typeof angular !== 'undefined') {
          try {
            var sc = angular.element(el).scope();
            for (var depth = 0; sc && depth < 30; sc = sc.$parent, depth++) {
              var pvid2 = sc.patientvisituid || sc.visituid;
              if (pvid2 && HEX24.test(String(pvid2)))
                return { patientvisituid: String(pvid2), patientuid: sc.patientuid ? String(sc.patientuid) : null };
              var nestKeys = ['patient','patientDetail','patientvisit','detail','visit','patientInfo','wardPatient','patientData'];
              for (var ni = 0; ni < nestKeys.length; ni++) {
                var no = sc[nestKeys[ni]];
                if (no && no.patientvisituid && HEX24.test(String(no.patientvisituid)))
                  return { patientvisituid: String(no.patientvisituid), patientuid: no.patientuid ? String(no.patientuid) : null };
              }
            }
          } catch (_) {}
        }

        el = el.parentElement;
      }
      return null;
    } catch (_) { return null; }
  }

  window.addEventListener('message', function (e) {
    try {
      if (e.source !== window || !e.data || e.data.__bkn_hmr_scope__ !== 1) return;
      var r = _findScopeForVisitId(e.data.visitid) || {};
      window.postMessage({ __bkn_hmr_scope_res__: 1, rid: e.data.rid,
        patientvisituid: r.patientvisituid || null, patientuid: r.patientuid || null }, '*');
    } catch (_) {}
  });

  function _scanResponseText(text) {
    if (!text || text.length < 10) return;
    try { _deepPatients(JSON.parse(text), 0); } catch (_) {}
  }

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
      _setPctxId('patientuid', b.patientuid);
      _setPctxId('patientvisituid', b.patientvisituid);
      if (!window.__arcus_pctx__.patientuid)      _setPctxId('patientuid', b.PatientUID);
      if (!window.__arcus_pctx__.patientvisituid) _setPctxId('patientvisituid', b.PatientVisitUID);
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
  var HDR_KEYS = {
    'incus-token': 1, 'appname': 1, 'utcoffset': 1, 'hasanonymouspermission': 1,
    'departmentuid': 1, 'orguid': 1, 'parentorguid': 1, 'roleuid': 1, 'useruid': 1
  };
  var _origSetHdr = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      var k = String(name || '').toLowerCase();
      if (HDR_KEYS[k] && value != null && value !== '') {
        if (k === 'incus-token') {
          /* Relay to chrome.storage.session (hidden from page scripts) AND store
             directly in __arcus_hdrs__ so _arcusExtractAngularCtx always has the
             latest token even if the storage relay misses a postMessage after
             extension reload. Page scripts can already intercept setRequestHeader
             so no additional exposure. */
          window.postMessage({ __bkn_sec__: 1, k: k, v: String(value) }, '*');
          window.__arcus_hdrs__[k] = String(value);
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
     request body carries no standalone reconcile ID at all (just patientuid +
     a date range), so there's nothing to "click to trigger" — we cache the
     RESPONSE verbatim, keyed by patientvisituid, and let the extension read
     it directly instead of trying to replay this query itself later. */
  window.__arcus_medhistory__ = window.__arcus_medhistory__ || {};
  var ID24 = /([a-f0-9]{24})/i;

  /* Relay a captured medreconcile entry to the ISOLATED-world listener, which
     persists it to the PHARMACY SERVER (per-visit capture bag, 24h TTL) so every
     workstation can reuse it — no per-PC storage, no re-capturing the same data.
     The tap runs in the page's MAIN world with no chrome.* access, so it posts a
     message the same way the incus-token relay does. Includes patientuid (needed
     to key the patient doc) + patientvisituid. Snapshots can be large — post the
     uid/token always, and the snapshot only when present. */
  function _relayMedrecon(vid, uid, snapshot) {
    try {
      if (!vid) return;
      var tok  = (window.__arcus_hdrs__ || {})['incus-token'] || '';
      var puid = window.__arcus_pctx__.patientuid || '';
      window.postMessage({
        __bkn_medrecon__: 1,
        vid: String(vid),
        puid: puid ? String(puid) : null,
        uid: uid ? String(uid) : null,
        snapshot: snapshot || null,
        token: tok ? String(tok) : null,
      }, '*');
    } catch (_) {}
  }

  var _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      _scan(String(url));
      this.__bkn_medrecon    = /\/medreconcile\//i.test(String(url));
      this.__bkn_medhistory  = /\/medicationhistory\/getdetails/i.test(String(url));
      // Flag inpatient API calls — their RESPONSES carry patientvisituid in JSON
      // even though the request URL uses path-params (not query-params).
      this.__bkn_scan_resp = /\/inpatient\//i.test(String(url));
    } catch (_) {}
    return _origOpen.apply(this, arguments);
  };
  /* Dispense Workbench passes patientuid/patientvisituid in the XHR request
     BODY (e.g. getallorderitem), not the URL — scan send() bodies too. */
  // Arm on every Med Reconcile navigation. The token is on request headers,
  // not in page HTML; persist after successful API traffic has loaded.
  var _reconCapturePending = /\/emr\/emrview\/emr\/medreconcile(?:[/?]|$)/i.test(location.hash);
  window.addEventListener('hashchange', function () {
    _reconCapturePending = /\/emr\/emrview\/emr\/medreconcile(?:[/?]|$)/i.test(location.hash);
  });
  var _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try { _scanBody(typeof body === 'string' ? body : null); } catch (_) {}
    if (_reconCapturePending && /\/emr\/emrview\/emr\/medreconcile(?:[/?]|$)/i.test(location.hash)) {
      var captureVisit = window.__arcus_pctx__.patientvisituid;
      var capturePatient = window.__arcus_pctx__.patientuid;
      var captureToken = (window.__arcus_hdrs__ || {})['incus-token'];
      this.addEventListener('load', function () {
        if (!_reconCapturePending || this.status < 200 || this.status >= 300) return;
        if (!captureToken || !captureVisit || !capturePatient) return;
        if (captureVisit !== window.__arcus_pctx__.patientvisituid || capturePatient !== window.__arcus_pctx__.patientuid) return;
        _reconCapturePending = false;
        window.postMessage({__bkn_medrecon__:1, puid:capturePatient, vid:captureVisit, token:captureToken}, '*');
      }, {once:true});
    }
    // Scan inpatient API *responses* for patient UIDs (path-param URLs)
    if (this.__bkn_scan_resp) {
      var _xhr = this;
      _xhr.addEventListener('load', function () {
        if (_xhr.status === 200) { try { _scanResponseText(_xhr.responseText); } catch (_) {} }
      }, { once: true, passive: true });
    }
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
        // Update the in-page map only. Server persistence is owned by the
        // RESPONSE handler below, which carries the same uid PLUS the snapshot —
        // relaying here too would double-write the server for one call.
        if (mu && vid) window.__arcus_medrecon__[vid] = String(mu);
      }
    } catch (_) {}
    // Capture from the medreconcile RESPONSE and persist to the server. The EMR
    // Med Reconcile view
    // (emr/emrview/emr/medreconcile) loads its list without a medreconcileuid in
    // the request body, so the request-body path above misses it — but the
    // getdetail response echoes medreconcile.medreconcileuid AND carries the
    // full medicationitems list. Grab the uid (for a later live re-fetch) and
    // cache the whole response as a snapshot the server can parse directly.
    if (this.__bkn_medrecon) {
      var _xhr3 = this;
      _xhr3.addEventListener('load', function () {
        if (_xhr3.status !== 200) return;
        try {
          var resp = JSON.parse(_xhr3.responseText);
          var mr = (resp && resp.medreconcile) || null;
          if (!mr) return;
          var vid3 = window.__arcus_pctx__.patientvisituid || '';
          var ruid = mr.medreconcileuid || mr.medReconcileUid ||
                     (mr.medreconcileuid && mr.medreconcileuid._id) || '';
          if (typeof ruid === 'object' && ruid) ruid = ruid._id || '';
          var haveUid  = vid3 && ruid && HEX24.test(String(ruid));
          var haveSnap = vid3 && Array.isArray(mr.medicationitems);
          if (haveUid)  window.__arcus_medrecon__[vid3]   = String(ruid);
          // Cache the full response as a snapshot too (server parses
          // medreconcile.medicationitems from it — same shape as getdetail).
          if (haveSnap) window.__arcus_medhistory__[vid3] = resp;
          // Persist to the pharmacy server (shared cross-PC, 24h TTL) so the
          // Home Med Sheet's ↻ works from any workstation, even after this
          // ArcusAir tab is closed/reloaded.
          if (haveUid || haveSnap) {
            _relayMedrecon(vid3, haveUid ? String(ruid) : null, haveSnap ? resp : null);
          }
        } catch (_) {}
      }, { once: true, passive: true });
    }
    // Cache the medicationhistory/getdetails RESPONSE verbatim (see comment
    // above) — this fires on page load, not on a button click, so it must be
    // captured passively here rather than awaited after the fact.
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
    return _origSend.apply(this, arguments);
  };
  var _origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      _scan(typeof input === 'string' ? input : (input && input.url) || '');
      if (init && typeof init.body === 'string') {
        try {
          var b = JSON.parse(init.body);
          _setPctxId('patientuid', b.patientuid);
          _setPctxId('patientvisituid', b.patientvisituid);
          if (!window.__arcus_pctx__.patientuid) _setPctxId('patientuid', b.PatientUID);
        } catch (_) {}
      }
    } catch (_) {}
    return _origFetch.apply(this, arguments);
  };
})();
