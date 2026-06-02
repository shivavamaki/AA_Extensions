/* ── shared-data-client.js ────────────────────────────────────────────────
   Cross-feature data bus for BKN Pharmacy Portal.

   Exposes window.BKNData with helpers for:
     - patient context (the last extracted patientuid/visituid/HN/name)
     - ADR timeline persistence (per patient)
     - medication cache (per visit, so Jasper is fetched once)
     - generic key/value store on the pharmacy server

   All persistent reads/writes go through the pharmacy server. The server URL
   is stored in chrome.storage.local under the same key already used by
   rx_menu's existing tools (`bknks.serverUrl`) so the merged extension
   inherits whatever URL the user previously configured.

   Server-bound calls are proxied through the background service worker via
   `BKN_SERVER_PROXY` to avoid CORS and ensure consistent origin headers.
──────────────────────────────────────────────────────────────────────── */
"use strict";

(function () {
  if (window.BKNData) return; /* idempotent guard */

  const SERVER_KEY    = "bknks.serverUrl";   /* matches existing rx_menu key */
  const PATIENT_CACHE = "bkn.patientContext"; /* session cache key */
  /* Default pharmacy server — same host the rest of the extension hardcodes
     (popup.js REPORT_SERVER, kpi/knowledge/schedule apps). Used when the user
     has not explicitly configured bknks.serverUrl. */
  const SERVER_DEFAULT = "http://10.134.110.81:8765";

  let _serverUrlCache = null;
  let _patientCache   = null;

  /* ── server URL helpers ────────────────────────────────────────────── */
  async function getServerUrl() {
    if (_serverUrlCache) return _serverUrlCache;
    return new Promise(resolve => {
      try {
        chrome.storage.local.get([SERVER_KEY], r => {
          _serverUrlCache = (r && r[SERVER_KEY])
            ? String(r[SERVER_KEY]).replace(/\/$/, "")
            : SERVER_DEFAULT;
          resolve(_serverUrlCache);
        });
      } catch (_) { resolve(SERVER_DEFAULT); }
    });
  }

  async function setServerUrl(url) {
    _serverUrlCache = String(url || "").replace(/\/$/, "");
    return new Promise(resolve => {
      try { chrome.storage.local.set({ [SERVER_KEY]: _serverUrlCache }, resolve); }
      catch (_) { resolve(); }
    });
  }

  /* ── server proxy (via background to bypass CORS) ────────────────── */
  async function serverFetch(path, opts) {
    opts = opts || {};
    const base = await getServerUrl();
    if (!base) return { ok: false, status: 0, error: "Server URL not configured" };
    const url = base + (path.startsWith("/") ? path : "/" + path);
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({
          type: "BKN_SERVER_PROXY",
          url, method: opts.method || "GET",
          headers: opts.headers || {},
          body: opts.body !== undefined ? opts.body : null,
        }, resp => {
          if (chrome.runtime.lastError || !resp) {
            resolve({ ok: false, status: 0, error: chrome.runtime.lastError && chrome.runtime.lastError.message });
          } else {
            resolve(resp);
          }
        });
      } catch (e) { resolve({ ok: false, status: 0, error: String(e) }); }
    });
  }

  /* ── patient context (session-scoped) ──────────────────────────────── */
  async function getPatientContext() {
    if (_patientCache) return _patientCache;
    return new Promise(resolve => {
      try {
        chrome.storage.session.get([PATIENT_CACHE], r => {
          _patientCache = (r && r[PATIENT_CACHE]) || null;
          resolve(_patientCache);
        });
      } catch (_) { resolve(null); }
    });
  }

  async function setPatientContext(ctx) {
    if (!ctx || typeof ctx !== "object") return;
    _patientCache = ctx;
    return new Promise(resolve => {
      try {
        chrome.storage.session.set({ [PATIENT_CACHE]: ctx }, async () => {
          /* Also snapshot to the pharmacy server for cross-session recovery */
          if (ctx.patientuid) {
            await serverFetch(`/api/patients/${encodeURIComponent(ctx.patientuid)}/context`, {
              method: "PUT", headers: { "Content-Type": "application/json" },
              body: JSON.stringify(ctx),
            });
          }
          resolve();
        });
      } catch (_) { resolve(); }
    });
  }

  /* ── ADR Timeline persistence ─────────────────────────────────────── */
  async function loadAdrTimeline(patientuid) {
    if (!patientuid) return null;
    const r = await serverFetch(`/api/patients/${encodeURIComponent(patientuid)}/adr-timeline`);
    return r && r.ok ? r.json : null;
  }

  async function saveAdrTimeline(patientuid, data) {
    if (!patientuid || !data) return false;
    const r = await serverFetch(`/api/patients/${encodeURIComponent(patientuid)}/adr-timeline`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return !!(r && r.ok);
  }

  /* ── Medication cache (per visit) ─────────────────────────────────── */
  async function loadMedCache(patientuid, patientvisituid) {
    if (!patientuid || !patientvisituid) return null;
    const r = await serverFetch(
      `/api/patients/${encodeURIComponent(patientuid)}/medication-cache/${encodeURIComponent(patientvisituid)}`
    );
    return r && r.ok ? r.json : null;
  }

  async function saveMedCache(patientuid, patientvisituid, data) {
    if (!patientuid || !patientvisituid || !data) return false;
    const r = await serverFetch(
      `/api/patients/${encodeURIComponent(patientuid)}/medication-cache/${encodeURIComponent(patientvisituid)}`,
      {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }
    );
    return !!(r && r.ok);
  }

  /* ── Generic patient profile read (combined object) ──────────────── */
  async function loadPatientProfile(patientuid) {
    if (!patientuid) return null;
    const r = await serverFetch(`/api/patients/${encodeURIComponent(patientuid)}`);
    return r && r.ok ? r.json : null;
  }

  /* ── Expose ──────────────────────────────────────────────────────── */
  window.BKNData = {
    getServerUrl, setServerUrl, serverFetch,
    getPatientContext, setPatientContext,
    loadAdrTimeline, saveAdrTimeline,
    loadMedCache, saveMedCache,
    loadPatientProfile,
  };
})();
