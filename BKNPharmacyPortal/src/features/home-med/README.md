# Home Medication Sheet (`home-med`)

Printable A4 **เอกสารแนะนำการใช้ยากลับบ้าน** (Home Medication Sheet) listing a patient's discharge medications with Thai instructions, drug photos, a diagnosis/allergy banner, and an editable table.

## Where it runs

- **`content-home-med.js`** injects a 🏠💊 button into the ArcusAir dispense-workbench tool group. Two modes (`sheetMode()`):
  - **IPD (discharge)** — page has a **"DISCHARGE MEDICATION"** cell (`hasDischargeMedicationCell()`).
  - **OPD (outpatient)** — the outpatient dispense workbench URL (`pharmacy/dispenseworkbench/pharmacy/dispense`), no discharge cell (`isOpdDispenseWorkbench()`).
- On click: extracts patient/visit context (reusing the ADR Timeline / `MedicationJourney` extractor), mirrors it to `BKNData`, and opens a page via a per-mode message:
  - **IPD** → **`page-home-med.html`** via `LOAD_MED_TABLE` (payload `payload_sheet`).
  - **OPD** → **`OPD-Sheet.html`** via `LOAD_MED_TABLE_OPD` (payload `payload_sheetOpd`); the click sets `context.mode="opd"`.
  Both modes validate **patientuid + patientvisituid** before sending (OPD no longer uses an orderid).

## Two sheets, one JS
`page-home-med.html` (IPD discharge) and **`OPD-Sheet.html`** (OPD) both load `page-home-med.js`. The JS distinguishes them at boot by the presence of `#histPanel` (OPD only): IPD uses `LOAD_MED_TABLE` / `payload_sheet`, OPD uses `LOAD_MED_TABLE_OPD` / `payload_sheetOpd`. OPD-Sheet.html **replaces** the IPD Med Reconciliation panel with a **last-5-visits medical-history** panel (`#histList`) and **omits** the HM Process Checklist card. Panel-specific binds (`_bindReconPanel`, checklist) are null-guarded so they no-op on the OPD sheet.

### One sheet, one build (`_lastRenderKey`)

`background.js`'s `openOrReuseTab` **always** does both: it writes the payload to
`chrome.storage.session` *and* sends the `LOAD_MED_TABLE` message. Both are
load-bearing — storage covers a freshly-created tab whose listener isn't attached
yet, the message covers a **reused** tab that is already open. On a reused tab
both arrive, so `_applyContextAndRender` used to run `fetchAndRender()` **twice**
and every ArcusAir call was issued twice (~900 ms wasted per open, and double
load upstream; visible in `/api/arcus-stats` as each endpoint appearing exactly
twice within one second).

`_applyContextAndRender` now dedupes on `_lastRenderKey` —
`patientuid|patientvisituid` from the payload, not a bare "already rendered"
flag — so re-opening the same tab for a **different patient or visit** still
rebuilds. The Revert button uses `location.reload()`, which resets the module
state, so a forced refresh is unaffected.

## Data flow

1. Page receives `{ context }` — both modes carry **patientuid + patientvisituid + incusToken**; OPD additionally sets `mode:"opd"`.
2. Endpoint by mode (`fetchAndRender` picks it):
   - IPD → **`POST /api/report/home-med-api`** → ArcusAir `getallorderitem` (DISCHARGE MEDICATION).
   - OPD → **`POST /api/report/home-med-opd`** → ArcusAir **`getallorderitem`** with `ordertype:"DAILYORDER"` / `ordertypeuid:"5796e65d1526f6ebabe3b4a4"` keyed by patientuid + patientvisituid (`fetch_arcus_opd_meds`). Same `orderitems[]` shape as IPD, so it flows through the **same** `_normalize_orderitems` / `_map_orderitem` pipeline with **no adapter** — parse / note-line / frequencyTh / images / translation / render are identical. OPD carries no discharge reconciliation (empty), but **does** show follow-up appointments (same `getfuturebookingforpatient` source as IPD) and adds `visitHistory` (see below).
   - Both return `{ patient, meds, allMeds, allergies, appointmentText, reconcileMeds }`; OPD adds `visitHistory`.
3. Drug photos: **`GET /api/medication-db`** (name/code index) + **`GET /med-image/{code}`** (extension-agnostic).
4. Renders an editable A4 table plus a follow-up appointment line. User edits persist per-visit via `BKNData.saveMedCache`.

