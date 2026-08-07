# Risk Treatment Tracker — BKN Pharmacy Extension

Implementation tracker for **RIS-FM-01-ISS-001** (ISO/IEC 27001 & 27799 risk
assessment). Maps each treatment (`RIS_RT_2026_0x`) to its status and, for
code items, where it lives. Process/infrastructure items list the runbook steps
to perform at deploy time — they are intentionally **not** code.

> Delivered in extension **v3.40.0** / server change of the same date.

| Risk | Treatment | Type | Status |
|---|---|---|---|
| RIS_RA_2026_01 | ArcusAir integration resilience | Process | Runbook (smoke-test) |
| RIS_RA_2026_02 | Session-token handling | Code + review | Verified — no change needed |
| RIS_RA_2026_03 | Server transport & access | Code (allowlist) + infra (HTTPS/FW) | Allowlist **done**; HTTPS/FW = runbook |
| RIS_RA_2026_04 | Translation fallback removal | Code | **Done** (prior release) |
| RIS_RA_2026_05 | Server backup & continuity | Infra | Runbook |
| RIS_RA_2026_06 | Knowledge continuity & cross-training | Docs/Process | Runbook |
| RIS_RA_2026_07 | Password hashing hardening | Code | **Done** |
| RIS_RA_2026_08 | Default credential hygiene | Code + process | **Done** (code) + runbook step |
| RIS_RA_2026_09 | Self-host print fonts | Code | **Done** |

---

## Code treatments (shipped this patch)

### RIS_RT_2026_07 — Password hashing
`pharmacy_server/bkn_ks_server.py`: `_hash_pw` / `_verify_pw` / `_is_legacy_hash`.
Salted PBKDF2-HMAC-SHA256 (240k iterations, 16-byte per-user salt). Legacy
SHA-256 accounts are accepted and transparently re-hashed on next login. See the
"Password storage" section of [`README.md`](README.md).

### RIS_RT_2026_08 — Default credential hygiene
`_ensure_default_users` / `_seed_password`: no hard-coded password; seed from
`BKN_ADMIN_PW` / `BKN_SUPERADMIN_PW` env vars or a printed-once random password.
Seeded accounts get `must_change_pw: true`; login response returns `mustChangePw`.
**Deploy step:** change the seeded password(s) immediately after first run.

### RIS_RT_2026_03 (partial) — Extension-ID allowlist
`_is_trusted_extension` no longer trusts every `chrome-extension://` origin; only
IDs in `TRUSTED_EXTENSION_ORIGINS` (seed constant + `BKN_EXTENSION_IDS` env var).
The BKN Pharmacy Portal manifest carries a fixed **`key`**, so its ID is
deterministic on every machine (`bmnbffgenocfinghgjbfblkmggmaejpp`) and is
allow-listed by default — **no per-install registration needed**. Only *other*
extensions need `BKN_EXTENSION_IDS` / a `TRUSTED_EXTENSION_ORIGINS` entry.
**Key custody:** the RSA private key that produced the manifest `key` is **not**
in the repo (and must never be committed or placed in the extension folder). Keep
it in secure ops storage — it's only needed to re-derive the same ID or publish
to the Web Store, not at runtime.

### RIS_RT_2026_09 — Self-host print fonts
`iv-aux-sticker`: removed all `fonts.googleapis.com` `@import`s from
`iv_sticker.{css,js}` and `aux_sticker.{css,js}`. CSS files use a relative
`@font-face`; print popups (about:blank) use `_bknPrintFontFace()` pointing at the
web-accessible `src/assets/fonts/Sarabun-Regular.ttf`. Fallback: system Thai font.

### RIS_RT_2026_04 — Translation fallback removal (already complete)
External Google Translate fallback was removed in a prior release; all translation
runs through the offline `medical-glossary.js` engine. No external call remains.

### RIS_RT_2026_02 — Session-token handling (verified)
Tokens stay in `chrome.storage.session`; the server keeps a Med-Reconcile
`incus-token` copy only, TTL-bounded by `CAPTURE_TOKEN_TTL_MS` (24 h). Confirmed no
disk persistence on the client. Keep main-world scripts in the normal code-review
rounds; re-verify each release that touches them.

---

## Process / infrastructure runbook (not code)

### RIS_RT_2026_01 — ArcusAir integration smoke test
Run after every ArcusAir update:
1. Log in to ArcusAir with the extension loaded.
2. Open a patient; confirm patient context/sticker loads.
3. Print a Home Med sheet; confirm content + page count.
4. Run one HM Process step end-to-end.
5. If a step fails, check the `README.md` changelog/version and the affected
   feature's README before editing.

### RIS_RT_2026_03 (infra) — HTTPS & firewall
- Front `pharmacy_server` with HTTPS (internal CA or self-signed cert).
- Restrict server reachability to the pharmacy VLAN / approved workstations via
  firewall rules.
- Define a retention window for cached `patient context`; purge when no longer needed.

### RIS_RT_2026_05 — Backup & continuity
- Schedule automated backups of `pharmacy_server/data/` (do **not** include
  `users.json` in backups that leave the VLAN).
- Write and periodically test a restore procedure.
- Add a basic uptime check with alerting.
- Consider a lightweight standby host.

> `data/` is protected in git (`.gitignore` + `merge=ours` + `--skip-worktree`);
> backups are the operator's responsibility, not git's.

### RIS_RT_2026_06 — Knowledge continuity & cross-training
- Keep each feature `README.md` + `CLAUDE.md` current every release.
- Maintain a short deployment runbook: register extension ID (`BKN_EXTENSION_IDS`),
  start server (`start_server.bat`), change default passwords, backup/restore.
- Cross-train at least one more IT/pharmacy-IT staff member.
- Keep non-secret configuration in version control.
