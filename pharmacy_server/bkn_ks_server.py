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
from datetime import datetime, timezone
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
KS_FILES_DIR  = DATA_DIR / 'ks' / 'files'
SCHEDULE_DIR      = DATA_DIR / 'schedule'
TEMP_REPORTS_DIR  = DATA_DIR / 'temp-reports'
PATIENTS_DIR      = DATA_DIR / 'patients'
LOGS_DIR          = DATA_DIR / 'logs'
WWW_DIR           = Path(__file__).parent / 'www'
KS_COLS       = {'faqs', 'items', 'vdos'}
# All rx collections — GET is public; PUT requires editor/admin auth
RX_COLS       = {'premix-drugs', 'mixing-protocols', 'medication-db', 'iv-drugs', 'iv-staff'}
# Requests from these Chrome extensions may read/write data without login.
# Multiple IDs supported during the rx_menu → BKN Pharmacy Portal migration.
TRUSTED_EXTENSION_ORIGINS = {
    'chrome-extension://eeglifkmgelepjmnnldknacamedmckbj',  # rx_menu (legacy)
    'chrome-extension://nffpegfadeflicpjedmhlgpgpjhkgmgg',  # AAOverlay (legacy)
}
# Backward-compat single-origin variable (still referenced by older code paths)
EXTENSION_ORIGIN = 'chrome-extension://eeglifkmgelepjmnnldknacamedmckbj'
# medication-db is a dict; all others are arrays
RX_DICT_COLS  = {'medication-db'}
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
EXTRALABEL_FILE  = RX_DIR / 'medication-db.json'   # merged: per-item instructions (TH/EN)

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
            th = _hm_norm(((row.get('detail') or {}).get('localLanguage')) or '')
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
        th_parts, en_parts = [], []
        for ins in inss:
            if (ins.get('type') or '').strip() != want_type:
                continue
            th = _hm_norm(ins.get('TH') or '')
            en = _hm_norm(ins.get('EN') or '')
            if th:
                th_parts.append(th)
            if en:
                en_parts.append(en)
        return ' '.join(th_parts).strip(), ' '.join(en_parts).strip()

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


# ── Home Medication Sheet (from ArcusAir getallorderitem API) ──
ARCUS_BASE = 'https://arcusair.bdms.co.th'
ARCUS_ORDERITEM_URL = ARCUS_BASE + '/ordermanagement/patientorder/getallorderitem'
ARCUS_ALLERGY_URL   = ARCUS_BASE + '/emr/drugalergy/getallergies'
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


def _arcus_post_json(url, ctx, payload):
    """POST JSON to an ArcusAir endpoint with session headers; return parsed JSON."""
    body = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers=_arcus_headers(ctx), method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read()
        if raw[:2] == b'\x1f\x8b':
            import gzip
            raw = gzip.decompress(raw)
    return json.loads(raw.decode('utf-8'))


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


