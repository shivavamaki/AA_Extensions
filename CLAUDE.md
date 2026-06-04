# CLAUDE.md

Guidance for Claude Code working in this repository. This file is a **lightweight index**: repo-wide invariants live here; per-feature detail lives in each feature's `README.md` (linked below). Read the relevant README when working on a specific feature.

## Repo overview

Internal tooling monorepo for the **BKN Hospital Pharmacy Department**. Chrome extensions + a Python backend, all targeting **ArcusAir** (`arcusair.bdms.co.th`, an AngularJS 1.x SPA).

```text
EXT/
├── BKNPharmacyPortal/   ← merged extension (rx_menu + AAOverlay) — primary, ACTIVE
├── rx_menu/             ← legacy: BKN Pharmacy (kept for rollback — do not edit)
├── AAOverlay/           ← legacy: Discharge Process Checklist (kept for rollback — do not edit)
├── Automate/            ← separate utility extension (Auto Dispense / IP Fill / scrapers)
└── pharmacy_server/     ← Python stdlib HTTP server (data backend)
```

**Active development: `BKNPharmacyPortal/` and `pharmacy_server/`.** Legacy `rx_menu/` and `AAOverlay/` exist only for rollback.

## Feature index → READMEs

ArcusAir-injected features (in `BKNPharmacyPortal/src/features/`):

| Feature | What it does | README |
| --- | --- | --- |
| home-med | Home Medication Sheet (discharge meds, Thai, photos, editable) | [src/features/home-med/README.md](BKNPharmacyPortal/src/features/home-med/README.md) |
| med-sticker | Medication label stickers from the dispense workbench / POM list | [src/features/med-sticker/README.md](BKNPharmacyPortal/src/features/med-sticker/README.md) |
| patient-sticker | Patient ID / address / med-reconcile / allergy / unreceivable labels | [src/features/patient-sticker/README.md](BKNPharmacyPortal/src/features/patient-sticker/README.md) |
| adrtimeline | 📊 ADR Drug Timeline (internal ids stay `MedicationJourney`/`MJ_*`) | [src/features/adrtimeline/README.md](BKNPharmacyPortal/src/features/adrtimeline/README.md) |
| med-journey | 🗺️ Medication Journey (per-drug continuity grid) | [src/features/med-journey/README.md](BKNPharmacyPortal/src/features/med-journey/README.md) |
| shared | `BKNData` bus, `HMTranslate`, medical glossary | [src/shared/README.md](BKNPharmacyPortal/src/shared/README.md) |

Top-level web-resource apps (extension pages, not injected):

| App | README |
| --- | --- |
| formulary | [formulary/README.md](BKNPharmacyPortal/formulary/README.md) |
| knowledge | [knowledge/README.md](BKNPharmacyPortal/knowledge/README.md) |
| kpi | [kpi/README.md](BKNPharmacyPortal/kpi/README.md) |
| schedule | [schedule/README.md](BKNPharmacyPortal/schedule/README.md) |
| vaccine | [vaccine/README.md](BKNPharmacyPortal/vaccine/README.md) |

The merge/architecture overview lives in [BKNPharmacyPortal/README.md](BKNPharmacyPortal/README.md).

## Running and developing

**Extension:** `chrome://extensions` → Developer mode → **Load unpacked** → `BKNPharmacyPortal/`. Reload the card after any change. **No build step, bundler, package.json, or test suite** — Chrome MV3 loads files directly.

**Server:**

```bash
cd pharmacy_server
python bkn_ks_server.py            # default port 8765 (or --port 9000)
```

Python 3.6+, stdlib only. `start_server.bat` on Windows. The extension reaches it at `http://10.134.110.81:8765` (some features also try `http://10.134.10.5:8765`).

**Verification:** no tests/lints/types exist. For UI work, reload the extension and exercise the feature in Chrome — the user expects browser verification.

**Python syntax check** — avoid `python -m py_compile` (the tracked `__pycache__/*.pyc` gets rewritten). Use:

```bash
python -c "p='pharmacy_server/bkn_ks_server.py'; compile(open(p, encoding='utf-8').read(), p, 'exec')"
```

## Repo-wide invariants (apply everywhere)

### Never touch `pharmacy_server/data/` without explicit say-so

Protected by `.gitignore` + `.gitattributes merge=ours` + `--skip-worktree` so `git pull` won't overwrite production data. Adding/moving files there defeats it. Data files are server-written.

### MV3 service worker is the only message hub — `BKNPharmacyPortal/background.js`

All cross-context messaging routes through it: `BKN_SERVER_PROXY` (server fetch, bypasses CORS), `MJ_FETCH_XLS`, `MJ_EXTRACT_ANGULAR_CTX`, `MJ_SETUP_XHR_TAP`, the `ROUTE_MAP` feature-tab openers, and verbatim legacy rx_menu handlers. `openOrReuseTab` writes the payload to `chrome.storage.session` **before** creating/focusing the tab — keep that ordering. Don't refactor legacy handlers; don't add paths that can call `sendResponse` twice.

### Content-script load order is load-bearing — `manifest.json`

ArcusAir scripts load: core utils → `shared-data-client.js` → features (home-med, med-sticker, patient-sticker, adrtimeline) → legacy `content_script.js` last. Feature scripts assume `window.BKNData` exists. All injected scripts use a `document[Symbol.for(...)]` guard (not `window` — Angular wipes window props), a **debounced** `MutationObserver`, and `hashchange`/`popstate`/`pushState` patches for SPA route changes. The legacy `content_script.js` predates this pattern — avoid broad refactors there.

### Shared `.bkn-tool-group` button strip

The 📊/🏷️/⚠️/💊 icons next to ArcusAir's `#paprint` live in a collapsible `<span class="bkn-tool-group">`. **patient-sticker** defines the CSS + factory (`document[Symbol.for("__BKN_TOOL_GROUP_FACTORY__")]`); other scripts call it. Append new icons into `.bkn-tool-flyout` — never as siblings of `#paprint`.

### Cross-workstation data → pharmacy server, not localStorage

`window.BKNData` (`src/shared/shared-data-client.js`) is the only sanctioned cross-feature data API; server URL key is `bknks.serverUrl`. The user explicitly rejected localStorage caches for cross-workstation data — fetch fresh from the server.

### Stable internal identifiers (do not rename)

`MJ_*` message types, `OPEN_MEDICATION_JOURNEY`, `aa_medicationJourney` tab key, `arcus-medj-btn2` DOM id, `mj-*` CSS hooks, and the `MedicationJourney` namespace are load-bearing even though the user-facing feature is "ADR Timeline".

### Server safety (`pharmacy_server/bkn_ks_server.py`)

Single-file stdlib server on `ThreadingHTTPServer`. JSON writes go through `_atomic_write_json` (temp + `os.replace`); static serving stays under base dirs via `_serve_file_under` / `_path_within`. `TRUSTED_EXTENSION_ORIGINS` trusts any `chrome-extension://` origin for writes (the user chose this over re-registering IDs); CORS is `*`.

### Environment

The user works on Windows over a UNC path (`\\10.134.10.5\BKNinfo\24 Pharmacy\EXT`). Prefer PowerShell for filesystem ops; quote paths with spaces.
