#!/usr/bin/env python3
"""
BKN Pharmacy — Knowledge Sharing Server
User-level: no admin rights or pip install required.
Uses only Python built-in libraries (Python 3.6+).

Usage:
  python bkn_ks_server.py
  python bkn_ks_server.py --port 9000

API:
  GET    /ping                              — health check (returns server URL)
  GET    /api/kpi                           — all daily KPI docs (newest first)
  GET    /api/kpi/YYYY-MM-DD               — one day's KPI doc (null if missing)
  PUT    /api/kpi/YYYY-MM-DD               — replace full day doc
  PUT    /api/kpi/YYYY-MM-DD/opd-brief     — update opdBrief section only
  PUT    /api/kpi/YYYY-MM-DD/ipd-brief     — update ipdBrief section only
  PUT    /api/kpi/YYYY-MM-DD/opd-stat      — update opdStat section only
  PUT    /api/kpi/YYYY-MM-DD/ipd-stat      — update ipdStat section only
  POST   /api/kpi/YYYY-MM-DD/med-errors    — append one med-error record
  DELETE /api/kpi/YYYY-MM-DD/med-errors/ID — remove by savedAt (URL-encoded)
  GET    /api/{ks_col}                      — get KS collection (faqs|items|vdos)
  PUT    /api/{ks_col}                      — replace KS collection (JSON array)

  GET    /api/premix-drugs                  — premix drug list (array)
  GET    /api/mixing-protocols              — mixing label protocols (array)
  GET    /api/iv-drugs                      — IV drug master list (array)
  PUT    /api/iv-drugs                      — replace IV drug master list
  GET    /api/iv-staff                      — pharmacy staff list (array)
  PUT    /api/iv-staff                      — replace pharmacy staff list
  GET    /api/medication-db                 — BKN medication DB keyed by item code

  GET    /api/patients/{puid}                                — full patient profile
  PUT    /api/patients/{puid}                                — replace patient profile
  GET    /api/patients/{puid}/context                        — patient context only
  PUT    /api/patients/{puid}/context                        — merge into context
  GET    /api/patients/{puid}/adr-timeline                   — ADR timeline data
  PUT    /api/patients/{puid}/adr-timeline                   — replace ADR timeline
  GET    /api/patients/{puid}/medication-cache/{visituid}    — cached meds for visit
  PUT    /api/patients/{puid}/medication-cache/{visituid}    — store cached meds

Data layout:
  data/kpi/YYYY-MM-DD.json    — one file per day
  data/ks/faqs.json
  data/ks/items.json
  data/ks/vdos.json
  data/rx/premix-drugs.json
  data/rx/mixing-protocols.json
  data/rx/iv-drugs.json
  data/rx/iv-staff.json
  data/rx/medication-db.json
  data/rx/pattern-overrides.json  — pharmacist-curated phrase translations, layered
                                     in front of the hardcoded AUXILIARY_PHRASES in
                                     medical-glossary.js (see pattern-editor feature)
  data/patients/{patientuid}.json   — one file per patient (context, ADR, med cache)
"""

import hashlib
import json
import mimetypes
import os
import re
import secrets
import shutil
import sys
import socket
import ssl
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar
import struct
import threading
import random
import unicodedata
import math
from datetime import datetime, timezone, timedelta
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────
DEFAULT_PORT  = 8765
DATA_DIR      = Path(__file__).parent / 'data'
KPI_DIR       = DATA_DIR / 'kpi'
KS_DIR        = DATA_DIR / 'ks'
RX_DIR        = DATA_DIR / 'rx'
AUTH_DIR      = DATA_DIR / 'auth'
AUTH_FILE     = AUTH_DIR / 'users.json'
MED_IMAGES_DIR = DATA_DIR / 'med-images'
# Extensions probed (in order) by the /med-image/:code route before scanning.
MED_IMAGE_EXTS = ('jpg', 'jpeg', 'png', 'jfif', 'webp', 'gif', 'jxl')
# Explicit MIME types — Python's mimetypes returns None for webp/jxl/jfif.
_IMAGE_MIME = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.jfif': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.jxl': 'image/jxl',
}
KS_FILES_DIR  = DATA_DIR / 'ks' / 'files'
SCHEDULE_DIR      = DATA_DIR / 'schedule'
TEMP_REPORTS_DIR  = DATA_DIR / 'temp-reports'
PATIENTS_DIR      = DATA_DIR / 'patients'
HMR_DIR           = DATA_DIR / 'hmr'
LOGS_DIR          = DATA_DIR / 'logs'
WWW_DIR           = Path(__file__).parent / 'www'
KS_COLS       = {'faqs', 'items', 'vdos'}
# All rx collections — GET is public; PUT requires editor/admin auth
RX_COLS       = {'premix-drugs', 'mixing-protocols', 'medication-db', 'iv-drugs', 'iv-staff', 'pattern-overrides', 'chemo-drugs'}
# Requests from these Chrome extensions may read/write data without login.
# Multiple IDs supported during the rx_menu → BKN Pharmacy Portal migration.
TRUSTED_EXTENSION_ORIGINS = {
    'chrome-extension://eeglifkmgelepjmnnldknacamedmckbj',  # rx_menu (legacy)
    'chrome-extension://nffpegfadeflicpjedmhlgpgpjhkgmgg',  # AAOverlay (legacy)
}
# Backward-compat single-origin variable (still referenced by older code paths)
EXTENSION_ORIGIN = 'chrome-extension://eeglifkmgelepjmnnldknacamedmckbj'
# medication-db and pattern-overrides are dicts; all other rx cols are arrays
RX_DICT_COLS  = {'medication-db', 'pattern-overrides'}
DATE_RE       = re.compile(r'^\d{4}-\d{2}-\d{2}$')
MONTH_RE      = re.compile(r'^\d{4}-\d{2}$')
SECTION_KEYS  = {'opd-brief', 'ipd-brief', 'opd-stat', 'ipd-stat'}
SECTION_FIELD = {
    'opd-brief': 'opdBrief',
    'ipd-brief': 'ipdBrief',
    'opd-stat':  'opdStat',
    'ipd-stat':  'ipdStat',
}

def _hm_norm(s):
    return re.sub(r'\s+', ' ', str(s or '').replace('\u00a0', ' ')).strip()


# ── Local Thai mapping data (frequency master + per-item extra labels) ──────
# These let the Home Medication Sheet render Thai instructions on first load
# WITHOUT calling Google Translate. Built once, lazily, from scraped JSON kept
# alongside the other rx master data. Missing/broken files degrade gracefully
# to empty indices (the sheet then falls back to on-demand translation).
FREQ_MASTER_FILE = RX_DIR / 'frequencymaster.json'
EXTRALABEL_FILE           = RX_DIR / 'medication-db.json'         # merged: per-item instructions (TH/EN)
ORDERITEM_EXTRALABEL_FILE = RX_DIR / 'orderitem_extralabel.json'  # raw ArcusAir order-item scrape

_freq_th_idx = None        # normalized freq name/code → Thai localLanguage
_extralabel_idx = None     # item code → {'text': en, 'localLanguage': th}


def _freq_key(s):
    """Case-insensitive, whitespace-collapsed key for frequency name/code match."""
    return _hm_norm(s).lower()


def _load_freq_th_index():
    """name/code (lowercased) → Thai localLanguage, from frequencymaster.json."""
    global _freq_th_idx
    if _freq_th_idx is not None:
        return _freq_th_idx
    idx = {}
    try:
        with open(FREQ_MASTER_FILE, encoding='utf-8') as f:
            data = json.load(f)
        for row in (data.get('rows') or []):
            # Slim shape: lang.TH (Thai) / lang.EN. Fall back to the older
            # detail.localLanguage for backward compatibility.
            th = _hm_norm((row.get('lang') or {}).get('TH')
                          or ((row.get('detail') or {}).get('localLanguage')) or '')
            if not th:
                continue
            # Match on the human-readable frequency name (what the order item
            # carries, e.g. "2 Time Daily Morning and Evening") and on the code.
            for k in (row.get('name'), row.get('code')):
                key = _freq_key(k)
                if key and key not in idx:
                    idx[key] = th
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f'[freq-master] load failed: {e}', file=sys.stderr)
    _freq_th_idx = idx
    return idx


def _load_extralabel_index():
    """item code → {'text', 'localLanguage'} note, from the merged
    medication-db.json (each entry has an 'instructions' array with TH/EN).
    Note-line source: prefer "Patient Instruction" lines; if a code has none
    (e.g. dropped because a "Dispensing Instruction" exists), fall back to
    "Dispensing Instruction". 'localLanguage' = Thai (default), 'text' = English,
    kept separate so each language stays pure."""
    global _extralabel_idx
    if _extralabel_idx is not None:
        return _extralabel_idx
    idx = {}

    def _collect(inss, want_type):
        # Return only the first matching instruction — joining multiples produces
        # confusingly long notes on the Home Med Sheet.
        for ins in inss:
            if (ins.get('type') or '').strip() != want_type:
                continue
            th = _hm_norm(ins.get('TH') or '')
            en = _hm_norm(ins.get('EN') or '')
            if th or en:
                return th, en
        return '', ''

    try:
        with open(EXTRALABEL_FILE, encoding='utf-8') as f:
            data = json.load(f)
        # Merged file is a dict keyed by code; each value has 'instructions'.
        items = data.values() if isinstance(data, dict) else (data.get('results') or [])
        for entry in items:
            code = _hm_norm((entry or {}).get('code') or '')
            inss = (entry or {}).get('instructions') or []
            if not code or not inss:
                continue
            th, en = _collect(inss, 'Patient Instruction')
            if not th and not en:
                th, en = _collect(inss, 'Dispensing Instruction')
            if th or en:
                idx[code] = {'localLanguage': th, 'text': en}
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f'[extralabel] load failed: {e}', file=sys.stderr)
    _extralabel_idx = idx
    return idx


# ── Offline note translator (EN → TH) ──────────────────────────
# Free-text order notes (warnings, drug classes) have no curated Thai for many
# codes. Translate them offline from a glossary mined from the curated Patient
# Instruction pairs + common warning/class terms — no network, no Google.
NOTE_GLOSSARY_FILE = RX_DIR / 'note-glossary.json'
_note_gloss = None

def _load_note_glossary():
    global _note_gloss
    if _note_gloss is not None:
        return _note_gloss
    phrases, terms = {}, {}
    try:
        with open(NOTE_GLOSSARY_FILE, encoding='utf-8') as f:
            data = json.load(f)
        phrases = {(_hm_norm(k)).lower(): v for k, v in (data.get('phrases') or {}).items()}
        # Longest terms first so multi-word phrases win over their sub-words.
        terms = sorted(((k, v) for k, v in (data.get('terms') or {}).items()),
                       key=lambda kv: -len(kv[0]))
    except FileNotFoundError:
        pass
    except Exception as e:
        print(f'[note-gloss] load failed: {e}', file=sys.stderr)
    _note_gloss = (phrases, terms)
    return _note_gloss

