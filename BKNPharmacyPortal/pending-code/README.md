# Pending Drug Code Tracker (`pending-code/`)

Shift-handover checklist tracking drugs that still need system setup — mirrors the source
sheet **"ส่งเวรเภสัช...รายการยารอทำ code"**. Each drug tracks 5 setup tasks: Order Item, Tariff,
Drug Master, Code, Store Bin.

## Access
Opening the page from the popup's **"Pending Drug Code"** button is login-gated — same
session/role logic as **Shift Schedule** (`popup.js` `initShiftSchedule`): a bearer token is
requested via `POST /api/auth/login`, cached in `chrome.storage.local` under
`pendingCodeAuthToken`, and re-validated via the shared `_schedCheckToken()` helper against
`GET /api/auth/me` on next open. Only `editor`/`admin`/`super_admin` roles pass
(`PENDING_CODE_ALLOWED_ROLES` in `popup.js`). This is a popup-side workflow gate only — the
`/api/pending-code` data endpoint itself stays open to trusted extension writes (see below),
matching how Shift Schedule's own data calls also bypass login from a trusted origin.

## Data
- `GET/PUT /api/pending-code` — whole-array replace, same `rx` collection mechanism as
  `chemo-drugs`/`premix-drugs` (see `RX_COLS` in `bkn_ks_server.py`). No login required for the
  API itself — writes from a `chrome-extension://` origin are trusted.
- Stored server-side at `pharmacy_server/data/rx/pending-code.json` (gitignored, server-written).
- Item shape:
  ```json
  {
    "id": "pc-1", "no": "1", "materialCode": "51001100204022",
    "description": "Sitagliptin/Metformin (50/1000mg) TABLET",
    "altCodeNote": "", "opdQty": "34", "ipdQty": "39", "notes": "",
    "tasks": { "orderItem": true, "tariff": true, "drugMaster": true, "code": true, "storeBin": true },
    "archived": false,
    "createdAt": "...", "updatedAt": "..."
  }
  ```
- An item is "Done" when all 5 `tasks` are true (computed client-side, not stored).
- `archived` defaults to falsy for legacy rows that predate the field — treated the same as `false`.

## Filtering
Two layers, both client-side and combinable:
- **Active / Archived** view toggle (`viewSeg`) — which `archived` bucket is shown.
- **Filter row** — one dropdown per column: Order Item, Tariff, Drug Master, Code, Store Bin
  (✓ Done / ✗ Pending), OPD, IPD (Has qty / No qty), and Status (overall Pending/Done, i.e. all
  5 tasks). "Clear filters" resets the row; the free-text search box (material code /
  description) is independent of these.

## Archiving (replaces delete)
There is no destructive delete. The row action button archives an item (`archived: true`,
moves it out of the Active view into Archived) instead of removing it; the Archived view's row
action restores it back to Active (`archived: false`). Data is never dropped from
`pending-code.json`.

## Files
| File | Role |
|---|---|
| `index.html` | Toolbar (search/view toggle/add) + filter row + table shell |
| `app.js` | Fetch/render, inline edit, checkbox toggle, column filters, archive/restore, add, debounced save-on-change |
| `styles.css` | Styling (same CSS-variable token system as `kpi/`) |

## Gotchas
- Save-on-every-edit (debounced ~250ms), no explicit save button — same convention as
  `chemo-sticker`'s drug DB tab and `iv-aux-sticker`.
- The original CSV's Thai headers/status column were already corrupted (literal `?` characters)
  in the source file the data was imported from — not an encoding bug. Those columns were
  dropped on import; only the English-labelled columns and the 5 checkbox tasks survived.
