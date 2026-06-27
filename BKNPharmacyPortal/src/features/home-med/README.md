# Home Medication Sheet (`home-med`)

Printable A4 **เอกสารแนะนำการใช้ยากลับบ้าน** (Home Medication Sheet) listing a patient's discharge medications with Thai instructions, drug photos, a diagnosis/allergy banner, and an editable table.

## Where it runs

- **`content-home-med.js`** injects a 🏠💊 button into the ArcusAir dispense-workbench tool group when the page contains a **"DISCHARGE MEDICATION"** cell (`hasDischargeMedicationCell()`).
- On click: extracts patient/visit context (reusing the ADR Timeline / `MedicationJourney` extractor), mirrors it to `BKNData`, and opens **`page-home-med.html`** via the `LOAD_MED_TABLE` message (payload stashed in `chrome.storage.session` as `payload_sheet`).

## Data flow

1. Page receives `{ context }` (patientuid, patientvisituid, incusToken, …).
2. Calls **`POST /api/report/home-med-api`** → server hits ArcusAir `getallorderitem` (DISCHARGE MEDICATION type), returns `{ patient, meds, allMeds, allergies, appointmentText }`.
3. Drug photos: **`GET /api/medication-db`** (name/code index) + **`GET /med-image/{code}`** (extension-agnostic).
4. Renders an editable A4 table plus a follow-up appointment line. User edits persist per-visit via `BKNData.saveMedCache`.

> The file-header comment mentioning a Jasper XLS flow is **stale** — the sheet now fetches from the ArcusAir API via the server.

## Follow-up appointment section

The sheet footer shows **นัดหมายติดตามอาการ** (follow-up appointment) instead of a static caregiver-note box.

- Server-side, the same `home-med-api` handler best-effort-POSTs to ArcusAir `enterprise/appointmentschedule/getfuturebookingforpatient` (`fetch_arcus_future_appointments` in `bkn_ks_server.py`), passing `patientuid` + current UTC timestamp as `futureapptstartdate`.
- `format_appointments_th()` turns the response into a Thai summary per appointment: service type, Buddhist-Era date/time (UTC+7, via `_thai_datetime`), department, provider, and comments — appointments are joined with `\n` when there are several.
- When there are no future appointments, or the ArcusAir call fails, it returns a static fallback: *"ไม่มีนัดติดตามอาการ แต่ถ้าพบอาการผิดปรกติ…"*. The fetch is **best-effort** — a failure here never blocks the medication list from rendering.
- Client-side, `renderAppointments()` (`page-home-med.js`) splits `data.appointmentText` on `\n` and renders **one `.appt-item` card per appointment** into `#appointmentList` — so multiple bookings don't run together as one paragraph. Each non-empty card gets a `•` bullet via CSS (`.appt-item:not(.empty)::before`); the no-appointment fallback renders as a single muted `.appt-item.empty` card with no bullet.

## Patient info + diagnosis/allergy — one merged card

`.patient-card` (name/HN/visit/room) and `.clinical-banner` (diagnosis/allergy lines) sit inside a single outer wrapper, `.patient-clinical-card`, which owns the one outer border/radius/background. Neither child has its own border anymore — `.clinical-banner` gets a `border-top` divider instead. Don't re-add borders to the children; it'll double up with the wrapper's frame.

## Medicine table — rounded corners need the separate border model

`#medTable` uses `border-collapse: separate` (not `collapse`) specifically so `border-radius` renders on the corner cells — Chrome ignores cell radius under `collapse`. To avoid double-thickness grid lines under the separate model, `th`/`td` draw only their **right** and **bottom** edges; an explicit rule adds the **left** edge back on `:first-child` and the **top** edge on the column-header row. Corner radius (8px, matching the other containers) is applied via `thead tr:last-child th:first-child` / `:last-child` and `tbody tr:last-child td:first-child` / `:last-child`.

The action column (`.col-act`, screen-only edit buttons) is the true first DOM child but is hidden in print, which would shift the visible left edge/rounded corner onto the "#" column with nothing there to draw it. A `@media print` override moves the left border + corner radius from `:first-child` to `:nth-child(2)` to compensate — if the column layout changes, double-check both the screen and print corner rules still target the right cells.

## Footer layout — appointment + providers

The footer (`.footer-note`) is a 2-column grid:
- **Left** (`appt-box`, wider): the appointment card list above.
- **Right** (`providers-box`): a single merged box with two stacked sections — **Physician** then **เภสัชกร (Pharmacist)** — separated by a dashed rule, instead of three separate boxes.
  - `populateHeader()` collects **every distinct provider** across the discharge meds (`_uniquePhysicians()`), not just the first one, since a visit can involve more than one prescriber. Each name renders on its own line via `_renderProviderList()`.
  - Pharmacist stays single-value (from `context.pharmacistName`).

## Emphasis style — plain weight, no underline or bold

