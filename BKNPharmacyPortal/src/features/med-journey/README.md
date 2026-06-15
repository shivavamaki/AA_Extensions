# Medication Journey (`med-journey`)

A 🗺️ page showing **each drug's continuity across care phases** — before/admission → ward → discharge — with an editable status and note per drug.

> Distinct from `adrtimeline`, which tracks ADR events over time. This feature is a per-drug continuity grid.

## Where it runs

Opened via `OPEN_MEDICATION_JOURNEY`-adjacent routing as `page-med-journey.html`. Receives patient context (patientuid, patientvisituid, token) and fetches all orders grouped server-side.

## Data flow

1. **`POST /api/report/med-journey`** → server hits ArcusAir `getallorderitem` for **all order types** and groups them into a continuity timeline.
2. Rows returned: `{ drug, code, admission, ward, home, status, note, provider }`.
3. Drug photos: **`GET /api/medication-db`** (name/code index) + **`GET /med-image/{code}`**.

## Status model

`STATUSES = [continued, new, changed, stopped]`

Thai labels: `{ continued: ใช้ต่อ, new: เริ่มใหม่, changed: เปลี่ยน, stopped: หยุด }`

Status and note are editable per row and saved back to the server.

## Files

| File | Role |
|---|---|
| `page-med-journey.html` | Timeline grid layout |
| `page-med-journey.js` | Fetch, group, render, edit status/note, translate (Thai default) |

## Gotchas

- Instructions default to Thai via the shared glossary engine (`HMTranslate`). See [`../../shared/README.md`](../../shared/README.md).
- Server-side grouping is authoritative — the page renders what the server returns, not a client-side re-group.
