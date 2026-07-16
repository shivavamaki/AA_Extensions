# Schedule Management (`schedule/`)

**Rule-based Fair Shift Scheduler** for the pharmacy team, plus a booking page.

## Allocator (two-pass, fairness-weighted)
`app.js` runs:
1. **Pass 1** — role-priority types (`Clinic`, `Night`) with light fairness.
2. **Pass 2** — IPD/OPD/Floor2/Office/Special with heavy fairness (22× type-count penalty).
3. A **4-stage backfill** that progressively relaxes constraints for missing required shifts.

Constraints: `maxConsecNights = 2` (hard), per-role `canNight`/`canWeekend`, monthly caps (mostly `Infinity` per current rules), and an **"Override role limits"** checkbox for one-off exceptions.

**Admin overrides survive auto-allocation.** When the scheduler ignores an admin choice, the fix is always to persist it as an override (e.g. OFF via `setOverride(personId, dayIndex, "OFF", remark)`, not `removeOverride`). Booking imports always apply (no `reqOffLocked` guard).

## Persistence (month-scoped)
- `PUT /api/schedule/state?month=YYYY-MM` → `state-YYYY-MM.json` (includes `updatedAt`). Shared fields (`staff`, `shiftTemplates`, `bookingRules`) mirror back to global `state.json`.
- `/api/schedule/state` (no month) = shared/global state for booking rules + staff metadata.
- `/api/schedule/bookings` = all-month bookings object (not per-month).
- Save button stays dirty if the server write fails; localStorage is only a local fallback. `loadState()` may show localStorage first, then refresh from server when the server timestamp is newer/equal.

## Files
| File | Role |
|---|---|
| `index.html` / `app.js` / `styles.css` | Scheduler UI + allocator + persistence |
| `booking.html` / `booking.js` / `booking.css` | Booking page (shares the same month as the scheduler) |

## Gotchas
- Don't add per-month night/weekend caps unless asked (they're `Infinity` by design).
- `booking.js` shares the open-month with `index.html`.
