# ADR Drug Timeline (`adrtimeline`)

A 📊 timeline page showing a patient's drug and ADR history across an admission, with editable custom events and manual medications that persist per-patient on the server.

> **Naming caveat:** the user-facing feature is "ADR Timeline" but internal identifiers remain `MedicationJourney` / `MJ_*` / `arcus-medj-btn2` / `aa_medicationJourney` / `mj-*`. These are load-bearing contracts across content scripts, pages, and the service worker — **do not rename them.** This feature is distinct from `med-journey`.

## Where it runs

- **`content-adrtimeline.js`** injects the 📊 button on the ArcusAir order-profile page (`/emr/emrview/emr/orders`) and orchestrates context extraction, Jasper XLS fetch, and page open (`OPEN_MEDICATION_JOURNEY`).
- The MAIN-world XHR/fetch tap (`src/main-world/arcus-xhr-tap.js`) is installed via a manifest-declared `world: "MAIN"`, `document_start` content script — **not** on demand via `MJ_SETUP_XHR_TAP` — so `incus-token` and the session UIDs are captured before ArcusAir's Angular app fires its first authenticated call. `content-adrtimeline.js` still sends `MJ_SETUP_XHR_TAP` as a no-op-safe fallback (the tap is idempotent, guarded by `window.__arcus_xhr_tap_installed__`).
- `src/main-world/early-sec-relay.js` (also `document_start`) listens for the tap's `postMessage({ __bkn_sec__: 1, ... })` and forwards it to background via `BKN_SEC_HDR_RELAY` → `chrome.storage.session`. Both scripts must load at `document_start` together — if the relay listener isn't attached yet when the tap posts, the message is lost (not queued).

## Patient-context extraction (the hard part)

`adrtimeline-core.js::extractArcusPatientContext` + the MAIN-world `_arcusExtractAngularCtx` in `background.js` run a **layered multi-strategy chase**: URL params → `$stateParams` → scope walk → Angular DI → DOM scrape → Jasper links → XHR tap fallback.

`patientuid` and `patientvisituid` live in separate Angular scopes, so multiple strategies are needed. Changes here touch both files; test across several patients.

## Files

| File | Role |
|---|---|
| `content-adrtimeline.js` | Button injection, XHR-tap setup, orchestration, toast |
| `adrtimeline-core.js` | `MedicationJourney` namespace: context extraction, helpers |
| `adrtimeline-jasper.js` | Jasper report URL building and XLS handling |
| `adrtimeline-parser-html.js` | HTML/report parsing into timeline rows |
| `page-adrtimeline.html/.js` | Timeline UI with multi-event/range editing and print |
| `adrtimeline.css` | Timeline styling |

## Persistence

Custom events and manual meds auto-save (debounced ~600ms) via `BKNData.saveAdrTimeline` → **`PUT /api/patients/{puid}/adr-timeline`**, reloaded on next open.

See [`../../shared/README.md`](../../shared/README.md) for `BKNData`.

## Gotchas

- Uses the shared `.bkn-tool-group` factory from patient-sticker. Falls back to a compatible self-built group if it runs before patient-sticker (unlikely in normal load order).
- `MJ_FETCH_XLS` uses an aborting timeout + single-response guard — don't add paths that can call `sendResponse` twice.
- Window guard: `Symbol.for("__ARCUS_MEDJ2__")` on `window`.
