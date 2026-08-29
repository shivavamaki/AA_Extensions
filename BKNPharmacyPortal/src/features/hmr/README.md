# HM Process — Home Medication Review workstation (`hmr`)

A 💊 **HM Process** card injected into ArcusAir's **Ward View**, tracking one
inpatient discharge. State persists server-side per visit so any workstation
sees the same progress.

## Card layout — three sections

1. **ความคืบหน้าการจำหน่าย · Discharge progress** — the ward's own four stages
   (Discharge Advice → Discharge Order → Medical Discharge → Final Discharge)
   as a progress bar. The **current** marker is the first stage *not yet
   reached* — i.e. the outstanding one — so the caption reads
   *"waiting for Medical Discharge"*, not the last thing completed.
2. **ตรวจสอบอัตโนมัติ · Auto checklist** — read-only rows, each a boolean
   straight off the discharge APIs. Nothing here is clickable by design: an
   unticked row means the ward has not done that task yet.
   | Row | Source |
   |---|---|
   | สถานะจำหน่าย · Discharge stage | stage timestamps (`getdischargeprocess`) |
   | คืนยาเรียบร้อย · Pharmacy return | `pharmacyreturnscompleted` |
   | สั่งยากลับบ้าน · Discharge order | `homemedordered` |
   | หยุดยาต่อเนื่อง · Off standing order | **`continuousordersprocessed`** |
3. **ขั้นตอนที่ต้องทำ · Manual checklist** — the two manual YES/NO checks plus
   the two semi-automated steps the pharmacist drives: **Med Reconcile** (also
   captures the reconcile token) and **Allocate / Dispense** (which now also
   carries the 🖨 **Sheet** action for the Home Medication Sheet).

> **The reconciliation ids are stored in TWO places, deliberately.** Step 5
> writes `medreconcileuid` / `medreconcileSnapshot` onto the **HMR record**
> (keyed by `visitid`) *and* onto the **per-visit capture bag** (keyed by
> `patientuid` + `patientvisituid`). The Home Med Sheet looks them up by
> patient/visit, so a uid saved only on the HMR record left its Med
> Reconciliation panel empty even though Step 5 had clearly run —
> `_resolve_reconcile_meds()` needs one of them *in the context* or it returns
> nothing. `buildHomeMedContext()` therefore reads the HMR record first, then
> the capture bag as a cross-workstation fallback.

> **🖨 Sheet is locked until Allocate / Dispense has run.** That step navigates
> deep into ArcusAir, so every session uid is on the wire and resolvable —
> `launchStep7()` calls `saveSessionCapture()` *before* navigating away and
> stores `incusToken` + `loginuid` / `roleuid` / `organisationuid` /
> `parentorguid` / `departmentuid` onto the per-visit capture bag
> (`PUT /api/patients/{puid}/captures/{vuid}`). `buildHomeMedContext()` then
> prefers the live tap and falls back to that bag, so the button works after a
> Ward View reload or from another workstation. Until the step is `done` the
> button renders `disabled` + `.is-locked` — clicking earlier could only open a
> sheet that hangs. The server keeps the uids 7 days but drops the stored token
> after 24 h, so a stale bag yields no token and the button says to re-run
> Allocate / Dispense rather than opening a spinning page.

> **🖨 Sheet carries the full ArcusAir session, not just the token.** The server
> rebuilds ArcusAir's request headers from the context object
> (`_arcus_headers`: `useruid`←`loginuid`, `roleuid`, `orguid`←`organisationuid`,
> `parentorguid`, `departmentuid`). Sending only `incusToken` left every one of
> those blank and ArcusAir then never answered `getallorderitem` — the sheet sat
> on *"กำลังโหลด…"* with the request stuck `(pending)`, while the same sheet
> opened from the dispense workbench worked, because that extractor carries them
> all. `buildHomeMedContext()` reads each from the tapped headers **or** the
> normalised `patientCtx` (both spellings), and the button refuses to open with
> a clear message when `loginuid` is still missing rather than opening a page
> that can only spin.

