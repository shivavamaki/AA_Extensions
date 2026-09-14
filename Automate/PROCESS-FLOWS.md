# Automate process flows — current implementation

Reviewed 2026-09-14; behavior layer updated to manifest **4.7.0**. Clinical workflow branches below remain the source-review baseline. Static source review; no live automation or clinical transaction was executed. Diagrams describe implemented behavior, including failure branches, rather than intended behavior. View with a Mermaid-capable Markdown preview.

## Behavior update: 4.7.0

Settings use independent tab profiles in PC-local Chrome storage. New/duplicated tabs start independently; reload and Chrome session-token restoration recover the same tab settings. No settings are written to the shared folder or Chrome Sync. Runs wait for pending settings restoration.

All six active panels retain their original DOM nodes while running, even off their normal routes or after DOM removal. They stay expanded with Stop available; Close/Minimize and popup dismissal are blocked during runs. Full page reload still ends an in-memory run. IP Fill mode cannot be changed by route detection during a run.

Image fallback downloads bind filename and URL in one request; the shared next-download filename slot has been removed.

## Inventory and run conditions

| Process | Trigger and conditions | Source |
|---|---|---|
| Auto Allocate | Workbench button; correct route; no other workbench task running | content/automation.js:767 |
| Auto Dispense | Separate workbench button; same shared running guard | content/automation.js:767 |
| IP Fill | Run button; idle; at least one ward selected; IP Fill mode | content/ipfill_panel.js:788 |
| POM IP Fill | Same engine, POM mode and routes | content/ipfill_panel.js:11 |
| Auto override | Enabled preference; matching alert dialog appears; handler not busy | content/auto-override.js:447 |
| Drug image collection | Start on Item Master; idle; localhost medication DB available | content/drug-image.js:737 |
| Image flag synchronization | Sync button; image module idle; DB and image file list available | content/drug-image.js:669 |
| Frequency Master export | Start from Frequency Master panel; idle | content/frequency-master.js:334 |
| Order Item instructions export | Start; idle; medication DB contains codes | content/order-item.js:358 |
| HIS Translation API export | Start; idle; API mode selected, the default | content/translation.js:1020 |
| HIS Translation DOM export | DOM selected or API startup failure | content/translation.js:1078 |
| Translation enrichment helper | Programmatic enrichExport(payload); nonempty rows; captured authentication | content/translation.js:1439 |
| HM workstation | Not loaded by manifest; Start only writes a placeholder message | content/hmr.js:330 |

All active content scripts match https://arcusair.bdms.co.th/*. Relevant route plus saved dismissal state controls panel visibility. Opening a panel does not start its batch. Each module has its own running flag; Allocate and Dispense share one flag. No extension-wide lock exists. Auto override can remain active independently of batches.

## 1. Startup, routing and popup

```mermaid
flowchart TD
 A[Open workflow from popup] --> B{Arcus tab in current window?}
 B -->|Yes| C[Activate tab; navigate by hash]
 B -->|No| D[Create tab at workflow URL]
 C --> E[Content modules inspect route]
 D --> E
 E --> F{Relevant route and not dismissed?}
 F -->|Yes| G[Create panel and restore settings]
 F -->|No| H[Keep absent or remove panel]
 G --> I[User starts selected process]
 J[Auto override enabled or restored] --> K[Watch dialog mutations independently]
```

Source: manifest.json, popup.js, content/boot.js and each panel's init function. Generic workbench route matching uses the entire pharmacy workbench prefix, so IP Fill start pages also match it. Panel dismissal is separate from Stop.

Translation popup additionally checks panel presence up to 3 times. If its content script is missing, it injects CSS and API/driver/shared/translation dependencies, retries after 500 ms, then either closes the popup or reports the observed route/dependency/dismissal problem. Other popup controls mainly dispatch show/remove events. Diagnostics, log copying and endpoint detection are manual support controls.

## 2. Allocate and Dispense eligibility

