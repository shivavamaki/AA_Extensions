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

  /** Gate by page DOM, not URL; ArcusAir hash routing can change during SPA navigation. */
  function shouldShow() {
    return hasDischargeMedicationCell();
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

        // medreconcileuid for THIS visit, captured when the pharmacist opened
        // the Med Reconcile screen earlier this session (keyed by visituid).
        const mrMap = (pageCtx._raw && pageCtx._raw.medreconMap) || {};
        if (ctx.patientvisituid && mrMap[ctx.patientvisituid]) {
          ctx.medreconcileuid = mrMap[ctx.patientvisituid];
        }

        // Fallback: the HM Process workstation's "Med Reconcile" step (▶ Run,
        // src/features/hmr/content-hmr.js) captures + persists medreconcileuid
        // to the HMR server record — reuse it here if this session never
        // opened ArcusAir's Med Reconcile screen itself (e.g. a different
        // workstation ran the capture earlier today).
        if (!ctx.medreconcileuid && (ctx.hn || ctx.patientId) && window.BKNData && window.BKNData.serverFetch) {
          try {
            const hn = ctx.hn || ctx.patientId;
            const to = new Date().toISOString().slice(0, 10);
            const from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
            const r = await window.BKNData.serverFetch(`/api/hmr?from=${from}&to=${to}`);
            const list = (r && r.ok && Array.isArray(r.json)) ? r.json : [];
            const rec = list.find((d) => d.medreconcileuid && norm(d.hn || "") === norm(hn));
            if (rec) ctx.medreconcileuid = rec.medreconcileuid;
          } catch (_) { /* best-effort */ }
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

    // Diagnosis is only in the page DOM (not the API) — read it now.
    try {
      const dx = readDiagnosis();
      if (dx) context.diagnosis = dx;
    } catch (_) { /* non-fatal */ }

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
        .sendMessage({ type: _msgType, context })
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
  function handleSheetClick()   { _msgType = MSG.LOAD_MED_TABLE;   handleClick(); }
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
      icon: "🏠💊", title: "Open Home Medication Sheet (Discharge)",
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
