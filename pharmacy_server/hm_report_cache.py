"""Validated Home Medication report cache. Never stores session credentials."""
import hashlib
import json
import os
import tempfile
import time
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

RETENTION_DAYS = 4
THAILAND = timezone(timedelta(hours=7))
_lock = threading.RLock()
_workers = set()
VERSION = 1

def identity(context):
    patient, visit = context.get('patientuid'), context.get('patientvisituid')
    if not isinstance(patient, str) or not isinstance(visit, str) or not patient or not visit:
        return None
    return hashlib.sha256((patient + '|' + visit).encode()).hexdigest()

def fingerprint(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

def load(directory, context, data, now=None):
    key = identity(context)
    if not key:
        return None
    try:
        record = json.loads((Path(directory) / (key + '.json')).read_text(encoding='utf-8'))
        age = (thai_date(time.time() if now is None else now) - thai_date(record['savedAt'])).days
        if record.get('version') != VERSION or not 0 <= age < RETENTION_DAYS:
            return None
        if record.get('fingerprint') != fingerprint(data):
            return None
        result = record.get('result')
        return result if isinstance(result, dict) and result.get('ok') else None
    except (OSError, ValueError, KeyError, TypeError):
        return None

def save(directory, context, data, result, now=None):
    key = identity(context)
    if not key:
        return
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    record = dict(version=VERSION, savedAt=time.time() if now is None else now,
                  fingerprint=fingerprint(data), result=result)
    temp = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=directory, delete=False) as f:
            temp = f.name
            json.dump(record, f, ensure_ascii=False)
        with _lock:
            os.replace(temp, directory / (key + '.json'))
    finally:
        if temp and os.path.exists(temp):
            os.unlink(temp)

def thai_date(timestamp):
    return datetime.fromtimestamp(timestamp, THAILAND).date()


def cleanup(directory, now=None):
    """Delete expired cache JSON only; serialize with atomic cache replacement."""
    today = thai_date(time.time() if now is None else now)
    deleted = 0
    for path in Path(directory).glob('*.json'):
        if len(path.stem) != 64 or any(c not in '0123456789abcdef' for c in path.stem):
            continue
        with _lock:
            try:
                if path.is_symlink():
                    continue
                record = json.loads(path.read_text(encoding='utf-8'))
                if (today - thai_date(record['savedAt'])).days >= RETENTION_DAYS:
                    path.unlink()
                    deleted += 1
            except (OSError, ValueError, KeyError, TypeError, OverflowError):
                continue
    return deleted


def next_cleanup(now):
    local = datetime.fromtimestamp(now, THAILAND)
    target = local.replace(hour=23, minute=0, second=0, microsecond=0)
    if target <= local:
        target += timedelta(days=1)
    return target.timestamp()


def start_cleanup(directory):
    """One daemon per directory; startup catch-up plus 23:00 Thailand daily."""
    directory = Path(directory).resolve()
    with _lock:
        if directory in _workers:
            return
        _workers.add(directory)

    def run():
        while True:
            try:
                cleanup(directory)
            except OSError:
                pass
            deadline = next_cleanup(time.time())
            while time.time() < deadline:
                time.sleep(min(60, max(0, deadline - time.time())))

    threading.Thread(target=run, name='hm-cache-cleanup', daemon=True).start()