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
import urllib.error
import urllib.parse
import urllib.request
import http.cookiejar
import struct
import threading
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
KS_FILES_DIR  = DATA_DIR / 'ks' / 'files'
SCHEDULE_DIR      = DATA_DIR / 'schedule'
TEMP_REPORTS_DIR  = DATA_DIR / 'temp-reports'
PATIENTS_DIR      = DATA_DIR / 'patients'
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

# ── Jasper (aa-report) service login ───────────────────────────
# The Jasper report server requires an interactive session. The pharmacy
# server logs in once with a service account, captures the JSESSIONID cookie,
# and reuses it to fetch report XLS files on behalf of the extension.
#
# ⚠️ SECURITY NOTE: these credentials are hardcoded here at the maintainer's
#    request. This file lives in the git repo, so the password is visible to
#    anyone with repo access. Rotate by editing the two constants below.
JASPER_BASE       = 'https://aa-report.bdms.co.th'
JASPER_LOGIN_URL  = JASPER_BASE + '/jasperserver/j_spring_security_check'
JASPER_USERNAME   = 'bkn07'
JASPER_PASSWORD   = 'abc@123'

# Module-level cached Jasper session (cookie jar + opener), guarded by a lock.
_jasper_lock   = threading.Lock()
_jasper_opener = None


def _jasper_build_opener():
    """Create a fresh urllib opener with its own cookie jar."""
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar)), jar


_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128'


def _jasper_scrape_csrf(html):
    """Return a CSRF token if the login page embeds one (Spring Security)."""
    # Common forms: <input name="_csrf" value="..."> or meta tag.
    m = re.search(r'name=["\']_csrf["\'][^>]*value=["\']([^"\']+)["\']', html, re.I)
    if m:
        return ('_csrf', m.group(1))
    m = re.search(r'value=["\']([^"\']+)["\'][^>]*name=["\']_csrf["\']', html, re.I)
    if m:
        return ('_csrf', m.group(1))
    m = re.search(r'<meta[^>]*name=["\']_csrf["\'][^>]*content=["\']([^"\']+)["\']', html, re.I)
    if m:
        return ('_csrf', m.group(1))
    return None


def _jasper_login():
    """Log in to Jasper, returning an opener carrying the authenticated session.
    Follows the standard Spring Security flow: GET the login page first (to seat
    a JSESSIONID + any CSRF token), then POST credentials. Raises RuntimeError
    with diagnostics on failure."""
    opener, jar = _jasper_build_opener()
    diag = {}

    # 1) GET the login page to establish a session + capture any CSRF token.
    csrf = None
    try:
        req = urllib.request.Request(JASPER_BASE + '/jasperserver/login.html',
                                     headers={'User-Agent': _UA, 'Accept': 'text/html,*/*'})
        with opener.open(req, timeout=30) as r:
            html = r.read().decode('utf-8', 'replace')
        csrf = _jasper_scrape_csrf(html)
        diag['csrf_found'] = bool(csrf)
    except Exception as e:
        diag['get_login_error'] = str(e)

    # 2) POST credentials (include CSRF token if present).
    fields = {'j_username': JASPER_USERNAME, 'j_password': JASPER_PASSWORD}
    if csrf:
        fields[csrf[0]] = csrf[1]
    form = urllib.parse.urlencode(fields).encode('utf-8')
    req = urllib.request.Request(JASPER_LOGIN_URL, data=form, headers={
        'User-Agent': _UA,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': '*/*',
        'Referer': JASPER_BASE + '/jasperserver/login.html',
    })
    try:
        with opener.open(req, timeout=30) as r:
            diag['post_status'] = r.status
            diag['post_final_url'] = r.geturl()
            body = r.read(4096).decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        diag['post_status'] = e.code
        diag['post_final_url'] = getattr(e, 'url', '')
        body = ''
    except Exception as e:
        raise RuntimeError('Jasper login POST failed: %s | diag=%s' % (e, diag))

    diag['cookies'] = [c.name for c in jar]
    final = diag.get('post_final_url', '') or ''
    # Failure signatures: redirected back to login?error, or login form in body.
    if ('login' in final and 'error' in final) or ('j_username' in body and 'j_password' in body):
        raise RuntimeError('Jasper login rejected — credentials or login flow wrong. diag=%s' % diag)
    if not any(c.name == 'JSESSIONID' for c in jar):
        raise RuntimeError('Jasper login: no JSESSIONID cookie. diag=%s' % diag)

    # 3) Verify the session is actually authenticated (not anonymous) by hitting
    #    an endpoint that requires login; the report fetch will confirm anyway.
    _JASPER_LOGIN_DIAG.clear()
    _JASPER_LOGIN_DIAG.update(diag)
    return opener


# Last login attempt diagnostics, surfaced in error responses for debugging.
_JASPER_LOGIN_DIAG = {}


def _jasper_get_opener(force_relogin=False):
    """Return a cached logged-in opener, logging in if needed."""
    global _jasper_opener
    with _jasper_lock:
        if force_relogin or _jasper_opener is None:
            _jasper_opener = _jasper_login()
        return _jasper_opener


def jasper_fetch_xls(report_url):
    """Fetch a Jasper report URL as bytes using the service session.
    Re-logs in once if the session has expired (login page returned).
    Returns bytes. Raises RuntimeError on failure."""
    def _do_fetch(opener):
        req = urllib.request.Request(report_url, headers={
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128',
            'Accept': 'application/vnd.ms-excel, application/octet-stream, */*',
        })
        with opener.open(req, timeout=60) as r:
            return r.read()

    opener = _jasper_get_opener()
    data = _do_fetch(opener)
    # Detect an expired session (Jasper served the login page) and retry once.
    head = data[:512].lower()
    if (b'<html' in head or b'<!doctype' in head) and data[:4] != b'\xd0\xcf\x11\xe0':
        opener = _jasper_get_opener(force_relogin=True)
        data = _do_fetch(opener)
    return data


