# Pending Drug Code Tracker (`pending-code/`)

Shift-handover checklist tracking drugs that still need system setup — mirrors the source
sheet **"ส่งเวรเภสัช...รายการยารอทำ code"**. Each drug tracks 5 setup tasks: Order Item, Tariff,
Drug Master, Code, Store Bin.

## Data
- `GET/PUT /api/pending-code` — whole-array replace, same `rx` collection mechanism as
  `chemo-drugs`/`premix-drugs` (see `RX_COLS` in `bkn_ks_server.py`). No login required —
  writes from a `chrome-extension://` origin are trusted.
- Stored server-side at `pharmacy_server/data/rx/pending-code.json` (gitignored, server-written).
- Item shape:
  ```json
  {
    "id": "pc-1", "no": "1", "materialCode": "51001100204022",
    "description": "Sitagliptin/Metformin (50/1000mg) TABLET",
    "altCodeNote": "", "opdQty": "34", "ipdQty": "39", "notes": "",
    "tasks": { "orderItem": true, "tariff": true, "drugMaster": true, "code": true, "storeBin": true },
    "createdAt": "...", "updatedAt": "..."
  }
  ```
- An item is "Done" when all 5 `tasks` are true (computed client-side, not stored).

## Files
| File | Role |
|---|---|
| `index.html` | Toolbar (search/filter/add) + table shell |
| `app.js` | Fetch/render, inline edit, checkbox toggle, add/delete, debounced save-on-change |
| `styles.css` | Styling (same CSS-variable token system as `kpi/`) |

## Gotchas
- Save-on-every-edit (debounced ~250ms), no explicit save button — same convention as
  `chemo-sticker`'s drug DB tab and `iv-aux-sticker`.
- The original CSV's Thai headers/status column were already corrupted (literal `?` characters)
  in the source file the data was imported from — not an encoding bug. Those columns were
  dropped on import; only the English-labelled columns and the 5 checkbox tasks survived.
