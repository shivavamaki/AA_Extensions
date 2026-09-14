# BKN Pharmacy Portal

Unified Chrome MV3 extension for BKN Hospital Pharmacy. Combines the former **BKN Pharmacy** (`rx_menu`) and **Discharge Process Checklist** (`AAOverlay`) extensions into one portal backed by a shared pharmacy server.

**Version:** 3.54.0 · **Manifest:** MV3 · **Target:** ArcusAir (`arcusair.bdms.co.th`, AngularJS 1.x SPA)

Full project context: [/README.md](../README.md)

---

## Main Idea

**Less paper, faster workflow, safer pharmacy operations.**

The portal injects pharmacy action buttons directly into ArcusAir pages. Patient context is extracted once and shared across all features — no re-typing, no re-printing the same details multiple times.

---

## What's Inside

### ArcusAir-injected features

| Feature | Trigger page | What it produces | README |
|---|---|---|---|
| Home Med Sheet | Dispense workbench (DISCHARGE MEDICATION) | Printable A4 Thai medication sheet with follow-up appointment section | [src/features/home-med/README.md](src/features/home-med/README.md) |
| Med Sticker | Dispense workbench / POM list | Medication label stickers with barcode | [src/features/med-sticker/README.md](src/features/med-sticker/README.md) |
| Patient Sticker | Patient EMR banner | Patient ID / address / allergy / unreceivable labels | [src/features/patient-sticker/README.md](src/features/patient-sticker/README.md) |
| ADR Drug Timeline | Order-profile page | Drug Gantt with ADR events, editable, server-persisted | [src/features/adrtimeline/README.md](src/features/adrtimeline/README.md) |
| Medication Journey | (opened from ADR Timeline context) | Per-drug continuity grid across care phases | [src/features/med-journey/README.md](src/features/med-journey/README.md) |
| Med Reconcile Comments | Med Reconcile page (`emr/medreconcile`) | Turns the Comments input into an editable dropdown (3 presets + free text) | [src/features/medrecon-comment/README.md](src/features/medrecon-comment/README.md) |

Shared infrastructure (translation engine, data bus): [src/shared/README.md](src/shared/README.md)

### Extension pages (popup tabs)