# ── BIFF8 / OLE2 .xls parser (stdlib) ──────────────────────────
# Ported from the extension's MedicationJourney.parseBiff8ToSheets so the
# server can read Jasper .xls output without third-party deps.
def parse_biff8_to_sheets(buf):
    """Parse OLE2/BIFF8 .xls bytes into [{'name': str, 'rows': [[cell,...]]}]."""
    if len(buf) < 8 or buf[:4] != b'\xd0\xcf\x11\xe0':
        return []

    def u16(off):  return struct.unpack_from('<H', buf, off)[0]
    def u32(off):  return struct.unpack_from('<I', buf, off)[0]
    def i32(off):  return struct.unpack_from('<i', buf, off)[0]

    sector_size        = 1 << u16(0x1E)
    mini_sector_size   = 1 << u16(0x20)
    mini_stream_cutoff = u32(0x38)
    fat_count          = u32(0x2C)
    dir_start          = u32(0x30)
    mini_fat_start     = u32(0x3C)

    fat = []
    for i in range(min(109, fat_count)):
        sec_id = u32(0x4C + i * 4)
        if sec_id >= 0xFFFFFFF8:
            break
        sec_off = (sec_id + 1) * sector_size
        for j in range(sector_size // 4):
            off = sec_off + j * 4
            if off + 4 <= len(buf):
                fat.append(i32(off))

    def read_sector_chain(start_sec, max_bytes=0):
        chunks = []
        sec = start_sec
        total = 0
        while 0 <= sec < 0xFFFFFFF8:
            off = (sec + 1) * sector_size
            length = min(sector_size, len(buf) - off)
            if length <= 0:
                break
            chunks.append(buf[off:off + length])
            total += length
            if max_bytes and total >= max_bytes:
                break
            sec = fat[sec] if sec < len(fat) else -1
        return b''.join(chunks)

    dir_data = read_sector_chain(dir_start)
    dir_count = len(dir_data) // 128
    dir_entries = []
    for i in range(dir_count):
        base = i * 128
        name_len = struct.unpack_from('<H', dir_data, base + 64)[0]
        start = struct.unpack_from('<I', dir_data, base + 116)[0]
        size = struct.unpack_from('<I', dir_data, base + 120)[0]
        name = ''
        for c in range(0, (name_len - 2) if name_len > 0 else 0, 2):
            name += chr(struct.unpack_from('<H', dir_data, base + c)[0])
        dir_entries.append({'name': name, 'start': start, 'size': size})

    if not dir_entries:
        return []
    root_entry = dir_entries[0]
    wb_entry = next((e for e in dir_entries
                     if e['name'].lower() in ('workbook', 'book')), None)
    if not wb_entry:
        return []

    if wb_entry['size'] < mini_stream_cutoff:
        mini_stream = read_sector_chain(root_entry['start'])
        mini_fat_data = read_sector_chain(mini_fat_start)
        mini_fat = list(struct.unpack_from('<%di' % (len(mini_fat_data) // 4),
                                           mini_fat_data, 0)) if mini_fat_data else []
        chunks = []
        msec = wb_entry['start']
        while 0 <= msec < 0xFFFFFFF8:
            off = msec * mini_sector_size
            length = min(mini_sector_size, len(mini_stream) - off)
            if length <= 0:
                break
            chunks.append(mini_stream[off:off + length])
            msec = mini_fat[msec] if msec < len(mini_fat) else -1
        wb = b''.join(chunks)
    else:
        wb = read_sector_chain(wb_entry['start'], wb_entry['size'])

    def decode_biff8_string(data, off, char_count):
        flags = data[off]
        is_wide = (flags & 0x01) != 0
        has_rt = (flags & 0x08) != 0
        has_ext = (flags & 0x04) != 0
        pos = off + 1
        run_count = 0
        ext_len = 0
        if has_rt:
            run_count = struct.unpack_from('<H', data, pos)[0]; pos += 2
        if has_ext:
            ext_len = struct.unpack_from('<I', data, pos)[0]; pos += 4
        chars = []
        if is_wide:
            for _ in range(char_count):
                chars.append(chr(struct.unpack_from('<H', data, pos)[0])); pos += 2
        else:
            for _ in range(char_count):
                chars.append(chr(data[pos])); pos += 1
        pos += run_count * 4 + ext_len
        return ''.join(chars), pos

    sheets = []
    current_sheet = -1
    in_globals = True
    sst = []
    sst_unique = 0
    sst_building = False
    sst_accum = b''

    def parse_accumulated_sst():
        nonlocal sst_building, sst_accum
        if not sst_accum:
            return
        p = 8
        for _ in range(sst_unique):
            if p >= len(sst_accum) - 2:
                break
            cc = struct.unpack_from('<H', sst_accum, p)[0]
            p += 2
            try:
                s, p = decode_biff8_string(sst_accum, p, cc)
                sst.append(s)
            except Exception:
                sst.append('')
                break
        sst_building = False
        sst_accum = b''

    def set_cell(sheet_idx, row, col, val):
        if sheet_idx < 0 or sheet_idx >= len(sheets):
            return
        rows = sheets[sheet_idx]['rows']
        while len(rows) <= row:
            rows.append([])
        r = rows[row]
        while len(r) <= col:
            r.append('')
        r[col] = val

    def decode_rk(rk):
        div100 = (rk & 0x01) != 0
        is_int = (rk & 0x02) != 0
        if is_int:
            num = float(rk >> 2)
        else:
            # Top 30 bits are the high word of an IEEE-754 double; low word = 0.
            # Mask to unsigned 32-bit and pack as unsigned ('<I'), not signed.
            hi = (rk & 0xFFFFFFFC) & 0xFFFFFFFF
            num = struct.unpack('<d', struct.pack('<II', 0, hi))[0]
        if div100:
            num /= 100.0
        return num

    pos = 0
    wb_len = len(wb)
    while pos + 4 <= wb_len:
        rec_type = struct.unpack_from('<H', wb, pos)[0]
        rec_len = struct.unpack_from('<H', wb, pos + 2)[0]
        rec_off = pos + 4
        pos += 4 + rec_len

        if rec_type == 0x003C:  # CONTINUE
            if sst_building and sst_accum:
                sst_accum += wb[rec_off:rec_off + rec_len]
            continue
        if sst_building and sst_accum:
            parse_accumulated_sst()

        if rec_type in (0x0009, 0x0209, 0x0409, 0x0809):  # BOF (0x0809 = BIFF8)
            if rec_len >= 6:
                bof_type = struct.unpack_from('<H', wb, rec_off + 2)[0]
                if bof_type == 0x0010:
                    current_sheet += 1
                    in_globals = False
                elif bof_type == 0x0005:
                    in_globals = True
        elif rec_type == 0x0085:  # BOUNDSHEET
            if rec_len >= 8:
                name_len = wb[rec_off + 6]
                flags = wb[rec_off + 7]
                is_wide = (flags & 0x01) != 0
                name_off = rec_off + 8
                name = ''
                if is_wide:
                    for c in range(name_len):
                        name += chr(struct.unpack_from('<H', wb, name_off + c * 2)[0])
                else:
                    for c in range(name_len):
                        name += chr(wb[name_off + c])
                sheets.append({'name': name, 'rows': []})
        elif rec_type == 0x00FC:  # SST
            if rec_len >= 8:
                sst_unique = struct.unpack_from('<I', wb, rec_off + 4)[0]
                sst_building = True
                sst[:] = []
                sst_accum = wb[rec_off:rec_off + rec_len]
        elif rec_type == 0x00FD:  # LABELSST
            if rec_len >= 10:
                row = struct.unpack_from('<H', wb, rec_off)[0]
                col = struct.unpack_from('<H', wb, rec_off + 2)[0]
                idx = struct.unpack_from('<I', wb, rec_off + 6)[0]
                set_cell(current_sheet, row, col, sst[idx] if idx < len(sst) else '')
        elif rec_type == 0x0204:  # LABEL
            if rec_len >= 9:
                row = struct.unpack_from('<H', wb, rec_off)[0]
                col = struct.unpack_from('<H', wb, rec_off + 2)[0]
                cc = struct.unpack_from('<H', wb, rec_off + 6)[0]
                try:
                    s, _ = decode_biff8_string(wb, rec_off + 8, cc)
                    set_cell(current_sheet, row, col, s)
                except Exception:
                    pass
        elif rec_type == 0x0203:  # NUMBER
            if rec_len >= 14:
                row = struct.unpack_from('<H', wb, rec_off)[0]
                col = struct.unpack_from('<H', wb, rec_off + 2)[0]
                val = struct.unpack_from('<d', wb, rec_off + 6)[0]
                set_cell(current_sheet, row, col, _num_str(val))
        elif rec_type in (0x0027, 0x027E):  # RK
            if rec_len >= 10:
                row = struct.unpack_from('<H', wb, rec_off)[0]
                col = struct.unpack_from('<H', wb, rec_off + 2)[0]
                rk = i32(rec_off + 6)
                set_cell(current_sheet, row, col, _num_str(decode_rk(rk)))
        elif rec_type == 0x00BE:  # MULRK
            if rec_len >= 6:
                row = struct.unpack_from('<H', wb, rec_off)[0]
                first_col = struct.unpack_from('<H', wb, rec_off + 2)[0]
                entry_count = (rec_len - 2) // 6
                for e in range(entry_count):
                    e_off = rec_off + 4 + e * 6
                    if e_off + 6 > rec_off + rec_len:
                        break
                    rk = i32(e_off + 2)
                    set_cell(current_sheet, row, first_col + e, _num_str(decode_rk(rk)))

    if sst_building and sst_accum:
        parse_accumulated_sst()

    for sh in sheets:
        sh['rows'] = [r for r in sh['rows']
                      if r and any(c not in (None, '') for c in r)]
    return sheets


def _num_str(v):
    """Format a numeric cell like JS String(Number) — integers without .0."""
    if v == int(v):
        return str(int(v))
    return repr(v)


# ── Home Medication Sheet (from RT_COMMON_286_UNBILL report) ───
# RT_COMMON_286_UNBILL is the patient charge/order report. It marks the
# discharge / home meds with "(HM)" category headers (e.g.
# "1.1.1 (5) ยาแผนปัจจุบัน-ยาอันตราย (HM)"). Unlike hoamemedthai it fetches
# headlessly with the pp token (same as the working RT_COMMON_257/917 reports).
HM_REPORT_UNIT     = '/BDMS/Other/RT_COMMON_286_UNBILL'
HM_REPORT_TEMPLATE = '5bebdddc7a789a015391a428'


def _build_home_med_jasper_url(ctx, fromdate=None, todate=None):
    """Build the RT_COMMON_286_UNBILL Jasper XLS URL from extracted context.

    NOTE: the pp token's '&' must NOT be percent-encoded — Jasper expects the
    raw `pp=u=..&r=..&o=..` form (see popup.js rawEncode for the RT reports)."""
    if not fromdate or not todate:
        bkk = datetime.now(timezone.utc).timestamp() + 7 * 3600
        end_d = datetime.utcfromtimestamp(bkk)
        start_d = datetime.utcfromtimestamp(bkk - 31 * 24 * 3600)
        fromdate = start_d.strftime('%Y-%m-%dT17:00:00.000Z')
        todate = end_d.strftime('%Y-%m-%dT16:59:59.999Z')

    pp = ctx.get('_pp') or ''
    if not pp and ctx.get('loginuid'):
        o = ctx.get('parentorguid') or ctx.get('organisationuid') or ''
        pp = 'u=%s&r=%s&o=%s' % (ctx.get('loginuid'), ctx.get('roleuid', ''), o)

    params = [
        ('_flowId', 'viewReportFlow'),
        ('output', 'xls'),
        ('reportUnit', HM_REPORT_UNIT),
        ('userTimezone', 'Asia/bangkok'),
        ('decorate', 'no'),
        ('patientuid', ctx.get('patientuid', '')),
        ('patientvisituid', ctx.get('patientvisituid', '')),
        ('fromdate', fromdate),
        ('todate', todate),
        ('loginuid', ctx.get('loginuid', '')),
        ('logindepartmentuid', ctx.get('logindepartmentuid') or ctx.get('departmentuid', '')),
        ('organisationuid', ctx.get('organisationuid', '')),
        ('userLocale', 'th'),
        ('reporttemplateuid', HM_REPORT_TEMPLATE),
        ('preflangcode', 'th'),
        ('isduplicate', 'false'),
    ]
    # Encode everything EXCEPT pp normally; append pp raw (its &/= are literal).
    qs = urllib.parse.urlencode(params)
    # quote pp values but keep the u=..&r=..&o=.. structure literal.
    return JASPER_BASE + '/jasperserver/flow.html?' + qs + '&pp=' + pp


def _hm_norm(s):
    return re.sub(r'\s+', ' ', str(s or '').replace(' ', ' ')).strip()


_HM_FIELD_SYNONYMS = {
    'code':      ['item code', 'drug code', 'code', 'รหัสยา', 'รหัส'],
    'drug':      ['order item', 'drug name', 'medication', 'drug', 'ชื่อยา', 'รายการยา'],
    'dosage':    ['dosage', 'dose', 'ขนาดยา', 'ขนาด'],
    'route':     ['route', 'วิธีให้', 'ทางให้', 'ช่องทาง'],
    'frequency': ['frequency', 'freq', 'ความถี่'],
    'duration':  ['duration', 'ระยะเวลา', 'จำนวนวัน'],
    'quantity':  ['quantity', 'qty', 'จำนวน'],
    'comment':   ['comments', 'comment', 'instruction', 'instructions', 'sig',
                  'หมายเหตุ', 'คำแนะนำ', 'วิธีใช้', 'administration instruction'],
    'provider':  ['careprovider', 'care provider', 'physician', 'doctor', 'แพทย์', 'ผู้สั่ง'],
    'status':    ['status', 'สถานะ'],
}

_HM_DROP = [
    r'\binject\b', r'\binfuse\b', r'\binfusion\b', r'\bintravenous\b',
    r'\bINJ\b', r'\bvial\b', r'\bamp(?:oule|ule)?\b', r'\bbag\b',
    r'\bsyringe\b', r'\bcontinuous\b', r'ฉีด',
]
_HM_KEEP = [
    r'\btake\b', r'\boral', r'\bp\.?o\.?\b', r'\bswallow\b', r'รับประทาน', r'กิน',
    r'\bspray\b', r'สเปรย์', r'พ่น',
    r'\bapply\b', r'\btopical\b', r'\bgel\b', r'\bcream\b', r'\bointment\b', r'ทา',
    r'\bdrop\b', r'หยอด', r'\bnasal\b', r'\bnostril\b', r'จมูก',
    r'\bsublingual\b', r'\bbuccal\b', r'อม', r'\bsachet\b', r'ซอง',
    r'\bsuck\b', r'\bchew\b', r'เคี้ยว',
]


def _hm_map_headers(header_row):
    field_idx = {}
    used = set()
    unmatched = []
    for i, raw in enumerate(header_row):
        h = _hm_norm(raw).lower()
        if not h:
            continue
        best_field, best_len = None, 0
        for field, syns in _HM_FIELD_SYNONYMS.items():
            if field in used:
                continue
            for syn in syns:
                if syn in h and len(syn) > best_len:
                    best_field, best_len = field, len(syn)
        if best_field:
            field_idx[i] = best_field
            used.add(best_field)
        else:
            unmatched.append({'index': i, 'header': _hm_norm(raw)})
    return field_idx, unmatched


def _hm_is_take_home(med):
    text = ' '.join([med.get('route', ''), med.get('comment', ''),
                     med.get('drug', ''), med.get('frequency', ''),
                     med.get('dosage', ''), med.get('quantity', '')])
    for p in _HM_DROP:
        if re.search(p, text, re.I):
            return False
    for p in _HM_KEEP:
        if re.search(p, text, re.I):
            return True
    return False


# RT_COMMON_286 header labels: "ชื่อผู้ป่วย : ...", "HN: ...", "EN: ...",
# "Room: ...", "วันที่รับผู้ป่วย :...". Values may be inline (after ':') or in
# the adjacent cell.
_HM_HEADER_FIELDS = {
    'patientName': [r'ชื่อผู้ป่วย', r'^name$'],
    'hn':          [r'^hn\b'],
    'an':          [r'^en\b'],            # EN = visit/admission number
    'room':        [r'^room\b'],
    'visitDate':   [r'วันที่รับผู้ป่วย', r'visit\s*date'],
}
# Fields whose value must NOT look like a date (avoids grabbing an adjacent date).
_HM_NO_DATE_FIELDS = {'room', 'patientName', 'hn', 'an'}


def _hm_looks_numeric(s):
    try:
        float(s)
        return True
    except (TypeError, ValueError):
        return False


def _hm_next_text_cell(row, start):
    """Next non-empty, non-numeric STRING cell after index `start` (skips the
    float garbage RT_COMMON_286 puts between label and value cells)."""
    for j in range(start + 1, len(row)):
        v = _hm_norm(row[j])
        if v and not _hm_looks_numeric(v):
            return v
    return ''


def _hm_extract_header(sheets):
    out = {}
    for sh in sheets:
        for row in sh.get('rows', []):
            for c, cell_raw in enumerate(row):
                cell = _hm_norm(cell_raw)
                if not cell:
                    continue
                label = re.sub(r'[:：]\s*$', '', cell)
                for field, pats in _HM_HEADER_FIELDS.items():
                    if field in out:
                        continue
                    if any(re.search(p, label, re.I) for p in pats):
                        # Value may be inline after ':' or in the next text cell.
                        inline = ''
                        if ':' in cell or '：' in cell:
                            inline = re.split(r'[:：]', cell, 1)[1].strip()
                        val = inline or _hm_next_text_cell(row, c)
                        if not val:
                            continue
                        # Reject pure numeric garbage.
                        if _hm_looks_numeric(val):
                            continue
                        # Reject date values for non-date fields (room/name/hn/an).
                        if field in _HM_NO_DATE_FIELDS and _HM_DATE.search(val):
                            continue
                        out[field] = val
    return out


def _row_text(row):
    """Join a row's non-empty cells into one normalized string."""
    return _hm_norm(' '.join(_hm_norm(c) for c in row if _hm_norm(c)))


# Category header markers in RT_COMMON_286. "(HM)" = home/discharge meds.
_HM_SECTION_HM   = re.compile(r'\(HM\)')
# A category/section header line starts with a dotted code like "1.1.1 (5)".
_HM_SECTION_HEAD = re.compile(r'^\d+\.\d+(?:\.\d+)?\s*\(\d+\)')
# An instruction line begins with an administration verb (EN) seen in the report.
_HM_INSTRUCTION  = re.compile(
    r'\b(take|inject|infuse|apply|spray|chew|as directed|instill|swallow|use|drop)\b',
    re.I)
# A drug line in the body has: <seq#> <drug name ...> <DD/MM/YYYY> <qty> <price> ...
_HM_DATE = re.compile(r'\b\d{2}/\d{2}/\d{4}\b')


def _cell(row, i):
    return _hm_norm(row[i]) if i < len(row) else ''


def build_home_med_from_sheets(sheets):
    """Parse RT_COMMON_286_UNBILL into home meds.

    Fixed-column layout (confirmed from the real XLS):
      col 3  = drug name (drug row) OR instruction text (next row)
      col 15 = order date DD/MM/YYYY  → marks a DRUG row
      col 25 = physician (on the instruction row)
    Category headers sit in col 1 or 2, e.g. '1.1.1 (5) ...ยาอันตราย (HM)'.
    Keep items under an (HM) section that pass the oral/take-home filter.
    """
    sh = max(sheets, key=lambda s: len(s.get('rows', [])), default=None)
    rows = sh.get('rows', []) if sh else []

    NAME_COL, DATE_COL, QTY_COL, PROV_COL = 3, 15, 19, 25
    meds = []
    all_count = 0
    in_hm = False
    cur = None
    sections_seen = []   # diagnostics: every category header encountered

    def _flush():
        nonlocal cur
        if cur and cur.get('drug'):
            meds.append(cur)
        cur = None

    in_drug = False   # true while inside a medicine section (code 1.1.x)
    for row in rows:
        cat = _cell(row, 1) or _cell(row, 2)
        if cat and _HM_SECTION_HEAD.match(cat):
            _flush()
            in_hm = bool(_HM_SECTION_HM.search(cat))
            # Medicine sections are coded "1.1.x"; fees/supplies/food are not.
            in_drug = bool(re.match(r'^\s*1\.1(?:\.\d+)?\s*\(', cat))
            sections_seen.append({'label': cat, 'hm': in_hm, 'drug': in_drug})
            continue

        name = _cell(row, NAME_COL)
        date = _cell(row, DATE_COL)

        # Drug row: text in name col AND a date in the date col.
        if name and _HM_DATE.search(date or ''):
            _flush()
            all_count += 1
            qty = _cell(row, QTY_COL)
            cur = {
                'drug': name, 'quantity': qty, 'comment': '',
                'route': '', 'frequency': '', 'dosage': '', 'code': '',
                'provider': '', '_hm': in_hm, '_drug': in_drug,
            }
            continue

        # Instruction row: text in name col, begins with an admin verb, no date.
        if cur and name and _HM_INSTRUCTION.search(name) and not _HM_DATE.search(name):
            cur['comment'] = name
            mm = re.match(r'^\s*([A-Za-z][A-Za-z ]+?)\s', name)
            if mm:
                cur['route'] = mm.group(1).strip()
            cur['provider'] = _cell(row, PROV_COL)
            _flush()
            continue

    _flush()

    # Initial list: prefer meds under (HM) discharge sections. If the report has
    # no (HM) sections yet (e.g. patient still admitted, discharge meds not
    # finalized), fall back to ALL meds so the pharmacist can prune in the UI.
    hm_count = sum(1 for s in sections_seen if s['hm'])
    used_fallback = hm_count == 0
    kept = []
    for m in meds:
        if used_fallback:
            # Fallback: medicine sections only (drop nursing/room/supply/food).
            if not m.get('_drug'):
                continue
        else:
            if not m.get('_hm'):
                continue
        m['oral'] = _hm_is_take_home(m)
        m.pop('_hm', None)
        m.pop('_drug', None)
        kept.append(m)

    return {
        'patient': _hm_extract_header(sheets),
        'meds': kept,
        'allMeds': all_count,
        'unmatched': [],
        'sections': sections_seen,
        'hmSectionCount': hm_count,
        'usedFallback': used_fallback,
    }


# ── KPI helpers (per-day files) ────────────────────────────────
def kpi_file(date_key):
    return KPI_DIR / f'{date_key}.json'

def _now_iso():
    return datetime.now(timezone.utc).isoformat()

def _atomic_write_text(path, text, encoding='utf-8'):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f'.{p.name}.', suffix='.tmp', dir=str(p.parent))
    try:
        with os.fdopen(fd, 'w', encoding=encoding) as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, str(p))
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


