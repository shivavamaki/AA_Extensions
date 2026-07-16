# Patient Sticker & related labels (`patient-sticker`)

A family of printable patient-identity labels injected from the ArcusAir patient EMR banner. One content script, five printable pages.

## Where it runs

- **`content-patient-sticker.js`** runs on patient pages, gated by `patient-emr-banner` presence.
- This script **owns the shared `.bkn-tool-group` CSS + factory** (exposed via `document[Symbol.for("__BKN_TOOL_GROUP_FACTORY__")]`). All other features call this factory — do not create a second group.
- Injects icon buttons next to `#paprint`.
- All parsing is **inlined** in the content script because Angular's scope-destroy wipes `window.ParserPatient`. `parser-patient.js` is a mirror copy and must stay in sync.

## Pages (printable labels)

| Page | Label |
|---|---|
| `page-patient-sticker.*` | Patient ID sticker (HN, name, barcode) |
| `page-patient-address.*` | Address sticker (⛺) from the patient dialog |
| `page-med-reconcile.*` | Med Reconcile set (1 cover + N drug stickers) |
| `page-allergy-card.*` | Allergy card (8 cm × 3.5 cm) |
| `page-unreceivable.*` | Unreceivable Medicine form |

## ⚠️ Barcode rule — load-bearing

The barcode is the **ORDER number**: format `IYYMMDDxxxx` (letter + 10 digits, **no dashes**), e.g. `I2606030109`. Parsed from the "Order Details (…)" `<h4>` heading.

It is **NOT** the visit number (`I48-/O48-/E48-yy-nnnnnn`, which has dashes).

Validation regex: `ORDER_NO_RE = /\b([IOE]\d{10})\b/i` — never fall back to the visit-number pattern.

> This was reversed twice by mistake. Both inlined parser copies (`content-patient-sticker.js` + `parser-patient.js`) must stay in sync and must use this regex.

## Files

| File | Role |
|---|---|
| `content-patient-sticker.js` | Banner button injection, inlined parser, tool-group factory + CSS |
| `parser-patient.js` | Mirror of the inlined parser — keep in sync |
| `page-*.html/.js` | The five printable label pages |
| `bkh-logo.png` | Hospital logo asset |

## Gotchas

- This script **owns** `.bkn-tool-group`. adrtimeline and other features call its factory. Don't duplicate the group; append new icons into `.bkn-tool-flyout` only.
- Gate strictly on `patient-emr-banner`: the dispense queue also has `#paprint` but no banner — injecting there would swallow row-click navigation.
- `page-unreceivable.js`: `URLSearchParams.get()` already URL-decodes — don't double-decode.