| Gate | Auto refresh-search mode | Semi-auto mode |
|---|---|---|
| Allocate status | Column 8 equals Ordered, case-insensitive | No status gate |
| Dispense status | Column 8 equals Allocated, case-insensitive | No status gate |
| IPD order number | Column 10 begins I, case-insensitive | No number gate |
| OPD order number | Column 10 begins O or E, case-insensitive | No number gate |
| IPD type | All, Daily Order, Continuous Order, Discharge Medication | Same filter; recognized row required |
| OPD type | All, STAT, ROUTINE | Same filter; recognized row required |
| Multiple types | OR; All overrides other selections | Same |
| Selection | Refresh then first eligible rendered DOM row | Snapshot matching visible rows once |
| No rows | Scan up to 8 seconds; wait 30 seconds; repeat | No rows found; return |
| End | Stop/error or 500 search loops | Stop or end of snapshot |

Pharmacy type: explicit preference, otherwise detected page label/URL, otherwise inpatient. Prefix checks do not validate the complete order number. Semi-auto is not limited to rows manually checked by the user: it snapshots rows matching its filters.

Sources: shared.js:289–424, shared.js:1059–1096, automation.js:190–330.

```mermaid
flowchart TD
 A[Click Allocate or Dispense] --> B{Workbench route and idle?}
 B -->|No| X[Alert and return]
 B -->|Yes| C{Auto mode?}
 C -->|Yes| D[Reset counts; target Ordered or Allocated]
 D --> E{Stop or 500 loops used?}
 E -->|Yes| END[Release running flag and highlight]
 E -->|No| F[Click Search and scan eligible rows]
 F --> G{Outcome?}
 G -->|No match| H[Waiting countdown: 30 seconds]
 H --> E
 G -->|Search failure| I[Stopped by error]
 I --> END
 G -->|Found| J[Process first row]
 J --> K{Result OK?}
 K -->|Yes| L[Increment processed and success]
 K -->|No| M[Increment processed and fail]
 L --> E
 M --> E
 C -->|No| N[Snapshot filtered visible rows]
 N --> O{Any rows?}
 O -->|No| P[No rows found; return]
 O -->|Yes| Q[Reset counts]
 Q --> R{Stop or snapshot exhausted?}
 R -->|Yes| S[Stopped or Completed with counts]
 S --> END
 R -->|No| T[Find snapshot row and process]
 T --> U[Increment processed and success or fail]
 U --> R
```

Auto failures at row level normally continue refreshing. A persistent failed row may be selected repeatedly. Search-level failure stops without incrementing row fail count. Reaching 500 loops releases the flag but has no explicit Completed status. Empty searches consume loops too.

## 3. Per-row Allocate / Dispense and re-confirmation

```mermaid
flowchart TD
 A[Find and click row] --> B{Opening alert present?}
 B -->|Yes| C[Mark all viewed or individual viewed buttons; close alert]
 B -->|No| D{Operation?}
 C --> D
 D -->|Allocate| E[Wait enabled Allocate action; click]
 D -->|Dispense| F[Wait enabled Dispense action; click]
 E --> G{Allocate route and confirm ready?}
 F --> H{Dispense route, selected Angular order, items above zero, confirm ready?}
 G -->|No| FAIL[Row failure]
 H -->|No| FAIL
 G -->|Yes| I[Click confirm and settle]
 H -->|Yes| I
 I --> J{Click accepted?}
 J -->|No| FAIL
 J -->|Yes| K[Wait dialog render and auto-override idle]
 K --> L{Manual override dialog and wait setting enabled?}
 L -->|Yes| M[Wait for closure up to 180 seconds]
 M -->|Stop or timeout| FAIL
 M -->|Closed| CHECK[Commit check]
 L -->|No| N[Close remaining generic dialogs as applicable]
 N --> CHECK
 CHECK --> O{Returned to workbench?}
 O -->|Yes| OK[Row success]
 O -->|No| P{Still operation page?}
 P -->|No| Q[Wait workbench readiness]
 Q -->|Ready| OK
 Q -->|Timeout| FAIL
 P -->|Yes| R[Wait confirm ready; re-click]
 R -->|Unavailable or rejected| FAIL
 R -->|Accepted| S[Settle; handle remaining dialogs]
 S --> T{Auto override awaiting pharmacist?}
 T -->|Yes| U[Wait for pharmacist or Stop]
 U -->|Stop| FAIL
 U -->|Cleared| V[Wait for workbench]
 T -->|No| V
 V -->|Ready| OK
 V -->|Not ready| W{Still operation page and fewer than 3 re-confirms?}
 W -->|Yes| Y[Settle in-flight requests]
 Y --> CHECK
 W -->|No| FAIL
```

