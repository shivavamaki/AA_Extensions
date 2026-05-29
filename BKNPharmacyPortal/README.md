# BKN Pharmacy Portal

Unified Chrome extension merging **BKN Pharmacy** (rx_menu) and **Discharge Process Checklist** (AAOverlay) into a single tool. All persistent data flows through the pharmacy server.

---

## What's included

| Source       | Features                                                                                              |
|--------------|-------------------------------------------------------------------------------------------------------|
| rx_menu      | popup workspace, IV/aux labels, IPD queue, Jasper reports, KPI, knowledge, schedule, vaccine, drug delivery bridge |
| AAOverlay    | home med sheet, medication stickers, patient stickers, med reconcile, allergy card, ADR Drug Timeline |
| **NEW**      | `BKNData` cross-feature data bus, per-patient profile persistence on the pharmacy server              |

The rx_menu popup (4 tabs: Workspace / IPD Queue / Report / Knowledge) is the primary UI. AAOverlay features inject buttons directly into ArcusAir pages and are not visible in the popup — exactly as before.

---

## Installation

1. Open `chrome://extensions` in Chrome
2. Toggle **Developer mode** (top right)
3. Click **Load unpacked**
4. Select `\\10.134.10.5\BKNinfo\24 Pharmacy\EXT\BKNPharmacyPortal`

> Important — for the **trusted extension origin** check on the pharmacy server to allow auth-free writes, the extension ID must match one of the entries in `pharmacy_server/bkn_ks_server.py::TRUSTED_EXTENSION_ORIGINS`. After first load, copy the new extension ID from `chrome://extensions` and add it to that set if it differs from the legacy IDs already listed.

---

## Architecture overview

```
chrome://extensions ─┐
                     │
   ┌─────────────────┴────────────────────────────────────────────────┐
   │ BKNPharmacyPortal                                                │
   │                                                                  │
   │   popup.html      ◄──── rx_menu's 4-tab popup (unchanged)        │
   │   background.js   ◄──── unified message router + BKN_SERVER_PROXY│
   │   content_script.js ◄── rx_menu's content script (verbatim)      │
   │                                                                  │
   │   src/                                                           │
   │     core/         ◄──── AAOverlay shared utilities               │
   │     shared/                                                      │
   │       shared-data-client.js  ◄── window.BKNData (cross-feature)  │
   │     features/                                                    │
   │       home-med, med-sticker, patient-sticker, medication-journey │
   │                                                                  │
   │   formulary/, knowledge/, kpi/, schedule/, vaccine/, etc.        │
   └──────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼  (BKN_SERVER_PROXY via background)
   ┌──────────────────────────────────────────────────────────────────┐
   │ Pharmacy Server  (http://10.134.10.5:8765)                       │
   │   /api/patients/{puid}                  ← NEW                    │
   │   /api/patients/{puid}/context          ← NEW (cross-feature)    │
   │   /api/patients/{puid}/adr-timeline     ← NEW                    │
   │   /api/patients/{puid}/medication-cache ← NEW                    │
   │   /api/kpi, /api/ks, /api/rx, ...       ← unchanged              │
   │                                                                  │
   │   data/patients/{patientuid}.json       ← NEW per-patient files  │
   │   data/kpi, data/ks, data/rx, ...       ← unchanged              │
   └──────────────────────────────────────────────────────────────────┘
```

### Cross-feature data flow

1. User opens ADR Timeline on ArcusAir → patient context (`patientuid`, HN, name) is extracted
2. `content-medication-journey.js` calls `BKNData.setPatientContext(ctx)` → saved to `chrome.storage.session` **and** server (`data/patients/{puid}.json`)
3. IV Sticker / Aux Sticker / med reconcile any other feature can now call `BKNData.getPatientContext()` to retrieve the same patient without re-extraction
4. ADR Timeline edits (custom events, manual medications) auto-save via `_persistAdrTimeline()` — debounced 600ms, sent through `BKN_SERVER_PROXY` to `PUT /api/patients/{puid}/adr-timeline`
5. Next time the same patient's ADR Timeline opens, the saved events are preloaded from the server

