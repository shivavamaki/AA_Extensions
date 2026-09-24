"""Exercise deployment code without importing the server or touching live data."""
import ast
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parent
RETIRED = ['/update-extension.bat', '/BKN-Update-Extension.bat', '/bkn-install.bat',
           '/install.bat', '/ext-sync.bat', '/ext-sync']
ROUTES = set(RETIRED + ['/ext-download', '/api/ext-version', '/update-extension',
                        '/update-extension.html', '/reload-extension', '/reload-extension.html'])


def load_deployment(source, directory):
    tree = ast.parse(source.read_text(encoding='utf-8'))
    names = {'_ext_manifest_version', '_ext_id_from_key', '_ext_pkg_info', '_ext_build_zip'}
    nodes = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
    nodes += [n for n in tree.body if isinstance(n, ast.Assign) and
              any(isinstance(t, ast.Name) and t.id in {'EXT_SKIP_EXT', 'EXT_SKIP_DIRS'} for t in n.targets)]
    handler = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'Handler')
    get = next(n for n in handler.body if isinstance(n, ast.FunctionDef) and n.name == 'do_GET')
    branches = [n for n in ast.walk(get) if isinstance(n, ast.If) and
                any(isinstance(v, ast.Constant) and isinstance(v.value, str) and v.value in ROUTES
                    for v in ast.walk(n.test))]
    route = ast.parse('def route(self, clean):\n    pass\n').body[0]
    route.body = branches
    nodes.append(route)
    env = dict(Path=Path, os=os, json=json, zipfile=zipfile, hashlib=hashlib,
               base64=base64, shutil=shutil, __file__=str(source),
               EXT_SRC_DIR=directory/'src', EXT_PKG_DIR=directory/'pkg', WWW_DIR=ROOT/'www')
    exec(compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), str(source), 'exec'), env)
    return env


class Response:
    def __init__(self):
        self.wfile = io.BytesIO()
        self.headers = {}
        self.status = None
    def send_json(self, status, data):
        self.status, self.data = status, data
    def send_response(self, status):
        self.status = status
    def send_header(self, key, value):
        self.headers[key] = value
    def _cors(self): pass
    def end_headers(self): pass
    def _serve_file(self, path, mime):
        self.status = 200 if path.exists() else 404
        self.wfile.write(path.read_bytes())


class ManualUpdateTests(unittest.TestCase):
    def test_packages_and_routes_in_both_server_copies(self):
        for source in [ROOT/'bkn_ks_server.py', ROOT/'pharmacy_server/bkn_ks_server.py']:
            with self.subTest(server=source), tempfile.TemporaryDirectory() as temp:
                directory = Path(temp)
                src = directory/'src'
                src.mkdir()
                (src/'manifest.json').write_text('{"version":"3.61.0"}')
                (src/'app.js').write_text('// extension')
                (src/'bkn-install.bat').write_text('@echo off')
                (src/'OLD.CMD').write_text('@echo off')
                env = load_deployment(source, directory)
                for url in RETIRED:
                    result = Response()
                    env['route'](result, url)
                    self.assertEqual(result.status, 410, url)
                    self.assertIn('/update-extension.html', result.data['error'])
                for url in ['/update-extension', '/update-extension.html']:
                    result = Response()
                    env['route'](result, url)
                    self.assertEqual(result.status, 200)
                    self.assertIn(b'href="/ext-download"', result.wfile.getvalue())
                    self.assertNotIn(b'href="/bkn-install.bat"', result.wfile.getvalue())
                result = Response()
                env['route'](result, '/api/ext-version')
                self.assertEqual(result.data['version'], '3.61.0')
                result = Response()
                env['route'](result, '/ext-download')
                self.assertEqual(result.status, 200)
                with zipfile.ZipFile(io.BytesIO(result.wfile.getvalue())) as package:
                    self.assertEqual(set(package.namelist()), {'manifest.json', 'app.js'})
                self.assertIn('3.61.0.zip', result.headers['Content-Disposition'])

    def test_real_extension_package(self):
        with tempfile.TemporaryDirectory() as temp:
            env = load_deployment(ROOT/'bkn_ks_server.py', Path(temp))
            env['EXT_SRC_DIR'] = ROOT.parent/'BKNPharmacyPortal'
            package = env['_ext_build_zip']()
            with zipfile.ZipFile(package) as archive:
                names = archive.namelist()
                self.assertEqual(json.loads(archive.read('manifest.json'))['version'],
                                 json.loads((env['EXT_SRC_DIR']/'manifest.json').read_text(encoding='utf-8'))['version'])
                self.assertFalse(any(n.lower().endswith(('.bat', '.cmd')) for n in names))
                self.assertIn('src/features/home-med/content-home-med.js', names)
                self.assertIsNone(archive.testzip())


if __name__ == '__main__':
    unittest.main()
