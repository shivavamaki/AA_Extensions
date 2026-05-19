"use strict";

// Capture orchestration: fetch XLS via background, parse, and persist.
window.JasperCapture = (() => {
  const { STORAGE_KEY, SUMMARY_KEY, parseRequestPayload } = window.JasperShared;
  const { base64ToArrayBuffer, workbookToRows, normalizeStickerData } = window.JasperParser;

  const VERSION = '0.1.5';

  async function fetchXlsViaBackground(xlsUrl) {
    return chrome.runtime.sendMessage({ type: 'FETCH_JASPER_XLS', url: xlsUrl });
  }

  async function captureXlsFromUrl(xlsUrl, source = 'manual', onStatus = () => {}) {
    const requestPayload = parseRequestPayload(xlsUrl);

    onStatus('1/4 Fetching XLS...');
    const fetchResult = await fetchXlsViaBackground(xlsUrl);
    if (!fetchResult?.ok) {
      throw new Error(fetchResult?.error || 'Background fetch returned no response');
    }

    const contentType = fetchResult.contentType || '';
    const arrayBuffer = base64ToArrayBuffer(fetchResult.base64);

    onStatus('2/4 Parsing workbook...');
    const parsedWorkbook = await workbookToRows(arrayBuffer, contentType);

    onStatus('3/4 Rebuilding sticker data...');
    const stickers = normalizeStickerData(parsedWorkbook, requestPayload);

    const capture = {
      version: VERSION,
      source,
      requestPayload,
      responseInfo: {
        contentType,
        byteLength:  arrayBuffer.byteLength,
        sheetNames:  parsedWorkbook.sheetNames,
      },
      workbook: parsedWorkbook,
      stickers,
    };

    onStatus('4/4 Saving capture...');
    await chrome.storage.local.set({
      [STORAGE_KEY]: capture,
      [SUMMARY_KEY]: {
        capturedAt:   requestPayload.capturedAt,
        reportUnit:   requestPayload.reportUnit,
        stickerCount: stickers.length,
        sheetNames:   parsedWorkbook.sheetNames,
        byteLength:   arrayBuffer.byteLength,
      },
    });

    onStatus('Ready: captured successfully');
    console.log('[Jasper Sticker Rebuilder] capture complete', capture);
    return capture;
  }

  return { captureXlsFromUrl };
})();
