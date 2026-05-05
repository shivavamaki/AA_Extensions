(() => {
  if (window.__ARCUS_PANEL_LOADED__) return;
  window.__ARCUS_PANEL_LOADED__ = true;

  const {
    PANEL_STORAGE_KEY,
    ORDER_FILTERS,
    state,
    clamp,
    escapeHtml,
    setPanelDismissed,
  } = window.ArcusShared;

  function setStatus(message) {
    const el = document.querySelector("#arcus-auto-status");
    if (el) el.textContent = message;
    console.log("[Arcus Panel]", message);
  }

  function renderStats() {
    const processed = document.querySelector("#arcus-stat-processed");
    const success = document.querySelector("#arcus-stat-success");
    const fail = document.querySelector("#arcus-stat-fail");
    if (processed) processed.textContent = String(state.stats.processed);
    if (success) success.textContent = String(state.stats.success);
    if (fail) fail.textContent = String(state.stats.fail);
  }

  function pushLog(type, message, meta = "") {
    const time = new Date().toLocaleTimeString();
    state.logItems.unshift({ type, message, meta, time });
    state.logItems = state.logItems.slice(0, 250);
    renderLog();
  }

  function renderLog() {
    const root = document.querySelector("#arcus-auto-log");
    if (!root) return;

    if (!state.logItems.length) {
      root.innerHTML = '<div class="log-item info">No log yet.</div>';
      return;
    }

    root.innerHTML = state.logItems
      .map(
        (item) => `
          <div class="log-item ${item.type}">
            <div class="meta">${item.time}${item.meta ? " • " + escapeHtml(item.meta) : ""}</div>
            <div>${escapeHtml(item.message)}</div>
          </div>
        `
      )
      .join("");
  }

  function renderScrapePreview(items = []) {
    const root = document.querySelector("#arcus-scrape-preview");
    if (!root) return;

    if (!items.length) {
      root.classList.remove("visible");
      root.innerHTML = "";
      return;
    }

    root.classList.add("visible");
    root.innerHTML = items
      .slice(0, 8)
      .map(
        (item, index) => `
          <div class="scrape-item">
            <div class="scrape-title">#${index + 1} ${escapeHtml(item.summary || "(empty)")}</div>
            <div class="scrape-text">${escapeHtml((item.detail || "").slice(0, 240))}</div>
          </div>
        `
      )
      .join("");
  }

  function updateButtonState() {
    const running = state.isRunning;
    const scraperRunning = state.scraper.state === "running";

    const allocateBtn = document.querySelector("#arcus-btn-allocate");
    const dispenseBtn = document.querySelector("#arcus-btn-dispense");
    const stopBtn = document.querySelector("#arcus-btn-stop");
    const clearBtn = document.querySelector("#arcus-btn-clear-log");
    const copyBtn = document.querySelector("#arcus-btn-copy-log");
    const rowFilter = document.querySelector("#arcus-row-filter");
    const waitOverride = document.querySelector("#arcus-manual-override");

    if (allocateBtn) allocateBtn.disabled = running || scraperRunning;
    if (dispenseBtn) dispenseBtn.disabled = running || scraperRunning;
    if (stopBtn) stopBtn.disabled = !(running || scraperRunning);
    if (clearBtn) clearBtn.disabled = running || scraperRunning;
    if (copyBtn) copyBtn.disabled = false;
    if (rowFilter) rowFilter.disabled = running || scraperRunning;
    if (waitOverride) waitOverride.disabled = running || scraperRunning;
  }

  function savePanelState(panel) {
    const rowFilterEl = document.querySelector("#arcus-row-filter");
    const waitOverrideEl = document.querySelector("#arcus-manual-override");

    const minimized = panel.classList.contains("is-minimized");

    chrome.storage?.local?.set({
      [PANEL_STORAGE_KEY]: {
        top: panel.style.top || "",
        left: panel.style.left || "",
        right: panel.style.right || "",
        bottom: panel.style.bottom || "",
        minimized,
        width: panel.style.width || "",
        rowFilter: rowFilterEl?.value || state.settings.rowFilter,
        waitManualOverride: !!waitOverrideEl?.checked,
      },
    });
  }

  function restorePanelState(panel) {
    chrome.storage?.local?.get(PANEL_STORAGE_KEY, (data) => {
      const saved = data?.[PANEL_STORAGE_KEY];
      if (!saved) {
        const rowFilterEl = panel.querySelector("#arcus-row-filter");
        const waitOverrideEl = panel.querySelector("#arcus-manual-override");
        if (rowFilterEl) rowFilterEl.value = state.settings.rowFilter;
        if (waitOverrideEl) waitOverrideEl.checked = state.settings.waitManualOverride;
        return;
      }

      if (saved.top) panel.style.top = saved.top;
      if (saved.left) panel.style.left = saved.left;
      if (saved.right) panel.style.right = saved.right;
      if (saved.bottom) panel.style.bottom = saved.bottom;
      if (saved.width) panel.style.width = saved.width;

      if (saved.rowFilter) state.settings.rowFilter = saved.rowFilter;
      if (typeof saved.waitManualOverride === "boolean") {
        state.settings.waitManualOverride = saved.waitManualOverride;
      }

      const rowFilterEl = panel.querySelector("#arcus-row-filter");
      const waitOverrideEl = panel.querySelector("#arcus-manual-override");

      if (rowFilterEl) rowFilterEl.value = state.settings.rowFilter;
      if (waitOverrideEl) waitOverrideEl.checked = state.settings.waitManualOverride;

      if (saved.minimized) {
        panel.classList.add("is-minimized");
        const btn = panel.querySelector("#arcus-btn-minimize");
        if (btn) btn.textContent = "+";
      }
    });
  }

  function removePanel() {
    const panel = document.querySelector("#arcus-auto-panel");
    if (panel) panel.remove();
  }

  function attachPanelInteractions(panel) {
    restorePanelState(panel);

    const header = panel.querySelector("#arcus-auto-header");
    const minimizeBtn = panel.querySelector("#arcus-btn-minimize");
    const closeBtn = panel.querySelector("#arcus-btn-close");
    const rowFilter = panel.querySelector("#arcus-row-filter");
    const waitOverride = panel.querySelector("#arcus-manual-override");

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    // AbortController so window-level listeners are cleaned up when panel is removed
    const ac = new AbortController();
    const { signal } = ac;
    const panelRemovalObserver = new MutationObserver(() => {
      if (!document.contains(panel)) {
        panelRemovalObserver.disconnect();
        ac.abort();
      }
    });
    panelRemovalObserver.observe(document.body, { childList: true, subtree: true });

    header?.addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) return;

      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      panel.classList.add("is-dragging");
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";

      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!dragging) return;

      const nextLeft = clamp(
        startLeft + (event.clientX - startX),
        8,
        window.innerWidth - panel.offsetWidth - 8
      );

      const nextTop = clamp(
        startTop + (event.clientY - startY),
        8,
        window.innerHeight - panel.offsetHeight - 8
      );

      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    }, { signal });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("is-dragging");
      savePanelState(panel);
    }, { signal });

    minimizeBtn?.addEventListener("click", () => {
      const minimized = panel.classList.toggle("is-minimized");
      minimizeBtn.textContent = minimized ? "+" : "—";
      savePanelState(panel);
    });

    closeBtn?.addEventListener("click", () => {
      setPanelDismissed(true);
      removePanel();
    });

    rowFilter?.addEventListener("change", () => {
      state.settings.rowFilter = rowFilter.value;
      pushLog("info", `Row filter changed to ${ORDER_FILTERS[state.settings.rowFilter]}`, "Settings");
      savePanelState(panel);
    });

    waitOverride?.addEventListener("change", () => {
      state.settings.waitManualOverride = waitOverride.checked;
      pushLog(
        "info",
        `Manual override wait ${state.settings.waitManualOverride ? "enabled" : "disabled"}`,
        "Settings"
      );
      savePanelState(panel);
    });

    window.addEventListener("resize", () => {
      const rect = panel.getBoundingClientRect();
      const nextLeft = clamp(rect.left, 8, Math.max(8, window.innerWidth - panel.offsetWidth - 8));
      const nextTop = clamp(rect.top, 8, Math.max(8, window.innerHeight - panel.offsetHeight - 8));

      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
      panel.style.right = "auto";
      panel.style.bottom = "auto";
      savePanelState(panel);
    }, { signal });
  }

  function createPanel() {
    if (document.querySelector("#arcus-auto-panel")) return;

    const panel = document.createElement("div");
    panel.id = "arcus-auto-panel";
    panel.innerHTML = `
      <div id="arcus-auto-header" class="arcus-panel-header">
        <div class="arcus-panel-title-wrap">
          <div class="title">Arcus Auto Tools v2</div>
          <div class="desc">Shared row engine with order-type filter and manual override wait.</div>
        </div>
        <div class="arcus-panel-actions">
          <button id="arcus-btn-minimize" class="icon-btn" title="Minimize / Restore">—</button>
          <button id="arcus-btn-close" class="icon-btn" title="Close">✕</button>
        </div>
      </div>

      <div id="arcus-auto-body" class="arcus-panel-body">
        <div class="field-group">
          <div class="section-title">Row selection</div>
          <select id="arcus-row-filter" class="select">
            <option value="all">ALL ROW</option>
            <option value="daily">DAILY ORDER</option>
            <option value="continuous">CONTINUOUS ORDER</option>
            <option value="discharge">DISCHARGE MEDICATION</option>
          </select>
        </div>

        <label class="checkbox-line">
          <input id="arcus-manual-override" type="checkbox" checked />
          <span>Wait for manual Override reason and user Save</span>
        </label>

        <div class="hint-box">
          If Override reason is required, system will pause and wait for user to select reason and click Save, then continue automatically.
        </div>

        <div class="btn-row">
          <button id="arcus-btn-allocate" class="btn">Auto Allocate</button>
          <button id="arcus-btn-dispense" class="btn">Auto Dispensed</button>
        </div>

        <button id="arcus-btn-stop" class="btn" disabled>Stop</button>

        <div id="arcus-auto-status" class="status">Ready</div>

        <div class="summary">
          <div class="metric">
            <div class="label">Processed</div>
            <div id="arcus-stat-processed" class="value">0</div>
          </div>
          <div class="metric">
            <div class="label">Success</div>
            <div id="arcus-stat-success" class="value">0</div>
          </div>
          <div class="metric">
            <div class="label">Fail</div>
            <div id="arcus-stat-fail" class="value">0</div>
          </div>
        </div>

        <div class="btn-row">
          <button id="arcus-btn-clear-log" class="small-btn">Clear Log</button>
          <button id="arcus-btn-copy-log" class="small-btn">Copy Log</button>
        </div>

        <div id="arcus-auto-log"></div>
        <div id="arcus-scrape-preview"></div>
      </div>
    `;

    document.body.appendChild(panel);
    attachPanelInteractions(panel);
    renderStats();
    renderLog();
    renderScrapePreview([]);
    updateButtonState();

    document.querySelector("#arcus-btn-clear-log")?.addEventListener("click", () => {
      state.logItems = [];
      renderLog();
      renderScrapePreview([]);
    });

    document.querySelector("#arcus-btn-copy-log")?.addEventListener("click", async () => {
      const text = state.logItems
        .map((item) => `[${item.time}] ${item.type.toUpperCase()}${item.meta ? ` (${item.meta})` : ""} - ${item.message}`)
        .join("\n");

      try {
        await navigator.clipboard.writeText(text || "No log yet.");
        pushLog("info", "Log copied to clipboard");
      } catch (error) {
        pushLog("fail", "Failed to copy log", error.message || "clipboard error");
      }
    });
  }

  window.ArcusPanel = {
    setStatus,
    renderStats,
    pushLog,
    renderLog,
    renderScrapePreview,
    updateButtonState,
    savePanelState,
    restorePanelState,
    removePanel,
    createPanel,
  };
})();