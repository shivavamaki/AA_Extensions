# BKN Pharmacy — Knowledge Sharing Server

> Lightweight local HTTP server for the **BKN Hospital Pharmacy Department**  
> Serves KPI data, knowledge sharing content, and pharmacy drug/staff master lists.  
> **No admin rights or `pip install` required** — uses only Python standard library.

![Python](https://img.shields.io/badge/python-3.6%2B-blue)
![License](https://img.shields.io/badge/license-Internal-grey)

---

## Overview

`bkn_ks_server.py` is a single-file HTTP server that backs the KPI, Knowledge, Formulary, and IV-Sticker features of the BKN Pharmacy Chrome Extension (`rx_menu/`). It stores all data as plain JSON files and exposes a REST-like API on localhost.

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
