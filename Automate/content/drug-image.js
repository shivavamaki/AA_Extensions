"use strict";

(() => {
  if (window.__ARCUS_DRUG_IMAGE_LOADED__) return;
  window.__ARCUS_DRUG_IMAGE_LOADED__ = true;

  const SERVER_URL          = "http://localhost:8765";
  const ITEM_MASTER_HASH    = "!/inventories/itemmaster";
  const ITEM_DETAIL_HASH    = "!/inventories/itemmasterdetail";
  const PANEL_STATE_KEY     = "arcusDrugImagePanelState";
  const PANEL_DISMISSED_KEY = "arcusDrugImageDismissed";

  const CONFIRM_CLOSE_SELECTORS = [
    "body > div.md-dialog-container.ng-scope > md-dialog > md-dialog-actions > button.md-primary.md-confirm-button.md-button.md-incustheme-theme.md-ink-ripple",
    "md-dialog md-dialog-actions button.md-primary.md-confirm-button",
    "md-dialog md-dialog-actions button.md-confirm-button",
  ];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  const state = {
    running: false,
    stopRequested: false,
    dismissed: false,
    success: 0,
    fail: 0,
    logItems: [],
  };

  // ── Route helpers ─────────────────────────────────────────────────────────

  function isItemMasterPage() {
    const h = location.href;
    return h.includes(ITEM_MASTER_HASH) && !h.includes(ITEM_DETAIL_HASH);
  }

  function isItemDetailPage() {
    return location.href.includes(ITEM_DETAIL_HASH);
  }

  function isRelevantPage() {
    return location.href.includes("inventories/itemmaster");
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  async function waitFor(fn, timeoutMs = 15000, intervalMs = 300) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (state.stopRequested) return null;
      const result = fn();
      if (result) return result;
      await sleep(intervalMs);
    }
    return null;
  }

  async function clickLikeUser(el) {
    if (!el) return false;
    try { el.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    await sleep(150);
    ["mouseover", "mouseenter", "mousedown", "mouseup", "click"].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
    if (typeof el.click === "function") el.click();
    return true;
  }

  function setNativeValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter ? setter.call(input, value) : (input.value = value);
    input.dispatchEvent(new Event("input",  { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function queryFirst(selectors) {
    const list = Array.isArray(selectors) ? selectors : [selectors];
    for (const sel of list) {
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el)) return el;
      } catch (_) {}
    }
    return null;
  }

  // ── Panel UI ──────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function setStatus(msg) {
    const el = document.querySelector("#arcus-di-status");
    if (el) el.textContent = msg;
    console.log("[DrugImage]", msg);
  }

  function setProgress(done, total) {
    const bar   = document.querySelector("#arcus-di-bar");
    const label = document.querySelector("#arcus-di-label");
    if (!bar || !label) return;
    bar.style.width   = total ? `${Math.round((done / total) * 100)}%` : "0%";
    label.textContent = `${done} / ${total}`;
  }

  function pushLog(type, message) {
    const time = new Date().toLocaleTimeString();
    state.logItems.unshift({ type, message, time });
    state.logItems = state.logItems.slice(0, 200);
    renderLog();
  }

  function renderLog() {
    const root = document.querySelector("#arcus-di-log");
    if (!root) return;
    root.innerHTML = state.logItems.length
      ? state.logItems.map((item) =>
          `<div class="arcus-di-log-${item.type}">` +
          `<span class="arcus-di-t">${item.time}</span> ${esc(item.message)}</div>`
        ).join("")
      : '<div class="arcus-di-log-info">No log yet.</div>';
  }

  function updateButtons() {
    const run  = document.querySelector("#arcus-di-run");
    const stop = document.querySelector("#arcus-di-stop");
    const sync = document.querySelector("#arcus-di-sync");
    if (run)  run.disabled  = state.running;
    if (stop) stop.disabled = !state.running;
    if (sync) sync.disabled = state.running;
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
        const s = data?.[PANEL_STATE_KEY];
        if (!s) return;
        if (s.top)  panel.style.top  = s.top;
        if (s.left) panel.style.left = s.left;
        if (s.minimized) {
          panel.classList.add("is-minimized");
          const btn = panel.querySelector("#arcus-di-minimize");
          if (btn) btn.textContent = "+";
        }
      });
    } catch (_) {}
  }

  function setPanelDismissed(value) {
    state.dismissed = !!value;
    try { chrome.storage?.local?.set({ [PANEL_DISMISSED_KEY]: !!value }); } catch (_) {}
  }

  function restorePanelDismissed(cb) {
    try {
      chrome.storage?.local?.get(PANEL_DISMISSED_KEY, (data) => {
        state.dismissed = !!data?.[PANEL_DISMISSED_KEY];
        cb?.(state.dismissed);
      });
    } catch (_) { cb?.(state.dismissed); }
  }

  function removePanel() {
    document.querySelector("#arcus-di-panel")?.remove();
  }

  function injectStyles() {
    if (document.querySelector("#arcus-di-style")) return;
    const style = document.createElement("style");
    style.id = "arcus-di-style";
    style.textContent = `
      #arcus-di-panel {
        position:fixed; top:80px; right:16px; z-index:999999;
        width:290px; background:#fff; border-radius:10px;
        box-shadow:0 4px 20px rgba(0,0,0,.18); border:1px solid #dde4ef;
        font-family:'Segoe UI',system-ui,sans-serif; font-size:12px; color:#1a1a2e;
      }
      #arcus-di-panel.is-minimized #arcus-di-body { display:none; }
      #arcus-di-panel.is-dragging { opacity:.88; }
      #arcus-di-header {
        background:linear-gradient(135deg,#0277bd,#0288d1); color:#fff;
        padding:10px 12px 9px; border-radius:10px 10px 0 0;
        display:flex; align-items:flex-start; justify-content:space-between; gap:8px; cursor:move;
      }
      .arcus-di-title  { font-size:13px; font-weight:700; }
      .arcus-di-desc   { font-size:10px; opacity:.8; margin-top:2px; }
      .arcus-di-hact   { display:flex; gap:4px; flex-shrink:0; }
      .arcus-di-ibtn   {
        background:rgba(255,255,255,.2); border:none; color:#fff;
        width:22px; height:22px; border-radius:5px; cursor:pointer; font-size:12px;
        display:flex; align-items:center; justify-content:center;
      }
      .arcus-di-ibtn:hover { background:rgba(255,255,255,.35); }
      #arcus-di-body   { padding:10px 12px 12px; }
      .arcus-di-row    { display:flex; gap:6px; margin-bottom:8px; }
      .arcus-di-btn    {
        flex:1; padding:7px 6px; border:none; border-radius:6px;
        font-size:11px; font-weight:600; cursor:pointer; transition:filter .15s;
      }
      .arcus-di-btn:disabled            { opacity:.38; cursor:not-allowed; }
      .arcus-di-btn:hover:not(:disabled){ filter:brightness(1.1); }
      .arcus-di-start  { background:#0288d1; color:#fff; }
      .arcus-di-stop   { background:#d32f2f; color:#fff; }
      .arcus-di-sync   { background:#388e3c; color:#fff; }
      .arcus-di-track  { height:6px; background:#e0e7ef; border-radius:3px; overflow:hidden; margin-bottom:3px; }
      .arcus-di-bar    { height:100%; background:#0288d1; border-radius:3px; width:0; transition:width .4s; }
      .arcus-di-plabel { font-size:10px; color:#607d8b; text-align:right; margin-bottom:8px; }
      #arcus-di-status {
        font-size:11px; line-height:1.4; padding:6px 8px;
        background:#f0f7ff; border-left:3px solid #0288d1; border-radius:4px;
        color:#2c3e60; margin-bottom:8px; white-space:pre-line; word-break:break-word;
      }
      #arcus-di-log    { max-height:150px; overflow-y:auto; font-size:10px; }
      #arcus-di-log > div { padding:3px 0; border-bottom:1px solid #f0f0f0; line-height:1.3; }
      .arcus-di-t      { color:#9e9e9e; margin-right:4px; }
      .arcus-di-log-success { color:#2e7d32; }
      .arcus-di-log-fail    { color:#c62828; }
      .arcus-di-log-info    { color:#444; }
    `;
    document.head.appendChild(style);
  }

  function createPanel() {
    if (!isRelevantPage() || state.dismissed || document.querySelector("#arcus-di-panel")) return;

    injectStyles();
    const panel = document.createElement("div");
    panel.id = "arcus-di-panel";
    panel.innerHTML = `
      <div id="arcus-di-header">
        <div>
          <div class="arcus-di-title">Drug Image Downloader</div>
          <div class="arcus-di-desc">Auto-fetch drug images from Item Master</div>
        </div>
        <div class="arcus-di-hact">
          <button id="arcus-di-minimize" class="arcus-di-ibtn" title="Minimize">—</button>
          <button id="arcus-di-close"    class="arcus-di-ibtn" title="Close">✕</button>
        </div>
      </div>
      <div id="arcus-di-body">
        <div class="arcus-di-row">
          <button id="arcus-di-run"  class="arcus-di-btn arcus-di-start">▶ Start</button>
          <button id="arcus-di-stop" class="arcus-di-btn arcus-di-stop"  disabled>■ Stop</button>
        </div>
        <div class="arcus-di-row">
          <button id="arcus-di-sync" class="arcus-di-btn arcus-di-sync">🔄 Sync Has Image</button>
        </div>
        <div class="arcus-di-track"><div id="arcus-di-bar" class="arcus-di-bar"></div></div>
        <div id="arcus-di-plabel" class="arcus-di-plabel">0 / 0</div>
        <div id="arcus-di-status" class="arcus-di-status">Ready. Navigate to Item Master then click Start.</div>
        <div id="arcus-di-log"></div>
      </div>
    `;

    document.body.appendChild(panel);
    restorePanelState(panel);

    const header      = panel.querySelector("#arcus-di-header");
    const minimizeBtn = panel.querySelector("#arcus-di-minimize");
    const closeBtn    = panel.querySelector("#arcus-di-close");
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener("mousedown", (e) => {
      if (e.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.classList.add("is-dragging");
      panel.style.left = `${rect.left}px`;
      panel.style.top  = `${rect.top}px`;
      panel.style.right = "auto";
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
      savePanelState(panel);
    });

    minimizeBtn.addEventListener("click", () => {
      const min = panel.classList.toggle("is-minimized");
      minimizeBtn.textContent = min ? "+" : "—";
      savePanelState(panel);
    });

    closeBtn.addEventListener("click", () => {
      setPanelDismissed(true);
      removePanel();
    });

    panel.querySelector("#arcus-di-run")?.addEventListener("click",  startRun);
    panel.querySelector("#arcus-di-sync")?.addEventListener("click", syncHasImage);
    panel.querySelector("#arcus-di-stop")?.addEventListener("click", () => {
      state.stopRequested = true;
      updateButtons();
      setStatus("Stopping…");
      pushLog("info", "Stop requested by user");
    });

    renderLog();
    updateButtons();
  }

  // ── Server helpers ────────────────────────────────────────────────────────

  async function fetchPendingCodes() {
    const resp = await fetch(`${SERVER_URL}/api/medication-db`);
    if (!resp.ok) throw new Error(`Server responded ${resp.status}`);
    const db = await resp.json();
    return Object.entries(db)
      .filter(([, v]) => v.itemimage_name === "มีรูปภาพ" && v.has_image === false)
      .map(([code]) => code);
  }

  function putMedicationDb(db) {
    // PUT must go through the background service worker so the request carries
    // Origin: chrome-extension://... which the server trusts without auth.
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "putMedicationDb", db }, (resp) => {
          resolve(resp || { ok: false });
        });
      } catch (_) { resolve({ ok: false }); }
    });
  }

  async function markImageDone(code) {
    try {
      const resp = await fetch(`${SERVER_URL}/api/medication-db`);
      if (!resp.ok) return;
      const db = await resp.json();
      if (!db[code]) return;
      db[code].has_image = true;
      await putMedicationDb(db);
    } catch (err) {
      console.warn("[DrugImage] markImageDone failed:", err);
    }
  }

  // ── Automation steps ──────────────────────────────────────────────────────

  async function ensureItemMasterPage() {
    if (isItemMasterPage()) return;
    location.hash = ITEM_MASTER_HASH;
    const ok = await waitFor(() => isItemMasterPage(), 15000, 200);
    if (!ok) throw new Error("Cannot navigate to Item Master page");
    await sleep(500);
  }

  async function searchCode(code) {
    const codeInput = await waitFor(() => {
      const el = document.querySelector("#iCode");
      return el && isVisible(el) ? el : null;
    }, 10000);
    if (!codeInput) throw new Error("#iCode not found");

    await clickLikeUser(codeInput);
    setNativeValue(codeInput, code);
    await sleep(200);

    const searchBtn = await waitFor(() => {
      const el = document.querySelector("#iSearchBtn");
      return el && isVisible(el) && !el.disabled ? el : null;
    }, 5000);
    if (!searchBtn) throw new Error("#iSearchBtn not found");

    await clickLikeUser(searchBtn);
    // Wait for results: #iModifyBtn0 appearing means data loaded
    await waitFor(() => document.querySelector("#iModifyBtn0"), 10000, 200);
  }

  async function openItemDetail() {
    const modifyBtn = await waitFor(() => {
      const el = document.querySelector("#iModifyBtn0");
      return el && isVisible(el) ? el : null;
    }, 8000);
    if (!modifyBtn) return false;

    await clickLikeUser(modifyBtn);
    const ok = await waitFor(() => isItemDetailPage(), 12000, 200);
    if (!ok) throw new Error("Did not navigate to Item Detail page");
    await sleep(600);
    return true;
  }

  function parseDrugCode() {
    const spans = document.querySelectorAll("span.ng-binding");
    for (const span of spans) {
      const text = (span.innerText || span.textContent || "").trim();
      const m = text.match(/^\(([^)]+)\)/);
      if (m) return m[1];
    }
    return null;
  }

  async function enableAddlnDetail() {
    // Two switches share id="addlndetail"; select by ng-model to get the right one.
    const sw = await waitFor(
      () => document.querySelector('md-switch[ng-model="vm.showItemImage"]'),
      10000
    );
    if (!sw) throw new Error('md-switch[ng-model="vm.showItemImage"] not found');

    sw.scrollIntoView({ behavior: "smooth", block: "center" });
    await sleep(300);

    if (sw.getAttribute("aria-checked") === "true") return;

    // jqLite triggerHandler fires Angular Material's registered click handler
    // on the exact #addlndetail element — no other switches are touched.
    if (window.angular) {
      window.angular.element(sw).triggerHandler("click");
    } else {
      sw.click();
    }
    await sleep(300);
  }

  async function downloadImage(fallbackCode) {
    await enableAddlnDetail();

    const drugCode = parseDrugCode() || fallbackCode;
    const filename = `${drugCode}.jpg`;

    await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "setNextDownloadName", filename }, () => resolve());
      } catch (_) { resolve(); }
    });

    const downloadBtn = await waitFor(() => {
      const el = document.querySelector("#downloadFileitemImage");
      return el && isVisible(el) ? el : null;
    }, 6000);

    if (!downloadBtn) return { ok: false, code: drugCode };

    // Single native click only — clickLikeUser fires two clicks (synthetic + el.click())
    // which would trigger two downloads.
    downloadBtn.click();
    await sleep(800);
    pushLog("success", `Downloaded: ${filename}`);
    return { ok: true, code: drugCode };
  }

  async function dismissSecurityDialog() {
    // Arcus shows "back button navigation" info dialog after some navigations.
    const btn = await waitFor(() => {
      for (const dialog of document.querySelectorAll("md-dialog")) {
        if (!isVisible(dialog)) continue;
        const txt = (dialog.innerText || dialog.textContent || "").toLowerCase();
        if (!txt.includes("back button")) continue;
        const ok = dialog.querySelector("md-dialog-actions button");
        if (ok && isVisible(ok)) return ok;
      }
      return null;
    }, 3000, 200);
    if (btn) {
      await clickLikeUser(btn);
      await sleep(300);
    }
  }

  function angularClick(el) {
    // ng-click handlers are registered via jqLite; triggerHandler reaches them
    // instantly without the delays or synthetic-event misses of clickLikeUser.
    if (window.angular) {
      window.angular.element(el).triggerHandler("click");
    } else {
      el.click();
    }
  }

  async function closeDetailPage() {
    const cancelBtn = await waitFor(() => {
      const el = document.querySelector("#itemCancelBtn");
      return el && isVisible(el) ? el : null;
    }, 6000);
    if (!cancelBtn) throw new Error("#itemCancelBtn not found");

    angularClick(cancelBtn);
    await sleep(300);

    // "Are you sure?" — poll at 100 ms and click the moment the button appears
    const confirmBtn = await waitFor(() => {
      const el = document.querySelector("button.md-confirm-button");
      return el ? el : null;          // don't gate on isVisible — click immediately
    }, 6000, 100);
    if (confirmBtn) {
      angularClick(confirmBtn);
      await sleep(300);
    }

    // Security info dialog about back-button navigation — dismiss if it appears
    await dismissSecurityDialog();

    const back = await waitFor(() => isItemMasterPage(), 12000, 200);
    if (!back) throw new Error("Did not return to Item Master after close");
    await sleep(300);
  }

  async function processOne(code, index, total) {
    if (state.stopRequested) return { ok: false, stopped: true };
    setProgress(index, total);
    setStatus(`[${index + 1}/${total}] ${code}`);
    pushLog("info", `Processing: ${code}`);

    try {
      await ensureItemMasterPage();
      await searchCode(code);

      const found = await openItemDetail();
      if (!found) {
        pushLog("info", `No result: ${code}`);
        return { ok: false };
      }

      const dl = await downloadImage(code);
      await closeDetailPage();

      if (dl.ok) {
        await markImageDone(dl.code);
        return { ok: true };
      }
      pushLog("fail", `No download button: ${code}`);
      return { ok: false };

    } catch (err) {
      pushLog("fail", `${code}: ${err.message || err}`);
      try {
        if (isItemDetailPage()) await closeDetailPage();
      } catch (_) {}
      return { ok: false };
    }
  }

  // ── Sync has_image from existing files ───────────────────────────────────

  async function syncHasImage() {
    if (state.running) return;
    state.running = true;
    updateButtons();
    setStatus("Fetching file list and database…");
    pushLog("info", "Sync started");

    try {
      const [fileResp, dbResp] = await Promise.all([
        fetch(`${SERVER_URL}/api/med-images-list`),
        fetch(`${SERVER_URL}/api/medication-db`),
      ]);
      if (!fileResp.ok) throw new Error(`File list error ${fileResp.status}`);
      if (!dbResp.ok)   throw new Error(`DB error ${dbResp.status}`);

      const fileStems = new Set(await fileResp.json());   // filenames without extension
      const db        = await dbResp.json();
      const codes     = Object.keys(db);
      const total     = codes.length;
      let updated     = 0;

      setProgress(0, total);
      setStatus(`Checking ${total} codes against ${fileStems.size} image files…`);

      for (let i = 0; i < codes.length; i++) {
        const code = codes[i];
        if (fileStems.has(code) && !db[code].has_image) {
          db[code].has_image = true;
          updated++;
        }
        // Update progress every 50 items to avoid UI jank
        if (i % 50 === 0 || i === codes.length - 1) {
          setProgress(i + 1, total);
          setStatus(`Checking… ${i + 1}/${total} | matched: ${updated}`);
          await sleep(0);   // yield to UI
        }
      }

      // Write the updated DB back via background (requires extension Origin header)
      setStatus(`Saving ${updated} update(s) to server…`);
      const putResp = await putMedicationDb(db);
      if (!putResp.ok) throw new Error(`Save error ${putResp.status || putResp.error}`);

      setProgress(total, total);
      setStatus(`Done. ${updated} record(s) updated out of ${total}.`);
      pushLog("success", `Sync complete — ${updated} updated`);

    } catch (err) {
      setStatus(`Sync failed: ${err.message}`);
      pushLog("fail", `Sync error: ${err.message}`);
    } finally {
      state.running = false;
      updateButtons();
    }
  }

  // ── Main run loop ─────────────────────────────────────────────────────────

  async function startRun() {
    if (state.running) return;
    if (!isItemMasterPage()) {
      setStatus("Please navigate to the Item Master page first.");
      return;
    }

    state.running = true;
    state.stopRequested = false;
    state.success = 0;
    state.fail = 0;
    updateButtons();
    setStatus("Fetching pending drug codes from server…");
    pushLog("info", "Run started");

    try {
      let codes;
      try {
        codes = await fetchPendingCodes();
      } catch (err) {
        setStatus(`Server error: ${err.message}`);
        pushLog("fail", `Fetch failed: ${err.message}`);
        return;
      }

      if (!codes.length) {
        setStatus("No pending drug images found.");
        pushLog("info", "Nothing to do");
        return;
      }

      setStatus(`Found ${codes.length} pending. Starting…`);
      pushLog("info", `${codes.length} codes to process`);
      setProgress(0, codes.length);

      for (let i = 0; i < codes.length; i++) {
        if (state.stopRequested) break;
        const result = await processOne(codes[i], i, codes.length);
        if (result.stopped) break;
        if (result.ok) state.success++; else state.fail++;
        setProgress(i + 1, codes.length);
        if (!state.stopRequested && i < codes.length - 1) await sleep(200);
      }

      const summary = `Done: ${state.success} OK, ${state.fail} fail`;
      setStatus(state.stopRequested ? `Stopped. ${summary}` : `Completed. ${summary}`);
      pushLog(state.stopRequested ? "info" : "success", summary);

    } finally {
      state.running = false;
      state.stopRequested = false;
      updateButtons();
    }
  }

  // ── Init & URL observer ───────────────────────────────────────────────────

  function initIfNeeded() {
    if (!isRelevantPage() || state.dismissed) {
      removePanel();
      return;
    }
    createPanel();
  }

  window.addEventListener("arcus-toolkit:show-drug-image-panel", () => {
    setPanelDismissed(false);
    initIfNeeded();
  });

  window.addEventListener("arcus-toolkit:remove-drug-image-panel", () => {
    setPanelDismissed(true);
    removePanel();
  });

  restorePanelDismissed(() => initIfNeeded());

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(initIfNeeded, 700);
    } else if (isRelevantPage() && !document.querySelector("#arcus-di-panel") && !state.dismissed) {
      createPanel();
    } else if (!isRelevantPage() && document.querySelector("#arcus-di-panel")) {
      removePanel();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => setTimeout(initIfNeeded, 700));
})();
