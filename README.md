# AA Extensions — BKN Hospital Pharmacy

> Internal tooling monorepo for the **BKN Hospital Pharmacy Department**  
> Chrome extensions + a Python backend, all targeting ArcusAir (`arcusair.bdms.co.th`, an AngularJS 1.x SPA).

---

## Active Projects

| Folder | Extension / App | Version | Description |
|---|---|---|---|
| [`BKNPharmacyPortal/`](BKNPharmacyPortal/) | BKN Pharmacy Portal | v3.12.0 | Primary extension — unified portal with all pharmacy tools |
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
| Home Med Sheet | Printable A4 discharge medication sheet (Thai, photos, editable, Checklist card, Medication Reconciliation/POM panel) | [home-med/README.md](BKNPharmacyPortal/src/features/home-med/README.md) |
| Med Sticker | Medication label stickers from dispense workbench / POM list | [med-sticker/README.md](BKNPharmacyPortal/src/features/med-sticker/README.md) |
| Patient Sticker | Patient ID / address / med-reconcile / allergy / unreceivable labels | [patient-sticker/README.md](BKNPharmacyPortal/src/features/patient-sticker/README.md) |
| ADR Drug Timeline | Drug Gantt chart with ADR events, multi-range editing, print-to-one-page | [adrtimeline/README.md](BKNPharmacyPortal/src/features/adrtimeline/README.md) |
| Medication Journey | Per-drug continuity grid across care phases | [med-journey/README.md](BKNPharmacyPortal/src/features/med-journey/README.md) |
| HM Process | Ward-view discharge workflow card — Med Reconcile capture, checks, Allocate/Dispense automation, HM Process Queue integration | [hmr/README.md](BKNPharmacyPortal/src/features/hmr/README.md) |
| HM Process Queue | Cross-workstation floating popup tracking New Case → On Process → Completed, plus a read-only history Dashboard in the extension popup | [hmq/README.md](BKNPharmacyPortal/src/features/hmq/README.md) |
| Pattern Editor | Admin page for curated EN→TH phrase overrides (Home Med translation) | [pattern-editor/README.md](BKNPharmacyPortal/src/features/pattern-editor/README.md) |

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
| `data/rx/` | Medication DB, IV drugs, premix drugs, pattern overrides, chemo drugs |
| `data/schedule/` | Shift schedule state, bookings, booking rules |
| `data/patients/` | Per-patient context, ADR timeline, medication cache |
| `data/hmr/` | HM Process records (one per visit; nightly-merged daily archives) |
| `data/hmq/` | HM Process Queue entries (one per case; nightly-merged daily archives) |
| `data/auth/`, `data/med-images/`, `data/logs/`, `data/temp-reports/` | Users, medication photos, request/fetch logs, downloaded Jasper XLS |

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
  │     home-med, med-sticker, patient-sticker, adrtimeline, med-journey,
  │     hmr (HM Process), hmq (HM Process Queue), pattern-editor
  │     (each injects buttons + opens print/tool pages via background.js;
  │      hmr and hmq talk to each other directly via window.BKN_HMQ)
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
  ├── /api/iv-drugs, /api/premix-drugs, /api/mixing-protocols, /api/pattern-overrides, /api/chemo-drugs
  ├── /api/schedule/state, /api/schedule/bookings
  ├── /api/patients/{puid}/context, /adr-timeline, /medication-cache/{vuid}
  ├── /api/hmr, /api/hmr/{visitid}         — HM Process
  ├── /api/hmq, /api/hmq/{id}              — HM Process Queue
  └── /api/report/home-med-api, /api/report/med-journey, /api/report/reconcile-api

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

### v3.12.0 — 2026-07-09
- **New: HM Queue Dashboard** — a read-only history view of the HM Process
  Queue, opened from the extension popup's **Ward & OPD** section (`src/features/hmq/page-hmq-dashboard.html`).
  Same visual language as the Ward View floating popup, laid out as a
  3-column board (New Case / On Process / Completed) with a date-range
  filter (Today/7d/30d + custom From–To), HN/name search, and the same
  per-case audit-log modal — but no Start/Complete/Revert actions, since it's
  meant for browsing history across workstations/days rather than working
  the live queue

