(() => {
  if (window.__ARCUS_SHARED_LOADED__) return;
  window.__ARCUS_SHARED_LOADED__ = true;

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

      allocateSaveButton:
        "#actiondiv > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple",

      dispenseToDeptSaveButton:
        "body > div.full-height.ng-scope.layout-row > div > md-content > md-card > md-card-content > div.layout-xs-column.layout-sm-column.layout-row > div > div > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple",

      overrideSaveButton:
        "body > div.md-dialog-container.ng-scope > md-dialog > form > md-dialog-actions > div > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple",

      closeToolbarIcon:
        "body > div.md-dialog-container.ng-scope > md-dialog > form > md-toolbar > div > button > md-icon",

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
    settleAfterRowClickMs: 1000,
    settleAfterDialogCloseMs: 900,
    settleAfterActionClickMs: 1500,
    settleAfterSaveClickMs: 1800,
    settleAfterPaneCloseMs: 400,
    loopDelayMs: 900,
    rowMatchTextLength: 240,
    maxRetriesPerRow: 2,
    scrapePaneWaitMs: 5000,
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
    stats: { processed: 0, success: 0, fail: 0 },
    logItems: [],
    settings: {
      rowFilter: "all",
      waitManualOverride: true,
    },
    panel: {
      dismissed: false,
    },
    scraper: {
      state: "idle",
      data: [],
      reason: "",
      progressText: "",
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

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      try {
        const el = root.querySelector(selector);
        if (el) return el;
      } catch (_) {}
    }
    return null;
  }

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

  function matchesRowFilter(rowText, filterKey) {
    if (!filterKey || filterKey === "all") return true;
    return getRowTypeFromText(rowText) === filterKey;
  }

  function getWorkbenchRows() {
    const container = getMainContainer();
    if (!container) return [];

    let rows = [];
    for (const selector of CONFIG.rowCandidateSelectors) {
      try {
        const found = Array.from(container.querySelectorAll(selector)).filter(
          (el) => el instanceof HTMLElement
        );
        if (found.length > rows.length) rows = found;
      } catch (_) {}
    }

    rows = rows.filter((el) => {
      if (!(el instanceof HTMLElement)) return false;
      const txt = textOf(el);
      if (!txt) return false;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return false;
      return true;
    });

    const seen = new Set();
    rows = rows.filter((row) => {
      const key = shortText(textOf(row), CONFIG.rowMatchTextLength);
      if (!key) return false;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    rows = rows.filter((row) => matchesRowFilter(textOf(row), state.settings.rowFilter));
    return rows;
  }

  function getRowSnapshots() {
    return getWorkbenchRows().map((row, index) => {
      const text = shortText(textOf(row), CONFIG.rowMatchTextLength);
      return {
        index,
        text,
        rowType: getRowTypeFromText(text),
      };
    });
  }

  function findRowBySnapshot(snapshot) {
    const rows = getWorkbenchRows();
    if (!rows.length) return null;

    const exact = rows.find(
      (row) => shortText(textOf(row), CONFIG.rowMatchTextLength) === snapshot.text
    );
    if (exact) return exact;

    const contains = rows.find((row) => {
      const txt = textOf(row);
      return txt.includes(snapshot.text) || snapshot.text.includes(txt);
    });
    if (contains) return contains;

    return rows[snapshot.index] || null;
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
      const el = document.querySelector(CONFIG.actionSelectors.allocateSaveButton);
      return el && isVisible(el) ? el : null;
    }, CONFIG.maxRouteWaitMs, 300);
    if (!saveBtn) return null;
    await sleep(700);
    return saveBtn;
  }

  async function waitForDispenseToDeptPageReady() {
    const saveBtn = await waitFor(() => {
      if (!isDispenseToDeptPage()) return null;
      const el = document.querySelector(CONFIG.actionSelectors.dispenseToDeptSaveButton);
      return el && isVisible(el) ? el : null;
    }, CONFIG.maxRouteWaitMs, 300);
    if (!saveBtn) return null;
    await sleep(700);
    return saveBtn;
  }

  async function waitForSelectorVisible(selector, timeout = 10000) {
    return waitFor(() => {
      const el = document.querySelector(selector);
      return el && isVisible(el) ? el : null;
    }, timeout, 250);
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

    const icon = document.querySelector(CONFIG.actionSelectors.closeToolbarIcon);
    if (icon && isVisible(icon)) {
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
          const saveBtn = document.querySelector(CONFIG.actionSelectors.allocateSaveButton);
          if (saveBtn && isVisible(saveBtn)) {
            window.ArcusPanel?.pushLog(
              "info",
              "Override dialog closed; allocate page still open",
              contextLabel
            );
            return { ok: true, reason: "manual override completed on allocate page" };
          }
        }

        if (isDispenseToDeptPage()) {
          const saveBtn = document.querySelector(CONFIG.actionSelectors.dispenseToDeptSaveButton);
          if (saveBtn && isVisible(saveBtn)) {
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
      await sleep(300);
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
    queryFirst,
    getMainContainer,
    getRowTypeFromText,
    matchesRowFilter,
    getWorkbenchRows,
    getRowSnapshots,
    findRowBySnapshot,
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