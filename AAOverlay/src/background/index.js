// src/background/index.js
// Single-file MV3 service worker — no importScripts, no ES modules.
"use strict";

/* ── Messages ─────────────────────────────────────────────────── */
const MSG = Object.freeze({
  LOAD_MED_TABLE:       "LOAD_MED_TABLE",
  OPEN_STICKER:         "OPEN_STICKER",
  OPEN_PATIENT_STICKER: "OPEN_PATIENT_STICKER",
  OPEN_MED_RECONCILE:   "OPEN_MED_RECONCILE",
  OPEN_ALLERGY_CARD:    "OPEN_ALLERGY_CARD",
});

/* ── Tab registry ─────────────────────────────────────────────── */
const tabRegistry = {
  sheet:          null,
  sticker:        null,
  patientSticker: null,
  medReconcile:   null,
  allergyCard:    null,
};

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const key of Object.keys(tabRegistry)) {
    if (tabRegistry[key] === tabId) tabRegistry[key] = null;
  }
});

/* ── Open or reuse tab, always send fresh payload ─────────────── */
function openOrReuseTab(key, relativeUrl, payload) {
  const fullUrl    = chrome.runtime.getURL(relativeUrl);
  const storageKey = "payload_" + key;

  // Always persist payload FIRST so the page can read it on DOMContentLoaded
  // even if sendMessage would arrive before the listener is registered.
  chrome.storage.session.set({ [storageKey]: payload });

  function sendPayload(tabId) {
    chrome.tabs.sendMessage(tabId, payload, () => void chrome.runtime.lastError);
  }

  function createNewTab() {
    chrome.tabs.create({ url: fullUrl, active: true }, (tab) => {
      if (chrome.runtime.lastError || !tab) return;
      tabRegistry[key] = tab.id;
      // Page will read from session storage on DOMContentLoaded — no race condition
    });
  }

  const currentId = tabRegistry[key];
  if (currentId !== null) {
    chrome.tabs.get(currentId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        tabRegistry[key] = null;
        createNewTab();
      } else {
        // Tab already open — focus and send live message
        chrome.tabs.update(currentId, { active: true });
        sendPayload(currentId);
      }
    });
  } else {
    createNewTab();
  }
}

/* ── Router ───────────────────────────────────────────────────── */
const ROUTE_MAP = {
  [MSG.LOAD_MED_TABLE]:       { key: "sheet",         url: "src/features/home-med/page-home-med.html"               },
  [MSG.OPEN_STICKER]:         { key: "sticker",        url: "src/features/med-sticker/page-med-sticker.html"         },
  [MSG.OPEN_PATIENT_STICKER]: { key: "patientSticker", url: "src/features/patient-sticker/page-patient-sticker.html" },
  [MSG.OPEN_MED_RECONCILE]:   { key: "medReconcile",   url: "src/features/patient-sticker/page-med-reconcile.html"    },
  [MSG.OPEN_ALLERGY_CARD]:    { key: "allergyCard",    url: "src/features/patient-sticker/page-allergy-card.html"     },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg?.type) return false;
  const route = ROUTE_MAP[msg.type];
  if (!route) return false;
  openOrReuseTab(route.key, route.url, msg);
  sendResponse({ ok: true });
  return true;
});
