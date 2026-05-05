"use strict";
(async function () {
  const S = window.CoreStorage;

  const logEl = document.getElementById("log");
  function addLog(cls, ...args) {
    const line = document.createElement("div");
    line.className = "log-" + cls;
    line.textContent = new Date().toLocaleTimeString() + "  " + args.join(" ");
    logEl.prepend(line);
  }

  // Intercept console to show in page too
  const _log  = console.log.bind(console);
  const _warn = console.warn.bind(console);
  console.log  = (...a) => { _log(...a);  addLog("info", ...a); };
  console.warn = (...a) => { _warn(...a); addLog("warn", ...a); };

  function setEl(id, val, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    el.className   = "value " + (cls || "");
  }

  function showRaw(obj) {
    document.getElementById("raw-out").textContent =
      JSON.stringify(obj, null, 2);
  }

  async function refresh() {
    addLog("info", "Refreshing status…");

    // Bridge server status
    const status = await S.bridgeStatus();
    setEl("s-bridge", status?.ok
      ? `✅ running — ${status.dataDir}`
      : "❌ not running (start hm_server.py)", status?.ok ? "ok" : "err");

    // availability
    const avail = typeof chrome !== "undefined" && !!chrome?.storage?.sync;
    setEl("s-available", avail ? "✅ available" : "❌ not available", avail ? "ok" : "err");

    if (!avail) { addLog("err", "chrome.storage.sync not available"); return; }

    // quota
    const q = await S.debugSyncQuota();
    if (q) {
      const cls = parseFloat(q.pct) > 80 ? "warn" : "ok";
      setEl("s-quota", `${q.bytesInUse} / ${q.quota} bytes (${q.pct}%)`, cls);
    } else {
      setEl("s-quota", "error reading quota", "err");
    }

    // keys
    const all  = await S.debugDumpSync();
    const hmKeys = Object.keys(all).filter(k => k.startsWith(S.SYNC_PREFIX));
    setEl("s-keys", hmKeys.length > 0 ? hmKeys.join(", ") : "none", hmKeys.length ? "ok" : "warn");

    // today
    const todayKey = S.SYNC_PREFIX + new Date().toISOString().slice(0,10);
    setEl("s-today", todayKey);

    const todayData = all[todayKey] || {};
    const pts = Object.keys(todayData).length;
    setEl("s-patients", pts > 0 ? `${pts} patients` : "0 (no data today)", pts ? "ok" : "warn");

    addLog("ok", "Status refreshed");
  }

  document.getElementById("btn-refresh").onclick = refresh;

  document.getElementById("btn-write-test").onclick = async () => {
    addLog("info", "Writing test entry to sync…");
    const dateIso = new Date().toISOString().slice(0, 10);
    const testCL  = {
      "48-99-999999": { "ยาคืน": true, "ATB": false, "ยสค้างรับ": true, "OffSTD": false, "ยาติดฉลาก": true },
      "48-00-000001": { "ยาคืน": false, "ATB": false, "ยสค้างรับ": false, "OffSTD": false, "ยาติดฉลาก": false },
    };
    const res = await S.saveSyncChecklist(dateIso, testCL);
    showRaw({ request: testCL, result: res });
    if (res.ok) {
      addLog("ok", `✅ Write OK — key=${res.key} bytes=${res.bytes}`);
    } else {
      addLog("err", `❌ Write FAILED — ${res.reason}`);
    }
    await refresh();
  };

  document.getElementById("btn-read-test").onclick = async () => {
    addLog("info", "Reading today's sync data…");
    const dateIso = new Date().toISOString().slice(0, 10);
    const data    = await S.loadSyncChecklist(dateIso);
    showRaw({ date: dateIso, data });
    const count = Object.keys(data).length;
    if (count > 0) {
      addLog("ok", `✅ Read OK — ${count} patients`);
    } else {
      addLog("warn", "⚠️ No data found for today");
    }
  };

  document.getElementById("btn-dump").onclick = async () => {
    addLog("info", "Dumping all sync keys…");
    const all = await S.debugDumpSync();
    showRaw(all);
    addLog("ok", `Dumped ${Object.keys(all).length} total keys`);
  };

  document.getElementById("btn-clear-sync").onclick = async () => {
    if (!confirm("Clear ALL HM sync keys? This affects all PCs on this account.")) return;
    addLog("warn", "Clearing all HM sync keys…");
    chrome.storage.sync.get(null, all => {
      const hmKeys = Object.keys(all).filter(k => k.startsWith(S.SYNC_PREFIX));
      if (!hmKeys.length) { addLog("info", "No HM keys to clear"); return; }
      chrome.storage.sync.remove(hmKeys, () => {
        addLog("ok", `Removed ${hmKeys.length} keys:`, hmKeys.join(", "));
        refresh();
      });
    });
  };

  // Auto-refresh on load
  await refresh();

  // Listen for live sync changes
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const hmChanges = Object.keys(changes).filter(k => k.startsWith(S.SYNC_PREFIX));
    if (hmChanges.length) {
      addLog("ok", "🔔 Sync changed:", hmChanges.join(", "));
      refresh();
    }
  });

})();
