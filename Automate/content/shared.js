(() => {
  if (window.__ARCUS_SHARED_LOADED__) return;
  window.__ARCUS_SHARED_LOADED__ = true;

  // Arcus Toolkit v4.3.0

  // Single interaction layer for every module. When turbo (chrome.debugger) is
  // on this gives trusted input and true network-idle waits; otherwise it is
  // synthetic events with MutationObserver/XHR-hook settle detection. Either
  // way the fixed sleeps below become bounded waits on a real signal.
  const Driver = window.ArcusDriver;

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

      // The Allocate confirm button carries aria-label="Allocate" and
      // ng-click="vm.saveData()". Attribute selectors are CASE-SENSITIVE, so
      // the old [ng-click*='save'] never matched saveData() and the search fell
      // through to a bare button.md-primary, which can be a different button.
      allocateSaveButton: [
        "button[aria-label='Allocate']",
        "button[ng-click*='saveData'][aria-label='Allocate']",
        "#actiondiv button[ng-click*='saveData']",
        "#actiondiv > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple",
        "#actiondiv button.md-primary",
        "button.md-primary[ng-click*='saveData']",
        "button.md-primary",
      ],

      // The dispense confirm calls vm.verifyDispense(), NOT vm.saveData() like
      // the allocate page, and the attribute carries a trailing semicolon
      // (ng-click="vm.verifyDispense();") so exact-value selectors miss it.
      // Match on aria-label first, then on the handler name as a substring.
      dispenseToDeptSaveButton: [
        "button[aria-label='Dispense']",
        "button[ng-click*='verifyDispense']",
        "button[aria-label='Save'][ng-click*='saveData']",
        "md-card-content button.md-primary[ng-click*='verify']",
        "#actiondiv button[ng-click*='saveData']",
        "#actiondiv button.md-primary",
        "md-card-content button.md-primary",
        "button.md-primary[ng-click*='saveData']",
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

    // Upper bounds for settle waits. These are ceilings, not delays: with turbo
    // on, a step returns as soon as its XHR completes, typically well under
    // these values. They only matter when the server is slow or unreachable.
    maxSaveSettleMs: 15000,
    maxRowSettleMs: 8000,

    maxActionWaitMs: 18000,
    maxRouteWaitMs: 20000,
    maxDialogSettleMs: 12000,
    maxManualOverrideWaitMs: 180000,
    settleAfterRowClickMs: 1000,
    settleAfterDialogCloseMs: 900,
    settleAfterActionClickMs: 1500,
    settleAfterSaveClickMs: 1800,
    settleAfterPaneCloseMs: 400,
    loopDelayMs: 250,
    autoNoMatchIntervalMs: 30000,
    rowMatchTextLength: 240,
    maxRetriesPerRow: 2,
    scrollLoadWaitMs: 900,
    mouseWheelScrollSteps: 5,
    mouseWheelDeltaY: 650,
  };

  const PANEL_STORAGE_KEY = "arcusAutoPanelState";
  const PANEL_DISMISSED_KEY = "arcusAutoPanelDismissed";
  const PHARMACY_TYPE_KEY = "arcusPharmacyType";

  const ORDER_FILTERS = {
    all: "ALL ROW",
    daily: "DAILY ORDER",
    continuous: "CONTINUOUS ORDER",
    discharge: "DISCHARGE MEDICATION",
  };

  const OPD_ORDER_FILTERS = {
    all: "ALL ROW",
    stat: "STAT",
    routine: "ROUTINE",
  };

  const state = {
    isRunning: false,
    stopRequested: false,
    stats: { processed: 0, success: 0, fail: 0 },
    logItems: [],
    settings: {
      rowFilter: "all",
      rowFilters: ["all"],
      waitManualOverride: true,
      automationMode: "auto",
      pharmacyType: "auto",
    },
    panel: {
      dismissed: false,
    },
  };

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
  window.ArcusStore.core = { state, CONFIG, version: "4.3.0" };

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
    const filters = getEffectivePharmacyType() === "outpatient" ? OPD_ORDER_FILTERS : ORDER_FILTERS;
    if (selected.includes("all")) return filters.all;
    return selected.map((key) => filters[key] || key).join(" + ");
  }

  function matchesRowFilter(rowText, filterKey, rowEl = null) {
    const selected = Array.isArray(filterKey) ? filterKey : getSelectedRowFilters();
    if (!selected.length || selected.includes("all")) return true;
    if (getEffectivePharmacyType() === "outpatient") {
      return selected.includes(getOpdRowTypeFromEl(rowEl || null));
    }
    return selected.includes(getRowTypeFromText(rowText));
  }

  function getRowKeyFromText(value) {
    return shortText(String(value || "").replace(/\s+/g, " ").trim(), CONFIG.rowMatchTextLength);
  }

  function isLikelyOrderRow(el) {
    if (!(el instanceof HTMLElement)) return false;
    const txt = textOf(el);
    if (!txt) return false;

    const isOpd = getEffectivePharmacyType() === "outpatient";
    const type = isOpd ? getOpdRowTypeFromEl(el) : getRowTypeFromText(txt);
    if (type === "unknown") return false;

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;

    const childOrderRows = Array.from(el.children || []).filter((child) => {
      if (!(child instanceof HTMLElement)) return false;
      if (isOpd) return getOpdRowTypeFromEl(child) !== "unknown" && textOf(child).length < txt.length * 0.85;
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
    rows = rows.filter((row) => matchesRowFilter(textOf(row), getSelectedRowFilters(), row));

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
        key: `${getEffectivePharmacyType() === "outpatient" ? getOpdRowTypeFromEl(row) : getRowTypeFromText(text)}::${text}`,
        rowType: getEffectivePharmacyType() === "outpatient" ? getOpdRowTypeFromEl(row) : getRowTypeFromText(text),
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

  // Delegates to the driver, which resolves on the mutation that satisfies the
  // predicate instead of on the next 250ms poll tick. The `interval` argument is
  // accepted for call-site compatibility and ignored.
  async function waitFor(fn, timeout = 10000, _interval = 250) {
    return Driver.waitFor(fn, timeout, { shouldAbort: () => state.stopRequested });
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (el.disabled) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Trusted CDP input when turbo is on, synthetic events otherwise. The old
  // unconditional smooth-scroll + sleep(250) on every click is gone; the driver
  // only scrolls when the element is actually outside the viewport.
  async function clickLikeUser(el) {
    if (!el) return false;
    const result = await Driver.click(el);
    return !!result.ok;
  }

  // Click, then return once the page's own XHRs have gone quiet. Replaces the
  // "click then sleep(1500..1800) and hope" pattern.
  async function clickAndSettle(el, options) {
    if (!el) return false;
    const result = await Driver.clickAndSettle(el, options);
    return !!result.ok;
  }

  // Wait for the app to stop talking to the server. Callers pass the old fixed
  // delay as `maxMs` so a page that never settles still bounds the wait.
  async function settle(maxMs = 4000, idleMs = 200) {
    const result = await Driver.waitForSettle({ idleMs, timeoutMs: maxMs });
    return !!result.ok;
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
    // The route is up; wait for the grid's own XHRs rather than a flat 700ms.
    await settle(2500);
    return container;
  }

  /**
   * Find a submit button that exists before it is usable.
   *
   * The Allocate/Dispense confirm buttons carry ng-disabled and start disabled
   * while the page loads its lines. findActionButton() asks for a *visible*
   * element and isVisible() rejects anything disabled, so searching for it
   * directly reports "not found" for what is really "not ready yet" — and the
   * run stalls at the confirm step.
   *
   * Locate it ignoring disabled state, then wait for it to become clickable.
   */
  async function waitForSubmitButton(selectorName, timeoutMs) {
    const selectors = asSelectorList(CONFIG.actionSelectors[selectorName]);

    const find = () => {
      for (const selector of selectors) {
        try {
          const el = document.querySelector(selector);
          if (!el) continue;
          const style = getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          const rect = el.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          return el;
        } catch (_) {}
      }
      return null;
    };

    const btn = await waitFor(find, timeoutMs, 200);
    if (!btn) return { ok: false, el: null, reason: `${selectorName} not found in the DOM` };

    const enabled = await waitFor(() => {
      const el = find() || btn;
      const blocked = el.disabled
        || el.getAttribute("aria-disabled") === "true"
        || !!el.closest("[disabled]");
      return blocked ? null : el;
    }, timeoutMs, 200);

    if (!enabled) {
      return { ok: false, el: btn, reason: `${selectorName} stayed disabled` };
    }
    return { ok: true, el: enabled };
  }

  async function waitForAllocatePageReady() {
    const onRoute = await waitFor(() => (isAllocatePage() ? true : null), CONFIG.maxRouteWaitMs, 200);
    if (!onRoute) return null;

    // Let the page's own requests finish before judging the button: it is
    // disabled until the allocate lines have loaded.
    await settle(4000);

    const result = await waitForSubmitButton("allocateSaveButton", CONFIG.maxRouteWaitMs);
    if (!result.ok) {
      window.ArcusPanel?.pushLog?.("fail", "Allocate confirm button unavailable", result.reason);
      return null;
    }
    return result.el;
  }

  /**
   * True once the dispense page has actually loaded its order.
   *
   * The Dispense button carries no ng-disabled, so it is clickable the moment
   * it renders — before the controller has its data. Clicking then throws
   * inside Arcus itself:
   *
   *   TypeError: Cannot read properties of undefined (reading 'patientorderitems')
   *     at DispenseToDeptController.verifyDispense
   *
   * The order-item rows are rendered from that same model, so their presence is
   * the signal that vm.selecteddispense exists and the handler is safe to call.
   */
  /**
   * Ask Angular directly whether the controller has its order.
   *
   * The DOM is an unreliable proxy here: the table lives inside md-table
   * wrappers that vary by layout, and a fixed-header clone can duplicate rows.
   * The controller's own scope is the thing verifyDispense() actually reads, so
   * check that when Angular is reachable and fall back to the DOM when not.
   */
  // Latest controller state reported by the MAIN-world page hook.
  let lastDispenseScope = null;

  try {
    window.addEventListener("message", (event) => {
      if (event.origin && event.origin !== location.origin) return;
      if (event.source && event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "arcus-page-hook" || data.type !== "dispenseScope") return;
      lastDispenseScope = data.state || null;
    });
  } catch (_) {}

  /**
   * Ask the page hook for the dispense controller's model.
   *
   * This CANNOT be read from the content script: it runs in an isolated world
   * where window.angular is undefined, so a direct read always failed and the
   * caller silently fell back to counting DOM rows — which are present well
   * before vm.selecteddispense is, hence the click into a TypeError.
   */
  function requestDispenseScope() {
    try {
      window.postMessage({ source: "arcus-content", type: "requestDispenseScope" }, location.origin);
    } catch (_) {}
  }

  /** The last reported controller state, or null if the hook has not answered. */
  function readDispenseScopeState() {
    requestDispenseScope();
    return lastDispenseScope;
  }

  /** Ask, then give the hook a moment to answer over postMessage. */
  async function fetchDispenseScopeState(timeoutMs = 1200) {
    lastDispenseScope = null;
    requestDispenseScope();
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (lastDispenseScope) return lastDispenseScope;
      await sleep(50);
    }
    return null;
  }

  /** Count order-item rows across the layouts Arcus uses for this table. */
  function countDispenseRows() {
    const seen = new Set();
    let count = 0;
    const rows = document.querySelectorAll(
      "md-table-container tbody tr, table.md-table tbody tr, tbody tr[md-row], tbody tr"
    );
    for (const row of rows) {
      if (seen.has(row)) continue;
      seen.add(row);
      if (!row.querySelector("td")) continue;      // header rows carry <th>
      if (textOf(row).length <= 3) continue;       // placeholder / spacer
      count += 1;
    }
    return count;
  }

  /**
   * True once the dispense page has loaded the order that verifyDispense()
   * needs. Prefers the controller scope; falls back to counting rows.
   */
  /**
   * True once the controller actually holds the order.
   *
   * The DOM row count is deliberately NOT a fallback for "ready": the rows are
   * rendered from a different binding and appear while vm.selecteddispense is
   * still undefined, which is exactly the state that crashes verifyDispense().
   * If the model cannot be confirmed, we wait rather than guess.
   */
  async function dispenseModelReady() {
    const scope = await fetchDispenseScopeState();
    if (!scope) return false;                    // hook did not answer yet
    if (!scope.scopeReachable) return false;     // Angular not up yet
    if (!scope.hasVm) return false;              // controller not attached yet
    return scope.hasSelected && scope.itemCount > 0;
  }

  /** Synchronous best-effort view, used only for diagnostics. */
  function dispensePageHasOrderItems() {
    const scope = lastDispenseScope;
    if (scope && scope.hasVm) return scope.hasSelected && scope.itemCount > 0;
    return false;
  }

  /**
   * Trace one step of a multi-stage wait.
   *
   * Each stage prints what it observed, so a stall can be attributed to a
   * specific condition instead of a generic "not ready".
   */
  function traceStep(stage, ok, detail) {
    const line = `[dispense-ready] ${stage}: ${ok ? "OK" : "WAITING"}${detail ? " — " + detail : ""}`;
    console.log(line);
    window.ArcusPanel?.pushLog?.(ok ? "info" : "warn", line);
  }

  /** A snapshot of everything that gates the dispense confirm click. */
  function describeDispensePage() {
    // Uses the last state the page hook reported; the wait loop keeps it fresh.
    const scope = lastDispenseScope;
    const btn = queryFirst(CONFIG.actionSelectors.dispenseToDeptSaveButton, document, false);
    return {
      route: isDispenseToDeptPage(),
      href: currentHref(),
      scopeReachable: !!scope,
      hasVm: scope ? scope.hasVm : false,
      hasSelected: scope ? scope.hasSelected : false,
      itemCount: scope ? scope.itemCount : -1,
      domRows: countDispenseRows(),
      buttonFound: !!btn,
      buttonDisabled: btn ? (!!btn.disabled || btn.getAttribute("aria-disabled") === "true") : null,
    };
  }

  async function waitForDispenseToDeptPageReady() {
    const onRoute = await waitFor(
      () => (isDispenseToDeptPage() ? true : null), CONFIG.maxRouteWaitMs, 200);
    traceStep("1 route", !!onRoute, currentHref());
    if (!onRoute) return null;

    await settle(4000);
    traceStep("2 network settled", true);

    // Wait for the controller's model, not just the button: the button has no
    // ng-disabled, so it is clickable before verifyDispense() has anything to
    // read, and clicking then throws inside Arcus itself.
    let loaded = false;
    const modelDeadline = Date.now() + CONFIG.maxRouteWaitMs;
    while (Date.now() < modelDeadline) {
      if (state.stopRequested) break;
      if (await dispenseModelReady()) { loaded = true; break; }
      await sleep(250);
    }

    const snap = describeDispensePage();
    traceStep("3 order loaded", !!loaded, JSON.stringify(snap));

    if (!loaded) {
      window.ArcusPanel?.pushLog?.(
        "fail",
        "Dispense page did not load its order items",
        JSON.stringify(snap)
      );
      return null;
    }

    // The rows can paint slightly before the model is complete.
    await settle(2000);

    const result = await waitForSubmitButton("dispenseToDeptSaveButton", CONFIG.maxRouteWaitMs);
    traceStep("4 confirm button", result.ok, result.ok ? "clickable" : result.reason);

    if (!result.ok) {
      window.ArcusPanel?.pushLog?.("fail", "Dispense confirm button unavailable", result.reason);
      return null;
    }
    return result.el;
  }

  async function waitForSelectorVisible(selector, timeout = 10000) {
    return waitFor(() => queryFirst(selector, document, true), timeout, 250);
  }

  async function waitForRouteContains(routeKeyword, timeout = 12000) {
    return waitFor(() => (currentHref().includes(routeKeyword) ? currentHref() : null), timeout, 250);
  }

  /**
   * Close the alert popup.
   *
   * Bounded to three attempts. A recording caught #closeBtn being pressed ~70
   * times in one second because callers re-entered this while the dialog stayed
   * open; every one of those reached Arcus. If it will not close, say so and
   * leave it for a human rather than hammering it.
   */
  async function closeAlertDialogIfPresent(logMeta = "") {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const dialog = findOpenDialog();
      if (!dialog || !isAlertDialog(dialog)) return attempt > 1;

      const closeBtn =
        dialog.querySelector(CONFIG.actionSelectors.closeBtn) ||
        dialog.querySelector("button[aria-label='Close']") ||
        (await waitForSelectorVisible(CONFIG.actionSelectors.closeBtn, 800));

      if (!closeBtn) return false;

      // allowRepeat: this is a deliberate, bounded retry on the same button.
      await Driver.click(closeBtn, { allowRepeat: attempt > 1 });

      const closed = await waitFor(() => !findOpenDialog(), 2500, 150);
      if (closed) {
        window.ArcusPanel?.pushLog("info", "Closed alert popup", logMeta);
        return true;
      }
    }

    window.ArcusPanel?.pushLog(
      "fail",
      "Alert popup would not close after 3 attempts",
      logMeta
    );
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

    // "Mark all as viewed" is the app's own bulk action and is far more reliable
    // than closing a many-row alert dialog one button at a time. Look for it
    // inside the dialog as well as document-wide.
    const hideAll =
      dialog.querySelector(CONFIG.actionSelectors.hideAllAlerts) ||
      dialog.querySelector("button[aria-label='Mark all as viewed']") ||
      dialog.querySelector("button[ng-click*='hideAllAlerts']") ||
      document.querySelector(CONFIG.actionSelectors.hideAllAlerts);

    if (hideAll && isVisible(hideAll)) {
      await Driver.click(hideAll);
      window.ArcusPanel?.pushLog("info", "Marked all alerts as viewed", logMeta);
      await settle(2000);
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
      await sleep(300);
    }
    return null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getOpdRowTypeFromEl(el) {
    if (!el) return "unknown";
    try {
      const nodes = Array.from(el.querySelectorAll("span.ng-binding, td.ng-binding, div.ng-binding, .ng-binding"));
      for (const node of nodes) {
        const t = ((node.innerText || node.textContent) || "").trim().toLowerCase();
        if (t === "stat") return "stat";
        if (t === "routine") return "routine";
      }
    } catch (_) {}
    return "unknown";
  }

  function detectPharmacyType() {
    const selectors = [
      "body > div.full-height.ng-scope.layout-row > div > md-toolbar > div > div",
      "md-toolbar .font-size-14-imp.ng-binding",
      "md-toolbar [class*='ng-binding'][class*='font-size']",
      "md-toolbar .md-toolbar-tools",
      "md-toolbar > *",
      "md-toolbar",
    ];
    for (const sel of selectors) {
      try {
        const nodes = document.querySelectorAll(sel);
        for (const el of nodes) {
          const txt = ((el.innerText || el.textContent) || "").toUpperCase();
          if (txt.includes("OUTPATIENT PHARMACY") || txt.includes("OUTPATIENT") || txt.includes("PHARMACY FLOOR 2")) return "outpatient";
          if (txt.includes("INPATIENT PHARMACY") || txt.includes("INPATIENT")) return "inpatient";
        }
      } catch (_) {}
    }
    try {
      const href = location.href.toLowerCase();
      if (href.includes("outpatient") || href.includes("opd")) return "outpatient";
      if (href.includes("inpatient") || href.includes("ipd")) return "inpatient";
    } catch (_) {}
    return null;
  }

  function getEffectivePharmacyType() {
    const override = state.settings.pharmacyType;
    if (override && override !== "auto") return override;
    return detectPharmacyType() || "inpatient";
  }

  function isValidOrderNo(identity) {
    const type = getEffectivePharmacyType();
    if (type === "outpatient") return /^[OE]/i.test(identity);
    return /^I/i.test(identity);
  }

  window.ArcusShared = {
    CONFIG,
    PANEL_STORAGE_KEY,
    PANEL_DISMISSED_KEY,
    ORDER_FILTERS,
    state,
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
    clickAndSettle,
    settle,
    Driver,
    findOpenDialog,
    isAlertDialog,
    dialogLooksLikeManualOverride,
    waitForWorkbenchReady,
    waitForSubmitButton,
    dispensePageHasOrderItems,
    dispenseModelReady,
    fetchDispenseScopeState,
    describeDispensePage,
    readDispenseScopeState,
    countDispenseRows,
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
    PHARMACY_TYPE_KEY,
    OPD_ORDER_FILTERS,
    detectPharmacyType,
    getEffectivePharmacyType,
    isValidOrderNo,
    getOpdRowTypeFromEl,
  };
})();