def _arcus_item_to_med(it):
    """Map one getallorderitem entry → a med dict (or None). Also attaches the
    order-type label and key dates so callers can place it on a timeline."""
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
    instr_parts = []
    if verb:
        instr_parts.append(verb)
    if dosage:
        instr_parts.append(str(dosage) + (' ' + dose_unit if dose_unit else ''))
    if route:
        instr_parts.append(route)
    if freq:
        instr_parts.append(freq)
    # Keep the instruction fully English here. The client's offline pattern
    # engine (matchMedicalPattern) localises the whole line — verb/unit/route/
    # frequency — to Thai on first load without any Google Translate call.
    instruction = ' '.join(instr_parts).strip()

    qty_n = poi.get('quantity')
    qty_unit = _hm_norm((_arc_first(poi.get('quantityUOM')) or {}).get('valuedescription') or '')
    quantity = (str(qty_n) + (' ' + qty_unit if qty_unit else '')) if qty_n is not None else ''

    # Live free-text patient instruction (English) from this order, if any.
    live_note = ''
    for ins in (poi.get('instructions') or []):
        if ins.get('valuecode') == 'INSTYP1' and ins.get('instructiontext'):
            live_note = _hm_norm(ins['instructiontext'])
            break

    # Note-line: the curated "Patient Instruction" extra label by item code.
    # localLanguage = Thai (default), text = English; build both so the client
    # can swap with the language dropdown. The live order free-text is appended
    # to each (de-duplicated) so doctor notes aren't lost.
    extra = _load_extralabel_index().get(code) if code else None
    extra = extra or {}
    extra_th = extra.get('localLanguage') or ''
    extra_en = extra.get('text') or ''

    def _with_live(base):
        if live_note and live_note != base:
            return (base + ' ' + live_note).strip() if base else live_note
        return base

    note   = _with_live(extra_th)          # Thai note (default)
    note_en = _with_live(extra_en)         # English note
    # If a language has no label at all, fall back to the other so the line
    # isn't blank.
    if not note:
        note = note_en
    if not note_en:
        note_en = note

    provider = _hm_norm((_arc_first(poi.get('careprovideruid')) or {}).get('name') or '')
    if not provider:
        provider = _hm_norm((_arc_first(it.get('careprovideruid')) or {}).get('name') or '')

    ordertype = _hm_norm((_arc_first(it.get('ordertypeuid')) or {}).get('valuedescription') or '')
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
        'ordertype': ordertype, 'status': status, 'ordercat': ordercat,
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


def build_home_med_from_arcus(data):
    """Map ArcusAir getallorderitem JSON → home-med rows: {patient, meds, allMeds}.
    Each item already IS a discharge med (server filtered)."""
    items = (data or {}).get('orderitems') or []
    meds = []
    patient = {}
    for it in items:
        med = _arcus_item_to_med(it)
        if not med:
            continue
        if not patient:
            patient = _arcus_patient_header(it)
        # Drop the timeline-only fields for the home-med sheet shape.
        for k in ('ordertype', 'status', 'ordercat', 'orderdate', 'startdate'):
            med.pop(k, None)
        meds.append(med)
    return {'patient': patient, 'meds': meds, 'allMeds': len(meds)}


def fetch_arcus_all_orders(ctx):
    """Fetch ALL order items (no ordertype filter) for the medication journey."""
    return _arcus_post_json(ARCUS_ORDERITEM_URL, ctx, {
        'pagesize': 500, 'pagenumber': 1,
        'patientuid': ctx.get('patientuid', ''),
        'patientvisituid': ctx.get('patientvisituid', ''),
        'isactive': True, 'sortorder': '-orderdate',
    })


def _journey_phase(ordertype):
    """Map an order-type label → journey phase column.
    admission = home/OPD meds (pre-admission) · ward = inpatient · home = discharge."""
    t = (ordertype or '').upper()
    if 'DISCHARGE' in t:
        return 'home'
    if 'HOME' in t or 'OPD' in t:
        return 'admission'
    return 'ward'


def build_med_journey_from_arcus(data, reconcile_meds=None):
    """Group all orders by drug into a continuity timeline.
    Returns {patient, rows:[{drug, code, admission, ward, home, status, note}]}.

    When `reconcile_meds` (from medreconcile/getdetail) is provided, the patient's
    pre-admission home meds fill the 'admission' column and their authoritative
    reconcilestatus overrides the auto-guessed status. status stays editable.
    """
    items = (data or {}).get('orderitems') or []
    patient = {}
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

    # 1) Reconcile (pre-admission home) meds first → admission column + status.
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
    for it in items:
        med = _arcus_item_to_med(it)
        if not med:
            continue
        if not patient:
            patient = _arcus_patient_header(it)
        if not _is_medicine(med):
            continue
        phase = _journey_phase(med.get('ordertype'))
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
        rows.append(row)

    return {'patient': patient, 'rows': rows, 'allRows': len(rows)}


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
#   adrTimeline: { customEvents, customMedications, adrEvent },
#   medicationCache: { "<patientvisituid>": { fetchedAt, orders, adminTimes } }
# }
_PUID_RE = re.compile(r'^[a-zA-Z0-9_-]{1,64}$')

def _safe_puid(puid):
    if not puid or not _PUID_RE.match(puid):
        return None
    return puid

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
            'adrEvent': None,
        },
        'medicationCache': {},
    }

