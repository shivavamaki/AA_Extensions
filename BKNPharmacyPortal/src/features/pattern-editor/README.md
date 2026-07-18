# Pattern Editor (`pattern-editor`)

A standalone admin page (🧩 **Pattern Editor**, opened from the popup via
`btnPatternEditor` → `chrome.tabs.create` to `page-pattern-editor.html`) for
curating the offline translation data used by the [`home-med`](../home-med/README.md)
sheet — **no code deploy, no external API**. Two tabs:

1. **Phrase Overrides** — English→Thai phrase translations (exact / verb-prefix /
   substring-replace; see *Scope* below).
2. **Drug Instructions** — CRUD on a drug's **Patient Instruction** in
   `medication-db.json` (the note-line source): search by name/code, edit the
   TH/EN instruction, save (curated) or remove.

## Data flow

- **Phrase overrides:** `GET /api/pattern-overrides` loads the dict
  (`{ phrase: { th, en?, mode? } }`, keyed by lowercased/trimmed English phrase);
  `PUT /api/pattern-overrides` replaces the whole dict.
- **Drug instructions:** `GET /api/medication-db` (whole DB, keyed by item code)
  to search; `PUT /api/rx-note/{code}` `{th, en?, manual:true}` sets a curated
  Patient Instruction (reuses `save_rx_note`, `auto=False` so auto-translation
  won't overwrite it); `DELETE /api/rx-note/{code}` removes it (`delete_rx_note`).
  All writes are trusted-extension (no login) — same model as the other rx routes.
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

Since the translation engine is **fully offline** (no Google/external API), the
editor is the only way to fill translation gaps. The regex-based qty/frequency/
timing engine (`MASTER_RE` in `medical-glossary.js`) stays **code-only** — a
malformed regex edit could break parsing for every instruction on every sheet.

Each override row has a **Mode**:

- **Exact / verb** (default) — matches only when the override equals the whole
  instruction line, via `matchAuxiliaryPhrase()`; and, for `apply`/`ทา`-type
  instructions, as a **verb prefix** (`_applyVerb()` → `_matchApplyVerbOverride()`)
  so you can add just the verb phrase and let the engine append the frequency:
   - `apply to the ulcer in mouth` → `ทาแผลในปาก`
- **Replace (substring)** — `applyTextReplacements()` (in the engine, run before
  pattern/glossary) does a find→replace of the English phrase **anywhere** in the
  text, so you can pre-translate arbitrary fragments:
   - `before breakfast` → `ก่อนอาหารเช้า`
   - `as needed` → `เมื่อจำเป็น`

  Longest key wins over its sub-phrases; word-like keys match on word boundaries
  (so `cap` won't hit inside `capsule`). Stored as `{ th, mode:"replace" }` in the
  same `pattern-overrides.json` (exact rows omit `mode`).

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
| `page-pattern-editor.html` | Tabbed UI: Phrase Overrides table + Drug Instructions search/editor |
| `page-pattern-editor.js` | Phrase CRUD via `/api/pattern-overrides`; drug-instruction CRUD via `/api/medication-db` + `/api/rx-note/{code}` |

See [`../home-med/README.md`](../home-med/README.md#pattern-overrides-editable-no-code-deploy)
for how the sheet consumes overrides.
