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
  GET    /api/server-status                 — dashboard status (incl. ArcusAir monitor under .arcus)
  GET    /api/arcus-stats                   — ArcusAir upstream call stats (counts, latency, error rate)
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
  PUT    /api/rx-note/{code}                 — set a drug's Patient Instruction (body {th, en?, manual?})
  DELETE /api/rx-note/{code}                 — remove a drug's Patient Instruction(s)

  GET    /api/patients/{puid}                                — full patient profile
  PUT    /api/patients/{puid}                                — replace patient profile
  GET    /api/patients/{puid}/context                        — patient context only
  PUT    /api/patients/{puid}/context                        — merge into context
  GET    /api/patients/{puid}/adr-timeline                   — ADR timeline data
  PUT    /api/patients/{puid}/adr-timeline                   — replace ADR timeline
  GET    /api/patients/{puid}/medication-cache/{visituid}    — cached meds for visit
  PUT    /api/patients/{puid}/medication-cache/{visituid}    — store cached meds
  GET    /api/patients/{puid}/captures/{visituid}            — client capture bag (record 7d; token 24h)
  PUT    /api/patients/{puid}/captures/{visituid}            — merge into capture bag

  GET    /api/report-cache/{key}[/{date}]    — parsed report rows+meta for the day ({} if none); 1-day retention
  PUT    /api/report-cache/{key}/{date}      — store parsed report rows+meta (trusted extension)

  GET    /api/hmr                           — all HM Process records (?from=&to=, newest first)
  GET    /api/hmr/{visitid}                 — one record (I48-xx-xxxxxx), {} if none
  PUT    /api/hmr/{visitid}                 — read-merge-write; auditLog entries append, never overwrite

  GET    /api/opd-queue                     — OPD dispensing queue + stats (?from=&to=, newest first; default today)
  POST   /api/opd-queue                     — send a case {hn,name,visitId,room,meds[],pharmacistNote,sentBy}
  PUT    /api/opd-queue/{id}                — {action:'complete', user} → mark case completed
  GET    /api/opd-logs                      — OPD event log feed + stats (?from=&to=; default today). Dashboard at /opd-dashboard
  GET    /api/hmq                           — HM Process Queue entries (?from=&to=, newest first)
  POST   /api/hmq                           — add a case {hn,name,ward,room,addedBy}; 409 if HN already active today
  PUT    /api/hmq/{id}                      — transition {action: start|complete|revert-process|revert-new, user}

  POST   /api/report/fetch                  — Jasper XLS proxy (aa-report.bdms.co.th only)
  POST   /api/report/home-med-api           — discharge meds → Home Medication Sheet (+ reconcileMeds)
  POST   /api/report/home-med-opd           — OPD daily orders (getallorderitem DAILYORDER) → OPD Medication Sheet (+ last-5-visits history)
  POST   /api/report/med-journey            — all orders → continuity timeline
  POST   /api/report/reconcile-api          — standalone Medication Reconciliation refresh

  GET    /api/extralabel[/{code}]           — order-item extra-label overrides
  GET/POST/PUT /api/auth/{login|logout|me}  — session auth; POST /api/users (super_admin only)
  GET    /api/schedule/state[?month=]       — shift schedule state; /api/schedule/bookings
  GET/PUT /api/pattern-overrides            — see pattern-editor feature
  GET/PUT /api/chemo-drugs                  — chemo-sticker drug DB

  Static: everything under www/ is served at the matching path, incl.
  /dashboard, /hmr-report, /hmq-report.

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
  data/rx/chemo-drugs.json
  data/patients/{patientuid}.json   — one file per patient (context, ADR, med cache)
  data/hmr/{visitid}.json           — live HM Process record; HM_YYYY-MM-DD.json daily archives
                                       (nightly merge at 23:00, see _hmr_nightly_merge)
  data/hmq/{id}.json                — live HM Process Queue entry; DAY_YYYY-MM-DD.json daily
                                       archives. Nightly at 23:00 (_hmq_nightly_merge), only
                                       'done' entries are folded in and their live files
                                       deleted — 'new'/'process' entries stay live untouched.
  data/schedule/, data/auth/, data/med-images/, data/ks/files/, data/temp-reports/, data/logs/
                                     — shift schedule, users, med images, KS attachments,
                                       downloaded Jasper XLS, home-med fetch logs
