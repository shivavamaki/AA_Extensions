# Home Medication Sheet (`home-med`)

Printable A4 **เอกสารแนะนำการใช้ยากลับบ้าน** (Home Medication Sheet) listing a patient's discharge medications with Thai instructions, drug photos, a diagnosis/allergy banner, and an editable table.

## Where it runs

- **`content-home-med.js`** injects a 🏠💊 button into the ArcusAir dispense-workbench tool group when the page contains a **"DISCHARGE MEDICATION"** cell (`hasDischargeMedicationCell()`).
- On click: extracts patient/visit context (reusing the ADR Timeline / `MedicationJourney` extractor), mirrors it to `BKNData`, and opens **`page-home-med.html`** via the `LOAD_MED_TABLE` message (payload stashed in `chrome.storage.session` as `payload_sheet`).

## Data flow

1. Page receives `{ context }` (patientuid, patientvisituid, incusToken, …).
2. Calls **`POST /api/report/home-med-api`** → server hits ArcusAir `getallorderitem` (DISCHARGE MEDICATION type), returns `{ patient, meds, allMeds, allergies }`.
3. Drug photos: **`GET /api/medication-db`** (name/code index) + **`GET /med-image/{code}`** (extension-agnostic).
4. Renders an editable A4 table. User edits persist per-visit via `BKNData.saveMedCache`.

> The file-header comment mentioning a Jasper XLS flow is **stale** — the sheet now fetches from the ArcusAir API via the server.

## Files

| File | Role |
|---|---|
| `content-home-med.js` | ArcusAir button injection, context extraction, route to page |
| `page-home-med.html` | A4 layout + toolbar (language, paper, margin, scale, font, picture size) |
| `page-home-med.js` | Fetch, build editable med list, render, translate, persist |
| `parser-home-med.js` | Header-agnostic row → med mapping (legacy/report fallback) |

## Translation (offline-first, Thai default)

- Instructions render in **Thai on first load** using the offline engine only (`HMTranslate` + `medical-glossary.js`) — no Google Translate call at load time.
- The server supplies the authoritative **`frequencyTh`** (from `frequencymaster.json`). It is passed to the pattern engine as `freqOverride` via `data-freq-th`. When the English freq/timing tail can't be parsed, the engine salvages the dose verb and appends `frequencyTh`, **dropping the unparsed English tail** so the line stays fully Thai.
- **Note line** (`.note-line`) uses curated Thai from `medication-db.json` (`Patient Instruction`, else `Dispensing Instruction`). When a code has no curated Thai, the server offline-translates via `note-glossary.json` and **self-heals** by persisting the result back to `medication-db.json`.
- A persistent translation cache (`chrome.storage.local`) avoids re-translating on every add/remove re-render.

See [`../../shared/README.md`](../../shared/README.md) for the translation engine and `BKNData`.

## Gotchas

- The whole `tbody` re-renders on add/remove; the `MutationObserver` is debounced (one run per animation frame) and the translation cache keeps it cheap — don't reintroduce per-tick re-translation.
- Saved edits (`loadMedCache`) win over freshly-fetched meds; a manual note edit overrides both TH and EN values.
- The tool group is shared — append buttons into `.bkn-tool-flyout`, never as siblings of `#paprint`.
