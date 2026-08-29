(() => {
  if (window.__ARCUS_SCRAPER_PANEL_LOADED__) return;
  window.__ARCUS_SCRAPER_PANEL_LOADED__ = true;

  const { state, clamp, escapeHtml, isWorkbenchPage, ORDER_FILTERS } = window.ArcusShared;

  const SCRAPER_PANEL_STATE_KEY     = "arcusScraperPanelState";
  const SCRAPER_PANEL_DISMISSED_KEY = "arcusScraperPanelDismissed";
  let scraperPanelDismissed = false;

  // ── Panel API (called by scraper.js) ─────────────────────────────────────
  function setStatus(message) {
    const el = document.querySelector("#arcus-scraper-status");
    if (el) el.textContent = message;
  }

  function pushLog(type, message, meta = "") {
    const time = new Date().toLocaleTimeString();
    state.logItems.unshift({ type, message, meta, time });
    state.logItems = state.logItems.slice(0, 250);

    // Render to the visible log panel
    const logEl = document.querySelector("#arcus-scraper-log");
    if (!logEl) return;
    const entry = document.createElement("div");
    entry.className = `arcus-log-entry arcus-log-${type}`;
    entry.textContent = `[${time}]${meta ? " " + meta + ":" : ""} ${message}`;
    logEl.insertBefore(entry, logEl.firstChild);
    while (logEl.children.length > 40) logEl.removeChild(logEl.lastChild);
  }

  function renderStats() {
    const q = (id) => document.querySelector(id);
    if (q("#arcus-scraper-stat-processed")) q("#arcus-scraper-stat-processed").textContent = String(state.stats.processed);
    if (q("#arcus-scraper-stat-success"))   q("#arcus-scraper-stat-success").textContent   = String(state.stats.success);
    if (q("#arcus-scraper-stat-fail"))      q("#arcus-scraper-stat-fail").textContent      = String(state.stats.fail);
    if (q("#arcus-scraper-captured"))       q("#arcus-scraper-captured").textContent       = String(state.scraper.data.length);
    updateProgressBar();
  }

  function renderScrapePreview() {} // no-op, data is saved to file

  function setDateProgress(text) {
    const el = document.querySelector("#arcus-date-progress");
    if (el) el.textContent = text || "—";
  }

  function updateButtonState() {
    const scraperRunning = state.scraper.state === "running";
    const busy = scraperRunning || state.isRunning;
    const hasData = state.scraper.data.length > 0;

    const runBtn        = document.querySelector("#arcus-scraper-run");
    const stopBtn       = document.querySelector("#arcus-scraper-stop");
    const saveNowBtn    = document.querySelector("#arcus-scraper-save-now");
    const pdpaChk       = document.querySelector("#arcus-scraper-pdpa");
    const typeChecks    = document.querySelectorAll(".arcus-scraper-type-check");
    const dateRunBtn    = document.querySelector("#arcus-scraper-date-run");
    const dateResumeBtn = document.querySelector("#arcus-scraper-date-resume");

    if (runBtn)        runBtn.disabled        = busy;
    if (stopBtn)       stopBtn.disabled       = !scraperRunning;
    if (saveNowBtn)    saveNowBtn.disabled    = !hasData || scraperRunning;
    if (pdpaChk)       pdpaChk.disabled       = scraperRunning;
    if (dateRunBtn)    dateRunBtn.disabled    = busy;
    if (dateResumeBtn) dateResumeBtn.disabled = busy;
    typeChecks.forEach((cb) => { cb.disabled = scraperRunning; });
  }

  function updateProgressBar() {
    const bar   = document.querySelector("#arcus-scraper-bar");
    const label = document.querySelector("#arcus-scraper-bar-label");
    if (!bar || !label) return;
    const total = state.stats.processed || 0;
    const ok    = state.stats.success   || 0;
    const pct   = total > 0 ? Math.round((ok / total) * 100) : 0;
    bar.style.width = `${pct}%`;
    label.textContent = `${ok} / ${total}`;
  }

  // ── Panel lifecycle ───────────────────────────────────────────────────────
  function removePanel() {
    document.querySelector("#arcus-scraper-panel")?.remove();
  }

  function savePanelPosition(panel) {
    try {
      chrome.storage?.local?.set({
        [SCRAPER_PANEL_STATE_KEY]: {
          top: panel.style.top || "", left: panel.style.left || "",
          right: panel.style.right || "", bottom: panel.style.bottom || "",
          minimized: panel.classList.contains("is-minimized"),
        },
      });
    } catch (_) {}
  }

  function restorePanelPosition(panel) {
    try {
      chrome.storage?.local?.get(SCRAPER_PANEL_STATE_KEY, (data) => {
        const s = data?.[SCRAPER_PANEL_STATE_KEY];
        if (!s) return;
        if (s.top)    panel.style.top    = s.top;
        if (s.left)   panel.style.left   = s.left;
        if (s.right)  panel.style.right  = s.right;
        if (s.bottom) panel.style.bottom = s.bottom;
        if (s.minimized) {
          panel.classList.add("is-minimized");
          const btn = panel.querySelector("#arcus-scraper-minimize");
          if (btn) btn.textContent = "+";
        }
      });
    } catch (_) {}
  }

  function readSelectedOrderTypes() {
    const boxes   = Array.from(document.querySelectorAll(".arcus-scraper-type-check"));
    const checked = boxes.filter((b) => b.checked).map((b) => b.value);
    if (!checked.length || checked.includes("all")) return ["all"];
    return checked.filter((v) => v !== "all");
  }

  function createPanel() {
    if (!isWorkbenchPage() || scraperPanelDismissed || document.querySelector("#arcus-scraper-panel")) return;

    const panel = document.createElement("div");
    panel.id = "arcus-scraper-panel";
    panel.innerHTML = `
      <div id="arcus-scraper-header" class="arcus-scraper-header">
        <div class="arcus-panel-title-wrap">
          <div class="arcus-scraper-title">Arcus Scraper</div>
          <div class="arcus-scraper-desc">Research data export</div>
        </div>
        <div class="arcus-panel-actions">
          <button id="arcus-scraper-minimize" class="arcus-scraper-icon-btn" title="Minimize">—</button>
          <button id="arcus-scraper-close"    class="arcus-scraper-icon-btn" title="Close">✕</button>
        </div>
      </div>

      <div id="arcus-scraper-body">
        <div class="arcus-scraper-section-title">Order type</div>
        <div class="arcus-scraper-type-grid">
          <label><input class="arcus-scraper-type-check" type="checkbox" value="all" checked> ALL</label>
          <label><input class="arcus-scraper-type-check" type="checkbox" value="daily"> DAILY</label>
          <label><input class="arcus-scraper-type-check" type="checkbox" value="continuous"> CONT.</label>
          <label><input class="arcus-scraper-type-check" type="checkbox" value="discharge"> D/C</label>
        </div>

        <label class="arcus-scraper-check-line">
          <input id="arcus-scraper-pdpa" type="checkbox" checked>
          <span>PDPA cleanse <span class="arcus-scraper-badge">blind personal data</span></span>
        </label>

        <div class="arcus-scraper-btn-row">
          <button id="arcus-scraper-run"      class="arcus-scraper-btn arcus-scraper-btn-run">Scrape</button>
          <button id="arcus-scraper-stop"     class="arcus-scraper-btn arcus-scraper-btn-stop" disabled>Stop</button>
          <button id="arcus-scraper-save-now" class="arcus-scraper-btn arcus-scraper-btn-save" disabled>Save now</button>
        </div>

        <div id="arcus-scraper-status" class="arcus-scraper-status">Ready</div>

        <div class="arcus-scraper-progress-wrap">
          <div class="arcus-scraper-progress-track">
            <div id="arcus-scraper-bar" class="arcus-scraper-progress-bar"></div>
          </div>
          <div id="arcus-scraper-bar-label" class="arcus-scraper-progress-label">0 / 0</div>
        </div>

        <div class="arcus-scraper-metrics">
          <div class="arcus-scraper-metric">
            <div class="arcus-scraper-metric-label">Done</div>
            <div id="arcus-scraper-stat-processed" class="arcus-scraper-metric-value">0</div>
          </div>
          <div class="arcus-scraper-metric">
            <div class="arcus-scraper-metric-label">OK</div>
            <div id="arcus-scraper-stat-success" class="arcus-scraper-metric-value ok">0</div>
          </div>
          <div class="arcus-scraper-metric">
            <div class="arcus-scraper-metric-label">Fail</div>
            <div id="arcus-scraper-stat-fail" class="arcus-scraper-metric-value fail">0</div>
          </div>
          <div class="arcus-scraper-metric">
            <div class="arcus-scraper-metric-label">Saved</div>
            <div id="arcus-scraper-captured" class="arcus-scraper-metric-value saved">0</div>
          </div>
        </div>

        <hr class="arcus-scraper-divider">

        <div class="arcus-scraper-section-title">Date range scrape</div>
        <div class="arcus-scraper-date-grid">
          <label class="arcus-scraper-date-label">
            From
            <input id="arcus-scraper-date-from" class="arcus-scraper-date-input" type="text" placeholder="01-03-2025" value="01-03-2025">
          </label>
          <label class="arcus-scraper-date-label">
            To
            <input id="arcus-scraper-date-to" class="arcus-scraper-date-input" type="text" placeholder="28-02-2026" value="28-02-2026">
          </label>
        </div>
        <div id="arcus-date-progress" class="arcus-date-progress-text">—</div>
        <div class="arcus-scraper-btn-row-2">
          <button id="arcus-scraper-date-run"    class="arcus-scraper-btn arcus-scraper-btn-run">▶ Start</button>
          <button id="arcus-scraper-date-resume" class="arcus-scraper-btn arcus-scraper-btn-save">⏎ Resume</button>
        </div>

        <hr class="arcus-scraper-divider">

        <div class="arcus-scraper-log-header">
          <span class="arcus-scraper-section-title" style="margin-bottom:0">Log</span>
          <button id="arcus-scraper-clear-log" class="arcus-scraper-log-clear-btn">clear</button>
        </div>
        <div id="arcus-scraper-log" class="arcus-scraper-log"></div>
      </div>
    `;

    document.body.appendChild(panel);
    restorePanelPosition(panel);
    attachInteractions(panel);
    renderStats();
    updateButtonState();
  }

  function attachInteractions(panel) {
    const header      = panel.querySelector("#arcus-scraper-header");
    const minimizeBtn = panel.querySelector("#arcus-scraper-minimize");
    const closeBtn    = panel.querySelector("#arcus-scraper-close");

    // ── Dragging ────────────────────────────────────────────────────────────
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header?.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragging  = true; startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.classList.add("is-dragging");
      panel.style.left = `${rect.left}px`; panel.style.top = `${rect.top}px`;
      panel.style.right = "auto"; panel.style.bottom = "auto";
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      panel.style.left = `${clamp(startLeft + (e.clientX - startX), 8, window.innerWidth  - panel.offsetWidth  - 8)}px`;
      panel.style.top  = `${clamp(startTop  + (e.clientY - startY), 8, window.innerHeight - panel.offsetHeight - 8)}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove("is-dragging");
      savePanelPosition(panel);
    });

    minimizeBtn?.addEventListener("click", () => {
      const min = panel.classList.toggle("is-minimized");
      minimizeBtn.textContent = min ? "+" : "—";
      savePanelPosition(panel);
    });

    closeBtn?.addEventListener("click", () => {
      scraperPanelDismissed = true;
      try { chrome.storage?.local?.set({ [SCRAPER_PANEL_DISMISSED_KEY]: true }); } catch (_) {}
      removePanel();
    });

    // ── Order type checkboxes ───────────────────────────────────────────────
    panel.querySelectorAll(".arcus-scraper-type-check").forEach((cb) => {
      cb.addEventListener("change", () => {
        if (cb.value === "all" && cb.checked) {
          panel.querySelectorAll(".arcus-scraper-type-check").forEach((c) => { if (c.value !== "all") c.checked = false; });
        } else if (cb.checked) {
          const allBox = panel.querySelector(".arcus-scraper-type-check[value='all']");
          if (allBox) allBox.checked = false;
        }
      });
    });

    // ── Start ───────────────────────────────────────────────────────────────
    panel.querySelector("#arcus-scraper-run")?.addEventListener("click", () => {
      const filters = readSelectedOrderTypes();
      state.settings.rowFilters = filters;
      state.settings.rowFilter  = filters[0] || "all";
      const pdpa = panel.querySelector("#arcus-scraper-pdpa")?.checked ?? true;
      window.ArcusScraper?.runSharedScraper({ pdpa });
    });

    // ── Stop (scraper only — does NOT touch automation state.stopRequested) ─
    panel.querySelector("#arcus-scraper-stop")?.addEventListener("click", () => {
      state.scraperStopRequested = true;
      setStatus("Stopping…");
      pushLog("info", "Stop requested by user");
    });

    // ── Save now ────────────────────────────────────────────────────────────
    panel.querySelector("#arcus-scraper-save-now")?.addEventListener("click", () => {
      if (state.scraper.data.length > 0) {
        window.ArcusScraper?.saveMilestone(state.scraper.data, `manual_${state.scraper.data.length}`);
      }
    });

    // ── Date range: Start ───────────────────────────────────────────────────
    panel.querySelector("#arcus-scraper-date-run")?.addEventListener("click", () => {
      const from = panel.querySelector("#arcus-scraper-date-from")?.value?.trim() || "";
      const to   = panel.querySelector("#arcus-scraper-date-to")?.value?.trim() || "";
      const pdpa = panel.querySelector("#arcus-scraper-pdpa")?.checked ?? true;
      console.log("[Arcus] date-run clicked", { from, to, pdpa,
        hasScraper: !!window.ArcusScraper,
        hasRun: !!window.ArcusScraper?.runDateRangeScraper,
      });
      if (!window.ArcusScraper?.runDateRangeScraper) {
        const msg = "ERROR: ArcusScraper module not loaded. Reload page.";
        setStatus(msg);
        pushLog("fail", msg, "date-run");
        console.error("[Arcus]", msg);
        return;
      }
      if (!from || !to) {
        const msg = "Enter From and To dates (DD-MM-YYYY).";
        setStatus(msg);
        pushLog("fail", msg, "date-run");
        return;
      }
      setStatus(`Starting: ${from} → ${to}`);
      pushLog("info", `Start clicked: ${from} → ${to}`, "date-run");
      window.ArcusScraper.runDateRangeScraper({ startDateStr: from, endDateStr: to, pdpa, resume: false });
    });

    // ── Date range: Resume ──────────────────────────────────────────────────
    panel.querySelector("#arcus-scraper-date-resume")?.addEventListener("click", () => {
      const from = panel.querySelector("#arcus-scraper-date-from")?.value?.trim() || "";
      const to   = panel.querySelector("#arcus-scraper-date-to")?.value?.trim() || "";
      const pdpa = panel.querySelector("#arcus-scraper-pdpa")?.checked ?? true;
      console.log("[Arcus] date-resume clicked", { from, to, pdpa,
        hasScraper: !!window.ArcusScraper,
      });
      if (!window.ArcusScraper?.runDateRangeScraper) {
        const msg = "ERROR: ArcusScraper module not loaded. Reload page.";
        setStatus(msg);
        pushLog("fail", msg, "date-resume");
        return;
      }
      setStatus(`Resuming: ${from} → ${to}`);
      pushLog("info", `Resume clicked: ${from} → ${to}`, "date-resume");
      window.ArcusScraper.runDateRangeScraper({ startDateStr: from, endDateStr: to, pdpa, resume: true });
    });

    // ── Clear log ───────────────────────────────────────────────────────────
    panel.querySelector("#arcus-scraper-clear-log")?.addEventListener("click", () => {
      const logEl = panel.querySelector("#arcus-scraper-log");
      if (logEl) logEl.innerHTML = "";
      state.logItems = [];
    });

    window.addEventListener("resize", () => {
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${clamp(rect.left, 8, Math.max(8, window.innerWidth  - panel.offsetWidth  - 8))}px`;
      panel.style.top  = `${clamp(rect.top,  8, Math.max(8, window.innerHeight - panel.offsetHeight - 8))}px`;
      panel.style.right = "auto"; panel.style.bottom = "auto";
      savePanelPosition(panel);
    });
  }

  // ── External event listeners ──────────────────────────────────────────────
  window.addEventListener("arcus-toolkit:show-scraper-panel", () => {
    scraperPanelDismissed = false;
    try { chrome.storage?.local?.set({ [SCRAPER_PANEL_DISMISSED_KEY]: false }); } catch (_) {}
    createPanel();
  });

  window.addEventListener("arcus-toolkit:remove-scraper-panel", () => {
    scraperPanelDismissed = true;
    try { chrome.storage?.local?.set({ [SCRAPER_PANEL_DISMISSED_KEY]: true }); } catch (_) {}
    removePanel();
  });

  // Stop scraper only (independent of automation stop)
  window.addEventListener("arcus-toolkit:stop-scraper", () => {
    state.scraperStopRequested = true;
    setStatus("Stopping…");
    pushLog("info", "Stop requested via popup");
  });

  // Restore dismissed state then init
  try {
    chrome.storage?.local?.get(SCRAPER_PANEL_DISMISSED_KEY, (data) => {
      scraperPanelDismissed = !!data?.[SCRAPER_PANEL_DISMISSED_KEY];
      createPanel();
    });
  } catch (_) {
    createPanel();
  }

  // Re-create panel on SPA navigation
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        if (!isWorkbenchPage()) { removePanel(); return; }
        createPanel();
      }, 700);
    } else if (isWorkbenchPage() && !document.querySelector("#arcus-scraper-panel") && !scraperPanelDismissed) {
      createPanel();
    } else if (!isWorkbenchPage() && document.querySelector("#arcus-scraper-panel")) {
      removePanel();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => setTimeout(() => {
    if (!isWorkbenchPage()) { removePanel(); return; }
    createPanel();
  }, 700));

  window.ArcusScraperPanel = {
    setStatus,
    pushLog,
    renderStats,
    renderScrapePreview,
    updateButtonState,
    setDateProgress,
    createPanel,
    removePanel,
  };
})();
