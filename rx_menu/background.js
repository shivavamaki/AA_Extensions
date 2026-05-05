/* ═══════════════════════════════════════════════════════
   background.js — BKN Pharmacy Extension
   MV3 Service Worker
   Compatible with:
   - popup.js
   - content_script.js
   ═══════════════════════════════════════════════════════ */

'use strict';

const DRUGDELIVERY_URL_PART = '10.134.10.91:8809/drugdelivery/web/ipfill';


// ── Single consolidated message listener ──────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // --- for bedee report ---
  if (msg.action === "OPEN_PDF_PAGE") {
    console.log("📩 Received payload:", msg.payload);

    chrome.storage.local.set({ pdf_data: msg.payload }, () => {
      console.log("💾 Data saved to storage");

      chrome.tabs.create({
        url: chrome.runtime.getURL("pdf.html")
      });
    });

    return true;
  }

  // ── Drug Delivery bridge: popup/background -> drugdelivery tab ──────────
  if (msg.action === 'sendToDrugDelivery') {
    handleSendToDrugDelivery(msg.visitId)
      .then(() => sendResponse({ ok: true }))
      .catch(err => {
        console.error('[BG] sendToDrugDelivery error:', err);
        sendResponse({ ok: false, error: err.message || String(err) });
      });
    return true;
  }

  // ── Drug Delivery page announces ready ───────────────────────────────────
  if (msg.action === 'drugDeliveryReady') {
    console.log('[BG] Drug delivery page ready:', sender.tab?.id, sender.tab?.url);
    sendResponse?.({ ok: true });
    return false;
  }

  // ── Drug Delivery result relay back to popup/extension pages ────────────
  if (msg.action === 'drugDeliveryResult') {
    console.log('[BG] Drug delivery result:', msg);

    chrome.runtime.sendMessage({
      action: 'drugDeliveryResult',
      visitId: msg.visitId,
      ok: !!msg.ok,
      errorText: msg.errorText || ''
    }).catch?.(() => {});

    sendResponse?.({ ok: true });
    return false;
  }

  // ── Extension-side fetch proxy (avoids CORS from content scripts) ───────
  if (msg.action === 'extFetch') {
    (async () => {
      try {
        const method  = msg.method  || 'GET';
        const headers = msg.headers || {};
        let body = undefined;

        if (msg.body !== null && msg.body !== undefined) {
          body = (typeof msg.body === 'string') ? msg.body : JSON.stringify(msg.body);
        }

        const res = await fetch(msg.url, {
          method,
          headers,
          body,
          redirect: 'follow'
        });

        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (_) {}

        sendResponse({
          ok: res.ok,
          status: res.status,
          statusText: res.statusText,
          text,
          json
        });
      } catch (e) {
        sendResponse({
          ok: false,
          status: 0,
          statusText: String(e),
          text: '',
          json: null
        });
      }
    })();
    return true;
  }

  // ── Sidebar toggle ───────────────────────────────────────────────────────
  if (msg.action === 'toggleSidebar') {
    if (!sender.tab?.id || !chrome.scripting?.executeScript) {
      sendResponse?.({ ok: false, error: 'No tab or scripting API unavailable' });
      return false;
    }

    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: () => { chrome.runtime.sendMessage({ action: 'toggleSidebar' }); }
    });
    sendResponse?.({ ok: true });
    return false;
  }

  // ── Selection storage ────────────────────────────────────────────────────
  if (msg.action === 'sendSelection') {
    chrome.storage.local.set({ selectedText: msg.data }, () => {
      if (chrome.runtime.lastError) {
        console.error('Error saving selected text:', chrome.runtime.lastError);
      }
    });
    sendResponse?.({ ok: true });
    return false;
  }

  if (msg.action === 'getSelection') {
    chrome.storage.local.get(['selectedText'], result => {
      if (chrome.runtime.lastError) {
        sendResponse({ data: '' });
      } else {
        sendResponse({ data: result.selectedText || '' });
      }
    });
    return true;
  }

  // ── Google Drive save ────────────────────────────────────────────────────
  if (msg.action === 'saveFile') {
    fetchFileFromUrl(msg.fileUrl)
      .then(file => uploadFileToDrive(file))
      .then(() => sendResponse({ status: 'File saved to Google Drive!' }))
      .catch(err => {
        console.error('Drive save error:', err);
        sendResponse({ status: 'Failed to save file to Google Drive.' });
      });
    return true;
  }

  // ── DOM tag query (legacy) ───────────────────────────────────────────────
  if (msg.action === 'getDataByTag') {
    sendResponse({ data: [] });
    return false;
  }

  // ── Med Rec trigger (Google Apps Script) ────────────────────────────────
  if (msg.action === 'triggerFunction') {
    const url = 'https://script.google.com/macros/s/AKfycbwk0PsLdtR7a37iEzMLS15YBUlw25UPp92IQYRy2sYRRU-3LFb17HSvBZsIjA_tGTvyYQ/exec';

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data0: 'value0', data1: 'value1' }),
    })
      .then(r => r.json())
      .then(d => {
        console.log('MedRec trigger success:', d);
        sendResponse({ success: true, message: 'Function triggered!' });
      })
      .catch(e => {
        console.error('MedRec trigger error:', e);
        sendResponse({ success: false, message: 'Failed to trigger function.' });
      });

    return true;
  }

  return false;
});

// ── Lifecycle ──────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    console.log('BKN Pharmacy extension installed.');
    chrome.tabs.create({ url: 'welcome.html' });
  } else if (details.reason === 'update') {
    console.log(`BKN Pharmacy updated to v${chrome.runtime.getManifest().version}.`);
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'openSidePanel' && chrome.sidePanel?.open) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// ── Drug Delivery helpers ──────────────────────────────────────────────────
async function handleSendToDrugDelivery(visitId) {
  if (!visitId) {
    throw new Error('Missing visitId');
  }

  const tabs = await chrome.tabs.query({});
  const drugTab = tabs.find(tab =>
    tab.url && tab.url.includes(DRUGDELIVERY_URL_PART)
  );

  if (!drugTab?.id) {
    throw new Error('Drug Delivery page not found. Please open ipfill page first.');
  }

  await chrome.tabs.update(drugTab.id, { active: true });

  const resp = await new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(
      drugTab.id,
      { action: 'fillAndSubmit', visitId },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      }
    );
  });

  if (!resp) {
    throw new Error('No response from drug delivery content script');
  }

  if (resp.ok === false) {
    throw new Error(resp.error || 'Drug delivery rejected request');
  }

  return true;
}

// ── Helper functions ───────────────────────────────────────────────────────
async function fetchFileFromUrl(fileUrl) {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
  const blob = await response.blob();
  return new File([blob], 'downloaded-file', { type: blob.type });
}

async function uploadFileToDrive(file) {
  const accessToken = await getAccessToken();
  const formData = new FormData();

  formData.append('metadata', new Blob([JSON.stringify({
    name: file.name,
    parents: ['14U3kFKdaA0tFkyFqMt1sDRByuIerOMbk']
  })], { type: 'application/json' }));

  formData.append('file', file);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + accessToken },
      body: formData
    }
  );

  if (!response.ok) throw new Error('Failed to upload to Google Drive.');
  return response.json();
}