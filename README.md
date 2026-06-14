# AA Extensions — BKN Hospital Pharmacy

> Internal tooling monorepo for the **BKN Hospital Pharmacy Department**  
> Chrome extensions + a Python backend, all targeting ArcusAir (`arcusair.bdms.co.th`).

![Extension Version](https://img.shields.io/badge/BKNPharmacyPortal-v3.0.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-Internal-grey)

---

## Active Projects

| Folder | Name | Description |
|---|---|---|
| [`BKNPharmacyPortal/`](BKNPharmacyPortal/) | **BKN Pharmacy Portal** (v3.0.0) | Primary extension — unified portal merging all pharmacy tools |
| [`Automate/`](Automate/) | Arcus Toolkit | Separate utility extension for Auto Dispense / IP Fill automation |
| [`pharmacy_server/`](pharmacy_server/) | Knowledge Sharing Server | Python stdlib backend for KPI, scheduling, master data, and medication DB |

> **Legacy rollback copies** (`rx_menu/`, `AAOverlay/`) have been removed. All their functionality is live in `BKNPharmacyPortal/`.

---

## BKNPharmacyPortal — BKN Pharmacy Portal

Full documentation: [BKNPharmacyPortal/README.md](BKNPharmacyPortal/README.md)

Unified MV3 Chrome extension merging two predecessor extensions (`rx_menu` + `AAOverlay`) under a shared pharmacy-server data layer (`BKNData`).

**Feature areas (injected into ArcusAir):**

| Feature | Description |
|---|---|
| Home Med Sheet | Discharge medication sheet (Thai, printable, with photos and editable lines) |
| Med Sticker | Medication labels from dispense workbench / POM list |
| Patient Sticker | Patient ID / address / med-reconcile / allergy / unreceivable labels |
| ADR Drug Timeline | Drug Gantt chart with ADR events, multi-range editing, print-to-one-page |
| Med Journey | Per-drug continuity grid across encounters |

**Top-level extension pages (popup tabs):**

| Page | Description |
|---|---|
| IV / Aux Sticker | IV label printing (HAD, PFS, ATB, Cytotoxic, EYE) and premix mixing labels |
| IPD Queue | Active inpatient list from ArcusAir MRD → push to Drug Delivery |
| Reports | RT_COMMON_257 dispensing report, RT_COMMON_917 stock picking PDF |
| Formulary | Drug formulary browser |
| Knowledge Hub | Internal knowledge sharing |
| KPI Viewer | Daily KPI tracking backed by pharmacy server |
| Schedule | Staff shift schedule with booking rules and auth gate |
| Vaccine | Vaccine schedule viewer |

**Load unpacked:** `chrome://extensions` → Developer mode → **Load unpacked** → `BKNPharmacyPortal/`

---

## Automate — Arcus Toolkit

Full documentation: [Automate/README.md](Automate/README.md)

Floating control panel injected into ArcusAir Dispense Workbench and IP Fill queue. Automates order row iteration with configurable filters, live progress stats, and step-by-step action log.

**Load unpacked:** `chrome://extensions` → **Load unpacked** → `Automate/`

---

## pharmacy_server — Knowledge Sharing Server

Full documentation: [pharmacy_server/README.md](pharmacy_server/README.md)

Single-file Python (stdlib only, 3.6+) `ThreadingHTTPServer`. All cross-workstation data flows through this server — extensions fetch fresh on each request (no localStorage caches).

**Key endpoints:** KPI documents, med-error log, knowledge collections, booking/schedule state, medication DB (images + instructions), frequency master, order item labels.

**Start the server:**
```bash
cd pharmacy_server
python bkn_ks_server.py          # default port 8765
python bkn_ks_server.py --port 9000
```

On Windows: `start_server.bat`. Server URL stored in Chrome extension storage under `bknks.serverUrl`.

> **Note:** Never modify `pharmacy_server/data/` manually — protected by `.gitignore` + `--skip-worktree` so git pull won't overwrite production data.

---

## Host Integrations

| Host | Used by |
|---|---|
| `arcusair.bdms.co.th` | BKNPharmacyPortal (content scripts), Automate |
| `10.134.10.91` (Drug Delivery) | BKNPharmacyPortal — IPD queue push |
| `10.134.110.81:8765` | BKNPharmacyPortal — pharmacy server API |
| `bdmsgroup-my.sharepoint.com` | BKNPharmacyPortal — SharePoint document access |
| `script.google.com` | BKNPharmacyPortal — Med Rec Google Apps Script |
| `translate.googleapis.com` | BKNPharmacyPortal — offline fallback drug name translation |

---

## Version History

### v3.0.0 — 2026-05-28 · BKNPharmacyPortal launch (merge)
- Merged `rx_menu` (BKN Pharmacy) + `AAOverlay` (Discharge Process Checklist) into single unified MV3 extension `BKNPharmacyPortal/`
- Shared pharmacy-server data layer (`BKNData` / `shared-data-client.js`) replacing per-extension localStorage
- All cross-workstation data routed through `pharmacy_server` (no localStorage caches)

### v3.0.1 — 2026-05-29
- Booking rules editor added to Schedule page
- Trusted Chrome extension origins validated server-side without re-registering IDs
- Welcome page added; deprecated popup files removed

### v3.1.0 — 2026-06-01
- Patient sticker injected via shared `.bkn-tool-group` collapsible button strip next to `#paprint`
- Dispense route detection and toolbar button management refactored
- Debounced `MutationObserver` + `hashchange`/`popstate` guard on patient pages only

### v3.2.0 — 2026-06-02
- Animated terminal dashboard for `pharmacy_server` (Maprang game)
- Home Med Sheet: translations cached — no repeated Google Translate calls on re-render
- Patient sticker barcode fixed to use order number

### v3.3.0 — 2026-06-03
- Home Med Sheet: full Thai on first load — offline translation from `frequencymaster` + `medication-db`, no Google Translate call on initial render
- Patient instruction notes use Thai-language `localLanguage` from `orderitem_extralabel`
- Order item scraper added for medication codes and instruction export
- `pharmacy_server`: fixed-window ASCII dashboard, Maprang row layout, home-med fetch logging
- Patient sticker barcode corrected to order number (not visit number)

### v3.4.0 — 2026-06-04
- Per-feature READMEs added; lightweight `CLAUDE.md` index created
- `medication-db`: Thai + English patient instructions for medications; Atorvastatin entry added
- `pharmacy_server`: correct MIME types for webp/jxl/jfif medication images
- ADR Drug Timeline: multi-ADR events with duration bars, multi-range drug editing, print fits one page
- Standalone PowerShell Maprang dashboard for `pharmacy_server`

### v3.5.0 — 2026-06-11 — 2026-06-12
- `beedee_report.json` cost calculation fixes
- UI redesign (popup / portal layout)

---

Maintained by BKN Hospital Pharmacy Department · Internal use only
