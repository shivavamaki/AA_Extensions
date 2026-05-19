"use strict";

const ALLOWED_JASPER_HOSTS = ['aa-report.bdms.co.th', 'aa-report-uat.bdms.co.th'];

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary  = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchJasperXls(url) {
  const target = new URL(url);

  if (!ALLOWED_JASPER_HOSTS.includes(target.hostname)) {
    throw new Error(`Blocked host: ${target.hostname}`);
  }
  if (!target.pathname.includes('/jasperserver/flow.html')) {
    throw new Error('Blocked non-Jasper flow URL');
  }

  target.searchParams.set('output', 'xls');

  const res = await fetch(target.toString(), {
    credentials: 'include',
    cache:       'no-store',
    redirect:    'follow',
  });

  if (!res.ok) {
    throw new Error(`Jasper XLS fetch failed: ${res.status} ${res.statusText}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    ok:          true,
    url:         target.toString(),
    finalUrl:    res.url,
    contentType: res.headers.get('content-type') || '',
    byteLength:  arrayBuffer.byteLength,
    base64:      arrayBufferToBase64(arrayBuffer),
  };
}

/* ── Renderer tab: open once, reuse on subsequent calls ──────────── */

let _rendererTabId = null;

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === _rendererTabId) _rendererTabId = null;
});

function openOrReuseRenderer(sendResponse) {
  const url = chrome.runtime.getURL('src/pages/sticker_render.html');

  function createNew() {
    chrome.tabs.create({ url }, (tab) => {
      _rendererTabId = tab?.id ?? null;
      sendResponse({ ok: true });
    });
  }

  if (_rendererTabId !== null) {
    chrome.tabs.get(_rendererTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        _rendererTabId = null;
        createNew();
      } else {
        chrome.tabs.update(_rendererTabId, { active: true });
        sendResponse({ ok: true });
      }
    });
  } else {
    createNew();
  }
}

/* ── Message router ──────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return;

  switch (message.type) {
    case 'FETCH_JASPER_XLS':
      fetchJasperXls(message.url)
        .then(sendResponse)
        .catch((err) => {
          console.error('[Jasper Sticker Rebuilder] background fetch failed', err);
          sendResponse({ ok: false, error: err.message || String(err) });
        });
      return true;

    case 'OPEN_STICKER_RENDERER':
      openOrReuseRenderer(sendResponse);
      return true;

    case 'CAPTURE_STATUS':
      chrome.storage.local.get(['lastCaptureSummary'], (data) => {
        sendResponse({ ok: true, summary: data.lastCaptureSummary || null });
      });
      return true;
  }
});
