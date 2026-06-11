"use strict";

(function () {
const _g = typeof globalThis !== "undefined" ? globalThis
         : typeof window    !== "undefined" ? window : {};
if (_g.CoreStorage) return;

const CoreStorage = (() => {

  const STORAGE_KEY   = "dc_lists_data";
  const MAX_SNAPSHOTS = 50;

  function loadSnapshots() {
    return new Promise(resolve =>
      chrome.storage.local.get(STORAGE_KEY, res => {
        if (chrome.runtime.lastError) { resolve([]); return; }
        resolve(res[STORAGE_KEY] || []);
      })
    );
  }

  function saveSnapshots(snapshots) {
    return new Promise(resolve =>
      chrome.storage.local.set({ [STORAGE_KEY]: snapshots }, resolve)
    );
  }

  async function appendSnapshot(snap) {
    const all = await loadSnapshots();
    all.push(snap);
    if (all.length > MAX_SNAPSHOTS) all.splice(0, all.length - MAX_SNAPSHOTS);
    await saveSnapshots(all);
    return all.length;
  }

  async function deleteSnapshot(idx) {
    const all = await loadSnapshots();
    all.splice(idx, 1);
    await saveSnapshots(all);
    return all;
  }

  function clearAll() { return saveSnapshots([]); }

  return {
    STORAGE_KEY,
    MAX_SNAPSHOTS,
    loadSnapshots,
    saveSnapshots,
    appendSnapshot,
    deleteSnapshot,
    clearAll,
  };

})();

_g.CoreStorage = CoreStorage;
})();