> **🖨 Sheet** opens `page-home-med.html` for the current patient directly from
> Ward View. It sends the **same `LOAD_MED_TABLE` message** that
> `content-home-med.js` sends from the dispense workbench, so `background.js`'s
> `openOrReuseTab` handles it — payload written to `chrome.storage.session`
> *before* the tab opens, and an already-open sheet reused rather than
> duplicated. Opening the extension URL raw would produce a sheet with no
> patient context. `buildHomeMedContext()` resolves `patientuid` /
> `patientvisituid` / `incusToken` through the same chain as
> `fetchDischargeInfo()` (xhrTap `visitMap` → Angular scope → patient context)
> and returns `null` if the visit or token is missing, so the button reports
> the problem instead of opening a sheet that can only render an error.

> **Two discharge endpoints, and they disagree.**
> `dischargeprocess/getdischargeprocess` carries the stage *timestamps*;
> `dischargeprocess/getdischargeorder` carries the per-task *flags*. The latter
> returns **both** `openordersprocessed` and `continuousordersprocessed`, and a
> live capture showed `open=false` while `continuous=true` — so *Off standing
> order* reads **`continuousordersprocessed`**. Reading the wrong one shows the
> row as ✗ on a patient whose standing orders really were stopped.
> `_orderFlags()` copies only keys the order endpoint actually returned, so a
> missing key never clobbers the value the other endpoint supplied.

> **"Print reports" was removed as a step.** The Home Medication Sheet prints
> from within Allocate / Dispense, so a separate step was just a second place
> to forget. `steps.reportsPrinted` is still written into new state objects so
> records saved by an older build keep loading unchanged.

> Internal identifiers are stable and load-bearing even though the user-facing
> name is "HM Process": `MJ_*` message types, `aa_medicationJourney` tab key,
> and the `HMR` naming throughout this file/CSS/server routes are historical
> ("Home Medication Review") — don't rename them opportunistically.

### 4 · บันทึกถึงทีม — pharmacist note

A free-text note under the manual checklist (before Reset / Complete), for
communication **within the department** about this discharge.

- Saved onto the HMR record as `note` / `noteBy` / `noteAt`, so every
  workstation sees the same text.
- The author is read from ArcusAir's header user button
  (`detectHeaderUser()` → `.headUserDetBtn span.ng-binding`) — the account
  actually logged in, not `lastModifiedBy`, which changes on *any* save (a
  checkbox, a step) and would misattribute the note.
- Saves on **Ctrl+Enter**, on the **Save note** button, and on **blur** — so a
  note is never lost by clicking straight into another control. Blur
  deliberately does **not** re-render: that would tear out the textarea the
  user just left and swallow the click that caused the blur. It refreshes the
  byline in place instead.
- Every save appends to the HMR audit log **and** is mirrored onto the queue
  entry's log via `BKN_HMQ.logEvent`. The note lives on the HMR record (keyed
  by `visitid`) but the Dashboard reads `/api/hmq` (keyed by case) — without
  the mirror the note would never appear there.

## Where it runs

- **`content-hmr.js`** injects `#hmr-trig-btn` next to the "Visit Details" `<h4>`
  on `#!/inpatient/wardview` (`findVisitDetailsH4`, `injectTriggerBtn`). The
  workstation card (`showWorkstation`) is **open by default** — `syncUI` calls
  `autoOpenWorkstation()` once the trigger + visit id are in place, and again
  when a different room/visit is selected. `onTriggerClick` still toggles it; a
  **manual** close sets `_userClosed` so it stays closed until the visit changes
  (open logic shared via `openWorkstation()`).