`page-home-med.html` registers only `Sarabun-Regular.ttf` via `@font-face` (no Bold face, by design — don't add one). All emphasis is `font-weight: 400` with no `text-decoration` — underline was tried and then explicitly removed per pharmacy feedback. Don't reintroduce bold or underline for "emphasis"; rely on layout (badges, color, spacing) instead.

## Repeating page header (print)

The logo/title row, patient-info card, and diagnosis/allergy banner live inside `#medTable`'s `<thead>` (a single `<tr class="hdr-row"><td class="hdr-cell" colspan="5">…</td></tr>` row, followed by the normal column-header `<tr>`). Browsers repeat `<thead>` content on every printed page, so the patient context reprints automatically if the medication list spans multiple A4 pages — no separate per-page reprint logic needed. Don't move these sections back out of the table, or multi-page printouts will only show patient/diagnosis info on page 1.

## Page number footer (print)

`#pageCounter` (`.page-counter`) is a `position: fixed` element, print-only, bottom-right of the sheet. The **current** page number comes from the CSS `counter(page)` trick (Chrome increments a `position: fixed` element's counter once per printed page) — no JS involved. The **total** page count has no native CSS equivalent in Chrome, so `updatePageCounterTotal()` (`page-home-med.js`, on `window.beforeprint`) estimates it from `.sheet.scrollHeight` vs. the A4 content height (297mm minus the current print margin), written to `data-total` and read via `attr(data-total)` in the `::before` content. It's an estimate, not exact pagination — close enough for "Page X / Y" on a discharge sheet.

## Daily Pill Journey Card (optional by-meal page)

An optional second page (`.mealcard-section` / `#mealcardGrid`) groups the discharge meds **by meal slot** (before/after × breakfast/lunch/dinner, then bedtime and PRN). It's gated behind the toolbar toggle **"แนบหน้า จัดตามมื้อ"** (`#includeMealCard`), which is part of the persisted print-settings config (`PRINT_CONTROL_DEFAULTS.includeMealCard` → `body.hm-with-mealcard`); when on, the card shows on screen and prints on its own page.

`renderMealCard()` runs at the end of `renderMeds()` (so it tracks add/remove/edit) and delegates bucketing + markup to the shared **`window.BKNMealSlots`** engine (`../../shared/meal-slots.js`) — the same one the Medication Journey card uses. Matching runs on `instruction + frequencyTh`, so a meal time supplied only by the authoritative Thai frequency phrase still buckets. The `.mc-*` CSS lives in this page's `<style>` (2-column masonry for portrait); empty slots are dropped so the card stays compact.

## Files

| File | Role |
|---|---|
| `content-home-med.js` | ArcusAir button injection, context extraction, route to page |
| `page-home-med.html` | A4 layout + toolbar (language, paper, margin, scale, font, picture size, by-meal page) |
| `page-home-med.js` | Fetch, build editable med list, render, translate, persist, by-meal card |

## Translation (offline-first, Thai default)

- Instructions render in **Thai on first load** using the offline engine only (`HMTranslate` + `medical-glossary.js`) — no Google Translate call at load time.
- The server supplies the authoritative **`frequencyTh`** (from `frequencymaster.json`). It is passed to the pattern engine as `freqOverride` via `data-freq-th`. When the English freq/timing tail can't be parsed, the engine salvages the dose verb and appends `frequencyTh`, **dropping the unparsed English tail** so the line stays fully Thai.
- **Note line** (`.note-line`) uses curated Thai from `medication-db.json` (`Patient Instruction`, else `Dispensing Instruction`). When a code has no curated Thai, the server offline-translates via `note-glossary.json` and **self-heals** by persisting the result back to `medication-db.json`.
- A persistent translation cache (`chrome.storage.local`) avoids re-translating on every add/remove re-render.

See [`../../shared/README.md`](../../shared/README.md) for the translation engine and `BKNData`.

### Pattern matcher test harness

`test/test-pattern-matcher.js` (repo root: `BKNPharmacyPortal/test/`) loads `medical-glossary.js` directly in Node (via `vm`, with a `window = global`-style sandbox — the file has no DOM dependency) and runs a table of `{ input, lang, opts, expect|contains }` cases through `window.matchMedicalPattern`. Run with `node test/test-pattern-matcher.js` (add `--verbose` to print passes too). Add new rows whenever a real ArcusAir instruction string exposes a parsing gap.

### Pattern overrides (editable, no code deploy)

`matchAuxiliaryPhrase()` checks `window.PATTERN_OVERRIDES` (a dict of `{ phrase: { th, en, ... } }`, keyed by the lowercased/trimmed English phrase) **before** the hardcoded `AUXILIARY_PHRASES` table, so a pharmacist-curated phrase wins and new verbatim phrases can be added without touching `medical-glossary.js`. `page-home-med.js`'s `_loadPatternOverrides()` fetches `GET /api/pattern-overrides` from the pharmacy server (best-effort — a failure just means no overrides apply) alongside the medication-DB load in `fetchAndRender()`.

The editing UI lives in `src/features/pattern-editor/` (`page-pattern-editor.html`/`.js`, opened via the popup's "🧩 Pattern Editor" button) — a simple phrase/Thai-translation table that `PUT`s the whole dict to `/api/pattern-overrides`, persisted server-side to `pharmacy_server/data/rx/pattern-overrides.json` via the existing generic rx-collection routes (same mechanism as `medication-db`/`premix-drugs`). Only **verbatim full-phrase** matches are exposed this way — the regex-based qty/frequency/timing engine (`MASTER_RE`) is not editable from the UI, by design, since a malformed regex edit could break parsing for every instruction on the sheet.

## Gotchas

- The whole `tbody` re-renders on add/remove; the `MutationObserver` is debounced (one run per animation frame) and the translation cache keeps it cheap — don't reintroduce per-tick re-translation.
- Saved edits (`loadMedCache`) win over freshly-fetched meds; a manual note edit overrides both TH and EN values.
- The tool group is shared — append buttons into `.bkn-tool-flyout`, never as siblings of `#paprint`.
