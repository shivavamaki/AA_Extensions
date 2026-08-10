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
| RIS_RA_2026_03 | Server transport & access | Code (subnet trust) + infra (HTTPS/FW) | Subnet trust **done**; HTTPS/FW = runbook — **now load-bearing** |
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

### RIS_RT_2026_03 (partial) — Subnet-scoped write trust
**Supersedes the extension-ID allowlist** (see *Revision* below).
`_is_trusted_extension` accepts login-less writes when the `Origin` is **any**
`chrome-extension://` origin **and** the client IP is loopback or within
`TRUSTED_SUBNETS` (`BKN_TRUSTED_SUBNETS` env var, default `10.134.0.0/16`).
Chrome sets the `Origin` header itself, so web pages cannot forge an extension
origin; the subnet check confines the rest. Refused writes are logged to
`data/logs/untrusted-write-YYYY-MM-DD.jsonl` via `_log_untrusted_write`.

**Residual risk (accepted):** any extension installed on a pharmacy workstation
can write. Mitigation now leans on the infra half below (HTTPS + firewall to the
pharmacy VLAN) — keep `BKN_TRUSTED_SUBNETS` as narrow as the addressing allows.
`iv-drugs`/`iv-staff` remain admin-login-only (`RX_ADMIN_WRITE_COLS`).

#### Revision — why ID pinning was withdrawn
The original treatment allow-listed extension IDs, relying on the manifest `key`
for a deterministic ID. In practice Chrome only derives that ID when the
extension is loaded from the folder carrying the key; an unpacked install from a
different path — or a copy predating the key — receives a **random ID** and is
refused. As reads are unauthenticated and only writes are gated, this presented
as a working-but-not-saving extension ("the extension is missing"), and recurred
on the same machine after reloads. Per-workstation ID registration was judged
operationally unsustainable, so `TRUSTED_EXTENSION_ORIGINS` / `BKN_EXTENSION_IDS`
were removed in favour of the network-scoped check.

**Key custody:** the manifest `key` is retained (it still gives a stable ID and
Web Store identity), but is **no longer a security control**. The RSA private key
that produced it is **not** in the repo and must never be committed or placed in
the extension folder — keep it in secure ops storage.

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
> **Priority raised.** With write trust now scoped by subnet rather than
> extension ID, these firewall rules are the primary control on who can write —
> they are no longer just defence in depth.
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
- Maintain a short deployment runbook: confirm the workstation subnet is in
  `BKN_TRUSTED_SUBNETS` (no per-machine extension ID registration),
  start server (`start_server.bat`), change default passwords, backup/restore.
- Cross-train at least one more IT/pharmacy-IT staff member.
- Keep non-secret configuration in version control.
