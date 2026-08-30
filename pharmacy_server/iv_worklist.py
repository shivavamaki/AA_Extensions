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
    ALLOWED = {'preparedBy', 'checkedBy', 'note', 'priority'}
    date_str = date_str or today_str()
    with _lock:
        rows = load_day(data_dir, date_str)
        idx = next((i for i, r in enumerate(rows) if r.get('id') == row_id), -1)
        if idx < 0:
            return None, 'Not found'
        row = rows[idx]
        for k, v in (fields or {}).items():
            if k in ALLOWED:
                row[k] = v
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