- Visit ID (`I48-xx-xxxxxx`) and HN are read from the DOM around that panel
  (`detectVisitId`/`detectHN` — regex scan of ancestor text, not a stable
  selector, since ArcusAir doesn't expose one).

## State model

`newState(visitid, hn)` — one document per visit, `GET/PUT /api/hmr/{visitid}`
(read-merge-write; `auditLog` entries always append, never overwrite):

```js
{
  visitid, hn, startedAt,
  checklist: { dischargeStatus, homemedordered, hasAtb, medReturned, controlledRemaining },
  steps:     { medReconcile, continueOrdersOff, allocateDispensed, reportsPrinted },
  medreconcileuid, medreconcileSnapshot,
  lastModifiedBy, lastModifiedAt, auditLog[], completedAt,
}
```

- **Discharge Status / Home Med / Meds Returned** (`hmr-dc-row`, tagged `AUTO`)
  come from `fetchDischargeInfo()` → ArcusAir
  `inpatient/dischargeprocess/getdischargeprocess`, resolving
  `patientuid`/`patientvisituid` via a 3-tier fallback (in order): the
  MAIN-world XHR tap's `visitMap[visitid]`, an Angular-`$scope` DOM scan
  (`getAngularScopeUIDs`), then the broader `ctx.data.patientCtx` extraction
  done by `background.js`'s `MJ_EXTRACT_ANGULAR_CTX` handler. `medReturned` is
  auto-set from `dischargeprocess.pharmacyreturnscompleted` — it is **not** a
  manual check.
- **มี ATB ก่อน D/C?** is the only remaining manual YES/NO check.
  **จัดการยาเสพติดค้างจ่าย** is a single "✓ Completed" button (not YES/NO) — a
  distinct check-row style (`c.singleComplete`), since there's no meaningful
  "NO" state for it.
- **Resolved manual-check rows highlight like the Process Steps.** Each
  `hmr-check-row` gets a state class: `hmr-check-done` (green, when the check is
  completed — YES / ✓ Completed, mirroring `.hmr-step-done`), `hmr-check-answered`
  (muted grey, when answered NO), or `hmr-check-pend` (unanswered). So the
  pharmacist sees at a glance which checks are resolved, matching the steps below.

## Step 5 — Med Reconcile (semi-automated)

`launchMedReconcileStep5(visitid, hn, setStatus)`, wired to the step's ▶ Run
button:

1. Resolves `patientvisituid` **while still on Ward View** (same 3-tier
   fallback as above) — this must happen before navigating away, since two of
   the three tiers depend on the Ward View "Visit Details" DOM that won't
   exist on the EMR pages.
2. Clicks `#opdvisitviewemrlanding` (View EMR) → waits for
   `#!/emr/emrview/emr/ipdlanding`.
3. Clicks the "Med Reconcile" side-menu button → waits for
   `#!/emr/emrview/emr/medreconcile`.
4. Saves a job (`saveMedReconJob`, `chrome.storage.local` key
   `bkn_hmr_medrecon` — same durable-job pattern as Step 7 below) and stops.

The pharmacist reviews the Med Reconcile list, then clicks a **"▶ Continue"**
button injected by `handleMedReconOnPage()` next to the page's eConsent icon
(`span[aria-label="eConsent"]`) — reappears across Angular route
re-renders via the same `MutationObserver` that drives ward-view sync.

Continuing (`_continueMedReconcile`) captures reconciliation data from two
sources, preferring the first:

1. **`medreconcileuid`** — `_clickFirstMedReconcileViewButton()` clicks
   `#viewMedReconcile0`, the **View** button on the list's newest row (ArcusAir
   sorts newest-first, so index 0 is always this admission's record). That
   click fires `ordermanagement/medreconcile/getdetail`, which — unlike
   `medicationhistory/getdetails` below — carries `{"medreconcileuid": "..."}`
   in its own **request body**. `arcus-xhr-tap.js`/`background.js` grab it from
   there into `window.__arcus_medrecon__[patientvisituid]`; `_continueMedReconcile`
   polls for up to ~2.4s after the click for it to land. Best-effort: if the
   button is missing/disabled (no record prepared yet for this admission),
   this just no-ops and falls through to (2).
2. **`medreconcileSnapshot`** — `window.__arcus_medhistory__[patientvisituid]`,
   a passive cache of ArcusAir's own `emr/medicationhistory/getdetails`
   response, which fires **automatically when the Med Reconcile page loads**
   (before any button click) — kept as a fallback source only.

Whichever of the two is captured (or both) is persisted onto the HMR record
(read-merge-write, so it never clobbers other steps), the step is marked
done, and the flow returns to Ward View via `navigateToWardViewAndSearchHN(hn)`.
It only fails outright if **neither** source produced anything.

Clicking ▶ Run always re-checks the server first
(`serverLoad(visitid).medreconcileuid || .medreconcileSnapshot`) — if a
different workstation already captured this visit's reconciliation data, the
whole EMR navigation is skipped.

`page-home-med.js`'s reconciliation panel (see
[`../home-med/README.md`](../home-med/README.md)) is the consumer.
`bkn_ks_server.py`'s `_resolve_reconcile_meds()` prefers a live
`fetch_arcus_medreconcile()` call using the stored `medreconcileuid` — the
exact endpoint + shape `build_reconcile_meds_for_home_med()` was written for,
and it works even on a later day as long as a fresh `incusToken` is supplied.
It only falls back to `build_reconcile_meds_from_snapshot()` (which tries
several plausible container keys, since `medreconcileSnapshot`'s exact
response shape has never been confirmed) if no `medreconcileuid` is
available or the live call fails.

