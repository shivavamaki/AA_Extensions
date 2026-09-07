"""IV Worklist — server-side store and CRUD.

The server owns the data. Clients read it and request transitions; they never
compute the things that must be consistent across workstations:

  * `expiresAt`   — computed once, here, at the `preparing` transition. Two
                    workstations with different clock skew must not disagree
                    about whether a bag is still good.
  * the HAD rule  — a high-alert drug cannot go preparing -> sent without a
                    second check. Enforced here as well as in the UI, so a
                    workstation running a stale script cannot bypass it.
  * `auditLog`    — appended server-side, so the trail cannot be rewritten by
                    a client replaying an old record.
  * dose identity — one row per (visit, order, date, slot). Re-running the
                    sync upserts on that key instead of duplicating the 14:00
                    Rocephin every refresh.

Storage: data/iv-worklist/YYYY-MM-DD.json, one file per day — the same shape
kpi/ uses. A day's worklist is a bounded, naturally-archived unit, and a date
range is N file reads. The folder is production-written and gitignored.
"""

from __future__ import annotations

import json
import re
import threading
from datetime import datetime, timedelta, timezone

# Thai wards run on UTC+7; every wall-clock time here is Bangkok local.
TZ_BKK = timezone(timedelta(hours=7))

FLOW = ['ordered', 'pending', 'preparing', 'checked', 'sent']
TERMINAL = ['cancelled', 'returned']

NEXT = {
    'ordered':   ['pending', 'cancelled'],
    'pending':   ['preparing', 'cancelled'],
    'preparing': ['checked', 'sent', 'cancelled'],
    'checked':   ['sent', 'cancelled'],
    'sent':      ['returned'],
    'cancelled': [],
    'returned':  [],
}

_ID_RE = re.compile(r'^IV-\d{8}-\d{4}$')
_DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')

_lock = threading.RLock()


# ── Paths ──────────────────────────────────────────────────────────────────

def _dir(data_dir):
    p = data_dir / 'iv-worklist'
    p.mkdir(parents=True, exist_ok=True)
    return p


def _day_path(data_dir, date_str):
    return _dir(data_dir) / f'{date_str}.json'


def today_str():
    return datetime.now(TZ_BKK).strftime('%Y-%m-%d')


def _now_iso():
    return datetime.now(TZ_BKK).isoformat()


def safe_id(v):
    return bool(v) and bool(_ID_RE.match(str(v)))


def safe_date(v):
    return bool(v) and bool(_DATE_RE.match(str(v)))


# ── Read / write ───────────────────────────────────────────────────────────

def load_day(data_dir, date_str):
    """All rows for one day, or [] if the day has no file yet."""
    if not safe_date(date_str):
        return []
    p = _day_path(data_dir, date_str)
    if not p.exists():
        return []
    try:
        with open(p, encoding='utf-8') as f:
            rows = json.load(f)
        return rows if isinstance(rows, list) else []
    except (OSError, ValueError):
        # A truncated file must not take the board down; the sync will rebuild.
        return []


def save_day(data_dir, date_str, rows, atomic_write_json):
    atomic_write_json(_day_path(data_dir, date_str), rows)


def load_range(data_dir, date_from, date_to):
    """Rows across an inclusive date range, for the dashboard."""
    if not (safe_date(date_from) and safe_date(date_to)):
        return []
    d0 = datetime.strptime(date_from, '%Y-%m-%d').date()
    d1 = datetime.strptime(date_to, '%Y-%m-%d').date()
    if d1 < d0:
        d0, d1 = d1, d0
    # Guard the window: a typo'd range must not walk years of files.
    if (d1 - d0).days > 92:
        d0 = d1 - timedelta(days=92)
    out = []
    cur = d0
    while cur <= d1:
        out.extend(load_day(data_dir, cur.strftime('%Y-%m-%d')))
        cur += timedelta(days=1)
    return out


def by_visit(data_dir, visituid, date_str=None):
    """Rows for one admission — the cross-feature hook hmr reads."""
    rows = load_day(data_dir, date_str or today_str())
    return [r for r in rows if r.get('patientvisituid') == visituid]


# ── Stability ──────────────────────────────────────────────────────────────

def compute_expiry(prepared_iso, stability_hours):
    if not prepared_iso or not stability_hours:
        return None
    try:
        t = datetime.fromisoformat(prepared_iso)
    except ValueError:
        return None
    return (t + timedelta(hours=float(stability_hours))).isoformat()