def load_or_create_patient(puid):
    doc = load_patient(puid)
    if doc is None:
        doc = _empty_patient(puid)
    # Backfill missing keys for older saved docs
    doc.setdefault('context', {})
    doc.setdefault('adrTimeline', {'customEvents': [], 'customMedications': [], 'adrEvent': None})
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
_recent_reqs  = []   # (time_str, method, path, status)
_SERVER_START = None

def _record_request(method, path, status):
    global _req_count
    ts = datetime.now().strftime('%H:%M:%S')
    with _STATS_LOCK:
        _req_count += 1
        _recent_reqs.append((ts, method, path[:40], str(status)))
        if len(_recent_reqs) > 5:
            _recent_reqs.pop(0)

# ANSI escape helpers
_ESC_HIDE  = '\033[?25l'
_ESC_SHOW  = '\033[?25h'
_ESC_HOME  = '\033[H'
_ESC_CLEAR = '\033[2J'
_ESC_ALT_ON  = '\033[?1049h'   # enter alternate screen buffer (no scrollback)
_ESC_ALT_OFF = '\033[?1049l'   # leave alternate screen buffer
_ESC_EOL     = '\033[K'        # erase to end of line
_RST = '\033[0m'
_CY  = '\033[1;36m'   # bright cyan
_GN  = '\033[1;32m'   # bright green
_RD  = '\033[1;31m'   # bright red
_YL  = '\033[1;33m'   # bright yellow
_BL  = '\033[0;34m'   # blue
_MG  = '\033[1;35m'   # bright magenta
_WH  = '\033[1;37m'   # bright white

# Box width (chars between ║ walls)
_BW = 62

def _vis_len(s):
    """Display column width of s, stripping ANSI escapes and counting wide chars."""
    plain = re.sub(r'\033\[[^m]*m', '', s)
    w = 0
    for c in plain:
        eaw = unicodedata.east_asian_width(c)
        w += 2 if eaw in ('W', 'F') else 1
    return w

def _bline(content, width=_BW):
    """Pad content to visual width and wrap in ║...║."""
    pad = max(0, width - _vis_len(content))
    return '║' + content + ' ' * pad + '║'

def _sep(l='╠', m='═', r='╣', width=_BW):
    return l + m * width + r


