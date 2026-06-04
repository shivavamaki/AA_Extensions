# Formulary (`formulary/`)

Standalone web page (web-accessible resource) — **BKN Pharmacy Formulary**: a searchable reference of pharmacy formulas/preparations.

## Files
| File | Role |
|---|---|
| `index.html` | Page shell |
| `app.js` | Formula data + search/render logic |
| `styles.css` | Styling |
| `data/formulas.json`, `data/default_formulas.js` | Bundled formula data |

## Notes
- Opened as an extension page; not injected into ArcusAir.
- Self-contained reference data bundled in `data/` — no pharmacy-server dependency for the core list.