# ── Transitions ────────────────────────────────────────────────────────────

def transition_error(row, to, checked_by=None):
    """'' if the move is allowed, else why not. Mirrors iv-worklist-core.js."""
    if not row:
        return 'No record'
    frm = row.get('status')
    if frm == to:
        return ''
    if to not in NEXT.get(frm, []):
        return f'Cannot go {frm} -> {to}'
    drug = row.get('drug') or {}
    if to == 'sent' and frm == 'preparing' and drug.get('had'):
        return 'High-alert drug — needs a second-person check first'
    if to == 'checked':
        who = (checked_by or row.get('checkedBy') or '').strip().lower()
        prep = (row.get('preparedBy') or '').strip().lower()
        if not who:
            return 'Pick who is checking'
        if prep and who == prep:
            return 'Checker must differ from the preparer'
    return ''


def apply_transition(data_dir, row_id, to, actor, atomic_write_json,
                     date_str=None, checked_by=None, prepared_by=None):
    """Move one row. Returns (row, error). The server stamps every time field."""
    date_str = date_str or today_str()
    with _lock:
        rows = load_day(data_dir, date_str)
        idx = next((i for i, r in enumerate(rows) if r.get('id') == row_id), -1)
        if idx < 0:
            return None, 'Not found'
        row = rows[idx]

        if prepared_by:
            row['preparedBy'] = prepared_by

        # Validate the INCOMING checker against the stored preparer before
        # writing it: assigning first would compare the new name with itself
        # and let one person sign both halves of the double-check.
        err = transition_error(row, to, checked_by=checked_by or row.get('checkedBy'))
        if err:
            return None, err
        if checked_by:
            row['checkedBy'] = checked_by

        now = _now_iso()
        who = actor or 'Unknown'
        row['status'] = to

        if to == 'pending':
            row['acceptedAt'] = now
        elif to == 'preparing':
            row['preparedAt'] = now
            # NOT setdefault: the key already exists as None from expand_order,
            # so setdefault would leave the label with no preparer on it.
            if not row.get('preparedBy'):
                row['preparedBy'] = who
            row['expiresAt'] = compute_expiry(
                now, (row.get('drug') or {}).get('stabilityHours'))
        elif to == 'checked':
            row['checkedAt'] = now
        elif to == 'sent':
            row['sentAt'] = now
            if not row.get('sentBy'):
                row['sentBy'] = who

        label = {
            'pending':   'Accepted into worklist',
            'preparing': 'Started preparing',
            'checked':   'Checked (second person)',
            'sent':      'Sent to ward',
            'cancelled': 'Cancelled',
            'returned':  'Returned',
        }.get(to, to)
        row.setdefault('auditLog', []).append({
            'ts': now,
            'user': (row.get('checkedBy') if to == 'checked' else row.get('preparedBy')) or who,
            'action': label,
        })
        row['updatedAt'] = now

        rows[idx] = row
        save_day(data_dir, date_str, rows, atomic_write_json)
        return row, ''


def patch_fields(data_dir, row_id, fields, atomic_write_json, date_str=None):
    """Edit the few free-text fields a pharmacist may correct by hand."""
    # Fields a pharmacist may correct by hand. `solvent` and `preparedAt` are
    # here because the eMAR order states neither: the diluent comes from the
    # preset but can be overridden at the hood, and the mix time is something
    # only the person mixing knows.
    #
    # `expiresAt` is deliberately NOT accepted from the client — it is
    # recomputed below from preparedAt + the drug's own stability, so a wrong
    # or stale client can never write an expiry that contradicts the drug.
    ALLOWED = {'preparedBy', 'checkedBy', 'note', 'priority',
               'solvent', 'preparedAt'}
    date_str = date_str or today_str()
    with _lock:
        rows = load_day(data_dir, date_str)
        idx = next((i for i, r in enumerate(rows) if r.get('id') == row_id), -1)
        if idx < 0:
            return None, 'Not found'
        row = rows[idx]
        for k, v in (fields or {}).items():
            if k not in ALLOWED:
                continue
            if k == 'solvent':
                drug = row.get('drug') or {}
                drug['solvent'] = v
                row['drug'] = drug
            else:
                row[k] = v

        # Expiry always follows the mix time and the drug's stability — never
        # whatever the client sent.
        if 'preparedAt' in (fields or {}):
            stab = (row.get('drug') or {}).get('stabilityHours')
            row['expiresAt'] = compute_expiry(row.get('preparedAt'), stab)

        row['updatedAt'] = _now_iso()
        rows[idx] = row
        save_day(data_dir, date_str, rows, atomic_write_json)
        return row, ''


