"use strict";

// Stores the desired filename for the next download triggered by the content script.
let nextDownloadName = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "setNextDownloadName") {
    nextDownloadName = message.filename || null;
    sendResponse({ ok: true });
    return false;
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

// Rename the file when Chrome is deciding the save path.
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  if (nextDownloadName) {
    const name = nextDownloadName;
    nextDownloadName = null;
    const origExt = (downloadItem.filename.match(/\.[^./\\]+$/) || [""])[0];
    const hasExt = /\.[^./\\]+$/.test(name);
    suggest({ filename: hasExt ? name : name + (origExt || ".jpg") });
  } else {
    suggest();
  }
});
