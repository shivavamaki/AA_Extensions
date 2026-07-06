# BKN Pharmacy — Knowledge Sharing Server

> Lightweight local HTTP server for the **BKN Hospital Pharmacy Department**  
> Serves KPI data, knowledge sharing content, and pharmacy drug/staff master lists.  
> **No admin rights or `pip install` required** — uses only Python standard library.

![Python](https://img.shields.io/badge/python-3.6%2B-blue)
![License](https://img.shields.io/badge/license-Internal-grey)

---

## Overview

`bkn_ks_server.py` is a single-file HTTP server that backs the **BKN Pharmacy Portal** extension (`BKNPharmacyPortal/`) — KPI, Knowledge, Formulary, IV-Sticker, and the ArcusAir-backed **reports** (Home Medication Sheet, Medication Journey). It stores all data as plain JSON files, proxies live ArcusAir order fetches, and exposes a REST-like API on localhost.

---

## Quick Start

```bash
# Default port 8765
python bkn_ks_server.py

# Custom port
python bkn_ks_server.py --port 9000
```

The server prints its URL on startup. The extension connects to it automatically when the server is running.

---

## API Reference

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/ping` | Health check — returns the server URL |

### KPI (`data/kpi/YYYY-MM-DD.json`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/kpi` | All daily KPI documents (newest first) |
| `GET` | `/api/kpi/YYYY-MM-DD` | One day's KPI document (`null` if missing) |
| `PUT` | `/api/kpi/YYYY-MM-DD` | Replace the full day document |
| `PUT` | `/api/kpi/YYYY-MM-DD/opd-brief` | Update `opdBrief` section only |
| `PUT` | `/api/kpi/YYYY-MM-DD/ipd-brief` | Update `ipdBrief` section only |
| `PUT` | `/api/kpi/YYYY-MM-DD/opd-stat` | Update `opdStat` section only |
| `PUT` | `/api/kpi/YYYY-MM-DD/ipd-stat` | Update `ipdStat` section only |
| `POST` | `/api/kpi/YYYY-MM-DD/med-errors` | Append one medication error record |
| `DELETE` | `/api/kpi/YYYY-MM-DD/med-errors/ID` | Remove a med-error record by `savedAt` (URL-encoded) |

### Knowledge Sharing (`data/ks/`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/faqs` | FAQ collection |
| `PUT` | `/api/faqs` | Replace FAQ collection (JSON array) |
| `GET` | `/api/items` | Knowledge items collection |
| `PUT` | `/api/items` | Replace knowledge items |
| `GET` | `/api/vdos` | Video links collection |
| `PUT` | `/api/vdos` | Replace video links |

### Pharmacy Master Data (`data/rx/`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/premix-drugs` | Premix drug list |
| `GET` | `/api/mixing-protocols` | Mixing label protocols |
| `GET` | `/api/iv-drugs` | IV drug master list |
| `PUT` | `/api/iv-drugs` | Replace IV drug master list |
| `GET` | `/api/iv-staff` | Pharmacy staff list |
| `PUT` | `/api/iv-staff` | Replace pharmacy staff list |
| `GET` | `/api/medication-db` | BKN medication database keyed by item code |

### Reports (ArcusAir-backed)

These endpoints fetch live orders from ArcusAir (`getallorderitem`) and shape them into printable reports. Body: `{ context: { patientuid, patientvisituid, incusToken, … } }`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/report/home-med-api` | Discharge meds → Home Medication Sheet: `{ patient, meds[], allMeds, allergies, appointmentText }` |
| `POST` | `/api/report/med-journey` | All orders grouped by drug into a continuity timeline: `{ patient, rows[], dates, allergies, hasReconcile, hasVisitHistory }` |

Both reports build from **one shared normaliser** so they never disagree about what an order is. Rules (all in `bkn_ks_server.py`):

- **Normalise once** — `_normalize_orderitems(raw)` maps each item (`_arcus_item_to_med`), then drops non-medicines and cancelled orders.
- **De-dupe by `(drug, code)`** — non-formulary items all share code `011001`; de-duping by code alone silently drops real take-home drugs (e.g. carvedilol vanishing behind sildenafil).
- **Phase by stable valuecode** — `ORDERTYPE_PHASE_BY_CODE` maps `ORDTYP3`→home, `ORDTYP2`/`ORDTYP1`→ward; the free-text label is only a fallback for unknown codes.
- **Journey noise filter** — exclude any `Intra-Op` instruction (any code/phase, incl. `51`); exclude ward-only items whose instruction is empty/`-`, or whose non-`51` code is absent from the medication DB. Discharge meds are always kept (safety net).
- **Note hygiene** — the patient note uses only `INSTYP1` instruction entries (clinician `INDIC` text never reaches the sheet) and strips cryptic 1-char codes (`D`, `X …`).
- **By-meal grouping** is client-side in `window.BKNMealSlots` (shared by both report pages), not the server.

### Static Files

All files under `www/` are served as static content from the root path.

---

## Data Layout

```
pharmacy_server/
├── bkn_ks_server.py        — Single-file server (stdlib only)
├── start_server.bat        — Windows launcher
├── data/
│   ├── kpi/
│   │   └── YYYY-MM-DD.json — One JSON file per day
│   ├── ks/
│   │   ├── faqs.json
│   │   ├── items.json
│   │   └── vdos.json
│   └── rx/
│       ├── premix-drugs.json
│       ├── mixing-protocols.json
│       ├── iv-drugs.json
│       ├── iv-staff.json
│       └── medication-db.json
└── www/
    └── index.html          — Static web UI (served at /)
```

---

## Configuration

| Setting | Default | How to change |
|---|---|---|
| Port | `8765` | `--port` CLI argument |
| Data directory | `./data/` | Hardcoded relative to script location |
| CORS | `*` (all origins) | Modify `_set_cors_headers()` in the script |

---

## Windows

Double-click `start_server.bat` to launch the server in a terminal window. It calls `python bkn_ks_server.py` and keeps the window open.

---

## Development Notes

- All data is stored as UTF-8 JSON files — no database required.
- The server uses Python's built-in `http.server.BaseHTTPRequestHandler`.
- CORS headers are set on every response to allow the extension (running on `chrome-extension://` origin) to call the API.
- Atomic writes use a temp file + rename to prevent data corruption on crash.
- Compatible with Python 3.6+ and runs without any third-party packages.

---

Maintained by BKN Hospital Pharmacy Department · Internal use only
