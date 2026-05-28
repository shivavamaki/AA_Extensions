// src/background/index.js
// Single-file MV3 service worker — no importScripts, no ES modules.
"use strict";

/* ── Messages ─────────────────────────────────────────────────────── */
const MSG = Object.freeze({
  LOAD_MED_TABLE:          "LOAD_MED_TABLE",
  OPEN_STICKER:            "OPEN_STICKER",
  OPEN_PATIENT_STICKER:    "OPEN_PATIENT_STICKER",
  OPEN_MED_RECONCILE:      "OPEN_MED_RECONCILE",
  OPEN_ALLERGY_CARD:       "OPEN_ALLERGY_CARD",
  OPEN_MEDICATION_JOURNEY: "OPEN_MEDICATION_JOURNEY",
});

/* ── Tab registry ─────────────────────────────────────────────────── */
const tabRegistry = {
  sheet:              null,
  sticker:            null,
  patientSticker:     null,
  medReconcile:       null,
  allergyCard:        null,
  medicationJourney:  null,
};

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of Object.keys(tabRegistry)) {
    if (tabRegistry[key] === tabId) tabRegistry[key] = null;
  }
});

/* ── Open or reuse tab, always send fresh payload ─────────────────── */
function openOrReuseTab(key, relativeUrl, payload) {
  const fullUrl    = chrome.runtime.getURL(relativeUrl);
  const storageKey = "payload_" + key;

  // Always persist payload FIRST so the page can read it on DOMContentLoaded
  // even if sendMessage would arrive before the listener is registered.
  chrome.storage.session.set({ [storageKey]: payload });

  function sendPayload(tabId) {
    chrome.tabs.sendMessage(tabId, payload, () => void chrome.runtime.lastError);
  }

  function createNewTab() {
    chrome.tabs.create({ url: fullUrl, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      tabRegistry[key] = tab.id;
      // Page will read from session storage on DOMContentLoaded — no race condition
    });
  }

  const currentId = tabRegistry[key];
  if (currentId !== null) {
    chrome.tabs.get(currentId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        tabRegistry[key] = null;
        createNewTab();
      } else {
        // Tab already open — focus and send live message
        chrome.tabs.update(currentId, { active: true });
        sendPayload(currentId);
      }
    });
  } else {
    createNewTab();
  }
}

/* ── Router ───────────────────────────────────────────────────────── */
const ROUTE_MAP = {
  [MSG.LOAD_MED_TABLE]:          { key: "sheet",             url: "src/features/home-med/page-home-med.html"               },
  [MSG.OPEN_STICKER]:            { key: "sticker",            url: "src/features/med-sticker/page-med-sticker.html"         },
  [MSG.OPEN_PATIENT_STICKER]:    { key: "patientSticker",     url: "src/features/patient-sticker/page-patient-sticker.html" },
  [MSG.OPEN_MED_RECONCILE]:      { key: "medReconcile",       url: "src/features/patient-sticker/page-med-reconcile.html"   },
  [MSG.OPEN_ALLERGY_CARD]:       { key: "allergyCard",        url: "src/features/patient-sticker/page-allergy-card.html"    },
  [MSG.OPEN_MEDICATION_JOURNEY]: { key: "medicationJourney",  url: "src/features/medication-journey/page-medication-journey.html" },
};

/* ── MJ_FETCH_XLS handler — fetch Jasper XLS with extension credentials ─ */
function handleFetchXls(msg, sendResponse) {
  const url = msg.url || "";

  // Security: only allow requests to the Jasper server
  if (!url.startsWith("https://aa-report.bdms.co.th/")) {
    sendResponse({ ok: false, error: "URL not allowed" });
    return;
  }

  const timeout = setTimeout(function () {
    sendResponse({ ok: false, error: "timeout" });
  }, 30000);

  fetch(url, {
    credentials: "include",
    headers: { "Accept": "application/vnd.ms-excel,*/*" },
  })
    .then(function (resp) {
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      return resp.arrayBuffer();
    })
    .then(function (buf) {
      clearTimeout(timeout);
      const arr = Array.from(new Uint8Array(buf));
      sendResponse({ ok: true, data: arr });
    })
    .catch(function (e) {
      clearTimeout(timeout);
      sendResponse({ ok: false, error: String(e) });
    });
}

