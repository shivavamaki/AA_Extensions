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
    getSelectedRowFilters,
    getSelectedRowFilterLabel,
  } = window.ArcusShared;

  function setStatus(message) {
    const el = document.querySelector("#arcus-auto-status");
    if (el) el.textContent = message;
    console.log("[Arcus Panel]", message);
  }

  function setStep(stepName, detail = "") {
    const stepEl = document.querySelector("#arcus-current-step");
    const detailEl = document.querySelector("#arcus-current-detail");
    if (stepEl) stepEl.textContent = stepName || "Ready";
    if (detailEl) detailEl.textContent = detail || "";
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
    // Logs are intentionally kept in memory only. The UI is compact and does not show log list.
  }

  function renderLog() {
    // no visible log in compact v3.8.0 panel
  }

  function renderScrapePreview() {
    // hidden in compact automation panel
  }

  function normalizeSelectedFilters(selected) {
    const arr = Array.isArray(selected) ? selected.filter(Boolean) : [selected || "all"];
    if (!arr.length || arr.includes("all")) return ["all"];
    return Array.from(new Set(arr.filter((v) => v !== "all")));
  }

  function readSelectedFilters(panel = document) {
    const boxes = Array.from(panel.querySelectorAll(".arcus-order-type-check"));
    const checked = boxes.filter((box) => box.checked).map((box) => box.value);
    return normalizeSelectedFilters(checked);
  }

  function applySelectedFilters(panel, selected) {
    const normalized = normalizeSelectedFilters(selected);
    panel.querySelectorAll(".arcus-order-type-check").forEach((box) => {
      box.checked = normalized.includes("all") ? box.value === "all" : normalized.includes(box.value);
    });
    state.settings.rowFilters = normalized;
    state.settings.rowFilter = normalized.includes("all") ? "all" : normalized[0] || "all";
  }

  function updateButtonState() {
    const running = state.isRunning;
    const scraperRunning = state.scraper.state === "running";

    const allocateBtn = document.querySelector("#arcus-btn-allocate");
    const dispenseBtn = document.querySelector("#arcus-btn-dispense");
    const stopBtn = document.querySelector("#arcus-btn-stop");
    const copyBtn = document.querySelector("#arcus-btn-copy-log");
    const waitOverride = document.querySelector("#arcus-manual-override");
    const modeSelect = document.querySelector("#arcus-mode-select");
    const filterBoxes = document.querySelectorAll(".arcus-order-type-check");

    if (allocateBtn) allocateBtn.disabled = running || scraperRunning;
    if (dispenseBtn) dispenseBtn.disabled = running || scraperRunning;
    if (stopBtn) stopBtn.disabled = !(running || scraperRunning);
    if (copyBtn) copyBtn.disabled = false;
    if (waitOverride) waitOverride.disabled = running || scraperRunning;
    if (modeSelect) modeSelect.disabled = running || scraperRunning;
    filterBoxes.forEach((box) => (box.disabled = running || scraperRunning));
  }

  function savePanelState(panel) {
    const waitOverrideEl = document.querySelector("#arcus-manual-override");
    const modeSelectEl = document.querySelector("#arcus-mode-select");
    const minimized = panel.classList.contains("is-minimized");
    const rowFilters = readSelectedFilters(panel);

    chrome.storage?.local?.set({
      [PANEL_STORAGE_KEY]: {
        top: panel.style.top || "",
        left: panel.style.left || "",
        right: panel.style.right || "",
        bottom: panel.style.bottom || "",
        minimized,
        width: panel.style.width || "",
        rowFilter: rowFilters.includes("all") ? "all" : rowFilters[0] || "all",
        rowFilters,
        waitManualOverride: !!waitOverrideEl?.checked,
        automationMode: modeSelectEl?.value || state.settings.automationMode || "auto",
      },
    });
  }

  function restorePanelState(panel) {
    chrome.storage?.local?.get(PANEL_STORAGE_KEY, (data) => {
      const saved = data?.[PANEL_STORAGE_KEY];
      const waitOverrideEl = panel.querySelector("#arcus-manual-override");
      const modeSelectEl = panel.querySelector("#arcus-mode-select");

      if (!saved) {
        applySelectedFilters(panel, state.settings.rowFilters || [state.settings.rowFilter || "all"]);
        state.settings.waitManualOverride = true;
        if (waitOverrideEl) waitOverrideEl.checked = true;
        if (modeSelectEl) modeSelectEl.value = state.settings.automationMode || "auto";
        return;
      }

      if (saved.top) panel.style.top = saved.top;
      if (saved.left) panel.style.left = saved.left;
      if (saved.right) panel.style.right = saved.right;
      if (saved.bottom) panel.style.bottom = saved.bottom;
      if (saved.width) panel.style.width = saved.width;

      const restoredFilters = normalizeSelectedFilters(saved.rowFilters || saved.rowFilter || "all");
      applySelectedFilters(panel, restoredFilters);

      // v3.8.0: default must be checked even if an older saved state was unchecked.
      state.settings.waitManualOverride = true;
      if (saved.automationMode) state.settings.automationMode = saved.automationMode;
      if (waitOverrideEl) waitOverrideEl.checked = state.settings.waitManualOverride;
      if (modeSelectEl) modeSelectEl.value = state.settings.automationMode || "auto";

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
    const waitOverride = panel.querySelector("#arcus-manual-override");
    const modeSelect = panel.querySelector("#arcus-mode-select");

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

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
      const nextLeft = clamp(startLeft + (event.clientX - startX), 8, window.innerWidth - panel.offsetWidth - 8);
      const nextTop = clamp(startTop + (event.clientY - startY), 8, window.innerHeight - panel.offsetHeight - 8);
      panel.style.left = `${nextLeft}px`;
      panel.style.top = `${nextTop}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("is-dragging");
      savePanelState(panel);
    });

    minimizeBtn?.addEventListener("click", () => {
      const minimized = panel.classList.toggle("is-minimized");
      minimizeBtn.textContent = minimized ? "+" : "—";
      savePanelState(panel);
    });

    closeBtn?.addEventListener("click", () => {
      setPanelDismissed(true);
      removePanel();
    });

    panel.querySelectorAll(".arcus-order-type-check").forEach((box) => {
      box.addEventListener("change", () => {
        const boxes = Array.from(panel.querySelectorAll(".arcus-order-type-check"));
        let selected;

        if (box.value === "all" && box.checked) {
          selected = ["all"];
        } else {
          selected = boxes
            .filter((item) => item.value !== "all" && item.checked)
            .map((item) => item.value);
        }

        if (!selected.length) selected = ["all"];

        applySelectedFilters(panel, selected);
        pushLog("info", `Order type changed to ${getSelectedRowFilterLabel()}`, "Settings");
        setStep("Ready", `Order type: ${getSelectedRowFilterLabel()}`);
        savePanelState(panel);
      });
    });

    waitOverride?.addEventListener("change", () => {
      state.settings.waitManualOverride = waitOverride.checked;
      pushLog("info", `Manual override wait `, "Settings");
      savePanelState(panel);
    });

    modeSelect?.addEventListener("change", () => {
      state.settings.automationMode = modeSelect.value || "auto";
      const label = state.settings.automationMode === "auto"
        ? "Auto mode: refresh search and process by status"
        : "Semi-auto mode: selected order type only";
      setStep("Mode changed", label);
      pushLog("info", label, "Settings");
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
    });
  }

  function createPanel() {
    if (document.querySelector("#arcus-auto-panel")) return;

    const panel = document.createElement("div");
    panel.id = "arcus-auto-panel";
    panel.className = "arcus-compact-panel";
    panel.innerHTML = `
      <div id="arcus-auto-header" class="arcus-panel-header compact">
        <div class="arcus-panel-title-wrap">
          <div class="title">Arcus Auto</div>
          <div class="desc">Allocate / Dispense</div>
        </div>
        <div class="arcus-panel-actions">
          <button id="arcus-btn-minimize" class="icon-btn" title="Minimize / Restore">—</button>
          <button id="arcus-btn-close" class="icon-btn" title="Close">✕</button>
        </div>
      </div>

      <div id="arcus-auto-body" class="arcus-panel-body compact-body">
        <div class="field-group compact-field">
          <div class="section-title">Mode</div>
          <select id="arcus-mode-select" class="select compact-select">
            <option value="auto">Auto: refresh search + status Ordered/Allocated</option>
            <option value="semi">Semi-auto: selected order type</option>
          </select>
        </div>

        <div class="field-group compact-field">
          <div class="section-title">Order type</div>
          <div class="arcus-check-grid">
            <label><input class="arcus-order-type-check" type="checkbox" value="all" checked /> ALL</label>
            <label><input class="arcus-order-type-check" type="checkbox" value="daily" /> DAILY</label>
            <label><input class="arcus-order-type-check" type="checkbox" value="continuous" /> CONT.</label>
            <label><input class="arcus-order-type-check" type="checkbox" value="discharge" /> D/C</label>
          </div>
        </div>

        <label class="checkbox-line compact-check">
          <input id="arcus-manual-override" type="checkbox" checked />
          <span>Wait manual override</span>
        </label>

        <div class="btn-row compact-buttons">
          <button id="arcus-btn-allocate" class="btn">Allocate</button>
          <button id="arcus-btn-dispense" class="btn">Dispense</button>
          <button id="arcus-btn-stop" class="btn" disabled>Stop</button>
        </div>

        <div class="arcus-step-card">
          <div class="arcus-step-label">Current step</div>
          <div id="arcus-current-step" class="arcus-step-name">Ready</div>
          <div id="arcus-current-detail" class="arcus-step-detail">Order type: ALL ROW</div>
        </div>

        <div id="arcus-auto-status" class="status compact-status">Ready</div>

        <div class="summary compact-summary">
          <div class="metric"><div class="label">Done</div><div id="arcus-stat-processed" class="value">0</div></div>
          <div class="metric"><div class="label">OK</div><div id="arcus-stat-success" class="value">0</div></div>
          <div class="metric"><div class="label">Fail</div><div id="arcus-stat-fail" class="value">0</div></div>
        </div>

        <button id="arcus-btn-copy-log" class="small-btn">Copy hidden log</button>
      </div>
    `;

    document.body.appendChild(panel);
    attachPanelInteractions(panel);
    renderStats();
    updateButtonState();
    setStep("Ready", `Order type: ${getSelectedRowFilterLabel()}`);

    document.querySelector("#arcus-btn-copy-log")?.addEventListener("click", async () => {
      const text = state.logItems
        .map((item) => `[${item.time}] ${item.type.toUpperCase()}${item.meta ? ` (${item.meta})` : ""} - ${item.message}`)
        .join("\n");

      try {
        await navigator.clipboard.writeText(text || "No log yet.");
        setStep("Log copied", "Hidden log copied to clipboard");
        pushLog("info", "Log copied to clipboard");
      } catch (error) {
        setStep("Copy failed", error.message || "clipboard error");
        pushLog("fail", "Failed to copy log", error.message || "clipboard error");
      }
    });
  }

  window.ArcusPanel = {
    setStatus,
    setStep,
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
