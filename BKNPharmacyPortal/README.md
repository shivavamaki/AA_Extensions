# BKN Pharmacy Portal

Unified Chrome MV3 extension for BKN Hospital Pharmacy. Combines the former **BKN Pharmacy** (`rx_menu`) and **Discharge Process Checklist** (`AAOverlay`) extensions into one portal backed by a shared pharmacy server.

**Version:** 3.5.0 · **Manifest:** MV3 · **Target:** ArcusAir (`arcusair.bdms.co.th`, AngularJS 1.x SPA)

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
| Home Med Sheet | Dispense workbench (DISCHARGE MEDICATION) | Printable A4 Thai medication sheet | [src/features/home-med/README.md](src/features/home-med/README.md) |
| Med Sticker | Dispense workbench / POM list | Medication label stickers with barcode | [src/features/med-sticker/README.md](src/features/med-sticker/README.md) |
| Patient Sticker | Patient EMR banner | Patient ID / address / allergy / unreceivable labels | [src/features/patient-sticker/README.md](src/features/patient-sticker/README.md) |
| ADR Drug Timeline | Order-profile page | Drug Gantt with ADR events, editable, server-persisted | [src/features/adrtimeline/README.md](src/features/adrtimeline/README.md) |
| Medication Journey | (opened from ADR Timeline context) | Per-drug continuity grid across care phases | [src/features/med-journey/README.md](src/features/med-journey/README.md) |

Shared infrastructure (translation engine, data bus): [src/shared/README.md](src/shared/README.md)

### Extension pages (popup tabs)

| Page | Description |
|---|---|
| IV / Aux Sticker | IV bag, HAD, PFS, ATB, Cytotoxic, EYE labels and premix mixing labels |
| IPD Queue | Active inpatient list from ArcusAir MRD → push to Drug Delivery |
| Reports | RT_COMMON_257 dispensing report, RT_COMMON_917 stock picking, Beedee report export |
| Formulary | Drug formulary browser · [formulary/README.md](formulary/README.md) |
| Knowledge Hub | Pharmacy FAQs, items, videos, shared references · [knowledge/README.md](knowledge/README.md) |
| KPI | Daily OPD/IPD/med-error KPI records · [kpi/README.md](kpi/README.md) |
| Schedule | Staff shift schedule with booking rules · [schedule/README.md](schedule/README.md) |
| Vaccine | Vaccine schedule viewer · [vaccine/README.md](vaccine/README.md) |

---

## Architecture

```text
popup.html / popup.js
  └── 4-tab workspace (Workspace | IPD Queue | Report | Knowledge)

background.js  ← sole message hub (MV3 service worker)
  ├── BKN_SERVER_PROXY  — all server fetches (bypasses CORS)
  ├── openOrReuseTab    — writes payload to chrome.storage.session BEFORE tab open
  ├── ROUTE_MAP         — feature-tab openers
  ├── MJ_FETCH_XLS      — Jasper XLS fetch (single-response guard)
  ├── MJ_EXTRACT_ANGULAR_CTX  — MAIN-world Angular DI extraction
  └── MJ_SETUP_XHR_TAP  — XHR/fetch tap setup

Content scripts (load order in manifest.json — load-bearing):
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

- Server URL key: **`bknks.serverUrl`** in `chrome.storage.local` — falls back to `http://10.134.110.81:8765`
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
3. After loading, copy the extension ID and verify it is in `TRUSTED_EXTENSION_ORIGINS` in `pharmacy_server/bkn_ks_server.py`
4. Start the pharmacy server: `python pharmacy_server/bkn_ks_server.py`

---

## File Layout

```text
BKNPharmacyPortal/
├── manifest.json
├── background.js
├── content_script.js
├── popup.html / popup.js / styles.css
├── iv_sticker.html/.js/.css
├── aux_sticker.html/.js/.css
├── welcome.html/.js
├── pdf.html/.js
├── report_print.html/.js/.css
├── beedee_report.json
├── formulary/
├── knowledge/
├── kpi/
├── schedule/
├── vaccine/
├── db/
├── images/
├── cdnjs/   (jsPDF)
└── src/
    ├── core/           (messages, utils, dom, storage)
    ├── shared/         (shared-data-client, translate-core, medical-glossary)
    ├── features/
    │   ├── home-med/
    │   ├── med-sticker/
    │   ├── patient-sticker/
    │   ├── adrtimeline/
    │   └── med-journey/
    ├── styles/         (overlay.css)
    ├── assets/fonts/   (THSarabunNew, Sarabun)
    └── vendor/         (jsbarcode.min.js)
```
