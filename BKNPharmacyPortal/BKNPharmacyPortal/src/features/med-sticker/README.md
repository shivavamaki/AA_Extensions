# Medication Label Sticker (`med-sticker`)

Generates printable **medication label stickers** from the ArcusAir Dispense Workbench order table (and the POM list), with the drug name, Thai instructions, and a barcode.

## Where it runs

- **`content-med-sticker.js`** injects a 🌐✨ button into the dispense-workbench tool group. On click it parses the order table (`parser-order-table.js`) and opens **`page-med-sticker.html`** via `OPEN_STICKER`.
- **`content-pomlist.js`** injects a translation button on the **POM list** page (a separate dispense view) — gated by `isPomlistPage()`, idempotent.

## Files

| File | Role |
|---|---|
| `content-med-sticker.js` | Dispense-workbench button injection, order-table parse, route to page |
| `content-pomlist.js` | POM-list page button (separate injection point) |
| `parser-order-table.js` | Order table rows → normalized (lowercase-keyed) med rows |
| `page-med-sticker.html` | Sticker layout + print controls |
| `page-med-sticker.js` | Render stickers, language switch, revert, print |

## Key behaviors

- **Normalized keys:** `parser-order-table.js` lowercases all column keys. `page-med-sticker.js::getField()` resolves aliases in priority order — don't reintroduce case-guessing.
- **Language switch** restores the original HTML before re-translating. **Revert** always starts from a clean `_originalHTML`.
- Uses the shared translation engine (`HMTranslate` + `medical-glossary.js`) and barcode library (`vendor/jsbarcode.min.js`).

## Gotchas

- Shares the dispense-workbench tool group with home-med. Injection observers are debounced (one run per frame) — keep handlers idempotent.
- The barcode value is the **order number** (`IYYMMDDxxxx`, letter + 10 digits, no dashes), not the visit number. Same rule as patient-sticker — see [patient-sticker/README.md](../patient-sticker/README.md) for the barcode details.