# ── Sync (upsert) ──────────────────────────────────────────────────────────

def dose_key(row):
    """Stable identity for one dose: visit + order + date + slot."""
    return '{}:{}:{}:{}'.format(
        row.get('patientvisituid') or '',
        row.get('orderItemId') or row.get('orderNumber') or '',
        row.get('date') or '',
        row.get('slot') or '')


def sync_doses(data_dir, incoming, atomic_write_json, date_str=None):
    """Upsert today's doses from the extractor.

    Idempotent: the getter runs repeatedly through the day, so a dose already on
    the board keeps its status, timestamps and audit trail. Only genuinely new
    doses are added.

    Rows the extractor no longer reports are marked `cancelled` — but only if
    nobody has started them. A bag already mixed stays on the board: it was
    made, and the trail must keep saying so.
    """
    date_str = date_str or today_str()
    with _lock:
        existing = load_day(data_dir, date_str)
        by_key = {dose_key(r): r for r in existing}
        seen = set()
        added = 0

        seq = 0
        for r in existing:
            m = re.match(r'^IV-\d{8}-(\d{4})$', r.get('id') or '')
            if m:
                seq = max(seq, int(m.group(1)))

        for inc in incoming or []:
            inc.setdefault('date', date_str)
            # Apply the pharmacy's own presets, keyed on the ArcusAir item
            # code. The eMAR order never states a diluent or a stability
            # window, so both come from the master here rather than from
            # whatever the client sent — one place to correct, and the board
            # and the sticker can never disagree.
            _d = inc.get('drug') or {}
            _prep = find_prep(data_dir, _d.get('code'), _d.get('name'))
            if _prep:
                if _prep.get('wardPrepares'):
                    continue          # ward mixes it; not pharmacy work
                if not _d.get('solvent'):
                    _d['solvent'] = pick_diluent(
                        _prep,
                        parse_dose_mg(_d.get('dose')),
                        bool(inc.get('isChild')))
                if _prep.get('stabilityHours'):
                    _d['stabilityHours'] = _prep['stabilityHours']
                elif _prep.get('shelfDays'):
                    _d['stabilityHours'] = _prep['shelfDays'] * 24
                _d['had'] = bool(_prep.get('had'))
                # Short name for the sticker. The ArcusAir item name is written
                # for an order screen ("Rocephin INJ (2 g) I.V.Vial #") and is
                # far too long for an 8x3.5 cm label, where it wraps onto three
                # lines and pushes the dose off the bottom. The workbook's own
                # nickname is what the pharmacy calls the drug.
                if _prep.get('nickname'):
                    _d['nickname'] = _prep['nickname']
                if not _d.get('freq') and _prep.get('defaultFreq'):
                    _d['freq'] = _prep['defaultFreq']
                if _prep.get('concMgPerMl'):
                    _d['concMgPerMl'] = _prep['concMgPerMl']
                inc['drug'] = _d
            k = dose_key(inc)
            seen.add(k)
            cur = by_key.get(k)
            if cur:
                # Refresh only the order-derived facts; never the workflow state.
                for f in ('hn', 'name', 'ward', 'room', 'drug', 'dueAt', 'note'):
                    if f in inc:
                        cur[f] = inc[f]
                continue
            seq += 1
            inc['id'] = 'IV-{}-{:04d}'.format(date_str.replace('-', ''), seq)
            inc.setdefault('status', 'ordered')
            inc.setdefault('auditLog', [])
            inc.setdefault('createdAt', _now_iso())
            existing.append(inc)
            by_key[k] = inc
            added += 1

        cancelled = 0
        for r in existing:
            if dose_key(r) in seen:
                continue
            if r.get('status') in ('ordered', 'pending'):
                r['status'] = 'cancelled'
                r.setdefault('auditLog', []).append({
                    'ts': _now_iso(), 'user': 'system',
                    'action': 'Cancelled — order no longer active',
                })
                cancelled += 1

        save_day(data_dir, date_str, existing, atomic_write_json)
        return {'total': len(existing), 'added': added, 'cancelled': cancelled}


