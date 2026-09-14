// src/features/home-med/content-home-med.js
// Injected into: arcusair.bdms.co.th
//
// Home Medication Sheet — reworked.
//
// The button is shown when the page DOM contains a "DISCHARGE MEDICATION"
// cell. On click it
// extracts the ArcusAir patient/report context (reusing the MedicationJourney
// extractor that ADR Timeline uses), mirrors it to the shared BKNData context
// bus, then routes to the Home Medication Sheet page carrying the context UIDs.
// The page fetches the HomeMedSheetReport/Thai Jasper XLS by patientvisituid.
"use strict";

(function () {
  if (window.__HM_SHEET_LOADED__) return;
  window.__HM_SHEET_LOADED__ = true;

  const { createIconButton, norm } = window.CoreDom;
  const { MSG }                    = window.CoreMessages;

  /** True when a "DISCHARGE MEDICATION" md-cell is present on the page. */
  function hasDischargeMedicationCell() {
    const cells = document.querySelectorAll("td.md-cell");
    for (const td of cells) {
      if (norm(td.textContent).toUpperCase() === "DISCHARGE MEDICATION") return true;
    }
    return false;
  }

  /** True on the OPD (outpatient) dispense workbench. The IPD discharge sheet is
   *  gated by the "DISCHARGE MEDICATION" cell; OPD has no such cell — it's the
   *  outpatient pharmacy worklist/dispense. Gate by URL (the dispense workbench)
   *  so the OPD Home Med Sheet button appears there too. */
  function isOpdDispenseWorkbench() {
    return /pharmacy\/dispenseworkbench\/pharmacy\/dispense/i.test(location.href)
        && !hasDischargeMedicationCell();
  }

  /** Which sheet mode the current page calls for: "ipd" (discharge) | "opd" | null. */
  function sheetMode() {
    if (hasDischargeMedicationCell()) return "ipd";
    if (isOpdDispenseWorkbench()) return "opd";
    return null;
  }

  /** Gate by page DOM/URL, not hash alone; ArcusAir SPA routing changes during nav. */
  function shouldShow() {
    return sheetMode() !== null;
  }

  /* ─────────────────────────────────────────────
   * Read the diagnosis text from the patient EMR banner.
   * The diagnosis sits in the banner's secondary section as a
   * `div.overme` element. Prefer the exact path, fall back to a
   * resilient scan within patient-emr-banner .sec-banner.
   * ───────────────────────────────────────────── */
  const DIAGNOSIS_SEL =
    "body > div.full-height.ng-scope.layout-row > div > md-content > md-content" +
    " > div > md-card > md-content.md-whiteframe-z2.padding-left-14-imp.margin-5" +
    ".stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme" +
    ".width-70-per > div.ng-isolate-scope.flex-initial > div:nth-child(1) >" +
    " patient-emr-banner > div > div.sec-banner.ng-scope >" +
    " div.sec-first-section.layout-row.layout-align-start-center > div:nth-child(2) > div";

  function readDiagnosis() {
    // 1) Exact selector from the dispense workbench banner.
    let el = document.querySelector(DIAGNOSIS_SEL);
    let txt = el ? norm(el.textContent) : "";
    if (txt) return txt;

    // 2) Resilient fallback: the diagnosis div.overme inside .sec-banner.
    //    (The banner's first section holds the diagnosis text.)
    const sec = document.querySelector("patient-emr-banner .sec-banner .sec-first-section");
    if (sec) {
      // Pick the longest .overme text that isn't a label/short token.
      let best = "";
      sec.querySelectorAll("div.overme").forEach((d) => {
        const t = norm(d.textContent);
        if (t.length > best.length) best = t;
      });
      if (best) return best;
    }
    return "";
  }

  /* ─────────────────────────────────────────────
   * Install the MAIN-world XHR/fetch tap early so it
   * captures patientuid / patientvisituid from the
   * Dispense Workbench requests (which carry them in
   * the XHR request body, not the URL or Angular scope).
   * ───────────────────────────────────────────── */
  let _tapRequested = false;
  function ensureXhrTap() {
    if (_tapRequested) return;
    _tapRequested = true;
    try {
      chrome.runtime.sendMessage({ type: "MJ_SETUP_XHR_TAP" }, () => void chrome.runtime.lastError);
    } catch (_) { /* extension context may be gone; harmless */ }
  }

  function getOrCreateDispenseToolGroup() {
    // Single source of truth: patient-sticker's #paprint group. Do NOT build a
    // second group in the toolbar span — that produced duplicate 💊 groups on
    // the dispense workbench (which has both anchors). If the shared group does
    // not exist yet, bail and wait for the next observer tick.
    const sharedFactory = document[Symbol.for("__BKN_TOOL_GROUP_FACTORY__")];
    if (typeof sharedFactory === "function") return sharedFactory();
    return document.querySelector(".bkn-tool-group");
  }

  function removeHomeMedButtons() {
    document.querySelectorAll(".hm-sheet-btn, .hm-journey-btn").forEach((btn) => btn.remove());
  }

  function ensureFlyoutButton(flyout, selector, opts) {
    let btn = document.querySelector(selector);
    if (!btn) btn = createIconButton(opts);
    if (btn.parentElement !== flyout) flyout.appendChild(btn);
    return btn;
  }

  /* ─────────────────────────────────────────────
   * Context extraction (reuse the ADR Timeline extractor).
   * Both adrtimeline-core.js and shared-data-client.js load
   * before this script (see manifest content_scripts order).
   * ───────────────────────────────────────────── */
  async function extractContext() {
    const NS = window.MedicationJourney;
    const ctx = NS && typeof NS.extractArcusPatientContext === "function"
      ? NS.extractArcusPatientContext()
      : {};

    // Augment with Angular MAIN-world context via the background extractor.
    try {
      if (NS && typeof NS.extractAngularContextFromPage === "function") {
        const pageCtx = await NS.extractAngularContextFromPage();
        const sp = pageCtx.stateParams || {};
        const uc = pageCtx.userCtx    || {};
        const pc = pageCtx.patientCtx || {};
        const _m = (key, val) => { if (!ctx[key] && val) ctx[key] = val; };

        _m("patientuid",        sp.patientuid        || sp.patientUid);
        _m("patientvisituid",   sp.patientvisituid   || sp.patientVisitUid || sp.visituid);
        _m("loginuid",          sp.loginuid          || sp.loginUid);
        _m("roleuid",           sp.roleuid           || sp.roleUid);
        _m("organisationuid",   sp.organisationuid   || sp.orguid);
        _m("parentorguid",      sp.parentorguid      || sp.parentOrguid);
        _m("logindepartmentuid",sp.logindepartmentuid|| sp.deptuid);
        _m("departmentuid",     sp.departmentuid     || sp.deptuid);
        _m("careprovideruid",   sp.careprovideruid   || sp.careProviderUid);
        _m("_pp",               sp.pp);

        _m("loginuid",          uc.loginuid);
        _m("roleuid",           uc.roleuid);
        _m("organisationuid",   uc.organisationuid);
        _m("parentorguid",      uc.parentorguid);
        _m("logindepartmentuid",uc.logindepartmentuid);
        _m("_pp",               uc._pp);
        _m("pharmacistName",    uc.pharmacistName);

        _m("patientuid",        pc.patientuid);
        _m("patientvisituid",   pc.patientvisituid);
        _m("patientId",         pc.patientId);
        _m("hn",                pc.patientId);
        _m("patientVisitId",    pc.patientVisitId);
        _m("an",                pc.patientVisitId);
        _m("patientName",       pc.patientName);

        // Final fallback: ids captured by the MAIN-world XHR/fetch tap from the
        // Dispense Workbench request URLs/bodies (getallorderitem etc.). This is
        // the only place the dispense workbench exposes the session/role UIDs
        // that Jasper needs to authenticate the report (loginuid/roleuid/org).
        const tap = (pageCtx._raw && pageCtx._raw.xhrTap) || {};
        _m("patientuid",        tap.patientuid);
        _m("patientvisituid",   tap.patientvisituid);
        _m("loginuid",          tap.loginuid);
        _m("roleuid",           tap.roleuid);
        _m("organisationuid",   tap.organisationuid);
        _m("parentorguid",      tap.parentorguid);
        _m("logindepartmentuid",tap.logindepartmentuid);
        _m("departmentuid",     tap.departmentuid);
        _m("careprovideruid",   tap.careprovideruid);

        // ArcusAir API headers (incus-token etc.) captured from setRequestHeader.
        const hdrs = (pageCtx._raw && pageCtx._raw.arcusHdrs) || {};
        if (hdrs["incus-token"]) ctx.incusToken = hdrs["incus-token"];

        // Reconciliation data for THIS visit. The server is the source of
        // truth — the HM Process workstation's "Med Reconcile" step (▶ Run,
        // src/features/hmr/content-hmr.js) persists the captured
        // medicationhistory/getdetails snapshot to the HMR record as soon as
        // it's captured, so any workstation can reuse it without re-running
        // the EMR navigation. Check there first.
        if ((ctx.hn || ctx.patientId) && window.BKNData && window.BKNData.serverFetch) {
          try {
            const hn = ctx.hn || ctx.patientId;
            const to = new Date().toISOString().slice(0, 10);
            const from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
            const r = await window.BKNData.serverFetch(`/api/hmr?from=${from}&to=${to}`);
            const list = (r && r.ok && Array.isArray(r.json)) ? r.json : [];
            const rec = list.find((d) => (d.medreconcileSnapshot || d.medreconcileuid) && norm(d.hn || "") === norm(hn));
            if (rec) {
              if (rec.medreconcileSnapshot) ctx.medreconcileSnapshot = rec.medreconcileSnapshot;
              if (rec.medreconcileuid)      ctx.medreconcileuid      = rec.medreconcileuid;
            }
          } catch (_) { /* best-effort */ }
        }

        // Fallback: this session's own live capture (keyed by visituid) —
        // only used if the server doesn't have a snapshot/uid yet for this visit.
        const mrMap = (pageCtx._raw && pageCtx._raw.medreconMap) || {};
        if (!ctx.medreconcileSnapshot && !ctx.medreconcileuid && ctx.patientvisituid && mrMap[ctx.patientvisituid]) {
          ctx.medreconcileuid = mrMap[ctx.patientvisituid];
        }

        const ok = ctx.patientuid && ctx.patientvisituid && ctx.loginuid;
        console.group("[home-med] context after merge");
        console.log("patientuid      :", ctx.patientuid       || "⚠️ MISSING");
        console.log("patientvisituid :", ctx.patientvisituid  || "⚠️ MISSING");
        console.log("loginuid        :", ctx.loginuid         || "⚠️ MISSING");
        console.log("roleuid         :", ctx.roleuid          || "⚠️ MISSING");
        console.log("organisationuid :", ctx.organisationuid  || "⚠️ MISSING");
        console.log("parentorguid    :", ctx.parentorguid     || "(none — pp falls back to organisationuid)");
        console.log("careprovideruid :", ctx.careprovideruid  || "(none)");
        console.log("_pp             :", ctx._pp              || "(none — built from u/r/o)");
        console.log("incusToken      :", ctx.incusToken       || "⚠️ MISSING (ArcusAir API needs it)");
        console.log("medreconcileuid :", ctx.medreconcileuid  || "(none — open Med Reconcile screen for this patient to capture)");
        console.log("canFetchReport  :", ok ? "✅ YES" : "❌ NO");
        console.log("xhrTap          :", JSON.parse(JSON.stringify(tap)));
        console.log("FULL ctx        :", JSON.parse(JSON.stringify(ctx)));
        console.groupEnd();
      }
    } catch (_) { /* silent — partial context still usable */ }

    return ctx;
  }

  /* ─────────────────────────────────────────────
   * Click handler
   * ───────────────────────────────────────────── */
  let _sending = false;
  let _hostedWindow = null;
  let _hostedReady = false;
  let _hostedContext = null;
  let _hostedOrigin = "";
  let _hostedListener = null;
  let _hostedDeliveryTimer = null;

  function sendHostedContext() {
    if (!_hostedWindow || !_hostedOrigin || !_hostedContext) return;
    clearTimeout(_hostedDeliveryTimer);
    let attempts = 0;
    const send = () => {
      if (!_hostedWindow || !_hostedOrigin || !_hostedContext) return;
      try {
        _hostedWindow.postMessage({ type: "HM_PILOT_CONTEXT", context: _hostedContext }, _hostedOrigin);
      } catch (_) { return; }
      if (++attempts < 20) _hostedDeliveryTimer = setTimeout(send, 300);
    };
    send();
  }

  async function handleClick() {
    if (_sending) return;
    _sending = true;

    // Make sure the tap is installed, then extract. The tap only captures
    // requests fired AFTER installation, so on a cold click we retry briefly
    // to give the workbench a chance to issue a tapped XHR.
    ensureXhrTap();

    const mode = sheetMode() || "ipd";

    // Both IPD (discharge) and OPD (DAILYORDER) pull from getallorderitem keyed by
    // patientuid + patientvisituid; the difference is the ordertype the server sends.
    // IPD additionally needs the session uids for Jasper; OPD is rendered client-side.
    const _hasPatient = (c) => c && c.patientuid && c.patientvisituid;
    const _hasAuth    = (c) => c && c.loginuid;
    const _ready = (c) => (mode === "opd") ? _hasPatient(c) : (_hasPatient(c) && _hasAuth(c));
    let context = null;
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        context = await extractContext();
        if (_ready(context)) break;
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (e) {
      _sending = false;
      console.error("[HM] context extraction failed:", e);
      alert("ไม่สามารถอ่านข้อมูลผู้ป่วยได้ กรุณาลองใหม่อีกครั้ง");
      return;
    }

    if (mode === "opd") {
      context = context || {};
      context.mode = "opd";
      if (!_hasPatient(context)) {
        _sending = false;
        alert("ไม่พบ patientvisituid ของผู้ป่วย OPD\n\nกรุณาคลิกเลือกผู้ป่วยในรายการ (worklist) ก่อน แล้วกดปุ่มซ้ำ");
        return;
      }
      // Fall through to diagnosis/mirror/route below.
    } else if (!_hasPatient(context)) {
      _sending = false;
      alert("ไม่พบ patientvisituid ของผู้ป่วย\n\nกรุณาคลิกเลือกผู้ป่วยในรายการ (worklist) หรือสลับแท็บ DISPENSING ใหม่อีกครั้ง แล้วกดปุ่มซ้ำ");
      return;
    }
    if (!_hasAuth(context)) {
      // Patient ids present but no session uid captured yet — let the user know;
      // the report will likely bounce to the Jasper login page without it.
      console.warn("[home-med] proceeding without loginuid — Jasper auth may fail", context);
    }

    // Diagnosis is only in the page DOM (not the API) — read it now.
    try {
      const dx = readDiagnosis();
      if (dx) context.diagnosis = dx;
    } catch (_) { /* non-fatal */ }

    if (_msgType === MSG.LOAD_MED_TABLE) {
      _hostedContext = context;
      sendHostedContext();
      _sending = false;
      return;
    }

    // Mirror to the shared cross-feature / cross-workstation context bus.
    try {
      if (window.BKNData && typeof window.BKNData.setPatientContext === "function") {
        const c = context;
        await window.BKNData.setPatientContext({
          patientuid:      c.patientuid || "",
          patientvisituid: c.patientvisituid || "",
          hn:              c.hn || c.patientId || "",
          an:              c.an || c.patientVisitId || "",
          patientName:     c.patientName || "",
        });
      }
    } catch (_) { /* non-fatal */ }

    // The Home Med Sheet button opens the IPD or OPD sheet by mode; the Journey
    // button keeps its own type.
    let outType = _msgType;
    if (_msgType === MSG.LOAD_MED_TABLE && mode === "opd") outType = MSG.LOAD_MED_TABLE_OPD;
    try {
      chrome.runtime
        .sendMessage({ type: outType, context })
        .finally(() => setTimeout(() => (_sending = false), 300));
    } catch (e) {
      _sending = false;
      if (e.message?.includes("Extension context invalidated")) {
        alert("⚠️ Extension was updated. Please refresh this page (F5) to reconnect.");
      } else {
        console.error("[HM] sendMessage failed:", e);
      }
    }
  }

  // The button click sets which page to open; both share the same extraction.
  let _msgType = MSG.LOAD_MED_TABLE;
  async function openHostedSheet(mode, child) {
    if (!child) {
      alert("กรุณาอนุญาตป๊อปอัปสำหรับเปิด Home Medication Sheet");
      return;
    }
    try {
      const base = await window.BKNData.getServerUrl();
      const page = mode === "opd" ? "OPD-Sheet.html" : "page-home-med.html";
      const url = new URL(`/hm-pilot/src/features/home-med/${page}`, base);
      _hostedOrigin = url.origin;
      _hostedReady = false;
      _hostedListener = (event) => {
        if (event.source !== child || event.origin !== url.origin || event.data?.type !== "HM_PILOT_READY") return;
        _hostedReady = true;
        sendHostedContext();
      };
      window.addEventListener("message", _hostedListener);
      child.location.href = url.href;
      setTimeout(() => {
        if (_hostedListener) window.removeEventListener("message", _hostedListener);
        _hostedListener = null;
      }, 120000);
    } catch (error) {
      child.close();
      console.error("[home-med] hosted pilot launch failed:", error);
      alert("ไม่สามารถเปิด Home Medication Sheet จาก server ได้");
    }
  }

  async function handleSheetClick() {
    _msgType = MSG.LOAD_MED_TABLE;
    _hostedWindow = window.open("about:blank", "_blank");
    if (!_hostedWindow) {
      alert("กรุณาอนุญาตป๊อปอัปสำหรับเปิด Home Medication Sheet");
      return;
    }
    const mode = sheetMode() || "ipd";
    void openHostedSheet(mode, _hostedWindow);
    await handleClick();
  }
  function handleJourneyClick() { _msgType = MSG.OPEN_MED_JOURNEY; handleClick(); }

  /* ─────────────────────────────────────────────
   * Inject / remove buttons (idempotent, page-level):
   *   🏠💊 Home Medication Sheet   🗺️ Medication Journey
   * ───────────────────────────────────────────── */
  function syncButton() {
    if (!shouldShow()) {
      removeHomeMedButtons();
      return;
    }

    const group = getOrCreateDispenseToolGroup();
    const flyout = group?.querySelector(".bkn-tool-flyout");
    if (!flyout) return;

    const sheetBtn = ensureFlyoutButton(flyout, ".hm-sheet-btn", {
      icon: "🏠💊", title: "Open Home Medication Sheet (Server)",
      className: "hm-sheet-btn", onClick: handleSheetClick,
    });
    const journeyBtn = ensureFlyoutButton(flyout, ".hm-journey-btn", {
      icon: "🗺️", title: "Open Medication Journey (timeline)",
      className: "hm-journey-btn", onClick: handleJourneyClick,
    });

    // Reorder only when out of place — moving nodes that are already correct
    // still fires the MutationObserver, keeping the page in a perpetual
    // re-render loop. sheet should sit right after the sticker button (or first),
    // journey right after sheet.
    const stickerBtn = flyout.querySelector(".print-sticker-btn");
    const sheetTarget = stickerBtn ? stickerBtn.nextSibling : flyout.firstChild;
    if (sheetBtn.nextSibling !== sheetTarget && sheetBtn !== sheetTarget) {
      flyout.insertBefore(sheetBtn, sheetTarget);
    }
    if (journeyBtn.previousSibling !== sheetBtn) {
      flyout.insertBefore(journeyBtn, sheetBtn.nextSibling);
    }
  }

  // Install the XHR tap without a URL gate so ArcusAir hash-route variations
  // do not prevent patient ids from being captured before the click.
  function syncAll() {
    ensureXhrTap();
    syncButton();
  }

  // Capture before Angular's allocation navigation tears down the order banner.
  let allocationContext = null;
  const prebuildJobs = new Set();
  function capturePrebuildContext(event) {
    if (!event.target.closest?.('#allocatedispense')) return;
    allocationContext = null;
    if (!location.hash.startsWith('#!/pharmacy/dispenseworkbench/pharmacy/dispense')) return;
    const discharge = Array.from(document.querySelectorAll('#orderdetailtable td, #ordertable td')).some(td =>
      (td.textContent || '').trim().toUpperCase() === 'DISCHARGE MEDICATION');
    if (discharge) allocationContext = extractContext().catch(() => null);
  }
  document.addEventListener('pointerdown', capturePrebuildContext, true);
  document.addEventListener('click', async event => {
    if (!event.target.closest?.('#allocatedispense')) return;
    if (!allocationContext) capturePrebuildContext(event); // keyboard/programmatic click
    const pending = allocationContext;
    allocationContext = null;
    if (!pending) return;
    const context = await pending;
    if (!context?.patientuid || !context?.patientvisituid || !context?.incusToken || !window.BKNData) return;
    const key = `${context.patientuid}|${context.patientvisituid}`;
    if (prebuildJobs.has(key)) return;
    prebuildJobs.add(key);
    try {
      // Speculative only: the server checks live orders again before cache reuse.
      await window.BKNData.serverFetch('/api/report/home-med-api', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({context, prebuild:true}),
      });
    } catch (_) { /* Opening the sheet still uses the normal live fallback. */ }
    finally { prebuildJobs.delete(key); }
  }, true);
  syncAll();

  // Debounce to one run per animation frame. syncButton() mutates the DOM, which
  // would otherwise re-trigger this observer synchronously on every Angular
  // re-render — pegging the CPU and freezing the dispense workbench.
  let _scheduled = false;
  new MutationObserver(() => {
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(() => {
      _scheduled = false;
      syncAll();
    });
  }).observe(document.body, { childList: true, subtree: true });

  window.addEventListener("hashchange", syncAll);
  window.addEventListener("popstate",   syncAll);
})();