## Step 7 — Allocate / Dispense (semi-automated, cross-page job)

`launchStep7(visitid, hn)` saves a job (`bkn_hmr_step7`) and navigates to
Pharmacy Worklist. `handleStep7OnWorklist()` (driven by the same
`MutationObserver`) fills the HN search (`fillWorklistHNSearch` — clicks the
patient-widget wrapper, picks the "MRN" suggestion chip, never the order-item
search box, which shares the same placeholder text) and shows a floating,
draggable overlay (`showStep7Overlay`) with two rows:

- **A** — manual "Done ✓" once the pharmacist allocates by hand.
- **D** — "▶ Run" triggers `runHmrAutoDispense()`, an auto-dispense loop
  (ported from the `Automate` extension) that repeatedly finds
  "Ordered"/"Allocated" `DISCHARGE MEDICATION` rows and drives them through
  Allocate → override-dialog handling → Dispense.

The overlay's final button ("→ Discharge List") saves `steps.allocateDispensed
= 'done'` and calls `navigateToWardViewAndSearchHN(hn)` to return to and
re-search the same patient (via the "Ward Board" side-menu link — setting
`location.hash` directly trips ArcusAir's "back button navigation" guard).
After filling the MRN and dispatching Enter, it **waits for the first result row
(`[id*="MgsGridOneRow0"]`, with fallbacks) and clicks it** — Enter alone filled
the field but didn't resolve the board to the patient, leaving the pharmacist to
click manually ("stuck at the discharge list, needs an extra click"). This mirrors
the dispense-workbench search, which already auto-clicks its result row.

## HM Process Queue integration

Two buttons call the shared API `window.BKN_HMQ` exposed by
[`../hmq/content-hmq.js`](../hmq/content-hmq.js) — see
[`../hmq/README.md`](../hmq/README.md):

- **➕ Add to Queue** (HM Process card header) → `BKN_HMQ.addCase({hn, name,
  ward, room})`. Patient name comes from `h4.patientbannername`; ward/room come
  from `detectWardBed()`:
  - **Primary — the bedoccupancy DOM element** (`readBedOccupancy`): ArcusAir
    renders the current bed as `<div ng-repeat="occupancy in
    vm.patientvisit.bedoccupancy | filter:{enddate:'!'}"><span>ward</span> /
    <span>room</span></div>`. This has **no** "Ward / Bed :" label, so the text
    regex never matched it. We read the two direct-child `<span>`s (ward = 1st,
    room = **2nd** — not "last", and only element children, so nested/sibling UI
    like the "▶ Start" button can't bleed in). This is why special-care rooms
    like `CCU06` were showing blank.
  - **Fallback — `WARD_BED_RE`** on the "Ward / Bed :  Ward 8 / 805" text line,
    scoped to the Visit Details panel (walked up from the `<h4>`) — **never
    `document.body`**, whose concatenated text ran the bed id into adjacent UI
    ("CCU06" + "Start" → "CCU06Start"). Bed token accepts alphanumeric ids
    (`[A-Za-z0-9-]+`): `CCU06` / `ICU-3` / `NICU2`.
  - **Room sanitizing (defence-in-depth)** against any residual contamination:
    the server `_clean_room()` cleans on write (`create_hmq_entry`,
    `update_hmq_location`) and the popup `cleanRoom()` cleans on display — both
    strip a trailing "Start" and keep the leading token.
  - If a patient was queued **before** the bed could be read (blank room) — or
    with a dirty stored room from an earlier build — the next auto-add call
    fixes it: `addCase` gets a 409 duplicate and, when the existing entry's
    ward/room is blank **or dirty**, PUTs `{action:'update-loc', ward, room}`
    which fills blanks and corrects dirty values (leaves clean ones untouched)
    — see `../hmq/README.md`.
- **✓ Complete** (next to Reset) → `BKN_HMQ.completeActiveByHn(hn)`, completing
  this patient's active ("On Process") queue entry from wherever it currently
  is, without needing the floating popup open.

`maybeAutoAddToQueue()` also calls `BKN_HMQ.addCase` automatically — with no
button click — whenever `fetchDischargeInfo()` resolves a raw `dischargestage`
of `1` (Discharge Advice) or `2` (Discharge Order), i.e. as soon as the ward
has started the discharge process. It's wired into both places discharge
info gets (re)fetched: opening the workstation (`onTriggerClick`) and the
manual **↻ Detect** button. It's safe to call repeatedly — the server's own
duplicate guard (`hmq_find_active_by_hn`) silently no-ops if the HN already
has an active `new`/`process` entry today — so failures are logged to the
console rather than surfaced to the pharmacist.

## Alert dismissal

Every automated click that changes the DOM/URL (page nav, menu switch,
search, row select) can pop a native or AngularMaterial confirm/alert dialog
that would otherwise block the rest of the sequence. `dismissAlerts()` fires
Escape 3× after each such click — AngularMaterial dialogs close on Escape by
default, and it's a no-op when nothing is open. **Deliberately not used** in
the auto-dispense flow (`_hmrAllocateRow`/`_hmrDispenseRow`) — that flow
already distinguishes alert vs. override dialogs
(`_hmrIsAlertDialog`/`_hmrIsOverrideDialog`) and blindly pressing Escape there
would dismiss the override dialog before the pharmacist can pick a reason and
save.

**Passive auto-dismiss.** Separately, ArcusAir pops its own **"Alerts"** modal
(billing/general alerts) on many DOM changes and page navigations — not just
during our automation. `_hmrAutoDismissAlertsOnce()` closes **only** that Alerts
modal: it fires the modal's own close control (`#closeBtn` / toolbar ✕) plus
Escape. It's gated by `_hmrIsAlertModal()` — which requires the alert modal's
own controls (`#closeBtn`/`#hideAllAlerts`) and excludes override/reason
dialogs — and stands down while `_hmrAutoRunning` (the automation handles alerts
itself). It never clicks `#hideAllAlerts`, so it dismisses the current popup
without permanently suppressing future alerts, and never touches our own
`#hmr-workstation` / `#hmr-step7-overlay` (plain divs, not `md-dialog`).