Routes: Allocate uses #!/pharmacy/allocatedispense; Dispense uses #!/pharmacy/dispensetodept. Action wait ceiling 18 seconds; route wait 20 seconds; save settle 15 seconds. Dispense additionally checks the page controller has a selected order and nonzero item count before allowing confirm.

Re-confirmation allows up to three additional presses after the initial confirm. Success is inferred from return/readiness, not an independent backend status read.

Semi-auto permits up to 3 attempts for Allocate action/route failures and synchronous exceptions in its per-row block. It does not retry every returned save failure. Snapshot matching falls back exact text → containment → original row index, which can identify a different row after changes.

Sources: automation.js:332–643, shared.js:810–1017.

## 4. Automatic override and manual waiting

Default disabled. Default reason: Medically needed. DOM observer debounce: 250 ms. It is not restricted to a running workbench batch.

```mermaid
flowchart TD
 A[Dialog mutation or explicit check] --> B{Enabled and not busy?}
 B -->|No| X[No action]
 B -->|Yes| C{Matching visible dialog with Save?}
 C -->|No| D[No action; clear human-wait state if dialog gone]
 C -->|Yes| E{Same failed or blocked signature?}
 E -->|Yes| X
 E -->|No| F[Read item and alert rows]
 F --> G{Detected allergy row?}
 G -->|Yes| H[Increment skipped; awaitingHuman true; PHARMACIST REQUIRED]
 H --> HUMAN[Leave for manual handling]
 G -->|No| I{Pharmacy reason select exists?}
 I -->|No| J{Save enabled?}
 J -->|No| ERR[Failure; remember signature; leave manual handling]
 J -->|Yes| K[Click Save; return click result]
 I -->|Yes| L[Choose configured reason]
 L -->|Failed| ERR
 L -->|Selected| M{Save enabled within 4 seconds?}
 M -->|No| ERR
 M -->|Yes| N[Click Save]
 N --> O{Accepted and closes within 8 seconds?}
 O -->|Yes| OK[Increment handled; Override saved]
 O -->|No| ERR
 HUMAN --> P[Dialog disappears: clear human-wait state]
```

Allergy detection: applied drugallergybackground class, inline cell color containing 246,172,172, or English text matching drug allergy / allergy interaction / allergic. The declared alert-type constant is not directly evaluated by detection.

Reason selection: use existing desired value, otherwise open its own select menu up to 3 attempts, match exact text then substring, wait for interactivity, click and verify a displayed/nonempty value. Missing/disabled menu, absent option, unapplied value or Save failure leaves manual handling. No-reason Save branch does not verify closure or increment handled.

**Integration gap:** shared alert acknowledgement and generic-close helpers do not consult the allergy guard. Re-confirmation calls close helpers before checking awaitingHuman. Therefore the module's allergy exclusion is not an end-to-end guarantee that every helper leaves an allergy dialog open. The specialized pharmacist wait is indefinite until cleared/Stop; the ordinary manual override wait is 180 seconds.

Sources: auto-override.js:110–568; shared.js:871–1017; automation.js:431–440.

## 5. IP Fill and POM IP Fill

| Mode | Start route | Detail route |
|---|---|---|
| IP Fill | #!/pharmacy/dispenseworkbench/pharmacy/ipfill | #!/pharmacy/ipfilldetail |
| POM IP Fill | #!/pharmacy/dispenseworkbench/pharmacy/pomipfill | #!/pharmacy/pomipfilldetail |

Same algorithm, saved mode and selected wards. URL synchronizes mode. Ward options: Cardiac Care Unit, Intensive Care Unit, Labour Room, Neonatal Intensive Care Unit, Nursery, WARD 4–9.

