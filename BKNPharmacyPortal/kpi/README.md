# KPI Data System (`kpi/`)

**Pharmacy KPI Data System** — daily KPI records (OPD/IPD brief & stat, med errors) with reporting.

## Data
- `GET /api/kpi` — all days; `GET/PUT /api/kpi/{date}` — one day (`YYYY-MM-DD.json`).
- Per-day doc shape: `{ date, opdBrief, ipdBrief, opdStat, ipdStat, medErrors[] }`.
- Section writes go through `/api/kpi/{date}/{section}` (server merges into the day doc).

## Files
| File | Role |
|---|---|
| `index.html` | Forms + report views |
| `app.js` | Day load/save, sections, med-error list, charts/reports |
| `styles.css` | Styling |

## Gotchas
- KPI day files are **server-written production data** under `pharmacy_server/data/kpi/` (gitignored). Never hand-edit those files.
- New KPI day files are created on demand by the server.
