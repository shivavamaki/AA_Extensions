# CLAUDE.md

Guidance for Claude Code working in this repository. This file is a **lightweight index** — keep it that way. Repo-wide invariants live here; everything else lives in the linked READMEs.

## Repo overview

Internal tooling monorepo for the **BKN Hospital Pharmacy Department**. Chrome extensions + a Python backend, all targeting **ArcusAir** (`arcusair.bdms.co.th`, an AngularJS 1.x SPA).

```text
EXT/
├── BKNPharmacyPortal/   ← primary extension (ACTIVE — v3.10.0)
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

### Cross-feature APIs live on `window`, not messages
`hmr`'s Ward View card calls `hmq`'s queue directly via `window.BKN_HMQ = { addCase, completeActiveByHn }` (set by `content-hmq.js`, consumed by `content-hmr.js`) — both content scripts run in the same page/world, so a plain `window` object avoids a `chrome.runtime` round-trip. If a third feature needs the queue, extend this object rather than adding a new message type.

### ArcusAir report pipeline is shared — keep both reports consistent
The **Home Medication Sheet** (`/api/report/home-med-api`) and **Medication Journey** (`/api/report/med-journey`) both build from one server-side normaliser, `_normalize_orderitems` in `bkn_ks_server.py` (maps items, drops non-medicines/cancelled). De-dupe by `(drug, code)` — never code alone (`011001` is shared by all non-formulary meds). Phase comes from the stable `ordertypeuid` valuecode (`ORDERTYPE_PHASE_BY_CODE`), not the free-text label. The by-meal card grouping is client-side and **shared** via `window.BKNMealSlots` (`src/shared/meal-slots.js`) — edit the engine once, both report pages follow.

### Medication reconciliation data is client-captured, not server-fetched
ArcusAir has two relevant calls: `emr/medicationhistory/getdetails` auto-fires on page load with no reusable ID in the request, so `arcus-xhr-tap.js` passively caches that **response** (`window.__arcus_medhistory__`, keyed by `patientvisituid`) as a fallback. But `ordermanagement/medreconcile/getdetail` — fired by clicking "View" (`viewMedReconcileN`) on a record in ArcusAir's own Med Reconcile list — carries `{"medreconcileuid": "..."}` in its **request body**, which the same tap grabs into `window.__arcus_medrecon__`. `hmr`'s Step 5 auto-clicks the newest record's View button (`viewMedReconcile0`) to force that call, then persists whichever of `medreconcileuid`/`medreconcileSnapshot` it got onto the HMR record. `bkn_ks_server.py`'s `_resolve_reconcile_meds()` prefers a live `fetch_arcus_medreconcile()` call using the stored `medreconcileuid` (confirmed shape, works across sessions/days as long as a fresh `incusToken` is supplied) and only falls back to the shape-guessed `medreconcileSnapshot` if no uid is available. See [`BKNPharmacyPortal/src/features/hmr/README.md`](BKNPharmacyPortal/src/features/hmr/README.md#step-5--med-reconcile-semi-automated).

### Server safety
Single-file stdlib server. JSON writes use `_atomic_write_json` (temp + `os.replace`). Static files served via `_serve_file_under` / `_path_within`. `TRUSTED_EXTENSION_ORIGINS` trusts any `chrome-extension://` origin for writes.

### Environment
Windows over UNC path (`\\10.134.10.70\Pharmacy`). Prefer PowerShell for filesystem ops; quote paths with spaces.
