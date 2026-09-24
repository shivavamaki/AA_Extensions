"""Synthetic storage and HTTP checks; never use live pharmacy data."""
import concurrent.futures
import json
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch
import medication_preparation as prep
import bkn_ks_server as app

STAFF = [{'name': 'Synthetic Staff', 'role': 'pharmacist'}, {'name': 'Synthetic Two', 'role': 'staff'}]
NOW = datetime(2026, 9, 22, 4, tzinfo=timezone.utc)
BODY = {'staffName': 'Synthetic Staff', 'orderNumber': 'I-TEST-001', 'scanDate': '2026-09-22'}

class PreparationTests(unittest.TestCase):
    def test_atomic_concurrent_duplicate_and_independent_staff(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(lambda _: prep.save(root, BODY, STAFF, app._atomic_write_json, NOW), range(8)))
            self.assertEqual(sum(created for _, created in results), 1)
            self.assertEqual(len({doc['id'] for doc, _ in results}), 1)
            prep.save(root, dict(BODY, staffName='Synthetic Two'), STAFF, app._atomic_write_json, NOW)
            rows = prep.list_records(root, '2026-09-22', '2026-09-22')
            self.assertEqual(rows['total'], 2)
            self.assertEqual(prep.list_records(root,'2026-09-22','2026-09-22',staff='Synthetic Two')['total'],1)
            self.assertEqual(prep.list_records(root,'2026-09-22','2026-09-22',order='NOT-FOUND')['total'],0)
            self.assertEqual(len(prep.list_records(root,'2026-09-22','2026-09-22',limit=1)['rows']),1)
            self.assertEqual(rows['rows'][0]['identityMethod'], 'staff-selection')

    def test_validation_and_midnight_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for body in [dict(BODY,staffName='Missing'),dict(BODY,orderNumber='../bad'),dict(BODY,scanDate='../bad'),dict(BODY,scanDate='2026-09-23'),dict(BODY,orderNumber='X123')]:
                with self.assertRaises(ValueError): prep.save(root,body,STAFF,app._atomic_write_json,NOW)
            late = dict(BODY,scanDate='2026-09-21')
            record, created = prep.save(root,late,STAFF,app._atomic_write_json,NOW)
            self.assertTrue(created)
            self.assertEqual(record['date'],'2026-09-22')
            self.assertEqual(prep.list_records(root,'2026-09-22','2026-09-22')['total'],1)
            retry, created = prep.save(root,late,[],app._atomic_write_json,datetime(2026,9,25,tzinfo=timezone.utc))
            self.assertFalse(created)
            self.assertEqual(retry,record)

    def test_http_routes_origin_gate_and_duplicate_response(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(app,'MED_PREPARATION_DIR',Path(directory)), patch.object(app,'load_rx',return_value=STAFF):
            server = app.ThreadingHTTPServer(('127.0.0.1',0),app.Handler)
            thread = threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            base = 'http://127.0.0.1:%d' % server.server_port
            body = dict(BODY,scanDate=app._hmq_today())
            def post(origin, payload=body):
                req = urllib.request.Request(base+'/api/medication-preparations',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Origin':origin})
                with urllib.request.urlopen(req) as response: return response.status,json.load(response)
            try:
                with patch.object(app,'_log_untrusted_write'):
                    with self.assertRaises(urllib.error.HTTPError) as denied: post('https://example.com')
                    self.assertEqual(denied.exception.code,401)
                status, result = post(base);self.assertEqual(status,201);self.assertFalse(result['duplicate'])
                status, result = post(base);self.assertEqual(status,200);self.assertTrue(result['duplicate'])
                with urllib.request.urlopen(base+'/api/medication-preparations') as response:
                    self.assertEqual(response.headers['Cache-Control'],'no-store')
                    self.assertEqual(json.load(response)['total'],1)
                for route in ['/static/medication-preparation/index.html','/static/medication-preparation/prepare.js','/static/medication-preparation/prepare.css']:
                    with urllib.request.urlopen(base+route) as response: self.assertEqual(response.status,200)
            finally: server.shutdown();server.server_close()

if __name__ == '__main__': unittest.main()
