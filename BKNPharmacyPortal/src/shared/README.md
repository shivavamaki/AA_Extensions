# Shared modules (`src/shared`)

Cross-feature infrastructure used by all ArcusAir-injected features and extension pages.

---

## `shared-data-client.js` — `window.BKNData` (the data bus)

The **only sanctioned cross-feature data API**. All persistent reads/writes go through the pharmacy server, proxied via `BKN_SERVER_PROXY` in `background.js` to bypass CORS.

**Exposed methods:**

| Method | What it does |
|---|---|
| `getServerUrl / setServerUrl` | Read/write server base URL from `chrome.storage.local` |
| `serverFetch(path, opts)` | Sends a `BKN_SERVER_PROXY` message to background, awaits response |
| `getPatientContext / setPatientContext` | Session cache + mirrors to `PUT /api/patients/{puid}/context` |
| `loadAdrTimeline / saveAdrTimeline` | Per-patient ADR timeline via `/api/patients/{puid}/adr-timeline` |
| `loadMedCache / saveMedCache` | Per-visit medication cache via `/api/patients/{puid}/medication-cache/{vuid}` |
| `loadPatientProfile` | Patient profile from `/api/patients/{puid}` |

**Key rules:**
- Server URL key: **`bknks.serverUrl`** in `chrome.storage.local` (same key as legacy rx_menu — inherited on merge). Falls back to `http://10.134.110.81:8765`.
- Patient context goes to `chrome.storage.session` **and** mirrors to the server so other workstations see it.
- **No localStorage caches for cross-workstation data** — always fetch fresh from the server.
- Idempotent guard: returns early if `window.BKNData` already exists.

---

## `translate-core.js` — `HMTranslate` engine

Three-layer prescription translation:

1. **Pattern match** (`matchMedicalPattern` from `medical-glossary.js`) — full-sentence regex; localises verb/unit/route/frequency in one pass.
2. **Glossary** — word-level substitution from `MEDICAL_GLOSSARY`.
3. **Google Translate** (`translate.googleapis.com`) — only when not in offline-only mode.

**API:** `init(root, {glossary})` / `translate(root, lang, {offlineOnly})` / `restore()`

**Persistent translation cache** in `chrome.storage.local` (key `hm:translateCache`, capped 5000 entries, debounced flush) — re-renders don't re-call Google.

- Nodes marked `data-no-translate` or `translate="no"` are skipped.
- An instruction cell may carry `data-freq-th` (authoritative Thai frequency) → passed to `matchMedicalPattern` as `freqOverride`.

---

## `medical-glossary.js` — patterns + glossary

**`window.matchMedicalPattern(text, lang, opts)`** — tries in order:
1. Auxiliary phrase match
2. Injection pattern
3. `MASTER_RE` — parses `<Verb> N Unit [route] FREQ TIMING [For D Days]`
4. Quantity pattern fallback

When `MASTER_RE` can't parse the freq/timing tail **but `opts.freqOverride` is set**: a loose `<Verb> N Unit` fallback salvages the dose verb and appends the Thai frequency, dropping the English tail. This is what keeps Home Med instructions fully Thai even when frequency strings don't match the pattern.

**`MEDICAL_GLOSSARY`** — per-language word maps (`th / lo / my / km / …`). Built for **dosage vocabulary** (take, tablet, ml, times/day, etc.) — not free-text warnings. Note translation is handled server-side via `note-glossary.json`.

## `meal-slots.js` — `window.BKNMealSlots` (Daily Pill Journey Card engine)

Groups a patient's home/discharge meds into meal slots (before/after × breakfast/lunch/dinner, then bedtime and PRN) by parsing each med's instruction text. **Language-agnostic** — handles Thai (`เช้า/กลางวัน/เย็น`, `ก่อน/หลัง`) and English (`breakfast/lunch/dinner`, `before/after/ac/pc`), so it works on the raw English order line (med-journey) or the offline-translated Thai line (home-med). A qualifier carries across a meal run (`หลังอาหาร เช้า เย็น` / `Before Breakfast and Dinner`); unqualified meal words default to **after**.

| Export | What it does |
|---|---|
| `MEAL_SLOTS` | Slot metadata array: `{ key, cls, ico, th, en, test(text) }` |
| `doseSnippet(text)` | Short dose phrase (`1 เม็ด`, `1 Tablet`, `1 PUFF`) or `""` |
| `bucket(items)` | `{ buckets:{key:[item]}, unslotted:[item] }` — a med lands in every slot it matches |
| `gridHTML(items, esc)` | `.mc-grid` card HTML (non-empty slots + an "อื่นๆ / ตามแพทย์สั่ง" card for the unclassified); `esc` = `CoreDom.escapeHtml` |

`items` are `{ drug, text, dose? }` — `text` drives matching, `drug`/`dose` display. The `.mc-*` CSS lives in each consuming page's `<style>` (med-journey landscape, home-med portrait); only the engine + markup are shared, so the bucketing rules stay identical across both reports.

---

## Related server data

| File | Purpose |
|---|---|
| `pharmacy_server/data/rx/frequencymaster.json` | Frequency name → `lang.TH` (powers `frequencyTh` in Home Med) |
| `pharmacy_server/data/rx/note-glossary.json` | EN→TH note phrase/term map (server-side note translation + self-heal into `medication-db.json`) |