### OPD last-5-visits history panel
`getallorderitem` is scoped to the **current** visit, so it can't supply history. Instead `build_opd_visit_history(ctx, currentVisitUid, 5)` fetches **`patientorder/search`** (`fetch_arcus_opd_history` — payload `{patientuid, ordercattype:["MEDICINE"], pagenumber:1, issummary:false}`, keyed by patientuid + incusToken only), the same call the OPD EMR page fires, which returns every visit's orders as `patientorders[]`. `build_visit_history_groups` groups them **by visit** (not de-duped by drug) — newest first, the current visit excluded (matched on `patientvisituid._id`), each `{ visitDate, visitId, meds:[{drug, code, info, freqTh, dosage, freq}] }`. The client's `renderVisitHistory(data.visitHistory)` fills `#histList`.

**Current-order box + selectable window.** The panel opens with a **📋 ใบสั่งยาปัจจุบัน (วันนี้)** box (the meds on today's sheet, from `_meds`) above the history list, so the pharmacist can compare today's order against prior visits directly. The header count is user-selectable — **🕑 ประวัติการใช้ยา (x ครั้งล่าสุด)** with a `<select>` (3/5/10/20). The server returns up to `OPD_HISTORY_MAX` (20) visits and the client slices to the chosen `x` locally (`_renderHistView`), so changing it re-renders instantly with **no re-fetch**. (Continuity tags still compare against the default `OPD_HISTORY_DEFAULT` = 5 window so they don't shift when `x` changes.)

A current-order drug that also appears anywhere in the shown history gets a blue **RM** (reconcile-match) tag in front of its name (`_histRow`, `repeats >= 1` on a current row). **Hovering a current-order row also draws an animated connector arrow** (`_pointToSheetRow` → `#histArrowLayer`, a fixed SVG overlay) from that panel row to the same medicine's `.med-row[data-index]` on the printed sheet — the sheet row pulses (`.sheet-pointed`) and scrolls into view if off-screen. Each current row carries `data-medidx` (its `_meds` index) to make the link. Screen-only, `prefers-reduced-motion`-aware, hidden on print. The sub-header always reads `แสดง X / Y ครั้ง` so it's obvious when the selected `x` exceeds the number of visits the patient actually has (raising `x` then correctly shows no new rows).

**Recognising a drug across visits.** Every row (current box + history) is colour-tagged by drug identity (`_histDrugKey` = code, else lowercased name) with a stable golden-angle hue (`_histColor`) shown as a coloured dot + left edge, so the *same* medicine looks the same everywhere in the panel. A drug in ≥2 visits gets a `×N` repeat badge; a history drug also on today's sheet gets a green **ครั้งนี้** tag. `_bindHistInteraction` links them, but the filter is driven **only by the current-order rows**: **hovering a today's-med** highlights that drug and narrows the history to it. Hovering a **history** row does *not* filter (that would hide the rows you're reading). **Click** any row (current or history) to pin/unpin. When filtering, the **current-order box always stays fully visible** (matching row highlighted, nothing hidden); only in the **history list** are non-matching rows hidden and empty visit groups collapsed (`_histSetActive`), so today's meds remain a stable reference while the past dates narrow to the matches. Screen-only panel — none of this affects the printed sheet.

### OPD continuity tags (รับยาต่อเนื่อง / ปรับขนาดยา)
`tag_meds_continuity(meds, visitHistory)` (server) sets `med.continuity` on each current sheet med by matching its **code** against the history:
- **same code + same dosage & frequency** → `continued` → **รับยาต่อเนื่อง** (green)
- **same code but dosage/frequency differ** → `adjusted` → **ปรับขนาดยา** (amber)
- code not in history → `''` (no tag)

The client (`_buildContinuityTag`, OPD sheet only) renders a **dropdown** (`<select>`) under the drug code, pre-selected from `med.continuity`. The pharmacist picks the final value from a fixed list (`CONTINUITY_OPTIONS`): `—` / **🟢 รับยาต่อเนื่อง** / **🟡 ปรับขนาดยา** / **🔵 ยาใหม่** (the last is a manual-only choice the auto-check never sets). The chosen value drives the pill colour (`cont-*`) and persists in the med cache. On a **cached** load, a med that already carries a saved `continuity` (a pharmacist pick — even blank) wins; only when the key is absent (cache predates the field) is the fresh server value seeded. Print shows a static coloured label (`.continuity-print`); the `<select>` is screen-only, and an unselected (`—`) tag doesn't print.

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
| Compact rows (`compactMode`) | `body.compact-mode`. **Forced on at every load** — `_loadPrintSettings()` sets `compactMode = true` regardless of any saved preference (a previously-saved `false` is overridden). Still toggleable off per session via the checkbox; the next open forces it back on. |
| แนบหน้า จัดตามมื้อ (`includeMealCard`) | Show the by-meal content (`body.hm-with-mealcard`). **On by default.** The meal card is a `<tbody>` inside `#medTable`, so it inherits the repeating page header and **flows continuously** after the medicines — no forced break. (See *Daily Pill Journey Card* below.) |

The toolbar **slides off the left edge**: the header's `‹` button collapses it (`body.toolbar-collapsed` → `transform: translateX(-100%)`, and the sheet reclaims the left padding), and a fixed vertical **ribbon tab** (`#toolbarRibbon`) on the left edge reopens it. State persists in `localStorage["hm:toolbarCollapsed"]` (`bindToolbarCollapse`). Screen-only; the ribbon is hidden on print.

## Two modes: Editor + Checking

The OPD sheet has two modes, toggled by the print toolbar's collapse state:

- **Editor mode** (toolbar open) — the A4 print sheet with the editable med table (default).
- **Checking mode** (toolbar minimized, `body.toolbar-collapsed`) — the print sheet hides and a **2-column** review layout appears (center + right). The ⚙️ ribbon reopens the toolbar to return to Editor mode. No duplicated summary container.

**Checking-mode columns:**
> - **Center (wide)** — `#reviewStatus` (top): the **patient name** as the section header (👤 + real name) + **🩹 vitals** (compact cards) (colour-flagged single-line grid, ▲ red high / ▼ blue low from `HLN`) + **⚠️ allergy** (NKDA or `⚠ allergen (reaction)`) + a **[🩺 doctor notes | 📄 สรุปการมาตรวจครั้งนี้]** 2-column row (doctor notes from `emr/doctornote/search` beside the **current visit's** summary — dept · doctor · CC); then **💊 editable medicine cards** split into **🏠 ยากลับบ้าน (Home)** / **⚡ ใช้ที่ รพ./STAT (used)** groups by `med.dispenseGroup` (`renderReviewMeds` → `#reviewMedsHome`/`#reviewMedsStat`; each card has a **move button** (reclassifies home ⇄ stat) **and a ลบ button** (confirms → `_removeMed`, actually removing it from `_meds` / the print sheet); still editable via `_commitField`, RM + continuity tags). **Auto-STAT** (`_isUsedAtHospital`): a **Stat** order (`m.isStat`, from ArcusAir `orderpriorityuid`/`priorityuid` relatedvalue `S`) **or** an item from a used-at-hospital store (`USED_AT_HOSPITAL_STORES` — currently **Central Supply**) defaults into the ⚡ STAT/used group; the same rule applies on a cached load so both paths agree. Within each group, meds are **sub-grouped by dispensing store** (`m.store` = `ordertodepartmentuid`/`invstoreuid`, e.g. Outpatient Pharmacy Floor 1 · Pharmacy Floor 2) with a 🏬 store sub-header (skipped when there's only one store), and **RM-tagged meds sort first** inside each store. Each card shows a **drug photo thumbnail** (`{serverBase}/med-image/{code}`, falls back to the 💊 icon on 404 — the error handler is **bound in `_bindReviewMeds`, never an inline `onerror`**, since the extension CSP forbids inline event handlers) that **hover-zooms** to a floating enlarged image (`bindRevPhotoZoom`). The per-card **move + ลบ buttons sit on one compact line**. Checking-mode fonts are **enlarged for iPad/touch readability** (a `body.toolbar-collapsed`-scoped block bumps the med cards, vitals, tags, buttons and history; the printed A4 sheet is unaffected). The `/opd-queue-view` and `/opd-dashboard` pages get the same larger-font treatment. The former left Visit-Summary column is gone — the center now uses the full freed width.
> - **Right** — the fixed `#histPanel` (width-reserved by body padding): the **🕑 history** list, now **merged with the visit summaries by date** — each date group shows that visit's summary line (dept · doctor · CC, joined by `visitId` via `_visitSummaryByVisit`) under the date header, then its meds; below the list the **📝 Pharmacist note** (`#pharmNote` in `#histNoteBlock`, persisted per-visit in the med cache as `pharmNote`, `bindPharmNote`; a 🎤 **voice-dictation** button `#btnPharmMic` uses the Web Speech API / `webkitSpeechRecognition` — Thai locale, appends final results, `bindPharmMic`; disabled on non-Chromium browsers) + **🚀 ส่งไปห้องจ่ายยา** button (`#btnSendDispense`, `bindSendDispense`) at the bottom. The send button POSTs `/api/opd-queue` with the grouped meds (incl. each med's `store`), the pharmacist note, **and a `context` object** (`diagnosis`, `allergies`, `vitals`, `doctorNotes`, current `visit`) so the dispensing zone sees the same clinical picture the pharmacist checked → the **OPD dispensing queue** (server store + event log). **Duplicate guard:** if the same visit is already in today's queue the server returns `409 duplicate` — the client alerts the pharmacist; if they confirm, it re-sends with `force:true` which **updates the existing case** (no duplicate card). If the existing case is already **completed**, it instead alerts to **contact the dispensing zone immediately** (no silent re-queue). The queue is worked at the server's **`/opd-queue-view`** (live, today by default, colour-escalating 2h/4h/6h wait alerts, click a case → list collapses left + full detail, **Complete** button `PUT /api/opd-queue/{id}`) with an **`/opd-dashboard`** activity view (stats + log feed). The extension popup's **🚀 OPD Queue** card opens the viewer.

`renderVisitSummary` fills `#reviewStatus` (center) and indexes the visit summaries into `_visitSummaryByVisit` (by `visitId`); `_renderHistView` reads that map to inject each history date's summary line, and the current visit's summary renders inline in the center notes row. Hovering a review med card draws a connector arrow (`_pointToEl`) to the first **visible** matching row in the history; `_pointToEl` skips hidden/zero-size targets so no broken arrow is drawn, and the history→current hover targets the review card in Checking mode (sheet row hidden). **Pastel-green accent** throughout. Screen-only.

> Removed: **Fit width** (`body.fit-width`), the dead **Paper** select, and the **Hide logo** toggle. When editing the config, keep the spots in sync — `PRINT_CONTROL_DEFAULTS`, `_getPrintControls`, `applyPrintSettings`, `currentPrintSettingsFromControls`, and the `bindPrintControls` set + listener array.

## Follow-up appointment section

The sheet footer shows **นัดหมายติดตามอาการ** (follow-up appointment) instead of a static caregiver-note box.

- Server-side, the same `home-med-api` handler best-effort-POSTs to ArcusAir `enterprise/appointmentschedule/getfuturebookingforpatient` (`fetch_arcus_future_appointments` in `bkn_ks_server.py`), passing `patientuid` + current UTC timestamp as `futureapptstartdate`.
- `format_appointments_th()` turns the response into a Thai summary per appointment: service type, Buddhist-Era date/time (UTC+7, via `_thai_datetime`), department, provider, and comments — appointments are joined with `\n` when there are several.
- When there are no future appointments, or the ArcusAir call fails, it returns a static fallback: *"ไม่มีนัดติดตามอาการ แต่ถ้าพบอาการผิดปรกติ…"*. The fetch is **best-effort** — a failure here never blocks the medication list from rendering.
- Client-side, `renderAppointments()` (`page-home-med.js`) splits `data.appointmentText` on `\n` and renders **one `.appt-item` card per appointment** into `#appointmentList` — so multiple bookings don't run together as one paragraph. Each non-empty card gets a `•` bullet via CSS (`.appt-item:not(.empty)::before`); the no-appointment fallback renders as a single muted `.appt-item.empty` card with no bullet.

## Patient info + diagnosis/allergy — one merged card

`.patient-card` (name/HN/visit/room) and `.clinical-banner` (diagnosis/allergy lines) sit inside a single outer wrapper, `.patient-clinical-card`, which owns the one outer border/radius/background. Neither child has its own border anymore — `.clinical-banner` gets a `border-top` divider instead. Don't re-add borders to the children; it'll double up with the wrapper's frame.

## Medicine table — rounded corners need the separate border model

`#medTable` uses `border-collapse: separate` (not `collapse`) specifically so `border-radius` renders on the corner cells — Chrome ignores cell radius under `collapse`. To avoid double-thickness grid lines under the separate model, `th`/`td` draw only their **right** and **bottom** edges; an explicit rule adds the **left** edge back on `:first-child` and the **top** edge on the column-header row. Corner radius (8px, matching the other containers) is applied via `.col-head-row th:first-child` / `:last-child` (top corners) and `tbody tr:last-child td:first-child` / `:last-child` (bottom corners).

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
### Continuity tag (รับยาต่อเนื่อง / ปรับขนาดยา / ยาใหม่)

A per-row dropdown (`.med-continuity`, `data-field="continuity"`), shown on
**both** sheets but filled differently:

| Sheet | Default |
|---|---|
| OPD | auto-computed server-side (`tag_meds_continuity`) by comparing the med against the last-5-visits history |
| IPD | **blank** — there is no such history, so the pharmacist picks |

The IPD sheet is deliberately not auto-guessed: labelling a discharge med
*รับยาต่อเนื่อง* without evidence would be a clinical claim the data doesn't
support. Either way the pharmacist's choice wins and is persisted with the row.

An **untagged** badge is hidden entirely when printing
(`.med-continuity:not(.cont-*)`), so an unclassified row prints nothing rather
than an empty pill; the `<select>` is swapped for `.continuity-print` static
text on paper, since selects don't print.

### ยาเดิม / Own medicines badge

A medicine the patient brought in is tagged automatically and shown with a
**ยาเดิม** badge (**Own medicines** in EN — it follows the Language selector).

- **Source of truth is ArcusAir's own flag**, `patientorderitems.broughtfromoutside`
  on `getallorderitem` — the same boolean behind the **POM** badge in ArcusAir's
  Orders grid. The server maps it to `broughtFromOutside` in
  `_arcus_item_to_med()`; `_medFromReport()` seeds `source: "own"` from it.
- **Not** inferred from the non-formulary code `011001`. That code is shared by
  every non-formulary item, including ones the hospital dispenses — treating it
  as POM would mislabel a real dispensed medicine on a discharge document.
- `source` carries two values that both render the badge: `"own"`
  (auto-detected) and `"pom"` (added by hand from the Med Reconciliation panel).
  Only the tooltip differs; the printed sheet doesn't distinguish them.
- **The default is only a default.** The badge is a `<button>` — clicking it
  sets `source: ""`, which `_persist()` saves. The saved-meds branch reads
  `source` verbatim, so a reload keeps the pharmacist's decision instead of
  re-applying the flag.
- The language switch swaps the badge label in place (`_applyOwnMedLang`)
  rather than re-rendering the table, so an in-progress `contenteditable` edit
  isn't discarded.

- **ลงชื่อเภสัชกร** (`providers-box`, narrowest) — two rows: **ผู้ตรวจสอบ
  รายการยา** (from `context.pharmacistName`, `#pharmacistCheckedName`) and
  **ผู้จ่ายยา** — a blank dashed signature line, no name, by design.

  > `pharmacistName` must travel **in the context** — the sheet is an extension
  > page with no access to ArcusAir's DOM, so it cannot read the logged-in user
  > itself. It is taken from **`.headUserDetBtn span.ng-binding`** (the header
  > user button), which is a semantic class present on every ArcusAir page.
  > The original extractor used a long positional path
  > (`… md-menu:nth-child(9) > button > span`) that pinned the body child
  > order, the layout-row classes *and* the user menu being the 9th `md-menu`;
  > any toolbar difference silently produced no name and the sheet printed
  > **"-"**. That path is now only a fallback. The same selector backs
  > `detectUsername()` in `hmr`/`hmq`, ahead of the old scan-every-span
  > heuristic — which could match a *patient* whose name carries a ภก./ภญ.
  > title.

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

The logo/title row, patient-info card, and diagnosis/allergy banner live inside `#medTable`'s `<thead>` as a **single** `<tr class="hdr-row"><td class="hdr-cell" colspan="5">…</td></tr>` row. Browsers repeat `<thead>` content on every printed page, so the patient context reprints automatically if the medication list spans multiple A4 pages — no separate per-page reprint logic needed. Don't move this banner back out of the table, or multi-page printouts will only show patient/diagnosis info on page 1.

The **column-header row** (`# | Medicine / Picture | How to take | Qty`, `.col-head-row`) is deliberately **NOT** in `<thead>` — it's the first row of `<tbody>`, so it prints **once on page 1 only**. A `<thead>` row repeats on every page, which left an empty "Medicine / How to take / Qty" bar above the by-meal card page (nothing under it). `renderMeds()` clears med rows with `tbody.querySelectorAll("tr:not(.col-head-row)")` (not `innerHTML = ""`) so the header row survives re-renders; it carries `break-after: avoid` so it never orphans at a page bottom.

## Page number footer (print)

`#pageCounter` (`.page-counter`) is a `position: fixed` element, print-only, bottom-right of the sheet. The **current** page number comes from the CSS `counter(page)` trick (Chrome increments a `position: fixed` element's counter once per printed page) — no JS involved. Two constraints keep it visible and correct:

- **Direct child of `<body>`, outside `.sheet-wrap`.** That wrapper carries a screen `transform: scale(...)`, and a transformed ancestor makes `position: fixed` resolve against the ancestor instead of the page, which stops `counter(page)` from repeating per printed page (symptom: page 2 printed "1 / 2").
- **Reserved footer band + `bottom: 0`.** `@page { margin: 8mm 8mm 12mm 8mm }` — the larger **bottom** margin reserves a footer band. The counter is `position: fixed; bottom: 0` so it sits at the edge of the printable area (just above that band), with `counter-reset: page` on `html` (not `body`). Positioning it *inside* the `@page` margin (e.g. `bottom: 4mm` against an 8mm margin) makes Chrome clip it — the symptom was the counter printing nothing at all. The **total** page count has no native CSS equivalent in Chrome, so `updatePageCounterTotal()` (`page-home-med.js`, on `window.beforeprint`) estimates it from `.sheet.scrollHeight` vs. the A4 content height (297mm minus the current print margin), written to `data-total` and read via `attr(data-total)` in the `::before` content. It's an estimate, not exact pagination — close enough for "Page X / Y" on a discharge sheet.

Because the meal card now flows inside the same table (see below), the count is
a single measurement: `updatePageCounterTotal()` writes
`ceil(sheet.scrollHeight / pageContentPx)` (with a ~6mm rounding tolerance) to
`data-total` — no separate fit-or-break branch.

## Daily Pill Journey Card (optional by-meal content)

Groups the discharge meds **by meal slot** (before/after × breakfast/lunch/dinner, then bedtime and PRN), gated behind the toolbar toggle **"แนบหน้า จัดตามมื้อ"** (`#includeMealCard` → `body.hm-with-mealcard`), which persists with the other print settings.

**It is a `<tbody>` inside `#medTable`** (`.mealcard-tbody` / `#mealcardTbody`), appended after the medicine rows — **not** a separate section with its own logo header. Consequences, all deliberate:

- **Shared repeating header.** Because it lives in the same table as the med rows, the page header in `<thead>` (BKH logo, "Home Medication Sheet", patient/diagnosis/allergy) repeats above it on **every** printed page automatically. There is no second logo header — just a topic heading row (`.mc-topic`: "ยากลับบ้าน — จัดตามเวลาในการรับประทาน" + the Daily Pill Journey Card subtitle).
- **Flows continuously, paginates naturally.** The card starts right after the last medicine row (same page if it fits, next page otherwise) and breaks across pages row-by-row. This **replaces** the old JS `mealcard-force-break` / whole-sheet-fits machinery and the empty `.mealcard-break` spacer — all removed.
- **The info row must be allowed to break.** The whole grid sits in one `<tr class="mc-info-row"><td colspan="5">`. The global `tr { break-inside: avoid }` would otherwise force the entire (possibly multi-page) grid onto one page, so `@media print` overrides `.mealcard-tbody .mc-info-row(,td)` to `break-inside: auto`.
- **Topic heading glued to its container.** `.mc-topic-row` has `break-after: avoid`, `.mc-info-row` has `break-before: avoid`, `.mc-info` has `break-after: avoid`, and `.mc-slot:first-child` has `break-before: avoid` — so the "ยากลับบ้าน — จัดตามเวลาในการรับประทาน" heading (+ intro banner + first slot) always travel to the next page together rather than the heading stranding at a page bottom. A long grid still paginates *after* the container has started.
- **Slot rows justified.** `.mc-item` is a flexbox; `.mc-dose` carries `margin-left: auto` so the drug name is left-aligned and the quantity (e.g. `1 เม็ด`) sits flush right.
- **Grid → CSS grid in print.** On screen `.mc-grid` is CSS **multi-column** (`column-count: 2`) for tight masonry; multi-column fragments column-by-column across pages and slices cards mid-slot, so `@media print` overrides `.mc-grid` to a real 2-column CSS grid (`display: grid; grid-template-columns: 1fr 1fr; grid-auto-flow: row`) whose items are block boxes — each `.mc-slot` (`break-inside: avoid`) moves whole to the next page.

Applied identically in `page-home-med.html` (IPD) and `OPD-Sheet.html` (OPD), which share `page-home-med.js`.

`renderMealCard()` runs at the end of `renderMeds()` (so it tracks add/remove/edit) and delegates bucketing + markup to the shared **`window.BKNMealSlots`** engine (`../../shared/meal-slots.js`) — the same one the Medication Journey card uses. Matching runs on `instruction + frequencyTh`, so a meal time supplied only by the authoritative Thai frequency phrase still buckets. The `.mc-*` CSS lives in this page's `<style>` (2-column masonry for portrait); empty slots are dropped so the card stays compact.

The card also holds the per-med **start/end date** inputs for meds marked 🚨 *take until finished* (`continueStartDate` / `continueEndDate`).

## Missing-end-date guard on Print (both sheets)

`bindToolbar()`'s Print **and** Save PDF buttons run `_confirmEndDatesBeforePrint()` first (`_medsMissingEndDate()` lists any 🚨 take-until-finished med with a blank `continueEndDate`). If any are missing it shows a `confirm()` naming the drugs — OK prints anyway, Cancel returns to pick the date. Shared by both the IPD Home Medication Sheet and the OPD Medication Sheet (both load `page-home-med.js`). Note it only guards the toolbar buttons, not the browser's own Ctrl+P.

## Files

| File | Role |
|---|---|
| `content-home-med.js` | ArcusAir button injection, context extraction, route to IPD/OPD page |
| `page-home-med.html` | IPD discharge A4 layout + toolbar (language, paper, margin, scale, font, picture size, by-meal page) |
| `OPD-Sheet.html` | OPD A4 layout — same toolbar, Med Reconciliation panel replaced by last-5-visits history, no Checklist card |
| `page-home-med.js` | Shared: fetch, build editable med list, render, translate, persist, by-meal card, OPD history panel |

## Translation (offline-first, Thai default)

- Instructions render in **Thai on first load** using the offline engine only (`HMTranslate` + `medical-glossary.js`) — no Google Translate call at load time.
- The server supplies the authoritative **`frequencyTh`** (from `frequencymaster.json`). It is passed to the pattern engine as `freqOverride` via `data-freq-th`. When the English freq/timing tail can't be parsed, the engine salvages the dose verb and appends `frequencyTh`, **dropping the unparsed English tail** so the line stays fully Thai.
- **Note line** (`.note-line`) is built server-side (`_map_orderitem`) as **two
  parts joined by a newline**:
  1. **`administrationinstruction`** — the doctor's per-order administration note
     from ArcusAir `getallorderitem` (`patientorderitems.administrationinstruction`,
     Thai; optional/null on most orders).
  2. **Patient Instruction** — the curated per-code note from `medication-db.json`
     (`Patient Instruction`, else `Dispensing Instruction`); TH `localLanguage` /
     EN `text`, swapped by the language dropdown.

  If `administrationinstruction` is null → only the Patient Instruction shows.
  The parts are de-duplicated (skip the Patient Instruction if the admin note
  already equals/contains it). The `.comment` box uses `white-space: pre-line`
  so the `\n` renders as a line break, and the client keeps note newlines via
  `normMultiline()` (a newline-preserving `norm`) everywhere the note is
  processed (render, lang-swap, edit-commit, saved-meds reload).

  > This **replaced** the older behaviour that merged the live order
  > `instructions[].instructiontext` (INSTYP1) into the note and offline-
  > translated/self-healed it via `note-glossary.json`. `_translate_note` /
  > `_clean_instruction_note` remain defined but are no longer used by the
  > note line. Applies to **both** reports (shared `_normalize_orderitems`).
  >
  > `administrationinstruction` is read from the existing `getallorderitem`
  > response (no extra API call). `_log_home_med_fetch()` also records the first
  > raw order-item's **keys + id fields** (`sampleOrderItemKeys`, `samplePoiKeys`,
  > `sampleOrderIds`, incl. `poi.administrationinstruction`) into
  > `home-med-fetch-*.jsonl` — a retained diagnostic (keys/ids only, no PHI) for
  > verifying the field is present and, if it ever isn't, wiring the
  > `/pharmacy/dispense/search` fallback keyed by the order id.
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
