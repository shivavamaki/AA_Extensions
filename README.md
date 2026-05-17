# AA Extensions — BKN Hospital Pharmacy

> Internal tooling monorepo for the **BKN Hospital Pharmacy Department**  
> Three Chrome extensions and a local backend server, all targeting the Arcusair clinical workbench.

![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-Internal-grey)

---

## Projects

| Folder | Name | Type | Description |
|---|---|---|---|
| [`rx_menu/`](rx_menu/) | BKN Pharmacy | Chrome Extension v2.1 | IV/auxiliary label printing, IPD queue, reports, quick links, formulary, knowledge hub |
| [`AAOverlay/`](AAOverlay/) | Discharge Process Checklist | Chrome Extension v2.3.14 | Discharge tools injected into Arcusair: home-med sheet, med stickers, patient stickers, med reconciliation, allergy cards |
| [`Automate/`](Automate/) | Arcus Toolkit | Chrome Extension v4.0.0 | One-click automation of Auto Dispense and IP Fill workflows on Arcusair |
| [`pharmacy_server/`](pharmacy_server/) | Knowledge Sharing Server | Python (stdlib only) | Local REST API backing KPI tracking, knowledge sharing, and pharmacy master data |

---

## rx_menu — BKN Pharmacy Extension

Full documentation: [rx_menu/README.md](README.md) *(root README covers this extension in detail)*

**Key features:**
- IV Sticker: generate and print IV labels for IPD patients (HAD, PFS, ATB, Cytotoxic, EYE types)
- Auxiliary Sticker: premix and mixing labels (10×5 cm sheet, 6 labels per sheet)
- IPD Queue: load active inpatient list from Arcusair MRD, push Visit IDs to Drug Delivery
- Reports: RT_COMMON_257 dispensing report, RT_COMMON_917 stock picking PDF
- Formulary, Knowledge Hub, and KPI viewer (backed by `pharmacy_server/`)
- Quick links to internal hospital systems

---

## AAOverlay — Discharge Process Checklist

Full documentation: [AAOverlay/README.md](AAOverlay/README.md)

**Key features:**
- Injects buttons directly into the Arcusair Discharge and Dispense Workbench routes
- Home Medication Sheet: formatted A4 printable from the discharge dialog med table
- Medication Sticker: dispense order sticker printing with POM list overlay
- Patient Sticker: barcode patient ID labels (JsBarcode)
- Medication Reconciliation, Allergy Card, Patient Address, Unreceivable Medications pages
- Shared Thai ↔ English medical glossary for drug name translation

---

## Automate — Arcus Toolkit

Full documentation: [Automate/README.md](Automate/README.md)

**Key features:**
- Floating control panel injected into Arcusair Dispense Workbench and IP Fill queue
- Automates order row iteration with configurable filters (pharmacy type, status)
- Live progress stats and step-by-step action log
- Popup for one-click navigation to each workflow

---

## pharmacy_server — Knowledge Sharing Server

Full documentation: [pharmacy_server/README.md](pharmacy_server/README.md)

**Key features:**
- Single Python file, no dependencies beyond stdlib (Python 3.6+)
- REST API for daily KPI documents, med-error logging, knowledge sharing collections
- Master data endpoints for IV drugs, premix drugs, mixing protocols, and pharmacy staff
- Serves static files from `www/` alongside the API

**Start the server:**
```bash
cd pharmacy_server
python bkn_ks_server.py          # default port 8765
python bkn_ks_server.py --port 9000
```

---

## Host Integrations

| Host | Used by |
|---|---|
| `arcusair.bdms.co.th` | All three extensions (Arcusair clinical workbench) |
| `10.134.10.91` (Drug Delivery) | `rx_menu` — IPD queue push |
| `bdmsgroup-my.sharepoint.com` | `rx_menu` — SharePoint document access |
| `script.google.com` | `rx_menu` — Med Rec Google Apps Script trigger |
| `translate.googleapis.com` | `AAOverlay` — Drug name translation |
| `localhost:8765` | `rx_menu` — pharmacy_server API |

---

## Installing the Extensions

All extensions are internal-only and not published to the Chrome Web Store.

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** for each extension folder (`rx_menu/`, `AAOverlay/`, `Automate/`)

---

Maintained by BKN Hospital Pharmacy Department · Internal use only
