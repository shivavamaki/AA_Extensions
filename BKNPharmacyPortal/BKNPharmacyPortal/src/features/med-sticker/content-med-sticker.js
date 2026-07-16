// src/features/med-sticker/content-med-sticker.js
// Injected into: arcusair.bdms.co.th  (pharmacy/dispenseworkbench route)
"use strict";

(function () {
  if (window.__STICKER_LOADED__) return;
  window.__STICKER_LOADED__ = true;

  const { createIconButton } = window.CoreDom;
  const { MSG }              = window.CoreMessages;
  const { parseRows }        = window.ParserOrderTable;

  function getOrCreateDispenseToolGroup() {
    // Single source of truth: patient-sticker's #paprint group. Do NOT build a
    // second group in the toolbar span — that produced duplicate 💊 groups on
    // the dispense workbench (which has both anchors). If the shared group does
    // not exist yet, bail and wait for the next observer tick.
    const sharedFactory = document[Symbol.for("__BKN_TOOL_GROUP_FACTORY__")];
    if (typeof sharedFactory === "function") return sharedFactory();
    return document.querySelector(".bkn-tool-group");
  }

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
    const group = getOrCreateDispenseToolGroup();
    const flyout = group?.querySelector(".bkn-tool-flyout");
    if (!flyout) return;

    let btn = document.querySelector(".print-sticker-btn");
    if (!btn) {
      btn = createIconButton({
        icon:      "🌐✨",
        title:     "Open Medication Sticker",
        className: "print-sticker-btn",
        onClick:   handleClick,
      });
    }

    if (btn.parentElement !== flyout || btn !== flyout.firstElementChild) {
      flyout.insertBefore(btn, flyout.firstChild);
    }
  }

  tryInsertButton();

  // Debounce to one run per animation frame. The handler mutates the DOM, which
  // would otherwise re-trigger this observer synchronously on every Angular
  // re-render — pegging the CPU and freezing the dispense workbench.
  let _scheduled = false;
  new MutationObserver(() => {
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(() => {
      _scheduled = false;
      tryInsertButton();
    });
  }).observe(document.body, { childList: true, subtree: true });

  window.addEventListener("hashchange", tryInsertButton);
  window.addEventListener("popstate",   tryInsertButton);
})();
