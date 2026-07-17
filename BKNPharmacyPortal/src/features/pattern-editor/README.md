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

The regex-based qty/frequency/timing engine (`MASTER_RE` in
`medical-glossary.js`) stays **code-only** — a malformed regex edit could break
parsing for every instruction on every sheet. Editable overrides work two ways:

1. **Whole-line phrase** — `matchAuxiliaryPhrase()` looks up the entire
   normalized instruction, so an override wins when it equals the whole line
   (e.g. a fixed counselling sentence).
2. **Topical verb prefix** — for `apply`/`ทา`-type instructions, `_applyVerb()`
   → `_matchApplyVerbOverride()` matches a curated key as a **prefix** of the
   instruction and lets the engine append the Thai frequency tail itself. So you
   can add just the **verb phrase**:
   - `apply to the ulcer in mouth` → `ทาแผลในปาก`

   and `apply to the ulcer in mouth 3 times daily morning noon evening` renders
   as `ทาแผลในปาก วันละ 3 ครั้ง เช้า กลางวัน เย็น` — the frequency comes from the
   BKN frequency master automatically, so **don't** add a separate frequency
   entry. Longest matching key wins (`apply to the ulcer in mouth` beats a
   shorter `apply to`); the prefix path only fires for topical verbs, never oral
   `take …` instructions.

   > The verb match runs against the **original** instruction text, not the
   > route-stripped copy. `matchPattern`'s route-strip regex has a `(?=\d)`
   > lookahead that wrongly eats the verb's own words when the frequency starts
   > with a digit (`Apply on Dry Skin 2 times…` → `Apply 2 times…`), which used
   > to drop the verb entirely (both curated overrides **and** the hardcoded
   > `apply on dry skin` / `apply to affected area` branches). Matching the
   > original text fixes both.

## Files

| File | Role |
|---|---|
| `page-pattern-editor.html` | Simple table UI: phrase, Thai translation, add/remove |
| `page-pattern-editor.js` | Fetch/save via `/api/pattern-overrides` |

See [`../home-med/README.md`](../home-med/README.md#pattern-overrides-editable-no-code-deploy)
for how the sheet consumes overrides.
