# Pattern Editor (`pattern-editor`)

A standalone admin page (🧩 **Pattern Editor**, opened from the popup via
`btnPatternEditor` → `chrome.tabs.create` to `page-pattern-editor.html`) for
curating English→Thai phrase overrides used by the [`home-med`](../home-med/README.md)
sheet's offline translation engine, without a code deploy.

## Data flow

- `GET /api/pattern-overrides` loads the current dict (`{ phrase: { th, en, ... } }`,
  keyed by lowercased/trimmed English phrase); `PUT /api/pattern-overrides`
  replaces the whole dict.
- Persisted server-side to `pharmacy_server/data/rx/pattern-overrides.json`
  via the same generic rx-collection REST routes `medication-db`/`premix-drugs`
  use (no auth required to read; write requires the same rx-collection rules
  as other RX_COLS).
- `medical-glossary.js`'s `matchAuxiliaryPhrase()` checks
  `window.PATTERN_OVERRIDES` **before** the hardcoded `AUXILIARY_PHRASES`
  table, so a curated phrase wins immediately on the sheet's next load
  (`page-home-med.js`'s `_loadPatternOverrides()` fetches it alongside the
  medication-DB load).

## Scope, by design

Only **verbatim full-phrase** matches are editable here — the regex-based
qty/frequency/timing engine (`MASTER_RE` in `medical-glossary.js`) stays
code-only, since a malformed regex edit could break parsing for every
instruction on every sheet.

## Files

| File | Role |
|---|---|
| `page-pattern-editor.html` | Simple table UI: phrase, Thai translation, add/remove |
| `page-pattern-editor.js` | Fetch/save via `/api/pattern-overrides` |

See [`../home-med/README.md`](../home-med/README.md#pattern-overrides-editable-no-code-deploy)
for how the sheet consumes overrides.
