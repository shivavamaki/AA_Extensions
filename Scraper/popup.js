// Arcus Toolkit popup — v3.10.0
// Separated into: Auto Scraper (date range) | Manual Scraper | Dispense | IP Fill

const SCRAPER_STOP_KEY    = "arcusScraperStop";
const ARCUS_WORKBENCH_URL = "https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/dispense";
const ARCUS_IPFILL_URL    = "https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/ipfill";

// ── Tab switching ──────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`)?.classList.add("active");
  });
});

// ── Shared helpers ─────────────────────────────────────────────────────────
function setStatus(id, msg, state = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status${state ? " " + state : ""}`;
}

async function getActiveArcusTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function executeInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return results?.[0]?.result;
}

function downloadJSON(data, prefix = "scrape") {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), {
    href: url,
    download: `${prefix}_${Date.now()}.json`,
  }).click();
  URL.revokeObjectURL(url);
}

// ── Injected functions (execute in content-script world) ───────────────────
function showArcusToolPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:show-panel"));
  return { ok: true };
}

function removeArcusToolPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-panel"));
  return { ok: true };
}

function showArcusIpFillPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:show-ipfill-panel"));
  return { ok: true };
}

function removeArcusIpFillPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-ipfill-panel"));
  return { ok: true };
}

function showArcusScraperPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:show-scraper-panel"));
  return { ok: true };
}

function removeArcusScraperPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-scraper-panel"));
  return { ok: true };
}

function triggerSharedScraper() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:start-scrape"));
  return { ok: true };
}

function requestSharedStop() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:stop-scraper"));
  return { ok: true };
}

function readSharedScraperState() {
  return window.__ARCUS_SHARED_SCRAPER_STATE__ || null;
}

// Called with args from popup — must not reference outer-scope variables
function triggerDateRangeScraper(startDateStr, endDateStr, resume) {
  if (window.ArcusScraper?.runDateRangeScraper) {
    window.ArcusScraper.runDateRangeScraper({
      startDateStr,
      endDateStr,
      pdpa: true,
      resume: !!resume,
    });
    return { ok: true };
  }
  // Scraper module not yet loaded (workbench not open)
  window.dispatchEvent(new CustomEvent("arcus-toolkit:show-scraper-panel"));
  return { ok: false, reason: "Scraper not loaded — open the Arcus workbench first." };
}

// ── Dispense tab ───────────────────────────────────────────────────────────
document.getElementById("openWorkbench")?.addEventListener("click", async () => {
  const [existing] = await chrome.tabs.query({ url: "https://arcusair.bdms.co.th/*", currentWindow: true });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true, url: ARCUS_WORKBENCH_URL });
    try { await executeInTab(existing.id, showArcusToolPanel); } catch (_) {}
  } else {
    await chrome.tabs.create({ url: ARCUS_WORKBENCH_URL });
  }
  window.close();
});

document.getElementById("closeWorkbenchPanel")?.addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("dispenseStatus", "No active Arcus tab.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("dispenseStatus", "Not an Arcus tab.", "error"); return; }
  try {
    const result = await executeInTab(tab.id, removeArcusToolPanel);
    setStatus("dispenseStatus",
      result?.ok ? "Panel closed." : (result?.reason || "Panel not found."),
      result?.ok ? "done" : "error"
    );
  } catch (err) {
    setStatus("dispenseStatus", `Error: ${err?.message || "unknown"}`, "error");
  }
});

// ── IP Fill tab ────────────────────────────────────────────────────────────
document.getElementById("openIpFill")?.addEventListener("click", async () => {
  const [existing] = await chrome.tabs.query({ url: "https://arcusair.bdms.co.th/*", currentWindow: true });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true, url: ARCUS_IPFILL_URL });
    try { await executeInTab(existing.id, showArcusIpFillPanel); } catch (_) {}
  } else {
    await chrome.tabs.create({ url: ARCUS_IPFILL_URL });
  }
  window.close();
});

document.getElementById("closeIpFillPanel")?.addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("ipfillStatus", "No active Arcus tab.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("ipfillStatus", "Not an Arcus tab.", "error"); return; }
  try {
    const result = await executeInTab(tab.id, removeArcusIpFillPanel);
    setStatus("ipfillStatus",
      result?.ok ? "IP Fill panel closed." : (result?.reason || "Panel not found."),
      result?.ok ? "done" : "error"
    );
  } catch (err) {
    setStatus("ipfillStatus", `Error: ${err?.message || "unknown"}`, "error");
  }
});

// ── Auto Scraper (Date Range) ──────────────────────────────────────────────
const autoScraper = {
  get startBtn()  { return document.getElementById("startAutoScraper");  },
  get resumeBtn() { return document.getElementById("resumeAutoScraper"); },
  get stopBtn()   { return document.getElementById("stopAutoScraper");   },
  get fromInput() { return document.getElementById("autoFrom");          },
  get toInput()   { return document.getElementById("autoTo");            },

  setRunning(running) {
    if (this.startBtn)  this.startBtn.disabled  =  running;
    if (this.resumeBtn) this.resumeBtn.disabled =  running;
    if (this.stopBtn)   this.stopBtn.disabled   = !running;
  },

  init() {
    this.startBtn?.addEventListener("click",  () => this.start(false));
    this.resumeBtn?.addEventListener("click", () => this.start(true));
    this.stopBtn?.addEventListener("click",   () => this.stop());
  },

  async start(resume) {
    const tab = await getActiveArcusTab();
    if (!tab) {
      setStatus("autoScraperStatus", "No active Arcus tab found.", "error");
      return;
    }
    if (!tab.url?.includes("arcusair.bdms.co.th")) {
      setStatus("autoScraperStatus", "Active tab is not Arcus Air.", "error");
      return;
    }

    const startDate = this.fromInput?.value?.trim() || "";
    const endDate   = this.toInput?.value?.trim()   || "";
    if (!startDate || !endDate) {
      setStatus("autoScraperStatus", "Please enter both From and To dates (DD-MM-YYYY).", "error");
      return;
    }

    this.setRunning(true);
    setStatus(
      "autoScraperStatus",
      resume ? `Resuming: ${startDate} → ${endDate}` : `Starting: ${startDate} → ${endDate}`,
      "running"
    );

    try {
      await chrome.storage.local.set({ [SCRAPER_STOP_KEY]: false });
      await executeInTab(tab.id, showArcusToolPanel);

      const result = await executeInTab(tab.id, triggerDateRangeScraper, [startDate, endDate, resume]);

      if (result?.ok) {
        setStatus(
          "autoScraperStatus",
          `Running: ${startDate} → ${endDate}\nLive progress shown in the page panel.\nClick Stop to pause and resume later.`,
          "running"
        );
      } else {
        setStatus("autoScraperStatus", result?.reason || "Failed to start scraper.", "error");
        this.setRunning(false);
      }
    } catch (err) {
      setStatus("autoScraperStatus", `Error: ${err?.message || "unknown"}`, "error");
      this.setRunning(false);
    }
  },

  async stop() {
    const tab = await getActiveArcusTab();
    if (tab) {
      await chrome.storage.local.set({ [SCRAPER_STOP_KEY]: true });
      try { await executeInTab(tab.id, requestSharedStop); } catch (_) {}
    }
    this.setRunning(false);
    setStatus("autoScraperStatus", "Stop requested — will finish current date then pause.\nUse Resume to continue.", "paused");
  },
};

// ── Manual Scraper ─────────────────────────────────────────────────────────
const manualScraper = {
  runBtn:  document.getElementById("runScraper"),
  stopBtn: document.getElementById("stopScraper"),

  init() {
    chrome.storage.local.set({ [SCRAPER_STOP_KEY]: false });
    this.runBtn?.addEventListener("click",  () => this.start());
    this.stopBtn?.addEventListener("click", () => this.stop());
  },

  setRunning(running) {
    if (this.runBtn)  this.runBtn.disabled  =  running;
    if (this.stopBtn) this.stopBtn.disabled = !running;
  },

  async start() {
    const tab = await getActiveArcusTab();
    if (!tab) {
      setStatus("scraperStatus", "No active tab found.", "error");
      return;
    }
    if (!tab.url?.includes("arcusair.bdms.co.th")) {
      setStatus("scraperStatus", "Active tab is not Arcus Air.", "error");
      return;
    }

    await chrome.storage.local.set({ [SCRAPER_STOP_KEY]: false });
    this.setRunning(true);
    setStatus("scraperStatus", "Starting scraper…", "running");

    try {
      await executeInTab(tab.id, showArcusToolPanel);

      const result = await executeInTab(tab.id, triggerSharedScraper);
      if (!result?.ok) {
        setStatus("scraperStatus", result?.reason || "Failed to start scraper.", "error");
        this.setRunning(false);
        return;
      }

      setStatus("scraperStatus", "Scraper started. Waiting for result…", "running");

      const final = await this.pollForResult(tab.id);
      if (final?.ok && Array.isArray(final.data)) {
        downloadJSON(final.data, "arcus_workbench");
        setStatus("scraperStatus", `Done — ${final.data.length} rows saved.`, "done");
      } else if (final?.stopped) {
        setStatus("scraperStatus", "Stopped by user.", "paused");
      } else {
        setStatus("scraperStatus", final?.reason || "Finished with no result.", "error");
      }
    } catch (err) {
      setStatus("scraperStatus", `Error: ${err?.message || "unknown"}`, "error");
    } finally {
      this.setRunning(false);
    }
  },

  async pollForResult(tabId) {
    const startedAt  = Date.now();
    const timeoutMs  = 5 * 60 * 1000; // 5 min max for manual scrape

    while (Date.now() - startedAt < timeoutMs) {
      const result = await executeInTab(tabId, readSharedScraperState);

      if (!result) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      if (result.state === "running") {
        setStatus("scraperStatus", `Running… ${result.progressText || ""}`.trim(), "running");
      }
      if (result.state === "done")    return { ok: true, data: result.data || [] };
      if (result.state === "stopped") return { stopped: true };
      if (result.state === "error")   return { ok: false, reason: result.reason };

      await new Promise((r) => setTimeout(r, 1000));
    }

    return { ok: false, reason: "Timeout (5 min). Check the page panel." };
  },

  async stop() {
    const tab = await getActiveArcusTab();
    if (!tab) {
      setStatus("scraperStatus", "No active tab.", "error");
      return;
    }
    await chrome.storage.local.set({ [SCRAPER_STOP_KEY]: true });
    await executeInTab(tab.id, requestSharedStop);
    if (this.stopBtn) this.stopBtn.disabled = true;
    setStatus("scraperStatus", "Stopping…", "paused");
  },
};

// ── Scraper panel show/hide ────────────────────────────────────────────────
document.getElementById("showScraperPanel")?.addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("scraperPanelStatus", "No active Arcus tab.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("scraperPanelStatus", "Not an Arcus tab.", "error"); return; }
  try {
    await executeInTab(tab.id, showArcusScraperPanel);
    setStatus("scraperPanelStatus", "Panel shown.", "done");
  } catch (err) {
    setStatus("scraperPanelStatus", `Error: ${err?.message || "unknown"}`, "error");
  }
});

document.getElementById("hideScraperPanel")?.addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("scraperPanelStatus", "No active Arcus tab.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("scraperPanelStatus", "Not an Arcus tab.", "error"); return; }
  try {
    await executeInTab(tab.id, removeArcusScraperPanel);
    setStatus("scraperPanelStatus", "Panel hidden.", "done");
  } catch (err) {
    setStatus("scraperPanelStatus", `Error: ${err?.message || "unknown"}`, "error");
  }
});

// ── Initialise both scrapers ───────────────────────────────────────────────
autoScraper.init();
manualScraper.init();

// ── On popup open: reflect running state if scraper is already active ──────
(async () => {
  const tab = await getActiveArcusTab().catch(() => null);
  if (!tab?.url?.includes("arcusair.bdms.co.th")) return;

  try {
    const scraperState = await executeInTab(tab.id, readSharedScraperState);
    if (scraperState?.state !== "running") return;

    const progress = scraperState.progressText || "";

    // Mark both sections as running so Stop is available
    autoScraper.setRunning(true);
    setStatus(
      "autoScraperStatus",
      `Already running…\n${progress}`.trim(),
      "running"
    );

    manualScraper.setRunning(true);
    setStatus(
      "scraperStatus",
      `Scraper running… ${progress}`.trim(),
      "running"
    );
  } catch (_) {}
})();
