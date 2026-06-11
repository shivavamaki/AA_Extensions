"use strict";

/**
 * core/messages.js
 * Single source of truth for every chrome.runtime message type.
 */
(function () {
  const _g = typeof globalThis !== "undefined" ? globalThis
           : typeof self       !== "undefined" ? self : window;

  if (_g.CoreMessages) return;

  const MSG = Object.freeze({
    LOAD_MED_TABLE:       "LOAD_MED_TABLE",
    OPEN_STICKER:         "OPEN_STICKER",
    OPEN_PATIENT_STICKER: "OPEN_PATIENT_STICKER",
    OPEN_MED_RECONCILE:   "OPEN_MED_RECONCILE",
    OPEN_ALLERGY_CARD:    "OPEN_ALLERGY_CARD",
    OPEN_MED_JOURNEY:     "OPEN_MED_JOURNEY",
  });

  _g.MSG = MSG;
  _g.CoreMessages = { MSG };
})();
