# Shared modules (`src/shared`)

Cross-feature infrastructure used by all ArcusAir-injected features and pages.

## `shared-data-client.js` — `window.BKNData` (the data bus)
The **only sanctioned cross-feature data API**. All persistent reads/writes go through the pharmacy server, proxied via the background service worker (`BKN_SERVER_PROXY`) to avoid CORS.

Exposes: `getServerUrl / setServerUrl / serverFetch / getPatientContext / setPatientContext / loadAdrTimeline / saveAdrTimeline / loadMedCache / saveMedCache / loadPatientProfile`.

- Server URL key: **`bknks.serverUrl`** in `chrome.storage.local` (same key as legacy rx_menu, so the merge inherits it). Falls back to `http://10.134.110.81:8765` when unset.
- Patient context goes to `chrome.storage.session` **and** mirrors to `PUT /api/patients/{puid}/context` so other workstations see it.
- **No localStorage caches for cross-workstation data** — the user explicitly rejected this; always fetch fresh from the server when data must be visible across machines.
- Idempotent guard: returns early if `window.BKNData` already exists.

## `translate-core.js` — `HMTranslate` engine
Three-layer prescription translation:
1. **Pattern match** (`matchMedicalPattern` from `medical-glossary.js`) — full-sentence regex; localises verb/unit/route/frequency in one go.
2. **Glossary** — word-level substitution.
3. **Google Translate** (`translate.googleapis.com`) — only when not in offline-only mode.

Has a **persistent translation cache** in `chrome.storage.local` (key `hm:translateCache`, capped 5000, debounced flush) so re-renders don't re-call Google. Translation is a pure function of `(text, lang, sl)` — safe to memoize.

`init(root, {glossary})` / `translate(root, lang, {offlineOnly})` / `restore()`. Nodes marked `data-no-translate` / `translate="no"` are skipped. An instruction cell may carry `data-freq-th` (authoritative Thai frequency) → passed to `matchMedicalPattern` as `freqOverride`.

## `medical-glossary.js` — patterns + glossary
- `window.matchMedicalPattern(text, lang, opts)` — tries auxiliary phrase → injection → master pattern (`MASTER_RE`) → quantity pattern.
- `MASTER_RE` parses `<Verb> N Unit [route] FREQ TIMING [For D Days]`. When it can't parse the freq/timing tail **but `opts.freqOverride` is set**, a loose `<Verb> N Unit` fallback salvages the dose verb and appends the Thai frequency (dropping the English tail) — this is what keeps Home Med instructions fully Thai.
- `MEDICAL_GLOSSARY` — per-language word maps (th/lo/my/km/…); built for **dosage** vocabulary, not free-text warnings (note translation is handled server-side via `note-glossary.json`).

## Related server data
- `pharmacy_server/data/rx/frequencymaster.json` — frequency name → `lang.TH` (powers `frequencyTh`).
- `pharmacy_server/data/rx/note-glossary.json` — EN→TH note phrase/term map (server-side note translation + self-heal into `medication-db.json`).
