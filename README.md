# AA Extensions — BKN Hospital Pharmacy

> Internal tooling monorepo for the **BKN Hospital Pharmacy Department**  
> Chrome extensions + a Python backend, all targeting ArcusAir (`arcusair.bdms.co.th`, an AngularJS 1.x SPA).

---

## Active Projects

| Folder | Extension / App | Version | Description |
|---|---|---|---|
| [`BKNPharmacyPortal/`](BKNPharmacyPortal/) | BKN Pharmacy Portal | v3.5.0 | Primary extension — unified portal with all pharmacy tools |
| [`Automate/`](Automate/) | Arcus Toolkit | v4.2.0 | Separate utility — Auto Dispense / IP Fill automation panel |
| [`pharmacy_server/`](pharmacy_server/) | Knowledge Sharing Server | — | Python stdlib backend for all persistent pharmacy data |

> Legacy rollback copies (`rx_menu/`, `AAOverlay/`) have been removed. All their functionality lives in `BKNPharmacyPortal/`.

---

## Project Goal: Paperless Pharmacy Workflow

The portal is built around one goal: **less paper, faster workflow, safer pharmacy operations**.

Instead of separate printed forms, manual copying, and repeated data entry, the portal gives pharmacy staff a central browser workspace connected directly to ArcusAir and the pharmacy server.

Key outcomes:
- Reduce repeated printing and handwritten tracking
- Reuse patient and medication data across pharmacy tools
- Standardize labels, stickers, reports, and documentation
- Keep pharmacy master data server-backed and shared across workstations
- Support faster order review, preparation, dispensing, and follow-up

---

## BKNPharmacyPortal — BKN Pharmacy Portal

Full architecture: [BKNPharmacyPortal/README.md](BKNPharmacyPortal/README.md)

Unified MV3 Chrome extension merging two predecessor extensions (`rx_menu` + `AAOverlay`) under a shared pharmacy-server data layer (`BKNData`).

### ArcusAir-injected features

| Feature | What it does | README |
|---|---|---|
| Home Med Sheet | Printable A4 discharge medication sheet (Thai, photos, editable) | [home-med/README.md](BKNPharmacyPortal/src/features/home-med/README.md) |
| Med Sticker | Medication label stickers from dispense workbench / POM list | [med-sticker/README.md](BKNPharmacyPortal/src/features/med-sticker/README.md) |
| Patient Sticker | Patient ID / address / med-reconcile / allergy / unreceivable labels | [patient-sticker/README.md](BKNPharmacyPortal/src/features/patient-sticker/README.md) |
| ADR Drug Timeline | Drug Gantt chart with ADR events, multi-range editing, print-to-one-page | [adrtimeline/README.md](BKNPharmacyPortal/src/features/adrtimeline/README.md) |
| Medication Journey | Per-drug continuity grid across care phases | [med-journey/README.md](BKNPharmacyPortal/src/features/med-journey/README.md) |

Shared infrastructure: [src/shared/README.md](BKNPharmacyPortal/src/shared/README.md)

### Extension pages (popup tabs)

| Page | Description | README |
|---|---|---|
| IV / Aux Sticker | IV bag, HAD, PFS, premix, and mixing labels | — |
| IPD Queue | Active inpatient list → push to Drug Delivery | — |
| Reports | RT_COMMON_257 dispensing, RT_COMMON_917 stock picking, Beedee report | — |
| Formulary | Drug formulary browser | [formulary/README.md](BKNPharmacyPortal/formulary/README.md) |
| Knowledge Hub | Pharmacy FAQs, items, videos, shared references | [knowledge/README.md](BKNPharmacyPortal/knowledge/README.md) |
| KPI | Daily OPD/IPD/med-error KPI records | [kpi/README.md](BKNPharmacyPortal/kpi/README.md) |
| Schedule | Staff shift schedule with booking rules and auth gate | [schedule/README.md](BKNPharmacyPortal/schedule/README.md) |
| Vaccine | Vaccine schedule viewer | [vaccine/README.md](BKNPharmacyPortal/vaccine/README.md) |

**Load unpacked:** `chrome://extensions` → Developer mode → **Load unpacked** → `BKNPharmacyPortal/`

---

## Automate — Arcus Toolkit

Full documentation: [Automate/README.md](Automate/README.md)

Floating control panel injected into ArcusAir Dispense Workbench and IP Fill queue. Automates order-row iteration with configurable filters, live progress stats, and step-by-step action log.

**Load unpacked:** `chrome://extensions` → **Load unpacked** → `Automate/`

---

## pharmacy_server — Knowledge Sharing Server

Full documentation: [pharmacy_server/README.md](pharmacy_server/README.md)

Single-file Python (stdlib only, 3.6+) `ThreadingHTTPServer`. All cross-workstation data flows through this server — extensions fetch fresh on every request (no localStorage caches).

**Key data areas:**

| Data area | Purpose |
|---|---|
| `data/kpi/` | Daily KPI records, OPD/IPD summaries, medication-error log |
| `data/ks/` | Knowledge system: FAQs, items, videos, attachments |
| `data/rx/` | Medication DB, IV drugs, premix drugs, frequency master, note glossary |
| `data/schedule/` | Shift schedule state, bookings, booking rules |
| `data/patients/` | Per-patient context, ADR timeline, medication cache |

**Start the server:**
```bash
cd pharmacy_server
python bkn_ks_server.py          # default port 8765
python bkn_ks_server.py --port 9000
```

On Windows: `start_server.bat`. Server URL stored in Chrome extension storage under `bknks.serverUrl`.

> **Never modify `pharmacy_server/data/` manually** — protected by `.gitignore` + `--skip-worktree` so git pull won't overwrite production data.