def _load_orderitem_extralabel_raw():
    """Load orderitem_extralabel.json as-is. Returns the full dict."""
    try:
        with open(ORDERITEM_EXTRALABEL_FILE, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {'results': []}
    except Exception as e:
        print(f'[orderitem-extralabel] load error: {e}', file=sys.stderr)
        return {'results': []}


def _translate_note(en):
    """EN note → Thai. Exact curated phrase first; else substitute known terms.
    Returns '' if nothing could be translated (caller keeps the English)."""
    src = _hm_norm(en)
    if not src or not re.search(r'[A-Za-z]', src):
        return src                       # already Thai / empty
    phrases, terms = _load_note_glossary()
    exact = phrases.get(src.lower())
    if exact:
        return exact
    # Component substitution: replace each known term (case-insensitive).
    out = src
    for term, th in terms:
        out = re.sub(re.escape(term), th, out, flags=re.IGNORECASE)
    out = _hm_norm(out)
    # Only return if we actually localised something (no Latin left, or it
    # changed meaningfully). If English remains, treat as a partial: keep it
    # only when most letters were translated away.
    if out and not re.search(r'[A-Za-z]', out):
        return out
    return out if out != src and len(re.findall(r'[A-Za-z]', out)) < len(re.findall(r'[A-Za-z]', src)) / 2 else ''


_rx_note_lock = threading.Lock()

def save_rx_note(code, th, en='', auto=True):
    """Write a note for `code` into medication-db.json as a "Patient Instruction".
    Returns True if the code exists in the DB.
    auto=True  (default) — marks entry _auto:true so future auto-translates replace it.
    auto=False            — marks entry as curated; auto-translate will not overwrite it."""
    global _extralabel_idx
    code = _hm_norm(code)
    with _rx_note_lock:
        db = load_rx('medication-db')
        if not isinstance(db, dict) or code not in db:
            return False
        entry = db[code]
        inss = entry.get('instructions')
        if not isinstance(inss, list):
            inss = []
        if auto:
            # Replace previous auto-notes; preserve manually curated ones
            inss = [i for i in inss if not (isinstance(i, dict) and i.get('_auto'))]
        else:
            # Manual save: replace ALL Patient Instructions (both auto and manual)
            inss = [i for i in inss if (i.get('type') or '') != 'Patient Instruction']
        new_ins = {'type': 'Patient Instruction', 'EN': en or th, 'TH': th}
        if auto:
            new_ins['_auto']  = True
            new_ins['autoAt'] = _now_iso()
        inss.append(new_ins)
        entry['instructions'] = inss
        entry['instructionCount'] = len(inss)
        db[code] = entry
        save_rx('medication-db', db)
        _extralabel_idx = None             # force rebuild on next read
    return True


# ── Home Medication Sheet (from ArcusAir getallorderitem API) ──
ARCUS_BASE = 'https://arcusair.bdms.co.th'
ARCUS_ORDERITEM_URL = ARCUS_BASE + '/ordermanagement/patientorder/getallorderitem'
ARCUS_ALLERGY_URL   = ARCUS_BASE + '/emr/drugalergy/getallergies'
ARCUS_VISITCOUNT_URL = ARCUS_BASE + '/ordermanagement/patientorder/searchfromvisitcount'
ARCUS_DISCHARGE_ORDERTYPE_UID = '57ce9bc44ac9670b1c439ba9'  # DISCHARGE MEDICATION


def _arcus_headers(ctx, extra=None):
    """Common ArcusAir API headers built from the captured session context."""
    h = {
        'Content-Type': 'application/json;charset=UTF-8',
        'Accept': '*/*',
        'appname': 'ARCUSAIR',
        'origin': ARCUS_BASE,
        'referer': ARCUS_BASE + '/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128',
        'incus-token': ctx.get('incusToken', ''),
        'useruid': ctx.get('loginuid', ''),
        'roleuid': ctx.get('roleuid', ''),
        'orguid': ctx.get('organisationuid', ''),
        'parentorguid': ctx.get('parentorguid', ''),
        'departmentuid': ctx.get('departmentuid') or ctx.get('logindepartmentuid', ''),
        'utcoffset': '420',
        'hasanonymouspermission': 'false',
    }
    if extra:
        h.update(extra)
    return h


def _is_transient_net_err(exc):
    """True for errors worth retrying: slow/failed TLS handshake, timeouts, resets."""
    if isinstance(exc, (socket.timeout, TimeoutError, ssl.SSLError, ConnectionError)):
        return True
    if isinstance(exc, urllib.error.URLError):
        reason = getattr(exc, 'reason', None)
        if isinstance(reason, (socket.timeout, TimeoutError, ssl.SSLError, ConnectionError)):
            return True
        # SSL handshake timeout surfaces as URLError wrapping an ssl.SSLError whose
        # text contains "handshake operation timed out" / "_ssl.c".
        if 'handshake' in str(exc).lower() or 'timed out' in str(exc).lower():
            return True
    return False


def _arcus_post_json(url, ctx, payload, retries=2):
    """POST JSON to an ArcusAir endpoint with session headers; return parsed JSON.

    Retries on transient network errors (e.g. the occasional slow TLS handshake to
    arcusair.bdms.co.th, which otherwise surfaces as
    '_ssl.c:993: The handshake operation timed out').
    """
    body = json.dumps(payload).encode('utf-8')
    last_exc = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, headers=_arcus_headers(ctx), method='POST')
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                if raw[:2] == b'\x1f\x8b':
                    import gzip
                    raw = gzip.decompress(raw)
            return json.loads(raw.decode('utf-8'))
        except Exception as exc:  # noqa: BLE001 — re-raised below if not retryable
            last_exc = exc
            if attempt < retries and _is_transient_net_err(exc):
                time.sleep(0.6 * (attempt + 1))
                continue
            raise
    raise last_exc  # pragma: no cover


def fetch_arcus_discharge_meds(ctx):
    """POST to ArcusAir getallorderitem (DISCHARGE MEDICATION). Returns JSON."""
    return _arcus_post_json(ARCUS_ORDERITEM_URL, ctx, {
        'pagesize': 200, 'pagenumber': 1,
        'patientuid': ctx.get('patientuid', ''),
        'patientvisituid': ctx.get('patientvisituid', ''),
        'ordertype': 'DISCHARGEMEDICATION',
        'ordertypeuid': ARCUS_DISCHARGE_ORDERTYPE_UID,
        'filtersearch': True, 'isactive': True, 'sortorder': '-orderdate',
    })


ARCUS_MEDRECON_URL = ARCUS_BASE + '/ordermanagement/medreconcile/getdetail'

ARCUS_APPT_URL = ARCUS_BASE + '/enterprise/appointmentschedule/getfuturebookingforpatient'

_THAI_MONTHS = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]


def _thai_datetime(iso_str):
    """ISO UTC string → Thai date+time in Buddhist Era (UTC+7)."""
    from datetime import datetime, timezone, timedelta
    try:
        dt = datetime.fromisoformat(iso_str.replace('Z', '+00:00'))
        bkk = dt.astimezone(timezone(timedelta(hours=7)))
        return (f'{bkk.day} {_THAI_MONTHS[bkk.month - 1]} {bkk.year + 543}'
                f' เวลา {bkk.strftime("%H:%M")} น.')
    except Exception:
        return iso_str


def fetch_arcus_future_appointments(ctx):
    """POST to ArcusAir getfuturebookingforpatient. Returns JSON."""
    from datetime import datetime, timezone
    now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    return _arcus_post_json(ARCUS_APPT_URL, ctx, {
        'patientuid': ctx.get('patientuid', ''),
        'futureapptstartdate': now_iso,
    })


def format_appointments_th(data):
    """Build Thai appointment summary text from getfuturebookingforpatient JSON."""
    appts = (data or {}).get('appointments') or []
    if not appts:
        return ('ไม่มีนัดติดตามอาการ '
                'แต่ถ้าพบอาการผิดปรกติหรืออาการแย่ลง '
                'แนะนำให้กลับมาพบแพทย์เพื่อตรวจเพิ่มเติม')
    lines = []
    for a in appts:
        # service = _hm_norm((a.get('servicetypeuid') or {}).get('valuedescription') or '')
        start   = _thai_datetime(a.get('start') or '')
        dept    = _hm_norm(a.get('departmentname') or '')
        provider = _hm_norm(a.get('careprovidername') or '')
        comments = _hm_norm(a.get('comments') or '')
        # Tab separates line-1 (date/time) from line-2 (dept/provider/notes)
        # so the client can render two rows per appointment card.
        line1 = f'คนไข้มีนัดหมาย วันที่ {start}'
        line2 = f'ที่แผนก {dept} กับ {provider}'
        if comments:
            line2 += f' หมายเหตุ {comments}'
        lines.append(f'{line1}\t{line2}')
    return '\n'.join(lines)


def fetch_arcus_medreconcile(ctx):
    """POST to ArcusAir medreconcile/getdetail. Needs ctx.medreconcileuid
    (captured when the pharmacist opened the Med Reconcile screen). Returns JSON.
    Best-effort — caller swallows errors when the uid is absent."""
    mu = ctx.get('medreconcileuid')
    if not mu:
        return None
    return _arcus_post_json(ARCUS_MEDRECON_URL, ctx, {'medreconcileuid': mu})


def build_reconcile_meds(data):
    """Map medreconcile/getdetail JSON → [{drug, code, status, instruction,
    frequency, route, note}]. These are the patient's pre-admission / home meds
    with the doctor's reconcile decision (CONTINUE/STOP/HOLD/CHANGE...)."""
    items = ((data or {}).get('medreconcile') or {}).get('medicationitems') or []
    out = []
    for it in items:
        # orderitemname is the visible (often free-text) home-med name; the
        # orderitemuid.name is a generic placeholder ("Non Hospital Formulary Item").
        name = _hm_norm(it.get('orderitemname') or '')
        if not name:
            name = _hm_norm((it.get('orderitemuid') or {}).get('name') or '')
        if not name:
            continue
        oi = it.get('orderitemuid') or {}
        code = _hm_norm(oi.get('code') or '')
        freq = _hm_norm((it.get('frequencyuid') or {}).get('locallangdesc')
                        or (it.get('frequencyuid') or {}).get('name') or '')
        route = _hm_norm((it.get('routeuid') or {}).get('valuedescription') or '')
        comments = _hm_norm(it.get('comments') or '')
        recon = _hm_norm(it.get('reconcilestatus') or '')
        out.append({
            'drug': name, 'code': code,
            'status': recon, 'instruction': comments,
            'frequency': freq, 'route': route, 'note': comments,
        })
    return out


_RECON_STATUS_MAP = {
    'CONTINUE': 'continued', 'CONTINUED': 'continued',
    'STOP': 'stopped', 'STOPPED': 'stopped', 'DISCONTINUE': 'stopped',
    'HOLD': 'changed', 'CHANGE': 'changed', 'CHANGED': 'changed', 'MODIFY': 'changed',
    'NEW': 'new', 'START': 'new',
}


def fetch_arcus_allergies(ctx):
    """POST to ArcusAir getallergies. Returns JSON. Best-effort (allergy is
    supplementary — caller swallows errors)."""
    return _arcus_post_json(ARCUS_ALLERGY_URL, ctx, {
        'departmentuid': ctx.get('departmentuid') or ctx.get('logindepartmentuid', ''),
        'patientuid': ctx.get('patientuid', ''),
        'patientvisituid': ctx.get('patientvisituid', ''),
        'isdrugallergydoc': True,
    })


def _allergen_label(a):
    """Allergen display name from a drug/food/other allergy entry.
    Real shape: resultitemuid.name (e.g. 'นมวัว (cow milk)'). Falls back to
    other observed shapes for robustness."""
    if not isinstance(a, dict):
        return _hm_norm(str(a))
    # Primary (confirmed) shape: resultitemuid: {name}
    obj = _arc_first(a.get('resultitemuid'))
    if isinstance(obj, dict) and (obj.get('name') or obj.get('valuedescription')):
        return _hm_norm(obj.get('name') or obj.get('valuedescription'))
    # Fallbacks for other possible drug-allergy shapes.
    for key in ('allergenname', 'name', 'allergen', 'drugname', 'itemname'):
        v = a.get(key)
        if isinstance(v, str) and v.strip():
            return _hm_norm(v)
    for key in ('allergenuid', 'tradenameuid', 'genericuid', 'druggroupuid',
                'drugallergenuid', 'itemuid', 'foodallergenuid'):
        obj = _arc_first(a.get(key))
        if isinstance(obj, dict):
            nm = obj.get('name') or obj.get('valuedescription')
            if nm:
                return _hm_norm(nm)
    return ''


def _reaction_label(a):
    """Reaction / side effects for an allergy entry. Real shape: `sideeffects`
    (string), with `comments` as a secondary note."""
    if not isinstance(a, dict):
        return ''
    se = a.get('sideeffects')
    if isinstance(se, str) and se.strip():
        return _hm_norm(se)
    for key in ('reaction', 'symptoms', 'manifestation', 'remark', 'comments'):
        v = a.get(key)
        if isinstance(v, str) and v.strip():
            return _hm_norm(v)
    obj = _arc_first(a.get('reactionuid'))
    if isinstance(obj, dict) and (obj.get('valuedescription') or obj.get('name')):
        return _hm_norm(obj.get('valuedescription') or obj.get('name'))
    return ''


def _allergy_active(a):
    """Skip inactive / closed allergy entries."""
    if not isinstance(a, dict):
        return True
    if a.get('isactive') is False:
        return False
    if a.get('closuredate'):   # non-null closure date → resolved
        return False
    return True


def build_allergies_from_arcus(data):
    """Map getallergies JSON → {nkda, items:[{type, allergen, reaction}], hasRecord}.

    The response holds MULTIPLE allergy records (one may be NKDA, another may
    carry real allergies) — merge across ALL of them. NKDA is true only when no
    active allergy exists anywhere AND a record flags noknowndrugallergies.
    """
    records = (data or {}).get('allergy') or (data or {}).get('allergies') or []
    if isinstance(records, dict):
        records = [records]

    items = []
    any_nkda_flag = False
    has_record = False
    for rec in records:
        if not isinstance(rec, dict):
            continue
        has_record = True
        if rec.get('noknowndrugallergies'):
            any_nkda_flag = True
        for arr, typ in ((rec.get('drugallergies') or [], 'drug'),
                         (rec.get('foodallergies') or [], 'food'),
                         (rec.get('otherallergies') or [], 'other')):
            for a in arr:
                if not _allergy_active(a):
                    continue
                allergen = _allergen_label(a)
                if not allergen:
                    continue
                items.append({
                    'type': typ,
                    'allergen': allergen,
                    'reaction': _reaction_label(a),
                })

    # Dedupe identical allergen entries (same allergen can appear in >1 record).
    seen = set()
    deduped = []
    for it in items:
        k = (it['type'], it['allergen'].lower())
        if k in seen:
            continue
        seen.add(k)
        deduped.append(it)

    nkda = any_nkda_flag and not deduped
    return {'nkda': nkda, 'items': deduped, 'hasRecord': has_record}


def _arc_first(v):
    """ArcusAir wraps many fields in single-element arrays; unwrap safely."""
    if isinstance(v, list):
        return v[0] if v else None
    return v


def _arcus_patient_header(it):
    """Patient header dict from an order item's patientuid block."""
    p = _arc_first(it.get('patientuid')) or {}
    ln = _hm_norm((p.get('localnametitleuid') or {}).get('valuedescription') or '')
    return {
        'patientName': _hm_norm(' '.join(x for x in [
            ln, p.get('localfirstname') or '', p.get('locallastname') or ''] if x)),
        'hn': _hm_norm(p.get('mrn') or ''),
        'an': _hm_norm(it.get('ordernumber') or ''),
        'room': _hm_norm((_arc_first(it.get('beduid')) or {}).get('name') or ''),
    }


def _clean_instruction_note(s):
    """Drop ArcusAir cryptic instruction codes from a patient note. Single-letter
    codes like "D"/"X" carry no patient meaning; a leading one-letter code before
    a parenthetical ("X ( antihyperlipidemia )") is stripped to its useful tail."""
    s = _hm_norm(s)
    if not s:
        return ''
    if re.fullmatch(r'[A-Za-z]', s):          # bare one-letter code, e.g. "D"
        return ''
    s = re.sub(r'^[A-Za-z]\s+(?=[(\[])', '', s)   # "X ( ... )" → "( ... )"
    return _hm_norm(s)


