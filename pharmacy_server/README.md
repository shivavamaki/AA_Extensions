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

# prefix shorthand — "starts with 10.134" (same thing, expands to 10.134.0.0/16)
BKN_TRUSTED_SUBNETS=10.134 python bkn_ks_server.py
BKN_TRUSTED_SUBNETS=10.134,192.168.20 python bkn_ks_server.py
```

Both full CIDR and the prefix shorthand are accepted; the mask follows the
number of octets given (`10.134` → `/16`, `10` → `/8`). Invalid entries are
skipped with a warning rather than aborting startup, and the effective list is
printed at startup (`[trust] login-less writes allowed from …`).

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

**Malformed routes are logged separately** to `data/logs/bad-route-*.jsonl`. A
URL carrying an unparseable identifier (classically a JS value stringified into
the path as `[object Object]`) cannot match a route, so `rtype` is `None`. A
*trusted* client hitting that case now gets a **400 "Malformed route"** instead
of falling through to a misleading 401 — the caller is trusted, so it is a
client bug, and keeping it out of the untrusted-write log stops real trust
misses being buried under client-side noise.

> **rx collections keep rolling backups.** `save_rx()` copies the current file
> into `data/rx/_backup/{col}.{timestamp}.json` before overwriting it, keeping
> the last `RX_BACKUP_KEEP` (5). These are small, pharmacist-curated files
> edited through a **whole-file PUT**, so one bad write replaces everything —
> `pattern-overrides.json` was reset to `{}` exactly that way, and `data/` is
> gitignored, so there was no other copy. To restore, copy the wanted snapshot
> back over the live file. Backups are skipped for an already-empty file, and a
> backup failure never blocks the save.

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
| `GET` | `/api/hmq?from=&to=` | Entries in a date range (newest first). **No range → today**; `?all=1` for the full history |
| `PUT` | `/api/hmr/{visitid}` | Read-merge-write. **`steps` and `checklist` are merged key-by-key**, not replaced — callers send partial patches (step 7 saves only `{steps:{allocateDispensed:'done'}}`), and a shallow assign wiped every other step. All other fields stay last-write-wins; `auditLog` always appends |
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

> **Archives are date-filtered by FILENAME before being read**
> (`_archive_in_range`). Because archives are kept forever — one file per day —
> a query that read every archive and *then* filtered got slower every day the
> feature ran (at ~1 file/day, ~365 parses/request after a year). The archive
> name already encodes its date, so a narrow query ("Today") now touches 2 files
> instead of all of them: measured **52× faster** on a synthetic year of
> archives (4281 ms → 83 ms). Entries store `createdAt` in **UTC** but are
> filtered by **Bangkok** day, so the filename window is widened by ±1 day and
> the exact `_bangkok_date_of()` check still decides — the prefilter only ever
> skips files that cannot match. `load_all_hmr()` uses the same helper.
> **Live files are cached in memory** (`_load_json_cached`, keyed by
> `(path, mtime_ns, size)`). HMQ/HMR store one file per live case/record and
> re-read all of them on every request — measured **~5.9 ms per file**, so 56
> open cases cost ~233 ms, on an endpoint the ward popup polls every **8 s**
> from every open ArcusAir tab. Caching the parsed object cuts a warm
> `/api/hmq?from=today&to=today` from **289 ms → 65 ms (4.4×)**; live updates
> stay immediate because any write bumps `mtime`. The cache hands out a **deep
> copy** (callers mutate what they load), which costs ~3 ms per 56 records
> against ~1240 ms to re-parse them.
>
> A call with **no `from`/`to` now defaults to TODAY**, not "everything" — an
> omitted or cleared date input would otherwise trigger the same unbounded scan
> the filename filter exists to avoid. A caller that genuinely wants the whole
> history must opt in explicitly with **`?all=1`**. Same default on
> `/api/hmr`. Measured against 200 archives × 25 cases: a bare `/api/hmq`
> returns today's 25 entries instead of scanning all 5000.

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

## Extension updates (3.61.0 onward)

Staff update manually using the ZIP published at `/update-extension.html`.

| Method | Path | Description |
|---|---|---|
| GET | `/api/ext-version` | Published version, extension ID, ZIP size and SHA-256 |
| GET | `/ext-download` | Extension ZIP, built on demand and cached by manifest version |
| GET | `/update-extension` or `/update-extension.html` | ZIP download and manual update instructions |
| GET | `/reload-extension` | Optional helper for copying the Chrome extensions settings address |

### Staff update steps

1. Download the ZIP and extract it into a temporary folder. Check that it contains `manifest.json`.
2. Close extension pages and back up the current installation. Replace all contents of the existing installation folder (normally `D:\pharmacy\BKNPharmacyPortal`) with the extracted contents. Keep the registered folder path; do not nest another folder beneath it.
3. Open `chrome://extensions`, enable Developer mode, and reload BKN Pharmacy Portal. Check its version matches the update page.
4. Refresh every ArcusAir tab. Close old medication sheets and open a new sheet for the selected patient.