# ── Preset lookup (data/rx/iv-prep-db.json) ───────────────────────────────

_PREP_CACHE = {'mtime': None, 'by_code': {}, 'by_name': []}


def _load_prep_db(data_dir):
    """The IV preparation master, cached by mtime.

    Re-read when the file changes so a preset edited in the editor takes effect
    on the next dose without restarting the server.
    """
    f = data_dir / 'rx' / 'iv-prep-db.json'
    try:
        m = f.stat().st_mtime
    except OSError:
        return _PREP_CACHE
    if _PREP_CACHE['mtime'] == m:
        return _PREP_CACHE
    try:
        with open(f, encoding='utf-8') as fh:
            db = json.load(fh)
    except (OSError, ValueError):
        return _PREP_CACHE
    by_code, by_name = {}, []
    for it in db.get('items') or []:
        if it.get('code'):
            by_code[str(it['code'])] = it
        nick = (it.get('nickname') or '').strip().lower()
        if nick:
            by_name.append((nick, it))
    # Longest nickname first: "Meropenem 1 g" should prefer a longer, more
    # specific entry over a short fragment that also matches.
    by_name.sort(key=lambda kv: -len(kv[0]))
    _PREP_CACHE.update({'mtime': m, 'by_code': by_code, 'by_name': by_name})
    return _PREP_CACHE


def find_prep(data_dir, code=None, name=None):
    """Preset for ONE ordered item.

    Keyed on the ArcusAir item code, because strength and pack size change the
    preparation: Rocephin 1 g and Rocephin 2 g share the nickname "Rocephin"
    but are separate entries with their own rules. Name matching is only a
    fallback for an item whose code is not in the master yet, and can only ever
    be approximate — two products can share a nickname.
    """
    c = _load_prep_db(data_dir)
    if code and str(code) in c['by_code']:
        return c['by_code'][str(code)]
    if name:
        k = str(name).strip().lower()
        for nm, it in c['by_name']:
            if nm and (nm in k or k in nm):
                return it
    return None


def parse_dose_mg(dose):
    """Ordered dose as milligrams, or None.

    Accepts what the eMAR row actually says: "1000 Milligram", "1 g", "4.5 g",
    "500 mg". Grams are converted, because the rules are written in mg.
    """
    if dose is None:
        return None
    t = str(dose).strip().lower().replace(',', '')
    m = re.search(r'([\d.]+)\s*(gm|g|mg|milligram|gram)?', t)
    if not m:
        return None
    try:
        v = float(m.group(1))
    except ValueError:
        return None
    unit = (m.group(2) or 'mg').strip()
    if unit in ('g', 'gm', 'gram'):
        v *= 1000.0
    return v


def pick_diluent(prep, dose_mg=None, is_child=False):
    """First matching rule wins.

    Rules are ordered by the pharmacy, so a narrow dose band placed above a
    catch-all is honoured — e.g. ceftriaxone 1500 mg is SWI 15 mL for a child
    but NSS 100 mL for an adult, which one flat value per drug cannot express.
    """
    if not prep:
        return ''
    want = 'child' if is_child else 'adult'
    for r in prep.get('rules') or []:
        when = (r.get('when') or 'any').lower()
        if when not in ('any', want):
            continue
        lo, hi = r.get('minMg'), r.get('maxMg')
        if dose_mg is not None:
            if lo is not None and dose_mg < lo:
                continue
            if hi is not None and dose_mg > hi:
                continue
        elif lo is not None or hi is not None:
            # A dose-bounded rule cannot be trusted when the dose is unknown.
            continue
        if r.get('diluent'):
            return r['diluent']
    return ''