def _arcus_item_to_med(it):
    """Map one getallorderitem entry → a med dict (or None). Also attaches the
    order-type label/code and key dates so callers can place it on a timeline."""
    poi = it.get('patientorderitems') or {}
    name = _hm_norm(poi.get('orderitemname') or '')
    if not name:
        name = _hm_norm((_arc_first(poi.get('orderitemuid')) or {}).get('name') or '')
    if not name:
        return None

    code = _hm_norm(poi.get('chargecode') or '')
    if not code:
        code = _hm_norm((_arc_first(poi.get('orderitemuid')) or {}).get('code') or '')

    verb = _hm_norm((_arc_first(poi.get('instructionuid')) or {}).get('valuedescription') or '')
    dosage = poi.get('dosage')
    dose_unit = _hm_norm((_arc_first(poi.get('dosageUOM')) or {}).get('valuedescription') or '')
    route = _hm_norm((_arc_first(poi.get('routeuid')) or {}).get('valuedescription') or '')
    freq_uid = _arc_first(poi.get('frequencyuid')) or {}
    freq = _hm_norm(freq_uid.get('name') or '')
    freq_code = _hm_norm(freq_uid.get('code') or '')
    # Authoritative Thai frequency phrase from the BKN frequency master, used by
    # the client only as a fallback when its offline engine doesn't recognise the
    # frequency (covers custom/odd frequencies without a Google Translate call).
    _freq_idx = _load_freq_th_index()
    freq_th = _freq_idx.get(_freq_key(freq)) or _freq_idx.get(_freq_key(freq_code)) or ''
    # If instructionuid.valuedescription already contains Thai/Lao text it is a
    # pre-written complete instruction (e.g. "รับประทาน ครึ่ง เม็ด วันละ 1 ครั้ง…").
    # Use it as-is; do NOT append the separate dosage/freq fields or the result
    # becomes a mixed Thai+English string that confuses the pattern engine.
    if verb and re.search(r'[฀-๿຀-໿]', verb):
        instruction = verb
    else:
        instr_parts = []
        if verb:
            instr_parts.append(verb)
        if dosage:
            instr_parts.append(str(dosage) + (' ' + dose_unit if dose_unit else ''))
        if freq:
            instr_parts.append(freq)
        # Route is intentionally excluded — "How to take" shows verb + dose + freq only.
        # The client's offline pattern engine localises the line to Thai on first load.
        instruction = ' '.join(instr_parts).strip()

    qty_n = poi.get('quantity')
    qty_unit = _hm_norm((_arc_first(poi.get('quantityUOM')) or {}).get('valuedescription') or '')
    quantity = (str(qty_n) + (' ' + qty_unit if qty_unit else '')) if qty_n is not None else ''

    # Free-text patient instructions from the order — keep the first usable one.
    # ArcusAir can emit multiple entries for one order; only the patient-facing
    # ones carry valuecode INSTYP1 (others, e.g. INDIC, are clinician indications
    # like the eGFR dosing note and must not reach the patient sheet). Cryptic
    # one-letter codes ("D", "X") are dropped too.
    live_note_parts = [
        _clean_instruction_note(ins.get('instructiontext'))
        for ins in (poi.get('instructions') or [])
        if (ins.get('valuecode') or 'INSTYP1') == 'INSTYP1'
    ]
    live_note = next((p for p in live_note_parts if p), '')

    # Note-line: the curated "Patient Instruction" extra label by item code.
    # localLanguage = Thai (default), text = English; build both so the client
    # can swap with the language dropdown. The live order free-text is appended
    # to each (de-duplicated) so doctor notes aren't lost.
    extra = _load_extralabel_index().get(code) if code else None
    extra = extra or {}
    extra_th = extra.get('localLanguage') or ''
    extra_en = extra.get('text') or ''

    # For the Thai note, translate the live English instruction offline so the
    # note-line isn't a mix of curated Thai + raw English.
    live_note_th = _translate_note(live_note)
    # Self-heal: if this code had no curated Thai and we just translated its live
    # note to real Thai, persist it into medication-db.json so future fetches
    # serve it as curated (and other patients benefit).
    if code and live_note and live_note_th and not extra_th \
            and not re.search(r'[A-Za-z]', live_note_th):
        try:
            save_rx_note(code, live_note_th, live_note)
        except Exception as e:
            print(f'[note-persist] {code}: {e}', file=sys.stderr)
    live_note_th = live_note_th or live_note

    def _with_live(base, live):
        _n = lambda s: ' '.join((s or '').split())
        # Strip punctuation/spaces for semantic Thai comparison so a single
        # comma-space difference doesn't cause the same note to appear twice
        # (e.g. medication-db has ",ห้าม" while note-glossary has ", ห้าม").
        _core = lambda s: re.sub(r'[^฀-๿\d]', '', s)
        if not live or _n(live) == _n(base) or _n(live) in _n(base):
            return base
        lc, bc = _core(live), _core(base)
        if lc and bc and (lc == bc or lc in bc or bc in lc):
            return base  # same Thai content, curated base wins
        return (base + ' ' + live).strip() if base else live

    note   = _with_live(extra_th, live_note_th)   # Thai note (default)
    note_en = _with_live(extra_en, live_note)     # English note
    # If a language has no label at all, fall back to the other so the line
    # isn't blank.
    if not note:
        note = note_en
    if not note_en:
        note_en = note

    provider = _hm_norm((_arc_first(poi.get('careprovideruid')) or {}).get('name') or '')
    if not provider:
        provider = _hm_norm((_arc_first(it.get('careprovideruid')) or {}).get('name') or '')

    _ot = _arc_first(it.get('ordertypeuid')) or {}
    ordertype = _hm_norm(_ot.get('valuedescription') or '')
    ordertypecode = _hm_norm(_ot.get('valuecode') or '')
    status = _hm_norm((_arc_first(poi.get('statusuid')) or {}).get('valuedescription') or '')
    # Order category ("Medicine" vs supplies/services/food). Two sources seen:
    # item-level ordercattype = "MEDICINE", and orderitemuid.ordercatuid.name.
    ordercat = _hm_norm(it.get('ordercattype') or '')
    if not ordercat:
        ordercat = _hm_norm((_arc_first(poi.get('orderitemuid')) or {}).get('ordercatuid', {})
                            .get('name') if isinstance((_arc_first(poi.get('orderitemuid')) or {}).get('ordercatuid'), dict) else '')

    return {
        'drug': name, 'code': code, 'quantity': quantity,
        'comment': instruction, 'note': note, 'noteEn': note_en,
        'route': route, 'frequency': freq, 'frequencyTh': freq_th, 'dosage': str(dosage or ''),
        'provider': provider,
        'oral': bool(re.search(r'oral|\btake\b|รับประทาน', route + ' ' + verb, re.I)),
        'ordertype': ordertype, 'ordertypecode': ordertypecode, 'status': status, 'ordercat': ordercat,
        'orderdate': it.get('orderdate') or poi.get('startdate') or '',
        'startdate': poi.get('startdate') or '',
    }


def _is_medicine(med):
    """True if an order item is an actual medicine (drop supplies/services/food/
    labs). Primary signal: item code starts with '51' (BKN medicine prefix).
    Secondary: order category contains 'MEDICINE'. Non-formulary home meds
    (code 011001) are handled separately via the reconcile path."""
    code = (med.get('code') or '').strip()
    if code.startswith('51'):
        return True
    cat = (med.get('ordercat') or '').upper()
    if 'MEDICINE' in cat:
        return True
    return False


def _log_home_med_fetch(ctx, raw, result):
    """Append a record of one Home Medication Sheet fetch — the ArcusAir API
    response summary and the meds we built from it — to data/logs so we can see
    exactly what data the sheet received. Best-effort; never breaks the request."""
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now()
        order_items = (raw or {}).get('orderitems') or []
        meds = (result or {}).get('meds') or []
        record = {
            'at': ts.isoformat(),
            'patientuid': ctx.get('patientuid', ''),
            'patientvisituid': ctx.get('patientvisituid', ''),
            'rawKeys': sorted((raw or {}).keys()) if isinstance(raw, dict) else None,
            'rawOrderItemCount': len(order_items),
            'builtMedCount': len(meds),
            'patient': (result or {}).get('patient'),
            'meds': meds,
        }
        # One file per day, JSON Lines (one record per line) for easy tailing.
        log_path = LOGS_DIR / f'home-med-fetch-{ts:%Y-%m-%d}.jsonl'
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(json.dumps(record, ensure_ascii=False) + '\n')
        # Also surface a one-line summary on the dashboard's request stream.
        _record_request('LOG', f'home-med {len(meds)} meds → {log_path.name}', 'ok')
    except Exception as e:
        print(f'[home-med-log] failed: {e}', file=sys.stderr)


def _normalize_orderitems(raw):
    """Single normalisation pass over a getallorderitem payload →
    {patient, items}. Maps each order item via _arcus_item_to_med, then drops
    non-medicine items (activities/nursing/diet/supplies — ArcusAir returns
    OTHERS even with a medication filter) and cancelled orders. Both the Home
    Medication Sheet and the Medication Journey build their views from this one
    consistent list instead of each re-parsing the raw payload, so the two
    reports can never disagree about what an order is."""
    out = []
    patient = {}
    for it in (raw or {}).get('orderitems') or []:
        med = _arcus_item_to_med(it)
        if not med:
            continue
        if not patient:
            patient = _arcus_patient_header(it)
        if not _is_medicine(med):
            continue
        # Cancelled orders never reach a report — ArcusAir can return both a
        # cancelled order and its dispensed replacement for the same drug.
        if re.search(r'cancel', med.get('status') or '', re.I):
            continue
        out.append(med)
    return {'patient': patient, 'items': out}


def build_home_med_from_arcus(data):
    """ArcusAir getallorderitem JSON → home-med rows: {patient, meds, allMeds}.
    A filtered view of the shared normalised order list (all items here are
    discharge meds — the home-med fetch already filters by ordertype)."""
    norm = _normalize_orderitems(data)
    meds = []
    seen_codes = {}   # (drug,code) → index in meds; later dispensed replaces earlier cancelled
    for med in norm['items']:
        code = med.get('code') or ''
        name = med.get('drug') or ''
        # Drop the timeline-only fields for the home-med sheet shape.
        for k in ('ordertype', 'ordertypecode', 'status', 'ordercat', 'orderdate', 'startdate'):
            med.pop(k, None)
        # De-dupe by (drug, code), NOT code alone: non-formulary items all share
        # the generic code "011001", so de-duping by code would silently drop
        # every non-formulary drug after the first (e.g. carvedilol vanishing
        # because sildenafil already claimed 011001). The first occurrence is the
        # newest (ArcusAir sorts -orderdate); a later same-(drug,code) order is a
        # superseded duplicate and is skipped.
        dedup_key = (name.strip().lower(), code)
        if code and dedup_key in seen_codes:
            pass
        else:
            if code:
                seen_codes[dedup_key] = len(meds)
            meds.append(med)
    return {'patient': norm['patient'], 'meds': meds, 'allMeds': len(meds)}


def fetch_arcus_all_orders(ctx):
    """Fetch ALL order items (no ordertype filter) for the medication journey."""
    return _arcus_post_json(ARCUS_ORDERITEM_URL, ctx, {
        'pagesize': 500, 'pagenumber': 1,
        'patientuid': ctx.get('patientuid', ''),
        'patientvisituid': ctx.get('patientvisituid', ''),
        'isactive': True, 'sortorder': '-orderdate',
    })


def fetch_arcus_visit_history(ctx, visitcount=10):
    """POST searchfromvisitcount — MEDICINE orders across the patient's last N
    visits. Used to fill the journey's 'Before / Admission' column with the most
    recent prior medicines. Returns JSON (or {} on failure)."""
    try:
        return _arcus_post_json(ARCUS_VISITCOUNT_URL, ctx, {
            'patientuid': ctx.get('patientuid', ''),
            'ordercattype': ['MEDICINE'],
            'visitcount': int(visitcount),
        })
    except Exception as e:
        print(f'[visit-history] fetch failed: {e}', file=sys.stderr)
        return {}


def build_prev_meds_from_visits(data, current_visit_uid=''):
    """From searchfromvisitcount JSON → {drug_key: {drug, code, info, freqTh}}
    holding the MOST RECENT prior order per distinct drug (excluding the current
    visit). `info` is the English dose+frequency line (verb / dosage / route /
    frequency name) so the client localises it to Thai the same way as the ward/
    home columns; `freqTh` is the authoritative Thai frequency fallback.
    Shape note: items are patientorders[].patientorderitems[] (a flat list)."""
    freq_idx = _load_freq_th_index()
    prev = {}            # key -> {drug, code, info, freqTh, _when}
    for po in ((data or {}).get('patientorders') or []):
        vuid = po.get('patientvisituid') or ''
        if current_visit_uid and vuid == current_visit_uid:
            continue                      # skip the current visit
        for poi in (po.get('patientorderitems') or []):
            if (poi.get('ordercattype') or '').upper() != 'MEDICINE':
                continue
            name = _hm_norm(poi.get('orderitemname') or '')
            if not name:
                continue
            code = _hm_norm(poi.get('chargecode') or '')
            if not _is_medicine({'code': code}):   # drop supplies/labs (keep 51-prefix)
                continue
            when = poi.get('startdate') or poi.get('enddate') or ''   # recency key
            key = (name.lower(), code)

            # Build the instruction line the same shape as _arcus_item_to_med:
            #   <verb> <dosage unit> <route> <frequency name>
            verb = _hm_norm((_arc_first(poi.get('instructionuid')) or {}).get('valuedescription') or '')
            dosage = poi.get('dosage')
            dose_unit = _hm_norm((_arc_first(poi.get('dosageUOM')) or {}).get('valuedescription') or '')
            route = _hm_norm((_arc_first(poi.get('routeuid')) or {}).get('valuedescription') or '')
            fq = _arc_first(poi.get('frequencyuid')) or {}
            freq = _hm_norm(fq.get('name') or '')
            freq_code = _hm_norm(fq.get('code') or '')
            freq_th = freq_idx.get(_freq_key(freq)) or freq_idx.get(_freq_key(freq_code)) or ''
            parts = []
            if verb: parts.append(verb)
            if dosage: parts.append(str(dosage) + (' ' + dose_unit if dose_unit else ''))
            if route: parts.append(route)
            if freq: parts.append(freq)
            info = ' '.join(parts).strip() or freq or '—'

            cur = prev.get(key)
            if cur is None or (when and when > cur.get('_when', '')):
                prev[key] = {'drug': name, 'code': code, 'info': info,
                             'freqTh': freq_th, '_when': when}
    return prev


