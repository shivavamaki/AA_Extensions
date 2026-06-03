const ARCUS_ITEM_MASTER_URL =
  "https://arcusair.bdms.co.th/#!/inventories/itemmaster";

const ARCUS_WORKBENCH_URL =
  "https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/dispense";

const ARCUS_IPFILL_URL =
  "https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/ipfill";

const ARCUS_FREQUENCY_MASTER_URL =
  "https://arcusair.bdms.co.th/#!/ordermanagement/frequencymaster";

const ARCUS_ORDER_ITEM_URL =
  "https://arcusair.bdms.co.th/#!/ordermanagement/orderitem";

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

// ── Drug Image Downloader ──────────────────────────────────────────────────

document.getElementById("openDrugImage").addEventListener("click", async () => {
  const tabId = await openOrNavigate(ARCUS_ITEM_MASTER_URL);
  try { await executeInTab(tabId, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:show-drug-image-panel"))); } catch (_) {}
  window.close();
});

document.getElementById("closeDrugImagePanel").addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("drugImageStatus", "No active tab found.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("drugImageStatus", "Active tab is not Arcus Air.", "error"); return; }

  try {
    await executeInTab(tab.id, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-drug-image-panel")));
    setStatus("drugImageStatus", "Drug Image panel closed.", "done");
  } catch (err) {
    setStatus("drugImageStatus", `Failed: ${err?.message || "unknown error"}`, "error");
  }
});

// Frequency Master Scraper

document.getElementById("openFrequencyMaster")?.addEventListener("click", async () => {
  const tabId = await openOrNavigate(ARCUS_FREQUENCY_MASTER_URL);
  try { await executeInTab(tabId, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:show-frequency-panel"))); } catch (_) {}
  window.close();
});

document.getElementById("closeFrequencyPanel")?.addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("frequencyStatus", "No active tab found.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("frequencyStatus", "Active tab is not Arcus Air.", "error"); return; }

  try {
    await executeInTab(tab.id, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-frequency-panel")));
    setStatus("frequencyStatus", "Frequency scraper panel closed.", "done");
  } catch (err) {
    setStatus("frequencyStatus", `Failed: ${err?.message || "unknown error"}`, "error");
  }
});

// Order Item Instruction Scraper

document.getElementById("openOrderItem")?.addEventListener("click", async () => {
  const tabId = await openOrNavigate(ARCUS_ORDER_ITEM_URL);
  try { await executeInTab(tabId, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:show-order-item-panel"))); } catch (_) {}
  window.close();
});

document.getElementById("closeOrderItemPanel")?.addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("orderItemStatus", "No active tab found.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("orderItemStatus", "Active tab is not Arcus Air.", "error"); return; }

  try {
    await executeInTab(tab.id, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-order-item-panel")));
    setStatus("orderItemStatus", "Order Item scraper panel closed.", "done");
  } catch (err) {
    setStatus("orderItemStatus", `Failed: ${err?.message || "unknown error"}`, "error");
  }
});
