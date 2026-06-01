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
  const DISPENSE_HASH = "#!/pharmacy/dispenseworkbench/pharmacy/dispense";

  function isDispensePage() {
    return location.origin === "https://arcusair.bdms.co.th"
      && (location.hash || "").split("?")[0] === DISPENSE_HASH;
  }

  /* ─────────────────────────────────────────────
   * Target span where the button is appended
   * ───────────────────────────────────────────── */
  const TOOLBAR_SPAN_SEL =
    "body > div.full-height.ng-scope.layout-row > div > md-content > md-content" +
    " > div > md-card > md-content.md-whiteframe-z2.padding-left-14-imp.margin-5" +
    ".stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme" +
    ".width-70-per > div.ng-isolate-scope.flex-initial > div.margin-top-7-imp.layout-row > span";

  function getToolbarSpan() {
    return document.querySelector(TOOLBAR_SPAN_SEL);
  }

  function getOrCreateDispenseToolGroup() {
    const span = getToolbarSpan();
    if (!span) return null;

    let group = span.querySelector(":scope > .bkn-tool-group");
    if (group) {
      group.classList.add("bkn-dispense-tool-group");
      return group;
    }

    group = document.createElement("span");
    group.className = "bkn-tool-group bkn-dispense-tool-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "BKN Pharmacy tools");

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "bkn-tool-trigger";
    trigger.title = "BKN Pharmacy tools";
    trigger.textContent = "💊";
    trigger.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });

    const flyout = document.createElement("span");
    flyout.className = "bkn-tool-flyout";

    group.appendChild(trigger);
    group.appendChild(flyout);
    span.appendChild(group);
    return group;
  }

  function cleanupDispenseToolGroup() {
    const group = getToolbarSpan()?.querySelector(":scope > .bkn-dispense-tool-group");
    const flyout = group?.querySelector(".bkn-tool-flyout");
    if (group && flyout && !flyout.children.length) group.remove();
  }

  function removeStickerButton() {
    document.querySelectorAll(".print-sticker-btn").forEach((btn) => btn.remove());
    cleanupDispenseToolGroup();
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
    if (!isDispensePage()) {
      removeStickerButton();
      return;
    }

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

  new MutationObserver(tryInsertButton).observe(document.body, {
    childList: true,
    subtree:   true,
  });

  window.addEventListener("hashchange", tryInsertButton);
  window.addEventListener("popstate",   tryInsertButton);
})();
