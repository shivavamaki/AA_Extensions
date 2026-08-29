(() => {
  if (window.__ARCUS_SHARED_LOADED__) return;
  window.__ARCUS_SHARED_LOADED__ = true;

  // Arcus Toolkit v3.10.0
  // Phase 1 upgrade: selector fallback helper, structured debug store, and safer click helpers.

  const CONFIG = {
    routes: {
      dispenseWorkbenchPrefix:
        "https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/",
      dispenseWorkbench:
        "#!/pharmacy/dispenseworkbench/pharmacy/dispense",
      allocateDispense: "#!/pharmacy/allocatedispense",
      dispenseToDept: "#!/pharmacy/dispensetodept",
    },

    containerSelectors: [
      "body > div.full-height.ng-scope.layout-row > div > md-content > md-content > div > md-card > md-content > div",
      "md-card md-content > div",
      "md-table-container",
    ],

    rowCandidateSelectors: [
      ":scope > *",
      ":scope > div",
      ":scope > md-list-item",
      ":scope > .layout-row",
      ":scope > .row",
      ":scope > tr",
      "md-table-container tbody > tr",
      "tbody > tr",
    ],

    actionSelectors: {
      allocateFromWorkbench: "#allocatedispense",
      dispenseFromWorkbench: "#dispensetodept",

      allocateSaveButton: [
        "#actiondiv > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple",
        "#actiondiv button.md-primary",
        "button.md-primary[ng-click*='save']",
        "button.md-primary",
      ],

      dispenseToDeptSaveButton: [
        "body > div.full-height.ng-scope.layout-row > div > md-content > md-card > md-card-content > div.layout-xs-column.layout-sm-column.layout-row > div > div > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple",
        "#actiondiv button.md-primary",
        "md-card-content button.md-primary",
        "button.md-primary[ng-click*='save']",
        "button.md-primary",
      ],

      overrideSaveButton: [
        "body > div.md-dialog-container.ng-scope > md-dialog > form > md-dialog-actions > div > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple",
        ".md-dialog-container md-dialog md-dialog-actions button.md-primary",
        "md-dialog md-dialog-actions button.md-primary",
      ],

      closeToolbarIcon: [
        "body > div.md-dialog-container.ng-scope > md-dialog > form > md-toolbar > div > button > md-icon",
        ".md-dialog-container md-toolbar button md-icon",
        "md-dialog md-toolbar button",
      ],

      closeBtn: "#closeBtn",
      hideAllAlerts: "#hideAllAlerts",
      alertViewedButtons: "button[id^='dontshow']",
    },

    genericDialogSelectors: [
      "body > div.md-dialog-container.ng-scope > md-dialog",
      "body > div.md-dialog-container > md-dialog",
      ".md-dialog-container md-dialog",
      "md-dialog",
      "[role='dialog']",
    ],

    detailPaneSelectors: [
      "body > div.full-height.ng-scope.layout-row > div > md-content > md-content > div > md-card > md-content.md-whiteframe-z2.padding-left-14-imp.margin-5.stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme.width-70-per",
      "md-content.stickydiv.incus-border-1",
      ".stickydiv.incus-border-1",
      "md-content.width-70-per",
    ],

    detailPaneCloseSelectors: [
      "body > div.full-height.ng-scope.layout-row > div > md-content > md-content > div > md-card > md-content.md-whiteframe-z2.padding-left-14-imp.margin-5.stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme.width-70-per > div.layout-row.flex-initial > button",
      ".stickydiv button",
      "md-content.stickydiv button",
    ],

    maxActionWaitMs: 18000,
    maxRouteWaitMs: 20000,
    maxDialogSettleMs: 12000,
    maxManualOverrideWaitMs: 180000,
    settleAfterRowClickMs: 400,      // reduced from 1000 — waitForDetailPaneText is the real gate
    settleAfterDialogCloseMs: 900,
    settleAfterActionClickMs: 1500,
    settleAfterSaveClickMs: 1800,
    settleAfterPaneCloseMs: 400,
    loopDelayMs: 200,                // reduced from 900 — minimal yield between rows
    autoNoMatchIntervalMs: 30000,
    rowMatchTextLength: 240,
    maxRetriesPerRow: 2,
    scrapePaneWaitMs: 5000,
    scrollLoadWaitMs: 500,           // reduced from 900 — less wait after scroll events
    maxEmptyScrollAttempts: 8,
    mouseWheelScrollSteps: 5,
    mouseWheelDeltaY: 650,
    milestoneSaveEvery: 50,
    scrollTriggerThreshold: 3,       // trigger scroll only when fewer than N unseen rows remain
  };

  const PANEL_STORAGE_KEY = "arcusAutoPanelState";
  const PANEL_DISMISSED_KEY = "arcusAutoPanelDismissed";

  const ORDER_FILTERS = {
    all: "ALL ROW",
    daily: "DAILY ORDER",
    continuous: "CONTINUOUS ORDER",
    discharge: "DISCHARGE MEDICATION",
  };

  const state = {
    isRunning: false,
    stopRequested: false,
    scraperStopRequested: false,
    stats: { processed: 0, success: 0, fail: 0 },
    logItems: [],
    settings: {
      rowFilter: "all",
      rowFilters: ["all"],
      waitManualOverride: true,
      automationMode: "auto",
    },
    panel: {
      dismissed: false,
    },
    scraper: {
      state: "idle",
      data: [],
      reason: "",
      progressText: "",
      pdpa: true,
    },
  };

  function syncScraperState() {
    window.__ARCUS_SHARED_SCRAPER_STATE__ = {
      state: state.scraper.state,
      data: state.scraper.data,
      reason: state.scraper.reason,
      progressText: state.scraper.progressText,
    };
  }

  function setPanelDismissed(value) {
    state.panel.dismissed = !!value;
    try {
      chrome.storage?.local?.set({ [PANEL_DISMISSED_KEY]: !!value });
    } catch (_) {}
  }

  function getPanelDismissed() {
    return !!state.panel.dismissed;
  }

  function restorePanelDismissed(callback) {
    try {
      chrome.storage?.local?.get(PANEL_DISMISSED_KEY, (data) => {
        state.panel.dismissed = !!data?.[PANEL_DISMISSED_KEY];
        callback?.(state.panel.dismissed);
      });
    } catch (_) {
      callback?.(state.panel.dismissed);
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function currentHref() {
    return location.href || "";
  }

  function isWorkbenchPage() {
    return currentHref().startsWith(CONFIG.routes.dispenseWorkbenchPrefix);
  }

  function isAllocatePage() {
    return currentHref().includes(CONFIG.routes.allocateDispense);
  }

  function isDispenseToDeptPage() {
    return currentHref().includes(CONFIG.routes.dispenseToDept);
  }

  function textOf(el) {
    return ((el && (el.innerText || el.textContent)) || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function shortText(value, max = 140) {
    if (!value) return "(empty)";
    return value.length > max ? value.slice(0, max) + "..." : value;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function asSelectorList(value) {
    return Array.isArray(value) ? value : [value].filter(Boolean);
  }

  function queryFirst(selectors, root = document, visibleOnly = false) {
    for (const selector of asSelectorList(selectors)) {
      try {
        const el = root.querySelector(selector);
        if (!el) continue;
        if (visibleOnly && !isVisible(el)) continue;
        return el;
      } catch (_) {}
    }
    return null;
  }

  function queryAll(selectors, root = document, visibleOnly = false) {
    const output = [];
    const seen = new Set();

    for (const selector of asSelectorList(selectors)) {
      try {
        Array.from(root.querySelectorAll(selector)).forEach((el) => {
          if (seen.has(el)) return;
          if (visibleOnly && !isVisible(el)) return;
          seen.add(el);
          output.push(el);
        });
      } catch (_) {}
    }

    return output;
  }

  function findActionButton(name, root = document) {
    return queryFirst(CONFIG.actionSelectors[name], root, true);
  }

  window.ArcusStore = window.ArcusStore || {};
  window.ArcusStore.core = { state, CONFIG, version: "3.10.0" };

  function getMainContainer() {
    for (const selector of CONFIG.containerSelectors) {
      const el = document.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function getRowTypeFromText(text) {
    const t = (text || "").toUpperCase();
    if (t.includes("DISCHARGE MEDICATION")) return "discharge";
    if (t.includes("CONTINUOUS ORDER")) return "continuous";
    if (t.includes("DAILY ORDER")) return "daily";
    return "unknown";
  }

  function getSelectedRowFilters() {
    const selected = Array.isArray(state.settings.rowFilters)
      ? state.settings.rowFilters.filter(Boolean)
      : [state.settings.rowFilter || "all"];

    if (!selected.length || selected.includes("all")) return ["all"];
    return Array.from(new Set(selected));
  }

  function getSelectedRowFilterLabel() {
    const selected = getSelectedRowFilters();
    if (selected.includes("all")) return ORDER_FILTERS.all;
    return selected.map((key) => ORDER_FILTERS[key] || key).join(" + ");
  }

  function matchesRowFilter(rowText, filterKey) {
    const selected = Array.isArray(filterKey) ? filterKey : getSelectedRowFilters();
    if (!selected.length || selected.includes("all")) return true;
    return selected.includes(getRowTypeFromText(rowText));
  }

  function getRowKeyFromText(value) {
    return shortText(String(value || "").replace(/\s+/g, " ").trim(), CONFIG.rowMatchTextLength);
  }

  function isLikelyOrderRow(el) {
    if (!(el instanceof HTMLElement)) return false;
    const txt = textOf(el);
    if (!txt) return false;

    const type = getRowTypeFromText(txt);
    if (type === "unknown") return false;

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const childOrderRows = Array.from(el.children || []).filter((child) => {
      if (!(child instanceof HTMLElement)) return false;
      const childTxt = textOf(child);
      return childTxt && getRowTypeFromText(childTxt) !== "unknown" && childTxt.length < txt.length * 0.85;
    });

    if (childOrderRows.length >= 2) return false;
    return true;
  }

  function getRawRowCandidates(container) {
    const candidates = [];
    const add = (el) => {
      if (el instanceof HTMLElement && !candidates.includes(el)) candidates.push(el);
    };

    for (const selector of CONFIG.rowCandidateSelectors) {
      try {
        Array.from(container.querySelectorAll(selector)).forEach(add);
      } catch (_) {}
    }

    try {
      Array.from(container.querySelectorAll("tr, md-list-item, div.layout-row, div[ng-repeat], div[role='row']")).forEach(add);
    } catch (_) {}

    return candidates;
  }

  function getWorkbenchRows() {
    const container = getMainContainer();
    if (!container) return [];

    let rows = getRawRowCandidates(container).filter(isLikelyOrderRow);

    const byKey = new Map();
    for (const row of rows) {
      const key = getRowKeyFromText(textOf(row));
      if (!key) continue;
      const current = byKey.get(key);
      if (!current) {
        byKey.set(key, row);
        continue;
      }

      const rowRect = row.getBoundingClientRect();
      const curRect = current.getBoundingClientRect();
      const rowArea = rowRect.width * rowRect.height;
      const curArea = curRect.width * curRect.height;
      if (rowArea > 0 && (curArea === 0 || rowArea < curArea)) byKey.set(key, row);
    }

    rows = Array.from(byKey.values());
    rows = rows.filter((row) => matchesRowFilter(textOf(row), getSelectedRowFilters()));

    rows.sort((a, b) => {
      const ar = a.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return ar.top === br.top ? ar.left - br.left : ar.top - br.top;
    });

    return rows;
  }

  function getRowSnapshots() {
    return getWorkbenchRows().map((row, index) => {
      const text = getRowKeyFromText(textOf(row));
      return {
        index,
        text,
        key: `${getRowTypeFromText(text)}::${text}`,
        rowType: getRowTypeFromText(text),
      };
    });
  }

  function findRowBySnapshot(snapshot) {
    const rows = getWorkbenchRows();
    if (!rows.length) return null;

    const targetText = snapshot.text || "";
    const exact = rows.find((row) => getRowKeyFromText(textOf(row)) === targetText);
    if (exact) return exact;

    const contains = rows.find((row) => {
      const txt = textOf(row);
      return txt.includes(targetText) || targetText.includes(txt);
    });
    if (contains) return contains;

    return rows[snapshot.index] || null;
  }

  function getScrollableCandidates() {
    const candidates = [];
    const main = getMainContainer();
    if (main) candidates.push(main);

    const selectors = [
      "md-table-container",
      "md-content",
      ".md-virtual-repeat-scroller",
      'div[style*="overflow"]',
      'div[class*="scroll"]',
      'div[class*="overflow"]',
    ];

    selectors.forEach((selector) => {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          if (el instanceof HTMLElement && !candidates.includes(el)) candidates.push(el);
        });
      } catch (_) {}
    });

    const doc = document.scrollingElement || document.documentElement;
    if (doc && !candidates.includes(doc)) candidates.push(doc);

    return candidates.filter((el) => {
      try {
        const style = getComputedStyle(el);
        const overflowY = style.overflowY || "";
        return el.scrollHeight > el.clientHeight + 10 || ["auto", "scroll", "overlay"].includes(overflowY);
      } catch (_) {
        return false;
      }
    });
  }

  function dispatchWheelLikeUser(el, deltaY = CONFIG.mouseWheelDeltaY || 650) {
    try {
      const rect = el.getBoundingClientRect?.();
      const clientX = rect ? rect.left + Math.max(5, Math.min(rect.width / 2, rect.width - 5)) : window.innerWidth / 2;
      const clientY = rect ? rect.top + Math.max(5, Math.min(rect.height / 2, rect.height - 5)) : window.innerHeight / 2;
      el.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          view: window,
          deltaY,
          deltaMode: 0,
          clientX,
          clientY,
        })
      );
    } catch (_) {}
  }

  async function scrollMainContainerToLoadMore() {
    const candidates = getScrollableCandidates();
    if (!candidates.length) return false;

    const before = candidates.map((el) => ({
      el,
      top: el.scrollTop || 0,
      height: el.scrollHeight || 0,
    }));

    const steps = CONFIG.mouseWheelScrollSteps || 5;
    const deltaY = CONFIG.mouseWheelDeltaY || 650;

    for (let step = 0; step < steps; step++) {
      for (const el of candidates) {
        // Dispatch wheel event first so Angular can intercept it
        dispatchWheelLikeUser(el, deltaY);
        try {
          const prevTop = el.scrollTop || 0;
          el.scrollTop = Math.min(prevTop + deltaY, el.scrollHeight || 0);
          // Angular md-virtual-repeat listens for "scroll" events, not "wheel".
          // Explicitly fire it so the virtual list re-evaluates visible items.
          el.dispatchEvent(new Event("scroll", { bubbles: true }));
        } catch (_) {}
      }

      window.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          view: window,
          deltaY,
          deltaMode: 0,
          clientX: window.innerWidth / 2,
          clientY: window.innerHeight / 2,
        })
      );
      window.scrollBy(0, Math.floor(deltaY * 0.6));
      window.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(180);
    }

    await sleep(CONFIG.scrollLoadWaitMs || 1200);

    return before.some(({ el, top, height }) => {
      try {
        return (el.scrollTop || 0) !== top || (el.scrollHeight || 0) !== height;
      } catch (_) {
        return false;
      }
    });
  }

  async function waitFor(fn, timeout = 10000, interval = 250) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const result = fn();
      if (result) return result;
      if (state.stopRequested) return null;
      await sleep(interval);
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (el.disabled) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  async function clickLikeUser(el) {
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    await sleep(250);

    const events = ["mouseover", "mouseenter", "mousedown", "mouseup", "click"];
    for (const type of events) {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    }

    if (typeof el.click === "function") el.click();
    return true;
  }

  function findOpenDialog() {
    for (const selector of CONFIG.genericDialogSelectors) {
      const el = document.querySelector(selector);
      if (el && el instanceof HTMLElement && isVisible(el)) return el;
    }
    return null;
  }

  function isAlertDialog(dialogEl = findOpenDialog()) {
    if (!dialogEl) return false;
    const txt = textOf(dialogEl).toLowerCase();
    return txt.includes("alerts") || !!dialogEl.querySelector(CONFIG.actionSelectors.closeBtn);
  }

  function dialogLooksLikeManualOverride(dialogEl = findOpenDialog()) {
    if (!dialogEl) return false;
    const txt = textOf(dialogEl).toLowerCase();
    const hints = ["override", "reason", "select reason", "warning override", "please select"];
    return hints.some((h) => txt.includes(h));
  }

  async function waitForWorkbenchReady() {
    const container = await waitFor(
      () => (isWorkbenchPage() && getMainContainer() ? getMainContainer() : null),
      CONFIG.maxRouteWaitMs,
      300
    );
    if (!container) return null;
    await sleep(700);
    return container;
  }

  async function waitForAllocatePageReady() {
    const saveBtn = await waitFor(() => {
      if (!isAllocatePage()) return null;
      return findActionButton("allocateSaveButton");
    }, CONFIG.maxRouteWaitMs, 300);
    if (!saveBtn) return null;
    await sleep(700);
    return saveBtn;
  }

  async function waitForDispenseToDeptPageReady() {
    const saveBtn = await waitFor(() => {
      if (!isDispenseToDeptPage()) return null;
      return findActionButton("dispenseToDeptSaveButton");
    }, CONFIG.maxRouteWaitMs, 300);
    if (!saveBtn) return null;
    await sleep(700);
    return saveBtn;
  }

  async function waitForSelectorVisible(selector, timeout = 10000) {
    return waitFor(() => queryFirst(selector, document, true), timeout, 250);
  }

  async function waitForRouteContains(routeKeyword, timeout = 12000) {
    return waitFor(() => (currentHref().includes(routeKeyword) ? currentHref() : null), timeout, 250);
  }

  async function closeAlertDialogIfPresent(logMeta = "") {
    const dialog = findOpenDialog();
    if (!dialog || !isAlertDialog(dialog)) return false;

    const closeBtn =
      (await waitForSelectorVisible(CONFIG.actionSelectors.closeBtn, 1200)) ||
      dialog.querySelector(CONFIG.actionSelectors.closeBtn) ||
      dialog.querySelector("button[aria-label='Close']");

    if (closeBtn) {
      await clickLikeUser(closeBtn);
      window.ArcusPanel?.pushLog("info", "Closed alert popup", logMeta);
      await sleep(CONFIG.settleAfterDialogCloseMs);
      await waitFor(() => !findOpenDialog(), CONFIG.maxDialogSettleMs, 250);
      return true;
    }

    return false;
  }

  async function closeGenericToolbarDialogIfPresent(logMeta = "") {
    const dialog = findOpenDialog();
    if (!dialog) return false;

    const icon = queryFirst(CONFIG.actionSelectors.closeToolbarIcon, document, true);
    if (icon) {
      await clickLikeUser(icon);
      window.ArcusPanel?.pushLog("info", "Closed toolbar dialog", logMeta);
      await sleep(CONFIG.settleAfterDialogCloseMs);
      await waitFor(() => !findOpenDialog(), CONFIG.maxDialogSettleMs, 250);
      return true;
    }

    return false;
  }

  async function acknowledgeAlertRowsIfPresent(logMeta = "") {
    const dialog = findOpenDialog();
    if (!dialog || !isAlertDialog(dialog)) return false;

    const hideAll = document.querySelector(CONFIG.actionSelectors.hideAllAlerts);
    if (hideAll && isVisible(hideAll)) {
      await clickLikeUser(hideAll);
      window.ArcusPanel?.pushLog("info", "Marked all alerts as viewed", logMeta);
      await sleep(500);
      return true;
    }

    const rowButtons = Array.from(
      dialog.querySelectorAll(CONFIG.actionSelectors.alertViewedButtons)
    ).filter(isVisible);

    for (const btn of rowButtons) {
      await clickLikeUser(btn);
      await sleep(250);
    }

    if (rowButtons.length) {
      window.ArcusPanel?.pushLog(
        "info",
        `Marked ${rowButtons.length} alert item(s) as viewed`,
        logMeta
      );
      await sleep(500);
      return true;
    }

    return false;
  }

  async function waitForManualOverrideCompletion(contextLabel = "") {
    const startedAt = Date.now();

    window.ArcusPanel?.setStatus(
      `Waiting for manual override...\nPlease select Override reason and click Save.\nSystem will continue automatically after dialog closes.`
    );
    window.ArcusPanel?.pushLog(
      "info",
      "Waiting for user to select override reason and click save",
      contextLabel
    );

    while (Date.now() - startedAt < CONFIG.maxManualOverrideWaitMs) {
      if (state.stopRequested) {
        return { ok: false, reason: "stopped while waiting manual override" };
      }

      const dialog = findOpenDialog();

      if (!dialog) {
        await sleep(1200);

        if (isAllocatePage()) {
          const saveBtn = findActionButton("allocateSaveButton");
          if (saveBtn) {
            window.ArcusPanel?.pushLog(
              "info",
              "Override dialog closed; allocate page still open",
              contextLabel
            );
            return { ok: true, reason: "manual override completed on allocate page" };
          }
        }

        if (isDispenseToDeptPage()) {
          const saveBtn = findActionButton("dispenseToDeptSaveButton");
          if (saveBtn) {
            window.ArcusPanel?.pushLog(
              "info",
              "Override dialog closed; dispense-to-dept page still open",
              contextLabel
            );
            return { ok: true, reason: "manual override completed on dispense-to-dept page" };
          }
        }

        if (isWorkbenchPage()) {
          window.ArcusPanel?.pushLog("info", "Override dialog closed and workbench ready", contextLabel);
          return { ok: true, reason: "manual override completed and returned to workbench" };
        }

        return { ok: true, reason: "manual override dialog closed" };
      }

      await sleep(500);
    }

    return { ok: false, reason: "timeout waiting for manual override" };
  }

  function getDetailPane() {
    return queryFirst(CONFIG.detailPaneSelectors);
  }

  async function closeDetailPaneIfPresent() {
    const btn = queryFirst(CONFIG.detailPaneCloseSelectors);
    if (!btn || !isVisible(btn)) return false;
    await clickLikeUser(btn);
    await sleep(CONFIG.settleAfterPaneCloseMs);
    return true;
  }

  async function waitForDetailPaneText(timeout = CONFIG.scrapePaneWaitMs) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const pane = getDetailPane();
      const txt = textOf(pane);
      if (txt && txt.length > 5) return txt;
      await sleep(100);   // reduced from 300 — catch ready pane up to 200ms sooner
    }
    return null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  syncScraperState();

  window.ArcusShared = {
    CONFIG,
    PANEL_STORAGE_KEY,
    PANEL_DISMISSED_KEY,
    ORDER_FILTERS,
    state,
    syncScraperState,
    setPanelDismissed,
    getPanelDismissed,
    restorePanelDismissed,
    sleep,
    currentHref,
    isWorkbenchPage,
    isAllocatePage,
    isDispenseToDeptPage,
    textOf,
    shortText,
    escapeHtml,
    asSelectorList,
    queryFirst,
    queryAll,
    findActionButton,
    getMainContainer,
    getRowTypeFromText,
    matchesRowFilter,
    getSelectedRowFilters,
    getSelectedRowFilterLabel,
    getWorkbenchRows,
    getRowSnapshots,
    findRowBySnapshot,
    getRowKeyFromText,
    scrollMainContainerToLoadMore,
    waitFor,
    isVisible,
    clickLikeUser,
    findOpenDialog,
    isAlertDialog,
    dialogLooksLikeManualOverride,
    waitForWorkbenchReady,
    waitForAllocatePageReady,
    waitForDispenseToDeptPageReady,
    waitForSelectorVisible,
    waitForRouteContains,
    closeAlertDialogIfPresent,
    closeGenericToolbarDialogIfPresent,
    acknowledgeAlertRowsIfPresent,
    waitForManualOverrideCompletion,
    getDetailPane,
    closeDetailPaneIfPresent,
    waitForDetailPaneText,
    clamp,
  };
})();