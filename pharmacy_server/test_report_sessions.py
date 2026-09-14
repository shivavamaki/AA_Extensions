import json
import tempfile
import time
import unittest
import threading
from pathlib import Path
from report_sessions import ReportSessions, SessionError

class SessionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.ctx=dict(patientuid='test-patient', patientvisituid='test-visit', incusToken='DO-NOT-PERSIST')
        self.req=dict(schemaVersion=1,reportType='home-med-ipd',identity=dict(patientUid='test-patient',visitUid='test-visit'))
        self.store=ReportSessions(self.tmp.name,lambda r,c:dict(ok=True,meds=[dict(code='test',quantity='1')]),self.write)
    def tearDown(self): self.tmp.cleanup()
    def write(self,p,d): p.write_text(json.dumps(d),encoding='utf-8')
    def ready(self,doc):
        for _ in range(200):
            doc=self.store.get('alice',doc['id'])
            if doc['status']!='building':return doc
            time.sleep(.01)
        self.fail('worker did not finish')
    def test_build_edit_conflict_refresh(self):
        doc=self.ready(self.store.create('alice',self.req,self.ctx))
        self.assertEqual(doc['status'],'ready')
        self.assertNotIn('DO-NOT-PERSIST',Path(self.tmp.name,doc['id']+'.json').read_text())
        original=doc['source']
        saved=self.store.save('alice',doc['id'],doc['revision'],{'medicines':[{'code':'test','quantity':'2'}]})
        self.assertEqual(saved['source'],original)
        with self.assertRaises(SessionError) as e:self.store.save('alice',doc['id'],doc['revision'],{'medicines':[]})
        self.assertEqual(e.exception.status,409)
        refreshed=self.ready(self.store.refresh('alice',doc['id'],saved['revision'],self.ctx))
        self.assertEqual(refreshed['edits'],{})
    def test_hosted_edit_roundtrip(self):
        doc=self.ready(self.store.create('alice',self.req,self.ctx))
        edits={'medicines':[{'code':'test','quantity':'2 tablets','instruction':'edited',
            'instructionEdited':True,'takeUntilFinished':True,'continueTicks':{'2026-09-14|am':True},
            'adminInstruction':'test administration','comments':'test comment'}], 'pharmNote':'synthetic note'}
        saved=self.store.save('alice',doc['id'],doc['revision'],edits)
        self.assertEqual(self.store.get('alice',doc['id'])['edits'],edits)
        with self.assertRaises(SessionError):
            self.store.save('alice',doc['id'],saved['revision'],{'medicines':[{'incusToken':'secret'}]})

    def test_calendar_retention(self):
        from datetime import datetime
        from hm_report_cache import THAILAND
        from unittest.mock import patch
        def stamp(day,hour=0):return datetime(2026,9,day,hour,tzinfo=THAILAND).timestamp()
        doc=self.ready(self.store.create('alice',self.req,self.ctx))
        doc['updatedAt']=stamp(13,23)
        self.write(self.store.path(doc['id']),doc)
        self.assertFalse(self.store.expired(doc,stamp(16,23)))
        self.assertTrue(self.store.expired(doc,stamp(17)))
        with patch('report_sessions.time.time',return_value=stamp(17)):
            with self.assertRaises(SessionError) as e:self.store.get('alice',doc['id'])
            self.assertEqual(e.exception.status,410)
        self.store.active.add(doc['id'])
        self.assertEqual(self.store.cleanup(stamp(17,23)),0)
        self.store.active.clear()
        other=Path(self.tmp.name,'unrelated.json');other.write_text('{}')
        self.assertEqual(self.store.cleanup(stamp(17,23)),1)
        self.assertTrue(other.exists())

    def test_persisted_session_reopen(self):
        ctx=dict(self.ctx,diagnosis='synthetic diagnosis',patientName='Test person')
        doc=self.ready(self.store.create('alice',self.req,ctx))
        reloaded=ReportSessions(self.tmp.name,self.store.builder,self.write)
        self.assertEqual(reloaded.get('alice',doc['id'])['displayContext']['diagnosis'],'synthetic diagnosis')
        self.assertNotIn('incusToken',reloaded.get('alice',doc['id'])['displayContext'])

    def test_owner_and_identity(self):
        doc=self.ready(self.store.create('alice',self.req,self.ctx))
        with self.assertRaises(SessionError) as e:self.store.get('bob',doc['id'])
        self.assertEqual(e.exception.status,404)
        with self.assertRaises(SessionError):self.store.create('alice',self.req,dict(self.ctx,patientvisituid='different'))
        with self.assertRaises(SessionError):self.store.get('alice','../file')
    def test_failure_redacted(self):
        def fail(r,c):raise RuntimeError(c['incusToken'])
        self.store.builder=fail
        doc=self.ready(self.store.create('alice',self.req,self.ctx))
        self.assertEqual(doc['status'],'error')
        self.assertNotIn('DO-NOT-PERSIST',json.dumps(doc))
    def test_restart(self):
        doc=self.ready(self.store.create('alice',self.req,self.ctx))
        doc['status']='building';self.store.persist(doc)
        self.assertEqual(self.store.get('alice',doc['id'])['status'],'interrupted')
    def test_concurrent_limit(self):
        event=threading.Event()
        self.store.builder=lambda r,c:(event.wait(2),{'ok':True})[1]
        docs=[]
        try:
            for _ in range(4):docs.append(self.store.create('alice',self.req,self.ctx))
            with self.assertRaises(SessionError) as e:self.store.create('alice',self.req,self.ctx)
            self.assertEqual(e.exception.status,503)
        finally:
            event.set()
            for d in docs:self.ready(d)

if __name__=='__main__': unittest.main()
