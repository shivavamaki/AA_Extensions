# Vaccine Schedule (`vaccine/`)

**Vaccine Schedule** page — a vaccine database with scheduling/recommendation logic for the pharmacy.

## Files
| File | Role |
|---|---|
| `index.html` | Page shell + UI |
| `app.js` | Vaccine database + schedule/recommendation logic + render |

## Notes
- Standalone extension page (web-accessible resource); not injected into ArcusAir.
- Vaccine reference data is bundled in `app.js`; no required pharmacy-server dependency for the core schedule.
