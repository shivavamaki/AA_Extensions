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

Thai labels: `{ continued: ใช้ต่อ, new: เริ่มใหม่, changed: เปลี่ยน, stopped: ใช้ระหว่างนอน รพ. }`

Status and note are editable per row and saved back to the server. The **สถานะ
column is the last column and is screen-only (`no-print`)** — it is the editing
control that tints each row's timeline bar; on paper the status is conveyed by
the bar colour, decoded via the legend above the table.

## Phase timeline (in-table)

The **ช่วงการใช้ยา** column shows each drug's continuity as a single coloured
bar spanning the phases it is present in (`admission → ward → home`), driven by
`_barSpan(row.phases)`. The shared axis (phase labels, gradient line + dots,
admission/discharge dates) lives in that column's `<th>` so it repeats on every
printed page. There is no separate Drug Timeline page.

## Files

| File | Role |
|---|---|
| `page-med-journey.html` | Continuity grid + in-table phase timeline + by-meal home-med card |
| `page-med-journey.js` | Fetch, group, render, edit status/note, translate (Thai default) |

## Gotchas

- Instructions default to Thai via the shared glossary engine (`HMTranslate`). See [`../../shared/README.md`](../../shared/README.md).
- Server-side grouping is authoritative — the page renders what the server returns, not a client-side re-group.
