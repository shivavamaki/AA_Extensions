# IV Worklist & Dashboard (`iv-worklist`)

Run queue for IV medicines the pharmacy **prepares** for IPD patients —
antibiotics first, then any admixture. One record per *preparation*, not per
patient: a patient on q6h Meropenem generates four rows a day, and each is
mixed, checked and delivered on its own clock.

> **Status: scaffold / demo.** Every number on screen comes from
> `iv-demo-data.js`. The data-getter (ArcusAir extractor) is not written yet —
> see [Pending: the data getter](#pending-the-data-getter).

---

## Why a separate feature

`hmq` queues *patients* through a discharge process. An IV worklist queues
*doses* through a preparation process, and the two differ in ways that make one
shared implementation awkward:

| | HM Process Queue (`hmq`) | IV Worklist (`iv-worklist`) |
|---|---|---|
| Unit of work | one patient visit | one **dose** (drug + time) |
| Volume | ~20/day | 150–400/day |
| Lifecycle | ends at discharge | repeats q6h/q8h/q12h, every day |
| Deadline | soft | **hard** — the dose is due at a ward round time |
| Expiry | n/a | **stability clock** starts at mixing |

The stability clock is the reason this cannot be a status column bolted onto
`hmq`. A prepared bag has a hard expiry (`iv-drugs.json.exp`), and a queue that
cannot express *"mixed 14:05, expires 21:05, still not delivered"* is unsafe.

---

## Workflow

```
  ①            ②            ③            ④            ⑤
ORDERED  →  PENDING  →  PREPARING  →  CHECKED  →  SENT
                 │           │            │
                 └───────────┴────────────┴──→  CANCELLED / RETURNED
```

| # | Status | Who | What happens |
|---|---|---|---|
| ① | `ordered` | (system) | Row appears from the ward's IV order. Not yet pharmacy's. |
| ② | `pending` | pharmacist | Accepted into today's worklist. Sorted by `dueAt`. |
| ③ | `preparing` | technician | Claimed for mixing. **Stability clock starts** → `preparedAt`, `expiresAt`. |
| ④ | `checked` | pharmacist | Second-person verification. Required for HAD; see below. |
| ⑤ | `sent` | porter/nurse | Left the pharmacy, signed for on the ward via the send report. |
| — | `cancelled` | any | Order stopped (patient discharged, drug changed). |
| — | `returned` | ward | Came back unused — separate from cancelled, it may be re-usable before `expiresAt`. |

### Two rules that shape the UI

**High-alert drugs cannot skip ④.** `iv-drugs.json` marks entries
`"type": "HAD"` (KCl, and 8 others today). For those, `preparing → sent`
is refused by the server, not merely hidden in the UI — a workstation with a
stale script must not be able to bypass a double-check.

**Expiry is displayed, never inferred at render time alone.** `expiresAt` is
computed once, server-side, at the `preparing` transition: `preparedAt +
iv-drugs.exp hours`. Clients only compare it to `now`. Two workstations with
different clock skew must not disagree about whether a bag is expired.

---

## Shared data — how this talks to the rest of the portal

The point of building it inside the portal is that the patient is already
known. Nothing here re-types an HN.

```
        ┌──────────────────────────────────────────────┐
        │  pharmacy_server   /api/iv-worklist          │
        │  data/iv-worklist/YYYY-MM-DD.json            │
        └───────────────┬──────────────────────────────┘
                        │  patientuid + patientvisituid
        ┌───────────────┴──────────────────────────────┐
        │        shared-data-client.js                 │
        │  loadCapture / saveCapture / getPatientCtx   │
        └───┬───────────────┬───────────────┬──────────┘
            │               │               │
      ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴──────┐
      │  hmr      │   │ home-med  │   │ iv-aux-    │
      │ HM Process│   │  Sheet    │   │ sticker    │
      └───────────┘   └───────────┘   └────────────┘
```

Concretely, three integrations are designed in from the start:

1. **`hmr` (HM Process)** — a patient with unfinished IV doses should not
   quietly complete discharge. The worklist exposes
   `GET /api/iv-worklist/by-visit/{visituid}`, so the HM Process card can show
   *"2 IV doses still pending"* next to its existing checklist. Same
   `patientuid` + `patientvisituid` keys the capture bag already uses.

2. **Home Medication Sheet** — IV antibiotics finishing at discharge are
   exactly what gets stepped down to oral. The sheet can list what the patient
   actually received, rather than what was ordered.

3. **`iv-aux-sticker`** — the label already exists. A `preparing` row hands its
   drug + patient + `expiresAt` straight to the sticker page instead of the
   pharmacist re-keying it, and the sticker's expiry then always matches the
   worklist's.

Reference data is read, never duplicated: `rx/iv-drugs.json` for stability and
HAD flags, `rx/mixing-protocols.json` for the mixing steps shown in the drawer.

---

## Files

| File | Role |
|---|---|
| `page-iv-worklist.html` | The board — today's live queue |
| `page-iv-worklist.js` | Board logic, status transitions, drawer |
| `page-iv-worklist.css` | Board + dashboard styling (shared tokens) |
| `page-iv-dashboard.html` | History, workload and turnaround stats |
| `page-iv-dashboard.js` | Dashboard aggregation and charts |
| `iv-worklist-core.js` | Pure logic: status machine, expiry, sorting, grouping |
| `iv-demo-data.js` | **Demo only.** ~40 synthetic rows. Delete when the getter lands. |
| `content-iv-worklist.js` | (later) ArcusAir injection point |

`iv-worklist-core.js` holds no DOM and no fetch, so the status machine can be
unit-tested and reused by the eventual content script.

---

## Record shape

Follows the `hmq` convention — stable id, status, timestamps, `auditLog` —
so the dashboard's history view works the same way.

```jsonc
{
  "id": "IV-20260830-0007",
  "date": "2026-08-30",
  "status": "preparing",

  "patientuid": "5b8a574c3238d86bf0c2121f",  // shared key
  "patientvisituid": "6a1d070e771b27cb0a60bf41",
  "hn": "48-25-011535",
  "name": "MRS. SOMYING JAIDEE",
  "ward": "Ward 6",
  "bed": "612/2",

  "drug": {
    "code": "51001020104003",
    "name": "Meropenem 1 g",
    "dose": "1 g",
    "solvent": "NSS 100 mL",
    "route": "IV infusion",
    "rate": "over 30 min",
    "had": false,                  // ← from rx/iv-drugs.json
    "stabilityHours": 4            // ← from rx/iv-drugs.json .exp
  },

  "dueAt":      "2026-08-30T14:00:00+07:00",
  "preparedAt": "2026-08-30T13:42:11+07:00",
  "expiresAt":  "2026-08-30T17:42:11+07:00",   // preparedAt + stabilityHours
  "checkedAt":  null,
  "deliveredAt": null,

  "preparedBy": "Apsorn",         // names from rx/iv-staff.json
  "checkedBy":  null,
  "priority":   "stat",           // stat | urgent | routine
  "note":       "",

  "auditLog": [
    { "ts": "...", "user": "Apsorn", "action": "Accepted into worklist" },
    { "ts": "...", "user": "Apsorn", "action": "Started preparing" }
  ]
}
```

**Storage:** `data/iv-worklist/YYYY-MM-DD.json`, one file per day — the same
shape `kpi/` uses. A day's worklist is a bounded, naturally-archived unit, and
the dashboard reads a date range by reading N files. This folder is
**production-written and gitignored**, like every other live data folder.

---

## API (proposed)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/iv-worklist?date=YYYY-MM-DD` | One day's rows |
| `GET` | `/api/iv-worklist/range?from=&to=` | Dashboard history |
| `GET` | `/api/iv-worklist/by-visit/{visituid}` | **Cross-feature hook** for `hmr` |
| `POST` | `/api/iv-worklist` | Add a row |
| `PATCH` | `/api/iv-worklist/{id}` | Status transition (server validates + stamps times) |

Transitions go through `PATCH`, never a blind `PUT` of the whole record: the
server owns `expiresAt`, the HAD rule and the `auditLog` append. Two
technicians claiming the same dose is resolved server-side, the same way the
`hmq` queue resolves a double-claim.

---

## Pending: the data getter

Everything above is real except where the rows come from. When the extractor
lands it should populate the record's `drug`, `dueAt`, `patientuid` and
`patientvisituid`, then `POST` to the worklist. Two open questions worth
settling with real data in hand:

- **What identifies a repeating dose?** A q6h order is one ArcusAir order but
  four worklist rows. Whether the getter expands the schedule, or the server
  does from a frequency + start time, decides where `frequencymaster.json`
  gets consulted.
- **Do amendments arrive as a new order or an edit?** If a ward changes the
  dose after 13:00's bag is mixed, the already-prepared row must not silently
  mutate — it needs `cancelled` + a fresh row, so the audit trail shows a bag
  was made and discarded.

Until then `iv-demo-data.js` fills the board so the workflow and UI can be
reviewed.


---

## v2 — what the board actually does

**Default view is ward-grouped, rooms in numeric order.** That is the order the
pharmacy works and the porter walks. Room sorting is numeric, not lexical, so
`902` precedes `1002`, and the `ICU`/`CCU` letter prefixes sort after the
numbered wards. The kanban board is still one click away for the "what stage is
everything at" question.

**Four filters, combined with AND**, each multi-select — an empty row means *no
restriction*, not *nothing*:

| Filter | Source |
|---|---|
| ⏱ Admin time | the master sheet's q-hour columns (00, 02, 06, 10, 12, 14, 18, 22) |
| 🏥 Ward | derived from the room number's first digit; `ICU`/`CCU` by prefix |
| 💊 Medicine | distinct drugs on the sheet |
| 📋 Status | the workflow states |

**Stickers are built in, not a separate page.** `iv-sticker-print.js` reuses the
*exact* markup, class names and `@page` rules from `iv-aux-sticker/iv_sticker.js`
— IPD at 8 × 3.5 cm, small at 4 × 2 cm — so a label printed from the board comes
off the same roll as one printed from the IV Label page. The gain over re-keying
is that the printed expiry is the row's own `expiresAt`: **the label and the
board can never disagree about when the bag dies.** Print one from the drawer,
or a whole ward's worth from the ward header.

**The send report is the delivery record.** Grouped ward → room so the round is
walked in order, one signature column per row, HAD flagged in red. It only
includes rows in `checked` or `sent` — what is still being mixed, or already
gone, does not belong on the sheet the porter carries.

Printing goes through a hidden same-document iframe rather than `window.open()`:
a popup is blocked both in an extension page and inside the artifact preview,
while an iframe prints from any context. It waits on `document.fonts.ready`
before calling `print()`, or the first label comes out in a fallback face at the
wrong width.

## Demo data

`iv-demo-data.js` is now generated from the real **IV_ATB_Master 2026** sheet:
38 standing orders across 8 wards, with the real rooms, drugs, doses, diluents,
frequencies, q-hour slots and ward remarks. One row per **dose**, so those 38
orders expand to ~57 doses a day. Status is assigned from the clock, so the
board reads like a real mid-shift.

**HNs and patient names are synthetic** — the master sheet holds real patients
and none of that is reproduced.

> **Stability needs confirming.** The master file's `exp` is in *days*
> (Cefazolin 7, Vancomycin 14) — that is vial/storage stability, not the in-use
> limit for a hung bag. `DRUG_INFO.hours` in the demo carries a practical in-use
> window instead (Meropenem 4 h, Pip/Tazo 12 h, most cephalosporins 24 h). Those
> numbers drive the expiry badge staff will act on, so confirm them with the IV
> team before go-live.
