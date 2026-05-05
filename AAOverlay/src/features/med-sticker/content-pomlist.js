// src/features/med-sticker/content-pomlist.js
// Injects translation button on pomlist (Patient Own Medication) page:
// #!/pharmacy/dispenseworkbench/pharmacy/pomlist
"use strict";

(function () {
  if (window.__POMLIST_TRANSLATE_LOADED__) return;
  window.__POMLIST_TRANSLATE_LOADED__ = true;

  const { createIconButton } = window.CoreDom;
  const { MSG }              = window.CoreMessages;

  /* ── Route guard ─────────────────────────────────────────────── */
  function isPomlistPage() {
    return location.hash.includes("pharmacy/dispenseworkbench/pharmacy/pomlist");
  }

  /* ── Button target: same toolbar pattern as dispense page ────── */
  // Try progressively broader selectors — pomlist toolbar may differ
  const TOOLBAR_SELS = [
    // Same stickydiv toolbar as dispense page
    "body > div.full-height.ng-scope.layout-row > div > md-content > md-content" +
    " > div > md-card > md-content.md-whiteframe-z2.padding-left-14-imp.margin-5" +
    ".stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme" +
    ".width-70-per > div.ng-isolate-scope.flex-initial > div.margin-top-7-imp.layout-row > span",
    // Fallback: any span in that stickydiv toolbar row
    ".stickydiv .layout-row > span",
    // Broader fallback: first toolbar span in md-card
    "md-card .layout-row > span",
  ];

  function findToolbarSpan() {
    for (const sel of TOOLBAR_SELS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  /* ── Click handler ───────────────────────────────────────────── */
  let _sending = false;

  function handleClick() {
    if (_sending) return;
    _sending = true;

    // Use the same parseRows() as the dispense page —
    // it reads #ordertable with normalised headers that page-med-sticker.js expects
    const rows = window.ParserOrderTable ? window.ParserOrderTable.parseRows() : [];

    if (!rows.length) {
      _sending = false;
      alert("Order table not found or empty on POM list.\nMake sure a patient is selected.");
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
        console.error("[HM] pomlist sendMessage failed:", e);
      }
    }
  }

  /* ── Inject button (idempotent) ──────────────────────────────── */
  function tryInsert() {
    if (!isPomlistPage()) return;

    const span = findToolbarSpan();
    if (!span) return;
    if (span.querySelector(".print-sticker-pomlist-btn")) return;

    const btn = createIconButton({
      icon:      "🌐✨",
      title:     "Open Medication Sticker (POM List)",
      className: "print-sticker-pomlist-btn",
      onClick:   handleClick,
    });

    span.appendChild(btn);
  }

  tryInsert();
  new MutationObserver(tryInsert).observe(document.body, {
    childList: true,
    subtree:   true,
  });

})();