# ArcusAir order-type → journey phase, keyed on the STABLE valuecode (not the
# free-text label, which could be localised/reworded). Confirmed from live data:
#   ORDTYP3 = DISCHARGE MEDICATION → home
#   ORDTYP2 = CONTINUOUS ORDER (inpatient) → ward
#   ORDTYP1 = one-day/STAT inpatient order → ward
# Edit this map if ArcusAir adds order types; the label substring check below is
# only a last-resort fallback for unknown/blank codes.
ORDERTYPE_PHASE_BY_CODE = {
    'ORDTYP3': 'home',
    'ORDTYP2': 'ward',
    'ORDTYP1': 'ward',
}

def _journey_phase(ordertype, ordertypecode=''):
    """Map an order to a journey phase column.
    admission = home/OPD meds (pre-admission) · ward = inpatient · home = discharge.
    Prefers the stable ordertype valuecode; falls back to label substrings."""
    code = (ordertypecode or '').upper()
    if code in ORDERTYPE_PHASE_BY_CODE:
        return ORDERTYPE_PHASE_BY_CODE[code]
    t = (ordertype or '').upper()
    if 'DISCHARGE' in t:
        return 'home'
    if 'HOME' in t or 'OPD' in t:
        return 'admission'
    return 'ward'


def build_med_journey_from_arcus(data, reconcile_meds=None, prev_meds=None):
    """Group all orders by drug into a continuity timeline.
    Returns {patient, rows:[{drug, code, admission, ward, home, status, note}]}.

    Admission column = "Before / Admission". Filled (in priority order) by:
      1. prev_meds — most recent prior order per drug from searchfromvisitcount
         (last 10 visits), tagged "(last visit)" — PRIMARY.
      2. reconcile_meds — pre-admission home meds from medreconcile/getdetail,
         which also carry an authoritative reconcilestatus.
    status stays editable.
    """
    norm = _normalize_orderitems(data)
    patient = norm['patient']
    by_drug = {}
    order_seen = []

    def _row_for(drug, code):
        key = (drug.lower(), code or '')
        row = by_drug.get(key)
        if not row:
            row = {
                'drug': drug, 'code': code or '',
                'admission': '', 'ward': '', 'home': '',
                'status': '', 'note': '', 'provider': '',
                '_phases': set(), '_recon': '',
            }
            by_drug[key] = row
            order_seen.append(key)
        return row

    # 1) Visit-history (last 10 visits) → admission column. PRIMARY source.
    #    `info` is the English dose+frequency line; the client localises it to
    #    Thai like the ward/home columns. freqTh gives the authoritative Thai
    #    frequency via data-freq-th. The "(ครั้งก่อน)" tag stays Thai so it isn't
    #    mangled by translation.
    for pm in (prev_meds or {}).values():
        row = _row_for(pm['drug'], pm.get('code'))
        info = pm.get('info') or '—'
        row['admission'] = info
        row['admissionFreqTh'] = pm.get('freqTh') or ''
        row['admissionTag'] = '(ครั้งก่อน)'
        row['_phases'].add('admission')

    # 2) Reconcile (pre-admission home) meds → fill admission gaps + status.
    for rm in (reconcile_meds or []):
        if not rm.get('drug'):
            continue
        row = _row_for(rm['drug'], rm.get('code'))
        if not row['admission']:
            row['admission'] = rm.get('instruction') or rm.get('frequency') or rm.get('route') or '—'
        row['_phases'].add('admission')
        row['_recon'] = _RECON_STATUS_MAP.get((rm.get('status') or '').upper(), '')
        if rm.get('note') and not row['note']:
            row['note'] = rm['note']

    # 2) Inpatient/discharge orders → ward/home columns. Medicines only
    #    (drop supplies/services/food/labs — code prefix 51 / cat Medicine).
    #    Track the earliest/latest order dates → admission / discharge endpoints
    #    for the bottom drug-timeline (phase-based bars labelled with real dates).
    # Known medicine codes from the BKN medication DB — used to weed supply /
    # non-drug items (NSS bags, alcohol swabs, soap, sterile water…) out of the
    # ward column. Loaded once per build.
    _meddb = load_rx('medication-db')
    _med_codes = set(_meddb.keys()) if isinstance(_meddb, dict) else set()
    order_dates = []
    for med in norm['items']:
        _ot_code = med.get('ordertypecode')
        _is_discharge = _journey_phase(med.get('ordertype'), _ot_code) == 'home'
        _instr = (med.get('comment') or '').strip()
        # Intra-operative meds (Propofol/Fentanyl/Esmeron/Bridion…) are never
        # part of the patient's medication journey — exclude unconditionally,
        # regardless of order type or code (including 51-prefix).
        if re.search(r'intra-?\s*op', _instr, re.I):
            continue
        # Ward items with no real usage instruction (empty/null or "-") are also
        # dropped; discharge meds are kept regardless (safety net).
        if not _is_discharge and (not _instr or _instr == '-'):
            continue
        # Drop ward-only items whose code isn't in the BKN medication DB. The
        # 51-prefix (BKN medicine codes) is always kept regardless, so a real
        # ward drug missing from the DB is never dropped; this rule therefore
        # only removes ward-only NON-51 items not found in the DB. Discharge meds
        # are always kept — non-formulary 011001 take-home meds aren't in the DB
        # but must stay.
        _code = med.get('code') or ''
        if (not _is_discharge and _code and _med_codes
                and not _code.startswith('51') and _code not in _med_codes):
            continue
        d = (med.get('orderdate') or med.get('startdate') or '').strip()
        if d:
            order_dates.append(d)
        phase = _journey_phase(med.get('ordertype'), med.get('ordertypecode'))
        row = _row_for(med['drug'], med.get('code'))
        cell = med.get('comment') or med.get('route') or ''
        if cell and not row[phase]:
            row[phase] = cell
        row['_phases'].add(phase)
        if med.get('note') and not row['note']:
            row['note'] = med['note']
        if med.get('provider') and not row['provider']:
            row['provider'] = med['provider']

    if not patient and reconcile_meds:
        patient = {}  # header comes from orders; reconcile getdetail lacks it

    rows = []
    for key in order_seen:
        row = by_drug[key]
        phases = row.pop('_phases')
        recon = row.pop('_recon')
        if recon:
            row['status'] = recon          # authoritative from med reconciliation
        elif 'home' in phases:
            row['status'] = 'continued' if (phases & {'admission', 'ward'}) else 'new'
        elif phases:
            row['status'] = 'stopped'
        # Phase presence flags — let the client draw the timeline bar without
        # re-deriving "is this phase filled?" from the localised cell text.
        row['phases'] = {
            'admission': 'admission' in phases,
            'ward': 'ward' in phases,
            'home': 'home' in phases,
        }
        rows.append(row)

    # ISO order dates sort lexicographically; admission = earliest, discharge =
    # latest. Both may be empty if the API omitted dates (client falls back).
    order_dates = sorted(d for d in order_dates if d)
    dates = {
        'admission': order_dates[0] if order_dates else '',
        'discharge': order_dates[-1] if order_dates else '',
    }

    return {'patient': patient, 'rows': rows, 'allRows': len(rows), 'dates': dates}


# ── KPI helpers (per-day files) ────────────────────────────────
def kpi_file(date_key):
    return KPI_DIR / f'{date_key}.json'

def _now_iso():
    return datetime.now(timezone.utc).isoformat()

# Per-path write locks serialize concurrent writers to the same file within
# this process (ThreadingHTTPServer runs each request in its own thread, so two
# PUTs for the same patient would otherwise race in os.replace).
_write_locks_guard = threading.Lock()
_write_locks = {}

def _lock_for(path_str):
    with _write_locks_guard:
        lock = _write_locks.get(path_str)
        if lock is None:
            lock = threading.Lock()
            _write_locks[path_str] = lock
        return lock

def _atomic_write_text(path, text, encoding='utf-8'):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    target = str(p)
    # Serialize same-process writers to this exact file.
    with _lock_for(target):
        fd, tmp_name = tempfile.mkstemp(prefix=f'.{p.name}.', suffix='.tmp', dir=str(p.parent))
        try:
            with os.fdopen(fd, 'w', encoding=encoding) as f:
                f.write(text)
            # os.replace can transiently fail with WinError 5 (Access denied) on
            # SMB shares when the destination is briefly locked by another
            # process (a concurrent reader, antivirus, or indexer). Retry with
            # backoff before giving up.
            last_err = None
            for attempt in range(8):
                try:
                    os.replace(tmp_name, target)
                    last_err = None
                    break
                except PermissionError as e:
                    last_err = e
                    time.sleep(0.05 * (attempt + 1))
            if last_err is not None:
                raise last_err
        except Exception:
            try:
                os.unlink(tmp_name)
            except OSError:
                pass
            raise

def _atomic_write_json(path, data):
    _atomic_write_text(path, json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

def _safe_filename(name):
    if not name or '\x00' in name or '/' in name or '\\' in name:
        return None
    if name.startswith('.') or Path(name).name != name:
        return None
    return name

def _path_within(base, target):
    base = Path(base).resolve()
    target = Path(target).resolve()
    try:
        target.relative_to(base)
        return True
    except ValueError:
        return False

def _empty_day(date_key):
    ts = _now_iso()
    return {
        'date': date_key, 'createdAt': ts, 'updatedAt': ts,
        'opdBrief': None, 'ipdBrief': None,
        'opdStat': None,  'ipdStat': None,
        'medErrors': [],
    }

def load_kpi_day(date_key):
    p = kpi_file(date_key)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return None

def load_or_create_day(date_key):
    doc = load_kpi_day(date_key)
    if doc is None:
        doc = _empty_day(date_key)
    if not isinstance(doc.get('medErrors'), list):
        doc['medErrors'] = []
    return doc

def save_kpi_day(date_key, data):
    data['updatedAt'] = _now_iso()
    _atomic_write_json(kpi_file(date_key), data)

def load_all_kpi():
    days = []
    for p in sorted(KPI_DIR.glob('????-??-??.json'), reverse=True):
        try:
            days.append(json.loads(p.read_text(encoding='utf-8')))
        except Exception:
            pass
    return days


# ── KS helpers (single file per collection) ───────────────────
def ks_file(col):
    return KS_DIR / f'{col}.json'

def load_ks(col):
    p = ks_file(col)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return []

def save_ks(col, data):
    _atomic_write_json(ks_file(col), data)


# ── RX helpers (pharmacy master data) ────────────────────────
def rx_file(col):
    return RX_DIR / f'{col}.json'

def load_rx(col):
    p = rx_file(col)
    if not p.exists():
        return {} if col in RX_DICT_COLS else []
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return {} if col in RX_DICT_COLS else []

def save_rx(col, data):
    _atomic_write_json(rx_file(col), data)


# ── Schedule helpers ──────────────────────────────────────────
def schedule_file(name):
    return SCHEDULE_DIR / f'{name}.json'

def load_schedule(name):
    p = schedule_file(name)
    if not p.exists():
        if name.startswith('state-'):
            legacy = schedule_file('state')
            if legacy.exists():
                try:
                    doc = json.loads(legacy.read_text(encoding='utf-8'))
                    if isinstance(doc, dict) and doc.get('month') == name[6:]:
                        return doc
                except Exception:
                    pass
        return None
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return None

def save_schedule(name, data):
    _atomic_write_json(schedule_file(name), data)
    if name.startswith('state-') and isinstance(data, dict):
        shared = load_schedule('state') or {}
        if not isinstance(shared, dict):
            shared = {}
        for key in ('staff', 'shiftTemplates', 'bookingRules'):
            if key in data:
                shared[key] = data[key]
        shared['lastMonthSaved'] = name[6:]
        shared['updatedAt'] = _now_iso()
        _atomic_write_json(schedule_file('state'), shared)


# ── Patient profile helpers (cross-feature data sharing) ─────────────
# One JSON file per patientuid under data/patients/{uid}.json
# Shape: {
#   patientuid, updatedAt,
#   context: { hn, patientName, bed, dept, doctor, ... },
#   adrTimeline: { customEvents, customMedications, adrEvents },
#   medicationCache: { "<patientvisituid>": { fetchedAt, orders, adminTimes } }
# }
_PUID_RE = re.compile(r'^[a-zA-Z0-9_-]{1,64}$')

def _safe_puid(puid):
    if not puid or not _PUID_RE.match(puid):
        return None
    return puid

# ── HMR helpers ────────────────────────────────────────────────
_VISITID_RE = re.compile(r'^I48-\d{2}-\d{6}$')
_HN_RE      = re.compile(r'^48-\d{2}-\d{7}$')

def _safe_visitid(vid):
    return bool(vid and _VISITID_RE.match(vid))

def hmr_file(vid):
    return HMR_DIR / f'{vid}.json'

def load_hmr(vid):
    """Load individual HMR record; falls back to scanning daily archives."""
    p = hmr_file(vid)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding='utf-8'))
        except Exception:
            pass
    # Scan daily archives newest-first
    if HMR_DIR.exists():
        for mp in sorted(HMR_DIR.glob('HM_*.json'), reverse=True):
            try:
                records = json.loads(mp.read_text(encoding='utf-8'))
                if isinstance(records, list):
                    for rec in records:
                        if rec.get('visitid') == vid:
                            return rec
            except Exception:
                pass
    return None