class _MaprangGame:
    """Auto-play ASCII game: Maprang (a little character with body, arms and
    legs) runs along the ground and catches falling items."""
    W = 40   # play area width (all ASCII = 1 col each)
    H = 6    # rows items fall through before ground

    _SYMS = [('+', _CY), ('o', _RD), ('*', _YL), ('%', _MG)]

    # Maprang sprite, 4 rows: face / arms / body / legs. Each animation frame is
    # a 5-char-wide figure so it stays aligned. Arms & legs alternate to walk;
    # when catching, arms go up (\o/). Anchor column is the character's centre.
    #   frames: 0 walk-A, 1 walk-B, 2 catch (arms up), 3 happy
    _SPRITE = {
        'face': ['(o_o)', '(^_^)', '(^o^)', '(>‿<)'],
        'arms': ['/| |\\', '\\| |/', '\\o o/', '\\| |/'],
        'body': [' |_| ', ' |_| ', ' |_| ', ' |_| '],
        'legs': ['_/ \\_', '/\\_/\\', '_/ \\_', '/\\_/\\'],
    }
    _SPRITE_W = 5

    _MSGS = [
        _GN + 'มาปรางเก่งมาก!' + _RST,
        _YL + 'やったー! ✨' + _RST,
        _CY + 'Catch it! 💖' + _RST,
        _MG + 'สู้ๆนะ มาปราง! 🎀' + _RST,
        _WH + 'Yes!! 🎉' + _RST,
    ]

    def __init__(self):
        self.mx    = self.W // 2
        self.score = 0
        self.msg   = ''
        self.msg_t = 0
        self.items = []   # [x, y, sym, color]
        self.tick  = 0
        self.walk  = 0
        self.catch_t = 0   # frames left showing the "catch" pose

    def step(self):
        self.tick += 1
        if self.tick % 18 == 0 and len(self.items) < 6:
            sym, col = random.choice(self._SYMS)
            self.items.append([random.randint(1, self.W - 2), 0, sym, col])
        for item in self.items:
            item[1] += 1
        # Items are caught when they reach Maprang's face row (top of the sprite).
        catch_row = self.H - 4
        # Chase nearest item that hasn't reached the catch row yet.
        active = [i for i in self.items if i[1] < catch_row]
        if active:
            tx = min(active, key=lambda i: abs(i[0] - self.mx))[0]
            if tx < self.mx:
                self.mx = max(2, self.mx - 1)
            elif tx > self.mx:
                self.mx = min(self.W - 3, self.mx + 1)
        # Catch items that reached the face row near Maprang's hands.
        caught = [i for i in self.items if i[1] >= catch_row and abs(i[0] - self.mx) <= 2]
        if caught:
            self.score += len(caught)
            self.msg    = random.choice(self._MSGS)
            self.msg_t  = 20
            self.catch_t = 6   # show arms-up "catch" pose briefly
        self.items = [i for i in self.items if i[1] < catch_row]
        if self.msg_t > 0:
            self.msg_t -= 1
        else:
            self.msg = ''
        if self.catch_t > 0:
            self.catch_t -= 1
        self.walk = (self.walk + 1) % 2   # 0/1 walk cycle

    def render(self):
        """List of strings (with ANSI) for the play area including borders.
        The bottom 4 rows draw Maprang (face/arms/body/legs); items fall through
        the rows above and are caught on the face row."""
        # Pose: catch (arms up) if just caught, else walk frame, else happy.
        if self.catch_t > 0:
            pose = 2
        else:
            pose = self.walk            # 0 or 1
        sprite_rows = [
            self._SPRITE['face'][pose],
            self._SPRITE['arms'][pose],
            self._SPRITE['body'][pose],
            self._SPRITE['legs'][pose],
        ]
        sprite_top = self.H - len(sprite_rows)   # first row index occupied by sprite

        lines = [_BL + '┌' + '─' * self.W + '┐' + _RST]
        for row in range(self.H):
            cells = [' '] * self.W
            # Falling items.
            for x, y, sym, col in self.items:
                if y == row and 0 <= x < self.W:
                    cells[x] = col + sym + _RST
            # Maprang sprite occupies the bottom rows.
            if row >= sprite_top:
                line = sprite_rows[row - sprite_top]
                for i, ch in enumerate(line):
                    xi = self.mx - 2 + i
                    if 0 <= xi < self.W and ch != ' ':
                        cells[xi] = _GN + ch + _RST
            lines.append(_BL + '│' + _RST + ''.join(cells) + _BL + '│' + _RST)
        lines.append(_BL + '└' + '─' * self.W + '┘' + _RST)
        return lines


def _enable_ansi():
    """Enable ANSI VT sequences in Windows 10+ cmd.exe."""
    if os.name == 'nt':
        os.system('')


