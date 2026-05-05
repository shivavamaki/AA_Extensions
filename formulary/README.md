# BKN Pharmacy Formula Web App

Standalone web app. No Google Sheet and no Google Apps Script required.

## How to run

### Recommended
Double-click `run_local_server.bat`, then open the displayed local URL.

### Direct open
You can also open `index.html` directly. The app will load `data/default_formulas.js` as fallback if the browser blocks `data/formulas.json`.

## Database
Main database: `data/formulas.json`

After editing `data/formulas.json`, run `sync_json_to_fallback.bat` so direct-open mode also has the same database.

## Latest layout changes
- Date is now on the same line as the formulary name.
- Signature area now has Date fields under Prepared by and Checked by.
- Workflow section is removed for a cleaner page.


## Fixed in this version
- Instruction section is shown again in the report after the working formula table.
- Instruction editor is available in the Edit / JSON Database page.
- Formula database remains JSON-first: data/formulas.json.
- data/default_formulas.js is synced as fallback for direct index.html opening.
