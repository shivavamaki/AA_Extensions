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
- **Name is Thai-only in the row (display-only).** Names are stored
  "ENGLISH - ไทย"; `displayName()` shows just the Thai part (falls back to the
  full string when there's no " - "). The stored entry and the log modal keep
  the **full** name, so search/records/reports are unaffected.
- **New-Case age alerts.** New-Case rows are timed against `createdAt`
  (`ageMinutes()`): **> 15 min** → row turns light orange with a `⚠ {age}`
  badge (`.hmq-age-warn`); **> 1 hr** → light red with a pulsing `⏰ {age}`
  badge (`.hmq-age-late`). A light `renderPopup` tick (`AGE_TICK_MS`, 30 s)
  updates the colour/badge between the slower server polls. Thresholds:
  `AGE_WARN_MIN` / `AGE_LATE_MIN` in `content-hmq.js`.
- **Fit-to-content height.** The body grows to show all rows and only scrolls
  once it would exceed the viewport (`.hmq-body { max-height: calc(95vh - 40px) }`).

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
| `PUT` | `/api/hmq/{id}` | Transition — `{action: 'start'\|'complete'\|'revert-process'\|'revert-new', user}`, or **backfill location** — `{action: 'update-loc', ward, room, user}` |

- **Timezone.** Days are keyed to **Asia/Bangkok** everywhere: the client queries
  the Bangkok date (`todayStr` = `now + 7h`), `_hmq_today()`/`_hmq_next_seq`/
  archival use `_bangkok_today()`, and `load_all_hmq`'s date filter compares each
  entry's Bangkok day (`_bangkok_date_of(createdAt)`, since `createdAt` is UTC).
  Previously the filter used the raw UTC date slice, so entries added in the
  00:00–07:00 Bangkok window (UTC still on the previous day) vanished from the
  "today" query on reload — that's fixed.

- **Duplicate guard** (`hmq_find_active_by_hn`): keyed on HN. A new `POST`
  is rejected (`409`) if that HN already has a `new` or `process` entry
  today; allowed if its only entries today are `done`. On a 409 the client
  backfills the existing entry's location (`update-loc` → `update_hmq_location`):
  fills a **blank** ward/room, and **corrects a dirty** stored room (one that
  differs from its own `_clean_room()` form, e.g. an old `CCU06Start`), leaving
  already-clean values untouched — so a case queued before its bed could be
  read, or with a bad value from an earlier build, gets fixed on the next
  auto-add pass.
- **Room sanitizing**: `_clean_room()` runs on every write (`create_hmq_entry`,
  `update_hmq_location`) and the popup's `cleanRoom()` runs on display — both
  strip a trailing "Start" and keep the leading `[A-Za-z0-9-]+` token, so a bed
  id can't carry adjacent UI text.
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
- **`action: 'log'` — record an ArcusAir-side event.** Appends one audit line
  (`action_text` + `user`) **without changing status**, so a case can receive
  one before Start or after Complete. Used for two milestones that happen in
  ArcusAir rather than in our UI:

  | Event | ArcusAir button | Page |
  |---|---|---|
  | Medicine returned | `#verifydispensereturn` ("Verify Return") | `dispenseworkbench/pharmacy/return` |
  | Standing orders closed | `[ng-click^="closeOrder("]` ("Close Continuous Orders") | `#!/inpatient/dischargeprocess` |

  Both give the **real** time (the click itself) and the **real** actor (read
  from `.headUserDetBtn`, i.e. the ArcusAir account that pressed it — not
  whoever has our card open). Deduped per selector so a double-fired Angular
  click cannot write the line twice.

  The Close Continuous Orders button has **no id**, so it is matched on
  `ng-click` *and* `aria-label`, with a prefix (`^=`) rather than an exact
  match: a template tweak like `vm.closeOrder()` or a stray space would
  otherwise stop the logging silently, and the generated `md-*` classes are not
  a usable anchor.

  `content-hmr.js` keeps a **fallback** that logs the same two milestones from
  the API flag flipping `false→true`. Those lines are labelled **"(detected)"**
  and carry **no user** — they only fire when the action happened on a machine
  that never had the relevant page open, so all we ever saw was the flag. The
  server stores the raw (empty) user rather than its `Unknown` default, so the
  modal shows nothing instead of a failed lookup.

  > The manual **➕ Add new case** button on the Return workbench is **gone** —
  > the case is already auto-enqueued at discharge stage 1–2
  > (`maybeAutoAddToQueue`), so it was redundant. `BKN_HMQ.addCase` remains, and
  > is still what the HM Process card calls.

- **`startedBy` — who is working the case.** Set from the `start` transition's
  `user` and shown as a 👤 chip beside the HN on **On Process** rows (both the
  floating popup and the Dashboard); `revert-new` clears it along with
  `startedAt`, so a returned case doesn't keep showing its previous owner.
  Stored as its own field rather than only in `auditLog` so a row can render it
  without scanning the log. Entries created before the field existed are
  **backfilled on read** in `load_all_hmq()` from the log's "Started…" line —
  done at read time so no stored file (and no archive) is rewritten.
  The chip drops ArcusAir's title suffix (`ชื่อ สกุล, ภก.` → `ชื่อ สกุล`) to
  stay short in a 300 px popup; the full value remains in the log modal.
- **Transition failures are surfaced, not swallowed.** `putTransition()` returns
  the `serverFetch` result (or a synthetic `{ok:false,error}`) and logs a
  `[BKN-HMQ]` warning on any non-ok/thrown response. The delegated click handler
  disables the button, runs the transition, and on failure **re-enables it and
  `alert()`s the reason** so a Start/Complete that hits a server/worker hiccup
  can simply be retried (rather than silently doing nothing / staying disabled).

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
  **Only the visible window is ever fetched** — the page opens on *today* and
  asks for today alone; the 7/30-day windows are requested only when the
  pharmacist clicks them. Older days are never loaded speculatively, since the
  archives are kept forever. `_lastKey` also skips a re-fetch when the window
  hasn't changed (clicking "Today" while already on Today); **Refresh** passes
  `force` so an explicit refresh always re-queries. The server applies the same
  bound: no `from`/`to` means *today*, not everything (`?all=1` opts in).
- **Search** by HN, name (searches the **full** stored name, English *and*
  Thai), ward or bed — filtered client-side against the already-fetched range.
- **Row layout** mirrors the floating popup: `Q<n>` then a bold blue **room/bed
  badge**, since the bed is what staff scan the board for. A missing room shows
  a muted `—` badge rather than nothing.
- **Thai name only.** Names are stored as `"ENGLISH NAME - ชื่อไทย"`
  (ArcusAir's banner format); the board shows just the Thai half via
  `thaiName()`, which splits on the **last** `" - "` (English surnames contain
  hyphens — `SAE-LEE`, `MACHA-ALE`) and only accepts the tail when it really
  contains Thai characters, so a purely English name is left intact.
- Same per-case 🕒 log modal as the floating popup, but log timestamps show
  date + time (not just time) since entries can span many days.
- Deliberately **no Start/Complete/Revert buttons** — this page is for
  browsing history across workstations/days, not for working the queue; a
  note at the bottom of the page points back to the live popup for that.

### Statistics tab

A second tab (`📊 Statistics`) renders from the **same `_entries`** the board
already fetched, so switching tabs never re-queries the server — the date range
and the HN/name search apply to both views.

Every figure derives from the three timestamps a case already carries, so
nothing extra is stored server-side:

| Metric | Derivation |
|---|---|
| Wait | `startedAt − createdAt` |
| Process | `completedAt − startedAt` |
| Total | `completedAt − createdAt` |

Panels: KPI tiles (cases, cases/day, median wait, median process) · cases per
day · median time per stage (stacked) · arrivals by hour · busiest wards ·
pharmacist workload · a per-day detail table.

Three decisions worth keeping:

- **Median, not mean.** One case left open overnight turns a 14 m median into a
  2 h 41 m mean. The median reports what a typical case actually costs.
- **Missing timestamps exclude a case from that metric**, never count it as
  zero — an unfinished case has no process time, and averaging it in as 0 would
  quietly drag every figure down.
- **Bangkok day bucketing** (`bkkDay`), matching the server, so a case queued at
  03:00 Bangkok (20:00 UTC the previous day) lands on the right day.

Charts are hand-authored SVG — no library, since the MV3 CSP blocks CDN
scripts. Only the two-series stage bar uses a categorical palette
(`#2a78d6` / `#eb6834`, validated: CVD ΔE 24.7 protan / 32.7 tritan, normal
33.6 — all pass); every other chart is single-hue, because its job is magnitude,
not identity.

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
