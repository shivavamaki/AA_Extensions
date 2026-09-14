"""Loopback-only synthetic fixture for Chrome hosted HM acceptance; no live APIs."""
import json,tempfile,threading
from pathlib import Path
from http.server import ThreadingHTTPServer
import bkn_ks_server as app
import report_sessions
def main():
    fixture=tempfile.TemporaryDirectory()
    app._sessions['synthetic-login']={'username':'test','role':'editor'}
    report={'ok':True,'patient':{'name':'SYNTHETIC TEST','hn':'TEST-ONLY'},'meds':[{'code':str(i),'drug':'Synthetic medicine '+str(i),'instruction':'Take 1 Tablet Once Daily After Breakfast','quantity':'10 Tablet','note':'Synthetic test instruction','frequencyTh':'วันละ 1 ครั้ง หลังอาหารเช้า'} for i in range(1,21)],'allergies':{'nkda':True,'items':[]},'reconcileMeds':[]}
    app._REPORT_SESSIONS=report_sessions.ReportSessions(Path(fixture.name),lambda r,c:report,app._atomic_write_json)
    ctx={'patientuid':'test-p','patientvisituid':'test-v','incusToken':'synthetic','hn':'TEST-ONLY','patientName':'SYNTHETIC TEST'}
    req={'schemaVersion':1,'reportType':'home-med-ipd','identity':{'patientUid':'test-p','visitUid':'test-v'}}
    doc=app._REPORT_SESSIONS.create('test',req,ctx)
    class Fixture(app.Handler):
     def do_POST(self):
      if self.path=='/api/auth/login':
       self._read_json_body();self.send_json(200,{'token':'synthetic-login'});return
      self.send_json(404,{'error':'No live upstream in fixture'})
     def do_GET(self):
      if self.path.startswith('/api/') and not self.path.startswith('/api/report-sessions'):
       self.send_json(200,{});return
      if self.path.startswith('/med-image/'):
       self.send_json(404,{});return
      super().do_GET()
    server=ThreadingHTTPServer(('127.0.0.1',0),Fixture)
    print(json.dumps({'port':server.server_port,'id':doc['id']}),flush=True)
    try:server.serve_forever()
    finally:server.server_close();fixture.cleanup()

if __name__ == "__main__":
    main()