### v3.11.0 — 2026-07-08
- **HM Process — Step 5 "Med Reconcile" automation**: drives ArcusAir's EMR → Med Reconcile menu, then stops and injects a "▶ Continue" button next to the page's eConsent icon so the pharmacist can review the list first. ArcusAir's own Med Reconcile page loads its medication list via `emr/medicationhistory/getdetails`, fired automatically on page load with no reusable ID in the request — `arcus-xhr-tap.js` now passively caches that response (`window.__arcus_medhistory__`) instead of trying to trigger/await it, and the step persists it server-side as `medreconcileSnapshot` on the HM Process record
- Fixed `resolvePatientVisitUid()` returning `null` even on Ward View with the card fully populated — it was missing the third fallback tier (`ctx.data.patientCtx`) that `fetchDischargeInfo()` already used successfully on the same card; also now resolves up front while still on Ward View instead of re-deriving it after navigating to the EMR pages, where the DOM it depends on no longer exists
- **Home Med Sheet — Medication Reconciliation panel**: new right-sidebar panel (mirrors the left print-control sidebar) listing the patient's pre-admission/home meds by status (continue/stop/change/new, only `stopped` non-addable); selected items are added to the medicine table tagged **POM** (Patient's Own Medication) via the sheet's existing `_addMed()` primitive, `source: "pom"` preserved through the save/reload cache path; server prefers the client-captured snapshot over a live ArcusAir re-fetch (`_resolve_reconcile_meds`)
- HM Process Queue: added ↺ revert buttons (On Process → New Case, Completed → On Process, both logged), remembers popup position across reloads, resizable width, and a "จัดการยาเสพติดค้างจ่าย" single "✓ Completed" button replacing the old YES/NO pair (no meaningful "NO" state)
- Every automated ArcusAir click that changes the DOM/URL now fires Escape 3× afterward (`dismissAlerts()`) to close any native/AngularMaterial dialog it pops — deliberately not applied to the auto-dispense flow, which already distinguishes alert vs. override dialogs and needs the override dialog to stay open for a manual reason + save
- `pharmacy_server`: `_role()` (dead code, never called) removed; `main()`'s inlined data-directory setup now calls the existing `_init_data_dirs()` instead of duplicating it; `data/hmr/` and `data/hmq/` are now eagerly created at startup like every other data directory

