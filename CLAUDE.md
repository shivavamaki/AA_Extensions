# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo overview

Internal tooling monorepo for the **BKN Hospital Pharmacy Department**. Contains three legacy Chrome extensions, one unified merged extension, and a Python backend server — all targeting the **ArcusAir** clinical workbench (`arcusair.bdms.co.th`, an AngularJS 1.x SPA).

```
EXT/
├── BKNPharmacyPortal/   ← merged extension (rx_menu + AAOverlay) — primary, active
├── rx_menu/             ← legacy: BKN Pharmacy extension (kept for rollback)
├── AAOverlay/           ← legacy: Discharge Process Checklist (kept for rollback)
├── Automate/            ← separate utility extension (Auto Dispense / IP Fill)
└── pharmacy_server/     ← Python stdlib HTTP server (data backend)
```

**Active development happens in `BKNPharmacyPortal/` and `pharmacy_server/`.** The legacy `rx_menu/` and `AAOverlay/` folders should not be edited — they exist for rollback during the merge transition.

## Running and developing

### Chrome extension (BKNPharmacyPortal)
1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select `BKNPharmacyPortal/`
2. After any change, click the reload icon on the extension card
3. There is **no build step, no bundler, no package.json, no test suite** — files are loaded directly by Chrome MV3

### Pharmacy server
```bash
cd pharmacy_server
python bkn_ks_server.py          # default port 8765
python bkn_ks_server.py --port 9000
```
Python 3.6+, stdlib only. `start_server.bat` launches it on Windows. The extension is configured to reach it at `http://10.134.110.81:8765` (some features also try `http://10.134.10.5:8765`).

### UI verification matters
There is no test suite. For UI or feature work, reload the extension and exercise the feature in Chrome — the user explicitly expects browser verification (see `### Cross-feature data flow` below). Type checks and lints do **not** exist for this project.

For Python syntax checks, avoid `python -m py_compile` in this repo because `pharmacy_server/__pycache__/bkn_ks_server.cpython-312.pyc` is tracked and gets rewritten. Use a no-pyc compile check instead:
```bash
python -c "p='pharmacy_server/bkn_ks_server.py'; compile(open(p, encoding='utf-8').read(), p, 'exec')"
```

## Critical architecture notes

### MV3 service worker is the message hub — `BKNPharmacyPortal/background.js`
All cross-context messaging goes through this single service worker:
- `BKN_SERVER_PROXY` — generic pharmacy-server fetch (bypasses CORS for content scripts and extension pages)
- `MJ_FETCH_XLS` — Jasper XLS binary fetch for the ADR Timeline
- `MJ_EXTRACT_ANGULAR_CTX` — runs a MAIN-world script via `chrome.scripting.executeScript` to read `$rootScope`, `UserContext`, `$stateParams` for `patientuid` / `patientvisituid`
- `MJ_SETUP_XHR_TAP` — installs a MAIN-world XHR/fetch interceptor as a fallback when scope extraction misses IDs
- `ROUTE_MAP` (`OPEN_STICKER`, `OPEN_PATIENT_STICKER`, `OPEN_MED_RECONCILE`, `OPEN_ALLERGY_CARD`, `OPEN_MEDICATION_JOURNEY`, `LOAD_MED_TABLE`) — feature pages routed to tabs with a per-feature single-tab reuse policy via `openOrReuseTab` + `tabRegistry`
- Legacy rx_menu handlers (`OPEN_PDF_PAGE`, `sendToDrugDelivery`, `extFetch`, `toggleSidebar`, `saveFile`, etc.) preserved verbatim — do not refactor

`openOrReuseTab` intentionally writes the payload to `chrome.storage.session` before creating/focusing the feature tab; new tabs read their first payload from session storage. Keep that ordering or first-open pages can see stale/missing data. `MJ_FETCH_XLS` uses an aborting timeout and single-response guard; do not reintroduce timeout paths that can call `sendResponse` twice. `MJ_SETUP_XHR_TAP` must surface `chrome.runtime.lastError` so context-capture failures are visible instead of silently losing the fallback.