```mermaid
flowchart TD
 A[Run] --> B{Idle and wards selected?}
 B -->|No| X[Return; selection message if empty]
 B -->|Yes| C[Save wards; reset progress]
 C --> D{Stop or no more wards?}
 D -->|Yes| END[Stopped at index or Done: processed ward options]
 D -->|No| E{Already matching detail page?}
 E -->|No| F[Go start; click New; wait detail]
 E -->|Yes| G[Clear and type ward]
 F --> G
 G --> H{Autocomplete option?}
 H -->|Yes| I[Exact, starts-with, contains, then first option]
 H -->|No| J[Enter fallback]
 I --> K[Click Search]
 J --> K
 K --> L{Outcome within 25 seconds?}
 L -->|Dialog| M[Wait up to 180 seconds for closure]
 M -->|Closed| N{Outcome within 10 seconds?}
 M -->|Timeout or Stop| ERR[Ward failed]
 L -->|No results| O[Clear search or input; skipped]
 N -->|No results| O
 L -->|Timeout or stopped| P[Skipped]
 N -->|Other than confirm| P
 L -->|Confirm ready| Q[Click Confirm and settle]
 N -->|Confirm ready| Q
 Q --> R{Dialog present?}
 R -->|Yes| S[Wait up to 180 seconds for closure]
 R -->|No| OK[Finished ward; success log]
 S -->|Closed| OK
 S -->|Timeout or Stop| ERR
 F -->|Control or route error| ERR
 G -->|Input error| ERR
 K -->|Control error| ERR
 ERR --> NEXT[Next ward; 1 second between wards]
 O --> NEXT
 P --> NEXT
 OK --> NEXT
 NEXT --> D
```

Search outcome priority: Stop → dialog → no results → confirm. A second pre-confirm dialog is skipped, not recursively awaited. Reset failure still advances. Confirm click result and committed state are not validated; no post-alert re-confirmation exists here. Final Done counts attempted ward options, including skipped/failed ones. Sources: ipfill_panel.js:574–831.

## 6. Drug image collection

Dependencies: localhost:8765 /api/medication-db, /api/med-images-list, /api/med-images/{filename}. List route #!/inventories/itemmaster; detail #!/inventories/itemmasterdetail.

```mermaid
flowchart TD
 A[Start on Item Master while idle] --> B[Auto-sync existing files: only set has_image true]
 B --> C[Read DB and file stems]
 C -->|DB failure| ERR[Server error; return]
 C --> D[Pending: has_image strictly false and no matching file stem]
 D --> E{Any pending?}
 E -->|No| EMPTY[No pending images]
 E -->|Yes| F{Stop or end?}
 F -->|Yes| DONE[Stopped or Completed: OK and fail counts]
 F -->|No| G[Ensure list; optional include inactive; search code]
 G --> H{Modify found?}
 H -->|No| FAIL[Record failure]
 H -->|Yes| I[Open detail; enable additional image details]
 I --> J{Download button found?}
 J -->|No| K[Close detail; failure]
 J -->|Yes| L{Usable URL and server upload succeeds?}
 L -->|Yes| M[Saved to server]
 L -->|No| N[Request download URL and filename together]
 M --> O[Cancel detail; confirm Yes; return list]
 N --> O
 O --> P[Attempt has_image true in DB; success]
 G -->|Exception| FAIL
 I -->|Exception| FAIL
 O -->|Exception| FAIL
 FAIL --> R[Best-effort close; next code]
 K --> R
 P --> R
 R --> F
```

File-list failure during pending selection is treated as an empty list. Browser fallback reports success after triggering download, not completion. markImageDone does not propagate unsuccessful DB writes. Source: drug-image.js:385–794, background.js.

## 7. Explicit image flag sync

```mermaid
flowchart TD
 A[Sync while idle] --> B[Fetch DB and file list]
 B --> C{Both successful?}
 C -->|No| ERR[Sync failed]
 C -->|Yes| D[For each code: has_image equals file membership]
 D --> E[PUT complete DB through background]
 E --> F{Write successful?}
 F -->|Yes| OK[Done: changed and pending counts]
 F -->|No| ERR
 OK --> END[Release running flag]
 ERR --> END
```

Explicit Sync can set true to false; automatic pre-run sync only sets true. Explicit sync does not check Stop in its loop. Source: drug-image.js:669–733.

## 8. Frequency Master export

```mermaid
flowchart TD
 A[Start while idle] --> B[Ensure Frequency Master and Search]
 B -->|No control or rows| ERR[Failed]
 B --> C[Collect unseen rendered code-name keys]
 C --> D{Stop?}
 D -->|Yes| EXPORT[Download accumulated JSON]
 D -->|No| E{Unseen rows?}
 E -->|Yes| F[Re-find row; Modify; wait matching dialog]
 F -->|Success| G[Read fields, languages, switches, timings; close]
 F -->|Failure| H[Append error record; attempt close]
 G --> I[Mark seen; update progress]
 H --> I
 I --> C
 E -->|No| J[Scroll; update idle score]
 J --> K{Idle score reaches 4?}
 K -->|No| C
 K -->|Yes| EXPORT
 EXPORT -->|Accepted| OK[Stopped or Completed with downloaded count]
 EXPORT -->|Error| ERR
```

