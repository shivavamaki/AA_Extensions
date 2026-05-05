"use strict";

/**
 * core/tabManager.js
 * ─────────────────────────────────────────────────────────────────
 * Tab registry + open-or-reuse logic extracted from background.js.
 *
 * Fixes carried forward:
 *  • opening[key] is reset to false on BOTH the success path AND the
 *    error path inside createNewTab() — previously it was only reset
 *    after a successful send, so a tab-create error left the flag
 *    permanently stuck as true.
 *  • tabRegistry is cleaned up on chrome.tabs.onRemoved.
 * ─────────────────────────────────────────────────────────────────
 */

/** @type {Record<string, number|null>}  tabId per feature key */
const tabRegistry = {
  sheet:          null,
  sticker:        null,
  patientSticker: null,
};

/** Debounce guards — prevent double-opens while a tab is loading */
const opening = {
  sheet:          false,
  sticker:        false,
  patientSticker: false,
};

/* ─────────────────────────────────────────────
 * INTERNAL: send a message to a tab, suppress
 * "no receiver" errors that fire before the
 * content script / page script has registered.
 * ───────────────────────────────────────────── */
function _safeSend(tabId, payload, onDone) {
  chrome.tabs.sendMessage(tabId, payload, () => {
    void chrome.runtime.lastError; // suppress unchecked-error warning
    if (onDone) onDone();
  });
}

/* ─────────────────────────────────────────────
 * PUBLIC: open or reuse a tab for a feature key.
 *
 * @param {string} key         – tabRegistry key ("sheet" | "sticker" | "patientSticker")
 * @param {string} relativeUrl – extension-relative HTML path, e.g. "sheet.html"
 * @param {object} payload     – full message object to forward to the page
 * ───────────────────────────────────────────── */
function openOrReuseTab(key, relativeUrl, payload) {
  const currentId = tabRegistry[key];
  const fullUrl   = chrome.runtime.getURL(relativeUrl);

  function resetGuard() {
    opening[key] = false;
  }

  function sendToTab(tabId) {
    _safeSend(tabId, payload, resetGuard);
  }

  function createNewTab() {
    chrome.tabs.create({ url: fullUrl, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        // FIX: reset guard on error so future clicks are not permanently blocked
        console.error("[tabManager] Failed to create tab:", chrome.runtime.lastError?.message);
        resetGuard();
        return;
      }

      tabRegistry[key] = tab.id;

      const onUpdated = (tabId, info) => {
        if (tabId !== tab.id || info.status !== "complete") return;
        chrome.tabs.onUpdated.removeListener(onUpdated);
        sendToTab(tab.id);
      };

      chrome.tabs.onUpdated.addListener(onUpdated);
    });
  }

  if (currentId !== null) {
    chrome.tabs.get(currentId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        // Tab was closed externally; clear stale reference and open fresh
        tabRegistry[key] = null;
        createNewTab();
      } else {
        chrome.tabs.update(currentId, { active: true });
        sendToTab(currentId);
      }
    });
  } else {
    createNewTab();
  }
}

/* ─────────────────────────────────────────────
 * Clean up registry when any tab is closed.
 * ───────────────────────────────────────────── */
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of Object.keys(tabRegistry)) {
    if (tabRegistry[key] === tabId) {
      tabRegistry[key] = null;
    }
  }
});

/* ─────────────────────────────────────────────
 * PUBLIC: check + set the debounce guard.
 * Returns true when the lock was acquired (caller may proceed).
 * Returns false when already opening (caller should bail).
 * ───────────────────────────────────────────── */
function acquireOpenLock(key) {
  if (opening[key]) return false;
  opening[key] = true;
  return true;
}
// tabManager runs only in the service worker — no window/module export needed.
// openOrReuseTab and acquireOpenLock are plain globals in the SW scope.
