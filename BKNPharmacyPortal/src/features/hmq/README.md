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
  ward/room from a `tr.md-row` whose first `td.md-cell` starts with "Ward"
  (`extractWardRoom`). The Return workbench actually has **two** such rows —
  the dispense-details header (2nd cell is the dispensing/pharmacy location,
  e.g. "Inpatient Pharmacy (Floor G)") and the "Bed Details" row further down
  (2nd cell is the patient's real bed/room, e.g. `510` or `CCU06`) —
  `extractWardRoom` takes the row whose 2nd cell is a **single alphanumeric
  token** (`[A-Za-z0-9-]+`), which both accepts special-care bed ids and skips
  the location row (that string has spaces/parens).
- [`../hmr/content-hmr.js`](../hmr/README.md) adds equivalent buttons directly
  on the Ward View HM Process card (➕ Add, ✓ Complete) via the shared
  `window.BKN_HMQ` API below — no floating popup needed to use them there.

## Popup UI

- **Draggable** by the header, position persisted to `localStorage`
  (`bkn:hmqPopupPos`) and restored on next load (`applySavedPos`).
- **Resizable width** via native CSS `resize: horizontal` (260–640px) — a
  `ResizeObserver` persists whatever width the user lands on, same storage key.
- **Minimizable** — collapses the *entire* card (header + body) down to a
  small floating button (with a live count badge); a plain click re-expands
  it, a real drag repositions it. State (`minimized`) persists across
  navigation the same way position/width do. **No close button**, by design;
  the queue needs to stay reachable.
- Three sections, top-down: 🔵 **On Process** → 🆕 **New Case** → ✅
  **Completed**, each independently collapsible (`hmq-sec-caret`).
- Each row: queue number (`Q{n}`, auto-incrementing, resets daily), then a
  **room/bed badge** (`.hmq-room` — bold blue, right next to `Q{n}` for
  at-a-glance reading; muted "—" placeholder when the room wasn't detected),
  then name + HN with the **ward** on the sub-line, a 🕒 **log** button
  (`showLog` — full audit trail modal per patient), and a status-appropriate
  action:
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

**All queue data lives on the pharmacy server** (`data/hmq/`), never in
`chrome.storage`/`localStorage` — the popup re-fetches from the server on open
and polls every 8s (`fetchQueue`/`refreshQueue`), so reloading the extension
never loses the queue. (Only the popup's *position/width* is per-browser
`localStorage`, `bkn:hmqPopupPos`.)

`pharmacy_server/bkn_ks_server.py`:

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/hmq?from=&to=` | List entries (date range on the **Bangkok** day of `createdAt`) |
| `POST` | `/api/hmq` | Add a case — `{hn, name, ward, room, addedBy}` |
| `PUT` | `/api/hmq/{id}` | Transition — `{action: 'start'\|'complete'\|'revert-process'\|'revert-new', user}` |

- **Timezone.** Days are keyed to **Asia/Bangkok** everywhere: the client queries
  the Bangkok date (`todayStr` = `now + 7h`), `_hmq_today()`/`_hmq_next_seq`/
  archival use `_bangkok_today()`, and `load_all_hmq`'s date filter compares each
  entry's Bangkok day (`_bangkok_date_of(createdAt)`, since `createdAt` is UTC).
  Previously the filter used the raw UTC date slice, so entries added in the
  00:00–07:00 Bangkok window (UTC still on the previous day) vanished from the
  "today" query on reload — that's fixed.

- **Duplicate guard** (`hmq_find_active_by_hn`): keyed on HN. A new `POST`
  is rejected (`409`) if that HN already has a `new` or `process` entry
  today; allowed if its only entries today are `done`.
- **Storage**: one live JSON file per entry (`data/hmq/HMQ-YYYYMMDD-NNNN.json`).
  A nightly job at 23:00 (`_hmq_nightly_merge`) archives only `done` entries
  into one `data/hmq/ddmmyyyy_HM_queue.json` per day (e.g. `09072026_HM_queue.json`,
  via `_hmq_archive_path`) and deletes just those live files — `new`/`process`
  entries are left as live files, untouched, so a patient still mid-case stays
  on the active queue overnight instead of being archived away before they're
  actually complete. Archive files are **never deleted or rotated** by the
  server — data stays available to the HMQ Dashboard indefinitely, until an
  admin manually cleans it up. (Older `DAY_YYYY-MM-DD.json` archives written
  before this naming convention are still read transparently, just never
  written again.) `load_all_hmq()` transparently merges live + all archived
  formats when answering `GET`.
- **Revert transitions** clear the timestamp of the stage being undone
  (`completedAt`/`startedAt` → `null`) and append an audit-log entry, same as
  forward transitions.

## Report viewer

`pharmacy_server/www/hmq-report.html` — date-range table (queue #, HN, name,
ward/room, status, added/started/completed timestamps, added-by, per-case log
modal, CSV export). Linked from the server dashboard's **HMQ REPORT** button
(`www/dashboard.html`, `www/static/dashboard.js`).

## Dashboard (extension popup)

`page-hmq-dashboard.html`/`.js`/`.css` — a **read-only** full-page history
view, opened via a "HM Queue Dashboard" button in the extension popup's
**Ward & OPD** section (`popup.html`/`popup.js`'s `initHmqDashboard`, `chrome.tabs.create`
to `chrome.runtime.getURL('src/features/hmq/page-hmq-dashboard.html')`). Same
visual language as the floating popup (same colors/section styling) but laid
out as a 3-column board (New Case / On Process / Completed) so older entries
across a date range are still meaningful — a `new`/`process` case surfacing
here from days ago is a real signal (a case that never got finished), not
noise, since the nightly merge (above) only ever archives `done` entries.

- **Date range**: From/To date inputs + Today/Last 7 days/Last 30 days quick
  buttons, all reading `GET /api/hmq?from=&to=` directly via
  `window.BKNData.serverFetch` (`src/shared/shared-data-client.js`).
- **Search** by HN or name, filtered client-side against the already-fetched
  range.
- Same per-case 🕒 log modal as the floating popup, but log timestamps show
  date + time (not just time) since entries can span many days.
- Deliberately **no Start/Complete/Revert buttons** — this page is for
  browsing history across workstations/days, not for working the queue; a
  note at the bottom of the page points back to the live popup for that.

## Files

| File | Role |
|---|---|
| `content-hmq.js` | Popup UI, drag/resize/minimize, Add Case + queue-transition logic, `window.BKN_HMQ` |
| `hmq.css` | Popup card, section/row styles, log modal, Return-workbench toolbar button |
| `page-hmq-dashboard.html`/`.js`/`.css` | Extension-popup dashboard — read-only date-range history board |

## Gotchas

- Ward/room extraction is page-specific: `extractWardRoom` (this file) reads
  the Return workbench's own "Bed Details" table; `detectWardBed` (in
  `content-hmr.js`, used by the Ward View ➕ button and auto-add) reads the
  "Ward / Bed :" line in the Visit Details panel instead — different pages,
  different DOM, so they don't share a helper.
- `_id` fields inside queue entries are day-scoped display numbers
  (`queueNum`), not database keys — the actual key is the file-name-derived
  `id` (`HMQ-YYYYMMDD-NNNN`), stable across the nightly merge.
