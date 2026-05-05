const SCRAPER_STOP_KEY = "arcusScraperStop";

const ARCUS_WORKBENCH_URL =
  "https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/dispense";

const ARCUS_IPFILL_URL =
  "https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/ipfill";

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

function setStatus(id, msg, state = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = `status${state ? " " + state : ""}`;
}

function downloadJSON(data, filenamePrefix = "scrape") {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), {
    href: url,
    download: `${filenamePrefix}_${Date.now()}.json`,
  }).click();
  URL.revokeObjectURL(url);
}

async function getActiveArcusTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab || null;
}

async function executeInTab(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return results?.[0]?.result;
}

document.getElementById("openWorkbench").addEventListener("click", async () => {
  const [existing] = await chrome.tabs.query({
    url: "https://arcusair.bdms.co.th/*",
    currentWindow: true,
  });

  if (existing) {
    await chrome.tabs.update(existing.id, {
      active: true,
      url: ARCUS_WORKBENCH_URL,
    });
    try {
      await executeInTab(existing.id, showArcusToolPanel);
    } catch (_) {}
  } else {
    await chrome.tabs.create({ url: ARCUS_WORKBENCH_URL });
  }

  window.close();
});

document.getElementById("closeWorkbenchPanel").addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) {
    setStatus("dispenseStatus", "No active Arcus tab found.", "error");
    return;
  }

  if (!tab.url?.includes("arcusair.bdms.co.th")) {
    setStatus("dispenseStatus", "Active tab is not Arcus Air.", "error");
    return;
  }

  try {
    const result = await executeInTab(tab.id, removeArcusToolPanel);
    if (result?.ok) {
      setStatus("dispenseStatus", "Arcus Auto Tool v2 closed.", "done");
    } else {
      setStatus("dispenseStatus", result?.reason || "Tool panel not found.", "error");
    }
  } catch (error) {
    setStatus("dispenseStatus", `Close failed: ${error?.message || "unknown error"}`, "error");
  }
});

function removeArcusToolPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-panel"));
  return { ok: true };
}

function showArcusToolPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:show-panel"));
  return { ok: true };
}



document.getElementById("openIpFill")?.addEventListener("click", async () => {
  const [existing] = await chrome.tabs.query({
    url: "https://arcusair.bdms.co.th/*",
    currentWindow: true,
  });

  if (existing) {
    await chrome.tabs.update(existing.id, {
      active: true,
      url: ARCUS_IPFILL_URL,
    });
    try {
      await executeInTab(existing.id, showArcusIpFillPanel);
    } catch (_) {}
  } else {
    await chrome.tabs.create({ url: ARCUS_IPFILL_URL });
  }

  window.close();
});

document.getElementById("closeIpFillPanel")?.addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) {
    setStatus("ipfillStatus", "No active Arcus tab found.", "error");
    return;
  }

  if (!tab.url?.includes("arcusair.bdms.co.th")) {
    setStatus("ipfillStatus", "Active tab is not Arcus Air.", "error");
    return;
  }

  try {
    const result = await executeInTab(tab.id, removeArcusIpFillPanel);
    if (result?.ok) {
      setStatus("ipfillStatus", "Arcus IP Fill Tool closed.", "done");
    } else {
      setStatus("ipfillStatus", result?.reason || "IP Fill panel not found.", "error");
    }
  } catch (error) {
    setStatus("ipfillStatus", `Close failed: ${error?.message || "unknown error"}`, "error");
  }
});

function removeArcusIpFillPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-ipfill-panel"));
  return { ok: true };
}

function showArcusIpFillPanel() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:show-ipfill-panel"));
  return { ok: true };
}

const scraper = {
  runBtn: document.getElementById("runScraper"),
  stopBtn: document.getElementById("stopScraper"),

  init() {
    chrome.storage.local.set({ [SCRAPER_STOP_KEY]: false });
    this.runBtn.addEventListener("click", () => this.start());
    this.stopBtn.addEventListener("click", () => this.stop());
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
    this.runBtn.disabled = true;
    this.stopBtn.disabled = false;
    setStatus("scraperStatus", "Starting shared scraper…", "running");

    try {
      await executeInTab(tab.id, showArcusToolPanel);

      const result = await executeInTab(tab.id, triggerSharedScraper);
      if (!result?.ok) {
        setStatus(
          "scraperStatus",
          result?.reason || "Failed to start shared scraper.",
          "error"
        );
        this.runBtn.disabled = false;
        this.stopBtn.disabled = true;
        return;
      }

      setStatus(
        "scraperStatus",
        "Shared scraper started in page panel. Waiting for result…",
        "running"
      );

      const finalResult = await this.pollForScrapeResult(tab.id);

      if (finalResult?.ok && Array.isArray(finalResult.data)) {
        downloadJSON(finalResult.data, "arcus_workbench");
        setStatus(
          "scraperStatus",
          `Done — ${finalResult.data.length} rows saved.`,
          "done"
        );
      } else if (finalResult?.stopped) {
        setStatus("scraperStatus", "Scraper stopped.", "paused");
      } else {
        setStatus(
          "scraperStatus",
          finalResult?.reason || "Scraper finished with no result.",
          "error"
        );
      }
    } catch (error) {
      setStatus(
        "scraperStatus",
        `Scraper error: ${error?.message || "unknown error"}`,
        "error"
      );
    } finally {
      this.runBtn.disabled = false;
      this.stopBtn.disabled = true;
    }
  },

  async pollForScrapeResult(tabId) {
    const startedAt = Date.now();
    const timeoutMs = 5 * 60 * 1000;

    while (Date.now() - startedAt < timeoutMs) {
      const result = await executeInTab(tabId, readSharedScraperState);

      if (!result) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }

      if (result.state === "running") {
        setStatus(
          "scraperStatus",
          `Running… ${result.progressText || ""}`.trim(),
          "running"
        );
      }

      if (result.state === "done") {
        return { ok: true, data: result.data || [] };
      }

      if (result.state === "stopped") {
        return { stopped: true };
      }

      if (result.state === "error") {
        return { ok: false, reason: result.reason || "Shared scraper error" };
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    return { ok: false, reason: "Timeout waiting for shared scraper result." };
  },

  async stop() {
    const tab = await getActiveArcusTab();
    if (!tab) {
      setStatus("scraperStatus", "No active tab found.", "error");
      return;
    }

    await chrome.storage.local.set({ [SCRAPER_STOP_KEY]: true });
    await executeInTab(tab.id, requestSharedStop);

    this.stopBtn.disabled = true;
    setStatus("scraperStatus", "Stopping…", "paused");
  },
};

scraper.init();

function triggerSharedScraper() {
  window.dispatchEvent(new CustomEvent("arcus-toolkit:start-scrape"));
  return { ok: true };
}

function requestSharedStop() {
  // Stop scraper only — automation has its own stop button in the page panel
  window.dispatchEvent(new CustomEvent("arcus-toolkit:stop-scraper"));
  return { ok: true };
}

function readSharedScraperState() {
  return window.__ARCUS_SHARED_SCRAPER_STATE__ || null;
}