# ── HTTP handler ───────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f'  [{self.address_string()}]  {fmt % args}')

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

        # /api/report/home-med  — server-side Jasper login + parse
        if parts == ['api', 'report', 'home-med']:
            return 'report-home-med', None, None

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

        # ── Home Medication Sheet: build the hoamemedthai URL from context
        #    and fetch it exactly like the working RT reports (plain urlopen —
        #    the pp token authenticates; NO Jasper login). Parse + oral-filter. ──
        if rtype == 'report-home-med':
            ctx = body.get('context') or {}
            if not ctx.get('patientvisituid'):
                self.send_json(400, {'error': 'context.patientvisituid required'}); return
            url = _build_home_med_jasper_url(ctx, body.get('fromdate'), body.get('todate'))
            try:
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125',
                    'Accept': 'application/vnd.ms-excel, application/octet-stream, */*',
                })
                with urllib.request.urlopen(req, timeout=60) as r:
                    data = r.read()
            except urllib.error.URLError as e:
                self.send_json(502, {'error': f'Cannot reach report server: {getattr(e, "reason", str(e))}', 'url': url}); return
            except Exception as e:
                self.send_json(500, {'error': f'Fetch error: {e}', 'url': url}); return

            if data[:4] != b'\xd0\xcf\x11\xe0':
                head = data[:200].decode('utf-8', 'replace')
                is_login = '<html' in head.lower() or 'login' in head.lower()
                self.send_json(502, {
                    'error': 'Jasper did not return an XLS (likely a login/error page). '
                             'Check the pp token / report parameters.',
                    'isLoginPage': is_login,
                    'bytes': len(data),
                }); return

            # Persist a copy for debugging/audit (best-effort).
            try:
                TEMP_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
                ts = datetime.now().strftime('%Y%m%d_%H%M%S')
                (TEMP_REPORTS_DIR / f'homemed_{ts}.xls').write_bytes(data)
            except Exception:
                pass

            try:
                sheets = parse_biff8_to_sheets(data)
                result = build_home_med_from_sheets(sheets)
            except Exception as e:
                self.send_json(500, {'error': f'Parse error: {e}', 'url': url}); return

            result['ok'] = True
            result['url'] = url
            # Debug: include the raw parsed rows (first sheet, capped) so the
            # row-scanner can be tuned to the real XLS layout if needed.
            if body.get('debug'):
                big = max(sheets, key=lambda s: len(s.get('rows', [])), default={'rows': []})
                result['rawRows'] = [r for r in big.get('rows', [])][:120]
                result['sheetInfo'] = [{'name': s.get('name'), 'rows': len(s.get('rows', []))} for s in sheets]
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

    ip = get_local_ip()
    Handler._ip   = ip
    Handler._port = port
    server = ThreadingHTTPServer(('0.0.0.0', port), Handler)

    print()
    print('  ╔══════════════════════════════════════════════╗')
    print('  ║   BKN Pharmacy — Knowledge Sharing Server    ║')
    print('  ╚══════════════════════════════════════════════╝')
    print()
    print(f'  Server URL  :  http://{ip}:{port}')
    print(f'  KPI data    :  {KPI_DIR.resolve()}')
    print(f'  KS data     :  {KS_DIR.resolve()}')
    print(f'  RX data     :  {RX_DIR.resolve()}')
    print(f'  Med images  :  {MED_IMAGES_DIR.resolve()}  ({len(list(MED_IMAGES_DIR.glob("*")))} files)')
    print()
    print('  ── How to connect ──────────────────────────────')
    print('  1. Copy the Server URL above.')
    print('  2. Open the KPI or Knowledge app in the extension.')
    print('  3. Set Server URL → Save.')
    print()
    print('  Press Ctrl+C to stop.')
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Server stopped.')


if __name__ == '__main__':
    main()
