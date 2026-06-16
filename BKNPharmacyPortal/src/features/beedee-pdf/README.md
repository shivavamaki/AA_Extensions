# Beedee Stock Transfer/Issue PDF (`beedee-pdf`)

Generates a printable A4-landscape PDF for Beedee stock transfer/issue, with UnitCost/Sum looked up from a bundled cost-master JSON by Hospital Code.

## Where it runs

- `background.js`'s `OPEN_PDF_PAGE` relay handler stores the payload in `chrome.storage.local` (`pdf_data`) then opens `pdf.html` in a new tab.
- `pdf.html` loads `jspdf` + `jspdf-autotable` from the shared `cdnjs/` bundle (relative path `../../../cdnjs/...` from this folder) before `pdf.js`.
- `pdf.js::initBeedeePdf()` waits for `pdf_data` to land in storage, builds a cost map from `beedee_report.json`, and calls `generatePDF()`.

## Files

| File | Role |
|---|---|
| `pdf.html` | Minimal shell — loads jsPDF/autotable + `pdf.js` |
| `pdf.js` | Waits for `pdf_data`, loads cost map, builds the PDF |
| `beedee_report.json` | Hospital-Code → cost lookup table, fetched at runtime |

## Gotchas

- `loadBeedeeCostMap()` tries `chrome.runtime.getURL('src/features/beedee-pdf/beedee_report.json')` first, then a same-folder relative fetch as a fallback — if you ever move `beedee_report.json` away from `pdf.js`, update both.
- Column-key matching for Hospital Code is intentionally loose (`'Hospital Code' ?? 'HospitalCode' ?? ... ?? 'code' ?? 'itemCode'`) to survive Thai-encoding/column-naming drift in the source export — don't tighten without checking real exports first.
