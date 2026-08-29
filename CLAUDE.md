# CLAUDE.md

Guidance for Claude Code working in this repository. This file is a **lightweight index** — keep it that way. Repo-wide invariants live here; everything else lives in the linked READMEs.

## Repo overview

Internal tooling monorepo for the **BKN Hospital Pharmacy Department**. Chrome extensions + a Python backend, all targeting **ArcusAir** (`arcusair.bdms.co.th`, an AngularJS 1.x SPA).

```text
EXT/
├── BKNPharmacyPortal/   ← primary extension (ACTIVE — v3.45.0)
├── Automate/            ← separate utility extension (Auto Dispense / IP Fill)
├── chemo_sticker/       ← standalone chemo label web app (no build step)
└── pharmacy_server/     ← Python stdlib HTTP server (data backend)
```

**Full project documentation:** [README.md](README.md)

## Feature index → READMEs

ArcusAir-injected features (`BKNPharmacyPortal/src/features/`):

| Feature | README |
| --- | --- |
| home-med | [src/features/home-med/README.md](BKNPharmacyPortal/src/features/home-med/README.md) |
| med-sticker | [src/features/med-sticker/README.md](BKNPharmacyPortal/src/features/med-sticker/README.md) |
| patient-sticker | [src/features/patient-sticker/README.md](BKNPharmacyPortal/src/features/patient-sticker/README.md) |
| adrtimeline | [src/features/adrtimeline/README.md](BKNPharmacyPortal/src/features/adrtimeline/README.md) |
| med-journey | [src/features/med-journey/README.md](BKNPharmacyPortal/src/features/med-journey/README.md) |
| hmr (HM Process) | [src/features/hmr/README.md](BKNPharmacyPortal/src/features/hmr/README.md) |
| hmq (HM Process Queue) | [src/features/hmq/README.md](BKNPharmacyPortal/src/features/hmq/README.md) |
| pattern-editor | [src/features/pattern-editor/README.md](BKNPharmacyPortal/src/features/pattern-editor/README.md) |
| medrecon-comment | [src/features/medrecon-comment/README.md](BKNPharmacyPortal/src/features/medrecon-comment/README.md) |
| shared | [src/shared/README.md](BKNPharmacyPortal/src/shared/README.md) |

Extension pages:

| App | README |
| --- | --- |
| formulary | [formulary/README.md](BKNPharmacyPortal/formulary/README.md) |
| knowledge | [knowledge/README.md](BKNPharmacyPortal/knowledge/README.md) |
| kpi | [kpi/README.md](BKNPharmacyPortal/kpi/README.md) |
| pending-code | [pending-code/README.md](BKNPharmacyPortal/pending-code/README.md) |
| schedule | [schedule/README.md](BKNPharmacyPortal/schedule/README.md) |
| vaccine | [vaccine/README.md](BKNPharmacyPortal/vaccine/README.md) |
| iv-aux-sticker | [src/features/iv-aux-sticker/README.md](BKNPharmacyPortal/src/features/iv-aux-sticker/README.md) |
| beedee-pdf | [src/features/beedee-pdf/README.md](BKNPharmacyPortal/src/features/beedee-pdf/README.md) |
| report-print | [src/features/report-print/README.md](BKNPharmacyPortal/src/features/report-print/README.md) |
| chemo-sticker | [`chemo-sticker/`](BKNPharmacyPortal/chemo-sticker/) — extension page clone of the standalone app; drug DB backed by `GET/PUT /api/chemo-drugs` on the pharmacy server |

Extension architecture: [BKNPharmacyPortal/README.md](BKNPharmacyPortal/README.md)

## Standalone apps

| App | Path | Notes |
| --- | --- | --- |
| chemo-sticker | [`chemo_sticker/`](chemo_sticker/) | Standalone chemo label web app — open `index.html` directly in a browser, no build step. Drug list seeded from `chemo_drugs_default.json`. Thai fonts bundled in `fonts/`. |

## Running

**Extension:** `chrome://extensions` → Developer mode → **Load unpacked** → `BKNPharmacyPortal/`. Reload after any change. No build step.

**Server:**
```bash
cd pharmacy_server
python bkn_ks_server.py   # default port 8765
```

**Python syntax check:**
```bash
python -c "p='pharmacy_server/bkn_ks_server.py'; compile(open(p, encoding='utf-8').read(), p, 'exec')"
```

## Repo-wide invariants

