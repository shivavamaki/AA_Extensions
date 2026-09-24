# Automate in BKN Pharmacy Portal

Integrated from the working Automate 4.8.3 project into Portal 3.62.2.
The original Automate directory is retained as a fallback; the portal is self-contained.

## Redundancy decisions

| Area | Decision |
| --- | --- |
| Extension manifest | One portal manifest; preserve its key, identity, permissions and features. Add downloads and debugger. Existing localhost host permission already covers port 8765. |
| Popup HTML | One portal popup with an Automate tab containing all seven cards and sixteen original controls. |
| Popup JavaScript and CSS | Separate feature controller in a private scope and styles scoped to #tab-automate. Reuse the portal's existing tab navigation and saved active tab. Remove the unused standalone version label code. |
| Background worker | One portal worker entry point imports Automate's handlers. Keep CDP, per-tab settings, downloads, and review storage in separate files. Imports resolve from the root worker. |
| Arcus MAIN hooks | Keep both: portal captures patient/reconciliation context; Automate captures auth, API discovery, interaction recording and dispense scope. Both chain their predecessors; integration tests verify native XHR runs once and both auth bridges receive data. |
| Automate content/hmr.js | Omitted: not loaded by the source manifest; the portal already owns the active HMR feature. |
| Portal paperless test overlay | Preserve as a separate existing test tool; do not inject it in the portal manifest. The integrated checker retains its conflict guard. |
| Server requests | Keep Automate serverGet and portal BKN_SERVER_PROXY contracts separate: different response shapes and existing callers. Message ownership is tested together. |
| Content modules and review page | Preserve active modules as separate files with their load order and tab-local settings. Rewrite extension-root resource URLs. |
| Tests | Keep Automate tests alongside the feature; read the actual portal manifest through a test-only path adapter, not a second manifest. |

## Behavior fixes included

- Popup navigation prefers the active Arcus tab before another Arcus tab in the same window.
- Fix the portal's pre-existing patient-context storage regression: content scripts use their in-memory context and server snapshot; trusted extension pages may also use session storage. Storage denial does not prevent the server snapshot.
- Existing working-tree changes in both projects were preserved.

## Activate

1. Stop running automation before switching extensions.
2. Disable the separate Arcus Toolkit / Automate extension to avoid two extensions controlling the same page.
3. Reload BKN Pharmacy Portal from chrome://extensions (or load this portal folder unpacked). Chrome may request the added downloads/debugger permissions.
4. Reload open Arcus tabs, then open BKN Pharmacy Portal > Automate.
5. Confirm per-tab settings before a real run. Old Automate extension-local settings and review history belong to its separate extension ID and are not automatically transferred. The portal's existing identity and storage remain intact.

## Verification

- All nine existing portal test files pass, including 32 pattern-matcher cases.
- All nineteen Automate unit cases and five new integration cases pass.
- Offline Chrome checks pass for six automation panels, twelve paperless workflow cases plus drag/position persistence, eight review-page cases, and the full portal popup.
- Popup browser check: five tabs, seven Automate cards, sixteen controls, tab persistence, review URL, and no JavaScript errors.
- Combined isolated scripts compile without global declaration collisions.
- Live authenticated Arcus/CDP actions, actual downloads, and pharmacy-server writes still require a workstation smoke check; tests used synthetic data and mocked services.

Run from EXT:

```powershell
Get-ChildItem BKNPharmacyPortal/test/test-*.js | ForEach-Object { node $_.FullName }
node --test BKNPharmacyPortal/test/test-automate-integration.cjs BKNPharmacyPortal/src/features/automate/tests/tab-behavior.test.cjs BKNPharmacyPortal/src/features/automate/tests/paperless-review.test.cjs
node BKNPharmacyPortal/test/browser-automate-popup.cjs
node BKNPharmacyPortal/src/features/automate/tests/browser-panels.cjs
node BKNPharmacyPortal/src/features/automate/tests/browser-paperless.cjs
node BKNPharmacyPortal/src/features/automate/tests/browser-paperless-review.cjs
```