| Page | Description | README |
|---|---|---|
| IV / Aux Sticker | IV bag, HAD, PFS, ATB, Cytotoxic, EYE labels and premix mixing labels | [src/features/iv-aux-sticker/README.md](src/features/iv-aux-sticker/README.md) |
| IPD Queue | Active inpatient list from ArcusAir MRD → push to Drug Delivery; "🏷 Check Discharge Status" cross-references RT_COMMON_896 to flag/highlight patients past discharge stage 2 | — |
| Reports | RT_COMMON_257 dispensing report, RT_COMMON_917 stock picking, Beedee report export. **Daily server-side cache** (`/api/report-cache/{key}/{date}`, 1-day retention): a report parsed once/day is reused by every workstation that day (rendered from cache on card open, "🗄 … · Refresh" note to re-pull). **Stock Picking auto-runs at 15:00 Asia/Bangkok** via a `chrome.alarms` trigger → headless offscreen doc (`offscreen-report.html`, loads `popup.js`'s parser) → saves rendered rows (`source:'auto'`) to the cache. | [src/features/report-print/README.md](src/features/report-print/README.md), [src/features/beedee-pdf/README.md](src/features/beedee-pdf/README.md) |
| Formulary | Drug formulary browser | [formulary/README.md](formulary/README.md) |
| Knowledge Hub | Pharmacy FAQs, items, videos, shared references | [knowledge/README.md](knowledge/README.md) |
| KPI | Daily OPD/IPD/med-error KPI records | [kpi/README.md](kpi/README.md) |
| Pending Drug Code | Shift-handover checklist tracking drug code setup tasks | [pending-code/README.md](pending-code/README.md) |
| Schedule | Staff shift schedule with booking rules | [schedule/README.md](schedule/README.md) |
| Vaccine | Vaccine schedule viewer | [vaccine/README.md](vaccine/README.md) |

---

## Architecture

```text
popup.html / popup.js
  └── 4-tab workspace (Workspace | IPD Queue | Report | Knowledge)

background.js  ← sole message hub (MV3 service worker)
  ├── BKN_SERVER_PROXY  — all server fetches (bypasses CORS)
  ├── openOrReuseTab    — writes payload to chrome.storage.session BEFORE tab open;
  │                       reuses an existing tab via tabRegistry, and (if the MV3
  │                       worker restarted and lost it) by chrome.tabs.query({url})
  │                       so a feature page never opens twice
  ├── ROUTE_MAP         — feature-tab openers
  ├── MJ_FETCH_XLS      — Jasper XLS fetch (single-response guard)
  ├── MJ_EXTRACT_ANGULAR_CTX  — MAIN-world Angular DI extraction
  └── MJ_SETUP_XHR_TAP  — on-demand XHR/fetch tap setup (idempotent fallback;
                           the tap normally self-installs, see below)

Content scripts (3 separate manifest.json entries — load order is load-bearing):
  1. world:"MAIN", document_start:
       src/main-world/arcus-xhr-tap.js     ← installs setRequestHeader/open/send/fetch hooks
                                              before ArcusAir's app fires its first call
  2. ISOLATED, document_start:
       src/main-world/early-sec-relay.js   ← relays the tap's incus-token postMessage
                                              to background (must load before the tap can post)
  3. ISOLATED, document_idle:
       src/core/messages.js
       src/core/utils.js
       src/core/dom.js
       src/core/storage.js
       src/shared/shared-data-client.js   ← window.BKNData (data bus)
       src/features/med-sticker/parser-order-table.js
       src/features/med-sticker/content-med-sticker.js
       src/features/med-sticker/content-pomlist.js
       src/features/patient-sticker/parser-patient.js
       src/features/patient-sticker/content-patient-sticker.js  ← owns .bkn-tool-group
       src/features/adrtimeline/adrtimeline-core.js
       src/features/adrtimeline/adrtimeline-parser-html.js
       src/features/adrtimeline/adrtimeline-jasper.js
       src/features/adrtimeline/content-adrtimeline.js
       src/features/home-med/content-home-med.js
       content_script.js  ← legacy handlers (load last)
```

---

## Shared Data Bus — `window.BKNData`

`src/shared/shared-data-client.js` is the only sanctioned cross-feature data API. It routes all persistent reads/writes through the pharmacy server via `BKN_SERVER_PROXY`.

Key methods: `getServerUrl / setServerUrl / serverFetch / getPatientContext / setPatientContext / loadAdrTimeline / saveAdrTimeline / loadMedCache / saveMedCache / loadPatientProfile`

- Server URL key: **`bknks.serverUrl`** in `chrome.storage.local` — defaults to `http://10.134.110.81:8765` and automatically fails over to `http://10.134.110.182:8765` when the primary is unreachable.
- Patient context: `chrome.storage.session` + mirrors to `PUT /api/patients/{puid}/context`
- **No localStorage** for cross-workstation data

---

## Critical Rules

| Rule | Detail |
|---|---|
| `.bkn-tool-group` owned by patient-sticker | All other features call the factory via `Symbol.for("__BKN_TOOL_GROUP_FACTORY__")`. Append into `.bkn-tool-flyout` only. |
| Load order is load-bearing | Features assume `window.BKNData` exists. Don't reorder content scripts. |
| Stable internal IDs | `MJ_*`, `OPEN_MEDICATION_JOURNEY`, `arcus-medj-btn2`, `aa_medicationJourney`, `mj-*`, `MedicationJourney` — do not rename. |
| Single `sendResponse` per handler | `MJ_FETCH_XLS` and all background handlers guard against double-response. Don't add paths that call `sendResponse` twice. |
| Guard symbol on `document` not `window` | Angular wipes `window` props on SPA nav. Use `document[Symbol.for("...")]`. |

---

## Installation

1. `chrome://extensions` → Developer mode ON
2. **Load unpacked** → select `BKNPharmacyPortal/`
3. **No per-install registration needed.** The server grants login-less writes to any `chrome-extension://` origin coming from a trusted subnet (`BKN_TRUSTED_SUBNETS`, default `10.134.0.0/16`) — the extension ID is not checked, so reloading from any folder works. If a workstation sits on a different subnet, add it to that env var. See `pharmacy_server/RISK-TREATMENT.md`.
4. Start the pharmacy server: `python pharmacy_server/bkn_ks_server.py`

---

## File Layout

```text
BKNPharmacyPortal/
├── manifest.json
├── background.js       (message hub; daily 15:00 auto-report alarm → offscreen doc)
├── content_script.js   (legacy: MRD table, drug delivery, dispense-workbench scrape)
├── popup.html / popup.js / styles.css
├── offscreen-report.html / offscreen-report.js   (headless: parse daily Jasper XLS for the auto-report)
├── welcome.html/.js
├── formulary/
├── knowledge/
├── kpi/
├── schedule/
├── vaccine/
├── db/             (iv_history.json — currently unused; iv_sticker.js uses localStorage instead)
├── images/
├── cdnjs/   (jsPDF)
└── src/
    ├── core/           (messages, utils, dom, storage)
    ├── shared/         (shared-data-client, translate-core, medical-glossary)
    ├── main-world/     (arcus-xhr-tap.js, early-sec-relay.js — incus-token capture; capture-persist.js — medreconcile capture → pharmacy server)
    ├── features/
    │   ├── home-med/
    │   ├── med-sticker/
    │   ├── patient-sticker/
    │   ├── adrtimeline/
    │   ├── med-journey/
    │   ├── iv-aux-sticker/   (iv_sticker.*, aux_sticker.*)
    │   ├── beedee-pdf/       (pdf.html/.js, beedee_report.json)
    │   └── report-print/    (report_print.html/.js/.css)
    ├── styles/         (overlay.css)
    ├── assets/fonts/   (THSarabunNew, Sarabun)
    └── vendor/         (jsbarcode.min.js)
```
