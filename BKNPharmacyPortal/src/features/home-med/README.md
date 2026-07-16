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
>
> The `home-med-api` handler shares its ArcusAir parsing with the Medication Journey via `_normalize_orderitems` in `bkn_ks_server.py` — see [`../../../../pharmacy_server/README.md`](../../../../pharmacy_server/README.md) (Reports) for the de-dupe / phase / note-hygiene rules.

## Control panel (left sidebar)

The on-screen controls live in a fixed **left sidebar** (`.toolbar`, pastel-green; screen only — `@media print` hides it and clears the body's left offset so the printed A4 is unchanged). All controls persist to `localStorage` (`hm:homeMedPrintSettings`) via the `PRINT_CONTROL_DEFAULTS` / `applyPrintSettings` config in `page-home-med.js`.

| Control | Effect |
|---|---|
| Print / Save PDF / Revert | `window.print()` (title = `buildFileName`) · reload |
| Language | Re-translate instructions (offline engine; user pick allows Google fallback) |
| Margin · Preview scale | `@page` margin · on-screen `--screen-scale` |
| Font · Picture | `--base-font-size` · `--medicine-image-size` |
| Compact rows · Fit width | `body.compact-mode` · `body.fit-width` |
| แนบหน้า จัดตามมื้อ (`includeMealCard`) | Show the by-meal page (`body.hm-with-mealcard`). The by-meal card **auto page-breaks**: its header + intro + continued block avoid splitting, so the whole card moves to a new page only when it doesn't fit — no manual break toggle. |

> Removed: the dead **Paper** select (only A4, never wired) and the **Hide logo** toggle. When editing the config, keep all five spots in sync — `PRINT_CONTROL_DEFAULTS`, `_getPrintControls`, `applyPrintSettings`, `currentPrintSettingsFromControls`, and the `bindPrintControls` set + listener array.

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

## Footer layout — appointment + Checklist + pharmacist sign-off

The footer (`.footer-note`) is a **3-column** grid (`5fr 3fr 2fr`), all three
boxes sharing one visual family (solid blue border + blue gradient header —
see `.sign-box.appt-box`, `.hmproc-box`, `.sign-box.providers-box` in
`page-home-med.html`):

- **นัดหมายติดตามอาการ** (`appt-box`, widest) — the appointment card list.
- **Checklist** (`hmproc-box`, middle, new) — read-only mirror of the ward-view
  HM Process card's 3 manual/auto checks (green ✓ dots), fetched by HN via
  `fetchAndRenderChecklist()` → `GET /api/hmr?from=&to=` (matched by HN, not
  visitid — this page never has the `I48-xx-xxxxxx` visitid HMR is keyed by),
  plus **2 blank paper checkboxes** with no digital backing at all (อธิบายยา
  กลับบ้าน, ผู้ป่วย/ผู้ปกครอง ทราบและเข้าใจ) for the pharmacist to hand-tick on
  the printed copy. Shows "HM Process not started for this visit" — a normal,
  expected state, not an error — when no HMR record exists yet. See
  [`../hmr/README.md`](../hmr/README.md) for what populates that record.
- **ลงชื่อเภสัชกร** (`providers-box`, narrowest) — two rows: **ผู้ตรวจสอบ
  รายการยา** (from `context.pharmacistName`, `#pharmacistCheckedName`) and
  **ผู้จ่ายยา** — a blank dashed signature line, no name, by design.

**Physician moved out of the footer** — it's now an inline line
(`.physician-line`, `#physicianNameTop`) at the **top of the clinical banner**,
above Diagnosis, styled neutrally (not blue/red like Diagnosis/Allergy below
it). `populateHeader()` collects **every distinct provider** across the
discharge meds (`_uniquePhysicians()`), comma-joined on one line — a visit can
involve more than one prescriber.

## Medication Reconciliation panel (right sidebar, POM tagging)

> Not to be confused with `src/features/patient-sticker/page-med-reconcile.html`
> — a separate, older sticker/label page opened via `OPEN_MED_RECONCILE`
> (patient-sticker's own feature, see its README). This panel is a new,
> unrelated inline sidebar on the Home Medication Sheet itself.

`.recon-panel` (`#reconPanel`, fixed right sidebar, screen-only, mirrors the
left print-control sidebar's positioning) lets the pharmacist pull items from
the patient's pre-admission/home medications into the sheet, tagged **POM**
(Patient's Own Medication — matches ArcusAir's own vocabulary for this).

- **Data source**: `data.reconcileMeds` from the same `POST
  /api/report/home-med-api` response (also independently refreshable via
  `POST /api/report/reconcile-api`, the ↻ button — `fetchAndRenderReconcile()`).
  Server-side, `_resolve_reconcile_meds()` prefers a live ArcusAir re-fetch
  using the client-captured `medreconcileuid`, falling back to the
  `medreconcileSnapshot` (see [`../hmr/README.md`](../hmr/README.md#step-5--med-reconcile-semi-automated)).
- **The ↻ reload re-pulls context from the live ArcusAir tab.** The sheet runs
  in its own extension tab and can't see ArcusAir's in-page capture, so opening
  Med Reconcile *after* the sheet was opened wouldn't otherwise register. On ↻,
  `_refreshReconContextFromArcus()` first reads the **server capture bag**
  (`BKNData.loadCapture(puid, vid)`), then sends `HM_REFRESH_RECON_CTX` to
  background for best-effort **live** enrichment from an open ArcusAir tab
  (a fresher `incus-token` / just-captured id), merging both into `_context`
  before the refresh POST. The XHR tap captures the `medreconcileuid` + full
  item list from the medreconcile getdetail **response** (not just the request
  body), so the EMR Med Reconcile view — which loads without a uid in the
  request body — registers.
- **Server-shared capture bag (cross-workstation), two-tier TTL.** The
  `medreconcileuid` / snapshot / `incus-token` are captured in the ArcusAir page
  context (volatile). The MAIN-world tap posts each capture (`__bkn_medrecon__`
  postMessage), and **`src/main-world/capture-persist.js`** (ISOLATED world, has
  `BKNData`) writes it to the **pharmacy server** via
  `PUT /api/patients/{puid}/captures/{visituid}` — a per-visit bag the server
  merges (non-empty fields only). Retention is split by sensitivity:
  - the **record** (`medreconcileuid` + snapshot) is kept **7 days**
    (`CAPTURE_TTL_MS`) — an opaque id + PHI that already lives on this server,
    so the panel works cross-workstation for a week;
  - the **`incus-token`** is a live ArcusAir session credential, so only a
    **24h** copy is kept (`CAPTURE_TOKEN_TTL_MS`, stamped via its own `tokenTs`
    so a later snapshot-only update can't revive it). Past 24h the GET strips
    the token (`_capture_view`); a missing token just means the server falls
    back to the stored snapshot — the panel still works.

  So opening Med Reconcile **once on any PC** lets **every** workstation load the
  panel for a week — no per-browser storage, no re-snapshotting.
  `_resolve_reconcile_meds` prefers a live `getdetail` (needs a non-expired
  token — a currently-open ArcusAir tab supplies a fresh one) and falls back to
  the stored snapshot otherwise. The bag is generic
  (`BKNData.loadCapture`/`saveCapture`), so other features can persist their own
  captured ArcusAir parameters the same way.
- **Status → action**: items are normalized to `continued`/`stopped`/
  `changed`/`new` (`_RECON_STATUS_LABEL`). Only `stopped` items are
  non-addable — a discontinued medication shouldn't become a home med.
- **Add Selected** calls the sheet's existing `_addMed()` primitive per
  checked item (same function the manual add-box already uses) with
  `source: "pom"`; the row then shows a small purple **POM** badge next to the
  drug name (`_buildMedRow`). `source` is preserved through the
  save/reload cache path (`_persist`/`fetchAndRender`'s saved-meds remap) so it
  survives edits and reloads.
- Added items **stay in the list**, checkbox disabled, marked "✓ Added as
  POM" (not removed from the panel) — so the pharmacist can see what's already
  on the sheet without the list shifting under them.
- **Unavailable state**: if `context.medreconcileuid`/`medreconcileSnapshot`
  was never captured for this visit, the panel shows a "not loaded" message
  instructing the pharmacist to run the HM Process card's Med Reconcile step.

## Emphasis style — plain weight, no underline or bold

`page-home-med.html` registers only `Sarabun-Regular.ttf` via `@font-face` (no Bold face, by design — don't add one). All emphasis is `font-weight: 400` with no `text-decoration` — underline was tried and then explicitly removed per pharmacy feedback. Don't reintroduce bold or underline for "emphasis"; rely on layout (badges, color, spacing) instead.

## Repeating page header (print)

The logo/title row, patient-info card, and diagnosis/allergy banner live inside `#medTable`'s `<thead>` (a single `<tr class="hdr-row"><td class="hdr-cell" colspan="5">…</td></tr>` row, followed by the normal column-header `<tr>`). Browsers repeat `<thead>` content on every printed page, so the patient context reprints automatically if the medication list spans multiple A4 pages — no separate per-page reprint logic needed. Don't move these sections back out of the table, or multi-page printouts will only show patient/diagnosis info on page 1.

## Page number footer (print)

`#pageCounter` (`.page-counter`) is a `position: fixed` element, print-only, bottom-right of the sheet. The **current** page number comes from the CSS `counter(page)` trick (Chrome increments a `position: fixed` element's counter once per printed page) — no JS involved. The **total** page count has no native CSS equivalent in Chrome, so `updatePageCounterTotal()` (`page-home-med.js`, on `window.beforeprint`) estimates it from `.sheet.scrollHeight` vs. the A4 content height (297mm minus the current print margin), written to `data-total` and read via `attr(data-total)` in the `::before` content. It's an estimate, not exact pagination — close enough for "Page X / Y" on a discharge sheet.

When the by-meal page is enabled (`hm-with-mealcard`), the meal card's height
is measured **separately** from the rest of the sheet and each rounded up to
whole pages independently before summing — not summed first, then divided.
The card auto-breaks onto its own page when it doesn't fit, which wastes
whatever room was left on the previous page, so a short med list (e.g. 20% of a
page) plus a short meal card (20%) is 2 physical pages, not `ceil(0.4) = 1`.
Falls back to the simple sum-then-divide estimate when the meal card is off.

## Daily Pill Journey Card (optional by-meal page)

An optional second page (`.mealcard-section` / `#mealcardGrid`) groups the discharge meds **by meal slot** (before/after × breakfast/lunch/dinner, then bedtime and PRN). It's gated behind the toolbar toggle **"แนบหน้า จัดตามมื้อ"** (`#includeMealCard` → `body.hm-with-mealcard`), which persists with the other print settings. The card **auto page-breaks**: its header + intro + continued block carry `break-inside/after: avoid`, so the whole card moves to a fresh page only when it doesn't fit in the room left on the current page — there's no manual "new page" toggle.

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
