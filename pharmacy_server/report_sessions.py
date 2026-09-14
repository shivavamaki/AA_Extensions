"""Opaque-ID scoped HM jobs. Arcus credentials exist only in worker memory."""
import copy
import json
import re
import secrets
import threading
import time
from hm_report_cache import thai_date, next_cleanup, RETENTION_DAYS
from pathlib import Path


class SessionError(Exception):
    def __init__(self, status, message):
        self.status, self.message = status, message


class ReportSessions:
    def __init__(self, directory, builder, writer):
        self.directory = Path(directory)
        self.builder, self.writer = builder, writer
        self.lock = threading.RLock()
        self.active = set()
        self.slots = threading.BoundedSemaphore(4)
        self.cleanup_started = False

    def path(self, key):
        if not re.fullmatch(r'[a-f0-9]{32}', key or ''):
            raise SessionError(404, 'Report session not found')
        return self.directory / (key + '.json')

    def read(self, owner, key):
        try:
            doc = json.loads(self.path(key).read_text(encoding='utf-8'))
        except (OSError, ValueError):
            raise SessionError(404, 'Report session not found')
        if doc['owner'] != owner:
            raise SessionError(404, 'Report session not found')
        if self.expired(doc) and key not in self.active:
            raise SessionError(410, 'Report session expired; open a fresh report from ArcusAir')
        # Jobs cannot retain upstream credentials across server restarts.
        if doc['status'] == 'building' and key not in self.active:
            doc['status'] = 'interrupted'
            doc['error'] = 'Server restarted; refresh with current Arcus context'
        return doc

    def persist(self, doc):
        doc['updatedAt'] = time.time()
        self.directory.mkdir(parents=True, exist_ok=True)
        self.writer(self.path(doc['id']), doc)

    def expired(self, doc, now=None):
        saved = doc.get('updatedAt', doc['createdAt'])
        return (thai_date(time.time() if now is None else now) - thai_date(saved)).days >= RETENTION_DAYS

    def cleanup(self, now=None):
        removed = 0
        with self.lock:
            for path in self.directory.glob('*.json'):
                if not re.fullmatch(r'[a-f0-9]{32}', path.stem) or path.is_symlink() or path.stem in self.active:
                    continue
                try:
                    doc = json.loads(path.read_text(encoding='utf-8'))
                    if self.expired(doc, now):
                        path.unlink()
                        removed += 1
                except (OSError, ValueError, KeyError, TypeError, OverflowError):
                    continue
        return removed

    def start_cleanup(self):
        with self.lock:
            if self.cleanup_started:
                return
            self.cleanup_started = True
        def run():
            while True:
                self.cleanup()
                deadline = next_cleanup(time.time())
                while time.time() < deadline:
                    time.sleep(min(60, max(0, deadline-time.time())))
        threading.Thread(target=run, name='report-session-cleanup', daemon=True).start()

    def validate(self, request, context):
        if not isinstance(request, dict) or not isinstance(context, dict):
            raise SessionError(400, 'request and context objects required')
        if request.get('schemaVersion') != 1 or request.get('reportType') not in ('home-med-ipd', 'home-med-opd'):
            raise SessionError(400, 'Unsupported report contract')
        identity = request.get('identity') or {}
        if not isinstance(identity, dict):
            raise SessionError(400, 'Invalid identity')
        for field, legacy in [('patientUid', 'patientuid'), ('visitUid', 'patientvisituid')]:
            value = identity.get(field)
            if not isinstance(value, str) or not value.strip() or value != context.get(legacy):
                raise SessionError(400, 'Report identity does not match context')
        if not isinstance(context.get('incusToken'), str) or not context['incusToken']:
            raise SessionError(400, 'Current Arcus context token required')
        presentation = request.get('presentation') or {}
        if not isinstance(presentation, dict):
            raise SessionError(400, 'Invalid presentation')
        language = presentation.get('language', 'th')
        if language not in ('th','lo','my','km','vi','id','ms','tl','zh-CN','zh-TW','ja','ko','hi','bn','en','ar','fr','ru'):
            raise SessionError(400, 'Unsupported language')
        if presentation.get('templateVersion', 'hm-a4-v1') != 'hm-a4-v1':
            raise SessionError(400, 'Unsupported template')
        # Persist only the defined contract, never arbitrary caller metadata.
        return dict(schemaVersion=1, reportType=request['reportType'],
                    identity={k: identity[k] for k in ('patientUid','visitUid')},
                    presentation=dict(language=language, templateVersion='hm-a4-v1'))

    def create(self, owner, request, context):
        request = self.validate(request, context)
        with self.lock:
            doc = dict(id=secrets.token_hex(16), owner=owner, request=request,
                       revision=0, status='new', source=None, edits={}, rendered=None,
                       history=[], createdAt=time.time())
            doc['displayContext'] = {k: context[k] for k in ('patientName','hn','patientId','an','patientVisitId','room','bed','doctor','diagnosis','pharmacistName','mode') if isinstance(context.get(k), str)}
            return self.start(doc, context)

    def get(self, owner, key):
        with self.lock:
            return self.read(owner, key)

    def check_revision(self, doc, revision):
        if type(revision) is not int or revision != doc['revision']:
            raise SessionError(409, 'Revision conflict; reload before saving')

    def refresh(self, owner, key, revision, context):
        with self.lock:
            doc = self.read(owner, key)
            self.check_revision(doc, revision)
            self.validate(doc['request'], context)
            if key in self.active:
                raise SessionError(409, 'Report build already in progress')
            return self.start(doc, context)

    def start(self, doc, context):
        if not self.slots.acquire(blocking=False):
            raise SessionError(503, 'Report workers busy; retry shortly')
        key = doc['id']
        doc['revision'] += 1
        doc['status'], doc['error'] = 'building', None
        self.active.add(key)
        try:
            self.persist(doc)
        except Exception:
            self.active.discard(key)
            self.slots.release()
            raise
        snapshot = copy.deepcopy(doc)
        def run():
            try:
                result = self.builder(doc['request'], context)
                if not isinstance(result, dict) or not result.get('ok'):
                    raise ValueError('Invalid builder output')
                with self.lock:
                    current = self.read(doc['owner'], key)
                    current['source'] = result
                    current['edits'] = {}  # explicit refresh discards previous edits
                    current['rendered'] = None
                    current['status'] = 'ready'
                    current['revision'] += 1
                    current['history'].append(dict(revision=current['revision'], action='build', at=time.time()))
                    self.persist(current)
            except Exception:
                with self.lock:
                    current = self.read(doc['owner'], key)
                    current['status'] = 'error'
                    current['error'] = 'Report build failed; check Arcus session and retry'
                    current['revision'] += 1
                    self.persist(current)
            finally:
                with self.lock:
                    self.active.discard(key)
                    self.slots.release()
        threading.Thread(target=run, name='hm-report-job', daemon=True).start()
        return snapshot

    def save(self, owner, key, revision, edits):
        if not isinstance(edits, dict) or set(edits) - {'medicines', 'pharmNote'}:
            raise SessionError(400, 'edits must contain medicines only')
        if not isinstance(edits.get('pharmNote', ''), str) or len(edits.get('pharmNote', '')) > 10000:
            raise SessionError(400, 'Invalid pharmacist note')
        medicines = edits.get('medicines')
        fields = {'drug','code','instruction','quantity','note','noteEn','continuity','provider','frequencyTh','source','store','dispenseGroup','continueStartDate','continueEndDate','continueNote','adminInstruction','comments'}
        if not isinstance(medicines, list) or len(medicines) > 500:
            raise SessionError(400, 'Invalid medicines list')
        for row in medicines:
            if not isinstance(row, dict) or set(row) - fields - {'instructionEdited','takeUntilFinished','continueTicks'}:
                raise SessionError(400, 'Invalid medicine edit fields')
            if any(not isinstance(v,str) or len(v)>10000 for k,v in row.items() if k in fields):
                raise SessionError(400, 'Invalid medicine text')
            if any(type(row[k]) is not bool for k in ('instructionEdited','takeUntilFinished') if k in row):
                raise SessionError(400, 'Invalid medicine flags')
            ticks = row.get('continueTicks', {})
            if not isinstance(ticks,dict) or len(ticks)>5000 or any(not isinstance(k,str) or len(k)>100 or type(v) is not bool for k,v in ticks.items()):
                raise SessionError(400, 'Invalid continuation ticks')
        with self.lock:
            doc = self.read(owner, key)
            self.check_revision(doc, revision)
            if doc['status'] != 'ready':
                raise SessionError(409, 'Report is not ready')
            doc['edits'] = copy.deepcopy(edits)
            doc['rendered'] = None
            doc['revision'] += 1
            doc['history'].append(dict(revision=doc['revision'], action='edit', at=time.time()))
            self.persist(doc)
            return doc