"""

import base64
import hashlib
import hmac
import ipaddress
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
import zipfile
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
REPORT_CACHE_DIR  = DATA_DIR / 'report-cache'   # parsed report rows, 1-day retention
PATIENTS_DIR      = DATA_DIR / 'patients'
HMR_DIR           = DATA_DIR / 'hmr'
HMQ_DIR           = DATA_DIR / 'hmq'
OPD_QUEUE_DIR     = DATA_DIR / 'opd-queue'
LOGS_DIR          = DATA_DIR / 'logs'
WWW_DIR           = Path(__file__).parent / 'www'

# ── Extension sync ────────────────────────────────────────────────
# Chrome cannot install an unpacked extension from a URL, so the server can't
# "push" an install. What it CAN do is publish the extension folder as a ZIP
# that each workstation unpacks to a FIXED local path; Chrome then loads
# unpacked from that stable path, so an update is a sync + a reload instead of
# removing and re-adding the extension. See "Extension sync" in README.md.
#
# Source: the repo checkout that sits beside pharmacy_server/ (the server runs
# on the same machine as the repo). Override with BKN_EXT_SRC if it moves.
EXT_SRC_DIR  = Path(os.environ.get('BKN_EXT_SRC')
                    or (Path(__file__).parent.parent / 'BKNPharmacyPortal'))
EXT_PKG_DIR  = DATA_DIR / 'ext-pkg'          # built ZIPs (server-written cache)
# Never ship developer/VCS noise to a workstation.
EXT_SKIP_DIRS  = {'.git', '__pycache__', 'node_modules', 'test', 'screenshots'}
EXT_SKIP_EXT   = {'.pem', '.crx', '.zip', '.log'}

def _ext_manifest_version():
    """Version string from the source manifest, or '' if unreadable."""
    try:
        with open(EXT_SRC_DIR / 'manifest.json', encoding='utf-8') as f:
            return str(json.load(f).get('version') or '')
    except Exception:
        return ''

def _ext_id_from_key():
    """Chrome's deterministic extension id, derived from the manifest "key".

    Chrome takes SHA-256 of the DER public key, keeps the first 16 bytes, and
    maps each hex nibble 0-f onto a-p. Computing it here means the sync script
    can deep-link to chrome://extensions/?id=... without anyone hand-copying an
    id that could silently drift from the published build. '' if unavailable.
    """
    try:
        with open(EXT_SRC_DIR / 'manifest.json', encoding='utf-8') as f:
            key = (json.load(f).get('key') or '').strip()
        if not key:
            return ''
        digest = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
        return ''.join(chr(ord('a') + int(c, 16)) for c in digest)
    except Exception:
        return ''

def _ext_pkg_info():
    """{version, name, id} the server is currently publishing."""
    return {'version': _ext_manifest_version(), 'name': 'BKNPharmacyPortal',
            'id': _ext_id_from_key()}

def _ext_build_zip():
    """Build (or reuse) the packaged extension ZIP; returns its Path.

    Cached per manifest version — rebuilt only when the version changes, so a
    ward PC polling for updates doesn't re-zip 5 MB on every request. Bump the
    manifest version to publish (which the release flow does anyway).
    """
    version = _ext_manifest_version()
    if not version:
        raise RuntimeError(f'no manifest at {EXT_SRC_DIR}')
    EXT_PKG_DIR.mkdir(parents=True, exist_ok=True)
    out = EXT_PKG_DIR / f'BKNPharmacyPortal-{version}.zip'
    if out.exists():
        return out
    tmp = out.with_suffix('.zip.tmp')
    with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in EXT_SRC_DIR.rglob('*'):
            if not p.is_file():
                continue
            rel = p.relative_to(EXT_SRC_DIR)
            if any(part in EXT_SKIP_DIRS for part in rel.parts):
                continue
            if p.suffix.lower() in EXT_SKIP_EXT:
                continue
            z.write(p, rel.as_posix())
    os.replace(tmp, out)          # atomic publish, like _atomic_write_json
    # Keep only the current version's ZIP — old builds are dead weight.
    for old in EXT_PKG_DIR.glob('BKNPharmacyPortal-*.zip'):
        if old != out:
            try: old.unlink()
            except OSError: pass
    return out

# Kept as a template rather than a static file under www/ so the server URL can
# be filled in per request — see _ext_sync_bat().
_EXT_SYNC_BAT_TEMPLATE = r'''@echo off
setlocal EnableDelayedExpansion
:: BKN Pharmacy Portal - extension sync
:: Downloads the current extension from the pharmacy server and unpacks it to a
:: FIXED local folder, so Chrome's "Load unpacked" path never changes.
:: Re-run this whenever a new version is announced, then reload the extension.

set "SERVER=@@SERVER@@"
:: Deterministic extension id, derived from the manifest "key" by the server —
:: never hand-typed, so it cannot drift from the published build.
set "EXTID=@@EXTID@@"
set "TARGET=D:\pharmacy\BKNPharmacyPortal"
set "TMP=%TEMP%\bkn-ext-sync"

echo.
echo  BKN Pharmacy Portal - extension sync
echo  ====================================
echo  Server: %SERVER%
echo  Target: %TARGET%
echo.

:: --- check what the server is publishing -------------------------------
for /f "usebackq delims=" %%V in (`
  powershell -NoProfile -Command ^
    "try{(Invoke-RestMethod -TimeoutSec 10 '%SERVER%/api/ext-version').version}catch{''}"
`) do set "REMOTE=%%V"

if "%REMOTE%"=="" (
  echo  *** Cannot reach the pharmacy server, or it has no package.
  echo      Check that the server is running at %SERVER%.
  goto :fail
)
echo  Available version: %REMOTE%

if exist "%TARGET%\manifest.json" (
  for /f "usebackq delims=" %%L in (`
    powershell -NoProfile -Command ^
      "try{(Get-Content -Raw '%TARGET%\manifest.json' | ConvertFrom-Json).version}catch{''}"
  `) do set "LOCAL=%%L"
  echo  Installed version: !LOCAL!
  if "!LOCAL!"=="%REMOTE%" (
    echo.
    echo  Already up to date - nothing to do.
    goto :done
  )
)

:: --- download + unpack --------------------------------------------------
echo.
echo  Downloading...
if exist "%TMP%" rmdir /s /q "%TMP%"
mkdir "%TMP%" 2>nul
powershell -NoProfile -Command ^
  "try{Invoke-WebRequest -TimeoutSec 120 -Uri '%SERVER%/ext-download' -OutFile '%TMP%\ext.zip'}catch{exit 1}"
if errorlevel 1 (
  echo  *** Download failed.
  goto :fail
)

echo  Unpacking...
powershell -NoProfile -Command ^
  "try{Expand-Archive -Force -Path '%TMP%\ext.zip' -DestinationPath '%TMP%\new'}catch{exit 1}"
if errorlevel 1 (
  echo  *** Could not unpack the download ^(file may be corrupt^).
  goto :fail
)
if not exist "%TMP%\new\manifest.json" (
  echo  *** Downloaded package looks wrong ^(no manifest.json^) - keeping the
  echo      existing install untouched.
  goto :fail
)

:: Only now touch the live folder: the new copy is verified, so a failed
:: download can never leave a half-updated extension behind.
echo  Installing...
if not exist "D:\pharmacy" mkdir "D:\pharmacy"
if exist "%TARGET%" rmdir /s /q "%TARGET%"
if not exist "%TARGET%" mkdir "%TARGET%"
:: robocopy, not move: TEMP is usually on C: and the target on D:, and "move"
:: across volumes is unreliable. robocopy exit codes 0-7 are success (8+ real
:: errors), so the check cannot use plain errorlevel.
robocopy "%TMP%\new" "%TARGET%" /E /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
  echo  *** Could not write to %TARGET%
  echo      Close Chrome and try again.
  goto :fail
)
if not exist "%TARGET%\manifest.json" (
  echo  *** Install did not complete - manifest.json missing in the target.
  goto :fail
)

echo.
echo  Updated to version %REMOTE%.
echo.
echo  ================================================================
echo    LAST STEP - click the RELOAD arrow, then close that tab.
echo  ================================================================
echo.
echo    Chrome is opening at the extension's own page, so the reload
echo    button is right there - no need to search for it.
echo.
echo    (First time on this PC only: turn Developer mode ON, click
echo     "Load unpacked" and select  %TARGET% )
echo.

:: Open Chrome straight at THIS extension's card. Chrome blocks scripted
:: clicks on chrome://extensions by design, so the reload itself stays
:: manual — but landing on the right page removes all the navigating.
::
:: Resolve chrome.exe by PATH, then the two standard install locations.
:: `start "" chrome.exe` is NOT safe here: chrome.exe is usually not on PATH,
:: and the shell then hands the unknown name to Windows, which offers to find
:: it in the Microsoft Store. Never let that happen on a ward PC.
:: Order: the standard install paths first (fast, no parsing), then the
:: App Paths registry entry as a fallback for a non-standard install.
set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined CHROME if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
:: Non-standard install: ask the App Paths registry entry. tokens=2,* keeps the
:: path intact even though it contains spaces.
if not defined CHROME for /f "usebackq skip=2 tokens=2,*" %%A in (
  `reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul`
) do if not defined CHROME set "CHROME=%%B"

:: Which Chrome profile? These PCs have MANY profiles (Default, Profile 10,
:: Profile 19, …) and Chrome shows the "Who's using Chrome?" picker when it
:: can't tell — a dead end for a staff member who just wants the reload arrow.
:: Read the profile Chrome itself last used from Local State, so we open the
:: one the pharmacist actually works in (where the extension is installed).
:: Hardcoding "Default" would be wrong on exactly these machines.
set "CHPROFILE="
for /f "usebackq delims=" %%A in (`
  powershell -NoProfile -Command ^
    "try{(Get-Content -Raw '%LOCALAPPDATA%\Google\Chrome\User Data\Local State' | ConvertFrom-Json).profile.last_used}catch{''}"
`) do set "CHPROFILE=%%A"
if not defined CHPROFILE set "CHPROFILE=Default"

if defined CHROME (
  start "" "%CHROME%" --profile-directory="%CHPROFILE%" --new-tab "chrome://extensions/?id=%EXTID%"
) else (
  echo   NOTE: Chrome was not found automatically - open Chrome yourself and go to
  echo         chrome://extensions   then click the reload arrow.
)

:done
if exist "%TMP%" rmdir /s /q "%TMP%" 2>nul
echo.
pause
exit /b 0

:fail
if exist "%TMP%" rmdir /s /q "%TMP%" 2>nul
echo.
pause
exit /b 1
'''

def _ext_sync_bat(host_header=''):
    """The client sync script, with this server's own URL baked in.

    Served from /ext-sync.bat so a workstation curls it once and never has to
    hand-edit an address. Uses the Host the client actually reached us on, so
    it stays correct whatever address/port the server is published under.
    """
    host = (host_header or '').strip() or f'{getattr(Handler, "_ip", "127.0.0.1")}:{getattr(Handler, "_port", DEFAULT_PORT)}'
    return (_EXT_SYNC_BAT_TEMPLATE
            .replace('@@SERVER@@', f'http://{host}')
            .replace('@@EXTID@@', _ext_id_from_key()))

KS_COLS       = {'faqs', 'items', 'vdos'}
# All rx collections — GET is public; PUT requires editor/admin auth
RX_COLS       = {'premix-drugs', 'mixing-protocols', 'medication-db', 'iv-drugs', 'iv-staff', 'pattern-overrides', 'chemo-drugs', 'pending-code'}
# RX collections whose PUT requires an authenticated admin/editor (Bearer token),
# NOT just a trusted extension origin. The IV-Sticker master data is edited only
# through the admin editor (Pattern Editor → "IV Sticker DB" tab); the sticker
# page itself is read-only. Reads (GET) stay open so the sticker can load them.
RX_ADMIN_WRITE_COLS = {'iv-drugs', 'iv-staff'}
# One-time seed for the IV-Sticker master data: written on first startup only
# (if data/rx/iv-drugs.json / iv-staff.json is absent), so the server — not the
# extension's hard-coded list — is the source of truth. Extracted from the
# extension's former DEFAULT_DRUGS / DEFAULT_STAFF (kept there only as an offline
# fallback). Existing files are never overwritten (data-protection invariant).
IV_DRUGS_SEED = [{"codeName":"KCl","generic":"KCl","type":"HAD","exp":7,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"50%MgSO4","generic":"50%MgSO4","type":"HAD","exp":30,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"KCl+MgSO4","generic":"KCl+MgSO4","type":"HAD","exp":2,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"3%NaCl (inhale with nebulizer)","generic":"3%NaCl (inhale with nebulizer)","type":"HAD","exp":1,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"KCl 10 mEq + K2PO4 40 mEq","generic":"KCl 10 mEq + K2PO4 40 mEq","type":"HAD","exp":90,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"Dipotassium Phosphate","generic":"Dipotassium Phosphate","type":"HAD","exp":7,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"3%NaCl","generic":"3%NaCl","type":"HAD","exp":1,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"Fentanyl","generic":"Fentanyl","type":"HAD","exp":30,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"Morphine","generic":"Morphine","type":"HAD","exp":60,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"Morphine 30 mg in NSS 30 mL","generic":"Morphine","type":"HAD","exp":60,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":"ฉีดตามแพทย์สั่ง"},{"codeName":"PCEA (Bupivacaine)","generic":"PCEA (Bupivacaine)","type":"HAD","exp":30,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"PCEA (Chirocaine)","generic":"PCEA (Chirocaine)","type":"HAD","exp":2,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"FENtanyl (5 mL)","generic":"FENtanyl (5 mL)","type":"PFS","exp":30,"storage":"Keep in Room Temp.","had":"","conc":"10 mcg/mL","rate":""},{"codeName":"MORphine (3 mL)","generic":"MORphine (3 mL)","type":"PFS","exp":60,"storage":"Keep in Room Temp.","had":"","conc":"1 mg/mL","rate":""},{"codeName":"PEThidine (2.5 mL)","generic":"PEThidine (2.5 mL)","type":"PFS","exp":28,"storage":"Keep in Room Temp.","had":"","conc":"10 mg/mL","rate":""},{"codeName":"Succinyl (2 mL)","generic":"Succinyl (2 mL)","type":"PFS","exp":7,"storage":"Keep in Room Temp.","had":"","conc":"50 mg/mL","rate":""},{"codeName":"Adrenaline","generic":"Adrenaline","type":"PFS","exp":90,"storage":"Keep in Room Temp.","had":"","conc":"","rate":""},{"codeName":"Fentanyl 50 mcg/mL PFS","generic":"Fentanyl","type":"PFS","exp":7,"storage":"Keep in Room Temp.","had":"","conc":"50 mcg/mL","rate":""},{"codeName":"Midazolam 1 mg/mL PFS","generic":"Midazolam","type":"PFS","exp":7,"storage":"Keep in Room Temp.","had":"","conc":"1 mg/mL","rate":""},{"codeName":"Norepinephrine 0.1 mg/mL","generic":"Norepinephrine","type":"PFS","exp":2,"storage":"Keep in Room Temp.","had":"","conc":"0.1 mg/mL","rate":""},{"codeName":"Cefazolin (ceFAZolin 1 Gm)","generic":"Cefazolin","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 60 ml/hr"},{"codeName":"Ceftriaxone 1 g","generic":"Ceftriaxone","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 10 ml/hr"},{"codeName":"Vancomycin 500 mg","generic":"Vancomycin","type":"ATB","exp":14,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip in 30 min"},{"codeName":"Pip/Tazo 4.5 g","generic":"Piperacillin/Tazobactam","type":"ATB","exp":2,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip every 8 hr"},{"codeName":"Rocephin 2 g","generic":"Rocephin","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 1 Gm/hr"},{"codeName":"Dalacin-C 600 mg","generic":"Dalacin-C","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 30 mL/hr"},{"codeName":"Meropenem 1 g","generic":"Meropenem","type":"ATB","exp":2,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip every 24 hr"},{"codeName":"Invanz 1 g","generic":"Invanz","type":"ATB","exp":3,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip in 1 hr"},{"codeName":"Amikacin 500 mg","generic":"Amikacin","type":"ATB","exp":5,"storage":"Keep in Refrigerator","had":"","conc":"","rate":""},{"codeName":"Levofloxacin 750 mg","generic":"Levofloxacin","type":"ATB","exp":2,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip every 5 hr"},{"codeName":"Ceftazidime 1 g","generic":"Ceftazidime","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 1 Gm/hr"},{"codeName":"5-FU","generic":"5-FU","type":"Cytotoxic","exp":28,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"Methotrexate","generic":"Methotrexate","type":"Cytotoxic","exp":7,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},{"codeName":"Gemcitabine 200 mg","generic":"Gemcitabine","type":"Cytotoxic","exp":7,"storage":"Keep in Room Temp.","had":"","conc":"","rate":""},{"codeName":"Vancomycin Eye","generic":"Vancomycin","type":"EYE","exp":14,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip in 30 min"},{"codeName":"Ceftazidime Eye","generic":"Ceftazidime","type":"EYE","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":""}]
IV_STAFF_SEED = [{"name":"Akira","role":"Pharmacist"},{"name":"Apsorn","role":"Pharmacist"},{"name":"Cha","role":"Pharmacist"},{"name":"Ket","role":"Pharmacist"},{"name":"JOHN","role":"Pharmacist"},{"name":"Waram","role":"Pharmacist"},{"name":"Nattaya","role":"Pharmacist"},{"name":"Narudee","role":"Phar.Assist"},{"name":"Chayaporn","role":"Pharmacist"},{"name":"Oum","role":"Pharmacist"},{"name":"Phatt","role":"Pharmacist"},{"name":"Piyathida","role":"Pharmacist"},{"name":"Tunyaporn","role":"Pharmacist"},{"name":"Metawee","role":"Pharmacist"},{"name":"Siwawoot","role":"Pharmacist"},{"name":"Sucheera","role":"Pharmacist"},{"name":"Wannaporn","role":"Pharmacist"},{"name":"Ananya","role":"Pharmacist"},{"name":"Chanapa","role":"Pharmacist"},{"name":"Nongnapas","role":"Pharmacist"},{"name":"Paraporn","role":"Pharmacist"},{"name":"Rattiyakorn","role":"Phar.Assist"},{"name":"Thantita","role":"Pharmacist"},{"name":"Onamon","role":"Phar.Assist"},{"name":"Tussanee","role":"Phar.Assist"},{"name":"Punyaporn","role":"Pharmacist"},{"name":"Arunya","role":"Phar.Assist"},{"name":"Patcharee","role":"Pharmacist"},{"name":"Pijarin","role":"Pharmacist"},{"name":"Tanit","role":"Pharmacist"},{"name":"Arisara","role":"Phar.Assist"},{"name":"Rattanan","role":"Phar.Assist"},{"name":"Wanika","role":"Phar.Assist"},{"name":"Pornsiri","role":"Phar.Assist"},{"name":"Pitsanu","role":"Phar.Assist"},{"name":"DUSADEE","role":"Phar.Assist"},{"name":"Siriporn","role":"Phar.Assist"},{"name":"Paninee","role":"Pharmacist"}]
# Requests from a Chrome extension running on a pharmacy workstation may
# read/write data without login.
#
# RIS_RA_2026_03 — TRUST MODEL: network location, not extension ID.
#
# The previous treatment allow-listed specific extension IDs. That proved
# operationally brittle: Chrome only derives the deterministic ID from the
# manifest "key" when the extension is loaded from the folder carrying that
# key, so an unpacked install from a different path — or any copy predating
# the key — gets a fresh random ID and is silently refused. Writes then fail
# with a bare 401 while reads keep working, which presents to staff as "the
# extension is missing" rather than as an auth error. Re-registering IDs per
# machine is not sustainable across the ward's workstations.
#
# We therefore trust *any* chrome-extension:// origin, but only when the
# request comes from an approved network. Chrome sets the Origin header
# itself (a web page cannot forge a chrome-extension:// origin), so this
# still excludes ordinary websites; the remaining exposure is another
# extension installed on a pharmacy PC, which is accepted deliberately and
# bounded by the subnet. The compensating controls are the infra half of
# RIS_RT_2026_03 (HTTPS + firewall to the pharmacy VLAN), which carry more
# of the weight under this model — see RISK-TREATMENT.md.
#
# Configure with BKN_TRUSTED_SUBNETS (comma-separated CIDRs) to match the
# site's addressing. Loopback is always trusted.
TRUSTED_SUBNETS_DEFAULT = '10.134.0.0/16'
def _parse_subnets(spec):
    """Parse a comma-separated trusted-network list into ip_network objects.

    Accepts full CIDR ('10.134.0.0/16') and the shorthand prefix form people
    actually think in: '10.134' / '10.134.' both mean "any IP starting with
    10.134", i.e. 10.134.0.0/16. Bad entries are skipped with a warning rather
    than aborting startup — a typo must not take the pharmacy server down.
    """
    nets = []
    for part in (spec or '').split(','):
        part = part.strip().rstrip('.')
        if not part:
            continue
        try:
            if '/' not in part:
                # Prefix shorthand: pad the missing octets and derive the mask
                # from how many octets were actually given (10.134 → /16).
                octets = part.split('.')
                if len(octets) < 4 and all(o.isdigit() for o in octets):
                    part = '.'.join(octets + ['0'] * (4 - len(octets))) + f'/{len(octets) * 8}'
            nets.append(ipaddress.ip_network(part, strict=False))
        except ValueError:
            print(f'[trust] ignoring invalid trusted network: {part!r}', file=sys.stderr)
    return nets

TRUSTED_SUBNETS = _parse_subnets(
    os.environ.get('BKN_TRUSTED_SUBNETS') or TRUSTED_SUBNETS_DEFAULT
)

def _ip_is_trusted(client_ip):
    """True if client_ip is loopback or inside a configured trusted subnet."""
    try:
        ip = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    # IPv4-mapped IPv6 (::ffff:10.134.x.x) — compare on the embedded v4 address.
    mapped = getattr(ip, 'ipv4_mapped', None)
    if mapped is not None:
        ip = mapped
    return any(ip in net for net in TRUSTED_SUBNETS)

# (The legacy EXTENSION_ORIGIN constant was removed with the extension-ID
# allowlist — nothing reads an extension ID any more; see _is_trusted_extension.)
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


def delete_rx_note(code):
    """Remove ALL 'Patient Instruction' entries for `code` from medication-db.json
    (the note-line source used by the Home Med Sheet). Returns True if the code
    exists. Leaves other instruction types untouched."""
    global _extralabel_idx
    code = _hm_norm(code)
    with _rx_note_lock:
        db = load_rx('medication-db')
        if not isinstance(db, dict) or code not in db:
            return False
        entry = db[code]
        inss = entry.get('instructions')
        inss = [i for i in (inss if isinstance(inss, list) else [])
                if (i.get('type') or '') != 'Patient Instruction']
        entry['instructions'] = inss
        entry['instructionCount'] = len(inss)
        db[code] = entry
        save_rx('medication-db', db)
        _extralabel_idx = None
    return True


# ── Home Medication Sheet (from ArcusAir getallorderitem API) ──
ARCUS_BASE = 'https://arcusair.bdms.co.th'
ARCUS_ORDERITEM_URL = ARCUS_BASE + '/ordermanagement/patientorder/getallorderitem'
ARCUS_ALLERGY_URL   = ARCUS_BASE + '/emr/drugalergy/getallergies'
ARCUS_VISITCOUNT_URL = ARCUS_BASE + '/ordermanagement/patientorder/searchfromvisitcount'
ARCUS_ORDERSEARCH_URL = ARCUS_BASE + '/ordermanagement/patientorder/search'
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


# ── ArcusAir call monitoring ────────────────────────────────────────────────
# Per-endpoint counters + latency, so the dashboard can show how the extension is
# using ArcusAir and spot a slow/failing upstream. In-memory only, thread-safe;
# no patient data (keyed by the endpoint path, never the request body/ids).
_ARCUS_LOCK  = threading.Lock()
_ARCUS_STATS = {}   # path -> {calls, ok, err, retries, totalMs, minMs, maxMs, lastMs, lastAt, lastError}
_ARCUS_RECENT = []  # rolling window of the last N calls: {path, ok, ms, at, error}
_ARCUS_RECENT_MAX = 50

def _arcus_endpoint(url):
    """The path portion of an ArcusAir URL — a stable, non-PHI stats key."""
    try:
        return urllib.parse.urlsplit(url).path or url
    except Exception:
        return url

def _record_arcus_call(url, ok, elapsed_ms, retries=0, error=''):
    """Record one ArcusAir call outcome into the in-memory monitor."""
    path = _arcus_endpoint(url)
    ms = int(elapsed_ms)
    now = time.time()
    with _ARCUS_LOCK:
        s = _ARCUS_STATS.get(path)
        if s is None:
            s = {'calls': 0, 'ok': 0, 'err': 0, 'retries': 0,
                 'totalMs': 0, 'minMs': None, 'maxMs': 0, 'lastMs': 0,
                 'lastAt': '', 'lastError': ''}
            _ARCUS_STATS[path] = s
        s['calls'] += 1
        s['ok' if ok else 'err'] += 1
        s['retries'] += int(retries)
        s['totalMs'] += ms
        s['minMs'] = ms if s['minMs'] is None else min(s['minMs'], ms)
        s['maxMs'] = max(s['maxMs'], ms)
        s['lastMs'] = ms
        s['lastAt'] = datetime.now().isoformat(timespec='seconds')
        if not ok:
            s['lastError'] = str(error)[:200]
        _ARCUS_RECENT.append({'path': path, 'ok': bool(ok), 'ms': ms,
                              'at': datetime.now().strftime('%H:%M:%S'),
                              'error': ('' if ok else str(error)[:120])})
        if len(_ARCUS_RECENT) > _ARCUS_RECENT_MAX:
            _ARCUS_RECENT.pop(0)
    # Also surface on the general dashboard request stream (short label).
    try:
        _record_request('ARCUS', path, 'ok' if ok else 'ERR', 0, ms)
    except Exception:
        pass

def arcus_stats():
    """Aggregated ArcusAir call stats for the dashboard / /api/arcus-stats."""
    with _ARCUS_LOCK:
        endpoints = []
        tot_calls = tot_ok = tot_err = 0
        for path, s in sorted(_ARCUS_STATS.items()):
            calls = s['calls'] or 1
            endpoints.append({
                'endpoint': path,
                'calls': s['calls'], 'ok': s['ok'], 'err': s['err'],
                'errorRate': round(s['err'] / calls, 3),
                'retries': s['retries'],
                'avgMs': int(s['totalMs'] / calls),
                'minMs': int(s['minMs'] or 0), 'maxMs': int(s['maxMs']),
                'lastMs': int(s['lastMs']), 'lastAt': s['lastAt'],
                'lastError': s['lastError'],
            })
            tot_calls += s['calls']; tot_ok += s['ok']; tot_err += s['err']
        recent = list(_ARCUS_RECENT[-20:])
    endpoints.sort(key=lambda e: e['calls'], reverse=True)
    return {
        'totalCalls': tot_calls, 'ok': tot_ok, 'err': tot_err,
        'errorRate': round(tot_err / tot_calls, 3) if tot_calls else 0.0,
        'endpoints': endpoints,
        'recent': recent,
        'generatedAt': datetime.now().isoformat(timespec='seconds'),
    }


def _arcus_post_json(url, ctx, payload, retries=2):
    """POST JSON to an ArcusAir endpoint with session headers; return parsed JSON.

    Retries on transient network errors (e.g. the occasional slow TLS handshake to
    arcusair.bdms.co.th, which otherwise surfaces as
    '_ssl.c:993: The handshake operation timed out').

    Each call (success or final failure) is recorded into the ArcusAir monitor
    (`_record_arcus_call`) for the dashboard's performance view.
    """
    body = json.dumps(payload).encode('utf-8')
    last_exc = None
    started = time.time()
    used_retries = 0
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=body, headers=_arcus_headers(ctx), method='POST')
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                if raw[:2] == b'\x1f\x8b':
                    import gzip
                    raw = gzip.decompress(raw)
            result = json.loads(raw.decode('utf-8'))
            _record_arcus_call(url, True, (time.time() - started) * 1000, used_retries)
            return result
        except Exception as exc:  # noqa: BLE001 — re-raised below if not retryable
            last_exc = exc
            if attempt < retries and _is_transient_net_err(exc):
                used_retries += 1
                time.sleep(0.6 * (attempt + 1))
                continue
            _record_arcus_call(url, False, (time.time() - started) * 1000, used_retries, exc)
            raise
    _record_arcus_call(url, False, (time.time() - started) * 1000, used_retries, last_exc)  # pragma: no cover
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


# ── OPD (outpatient) Home Med Sheet — getallorderitem (DAILY ORDER) ─────────
# OPD uses the SAME endpoint as the discharge sheet (getallorderitem), only the
# ordertype differs: DAILYORDER instead of DISCHARGEMEDICATION. Its response is
# the identical `orderitems[]` shape, so it flows through _normalize_orderitems /
# _map_orderitem unchanged — no adapter needed. Keyed by patientuid +
# patientvisituid (the same context the discharge sheet already captures).
# The response mixes MEDICINE with non-meds (e.g. DOCTORFEE "Physician fee");
# _is_medicine drops those.
ARCUS_OPD_ORDERTYPE_UID = '5796e65d1526f6ebabe3b4a4'  # DAILY ORDER (OPD)

# OPD history panel: how many prior visits to build. The server returns up to
# _MAX so the client's "x ครั้งล่าสุด" selector can slice locally (no re-fetch);
# _DEFAULT is the initial window and the one continuity tags compare against.
OPD_HISTORY_DEFAULT = 5
OPD_HISTORY_MAX     = 20

def fetch_arcus_opd_meds(ctx):
    """POST to ArcusAir getallorderitem for the patient's OPD daily orders.
    Needs patientuid + patientvisituid. Returns JSON."""
    return _arcus_post_json(ARCUS_ORDERITEM_URL, ctx, {
        'pagesize': 30, 'pagenumber': 1,
        'patientuid': ctx.get('patientuid', ''),
        'patientvisituid': ctx.get('patientvisituid', ''),
        'ordertype': 'DAILYORDER',
        'ordertypeuid': ARCUS_OPD_ORDERTYPE_UID,
        'filtersearch': True, 'isactive': True,
        'includedispensereturns': True, 'sortorder': '-orderdate',
    })

def build_home_med_from_opd(data):
    """OPD getallorderitem JSON → the same {patient, meds, allMeds} the discharge
    sheet produces, via the shared normaliser (identical shape, no adapter)."""
    return build_home_med_from_arcus(data)


# ── OPD medical history: the patient's last N visits' meds ──────────────────
# The OPD sheet shows a "last 5 visits" medical-history panel (in place of the
# discharge sheet's Med Reconciliation). getallorderitem is scoped to the CURRENT
# visit, so it can't supply history. patientorder/search — the call the OPD EMR
# page itself fires — returns every visit's orders as patientorders[] (each with
# its own patientvisituid), keyed by just patientuid. We call that and group it.
def fetch_arcus_opd_history(ctx):
    """POST patientorder/search — MEDICINE orders across ALL of the patient's
    visits (needs only patientuid + incusToken). Returns {patientorders:[…]}."""
    # issummary:false so every visit carries its full patientorderitems[] (summary
    # mode collapses some entries to just an _id, which would drop those visits).
    return _arcus_post_json(ARCUS_ORDERSEARCH_URL, ctx, {
        'patientuid': ctx.get('patientuid', ''),
        'ordercattype': ['MEDICINE'],
        'pagenumber': 1,
        'issummary': False,
    })

def build_opd_visit_history(ctx, current_visit_uid='', visitcount=5):
    """Fetch patientorder/search and group its patientorders[] by visit for the
    OPD history panel. Returns [{visitDate, visitId, meds:[…]}] newest first, []."""
    try:
        data = fetch_arcus_opd_history(ctx)
    except Exception:
        return []
    if not data:
        return []
    try:
        return build_visit_history_groups(data, current_visit_uid, visitcount)
    except Exception:
        return []


# ── Current-visit summary panel (OPD): vitals + visit summary + doctor notes ──
ARCUS_VITALS_URL     = ARCUS_BASE + '/emr/observation/getlatestemrbannervitalsigns'
ARCUS_SUMMARY_URL    = ARCUS_BASE + '/emr/summary/getemrsummaryvisit'
ARCUS_DOCTORNOTE_URL = ARCUS_BASE + '/emr/doctornote/search'
# Fixed valuecode used by ArcusAir's own summary call (note-entry type).
ARCUS_SUMMARY_NOTENTYPEUID = '5b3c67b88c9df34c3e943525'

def fetch_arcus_vitals(ctx):
    """POST getlatestemrbannervitalsigns → latest banner vital signs for the visit.
    Body: {patientuid, patientvisituid}. Returns JSON."""
    return _arcus_post_json(ARCUS_VITALS_URL, ctx, {
        'patientuid': ctx.get('patientuid', ''),
        'patientvisituid': ctx.get('patientvisituid', ''),
    })

def fetch_arcus_visit_summary(ctx):
    """POST getemrsummaryvisit → the patient's recent visits w/ careprovider +
    chief-complaint. Body keyed by patientuid (matches ArcusAir's own call)."""
    return _arcus_post_json(ARCUS_SUMMARY_URL, ctx, {
        'patientuid': ctx.get('patientuid', ''),
        'pagenumber': 1,
        'notentypeuid': ARCUS_SUMMARY_NOTENTYPEUID,
        'isnotipd': True,
    })

def fetch_arcus_doctor_notes(ctx, departmentuid=''):
    """POST doctornote/search → doctor notes for the current visit. departmentuid
    should be the VISIT's department (from the summary) — falls back to ctx."""
    dept = departmentuid or ctx.get('departmentuid') or ctx.get('logindepartmentuid', '')
    return _arcus_post_json(ARCUS_DOCTORNOTE_URL, ctx, {
        'patientuid': ctx.get('patientuid', ''),
        'patientvisituid': ctx.get('patientvisituid', ''),
        'departmentuid': dept,
    })

# Vital-sign display order + which readings to flag as a BP pair.
_VITALS_ORDER = ['WT', 'HT', 'BMI', 'BSA', 'T', 'PR', 'RR', 'SBP', 'DBP', 'MAP', 'O2', 'HC', 'CC']

def build_vitals_from_arcus(data):
    """getlatestemrbannervitalsigns JSON → ordered list of readings:
    [{key, name, value, unit, flag, range, at}] (flag: 'H'|'L'|'' from HLN)."""
    obs = ((data or {}).get('result') or {}).get('observationbyvisit') or []
    by_key = {}
    for o in obs:
        r = (o or {}).get('result') or {}
        key = _hm_norm(r.get('shorttext') or '')
        if not key:
            continue
        item = (r.get('orderresultitemuid') or {})
        by_key[key] = {
            'key': key,
            'name': _hm_norm(item.get('name') or key),
            'value': _hm_norm(str(r.get('resultvalue') if r.get('resultvalue') is not None else '')),
            'unit': _hm_norm((r.get('uomuid') or {}).get('valuedescription') or ''),
            'flag': (_hm_norm(r.get('HLN') or '') if _hm_norm(r.get('HLN') or '') in ('H', 'L') else ''),
            'range': _hm_norm(r.get('normalrange') or ''),
            'at': r.get('observationdate') or r.get('createdat') or '',
        }
    ordered = [by_key[k] for k in _VITALS_ORDER if k in by_key]
    ordered += [v for k, v in by_key.items() if k not in _VITALS_ORDER]  # any extras last
    return ordered

def build_visit_summary_rows(data, current_visit_uid=''):
    """getemrsummaryvisit JSON → [{visitId, date, department, provider, complaint}].
    Prefer the current visit; keep others as context (newest first)."""
    rows = []
    for v in ((data or {}).get('emrpatientvisits') or []):
        vcp = (v.get('visitcareproviders') or {})
        rows.append({
            'visitUid': v.get('_id') or '',
            'visitId': _hm_norm(v.get('visitid') or ''),
            'date': vcp.get('startdate') or v.get('startdate') or '',
            'department': _hm_norm((vcp.get('departmentuid') or {}).get('name') or ''),
            'departmentUid': (vcp.get('departmentuid') or {}).get('_id') or '',
            'provider': _hm_norm((vcp.get('careprovideruid') or {}).get('name') or ''),
            'complaint': _hm_norm(vcp.get('comments') or ''),
            'isCurrent': (v.get('_id') or '') == current_visit_uid,
        })
    # Current visit first, then newest→oldest by date.
    rows.sort(key=lambda r: (0 if r['isCurrent'] else 1, _neg_iso(r['date'])))
    return rows

def _neg_iso(s):
    """Sort key that puts newer ISO dates first."""
    return ''.join(chr(255 - ord(c)) for c in str(s or ''))[:32]

def build_doctor_notes(data, provider_by_uid=None):
    """doctornote/search JSON → [{provider, at, html}] newest first. notetext is
    curated ArcusAir HTML — sanitised to a safe subset before returning."""
    prov = provider_by_uid or {}
    out = []
    for n in ((data or {}).get('doctornote') or []):
        out.append({
            'provider': prov.get(n.get('careprovideruid') or '', ''),
            'at': n.get('modifiedat') or n.get('createdat') or '',
            'html': _sanitize_note_html(n.get('notetext') or ''),
        })
    out.sort(key=lambda r: _neg_iso(r['at']))
    return out

# Formatting tags kept from doctornote HTML; everything else (and ALL attributes)
# is stripped, so no onclick/style/href etc. survives.
_NOTE_ALLOWED = {'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li'}
_NOTE_TAG_RE = re.compile(r'<\s*(/?)\s*([a-zA-Z0-9]+)[^>]*?(/?)\s*>')
def _sanitize_note_html(html):
    """Reduce the note HTML to a safe whitelist of formatting tags, with NO
    attributes (drops scripts/styles/event handlers). Non-whitelisted tags are
    removed but their text is kept."""
    if not html:
        return ''
    s = str(html)
    s = re.sub(r'<\s*(script|style)[^>]*>.*?<\s*/\s*\1\s*>', '', s, flags=re.I | re.S)
    def _clean(m):
        closing, tag, selfclose = m.group(1), m.group(2).lower(), m.group(3)
        if tag not in _NOTE_ALLOWED:
            return ''                       # drop the tag, keep surrounding text
        if closing:
            return f'</{tag}>'
        if tag == 'br' or selfclose:
            return '<br>' if tag == 'br' else f'<{tag}>'
        return f'<{tag}>'                   # re-emit with no attributes
    s = _NOTE_TAG_RE.sub(_clean, s)
    return s.strip()

def build_opd_visit_summary(ctx):
    """Assemble the OPD current-visit summary panel: {vitals, visits, doctorNotes}.
    Each part best-effort; the visit summary supplies the visit's department for a
    correctly-scoped doctornote fetch and the careprovider names for the notes."""
    out = {'vitals': [], 'visits': [], 'doctorNotes': []}
    cur_uid = ctx.get('patientvisituid', '')
    # 1) Vitals.
    try:
        out['vitals'] = build_vitals_from_arcus(fetch_arcus_vitals(ctx))
    except Exception:
        pass
    # 2) Visit summary (also gives us the visit department + provider names).
    dept_uid = ''
    prov_by_uid = {}
    try:
        sdata = fetch_arcus_visit_summary(ctx)
        out['visits'] = build_visit_summary_rows(sdata, cur_uid)
        for v in ((sdata or {}).get('emrpatientvisits') or []):
            vcp = (v.get('visitcareproviders') or {})
            cp = (vcp.get('careprovideruid') or {})
            if cp.get('_id'):
                prov_by_uid[cp['_id']] = _hm_norm(cp.get('name') or '')
            if (v.get('_id') or '') == cur_uid and (vcp.get('departmentuid') or {}).get('_id'):
                dept_uid = vcp['departmentuid']['_id']
        if not dept_uid:  # any visit's dept as a fallback
            for r in out['visits']:
                if r.get('departmentUid'):
                    dept_uid = r['departmentUid']; break
    except Exception:
        pass
    # 3) Doctor notes (scoped to the visit's department when known).
    try:
        out['doctorNotes'] = build_doctor_notes(
            fetch_arcus_doctor_notes(ctx, dept_uid), prov_by_uid)
    except Exception:
        pass
    return out


# ── OPD QUEUE: cases the pharmacist sends to the dispensing zone ─────────────
# Simple day-archived store: one JSON file per Bangkok day holding a list of
# queued cases. Each case = {id, hn, name, visitId, room, meds:[{drug,code,
# instruction,quantity,group}], pharmacistNote, sentBy, createdAt, status}.
def _opd_queue_file(date_str):
    """'YYYY-MM-DD' → OPD_QUEUE_DIR/ddmmyyyy_opd_queue.json (one file per day)."""
    y, m, d = date_str.split('-')
    return OPD_QUEUE_DIR / f'{d}{m}{y}_opd_queue.json'

def _load_opd_queue_day(date_str):
    p = _opd_queue_file(date_str)
    if p.exists():
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
            if isinstance(data, list):
                return data
        except Exception:
            pass
    return []

def add_opd_queue_case(case):
    """Append a case to today's OPD queue file (atomic). Returns the stored case
    (with id/createdAt/status filled). Also appends a log line."""
    today = _bangkok_today()
    cases = _load_opd_queue_day(today)
    now = _now_iso()
    stored = {
        'id': f'OPDQ-{today.replace("-", "")}-{len(cases) + 1:03d}',
        'hn': _hm_norm(case.get('hn') or ''),
        'name': _hm_norm(case.get('name') or ''),
        'visitId': _hm_norm(case.get('visitId') or ''),
        'patientuid': case.get('patientuid') or '',
        'patientvisituid': case.get('patientvisituid') or '',
        'room': _hm_norm(case.get('room') or ''),
        'meds': case.get('meds') if isinstance(case.get('meds'), list) else [],
        'pharmacistNote': _hm_norm(case.get('pharmacistNote') or ''),
        'sentBy': _hm_norm(case.get('sentBy') or ''),
        # Clinical context the pharmacist reviewed (Dx, allergy, vitals, doctor
        # notes, current visit) so the dispensing zone sees the same picture.
        'context': case.get('context') if isinstance(case.get('context'), dict) else {},
        'createdAt': now,
        'status': 'queued',
    }
    cases.append(stored)
    _atomic_write_json(_opd_queue_file(today), cases)
    _log_opd_queue('sent', stored)
    try:
        _record_request('OPDQ', f'queued {stored["id"]} ({stored["hn"]})', 'ok')
    except Exception:
        pass
    return stored

def find_opd_queue_for_visit(hn, visit_id='', patientvisituid=''):
    """Find today's most-recent case for the same patient visit (by
    patientvisituid, else visitId, else HN). Returns (case, dayStr) or (None, None)."""
    today = _bangkok_today()
    cases = _load_opd_queue_day(today)
    hn = _hm_norm(hn or ''); vid = _hm_norm(visit_id or ''); pvu = patientvisituid or ''
    match = None
    for c in cases:
        same = False
        if pvu and c.get('patientvisituid') == pvu: same = True
        elif vid and _hm_norm(c.get('visitId') or '') == vid: same = True
        elif hn and _hm_norm(c.get('hn') or '') == hn and not vid and not pvu: same = True
        if same:
            match = c   # keep the last (newest, since appended in order)
    return (match, today) if match else (None, None)

def update_opd_queue_case(case_id, body):
    """Overwrite an existing queued case's meds/note/etc (re-send). Keeps id,
    createdAt, status; bumps resentAt. Returns the updated case or None."""
    today = _bangkok_today()
    cases = _load_opd_queue_day(today)
    for c in cases:
        if c.get('id') == case_id:
            c['name'] = _hm_norm(body.get('name') or c.get('name') or '')
            c['visitId'] = _hm_norm(body.get('visitId') or c.get('visitId') or '')
            c['room'] = _hm_norm(body.get('room') or c.get('room') or '')
            c['meds'] = body.get('meds') if isinstance(body.get('meds'), list) else c.get('meds')
            c['pharmacistNote'] = _hm_norm(body.get('pharmacistNote') or '')
            c['sentBy'] = _hm_norm(body.get('sentBy') or c.get('sentBy') or '')
            if isinstance(body.get('context'), dict):
                c['context'] = body['context']
            c['resentAt'] = _now_iso()
            c['resendCount'] = int(c.get('resendCount') or 0) + 1
            _atomic_write_json(_opd_queue_file(today), cases)
            _log_opd_queue('resent', c, c.get('sentBy'))
            try: _record_request('OPDQ', f'resent {case_id} ({c.get("hn")})', 'ok')
            except Exception: pass
            return c
    return None

def complete_opd_queue_case(case_id, user=''):
    """Mark a queued case 'completed' (idempotent). Searches today then recent
    days. Returns the updated case, or None if not found."""
    today = _bangkok_today()
    for i in range(0, 7):   # today + up to 6 days back
        day = (datetime.strptime(today, '%Y-%m-%d') - timedelta(days=i)).strftime('%Y-%m-%d')
        cases = _load_opd_queue_day(day)
        changed = False
        for c in cases:
            if c.get('id') == case_id:
                if c.get('status') != 'completed':
                    c['status'] = 'completed'
                    c['completedAt'] = _now_iso()
                    c['completedBy'] = _hm_norm(user or '')
                    changed = True
                if changed:
                    _atomic_write_json(_opd_queue_file(day), cases)
                    _log_opd_queue('completed', c, user)
                    try:
                        _record_request('OPDQ', f'completed {case_id}', 'ok')
                    except Exception:
                        pass
                return c
    return None

def _log_untrusted_write(method, path, origin, client_ip, reason):
    """Append one refused login-less write to data/logs/untrusted-write-YYYY-MM-DD.jsonl.

    RIS_RA_2026_03. A refused write returns a bare 401, which is indistinguishable
    from an ordinary auth failure in the UI — reads still succeed, so staff see a
    populated page that silently fails to save. Logging every rejection makes the
    next trust miss diagnosable instead of being reported as "the extension is
    missing". Also echoed to stderr so it shows up without opening the log file.
    """
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now()
        rec = {
            'at': ts.isoformat(),
            'method': method,
            'path': path,
            'origin': origin or '',
            'ip': client_ip or '',
            'reason': reason,
        }
        with open(LOGS_DIR / f'untrusted-write-{ts:%Y-%m-%d}.jsonl', 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
        print(f'[untrusted-write] {reason}: {method} {path} '
              f'origin={origin or "-"} ip={client_ip or "-"}', file=sys.stderr)
    except Exception as e:
        print(f'[untrusted-write-log] failed: {e}', file=sys.stderr)

def _log_bad_route(method, path, origin, client_ip):
    """Log a trusted client hitting an unparseable route → data/logs/bad-route-*.jsonl.

    Distinct from _log_untrusted_write: the caller IS trusted, so this is a
    CLIENT bug (a malformed identifier in the URL, e.g. a JS object stringified
    to "[object Object]"), not an access-control problem. Kept separate so a
    genuine trust miss is never buried under client-side noise.
    """
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now()
        rec = {
            'at': ts.isoformat(), 'method': method, 'path': path,
            'origin': origin or '', 'ip': client_ip or '',
        }
        with open(LOGS_DIR / f'bad-route-{ts:%Y-%m-%d}.jsonl', 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
        print(f'[bad-route] client sent a malformed path: {method} {path} '
              f'ip={client_ip or "-"}', file=sys.stderr)
    except Exception as e:
        print(f'[bad-route-log] failed: {e}', file=sys.stderr)

def _log_opd_queue(event, case, user=''):
    """Append one queue event to data/logs/opd-queue-YYYY-MM-DD.jsonl.
    event: 'sent' | 'completed'."""
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now()
        rec = {
            'at': ts.isoformat(),
            'event': event,
            'id': case.get('id'),
            'hn': case.get('hn'),
            'name': case.get('name'),
            'visitId': case.get('visitId'),
            'medCount': len(case.get('meds') or []),
            'homeCount': sum(1 for m in (case.get('meds') or []) if (m.get('group') or 'home') == 'home'),
            'statCount': sum(1 for m in (case.get('meds') or []) if (m.get('group') or 'home') == 'stat'),
            'by': _hm_norm(user or '') or case.get('sentBy'),
        }
        with open(LOGS_DIR / f'opd-queue-{ts:%Y-%m-%d}.jsonl', 'a', encoding='utf-8') as f:
            f.write(json.dumps(rec, ensure_ascii=False) + '\n')
    except Exception as e:
        print(f'[opd-queue-log] failed: {e}', file=sys.stderr)

def read_opd_logs(date_from='', date_to='', limit=500):
    """Read the OPD queue event logs across a Bangkok-date range (inclusive),
    newest first. Defaults to today."""
    today = _bangkok_today()
    date_from = date_from or today
    date_to = date_to or today
    try:
        d0 = datetime.strptime(date_from, '%Y-%m-%d').date()
        d1 = datetime.strptime(date_to, '%Y-%m-%d').date()
    except Exception:
        d0 = d1 = datetime.strptime(today, '%Y-%m-%d').date()
    events = []
    cur = d0
    while cur <= d1:
        p = LOGS_DIR / f'opd-queue-{cur.strftime("%Y-%m-%d")}.jsonl'
        if p.exists():
            try:
                for line in p.read_text(encoding='utf-8').splitlines():
                    line = line.strip()
                    if line:
                        try: events.append(json.loads(line))
                        except Exception: pass
            except Exception:
                pass
        cur += timedelta(days=1)
    events.sort(key=lambda e: e.get('at', ''), reverse=True)
    return events[:limit]

def opd_queue_stats(cases):
    """Compute live stats from a case list: counts by status + waiting-time
    overdue buckets (2h/4h/6h) for still-queued cases."""
    now = datetime.now(timezone.utc)
    waiting = completed = 0
    over2 = over4 = over6 = 0
    total_wait_min = 0
    for c in cases:
        if c.get('status') == 'completed':
            completed += 1
            continue
        waiting += 1
        # Waiting minutes = now − createdAt (UTC ISO).
        try:
            s = str(c.get('createdAt') or '')
            if s.endswith('Z'): s = s[:-1] + '+00:00'
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None: dt = dt.replace(tzinfo=timezone.utc)
            mins = max(0, int((now - dt).total_seconds() // 60))
        except Exception:
            mins = 0
        total_wait_min += mins
        if mins >= 360: over6 += 1
        elif mins >= 240: over4 += 1
        elif mins >= 120: over2 += 1
    return {
        'total': len(cases), 'waiting': waiting, 'completed': completed,
        'over2h': over2, 'over4h': over4, 'over6h': over6,
        'avgWaitMin': int(total_wait_min / waiting) if waiting else 0,
    }

def list_opd_queue(date_from='', date_to=''):
    """List queued cases across the given Bangkok-date range (inclusive),
    newest first. Defaults to today only."""
    today = _bangkok_today()
    date_from = date_from or today
    date_to = date_to or today
    out = []
    try:
        d0 = datetime.strptime(date_from, '%Y-%m-%d').date()
        d1 = datetime.strptime(date_to, '%Y-%m-%d').date()
    except Exception:
        d0 = d1 = datetime.strptime(today, '%Y-%m-%d').date()
    cur = d0
    while cur <= d1:
        out.extend(_load_opd_queue_day(cur.strftime('%Y-%m-%d')))
        cur += timedelta(days=1)
    out.sort(key=lambda c: c.get('createdAt', ''), reverse=True)
    return out


def _cmp_key(s):
    """Normalise a dosage/frequency token for comparison: lowercase, collapse
    whitespace, strip punctuation-ish noise so '1 Tablet' == '1 tablet'."""
    return re.sub(r'\s+', ' ', str(s or '').strip().lower())

def tag_meds_continuity(meds, visit_history):
    """For each current OPD sheet med, look for the SAME drug code anywhere in the
    last-5-visits history and set med['continuity']:
      'continued' → same code AND same dosage+frequency  → รับยาต่อเนื่อง
      'adjusted'  → same code but dosage/frequency differ → ปรับขนาดยา
      ''          → not seen before (no matching code in history)
    The tag is a default the user can override/edit on the sheet."""
    # code -> list of {dosage, freq} seen across history (newest visits first)
    hist_by_code = {}
    for grp in (visit_history or []):
        for m in (grp.get('meds') or []):
            c = _hm_norm(m.get('code') or '')
            if not c:
                continue
            hist_by_code.setdefault(c, []).append(
                (_cmp_key(m.get('dosage')), _cmp_key(m.get('freq'))))
    for med in (meds or []):
        c = _hm_norm(med.get('code') or '')
        prior = hist_by_code.get(c)
        if not prior:
            med['continuity'] = ''
            continue
        cur = (_cmp_key(med.get('dosage')), _cmp_key(med.get('frequency')))
        med['continuity'] = 'continued' if cur in prior else 'adjusted'
    return meds


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
    """POST to ArcusAir medreconcile/getdetail. Needs ctx.medreconcileuid —
    captured client-side when the pharmacist clicks "View" on a record in
    ArcusAir's Med Reconcile list (viewMedReconcileN → this exact endpoint,
    with {"medreconcileuid": "..."} in the request body) and persisted onto
    the HMR record by content-hmr.js. Returns JSON. Best-effort — caller
    swallows errors when the uid is absent or the call fails (expired
    incusToken, ArcusAir down, etc.)."""
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
        fuid = it.get('frequencyuid') or {}
        freq_th = _hm_norm(fuid.get('locallangdesc') or '')
        freq_en = _hm_norm(fuid.get('name') or '')
        freq = freq_th or freq_en
        route = _hm_norm((it.get('routeuid') or {}).get('valuedescription') or '')
        comments = _hm_norm(it.get('comments') or '')
        recon = _hm_norm(it.get('reconcilestatus') or '')
        out.append({
            'drug': name, 'code': code,
            'status': recon, 'instruction': comments,
            'frequency': freq, 'frequencyTh': freq_th, 'frequencyEn': freq_en,
            'route': route, 'note': comments,
        })
    return out


_RECON_STATUS_MAP = {
    'CONTINUE': 'continued', 'CONTINUED': 'continued',
    'STOP': 'stopped', 'STOPPED': 'stopped', 'DISCONTINUE': 'stopped',
    'HOLD': 'changed', 'CHANGE': 'changed', 'CHANGED': 'changed', 'MODIFY': 'changed',
    'NEW': 'new', 'START': 'new',
}

def build_reconcile_meds_for_home_med(data):
    """Like build_reconcile_meds(), plus the normalized status (continued/
    stopped/changed/new — same _RECON_STATUS_MAP the Medication Journey
    continuity grid uses) and an 'addable' flag for the Home Med Sheet's
    reconciliation panel. Only 'stopped' items are non-addable — a
    discontinued medication shouldn't be pulled forward as a home med."""
    out = []
    for m in build_reconcile_meds(data):
        status = _RECON_STATUS_MAP.get((m.get('status') or '').upper(), 'new')
        out.append({**m, 'status': status, 'statusRaw': m.get('status') or '', 'addable': status != 'stopped'})
    return out

def _resolve_reconcile_meds(ctx):
    """Prefer a live ArcusAir call using the client-captured medreconcileuid:
    it's captured reliably when the pharmacist clicks "View" on a
    reconciliation record on ArcusAir's Med Reconcile list (the resulting
    ordermanagement/medreconcile/getdetail request body carries
    {"medreconcileuid": "..."}) — see the __bkn_medrecon tap in
    src/main-world's XHR hook (background.js). content-hmr.js persists that
    uid onto the HMR record as soon as it's captured, so it's available on
    a later day too, as long as a fresh incusToken is supplied here. This is
    the exact endpoint + shape build_reconcile_meds_for_home_med() expects,
    so it's tried first. Falls back to the medicationhistory/getdetails
    snapshot (auto-captured, no id required, but its response shape is only
    guessed at) if no uid is available or the live call fails."""
    have_uid  = bool(ctx.get('medreconcileuid'))
    have_snap = bool(ctx.get('medreconcileSnapshot'))
    have_tok  = bool(ctx.get('incusToken'))
    if ctx.get('medreconcileuid'):
        try:
            recon_raw = fetch_arcus_medreconcile(ctx)
            n_items = len(((recon_raw or {}).get('medreconcile') or {}).get('medicationitems') or [])
            if recon_raw:
                meds = build_reconcile_meds_for_home_med(recon_raw)
                print(f'[recon] uid live-fetch ok: items={n_items} meds={len(meds)} '
                      f'(uid={ctx.get("medreconcileuid")})', file=sys.stderr)
                if meds:
                    return meds
            else:
                print(f'[recon] uid present but live-fetch returned nothing '
                      f'(token={have_tok})', file=sys.stderr)
        except Exception as e:
            print(f'[recon] uid live-fetch failed: {e} (token={have_tok})', file=sys.stderr)
    snapshot = ctx.get('medreconcileSnapshot')
    if snapshot:
        meds = build_reconcile_meds_from_snapshot(snapshot)
        print(f'[recon] snapshot fallback: meds={len(meds)} '
              f'(snapshot keys={list(snapshot.keys()) if isinstance(snapshot, dict) else type(snapshot).__name__})',
              file=sys.stderr)
        if meds:
            return meds
    print(f'[recon] no meds resolved (uid={have_uid} snapshot={have_snap} token={have_tok})',
          file=sys.stderr)
    return []

def build_reconcile_meds_from_snapshot(snapshot):
    """Parse a client-captured emr/medicationhistory/getdetails response
    (see src/main-world/arcus-xhr-tap.js — that call fires automatically when
    the Med Reconcile page loads, so the extension caches the raw response
    instead of replaying the query server-side) into the same shape
    build_reconcile_meds_for_home_med() produces.

    The exact response shape hasn't been confirmed against a live capture, so
    this tries several plausible container keys and reuses the existing
    orderitemname/frequencyuid/routeuid/comments/reconcilestatus field
    mapping. Returns [] rather than raising if nothing recognizable is
    found — treat an empty result as "shape not recognized yet", not
    "no reconciliation data exists". Log the raw snapshot (see callers) to
    refine this if it comes back empty on a visit known to have data."""
    if not isinstance(snapshot, dict):
        return []
    items = None
    medrecon = snapshot.get('medreconcile')
    if isinstance(medrecon, dict):
        items = medrecon.get('medicationitems')
    for key in ('medicationitems', 'items', 'orders', 'data'):
        if items is None:
            candidate = snapshot.get(key)
            if isinstance(candidate, list):
                items = candidate
    if not isinstance(items, list):
        return []
    return build_reconcile_meds_for_home_med({'medreconcile': {'medicationitems': items}})


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

    # ── Note-line structure ───────────────────────────────────────────────
    # Two parts, joined by a newline:
    #   1. administrationinstruction — the doctor's free-text administration note
    #      on THIS order (getallorderitem's patientorderitems.administrationinstruction,
    #      Thai, e.g. "ยาขับลม แก้ปวดท้อง"). Optional — null/blank on most orders.
    #   2. Patient Instruction — the curated per-code note from medication-db.json
    #      (Thai localLanguage / English text), swapped by the language dropdown.
    # If administrationinstruction is null → show only the Patient Instruction.
    admin_instr = _hm_norm(poi.get('administrationinstruction') or '')

    extra = _load_extralabel_index().get(code) if code else None
    extra = extra or {}
    extra_th = extra.get('localLanguage') or ''   # curated Patient Instruction (TH)
    extra_en = extra.get('text') or ''            # curated Patient Instruction (EN)

    def _join_note(patient_instr):
        # admin-instruction first, then the curated Patient Instruction, on
        # separate lines. Drop either part if empty; avoid duplicating when the
        # admin note already equals/contains the patient instruction.
        parts = []
        if admin_instr:
            parts.append(admin_instr)
        if patient_instr and patient_instr != admin_instr and patient_instr not in admin_instr:
            parts.append(patient_instr)
        return '\n'.join(parts)

    note    = _join_note(extra_th)   # Thai note (default)
    note_en = _join_note(extra_en)   # English note (admin-instruction is Thai as-is)
    # If a language has no curated label at all, fall back to the other so the
    # line isn't blank (admin-instruction alone is language-neutral Thai).
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

    # Priority — "Stat" orders default to the STAT/used group on the OPD sheet.
    # Check the item then the order level; relatedvalue 'S' (Stat) / 'R' (Routine).
    def _uid_name(obj):
        o = _arc_first(obj) or {}
        return o if isinstance(o, dict) else {}
    _prio = (_uid_name(poi.get('priorityuid')) or _uid_name(it.get('priorityuid'))
             or _uid_name(it.get('orderpriorityuid')))
    priority = _hm_norm(_prio.get('valuedescription') or '')
    priority_rel = _hm_norm(_prio.get('relatedvalue')
                            or poi.get('orderpriorityvalue') or it.get('orderpriorityvalue') or '')
    is_stat = (priority_rel.upper() == 'S') or ('stat' in priority.lower())

    # Dispensing store / location — for sub-grouping (Outpatient Pharmacy Floor 1,
    # Central Supply, Inpatient Pharmacy Floor G/2, …). The flat getallorderitem
    # shape may carry it on the item (poi) or the order (it); try both + several
    # field names.
    def _store_from(o):
        for f in ('ordertodepartmentuid', 'invstoreuid', 'dispensestoreuid',
                  'inventorystoreuid', 'storeuid', 'departmentuid'):
            nm = _hm_norm(_uid_name(o.get(f)).get('name') or '')
            if nm:
                return nm
        return ''
    store = _store_from(poi) or _store_from(it)

    return {
        'drug': name, 'code': code, 'quantity': quantity,
        'comment': instruction, 'note': note, 'noteEn': note_en,
        'route': route, 'frequency': freq, 'frequencyTh': freq_th, 'dosage': str(dosage or ''),
        'provider': provider,
        'oral': bool(re.search(r'oral|\btake\b|รับประทาน', route + ' ' + verb, re.I)),
        'ordertype': ordertype, 'ordertypecode': ordertypecode, 'status': status, 'ordercat': ordercat,
        'priority': priority, 'isStat': is_stat, 'store': store,
        # Administration Instruction (label print) + free-text Comments, as shown
        # in the ArcusAir order-item table.
        'adminInstruction': admin_instr,
        'comments': _hm_norm(poi.get('comments') or it.get('comments') or ''),
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


def _opd_store_prio_probe(item):
    """Diagnostic: surface any key on the order-item (it) or its patientorderitems
    (poi) that looks store- or priority-related, with the resolved name/value.
    Used only in the fetch log to discover the correct field path. No PHI."""
    poi = item.get('patientorderitems')
    poi = poi if isinstance(poi, dict) else {}
    out = {'it': {}, 'poi': {}}
    for label, obj in (('it', item), ('poi', poi)):
        for k, v in (obj or {}).items():
            kl = k.lower()
            if any(t in kl for t in ('store', 'depart', 'priority', 'invstore', 'dispens', 'location')):
                if isinstance(v, dict):
                    out[label][k] = {'name': v.get('name'), 'valuedescription': v.get('valuedescription'),
                                     'relatedvalue': v.get('relatedvalue'), 'valuecode': v.get('valuecode')}
                elif isinstance(v, list) and v and isinstance(v[0], dict):
                    out[label][k] = {'name': v[0].get('name'), 'valuedescription': v[0].get('valuedescription')}
                else:
                    out[label][k] = v
    return out


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
            # Diagnostic: keys of the first raw order-item + its patientorderitems,
            # so we can see whether getallorderitem carries administrationinstruction
            # and what the order-id field is (needed to design the dispense/search
            # call). Only the KEYS + a couple of id-ish fields — not full PHI.
            'sampleOrderItemKeys': (sorted(order_items[0].keys())
                                    if order_items and isinstance(order_items[0], dict) else None),
            'samplePoiKeys': (sorted((order_items[0].get('patientorderitems') or {}).keys())
                              if order_items and isinstance(order_items[0].get('patientorderitems'), dict) else None),
            'sampleOrderIds': ({
                'it._id': order_items[0].get('_id'),
                'it.orderuid': order_items[0].get('orderuid'),
                'it.orderid': order_items[0].get('orderid'),
                'it.patientorderuid': order_items[0].get('patientorderuid'),
                'poi._id': (order_items[0].get('patientorderitems') or {}).get('_id'),
                'poi.administrationinstruction': (order_items[0].get('patientorderitems') or {}).get('administrationinstruction'),
            } if order_items and isinstance(order_items[0], dict) else None),
            # Diagnostic for store/priority field discovery (values only, no PHI):
            # which keys on it/poi look store- or priority-related and their names.
            'sampleStorePrio': (_opd_store_prio_probe(order_items[0])
                                if order_items and isinstance(order_items[0], dict) else None),
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


def build_visit_history_groups(data, current_visit_uid='', limit=5):
    """Group getallorderitem `patientorders[]` BY VISIT (not de-duped by drug) for
    the OPD sheet's medical-history panel: the last `limit` visits, newest first,
    each { visitDate, visitId, meds:[{drug, code, info, freqTh}] }. Only MEDICINE
    items; the current visit (matched on patientvisituid._id) is excluded so the
    panel is genuinely history."""
    freq_idx = _load_freq_th_index()
    visits = {}   # vuid -> {visitDate, visitId, _when, meds:[]}
    for po in ((data or {}).get('patientorders') or []):
        # patientvisituid is a dict in getallorderitem ({_id, visitid, …}) but a
        # plain string in some other endpoints — accept both.
        pv = po.get('patientvisituid')
        if isinstance(pv, dict):
            vuid = pv.get('_id') or ''
            vlabel = pv.get('visitid') or ''
        else:
            vuid = pv or ''
            vlabel = ''
        if not vuid or (current_visit_uid and vuid == current_visit_uid):
            continue
        vdate = (po.get('orderdate') or po.get('visitdate')
                 or po.get('createdat') or '')
        for poi in (po.get('patientorderitems') or []):
            if (poi.get('ordercattype') or '').upper() != 'MEDICINE':
                continue
            name = _hm_norm(poi.get('orderitemname') or '')
            if not name:
                continue
            code = _hm_norm(poi.get('chargecode') or '')
            if not _is_medicine({'code': code}):
                continue
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
            grp = visits.setdefault(vuid, {
                'visitDate': vdate, 'visitId': vlabel or vuid, '_when': vdate, 'meds': []})
            # dosage/freq kept alongside `info` so the sheet can compare a current
            # med against history (same code + same dosage+freq → รับยาต่อเนื่อง;
            # same code but different → ปรับขนาดยา).
            grp['meds'].append({'drug': name, 'code': code, 'info': info, 'freqTh': freq_th,
                                'dosage': str(dosage or ''), 'freq': freq})
    # Newest first, cap to `limit`; drop the recency key.
    out = sorted(visits.values(), key=lambda g: g.get('_when', ''), reverse=True)[:limit]
    for g in out:
        g.pop('_when', None)
    return out


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

# Per-visit client capture bag (ArcusAir params: medreconcileuid, snapshot,
# incusToken, …). Shared cross-workstation via the patient doc so one capture
# on any PC serves every PC. Entries carry a `ts` (epoch ms).
#
# Two-tier expiry, split by sensitivity:
#   • The RECORD (medreconcileuid + snapshot) — an opaque id + PHI that already
#     lives on this server — is kept CAPTURE_TTL_MS so the reconciliation panel
#     works cross-workstation for a week.
#   • The incus-token is a live ArcusAir SESSION CREDENTIAL. We keep a copy only
#     briefly (CAPTURE_TOKEN_TTL_MS) to shrink the window in which a usable
#     bearer token sits at rest. A stale token just means the server falls back
#     to the stored snapshot — the panel still works.
CAPTURE_TTL_MS       = 7 * 24 * 60 * 60 * 1000   # 7 days  (uid + snapshot)
CAPTURE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000       # 24 hours (incus-token copy)

def _capture_is_fresh(entry):
    """True while the record (uid/snapshot) is within its window."""
    try:
        ts = entry.get('ts')
        if not isinstance(ts, (int, float)):
            return False
        return (time.time() * 1000 - ts) < CAPTURE_TTL_MS
    except Exception:
        return False

def _capture_token_is_fresh(entry):
    """True while the stored incus-token copy is within its (shorter) window.
    Uses the token's own timestamp (`tokenTs`) so a snapshot-only update that
    refreshes the record `ts` can't revive a stale token; falls back to `ts` for
    entries written before tokenTs existed."""
    try:
        ts = entry.get('tokenTs', entry.get('ts'))
        if not isinstance(ts, (int, float)):
            return False
        return (time.time() * 1000 - ts) < CAPTURE_TOKEN_TTL_MS
    except Exception:
        return False

def _capture_view(entry):
    """A read-safe copy of a capture entry: drops the incus-token once its
    shorter TTL has passed, so an at-rest credential is never handed back after
    24h even though the record itself is retained for 7 days."""
    if not isinstance(entry, dict):
        return {}
    view = dict(entry)
    if not _capture_token_is_fresh(entry):
        view.pop('incusToken', None)
    return view

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

# ── Report cache helpers ───────────────────────────────────────
# Parsed report rows + metadata, keyed by (reportKey, YYYY-MM-DD), so a report
# fetched once per day is reused by everyone that day without re-fetching from
# Jasper. Retained 1 day: on every read/write we prune any cache file whose date
# isn't today (Asia/Bangkok — the pharmacy's local day). One file per
# report+date: report-cache/{reportKey}_{date}.json.
_REPORT_KEY_RE = re.compile(r'^[a-z0-9_-]{1,40}$', re.I)

def _bangkok_today():
    # Server may run in any tz; the pharmacy day is Asia/Bangkok (UTC+7).
    return (datetime.now(timezone.utc) + timedelta(hours=7)).strftime('%Y-%m-%d')

def _safe_report_key(k):
    return k if (k and _REPORT_KEY_RE.match(k)) else None

def _report_cache_file(report_key, date_key):
    return REPORT_CACHE_DIR / f'{report_key}_{date_key}.json'

def _prune_report_cache():
    """Delete any cache file not dated today (1-day retention)."""
    try:
        if not REPORT_CACHE_DIR.exists():
            return
        today = _bangkok_today()
        for p in REPORT_CACHE_DIR.glob('*.json'):
            # filename: {reportKey}_{YYYY-MM-DD}.json → date is the last 10 chars
            stem = p.stem
            if len(stem) < 11 or stem[-10:] != today:
                try: p.unlink()
                except Exception: pass
    except Exception:
        pass

def load_report_cache(report_key, date_key):
    _prune_report_cache()
    p = _report_cache_file(report_key, date_key)
    if not p.exists():
        return None
    try:
        with p.open(encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None

def save_report_cache(report_key, date_key, data):
    REPORT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _prune_report_cache()
    _atomic_write_json(_report_cache_file(report_key, date_key), data)

# ── HMR helpers ────────────────────────────────────────────────
_VISITID_RE = re.compile(r'^I48-\d{2}-\d{6}$')
_HN_RE      = re.compile(r'^48-\d{2}-\d{7}$')

def _safe_visitid(vid):
    return bool(vid and _VISITID_RE.match(vid))

_HMQ_ID_RE = re.compile(r'^HMQ-\d{8}-\d{4}$')

def _safe_hmq_id(eid):
    return bool(eid and _HMQ_ID_RE.match(eid))

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
    # Daily archive files fill in records no longer live. Skipped by filename
    # when outside the requested window (see _archive_in_range) — these are kept
    # forever, so an unfiltered scan grows by one file per day.
    for mp in sorted(HMR_DIR.glob('HM_*.json')):
        if not _archive_in_range(mp, from_date, to_date):
            continue
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

# ── HMQ (HM Process Queue) helpers ──────────────────────────────────────
# Data model per entry:
#   { id, queueNum, hn, name, ward, room, status ('new'|'process'|'done'),
#     createdAt, startedAt, completedAt, addedBy, auditLog: [{ts,user,action}] }
# Live entries: one file per entry (HMQ_DIR/HMQ-YYYYMMDD-NNNN.json). The nightly
# merge (23:00) folds only 'done' entries into one HMQ_DIR/ddmmyyyy_HM_queue.json
# per day and deletes just those live files — 'new'/'process' entries are left
# live so a patient still mid-case isn't archived away before they're actually
# done. Archive files are never deleted/rotated by this server — they're kept
# indefinitely until an admin manually cleans them up.

def hmq_file(entry_id):
    return HMQ_DIR / f'{entry_id}.json'

def _hmq_today():
    # Bangkok day (UTC+7) — independent of the server's local timezone. Must
    # match the Bangkok date the client queries and the Bangkok date derived
    # from each entry's (UTC) createdAt in load_all_hmq's filter.
    return _bangkok_today()

def _bangkok_date_of(iso_ts):
    """The Asia/Bangkok calendar date (YYYY-MM-DD) of a UTC ISO timestamp.
    createdAt is stored as UTC (_now_iso); this converts it to the Bangkok day
    so date filtering matches the client and the entry_id/queueNum day."""
    try:
        s = str(iso_ts or '')
        if s.endswith('Z'):
            s = s[:-1] + '+00:00'
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return (dt.astimezone(timezone.utc) + timedelta(hours=7)).strftime('%Y-%m-%d')
    except Exception:
        # Fallback: the raw date slice (best-effort for malformed timestamps).
        return str(iso_ts or '')[:10]

def _hmq_archive_path(date_str):
    """'YYYY-MM-DD' -> HMQ_DIR/ddmmyyyy_HM_queue.json (one file per day)."""
    y, m, d = date_str.split('-')
    return HMQ_DIR / f'{d}{m}{y}_HM_queue.json'

def load_hmq_entry(entry_id):
    p = hmq_file(entry_id)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding='utf-8'))
        except Exception:
            pass
    # Fall back to any archive — new ddmmyyyy_HM_queue.json files, or legacy
    # DAY_YYYY-MM-DD.json ones written before that naming change.
    for rec in load_all_hmq():
        if rec.get('id') == entry_id:
            return rec
    return None

def save_hmq_entry(doc):
    HMQ_DIR.mkdir(parents=True, exist_ok=True)
    doc['updatedAt'] = _now_iso()
    _atomic_write_json(hmq_file(doc['id']), doc)

def _archive_date_of(path):
    """The YYYY-MM-DD a daily archive filename encodes, or '' if unrecognised.

    Handles both namings kept by this server:
      ddmmyyyy_HM_queue.json / ddmmyyyy_HM_process.json  (current)
      DAY_YYYY-MM-DD.json                                (legacy)
    """
    n = path.name
    m = re.match(r'^(\d{2})(\d{2})(\d{4})_', n)
    if m:
        d, mo, y = m.groups()
        return f'{y}-{mo}-{d}'
    # DAY_YYYY-MM-DD.json (legacy HMQ) and HM_YYYY-MM-DD.json (HMR archives)
    m = re.match(r'^(?:DAY|HM)_(\d{4}-\d{2}-\d{2})\.json$', n)
    return m.group(1) if m else ''

def _archive_in_range(path, from_date, to_date):
    """Can this archive file hold an entry inside [from_date, to_date]?

    Filename-level prefilter so a narrow query ("Today") doesn't read and parse
    every archive ever written — these files are kept forever, so an unfiltered
    scan grows without bound (one file per day) and the dashboard gets slower
    every day it runs.

    Entries store createdAt in UTC but are filtered by BANGKOK day, so a file
    can legitimately contain entries belonging to the adjacent day. Widen the
    filename window by ±1 day and let the existing precise _bangkok_date_of()
    check below do the exact filtering — this only ever skips files that cannot
    possibly match.
    """
    if not from_date and not to_date:
        return True
    fdate = _archive_date_of(path)
    if not fdate:
        return True          # unrecognised name — never skip, read it
    try:
        d = datetime.strptime(fdate, '%Y-%m-%d')
    except ValueError:
        return True
    lo = (d - timedelta(days=1)).strftime('%Y-%m-%d')
    hi = (d + timedelta(days=1)).strftime('%Y-%m-%d')
    if from_date and hi < from_date:
        return False
    if to_date and lo > to_date:
        return False
    return True

def load_all_hmq(from_date=None, to_date=None):
    """Return all HMQ entries (live + daily archives), newest first, optionally
    filtered by createdAt date (YYYY-MM-DD, inclusive). Reads both the current
    ddmmyyyy_HM_queue.json archive naming and the legacy DAY_YYYY-MM-DD.json
    files from before that naming change — both are kept forever, never
    deleted by this server.

    Archives outside the requested window are skipped by FILENAME before being
    read (_archive_in_range); live HMQ-*.json files are always read since an
    unfinished case is never archived and its name carries no date."""
    if not HMQ_DIR.exists():
        return []
    seen = {}
    for p in HMQ_DIR.glob('HMQ-*.json'):
        try:
            doc = json.loads(p.read_text(encoding='utf-8'))
            eid = doc.get('id')
            if eid:
                seen[eid] = doc
        except Exception:
            pass
    archive_paths = sorted(HMQ_DIR.glob('*_HM_queue.json')) + sorted(HMQ_DIR.glob('DAY_*.json'))
    for mp in archive_paths:
        if not _archive_in_range(mp, from_date, to_date):
            continue
        try:
            records = json.loads(mp.read_text(encoding='utf-8'))
            if isinstance(records, list):
                for doc in records:
                    eid = doc.get('id')
                    if eid and eid not in seen:
                        seen[eid] = doc
        except Exception:
            pass
    result = list(seen.values())
    # Backfill startedBy for entries created before the field existed: recover
    # it from the audit log's "Started" line. Done on READ so no stored file is
    # rewritten (and archives, which are never rewritten, benefit too).
    for d in result:
        if not d.get('startedBy') and d.get('startedAt'):
            for entry in reversed(d.get('auditLog') or []):
                if str(entry.get('action', '')).startswith('Started'):
                    d['startedBy'] = entry.get('user') or None
                    break
    if from_date or to_date:
        # Filter by each entry's BANGKOK calendar day (createdAt is UTC), so the
        # window matches the client's Bangkok-day query and the entry's own
        # queueNum day. Comparing the raw UTC slice dropped entries created in
        # the 00:00–07:00 Bangkok window (UTC still on the previous day).
        def _date_key(d):
            return _bangkok_date_of(d.get('createdAt'))
        result = [d for d in result
                  if (not from_date or _date_key(d) >= from_date)
                  and (not to_date   or _date_key(d) <= to_date)]
    result.sort(key=lambda d: d.get('createdAt') or '', reverse=True)
    return result

_HMQ_ROOM_TOKEN_RE = re.compile(r'^[A-Za-z0-9-]+')

def _clean_room(raw):
    """A bed id is a single alphanumeric token. Detection on the client could
    concatenate it with adjacent UI text (e.g. 'CCU06Start' from a '▶ Start'
    button); strip a trailing 'Start' and keep the leading token so stored
    values stay clean. Defence-in-depth alongside the client's cleanRoom()."""
    r = str(raw or '').strip()
    if not r:
        return ''
    r = re.sub(r'Start$', '', r, flags=re.I)
    m = _HMQ_ROOM_TOKEN_RE.match(r)
    return m.group(0) if m else r

def _hmq_next_seq(today):
    """Next display queue number for today (Q1, Q2, …) — resets daily."""
    return len(load_all_hmq(today, today)) + 1

def hmq_find_active_by_hn(hn):
    """Return today's queue entry for this HN if it's still 'new' or 'process'."""
    today = _hmq_today()
    for rec in load_all_hmq(today, today):
        if rec.get('hn') == hn and rec.get('status') in ('new', 'process'):
            return rec
    return None

def create_hmq_entry(hn, name, ward, room, added_by):
    today = _hmq_today()
    seq = _hmq_next_seq(today)
    entry_id = f'HMQ-{today.replace("-", "")}-{seq:04d}'
    now = _now_iso()
    doc = {
        'id':          entry_id,
        'queueNum':    seq,
        'hn':          hn,
        'name':        name,
        'ward':        (ward or '').strip(),
        'room':        _clean_room(room),
        'status':      'new',
        'createdAt':   now,
        'startedAt':   None,
        'startedBy':   None,   # set on 'start', cleared on 'revert-new'
        'completedAt': None,
        'addedBy':     added_by,
        'auditLog':    [{'ts': now, 'user': added_by, 'action': 'Added to queue (New Case)'}],
    }
    save_hmq_entry(doc)
    return doc

def transition_hmq_entry(entry_id, action, user):
    """action: 'start' (new→process), 'complete' (process→done),
    'revert-process' (done→process), or 'revert-new' (process→new). Reverts
    clear the timestamp of the stage being undone and log the action, same
    as forward transitions."""
    doc = load_hmq_entry(entry_id)
    if not doc:
        return None
    now = _now_iso()
    if action == 'start' and doc.get('status') == 'new':
        doc['status']    = 'process'
        doc['startedAt'] = now
        # Who is working this case. Stored as its own field (not only in the
        # audit log) so the queue row can show it without scanning the log —
        # and so it survives even if the log is ever trimmed.
        doc['startedBy'] = user
        doc.setdefault('auditLog', []).append({'ts': now, 'user': user, 'action': 'Started — moved to On Process'})
    elif action == 'complete' and doc.get('status') == 'process':
        doc['status']      = 'done'
        doc['completedAt'] = now
        doc.setdefault('auditLog', []).append({'ts': now, 'user': user, 'action': 'Completed'})
    elif action == 'revert-process' and doc.get('status') == 'done':
        doc['status']      = 'process'
        doc['completedAt'] = None
        doc.setdefault('auditLog', []).append({'ts': now, 'user': user, 'action': 'Reverted — Completed back to On Process'})
    elif action == 'revert-new' and doc.get('status') == 'process':
        doc['status']    = 'new'
        doc['startedAt'] = None
        # Nobody is working it any more — clear the owner with the timestamp,
        # or the row would keep showing whoever started the previous attempt.
        doc['startedBy'] = None
        doc.setdefault('auditLog', []).append({'ts': now, 'user': user, 'action': 'Reverted — On Process back to New Case'})
    else:
        return doc  # invalid transition — return unchanged, caller decides how to respond
    save_hmq_entry(doc)
    return doc

def update_hmq_location(entry_id, ward, room, user):
    """Backfill ward/room on an existing entry so a case queued before the bed
    could be read (e.g. special-care beds like CCU06) gets its location filled.
    Fills BLANK fields, and also CORRECTS a stored room that's dirty (doesn't
    match its own cleaned single-token form, e.g. an old 'CCU06Start'); a room
    that's already clean is left untouched. Returns the doc, or None."""
    doc = load_hmq_entry(entry_id)
    if not doc:
        return None
    ward = (ward or '').strip()
    room = _clean_room(room)
    changed = False
    if ward and not (doc.get('ward') or '').strip():
        doc['ward'] = ward; changed = True
    if room:
        cur = (doc.get('room') or '').strip()
        # Fill when blank, or replace a dirty stored value (differs from clean).
        if not cur or cur != _clean_room(cur):
            doc['room'] = room; changed = True
    if changed:
        now = _now_iso()
        doc.setdefault('auditLog', []).append(
            {'ts': now, 'user': user, 'action': f'Location filled: {doc.get("ward","")} / {doc.get("room","")}'})
        save_hmq_entry(doc)
    return doc

# ── HMQ nightly merge — one ddmmyyyy_HM_queue.json per day, kept forever
#    until an admin manually cleans them up (this server never deletes or
#    rotates archive files on its own) ──
def _hmq_nightly_merge():
    """Archive only completed ('done') live HMQ-*.json entries into today's
    ddmmyyyy_HM_queue.json, then delete just those live files. 'new' and
    'process' entries are left as live files, untouched — patients still
    being worked overnight stay on the active queue instead of being swept
    into the archive mid-case. The archive file itself is written once per
    day and kept forever — still readable via load_all_hmq()/the HMQ
    Dashboard regardless of how much time has passed."""
    if not HMQ_DIR.exists():
        return
    today = _bangkok_today()   # Bangkok day, matching entry ids / queue day
    live_files = list(HMQ_DIR.glob('HMQ-*.json'))
    if not live_files:
        return
    daily_path = _hmq_archive_path(today)
    merged = {}
    if daily_path.exists():
        try:
            existing = json.loads(daily_path.read_text(encoding='utf-8'))
            if isinstance(existing, list):
                merged = {r.get('id'): r for r in existing if r.get('id')}
        except Exception:
            pass
    to_delete = []
    for p in live_files:
        try:
            doc = json.loads(p.read_text(encoding='utf-8'))
        except Exception:
            continue
        if doc.get('status') != 'done':
            continue
        eid = doc.get('id')
        if eid:
            merged[eid] = doc
        to_delete.append(p)
    if not to_delete:
        return
    _atomic_write_json(daily_path, list(merged.values()))
    for p in to_delete:
        try:
            p.unlink()
        except Exception:
            pass

def _hmq_nightly_job():
    try:
        _hmq_nightly_merge()
    except Exception as e:
        print(f'[HMQ] Nightly merge error: {e}', file=sys.stderr)
    threading.Timer(_seconds_until_2300(), _hmq_nightly_job).start()

def _start_hmq_scheduler():
    threading.Timer(_seconds_until_2300(), _hmq_nightly_job).start()

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

# ── Password hashing (RIS_RA_2026_07 — salted slow KDF) ─────────
# Passwords are stored as  "pbkdf2$<iterations>$<salt_hex>$<hash_hex>".
# Legacy accounts hold a bare 64-char SHA-256 hex digest; those are still
# accepted at login and transparently re-hashed to PBKDF2 on the next
# successful login (see the login handler), so no forced reset is needed.
PBKDF2_ITERATIONS = 240_000
_LEGACY_SHA256_RE = re.compile(r'^[0-9a-f]{64}$')

def _hash_pw(pw):
    """Hash a password with PBKDF2-HMAC-SHA256 and a fresh per-user salt."""
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'), salt, PBKDF2_ITERATIONS)
    return f'pbkdf2${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}'

def _is_legacy_hash(stored):
    return bool(_LEGACY_SHA256_RE.match(stored or ''))

def _verify_pw(pw, stored):
    """Constant-time verify against either a PBKDF2 or a legacy SHA-256 hash."""
    stored = stored or ''
    if stored.startswith('pbkdf2$'):
        try:
            _, iters, salt_hex, hash_hex = stored.split('$', 3)
            dk = hashlib.pbkdf2_hmac('sha256', pw.encode('utf-8'),
                                     bytes.fromhex(salt_hex), int(iters))
            return hmac.compare_digest(dk.hex(), hash_hex)
        except Exception:
            return False
    if _is_legacy_hash(stored):
        legacy = hashlib.sha256(pw.encode('utf-8')).hexdigest()
        return hmac.compare_digest(legacy, stored)
    return False

def _load_users():
    if not AUTH_FILE.exists():
        return {}
    try:
        return json.loads(AUTH_FILE.read_text(encoding='utf-8'))
    except Exception:
        return {}

def _save_users(users):
    _atomic_write_json(AUTH_FILE, users)

def _seed_password(env_var, label):
    """Return the seed password for a default account.

    RIS_RA_2026_08 — Default credential hygiene: never ship a reusable
    hard-coded password. Take it from an env var if the operator set one,
    otherwise generate a random one-time password and print it ONCE with a
    change-now notice. Accounts seeded this way carry must_change_pw=True.
    """
    pw = os.environ.get(env_var)
    if pw:
        print(f'  {label} created from {env_var} (change after first login)')
        return pw
    pw = secrets.token_urlsafe(12)
    print(f'  {label} created  →  one-time password: {pw}')
    print(f'     ⚠  Log in and change it immediately (or set {env_var} before first run).')
    return pw

def _ensure_default_users():
    users = _load_users()
    changed = False
    if not users:
        users['admin'] = {
            'password_hash': _hash_pw(_seed_password('BKN_ADMIN_PW', 'Default admin')),
            'role': 'admin', 'must_change_pw': True,
        }
        changed = True
    if 'Makin' not in users:
        users['Makin'] = {
            'password_hash': _hash_pw(_seed_password('BKN_SUPERADMIN_PW', 'Super-admin')),
            'role': 'super_admin', 'must_change_pw': True,
        }
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
            'HMQ (live)':    _count_files_safe(HMQ_DIR, 'HMQ-*.json'),
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
        'arcus': arcus_stats(),
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
        """True if this request may write data without a login.

        RIS_RA_2026_03 — trust is decided by NETWORK LOCATION, not extension ID:
        any `chrome-extension://` origin is accepted, but only from loopback or a
        configured trusted subnet (BKN_TRUSTED_SUBNETS). Chrome sets the Origin
        header itself, so a web page cannot forge a chrome-extension:// origin.
        This removes the per-install ID registration that kept breaking whenever
        an unpacked extension was reloaded from a different path.

        Sets `self._trust_deny` to a short reason when refusing, so the caller can
        log why (see _log_untrusted_write).
        """
        client_ip = self.client_address[0]
        origin = self.headers.get('Origin', '')
        ip_ok = _ip_is_trusted(client_ip)
        if origin.startswith('chrome-extension://'):
            if ip_ok:
                return True
            self._trust_deny = 'extension origin from untrusted network'
            return False
        # A cross-origin *website* is never trusted, even from the server's own
        # machine — a page open in a browser on the host must not inherit write
        # access just by being local.
        if origin:
            self._trust_deny = 'non-extension origin'
            return False
        # No Origin header: same-origin first-party pages (e.g. /opd-queue-view)
        # and local tooling like curl. Loopback only — not the whole subnet.
        try:
            if ipaddress.ip_address(client_ip).is_loopback:
                return True
        except ValueError:
            pass
        self._trust_deny = 'no Origin header (non-local)'
        return False

    def _allow_write(self, ext_data_write):
        """Gate a login-less data write: allow it, else fall back to a role check.

        Returns True if the request may proceed. When the trusted-client check
        failed we log the rejection (RIS_RA_2026_03) before falling back, so an
        untrusted workstation is visible in data/logs/ instead of silently
        surfacing as a bare 401 that looks like an ordinary auth failure.
        Requests carrying a valid session are NOT logged — those are normal
        logged-in admin writes, not trust misses.
        """
        if ext_data_write:
            return True
        if not self._session():
            _log_untrusted_write(
                self.command, self.path,
                self.headers.get('Origin', ''), self.client_address[0],
                getattr(self, '_trust_deny', 'not a trusted client'),
            )
        return self._require('super_admin', 'admin', 'editor')

    def _session(self):
        """Return session dict {username, role} or None."""
        h = self.headers.get('Authorization', '')
        if h.startswith('Bearer '):
            return _sessions.get(h[7:])
        return None

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

        # /api/report/home-med-opd — OPD version: getallorderitem DAILYORDER by patientvisituid
        if parts == ['api', 'report', 'home-med-opd']:
            return 'report-home-med-opd', None, None

        # /api/report/med-journey — all orders grouped into a continuity timeline
        if parts == ['api', 'report', 'med-journey']:
            return 'report-med-journey', None, None

        # /api/report/reconcile-api — standalone reconciliation refresh (Home
        # Medication Sheet's ↻ button, without re-running the whole discharge fetch)
        if parts == ['api', 'report', 'reconcile-api']:
            return 'report-reconcile-api', None, None

        # /api/report-cache/{reportKey}/{YYYY-MM-DD} — parsed report rows cache
        # (GET load, PUT save), 1-day retention. key=report_key, extra=date.
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'report-cache':
            rk = _safe_report_key(parts[2])
            return ('report-cache', rk, None) if rk else (None, None, None)
        if len(parts) == 4 and parts[0] == 'api' and parts[1] == 'report-cache':
            rk = _safe_report_key(parts[2])
            date = parts[3]
            if rk and DATE_RE.match(date):
                return 'report-cache', rk, date
            return None, None, None

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
            # /api/patients/{puid}/captures/{visituid} -> per-visit capture bag
            # (client-captured ArcusAir params: medreconcileuid, snapshot, token,
            # …). Shared cross-workstation so one capture serves every PC.
            if sub == 'captures' and len(parts) == 5:
                visituid = urllib.parse.unquote(parts[4])
                if not _safe_puid(visituid):
                    return None, None, None
                return 'patient-captures', puid, visituid

        # /api/hmr               → ('hmr-list', None, None)
        # /api/hmr/{visitid}     → ('hmr', visitid, None)
        if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'hmr':
            if len(parts) == 2:
                return 'hmr-list', None, None
            vid = urllib.parse.unquote(parts[2])
            if not _safe_visitid(vid):
                return None, None, None
            return 'hmr', vid, None

        # /api/opd-queue         → ('opd-queue', None, None)  (GET: list, POST: add)
        # /api/opd-queue/{id}    → ('opd-queue', id, None)    (PUT: complete)
        # /api/opd-logs          → ('opd-logs', None, None)   (GET: event feed)
        if parts == ['api', 'opd-queue']:
            return 'opd-queue', None, None
        if len(parts) == 3 and parts[0] == 'api' and parts[1] == 'opd-queue':
            cid = urllib.parse.unquote(parts[2])
            if re.fullmatch(r'OPDQ-\d{8}-\d{3}', cid):
                return 'opd-queue', cid, None
            return None, None, None
        if parts == ['api', 'opd-logs']:
            return 'opd-logs', None, None

        # /api/hmq               → ('hmq-list', None, None)  (GET: list, POST: add)
        # /api/hmq/{id}          → ('hmq', id, None)          (PUT: start/complete)
        if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'hmq':
            if len(parts) == 2:
                return 'hmq-list', None, None
            eid = urllib.parse.unquote(parts[2])
            if not _safe_hmq_id(eid):
                return None, None, None
            return 'hmq', eid, None

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

        if clean in ('/hmq-report', '/hmq-report.html'):
            self._serve_file(WWW_DIR / 'hmq-report.html', 'text/html; charset=utf-8'); return

        if clean in ('/opd-queue-view', '/opd-queue.html'):
            self._serve_file(WWW_DIR / 'opd-queue.html', 'text/html; charset=utf-8'); return

        if clean in ('/opd-dashboard', '/opd-dashboard.html'):
            self._serve_file(WWW_DIR / 'opd-dashboard.html', 'text/html; charset=utf-8'); return
        if clean in ('/index', '/home'):
            # Explicit route to the legacy index.html (dashboard.html shadows it at /).
            self._serve_file(WWW_DIR / 'index.html', 'text/html; charset=utf-8'); return
        if clean in ('/', '/index.html', ''):
            # Prefer the new Pixi dashboard when present; otherwise keep legacy index.html.
            dash = WWW_DIR / 'dashboard.html'
            self._serve_file(dash if dash.exists() else (WWW_DIR / 'index.html'), 'text/html; charset=utf-8'); return
        if clean.startswith('/static/'):
            self._serve_file_under(WWW_DIR, urllib.parse.unquote(clean.lstrip('/')), None); return

        # ── Extension sync (see "Extension sync" in README) ────
        # /api/ext-version → the version the server is publishing, so a client
        # can skip the download when it is already current.
        if clean == '/api/ext-version':
            self.send_json(200, _ext_pkg_info()); return
        # /ext-download → the packaged extension ZIP. Built on demand from
        # EXT_SRC_DIR and cached until the source manifest version changes.
        if clean == '/ext-download':
            info = _ext_pkg_info()
            if not info.get('version'):
                self.send_json(503, {'error': 'No extension package available'}); return
            try:
                zip_path = _ext_build_zip()
            except Exception as e:
                self.send_json(500, {'error': f'Package build failed: {e}'}); return
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Length', str(zip_path.stat().st_size))
            self.send_header('Content-Disposition',
                             f'attachment; filename="BKNPharmacyPortal-{info["version"]}.zip"')
            self._cors()
            self.end_headers()
            with zip_path.open('rb') as f:
                shutil.copyfileobj(f, self.wfile)
            return
        # /update-extension → the one-click updater a workstation keeps on its
        # Desktop. It is a tiny bootstrap that re-downloads /ext-sync.bat each
        # run, so the copy on the PC never goes stale. Served with this server's
        # own address baked in, so the staff member never edits anything.
        if clean in ('/update-extension', '/update-extension.bat',
                     '/BKN-Update-Extension.bat'):
            src = WWW_DIR / 'BKN-Update-Extension.bat'
            if not src.exists():
                self.send_json(404, {'error': 'updater not installed on server'}); return
            host = (self.headers.get('Host', '') or '').strip() \
                   or f'{getattr(Handler, "_ip", "127.0.0.1")}:{getattr(Handler, "_port", DEFAULT_PORT)}'
            text = src.read_text(encoding='utf-8')
            text = re.sub(r'(?m)^set "SERVER=.*"$', f'set "SERVER=http://{host}"', text, count=1)
            body = text.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Content-Disposition',
                             'attachment; filename="BKN-Update-Extension.bat"')
            self._cors()
            self.end_headers()
            self.wfile.write(body); return
        # /ext-sync.bat → the client sync script, pre-filled with this server's
        # own URL so a workstation needs no hand-editing.
        if clean in ('/ext-sync.bat', '/ext-sync'):
            body = _ext_sync_bat(self.headers.get('Host', '')).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Content-Disposition', 'attachment; filename="bkn-ext-sync.bat"')
            self._cors()
            self.end_headers()
            self.wfile.write(body); return

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

        # ArcusAir upstream call monitoring (counts, latency, error rate).
        if clean in ('/api/arcus-stats', '/api/arcus-status'):
            self.send_json(200, arcus_stats())
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
        elif rtype == 'patient-captures':
            doc = load_or_create_patient(key)
            entry = (doc.get('captures') or {}).get(extra)
            # Enforce the capture TTL at read time — an expired record reads as
            # empty; a still-valid record has its incus-token stripped once the
            # shorter token TTL has passed (see _capture_view).
            if entry and _capture_is_fresh(entry):
                self.send_json(200, _capture_view(entry))
            else:
                self.send_json(200, {})
        elif rtype == 'hmr':
            doc = load_hmr(key)
            self.send_json(200, doc or {})
        elif rtype == 'hmr-list':
            qs        = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            from_date = (qs.get('from') or [None])[0]
            to_date   = (qs.get('to')   or [None])[0]
            # Same bounded default as hmq-list above: no window means today, not
            # "every archive ever written". Explicit all=1 opts back in.
            if not from_date and not to_date and not (qs.get('all') or [''])[0]:
                from_date = to_date = _hmq_today()
            self.send_json(200, load_all_hmr(from_date, to_date))
        elif rtype == 'hmq':
            doc = load_hmq_entry(key)
            self.send_json(200, doc or {})
        elif rtype == 'hmq-list':
            qs        = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            from_date = (qs.get('from') or [None])[0]
            to_date   = (qs.get('to')   or [None])[0]
            # Default to TODAY when the caller gives no window. Without this an
            # omitted (or cleared) date input reads every archive ever written —
            # unbounded work that grows by one file per day. A caller that really
            # wants everything must ask for it explicitly with all=1.
            if not from_date and not to_date and not (qs.get('all') or [''])[0]:
                from_date = to_date = _hmq_today()
            self.send_json(200, load_all_hmq(from_date, to_date))
        elif rtype == 'opd-queue':
            qs        = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            from_date = (qs.get('from') or [''])[0]
            to_date   = (qs.get('to')   or [''])[0]
            q = list_opd_queue(from_date, to_date)
            self.send_json(200, {'ok': True, 'queue': q, 'stats': opd_queue_stats(q)})
        elif rtype == 'opd-logs':
            qs        = urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
            from_date = (qs.get('from') or [''])[0]
            to_date   = (qs.get('to')   or [''])[0]
            q = list_opd_queue(from_date, to_date)
            self.send_json(200, {'ok': True, 'stats': opd_queue_stats(q),
                                 'logs': read_opd_logs(from_date, to_date)})
        elif rtype == 'report-cache':
            # GET /api/report-cache/{key}[/{date}] — default date = today (BKK).
            date_key = extra or _bangkok_today()
            entry = load_report_cache(key, date_key)
            self.send_json(200, entry or {})
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
        # An unparseable route yields rtype None, which would otherwise fall
        # through the trust gate below and surface as a misleading 401 ("not a
        # trusted client") even for a perfectly trusted workstation — that is
        # what a malformed puid such as the literal string "[object Object]"
        # produces. Answer 400 so the client bug is visible as a client bug.
        if rtype is None:
            if self._is_trusted_extension():
                _log_bad_route(self.command, self.path,
                               self.headers.get('Origin', ''), self.client_address[0])
                self.send_json(400, {'error': 'Malformed route (bad identifier in path)'})
                return
        # Allow the trusted Chrome extension to write data routes without login.
        # User-management routes always require explicit auth.
        ext_data_write = self._is_trusted_extension() and rtype in (
            'kpi-day', 'kpi-section', 'ks', 'rx', 'rx-note',
            'med-image-upload', 'ks-file-upload', 'schedule',
            'patient', 'patient-context', 'patient-adr', 'patient-medcache',
            'patient-captures', 'report-cache', 'hmr', 'hmq', 'opd-queue',
        )
        # IV-Sticker master data (iv-drugs / iv-staff) is admin-only: editable
        # solely through the Pattern Editor's "IV Sticker DB" tab by a logged-in
        # admin/editor. A trusted extension alone is NOT enough — force the
        # role check even though the collection rides the generic 'rx' route.
        if rtype == 'rx' and key in RX_ADMIN_WRITE_COLS:
            ext_data_write = False
        # The OPD queue viewer (/opd-queue-view) is a first-party server page, not
        # the extension — allow its Complete action (opd-queue PUT) without login,
        # like the workflow queue it drives. Cross-origin is still blocked by CORS.
        if rtype == 'opd-queue':
            ext_data_write = True
        if not self._allow_write(ext_data_write): return

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

        elif rtype == 'patient-captures':
            # Per-visit capture bag, shared cross-workstation. Merge non-empty
            # fields into the existing entry (so a snapshot from one PC + a fresh
            # token from another coexist), stamp timestamps, prune expired visits.
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            doc = load_or_create_patient(key)
            captures = doc.get('captures') or {}
            # Drop expired entries so the bag can't grow unbounded over time.
            captures = {v: e for v, e in captures.items()
                        if isinstance(e, dict) and _capture_is_fresh(e)}
            prev = captures.get(extra) or {}
            merged = dict(prev)
            now_ms = int(time.time() * 1000)
            token_supplied = False
            for k, v in body.items():
                if k in ('ts', 'tokenTs'):
                    continue
                if v is not None and v != '':
                    merged[k] = v
                    if k == 'incusToken':
                        token_supplied = True
            merged['ts'] = now_ms   # record TTL window (7 days)
            # Stamp the token's own time only when a token was actually supplied,
            # so a later snapshot-only update can't revive an old token's TTL.
            if token_supplied:
                merged['tokenTs'] = now_ms
            captures[extra] = merged
            doc['captures'] = captures
            save_patient(key, doc)
            self.send_json(200, {'ok': True})

        elif rtype == 'report-cache':
            # PUT /api/report-cache/{key}/{date} — store parsed rows + meta for
            # the day. Body: {rows:[...], meta:{...}}. 1-day retention (pruned on
            # write). date is required in the URL for a write.
            if not extra:
                self.send_json(400, {'error': 'date required in URL'}); return
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            entry = {
                'reportKey': key,
                'date':      extra,
                'rows':      body.get('rows') if isinstance(body.get('rows'), list) else [],
                'meta':      body.get('meta') if isinstance(body.get('meta'), dict) else {},
                'source':    body.get('source') or 'manual',   # 'manual' | 'auto'
                'savedAt':   _now_iso(),
            }
            save_report_cache(key, extra, entry)
            self.send_json(200, {'ok': True, 'rows': len(entry['rows'])})

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

        elif rtype == 'opd-queue':
            # Complete a queued case: {'action': 'complete', 'user'}.
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            action = body.get('action')
            user   = (body.get('user') or '').strip()
            if action != 'complete':
                self.send_json(400, {'error': "action must be 'complete'"}); return
            doc = complete_opd_queue_case(key, user)
            if doc is None:
                self.send_json(404, {'error': 'Case not found'}); return
            self.send_json(200, {'ok': True, 'case': doc}); return

        elif rtype == 'hmq':
            # Advance/revert a queue entry, or backfill its ward/room:
            #   {'action': 'start'|'complete'|'revert-process'|'revert-new', 'user'}
            #   {'action': 'update-loc', 'ward', 'room', 'user'}  (fills blanks only)
            if not isinstance(body, dict):
                self.send_json(400, {'error': 'Body must be a JSON object'}); return
            action = body.get('action')
            user   = body.get('user') or 'Unknown'
            if action == 'update-loc':
                doc = update_hmq_location(key, (body.get('ward') or '').strip(),
                                          (body.get('room') or '').strip(), user)
                if doc is None:
                    self.send_json(404, {'error': 'Queue entry not found'}); return
                self.send_json(200, doc); return
            if action not in ('start', 'complete', 'revert-process', 'revert-new'):
                self.send_json(400, {'error': "action must be 'start', 'complete', 'revert-process', 'revert-new', or 'update-loc'"}); return
            doc = transition_hmq_entry(key, action, user)
            if doc is None:
                self.send_json(404, {'error': 'Queue entry not found'}); return
            self.send_json(200, doc)

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
                users[key].pop('must_change_pw', None)  # RIS_RA_2026_08
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
            if not u or not _verify_pw(password, u.get('password_hash')):
                self.send_json(401, {'error': 'Invalid credentials'}); return
            # RIS_RA_2026_07 — transparently upgrade legacy SHA-256 hashes to
            # PBKDF2 on the next successful login (no forced reset).
            if _is_legacy_hash(u.get('password_hash')):
                u['password_hash'] = _hash_pw(password)
                _save_users(users)
            token = _create_session(username, u['role'])
            self.send_json(200, {
                'token': token, 'username': username, 'role': u['role'],
                'mustChangePw': bool(u.get('must_change_pw')),
            }); return

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

        # ── OPD QUEUE: pharmacist sends a case to the dispensing zone ──
        if rtype == 'opd-queue':
            hn = (body.get('hn') or '').strip()
            meds = body.get('meds')
            if not hn:
                self.send_json(400, {'error': 'hn is required'}); return
            if not isinstance(meds, list) or not meds:
                self.send_json(400, {'error': 'meds (non-empty list) is required'}); return
            # Duplicate guard: same visit already sent today?
            existing, _day = find_opd_queue_for_visit(
                hn, body.get('visitId'), body.get('patientvisituid'))
            force = bool(body.get('force'))
            if existing and not force:
                self.send_json(409, {
                    'error': 'duplicate',
                    'completed': existing.get('status') == 'completed',
                    'existing': existing,
                }); return
            if existing and force:
                if existing.get('status') == 'completed':
                    # Already dispensed — a re-send must not silently reopen it;
                    # the client is told to contact the dispensing zone. But if the
                    # pharmacist still forces, add a NEW case so nothing is lost.
                    stored = add_opd_queue_case(body)
                    self.send_json(201, {'ok': True, 'case': stored, 'note': 'was-completed'}); return
                updated = update_opd_queue_case(existing.get('id'), body)
                if updated:
                    self.send_json(200, {'ok': True, 'case': updated, 'updated': True}); return
            stored = add_opd_queue_case(body)
            self.send_json(201, {'ok': True, 'case': stored}); return

        # ── HMQ: add a new case to today's queue ────────────────
        if rtype == 'hmq-list':
            hn   = (body.get('hn') or '').strip()
            name = (body.get('name') or '').strip()
            if not hn or not name:
                self.send_json(400, {'error': 'hn and name are required'}); return
            ward     = (body.get('ward') or '').strip()
            room     = (body.get('room') or '').strip()
            added_by = (body.get('addedBy') or 'Unknown').strip()
            dup = hmq_find_active_by_hn(hn)
            if dup:
                self.send_json(409, {'error': 'duplicate', 'existing': dup}); return
            doc = create_hmq_entry(hn, name, ward, room, added_by)
            self.send_json(201, doc); return

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
            # Medication Reconciliation panel — best-effort; prefers the
            # client-captured snapshot, see _resolve_reconcile_meds().
            result['reconcileMeds'] = _resolve_reconcile_meds(ctx)
            result['hasReconcile'] = bool(result['reconcileMeds'])
            result['ok'] = True
            result['source'] = 'arcus-api'
            self.send_json(200, result)
            return

        # ── OPD Home Medication Sheet: DAILY ORDER meds via getallorderitem ──
        if rtype == 'report-home-med-opd':
            ctx = body.get('context') or {}
            if not ctx.get('patientuid') or not ctx.get('patientvisituid'):
                self.send_json(400, {'error': 'patientuid + patientvisituid required'}); return
            if not ctx.get('incusToken'):
                self.send_json(400, {'error': 'incusToken missing — open the patient on ArcusAir first'}); return
            try:
                data = fetch_arcus_opd_meds(ctx)
            except urllib.error.HTTPError as e:
                self.send_json(502, {'error': f'ArcusAir HTTP {e.code} — token may be expired'}); return
            except Exception as e:
                self.send_json(500, {'error': f'ArcusAir fetch error: {e}'}); return
            try:
                result = build_home_med_from_opd(data)
            except Exception as e:
                self.send_json(500, {'error': f'Parse error: {e}'}); return
            _log_home_med_fetch(ctx, data, result)
            # Allergies — best-effort (OPD has patientuid + patientvisituid).
            try:
                result['allergies'] = build_allergies_from_arcus(fetch_arcus_allergies(ctx))
            except Exception as e:
                result['allergies'] = {'nkda': False, 'items': [], 'hasRecord': False, 'error': str(e)}
            # OPD panel = recent visits' medical history (replaces reconciliation),
            # fetched from patientorder/search and grouped by visit (this visit
            # excluded). Return up to OPD_HISTORY_MAX groups so the client's visit-
            # count selector can slice locally without a re-fetch.
            result['visitHistory'] = build_opd_visit_history(
                ctx, ctx.get('patientvisituid', ''), OPD_HISTORY_MAX)
            # Tag each current med by continuity vs. the history (รับยาต่อเนื่อง /
            # ปรับขนาดยา) — a default the pharmacist can override. Compare against
            # the DEFAULT window so the tag doesn't shift when the user changes N.
            try:
                tag_meds_continuity(result.get('meds'),
                                    (result.get('visitHistory') or [])[:OPD_HISTORY_DEFAULT])
            except Exception:
                pass
            # Future appointments — same source as the IPD sheet; best-effort.
            try:
                result['appointmentText'] = format_appointments_th(fetch_arcus_future_appointments(ctx))
            except Exception as e:
                result['appointmentText'] = f'(ไม่สามารถโหลดนัดหมายได้: {e})'
            # Current-visit summary panel: vital signs + visit summary + doctor
            # notes. All best-effort — a failure just leaves that section empty.
            result['visitSummary'] = build_opd_visit_summary(ctx)
            # OPD sheets carry no discharge reconciliation.
            result['reconcileMeds'] = []
            result['hasReconcile'] = False
            result['ok'] = True
            result['source'] = 'arcus-opd'
            self.send_json(200, result)
            return

        # ── Standalone reconciliation refresh (Home Med Sheet's ↻ button) ──
        if rtype == 'report-reconcile-api':
            ctx = body.get('context') or {}
            if not ctx.get('medreconcileSnapshot') and not ctx.get('incusToken'):
                self.send_json(400, {'error': 'incusToken missing — open the patient on ArcusAir first'}); return
            recon_meds = _resolve_reconcile_meds(ctx)
            self.send_json(200, {'ok': True, 'reconcileMeds': recon_meds, 'hasReconcile': bool(recon_meds)})
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

        # ── KPI med errors ────────────────────────────────────
        # Same trust model as the KPI PUT routes (kpi-day/kpi-section): the KPI
        # app writes as a chrome-extension origin without logging in, so allow
        # the trusted extension to append a med-error record without a session.
        # Anyone else must be editor/admin/super_admin.
        ext_data_write = self._is_trusted_extension() and rtype == 'kpi-med-errors'
        if not self._allow_write(ext_data_write): return
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

        # Same trust model as the KPI writes: the extension (chrome-extension
        # origin) may remove a med-error record or a drug's Patient Instruction
        # without logging in; anyone else needs editor/admin/super_admin.
        ext_data_write = self._is_trusted_extension() and rtype in ('kpi-med-error-item', 'rx-note')
        if not self._allow_write(ext_data_write): return

        # DELETE /api/rx-note/:code — remove a drug's Patient Instruction(s).
        if rtype == 'rx-note':
            if not key:
                self.send_json(400, {'error': 'code required in URL'}); return
            ok = delete_rx_note(key)
            self.send_json(200 if ok else 404,
                           {'ok': ok} if ok else {'error': 'Unknown item code'})
            return

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
    HMR_DIR.mkdir(parents=True, exist_ok=True)
    HMQ_DIR.mkdir(parents=True, exist_ok=True)
    OPD_QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    EXT_PKG_DIR.mkdir(parents=True, exist_ok=True)
    WWW_DIR.mkdir(parents=True, exist_ok=True)
    for col in KS_COLS:
        p = ks_file(col)
        if not p.exists():
            p.write_text('[]', encoding='utf-8')
    for col in RX_COLS:
        p = rx_file(col)
        if not p.exists():
            # Seed the IV-Sticker master data from the built-in defaults on first
            # run so the server is the source of truth; all others start empty.
            if col == 'iv-drugs':
                _atomic_write_json(p, IV_DRUGS_SEED)
            elif col == 'iv-staff':
                _atomic_write_json(p, IV_STAFF_SEED)
            else:
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
    # Schedule HMR / HMQ nightly merges at 23:00
    _start_hmr_scheduler()
    _start_hmq_scheduler()
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
    _init_data_dirs()

    # Make the write-trust boundary visible at startup — a mistyped
    # BKN_TRUSTED_SUBNETS otherwise only shows up as workstations failing to save.
    print('[trust] login-less writes allowed from chrome-extension:// origins on: '
          + (', '.join(str(n) for n in TRUSTED_SUBNETS) or '(loopback only)'),
          file=sys.stderr)

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