Route #!/ordermanagement/frequencymaster. Output frequency-master-{timestamp}.json. Idle score adds 1 if scroll moved or more-data hint exists, otherwise 2; resets when pending rows exist. Row errors are exported and marked seen, without retry. Outer fatal error does not automatically export partial data. Source: frequency-master.js:247–405.

## 9. Order Item instruction export

```mermaid
flowchart TD
 A[Start while idle] --> B[Ensure list; fetch medication codes from local DB]
 B -->|Read error or empty codes| ERR[Failed]
 B --> C{Stop or codes exhausted?}
 C -->|Yes| EXPORT[Download results and counts]
 C -->|No| D[Search next code; find matching row]
 D -->|No result| E[status not_found; empty instructions]
 D -->|Found| F[Modify CRUD; scrape instruction blocks]
 F --> G[Cancel; confirm Yes; recover list route if needed]
 G -->|Success| H[status ok; instruction count]
 D -->|Exception| I[status error]
 F -->|Exception| I
 G -->|Exception| I
 I --> J[Best-effort Cancel or list navigation]
 E --> C
 H --> C
 J --> C
 EXPORT -->|Accepted| OK[Stopped or Completed: OK, not found, error counts]
 EXPORT -->|Error| ERR
```

Route #!/ordermanagement/orderitem with /crud for detail. Output order-item-instructions-{timestamp}.json. Status ok means successful scrape/return, and may contain zero instructions. Source: order-item.js:120–432.

## 10. HIS Translation API and DOM export

```mermaid
flowchart TD
 A[Start; reset rows] --> B{API mode?}
 B -->|Yes| C[Ensure captured authentication; trigger Search if needed]
 C -->|Failure| FALL[API unavailable; clear rows; use DOM]
 C --> D[Fetch sigcode search pages]
 D --> E{Request outcome?}
 E -->|Failure, no rows| FALL
 E -->|Failure, partial rows| KEEP[Keep partial rows and log error]
 E -->|Success| F{Empty page, no new IDs, Stop or 200 pages?}
 F -->|No| D
 F -->|Yes| KEEP
 KEEP --> G{Rows and not stopped?}
 G -->|Yes| H[Fetch detail by ID: 6 concurrent requests]
 H --> I[Merge languages; retain per-record failures; log warnings]
 G -->|No| EXPORT[Export rows]
 I --> EXPORT
 B -->|No| DOM[Ensure list; Search]
 FALL --> DOM
 DOM --> J{Stop or idle score reaches 4?}
 J -->|Yes| EXPORT
 J -->|No| K{Unseen rows?}
 K -->|No| L[Scroll and update idle score]
 L --> J
 K -->|Yes| M[Re-find row; Modify; wait CRUD; verify identity; scrape]
 M -->|Success| N[Cancel and return; append details]
 M -->|Failure| O[Append error record; best-effort Cancel]
 N --> P[Mark seen; refresh Search]
 O --> P
 P -->|Success| J
 P -->|Failure| EXPORT
 EXPORT --> Q{Any rows?}
 Q -->|No| EMPTY[Stopped or Completed: no rows scraped]
 Q -->|Yes| R[Background JSON download; page-download fallback]
 R --> DONE[Stopped or Completed with downloaded count]
```

Route #!/ordermanagement/translation, CRUD suffix /crud. Search: /ordermanagement/sigcode/search with code/name empty, all=true and includeall=true. Detail: /ordermanagement/translation/getdetail/{id}. Output his-translations-{timestamp}.json.

Pagination deduplicates by _id or serialized record. A partial API failure with rows does not trigger DOM fallback. Detail failures, fewer rows than visible UI, or no local-language text can still end as Completed. DOM idle scoring matches Frequency Master. DOM refresh failure returns rows for export.

Unexpected outer failure attempts partial export in finally if rows exist and export was not attempted. The exported flag is set before final download, so that guard does not retry a failed final download. Source: translation.js:945–1137, api-client.js:241–313.

