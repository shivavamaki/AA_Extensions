#!/usr/bin/env python3
"""
BKN Pharmacy — Knowledge Sharing Server
User-level: no admin rights or pip install required.
Uses only Python built-in libraries (Python 3.6+).

Usage:
  python bkn_ks_server.py
  python bkn_ks_server.py --port 9000

API:
  GET  /ping                  — health check (returns server URL)
  GET  /api/kpi               — list all daily KPI docs (sorted newest first)
  GET  /api/kpi/YYYY-MM-DD    — get one day's KPI doc (null if not exists)
  PUT  /api/kpi/YYYY-MM-DD    — save/update one day's KPI doc (JSON object)
  GET  /api/{ks_col}          — get KS collection (faqs | items | vdos)
  PUT  /api/{ks_col}          — replace KS collection (JSON array)

Data layout:
  data/kpi/YYYY-MM-DD.json    — one file per day
  data/ks/faqs.json
  data/ks/items.json
  data/ks/vdos.json
"""

import json
import re
import sys
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────
DEFAULT_PORT = 8765
DATA_DIR     = Path(__file__).parent / 'data'
KPI_DIR      = DATA_DIR / 'kpi'
KS_DIR       = DATA_DIR / 'ks'
KS_COLS      = {'faqs', 'items', 'vdos'}
DATE_RE      = re.compile(r'^\d{4}-\d{2}-\d{2}$')


# ── KPI helpers (per-day files) ────────────────────────────────
def kpi_file(date_key):
    return KPI_DIR / f'{date_key}.json'

def load_kpi_day(date_key):
    p = kpi_file(date_key)
    if not p.exists():
        return None
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return None

def save_kpi_day(date_key, data):
    KPI_DIR.mkdir(parents=True, exist_ok=True)
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


# ── HTTP handler ───────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f'  [{self.address_string()}]  {fmt % args}')

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type',   'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def parse_route(self):
        """Return (route_type, key).
        route_type: 'kpi-all' | 'kpi-day' | 'ks' | None
        key: date string for kpi-day, col name for ks, None otherwise.
        """
        parts = self.path.split('?')[0].strip('/').split('/')
        if len(parts) == 2 and parts[0] == 'api':
            col = parts[1]
            if col == 'kpi':
                return 'kpi-all', None
            if col in KS_COLS:
                return 'ks', col
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'kpi':
            date_key = parts[2]
            if DATE_RE.match(date_key):
                return 'kpi-day', date_key
        return None, None

    # OPTIONS (preflight)
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # GET
    def do_GET(self):
        if self.path == '/ping':
            self.send_json(200, {
                'ok':     True,
                'server': 'BKN KS Server',
                'url':    f'http://{Handler._ip}:{Handler._port}'
            })
            return
        rtype, key = self.parse_route()
        if rtype == 'kpi-all':
            self.send_json(200, load_all_kpi())
        elif rtype == 'kpi-day':
            self.send_json(200, load_kpi_day(key))   # null if not exists
        elif rtype == 'ks':
            self.send_json(200, load_ks(key))
        else:
            self.send_json(404, {'error': 'Not found'})

    # PUT
    def do_PUT(self):
        rtype, key = self.parse_route()
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length))
        except Exception as e:
            self.send_json(400, {'error': str(e)})
            return

        if rtype == 'kpi-day':
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            save_kpi_day(key, body)
            self.send_json(200, {'ok': True})
        elif rtype == 'ks':
            if not isinstance(body, list):
                self.send_json(400, {'error': 'Body must be a JSON array'}); return
            save_ks(key, body)
            self.send_json(200, {'ok': True, 'count': len(body)})
        else:
            self.send_json(404, {'error': 'Not found'})


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
    for col in KS_COLS:
        p = ks_file(col)
        if not p.exists():
            p.write_text('[]', encoding='utf-8')

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
