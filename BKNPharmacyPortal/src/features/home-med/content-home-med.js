// src/features/home-med/content-home-med.js
// Injected into: arcusair.bdms.co.th
//
// Home Medication Sheet — reworked.
//
// The button is shown ONLY on the Dispense Workbench dispense route AND only
// when a "DISCHARGE MEDICATION" cell is present on the page. On click it
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

  /* ─────────────────────────────────────────────
   * Gates
   * ───────────────────────────────────────────── */
  function isDispensePage() {
    return location.hash.includes("pharmacy/dispenseworkbench/pharmacy/dispense");
  }

  /** True when a "DISCHARGE MEDICATION" md-cell is present on the page. */
  function hasDischargeMedicationCell() {
    const cells = document.querySelectorAll("td.md-cell");
    for (const td of cells) {
      if (norm(td.textContent).toUpperCase() === "DISCHARGE MEDICATION") return true;
    }
    return false;
  }

  /** Both gates must hold for the button to be shown. */
  function shouldShow() {
    return isDispensePage() && hasDischargeMedicationCell();
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

  /* ─────────────────────────────────────────────
   * Button target — same dispense toolbar span as the
   * Medication Sticker button (content-med-sticker.js).
   * ───────────────────────────────────────────── */
  const TOOLBAR_SPAN_SEL =
    "body > div.full-height.ng-scope.layout-row > div > md-content > md-content" +
    " > div > md-card > md-content.md-whiteframe-z2.padding-left-14-imp.margin-5" +
    ".stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme" +
    ".width-70-per > div.ng-isolate-scope.flex-initial > div.margin-top-7-imp.layout-row > span";

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

  async function handleClick() {
    if (_sending) return;
    _sending = true;

    // Make sure the tap is installed, then extract. The tap only captures
    // requests fired AFTER installation, so on a cold click we retry briefly
    // to give the workbench a chance to issue a tapped XHR.
    ensureXhrTap();

    // We need patientvisituid AND the session UIDs (loginuid/roleuid/org) for
    // Jasper to authenticate the report. The tap captures them from requests
    // fired after install, so retry briefly to let them arrive.
    const _hasPatient = (c) => c && c.patientuid && c.patientvisituid;
    const _hasAuth    = (c) => c && c.loginuid;
    let context = null;
    try {
      for (let attempt = 0; attempt < 8; attempt++) {
        context = await extractContext();
        if (_hasPatient(context) && _hasAuth(context)) break;
        await new Promise((r) => setTimeout(r, 400));
      }
    } catch (e) {
      _sending = false;
      console.error("[HM] context extraction failed:", e);
      alert("ไม่สามารถอ่านข้อมูลผู้ป่วยได้ กรุณาลองใหม่อีกครั้ง");
      return;
    }

    if (!_hasPatient(context)) {
      _sending = false;
      alert("ไม่พบ patientvisituid ของผู้ป่วย\n\nกรุณาคลิกเลือกผู้ป่วยในรายการ (worklist) หรือสลับแท็บ DISPENSING ใหม่อีกครั้ง แล้วกดปุ่มซ้ำ");
      return;
    }
    if (!_hasAuth(context)) {
      // Patient ids present but no session uid captured yet — let the user know;
      // the report will likely bounce to the Jasper login page without it.
      console.warn("[home-med] proceeding without loginuid — Jasper auth may fail", context);
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

    try {
      chrome.runtime
        .sendMessage({ type: MSG.LOAD_MED_TABLE, context })
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

  /* ─────────────────────────────────────────────
   * Inject / remove button (idempotent, page-level)
   * ───────────────────────────────────────────── */
  function syncButton() {
    const span = document.querySelector(TOOLBAR_SPAN_SEL);
    const existing = span && span.querySelector(".hm-sheet-btn");

    if (!shouldShow()) {
      if (existing) existing.remove();
      return;
    }

    if (!span || existing) return;

    const btn = createIconButton({
      icon:      "🏠💊",
      title:     "Open Home Medication Sheet (Discharge)",
      className: "hm-sheet-btn",
      onClick:   handleClick,
    });

    span.appendChild(btn);
  }

  // Install the XHR tap as soon as we're on the dispense workbench so it
  // captures the patient ids before the pharmacist clicks the button.
  function syncAll() {
    if (isDispensePage()) ensureXhrTap();
    syncButton();
  }

  syncAll();

  new MutationObserver(syncAll).observe(document.body, {
    childList: true,
    subtree:   true,
  });

  window.addEventListener("hashchange", syncAll);
  window.addEventListener("popstate",   syncAll);
})();
