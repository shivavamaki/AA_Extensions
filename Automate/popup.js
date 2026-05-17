const ARCUS_WORKBENCH_URL =
  "https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/dispense";

const ARCUS_IPFILL_URL =
  "https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/ipfill";

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
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
  });
  return results?.[0]?.result;
}

async function openOrNavigate(url) {
  const [existing] = await chrome.tabs.query({
    url: "https://arcusair.bdms.co.th/*",
    currentWindow: true,
  });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    // Navigate via hash change so Angular's router handles it — avoids the
    // "back button navigation" security alert that fires when Chrome forces a URL change.
    try {
      await executeInTab(existing.id, (targetUrl) => {
        const hashIndex = targetUrl.indexOf("#");
        if (hashIndex !== -1) {
          location.hash = targetUrl.slice(hashIndex + 1);
        } else {
          location.href = targetUrl;
        }
      }, [url]);
    } catch (_) {}
    return existing.id;
  }
  const tab = await chrome.tabs.create({ url });
  return tab.id;
}

// ── Auto Dispense ──────────────────────────────────────────────────────────

document.getElementById("openWorkbench").addEventListener("click", async () => {
  const tabId = await openOrNavigate(ARCUS_WORKBENCH_URL);
  try { await executeInTab(tabId, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:show-panel"))); } catch (_) {}
  window.close();
});

document.getElementById("closeWorkbenchPanel").addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("dispenseStatus", "No active tab found.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("dispenseStatus", "Active tab is not Arcus Air.", "error"); return; }

  try {
    await executeInTab(tab.id, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-panel")));
    setStatus("dispenseStatus", "Automation panel closed.", "done");
  } catch (err) {
    setStatus("dispenseStatus", `Failed: ${err?.message || "unknown error"}`, "error");
  }
});

// ── IP Fill ────────────────────────────────────────────────────────────────

document.getElementById("openIpFill").addEventListener("click", async () => {
  const tabId = await openOrNavigate(ARCUS_IPFILL_URL);
  try { await executeInTab(tabId, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:show-ipfill-panel"))); } catch (_) {}
  window.close();
});

document.getElementById("closeIpFillPanel").addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("ipfillStatus", "No active tab found.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("ipfillStatus", "Active tab is not Arcus Air.", "error"); return; }

  try {
    await executeInTab(tab.id, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-ipfill-panel")));
    setStatus("ipfillStatus", "IP Fill panel closed.", "done");
  } catch (err) {
    setStatus("ipfillStatus", `Failed: ${err?.message || "unknown error"}`, "error");
  }
});
