# Medication Journey (`med-journey`)

A 🗺️ timeline page showing **each drug's continuity across care phases** — before/admission → ward → discharge — with an editable status and note per drug.

> Distinct from the `adrtimeline` feature (which tracks ADR events over time). This one is a per-drug continuity grid.

## Where it runs
- Opened via `OPEN_MEDICATION_JOURNEY`-adjacent routing (`page-med-journey.html`). It receives patient context and fetches all orders grouped server-side.

## Data flow
1. **`POST /api/report/med-journey`** → server fetches the ArcusAir `getallorderitem` API for **all order types** and groups them into a continuity timeline.
2. Rows: `{ drug, code, admission, ward, home, status, note, provider }`.
3. Drug photos from **`GET /api/medication-db`** + **`GET /med-image/{code}`**.

## Status model
`STATUSES = [continued, new, changed, stopped]` with Thai labels
`{ continued: ใช้ต่อ, new: เริ่มใหม่, changed: เปลี่ยน, stopped: หยุด }`. Status + note are editable per row.

## Files
| File | Role |
|---|---|
| `page-med-journey.html` | Timeline grid layout |
| `page-med-journey.js` | Fetch, group, render, edit status/note, translate (Thai default) |

## Gotchas
- Instructions default to Thai via the shared glossary engine (`HMTranslate`).
- Server-side grouping is authoritative; the page renders what the server returns.
