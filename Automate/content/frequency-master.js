"use strict";

(() => {
  if (window.__ARCUS_FREQUENCY_MASTER_LOADED__) return;
  window.__ARCUS_FREQUENCY_MASTER_LOADED__ = true;

  const ROUTE_HASH = "!/ordermanagement/frequencymaster";
  const PANEL_STATE_KEY = "arcusFrequencyPanelState";
  const PANEL_DISMISSED_KEY = "arcusFrequencyPanelDismissed";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const Driver = window.ArcusDriver;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const state = {
    running: false,
    stopRequested: false,
    dismissed: false,
    rows: [],
    logItems: [],
  };

  function isFrequencyPage() {
    return location.href.includes(ROUTE_HASH);
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textOf(el) {
    return ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  }

  // Mutation-driven via the shared driver: resolves on the DOM change that
  // satisfies the predicate rather than on the next 250ms poll.
  async function waitFor(fn, timeoutMs = 12000, _intervalMs = 250) {
    return Driver.waitFor(fn, timeoutMs, { shouldAbort: () => state.stopRequested });
  }

  // Trusted CDP click under turbo, synthetic events otherwise. The driver
  // only scrolls when the element is off-screen, so the old unconditional
  // scroll + sleep(180) per click is gone.
  async function clickLikeUser(el) {
    if (!el) return false;
    const result = await Driver.click(el);
    return !!result.ok;
  }

  // Click, then resume when the resulting request finishes.
  async function clickAndSettle(el, maxMs = 10000) {
    if (!el) return false;
    const result = await Driver.clickAndSettle(el, { timeoutMs: maxMs });
    return !!result.ok;
  }

  async function settle(maxMs = 4000) {
    const result = await Driver.waitForSettle({ timeoutMs: maxMs });
    return !!result.ok;
  }

  function angularClick(el) {
    if (!el) return;
    if (window.angular) window.angular.element(el).triggerHandler("click");
    else el.click();
  }

  function getTableContainer() {
    return document.querySelector("md-table-container[full-height]") ||
      document.querySelector("md-table-container");
  }

  function getDataRows() {
    return Array.from(document.querySelectorAll("table.md-table tbody tr[ng-repeat*='frequency'], table.md-table tbody tr"))
      .filter((row) => row.querySelector("button[id^='frequenctMasterFormModify']"))
      .filter((row, index, rows) => rows.indexOf(row) === index);
  }

  function readTableRow(row) {
    const cells = Array.from(row.querySelectorAll("td[md-cell], td"));
    return {
      code: textOf(cells[0]),
      name: textOf(cells[1]),
      description: textOf(cells[2]),
    };
  }

  function getRowKey(rowData) {
    return `${rowData.code || ""}::${rowData.name || ""}`;
  }

  async function ensureFrequencyPage() {
    if (!isFrequencyPage()) {
      location.hash = ROUTE_HASH;
      const ok = await waitFor(() => isFrequencyPage(), 15000, 200);
      if (!ok) throw new Error("Cannot navigate to Frequency Master page");
      await settle(3000);
    }
  }

  async function searchFrequencyMaster() {
    const searchBtn = await waitFor(() => {
      const el = document.querySelector("#frequenctMasterFormSearch");
      return el && isVisible(el) && !el.disabled ? el : null;
    }, 15000);
    if (!searchBtn) throw new Error("#frequenctMasterFormSearch not found");
    setStatus("Clicking search...");
    // The table is the point of this click, so wait for its fetch, then for the
    // rows themselves to paint.
    await clickAndSettle(searchBtn, 18000);
    const rows = await waitFor(() => getDataRows().length ? getDataRows() : null, 18000, 300);
    if (!rows) throw new Error("Frequency table did not render rows");
  }

  function findRowByKey(key) {
    for (const row of getDataRows()) {
      if (getRowKey(readTableRow(row)) === key) return row;
    }
    return null;
  }

  function readInputValue(selector, root = document) {
    const el = root.querySelector(selector);
    return el ? String(el.value || "").trim() : "";
  }

  function fieldNameFromLabel(labelText, fallback) {
    const base = String(labelText || fallback || "")
      .replace(/\*/g, "")
      .replace(/[^A-Za-z0-9]+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^[A-Z]/, (c) => c.toLowerCase())
      .trim();
    return base || fallback || "value";
  }

  function readLabeledInputs(dialog) {
    const fields = {};
    dialog.querySelectorAll("md-input-container").forEach((container) => {
      const input = container.querySelector("input, textarea");
      if (!input) return;
      const label = textOf(container.querySelector("label")) || input.getAttribute("aria-label") || input.id || input.name;
      fields[fieldNameFromLabel(label, input.id || input.name)] = String(input.value || "").trim();
    });
    return fields;
  }

  function readType(dialog) {
    const select = dialog.querySelector("#frequencymastertype");
    if (!select) return "";
    return (textOf(select.querySelector(".md-select-value .md-text")) ||
      textOf(select.querySelector(".md-select-value")) ||
      select.getAttribute("aria-label") ||
      "").replace(/^Type:\s*/i, "").trim();
  }

  function readSwitches(dialog) {
    const switches = {};
    dialog.querySelectorAll("md-switch").forEach((sw) => {
      const label = textOf(sw.querySelector(".md-label")) || sw.getAttribute("aria-label") || sw.id;
      switches[fieldNameFromLabel(label, sw.id || "switch")] = sw.getAttribute("aria-checked") === "true";
    });
    return switches;
  }

  function readTimings(dialog) {
    return Array.from(dialog.querySelectorAll("time-picker")).map((picker, index) => {
      const hour = picker.querySelector("input.tp_hr")?.value || "";
      const mins = picker.querySelector("input.tp_min")?.value || "";
      return {
        index: index + 1,
        hour: String(hour).padStart(2, "0"),
        minute: String(mins).padStart(2, "0"),
        value: `${String(hour).padStart(2, "0")}:${String(mins).padStart(2, "0")}`,
      };
    });
  }

  function getOpenFrequencyDialog() {
    return Array.from(document.querySelectorAll("md-dialog, [role='dialog']"))
      .find((dialog) => isVisible(dialog) && dialog.querySelector("#frequencymastercode"));
  }

  async function waitForDialog() {
    return waitFor(() => getOpenFrequencyDialog(), 12000, 200);
  }

  // Wait until the open dialog actually shows THIS row's data. The Modify dialog
  // is reused/animated, so a stale dialog (still showing the previous row) can be
  // briefly visible — scraping it carries the previous row's detail forward.
  // Gate on the dialog's own code/name field matching the row we clicked.
  async function waitForDialogMatching(rowData) {
    const want = (rowData.code || rowData.name || "").trim();
    const dialog = await waitFor(() => {
      const dlg = getOpenFrequencyDialog();
      if (!dlg) return null;
      const dc = (readInputValue("#frequencymastercode", dlg) || "").trim();
      const dn = (readInputValue("#frequencymastername", dlg) || "").trim();
      // Accept when the dialog's code OR name equals the row (some rows key on name).
      if (!want || dc === (rowData.code || "").trim() || dn === (rowData.name || "").trim()) {
        return dlg;
      }
      return null;
    }, 12000, 150);
    return dialog;
  }

  function scrapeDialog(dialog) {
    return {
      code: readInputValue("#frequencymastercode", dialog),
      name: readInputValue("#frequencymastername", dialog),
      description: readInputValue("#frequencymasterdescription", dialog),
      localLanguage: readInputValue("#frequencymasterlocallangdesc", dialog),
      type: readType(dialog),
      numberOfTimes: readInputValue("#frequencymasterquantityperday", dialog),
      activeFrom: readInputValue("md-date-selector#frequencymasteractivefrom input, input[aria-label='Active From']", dialog),
      activeTo: readInputValue("md-date-selector#frequencymasteractiveto input, input[aria-label='Active To']", dialog),
      externalCode: readInputValue("#frequencymasterexternalcode", dialog),
      timings: readTimings(dialog),
      switches: readSwitches(dialog),
      fields: readLabeledInputs(dialog),
    };
  }

  async function closeDialog() {
    const dialog = getOpenFrequencyDialog();
    if (!dialog) return;
    const closeBtn =
      dialog.querySelector("#cancelData") ||
      dialog.querySelector("button[ng-click='cancelData()']") ||
      dialog.querySelector("button[aria-label='Cancel']") ||
      Array.from(dialog.querySelectorAll("button")).find((button) => /^cancel$/i.test(textOf(button))) ||
      dialog.querySelector("md-toolbar button") ||
      dialog.querySelector("button[aria-label='Close']") ||
      dialog.querySelector("md-dialog-actions button:not(.md-primary)") ||
      dialog.querySelector("md-dialog-actions button");
    if (closeBtn) angularClick(closeBtn);
    else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await waitFor(() => !getOpenFrequencyDialog(), 8000, 200);
    await sleep(250);
  }

  async function scrapeOne(rowData, index) {
    const key = getRowKey(rowData);
    const row = findRowByKey(key);
    if (!row) throw new Error(`Row disappeared: ${rowData.code}`);
    const btn = row.querySelector("button[id^='frequenctMasterFormModify']");
    if (!btn) throw new Error(`Modify button not found: ${rowData.code}`);

    // Make sure no previous dialog is still open before we click — otherwise the
    // stale dialog would satisfy waitForDialog() and we'd scrape the wrong row.
    if (getOpenFrequencyDialog()) await closeDialog();

    setStatus(`Opening ${index + 1}: ${rowData.code || rowData.name}`);
    await clickLikeUser(btn);
    // Wait for the dialog that actually shows THIS row (guards carry-forward).
    const dialog = await waitForDialogMatching(rowData);
    if (!dialog) throw new Error(`Modify dialog did not open for: ${rowData.code || rowData.name}`);
    await sleep(250);

    const detail = scrapeDialog(dialog);
    // Sanity: the scraped detail must belong to this row; never carry forward.
    const dc = (detail.code || "").trim();
    const dn = (detail.name || "").trim();
    if ((rowData.code && dc && dc !== rowData.code.trim()) &&
        (rowData.name && dn && dn !== rowData.name.trim())) {
      await closeDialog();
      throw new Error(`Dialog mismatch for ${rowData.code || rowData.name} (got ${dc || dn})`);
    }
    await closeDialog();
    // Slim output shape consumed by the pharmacy server:
    //   { code, name, lang: { EN, TH }, scrapedAt }
    // EN = English frequency name, TH = the dialog's local-language (Thai) label.
    const en = (rowData.name || detail.name || "").trim();
    const th = (detail.localLanguage || "").trim();
    return {
      code: (rowData.code || detail.code || "").trim(),
      name: en,
      lang: { EN: en, TH: th },
      scrapedAt: new Date().toISOString(),
    };
  }

  function hasMoreDataHint() {
    return Array.from(document.querySelectorAll("div, span"))
      .some((el) => isVisible(el) && /scroll to load more data/i.test(textOf(el)));
  }

  async function scrollToLoadMore() {
    const container = getTableContainer();
    if (!container) return false;
    const beforeRows = getDataRows().length;
    const beforeHeight = container.scrollHeight;
    const beforeTop = container.scrollTop;

    for (let i = 0; i < 5; i++) {
      container.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        view: window,
        deltaY: 700,
        deltaMode: 0,
      }));
      container.scrollTop = Math.min(container.scrollTop + 700, container.scrollHeight);
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
      await sleep(180);
    }
    await sleep(1000);

    const afterRows = getDataRows().length;
    return afterRows > beforeRows || container.scrollHeight !== beforeHeight || container.scrollTop !== beforeTop;
  }

  async function downloadJson(data) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `frequency-master-${stamp}.json`;
    const response = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "downloadJson", filename, data }, (resp) => {
          resolve(resp || { ok: false, error: "No response from extension background" });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
    if (!response.ok) throw new Error(response.error || "JSON download failed");
    return filename;
  }

  async function runScraper() {
    if (state.running) return;
    state.running = true;
    state.stopRequested = false;
    state.rows = [];
    updateButtons();
    setProgress(0, 0);
    pushLog("info", "Scrape started");

    const seen = new Set();
    let idleScrolls = 0;

    try {
      await ensureFrequencyPage();
      await searchFrequencyMaster();

      while (!state.stopRequested) {
        const loaded = getDataRows().map(readTableRow).filter((row) => row.code || row.name);
        const pending = loaded.filter((row) => !seen.has(getRowKey(row)));

        if (!pending.length) {
          const moved = await scrollToLoadMore();
          idleScrolls = moved || hasMoreDataHint() ? idleScrolls + 1 : idleScrolls + 2;
          if (idleScrolls >= 4) break;
          continue;
        }

        idleScrolls = 0;
        for (const rowData of pending) {
          if (state.stopRequested) break;
          const key = getRowKey(rowData);
          if (seen.has(key)) continue;
          try {
            const detail = await scrapeOne(rowData, state.rows.length);
            state.rows.push(detail);
            seen.add(key);
            pushLog("success", `Scraped ${detail.code || detail.name}`);
          } catch (err) {
            const en = (rowData.name || "").trim();
            state.rows.push({
              code: (rowData.code || "").trim(),
              name: en,
              lang: { EN: en, TH: "" },
              error: err.message || String(err),
              scrapedAt: new Date().toISOString(),
            });
            seen.add(key);
            pushLog("fail", `${rowData.code || rowData.name}: ${err.message || err}`);
            try { await closeDialog(); } catch (_) {}
          }
          setProgress(state.rows.length, Math.max(seen.size, loaded.length));
          await sleep(150);
        }
      }

      const payload = {
        source: "Arcus Frequency Master",
        url: location.href,
        scrapedAt: new Date().toISOString(),
        count: state.rows.length,
        rows: state.rows,
      };
      const filename = await downloadJson(payload);
      setStatus(state.stopRequested ? `Stopped. Downloaded ${state.rows.length} rows to ${filename}` : `Completed. Downloaded ${state.rows.length} rows to ${filename}`);
      pushLog("success", `Downloaded ${filename}`);
    } catch (err) {
      setStatus(`Failed: ${err.message || err}`);
      pushLog("fail", err.message || String(err));
    } finally {
      state.running = false;
      state.stopRequested = false;
      updateButtons();
    }
  }

  function esc(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function setStatus(message) {
    const el = document.querySelector("#arcus-fm-status");
    if (el) el.textContent = message;
    console.log("[FrequencyMaster]", message);
  }

  function setProgress(done, total) {
    const bar = document.querySelector("#arcus-fm-bar");
    const label = document.querySelector("#arcus-fm-label");
    if (bar) bar.style.width = total ? `${Math.min(100, Math.round((done / total) * 100))}%` : "0%";
    if (label) label.textContent = total ? `${done} / ${total}` : `${done}`;
  }

  function pushLog(type, message) {
    state.logItems.unshift({ type, message, time: new Date().toLocaleTimeString() });
    state.logItems = state.logItems.slice(0, 120);
    renderLog();
  }

  function renderLog() {
    const root = document.querySelector("#arcus-fm-log");
    if (!root) return;
    root.innerHTML = state.logItems.length
      ? state.logItems.map((item) => `<div class="arcus-fm-log-${item.type}"><span>${esc(item.time)}</span> ${esc(item.message)}</div>`).join("")
      : '<div class="arcus-fm-log-info">No log yet.</div>';
  }

  function updateButtons() {
    const run = document.querySelector("#arcus-fm-run");
    const stop = document.querySelector("#arcus-fm-stop");
    if (run) run.disabled = state.running;
    if (stop) stop.disabled = !state.running;
  }

  function setPanelDismissed(value) {
    state.dismissed = !!value;
    try { chrome.storage?.local?.set({ [PANEL_DISMISSED_KEY]: !!value }); } catch (_) {}
  }

  function restorePanelDismissed(callback) {
    try {
      chrome.storage?.local?.get(PANEL_DISMISSED_KEY, (data) => {
        state.dismissed = !!data?.[PANEL_DISMISSED_KEY];
        callback?.();
      });
    } catch (_) {
      callback?.();
    }
  }

  function savePanelState(panel) {
    try {
      chrome.storage?.local?.set({
        [PANEL_STATE_KEY]: {
          top: panel.style.top || "",
          left: panel.style.left || "",
          minimized: panel.classList.contains("is-minimized"),
        },
      });
    } catch (_) {}
  }

  function restorePanelState(panel) {
    try {
      chrome.storage?.local?.get(PANEL_STATE_KEY, (data) => {
        const saved = data?.[PANEL_STATE_KEY];
        if (!saved) return;
        if (saved.top) panel.style.top = saved.top;
        if (saved.left) panel.style.left = saved.left;
        if (saved.top || saved.left) panel.style.right = "auto";
        if (saved.minimized) {
          panel.classList.add("is-minimized");
          const btn = panel.querySelector("#arcus-fm-minimize");
          if (btn) btn.textContent = "+";
        }
      });
    } catch (_) {}
  }

  function injectStyles() {
    if (document.querySelector("#arcus-fm-style")) return;
    const style = document.createElement("style");
    style.id = "arcus-fm-style";
    style.textContent = `
      #arcus-fm-panel {
        position:fixed; top:86px; right:16px; z-index:999999; width:300px;
        background:#fff; border:1px solid #dde4ef; border-radius:8px;
        box-shadow:0 4px 20px rgba(0,0,0,.18); font-family:'Segoe UI',system-ui,sans-serif;
        font-size:12px; color:#1a1a2e;
      }
      #arcus-fm-panel.is-minimized #arcus-fm-body { display:none; }
      #arcus-fm-header {
        background:#37474f; color:#fff; padding:10px 12px; border-radius:8px 8px 0 0;
        display:flex; justify-content:space-between; gap:8px; cursor:move;
      }
      .arcus-fm-title { font-size:13px; font-weight:700; }
      .arcus-fm-desc { font-size:10px; opacity:.82; margin-top:2px; }
      .arcus-fm-actions { display:flex; gap:4px; }
      .arcus-fm-icon {
        width:22px; height:22px; border:0; border-radius:5px; color:#fff;
        background:rgba(255,255,255,.18); cursor:pointer;
      }
      #arcus-fm-body { padding:10px 12px 12px; }
      .arcus-fm-row { display:flex; gap:6px; margin-bottom:8px; }
      .arcus-fm-btn {
        flex:1; border:0; border-radius:6px; padding:7px 6px; font-size:11px;
        font-weight:600; color:#fff; cursor:pointer;
      }
      .arcus-fm-btn:disabled { opacity:.4; cursor:not-allowed; }
      #arcus-fm-run { background:#2e7d32; }
      #arcus-fm-stop { background:#c62828; }
      .arcus-fm-track { height:6px; background:#e0e7ef; border-radius:3px; overflow:hidden; margin-bottom:3px; }
      #arcus-fm-bar { height:100%; background:#2e7d32; width:0; }
      #arcus-fm-label { font-size:10px; color:#607d8b; text-align:right; margin-bottom:8px; }
      #arcus-fm-status {
        font-size:11px; line-height:1.4; white-space:pre-line; word-break:break-word;
        padding:6px 8px; border-left:3px solid #2e7d32; border-radius:4px;
        background:#f1f8f1; color:#243b2b; margin-bottom:8px;
      }
      #arcus-fm-log { max-height:150px; overflow-y:auto; font-size:10px; }
      #arcus-fm-log > div { padding:3px 0; border-bottom:1px solid #f0f0f0; line-height:1.3; }
      #arcus-fm-log span { color:#9e9e9e; margin-right:4px; }
      .arcus-fm-log-success { color:#2e7d32; }
      .arcus-fm-log-fail { color:#c62828; }
      .arcus-fm-log-info { color:#444; }
    `;
    document.head.appendChild(style);
  }

  function removePanel() {
    document.querySelector("#arcus-fm-panel")?.remove();
  }

  function createPanel() {
    if (!isFrequencyPage() || state.dismissed || document.querySelector("#arcus-fm-panel")) return;
    injectStyles();
    const panel = document.createElement("div");
    panel.id = "arcus-fm-panel";
    panel.innerHTML = `
      <div id="arcus-fm-header">
        <div>
          <div class="arcus-fm-title">Frequency Master</div>
          <div class="arcus-fm-desc">Scrape table + modify dialog to JSON</div>
        </div>
        <div class="arcus-fm-actions">
          <button id="arcus-fm-minimize" class="arcus-fm-icon" title="Minimize">-</button>
          <button id="arcus-fm-close" class="arcus-fm-icon" title="Close">X</button>
        </div>
      </div>
      <div id="arcus-fm-body">
        <div class="arcus-fm-row">
          <button id="arcus-fm-run" class="arcus-fm-btn">Start</button>
          <button id="arcus-fm-stop" class="arcus-fm-btn" disabled>Stop</button>
        </div>
        <div class="arcus-fm-track"><div id="arcus-fm-bar"></div></div>
        <div id="arcus-fm-label">0</div>
        <div id="arcus-fm-status">Ready. Click Start to search and scrape all loaded rows.</div>
        <div id="arcus-fm-log"></div>
      </div>
    `;
    document.body.appendChild(panel);
    restorePanelState(panel);

    const header = panel.querySelector("#arcus-fm-header");
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    header.addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      event.preventDefault();
    });
    window.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      panel.style.left = `${clamp(startLeft + event.clientX - startX, 8, window.innerWidth - panel.offsetWidth - 8)}px`;
      panel.style.top = `${clamp(startTop + event.clientY - startY, 8, window.innerHeight - panel.offsetHeight - 8)}px`;
    });
    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      savePanelState(panel);
    });

    panel.querySelector("#arcus-fm-run")?.addEventListener("click", runScraper);
    panel.querySelector("#arcus-fm-stop")?.addEventListener("click", () => {
      state.stopRequested = true;
      setStatus("Stopping...");
      pushLog("info", "Stop requested");
      updateButtons();
    });
    panel.querySelector("#arcus-fm-minimize")?.addEventListener("click", () => {
      const minimized = panel.classList.toggle("is-minimized");
      panel.querySelector("#arcus-fm-minimize").textContent = minimized ? "+" : "-";
      savePanelState(panel);
    });
    panel.querySelector("#arcus-fm-close")?.addEventListener("click", () => {
      setPanelDismissed(true);
      removePanel();
    });

    renderLog();
    updateButtons();
  }

  function initIfNeeded() {
    if (!isFrequencyPage() || state.dismissed) {
      removePanel();
      return;
    }
    createPanel();
  }

  window.addEventListener("arcus-toolkit:show-frequency-panel", () => {
    setPanelDismissed(false);
    initIfNeeded();
  });

  window.addEventListener("arcus-toolkit:remove-frequency-panel", () => {
    setPanelDismissed(true);
    removePanel();
  });

  restorePanelDismissed(() => initIfNeeded());

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(initIfNeeded, 700);
    } else if (isFrequencyPage() && !document.querySelector("#arcus-fm-panel") && !state.dismissed) {
      createPanel();
    } else if (!isFrequencyPage() && document.querySelector("#arcus-fm-panel")) {
      removePanel();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => setTimeout(initIfNeeded, 700));
})();