### Patient context extraction is a layered multi-strategy chase
`patientuid` is intermittently missing because the visit context and patient context live in **separate Angular scope objects**. The extraction code in `src/features/adrtimeline/adrtimeline-core.js::extractArcusPatientContext` and the MAIN-world `_arcusExtractAngularCtx` in `background.js` tries:
1. URL hash + query params
2. AngularJS `$stateParams`, `LastUIStateParams`, `AutoLoginStateParams` on `$rootScope`
3. Scope walk on `ui-view`, banner controllers, `ng-controller` matches, parent chain (up 4 levels)
4. Angular DI service injection (`PatientVisitService`, `EmrService`, etc.)
5. DOM text scraping (HN, AN, name, gender, DOB, bed, dept, doctor, admit date, pharmacist)
6. Scanning Jasper links on the page
7. **XHR/fetch tap fallback** — a MAIN-world hook installed early via `MJ_SETUP_XHR_TAP` that records `patientuid` / `patientvisituid` from any outbound API URL

When patching this path: changes propagate across both files. Test by opening Orders for several different patients — context loss is often patient-specific.

### ArcusAir API/XHR capture
To catch page-owned API payloads such as `https://arcusair.bdms.co.th/ordermanagement/patientorder/getallorderitem`, extend the MAIN-world `_arcusSetupXhrTap` in `background.js`. A normal isolated content script cannot reliably inspect the page's Angular-owned XHR/fetch internals.

Recommended pattern:
- Install the tap as early as possible (`MJ_SETUP_XHR_TAP`; use `document_start` bootstrap if the target call fires before `document_idle`).
- Patch both `XMLHttpRequest.prototype.open/send` and `window.fetch`.
- Detect target URLs with a narrow regex such as `/\/ordermanagement\/patientorder\/getallorderitem/i`.
- Capture request body from `send(body)` / `fetch(..., { body })` and response body from `xhr.responseText` / `response.clone().text()`.
- MAIN-world code cannot call `chrome.*`; either store results on `window.__arcus_*` and read them via another MAIN-world extraction, or `window.postMessage` to an isolated content script that then uses `chrome.runtime` / `BKNData`.
- Never break the original request/response contract: always return the original XHR/fetch result and use `response.clone()` for fetch response reads.

### Cross-feature data bus — `src/shared/shared-data-client.js`
`window.BKNData` is the only sanctioned cross-feature data API. It exposes `getServerUrl/setServerUrl/serverFetch/getPatientContext/setPatientContext/loadAdrTimeline/saveAdrTimeline/loadMedCache/saveMedCache/loadPatientProfile`. Patient context goes into `chrome.storage.session` **and** mirrors to `PUT /api/patients/{puid}/context` so other workstations / sessions see it. Server URL key is `bknks.serverUrl` in `chrome.storage.local` — same key as legacy rx_menu so the URL survives the merge.

**Do not introduce localStorage caches for cross-workstation data** — the user explicitly rejected this pattern. Always fetch fresh from the pharmacy server when data must be visible across machines (Knowledge popup FAQs/Items/Vdos was rewritten to fetch server-direct after a localStorage attempt was rejected).

`shared-data-client.js` falls back to `http://10.134.110.81:8765` when `bknks.serverUrl` is unset. Some older extension pages still use hard-coded constants or the legacy `localStorage` key `pharmacyServerUrl` (`iv_sticker.js`, `aux_sticker.js`, parts of KPI/Knowledge/Schedule/Popup). Do not assume changing `BKNData` automatically moves every feature until those pages are migrated.

### Pharmacy server — `pharmacy_server/bkn_ks_server.py`
Single-file Python stdlib server. All data is plain JSON under `pharmacy_server/data/`. It runs on `ThreadingHTTPServer`; keep shared writes atomic and safe for concurrent requests. Auth model:
- `TRUSTED_EXTENSION_ORIGINS` was loosened — any origin starting with `chrome-extension://` is trusted for writes. The extension ID changes on every unpacked reload, and the user chose this trade-off over re-registering IDs.
- CORS is `*` and set on every response.

**Never edit files under `pharmacy_server/data/`** without the user's explicit say-so. The folder is protected by `.gitignore` + `.gitattributes` `merge=ours` + `git update-index --skip-worktree` so `git pull` does not overwrite production data. Adding or moving anything in `data/` defeats that protection.

Server safety invariants:
- JSON writes must go through `_atomic_write_json` / temp-file + `os.replace`; do not use direct `write_text` for production JSON.
- Static file serving must stay under its intended base directory via `_serve_file_under` / `_path_within`; never join raw URL paths directly to `WWW_DIR`, `MED_IMAGES_DIR`, or `KS_FILES_DIR`.
- `/api/schedule/state?month=YYYY-MM` maps to month-scoped `state-YYYY-MM.json`. `/api/schedule/state` remains the shared/global state used by booking rules and staff metadata. When saving month-scoped state, shared fields such as `staff`, `shiftTemplates`, and `bookingRules` are mirrored back to global `state.json`.
- `/api/schedule/bookings` is an all-month bookings object, not a per-month file.
- `patient-medcache` routes use the parsed visit UID (`extra`) as the medication cache key; do not reintroduce the old undefined `item_id` read in GET.

