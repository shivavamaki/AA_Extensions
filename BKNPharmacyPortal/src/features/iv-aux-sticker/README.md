# IV / Auxiliary Label Stickers (`iv-aux-sticker`)

Two standalone, self-contained label printers opened from the popup toolbar — not ArcusAir-injected pages. Each manages its own state, data fetch, rendering, print, and CRUD independently.

- **IV Sticker** (`iv_sticker.html/js/css`) — IV admixture labels.
- **Auxiliary Sticker** (`aux_sticker.html/js/css`) — Premix Sticker + Mixing Label.

## Where it runs

- Opened via the popup buttons `#openIvSticker` / `#openAuxSticker` (`popup.js`), each a plain `chrome.tabs.create({ url: chrome.runtime.getURL(...) })` — no content-script injection involved.
- `content_script.js`'s Dispense Workbench scraper also opens `iv_sticker.html` directly (`window.open(chrome.runtime.getURL(...))`) after pushing scraped patient/order data to storage.
- Both pages talk directly to the pharmacy server (`_serverUrl()`, default `http://10.134.110.81:8765`, override via `localStorage['pharmacyServerUrl']`) rather than through `window.BKNData` — these predate the shared `shared-data-client.js` layer.

## Drug + staff database (server-owned, admin-edited)

The IV drug master list and staff list are **server data**, not hard-coded:

- `loadData()` reads `GET /api/iv-drugs` + `GET /api/iv-staff` (both open reads). The server seeds `data/rx/iv-drugs.json` / `iv-staff.json` once from the built-in defaults on first startup, so the **server is the source of truth**.
- `DEFAULT_DRUGS` / `DEFAULT_STAFF` in `iv_sticker.js` remain **only as an offline fallback** used when the server is unreachable.
- **The sticker page is read-only w.r.t. this data.** It no longer PUTs the lists back (`_syncToServer()` was removed) — pushing its in-memory copy would overwrite admin edits with the (possibly fallback) list. All editing happens in the admin **Pattern Editor → "IV Sticker DB"** tab, whose `PUT /api/iv-drugs|iv-staff` requires a logged-in admin/editor (Bearer token). See [`../pattern-editor/README.md`](../pattern-editor/README.md#iv-sticker-db-admin-only).

## Files

| File | Role |
|---|---|
| `iv_sticker.html/js/css` | IV sticker UI, state, rendering, print, CRUD, navigation |
| `aux_sticker.html/js/css` | Premix/mixing label UI — mirrors `iv_sticker.js`'s print-popup pattern (see comments in `aux_sticker.js`) |

## Fonts (offline)

Thai text uses the bundled **Sarabun-Regular** (`src/assets/fonts/`, a web-accessible resource) — **no `fonts.googleapis.com` request** (RIS_RA_2026_09). The CSS files declare a relative `@font-face`; the print popups are `about:blank`, so they inject `@font-face` from `_bknPrintFontFace()`, which resolves the font by its absolute `chrome-extension://` URL. If the extension context is unavailable the label falls back to the system Thai font. Don't reintroduce a Google Fonts `@import` here.

## Gotchas

- These are **not** part of the ArcusAir content-script load order — they're independent extension pages, so the CLAUDE.md load-order invariant doesn't apply here.
- `db/iv_history.json` (extension root) is **not used** by `iv_sticker.js` — it persists history via `localStorage['iv_history']` instead. The JSON file appears to be orphaned leftover data; left untouched pending confirmation.