### `pharmacy_server/data/` — never touch without explicit say-so
Protected by `.gitignore` + `.gitattributes merge=ours` + `--skip-worktree`. Data files are server-written.

### `background.js` is the only message hub
All cross-context messaging routes through it. `openOrReuseTab` writes payload to `chrome.storage.session` **before** creating/focusing the tab, reuses an existing tab via `tabRegistry`, and falls back to `chrome.tabs.query({url})` when the MV3 worker restarted and lost the registry — so a feature page never opens twice. Don't add paths that can call `sendResponse` twice.

### `openOrReuseTab` delivers the payload TWICE — feature pages must dedupe
`background.js` writes the payload to `chrome.storage.session` **and** sends the message; both are needed (storage for a newly-created tab whose listener isn't attached yet, the message for a **reused** tab). A reused tab therefore receives both, so any page that renders on each will do its work twice — for `home-med` that meant every ArcusAir fetch firing twice (~900ms wasted per open). Dedupe on payload identity (`home-med`'s `_lastRenderKey` = `patientuid|patientvisituid`), never on a bare "already rendered" flag, or reopening the same tab for a different patient silently shows stale data. The other `storage.session.get` pages (`adrtimeline`, `med-journey`, `med-sticker`, `patient-sticker`, `page-allergy-card`, `page-med-reconcile`) share the pattern; they're cheap today but the same guard applies if they gain remote fetches.

### No inline event handlers in extension pages (MV3 CSP)
The extension CSP (`script-src 'self'`) **blocks inline handlers** — `onerror=`, `onclick=`, `onload=` etc. written into template-string HTML throw *"Refused to execute inline event handler"* at runtime. Build the markup without them and attach listeners in JS after injecting (e.g. `_bindReviewMeds` binds the drug-photo `error` fallback). Same for inline `<script>`, `javascript:` URLs, and `eval`. Server-hosted pages under `pharmacy_server/www/` are a normal origin and aren't bound by this.

### Content-script load order is load-bearing (`manifest.json`)
Load order: core utils → `shared-data-client.js` → features → legacy `content_script.js` last. Feature scripts assume `window.BKNData` exists. All injected scripts use `document[Symbol.for(...)]` guard (not `window`), a **debounced** `MutationObserver`, and SPA route patches.

### Shared `.bkn-tool-group` button strip
**patient-sticker** defines the CSS + factory (`document[Symbol.for("__BKN_TOOL_GROUP_FACTORY__")]`). All other scripts call it. Append new buttons into `.bkn-tool-flyout` — never as siblings of `#paprint`.

### Cross-workstation data → pharmacy server, not localStorage
`window.BKNData` (`src/shared/shared-data-client.js`) is the only sanctioned cross-feature data API. No localStorage caches for cross-workstation data.

### Stable internal identifiers — do not rename
`MJ_*` message types, `OPEN_MEDICATION_JOURNEY`, `aa_medicationJourney` tab key, `arcus-medj-btn2` DOM id, `mj-*` CSS hooks, `MedicationJourney` namespace — load-bearing even though the user-facing feature is "ADR Timeline". Likewise `HMR`/`hmr-*` naming throughout the `hmr` feature is historical ("Home Medication Review") even though the user-facing name is "HM Process".

### `PUT /api/hmr/{visitid}` merges `steps`/`checklist` — never shallow-assign them
Callers send **partial** patches: step 7 finishes on a different page from the Ward View card and saves only `{steps:{allocateDispensed:'done'}}`. A plain `doc[k] = v` replaced the whole `steps` object, so a completed Med Reconcile silently reverted to pending the moment Allocate/Dispense finished. The server deep-merges `steps` and `checklist` (`MERGE_KEYS`); everything else stays last-write-wins and `auditLog` always appends. Clearing still works — an explicit value in the patch overwrites, so ↺ revert and Reset are unaffected. The step-7 overlay also re-reads the record and merges client-side before saving, since its in-memory state is stale by then.

### A report context needs the whole ArcusAir session, not just `incusToken`
`_arcus_headers()` rebuilds ArcusAir's request headers from the context object a feature sends: `useruid`←`loginuid`, `roleuid`, `orguid`←`organisationuid`, `parentorguid`, `departmentuid`. Omit them and the server sends **blank** headers — ArcusAir then simply never answers (`getallorderitem` hangs rather than 401ing), so the page sits on "loading" with the request `(pending)` forever. Any new caller of `/api/report/*` must carry the same set `content-home-med.js`'s extractor does; the tap stores both spellings (raw header `useruid`/`orguid`, normalised `loginuid`/`organisationuid`), so read either. `background.js`'s `BKN_SERVER_PROXY` has a 90s `AbortController` timeout so a wedged upstream surfaces as an error instead of an unsettled promise.

