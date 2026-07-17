# KPI Data System (`kpi/`)

**Pharmacy KPI Data System** — daily KPI records (OPD/IPD brief & stat, med errors) with reporting.

## Data
- `GET /api/kpi` — all days; `GET/PUT /api/kpi/{date}` — one day (`YYYY-MM-DD.json`).
- Per-day doc shape: `{ date, opdBrief, ipdBrief, opdStat, ipdStat, medErrors[] }`.
- Section writes (OPD/IPD brief & stat) go through **PUT** `/api/kpi/{date}/{section}` (server merges into the day doc).
- Med errors use different verbs: **POST** `/api/kpi/{date}/med-errors` (append one record, carries `savedAt`) and **DELETE** `/api/kpi/{date}/med-errors/{savedAt}` (remove by `savedAt`).

## Auth model
The KPI app writes as a `chrome-extension://` origin **without logging in** — it relies on the server's trusted-extension bypass (`_is_trusted_extension`). All KPI write routes (PUT sections **and** the med-error POST/DELETE) carry that bypass; anyone else needs editor/admin/super_admin. (The med-error POST/DELETE bypass was added after they were found returning 401 — unlike the PUT sections, they'd been left auth-gated.)

## Files
| File | Role |
|---|---|
| `index.html` | Forms + report views |
| `app.js` | Day load/save, sections, med-error list, charts/reports |
| `styles.css` | Styling |

## Gotchas
- KPI day files are **server-written production data** under `pharmacy_server/data/kpi/` (gitignored). Never hand-edit those files.
- New KPI day files are created on demand by the server.
