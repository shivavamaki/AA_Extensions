# HM Process — Home Medication Review workstation (`hmr`)

A 💊 **HM Process** card injected into ArcusAir's **Ward View**, tracking one
inpatient discharge through 4 tracked steps (Med Reconcile → Off continue
orders → Allocate/Dispense → Print reports) plus 3 manual/auto checks. State
persists server-side per visit so any workstation sees the same progress.

> Internal identifiers are stable and load-bearing even though the user-facing
> name is "HM Process": `MJ_*` message types, `aa_medicationJourney` tab key,
> and the `HMR` naming throughout this file/CSS/server routes are historical
> ("Home Medication Review") — don't rename them opportunistically.

## Where it runs

- **`content-hmr.js`** injects `#hmr-trig-btn` next to the "Visit Details" `<h4>`
  on `#!/inpatient/wardview` (`findVisitDetailsH4`, `injectTriggerBtn`). Clicking
  it opens the workstation card (`onTriggerClick` → `showWorkstation`) inline
  before the "Patient Tracking" row.
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
Continuing (`_continueMedReconcile`) reads back
`window.__arcus_medhistory__[patientvisituid]` — a snapshot of ArcusAir's own
`emr/medicationhistory/getdetails` response, which fires **automatically when
the Med Reconcile page loads** (before any button click), so
`arcus-xhr-tap.js`/`background.js` cache it passively rather than trying to
trigger/await it. That snapshot is persisted as `medreconcileSnapshot` on the
HMR record (read-merge-write, so it never clobbers other steps), the step is
marked done, and the flow returns to Ward View via
`navigateToWardViewAndSearchHN(hn)`.

Clicking ▶ Run always re-checks the server first
(`serverLoad(visitid).medreconcileSnapshot`) — if a different workstation
already captured this visit's reconciliation data, the whole EMR navigation is
skipped.

`page-home-med.js`'s reconciliation panel (see
[`../home-med/README.md`](../home-med/README.md)) is the consumer of
`medreconcileSnapshot` — `bkn_ks_server.py`'s `build_reconcile_meds_from_snapshot()`
parses it, trying several plausible container keys since the exact response
shape hasn't been confirmed against a live capture; treat an empty parse as
"shape not recognized yet," not "no reconciliation data."

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

## HM Process Queue integration

Two buttons call the shared API `window.BKN_HMQ` exposed by
[`../hmq/content-hmq.js`](../hmq/content-hmq.js) — see
[`../hmq/README.md`](../hmq/README.md):

- **➕** (header, before the "💊 HM Process" title) → `BKN_HMQ.addCase({hn, name,
  ward: '', room: ''})`. Patient name comes from `h4.patientbannername` if
  present on Ward View; ward/room are **not** reliably detectable on this page
  (unlike the Return workbench) and are left blank.
- **✓ Complete** (next to Reset) → `BKN_HMQ.completeActiveByHn(hn)`, completing
  this patient's active ("On Process") queue entry from wherever it currently
  is, without needing the floating popup open.

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
