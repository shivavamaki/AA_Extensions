/* ISOLATED-world capture persister (runs in the ArcusAir content-script bundle,
 * where window.BKNData is available).
 *
 * The MAIN-world XHR tap (arcus-xhr-tap.js) captures ArcusAir parameters that
 * only appear in the page's own API traffic — e.g. the medreconcileuid, the
 * med-reconcile snapshot, and the current incus-token. Those live only in the
 * page's volatile memory, so a different workstation (or the same PC after a
 * reload) can't see them.
 *
 * This listener receives the tap's postMessage and writes the capture to the
 * PHARMACY SERVER via BKNData.saveCapture(), keyed by patientuid + visituid.
 * The server merges non-empty fields and enforces a 24h TTL, so:
 *   • one capture on any PC serves every PC, and
 *   • the same data is never re-snapshotted repeatedly.
 *
 * This replaces the old per-browser chrome.storage.local store. Generic by
 * design — future features can post the same message shape to persist their own
 * captured parameters into the shared per-visit bag.
 */
"use strict";

(function () {
  if (window.__bkn_capture_persist__) return;
  window.__bkn_capture_persist__ = true;

  // Coalesce rapid duplicate captures (the tap can fire request- and
  // response-path captures for the same visit within a few ms) so we don't
  // hammer the server with identical writes.
  const _lastSent = new Map();   // "puid|vid" → JSON of last payload
  const _debounce = new Map();   // "puid|vid" → timer

  function _persist(puid, vid, payload) {
    if (!window.BKNData || !window.BKNData.saveCapture) return;
    if (!puid || !vid) return;
    const mapKey = `${puid}|${vid}`;
    const sig = JSON.stringify(payload);
    if (_lastSent.get(mapKey) === sig) return;   // identical to last write — skip

    clearTimeout(_debounce.get(mapKey));
    _debounce.set(mapKey, setTimeout(async () => {
      try {
        const ok = await window.BKNData.saveCapture(puid, vid, payload);
        if (ok) _lastSent.set(mapKey, sig);
      } catch (_) { /* best-effort */ }
    }, 300));
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__bkn_medrecon__ !== 1 || !d.vid) return;

    const puid = d.puid || "";
    const vid  = d.vid;
    // Only send the fields that are actually present, so an empty field never
    // clobbers a value another capture (or another PC) already stored — the
    // server merges non-empty fields only.
    const payload = {};
    if (d.uid)      payload.medreconcileuid     = d.uid;
    if (d.snapshot) payload.medreconcileSnapshot = d.snapshot;
    if (d.token)    payload.incusToken          = d.token;
    if (!Object.keys(payload).length) return;

    _persist(puid, vid, payload);
  });
})();