For first installation, extract to the intended installation folder and select it with **Load unpacked**.

### Publishing

Bump `BKNPharmacyPortal/manifest.json`; the server builds the ZIP on the next version/download request. No publish script is needed. Source is `EXT_SRC_DIR` (override with `BKN_EXT_SRC`); packages are cached in `data/ext-pkg/`. Batch and CMD files are excluded from packages, along with existing development-file exclusions. Restart the server after changing its Python code.

### Retired batch deployment

Release 3.61.0 removes `www/BKN-Update-Extension.bat`, `www/bkn-install.bat`, `publish_extension.bat`, and the embedded sync-script generator. The old `/update-extension.bat`, `/BKN-Update-Extension.bat`, `/bkn-install.bat`, `/install.bat`, `/ext-sync.bat`, and `/ext-sync` routes return HTTP 410 with instructions to use the update page. The nested legacy server also retires these routes.

Existing Desktop/Downloads copies are not remotely removed; staff should delete them. Historical BAT review archives include unrelated server-start scripts and are retained as historical records, not installation packages. No server-start scripts are removed.

### 3.61.0 release notes

- Replace batch installers/updaters with manual ZIP deployment.
- Prevent the previous patient's context from reaching a new Home Medication Sheet tab (carried forward from the 3.60.1 fix).
- Clear previous launch state, isolate delayed delivery callbacks, and guard repeated clicks while patient extraction is pending.

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

### HM Process Queue dashboard

Open `/static/hmq/dashboard.html` on the pharmacy server for the queue board, statistics, date filters, search, and audit logs without installing the extension. The server home page and extension HM Queue Dashboard button link here. Assets live in `www/static/hmq/` and read the existing same-origin `/api/hmq` endpoint. The static URL works without a server restart. `/hmq-dashboard` is also available after restarting the Python server. Reload the extension to update its button. The existing `/hmq-report` remains available.

HMQ performance: the loader uses one `os.scandir` pass and enumeration metadata for the parsed-JSON cache, avoiding per-file SMB stat requests. It preserves live-over-archive precedence and checks fresh directory metadata on every query. Restart the server to activate Python loader changes. The dashboard reuses date formatting/card markup and debounces search; static asset updates apply on page reload. Regression check: `python -m unittest discover -s pharmacy_server -p test_hmq_loader.py`.

### Staff medication preparation

Open `/static/medication-preparation/index.html` (also linked as **PREPARE MEDICATION** on the server home page and **Prepare medication** in Arcus Toolkit).

1. Select the preparer's name from the same `/api/iv-staff` master used by IV stickers.
2. Scan the order number beginning with I, O, or E. Enter, Tab, or 800 ms idle submits it.
3. Wait for **Saved** or **Already recorded**, then scan the next order. The input retains focus. This is an order-level preparation acknowledgement; it does not verify individual medicines, quantities, or dispensing completion.

A name is selected explicitly on a new page. This is a staff-selected attribution, not an authenticated pharmacist signature. The server validates the selected name against the current IV staff master. Names/roles are copied into the immutable record so later master-list changes do not rewrite history.

Records are stored atomically under `data/medication-preparation/YYYY-MM-DD/<hash>.json`. The folder represents the scan's Bangkok date; `preparedAt` and `date` are server-generated receipt time/date. One record per selected staff name + exact order number + scan date prevents repeated scans from duplicating preparation counts. A different staff member produces a separate record. A retry retains the same payload, including across a page reload in the same tab. Existing records can be acknowledged on later retries; new records accept only today's or yesterday's scan date to accommodate midnight transitions.

Dashboard API:

- `POST /api/medication-preparations`: JSON `{ "staffName": "<IV staff name>", "orderNumber": "I-ORDER", "scanDate": "YYYY-MM-DD" }`. Returns `{ok, duplicate, record}`; HTTP 201 for a new event, 200 for an existing event.
- `GET /api/medication-preparations?from=YYYY-MM-DD&to=YYYY-MM-DD&orderNumber=I-ORDER&staffName=...&limit=100&offset=0`: returns `{rows,total,from,to,limit,offset}`, newest first. Dates default to today in Bangkok and filter the server receipt date. `orderNumber` is a case-insensitive substring filter; `staffName` is an exact filter. Up to 366 days and 500 rows per page. Dashboards join by `orderNumber` and display `staffName` / `preparedAt`.
- There is no edit/delete API for these preparation acknowledgements. Saves from the hosted page require same-origin requests on the configured trusted network; existing extension/session permissions remain available and other endpoint policies are unchanged.

Reload the extension to expose its new button. **Restart the Python pharmacy server to activate the new API**; the page disables saves until that API is available. No historical patient/queue records are migrated or changed.

Synthetic validation: `python -m unittest discover -s pharmacy_server -p test_medication_preparation.py` and `node pharmacy_server/test_medication_preparation_browser.cjs`.