def load_all_hmr(from_date=None, to_date=None):
    """Return all HMR records from live files and daily archives."""
    if not HMR_DIR.exists():
        return []
    seen = {}
    # Live individual files take priority
    for p in HMR_DIR.glob('I*.json'):
        try:
            doc = json.loads(p.read_text(encoding='utf-8'))
            vid = doc.get('visitid')
            if vid:
                seen[vid] = doc
        except Exception:
            pass
    # Daily archive files fill in records no longer live
    for mp in sorted(HMR_DIR.glob('HM_*.json')):
        try:
            records = json.loads(mp.read_text(encoding='utf-8'))
            if isinstance(records, list):
                for doc in records:
                    vid = doc.get('visitid')
                    if vid and vid not in seen:
                        seen[vid] = doc
        except Exception:
            pass
    result = list(seen.values())
    if from_date or to_date:
        def _date_key(d):
            return (d.get('startedAt') or d.get('createdAt') or '')[:10]
        result = [d for d in result
                  if (not from_date or _date_key(d) >= from_date)
                  and (not to_date   or _date_key(d) <= to_date)]
    result.sort(key=lambda d: d.get('startedAt') or d.get('createdAt') or '', reverse=True)
    return result

def save_hmr(vid, doc):
    HMR_DIR.mkdir(parents=True, exist_ok=True)
    doc['updatedAt'] = _now_iso()
    _atomic_write_json(hmr_file(vid), doc)

# ── HMR nightly merge — one HM_YYYY-MM-DD.json per day, kept forever ──
def _hmr_nightly_merge():
    """Merge all live I*.json files into today's HM_YYYY-MM-DD.json, then delete live files."""
    if not HMR_DIR.exists():
        return
    today = datetime.now().strftime('%Y-%m-%d')
    live_files = list(HMR_DIR.glob('I*.json'))
    if not live_files:
        return
    # Load or create today's daily archive
    daily_path = HMR_DIR / f'HM_{today}.json'
    merged = {}
    if daily_path.exists():
        try:
            existing = json.loads(daily_path.read_text(encoding='utf-8'))
            if isinstance(existing, list):
                merged = {r.get('visitid'): r for r in existing if r.get('visitid')}
        except Exception:
            pass
    # Upsert each live record (latest wins)
    for p in live_files:
        try:
            doc = json.loads(p.read_text(encoding='utf-8'))
            vid = doc.get('visitid')
            if vid:
                merged[vid] = doc
        except Exception:
            pass
    _atomic_write_json(daily_path, list(merged.values()))
    # Remove individual live files — they are now in the daily archive
    for p in live_files:
        try:
            p.unlink()
        except Exception:
            pass

def _seconds_until_2300():
    now    = datetime.now()
    target = now.replace(hour=23, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return max(60, (target - now).total_seconds())

def _hmr_nightly_job():
    try:
        _hmr_nightly_merge()
    except Exception as e:
        print(f'[HMR] Nightly merge error: {e}', file=sys.stderr)
    threading.Timer(_seconds_until_2300(), _hmr_nightly_job).start()

def _start_hmr_scheduler():
    threading.Timer(_seconds_until_2300(), _hmr_nightly_job).start()

def patient_file(puid):
    return PATIENTS_DIR / f'{puid}.json'

def load_patient(puid):
    p = patient_file(puid)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return None

def save_patient(puid, data):
    data['updatedAt'] = _now_iso()
    data['patientuid'] = puid
    _atomic_write_json(patient_file(puid), data)

def _empty_patient(puid):
    return {
        'patientuid': puid,
        'createdAt': _now_iso(),
        'updatedAt': _now_iso(),
        'context': {},
        'adrTimeline': {
            'customEvents': [],
            'customMedications': [],
            'adrEvents': [],
        },
        'medicationCache': {},
    }

def load_or_create_patient(puid):
    doc = load_patient(puid)
    if doc is None:
        doc = _empty_patient(puid)
    # Backfill missing keys for older saved docs
    doc.setdefault('context', {})
    doc.setdefault('adrTimeline', {'customEvents': [], 'customMedications': [], 'adrEvents': []})
    doc.setdefault('medicationCache', {})
    return doc


# ── Auth helpers ───────────────────────────────────────────────
# In-memory sessions: token → {username, role}
_sessions = {}

ROLES = ('super_admin', 'admin', 'editor', 'user')

def _hash_pw(pw):
    return hashlib.sha256(pw.encode('utf-8')).hexdigest()

def _load_users():
    if not AUTH_FILE.exists():
        return {}
    try:
        return json.loads(AUTH_FILE.read_text(encoding='utf-8'))
    except Exception:
        return {}

def _save_users(users):
    _atomic_write_json(AUTH_FILE, users)

def _ensure_default_users():
    users = _load_users()
    changed = False
    if not users:
        users['admin'] = {'password_hash': _hash_pw('admin1234'), 'role': 'admin'}
        print('  Default admin created  →  username: admin  password: admin1234')
        changed = True
    if 'Makin' not in users:
        users['Makin'] = {'password_hash': _hash_pw('0128662'), 'role': 'super_admin'}
        print('  Super-admin created   →  username: Makin  password: 0128662')
        changed = True
    if changed:
        _save_users(users)

def _create_session(username, role):
    token = secrets.token_hex(32)
    _sessions[token] = {'username': username, 'role': role}
    return token


# ── Live dashboard ──────────────────────────────────────────────
_STATS_LOCK   = threading.Lock()
_req_count    = 0
_recent_reqs  = []   # (time_str, method, path, status, size, elapsed_ms, epoch)
_SERVER_START = None


def _count_files_safe(path, pattern='*'):
    try:
        return sum(1 for p in Path(path).glob(pattern) if p.is_file())
    except Exception:
        return 0


def _data_dir_writable():
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        probe = DATA_DIR / '.dashboard-write-test.tmp'
        probe.write_text('ok', encoding='utf-8')
        try:
            probe.unlink()
        except Exception:
            pass
        return True
    except Exception:
        return False


def _record_request(method, path, status, size=0, elapsed_ms=None):
    """Record one request for both terminal and desktop dashboards.
    Keeps a small in-memory rolling window only; no patient data is persisted here.
    """
    global _req_count
    ts = datetime.now().strftime('%H:%M:%S')
    try:
        elapsed_ms = int(elapsed_ms) if elapsed_ms is not None else 0
    except Exception:
        elapsed_ms = 0
    with _STATS_LOCK:
        _req_count += 1
        _recent_reqs.append((ts, str(method), str(path)[:96], str(status), int(size or 0), elapsed_ms, time.time()))
        if len(_recent_reqs) > 60:
            _recent_reqs.pop(0)


# Cache the expensive disk/JSON parts of dashboard_status. Polling clients hit
# this often; re-globbing ~2000 med images + parsing the 1.4 MB medication DB on
# every call (over an SMB share) takes ~5 s. Strategy: stale-while-revalidate —
# always return the cached snapshot immediately and refresh in a background
# thread when it gets old, so a poll never blocks on the scan.
_DASH_CACHE = {'at': 0.0, 'endpoints': None, 'modules': None, 'dataOk': False}
_DASH_TTL   = 30.0          # module counts change slowly; refresh at most every 30 s
_dash_lock  = threading.Lock()
_dash_refreshing = False

def _dashboard_scan():
    """Do the slow disk/JSON work and update the cache. Blocking — call in a
    background thread (or once at startup) so request threads never wait."""
    global _dash_refreshing
    try:
        data_ok = _data_dir_writable()
        vdos  = load_ks('vdos');  faqs = load_ks('faqs');  items = load_ks('items')
        users = _load_users();    med_db = load_rx('medication-db')
        endpoints = {
            '/api/vdos':   {'ok': isinstance(vdos, list),  'status': 200},
            '/api/faqs':   {'ok': isinstance(faqs, list),  'status': 200},
            '/api/items':  {'ok': isinstance(items, list), 'status': 200},
            '/api/users':  {'ok': isinstance(users, dict), 'status': 200},
            '/api/health': {'ok': True, 'status': 200},
        }
        modules = {
            'KPI':           _count_files_safe(KPI_DIR, '????-??-??.json'),
            'KS items':      len(items) if isinstance(items, list) else 0,
            'FAQs':          len(faqs) if isinstance(faqs, list) else 0,
            'Videos':        len(vdos) if isinstance(vdos, list) else 0,
            'Medication DB': len(med_db) if isinstance(med_db, dict) else 0,
            'Med images':    _count_files_safe(MED_IMAGES_DIR),
            'Patients':      _count_files_safe(PATIENTS_DIR, '*.json'),
            'Logs':          _count_files_safe(LOGS_DIR, '*.jsonl'),
            'HMR (live)':    _count_files_safe(HMR_DIR, 'I*.json'),
        }
        with _dash_lock:
            _DASH_CACHE.update(at=time.time(), endpoints=endpoints, modules=modules, dataOk=data_ok)
    finally:
        _dash_refreshing = False

def _dashboard_heavy():
    """Return (endpoints, modules, dataOk) from cache; never blocks once warmed.
    Triggers a background refresh when the cache is stale."""
    global _dash_refreshing
    with _dash_lock:
        have = _DASH_CACHE['endpoints'] is not None
        stale = (time.time() - _DASH_CACHE['at']) >= _DASH_TTL
        snap = (_DASH_CACHE['endpoints'], _DASH_CACHE['modules'], _DASH_CACHE['dataOk'])
        need_refresh = (not have or stale) and not _dash_refreshing
        if need_refresh:
            _dash_refreshing = True
    if need_refresh:
        if have:
            threading.Thread(target=_dashboard_scan, daemon=True).start()  # serve stale, refresh async
        else:
            _dashboard_scan()                                              # first call must populate
            with _dash_lock:
                snap = (_DASH_CACHE['endpoints'], _DASH_CACHE['modules'], _DASH_CACHE['dataOk'])
    return snap


def dashboard_status():
    """Machine-readable status for the Tk dashboard and /api/server-status.
    Live counters are fresh each call; expensive disk scans are cached (~6s).
    Uses only stdlib + local data, safe on locked-down hospital PCs."""
    now = time.time()
    with _STATS_LOCK:
        recent_raw = list(_recent_reqs)
        req_count = _req_count
    recent = []
    ok_count = 0
    err_count = 0
    elapsed_vals = []
    for row in recent_raw[-20:]:
        padded = list(row) + [0, now]
        ts, method, path, status, size, elapsed_ms, epoch = padded[:7]
        status_s = str(status)
        ok = status_s.startswith('2') or status_s == 'ok'
        ok_count += 1 if ok else 0
        err_count += 0 if ok else 1
        if elapsed_ms:
            elapsed_vals.append(int(elapsed_ms))
        recent.append({
            'time': ts, 'method': method, 'path': path, 'status': status_s,
            'size': int(size or 0), 'elapsedMs': int(elapsed_ms or 0), 'ok': ok,
        })
    last_min = [r for r in recent_raw if len(r) >= 7 and (now - r[6]) <= 60]
    avg_ms = int(sum(elapsed_vals) / len(elapsed_vals)) if elapsed_vals else 0
    endpoints, modules, data_ok = _dashboard_heavy()
    return {
        'ok': data_ok and all(v.get('ok') for v in endpoints.values()),
        'server': 'BKN KS Server',
        'url': f'http://{getattr(Handler, "_ip", "127.0.0.1")}:{getattr(Handler, "_port", DEFAULT_PORT)}',
        'uptimeSec': int(now - (_SERVER_START or now)),
        'requestCount': req_count,
        'requestsPerMin': round(len(last_min), 1),
        'avgResponseMs': avg_ms,
        'activeThreads': threading.active_count(),
        'dataWritable': data_ok,
        'endpoints': endpoints,
        'modules': modules,
        'recent': recent,
        'okCountWindow': ok_count,
        'errorCountWindow': err_count,
        'generatedAt': datetime.now().isoformat(timespec='seconds'),
    }

# ANSI colour helpers (used by the terminal status line + Ctrl+C guard)
_ESC_HIDE  = '\033[?25l'
_ESC_SHOW  = '\033[?25h'
_RST = '\033[0m'
_CY  = '\033[1;36m'   # bright cyan
_GN  = '\033[1;32m'   # bright green
_RD  = '\033[1;31m'   # bright red
_YL  = '\033[1;33m'   # bright yellow
_BL  = '\033[0;34m'   # blue
_MG  = '\033[1;35m'   # bright magenta
_WH  = '\033[1;37m'   # bright white
_GY  = '\033[38;5;245m'  # gray


def _enable_ansi():
    """Enable ANSI VT sequences in Windows 10+ cmd.exe."""
    if os.name == 'nt':
        os.system('')


def _run_dashboard(ip, port):
    """Terminal mode: print a one-line status and stay quiet. The rich animated
    dashboard now lives in the desktop GUI (maprang_app.py / start_dashboard.bat)."""
    sys.stdout.write(
        f'\n  {_WH}BKN Pharmacy Server{_RST}  ->  {_CY}http://{ip}:{port}{_RST}\n'
        f'  {_GY}Serving... desktop dashboard: run start_dashboard.bat{_RST}\n'
        f'  {_WH}Press Ctrl+C to stop the server{_RST}\n\n'
    )
    sys.stdout.flush()


# ── HTTP server ────────────────────────────────────────────────
class _QuietHTTPServer(ThreadingHTTPServer):
    """ThreadingHTTPServer that doesn't print a traceback when a client closes
    the connection mid-response (common with the dashboard poller / browsers)."""
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionAbortedError, ConnectionResetError, BrokenPipeError)):
            return  # client disconnected — ignore quietly
        super().handle_error(request, client_address)


