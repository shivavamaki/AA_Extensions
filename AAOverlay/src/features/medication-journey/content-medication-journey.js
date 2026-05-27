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

      /* Step 4: Try Jasper XLS if we have enough context */
      const canFetchJasper = context.patientuid && context.patientvisituid && context.loginuid;
      if (canFetchJasper) {
        try {
          _showStatus("⏳ กำลังดึงรายงานจาก Jasper...", "info");
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

      /* Step 6: Last resort — mock data */
      if (orders.length === 0) {
        orders   = NS.normalizeMedicationOrders(NS.MOCK_ORDERS);
        usedMock = true;
      }

      /* Step 7: Create journey */
      _showStatus("⏳ กำลังสร้าง Medication Journey...", "info");
      const journey = NS.createMedicationJourney(orders, context);
      journey.source.medicationReviewUrl = jasperUrl;
      journey.source.usedJasperXls       = usedJasper;
      journey.source.usedHtmlFallback    = usedHtmlFb;
      journey.source.usedMock            = usedMock;

      /* Step 8: Open page */
      NS.openMedicationJourneyPage(journey);
      _showStatus("✓ เปิด Medication Journey แล้ว!", "ok");

    } catch (err) {
      _showStatus("ข้อผิดพลาด: " + String(err.message || err), "err");
    }
  }

  /* ── Button injection ────────────────────────────────────────────────── */
  function _injectButton() {
    if (document.getElementById("arcus-medj-btn2")) return;

    /* Only inject on the orders page */
    if (!window.location.href.includes("emr/emrview/emr/orders") &&
        !window.location.hash.includes("emr/orders")) {
      return;
    }

    /* Find toolbar */
    const toolbarSelectors = [
      "div[class*='groupbylist']",
      "div.groupbylist",
      ".order-toolbar",
      ".toolbar-container",
      "[ng-controller*='order'] .btn-toolbar",
      ".md-toolbar-tools",
      ".layout-row.layout-align-start-center",
    ];

    let toolbar = null;
    for (const sel of toolbarSelectors) {
      toolbar = document.querySelector(sel);
      if (toolbar) break;
    }
    if (!toolbar) return;

    const btn = document.createElement("button");
    btn.id          = "arcus-medj-btn2";
    btn.textContent = "💊 Medication Journey";
    Object.assign(btn.style, {
      background:   "#e8f5e9",
      border:       "1.5px solid #4caf50",
      color:        "#1b5e20",
      borderRadius: "20px",
      padding:      "5px 14px",
      fontSize:     "12px",
      fontWeight:   "700",
      cursor:       "pointer",
      marginLeft:   "8px",
      fontFamily:   "Segoe UI, Arial, sans-serif",
      whiteSpace:   "nowrap",
      lineHeight:   "1.4",
      transition:   "background .15s",
    });
    btn.title = "แสดง Medication Journey";
    btn.addEventListener("mouseenter", function () { btn.style.background = "#c8e6c9"; });
    btn.addEventListener("mouseleave", function () { btn.style.background = "#e8f5e9"; });
    btn.addEventListener("click", _onMedicationJourneyClick);

    toolbar.appendChild(btn);
  }

  /* ── SPA navigation handling ─────────────────────────────────────────── */
  function _removeButton() {
    const existing = document.getElementById("arcus-medj-btn2");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  function _onNavChange() {
    _removeButton();
    /* Small delay to let Angular render the new page */
    setTimeout(_injectButton, 600);
  }

  /* Patch pushState / replaceState */
  (function () {
    const _push    = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);
    history.pushState = function () {
      _push.apply(history, arguments);
      _onNavChange();
    };
    history.replaceState = function () {
      _replace.apply(history, arguments);
      _onNavChange();
    };
  })();

  window.addEventListener("hashchange", _onNavChange);
  window.addEventListener("popstate",   _onNavChange);

  /* MutationObserver to catch Angular-driven DOM changes */
  const _observer = new MutationObserver(function () {
    if (!document.getElementById("arcus-medj-btn2")) {
      _injectButton();
    }
  });
  _observer.observe(document.body, { childList: true, subtree: true });

  /* Initial injection */
  _injectButton();

})();
