"use strict";

(() => {
  if (window.__ARCUS_ORDER_ITEM_SCRAPER_LOADED__) return;
  window.__ARCUS_ORDER_ITEM_SCRAPER_LOADED__ = true;

  const SERVER_URL = "http://localhost:8765";
  const ORDER_ITEM_HASH = "!/ordermanagement/orderitem";
  const ORDER_ITEM_CRUD_HASH = "!/ordermanagement/orderitem/crud";
  const PANEL_STATE_KEY = "arcusOrderItemPanelState";
  const PANEL_DISMISSED_KEY = "arcusOrderItemPanelDismissed";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const Driver = window.ArcusDriver;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const state = {
    running: false,
    stopRequested: false,
    dismissed: false,
    codes: [],
    results: [],
    logItems: [],
  };

  function isOrderItemPage() {
    return location.href.includes(ORDER_ITEM_HASH);
  }

  function isOrderItemListPage() {
    return location.href.includes(ORDER_ITEM_HASH) && !location.href.includes(ORDER_ITEM_CRUD_HASH);
  }

  function isOrderItemCrudPage() {
    return location.href.includes(ORDER_ITEM_CRUD_HASH);
  }

  function textOf(el) {
    return ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  // Mutation-driven via the shared driver: resolves on the DOM change that
  // satisfies the predicate rather than on the next 250ms poll.
  async function waitFor(fn, timeoutMs = 12000, _intervalMs = 250) {
    return Driver.waitFor(fn, timeoutMs, { shouldAbort: () => state.stopRequested });
  }

  // Trusted CDP click under turbo, synthetic events otherwise. The driver
  // only scrolls when the element is off-screen, so the old unconditional
  // scroll + sleep(150) per click is gone.
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

  function setNativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function serverGet(path) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: "serverGet", url: `${SERVER_URL}${path}` },
          (resp) => resolve(resp || { ok: false, error: "No response from background" })
        );
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  async function downloadJson(data) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `order-item-instructions-${stamp}.json`;
    const response = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "downloadJson", filename, data }, (resp) => {
          resolve(resp || { ok: false, error: "No response from background" });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
    if (!response.ok) throw new Error(response.error || "JSON download failed");
    return filename;
  }

  async function fetchMedicationCodes() {
    setMilestone("Fetch medication DB", "Reading /api/medication-db from pharmacy server");
    const resp = await serverGet("/api/medication-db");
    if (!resp.ok) throw new Error(`Medication DB read failed: ${resp.error || resp.status || "unknown"}`);
    const db = resp.data || {};
    return Object.keys(db)
      .map((code) => String(code || "").trim())
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }

  async function ensureListPage() {
    if (!isOrderItemListPage()) {
      location.hash = ORDER_ITEM_HASH;
      const ok = await waitFor(() => isOrderItemListPage(), 15000, 200);
      if (!ok) throw new Error("Cannot navigate to Order Item page");
      await settle(3000);
    }
  }

  function getResultRows() {
    return Array.from(document.querySelectorAll("table.md-table tbody tr, tr[ng-repeat*='order']"))
      .filter((row) => row.querySelector("button[id^='orderitemFormModify']"));
  }

  function getCellText(row, columnIndex) {
    const cells = Array.from(row.querySelectorAll("td[md-cell], td"));
    return textOf(cells[columnIndex] || null);
  }

  function readResultRow(row) {
    const cells = Array.from(row.querySelectorAll("td[md-cell], td")).map(textOf);
    return {
      code: cells[0] || "",
      name: cells[1] || "",
      description: cells[2] || "",
      cells,
    };
  }

  function findMatchingResultRow(code) {
    const normalized = String(code || "").trim().toUpperCase();
    return getResultRows().find((row) => {
      const rowCode = getCellText(row, 0).trim().toUpperCase();
      return rowCode === normalized;
    }) || null;
  }

  async function searchCode(code, index, total) {
    await ensureListPage();
    setMilestone("Search code", `[${index + 1}/${total}] ${code}`);

    const input = await waitFor(() => {
      const el = document.querySelector("#orderitemFormCode");
      return el && isVisible(el) ? el : null;
    }, 12000);
    if (!input) throw new Error("#orderitemFormCode not found");

    await clickLikeUser(input);
    setNativeValue(input, "");
    await sleep(80);
    setNativeValue(input, code);
    await sleep(100);

    const searchBtn = await waitFor(() => {
      const el = document.querySelector("#orderitemFormSearch");
      return el && isVisible(el) && !el.disabled ? el : null;
    }, 8000);
    if (!searchBtn) throw new Error("#orderitemFormSearch not found");

    await clickAndSettle(searchBtn, 15000);

    const found = await waitFor(() => {
      const row = findMatchingResultRow(code);
      if (row) return row;
      const alert = findNoResultsAlert();
      if (alert) return { noResultsAlert: alert };
      return null;
    }, 8000, 80);

    if (found?.noResultsAlert) {
      await closeNoResultsAlert(code, found.noResultsAlert);
      return null;
    }

    if (found) return found;

    const closedAlert = await closeNoResultsAlert(code);
    if (closedAlert) return null;

    await pressEscape();
    await sleep(120);
    return null;
  }

  async function pressEscape() {
    for (const target of [document.activeElement, document, window]) {
      try {
        target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
        target.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true }));
      } catch (_) {}
    }
  }

  function findNoResultsAlert() {
    return Array.from(document.querySelectorAll("md-dialog, .md-dialog-container [role='dialog'], .md-dialog-container"))
      .find((el) => isVisible(el) && /no results found|no result|error/i.test(textOf(el))) || null;
  }

  async function closeNoResultsAlert(code, knownDialog = null) {
    const dialog = knownDialog || findNoResultsAlert();
    if (!dialog) return false;

    setMilestone("Close no-result alert", code);
    const okBtn = Array.from(dialog.querySelectorAll("button"))
      .find((button) => isVisible(button) && /^ok$/i.test(textOf(button)));

    if (okBtn) {
      angularClick(okBtn);
    } else {
      await pressEscape();
    }

    await sleep(80);
    if (findNoResultsAlert()) await pressEscape();
    await sleep(120);
    return true;
  }

  async function openCrudForRow(row, code) {
    const modifyBtn = row.querySelector("button[id^='orderitemFormModify']");
    if (!modifyBtn) throw new Error(`Modify button not found for ${code}`);
    setMilestone("Open CRUD", code);
    await clickAndSettle(modifyBtn, 15000);
    const ok = await waitFor(() => isOrderItemCrudPage(), 15000, 250);
    if (!ok) throw new Error(`CRUD page did not open for ${code}`);
    await settle(3000);
  }

  function readSelectText(root, selector) {
    const select = root.querySelector(selector);
    if (!select) return "";
    return textOf(select.querySelector(".md-select-value .md-text")) ||
      textOf(select.querySelector(".md-select-value")) ||
      (select.getAttribute("aria-label") || "").replace(/^[^:]+:\s*/, "").trim();
  }

  function readInputValue(root, selector) {
    const input = root.querySelector(selector);
    return input ? String(input.value || "").trim() : "";
  }

  function getInstructionBlocks() {
    return Array.from(document.querySelectorAll("div[ng-repeat*='orderiteminstructions']"))
      .filter((block) => block.querySelector("#orderitemFormInstructiontypeuid, #orderitemFormInstructionuid, input[id^='orderitemFormInstructiontext']"));
  }

  function scrapeInstructionBlock(block, index) {
    return {
      index: index + 1,
      type: readSelectText(block, "#orderitemFormInstructiontypeuid"),
      instruction: readSelectText(block, "#orderitemFormInstructionuid"),
      text: readInputValue(block, "input[id^='orderitemFormInstructiontext']"),
      localLanguage: readInputValue(block, "input[id^='orderitemFormInstructionlocallangtext']"),
      rawText: textOf(block),
    };
  }

  function scrapeCrudPage(code, listRow) {
    setMilestone("Scrape instructions", code);
    const blocks = getInstructionBlocks();
    const instructions = blocks.map(scrapeInstructionBlock);
    return {
      code,
      listRow,
      instructions,
      instructionCount: instructions.length,
      url: location.href,
      scrapedAt: new Date().toISOString(),
    };
  }

  async function clickCancelAndConfirm(code) {
    setMilestone("Cancel CRUD", code);
    const cancelBtn = await waitFor(() => {
      const el = document.querySelector("#orderitemFormCancel");
      return el && isVisible(el) ? el : null;
    }, 10000);
    if (!cancelBtn) throw new Error(`#orderitemFormCancel not found for ${code}`);

    angularClick(cancelBtn);
    await sleep(250);

    const yesBtn = await waitFor(() => {
      const buttons = Array.from(document.querySelectorAll("md-dialog button, .md-dialog-container button"));
      return buttons.find((button) => {
        if (!isVisible(button)) return false;
        const txt = textOf(button).toLowerCase();
        return button.classList.contains("md-confirm-button") || txt === "yes";
      }) || null;
    }, 8000, 200);

    if (yesBtn) {
      setMilestone("Confirm cancel", code);
      angularClick(yesBtn);
      await sleep(400);
    }

    const back = await waitFor(() => isOrderItemListPage(), 15000, 250);
    if (!back) {
      location.hash = ORDER_ITEM_HASH;
      const recovered = await waitFor(() => isOrderItemListPage(), 10000, 250);
      if (!recovered) throw new Error(`Did not return to Order Item list for ${code}`);
    }
    await sleep(500);
  }

  async function processOneCode(code, index, total) {
    const row = await searchCode(code, index, total);
    if (!row) {
      pushLog("info", `${code}: no matching result`);
      return {
        code,
        status: "not_found",
        instructions: [],
        instructionCount: 0,
        scrapedAt: new Date().toISOString(),
      };
    }

    const listRow = readResultRow(row);
    await openCrudForRow(row, code);
    const result = scrapeCrudPage(code, listRow);
    await clickCancelAndConfirm(code);
    result.status = "ok";
    return result;
  }

  async function runScraper() {
    if (state.running) return;
    state.running = true;
    state.stopRequested = false;
    state.results = [];
    state.codes = [];
    updateButtons();
    setProgress(0, 0);
    pushLog("info", "Order Item scrape started");

    try {
      await ensureListPage();
      state.codes = await fetchMedicationCodes();
      if (!state.codes.length) throw new Error("Medication DB has no codes");

      setProgress(0, state.codes.length);
      setStatus(`Loaded ${state.codes.length} medication codes.\nStarting loop...`);

      for (let i = 0; i < state.codes.length; i++) {
        if (state.stopRequested) break;
        const code = state.codes[i];
        try {
          const result = await processOneCode(code, i, state.codes.length);
          state.results.push(result);
          if (result.status === "ok") {
            pushLog("success", `${code}: ${result.instructionCount} instruction row(s)`);
          }
        } catch (err) {
          state.results.push({
            code,
            status: "error",
            error: err.message || String(err),
            instructions: [],
            instructionCount: 0,
            scrapedAt: new Date().toISOString(),
          });
          pushLog("fail", `${code}: ${err.message || err}`);
          try {
            if (isOrderItemCrudPage()) await clickCancelAndConfirm(code);
          } catch (_) {
            try { location.hash = ORDER_ITEM_HASH; await sleep(1000); } catch (_) {}
          }
        }
        setProgress(i + 1, state.codes.length);
      }

      const okCount = state.results.filter((row) => row.status === "ok").length;
      const notFoundCount = state.results.filter((row) => row.status === "not_found").length;
      const errorCount = state.results.filter((row) => row.status === "error").length;
      const payload = {
        source: "Arcus Order Item",
        url: location.href,
        scrapedAt: new Date().toISOString(),
        totalCodes: state.codes.length,
        processed: state.results.length,
        ok: okCount,
        notFound: notFoundCount,
        error: errorCount,
        stopped: state.stopRequested,
        results: state.results,
      };

      setMilestone("Download JSON", `${state.results.length}/${state.codes.length} processed`);
      const filename = await downloadJson(payload);
      setStatus(`${state.stopRequested ? "Stopped" : "Completed"}.\nOK ${okCount}, not found ${notFoundCount}, error ${errorCount}.\nDownloaded ${filename}`);
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
    const el = document.querySelector("#arcus-oi-status");
    if (el) el.textContent = message;
    console.log("[OrderItemScraper]", message);
  }

  function setMilestone(step, detail = "") {
    const stepEl = document.querySelector("#arcus-oi-step");
    const detailEl = document.querySelector("#arcus-oi-detail");
    if (stepEl) stepEl.textContent = step || "Ready";
    if (detailEl) detailEl.textContent = detail || "";
    setStatus(`${step}${detail ? "\n" + detail : ""}`);
  }

  function setProgress(done, total) {
    const bar = document.querySelector("#arcus-oi-bar");
    const label = document.querySelector("#arcus-oi-label");
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    if (bar) bar.style.width = `${pct}%`;
    if (label) label.textContent = total ? `${done} / ${total} (${pct}%)` : String(done);
  }

  function pushLog(type, message) {
    state.logItems.unshift({ type, message, time: new Date().toLocaleTimeString() });
    state.logItems = state.logItems.slice(0, 180);
    renderLog();
  }

  function renderLog() {
    const root = document.querySelector("#arcus-oi-log");
    if (!root) return;
    root.innerHTML = state.logItems.length
      ? state.logItems.map((item) => `<div class="arcus-oi-log-${item.type}"><span>${esc(item.time)}</span> ${esc(item.message)}</div>`).join("")
      : '<div class="arcus-oi-log-info">No log yet.</div>';
  }

  function updateButtons() {
    const run = document.querySelector("#arcus-oi-run");
    const stop = document.querySelector("#arcus-oi-stop");
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
          const btn = panel.querySelector("#arcus-oi-minimize");
          if (btn) btn.textContent = "+";
        }
      });
    } catch (_) {}
  }

  function injectStyles() {
    if (document.querySelector("#arcus-oi-style")) return;
    const style = document.createElement("style");
    style.id = "arcus-oi-style";
    style.textContent = `
      #arcus-oi-panel {
        position:fixed; top:92px; right:18px; z-index:999999; width:320px;
        background:#fff; border:1px solid #dde4ef; border-radius:8px;
        box-shadow:0 4px 20px rgba(0,0,0,.18); font-family:'Segoe UI',system-ui,sans-serif;
        font-size:12px; color:#1a1a2e;
      }
      #arcus-oi-panel.is-minimized #arcus-oi-body { display:none; }
      #arcus-oi-header {
        background:#455a64; color:#fff; padding:10px 12px; border-radius:8px 8px 0 0;
        display:flex; justify-content:space-between; gap:8px; cursor:move;
      }
      .arcus-oi-title { font-size:13px; font-weight:700; }
      .arcus-oi-desc { font-size:10px; opacity:.82; margin-top:2px; }
      .arcus-oi-actions { display:flex; gap:4px; }
      .arcus-oi-icon {
        width:22px; height:22px; border:0; border-radius:5px; color:#fff;
        background:rgba(255,255,255,.18); cursor:pointer;
      }
      #arcus-oi-body { padding:10px 12px 12px; }
      .arcus-oi-row { display:flex; gap:6px; margin-bottom:8px; }
      .arcus-oi-btn {
        flex:1; border:0; border-radius:6px; padding:7px 6px; font-size:11px;
        font-weight:600; color:#fff; cursor:pointer;
      }
      .arcus-oi-btn:disabled { opacity:.4; cursor:not-allowed; }
      #arcus-oi-run { background:#1565c0; }
      #arcus-oi-stop { background:#c62828; }
      .arcus-oi-track { height:7px; background:#e0e7ef; border-radius:4px; overflow:hidden; margin-bottom:4px; }
      #arcus-oi-bar { height:100%; background:#1565c0; width:0; transition:width .2s; }
      #arcus-oi-label { font-size:10px; color:#607d8b; text-align:right; margin-bottom:8px; }
      .arcus-oi-step-card {
        padding:7px 8px; background:#f7f9fc; border:1px solid #e3e8ef;
        border-radius:6px; margin-bottom:8px;
      }
      .arcus-oi-step-label { font-size:9px; color:#78909c; text-transform:uppercase; font-weight:700; }
      #arcus-oi-step { font-size:12px; font-weight:700; color:#263238; margin-top:2px; }
      #arcus-oi-detail { font-size:10.5px; color:#546e7a; margin-top:2px; word-break:break-word; }
      #arcus-oi-status {
        font-size:11px; line-height:1.4; white-space:pre-line; word-break:break-word;
        padding:6px 8px; border-left:3px solid #1565c0; border-radius:4px;
        background:#f0f4ff; color:#263b62; margin-bottom:8px;
      }
      #arcus-oi-log { max-height:160px; overflow-y:auto; font-size:10px; }
      #arcus-oi-log > div { padding:3px 0; border-bottom:1px solid #f0f0f0; line-height:1.3; }
      #arcus-oi-log span { color:#9e9e9e; margin-right:4px; }
      .arcus-oi-log-success { color:#2e7d32; }
      .arcus-oi-log-fail { color:#c62828; }
      .arcus-oi-log-info { color:#444; }
    `;
    document.head.appendChild(style);
  }

  function removePanel() {
    document.querySelector("#arcus-oi-panel")?.remove();
  }

  function createPanel() {
    if (!isOrderItemPage() || state.dismissed || document.querySelector("#arcus-oi-panel")) return;
    injectStyles();
    const panel = document.createElement("div");
    panel.id = "arcus-oi-panel";
    panel.innerHTML = `
      <div id="arcus-oi-header">
        <div>
          <div class="arcus-oi-title">Order Item Scraper</div>
          <div class="arcus-oi-desc">Medication DB code loop + instruction export</div>
        </div>
        <div class="arcus-oi-actions">
          <button id="arcus-oi-minimize" class="arcus-oi-icon" title="Minimize">-</button>
          <button id="arcus-oi-close" class="arcus-oi-icon" title="Close">X</button>
        </div>
      </div>
      <div id="arcus-oi-body">
        <div class="arcus-oi-row">
          <button id="arcus-oi-run" class="arcus-oi-btn">Start</button>
          <button id="arcus-oi-stop" class="arcus-oi-btn" disabled>Stop</button>
        </div>
        <div class="arcus-oi-track"><div id="arcus-oi-bar"></div></div>
        <div id="arcus-oi-label">0</div>
        <div class="arcus-oi-step-card">
          <div class="arcus-oi-step-label">Milestone</div>
          <div id="arcus-oi-step">Ready</div>
          <div id="arcus-oi-detail">Start when Order Item page is loaded.</div>
        </div>
        <div id="arcus-oi-status">Ready.</div>
        <div id="arcus-oi-log"></div>
      </div>
    `;
    document.body.appendChild(panel);
    restorePanelState(panel);

    const header = panel.querySelector("#arcus-oi-header");
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

    panel.querySelector("#arcus-oi-run")?.addEventListener("click", runScraper);
    panel.querySelector("#arcus-oi-stop")?.addEventListener("click", () => {
      state.stopRequested = true;
      setMilestone("Stopping", "Will stop after current code");
      pushLog("info", "Stop requested");
      updateButtons();
    });
    panel.querySelector("#arcus-oi-minimize")?.addEventListener("click", () => {
      const minimized = panel.classList.toggle("is-minimized");
      panel.querySelector("#arcus-oi-minimize").textContent = minimized ? "+" : "-";
      savePanelState(panel);
    });
    panel.querySelector("#arcus-oi-close")?.addEventListener("click", () => {
      setPanelDismissed(true);
      removePanel();
    });

    renderLog();
    updateButtons();
  }

  function initIfNeeded() {
    if (!isOrderItemPage() || state.dismissed) {
      removePanel();
      return;
    }
    createPanel();
  }

  window.addEventListener("arcus-toolkit:show-order-item-panel", () => {
    setPanelDismissed(false);
    initIfNeeded();
  });

  window.addEventListener("arcus-toolkit:remove-order-item-panel", () => {
    setPanelDismissed(true);
    removePanel();
  });

  restorePanelDismissed(() => initIfNeeded());

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(initIfNeeded, 700);
    } else if (isOrderItemPage() && !document.querySelector("#arcus-oi-panel") && !state.dismissed) {
      createPanel();
    } else if (!isOrderItemPage() && document.querySelector("#arcus-oi-panel")) {
      removePanel();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => setTimeout(initIfNeeded, 700));
})();
