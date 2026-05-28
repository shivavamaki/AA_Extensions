/* ── content-medication-journey.js ────────────────────────────────────────
   Entry-point content script for the Medication Journey feature.
   Injects a button on the ArcusAir order-profile page and orchestrates
   data extraction, Jasper XLS fetching, and page opening.
──────────────────────────────────────────────────────────────────────────── */
"use strict";
(function () {
  /* Guard against duplicate injection across SPA navigations */
  const GUARD = Symbol.for("__ARCUS_MEDJ2__");
  if (window[GUARD]) return;
  window[GUARD] = true;

  /* Install XHR/fetch tap in MAIN world as early as possible so it captures
     API calls made during SPA navigation before the button is clicked */
  try { chrome.runtime.sendMessage({ type: "MJ_SETUP_XHR_TAP" }); } catch (_) {}

  /* ── Status toast ────────────────────────────────────────────────────── */
  const TOAST_COLORS = {
    info: "#1565c0",
    warn: "#e65100",
    err:  "#c62828",
    ok:   "#2e7d32",
  };
  let _currentToast = null;

  function _showStatus(msg, type) {
    type = type || "info";
    if (_currentToast && _currentToast.parentNode) {
      _currentToast.parentNode.removeChild(_currentToast);
    }
    const el = document.createElement("div");
    el.id = "arcus-medj-toast2";
    Object.assign(el.style, {
      position:    "fixed",
      top:         "16px",
      right:       "16px",
      zIndex:      "2147483647",
      background:  TOAST_COLORS[type] || TOAST_COLORS.info,
      color:       "#fff",
      padding:     "10px 18px",
      borderRadius:"8px",
      fontSize:    "13px",
      fontFamily:  "Segoe UI, Arial, sans-serif",
      fontWeight:  "600",
      boxShadow:   "0 4px 16px rgba(0,0,0,.28)",
      maxWidth:    "340px",
      lineHeight:  "1.5",
      transition:  "opacity .3s",
      opacity:     "1",
    });
    el.textContent = msg;
    document.body.appendChild(el);
    _currentToast = el;

    if (type === "ok" || type === "err") {
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
        if (_currentToast === el) _currentToast = null;
      }, 4000);
    }
  }

  /* ── Click handler ───────────────────────────────────────────────────── */
  async function _onMedicationJourneyClick() {
    const NS = window.MedicationJourney;
    if (!NS) {
      _showStatus("ข้อผิดพลาด: ไม่พบ MedicationJourney namespace", "err");
      return;
    }

    try {
      /* Step 1: Extract patient context */
      _showStatus("⏳ กำลังดึงข้อมูลผู้ป่วย...", "info");
      const context = NS.extractArcusPatientContext();

      /* Step 1b: Augment with Angular MAIN-world context (script injection) */
      try {
        const pageCtx = await NS.extractAngularContextFromPage();
        const sp = pageCtx.stateParams || {};
        const uc = pageCtx.userCtx    || {};
        const pc = pageCtx.patientCtx || {};

        const _m = (key, val) => { if (!context[key] && val) context[key] = val; };
        /* From stateParams */
        _m("patientuid",        sp.patientuid        || sp.patientUid);
        _m("patientvisituid",   sp.patientvisituid   || sp.patientVisitUid || sp.visituid);
        _m("loginuid",          sp.loginuid          || sp.loginUid);
        _m("roleuid",           sp.roleuid           || sp.roleUid);
        _m("organisationuid",   sp.organisationuid   || sp.orguid);
        _m("parentorguid",      sp.parentorguid      || sp.parentOrguid);
        _m("logindepartmentuid",sp.logindepartmentuid|| sp.deptuid);
        _m("_pp",               sp.pp);
        /* From UserContext */
        _m("loginuid",          uc.loginuid);
        _m("roleuid",           uc.roleuid);
        _m("organisationuid",   uc.organisationuid);
        _m("parentorguid",      uc.parentorguid);
        _m("logindepartmentuid",uc.logindepartmentuid);
        _m("_pp",               uc._pp);
        _m("pharmacistName",    uc.pharmacistName);
        /* From patient scope object */
        _m("patientuid",        pc.patientuid);
        _m("patientvisituid",   pc.patientvisituid);
        _m("patientId",         pc.patientId);
        _m("hn",                pc.patientId);
        _m("patientVisitId",    pc.patientVisitId);
        _m("an",                pc.patientVisitId);
        _m("patientName",       pc.patientName);

        /* Debug */
        const ok = context.patientuid && context.patientvisituid && context.loginuid;
        console.group("[ADR Timeline] context after merge");
        console.log("patientuid      :", context.patientuid       || "⚠️ MISSING");
        console.log("patientvisituid :", context.patientvisituid  || "⚠️ MISSING");
        console.log("loginuid        :", context.loginuid         || "⚠️ MISSING");
        console.log("canFetchJasper  :", ok ? "✅ YES" : "❌ NO");
        console.log("$stateParams        :", pageCtx._raw && pageCtx._raw.stateParams);
        console.log("LastUIStateParams   :", pageCtx._raw && pageCtx._raw.LastUIStateParams);
        console.log("AutoLoginStateParams:", pageCtx._raw && pageCtx._raw.AutoLoginStateParams);
        console.log("UserContext         :", pageCtx._raw && pageCtx._raw.UserContext);
        console.log("error               :", pageCtx._error || "(none)");
        console.groupEnd();
      } catch (_) { /* silent */ }

      /* Step 2: Parse HTML order table */
      _showStatus("⏳ กำลังอ่านรายการยาจากหน้า...", "info");
      let orders       = [];
      let usedJasper   = false;
      let usedHtmlFb   = false;
      let usedMock     = false;

      const rawHtml   = NS.parseOrderProfileTable(document);
      const htmlOrders = NS.normalizeMedicationOrders(rawHtml);

      /* Step 3: Build Jasper URL */
      const jasperUrl = NS.buildMedicationReviewUrl(context);

      /* Step 4: Try Jasper XLS — full context preferred, partial (no patientuid) allowed */
      const hasFullCtx    = !!(context.patientuid && context.patientvisituid && context.loginuid);
      const hasPartialCtx = !!(context.patientvisituid && context.loginuid);
      const canFetchJasper = hasFullCtx || hasPartialCtx;
      if (canFetchJasper) {
        try {
          _showStatus(hasFullCtx ? "⏳ กำลังดึงรายงานจาก Jasper..." : "⚠️ ไม่พบ patientuid — กำลังลองดึงรายงาน...", hasFullCtx ? "info" : "warn");
          const buffer = await NS.fetchMedicationReviewXls(jasperUrl);
          if (buffer) {
            const sheets   = NS.parseBiff8ToSheets(buffer);
            const rawXls   = NS.parseJasperXlsOrders(sheets);
            const xlsOrders = NS.normalizeMedicationOrders(rawXls);
            if (xlsOrders.length > 0) {
              orders     = xlsOrders;
              usedJasper = true;
            }
          }
        } catch (_) { /* fall through silently */ }
      }

      /* Step 5: Fallback to HTML orders */
      if (!usedJasper) {
        if (htmlOrders.length > 0) {
          orders     = htmlOrders;
          usedHtmlFb = true;
        }
      }

      /* Step 6: No data — show actionable error, do NOT use mock data */
      if (orders.length === 0) {
        const noCtx = !hasPartialCtx;
        const msg = noCtx
          ? "ไม่พบข้อมูลผู้ป่วย (patientuid / loginuid)\nกรุณาเปิดหน้า Orders ของผู้ป่วยก่อน แล้วลองใหม่อีกครั้ง"
          : "ดึงข้อมูลยาไม่ได้ — Jasper ไม่ตอบสนองหรือไม่มีรายการยา\nกรุณารอสักครู่แล้วกดปุ่มอีกครั้ง";
        _showStatus("❌ " + msg.split("\n")[0], "err");
        /* Persistent overlay with retry hint */
        const overlay = document.createElement("div");
        overlay.id = "arcus-medj-err-overlay";
        Object.assign(overlay.style, {
          position: "fixed", top: "60px", right: "16px", zIndex: "2147483647",
          background: "#fff", border: "1.5px solid #c62828", borderRadius: "10px",
          padding: "18px 22px", maxWidth: "320px", boxShadow: "0 4px 20px rgba(0,0,0,.2)",
          fontFamily: "Segoe UI, Arial, sans-serif", fontSize: "13px", lineHeight: "1.6",
          color: "#1a1a2e",
        });
        overlay.innerHTML =
          `<div style="font-weight:800;color:#c62828;margin-bottom:8px">❌ ไม่พบข้อมูลยา</div>` +
          `<div style="white-space:pre-line;margin-bottom:12px">${msg}</div>` +
          `<div style="display:flex;gap:8px">` +
            `<button id="arcus-medj-retry-btn" style="flex:1;padding:6px 0;border-radius:16px;border:1.5px solid #4caf50;background:#e8f5e9;color:#1b5e20;font-weight:700;cursor:pointer;font-size:12px">🔄 ลองใหม่</button>` +
            `<button id="arcus-medj-close-err-btn" style="padding:6px 12px;border-radius:16px;border:1.5px solid #bdbdbd;background:#f5f5f5;color:#546e7a;font-weight:700;cursor:pointer;font-size:12px">✕</button>` +
          `</div>`;
        /* Remove existing overlay if any */
        const existing = document.getElementById("arcus-medj-err-overlay");
        if (existing) existing.remove();
        document.body.appendChild(overlay);
        document.getElementById("arcus-medj-close-err-btn").onclick = function () { overlay.remove(); };
        document.getElementById("arcus-medj-retry-btn").onclick = function () { overlay.remove(); _onMedicationJourneyClick(); };
        return; /* abort — do not open the timeline page */
      }

      /* Step 7: Create journey */
      _showStatus("⏳ กำลังสร้าง ADR Timeline...", "info");
      const journey = NS.createMedicationJourney(orders, context);
      journey.source.medicationReviewUrl = jasperUrl;
      journey.source.usedJasperXls       = usedJasper;
      journey.source.usedHtmlFallback    = usedHtmlFb;
      journey.source.usedMock            = usedMock;

      /* Step 7.5: Fetch eMAR crosstab for oral administration times */
      if (hasPartialCtx) {
        try {
          _showStatus("⏳ กำลังดึงข้อมูลการบริหารยา (eMAR)...", "info");
          const emarUrl = NS.buildEmarCrosstabUrl(context);
          const emarBuf = await NS.fetchMedicationReviewXls(emarUrl);
          if (emarBuf) {
            const emarSheets = NS.parseBiff8ToSheets(emarBuf);
            const adminTimes = NS.parseEmarCrosstabAdminTimes(emarSheets);
            if (adminTimes.length > 0) {
              journey.adminTimes           = adminTimes;
              journey.source.emarCrosstabUrl = emarUrl;
            }
          }
        } catch (_) { /* silent fallback — admin ticks simply won't appear */ }
      }

      /* Step 8: Open page */
      NS.openMedicationJourneyPage(journey);
      _showStatus("✓ เปิด ADR Timeline แล้ว!", "ok");

    } catch (err) {
      _showStatus("ข้อผิดพลาด: " + String(err.message || err), "err");
    }
  }

  /* ── Button injection ────────────────────────────────────────────────── */
  const ANCHOR_SEL = "#paprint";

  function _isOrdersPage() {
    return (window.location.hash || "").includes("/emr/emrview/emr/orders");
  }

  function _injectButton() {
    if (document.getElementById("arcus-medj-btn2")) return;
    if (!_isOrdersPage()) return;

    const anchor = document.querySelector(ANCHOR_SEL);
    if (!anchor) return;

    const btn = document.createElement("button");
    btn.id          = "arcus-medj-btn2";
    btn.textContent = "📊";
    Object.assign(btn.style, {
      background:   "#e8f5e9",
      border:       "1.5px solid #4caf50",
      color:        "#1b5e20",
      borderRadius: "50%",
      padding:      "4px 7px",
      fontSize:     "14px",
      cursor:       "pointer",
      fontFamily:   "Segoe UI, Arial, sans-serif",
      lineHeight:   "1",
      verticalAlign: "middle",
      marginLeft:   "6px",
      transition:   "background .15s",
    });
    btn.title = "ADR Timeline";
    btn.addEventListener("mouseenter", function () { btn.style.background = "#c8e6c9"; });
    btn.addEventListener("mouseleave", function () { btn.style.background = "#e8f5e9"; });
    btn.addEventListener("click", _onMedicationJourneyClick);

    anchor.insertAdjacentElement("afterend", btn);
  }

  function _removeButton() {
    const existing = document.getElementById("arcus-medj-btn2");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function _onNavChange() {
    if (!_isOrdersPage()) {
      _removeButton();
    } else {
      setTimeout(_injectButton, 600);
    }
  }

  /* Patch pushState / replaceState */
  (function () {
    const _push    = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);
    history.pushState    = function () { _push.apply(history, arguments);    _onNavChange(); };
    history.replaceState = function () { _replace.apply(history, arguments); _onNavChange(); };
  })();

  window.addEventListener("hashchange", _onNavChange);
  window.addEventListener("popstate",   _onNavChange);

  /* MutationObserver — retry injection when Angular renders the tab bar */
  const _observer = new MutationObserver(function () {
    if (_isOrdersPage() && !document.getElementById("arcus-medj-btn2")) {
      _injectButton();
    }
  });
  _observer.observe(document.body, { childList: true, subtree: true });

  /* Initial injection */
  _injectButton();

})();
