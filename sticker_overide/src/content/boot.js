"use strict";

// Entry point: link scanning, auto-capture, and MutationObserver.
(() => {
  if (window.__JR_BOOT_LOADED__) return;
  window.__JR_BOOT_LOADED__ = true;

  const { makeExcelUrl }                         = window.JasperShared;
  const { captureXlsFromUrl }                    = window.JasperCapture;
  const { updateDetection, getDetectedUrl, injectCaptureButton } = window.JasperPanel;

  let _autoCaptureStarted = false;

  /* ── Scan page for Jasper XLS links ──────────────────────────── */

  function _scanAttributes() {
    for (const node of document.querySelectorAll('*')) {
      for (const attr of [...(node.attributes || [])]) {
        if (!attr.value?.includes('/jasperserver/flow.html')) continue;
        const url = makeExcelUrl(attr.value);
        if (url) return url;
      }
    }
    return '';
  }

  function scanLinks() {
    let found = '';

    for (const a of document.querySelectorAll('a[href]')) {
      const xlsUrl = makeExcelUrl(a.href);
      if (!xlsUrl) continue;
      if (!found) found = xlsUrl;
      injectCaptureButton(a, xlsUrl);
    }

    // Fallback: Angular may stash Jasper URLs in non-href attributes.
    if (!found) found = _scanAttributes();

    updateDetection(found);
    if (found && found !== getDetectedUrl()) {
      console.log('[Jasper Sticker Rebuilder] detected XLS URL', found);
    }
  }

  /* ── Auto-capture when the current page IS the Jasper report ─── */

  async function autoCaptureFromCurrentUrl() {
    if (_autoCaptureStarted) return;
    const xlsUrl = makeExcelUrl(location.href);
    if (!xlsUrl) return;
    _autoCaptureStarted = true;
    try {
      await captureXlsFromUrl(xlsUrl, 'auto-from-current-url');
      chrome.runtime.sendMessage({ type: 'OPEN_STICKER_RENDERER' });
    } catch (err) {
      console.warn('[Jasper Sticker Rebuilder] auto capture failed', err);
    }
  }

  /* ── Init ─────────────────────────────────────────────────────── */

  scanLinks();
  autoCaptureFromCurrentUrl();

  const observer = new MutationObserver(scanLinks);
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
