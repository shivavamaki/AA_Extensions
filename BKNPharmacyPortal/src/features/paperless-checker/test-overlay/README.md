# Paperless checker test overlay v0.7.0

Original BKNPharmacyPortal and Automate extension code is unchanged. This isolated overlay now performs a live Dispense button click when its conditions are met.

## Activate the update

Close the old overlay. Open launch.html, replace the previous bookmark with the updated teal button, and run it on the ArcusAir dispense workbench. For the separate unpacked test extension, reload it and click its toolbar icon after closing the old overlay.

## Workflow

1. First check selects Ordered only; second pharmacist selects exactly Allocated, Partial Checkedin, Partially Allocated, Partially Cancelled, Partially Dispensed. Both click Search after verifying the filter.
2. Keep the scanner field focused. Enter or Tab submits immediately. Without a suffix, input submits after 800 ms with no input. Receive remains as a fallback. Slow manual typing with a pause of 800 ms also submits; use a scanner or paste a complete code.
3. Prescription prefix must be uppercase I, O, or E. The code fills input#ordernumber with input/change events, then Search is clicked. A fresh first row must contain the exact order number before it opens. The details heading must confirm that same number.
4. Read medicine rows from table#ordertable inside the matched details panel, using tr[ng-repeat-start] bound to selecteddispense.patientorderitems and td[id^="showMonographcode"].
5. Each medicine code must match exactly. Add a green checked marker to the matched row's first cell. Do not modify ArcusAir's own row selection or model. With repeated identical codes on separate rows, each scan checks the next unchecked matching row. Further scans after all matching rows are checked are ignored.
6. When every identified medicine row is checked, click button#dispensetodept within the same panel once, only when it is visible and enabled. If disabled, show that state and wait for it to become enabled while the same checked order remains open.
7. After the checked order opens /pharmacy/dispensetodept, verify the exact prescription number and checked medicine codes in visible table cells, then click the single enabled button bound to vm.verifyDispense() once. This continuation expires after 30 seconds, is armed only by the checked-order transition, and is cancelled by reset, closing the overlay, or unrelated navigation. Directly opening the Dispense page does not arm it.\n8. Final click is recorded as sent, not completed dispensing. Server completion and any subsequent dialog still require verification; there is no automatic retry.

## Guards and reset

- Wrong codes do not mark rows or trigger Dispense.
- A nonempty medicine table with readable codes on all identified rows is required.
- Changes to the panel, row nodes, row contents (including quantities/status), row count, or cancelled-row state invalidate all marks before dispensing.
- Cancelled/discontinued rows block automatic Dispense.
- Native disabled and aria-disabled are respected. No permission or disabled-state bypass.
- Dispense is attempted only once per prescription during this overlay instance, including after New prescription. It is never retried blindly after an uncertain result.
- Scanner input is locked after a Dispense click. New prescription starts another lookup; a previously attempted order remains blocked for automatic dispensing.
- New prescription, mode/route changes, changed details, or closing the overlay removes injected marks and pending scan timers.
- Code matching checks identity, not quantities, clinical appropriateness, or physical sticker contents.
- All data stays in tab memory; this is not the production audit backend.

## Verification

Offline browser checks use fictional order rows and a fake Dispense click counter. They test automatic receiving, Enter, exact medicine matching, DOM marks, duplicate scans, disabled-button behavior, one-time triggering, changed-order invalidation, and cleanup. No live clinical transaction is executed by these tests. Live compatibility still requires testing in ArcusAir.

The supplied exact worklist tbody path remains in use. Other search filters are preserved. No refresh with an exact first-row match within 12 seconds, or no matching details within 8 seconds, leaves a visible error without establishing a checked prescription.


## Automatic standby (v0.7.0)
After the final Dispense click, wait for ArcusAir to return to the dispense workbench. Clear the previous scanner context and Order Number field, restore the five second-pharmacist statuses if needed, and focus the scanner for the next prescription. Returning to the workbench is recorded as a navigation event, not proof of server-side dispensing success. No forced navigation or blind retry is performed while ArcusAir is still on its final page/dialog.

While second-pharmacist scanning is ready, restore scanner focus every 500 ms. Do not steal focus while a visible ArcusAir dialog/status selector is open, during automation, or in a hidden browser tab. Keep the per-prescription one-click guard across standby cycles.
