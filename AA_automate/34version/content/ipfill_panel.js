(() => {
  if (window.__ARCUS_IPFILL_PANEL_LOADED__) return;
  window.__ARCUS_IPFILL_PANEL_LOADED__ = true;

  const START_ROUTE = "#!/pharmacy/dispenseworkbench/pharmacy/ipfill";
  const DETAIL_ROUTE = "#!/pharmacy/ipfilldetail";
  const IPFILL_PANEL_STORAGE_KEY = "arcusIpFillPanelState";
  const IPFILL_PANEL_DISMISSED_KEY = "arcusIpFillPanelDismissed";

  const state = {
    running: false,
    stopRequested: false,
    rounds: 6,
    currentRound: 0,
    failed: false,
    dismissed: false,
    logItems: [],
    manualStep: {
      active: false,
      secondsLeft: 0,
      timerId: null,
      resolver: null,
      mode: "ward_select",
      message: "",
    },
  };

  function isIpFillPage() {
    return location.href.includes(START_ROUTE) || location.href.includes(DETAIL_ROUTE);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setPanelDismissed(value) {
    state.dismissed = !!value;
    try {
      chrome.storage?.local?.set({ [IPFILL_PANEL_DISMISSED_KEY]: !!value });
    } catch (_) {}
  }

  function restorePanelDismissed(callback) {
    try {
      chrome.storage?.local?.get(IPFILL_PANEL_DISMISSED_KEY, (data) => {
        state.dismissed = !!data?.[IPFILL_PANEL_DISMISSED_KEY];
        callback?.(state.dismissed);
      });
    } catch (_) {
      callback?.(state.dismissed);
    }
  }

  function pushLog(type, message, meta = "") {
    const time = new Date().toLocaleTimeString();
    state.logItems.unshift({ type, message, meta, time });
    state.logItems = state.logItems.slice(0, 300);
    renderLog();
  }

  function renderLog() {
    const root = document.querySelector("#arcus-ipfill-log");
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

  function setStatus(message) {
    const el = document.querySelector("#arcus-ipfill-status");
    if (el) el.textContent = message;
    console.log("[Arcus IPFill]", message);
  }

  function setProgress(done, total) {
    const wrap = document.querySelector("#arcus-ipfill-progress");
    const bar = document.querySelector("#arcus-ipfill-bar");
    const label = document.querySelector("#arcus-ipfill-label");
    if (!wrap || !bar || !label) return;
    wrap.classList.add("visible");
    bar.style.width = `${(done / total) * 100}%`;
    label.textContent = `${done} / ${total}`;
  }

  function resetProgress() {
    const wrap = document.querySelector("#arcus-ipfill-progress");
    const bar = document.querySelector("#arcus-ipfill-bar");
    const label = document.querySelector("#arcus-ipfill-label");
    if (!wrap || !bar || !label) return;
    wrap.classList.remove("visible");
    bar.style.width = "0%";
    label.textContent = `0 / ${state.rounds}`;
  }

  function updateButtons() {
    const runBtn = document.querySelector("#arcus-ipfill-run");
    const stopBtn = document.querySelector("#arcus-ipfill-stop");
    const diagBtn = document.querySelector("#arcus-ipfill-diagnose");
    const clearBtn = document.querySelector("#arcus-ipfill-clear");
    const copyBtn = document.querySelector("#arcus-ipfill-copy");

    if (runBtn) runBtn.disabled = state.running;
    if (stopBtn) stopBtn.disabled = !state.running;
    if (diagBtn) diagBtn.disabled = state.running || state.manualStep.active;
    if (clearBtn) clearBtn.disabled = state.running;
    if (copyBtn) copyBtn.disabled = false;
  }

  function renderManualStep() {
    const box = document.querySelector("#arcus-ipfill-manual-box");
    const text = document.querySelector("#arcus-ipfill-manual-text");
    const time = document.querySelector("#arcus-ipfill-manual-time");

    if (!box || !text || !time) return;

    if (!state.manualStep.active) {
      box.style.display = "none";
      text.textContent = "";
      time.textContent = "";
      return;
    }

    box.style.display = "block";
    text.textContent = state.manualStep.message || "";
    time.textContent = `Continuing automatically in ${state.manualStep.secondsLeft}s`;
  }

  function getOrCreateManualOverlay() {
    let overlay = document.querySelector("#arcus-ipfill-manual-overlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "arcus-ipfill-manual-overlay";
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      background: rgba(0,0,0,0.08);
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      pointer-events: none;
    `;

    overlay.innerHTML = `
      <div id="arcus-ipfill-overlay-card" style="
        width: 460px;
        max-width: 100%;
        background: #fff;
        border-radius: 14px;
        box-shadow: 0 16px 50px rgba(0,0,0,0.22);
        border: 1px solid #d7ccc8;
        overflow: hidden;
        font-family: 'Segoe UI', system-ui, sans-serif;
        pointer-events: none;
      ">
        <div style="
          padding: 14px 16px;
          background:#fff3e0;
          border-bottom:1px solid #ffe0b2;
          font-weight:700;
          color:#8d6e63;
        ">
          Manual Action Required
        </div>

        <div style="padding: 16px;">
          <div id="arcus-ipfill-overlay-text" style="
            font-size:13px;
            line-height:1.6;
            color:#444;
          "></div>

          <div id="arcus-ipfill-overlay-time" style="
            margin-top:10px;
            font-size:18px;
            font-weight:700;
            color:#e65100;
          "></div>

          <div style="margin-top:14px; display:flex; gap:8px;">
            <button id="arcus-ipfill-overlay-continue" style="
              flex:1;
              border:none;
              border-radius:8px;
              padding:10px 12px;
              background:#1565c0;
              color:#fff;
              font-weight:700;
              cursor:pointer;
              pointer-events:auto;
            ">Start now</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector("#arcus-ipfill-overlay-continue")?.addEventListener("click", () => {
      finishManualStep("continue_now");
    });

    return overlay;
  }

  function updateManualOverlay() {
    const overlay = getOrCreateManualOverlay();
    const text = overlay.querySelector("#arcus-ipfill-overlay-text");
    const time = overlay.querySelector("#arcus-ipfill-overlay-time");

    if (!state.manualStep.active) {
      overlay.style.display = "none";
      return;
    }

    overlay.style.display = "flex";
    text.textContent = state.manualStep.message || "";
    time.textContent = `Auto continue in ${state.manualStep.secondsLeft}s`;
  }

  function finishManualStep(reason = "timer") {
    if (!state.manualStep.active) return;

    if (state.manualStep.timerId) {
      clearInterval(state.manualStep.timerId);
      state.manualStep.timerId = null;
    }

    const resolve = state.manualStep.resolver;
    state.manualStep.active = false;
    state.manualStep.secondsLeft = 0;
    state.manualStep.resolver = null;
    state.manualStep.message = "";
    state.manualStep.mode = "ward_select";

    renderManualStep();
    updateManualOverlay();
    updateButtons();

    if (resolve) resolve(reason);
  }

  function clearManualCountdown() {
    finishManualStep("cleared");
  }

  async function waitForManualAction({
    round,
    seconds = 20,
    mode = "ward_select",
    message = "",
  }) {
    clearManualCountdown();

    state.manualStep.active = true;
    state.manualStep.secondsLeft = seconds;
    state.manualStep.mode = mode;
    state.manualStep.message = message;

    renderManualStep();
    updateManualOverlay();
    updateButtons();

    pushLog("info", "Manual action started", `Round ${round} • ${mode} • ${seconds}s`);

    return new Promise((resolve) => {
      state.manualStep.resolver = resolve;

      state.manualStep.timerId = setInterval(() => {
        state.manualStep.secondsLeft -= 1;
        renderManualStep();
        updateManualOverlay();

        if (state.manualStep.secondsLeft <= 0) {
          finishManualStep("timer");
        }
      }, 1000);
    });
  }

  function removePanel() {
    clearManualCountdown();
    document.querySelector("#arcus-ipfill-manual-overlay")?.remove();
    document.querySelector("#arcus-ipfill-panel")?.remove();
  }

  function savePanelState(panel) {
    const minimized = panel.classList.contains("is-minimized");
    chrome.storage?.local?.set({
      [IPFILL_PANEL_STORAGE_KEY]: {
        top: panel.style.top || "",
        left: panel.style.left || "",
        right: panel.style.right || "",
        bottom: panel.style.bottom || "",
        minimized,
        width: panel.style.width || "",
      },
    });
  }

  function restorePanelState(panel) {
    chrome.storage?.local?.get(IPFILL_PANEL_STORAGE_KEY, (data) => {
      const saved = data?.[IPFILL_PANEL_STORAGE_KEY];
      if (!saved) return;

      if (saved.top) panel.style.top = saved.top;
      if (saved.left) panel.style.left = saved.left;
      if (saved.right) panel.style.right = saved.right;
      if (saved.bottom) panel.style.bottom = saved.bottom;
      if (saved.width) panel.style.width = saved.width;

      if (saved.minimized) {
        panel.classList.add("is-minimized");
        const btn = panel.querySelector("#arcus-ipfill-minimize");
        if (btn) btn.textContent = "+";
      }
    });
  }

  function attachPanelInteractions(panel) {
    restorePanelState(panel);

    const header = panel.querySelector("#arcus-ipfill-header");
    const minimizeBtn = panel.querySelector("#arcus-ipfill-minimize");
    const closeBtn = panel.querySelector("#arcus-ipfill-close");

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
    if (!isIpFillPage()) return;
    if (state.dismissed) return;
    if (document.querySelector("#arcus-ipfill-panel")) return;

    const panel = document.createElement("div");
    panel.id = "arcus-ipfill-panel";
    panel.className = "arcus-ipfill-panel";
    panel.innerHTML = `
      <div id="arcus-ipfill-header" class="arcus-panel-header">
        <div class="arcus-panel-title-wrap">
          <div class="title">Arcus IP Fill Tools</div>
          <div class="desc">Start route → New → ipfilldetail → manual ward select → search → confirm → manual override if alert.</div>
        </div>
        <div class="arcus-panel-actions">
          <button id="arcus-ipfill-minimize" class="icon-btn" title="Minimize / Restore">—</button>
          <button id="arcus-ipfill-close" class="icon-btn" title="Close">✕</button>
        </div>
      </div>

      <div class="arcus-panel-body">
        <div class="hint-box">
          In the Ward step, the system pauses and lets you manually choose Ward. If no result is found, it will ask you to choose another Ward and retry from the same page, up to 3 attempts. Then the session stops.
        </div>

        <div id="arcus-ipfill-manual-box" class="hint-box" style="display:none; background:#fff3e0; border-color:#ffb74d;">
          <div id="arcus-ipfill-manual-text"></div>
          <div id="arcus-ipfill-manual-time" style="margin-top:6px; font-weight:700;"></div>
        </div>

        <div class="btn-row">
          <button id="arcus-ipfill-run" class="btn">Run IP Fill</button>
          <button id="arcus-ipfill-stop" class="btn" disabled>Stop</button>
        </div>

        <div class="btn-row">
          <button id="arcus-ipfill-diagnose" class="small-btn">Diagnose</button>
          <button id="arcus-ipfill-clear" class="small-btn">Clear Log</button>
          <button id="arcus-ipfill-copy" class="small-btn">Copy Log</button>
        </div>

        <div id="arcus-ipfill-progress" class="progress-wrap">
          <div class="progress-track">
            <div id="arcus-ipfill-bar" class="progress-bar"></div>
          </div>
          <div id="arcus-ipfill-label" class="progress-label">0 / 6</div>
        </div>

        <div id="arcus-ipfill-status" class="status">Ready</div>
        <div id="arcus-ipfill-log"></div>
      </div>
    `;

    document.body.appendChild(panel);
    getOrCreateManualOverlay();
    attachPanelInteractions(panel);
    renderLog();
    renderManualStep();
    updateManualOverlay();
    updateButtons();

    panel.querySelector("#arcus-ipfill-run")?.addEventListener("click", () => startRun());
    panel.querySelector("#arcus-ipfill-stop")?.addEventListener("click", () => stopRun());
    panel.querySelector("#arcus-ipfill-diagnose")?.addEventListener("click", () => diagnose());

    panel.querySelector("#arcus-ipfill-clear")?.addEventListener("click", () => {
      state.logItems = [];
      renderLog();
    });

    panel.querySelector("#arcus-ipfill-copy")?.addEventListener("click", async () => {
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

  function isVisible(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isClickable(el) {
    return !!el && isVisible(el) && !el.disabled && !el.closest("[disabled]");
  }

  function clickLikeUser(el) {
    ["mouseover", "mouseenter", "mousedown", "mouseup", "click"].forEach((type) => {
      el.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: window,
        })
      );
    });
    if (typeof el.click === "function") el.click();
  }

  async function waitForSelector(selector, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const el = document.querySelector(selector);
      if (isVisible(el)) return el;
      await sleep(250);
    }
    return null;
  }

  async function waitForRouteContains(route, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (location.href.includes(route)) return true;
      await sleep(250);
    }
    return false;
  }

  async function waitForSearchClickable(timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const btn = document.querySelector("#searchipfill");
      if (isClickable(btn)) return btn;
      await sleep(250);
    }
    return null;
  }

  function findOpenDialog() {
    const dialogs = Array.from(document.querySelectorAll("md-dialog, [role='dialog']"));
    return dialogs.find((d) => isVisible(d)) || null;
  }

  async function waitUntilDialogClosed(timeoutMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (state.stopRequested) return false;
      const dlg = findOpenDialog();
      if (!dlg) return true;
      await sleep(500);
    }
    return false;
  }

  function findWardInput() {
    const candidates = [
      "#fl-input-89",
      'input[aria-label="Ward"]',
      'input[aria-label*="Ward"]',
      'input[role="combobox"]',
      "md-autocomplete input",
      "md-input-container input",
    ];

    for (const selector of candidates) {
      const els = Array.from(document.querySelectorAll(selector));
      for (const el of els) {
        if (!isVisible(el)) continue;

        const label =
          el.getAttribute("aria-label") ||
          el.getAttribute("placeholder") ||
          el.closest("md-input-container")?.querySelector("label")?.textContent ||
          "";

        if (String(label).toLowerCase().includes("ward")) {
          return el;
        }

        if (selector === "#fl-input-89") return el;
      }
    }

    return null;
  }

  function findNoResultMessage() {
    const candidates = Array.from(
      document.querySelectorAll("span.errortext, .errortext, span[translate], span")
    );

    return (
      candidates.find((el) => {
        if (!isVisible(el)) return false;
        const txt = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        return txt.includes("no results found for this search criteria");
      }) || null
    );
  }

  async function waitForSearchOutcome(timeoutMs = 15000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      const confirmBtn = document.querySelector(
        "#actiondiv > div > div > button.md-primary.md-button.ng-scope.md-incustheme-theme.md-ink-ripple"
      );
      if (confirmBtn && isVisible(confirmBtn)) {
        return { type: "confirm", el: confirmBtn };
      }

      const noResult = findNoResultMessage();
      if (noResult) {
        return { type: "no_result", el: noResult };
      }

      const dialog = findOpenDialog();
      if (dialog) {
        return { type: "dialog", el: dialog };
      }

      await sleep(300);
    }

    return { type: "timeout", el: null };
  }

  async function promptRetryAnotherWard(round, attemptNo) {
    setStatus(
      `Round ${round}: no results found.\nPlease choose another Ward.\nRetry attempt ${attemptNo}/3.`
    );

    return waitForManualAction({
      round,
      seconds: 20,
      mode: "no_result_retry",
      message:
        `Round ${round}: no results were found for the current Ward. Please select another Ward now. Retry attempt ${attemptNo}/3. Then press "Start now" or wait for the countdown.`,
    });
  }

  async function runOneRound(round) {
    const trace = [];
    let stepNum = 0;

    function t(kind, msg, detail = "") {
      stepNum++;
      trace.push({ step: stepNum, kind, msg, detail: String(detail) });
      pushLog(
        kind === "fail" ? "fail" : kind === "warn" ? "info" : "success",
        `S${stepNum} ${msg}`,
        detail
      );
    }

    if (!location.href.includes(START_ROUTE)) {
      location.href = `https://arcusair.bdms.co.th/${START_ROUTE}`;
      t("info", "Navigating to IP Fill start route", START_ROUTE);
      const ok = await waitForRouteContains(START_ROUTE, 15000);
      if (!ok) {
        t("fail", "Cannot reach IP Fill start route", location.href);
        return { ok: false, error: "Cannot reach IP Fill start route", trace };
      }
    }

    const newBtn = await waitForSelector("#newipfill", 10000);
    if (!newBtn) {
      t("fail", "#newipfill not found");
      return { ok: false, error: "#newipfill not found", trace };
    }

    clickLikeUser(newBtn);
    t("ok", "Clicked #newipfill");

    const detailOk = await waitForRouteContains(DETAIL_ROUTE, 15000);
    if (!detailOk) {
      t("fail", "Did not navigate to ipfilldetail", location.href);
      return { ok: false, error: "Did not navigate to ipfilldetail", trace };
    }

    const wardInput = (await waitForSelector("#fl-input-89", 3000)) || findWardInput();

    if (!wardInput) {
      t("fail", "Ward input not found");
      return { ok: false, error: "Ward input not found", trace };
    }

    t(
      "ok",
      "Ward input ready",
      wardInput.id || wardInput.getAttribute("aria-label") || "Ward input"
    );
    setStatus(
      `Round ${round}: please manually select Ward now.\nThe system will continue automatically after countdown.`
    );
    t("warn", "Manual Ward selection required", `Round ${round}`);

    const reason = await waitForManualAction({
      round,
      seconds: 20,
      mode: "ward_select",
      message:
        `Round ${round}: please manually select Ward now, then press "Start now" or wait for the countdown.`,
    });
    t("info", "Manual Ward step finished", reason);

    if (state.stopRequested) {
      t("fail", "Stopped during manual Ward step");
      return { ok: false, error: "Stopped during manual Ward step", trace };
    }

    let searchAttempt = 1;
    const maxSearchAttempts = 3;

    while (searchAttempt <= maxSearchAttempts) {
      const searchBtn = await waitForSearchClickable(6000);
      if (!searchBtn) {
        t(
          "fail",
          "#searchipfill not clickable after manual Ward selection",
          `value="${wardInput.value || ""}"`
        );
        return { ok: false, error: "#searchipfill not clickable", trace };
      }

      clickLikeUser(searchBtn);
      t("ok", "Clicked #searchipfill", `attempt ${searchAttempt}`);

      const outcome = await waitForSearchOutcome(15000);

      if (outcome.type === "no_result") {
        t("warn", "No results found for this search criteria", `attempt ${searchAttempt}/3`);

        if (searchAttempt >= maxSearchAttempts) {
          t("fail", "Reached max retry attempts for selecting another Ward", "Stop this session");
          return {
            ok: false,
            error: "No results found after 3 Ward attempts. Session stopped.",
            trace,
          };
        }

        const retryReason = await promptRetryAnotherWard(round, searchAttempt + 1);
        t("info", "Manual retry Ward step finished", retryReason);

        if (state.stopRequested) {
          t("fail", "Stopped during retry Ward step");
          return { ok: false, error: "Stopped during retry Ward step", trace };
        }

        searchAttempt += 1;
        continue;
      }

      if (outcome.type === "timeout") {
        t("fail", "Search outcome timeout", "No confirm button, no no-result message, no dialog");
        return { ok: false, error: "Search outcome timeout", trace };
      }

      if (outcome.type === "dialog") {
        t("warn", "Alert/dialog detected after search", "Waiting user manual override");
        setStatus(
          `Round ${round}: manual override required.\nPlease handle alert dialog manually.`
        );
        const closed = await waitUntilDialogClosed(180000);
        if (!closed) {
          t("fail", "Manual override timeout");
          return { ok: false, error: "Manual override timeout", trace };
        }
        t("ok", "Dialog closed by user");

        const outcomeAfterDialog = await waitForSearchOutcome(10000);

        if (outcomeAfterDialog.type === "no_result") {
          t("warn", "No results found after dialog handling", `attempt ${searchAttempt}/3`);

          if (searchAttempt >= maxSearchAttempts) {
            t("fail", "Reached max retry attempts after dialog handling", "Stop this session");
            return {
              ok: false,
              error: "No results found after 3 Ward attempts. Session stopped.",
              trace,
            };
          }

          const retryReason = await promptRetryAnotherWard(round, searchAttempt + 1);
          t("info", "Manual retry Ward step finished", retryReason);

          if (state.stopRequested) {
            t("fail", "Stopped during retry Ward step");
            return { ok: false, error: "Stopped during retry Ward step", trace };
          }

          searchAttempt += 1;
          continue;
        }

        if (outcomeAfterDialog.type !== "confirm") {
          t("fail", "Confirm button not found after dialog handling");
          return { ok: false, error: "Confirm button not found after dialog handling", trace };
        }

        clickLikeUser(outcomeAfterDialog.el);
        t("ok", "Clicked confirm button");
        await sleep(1200);

        const dialog2 = findOpenDialog();
        if (dialog2) {
          t("warn", "Alert/dialog detected after confirm", "Waiting user manual override");
          setStatus(
            `Round ${round}: manual override required.\nPlease handle alert dialog manually.`
          );
          const closed2 = await waitUntilDialogClosed(180000);
          if (!closed2) {
            t("fail", "Manual override timeout after confirm");
            return { ok: false, error: "Manual override timeout after confirm", trace };
          }
          t("ok", "Dialog closed by user");
        }

        return { ok: true, trace };
      }

      if (outcome.type === "confirm") {
        clickLikeUser(outcome.el);
        t("ok", "Clicked confirm button");
        await sleep(1200);

        const dialog = findOpenDialog();
        if (dialog) {
          t("warn", "Alert/dialog detected", "Waiting user manual override");
          setStatus(
            `Round ${round}: manual override required.\nPlease handle alert dialog manually.`
          );
          const closed = await waitUntilDialogClosed(180000);
          if (!closed) {
            t("fail", "Manual override timeout");
            return { ok: false, error: "Manual override timeout", trace };
          }
          t("ok", "Dialog closed by user");
        }

        return { ok: true, trace };
      }

      t("fail", "Unhandled search outcome");
      return { ok: false, error: "Unhandled search outcome", trace };
    }

    return { ok: false, error: "Session stopped after max Ward retry attempts", trace };
  }

  async function startRun() {
    if (state.running) return;

    setPanelDismissed(false);

    state.running = true;
    state.stopRequested = false;
    state.failed = false;
    state.currentRound = 0;
    resetProgress();
    updateButtons();
    setStatus("Starting IP Fill…");
    pushLog("info", "IP Fill started");

    for (let round = 1; round <= state.rounds; round++) {
      if (state.stopRequested) {
        setStatus(`Stopped at round ${round - 1}/${state.rounds}`);
        pushLog("info", "Stopped by user");
        break;
      }

      state.currentRound = round;
      setStatus(`Running round ${round}/${state.rounds}…`);
      pushLog("info", `Round ${round} starting`);

      const result = await runOneRound(round);

      if (!result.ok) {
        state.failed = true;
        state.stopRequested = true;
        setStatus(`Session stopped at round ${round}: ${result.error}`);
        pushLog("fail", `Session stopped at round ${round}`, result.error || "");
        break;
      }

      setProgress(round, state.rounds);
      setStatus(`Round ${round} completed.`);
      pushLog("success", `Round ${round} completed`);

      if (round < state.rounds) {
        await sleep(1200);
      }
    }

    clearManualCountdown();

    if (!state.failed && !state.stopRequested && state.currentRound === state.rounds) {
      setStatus(`All ${state.rounds} rounds complete.`);
      pushLog("success", `All ${state.rounds} rounds completed`);
    }

    state.running = false;
    updateButtons();
  }

  function stopRun() {
    state.stopRequested = true;
    clearManualCountdown();
    setStatus("Stopping after current round…");
    pushLog("info", "Stop requested");
    updateButtons();
  }

  async function diagnose() {
    pushLog("info", "Diagnose start");
    const wardInput = findWardInput();
    const report = {
      url: location.href,
      hasNewIpFill: !!document.querySelector("#newipfill"),
      hasWard89: !!document.querySelector("#fl-input-89"),
      detectedWardInput: wardInput
        ? {
            id: wardInput.id || "",
            ariaLabel: wardInput.getAttribute("aria-label") || "",
            placeholder: wardInput.getAttribute("placeholder") || "",
            value: wardInput.value || "",
          }
        : null,
      hasSearch: !!document.querySelector("#searchipfill"),
      hasActionDiv: !!document.querySelector("#actiondiv"),
      hasNoResultMessage: !!findNoResultMessage(),
      dismissed: state.dismissed,
      allIds: Array.from(document.querySelectorAll("[id]"))
        .map((el) => el.id)
        .filter(Boolean)
        .slice(0, 80),
    };

    console.log("[Arcus IPFill Diagnose]", report);
    pushLog("info", "Diagnose URL", report.url);
    pushLog("info", "#newipfill", String(report.hasNewIpFill));
    pushLog("info", "#fl-input-89", String(report.hasWard89));
    pushLog("info", "detectedWardInput", JSON.stringify(report.detectedWardInput || null));
    pushLog("info", "#searchipfill", String(report.hasSearch));
    pushLog("info", "#actiondiv", String(report.hasActionDiv));
    pushLog("info", "hasNoResultMessage", String(report.hasNoResultMessage));
    pushLog("info", "dismissed", String(report.dismissed));
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2)).catch(() => {});
    setStatus("Diagnose finished. JSON copied to clipboard.");
  }

  function initIfNeeded() {
    if (!isIpFillPage()) {
      removePanel();
      return;
    }
    if (state.dismissed) {
      removePanel();
      return;
    }
    createPanel();
    updateButtons();
  }

  restorePanelDismissed(() => {
    initIfNeeded();
  });

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(initIfNeeded, 700);
    } else if (isIpFillPage() && !document.querySelector("#arcus-ipfill-panel") && !state.dismissed) {
      createPanel();
    } else if ((!isIpFillPage() || state.dismissed) && document.querySelector("#arcus-ipfill-panel")) {
      removePanel();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  window.addEventListener("unload", () => observer.disconnect(), { once: true });

  window.addEventListener("hashchange", () => {
    setTimeout(initIfNeeded, 700);
  });
})();