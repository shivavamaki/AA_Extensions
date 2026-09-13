"""Validated Home Medication report cache. Never stores session credentials."""
import hashlib
import json
import os
import tempfile
import time
from pathlib import Path

TTL_SECONDS = 15 * 60
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
        age = (time.time() if now is None else now) - record['savedAt']
        if record.get('version') != VERSION or not 0 <= age < TTL_SECONDS:
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
        os.replace(temp, directory / (key + '.json'))
    finally:
        if temp and os.path.exists(temp):
            os.unlink(temp)