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

const ARCUS_TRANSLATION_URL =
  "https://arcusair.bdms.co.th/#!/ordermanagement/translation";

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

document.getElementById("openTranslation")?.addEventListener("click", async () => {
  const tabId = await openOrNavigate(ARCUS_TRANSLATION_URL);

  // Show the panel by calling into the content script. If the content script is
  // not present (the page was open before the extension was loaded/reloaded, so
  // it holds a stale context), the event goes nowhere — so verify, and inject
  // on demand rather than silently doing nothing.
  let shown = false;
  let lastResult = null;
  for (let attempt = 1; attempt <= 3 && !shown; attempt++) {
    try {
      const result = await executeInTab(tabId, () => {
        // Clear the dismissed flag in storage as well as in memory. The content
        // script restores it asynchronously at load, so a stale stored `true`
        // can clobber the in-memory false and silently suppress the panel.
        try { chrome.storage?.local?.set({ arcusTranslationPanelDismissed: false }); } catch (_) {}

        window.dispatchEvent(new CustomEvent("arcus-toolkit:show-translation-panel"));

        const store = window.ArcusStore && window.ArcusStore.translation;
        return {
          loaded: !!window.__ARCUS_TRANSLATION_LOADED__,
          panel: !!document.querySelector("#arcus-tr-panel"),
          href: location.href,
          // Diagnostics, surfaced in the popup when the panel does not appear.
          dismissed: store ? !!store.state.dismissed : null,
          driver: !!window.ArcusDriver,
          api: !!window.ArcusApi,
          onTranslationRoute: location.href.indexOf("!/ordermanagement/translation") !== -1,
        };
      });

      lastResult = result || lastResult;
      if (result && result.panel) { shown = true; break; }

      if (result && !result.loaded) {
        // Content script missing: inject the whole chain in manifest order.
        await chrome.scripting.insertCSS({ target: { tabId }, files: ["styles.css"] }).catch(() => {});
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [
            "content/api-client.js",
            "content/driver.js",
            "content/shared.js",
            "content/translation.js",
          ],
        });
      }
    } catch (err) {
      setStatus("translationStatus", `Failed: ${err?.message || "unknown error"}`, "error");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (!shown) {
    // Say what is actually wrong rather than a generic failure.
    let why = "Reload the Arcus tab (F5), then try again.";
    if (lastResult) {
      // Only claim a wrong-route problem when we actually observed the route.
      // Treating an absent field as "off route" produces a misleading message
      // telling the user to navigate to the page they are already on.
      if (lastResult.onTranslationRoute === false) {
        why = `Tab is on ${lastResult.href || "another page"}. Navigate to Order Management > Translation.`;
      } else if (lastResult.loaded === false) {
        why = "Content script did not load. Reload the Arcus tab (F5).";
      } else if (lastResult.dismissed === true) {
        why = "Panel is marked dismissed. Reload the Arcus tab (F5).";
      } else if (lastResult.driver === false || lastResult.api === false) {
        why = `Missing dependency (driver:${lastResult.driver} api:${lastResult.api}). Reload the Arcus tab.`;
      }
    }
    setStatus("translationStatus", `Could not open the panel. ${why}`, "error");
    return;
  }

  window.close();
});

document.getElementById("closeTranslationPanel")?.addEventListener("click", async () => {
  const tab = await getActiveArcusTab();
  if (!tab) { setStatus("translationStatus", "No active tab found.", "error"); return; }
  if (!tab.url?.includes("arcusair.bdms.co.th")) { setStatus("translationStatus", "Active tab is not Arcus Air.", "error"); return; }

  try {
    await executeInTab(tab.id, () => window.dispatchEvent(new CustomEvent("arcus-toolkit:remove-translation-panel")));
    setStatus("translationStatus", "HIS Translations panel closed.", "done");
  } catch (err) {
    setStatus("translationStatus", `Failed: ${err?.message || "unknown error"}`, "error");
  }
});

// Read the version from the manifest so the header cannot drift out of sync
// with the actual build.
try {
  const el = document.getElementById("headerVersion");
  if (el) el.textContent = "v" + chrome.runtime.getManifest().version;
} catch (_) {}
