/* Offscreen driver for the daily auto-report job.
 *
 * The background service worker (no DOM, can't run the BIFF8/HTML XLS parser)
 * creates the offscreen document and posts { type: 'BKN_RUN_AUTO_REPORT', ... }.
 * We reuse the fetch + parse + cache-save functions popup.js defines (loaded in
 * the same page), then reply with a result the worker logs.
 *
 * Currently drives the Stock Picking (RT_COMMON_917) report; the shape is
 * generic so other reports can be added.
 */
"use strict";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'BKN_RUN_AUTO_REPORT') return;

  (async () => {
    try {
      if (msg.report === 'stk917') {
        const { from, to } = msg;   // YYYY-MM-DD
        if (!from || !to) throw new Error('missing from/to dates');
        // These are all defined by popup.js (loaded in this page).
        const bytes  = await fetchReportBytes(buildStk917Url(from, to), 'RT_COMMON_917');
        const sheets = parseXlsBuffer(bytes);
        const rows   = parseStockPickingSheets(sheets);   // also sets stk917Meta
        const meta   = (typeof stk917Meta !== 'undefined' && stk917Meta)
          ? stk917Meta : { from, to, title: 'Stock Picking List' };
        const ok = await saveReportCache('stk917', rows, meta, 'auto');
        sendResponse({ ok, rows: rows.length, saved: ok });
      } else {
        sendResponse({ ok: false, error: 'unknown report: ' + msg.report });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e && e.message || e) });
    }
  })();

  return true;   // async sendResponse
});
