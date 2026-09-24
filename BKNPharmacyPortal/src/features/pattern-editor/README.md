# Pattern Editor (`pattern-editor`)

A standalone admin page (🧩 **Pattern Editor**, opened from the popup via
`btnPatternEditor` → `chrome.tabs.create` to `page-pattern-editor.html`) for
curating the offline translation data used by the [`home-med`](../home-med/README.md)
sheet — **no code deploy, no external API**. Three tabs:

1. **Phrase Overrides** — English→Thai phrase translations (exact / verb-prefix /
   substring-replace; see *Scope* below). The table **shows the built-in
   `AUXILIARY_PHRASES` as read-only rows** (badge **Built-in**) alongside saved
   overrides (**Override**) and pharmacist-added phrases (**Custom**) — so the
   list is never empty and every built-in phrase is discoverable/editable.
2. **Drug Instructions** — CRUD on a drug's **Patient Instruction** in
   `medication-db.json` (the note-line source): search by name/code, edit the
   TH/EN instruction, save (curated) or remove.
3. **IV Sticker DB** — admin editor for the IV/Aux Sticker's **drug master list**
   (`iv-drugs`) and **staff list** (`iv-staff`). See *IV Sticker DB* below.

## IV Sticker DB (admin-only)

The [`iv-aux-sticker`](../iv-aux-sticker/README.md) drug + staff lists are
**server-owned** (`data/rx/iv-drugs.json` / `iv-staff.json`, seeded once from the
former hard-coded defaults). This tab edits them:

- **Sub-tabs Drugs / Staff.** Drugs are a table of
  `codeName · generic · type · exp · storage · had · conc · rate` (add/edit/delete
  rows); Staff is `name · role`. `type` and `role` are dropdowns.
- **Login required to save.** `GET /api/iv-drugs|iv-staff` is open (so the tab can
  load), but `PUT` needs a **logged-in admin/editor** — the tab has its own
  username/password sign-in (`POST /api/auth/login`) and sends the returned
  Bearer token on save (`_ivToken`, in-memory only). Non-admin/editor roles are
  rejected client- and server-side. Rows stay locked (greyed) until signed in.
- **Blank rows dropped on save** (a drug needs a `codeName`, staff a `name`).
- The sticker page is **read-only** w.r.t. this data — it no longer syncs its
  in-memory list back (that would clobber admin edits); see the iv-aux README.

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

### Built-in merge (fallback model, not a copy)

The editor page loads `../../shared/medical-glossary.js`, which now exposes
`window.AUXILIARY_PHRASES`. `load()` snapshots those built-in phrases (Thai value
only) and lists them as **read-only** rows. **Editing a built-in row creates an
override** (seeded from the built-in value) — the row flips to **Override** and
gains a **↩ Reset** action that drops the override so the shipped default applies
again. `save()` persists **only the delta**: custom phrases + built-in overrides
whose Thai/mode actually differ from the shipped default; untouched built-ins and
empty rows are never written. This keeps `pattern-overrides.json` a minimal
pharmacist-layer file and **avoids drift** — the built-in phrases stay
authoritative in code, and a future code update to a built-in reaches everyone
who hasn't explicitly overridden it. Renaming/removing is restricted to Custom
rows (built-in keys are load-bearing for the engine and are read-only).

## Scope, by design

Since the translation engine is **fully offline** (no Google/external API), the
editor is the only way to fill translation gaps. The regex-based qty/frequency/
timing engine (`MASTER_RE` in `medical-glossary.js`) stays **code-only** — a
malformed regex edit could break parsing for every instruction on every sheet.

Each override row has a **Mode**:

- **Exact / verb** (default) — matches when the override equals the whole
  instruction line (`matchAuxiliaryPhrase()`), **or** when it is a leading
  **verb prefix** of the line (`_matchCuratedVerbPrefix()`), so you can add just
  the verb phrase and let the engine append the Thai frequency. The prefix path
  works for **any** verb, not only topical `apply`/`ทา`:
   - `apply to the ulcer in mouth` → `ทาแผลในปาก`
   - `dissolve in mouth` → `อม` — so `Dissolve in mouth 1 Tablet Every 6 Hours If Needed For Cough` renders as `อม ทุก 6 ชั่วโมง เวลาไอ`
  Hijack guard: for non-topical verbs the text after the curated key must be
  empty or start with a dose/frequency token (a digit, `once/twice/every/before/
  after/at/when/if …`), so a curated phrase never swallows an unrelated line.
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
   shorter `apply to`). The prefix path fires for any curated verb (topical or
   oral), gated by the dose/frequency-tail guard described above so it never
   hijacks an unrelated `take …` line that wasn't curated.

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

### Built-in additions (3.61.1)

The following pharmacist-supplied Exact/verb phrases now ship as built-ins:

| English | Thai |
|---|---|
| apply to the ulcer | ทาแผลในปาก |
| spray into the nostril | พ่นจมูก |
| apply to rectum | ทาบริเวณทวารหนัก |
| apply on local swelling, bruised area | ทาบริเวณที่ปวด บวม |

They also match leading verbs followed by dose/frequency tokens without server overrides. Longer distinct instructions keep their existing parser behavior. Identical saved copies display as Built-in; different translations or replacement modes remain Override. This update does not rewrite server override data.
