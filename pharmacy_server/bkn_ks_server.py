#!/usr/bin/env python3
"""
BKN Pharmacy — Knowledge Sharing Server
User-level: no admin rights or pip install required.
Uses only Python built-in libraries (Python 3.6+).

Usage:
  python bkn_ks_server.py
  python bkn_ks_server.py --port 9000

API:
  GET  /ping            — health check
  GET  /api/{col}       — get all records (col = faqs | items | vdos)
  PUT  /api/{col}       — replace entire collection (JSON array in body)

Data stored as JSON files in ./data/
"""

import json
import os
import sys
import socket
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# ── Config ─────────────────────────────────────────────────────
DEFAULT_PORT = 8765
DATA_DIR     = Path(__file__).parent / 'data'
COLLECTIONS  = {'faqs', 'items', 'vdos', 'kpi'}


# ── File helpers ───────────────────────────────────────────────
def data_file(col):
    return DATA_DIR / f'{col}.json'

def load(col):
    p = data_file(col)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        return []

def save_col(col, data):
    DATA_DIR.mkdir(exist_ok=True)
    data_file(col).write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding='utf-8'
    )


# ── HTTP handler ───────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f'  [{self.address_string()}]  {fmt % args}')

    # CORS headers on every response
    def _cors(self):
        self.send_header('Access-Control-Allow-Origin',  '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')

    def send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type',   'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def parse_col(self):
        """Return collection name from /api/{col}, or None."""
        parts = self.path.split('?')[0].strip('/').split('/')
        if len(parts) == 2 and parts[0] == 'api' and parts[1] in COLLECTIONS:
            return parts[1]
        return None

    # OPTIONS (preflight)
    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    # GET
    def do_GET(self):
        if self.path == '/ping':
            self.send_json(200, {'ok': True, 'server': 'BKN KS Server'})
            return
        col = self.parse_col()
        if col:
            self.send_json(200, load(col))
        else:
            self.send_json(404, {'error': 'Not found'})

    # POST — append one record (kpi only)
    def do_POST(self):
        col = self.parse_col()
        if col != 'kpi':
            self.send_json(405, {'error': 'POST only supported for /api/kpi'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            record = json.loads(self.rfile.read(length))
            if not isinstance(record, dict):
                raise ValueError('Body must be a JSON object')
            data = load(col)
            data.append(record)
            save_col(col, data)
            self.send_json(200, {'ok': True, 'count': len(data)})
        except Exception as e:
            self.send_json(400, {'error': str(e)})

    # PUT — replace entire collection (faqs / items / vdos)
    def do_PUT(self):
        col = self.parse_col()
        if not col:
            self.send_json(404, {'error': 'Not found'})
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            body   = json.loads(self.rfile.read(length))
            if not isinstance(body, list):
                raise ValueError('Body must be a JSON array')
            save_col(col, body)
            self.send_json(200, {'ok': True, 'count': len(body)})
        except Exception as e:
            self.send_json(400, {'error': str(e)})


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

    # Init empty data files on first run
    DATA_DIR.mkdir(exist_ok=True)
    for col in COLLECTIONS:
        p = data_file(col)
        if not p.exists():
            p.write_text('[]', encoding='utf-8')

    ip     = get_local_ip()
    server = HTTPServer(('0.0.0.0', port), Handler)

    print()
    print('  ╔══════════════════════════════════════════════╗')
    print('  ║   BKN Pharmacy — Knowledge Sharing Server    ║')
    print('  ╚══════════════════════════════════════════════╝')
    print()
    print(f'  Server URL  :  http://{ip}:{port}')
    print(f'  Data folder :  {DATA_DIR.resolve()}')
    print()
    print('  ── How to connect ──────────────────────────────')
    print('  1. Copy the Server URL above.')
    print('  2. Open Knowledge app in the extension.')
    print('  3. Go to Admin → Settings → paste URL → Save.')
    print()
    print('  Press Ctrl+C to stop.')
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Server stopped.')


if __name__ == '__main__':
    main()
