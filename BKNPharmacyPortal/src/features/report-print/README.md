# Report Print (`report-print`)

Generic HTML print renderer for popup-generated reports (currently ADR and EXP stock reports). Replaces ad-hoc per-report print logic with one shared page.

## Where it runs

- `popup.js::openPrintPage(type, data, meta)` is the single entry point — called for `'adr'` (ADR-256 report) and `'exp'` (EXP-174 report) rows.
- It writes `{ reportData: rows, reportPrintPayload: { type, meta, rows, createdAt } }` to `chrome.storage.local`, then opens `report_print.html?type=<type>` in a new tab.
- `report_print.js` reads `type` from the URL (`getTypeFromUrl()`) and `reportPrintPayload`/`reportData` from storage to render the printable table.

## Files

| File | Role |
|---|---|
| `report_print.html` | Print-page shell + styles link |
| `report_print.js` | Reads storage payload, renders table, print controls |
| `report_print.css` | Print-oriented styles |

## Gotchas

- `report_print.js` keeps `reportData` (plain rows array) for backward compatibility alongside the newer `reportPrintPayload` (rows + meta + type) — both are written by `popup.js`; don't drop either without checking which one a given report type actually reads.
- StoreBin filtering lives in `report_print.html`/`.js`, not in `popup.js` (moved out per a comment in `popup.js`) — don't reintroduce it on the popup side.