### Separate translation enrichment helper

```mermaid
flowchart TD
 A[enrichExport payload] --> B{Nonempty array or payload.rows?}
 B -->|No| ERR[Throw error]
 B -->|Yes| C[Ensure captured authentication]
 C -->|Failure| ERR
 C --> D[Use supplied rows; fetch details with shared enrichment engine]
 D --> E[Count enriched, failed and rows with local text]
 E --> F[Build output; download JSON]
 F --> G[Return enrichment counts]
```

This enriches supplied records rather than discovering the full list. It shares module state and has no runScraper-style running guard. Source: translation.js:1439.

## 11. Shared driver, API bridge and background

```mermaid
flowchart TD
 A[Click requested] --> B{Element passes click guards?}
 B -->|No| FAIL[Rejected with reason]
 B -->|Yes| C{Recent duplicate without allowRepeat?}
 C -->|Yes| FAIL
 C -->|No| D[Scroll into view]
 D --> E{Turbo attached and clear click point?}
 E -->|Yes| F[CDP trusted input]
 F -->|Success| OK[Accepted click]
 F -->|Failure| G[Degrade to DOM mode]
 E -->|No| H[Synthetic DOM input]
 G --> H
 H --> I[Settle if requested]
 I --> OK
```

Turbo preference attempts debugger attachment; attachment/command failure permits DOM fallback. Mutation-driven waits have timeouts. Click acceptance and network settling do not themselves prove transaction success. Source: driver.js, cdp-bridge.js.

| Service action | Flow and outcome |
|---|---|
| serverGet | Fetch URL → parse JSON → HTTP ok/status/data or caught error |
| uploadMedImage | Fetch image with cookies → PUT bytes to localhost → HTTP result/error |
| putMedicationDb | PUT JSON DB to localhost → HTTP result/error |
| downloadJson | JSON data URL → Chrome Save As download → download ID/API error, not completion |
| downloadMedImage | Download the supplied URL with its own filename; return download ID or error |
| CDP messages | Attach/debugger input/evaluation/network tracking → result or error |
| Page hook/API client | MAIN-world request observation → capture authentication and request metadata → API calls; also model diagnostics/recording support |

page-hook.js loads at document_start; other manifest content modules at document_idle. These support services are not scheduled jobs.

## 12. HM workstation: inactive and unfinished

```mermaid
flowchart TD
 A[Current manifest] --> B[hmr.js absent: no normal activation]
 C[If separately loaded] --> D{Ward view and Visit Details heading?}
 D -->|No| E[Remove workstation UI]
 D -->|Yes| F[Detect room; restore state; show trigger]
 F --> G[Open workstation; detect discharge status; answer checklist]
 G --> H{All 3 checks answered yes or no?}
 H -->|No| I[Start disabled]
 H -->|Yes| J[Start enabled]
 J --> K[Click Start: save auto steps pending implementation]
```

Checklist completeness, not all-Yes, enables Start. Existing incomplete room state can reopen the workstation. Reset creates fresh room state. No actual automated HM steps exist. Source: hmr.js:155–218, hmr.js:284–380; manifest.json.

## Status interpretation and upgrade baseline

| Current signal | What it actually establishes |
|---|---|
| Workbench success | Operation returned to workbench/readiness path |
| IP Fill Done | Selected ward loop finished, even with failed/skipped wards |
| Image success | Server upload or browser download trigger; DB marking is best effort |
| Scraper Completed | Loop/export ended, potentially with error records or partial data |
| Downloaded JSON | Download request accepted or page download triggered |
| Stop | Cooperative flag checked by loops/waits, not rollback of completed actions |

Priority findings:
1. Centralize alert handling so shared close/viewed helpers respect the allergy exclusion before acting.
2. Verify actual committed outcomes, especially IP Fill confirm and post-alert re-confirmation.
3. Strengthen identity: semi-auto index fallback, first-option ward fallback and fixed-column status checks.
4. Add explicit partial/skipped/failed results and 500-loop termination status.
5. Define cross-module ownership and bounded retry rules; persistent auto row failures can be selected repeatedly.
6. Verify image file completion and DB write outcomes before marking success.
7. Keep internal version labels aligned with manifest 4.7.0 and document HMR as inactive.

These are code-review findings; workflow source was not changed.

