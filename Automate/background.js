"use strict";

// Stores the desired filename for the next download triggered by the content script.
let nextDownloadName = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "setNextDownloadName") {
    nextDownloadName = message.filename || null;
    sendResponse({ ok: true });
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