/* ── Message listener ─────────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type) return false;

  // Handle XLS fetch separately (async)
  if (msg.type === "MJ_FETCH_XLS") {
    handleFetchXls(msg, sendResponse);
    return true;
  }

  // Install XHR/fetch tap in MAIN world to capture patientuid from API call URLs
  if (msg.type === "MJ_SETUP_XHR_TAP") {
    const tabId = _sender.tab && _sender.tab.id;
    if (!tabId) { sendResponse({ ok: false }); return true; }
    chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: function _arcusSetupXhrTap() {
        if (window.__arcus_xhr_tap_installed__) return;
        window.__arcus_xhr_tap_installed__ = true;
        window.__arcus_pctx__ = window.__arcus_pctx__ || {};
        var UID_RE = /[?&]patientuid=([a-f0-9]{24})/i;
        var VID_RE = /[?&]patientvisituid=([a-f0-9]{24})/i;
        function _scan(url) {
          if (!url) return;
          var m;
          m = UID_RE.exec(url); if (m && m[1]) window.__arcus_pctx__.patientuid      = m[1];
          m = VID_RE.exec(url); if (m && m[1]) window.__arcus_pctx__.patientvisituid = m[1];
        }
        var _origOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          try { _scan(String(url)); } catch(_) {}
          return _origOpen.apply(this, arguments);
        };
        var _origFetch = window.fetch;
        window.fetch = function(input, init) {
          try {
            _scan(typeof input === "string" ? input : (input && input.url) || "");
            if (init && typeof init.body === "string") {
              try {
                var b = JSON.parse(init.body);
                if (b.patientuid)      window.__arcus_pctx__.patientuid      = String(b.patientuid);
                if (b.patientvisituid) window.__arcus_pctx__.patientvisituid = String(b.patientvisituid);
                if (b.PatientUID && !window.__arcus_pctx__.patientuid) window.__arcus_pctx__.patientuid = String(b.PatientUID);
              } catch(_) {}
            }
          } catch(_) {}
          return _origFetch.apply(this, arguments);
        };
      },
    }, function() { sendResponse({ ok: true }); });
    return true;
  }

  // Extract Angular context from the page's MAIN world (bypasses CSP)
  if (msg.type === "MJ_EXTRACT_ANGULAR_CTX") {
    const tabId = _sender.tab && _sender.tab.id;
    if (!tabId) { sendResponse({ ok: false }); return true; }
    chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: function _arcusExtractAngularCtx() {
        var out = { stateParams: {}, userCtx: {}, patientCtx: {}, _raw: {} };
        try {
          var $r = angular.element(document.documentElement).scope().$root; // eslint-disable-line no-undef

          /* ── State params: $stateParams → LastUIStateParams → AutoLoginStateParams ── */
          function _safeParams(obj) {
            if (!obj || typeof obj !== "object") return {};
            var safe = {};
            Object.keys(obj).forEach(function (k) {
              var v = obj[k];
              if (v !== null && v !== undefined && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
                safe[k] = String(v);
              }
            });
            return safe;
          }
          /* Prefer the most specific source first */
          var sp = _safeParams($r.$stateParams && Object.keys($r.$stateParams).length ? $r.$stateParams : null) ||
                   _safeParams($r.LastUIStateParams) ||
                   _safeParams($r.AutoLoginStateParams) ||
                   {};
          /* Also merge LastUIStateParams on top so we don't lose patient UIDs
             even when $stateParams is non-empty but missing them */
          var lastP = _safeParams($r.LastUIStateParams);
          var autoP = _safeParams($r.AutoLoginStateParams);
          Object.keys(lastP).forEach(function (k) { if (!sp[k]) sp[k] = lastP[k]; });
          Object.keys(autoP).forEach(function (k) { if (!sp[k]) sp[k] = autoP[k]; });

          out.stateParams = sp;
          out._raw.stateParams     = sp;
          out._raw.LastUIStateParams    = lastP;
          out._raw.AutoLoginStateParams = autoP;

          /* ── UserContext — this app uses PascalCase keys ── */
          var uc = $r.UserContext || $r.userContext || {};
          var safeUc = {};
          Object.keys(uc).forEach(function (k) {
            var v = uc[k];
            if (v !== null && v !== undefined && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
              safeUc[k] = v;
            }
          });
          out._raw.UserContext = safeUc;
          out.userCtx = {
            loginuid:           String(uc.UserUID            || uc.loginuid            || uc.loginUid    || uc.LoginUid    || uc.UserId    || ""),
            roleuid:            String(uc.RoleUID            || uc.roleuid             || uc.roleUid     || uc.RoleUid     || uc.RoleId    || ""),
            organisationuid:    String(uc.OrgUID             || uc.organisationuid     || uc.orgUid      || uc.OrgUid      || ""),
            parentorguid:       String(uc.ParentOrgUID       || uc.parentorguid        || uc.parentOrguid || ""),
            logindepartmentuid: String(uc.DepartmentUID      || uc.logindepartmentuid  || uc.deptUid     || uc.DeptUid     || ""),
            _pp:                String(uc.pp || uc._pp || ""),
            pharmacistName:     String(uc.UserName           || uc.userName            || uc.DisplayName || uc.displayName || ""),
          };

          /* ── Patient context helper — extract from any scope/object ──
             allowBareUid=true only for named patient sub-objects, never raw scope */
          function _pickPatient(o, allowBareUid) {
            if (!o || typeof o !== "object" || Array.isArray(o)) return null;
            function _str(v) { return (v && typeof v === "string") ? v : ""; }
            var uid = _str(o.patientuid)  || _str(o.patientUid)  || _str(o.PatientUID) || _str(o.PatientUid)
                   || _str(o.patientid)   || _str(o.PatientID)   || _str(o.patient_id)
                   || _str(o.pid)         || _str(o.puid)
                   || (allowBareUid ? _str(o.uid) : "");
            var vid = _str(o.patientvisituid) || _str(o.patientVisitUid) || _str(o.PatientVisitUID)
                   || _str(o.PatientVisitUid)  || _str(o.visituid)        || _str(o.visitUid);
            if (!uid && !vid) return null;
            return {
              patientuid:      uid,
              patientvisituid: vid,
              patientId:       String(o.patientId  || o.hn || o.patientid  || o.PatientID  || ""),
              patientVisitId:  String(o.patientVisitId || o.an || o.patientvisitid || o.PatientVisitID || ""),
              patientName:     String(o.patientName || o.name || o.fullName || o.PatientName || ""),
            };
          }

          function _fromScope(sc) {
            if (!sc) return null;
            var r = _pickPatient(sc); /* direct uid props on scope (no bare uid) */
            if (r && r.patientuid) return r;
            var keys = ["patient","patientData","patientInfo","patientContext","PatientContext",
                        "currentPatient","selectedPatient","patientVisit","currentVisit","visit",
                        "patientVisitContext","emrContext","EmrContext","emrData",
                        "vm","ctrl","model","data","scope","viewModel"];
            for (var i = 0; i < keys.length; i++) {
              var sub = sc[keys[i]];
              if (!sub || typeof sub !== "object") continue;
              r = _pickPatient(sub, true);
              if (r && r.patientuid) return r;
              /* one level deeper: vm.patient, ctrl.patientData, etc. */
              var nested = ["patient","patientData","patientInfo","patientContext","currentPatient","selectedPatient"];
              for (var ni = 0; ni < nested.length; ni++) {
                r = _pickPatient(sub[nested[ni]], true);
                if (r && r.patientuid) return r;
              }
            }
            /* Return partial result (visituid found but not patientuid) as last resort */
            r = _pickPatient(sc);
            if (r) return r;
            for (var j = 0; j < keys.length; j++) {
              r = _pickPatient(sc[keys[j]], true);
              if (r) return r;
            }
            return null;
          }

          /* Helper: merge candidate into pc, keeping best values */
          function _merge(pc, candidate) {
            if (!candidate) return pc;
            if (!pc) return candidate;
            if (candidate.patientuid      && !pc.patientuid)      pc.patientuid      = candidate.patientuid;
            if (candidate.patientvisituid && !pc.patientvisituid) pc.patientvisituid = candidate.patientvisituid;
            if (candidate.patientName     && !pc.patientName)     pc.patientName     = candidate.patientName;
            if (candidate.patientId       && !pc.patientId)       pc.patientId       = candidate.patientId;
            return pc;
          }

          /* 1. Root scope */
          var pc = _fromScope($r);

          /* 2. ui-view scopes — continue-and-merge until patientuid found */
          if (!pc || !pc.patientuid) {
            var views = document.querySelectorAll("ui-view, [ui-view]");
            for (var vi = 0; vi < views.length && !(pc && pc.patientuid); vi++) {
              try {
                var vsc = angular.element(views[vi]).scope(); // eslint-disable-line no-undef
                pc = _merge(pc, _fromScope(vsc));
                /* Walk up parent chain hunting for patientuid */
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

          /* 3. ng-controller elements matching emr/order/patient/visit */
          if (!pc || !pc.patientuid) {
            var ctrlEls = document.querySelectorAll("[ng-controller]");
            for (var ci = 0; ci < ctrlEls.length && !(pc && pc.patientuid); ci++) {
              var ctrlName = (ctrlEls[ci].getAttribute("ng-controller") || "").toLowerCase();
              if (!/emr|order|patient|visit|drug|med/.test(ctrlName)) continue;
              try {
                pc = _merge(pc, _fromScope(angular.element(ctrlEls[ci]).scope())); // eslint-disable-line no-undef
              } catch (_) {}
            }
          }

          /* 4. Angular injector services */
          if (!pc || !pc.patientuid) {
            try {
              var inj = angular.element(document.documentElement).injector(); // eslint-disable-line no-undef
              var svcs = ["PatientVisitService","PatientService","PatientContextService",
                          "VisitService","CurrentVisitService","EmrService","PatientContext"];
              for (var si = 0; si < svcs.length && !(pc && pc.patientuid); si++) {
                try { pc = _merge(pc, _fromScope(inj.get(svcs[si]))); } catch (_) {}
              }
            } catch (_) {}
          }

          /* 5. XHR tap — read UIDs captured from API calls */
          try {
            var xhrCtx = window.__arcus_pctx__ || {};
            if (!pc) pc = { patientuid: "", patientvisituid: "", patientId: "", patientVisitId: "", patientName: "" };
            if (xhrCtx.patientuid      && !pc.patientuid)      pc.patientuid      = xhrCtx.patientuid;
            if (xhrCtx.patientvisituid && !pc.patientvisituid) pc.patientvisituid = xhrCtx.patientvisituid;
            out._raw.xhrTap = xhrCtx;
          } catch (_) {}

          /* 6. Debug: scope keys of first ui-view if patientuid still missing */
          if (!pc || !pc.patientuid) {
            try {
              var firstView = document.querySelector("ui-view, [ui-view]");
              if (firstView) {
                var dbgSc = angular.element(firstView).scope(); // eslint-disable-line no-undef
                if (dbgSc) out._raw.firstViewScopeKeys = Object.keys(dbgSc).filter(function(k){ return k[0]!=="$"; });
              }
            } catch (_) {}
          }

          if (pc && (pc.patientuid || pc.patientvisituid)) out.patientCtx = pc;

        } catch (e) { out._error = String(e); }
        return out;
      },
    }, function (results) {
      if (chrome.runtime.lastError || !results || !results[0]) {
        sendResponse({ ok: false, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
      } else {
        sendResponse({ ok: true, data: results[0].result || {} });
      }
    });
    return true; // keep channel open for async sendResponse
  }

  const route = ROUTE_MAP[msg.type];
  if (!route) return false;
  openOrReuseTab(route.key, route.url, msg);
  sendResponse({ ok: true });
  return true;
});
