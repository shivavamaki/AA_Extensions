# Automate in BKN Pharmacy Portal

Integrated from the working Automate 4.8.3 project into Portal 3.62.0.
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
