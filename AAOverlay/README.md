# Discharge Process Checklist

> Chrome Extension (Manifest V3) for **BKN Hospital Pharmacy Department**  
> Overlays tools directly into Arcusair — discharge checklists, medication printing, reconciliation, and allergy cards.

![Version](https://img.shields.io/badge/version-2.3.14-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-Internal-grey)

---

## Overview

AAOverlay injects a suite of clinical-workflow tools directly into the Arcusair web application. It is activated by content scripts that detect specific Angular SPA routes and inject action buttons into the existing Arcusair UI — no separate popup required for most workflows.

---

## Features

### Home Medication Sheet (`home-med`)
- Extracts the medication table from the Arcusair discharge dialog
- Opens a formatted printable sheet (A4) in a dedicated tab
- Auto-reads the logged-in pharmacist name from the toolbar
- Triggered by an injected button on the discharge process route

### Medication Sticker / Dispense Order Printing (`med-sticker`)
- Parses the order table on the Arcusair Dispense Workbench
- Opens a sticker print page pre-filled with order rows
- Supports POM list overlay (`content-pomlist.js`) for order verification

### Patient Sticker (`patient-sticker`)
- Scrapes patient demographics from the Arcusair patient banner
- Generates printable patient ID stickers with barcode (JsBarcode)
- Includes Thai/English name, HN, ward, and allergy summary

### Patient Address Page (`page-patient-address`)
- Prints a formatted mailing-address label for discharge correspondence

### Medication Reconciliation (`page-med-reconcile`)
- Opens a structured med reconciliation form pre-filled from Arcusair data
- Supports Thai translation of drug names via the shared medical glossary

### Allergy Card (`page-allergy-card`)
- Generates a wallet-sized allergy card with drug allergy list
- Includes BKN logo and patient identifiers

### Unreceivable Medications (`page-unreceivable`)
- Documents medications that cannot be dispensed with reason codes

### Discharge List Viewer (`discharge-list`)
- Parses and displays the active discharge patient list
- Debug sync page for verifying parser output against live data

### Translation Support (`shared/translate-core.js`)
- Shared Thai ↔ English medical glossary (`medical-glossary.js`)
- Used across multiple features for drug name localisation

---

## File Structure

```
AAOverlay/
├── manifest.json
└── src/
    ├── background/
    │   └── index.js                    — Service worker: tab registry, payload routing
    ├── core/
    │   ├── dom.js                      — Shared DOM helpers (createIconButton, etc.)
    │   ├── messages.js                 — Shared MSG constants
    │   ├── storage.js                  — chrome.storage wrappers
    │   ├── tabManager.js               — Open/reuse tab logic
    │   └── utils.js                    — General utilities
    ├── features/
    │   ├── discharge-list/
    │   │   ├── content-discharge-list.js
    │   │   ├── parser-discharge-list.js
    │   │   ├── viewer-discharge-list.html
    │   │   ├── viewer-discharge-list.js
    │   │   ├── debug-sync.html
    │   │   └── debug-sync.js
    │   ├── home-med/
    │   │   ├── content-home-med.js     — Injects button on discharge route
    │   │   ├── parser-home-med.js      — Extracts med table & patient banner
    │   │   ├── page-home-med.html      — A4 printable home-med sheet
    │   │   └── page-home-med.js
    │   ├── med-sticker/
    │   │   ├── content-med-sticker.js  — Injects button on dispense workbench
    │   │   ├── content-pomlist.js      — POM list overlay
    │   │   ├── parser-order-table.js   — Parses order rows from Arcusair table
    │   │   ├── page-med-sticker.html
    │   │   └── page-med-sticker.js
    │   └── patient-sticker/
    │       ├── content-patient-sticker.js
    │       ├── parser-patient.js
    │       ├── page-patient-sticker.html
    │       ├── page-patient-sticker.js
    │       ├── page-patient-address.html
    │       ├── page-patient-address.js
    │       ├── page-med-reconcile.html
    │       ├── page-med-reconcile.js
    │       ├── page-allergy-card.html
    │       ├── page-allergy-card.js
    │       ├── page-unreceivable.html
    │       ├── page-unreceivable.js
    │       └── bkh-logo.png
    ├── pages/
    │   └── popup/
    │       ├── index.html              — Extension popup (checklist controls)
    │       └── index.js
    ├── shared/
    │   ├── translate-core.js
    │   └── medical-glossary.js
    ├── assets/
    │   ├── fonts/                      — THSarabunNew & Sarabun TTF families
    │   └── bkn_med_database/
    │       ├── medication_by_code.json — BKN medication master keyed by item code
    │       └── images/                 — Drug product images (jpg/png)
    ├── styles/
    │   └── overlay.css
    └── vendor/
        └── jsbarcode.min.js            — JsBarcode (bundled locally)
```

---

## Installation

This extension is for internal use only and is not published to the Chrome Web Store.

1. Clone or download this repository
2. Open Chrome → `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `AAOverlay/` folder

To update after source changes, click the **↻** refresh icon on the extension card.

---

## Permissions

| Permission | Reason |
|---|---|
| `tabs` | Open and reuse feature tabs |
| `scripting` | Inject content scripts dynamically |
| `storage` | Persist payload between background and feature pages |
| `host: arcusair.bdms.co.th` | Inject into and read data from Arcusair |
| `host: translate.googleapis.com` | Drug name translation lookups |

---

## Development Notes

- **Framework:** Vanilla JS, no bundler. All files loaded directly by the extension manifest.
- **SPA compatibility:** `MutationObserver` detects Angular route changes on Arcusair and re-injects buttons after navigation.
- **Tab reuse:** The background service worker maintains a tab registry so feature pages (sticker, home-med, etc.) are reused rather than opened repeatedly. Payloads are written to `chrome.storage.session` before the tab is focused to avoid race conditions.
- **Barcode:** JsBarcode bundled locally in `vendor/` — no CDN dependency at print time.
- **Fonts:** THSarabunNew and Sarabun TTF families bundled in `assets/fonts/` for Thai character support in printed output.
- **Browser:** Chrome 109+ (MV3 service worker requirement)

---

Maintained by BKN Hospital Pharmacy Department · Internal use only