### Cross-feature APIs live on `window`, not messages
`hmr`'s Ward View card calls `hmq`'s queue directly via `window.BKN_HMQ = { addCase, completeActiveByHn }` (set by `content-hmq.js`, consumed by `content-hmr.js`) — both content scripts run in the same page/world, so a plain `window` object avoids a `chrome.runtime` round-trip. If a third feature needs the queue, extend this object rather than adding a new message type.

### ArcusAir report pipeline is shared — keep both reports consistent
The **Home Medication Sheet** (`/api/report/home-med-api`) and **Medication Journey** (`/api/report/med-journey`) both build from one server-side normaliser, `_normalize_orderitems` in `bkn_ks_server.py` (maps items, drops non-medicines/cancelled). De-dupe by `(drug, code)` — never code alone (`011001` is shared by all non-formulary meds). Phase comes from the stable `ordertypeuid` valuecode (`ORDERTYPE_PHASE_BY_CODE`), not the free-text label. The by-meal card grouping is client-side and **shared** via `window.BKNMealSlots` (`src/shared/meal-slots.js`) — edit the engine once, both report pages follow.

### Medication reconciliation data is client-captured, not server-fetched
ArcusAir has two relevant calls: `emr/medicationhistory/getdetails` auto-fires on page load with no reusable ID in the request, so `arcus-xhr-tap.js` passively caches that **response** (`window.__arcus_medhistory__`, keyed by `patientvisituid`) as a fallback. But `ordermanagement/medreconcile/getdetail` — fired by clicking "View" (`viewMedReconcileN`) on a record in ArcusAir's own Med Reconcile list — carries `{"medreconcileuid": "..."}` in its **request body**, which the same tap grabs into `window.__arcus_medrecon__`. `hmr`'s Step 5 auto-clicks the newest record's View button (`viewMedReconcile0`) to force that call, then persists whichever of `medreconcileuid`/`medreconcileSnapshot` it got onto the HMR record. `bkn_ks_server.py`'s `_resolve_reconcile_meds()` prefers a live `fetch_arcus_medreconcile()` call using the stored `medreconcileuid` (confirmed shape, works across sessions/days as long as a fresh `incusToken` is supplied) and only falls back to the shape-guessed `medreconcileSnapshot` if no uid is available. See [`BKNPharmacyPortal/src/features/hmr/README.md`](BKNPharmacyPortal/src/features/hmr/README.md#step-5--med-reconcile-semi-automated).

### Master data is server-owned; seed once, never re-push from a client
The IV Sticker's drug + staff lists (`rx/iv-drugs`, `rx/iv-staff`) live on the server and are **seeded once** at first startup from `IV_DRUGS_SEED` / `IV_STAFF_SEED` in `bkn_ks_server.py` — `_init_data_dirs()` only writes when the file is absent, so existing data is never overwritten. The extension's `DEFAULT_DRUGS` / `DEFAULT_STAFF` in `iv_sticker.js` are an **offline fallback only**. A consumer page must never PUT its in-memory copy back: if the server was unreachable, that copy is the fallback list, and pushing it would silently overwrite admin edits. Editing happens in exactly one place — the admin editor. Apply this shape to any future master list.

### Write trust is by NETWORK, not extension ID
`_is_trusted_extension()` allows a login-less write when the `Origin` is **any** `chrome-extension://` origin **and** the client IP is loopback or inside `TRUSTED_SUBNETS` (`BKN_TRUSTED_SUBNETS`, default `10.134.0.0/16`; accepts prefix shorthand like `10.134`). Do **not** reintroduce an extension-ID allowlist: Chrome only derives the deterministic ID from the manifest `key` when the extension is loaded from the folder carrying that key, so unpacked installs from other paths get random IDs and silently lose the ability to save — reads are ungated, so it looks like "the extension is missing", not an auth error. The manifest `key` is kept for a stable ID but is no longer a security control. Refused writes are logged by `_log_untrusted_write` to `data/logs/untrusted-write-*.jsonl`; requests with a valid session are not logged there. An unparseable route (`rtype is None`) from a *trusted* client returns **400**, not 401, and is logged separately by `_log_bad_route` — never conflate a client-side malformed URL with an access-control failure.

### Never build a URL path from an unvalidated id
Ids reaching `/api/patients/{puid}/…` must be validated as 24-hex **strings**, not merely truthy: a JS object passes `if (id)` and stringifies into the path as `[object Object]`, producing writes the server cannot route. `shared-data-client.js` gates `loadCapture`/`saveCapture` on `_validUid()`, and `arcus-xhr-tap.js` only stores a HEX24-checked string into `visitMap`. Keep both ends validating — the server's 400 is a backstop, not the fix.

### `RX_ADMIN_WRITE_COLS` — the exception to "trusted client may write"
A trusted client normally writes rx collections without a login. Collections listed in `RX_ADMIN_WRITE_COLS` (`iv-drugs`, `iv-staff`) are deliberately **exempt**: their PUT clears `ext_data_write` and forces a real `admin`/`editor`/`super_admin` Bearer-token check, even though they ride the generic `rx` route. GET stays open so the sticker can still load. Don't "fix" this asymmetry — it's what keeps the read-only sticker page from being able to clobber the master list.

### Extension deployment: sync folder, not a server install
Chrome cannot install an unpacked extension from a URL. The server publishes the extension as a ZIP (`/ext-download`, built from `EXT_SRC_DIR`, cached per manifest version in `data/ext-pkg/`) plus a self-configuring client script (`/ext-sync.bat`); each workstation unpacks to the fixed path `D:\pharmacy\BKNPharmacyPortal` so Chrome's registered path — and the extension ID — never change. Staff run one Desktop file, `BKN-Update-Extension.bat` (served URL-injected from `/update-extension`), which is only a bootstrap: it re-fetches `/ext-sync.bat` on every run, so the copy on the PC never needs replacing. `publish_extension.bat` is the maintainer-side counterpart. **Bump the manifest version to publish**: the ZIP cache keys on it, so edits without a version bump are not served. After a successful update the script deep-links to `chrome://extensions/?id=<id>` (id computed from the manifest `key` by `_ext_id_from_key`, never hand-copied) so the reload arrow is one click away. **The reload itself cannot be automated** — Chrome blocks synthetic input on `chrome://extensions` by design, so SendKeys/AutoIt/AutoHotkey fail there too. Only a policy-managed CRX removes it, which needs Group Policy; **hospital IT has declined**, and pharmacy staff have no local admin (`gpedit.msc`/`HKLM` denied), so the `.bat` + manual reload is the permanent supported flow — don't re-propose CRX or click-automation.

### Parsed-JSON cache — `_load_json_cached` returns a COPY
HMQ/HMR keep one file per live case, and `/api/hmq` re-read them all on every request (~5.9ms/file → ~233ms at 56 open cases), which the ward popup polls every 8s from every ArcusAir tab. `_load_json_cached(path)` caches the parsed object keyed by `(path, mtime_ns, size)` — a write bumps mtime, so a stale entry can never be served, and live updates stay immediate. It returns a **deep copy** because callers mutate what they load (`load_all_hmq`'s `startedBy` backfill, `transition_hmq_entry`); handing out the cached object would let one request corrupt every later one. Copying costs ~3ms per 56 records vs ~1240ms to re-parse, so the copy is not the expensive part. Don't cache single-record loaders on write paths (`load_hmq_entry`) — freshness matters more there than the one avoided read.

### A whole-file PUT must never be built on an unloaded state
The Pattern Editor (and any editor that `PUT`s a WHOLE collection) replaces the server file outright. If its `load()` failed, `overrides` is `{}` — and the next Save writes that empty state over everything. That is how `pattern-overrides.json` became `{}`; it is **not** tracked in git, so there was nothing to restore from. Two defences, keep both: the client refuses to save unless a load actually succeeded (`_loadedOk`) and confirms when a save would drop most of what it loaded; the server snapshots the current file into `data/rx/_backup/` before every `save_rx` (last `RX_BACKUP_KEEP`). Apply the same shape to any future whole-file editor.

### Server safety
Single-file stdlib server. JSON writes use `_atomic_write_json` (temp + `os.replace`). Static files served via `_serve_file_under` / `_path_within`. Login-less writes are gated by `_is_trusted_extension()` (see *Write trust is by NETWORK* above).

### Environment
Windows over UNC path (`\\10.134.10.70\Pharmacy`). Prefer PowerShell for filesystem ops; quote paths with spaces.