# ── HTTP handler ───────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def handle_one_request(self):
        self._req_started = time.time()
        try:
            return super().handle_one_request()
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            # Client (dashboard poller / browser) closed the socket mid-response.
            # Harmless and common; don't spam the console with a traceback.
            self.close_connection = True

    def log_message(self, fmt, *args):
        try:
            status = args[1] if len(args) > 1 else '?'
            size = args[2] if len(args) > 2 and str(args[2]).isdigit() else 0
            elapsed = (time.time() - getattr(self, '_req_started', time.time())) * 1000
            _record_request(self.command, urllib.parse.urlsplit(self.path).path, status, size, elapsed)
        except Exception:
            pass
        # Suppress default stderr output — the dashboard shows it.

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.send_header('Access-Control-Max-Age',       '86400')

    def _is_trusted_extension(self):
        origin = self.headers.get('Origin', '')
        # Known-legacy IDs match exactly (defence in depth)
        if origin in TRUSTED_EXTENSION_ORIGINS:
            return True
        # Trust any Chrome extension origin — Chrome guarantees this header is
        # set by the browser and cannot be spoofed by web pages. New extension
        # installs (e.g. the merged BKN Pharmacy Portal) work without manual
        # allowlisting.
        if origin.startswith('chrome-extension://'):
            return True
        # Local-machine fallback (when Origin header is absent)
        client_ip = self.client_address[0]
        return client_ip in ('127.0.0.1', '::1', 'localhost')

    def _session(self):
        """Return session dict {username, role} or None."""
        h = self.headers.get('Authorization', '')
        if h.startswith('Bearer '):
            return _sessions.get(h[7:])
        return None

    def _role(self):
        s = self._session()
        return s['role'] if s else None

    def _require(self, *allowed_roles):
        """Send 401/403 and return False if caller lacks permission."""
        s = self._session()
        if not s:
            self.send_json(401, {'error': 'Authentication required'}); return False
        if s['role'] not in allowed_roles:
            self.send_json(403, {'error': 'Insufficient role'}); return False
        return True

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type',   'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0))
        return json.loads(self.rfile.read(length))

    def parse_route(self):
        """Return (route_type, date_or_col, extra).

        route_type          date_or_col     extra
        ──────────────────  ──────────────  ─────────────────────
        'kpi-all'           None            None
        'kpi-day'           date            None
        'kpi-section'       date            section key (e.g. 'opd-brief')
        'kpi-med-errors'    date            None
        'kpi-med-error-item'date            record savedAt (URL-decoded)
        'ks'                col             None
        'rx'                col             None
        'auth'              action          None  (login|logout|me)
        'users'             username|None   None
        None                None            None
        """
        raw   = urllib.parse.urlsplit(self.path).path
        parts = raw.strip('/').split('/')

        # /api/kpi
        if parts == ['api', 'kpi']:
            return 'kpi-all', None, None

        if len(parts) >= 3 and parts[0] == 'api' and parts[1] == 'kpi' and DATE_RE.match(parts[2]):
            date = parts[2]
            # /api/kpi/DATE
            if len(parts) == 3:
                return 'kpi-day', date, None
            # /api/kpi/DATE/SECTION  or  /api/kpi/DATE/med-errors  or  /api/kpi/DATE/med-errors/ID
            sub = parts[3]
            if sub in SECTION_KEYS and len(parts) == 4:
                return 'kpi-section', date, sub
            if sub == 'med-errors':
                if len(parts) == 4:
                    return 'kpi-med-errors', date, None
                if len(parts) == 5:
                    item_id = urllib.parse.unquote(parts[4])
                    return 'kpi-med-error-item', date, item_id

        # /api/COL  (ks collections)
        if len(parts) == 2 and parts[0] == 'api' and parts[1] in KS_COLS:
            return 'ks', parts[1], None

        # /api/medication-db/recheck
        if parts == ['api', 'medication-db', 'recheck']:
            return 'med-db-recheck', None, None

        # /api/COL  (rx pharmacy master data)
        if len(parts) == 2 and parts[0] == 'api' and parts[1] in RX_COLS:
            return 'rx', parts[1], None

        # /api/med-images-list
        if parts == ['api', 'med-images-list']:
            return 'med-images-list', None, None

        # /api/rx-note/:code — persist a client-translated note (TH/EN) into the
        # medication-db.json entry as a synthesized Patient Instruction.
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'rx-note':
            return 'rx-note', urllib.parse.unquote(parts[2]), None

        # /api/med-images/{code}/copy-default  — copy placeholder image to code
        if len(parts) == 4 and parts[0] == 'api' and parts[1] == 'med-images' and parts[3] == 'copy-default':
            return 'med-image-copy-default', urllib.parse.unquote(parts[2]), None

        # /api/med-images/:filename  — image upload
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'med-images':
            return 'med-image-upload', urllib.parse.unquote(parts[2]), None

        # /api/ks-files/:filename  — KS attachment upload
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'ks-files':
            return 'ks-file-upload', urllib.parse.unquote(parts[2]), None

        # /api/schedule/state, /api/schedule/state?month=YYYY-MM, or /api/schedule/bookings
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'schedule' and parts[2] in ('state', 'bookings'):
            key = parts[2]
            if key == 'state':
                qs = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                month = (qs.get('month') or [''])[0]
                if month:
                    if not MONTH_RE.match(month):
                        return None, None, None
                    key = f'state-{month}'
            return 'schedule', key, None

        # /api/report/fetch
        if parts == ['api', 'report', 'fetch']:
            return 'report-fetch', None, None

        # /api/report/home-med-api — fetch ArcusAir getallorderitem JSON directly
        if parts == ['api', 'report', 'home-med-api']:
            return 'report-home-med-api', None, None

        # /api/report/med-journey — all orders grouped into a continuity timeline
        if parts == ['api', 'report', 'med-journey']:
            return 'report-med-journey', None, None

        # /api/patients/{puid}                              -> 'patient', puid, None
        # /api/patients/{puid}/context                      -> 'patient-context', puid, None
        # /api/patients/{puid}/adr-timeline                 -> 'patient-adr', puid, None
        # /api/patients/{puid}/medication-cache/{visituid}  -> 'patient-medcache', puid, visituid
        if len(parts) >= 3 and parts[0] == 'api' and parts[1] == 'patients':
            puid = urllib.parse.unquote(parts[2])
            if not _safe_puid(puid):
                return None, None, None
            if len(parts) == 3:
                return 'patient', puid, None
            sub = parts[3]
            if sub == 'context' and len(parts) == 4:
                return 'patient-context', puid, None
            if sub == 'adr-timeline' and len(parts) == 4:
                return 'patient-adr', puid, None
            if sub == 'medication-cache' and len(parts) == 5:
                visituid = urllib.parse.unquote(parts[4])
                if not _safe_puid(visituid):
                    return None, None, None
                return 'patient-medcache', puid, visituid

        # /api/hmr               → ('hmr-list', None, None)
        # /api/hmr/{visitid}     → ('hmr', visitid, None)
        if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'hmr':
            if len(parts) == 2:
                return 'hmr-list', None, None
            vid = urllib.parse.unquote(parts[2])
            if not _safe_visitid(vid):
                return None, None, None
            return 'hmr', vid, None

        # /api/extralabel                → ('extralabel', None, None)
        # /api/extralabel/<code>         → ('extralabel', code, None)
        if len(parts) >= 2 and parts[:2] == ['api', 'extralabel']:
            code = urllib.parse.unquote(parts[2]) if len(parts) == 3 else None
            return 'extralabel', code, None

        # /api/auth/ACTION
        if len(parts) == 3 and parts[:2] == ['api', 'auth'] and parts[2] in ('login', 'logout', 'me'):
            return 'auth', parts[2], None

        # /api/users  or  /api/users/:username
        if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'users':
            uname = urllib.parse.unquote(parts[2]) if len(parts) == 3 else None
            return 'users', uname, None

        return None, None, None

    # OPTIONS (preflight)
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # GET
    def do_GET(self):
        # ── Static webapp files ────────────────────────────────
        clean = urllib.parse.urlsplit(self.path).path
        if clean in ('/dashboard', '/dashboard.html'):
            self._serve_file(WWW_DIR / 'dashboard.html', 'text/html; charset=utf-8'); return
        if clean in ('/hmr-report', '/hmr-report.html'):
            self._serve_file(WWW_DIR / 'hmr-report.html', 'text/html; charset=utf-8'); return
        if clean in ('/index', '/home'):
            # Explicit route to the legacy index.html (dashboard.html shadows it at /).
            self._serve_file(WWW_DIR / 'index.html', 'text/html; charset=utf-8'); return
        if clean in ('/', '/index.html', ''):
            # Prefer the new Pixi dashboard when present; otherwise keep legacy index.html.
            dash = WWW_DIR / 'dashboard.html'
            self._serve_file(dash if dash.exists() else (WWW_DIR / 'index.html'), 'text/html; charset=utf-8'); return
        if clean.startswith('/static/'):
            self._serve_file_under(WWW_DIR, urllib.parse.unquote(clean.lstrip('/')), None); return

        # ── Med image by code (any extension) ──────────────────
        # /med-image/:code — serve whatever file has this stem, so the client
        # need not guess the extension (covers jpg/jpeg/png/jfif/webp/gif/jxl…).
        if clean.startswith('/med-image/'):
            code = _safe_filename(urllib.parse.unquote(clean[11:]))
            if not code or '.' in code:
                self.send_json(403, {'error': 'Forbidden'}); return
            match = None
            # Fast path: probe common extensions directly (no dir scan).
            for ext in MED_IMAGE_EXTS:
                cand = MED_IMAGES_DIR / f'{code}.{ext}'
                if cand.is_file():
                    match = cand; break
            # Fallback: scan for any other extension (gif/jxl/…).
            if match is None:
                try:
                    for p in MED_IMAGES_DIR.iterdir():
                        if p.is_file() and p.stem == code:
                            match = p; break
                except OSError:
                    pass
            if match is None:
                self.send_json(404, {'error': 'File not found'}); return
            self._serve_file(match, None); return

        # ── Med images ─────────────────────────────────────────
        if clean.startswith('/med-images/'):
            fname = _safe_filename(urllib.parse.unquote(clean[12:]))
            if not fname:
                self.send_json(403, {'error': 'Forbidden'}); return
            self._serve_file(MED_IMAGES_DIR / fname, None); return

        # ── KS files (images / PDFs) ────────────────────────────
        if clean.startswith('/ks-files/'):
            fname = _safe_filename(urllib.parse.unquote(clean[10:]))
            if not fname:
                self.send_json(403, {'error': 'Forbidden'}); return
            self._serve_file(KS_FILES_DIR / fname, None); return

        # ── API ────────────────────────────────────────────────
        if clean in ('/api/health', '/api/server-status'):
            self.send_json(200, dashboard_status())
            return

        if self.path == '/ping':
            self.send_json(200, {
                'ok': True, 'server': 'BKN KS Server',
                'url': f'http://{Handler._ip}:{Handler._port}'
            })
            return

        rtype, key, extra = self.parse_route()

        if rtype == 'auth' and key == 'me':
            s = self._session()
            if not s: self.send_json(401, {'error': 'Not authenticated'}); return
            self.send_json(200, {'username': s['username'], 'role': s['role']}); return

        if rtype == 'users':
            if not self._require('super_admin'): return
            users = _load_users()
            if key:
                u = users.get(key)
                if not u: self.send_json(404, {'error': 'User not found'}); return
                self.send_json(200, {'username': key, 'role': u['role']}); return
            self.send_json(200, [
                {'username': u, 'role': d['role']} for u, d in users.items()
            ]); return

        if rtype == 'kpi-all':
            self.send_json(200, load_all_kpi())
        elif rtype == 'kpi-day':
            self.send_json(200, load_kpi_day(key))
        elif rtype == 'ks':
            self.send_json(200, load_ks(key))
        elif rtype == 'rx':
            self.send_json(200, load_rx(key))
        elif rtype == 'schedule':
            data = load_schedule(key)
            self.send_json(200, data)
        elif rtype == 'med-images-list':
            stems = [p.stem for p in MED_IMAGES_DIR.iterdir() if p.is_file()]
            self.send_json(200, stems)
        elif rtype == 'extralabel':
            raw = _load_orderitem_extralabel_raw()
            results = raw.get('results') or []
            seen = set()
            out = []
            for r in results:
                if r.get('status') != 'ok':
                    continue
                inss = [i for i in (r.get('instructions') or [])
                        if i.get('type') == 'Patient Instruction']
                if not inss:
                    continue
                code = r.get('code', '')
                seen.add(code)
                name = (r.get('listRow') or {}).get('name') or ''
                out.append({
                    'code': code,
                    'name': name,
                    'instructions': [
                        {'text': i.get('text', ''), 'localLanguage': i.get('localLanguage', '')}
                        for i in inss
                    ],
                })
            # Also surface curated instructions from medication-db.json
            db = load_rx('medication-db')
            if isinstance(db, dict):
                for code, entry in db.items():
                    if code in seen:
                        continue
                    inss = [i for i in (entry.get('instructions') or [])
                            if i.get('type') == 'Patient Instruction']
                    if not inss:
                        continue
                    ins = inss[0]
                    out.append({
                        'code': code,
                        'name': entry.get('name', ''),
                        '_source': 'med-db',
                        'instructions': [{
                            'text':          ins.get('EN', '') or ins.get('TH', ''),
                            'localLanguage': ins.get('TH', ''),
                        }],
                    })
            self.send_json(200, out)
        elif rtype == 'patient':
            self.send_json(200, load_or_create_patient(key))
        elif rtype == 'patient-context':
            doc = load_or_create_patient(key)
            self.send_json(200, doc.get('context') or {})
        elif rtype == 'patient-adr':
            doc = load_or_create_patient(key)
            self.send_json(200, doc.get('adrTimeline') or {})
        elif rtype == 'patient-medcache':
            doc = load_or_create_patient(key)
            entry = (doc.get('medicationCache') or {}).get(extra)
            self.send_json(200, entry)
        elif rtype == 'hmr':
            doc = load_hmr(key)
            self.send_json(200, doc or {})
        elif rtype == 'hmr-list':
            qs        = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            from_date = (qs.get('from') or [None])[0]
            to_date   = (qs.get('to')   or [None])[0]
            self.send_json(200, load_all_hmr(from_date, to_date))
        else:
            self.send_json(404, {'error': 'Not found'})

    def _serve_file_under(self, base_dir, relative_path, content_type):
        rel = str(relative_path).replace('\\', '/').lstrip('/')
        target = Path(base_dir) / rel
        if not _path_within(base_dir, target):
            self.send_json(403, {'error': 'Forbidden'}); return
        self._serve_file(target, content_type)

    def _serve_file(self, path, content_type):
        p = Path(path)
        if not p.exists() or not p.is_file():
            self.send_json(404, {'error': 'File not found'}); return
        # Python's mimetypes doesn't know webp/jxl/jfif — map them explicitly so
        # the browser renders med images in <img> instead of downloading them.
        ct = (content_type
              or _IMAGE_MIME.get(p.suffix.lower())
              or mimetypes.guess_type(str(p))[0]
              or 'application/octet-stream')
        self.send_response(200)
        self.send_header('Content-Type', ct)
        self.send_header('Content-Length', str(p.stat().st_size))
        self._cors()
        self.end_headers()
        with p.open('rb') as f:
            shutil.copyfileobj(f, self.wfile)

    # PUT — full day doc OR single section OR rx collection OR user
    def do_PUT(self):
        rtype, key, extra = self.parse_route()
        # Allow the trusted Chrome extension to write data routes without login.
        # User-management routes always require explicit auth.
        ext_data_write = self._is_trusted_extension() and rtype in (
            'kpi-day', 'kpi-section', 'ks', 'rx', 'rx-note',
            'med-image-upload', 'ks-file-upload', 'schedule',
            'patient', 'patient-context', 'patient-adr', 'patient-medcache',
            'hmr',
        )
        if not ext_data_write:
            if not self._require('super_admin', 'admin', 'editor'): return

        if rtype == 'med-image-upload':
            safe_name = _safe_filename(key)
            if not safe_name:
                self.send_json(400, {'error': 'Invalid filename'}); return
            length = int(self.headers.get('Content-Length', 0))
            data   = self.rfile.read(length)
            if not data:
                self.send_json(400, {'error': 'Empty body'}); return
            MED_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
            (MED_IMAGES_DIR / safe_name).write_bytes(data)
            self.send_json(200, {'ok': True, 'file': safe_name})
            return

        if rtype == 'ks-file-upload':
            safe_name = _safe_filename(key)
            if not safe_name:
                self.send_json(400, {'error': 'Invalid filename'}); return
            length = int(self.headers.get('Content-Length', 0))
            data   = self.rfile.read(length)
            if not data:
                self.send_json(400, {'error': 'Empty body'}); return
            KS_FILES_DIR.mkdir(parents=True, exist_ok=True)
            (KS_FILES_DIR / safe_name).write_bytes(data)
            self.send_json(200, {'ok': True, 'url': f'/ks-files/{safe_name}', 'file': safe_name})
            return

        try:
            body = self._read_json_body()
        except Exception as e:
            self.send_json(400, {'error': str(e)}); return

        if rtype == 'kpi-day':
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            save_kpi_day(key, body)
            self.send_json(200, {'ok': True})

        elif rtype == 'rx-note':
            # Persist a curated/translated note (TH + optional EN) for an item code
            # into medication-db.json.  Pass manual:true in the body to save as a
            # curated note that auto-translate will never overwrite.
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            th = _hm_norm(body.get('TH') or '')
            en = _hm_norm(body.get('EN') or '')
            if not key or not th:
                self.send_json(400, {'error': 'code (URL) and TH (body) required'}); return
            manual = bool(body.get('manual'))
            ok = save_rx_note(key, th, en, auto=not manual)
            self.send_json(200 if ok else 404,
                           {'ok': ok} if ok else {'error': 'Unknown item code'})

        elif rtype == 'kpi-section':
            field = SECTION_FIELD[extra]
            doc   = load_or_create_day(key)
            doc[field] = body
            save_kpi_day(key, doc)
            self.send_json(200, {'ok': True, 'date': key, 'section': extra})

        elif rtype == 'ks':
            if not isinstance(body, list):
                self.send_json(400, {'error': 'Body must be a JSON array'}); return
            save_ks(key, body)
            self.send_json(200, {'ok': True, 'count': len(body)})

        elif rtype == 'rx':
            if key in RX_DICT_COLS:
                if not isinstance(body, dict):
                    self.send_json(400, {'error': 'Body must be a JSON object'}); return
            else:
                if not isinstance(body, list):
                    self.send_json(400, {'error': 'Body must be a JSON array'}); return
            save_rx(key, body)
            count = len(body) if isinstance(body, (list, dict)) else 0
            self.send_json(200, {'ok': True, 'count': count})

        elif rtype == 'schedule':
            if not isinstance(body, (dict, list)):
                self.send_json(400, {'error': 'Body must be a JSON object or array'}); return
            save_schedule(key, body)
            self.send_json(200, {'ok': True})

        elif rtype == 'extralabel' and key:
            # PUT /api/extralabel/<code>  body: {localLanguage, text}
            # Updates the first "Patient Instruction" entry for this drug code.
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be JSON object'}); return
            raw = _load_orderitem_extralabel_raw()
            results = raw.get('results') or []
            found = False
            for r in results:
                if r.get('code') != key:
                    continue
                for ins in (r.get('instructions') or []):
                    if ins.get('type') == 'Patient Instruction':
                        if 'localLanguage' in body:
                            ins['localLanguage'] = body['localLanguage']
                        if 'text' in body:
                            ins['text'] = body['text']
                        found = True
                        break
                break
            if not found:
                self.send_json(404, {'error': 'Code not found or no Patient Instruction'}); return
            _atomic_write_json(ORDERITEM_EXTRALABEL_FILE, raw)
            self.send_json(200, {'ok': True})

        elif rtype == 'patient':
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            doc = load_or_create_patient(key)
            # Replace top-level fields except patientuid/createdAt
            for k, v in body.items():
                if k in ('patientuid', 'createdAt'): continue
                doc[k] = v
            save_patient(key, doc)
            self.send_json(200, {'ok': True})

        elif rtype == 'patient-context':
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            doc = load_or_create_patient(key)
            # Merge so other features' context fields are preserved
            ctx = doc.get('context') or {}
            for k, v in body.items():
                if v is not None and v != '':
                    ctx[k] = v
            doc['context'] = ctx
            save_patient(key, doc)
            self.send_json(200, {'ok': True})

        elif rtype == 'patient-adr':
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            doc = load_or_create_patient(key)
            doc['adrTimeline'] = body
            save_patient(key, doc)
            self.send_json(200, {'ok': True})

        elif rtype == 'patient-medcache':
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            doc = load_or_create_patient(key)
            cache = doc.get('medicationCache') or {}
            body.setdefault('fetchedAt', _now_iso())
            cache[extra] = body
            doc['medicationCache'] = cache
            save_patient(key, doc)
            self.send_json(200, {'ok': True})

        elif rtype == 'hmr':
            # Read-merge-write so multiple PCs can edit concurrently.
            # Checklist/step fields: last-write-wins.
            # auditLog: always append — entries from body are added to existing list.
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            doc = load_hmr(key) or {
                'visitid':   key,
                'createdAt': _now_iso(),
                'auditLog':  [],
            }
            protected = {'visitid', 'createdAt', 'auditLog', 'updatedAt'}
            for k, v in body.items():
                if k not in protected:
                    doc[k] = v
            # Append incoming audit log entries (never overwrite existing)
            incoming_log = body.get('auditLog')
            if isinstance(incoming_log, list):
                existing = doc.get('auditLog') or []
                existing.extend(incoming_log)
                doc['auditLog'] = existing
            save_hmr(key, doc)
            self.send_json(200, {'ok': True})

        elif rtype == 'users':
            if not self._require('super_admin'): return
            if not key:
                self.send_json(400, {'error': 'Username required in URL'}); return
            users = _load_users()
            if key not in users:
                self.send_json(404, {'error': 'User not found'}); return
            role = body.get('role')
            if role and role not in ROLES:
                self.send_json(400, {'error': f'Role must be one of {ROLES}'}); return
            if role:
                users[key]['role'] = role
            pw = body.get('password')
            if pw:
                users[key]['password_hash'] = _hash_pw(pw)
            _save_users(users)
            self.send_json(200, {'ok': True, 'username': key, 'role': users[key]['role']})

        else:
            self.send_json(404, {'error': 'Not found'})

    # POST — login / logout / create user / append med error
    def do_POST(self):
        rtype, key, _ = self.parse_route()
        try:
            body = self._read_json_body()
        except Exception as e:
            self.send_json(400, {'error': str(e)}); return

        # ── Auth: login (public) ───────────────────────────────
        if rtype == 'auth' and key == 'login':
            username = body.get('username', '').strip()
            password = body.get('password', '')
            users = _load_users()
            u = users.get(username)
            if not u or u.get('password_hash') != _hash_pw(password):
                self.send_json(401, {'error': 'Invalid credentials'}); return
            token = _create_session(username, u['role'])
            self.send_json(200, {'token': token, 'username': username, 'role': u['role']}); return

        # ── Auth: logout ──────────────────────────────────────
        if rtype == 'auth' and key == 'logout':
            h = self.headers.get('Authorization', '')
            if h.startswith('Bearer '):
                _sessions.pop(h[7:], None)
            self.send_json(200, {'ok': True}); return

        # ── Copy default placeholder image ─────────────────────
        if rtype == 'med-image-copy-default':
            safe = _safe_filename(f'{key}.jpg')
            if not safe:
                self.send_json(400, {'error': 'Invalid code'}); return
            src = MED_IMAGES_DIR / '11001.jpg'
            if not src.exists():
                self.send_json(404, {'error': 'Placeholder 11001.jpg not found on server'}); return
            shutil.copy2(src, MED_IMAGES_DIR / safe)
            self.send_json(200, {'ok': True, 'file': safe})
            return

        # ── Med DB recheck ─────────────────────────────────────
        if rtype == 'med-db-recheck':
            if not self._require('super_admin', 'admin', 'editor'): return
            db    = load_rx('medication-db')
            stems = {p.stem for p in MED_IMAGES_DIR.iterdir() if p.is_file()}
            updated = 0
            for code, entry in db.items():
                has = code in stems
                if entry.get('has_image') != has:
                    entry['has_image'] = has
                    entry['itemimage_name'] = 'มีรูปภาพ' if has else 'ไม่มีรูปภาพ'
                    updated += 1
            if updated:
                save_rx('medication-db', db)
            total     = len(db)
            has_count = sum(1 for e in db.values() if e.get('has_image'))
            self.send_json(200, {
                'ok': True, 'updated': updated, 'total': total,
                'has_image': has_count, 'no_image': total - has_count,
            })
            return

        # ── User create (super_admin only) ─────────────────────
        if rtype == 'users' and key is None:
            if not self._require('super_admin'): return
            uname = body.get('username', '').strip()
            pw    = body.get('password', '')
            role  = body.get('role', 'user')
            if not uname or not pw:
                self.send_json(400, {'error': 'username and password required'}); return
            if role not in ROLES:
                self.send_json(400, {'error': f'Role must be one of {ROLES}'}); return
            users = _load_users()
            if uname in users:
                self.send_json(409, {'error': 'Username already exists'}); return
            users[uname] = {'password_hash': _hash_pw(pw), 'role': role}
            _save_users(users)
            self.send_json(201, {'ok': True, 'username': uname, 'role': role}); return

        # ── Jasper report server-side fetch (trusted extension only) ─
        if rtype == 'report-fetch':
            url = body.get('url', '').strip()
            report_id = re.sub(r'[^A-Za-z0-9_-]', '', body.get('report', 'report') or 'report')[:30]
            if not url.startswith('https://aa-report.bdms.co.th/'):
                self.send_json(400, {'error': 'URL must be from aa-report.bdms.co.th'}); return
            try:
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125',
                    'Accept': 'application/vnd.ms-excel, application/octet-stream, */*',
                })
                with urllib.request.urlopen(req, timeout=30) as r:
                    data = r.read()
            except urllib.error.URLError as e:
                self.send_json(502, {'error': f'Cannot reach report server: {getattr(e, "reason", str(e))}'}); return
            except Exception as e:
                self.send_json(500, {'error': f'Fetch error: {str(e)}'}); return
            first_200 = data[:200].lower()
            is_html = b'<!doctype' in first_200 or b'<html' in first_200
            is_ole2 = data[:4] == b'\xd0\xcf\x11\xe0'
            if is_html and not is_ole2:
                self.send_json(401, {'error': 'Jasper returned a login page — the report URL requires an active browser session. Use Manual ▾ to open the URL in your browser, download the XLS, then upload it.'}); return
            if len(data) < 512:
                self.send_json(502, {'error': f'Server returned only {len(data)} bytes — may require browser session.'}); return
            TEMP_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            try:
                (TEMP_REPORTS_DIR / f'{report_id}_{ts}.xls').write_bytes(data)
            except Exception:
                pass
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition', f'attachment; filename="{report_id}_{ts}.xls"')
            self.send_header('Content-Length', str(len(data)))
            self._cors()
            self.end_headers()
            self.wfile.write(data)
            return

        # ── Home Medication Sheet (PRIMARY): fetch ArcusAir getallorderitem
        #    JSON directly using the captured incus-token + session headers.
        #    Cleaner than Jasper: structured, exact codes/qty/freq, already
        #    filtered to DISCHARGE MEDICATION. ──
        if rtype == 'report-home-med-api':
            ctx = body.get('context') or {}
            if not ctx.get('patientuid') or not ctx.get('patientvisituid'):
                self.send_json(400, {'error': 'patientuid + patientvisituid required'}); return
            if not ctx.get('incusToken'):
                self.send_json(400, {'error': 'incusToken missing — open the patient on ArcusAir first'}); return
            try:
                data = fetch_arcus_discharge_meds(ctx)
            except urllib.error.HTTPError as e:
                self.send_json(502, {'error': f'ArcusAir HTTP {e.code} — token may be expired'}); return
            except Exception as e:
                self.send_json(500, {'error': f'ArcusAir fetch error: {e}'}); return
            try:
                result = build_home_med_from_arcus(data)
            except Exception as e:
                self.send_json(500, {'error': f'Parse error: {e}'}); return
            # Log exactly what the Home Medication Sheet received (API summary +
            # built meds) to data/logs for inspection.
            _log_home_med_fetch(ctx, data, result)
            # Allergies are supplementary — fetch best-effort, never fail the sheet.
            try:
                result['allergies'] = build_allergies_from_arcus(fetch_arcus_allergies(ctx))
            except Exception as e:
                result['allergies'] = {'nkda': False, 'items': [], 'hasRecord': False, 'error': str(e)}
            # Future appointments — best-effort, never fail the sheet.
            try:
                appt_data = fetch_arcus_future_appointments(ctx)
                result['appointmentText'] = format_appointments_th(appt_data)
            except Exception:
                result['appointmentText'] = (
                    'ไม่มีนัดติดตามอาการ '
                    'แต่ถ้าพบอาการผิดปรกติหรืออาการแย่ลง '
                    'แนะนำให้กลับมาพบแพทย์เพื่อตรวจเพิ่มเติม'
                )
            result['ok'] = True
            result['source'] = 'arcus-api'
            self.send_json(200, result)
            return

        # ── Medication Journey: all orders grouped into a continuity timeline ──
        if rtype == 'report-med-journey':
            ctx = body.get('context') or {}
            if not ctx.get('patientuid') or not ctx.get('patientvisituid'):
                self.send_json(400, {'error': 'patientuid + patientvisituid required'}); return
            if not ctx.get('incusToken'):
                self.send_json(400, {'error': 'incusToken missing — open the patient on ArcusAir first'}); return
            try:
                data = fetch_arcus_all_orders(ctx)
            except urllib.error.HTTPError as e:
                self.send_json(502, {'error': f'ArcusAir HTTP {e.code} — token may be expired'}); return
            except Exception as e:
                if _is_transient_net_err(e):
                    self.send_json(504, {'error': 'ArcusAir ตอบช้า/เชื่อมต่อไม่ได้ (TLS timeout) — ลองใหม่อีกครั้ง'}); return
                self.send_json(500, {'error': f'ArcusAir fetch error: {e}'}); return
            # Best-effort: previous medicines from the last 10 visits → primary
            # source for the 'Before / Admission' column (tagged "(last visit)").
            prev_meds = None
            try:
                vh = fetch_arcus_visit_history(ctx, 10)
                if vh:
                    prev_meds = build_prev_meds_from_visits(vh, ctx.get('patientvisituid', ''))
            except Exception:
                prev_meds = None
            # Best-effort: pre-admission home meds + reconcile status, if the
            # pharmacist opened the Med Reconcile screen (gave us medreconcileuid).
            recon_meds = None
            try:
                rd = fetch_arcus_medreconcile(ctx)
                if rd:
                    recon_meds = build_reconcile_meds(rd)
            except Exception:
                recon_meds = None
            try:
                result = build_med_journey_from_arcus(data, recon_meds, prev_meds)
            except Exception as e:
                self.send_json(500, {'error': f'Parse error: {e}'}); return
            result['hasReconcile'] = bool(recon_meds)
            result['hasVisitHistory'] = bool(prev_meds)
            try:
                result['allergies'] = build_allergies_from_arcus(fetch_arcus_allergies(ctx))
            except Exception as e:
                result['allergies'] = {'nkda': False, 'items': [], 'hasRecord': False, 'error': str(e)}
            result['ok'] = True
            result['source'] = 'arcus-api'
            self.send_json(200, result)
            return

        # ── KPI med errors (editor/admin/super_admin) ─────────
        if not self._require('super_admin', 'admin', 'editor'): return
        if rtype == 'kpi-med-errors':
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            doc = load_or_create_day(key)
            doc['medErrors'].append(body)
            save_kpi_day(key, doc)
            self.send_json(201, {'ok': True, 'date': key, 'count': len(doc['medErrors'])})
        else:
            self.send_json(404, {'error': 'Not found'})

    # DELETE — remove a med error by savedAt, or delete a user
    def do_DELETE(self):
        rtype, key, item_id = self.parse_route()

        if rtype == 'users':
            if not self._require('super_admin'): return
            if not key:
                self.send_json(400, {'error': 'Username required in URL'}); return
            users = _load_users()
            if key not in users:
                self.send_json(404, {'error': 'User not found'}); return
            # Prevent deleting last super_admin
            if users[key]['role'] == 'super_admin' and sum(1 for u in users.values() if u['role'] == 'super_admin') <= 1:
                self.send_json(409, {'error': 'Cannot delete the last admin'}); return
            del users[key]
            _save_users(users)
            # Evict any active sessions for this user
            evict = [t for t, s in _sessions.items() if s['username'] == key]
            for t in evict:
                del _sessions[t]
            self.send_json(200, {'ok': True}); return

        if not self._require('super_admin', 'admin', 'editor'): return
        if rtype != 'kpi-med-error-item':
            self.send_json(404, {'error': 'Not found'}); return

        doc = load_or_create_day(key)
        before = len(doc['medErrors'])
        doc['medErrors'] = [e for e in doc['medErrors'] if e.get('savedAt') != item_id]
        removed = before - len(doc['medErrors'])
        save_kpi_day(key, doc)
        self.send_json(200, {'ok': True, 'removed': removed})


