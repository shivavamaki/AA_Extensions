(() => {
  if (window.__ARCUS_IPFILL_PANEL_LOADED__) return;
  window.__ARCUS_IPFILL_PANEL_LOADED__ = true;

  // Arcus Toolkit v3.9.3 - IP Fill + POM IP Fill mode patch.
  // Flow:
  // start page -> click #newipfill -> detail page -> select Ward autocomplete
  // -> click #searchipfill -> wait data/confirm -> click confirm -> wait manual alert if any
  // -> repeat until Ward list is done.

  const MODES = {
    ipfill: {
      key: "ipfill",
      label: "IP Fill",
      title: "Arcus IP Fill Tools",
      color: "#1565c0",
      light: "#e8f0fe",
      startRoute: "#!/pharmacy/dispenseworkbench/pharmacy/ipfill",
      detailRoute: "#!/pharmacy/ipfilldetail"
    },
    pomipfill: {
      key: "pomipfill",
      label: "POM IP Fill",
      title: "Arcus POM IP Fill Tools",
      color: "#2e7d32",
      light: "#e8f5e9",
      startRoute: "#!/pharmacy/dispenseworkbench/pharmacy/pomipfill",
      detailRoute: "#!/pharmacy/pomipfilldetail"
    }
  };

  const BASE_URL = "https://arcusair.bdms.co.th/";
  const IPFILL_PANEL_STORAGE_KEY = "arcusIpFillPanelState";
  const IPFILL_PANEL_DISMISSED_KEY = "arcusIpFillPanelDismissed";
  const IPFILL_WARD_LIST_KEY = "arcusIpFillWardList";
  const IPFILL_MODE_KEY = "arcusIpFillMode";

  const DEFAULT_WARD_OPTIONS = [
    "Cardiac Care Unit",
    "Intensive Care Unit",
    "Labour Room",
    "Neonatal Intensive Care Unit",
    "Nursery",
    "WARD 4",
    "WARD 5",
    "WARD 6",
    "WARD 7",
    "WARD 8",
    "WARD 9"
  ];

  const SELECTORS = {
    newIpFill: ["#newipfill", "button#newipfill", "button[ng-click*='newIPFill']"],
    wardInput: [
      "input[aria-label='Ward'][role='combobox']",
      "input[aria-label*='Ward'][role='combobox']",
      "md-autocomplete input[role='combobox']",
      "md-autocomplete input[type='search']",
      "input[id^='fl-input-'][type='search']"
    ],
    autocompleteOptions: [
      "md-virtual-repeat-container:not(.ng-hide) li",
      "md-autocomplete-parent-scope li",
      "ul[role='listbox'] li",
      "li[role='option']",
      "md-option",
      ".md-autocomplete-suggestions li"
    ],
    searchIpFill: ["#searchipfill", "button#searchipfill", "button[ng-click*='searchIPFillList']"],
    cancelSearch: ["#cancelsearch", "button#cancelsearch", "button[ng-click*='clearSearch']"],
    confirmButton: [
      "#actiondiv > div > div > button.md-primary.md-button.ng-scope.md-incustheme-theme.md-ink-ripple",
      "#actiondiv button.md-primary",
      "#actiondiv button",
      "button.md-primary[ng-click*='confirm']"
    ],
    noResultMessage: ["span.errortext", ".errortext", "span[translate]", "span"],
    loading: ["md-progress-circular:not(.ng-hide)", ".md-mode-indeterminate:not(.ng-hide)"]
  };

  const state = {
    running: false,
    stopRequested: false,
    dismissed: false,
    logItems: [],
    currentIndex: 0,
    total: 0,
    currentStep: "Ready",
    mode: "ipfill",
  };

  window.ArcusStore = window.ArcusStore || {};
  window.ArcusStore.ipfill = { state, SELECTORS, DEFAULT_WARD_OPTIONS, MODES, version: "3.9.3" };

  const sleep = window.ArcusShared?.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const clamp = window.ArcusShared?.clamp || ((value, min, max) => Math.min(Math.max(value, min), max));
  const escapeHtml = window.ArcusShared?.escapeHtml || ((str) => String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;"));

  function getModeConfig(mode = state.mode) {
    return MODES[mode] || MODES.ipfill;
  }

  function detectModeFromUrl() {
    const href = location.href || "";
    if (href.includes(MODES.pomipfill.startRoute) || href.includes(MODES.pomipfill.detailRoute)) return "pomipfill";
    if (href.includes(MODES.ipfill.startRoute) || href.includes(MODES.ipfill.detailRoute)) return "ipfill";
    return state.mode || "ipfill";
  }

  function syncModeWithUrl() {
    const modeFromUrl = detectModeFromUrl();
    if (modeFromUrl && modeFromUrl !== state.mode && isIpFillPage()) {
      state.mode = modeFromUrl;
      try { chrome.storage?.local?.set({ [IPFILL_MODE_KEY]: state.mode }); } catch (_) {}
    }
  }

  function isIpFillPage() {
    const href = location.href || "";
    return Object.values(MODES).some((mode) => href.includes(mode.startRoute) || href.includes(mode.detailRoute));
  }

  function isStartPage(mode = state.mode) {
    return location.href.includes(getModeConfig(mode).startRoute);
  }

  function isDetailPage(mode = state.mode) {
    return location.href.includes(getModeConfig(mode).detailRoute);
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function isClickable(el) {
    return !!el && isVisible(el) && !el.disabled && !el.closest("[disabled]") && el.getAttribute("aria-disabled") !== "true";
  }

  function textOf(el) {
    return ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  }

  function queryFirst(selectors, root = document, visibleOnly = false) {
    const list = Array.isArray(selectors) ? selectors : [selectors].filter(Boolean);
    for (const selector of list) {
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
    const list = Array.isArray(selectors) ? selectors : [selectors].filter(Boolean);
    const output = [];
    const seen = new Set();
    for (const selector of list) {
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

  async function clickLikeUser(el) {
    if (!el) return false;
    try { el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" }); } catch (_) {}
    await sleep(120);
    ["mouseover", "mouseenter", "mousedown", "mouseup", "click"].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    if (typeof el.click === "function") el.click();
    return true;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function waitFor(fn, timeoutMs = 15000, intervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (state.stopRequested) return null;
      const result = fn();
      if (result) return result;
      await sleep(intervalMs);
    }
    return null;
  }

  function setPanelDismissed(value) {
    state.dismissed = !!value;
    try { chrome.storage?.local?.set({ [IPFILL_PANEL_DISMISSED_KEY]: !!value }); } catch (_) {}
  }

  function restorePanelDismissed(callback) {
    try {
      chrome.storage?.local?.get(IPFILL_PANEL_DISMISSED_KEY, (data) => {
        state.dismissed = !!data?.[IPFILL_PANEL_DISMISSED_KEY];
        callback?.(state.dismissed);
      });
    } catch (_) { callback?.(state.dismissed); }
  }

  function pushLog(type, message, meta = "") {
    const time = new Date().toLocaleTimeString();
    state.logItems.unshift({ type, message, meta, time });
    state.logItems = state.logItems.slice(0, 200);
    renderLog();
  }

  function renderLog() {
    const root = document.querySelector("#arcus-ipfill-log");
    if (!root) return;
    root.innerHTML = state.logItems.length
      ? state.logItems.map((item) => `
          <div class="log-item ${item.type}">
            <div class="meta">${item.time}${item.meta ? " • " + escapeHtml(item.meta) : ""}</div>
            <div>${escapeHtml(item.message)}</div>
          </div>
        `).join("")
      : '<div class="log-item info">No log yet.</div>';
  }

  function setStatus(message) {
    state.currentStep = message;
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
    const pct = total ? Math.round((done / total) * 100) : 0;
    bar.style.width = `${pct}%`;
    bar.style.background = getModeConfig().color;
    label.textContent = `${done} / ${total}`;
  }

  function getWardToggleInputs() {
    return Array.from(document.querySelectorAll(".arcus-ipfill-ward-toggle"));
  }

  function updateWardCount() {
    const label = document.querySelector("#arcus-ipfill-ward-count");
    if (!label) return;
    const selected = getWardList().length;
    label.textContent = `${selected} / ${DEFAULT_WARD_OPTIONS.length} selected`;
  }

  function updateButtons() {
    const runBtn = document.querySelector("#arcus-ipfill-run");
    const stopBtn = document.querySelector("#arcus-ipfill-stop");
    const diagBtn = document.querySelector("#arcus-ipfill-diagnose");
    const clearBtn = document.querySelector("#arcus-ipfill-clear");
    const copyBtn = document.querySelector("#arcus-ipfill-copy");
    const selectAllBtn = document.querySelector("#arcus-ipfill-select-all");
    const selectNoneBtn = document.querySelector("#arcus-ipfill-select-none");
    const modeInputs = Array.from(document.querySelectorAll(".arcus-ipfill-mode-radio"));
    if (runBtn) runBtn.disabled = state.running;
    if (stopBtn) stopBtn.disabled = !state.running;
    if (diagBtn) diagBtn.disabled = state.running;
    if (clearBtn) clearBtn.disabled = state.running;
    if (copyBtn) copyBtn.disabled = false;
    if (selectAllBtn) selectAllBtn.disabled = state.running;
    if (selectNoneBtn) selectNoneBtn.disabled = state.running;
    getWardToggleInputs().forEach((input) => { input.disabled = state.running; });
    modeInputs.forEach((input) => { input.disabled = state.running; input.checked = input.value === state.mode; });
    updateModeTheme();
    updateWardCount();
  }

  function saveWardList() {
    const selected = getWardList();
    try { chrome.storage?.local?.set({ [IPFILL_WARD_LIST_KEY]: selected }); } catch (_) {}
    updateWardCount();
  }

  function restoreWardList() {
    try {
      chrome.storage?.local?.get(IPFILL_WARD_LIST_KEY, (data) => {
        const saved = data?.[IPFILL_WARD_LIST_KEY];
        const selected = Array.isArray(saved) ? saved : DEFAULT_WARD_OPTIONS.slice();
        getWardToggleInputs().forEach((input) => {
          input.checked = selected.includes(input.value);
        });
        updateWardCount();
      });
    } catch (_) {
      getWardToggleInputs().forEach((input) => { input.checked = true; });
      updateWardCount();
    }
  }

  function saveMode() {
    try { chrome.storage?.local?.set({ [IPFILL_MODE_KEY]: state.mode }); } catch (_) {}
    updateModeTheme();
  }

  function restoreMode(callback) {
    try {
      chrome.storage?.local?.get(IPFILL_MODE_KEY, (data) => {
        const saved = data?.[IPFILL_MODE_KEY];
        if (saved && MODES[saved]) state.mode = saved;
        if (isIpFillPage()) state.mode = detectModeFromUrl();
        callback?.(state.mode);
      });
    } catch (_) {
      if (isIpFillPage()) state.mode = detectModeFromUrl();
      callback?.(state.mode);
    }
  }

  function updateModeTheme() {
    const cfg = getModeConfig();
    const panel = document.querySelector("#arcus-ipfill-panel");
    if (!panel) return;
    panel.dataset.mode = cfg.key;
    panel.style.setProperty("--arcus-mode-color", cfg.color);
    panel.style.setProperty("--arcus-mode-light", cfg.light);
    const title = panel.querySelector("#arcus-ipfill-title");
    const badge = panel.querySelector("#arcus-ipfill-mode-badge");
    const runBtn = panel.querySelector("#arcus-ipfill-run");
    const bar = panel.querySelector("#arcus-ipfill-bar");
    if (title) title.textContent = `${cfg.title} v3.9.3`;
    if (badge) {
      badge.textContent = cfg.label;
      badge.style.color = cfg.color;
      badge.style.background = cfg.light;
      badge.style.borderColor = cfg.color;
    }
    if (runBtn) {
      runBtn.textContent = `Run ${cfg.label}`;
      runBtn.style.background = cfg.color;
    }
    if (bar) bar.style.background = cfg.color;
  }

  function setAllWards(checked) {
    getWardToggleInputs().forEach((input) => { input.checked = !!checked; });
    saveWardList();
  }

  function getWardList() {
    return getWardToggleInputs()
      .filter((input) => input.checked)
      .map((input) => input.value)
      .filter(Boolean);
  }

  function removePanel() {
    document.querySelector("#arcus-ipfill-panel")?.remove();
  }

  function savePanelState(panel) {
    const minimized = panel.classList.contains("is-minimized");
    try {
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
    } catch (_) {}
  }

  function restorePanelState(panel) {
    try {
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
    } catch (_) {}
  }

  function attachPanelInteractions(panel) {
    restorePanelState(panel);
    restoreWardList();

    const header = panel.querySelector("#arcus-ipfill-header");
    const minimizeBtn = panel.querySelector("#arcus-ipfill-minimize");
    const closeBtn = panel.querySelector("#arcus-ipfill-close");
    const wardToggles = panel.querySelectorAll(".arcus-ipfill-ward-toggle");
    const modeRadios = panel.querySelectorAll(".arcus-ipfill-mode-radio");

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
      panel.style.left = `${clamp(startLeft + (event.clientX - startX), 8, window.innerWidth - panel.offsetWidth - 8)}px`;
      panel.style.top = `${clamp(startTop + (event.clientY - startY), 8, window.innerHeight - panel.offsetHeight - 8)}px`;
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

    wardToggles.forEach((input) => input.addEventListener("change", saveWardList));

    modeRadios.forEach((input) => input.addEventListener("change", () => {
      if (!input.checked || state.running) return;
      state.mode = input.value;
      saveMode();
      setStatus(`${getModeConfig().label} mode selected.`);
    }));

    panel.querySelector("#arcus-ipfill-select-all")?.addEventListener("click", () => setAllWards(true));
    panel.querySelector("#arcus-ipfill-select-none")?.addEventListener("click", () => setAllWards(false));

    panel.querySelector("#arcus-ipfill-run")?.addEventListener("click", startRun);
    panel.querySelector("#arcus-ipfill-stop")?.addEventListener("click", stopRun);
    panel.querySelector("#arcus-ipfill-diagnose")?.addEventListener("click", diagnose);
    panel.querySelector("#arcus-ipfill-clear")?.addEventListener("click", () => { state.logItems = []; renderLog(); });
    panel.querySelector("#arcus-ipfill-copy")?.addEventListener("click", async () => {
      const text = state.logItems.map((item) => `[${item.time}] ${item.type.toUpperCase()}${item.meta ? ` (${item.meta})` : ""} - ${item.message}`).join("\n");
      try { await navigator.clipboard.writeText(text || "No log yet."); pushLog("info", "Log copied to clipboard"); }
      catch (error) { pushLog("fail", "Failed to copy log", error.message || "clipboard error"); }
    });
  }

  function createPanel() {
    if (!isIpFillPage() || state.dismissed || document.querySelector("#arcus-ipfill-panel")) return;
    const panel = document.createElement("div");
    panel.id = "arcus-ipfill-panel";
    panel.className = "arcus-ipfill-panel";
    const cfg = getModeConfig();
    panel.style.setProperty("--arcus-mode-color", cfg.color);
    panel.style.setProperty("--arcus-mode-light", cfg.light);
    panel.innerHTML = `
      <div id="arcus-ipfill-header" class="arcus-panel-header">
        <div class="arcus-panel-title-wrap">
          <div id="arcus-ipfill-title" class="title" style="color:var(--arcus-mode-color);">Arcus IP Fill Tools v3.9.3</div>
          <div class="desc">Mode-aware flow: New → Detail → Ward autocomplete → Search → Confirm → repeat until Ward list done.</div>
        </div>
        <div class="arcus-panel-actions">
          <button id="arcus-ipfill-minimize" class="icon-btn" title="Minimize / Restore">—</button>
          <button id="arcus-ipfill-close" class="icon-btn" title="Close">✕</button>
        </div>
      </div>
      <div class="arcus-panel-body">
        <div class="hint-box" style="border-color:var(--arcus-mode-color); background:var(--arcus-mode-light); color:#37474f;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">
            <strong>Mode</strong>
            <span id="arcus-ipfill-mode-badge" style="border:1px solid var(--arcus-mode-color); border-radius:999px; padding:2px 8px; font-weight:700;">IP Fill</span>
          </div>
          <label class="checkbox-line" style="margin-bottom:6px;">
            <input class="arcus-ipfill-mode-radio" type="radio" name="arcus-ipfill-mode" value="ipfill" checked />
            <span>IP Fill</span>
          </label>
          <label class="checkbox-line" style="margin-bottom:0;">
            <input class="arcus-ipfill-mode-radio" type="radio" name="arcus-ipfill-mode" value="pomipfill" />
            <span>POM IP Fill</span>
          </label>
        </div>
        <div class="hint-box">Select Ward options below. All Wards are selected by default. The tool will select each Ward from the Angular autocomplete list, then click Search and Confirm.</div>
        <div class="field-group">
          <div class="section-title" style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span>Ward selection</span>
            <span id="arcus-ipfill-ward-count" style="font-weight:600; color:#607d8b; text-transform:none; letter-spacing:0;">0 / 11 selected</span>
          </div>
          <div class="btn-row">
            <button id="arcus-ipfill-select-all" class="small-btn" type="button">Select All</button>
            <button id="arcus-ipfill-select-none" class="small-btn" type="button">Clear All</button>
          </div>
          <div id="arcus-ipfill-ward-list" style="display:grid; grid-template-columns:1fr; gap:6px; margin-bottom:10px;">
            ${DEFAULT_WARD_OPTIONS.map((ward) => `
              <label class="checkbox-line" style="margin-bottom:0; background:var(--arcus-mode-light); border:1px solid var(--arcus-mode-color); border-radius:6px; padding:6px 8px;">
                <input class="arcus-ipfill-ward-toggle" type="checkbox" value="${escapeHtml(ward)}" checked />
                <span>${escapeHtml(ward)}</span>
              </label>
            `).join("")}
          </div>
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
          <div class="progress-track"><div id="arcus-ipfill-bar" class="progress-bar"></div></div>
          <div id="arcus-ipfill-label" class="progress-label">0 / 0</div>
        </div>
        <div id="arcus-ipfill-status" class="status">Ready</div>
        <div id="arcus-ipfill-log"></div>
      </div>
    `;
    document.body.appendChild(panel);
    attachPanelInteractions(panel);
    renderLog();
    updateModeTheme();
    updateButtons();
  }

  async function ensureStartPage() {
    const cfg = getModeConfig();
    setStatus(`Step 1: go to ${cfg.label} start page`);
    if (!isStartPage()) {
      location.href = BASE_URL + cfg.startRoute;
      const ok = await waitFor(() => isStartPage(), 20000, 300);
      if (!ok) throw new Error(`Cannot reach ${cfg.label} start page`);
    }
    await sleep(800);
  }

  async function clickNewAndWaitDetail() {
    setStatus("Step 2: find and click #newipfill");
    const newBtn = await waitFor(() => {
      const el = queryFirst(SELECTORS.newIpFill, document, true);
      return isClickable(el) ? el : null;
    }, 15000, 300);
    if (!newBtn) throw new Error("#newipfill not found or not clickable");
    await clickLikeUser(newBtn);

    const cfg = getModeConfig();
    setStatus(`Step 3: waiting for ${cfg.detailRoute} URL`);
    const ok = await waitFor(() => isDetailPage(), 20000, 300);
    if (!ok) throw new Error(`Did not navigate to ${cfg.detailRoute} after New`);
    await sleep(900);
  }

  async function findWardInput() {
    return waitFor(() => {
      const inputs = queryAll(SELECTORS.wardInput, document, true);
      for (const input of inputs) {
        const label = input.getAttribute("aria-label") || input.closest("md-input-container")?.querySelector("label")?.textContent || "";
        if (/ward/i.test(label)) return input;
      }
      return inputs[0] || null;
    }, 15000, 250);
  }

  async function selectWardAutocomplete(wardText) {
    setStatus(`Step 4: select Ward "${wardText}"`);
    const input = await findWardInput();
    if (!input) throw new Error("Ward autocomplete input not found");

    await clickLikeUser(input);
    input.focus();
    setNativeValue(input, "");
    await sleep(250);
    setNativeValue(input, wardText);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: wardText.slice(-1) || "a", bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: wardText.slice(-1) || "a", bubbles: true, cancelable: true }));
    await sleep(900);

    const option = await waitFor(() => {
      const opts = queryAll(SELECTORS.autocompleteOptions, document, true);
      const exact = opts.find((o) => textOf(o).toLowerCase() === wardText.toLowerCase());
      if (exact) return exact;
      const starts = opts.find((o) => textOf(o).toLowerCase().startsWith(wardText.toLowerCase()));
      if (starts) return starts;
      const contains = opts.find((o) => textOf(o).toLowerCase().includes(wardText.toLowerCase()));
      return contains || opts[0] || null;
    }, 6000, 250);

    if (option) {
      await clickLikeUser(option);
      await sleep(600);
      pushLog("success", `Selected Ward option: ${textOf(option) || wardText}`);
    } else {
      // Fallback: press Enter. This may work when Arcus has already resolved a valid md-selected-item.
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      await sleep(700);
      pushLog("info", "No visible autocomplete option; used Enter fallback", wardText);
    }

    input.blur();
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    await sleep(500);
  }

  async function clickSearchAndWaitOutcome() {
    setStatus("Step 5: click #searchipfill");
    const searchBtn = await waitFor(() => {
      const el = queryFirst(SELECTORS.searchIpFill, document, true);
      return isClickable(el) ? el : null;
    }, 10000, 300);
    if (!searchBtn) throw new Error("#searchipfill not found or disabled");
    await clickLikeUser(searchBtn);

    setStatus("Step 6: waiting for data / confirm button");
    await sleep(1000);
    return waitForSearchOutcome(25000);
  }

  function findOpenDialog() {
    const dialogs = Array.from(document.querySelectorAll("md-dialog, [role='dialog'], .md-dialog-container md-dialog"));
    return dialogs.find(isVisible) || null;
  }

  function findNoResultMessage() {
    return queryAll(SELECTORS.noResultMessage, document, true).find((el) => {
      const txt = textOf(el).toLowerCase();
      return txt.includes("no results found for this search criteria") || txt.includes("no results found");
    }) || null;
  }

  async function waitForSearchOutcome(timeoutMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (state.stopRequested) return { type: "stopped" };
      const dialog = findOpenDialog();
      if (dialog) return { type: "dialog", el: dialog };
      const noResult = findNoResultMessage();
      if (noResult) return { type: "no_result", el: noResult };
      const confirmBtn = queryFirst(SELECTORS.confirmButton, document, true);
      if (isClickable(confirmBtn)) return { type: "confirm", el: confirmBtn };
      await sleep(300);
    }
    return { type: "timeout" };
  }

  async function waitUntilDialogClosed(timeoutMs = 180000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (state.stopRequested) return false;
      if (!findOpenDialog()) return true;
      setStatus("Manual alert shown. Please complete it, then system will continue.");
      await sleep(800);
    }
    return false;
  }

  async function resetSearchAfterNoResult(wardText = "") {
    setStatus(`No data found${wardText ? ` for ${wardText}` : ""}. Reset search and continue next Ward.`);
    pushLog("info", "No results found; reset search box", wardText);

    const cancelBtn = await waitFor(() => {
      const el = queryFirst(SELECTORS.cancelSearch, document, true);
      return isClickable(el) ? el : null;
    }, 6000, 250);

    if (cancelBtn) {
      await clickLikeUser(cancelBtn);
      await sleep(900);
      return true;
    }

    // Fallback when the Clear button is temporarily not clickable.
    const input = await findWardInput();
    if (input) {
      await clickLikeUser(input);
      setNativeValue(input, "");
      input.dispatchEvent(new Event("blur", { bubbles: true }));
      await sleep(500);
      pushLog("info", "Clear button not found; manually cleared Ward input fallback", wardText);
      return true;
    }

    pushLog("fail", "Cannot reset search after no result", wardText);
    return false;
  }

  async function confirmAndHandleAlert(outcome, wardText = "") {
    if (outcome.type === "dialog") {
      pushLog("info", "Alert detected before confirm; waiting for user");
      const closed = await waitUntilDialogClosed();
      if (!closed) throw new Error("Manual alert timeout before confirm");
      outcome = await waitForSearchOutcome(10000);
    }

    if (outcome.type === "no_result") {
      await resetSearchAfterNoResult(wardText);
      return { ok: false, skipped: true, reason: "No results found; reset and skipped to next Ward" };
    }

    if (outcome.type !== "confirm" || !outcome.el) {
      return { ok: false, skipped: true, reason: outcome.type || "No confirm button" };
    }

    setStatus("Step 7: click confirm button");
    await clickLikeUser(outcome.el);
    await sleep(1300);

    const dialog = findOpenDialog();
    if (dialog) {
      pushLog("info", "Alert detected after confirm; waiting for user");
      const closed = await waitUntilDialogClosed();
      if (!closed) throw new Error("Manual alert timeout after confirm");
    }

    setStatus("Step 8: finished this Ward");
    return { ok: true };
  }

  async function runOneWard(ward, index, total) {
    if (state.stopRequested) return { ok: false, stopped: true };
    state.currentIndex = index + 1;
    setProgress(index, total);
    pushLog("info", `Start Ward ${index + 1}/${total}`, ward);

    if (!isDetailPage()) {
      await ensureStartPage();
      await clickNewAndWaitDetail();
    }
    await selectWardAutocomplete(ward);
    const outcome = await clickSearchAndWaitOutcome();
    const result = await confirmAndHandleAlert(outcome, ward);

    if (result.ok) pushLog("success", `Completed Ward ${index + 1}/${total}`, ward);
    else pushLog("fail", result.reason || "Skipped", ward);

    setProgress(index + 1, total);
    return result;
  }

  async function startRun() {
    if (state.running) return;
    const wards = getWardList();
    if (!wards.length) {
      setStatus("Please select at least one Ward.");
      pushLog("fail", "No Ward selected");
      return;
    }

    saveWardList();
    state.running = true;
    state.stopRequested = false;
    state.currentIndex = 0;
    state.total = wards.length;
    updateButtons();
    setProgress(0, wards.length);
    setStatus(`Starting ${getModeConfig().label} loop: ${wards.length} Ward option(s)`);
    pushLog("info", `${getModeConfig().label} loop started`, `${wards.length} wards`);

    try {
      for (let i = 0; i < wards.length; i++) {
        if (state.stopRequested) break;
        try {
          await runOneWard(wards[i], i, wards.length);
        } catch (error) {
          pushLog("fail", `Ward failed: ${wards[i]}`, error.message || "unknown error");
          setStatus(`Ward failed: ${wards[i]}\n${error.message || "unknown error"}`);
          // Continue to next Ward unless user presses Stop.
        }
        if (!state.stopRequested && i < wards.length - 1) await sleep(1000);
      }

      if (state.stopRequested) {
        setStatus(`Stopped at ${state.currentIndex}/${wards.length}`);
        pushLog("info", "Stopped by user");
      } else {
        setStatus(`Done. Processed ${wards.length}/${wards.length} Ward option(s).`);
        pushLog("success", `${getModeConfig().label} loop finished`);
      }
    } finally {
      state.running = false;
      updateButtons();
    }
  }

  function stopRun() {
    state.stopRequested = true;
    setStatus("Stopping…");
    pushLog("info", "Stop requested");
    updateButtons();
  }

  async function diagnose() {
    const wardInput = await findWardInput();
    const report = {
      version: "3.9.3",
      mode: state.mode,
      modeLabel: getModeConfig().label,
      startRoute: getModeConfig().startRoute,
      detailRoute: getModeConfig().detailRoute,
      url: location.href,
      isStartPage: isStartPage(),
      isDetailPage: isDetailPage(),
      hasNewIpFill: !!queryFirst(SELECTORS.newIpFill),
      hasSearchIpFill: !!queryFirst(SELECTORS.searchIpFill),
      hasCancelSearch: !!queryFirst(SELECTORS.cancelSearch),
      hasActionDiv: !!document.querySelector("#actiondiv"),
      detectedWardInput: wardInput ? {
        id: wardInput.id || "",
        name: wardInput.getAttribute("name") || "",
        ariaLabel: wardInput.getAttribute("aria-label") || "",
        role: wardInput.getAttribute("role") || "",
        type: wardInput.getAttribute("type") || "",
        value: wardInput.value || ""
      } : null,
      flInputs: Array.from(document.querySelectorAll("input[id^='fl-input-']")).map((el) => ({
        id: el.id,
        ariaLabel: el.getAttribute("aria-label") || "",
        role: el.getAttribute("role") || "",
        type: el.getAttribute("type") || "",
        visible: isVisible(el),
        value: el.value || ""
      })),
      visibleOptions: queryAll(SELECTORS.autocompleteOptions, document, true).map(textOf).filter(Boolean).slice(0, 30),
      openDialogText: textOf(findOpenDialog()).slice(0, 500),
      noResult: !!findNoResultMessage(),
    };

    console.log("[Arcus IPFill Diagnose]", report);
    try { await navigator.clipboard.writeText(JSON.stringify(report, null, 2)); } catch (_) {}
    pushLog("info", "Diagnose copied to clipboard", report.url);
    setStatus("Diagnose finished. JSON copied to clipboard.");
  }

  window.addEventListener("arcus-toolkit:show-ipfill-panel", () => {
    setPanelDismissed(false);
    initIfNeeded();
  });

  window.addEventListener("arcus-toolkit:remove-ipfill-panel", () => {
    setPanelDismissed(true);
    removePanel();
  });

  function initIfNeeded() {
    if (isIpFillPage()) syncModeWithUrl();
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

  restoreMode(() => restorePanelDismissed(() => initIfNeeded()));

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

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => setTimeout(initIfNeeded, 700));
})();
