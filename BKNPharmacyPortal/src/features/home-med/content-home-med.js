// src/features/home-med/content-home-med.js
// Injected into: arcusair.bdms.co.th  (inpatient/dischargeprocess route)
"use strict";

(function () {
  if (window.__HM_SHEET_LOADED__) return;
  window.__HM_SHEET_LOADED__ = true;

  const { createIconButton } = window.CoreDom;
  const { MSG }              = window.CoreMessages;
  const { parseFromBanner }  = window.ParserHomeMed;

  /* ─────────────────────────────────────────────
   * Selector for the dialog toolbar span where
   * the button is appended.
   * ───────────────────────────────────────────── */
  const TOOLBAR_SPAN_SEL =
    "body > div.md-dialog-container.ng-scope > md-dialog > form > md-toolbar > div > span";

  /* ─────────────────────────────────────────────
   * Scrape the medication <table> from the open dialog.
   * Returns raw outerHTML or null.
   * ───────────────────────────────────────────── */
  function getMedTableHTML() {
    const dialog = document.querySelector("div.md-dialog-container md-dialog");
    if (!dialog) return null;
    const table = dialog.querySelector("table");
    return table ? table.outerHTML : null;
  }

  /* ─────────────────────────────────────────────
   * Read the logged-in pharmacist name from the
   * Arcus top toolbar user menu button span.
   * ───────────────────────────────────────────── */
  function getPharmacistName() {
    const el = document.querySelector(
      "body > div.full-height.ng-scope.layout-row > div > md-toolbar > div > md-menu:nth-child(9) > button > span"
    );
    return el ? (el.textContent || el.innerText || "").trim() : null;
  }

  /* ─────────────────────────────────────────────
   * Button click handler
   * ───────────────────────────────────────────── */
  let _sending = false;

  function handleClick() {
    if (_sending) return;
    _sending = true;

    const tableHTML      = getMedTableHTML();
    const patientData    = parseFromBanner();
    const pharmacistName = getPharmacistName();

    if (!tableHTML) {
      _sending = false;
      alert("Medication table not found.");
      return;
    }

    try {
      chrome.runtime
        .sendMessage({ type: MSG.LOAD_MED_TABLE, tableHTML, patientData, pharmacistName })
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
   * Inject button into the dialog toolbar (idempotent)
   * ───────────────────────────────────────────── */
  function tryInsertButton() {
    if (!location.hash.includes("inpatient/dischargeprocess")) return;

    const span = document.querySelector(TOOLBAR_SPAN_SEL);
    if (!span) return;
    if (span.querySelector(".hm-sheet-btn")) return;

    const btn = createIconButton({
      icon:      "🏠💊",
      title:     "Open Home Medication Sheet",
      className: "hm-sheet-btn",
      onClick:   handleClick,
    });

    span.appendChild(btn);
  }

  tryInsertButton();

  new MutationObserver(tryInsertButton).observe(document.body, {
    childList: true,
    subtree:   true,
  });
})();