### Content-script injection on ArcusAir
The `content_scripts` block in `manifest.json` loads scripts in a specific order — core utilities first, then `shared-data-client.js`, then features (home-med, med-sticker, patient-sticker, adrtimeline), then rx_menu's legacy `content_script.js` last. Reordering breaks cross-feature dependencies (e.g., feature scripts assume `window.BKNData` is defined).

A page-injected SPA like ArcusAir destroys and rebuilds the DOM constantly. All content scripts use:
- A `Symbol.for(...)` guard stored on `document` (not `window` — Angular wipes window props on scope destroy)
- A `MutationObserver` that re-injects buttons after navigation
- `hashchange` / `popstate` listeners and a `pushState` / `replaceState` patch to detect SPA route changes

Nuance: the newer AAOverlay-style feature scripts follow the `document[Symbol.for(...)]` guard pattern. The merged legacy `content_script.js` is older rx_menu code and does not fully follow that pattern; avoid broad refactors there unless the user asks. When adding new ArcusAir content scripts, use the document-level Symbol guard and throttle/debounce broad `MutationObserver` callbacks.

### Shared "BKN tool group" button strip
The 📊 / 🏷️ / ⚠️ icons that appear next to ArcusAir's `#paprint` button live inside a collapsible `<span class="bkn-tool-group">` container. Hover expands the flyout via pure CSS (`:hover` / `:focus-within`). Two content scripts cooperate:
- `content-patient-sticker.js` defines the CSS and the factory, exposed via `document[Symbol.for("__BKN_TOOL_GROUP_FACTORY__")]`
- `content-adrtimeline.js` calls that factory (or falls back to a compatible self-built group if it runs first)

When adding a new icon to this strip: append to `.bkn-tool-flyout` inside the group; do **not** insert siblings next to `#paprint`.

### Schedule allocator — pass-based, with admin-override persistence
`schedule/app.js` runs a two-pass allocator:
1. **Pass 1** — role-priority types (`Clinic`, `Night`) with light fairness
2. **Pass 2** — IPD/OPD/Floor2/Office/Special with heavy fairness (22× type-count penalty)
Plus a 4-stage backfill that progressively relaxes constraints for missing required shifts. Constraints include `maxConsecNights = 2` (hard), per-role `canNight` / `canWeekend`, monthly caps (mostly `Infinity` per current role rules), and an "Override role limits" checkbox in the shift editor for one-off exceptions.

When the user reports the scheduler not respecting an admin choice: the pattern is always to persist the choice as an admin override that survives auto-allocation. Past examples — OFF override via `setOverride(personId, dayIndex, "OFF", remark)` (not `removeOverride`); booking imports always apply (no `reqOffLocked` guard).

Schedule persistence is month-scoped. `schedule/app.js::scheduleStateUrl()` saves to `/api/schedule/state?month=YYYY-MM`, includes `updatedAt`, and keeps the save button dirty if the server write fails (localStorage is only a local fallback). `loadState()` may load localStorage immediately, then refresh from server only when the server state has a usable newer/equal timestamp. Booking import data still lives in `/api/schedule/bookings` and is checked from the server because it can be edited on another workstation.

## Patterns to respect

- **Internal identifiers are stable contracts** — `MJ_*` message types, `OPEN_MEDICATION_JOURNEY`, `aa_medicationJourney` tab key, `arcus-medj-btn2` DOM id, `mj-*` CSS hooks, and the `MedicationJourney` JS namespace are intentionally **not renamed** even though the user-facing feature is "ADR Timeline" (folder + filenames were renamed for that). Don't rename these — they're load-bearing across content scripts, pages, and the service worker.
- **Don't refactor legacy rx_menu handlers** in `background.js`. They're preserved verbatim from the pre-merge extension; their stability matters more than cleanliness.
- **AAOverlay features have no popup tab** by design. Buttons inject directly into ArcusAir; the popup is rx_menu's existing 4-tab layout (Workspace / IPD Queue / Report / Knowledge) and stays that way.
- The user works on Windows over a UNC path (`\\10.134.10.5\BKNinfo\24 Pharmacy\EXT`). Prefer PowerShell for filesystem ops; quote paths with spaces.
