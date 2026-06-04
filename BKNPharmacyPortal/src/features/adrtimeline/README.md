# ADR Drug Timeline (`adrtimeline`)

A 📊 timeline page showing a patient's drug/ADR history across an admission, with editable custom events and manual medications that persist per-patient on the server.

> **Naming caveat:** the user-facing feature is "ADR Timeline" (folder + filenames renamed), but the internal identifiers are still **`MedicationJourney` / `MJ_*` / `arcus-medj-btn2` / `aa_medicationJourney` / `mj-*`**. These are load-bearing contracts across content scripts, pages, and the service worker — **do not rename them.** This is distinct from the separate `med-journey` feature.

## Where it runs
- **`content-adrtimeline.js`** injects the 📊 button on the ArcusAir order-profile (`/emr/emrview/emr/orders`) page and orchestrates context extraction, Jasper XLS fetch, and page open (`OPEN_MEDICATION_JOURNEY`).
- It installs the **MAIN-world XHR/fetch tap early** (`MJ_SETUP_XHR_TAP`) so API calls are captured during SPA navigation before the click.

## Patient-context extraction (the hard part)
`adrtimeline-core.js::extractArcusPatientContext` + the MAIN-world `_arcusExtractAngularCtx` in `background.js` run a **layered multi-strategy chase** (URL params → `$stateParams` → scope walk → Angular DI → DOM scrape → Jasper links → XHR tap fallback) because `patientuid` and `patientvisituid` live in separate Angular scopes. Changes here touch both files; test across several patients.

## Files
| File | Role |
|---|---|
| `content-adrtimeline.js` | Button injection, XHR-tap setup, orchestration, toast |
| `adrtimeline-core.js` | `MedicationJourney` namespace: context extraction, helpers |
| `adrtimeline-jasper.js` | Jasper report URL building / XLS handling |
| `adrtimeline-parser-html.js` | HTML/report parsing into timeline rows |
| `page-adrtimeline.html/.js` | Timeline UI + editing |
| `adrtimeline.css` | Timeline styling |

## Persistence
- Custom events / manual meds auto-save (debounced ~600ms) via `BKNData.saveAdrTimeline` → **`PUT /api/patients/{puid}/adr-timeline`**, reloaded on next open. See [`../../shared/README.md`](../../shared/README.md).

## Gotchas
- Uses the shared `.bkn-tool-group` factory from patient-sticker (falls back to a compatible self-built group if it runs first).
- `MJ_FETCH_XLS` uses an aborting timeout + single-response guard — don't reintroduce paths that can call `sendResponse` twice.
- Guard: `Symbol.for("__ARCUS_MEDJ2__")` on `window`.