### v3.10.0 — 2026-07-07
- **New: HM Process Queue** (`src/features/hmq/`) — a floating, draggable, minimizable popup (no close button by design) shared across Ward View and the Pharmacy Return workbench, tracking patients through New Case → On Process → Completed. Cross-workstation via the pharmacy server (`/api/hmq`, `/api/hmq/{id}`), with a duplicate guard keyed on HN, a daily-reset queue number, per-patient audit log, and a nightly 23:00 merge into per-day archives (same pattern as HM Process below). Exposes `window.BKN_HMQ` so other content scripts can add/complete cases without reimplementing the server calls
- **New: HM Process** (`src/features/hmr/`, server-side `/api/hmr`) — formalized the ward-view discharge workflow card into its own documented feature: auto-detected Discharge Status/Home Med/Meds Returned, a semi-automated Step 7 (Allocate/Dispense, ported from the `Automate` extension's auto-dispense loop) with a draggable floating overlay, and HM Process Queue integration buttons in the card header
- **Home Med Sheet**: added a read-only Checklist card to the footer (mirrors the HM Process card's checks, fetched by HN), moved Physician to an inline line above Diagnosis, and renamed the Physician/Pharmacist footer box to "ลงชื่อเภสัชกร" — ผู้ตรวจสอบรายการยา (name) + ผู้จ่ายยา (blank signature line); appointment card restyled with the same blue-header treatment used by the new cards
- Fixed the by-meal page counter under-counting pages when the Daily Pill Journey Card is forced onto its own printed page — it now rounds the meal card's height up to whole pages independently instead of summing heights before dividing, since a forced page break always wastes whatever room was left on the previous page

### v3.8.6 — 2026-06-28
- **Medication Journey redesign** — the `ช่วงการใช้ยา` column now shows an in-table phase timeline (admission → ward → home) with the shared axis in the column header; the `สถานะ` column moved last and is screen-only (colour + legend carry status on paper); the standalone Drug Timeline page was removed
- **Shared by-meal engine** — new `src/shared/meal-slots.js` (`window.BKNMealSlots`), used by both the Medication Journey and Home Medication Sheet so the "Daily Pill Journey Card" groups meds identically; bare once-daily meds default to the morning slot
- **Home Med Sheet** — added an optional by-meal page with `แนบหน้า จัดตามมื้อ` + `ขึ้นหน้าใหม่ (จัดตามมื้อ)` toggles; reworked the control panel into a pastel-green left sidebar; removed the dead Paper select and the Hide-logo toggle
- **Server report pipeline** — Home Med + Journey now build from one `_normalize_orderitems` pass: de-dupe by `(drug, code)` (fixes non-formulary `011001` meds being dropped), phase from the stable `ordertypeuid` valuecode, intra-op/supply/empty-instruction filtering, and INSTYP1-only note hygiene
- Added PDPA-blurred presentation assets under `src/features/med-journey/screenshots/`; registered `src/shared/meal-slots.js` in `web_accessible_resources`

### v3.6.6 — 2026-06-16
- Added `BKNPharmacyPortal/test/test-pattern-matcher.js` — a standalone Node test harness for the Home Med Sheet's offline pattern matcher (`medical-glossary.js`), loaded via `vm` with no browser/build step; run with `node test/test-pattern-matcher.js`
- Added a "Pattern Editor" admin page (`src/features/pattern-editor/`, opened from the popup) so pharmacy staff can add/correct curated English→Thai phrase translations without a code deploy — persisted server-side to a new `data/rx/pattern-overrides.json` via the existing generic rx-collection REST routes (`GET`/`PUT /api/pattern-overrides`)
- `matchAuxiliaryPhrase()` in `medical-glossary.js` now checks `window.PATTERN_OVERRIDES` (fetched by `page-home-med.js` at load) before the hardcoded phrase table, so overrides take effect immediately on next sheet load — the regex-based qty/frequency/timing engine itself stays code-only by design

### v3.6.5 — 2026-06-16
- Home Med Sheet: rounded the medicine table's own corners (8px, matching the other containers) — `border-collapse: collapse` silently ignores `border-radius` on cells in Chrome, so the table switched to `border-collapse: separate` with each cell drawing only its right/bottom edge (plus an explicit left/top edge on the first column/row) to keep the same 1px grid look while letting corner radius work; print mode has its own corner rules since the hidden action column shifts which column is visually first

### v3.6.4 — 2026-06-16
- Home Med Sheet: removed the table's outer 1.5px border (the table now only frames the medicine grid via its own cell borders) — moving the header into `<thead>` had left a stray black box around the logo/patient/diagnosis area
- Home Med Sheet: patient-info card and diagnosis/allergy banner now share one merged outer container (`.patient-clinical-card`) instead of two separately-bordered boxes — same internal styling, single frame
- Home Med Sheet: footer `appt-box` (นัดหมายติดตามอาการ) widened, `providers-box` (Physician/Pharmacist) narrowed — `grid-template-columns: 2fr .8fr`

### v3.6.3 — 2026-06-16
- Home Med Sheet: removed all `text-decoration: underline` emphasis (per pharmacy feedback) — emphasis is plain `font-weight: 400` only now
- Home Med Sheet: removed the "Medication instructions" section-title line above the table — the table is self-explanatory
- Home Med Sheet: header (logo/title), patient-info card, and diagnosis/allergy banner moved into `#medTable`'s `<thead>` so they repeat automatically on every printed page, not just the first
- Home Med Sheet: added a print-only "Page X / Y" counter, bottom-right of the sheet (`#pageCounter`) — current page via CSS `counter(page)`, estimated total via `updatePageCounterTotal()` in `page-home-med.js`

### v3.6.2 — 2026-06-16
- Home Med Sheet: compacted header/logo, patient-info card, and diagnosis/allergy banner (reduced margins, padding, gaps, and font sizes) — no more empty vertical space between sections
- Home Med Sheet: `.section-title` ("Medication instructions" etc.) redesigned from a full-width colored banner into a compact floating pill badge
- Home Med Sheet: medication table's Qty column header simplified from "Qty / Days" / "จำนวน / วัน" to "Qty" / "จำนวน" since only quantity is shown

### v3.6.1 — 2026-06-16
- Home Med Sheet: reverted the v3.5.5 `THSarabunNew-Bold.ttf` `@font-face` registration — no font-family/face change, single `Sarabun-Regular` face as before
- All emphasis that used `font-weight: 700/800` (patient field labels/values, diagnosis/allergy banner, section titles, `.med-name`, `.instruction-text`, the per-medicine หมายเหตุ `.comment` box, footer labels) now uses `text-decoration: underline` with normal weight instead of bold

### v3.6.0 — 2026-06-16
- **Refactor — feature-based reorganization, no behavior change.** Moved root-level loose files into `src/features/`: `iv_sticker.*` + `aux_sticker.*` → `src/features/iv-aux-sticker/`; `pdf.html/.js` + `beedee_report.json` → `src/features/beedee-pdf/`; `report_print.*` → `src/features/report-print/`. All path references (`manifest.json` web_accessible_resources, `popup.js`/`background.js`/`content_script.js` `chrome.runtime.getURL(...)` calls, `pdf.html`'s relative `cdnjs/` script paths) updated accordingly; each new folder has its own README.
- **Removed dead code** found during the reorg audit (all confirmed unreachable — no sender/caller existed anywhere in the repo): `background.js` handlers for `extFetch`, `toggleSidebar`, `sendSelection`, `getSelection`, `saveFile` (+ its entire orphaned Google Drive upload chain: `fetchFileFromUrl`/`uploadFileToDrive`/`getAccessToken` — `chrome.identity` wasn't even a declared permission, so this was non-functional besides being unreachable), and the stub `getDataByTag`; the unused `"contextMenus"` permission and its dead `chrome.contextMenus.onClicked` listener (no `contextMenus.create()` exists anywhere); `content_script.js`'s generic-router cases `getDataByTag`/`getDataBySelector`/`getInputValueBySelector`/`getDataByTagTable`/`getMrdRows` and the `collectMrdRows()` helper; `popup.js`'s unused `msgTab()` function.
- Fixed a stale doc reference: `src/features/home-med/README.md` documented a `parser-home-med.js` file that doesn't exist in the repo.
- Noted but left untouched: `BKNPharmacyPortal/db/iv_history.json` is unreferenced — `iv_sticker.js` persists history via `localStorage['iv_history']` instead.

### v3.5.5 — 2026-06-16
- Home Med Sheet: appointment box (`นัดหมายติดตามอาการ`) now shows a bullet marker per card so multiple bookings are visually distinct, not just stacked boxes
- Home Med Sheet: registered the missing Bold face for the `Sarabun` font family (`THSarabunNew-Bold.ttf`, no `Sarabun-Bold.ttf` was ever shipped) — every existing `font-weight: 700/800` rule, including the per-medicine หมายเหตุ note box, was silently rendering as Regular weight because the browser had no bold glyph to match against

### v3.5.4 — 2026-06-16
- Fixed `incus-token` (ArcusAir session auth) frequently showing as missing in Home Med / ADR Timeline / Medication Journey context, blocking report fetches
- `src/main-world/arcus-xhr-tap.js`: the `setRequestHeader`/`open`/`send`/`fetch` hooks that capture the token now install via a manifest-declared `world: "MAIN"`, `document_start` content script, instead of being injected on demand at `document_idle` — previously ArcusAir's first authenticated XHR (carrying the token) often fired before the tap was installed
- `src/main-world/early-sec-relay.js`: added the `window.addEventListener("message", ...)` listener that forwards the tap's `__bkn_sec__` postMessage to `BKN_SEC_HDR_RELAY` — this listener never existed, so the token was never actually relayed into `chrome.storage.session` regardless of timing

### v3.5.3 — 2026-06-16
- Home Med Sheet: offline translation engine — fixed `"Drink Instead of Water Every 2-3 Hours When have Symptom"` (ORS/fluid instructions) dropping the dose verb; added `_drinkVerb()` fallback in `medical-glossary.js` so the Thai output keeps "ดื่มช้าๆ" before the frequency, matching the existing `_applyVerb()` pattern for topical instructions

### v3.5.2 — 2026-06-16
- Home Med Sheet: appointment box now renders one card per booking instead of one paragraph (splits `appointmentText` on newline)
- Home Med Sheet: Physician and Pharmacist merged into a single footer box; all distinct prescribing physicians across the discharge meds are listed (not just the first)

### v3.5.1 — 2026-06-16
- Home Med Sheet: added follow-up appointment section (`นัดหมายติดตามอาการ`) to the sheet footer, replacing the static caregiver-note box
- Server: best-effort fetch of ArcusAir `getfuturebookingforpatient`, formatted as Thai appointment summary (Buddhist Era date, UTC+7 time, department, provider, comments)

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
