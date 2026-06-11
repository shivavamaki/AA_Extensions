// src/features/med-sticker/content-med-sticker.js
// Injected into: arcusair.bdms.co.th  (pharmacy/dispenseworkbench route)
"use strict";

(function () {
  if (window.__STICKER_LOADED__) return;
  window.__STICKER_LOADED__ = true;

  const { createIconButton } = window.CoreDom;
  const { MSG }              = window.CoreMessages;
  const { parseRows }        = window.ParserOrderTable;

  /* ─────────────────────────────────────────────
   * Route guard
   * ───────────────────────────────────────────── */
  function isDispensePage() {
    return location.hash.includes("pharmacy/dispenseworkbench/pharmacy/dispense");
  }

  /* ─────────────────────────────────────────────
   * Target span where the button is appended
   * ───────────────────────────────────────────── */
  const TOOLBAR_SPAN_SEL =
    "body > div.full-height.ng-scope.layout-row > div > md-content > md-content" +
    " > div > md-card > md-content.md-whiteframe-z2.padding-left-14-imp.margin-5" +
    ".stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme" +
    ".width-70-per > div.ng-isolate-scope.flex-initial > div.margin-top-7-imp.layout-row > span";

  /* ─────────────────────────────────────────────
   * Button click handler
   * ───────────────────────────────────────────── */
  let _sending = false;

  function handleClick() {
    if (_sending) return;
    _sending = true;

    const rows = parseRows();

    if (!rows.length) {
      _sending = false;
      alert("Order table not found or empty.");
      return;
    }

    try {
      chrome.runtime.sendMessage(
        { type: MSG.OPEN_STICKER, rows },
        () => {
          void chrome.runtime.lastError;
          setTimeout(() => (_sending = false), 300);
        }
      );
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
   * Inject button (idempotent)
   * ───────────────────────────────────────────── */
  function tryInsertButton() {
    if (!isDispensePage()) return;

    const span = document.querySelector(TOOLBAR_SPAN_SEL);
    if (!span) return;
    if (span.querySelector(".print-sticker-btn")) return;

    const btn = createIconButton({
      icon:      "🌐✨",
      title:     "Open Medication Sticker",
      className: "print-sticker-btn",
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
