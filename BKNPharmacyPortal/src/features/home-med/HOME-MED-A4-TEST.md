# Home Medication A4 layout (TEST)

Open in Chrome after opening the normal Home Medication Sheet for the desired patient:

chrome-extension://bmnbffgenocfinghgjbfblkmggmaejpp/src/features/home-med/page-home-med-test.html

The test reads the same latest `payload_sheet` from extension session storage, calls the existing report endpoint, and loads saved medication edits. It does not use the demo's hardcoded patient snapshot. Verify the displayed patient before testing.

New files:
- page-home-med-test.html: separate production-based test page.
- page-home-med-test.js: independent copy of patient loading, translation and editing logic; automatic medication saves disabled for this test.
- page-home-med-test.css: checklist placement and A4 page styling.
- page-home-med-test-preview.js: measured page layout and temporary edit/preview toggle.

Behavior:
- A4 portrait preview defaults to fit page; content uses 8 mm top/side margins and a 12 mm bottom footer reserve.
- Checklist appears to the right of patient/clinical information. The patient-understanding checklist item is removed.
- Appointment and pharmacist signature sections are removed; appointment renderer is removed from test JS.
- Compact rows and meal cards are always enabled, with their checkboxes removed. Meal-card title is removed.
- Medicine rows are measured individually; the header repeats on each generated page. The meal-card block stays together when it fits, otherwise it starts a new page.
- Edit sheet exposes the real editable source. Show A4 preview regenerates the preview. Test edits remain in memory and are lost on reload. Production saved data is read but not overwritten by automatic saves.
- Print and PDF use the generated page arrangement; files are named TEST_HomeMedicationSheet_*. Print settings use an independent test key.

Validation: JavaScript syntax, markup structure, and shared dose regression checks passed. Live Chrome extension data loading and visual print comparison still require browser testing.

Known limit: a single medicine row or entire meal-card block taller than an A4 content area is flagged in the TEST banner; reduce font/picture size before printing. Splitting an oversized block across multiple pages is not implemented in this test.

Original page-home-med.html and page-home-med.js are not replaced or modified. No launch routing or manifest changes were made.