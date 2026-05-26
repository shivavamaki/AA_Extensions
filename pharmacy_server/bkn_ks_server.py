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
"""

import hashlib
import json
import mimetypes
import re
import secrets
import sys
import socket
import urllib.parse
from datetime import datetime, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
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
SCHEDULE_DIR  = DATA_DIR / 'schedule'
WWW_DIR       = Path(__file__).parent / 'www'
KS_COLS       = {'faqs', 'items', 'vdos'}
# All rx collections — GET is public; PUT requires editor/admin auth
RX_COLS       = {'premix-drugs', 'mixing-protocols', 'medication-db', 'iv-drugs', 'iv-staff'}
# Requests from this Chrome extension may read/write data without login
EXTENSION_ORIGIN = 'chrome-extension://eeglifkmgelepjmnnldknacamedmckbj'
# medication-db is a dict; all others are arrays
RX_DICT_COLS  = {'medication-db'}
DATE_RE       = re.compile(r'^\d{4}-\d{2}-\d{2}$')
SECTION_KEYS  = {'opd-brief', 'ipd-brief', 'opd-stat', 'ipd-stat'}
SECTION_FIELD = {
    'opd-brief': 'opdBrief',
    'ipd-brief': 'ipdBrief',
    'opd-stat':  'opdStat',
    'ipd-stat':  'ipdStat',
}


# ── KPI helpers (per-day files) ────────────────────────────────
def kpi_file(date_key):
    return KPI_DIR / f'{date_key}.json'

def _now_iso():
    return datetime.now(timezone.utc).isoformat()

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
    KPI_DIR.mkdir(parents=True, exist_ok=True)
    data['updatedAt'] = _now_iso()
    kpi_file(date_key).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

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
    KS_DIR.mkdir(parents=True, exist_ok=True)
    ks_file(col).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )


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
    RX_DIR.mkdir(parents=True, exist_ok=True)
    rx_file(col).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )


# ── Schedule helpers ──────────────────────────────────────────
def schedule_file(name):
    return SCHEDULE_DIR / f'{name}.json'

def load_schedule(name):
    p = schedule_file(name)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return None

def save_schedule(name, data):
    SCHEDULE_DIR.mkdir(parents=True, exist_ok=True)
    schedule_file(name).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )


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
    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    AUTH_FILE.write_text(
        json.dumps(users, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )

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
        if origin == EXTENSION_ORIGIN:
            return True
        # Also trust requests from the local machine (background service worker
        # sends the extension origin, but if the extension ID ever changes the
        # client_address fallback keeps local-only writes working).
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
        raw   = self.path.split('?')[0]
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

        # /api/schedule/state  or  /api/schedule/bookings
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'schedule' and parts[2] in ('state', 'bookings'):
            return 'schedule', parts[2], None

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
        clean = self.path.split('?')[0]
        if clean in ('/', '/index.html', ''):
            self._serve_file(WWW_DIR / 'index.html', 'text/html; charset=utf-8'); return
        if clean.startswith('/static/'):
            self._serve_file(WWW_DIR / clean.lstrip('/'), None); return

        # ── Med images ─────────────────────────────────────────
        if clean.startswith('/med-images/'):
            fname = clean[12:]          # strip leading '/med-images/'
            if not fname or '/' in fname or fname.startswith('.'):
                self.send_json(403, {'error': 'Forbidden'}); return
            self._serve_file(MED_IMAGES_DIR / fname, None); return

        # ── KS files (images / PDFs) ────────────────────────────
        if clean.startswith('/ks-files/'):
            fname = clean[10:]          # strip leading '/ks-files/'
            if not fname or '/' in fname or fname.startswith('.'):
                self.send_json(403, {'error': 'Forbidden'}); return
            self._serve_file(KS_FILES_DIR / fname, None); return

        # ── API ────────────────────────────────────────────────
        if self.path == '/ping':
            self.send_json(200, {
                'ok': True, 'server': 'BKN KS Server',
                'url': f'http://{Handler._ip}:{Handler._port}'
            })
            return

        rtype, key, _ = self.parse_route()

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
        else:
            self.send_json(404, {'error': 'Not found'})

    def _serve_file(self, path, content_type):
        p = Path(path)
        if not p.exists() or not p.is_file():
            self.send_json(404, {'error': 'File not found'}); return
        data = p.read_bytes()
        ct = content_type or mimetypes.guess_type(str(p))[0] or 'application/octet-stream'
        self.send_response(200)
        self.send_header('Content-Type', ct)
        self.send_header('Content-Length', str(len(data)))
        self._cors()
        self.end_headers()
        self.wfile.write(data)

    # PUT — full day doc OR single section OR rx collection OR user
    def do_PUT(self):
        rtype, key, extra = self.parse_route()
        # Allow the trusted Chrome extension to write data routes without login.
        # User-management routes always require explicit auth.
        ext_data_write = self._is_trusted_extension() and rtype in ('kpi-day', 'kpi-section', 'ks', 'rx', 'med-image-upload', 'ks-file-upload', 'schedule')
        if not ext_data_write:
            if not self._require('super_admin', 'admin', 'editor'): return

        if rtype == 'med-image-upload':
            safe_name = Path(key).name
            if not safe_name:
                self.send_json(400, {'error': 'Invalid filename'}); return
            length = int(self.headers.get('Content-Length', 0))
            data   = self.rfile.read(length)
            if not data:
                self.send_json(400, {'error': 'Empty body'}); return
            (MED_IMAGES_DIR / safe_name).write_bytes(data)
            self.send_json(200, {'ok': True, 'file': safe_name})
            return

        if rtype == 'ks-file-upload':
            safe_name = Path(key).name
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
    server = HTTPServer(('0.0.0.0', port), Handler)

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