# ── Network helpers ────────────────────────────────────────────
def get_local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return '127.0.0.1'


# ── Shutdown guard ─────────────────────────────────────────────
# "Please do not stop — Maprang is playing the game!" Warn whoever tries to
# close the server so it isn't killed by accident.
_STOP_WARN = (
    'Please do not stop the Pharmacy Server.\n'
    'Maprang is still playing the game! 🎀\n\n'
    'มาปรางกำลังเล่นเกมอยู่ กรุณาอย่าปิดเซิร์ฟเวอร์นะคะ 💖'
)
_ctrlc_armed = False  # first Ctrl+C only warns; second within the window stops

def _disarm_ctrlc():
    global _ctrlc_armed
    _ctrlc_armed = False

def _warn_console():
    """Print the playful do-not-close warning into the console."""
    try:
        sys.stdout.write(
            _ESC_SHOW + '\n'
            + _YL + '╔══════════════════════════════════════════════════════╗' + _RST + '\n'
            + _YL + '║ ' + _RST + _RD + '  อย่าปิดเซิร์ฟเวอร์นะคะ! / Please do NOT stop me!  ' + _RST + _YL + ' ║' + _RST + '\n'
            + _YL + '║ ' + _RST + _MG + '  มาปรางกำลังเล่นเกมอยู่ 🎀  Maprang is playing! 💖  ' + _RST + _YL + '║' + _RST + '\n'
            + _YL + '╚══════════════════════════════════════════════════════╝' + _RST + '\n'
        )
        sys.stdout.flush()
    except Exception:
        pass

