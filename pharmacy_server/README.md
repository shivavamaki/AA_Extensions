# BKN Pharmacy — Knowledge Sharing Server

> Lightweight local HTTP server for the **BKN Hospital Pharmacy Department**  
> Serves KPI data, knowledge sharing content, pharmacy drug/staff master lists, and two ArcusAir-facing workflow trackers (HM Process, HM Process Queue).  
> **No admin rights or `pip install` required** — uses only Python standard library.

![Python](https://img.shields.io/badge/python-3.6%2B-blue)
![License](https://img.shields.io/badge/license-Internal-grey)

---

## Overview

`bkn_ks_server.py` is a single-file HTTP server that backs the **BKN Pharmacy Portal** extension (`BKNPharmacyPortal/`) — KPI, Knowledge, Formulary, IV-Sticker, the ArcusAir-backed **reports** (Home Medication Sheet, Medication Journey, Medication Reconciliation), and two per-visit workflow trackers (**HM Process** / `hmr`, **HM Process Queue** / `hmq`). It stores all data as plain JSON files, proxies live ArcusAir order fetches, and exposes a REST-like API on localhost.

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
| `GET` | `/api/server-status` | Dashboard JSON: endpoint health, per-module record counts, uptime, **`.arcus`** (ArcusAir call monitor) |
| `GET` | `/api/arcus-stats` | ArcusAir upstream call monitor — per-endpoint counts, avg/min/max latency, retries, error rate, last error, recent window |
| `GET` | `/api/opd-queue` | OPD dispensing queue **+ `stats`** (`?from=&to=`, newest first; default today). Stats: waiting/completed counts, `over2h/over4h/over6h` overdue buckets, `avgWaitMin`. |
| `POST` | `/api/opd-queue` | Send a case `{hn, name, visitId, patientvisituid, room, meds:[{…, store}], pharmacistNote, sentBy, context}` → stored (`queued`) + logged (`sent`). **`context`** carries the clinical picture the pharmacist reviewed — `{diagnosis, allergies, vitals, doctorNotes, visit}` — and is rendered in the queue viewer's detail panel. **Duplicate guard:** if the same visit is already queued today → `409 {error:'duplicate', completed, existing}`. Re-post with `force:true` to **update** the existing queued case (`update_opd_queue_case`, logs `resent`) instead of creating a new one; if the existing case is completed, `force` adds a fresh case (`note:'was-completed'`). |
| `PUT` | `/api/opd-queue/{id}` | `{action:'complete', user}` → mark the case `completed` (timestamp + `completedBy`) + logged. **No login required** (the `/opd-queue-view` page is first-party; cross-origin still blocked by CORS) so the Complete button works from the server page. |
| `GET` | `/api/opd-logs` | OPD event-log feed (`sent`/`completed`) + `stats` (`?from=&to=`; default today). |

**OPD queue store + monitoring:** `add_opd_queue_case` / `complete_opd_queue_case` / `list_opd_queue` write day-archived JSON (`ddmmyyyy_opd_queue.json`); every event is appended to `data/logs/opd-queue-YYYY-MM-DD.jsonl` (`_log_opd_queue`, read back by `read_opd_logs`). `opd_queue_stats` computes waiting/completed + 2h/4h/6h overdue buckets from `createdAt`. Pages: **`/opd-queue-view`** (live queue — today by default; a **fixed narrow left list** of compact cards with the detail panel always on the right, which shows the case's **full clinical context** — Dx · allergy · colour-flagged vitals · current visit · doctor notes — above the med groups the detail is styled as a **hospital prescription form** (`.rx*` — header block with HN/name/visit/physician/location, a Diagnosis/Drug-Allergy/CC/Pharmacy-Note clinical bar, and a NO · รายการ · วิธีใช้ · จำนวน · Administration Instruction · Comments · คลัง · ประเภท med table with drug-photo thumbnails, then an acknowledgment + ผู้จัด/ผู้จ่าย/ผู้สั่ง footer), mirroring the ArcusAir print layout. Each med photo (`/med-image/{code}`, 💊 fallback) **hover-zooms** to a floating enlarged image; a header **HN / barcode search** (digits-only compare so a scanner-gun scan or a partial HN like the last 4 digits matches; Enter or a single hit auto-opens the case); waiting cases **sorted by sent time** (oldest/longest-waiting first) with colour-escalating alerts; a **collapsed-by-default "เสร็จแล้ว" (completed)** section at the bottom of the list; click a case → full detail + Complete button on the right) and **`/opd-dashboard`** (stats cards + chronological activity log feed). Both auto-refresh.

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
| `POST` | `/api/ks-files/{filename}` | Upload a KS attachment (served back at `/ks-files/{filename}`) |

### Pharmacy Master Data (`data/rx/`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/premix-drugs` | Premix drug list |
| `GET` | `/api/mixing-protocols` | Mixing label protocols |
| `GET` | `/api/iv-drugs` | IV drug master list (open read) |
| `PUT` | `/api/iv-drugs` | Replace IV drug master list — **admin/editor login required** |
| `GET` | `/api/iv-staff` | Pharmacy staff list (open read) |
| `PUT` | `/api/iv-staff` | Replace pharmacy staff list — **admin/editor login required** |

> **IV Sticker DB.** `iv-drugs` / `iv-staff` are the source of truth for the
> IV/Aux Sticker; they're **seeded once** from the built-in defaults on first
> startup (only if the file is absent — existing data is never overwritten).
> Unlike other `rx` collections, their `PUT` is **not** allowed by a trusted
> extension alone — it requires a logged-in `admin`/`editor`/`super_admin`
> (`RX_ADMIN_WRITE_COLS`). Editing is done in the extension's **Pattern Editor →
> IV Sticker DB** tab; the sticker page only reads them.
| `GET` | `/api/medication-db` | BKN medication database keyed by item code |
| `POST` | `/api/medication-db/recheck` | Recompute each entry's `has_image` flag against `data/med-images/` |
| `GET`/`PUT` | `/api/pattern-overrides` | Pharmacist-curated EN→TH phrase overrides (see [`pattern-editor`](../BKNPharmacyPortal/src/features/pattern-editor/README.md)) |
| `GET`/`PUT` | `/api/chemo-drugs` | Chemo label drug DB (chemo-sticker) |
| `POST` | `/api/rx-note/{code}` | Persist a client-translated note back into `medication-db.json` |

All `GET`s on these are public; `PUT`/`POST` requires `editor`/`admin`/`super_admin` **unless** the request comes from a `chrome-extension://` origin on a trusted subnet (see *Trusted clients for login-less writes* below).

### Auth & Users (`data/auth/`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/auth/login` | `{username, password}` → session token |
| `POST` | `/api/auth/logout` | Invalidate the bearer token |
| `GET` | `/api/auth/me` | Current session `{username, role}` |
| `POST` | `/api/users` | Create a user (`super_admin` only) |
| `PUT` | `/api/users/{username}` | Update role/password (`super_admin` only) |

#### Password storage & default credentials (security)

Passwords in `data/auth/users.json` are stored as **salted PBKDF2-HMAC-SHA256**
(`pbkdf2$<iterations>$<salt>$<hash>`, per-user salt). Accounts created before this
change hold a legacy unsalted SHA-256 digest; those still log in and are
**transparently re-hashed to PBKDF2 on the next successful login** — no manual
reset needed. *(RIS_RA_2026_07)*

Default accounts are seeded **only when `users.json` is absent**. There is no
hard-coded reusable password: *(RIS_RA_2026_08)*

- Set `BKN_ADMIN_PW` / `BKN_SUPERADMIN_PW` before the first run to choose them, **or**
- leave them unset and the server generates a random one-time password and prints
  it **once** with a "change it now" notice.

Seeded accounts carry `must_change_pw: true`; the login response echoes
`mustChangePw` so the client can prompt. Changing the password clears the flag.
Restrict filesystem access to `users.json` to the server host and keep it out of
any backup that leaves the pharmacy VLAN.

#### Trusted clients for login-less writes (security)

Trust is decided by **network location, not extension ID** *(RIS_RA_2026_03)*. A
write without a login is accepted when **both** hold:

1. the `Origin` is a `chrome-extension://` origin — **any** ID, and
2. the client IP is loopback or inside a **trusted subnet**.

Chrome sets the `Origin` header itself, so an ordinary web page cannot forge a
`chrome-extension://` origin; rule 2 confines the remaining exposure to
extensions running on pharmacy workstations.

```bash
# default: 10.134.0.0/16
BKN_TRUSTED_SUBNETS=10.134.0.0/16,192.168.20.0/24 python bkn_ks_server.py
```

Invalid CIDRs are skipped with a warning, and the effective list is printed at
startup (`[trust] login-less writes allowed from …`).

> **Why not an extension-ID allowlist?** The previous treatment pinned specific
> IDs. Chrome only derives the deterministic ID from the manifest `key` when the
> extension is loaded from the folder carrying that key — an unpacked install
> from a different path, or any copy predating the key, gets a **fresh random
> ID** and is refused. Because reads are unauthenticated and only writes are
> gated, that surfaced as a populated page that silently failed to save, and was
> reported as *"the extension is missing"*. Per-machine ID registration was not
> sustainable across the ward's workstations, so `BKN_EXTENSION_IDS` and
> `TRUSTED_EXTENSION_ORIGINS` are **removed**.

**Trade-off, stated plainly:** any extension installed on a pharmacy PC can now
write. This is a deliberate exchange of ID-pinning for operational reliability,
which shifts weight onto the infra half of RIS_RT_2026_03 — **HTTPS + firewall
restricting the server to the pharmacy VLAN**. Keep the subnet list as narrow as
the addressing allows. Non-extension origins and remote hosts with no `Origin`
are still refused; `iv-drugs`/`iv-staff` still require a real admin login.

**Refused writes are logged** to `data/logs/untrusted-write-YYYY-MM-DD.jsonl`
(method, path, origin, IP, reason) and echoed to stderr, so a trust miss is
diagnosable instead of appearing as a generic 401. Requests carrying a valid
session are not logged there — those are normal logged-in writes.

### Patients (`data/patients/`)

| Method | Path | Description |
|---|---|---|
| `GET`/`PUT` | `/api/patients/{puid}` | Full patient profile |
| `GET`/`PUT` | `/api/patients/{puid}/context` | Patient context only (merge on `PUT`) |
| `GET`/`PUT` | `/api/patients/{puid}/adr-timeline` | ADR timeline data |
| `GET`/`PUT` | `/api/patients/{puid}/medication-cache/{visituid}` | Cached meds for one visit |

### Schedule (`data/schedule/`)

| Method | Path | Description |
|---|---|---|
| `GET`/`PUT` | `/api/schedule/state[?month=YYYY-MM]` | Shift schedule state (whole or one month) |
| `GET`/`PUT` | `/api/schedule/bookings` | Bookings |

### HM Process (`data/hmr/`) — one record per ArcusAir visit

Ward-view discharge-workflow tracker — see
[`../BKNPharmacyPortal/src/features/hmr/README.md`](../BKNPharmacyPortal/src/features/hmr/README.md).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/hmr?from=&to=` | All records in a date range (newest first) |
| `GET` | `/api/hmr/{visitid}` | One record (`I48-xx-xxxxxx`), `{}` if none |
| `PUT` | `/api/hmr/{visitid}` | Read-merge-write; `auditLog` entries **append**, never overwrite |

Storage: one live file per visit (`data/hmr/{visitid}.json`); a nightly job at
23:00 folds the day's live files into `data/hmr/HM_YYYY-MM-DD.json` and
deletes them (`_hmr_nightly_merge`) — `load_hmr`/`load_all_hmr` transparently
fall back to the daily archives once a visit is no longer "live".

### HM Process Queue (`data/hmq/`) — cross-workstation add/start/complete tracker

Floating popup on Ward View + the Pharmacy Return workbench — see
[`../BKNPharmacyPortal/src/features/hmq/README.md`](../BKNPharmacyPortal/src/features/hmq/README.md).

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/hmq?from=&to=` | Entries in a date range (newest first) |
| `POST` | `/api/hmq` | Add a case — `{hn, name, ward, room, addedBy}`; `409` if that HN is already `new`/`process` today |
| `PUT` | `/api/hmq/{id}` | Transition — `{action: 'start'\|'complete'\|'revert-process'\|'revert-new', user}` |

Storage: one live file per entry (`data/hmq/HMQ-YYYYMMDD-NNNN.json`). Unlike
HM Process's nightly merge, HMQ's 23:00 job only archives entries that are
already `done` into one `data/hmq/ddmmyyyy_HM_queue.json` per day (e.g.
`09072026_HM_queue.json`) and deletes just those live files — a `new`/`process`
entry stays live and untouched overnight, so a case still being worked isn't
swept into the archive mid-flight. Archive files are never deleted or
rotated by the server — they're kept indefinitely (still readable by the HMQ
Dashboard) until an admin manually cleans them up. Older `DAY_YYYY-MM-DD.json`
files written before this naming change are still read transparently, just
never written again.

### ArcusAir call monitoring

Every server-side ArcusAir fetch goes through the single `_arcus_post_json()` chokepoint, which records each call (success or final failure) into an in-memory, thread-safe monitor (`_record_arcus_call` → `_ARCUS_STATS` / `_ARCUS_RECENT`). Keyed by the **endpoint path only** — never the request body or patient ids, so no PHI is retained. `arcus_stats()` aggregates it: per-endpoint `calls / ok / err / errorRate / retries / avgMs / minMs / maxMs / lastMs / lastAt / lastError`, a totals row, and a rolling `recent` window. Exposed at **`GET /api/arcus-stats`** and embedded in `/api/server-status` under `.arcus`; the dashboard's **ARCUS MONITOR** panel renders it live (per-endpoint call count, avg latency — amber when >3 s — and an error dot). Only covers server-side calls; the `hmr` discharge fetch runs browser→ArcusAir via `background.js` and isn't seen here.

### Reports (ArcusAir-backed)

These endpoints fetch live orders from ArcusAir and shape them into printable reports. Body: `{ context: { patientuid, patientvisituid, incusToken, … } }`.

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/report/fetch` | Jasper XLS proxy (`aa-report.bdms.co.th` only — legacy path, superseded by the two routes below for Home Med / Journey) |
| `POST` | `/api/report/home-med-api` | **IPD** discharge meds (`getallorderitem`) → Home Medication Sheet: `{ patient, meds[], allMeds, allergies, appointmentText, reconcileMeds, hasReconcile }` |
| `POST` | `/api/report/home-med-opd` | **OPD** daily orders (`getallorderitem` with `ordertype:"DAILYORDER"` / `ordertypeuid:"5796e65d1526f6ebabe3b4a4"`, by patientuid + patientvisituid) → OPD Medication Sheet, same shape. Identical `orderitems[]` shape as IPD, so it reuses `_normalize_orderitems` with **no adapter**; no reconcile, but **includes** follow-up appointments (`getfuturebookingforpatient`). Adds `visitHistory` — up to `OPD_HISTORY_MAX` (20) visits' meds from a `patientorder/search` call (`fetch_arcus_opd_history`, `issummary:false`, by patientuid) grouped by visit, current visit excluded (`build_opd_visit_history` → `build_visit_history_groups`); the client slices to its selected window. Also tags each current med `continuity` (`continued`/`adjusted`/`''`) vs. the default (`OPD_HISTORY_DEFAULT` = 5) window (`tag_meds_continuity`). Adds `visitSummary` = `{vitals, visits, doctorNotes}` for the current-visit summary panel (`build_opd_visit_summary`): **vitals** from `observation/getlatestemrbannervitalsigns` (ordered WT→O2, with H/L flags + normal range), **visits** from `summary/getemrsummaryvisit` (current visit first; department, careprovider, chief complaint), **doctorNotes** from `doctornote/search` scoped to the visit's department (careprovider names resolved from the summary; `notetext` HTML sanitised to a formatting-tag whitelist with no attributes). |
| `POST` | `/api/report/med-journey` | All orders grouped by drug into a continuity timeline: `{ patient, rows[], dates, allergies, hasReconcile, hasVisitHistory }` |
| `POST` | `/api/report/reconcile-api` | Standalone Medication Reconciliation refresh (Home Med Sheet's ↻ button) — `{ ok, reconcileMeds, hasReconcile }` |

Both Home Med and Journey build from **one shared normaliser** so they never disagree about what an order is. Rules (all in `bkn_ks_server.py`):

- **Normalise once** — `_normalize_orderitems(raw)` maps each item (`_arcus_item_to_med`), then drops non-medicines and cancelled orders. Each med also carries `priority`/`isStat` (from `orderpriorityuid`/`priorityuid` relatedvalue `S`) and `store` (`ordertodepartmentuid`/`invstoreuid` name) — the OPD Checking view auto-defaults Stat meds to the STAT group and sub-groups meds by store.
- **De-dupe by `(drug, code)`** — non-formulary items all share code `011001`; de-duping by code alone silently drops real take-home drugs (e.g. carvedilol vanishing behind sildenafil).
- **Phase by stable valuecode** — `ORDERTYPE_PHASE_BY_CODE` maps `ORDTYP3`→home, `ORDTYP2`/`ORDTYP1`→ward; the free-text label is only a fallback for unknown codes.
- **Journey noise filter** — exclude any `Intra-Op` instruction (any code/phase, incl. `51`); exclude ward-only items whose instruction is empty/`-`, or whose non-`51` code is absent from the medication DB. Discharge meds are always kept (safety net).
- **Note hygiene** — the patient note uses only `INSTYP1` instruction entries (clinician `INDIC` text never reaches the sheet) and strips cryptic 1-char codes (`D`, `X …`).
- **By-meal grouping** is client-side in `window.BKNMealSlots` (shared by both report pages), not the server.

**Medication reconciliation** is client-captured, not server-fetched: ArcusAir's own Med Reconcile page loads its list via `emr/medicationhistory/getdetails`, fired automatically on page load with no reusable ID in the request — so the extension's MAIN-world XHR tap (`arcus-xhr-tap.js`) passively caches that **response**, and the client persists it server-side as `medreconcileSnapshot` on the HMR record. `_resolve_reconcile_meds()` prefers that snapshot over a live `fetch_arcus_medreconcile()` re-fetch (which needs a `medreconcileuid` that's rarely available). `build_reconcile_meds_from_snapshot()` parses the snapshot defensively — its exact shape hasn't been confirmed against a live capture, so an empty result means "shape not recognized yet," not "no reconciliation data."

### Static Files

All files under `www/` are served as static content from the root path, including:

| Path | Page |
|---|---|
| `/` or `/dashboard` | `dashboard.html` — retro terminal-style server dashboard (module counts, endpoint health, "Maprang" sprite animation) |
| `/hmr-report` | `hmr-report.html` — HM Process report viewer (date-range table, per-visit audit log, CSV export) |
| `/hmq-report` | `hmq-report.html` — HM Process Queue report viewer (same pattern) |
| `/index` | `index.html` — legacy static index |

---

## Data Layout

```
pharmacy_server/
├── bkn_ks_server.py        — Single-file server (stdlib only)
├── start_server.bat        — Windows launcher
├── maprang_app.py          — Desktop GUI wrapper (calls start_server_background())
├── data/
│   ├── kpi/YYYY-MM-DD.json         — one file per day
│   ├── ks/{faqs,items,vdos}.json
│   ├── ks/files/                   — KS attachment uploads
│   ├── rx/{premix-drugs,mixing-protocols,iv-drugs,iv-staff,medication-db,
│   │        pattern-overrides,chemo-drugs}.json
│   ├── auth/                       — user accounts (password hashes)
│   ├── schedule/                   — shift schedule state + bookings
│   ├── patients/{patientuid}.json  — one file per patient (context, ADR, med cache)
│   ├── hmr/{visitid}.json          — live HM Process records
│   ├── hmr/HM_YYYY-MM-DD.json      — daily archive (23:00 nightly merge)
│   ├── hmq/HMQ-YYYYMMDD-NNNN.json  — live HM Process Queue entries
│   ├── hmq/ddmmyyyy_HM_queue.json  — daily archive (23:00 nightly merge, 'done' entries only;
│   │                                  kept forever until an admin cleans it up)
│   ├── med-images/                 — medication photo uploads
│   ├── temp-reports/               — downloaded Jasper XLS files
│   └── logs/                       — home-med fetch logs, request logs
└── www/
    ├── index.html            — legacy static index
    ├── dashboard.html/.css/.js — server dashboard
    ├── hmr-report.html       — HM Process report viewer
    ├── hmq-report.html       — HM Process Queue report viewer
    └── static/               — dashboard assets (sprite sheet, etc.)
```

> **Never modify `data/` manually** — protected by `.gitignore` + `.gitattributes merge=ours` + `--skip-worktree` so `git pull` won't overwrite production data.

---

## Configuration

| Setting | Default | How to change |
|---|---|---|
| Port | `8765` | `--port` CLI argument |
| Data directory | `./data/` | Hardcoded relative to script location |
| CORS | `*` (all origins) | Modify `_cors()` in the script |
| Login-less write trust | any `chrome-extension://` origin from `10.134.0.0/16` or loopback | `BKN_TRUSTED_SUBNETS` env var (comma-separated CIDRs) |

---

## Windows

Double-click `start_server.bat` to launch the server in a terminal window. It calls `python bkn_ks_server.py` and keeps the window open.

---

## Development Notes

- All data is stored as UTF-8 JSON files — no database required.
- The server uses Python's built-in `http.server.BaseHTTPRequestHandler` (`ThreadingHTTPServer`).
- CORS headers are set on every response to allow the extension (running on `chrome-extension://` origin) to call the API.
- Atomic writes use `_atomic_write_json` (temp file + `os.replace`), serialized per-path via `_lock_for()` so two PUTs to the same file within one process don't race.
- `main()` (CLI entry point) and `start_server_background()` (used by the desktop GUI, `maprang_app.py`) both call the same `_init_data_dirs()` — don't reintroduce a second inlined copy of that setup.
- Compatible with Python 3.6+ and runs without any third-party packages.

---

Maintained by BKN Hospital Pharmacy Department · Internal use only
