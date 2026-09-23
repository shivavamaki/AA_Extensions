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
    detectPharmacyType,
    getEffectivePharmacyType,
  } = window.ArcusShared;

  const TURBO_LABELS = {
    on: "on",
    off: "off",
    connecting: "connecting...",
    unavailable: "unavailable",
  };

  function setAutoOverrideState(mode, detail) {
    const el = document.querySelector("#arcus-auto-override-state");
    if (!el) return;
    el.textContent = TURBO_LABELS[mode] || mode;
    el.className = "arcus-turbo-state arcus-turbo-" + mode;
    el.title = detail || "";
  }

  function setTurboState(mode, detail) {
    const el = document.querySelector("#arcus-turbo-state");
    if (!el) return;
    el.textContent = TURBO_LABELS[mode] || mode;
    el.className = "arcus-turbo-state arcus-turbo-" + mode;
    el.title = detail || "";
  }

  // The driver announces its own downgrades (lost debugger session, refused
  // attach), so the panel stays truthful without polling.
  window.addEventListener("arcus-driver:mode", (event) => {
    const mode = event.detail?.mode === "turbo" ? "on" : "off";
    setTurboState(event.detail?.reason ? "unavailable" : mode, event.detail?.reason);
    const toggle = document.querySelector("#arcus-turbo");
    if (toggle) toggle.checked = event.detail?.mode === "turbo";
  });

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
    window.ArcusPanelHost.refresh();
    const running = state.isRunning;

    // Fade the panel only while idle. During a run it must stay fully legible,
    // since that is when its status actually matters.
    const panelEl = document.querySelector("#arcus-auto-panel");
    if (panelEl) panelEl.classList.toggle("is-idle", !running);

    const allocateBtn = document.querySelector("#arcus-btn-allocate");
    const dispenseBtn = document.querySelector("#arcus-btn-dispense");
    const stopBtn = document.querySelector("#arcus-btn-stop");
    const copyBtn = document.querySelector("#arcus-btn-copy-log");
    const waitOverride = document.querySelector("#arcus-manual-override");
    const modeSelect = document.querySelector("#arcus-mode-select");
    const pharmacyTypeSelect = document.querySelector("#arcus-pharmacy-type");
    const filterBoxes = document.querySelectorAll(".arcus-order-type-check");

    if (allocateBtn) allocateBtn.disabled = running;
    if (dispenseBtn) dispenseBtn.disabled = running;
    if (stopBtn) stopBtn.disabled = !running;
    if (copyBtn) copyBtn.disabled = false;
    if (waitOverride) waitOverride.disabled = running;
    if (modeSelect) modeSelect.disabled = running;
    if (pharmacyTypeSelect) pharmacyTypeSelect.disabled = running;
    filterBoxes.forEach((box) => (box.disabled = running));
  }

  function savePanelState(panel) {
    const waitOverrideEl = document.querySelector("#arcus-manual-override");
    const modeSelectEl = document.querySelector("#arcus-mode-select");
    const pharmacyTypeEl = document.querySelector("#arcus-pharmacy-type");
    const minimized = panel.classList.contains("is-minimized");
    const rowFilters = readSelectedFilters(panel);

    // Reloading the extension while this page stays open invalidates the
    // context: chrome.storage still exists, but calling it throws. The optional
    // chaining above only guards absence, not a dead connection.
    try {
      window.ArcusTabSettings?.set({
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
        pharmacyType: pharmacyTypeEl?.value || state.settings.pharmacyType || "auto",
      },
      });
    } catch (_) {
      // Panel position is a convenience; losing it is not worth an exception.
    }
  }

  function updateLocationLabel(panel) {
    const label = panel.querySelector("#arcus-location-detected");
    if (!label) return;
    const detected = detectPharmacyType();
    label.textContent = detected ? `detected: ${detected}` : "not detected";
  }

  function restorePanelState(panel) {
    try {
      window.ArcusTabSettings?.get(PANEL_STORAGE_KEY, (data) => {
      const saved = data?.[PANEL_STORAGE_KEY];
      const waitOverrideEl = panel.querySelector("#arcus-manual-override");
      const modeSelectEl = panel.querySelector("#arcus-mode-select");
      const pharmacyTypeEl = panel.querySelector("#arcus-pharmacy-type");

      updateLocationLabel(panel);

      if (!saved) {
        if (pharmacyTypeEl) pharmacyTypeEl.value = state.settings.pharmacyType || "auto";
        renderOrderTypeSection(panel, state.settings.rowFilters || [state.settings.rowFilter || "all"]);
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

      state.settings.waitManualOverride = saved.waitManualOverride !== false;
      if (saved.automationMode) state.settings.automationMode = saved.automationMode;
      if (saved.pharmacyType) state.settings.pharmacyType = saved.pharmacyType;
      if (waitOverrideEl) waitOverrideEl.checked = state.settings.waitManualOverride;
      if (modeSelectEl) modeSelectEl.value = state.settings.automationMode || "auto";
      if (pharmacyTypeEl) pharmacyTypeEl.value = state.settings.pharmacyType || "auto";

      renderOrderTypeSection(panel, normalizeSelectedFilters(saved.rowFilters || saved.rowFilter || "all"));

      if (saved.minimized) {
        panel.classList.add("is-minimized");
        const btn = panel.querySelector("#arcus-btn-minimize");
        if (btn) btn.textContent = "+";
      }
      });
    } catch (_) {
      // Dead extension context; the panel just opens with its defaults.
      updateLocationLabel(panel);
    }
  }

  function removePanel() {
    if (state.isRunning) { window.ArcusPanelHost.restore("arcus-auto-panel"); return; }
    const panel = document.querySelector("#arcus-auto-panel");
    if (panel) panel.remove();
  }

  function attachOrderTypeListeners(panel) {
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
  }

  function renderOrderTypeSection(panel, filtersToRestore) {
    const container = panel.querySelector("#arcus-order-type-container");
    if (!container) return;

    const isOpd = getEffectivePharmacyType() === "outpatient";

    if (isOpd) {
      container.innerHTML = `
        <label><input class="arcus-order-type-check" type="checkbox" value="all" /> ALL</label>
        <label><input class="arcus-order-type-check" type="checkbox" value="stat" /> STAT</label>
        <label><input class="arcus-order-type-check" type="checkbox" value="routine" /> ROUTINE</label>
      `;
    } else {
      container.innerHTML = `
        <label><input class="arcus-order-type-check" type="checkbox" value="all" /> ALL</label>
        <label><input class="arcus-order-type-check" type="checkbox" value="daily" /> DAILY</label>
        <label><input class="arcus-order-type-check" type="checkbox" value="continuous" /> CONT.</label>
        <label><input class="arcus-order-type-check" type="checkbox" value="discharge" /> D/C</label>
      `;
    }

    const boxes = Array.from(container.querySelectorAll(".arcus-order-type-check"));
    const validValues = new Set(boxes.map((b) => b.value));

    let effective = ["all"];
    if (filtersToRestore && filtersToRestore.length) {
      const compatible = filtersToRestore.filter((f) => validValues.has(f));
      if (compatible.length && !compatible.includes("all")) {
        effective = compatible;
      }
    }
    applySelectedFilters(panel, effective);
    boxes.forEach((box) => { box.disabled = state.isRunning; });
    setStep("Ready", `Order type: ${getSelectedRowFilterLabel()}`);
    attachOrderTypeListeners(panel);
  }

  function attachPanelInteractions(panel) {
    restorePanelState(panel);

    const header = panel.querySelector("#arcus-auto-header");
    const recordBtn = panel.querySelector("#arcus-btn-record");
    let recording = false;

    // Recording captures real selectors, disabled states and timings, so
    // automation steps can be built from what the app actually does instead of
    // from guesses at its markup.
    recordBtn?.addEventListener("click", () => {
      recording = !recording;
      recordBtn.textContent = recording ? "Stop rec" : "Record";
      recordBtn.style.background = recording ? "#c62828" : "";
      try {
        window.postMessage(
          { source: "arcus-content", type: recording ? "recStart" : "recStop", redact: true },
          location.origin
        );
      } catch (_) {}
      setStatus(recording
        ? "Recording. Do the steps by hand, then press Stop rec and Export."
        : "Recording stopped. Press Export to copy it.");
    });

    panel.querySelector("#arcus-btn-export-rec")?.addEventListener("click", () => {
      const onMessage = (event) => {
        if (event.origin && event.origin !== location.origin) return;
        const data = event.data;
        if (!data || data.source !== "arcus-page-hook" || data.type !== "recording") return;
        window.removeEventListener("message", onMessage);

        const payload = JSON.stringify({
          capturedAt: new Date().toISOString(),
          redacted: data.redacted,
          events: data.events,
        }, null, 2);

        navigator.clipboard?.writeText(payload)
          .then(() => setStatus("Copied " + data.events.length + " events to the clipboard."))
          .catch(() => {
            console.log("[Arcus recording]", payload);
            setStatus("Clipboard blocked. The recording is in the console instead.");
          });
      };
      window.addEventListener("message", onMessage);
      try {
        window.postMessage({ source: "arcus-content", type: "recDump" }, location.origin);
      } catch (_) {}
    });

    const minimizeBtn = panel.querySelector("#arcus-btn-minimize");
    const closeBtn = panel.querySelector("#arcus-btn-close");
    const waitOverride = panel.querySelector("#arcus-manual-override");
    const modeSelect = panel.querySelector("#arcus-mode-select");
    const pharmacyTypeSelect = panel.querySelector("#arcus-pharmacy-type");
    const turboToggle = panel.querySelector("#arcus-turbo");
    const overrideToggle = panel.querySelector("#arcus-auto-override");

    if (overrideToggle) {
      const AutoOverride = window.ArcusAutoOverride;
      const live = AutoOverride?.isEnabled?.() || false;
      overrideToggle.checked = live;
      setAutoOverrideState(live ? "on" : "off");

      overrideToggle.addEventListener("change", () => {
        if (!AutoOverride) {
          overrideToggle.checked = false;
          setAutoOverrideState("unavailable", "auto-override module not loaded");
          return;
        }

        // This dismisses clinical alerts without a pharmacist reading them, so
        // it is confirmed every time it is switched on.
        if (overrideToggle.checked) {
          const accepted = window.confirm(
            "Turn on Auto override?\n\n" +
            "The alert dialog will be filled in with \"" + AutoOverride.DEFAULT_REASON +
            "\" and saved automatically, so nobody reads those alerts during a run.\n\n" +
            "Drug allergy alerts are never handled automatically - the run pauses " +
            "and waits for a pharmacist.\n\n" +
            "Every alert that is auto-accepted is written to the panel log."
          );
          if (!accepted) {
            overrideToggle.checked = false;
            setAutoOverrideState("off");
            return;
          }
        }

        AutoOverride.setEnabled(overrideToggle.checked);
        setAutoOverrideState(overrideToggle.checked ? "on" : "off");
      });
    }

    if (turboToggle) {
      // The driver attaches before the panel is built, so its mode event has
      // already fired by now. Read the live state instead of trusting the
      // markup default, which otherwise leaves the badge reading "off" while
      // turbo is actually running.
      const turboLive = window.ArcusDriver?.isTurbo() || false;
      turboToggle.checked = turboLive;
      setTurboState(turboLive ? "on" : "off");

      turboToggle.addEventListener("change", async () => {
        // Turbo attaches chrome.debugger, which makes Chrome display a banner
        // across the tab for as long as it is on. Confirm before doing that, so
        // the banner is never a surprise.
        if (turboToggle.checked) {
          const accepted = window.confirm(
            "Turn on Turbo mode?\n\n" +
            "Turbo uses the Chrome DevTools Protocol for faster, more reliable " +
            "automation.\n\n" +
            "While it is on, Chrome shows a yellow bar reading \"Arcus Toolkit " +
            "started debugging this browser\". That bar cannot be hidden or " +
            "moved, and it disappears when you turn Turbo off.\n\n" +
            "Turbo also cannot start if DevTools is already open on this tab.\n\n" +
            "It stays on only for this session."
          );
          if (!accepted) {
            turboToggle.checked = false;
            setTurboState("off");
            return;
          }
        }

        setTurboState(turboToggle.checked ? "connecting" : "off");
        const result = await window.ArcusDriver?.setTurboPreference(turboToggle.checked);
        // Attach can be refused (DevTools already open on this tab), so the
        // checkbox has to follow the driver's real state, not the click.
        if (turboToggle.checked && result && !result.ok) {
          turboToggle.checked = false;
          setTurboState("unavailable", result.error);
        }
      });
    }

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    // A dragged position is persisted, so a panel parked over the search fields
    // stays there across sessions. Double-clicking the header snaps it back to
    // the default bottom-right corner.
    header?.addEventListener("dblclick", (event) => {
      if (event.target.closest("button")) return;
      panel.style.left = "auto";
      panel.style.top = "auto";
      panel.style.right = "24px";
      panel.style.bottom = "24px";
      savePanelState(panel);
    });

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

    attachOrderTypeListeners(panel);

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

    pharmacyTypeSelect?.addEventListener("change", () => {
      state.settings.pharmacyType = pharmacyTypeSelect.value || "auto";
      updateLocationLabel(panel);
      renderOrderTypeSection(panel, state.settings.rowFilters);
      const type = pharmacyTypeSelect.value;
      const label = type === "outpatient"
        ? "Outpatient: order O* or E*"
        : type === "inpatient"
          ? "Inpatient: order I*"
          : `Auto-detect: ${detectPharmacyType() || "not detected"} (order ${detectPharmacyType() === "outpatient" ? "O* or E*" : "I*"})`;
      setStep("Location changed", label);
      pushLog("info", `Location set to ${type}`, "Settings");
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
    if (window.ArcusPanelHost.restore("arcus-auto-panel")) return;
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
          <div class="section-title" style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
            <span>Location</span>
            <span id="arcus-location-detected" style="font-size:10px;color:#607d8b;font-weight:500;text-transform:none;letter-spacing:0;"></span>
          </div>
          <select id="arcus-pharmacy-type" class="select compact-select">
            <option value="auto">Auto-detect from page</option>
            <option value="inpatient">Inpatient — order no. starts with I</option>
            <option value="outpatient">Outpatient — order no. starts with O or E</option>
          </select>
        </div>

        <div class="field-group compact-field">
          <div class="section-title">Order type</div>
          <div id="arcus-order-type-container" class="arcus-check-grid">
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

        <label class="checkbox-line compact-check" title="Uses Chrome DevTools Protocol for trusted clicks and network-idle waits. Chrome shows a debugging banner while active.">
          <input id="arcus-turbo" type="checkbox" />
          <span>Turbo mode <span id="arcus-turbo-state" class="arcus-turbo-state">off</span></span>
        </label>

        <label class="checkbox-line compact-check" title="Selects the pharmacy override reason and saves the alert dialog automatically. Drug allergy alerts are never handled automatically - the run pauses for a pharmacist.">
          <input id="arcus-auto-override" type="checkbox" />
          <span>Auto override <span id="arcus-auto-override-state" class="arcus-turbo-state">off</span></span>
        </label>

        <div class="btn-row compact-buttons">
          <button id="arcus-btn-record" class="btn" title="Record what you click, so automation steps can be built from real selectors and timings instead of guesses. Patient identifiers are redacted.">Record</button>
          <button id="arcus-btn-export-rec" class="btn" title="Copy the recording to the clipboard as JSON">Export</button>
        </div>

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
    window.ArcusPanelHost.register(panel, () => state.isRunning);
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
    updateButtonState,
    savePanelState,
    restorePanelState,
    removePanel,
    createPanel,
  };
})();
