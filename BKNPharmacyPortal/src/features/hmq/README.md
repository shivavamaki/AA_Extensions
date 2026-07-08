# HM Process Queue (`hmq`)

A 📋 floating popup shared across **Ward View** and the **Pharmacy Return
workbench**, tracking patients through **New Case → On Process → Completed**
for the home-medication discharge process. Data lives on the pharmacy server,
so every workstation's popup shows the same queue.

## Where it runs

- Injected on `#!/inpatient/wardview` and
  `#!/pharmacy/dispenseworkbench/pharmacy/return` (`isRelevantPage()`).
  Persists across navigation between the two (`syncUI`/`teardownPopupIfIrrelevant`
  only tears it down once neither page is active) and polls the server every
  8s (`POLL_MS`) while visible.
- **"Add new case"** button (`injectAddCaseButton`) is inserted before
  `#printprescription` in the Return workbench toolbar — same icon-button
  class as ArcusAir's own native button, clicking it extracts the patient
  name/HN from `h4.patientbannername` (`extractPatientFromBanner`) and
  ward/room from the first two `td.md-cell`s of the selected `tr.md-row`
  (`extractWardRoom`).
- [`../hmr/content-hmr.js`](../hmr/README.md) adds equivalent buttons directly
  on the Ward View HM Process card (➕ Add, ✓ Complete) via the shared
  `window.BKN_HMQ` API below — no floating popup needed to use them there.

## Popup UI

- **Draggable** by the header, position persisted to `localStorage`
  (`bkn:hmqPopupPos`) and restored on next load (`applySavedPos`).
- **Resizable width** via native CSS `resize: horizontal` (260–640px) — a
  `ResizeObserver` persists whatever width the user lands on, same storage key.
- **Minimizable** (collapses the body, header stays) — **no close button**,
  by design; the queue needs to stay reachable.
- Three sections, top-down: 🔵 **On Process** → 🆕 **New Case** → ✅
  **Completed**, each independently collapsible (`hmq-sec-caret`).
- Each row: queue number (`Q{n}`, auto-incrementing, resets daily), name + HN,
  ward/room, a 🕒 **log** button (`showLog` — full audit trail modal per
  patient), and a status-appropriate action:
  - New Case → **▶ Start**
  - On Process → **↺** (revert to New Case) + **✓ Complete**
  - Completed → **↺** (revert to On Process) + checkmark/time

## Shared API — `window.BKN_HMQ`

Exposed so other content scripts can drive the same queue without duplicating
server calls or duplicate-guard logic:

```js
window.BKN_HMQ = {
  addCase({ hn, name, ward, room }),  // → { ok, entry } | { ok:false, reason, duplicate?, existing? }
  completeActiveByHn(hn),             // → { ok, entry } | { ok:false, reason }
};
```

`content-hmr.js`'s Ward View buttons call these directly — see
[`../hmr/README.md`](../hmr/README.md#hm-process-queue-integration).

## Data flow / server

`pharmacy_server/bkn_ks_server.py`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/hmq?from=&to=` | List entries (date range on `createdAt`) |
| `POST` | `/api/hmq` | Add a case — `{hn, name, ward, room, addedBy}` |
| `PUT` | `/api/hmq/{id}` | Transition — `{action: 'start'\|'complete'\|'revert-process'\|'revert-new', user}` |

- **Duplicate guard** (`hmq_find_active_by_hn`): keyed on HN. A new `POST`
  is rejected (`409`) if that HN already has a `new` or `process` entry
  today; allowed if its only entries today are `done`.
- **Storage**: one live JSON file per entry (`data/hmq/HMQ-YYYYMMDD-NNNN.json`).
  A nightly job at 23:00 (`_hmq_nightly_merge`) archives only `done` entries
  into `data/hmq/DAY_YYYY-MM-DD.json` and deletes just those live files —
  `new`/`process` entries are left as live files, untouched, so a patient
  still mid-case stays on the active queue overnight instead of being
  archived away before they're actually complete. `load_all_hmq()`
  transparently merges live + archived when answering `GET` either way.
- **Revert transitions** clear the timestamp of the stage being undone
  (`completedAt`/`startedAt` → `null`) and append an audit-log entry, same as
  forward transitions.

## Report viewer

`pharmacy_server/www/hmq-report.html` — date-range table (queue #, HN, name,
ward/room, status, added/started/completed timestamps, added-by, per-case log
modal, CSV export). Linked from the server dashboard's **HMQ REPORT** button
(`www/dashboard.html`, `www/static/dashboard.js`).

## Files

| File | Role |
|---|---|
| `content-hmq.js` | Popup UI, drag/resize/minimize, Add Case + queue-transition logic, `window.BKN_HMQ` |
| `hmq.css` | Popup card, section/row styles, log modal, Return-workbench toolbar button |

## Gotchas

- Ward/room extraction (`extractWardRoom`) only works on the Return
  workbench's own details table — when adding a case from Ward View via
  `content-hmr.js`, ward/room are left blank (no equivalent table there).
- `_id` fields inside queue entries are day-scoped display numbers
  (`queueNum`), not database keys — the actual key is the file-name-derived
  `id` (`HMQ-YYYYMMDD-NNNN`), stable across the nightly merge.
