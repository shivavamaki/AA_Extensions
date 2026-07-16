/* ISOLATED-world relay for the MAIN-world XHR tap (arcus-xhr-tap.js).
 * The tap can't call chrome.runtime.sendMessage directly (page context has no
 * extension API access), so it posts { __bkn_sec__: 1, k, v } via
 * window.postMessage. Declared at document_start, same as the tap, so no
 * postMessage fires before this listener is attached — a message dispatched
 * with no listener present is simply lost, not queued.
 */
window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (!d || d.__bkn_sec__ !== 1 || !d.k || !d.v) return;
  try {
    chrome.runtime.sendMessage({ type: "BKN_SEC_HDR_RELAY", k: d.k, v: d.v });
  } catch (_) { /* extension context invalidated — ignore */ }
});