To save a popup screenshot, set AUTOMATE_SCREENSHOT to the output PNG path before running the popup browser test. By default tests leave no screenshots in the repository.

## Allocation and override update (3.62.1)

The supplied workflow recording showed 65 automatic Close events in 1,013 ms. Review found HMR's passive modal closer could dispatch two clicks per attempt and retry during mutation bursts. It now yields to active Automate, IP Fill, and Paperless owners; its independent retries are bounded per dialog.

- Keep **Medically needed** as the default, as requested. The panel displays an editable Pharmacy override reason with suggestions. Selection must match the exact label offered by Arcus; missing options are left for manual review.
- Allocate is submitted once. Saving the override can itself start allocation, so the runner waits for the workbench instead of pressing Allocate again. An unconfirmed outcome stops the batch for review.
- Automatically handle the reason dialog explicitly, independently of observer timing. Failed selection and allergy alerts stay open for a pharmacist.
- Stop cancels pending option/Save work. Transactions already sent cannot be undone.
- Shared dialog closers use dialog-scoped controls, reject override/allergy dialogs, and prevent concurrent Close loops.
- HMR remains a separate feature; its active HM workflow is unchanged.

Additional regressions:

```powershell
node --test BKNPharmacyPortal/src/features/automate/tests/allocation-coordination.test.cjs
node BKNPharmacyPortal/src/features/automate/tests/browser-allocation.cjs
```

These tests use synthetic DOM and mocked services. They verify the automation logic, not a live authenticated hospital transaction. Reload Portal 3.62.1 and the Arcus tabs to activate the changes; keep the standalone Automate extension disabled.

## Alert closing and Allocate button correction (3.62.2)

Informational dialogs are distinguished from override dialogs by their input controls, not words such as “reason” in their message. The runner waits briefly for alerts after selecting a row and closes informational alerts on the allocation page before submitting. Override and allergy dialogs remain protected.

The final Allocate action prioritizes the supplied #actiondiv > button.md-primary.md-button.md-incustheme-theme.md-ink-ripple with aria-label="Allocate" and ng-click="vm.saveData()". Readiness waits for the live button to become enabled and ignores toolbar buttons, dialog Save buttons, and detached elements.

The allocation browser fixture now uses that exact markup and the real readiness helper, with delayed button enabling and delayed row/allocation alerts. All eleven allocation scenarios and twenty-six unit/integration cases pass. Reload Portal 3.62.2 and the Arcus tab to use this update. Live hospital transactions were not run.

## Compact controls and toggle feedback (3.62.3)

The floating panel uses two-column Mode/Location settings, one-row order filters, compact statistics and one current-step display. The visible log-copy control and redundant Ready/detail text are removed. Record/Export remain under collapsed Tools; diagnostic logs stay in memory. The override reason is shown only when Auto override is enabled.

Manual wait persists per tab and applies when Auto override is off; Auto override takes priority when enabled. Auto override reflects on/off/paused state, including Stop and resume. Turbo locks while connecting or disconnecting and follows the actual driver result, including refused attach/detach. Turbo remains session-only.

Test: node BKNPharmacyPortal/src/features/automate/tests/browser-panel-toggles.cjs. Set AUTOMATE_SCREENSHOT to an optional PNG path for a synthetic panel capture.

## Sidebar panel and reasons (3.62.4)

Auto override offers Doctor is Aware, For extra stock, and Medically needed (default). Existing saved custom reasons remain available. The automation panel mounts after the last item in tri-menu > md-content when the sidebar is at least 180px wide; otherwise it floats. Panel state and controls survive sidebar replacement, including during allocation. Browser checks cover all choices, docking, replacement, fallback, toggle behavior, and allocation regression flows.
