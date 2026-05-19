"use strict";

// Floating capture panel and inline anchor button injection.
window.JasperPanel = (() => {
  const { captureXlsFromUrl } = window.JasperCapture;

  let _detectedUrl    = '';
  let _panelCreated   = false;
  let _captureRunning = false;

  /* ── Internal panel element helpers ──────────────────────────── */

  function _panel()  { return document.getElementById('jr-floating-panel'); }
  function _status() { return _panel()?.querySelector('[data-jr-role="status"]'); }
  function _btn()    { return _panel()?.querySelector('[data-jr-role="capture"]'); }

  function _pageLabel() {
    if (location.hostname === 'arcusair.bdms.co.th')  return 'Arcus dispenseworkbench';
    if (location.hostname.includes('aa-report'))       return 'Jasper report page';
    return location.hostname;
  }

  /* ── Panel visibility ─────────────────────────────────────────── */

  function _refreshPanel(statusText, btnText) {
    const p = _panel();
    if (!p) return;
    const hasUrl = Boolean(_detectedUrl);
    p.style.display       = hasUrl ? 'block' : 'none';
    _status().textContent = statusText || (hasUrl
      ? 'Ready: Jasper ipdsticker link detected'
      : 'No Jasper ipdsticker link detected');
    _btn().textContent    = btnText || 'Capture + Rebuild Sticker';
    _btn().disabled       = !hasUrl || _captureRunning;
    _btn().style.opacity  = (!hasUrl || _captureRunning) ? '0.6' : '1';
  }

  /* ── Panel creation ───────────────────────────────────────────── */

  function _ensurePanel() {
    if (_panelCreated || _panel()) return;
    _panelCreated = true;

    const p = document.createElement('div');
    p.id = 'jr-floating-panel';
    p.style.cssText = [
      'position:fixed', 'right:16px', 'bottom:16px', 'z-index:2147483647',
      'width:260px', 'box-sizing:border-box', 'padding:12px',
      'border:1px solid #15803d', 'border-radius:14px',
      'background:#f0fdf4', 'color:#14532d',
      'box-shadow:0 10px 30px rgba(0,0,0,.22)',
      'font-family:Arial,Tahoma,sans-serif', 'font-size:12px', 'display:none',
    ].join(';');

    p.innerHTML = `
      <div style="font-weight:700;margin-bottom:4px;">Jasper Sticker Rebuilder</div>
      <div style="font-size:11px;margin-bottom:8px;opacity:.85;">${_pageLabel()}</div>
      <button data-jr-role="capture" type="button" disabled style="
        width:100%;padding:8px 10px;border:0;border-radius:10px;
        background:#16a34a;color:#fff;font-weight:700;cursor:pointer;">
        Capture + Rebuild Sticker
      </button>
      <div data-jr-role="status" style="margin-top:8px;font-size:11px;line-height:1.35;">
        Waiting for Jasper ipdsticker link on this page
      </div>
    `;

    p.querySelector('[data-jr-role="capture"]').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      _runCapture('floating-button');
    });

    document.documentElement.appendChild(p);
  }

  /* ── Capture runner ───────────────────────────────────────────── */

  async function _runCapture(source) {
    if (!_detectedUrl || _captureRunning) return;
    _captureRunning = true;
    _refreshPanel('Starting capture...', '1/4 Fetching XLS...');
    try {
      await captureXlsFromUrl(_detectedUrl, source, (status) => _refreshPanel(status, status));
      _refreshPanel('Captured. Opening rebuilt sticker page...', 'Captured ✓ Opening...');
      chrome.runtime.sendMessage({ type: 'OPEN_STICKER_RENDERER' });
    } catch (err) {
      console.error(err);
      _refreshPanel(`Capture failed: ${err.message}`);
      alert(`Capture failed: ${err.message}`);
    } finally {
      _captureRunning = false;
      setTimeout(() => _refreshPanel(), 1200);
    }
  }

  /* ── Public API ───────────────────────────────────────────────── */

  function updateDetection(xlsUrl) {
    const changed = xlsUrl !== _detectedUrl;
    _detectedUrl  = xlsUrl || '';

    if (_detectedUrl) {
      _ensurePanel();
      if (changed) {
        _refreshPanel('Ready: Jasper ipdsticker link detected', 'Capture + Rebuild Sticker');
      } else if (_panel()?.style.display === 'none') {
        _refreshPanel();
      }
    } else {
      _refreshPanel('No Jasper ipdsticker link detected');
    }
  }

  function getDetectedUrl() { return _detectedUrl; }

  function injectCaptureButton(anchor, xlsUrl) {
    if (anchor.dataset.jrCaptureAttached === '1') return;
    anchor.dataset.jrCaptureAttached = '1';

    const btn = document.createElement('button');
    btn.type        = 'button';
    btn.textContent = 'Capture + Rebuild Sticker';
    btn.style.cssText = [
      'margin-left:8px', 'padding:6px 10px',
      'border:1px solid #15803d', 'border-radius:8px',
      'background:#dcfce7', 'color:#14532d',
      'font-weight:600', 'cursor:pointer', 'font-size:12px',
    ].join(';');

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.disabled = true;
      const orig = btn.textContent;
      try {
        await captureXlsFromUrl(xlsUrl, 'inline-button', (status) => { btn.textContent = status; });
        btn.textContent = 'Captured ✓ Opening...';
        chrome.runtime.sendMessage({ type: 'OPEN_STICKER_RENDERER' });
      } catch (err) {
        console.error(err);
        alert(`Capture failed: ${err.message}`);
        btn.textContent = orig;
        btn.disabled    = false;
      }
    });

    anchor.insertAdjacentElement('afterend', btn);
  }

  return { updateDetection, getDetectedUrl, injectCaptureButton };
})();