def _run_dashboard(ip, port):
    """Background thread: redraws animated terminal dashboard at ~5 fps in a
    fixed-size area using the alternate screen buffer (no scrolling)."""
    _enable_ansi()
    game = _MaprangGame()
    # Alternate screen buffer keeps the dashboard pinned in place — frames redraw
    # at the home position instead of scrolling new copies down the console.
    sys.stdout.write(_ESC_ALT_ON + _ESC_HIDE + _ESC_CLEAR)
    sys.stdout.flush()

    def uptime_str():
        s = int(time.time() - _SERVER_START)
        return f'{s // 3600:02}:{(s % 3600) // 60:02}:{s % 60:02}'

    while True:
        try:
            game.step()
            # Home cursor each frame and erase each line as we redraw — fixed
            # window, no full-clear flicker, no scrolling.
            out = [_ESC_HOME]

            # ── Title ──────────────────────────────────────────────
            out.append(_BL + _sep('╔', '═', '╗') + _RST)
            out.append(_bline(_WH + '  BKN Pharmacy — Knowledge Sharing Server' + _RST))

            # ── Server info ────────────────────────────────────────
            out.append(_BL + _sep() + _RST)
            up   = uptime_str()
            url  = f'  🌐  http://{ip}:{port}'
            with _STATS_LOCK:
                rc   = _req_count
                last = (_recent_reqs[-1][1] + ' ' + _recent_reqs[-1][2]) if _recent_reqs else '—'
            out.append(_bline(f'{url}      {_CY}⏱ Uptime: {up}{_RST}'))
            req_s  = f'  📊  Requests: {rc}'
            last_s = last[:_BW - _vis_len(req_s) - 12]
            out.append(_bline(f'{req_s}   {_YL}Last: {last_s}{_RST}'))

            # ── Maprang game ───────────────────────────────────────
            out.append(_BL + _sep() + _RST)
            score_s = _YL + f'⭐ Score: {game.score}' + _RST
            out.append(_bline(f'  {_MG}🌸 Maprang Plays! 🌸{_RST}       {score_s}'))
            out.append(_bline(''))
            for pl in game.render():
                out.append(_bline('  ' + pl))
            msg_s = game.msg or ''
            out.append(_bline(f'  {msg_s}'))

            # ── Recent requests ────────────────────────────────────
            out.append(_BL + _sep() + _RST)
            out.append(_bline(_WH + '  Recent requests:' + _RST))
            with _STATS_LOCK:
                recent = list(_recent_reqs[-4:])
            while len(recent) < 4:
                recent.insert(0, None)
            for entry in recent:
                if entry:
                    ts, method, path, status = entry
                    sc = _GN if status.startswith('2') else (_YL if status.startswith('3') else _RD)
                    row = f'  [{_CY}{ts}{_RST}]  {_WH}{method:<6}{_RST}  {path:<36}  {sc}{status}{_RST}'
                else:
                    row = ''
                out.append(_bline(row))

            # ── Footer ─────────────────────────────────────────────
            out.append(_BL + _sep() + _RST)
            out.append(_bline(f'  {_WH}Press Ctrl+C to stop the server{_RST}'))
            out.append(_BL + _sep('╚', '═', '╝') + _RST)

            # out[0] is the cursor-home escape; the rest are content lines. Erase
            # to end of each line so shorter frames don't leave stale characters,
            # then erase everything below the frame.
            body = (_ESC_EOL + '\n').join(out[1:])
            sys.stdout.write(out[0] + body + _ESC_EOL + '\n' + '\033[J')
            sys.stdout.flush()
        except Exception:
            pass
        time.sleep(0.2)


# ── HTTP handler ───────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        try:
            _record_request(self.command, self.path, args[1] if len(args) > 1 else '?')
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
        if clean in ('/', '/index.html', ''):
            self._serve_file(WWW_DIR / 'index.html', 'text/html; charset=utf-8'); return
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
        ct = content_type or mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
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
            'kpi-day', 'kpi-section', 'ks', 'rx',
            'med-image-upload', 'ks-file-upload', 'schedule',
            'patient', 'patient-context', 'patient-adr', 'patient-medcache',
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
                self.send_json(500, {'error': f'ArcusAir fetch error: {e}'}); return
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
                result = build_med_journey_from_arcus(data, recon_meds)
            except Exception as e:
                self.send_json(500, {'error': f'Parse error: {e}'}); return
            result['hasReconcile'] = bool(recon_meds)
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
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)

    _SERVER_START = time.time()
    _enable_ansi()
    _install_close_guard()
    t = threading.Thread(target=_run_dashboard, args=(ip, port), daemon=True)
    t.start()

    # Ctrl+C: first press only warns ("don't stop Maprang!"); a second Ctrl+C
    # within 5 seconds confirms and actually stops the server.
    global _ctrlc_armed
    while True:
        try:
            server.serve_forever()
            break
        except KeyboardInterrupt:
            if _ctrlc_armed:
                # Leave the alternate screen buffer so the normal console (with
                # its scrollback) is restored before we exit.
                sys.stdout.write(_ESC_ALT_OFF + _ESC_SHOW + '\n  Server stopped.\n')
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
