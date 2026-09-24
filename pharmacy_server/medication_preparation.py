"""Append-only preparation acknowledgements; no dispensing or order updates."""
import hashlib
import json
import re
import threading
from datetime import datetime, timedelta, timezone, date
from pathlib import Path

_LOCK = threading.Lock()
BANGKOK = timezone(timedelta(hours=7))


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('Date must be YYYY-MM-DD')
    return date.fromisoformat(value)


def save(root, body, staff, writer, now=None):
    if not isinstance(body, dict):
        raise ValueError('Expected a JSON object')
    name, order = body.get('staffName'), body.get('orderNumber')
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise ValueError('Select a staff member from the IV sticker list')
    name = name.strip()
    if not isinstance(order, str) or not re.fullmatch(r'[IOE][A-Za-z0-9._/-]{1,159}', order):
        raise ValueError('Scan a valid order number beginning with I, O, or E')
    scan_day = day(body.get('scanDate'))
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(BANGKOK).date()
    digest = hashlib.sha256((name + '\0' + order).encode('utf-8')).hexdigest()
    target = Path(root) / scan_day.isoformat() / (digest + '.json')
    with _LOCK:
        if target.exists():
            return json.loads(target.read_text(encoding='utf-8')), False
        if scan_day not in (today, today - timedelta(days=1)):
            raise ValueError('Scan date expired or computer clock is incorrect; refresh and scan again')
        match = next((s for s in staff if isinstance(s, dict) and s.get('name') == name), None)
        if match is None:
            raise ValueError('Staff name is no longer in the IV sticker list; reload staff names')
        doc = {'id': 'prep_' + scan_day.isoformat() + '_' + digest[:24],
               'event': 'medication_prepared', 'orderNumber': order,
               'staffName': match['name'], 'staffRole': match.get('role', ''),
               'preparedAt': now.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z'),
               'date': today.isoformat(), 'scanDate': scan_day.isoformat(),
               'source': 'medication-preparation-page', 'identityMethod': 'staff-selection'}
        writer(target, doc)
        return doc, True


def list_records(root, from_date, to_date, order='', staff='', limit=100, offset=0):
    start, end = day(from_date), day(to_date)
    if end < start or (end - start).days > 365:
        raise ValueError('Choose a date range of at most 366 days')
    if not 1 <= limit <= 500 or offset < 0:
        raise ValueError('Invalid pagination')
    rows = []
    # A midnight retry may have its scan bucket on the preceding day.
    current = start - timedelta(days=1)
    while current <= end:
        for path in (Path(root) / current.isoformat()).glob('*.json'):
            doc = json.loads(path.read_text(encoding='utf-8'))
            if not from_date <= doc.get('date', '') <= to_date:
                continue
            if order and order.lower() not in doc.get('orderNumber', '').lower():
                continue
            if staff and staff != doc.get('staffName'):
                continue
            rows.append(doc)
        current += timedelta(days=1)
    rows.sort(key=lambda r: (r['preparedAt'], r['id']), reverse=True)
    return {'rows': rows[offset:offset + limit], 'total': len(rows),
            'from': from_date, 'to': to_date, 'limit': limit, 'offset': offset}
