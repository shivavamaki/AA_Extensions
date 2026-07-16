# IV / Auxiliary Label Stickers (`iv-aux-sticker`)

Two standalone, self-contained label printers opened from the popup toolbar — not ArcusAir-injected pages. Each manages its own state, data fetch, rendering, print, and CRUD independently.

- **IV Sticker** (`iv_sticker.html/js/css`) — IV admixture labels.
- **Auxiliary Sticker** (`aux_sticker.html/js/css`) — Premix Sticker + Mixing Label.

## Where it runs

- Opened via the popup buttons `#openIvSticker` / `#openAuxSticker` (`popup.js`), each a plain `chrome.tabs.create({ url: chrome.runtime.getURL(...) })` — no content-script injection involved.
- `content_script.js`'s Dispense Workbench scraper also opens `iv_sticker.html` directly (`window.open(chrome.runtime.getURL(...))`) after pushing scraped patient/order data to storage.
- Both pages talk directly to the pharmacy server (`_serverUrl()`, default `http://10.134.110.81:8765`, override via `localStorage['pharmacyServerUrl']`) rather than through `window.BKNData` — these predate the shared `shared-data-client.js` layer.

## Files

| File | Role |
|---|---|
| `iv_sticker.html/js/css` | IV sticker UI, state, rendering, print, CRUD, navigation |
| `aux_sticker.html/js/css` | Premix/mixing label UI — mirrors `iv_sticker.js`'s print-popup pattern (see comments in `aux_sticker.js`) |

## Gotchas

- These are **not** part of the ArcusAir content-script load order — they're independent extension pages, so the CLAUDE.md load-order invariant doesn't apply here.
- `db/iv_history.json` (extension root) is **not used** by `iv_sticker.js` — it persists history via `localStorage['iv_history']` instead. The JSON file appears to be orphaned leftover data; left untouched pending confirmation.
