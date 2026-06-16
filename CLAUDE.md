# CLAUDE.md

Guidance for Claude Code working in this repository. This file is a **lightweight index** — keep it that way. Repo-wide invariants live here; everything else lives in the linked READMEs.

## Repo overview

Internal tooling monorepo for the **BKN Hospital Pharmacy Department**. Chrome extensions + a Python backend, all targeting **ArcusAir** (`arcusair.bdms.co.th`, an AngularJS 1.x SPA).

```text
EXT/
├── BKNPharmacyPortal/   ← primary extension (ACTIVE — v3.6.0)
├── Automate/            ← separate utility extension (Auto Dispense / IP Fill)
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
| shared | [src/shared/README.md](BKNPharmacyPortal/src/shared/README.md) |

Extension pages:

| App | README |
| --- | --- |
| formulary | [formulary/README.md](BKNPharmacyPortal/formulary/README.md) |
| knowledge | [knowledge/README.md](BKNPharmacyPortal/knowledge/README.md) |
| kpi | [kpi/README.md](BKNPharmacyPortal/kpi/README.md) |
| schedule | [schedule/README.md](BKNPharmacyPortal/schedule/README.md) |
| vaccine | [vaccine/README.md](BKNPharmacyPortal/vaccine/README.md) |
| iv-aux-sticker | [src/features/iv-aux-sticker/README.md](BKNPharmacyPortal/src/features/iv-aux-sticker/README.md) |
| beedee-pdf | [src/features/beedee-pdf/README.md](BKNPharmacyPortal/src/features/beedee-pdf/README.md) |
| report-print | [src/features/report-print/README.md](BKNPharmacyPortal/src/features/report-print/README.md) |

Extension architecture: [BKNPharmacyPortal/README.md](BKNPharmacyPortal/README.md)

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
All cross-context messaging routes through it. `openOrReuseTab` writes payload to `chrome.storage.session` **before** creating/focusing the tab. Don't add paths that can call `sendResponse` twice.

### Content-script load order is load-bearing (`manifest.json`)
Load order: core utils → `shared-data-client.js` → features → legacy `content_script.js` last. Feature scripts assume `window.BKNData` exists. All injected scripts use `document[Symbol.for(...)]` guard (not `window`), a **debounced** `MutationObserver`, and SPA route patches.

### Shared `.bkn-tool-group` button strip
**patient-sticker** defines the CSS + factory (`document[Symbol.for("__BKN_TOOL_GROUP_FACTORY__")]`). All other scripts call it. Append new buttons into `.bkn-tool-flyout` — never as siblings of `#paprint`.

### Cross-workstation data → pharmacy server, not localStorage
`window.BKNData` (`src/shared/shared-data-client.js`) is the only sanctioned cross-feature data API. No localStorage caches for cross-workstation data.

### Stable internal identifiers — do not rename
`MJ_*` message types, `OPEN_MEDICATION_JOURNEY`, `aa_medicationJourney` tab key, `arcus-medj-btn2` DOM id, `mj-*` CSS hooks, `MedicationJourney` namespace — load-bearing even though the user-facing feature is "ADR Timeline".

### Server safety
Single-file stdlib server. JSON writes use `_atomic_write_json` (temp + `os.replace`). Static files served via `_serve_file_under` / `_path_within`. `TRUSTED_EXTENSION_ORIGINS` trusts any `chrome-extension://` origin for writes.

### Environment
Windows over UNC path (`\\10.134.10.70\Pharmacy`). Prefer PowerShell for filesystem ops; quote paths with spaces.