- **Instant, no lag.** It's **synchronous** — closing in the same tick the modal
  is detected — and uses `_hmrFireClose()` (a plain synthetic click, **no**
  `scrollIntoView`/smooth-scroll and **no** pre-click `sleep`). The old path went
  through `_hmrClick()`, whose `scrollIntoView({behavior:'smooth'}) + sleep(250)`
  added a ~250ms+ delay every time.
- **Two triggers.** Driven by both the debounced `MutationObserver` (via
  `syncUI`) **and** a light **150ms `setInterval`** poll. The poll covers the
  cases where the observer tick lags: the alert renders in stages (container
  first, `#closeBtn` a moment later) or appears mid-mutation-burst. `_hmrFindDialog`
  is a handful of `querySelector`s returning `null` instantly when no dialog is
  up, so the poll is cheap. Repeated Escape while a modal lingers is idempotent
  and stops the moment `_hmrIsAlertModal` goes false.

## Files

| File | Role |
|---|---|
| `content-hmr.js` | Ward-view injection, discharge-status polling, Step 5/7 automation, HMQ integration |
| `hmr.css` | Workstation card, Step 7 floating overlay, injected Med Reconcile "Continue" button |

## Gotchas

- `checklist.medReturned` used to be a manual YES/NO check; it's auto-detected
  now. Don't re-add YES/NO buttons for it.
- `resolvePatientVisitUid`/`fetchDischargeInfo` intentionally duplicate their
  3-tier resolution logic rather than sharing a helper — left as-is to avoid
  risking a regression in the already-working `fetchDischargeInfo` path for a
  small dedup; a future cleanup candidate, not a bug.
- The Step 7 job and the Step 5 job are separate `chrome.storage.local` keys
  (`bkn_hmr_step7`, `bkn_hmr_medrecon`) — both follow the same
  save/get/clear-job + `MutationObserver`-driven page-arrival pattern, so a
  third semi-automated step could reuse the same shape.