### Why no popup tab added for AAOverlay

AAOverlay features inject directly into ArcusAir pages (med-sticker on Dispense Workbench, ADR Timeline on Orders page, etc.). They never had a popup UI and don't need one. The popup remains rx_menu's existing 4-tab layout.

---

## Migration from the two legacy extensions

| Step | Action |
|------|--------|
| 1    | Load this merged extension as unpacked |
| 2    | Verify popup features (Workspace, IPD Queue, Report, Knowledge) work as before |
| 3    | Verify ArcusAir feature buttons appear (IV Label 💉, ADR Timeline 📊) |
| 4    | Open a patient's ADR Timeline once to populate `chrome.storage.session` patient context |
| 5    | Open IV Sticker — confirm patient HN/name/room is pre-populated from shared context |
| 6    | If everything works, disable the old **BKN Pharmacy** and **Discharge Process Checklist** in `chrome://extensions` |
| 7    | Keep them disabled but don't remove for a week, in case rollback is needed |

The pharmacy server's `TRUSTED_EXTENSION_ORIGINS` still includes both legacy IDs so the old extensions keep working during the transition.

---

## File layout

```
BKNPharmacyPortal/
├── manifest.json              ← merged manifest, v3.0.0
├── background.js              ← merged: rx_menu + AAOverlay handlers + BKN_SERVER_PROXY
├── content_script.js          ← rx_menu's content script (verbatim, runs last)
├── popup.html / popup.js      ← rx_menu's 4-tab popup (unchanged)
├── styles.css                 ← rx_menu popup styling (unchanged)
├── README.md
│
├── (rx_menu pages — unchanged)
├── welcome.html, pdf.html, report_print.html
├── iv_sticker.html/.js/.css, aux_sticker.html/.js/.css
├── formulary/, knowledge/, kpi/, schedule/, vaccine/
├── cdnjs/                     ← jsPDF
├── db/                        ← bundled fallback dbs (drugs, staff, iv_history)
├── images/                    ← icons, footer
│
└── src/                       ← AAOverlay tree (unchanged content)
    ├── core/                  ← messages.js, utils.js, dom.js, storage.js
    ├── shared/
    │   ├── shared-data-client.js   ← NEW: window.BKNData
    │   ├── translate-core.js, medical-glossary.js
    ├── features/
    │   ├── home-med/
    │   ├── med-sticker/
    │   ├── patient-sticker/
    │   └── medication-journey/    ← uses BKNData for ADR persistence
    ├── assets/fonts/          ← Thai/Sarabun
    ├── styles/overlay.css
    └── vendor/jsbarcode.min.js
```

---

## Pharmacy server changes

`pharmacy_server/bkn_ks_server.py` was updated in place. The additions are **purely additive** — no existing endpoints, data files, or behavior changed.

New constants:
- `PATIENTS_DIR = data/patients`
- `TRUSTED_EXTENSION_ORIGINS = { rx_menu ID, AAOverlay ID }` (back-compat with `EXTENSION_ORIGIN`)

New endpoints:
- `GET/PUT /api/patients/{patientuid}`
- `GET/PUT /api/patients/{patientuid}/context`         (PUT merges; preserves other features' fields)
- `GET/PUT /api/patients/{patientuid}/adr-timeline`
- `GET/PUT /api/patients/{patientuid}/medication-cache/{patientvisituid}`

Existing data protection (`.gitignore` + `.gitattributes` + `--skip-worktree`) already covers `data/patients/` because it's under `data/`. The merge driver applies.

---

## Rollback

If anything breaks:

1. Re-enable old extensions in `chrome://extensions`
2. Disable BKN Pharmacy Portal
3. Existing data files on the server are untouched — old extensions read/write the same `data/kpi`, `data/ks`, `data/rx` as before
4. `data/patients/` is only consumed by the merged extension; it's harmless if unused

The merge does not modify any existing data file. Only adds new ones under `data/patients/`.
