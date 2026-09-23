# Paperless Checker — BKN Pharmacy Portal Automate

## Start

Reload BKN Pharmacy Portal at chrome://extensions, then reload the ArcusAir tab. Close the old standalone checker/bookmark overlay and disable the separate test extension if it is installed.

On the active ArcusAir tab, open BKN Pharmacy Portal → Automate → Paperless Checker → Open Checker. Choose First check or Second pharmacist. Opening does not select a mode or start dispensing. Page reload never resumes checking/dispensing.

First check selects Ordered only. Second pharmacist selects exactly Allocated, Partial Checkedin, Partially Allocated, Partially Cancelled, and Partially Dispensed. Both use the normal status selector and automatically click Search.

## Scan flow

- Keep the scanner input focused. Enter/Tab submits immediately; no suffix submits after 800 ms without input. Receive remains a fallback.
- Prescription begins uppercase I, O, or E. Fill Order Number, Search, wait for fresh results, open the first exact-matching order row, and verify the details heading.
- Match medicine codes exactly to the open order's #ordertable rows. Each matching scan adds a check mark. Repeated codes on multiple rows require one scan per row.
- After all rows are checked and unchanged, click the enabled #dispensetodept once.
- On /pharmacy/dispensetodept, confirm the same prescription and medicine codes, then click the enabled vm.verifyDispense button once. This continuation expires after 30 seconds.
- When ArcusAir returns to the workbench, clear the old order, restore the five statuses, and focus the scanner for the next prescription.
- Stop is always available on the checker; the popup also has Stop Checker. A sent click cannot be undone. Stopping cancels further checking/continuation and removes marks.

Final button clicks and return navigation are logged as such; they do not establish successful server-side dispensing. Further native dialogs are not automatically accepted. Code matching does not verify physical quantity or clinical suitability.

## Shared integration

- Existing popup scripting/navigation utilities target the current ArcusAir tab.
- ArcusShared.CONFIG supplies the workbench and final-dispense routes.
- ArcusPanelHost retains the checker DOM and controls across SPA replacements.
- Checker ownership is per tab and blocks batch Allocate/Dispense and IP Fill. An active batch or override handler blocks checker startup.
- Automatic override handling is suspended while checker is open; preferences are preserved and handling can resume after Stop.
- The ordinary workbench panel is hidden while checker owns the tab. No new permissions or backend dependency.
- Scanner session, pending transitions, and attempted-prescription guards stay in memory. Nothing auto-resumes on reload.

## Session logging

Open Filter / scanner activity → Export session log to download JSON containing all recorded events and scan outcomes from this checker session. The visible log is bounded; the export retains the session events. Recent review snapshots are saved in this Chrome profile (up to 20 sessions, 1,000 events per session and 2 MB total). Logs are not sent to the pharmacy server or synchronized to other workstations. Export the full session before stopping/reloading if you need events beyond the retained limit. This feature does not yet implement staff sticker-collection records or authenticated preparer/checker identities.

## Verification

Run:
- node --test BKNPharmacyPortal/src/features/automate/tests/tab-behavior.test.cjs
- node BKNPharmacyPortal/src/features/automate/tests/browser-paperless.cjs
- node BKNPharmacyPortal/src/features/automate/tests/browser-panels.cjs

The browser tests run the actual extension content modules against fictional DOM fixtures and fake transaction buttons. No live clinical transaction is executed by the tests.


## Compact panel (4.8.1)
Drag the header to move the panel; its position is saved using Automate's per-tab settings. Mode buttons sit side by side, with the scanner below. Activity, filter details, instructions and log export are collapsed under Activity & details. Stop remains visible. The workflow and dispense guards are unchanged.


## Mode reset (4.8.2)
Clicking either mode first clicks ArcusAir Clear (#cancelsearch), waits for Order Number to clear, then selects the required statuses and clicks Search. Missing/disabled Clear blocks the mode switch. Automatic standby does not clear unrelated filters again.

## Current data and review logs (4.8.3)

Open **BKN Pharmacy Portal → Automate → Paperless Checker → Current data & review logs**. The extension page is `paperless-review.html` (with separate CSS and JavaScript). Reload the extension and ArcusAir tabs once after updating.

- Select an ArcusAir tab to see its checker mode, prescription, current status, medicine codes and checked-row progress. Live refresh runs every three seconds while the review page is visible and can be paused.
- Review recent sessions across tabs in this browser profile. Search prescription/code/event text, filter scan/action/attention events, page through results, and export all matching events as JSON.
- **Go to ArcusAir** focuses the selected source tab. Reviewing does not start the checker, switch its mode, scan medicines, or send dispensing actions.
- Snapshots are published only when state changes; background writes are serialized across tabs. Session history survives stopping the checker and reloading Chrome. The live scanner state is never restored from history.
- A history entry marked **Last seen active** is a saved snapshot, not a claim that the tab is still running. Browser closure or page reload can end a session without a final stop event. The live section reads the current tab directly.
- Old sessions predating this update are unavailable. Saved logs contain prescription identifiers and medicine codes, but do not capture full patient DOM, cookies, or authentication tokens. No preparer/checker identity is inferred.
- Retention is bounded to 20 recent sessions, the latest 1,000 events per session, and 2 MB overall. Older history is removed as this limit is reached. The existing in-panel export still exports the full in-memory session.

Verification: `node --test BKNPharmacyPortal/src/features/automate/tests/paperless-review.test.cjs`, `node BKNPharmacyPortal/src/features/automate/tests/browser-paperless-review.cjs`, and `node BKNPharmacyPortal/src/features/automate/tests/browser-paperless.cjs`. All browser fixtures use synthetic data and fake transaction buttons.

## Staff medication preparation

The **Prepare medication** button opens the pharmacy server's `/static/medication-preparation/index.html`. Staff select their name from the IV sticker master, scan an order, and receive a confirmed server-log acknowledgement. The page includes searchable preparation history; dashboard integrations can query `/api/medication-preparations` by date, order number and staff name. These shared preparation records are separate from browser-local checker session logs. See the pharmacy server README for the API schema and deployment step.