def _windows_message_box():
    """Pop a Windows MessageBox so the warning is seen even if the console is
    being closed (X button / logoff / shutdown)."""
    try:
        import ctypes
        MB_ICONWARNING = 0x30
        MB_TOPMOST = 0x40000
        MB_SYSTEMMODAL = 0x1000
        ctypes.windll.user32.MessageBoxW(
            0, _STOP_WARN, 'BKN Pharmacy Server',
            MB_ICONWARNING | MB_TOPMOST | MB_SYSTEMMODAL,
        )
    except Exception:
        pass

def _install_close_guard():
    """On Windows, intercept console-close / logoff / shutdown events and show
    the warning MessageBox (which also briefly blocks the close)."""
    if os.name != 'nt':
        return
    try:
        import ctypes
        from ctypes import wintypes

        # CTRL_C_EVENT=0, CTRL_BREAK_EVENT=1, CTRL_CLOSE_EVENT=2,
        # CTRL_LOGOFF_EVENT=5, CTRL_SHUTDOWN_EVENT=6
        HANDLER = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.DWORD)

        def _handler(ctrl_type):
            if ctrl_type in (2, 5, 6):          # close / logoff / shutdown
                _warn_console()
                _windows_message_box()
                # Returning TRUE marks the event handled; the OS still ends the
                # process shortly after, but the user has now been warned.
                return True
            return False                         # let Ctrl+C/Break flow normally

        # Keep a reference so the callback isn't garbage-collected.
        global _CTRL_HANDLER_REF
        _CTRL_HANDLER_REF = HANDLER(_handler)
        ctypes.windll.kernel32.SetConsoleCtrlHandler(_CTRL_HANDLER_REF, True)
    except Exception:
        pass

_CTRL_HANDLER_REF = None


# ── Server bootstrap (shared by CLI main + GUI app) ─────────────
def _init_data_dirs():
    """Create data folders + seed empty collections. Idempotent."""
    KPI_DIR.mkdir(parents=True, exist_ok=True)
    KS_DIR.mkdir(parents=True, exist_ok=True)
    RX_DIR.mkdir(parents=True, exist_ok=True)
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    MED_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    KS_FILES_DIR.mkdir(parents=True, exist_ok=True)
    SCHEDULE_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    PATIENTS_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    WWW_DIR.mkdir(parents=True, exist_ok=True)
    for col in KS_COLS:
        p = ks_file(col)
        if not p.exists():
            p.write_text('[]', encoding='utf-8')
    for col in RX_COLS:
        p = rx_file(col)
        if not p.exists():
            p.write_text('{}' if col in RX_DICT_COLS else '[]', encoding='utf-8')
    _ensure_default_users()


def start_server_background(port=None):
    """Start the HTTP server in a daemon thread WITHOUT the terminal dashboard
    or console handlers. Used by the desktop GUI (maprang_app.py), which renders
    its own dashboard. Returns (server, ip, port)."""
    global _SERVER_START
    if port is None:
        port = DEFAULT_PORT
    _init_data_dirs()
    ip = get_local_ip()
    Handler._ip = ip
    Handler._port = port
    server = _QuietHTTPServer(('0.0.0.0', port), Handler)
    _SERVER_START = time.time()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    # Warm the dashboard cache (the disk scan is slow over SMB) so the GUI's
    # first poll doesn't hit a multi-second cold call.
    threading.Thread(target=_dashboard_heavy, daemon=True).start()
    # Schedule HMR nightly merge at 23:00
    _start_hmr_scheduler()
    return server, ip, port


# ── Main ───────────────────────────────────────────────────────
def main():
    port = DEFAULT_PORT
    args = sys.argv[1:]
    if len(args) >= 2 and args[0] == '--port':
        try:
            port = int(args[1])
        except ValueError:
            print(f'Invalid port: {args[1]}')
            sys.exit(1)

    # Init sub-folders (KPI files created on demand per day)
    KPI_DIR.mkdir(parents=True, exist_ok=True)
    KS_DIR.mkdir(parents=True, exist_ok=True)
    RX_DIR.mkdir(parents=True, exist_ok=True)
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    MED_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    KS_FILES_DIR.mkdir(parents=True, exist_ok=True)
    SCHEDULE_DIR.mkdir(parents=True, exist_ok=True)
    TEMP_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    PATIENTS_DIR.mkdir(parents=True, exist_ok=True)
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    WWW_DIR.mkdir(parents=True, exist_ok=True)
    for col in KS_COLS:
        p = ks_file(col)
        if not p.exists():
            p.write_text('[]', encoding='utf-8')
    for col in RX_COLS:
        p = rx_file(col)
        if not p.exists():
            empty = '{}' if col in RX_DICT_COLS else '[]'
            p.write_text(empty, encoding='utf-8')
    _ensure_default_users()

    global _SERVER_START
    ip = get_local_ip()
    Handler._ip   = ip
    Handler._port = port
    server = _QuietHTTPServer(('0.0.0.0', port), Handler)

    _SERVER_START = time.time()
    _enable_ansi()
    _install_close_guard()
    _run_dashboard(ip, port)   # one-time status line (GUI dashboard is separate)

    # Ctrl+C: first press only warns ("don't stop Maprang!"); a second Ctrl+C
    # within 5 seconds confirms and actually stops the server.
    global _ctrlc_armed
    while True:
        try:
            server.serve_forever()
            break
        except KeyboardInterrupt:
            if _ctrlc_armed:
                sys.stdout.write(_ESC_SHOW + '\n  Server stopped.\n')
                sys.stdout.flush()
                break
            _ctrlc_armed = True
            _warn_console()
            sys.stdout.write(
                _WH + '  Press Ctrl+C again within 5s to stop anyway…' + _RST + '\n'
            )
            sys.stdout.flush()
            threading.Timer(5.0, _disarm_ctrlc).start()
            # Resume serving; serve_forever returns on KeyboardInterrupt, so loop.
            continue


if __name__ == '__main__':
    main()
