"use strict";

// The CDP bridge registers its own onMessage listener for cdp* message types.
importScripts("cdp-bridge.js", "tab-settings.js", "paperless-review-store.js");

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Each download carries its own filename; no global next-download slot.
  if (message.type === "downloadMedImage") {
    chrome.downloads.download({ url: message.imageUrl, filename: message.filename, saveAs: false }, (downloadId) => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : { ok: true, downloadId });
    });
    return true;
  }

  // PUT requests must originate from the extension context (background) so that
  // the server sees Origin: chrome-extension://... and passes _is_trusted_extension().
  // Content scripts run in the page context and always get 401.
  if (message.type === "serverGet") {
    fetch(message.url)
      .then(async (r) => {
        const data = await r.json();
        sendResponse({ ok: r.ok, status: r.status, data });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "uploadMedImage") {
    // Fetch image from Arcus (with session cookies) and PUT raw bytes to local server.
    fetch(message.imageUrl, { credentials: "include" })
      .then((r) => {
        if (!r.ok) throw new Error(`Image fetch ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) =>
        fetch(
          `http://localhost:8765/api/med-images/${encodeURIComponent(message.filename)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: buf,
          }
        )
      )
      .then((r) => sendResponse({ ok: r.ok, status: r.status }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "putMedicationDb") {
    fetch("http://localhost:8765/api/medication-db", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.db),
    })
      .then((r) => sendResponse({ ok: r.ok, status: r.status }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (message.type === "downloadJson") {
    const filename = message.filename || "arcus-export.json";
    const body = JSON.stringify(message.data ?? {}, null, 2);
    const url = "data:application/json;charset=utf-8," + encodeURIComponent(body);
    chrome.downloads.download({ url, filename, saveAs: true }, (downloadId) => {
      const err = chrome.runtime.lastError;
      sendResponse(err ? { ok: false, error: err.message } : { ok: true, downloadId });
    });
    return true;
  }

  return false;
});