def refresh_presets(data_dir, date_str=None, atomic_write_json=None):
    """Re-apply the preset database to a day's existing rows.

    Rows created before a preset existed — or before the drug was added to the
    master — keep whatever stability the client happened to send, which is a
    24 h default. That is not a cosmetic problem: the expiry printed on a bag
    is a clinical instruction, and 24 h on a drug good for 7 days makes the
    ward discard usable medicine (or, the other way round, keep an expired one).
    So the presets are re-applied on every load rather than only at sync.

    Only the drug's own facts are refreshed. Workflow state, timestamps, who
    prepared it and the audit trail are never touched. expiresAt is recomputed
    only when the bag already has a mix time.
    """
    date_str = date_str or today_str()
    rows = load_day(data_dir, date_str)
    changed = 0
    for r in rows:
        d = r.get('drug') or {}
        prep = find_prep(data_dir, d.get('code'), d.get('name'))
        if not prep:
            continue
        before = (d.get('stabilityHours'), d.get('solvent'), d.get('had'))
        hours = prep.get('stabilityHours') or ((prep.get('shelfDays') or 0) * 24)
        if hours:
            d['stabilityHours'] = hours
        if not d.get('solvent'):
            d['solvent'] = pick_diluent(prep, parse_dose_mg(d.get('dose')),
                                        bool(r.get('isChild')))
        d['had'] = bool(prep.get('had'))
        if prep.get('nickname'):
            d['nickname'] = prep['nickname']
        # Do NOT back-fill the code from a NAME match. Rocephin 1 g and
        # Rocephin 2 g share the nickname, so the name lookup returns whichever
        # entry sorted first — writing that code would permanently mislabel the
        # dose as the wrong strength. A code is only ever trusted when the
        # extractor supplied it.
        r['drug'] = d
        if r.get('preparedAt'):
            r['expiresAt'] = compute_expiry(r['preparedAt'], d.get('stabilityHours'))
        if before != (d.get('stabilityHours'), d.get('solvent'), d.get('had')):
            changed += 1
    if changed and atomic_write_json:
        save_day(data_dir, date_str, rows, atomic_write_json)
    return rows, changed


# ── ArcusAir order -> doses ────────────────────────────────────────────────

def slot_from_timing(iso):
    """ArcusAir timing instant -> 'HH:MM' on the Bangkok ward clock.

    `timings` are 1970-epoch instants in real UTC; the ward round is that
    instant in UTC+7 (00:00Z -> 07:00, 14:00Z -> 21:00), which is what makes
    "before breakfast / bedtime" line up. Convert explicitly: this runs on a
    server that may well be on UTC.
    """
    try:
        t = datetime.fromisoformat(str(iso).replace('Z', '+00:00'))
    except ValueError:
        return None
    return t.astimezone(TZ_BKK).strftime('%H:%M')


def expand_order(order, drug_info, date_str=None):
    """One ArcusAir order -> one row per scheduled dose.

    `drug_info` is the workbook entry (diluent, stabilityHours, had); an order
    whose drug is not in the workbook, or is ward-prepared, yields nothing.
    PRN orders carry no timings and are not pharmacy-scheduled work.
    """
    if not drug_info or drug_info.get('wardPrepares'):
        return []
    date_str = date_str or today_str()
    timings = order.get('timings') or []
    if not timings:
        return []

    out = []
    for ts in timings:
        slot = ts if re.match(r'^\d{2}:\d{2}$', str(ts)) else slot_from_timing(ts)
        if not slot:
            continue
        due = f'{date_str}T{slot}:00+07:00'
        out.append({
            'date': date_str,
            'status': 'ordered',
            'patientuid': order.get('patientuid'),
            'patientvisituid': order.get('patientvisituid'),
            'orderItemId': order.get('orderItemId'),
            'orderNumber': order.get('orderNumber'),
            'hn': order.get('hn'),
            'name': order.get('name'),
            'ward': order.get('ward'),
            'room': order.get('room'),
            'slot': slot,
            'drug': {
                'name': order.get('drug'),
                'code': order.get('code'),
                'dose': order.get('dose'),
                'solvent': order.get('solvent') or drug_info.get('adult') or '',
                'route': order.get('route') or 'IV',
                'rate': order.get('rate') or '',
                'freq': order.get('freq') or '',
                'had': bool(drug_info.get('type') == 'HAD'),
                'stabilityHours': (drug_info.get('shelfDays') or 1) * 24,
                'storage': drug_info.get('note') or '',
            },
            'dueAt': due,
            'acceptedAt': None, 'preparedAt': None, 'expiresAt': None,
            'checkedAt': None, 'sentAt': None,
            'preparedBy': None, 'checkedBy': None, 'sentBy': None,
            'priority': 'urgent' if drug_info.get('type') == 'HAD' else 'routine',
            'note': order.get('remark') or '',
            'auditLog': [],
        })
    return out