---

## System Architecture

```text
BKNPharmacyPortal Chrome extension
  │
  ├── popup.html / popup.js
  │     Main 4-tab pharmacy workspace (Workspace, IPD Queue, Report, Knowledge)
  │
  ├── background.js
  │     MV3 service worker — sole message hub, BKN_SERVER_PROXY, openOrReuseTab
  │
  ├── content_script.js
  │     ArcusAir + drug-delivery page integration (legacy handlers, IPD queue)
  │
  ├── src/features/
  │     home-med, med-sticker, patient-sticker, adrtimeline, med-journey
  │     (each injects buttons + opens print/tool pages via background.js)
  │
  ├── iv_sticker, aux_sticker, welcome, pdf, report_print
  │     (extension pages — web accessible resources)
  │
  └── formulary/, knowledge/, kpi/, schedule/, vaccine/
        (standalone extension-page apps)
            │
            │  BKN_SERVER_PROXY (via background.js, bypasses CORS)
            ▼
Pharmacy Server  http://10.134.110.81:8765
  ├── /api/kpi/{date}
  ├── /api/faqs, /api/items, /api/vdos, /api/ks-files
  ├── /api/medication-db, /med-image/{code}
  ├── /api/iv-drugs, /api/premix-drugs, /api/mixing-protocols
  ├── /api/schedule/state, /api/schedule/bookings
  ├── /api/patients/{puid}/context, /adr-timeline, /medication-cache/{vuid}
  └── /api/report/home-med-api, /api/report/med-journey

ArcusAir  https://arcusair.bdms.co.th
  (Angular 1.x SPA — read via API calls proxied through pharmacy server)
```

---

## Shared Patient Data (BKNData)

`window.BKNData` (`src/shared/shared-data-client.js`) is the shared client-side data bus. It routes patient context, medication cache, and ADR timeline data through the pharmacy server so all workstations stay in sync.

Flow:
1. Content script extracts patient context from the current ArcusAir page.
2. `BKNData.setPatientContext(ctx)` caches to `chrome.storage.session` and mirrors to `PUT /api/patients/{puid}/context`.
3. Any feature (IV sticker, ADR timeline, home med, etc.) calls `BKNData.getPatientContext()` — no re-scraping.

---

## Host Integrations

| Host | Used by |
|---|---|
| `arcusair.bdms.co.th` | BKNPharmacyPortal content scripts, Automate |
| `aa-report.bdms.co.th` | BKNPharmacyPortal — Jasper report fetch |
| `10.134.10.91` (Drug Delivery) | BKNPharmacyPortal — IPD queue push |
| `10.134.110.81:8765` | BKNPharmacyPortal — pharmacy server API |
| `bdmsgroup-my.sharepoint.com` | BKNPharmacyPortal — SharePoint document access |
| `script.google.com` | BKNPharmacyPortal — Med Rec Google Apps Script |
| `translate.googleapis.com` | BKNPharmacyPortal — fallback drug name translation |

---

## Installation

1. Open Chrome → `chrome://extensions` → turn on **Developer mode**.
2. Click **Load unpacked** → select `BKNPharmacyPortal/` (or `Automate/` for the automation tool).
3. After loading, copy the extension ID and ensure it appears in `TRUSTED_EXTENSION_ORIGINS` inside `pharmacy_server/bkn_ks_server.py` for server write access.
4. Start the pharmacy server: `python pharmacy_server/bkn_ks_server.py`.

---

## Version History

### v3.5.0 — 2026-06-11 → 2026-06-12
- `beedee_report.json` cost calculation fixes
- Popup / portal UI redesign and layout improvements

### v3.4.0 — 2026-06-04
- Per-feature READMEs added; lightweight `CLAUDE.md` index created
- `medication-db`: Thai + English patient instructions; Atorvastatin entry added
- `pharmacy_server`: correct MIME types for webp/jxl/jfif medication images
- ADR Drug Timeline: multi-ADR events with duration bars, multi-range drug editing, print fits one page
- Standalone PowerShell Maprang dashboard for `pharmacy_server`

### v3.3.0 — 2026-06-03
- Home Med Sheet: full Thai on first load — offline translation from `frequencymaster` + `medication-db`, no Google Translate on initial render
- Patient instruction notes use Thai `localLanguage` from `orderitem_extralabel`
- Order item scraper added for medication codes and instruction export
- `pharmacy_server`: fixed-window ASCII dashboard, Maprang row layout, home-med fetch logging
- Patient sticker barcode corrected to order number (not visit number)

### v3.2.0 — 2026-06-02
- Animated terminal dashboard for `pharmacy_server` (Maprang game)
- Home Med Sheet: translations cached — no repeated Google Translate calls on re-render
- Patient sticker barcode fixed to use order number

### v3.1.0 — 2026-06-01
- Patient sticker injected via shared `.bkn-tool-group` collapsible button strip next to `#paprint`
- Dispense route detection and toolbar button management refactored
- Debounced `MutationObserver` + `hashchange`/`popstate` guard on patient pages

### v3.0.1 — 2026-05-29
- Booking rules editor added to Schedule page
- Trusted Chrome extension origins validated server-side without re-registering IDs
- Welcome page added; deprecated popup files removed

### v3.0.0 — 2026-05-28 · BKNPharmacyPortal launch (merge)
- Merged `rx_menu` (BKN Pharmacy) + `AAOverlay` (Discharge Process Checklist) into single unified MV3 extension `BKNPharmacyPortal/`
- Shared pharmacy-server data layer (`BKNData` / `shared-data-client.js`) replacing per-extension localStorage
- All cross-workstation data routed through `pharmacy_server`

---

Maintained by BKN Hospital Pharmacy Department · Internal use only
