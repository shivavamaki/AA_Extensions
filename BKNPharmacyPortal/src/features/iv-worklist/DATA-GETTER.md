# IV Worklist — data getter design

Turning `getallorderitem` (`CONTINOUSORDERS`) into worklist rows.

Status: **design, not yet built.** Written against the real payload sample so
the open questions are concrete. Read alongside [README.md](README.md).

---

## The good news: this is a third ordertype, not new plumbing

The server already calls this exact endpoint twice, and the two paths share one
normaliser because *the response shape is identical* — only `ordertype` differs:

| Purpose | `ordertype` | `ordertypeuid` |
|---|---|---|
| Discharge sheet | `DISCHARGEMEDICATION` | `57ce9bc44ac9670b1c439ba9` |
| OPD sheet | `DAILYORDER` | `5796e65d1526f6ebabe3b4a4` |
| **IV worklist** | **`CONTINOUSORDERS`** | **`5796e65d1526f6ebabe3b4a5`** |

So `fetch_arcus_iv_orders()` is a near-copy of `fetch_arcus_opd_meds()`
([bkn_ks_server.py:930](../../../../pharmacy_server/bkn_ks_server.py#L930)), and
`_normalize_orderitems()` / `_arcus_item_to_med()` already extract name, code,
dose, route, frequency and status correctly. `_arcus_headers()` already rebuilds
the ArcusAir session, and `hmr`'s `saveSessionCapture()` already persists the
uids the call needs.

**What is genuinely new is only two things:** deciding which orders are IV
preparations, and expanding one order into one row per dose.

---

## ⚠ `timings` are UTC instants — convert to Asia/Bangkok, don't read the face

The single most important detail in the payload. `frequencyuid.timings` are
1970-epoch instants in **real UTC**, and the Thai wall-clock round is that
instant converted to **UTC+7**:

| Frequency | `timings` (raw UTC) | Ward round (Asia/Bangkok) |
|---|---|---|
| QID before meals + bed | `00:00, 04:00, 09:00, 14:00` Z | **07:00, 11:00, 16:00, 21:00** |
| TID before meals | `00:00, 04:00, 09:00` Z | **07:00, 11:00, 16:00** |
| BID after meals | `02:00, 11:00` Z | **09:00, 18:00** |

Those local times are the ones that make clinical sense — 07:00/11:00/16:00/21:00
is before breakfast, lunch, dinner and bedtime, exactly as the frequency is
named. Reading the raw UTC clock face (00/04/09/14) would put the "bedtime" dose
in the early afternoon.

So the conversion is a genuine timezone conversion, **not** a face-value read:

```js
/** ArcusAir timing instant → "HH:MM" on the Bangkok ward clock. */
function slotFromTiming(iso) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',            // pin it: the server may run UTC
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));              // 1970-01-01T14:00:00Z → "21:00"
}
```

`new Date(iso).getHours()` happens to give the right answer *on a workstation
already set to Asia/Bangkok* — and every pharmacy PC is — but it silently breaks
on a server running UTC, which is where the sync job will actually run. Pin the
zone explicitly rather than relying on the host's locale.

`type: "EXACT TIME"` carries usable `timings`. **`type: "PRN"` carries
`timings: []`** — the Paracetamol q6h-PRN row in the sample proves it. A PRN
order has no scheduled round and must never be expanded into rows; it is not
pharmacy-prepared work.

## Which orders are IV preparations?

The payload returns *everything* continuous — Ulcefate suspension, Ondansetron
tablets, Librax capsules — so the filter matters more than the fetch. Four
signals, in order of trust:

1. **`routeuid.valuedescription`** — the sample's orals are all `"Orally"`. An
   IV order should read `Intravenous` / `IV Infusion` / similar. This is the
   primary test.
2. **`infusionrate` / `infusionrateuom` / `infusionduration`** — `null` on every
   oral in the sample. Populated, it is strong evidence of an infusion.
3. **`ordersubcatuid.name`** — `Tablet`, `Syrup`, `Capsule` on the orals; an
   injection subcategory would identify IV directly.
4. **Drug code against `rx/iv-drugs.json`** — the existing IV master. Useful as
   a cross-check and as the source of HAD + stability, but not as the primary
   filter (a new antibiotic missing from the file would silently vanish).

> **Open question 1 — I cannot settle this from the sample, which contains no IV
> order.** Please capture one `CONTINOUSORDERS` response for a patient on IV
> antibiotics. Specifically: what is `routeuid.valuedescription`, is
> `ordersubcatuid.name` something like "Injection", and is `infusionrate`
> populated? That single sample decides the filter and is the last thing
> blocking the parser.

Reuse `_is_medicine()` first to drop non-drug lines, then apply the IV test.

---

## One order → many rows

A `q 6 hrs` order is **one** ArcusAir order and **four** worklist rows. The
expansion belongs **server-side**, not in the content script:

- the board must show the same rows on every workstation;
- a row carries mutable state (`preparing`, `expiresAt`, who checked it) that
  cannot live in a re-derived client list;
- two workstations expanding independently would race to create duplicates.

So the getter posts *orders*; the server expands them into today's doses and
owns the identity. Proposed dose key, stable and idempotent:

```
{patientvisituid}:{orderitem _id}:{YYYY-MM-DD}:{HH:MM}
```

Re-running the getter must **upsert on that key**, never blind-insert — the
extractor will run repeatedly through the day and must not duplicate the 14:00
Rocephin every time.

Mapping into the row shape the board already consumes:

| Row field | From |
|---|---|
| `hn`, `name` | `patientuid[0].mrn`, `firstname`/`lastname` (or `local*name`) |
| `patientuid`, `patientvisituid` | top-level — the **shared keys** into `hmr` / Home Med Sheet |
| `ward` | `warduid[0].name` → `"Ward 8"` |
| `room` | `beduid[0].code` → `"822"` |
| `drug.name` | `patientorderitems.orderitemname` |
| `drug.code` | `chargecode` (fall back to `orderitemuid[0].code`) |
| `drug.dose` | `dosage` + `dosageUOM[0].valuedescription` |
| `drug.solvent` | ⚠ see open question 2 |
| `drug.route`, `.rate` | `routeuid`, `infusionrate` + uom |
| `drug.freq` | `frequencyuid[0].name` |
| `slot` | each `timings[]` entry via `slotFromTiming()` |
| `drug.had`, `.stabilityHours` | `rx/iv-drugs.json`, by code |
| `status` | new rows start `ordered`; existing rows keep their state |

> **Open question 2 — where does the diluent come from?** The board prints
> "NSS 100 mL" on the sticker and the master CSV has a diluent column, but the
> sample payload has no such field on an oral order. Candidates: a linked
> `isdiluent: true` order item (the flag exists on the oral rows, set `false`),
> `additionalinfusion[]`, or free text inside `instructions[]`. The IV sample
> from question 1 will answer this too.

---

## Amendments and stops

`patientorderlogs[]` carries the audit ArcusAir already keeps, and
`statusuid.valuedescription` the current state (`Ordered` in every sample row).

The rule the README already states, restated as an implementation constraint:
**a change to an order whose bag is already mixed must not mutate that row.**
Cancel it and create a fresh one, so the trail keeps the fact that a bag was
made and discarded. Concretely, on re-sync:

- order no longer present / `isactive: false` / status cancelled → mark
  un-started rows `cancelled`; leave `sent` rows alone (they happened);
- dose or drug changed and the row is past `preparing` → `cancelled` + new row;
- changed while still `ordered`/`pending` → safe to update in place.

---

## Scope: per-patient vs ward-wide

`getallorderitem` is scoped to **one** `patientvisituid`. A ward worklist needs
every current inpatient, so one of:

- **A — iterate patients.** Reuse the visit list `hmr` already works from and
  call the endpoint per patient. Simple, proven, but N calls per refresh.
- **B — `patientorder/search`.** The server already uses it for OPD history
  ([bkn_ks_server.py:955](../../../../pharmacy_server/bkn_ks_server.py#L955));
  it takes `ordercattype: ['MEDICINE']` and returns orders across visits. If it
  accepts a ward or department filter it is one call for the whole board.

I'd start with **A** — it reuses a path known to work, and the server can cache
per visit (`perf(server): cache parsed live JSON by mtime` is already in the
codebase). Move to **B** only if refresh proves too slow.

---

## Suggested build order

1. **Get one IV sample** (questions 1 + 2). Everything else is ready to write.
2. `fetch_arcus_iv_orders(ctx)` — copy of the OPD fetch, `CONTINOUSORDERS`.
3. `_is_iv_prep(med, raw)` — the route/infusion/subcat filter, unit-tested
   against both the oral sample above and the new IV one.
4. `expand_doses(order, date)` — timings → rows, PRN skipped, idempotent key.
5. `POST /api/iv-worklist/sync` — upsert today's rows, apply the amendment rules.
6. Swap the board's `loadRows()` to `GET /api/iv-worklist` and delete
   `iv-demo-data.js`.

Steps 2–5 are server-side and independently testable; only step 6 touches the
UI, and the board's data source is already a single function for exactly that
reason.
