"use strict";
(() => {
  let context, token, session, receive, messageType;
  const resumeId = new URLSearchParams(location.search).get('report');
  let saves = Promise.resolve();
  let failedSave = false;
  const status = document.createElement('div');
  status.setAttribute('role','status');
  function say(text) { status.textContent = text; }
  async function api(path, opts={}) {
    const r=await fetch(path,{...opts,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...opts.headers},cache:'no-store'});
    const data=await r.json();
    if(!r.ok) throw new Error(data.error || 'Request failed');
    return data;
  }
  async function waitReady(doc) {
    session=doc;
    for(let n=0;n<180 && session.status==='building';n++) {
      await new Promise(r=>setTimeout(r,1000));
      session=await api('/api/report-sessions/'+session.id);
    }
    if(session.status!=='ready') throw new Error(session.error || 'Report is still building; reopen the pilot to retry');
    window.__HM_HOSTED_DEBUG__={status:session.status,revision:session.revision,reportType:session.request.reportType};
    return session.source;
  }
  window.addEventListener('message', event => {
    if(event.source!==window.opener || !event.origin.startsWith('chrome-extension://') || event.data?.type!=='HM_PILOT_CONTEXT' || context) return;
    context=event.data.context;
    say('Patient context received. Sign in to build the report.');
  });
  window.HMHosted={
    subscribe(type,key,callback) {
      receive=callback; messageType=type;
      const box=document.createElement('form');
      box.className='no-print';
      box.innerHTML='<strong>Server HM pilot</strong><input name="username" placeholder="Username" autocomplete="username" required><input name="password" type="password" placeholder="Password" autocomplete="current-password" required><button type="submit">Sign in and open report</button>';
      box.append(status);document.querySelector('.toolbar').prepend(box);
      say(resumeId ? 'Sign in to reopen your saved report.' : 'Open this pilot from the extension Home Medication Sheet.');
      box.addEventListener('submit', async event => {
        event.preventDefault();
        const button=box.querySelector('button');button.disabled=true;
        try {
          if(!resumeId && !context?.patientvisituid) throw new Error('Open this pilot from the extension Home Medication Sheet first.');
          say('Signing in…');
          const auth=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:box.elements.username.value,password:box.elements.password.value})});
          token=auth.token;box.elements.password.value='';
          if(resumeId) {
            if(!/^[a-f0-9]{32}$/.test(resumeId)) throw new Error('Invalid report link');
            say('Opening saved report…');
            await waitReady(await api('/api/report-sessions/'+resumeId));
            const expected=messageType==='LOAD_MED_TABLE_OPD'?'home-med-opd':'home-med-ipd';
            if(session.request.reportType!==expected) throw new Error('Report type does not match this page');
            const identity=session.request.identity;
            if(context && (context.patientuid!==identity.patientUid || context.patientvisituid!==identity.visitUid)) throw new Error('Patient context does not match saved report');
            context=context || {...session.source.patient,...session.displayContext,patientuid:identity.patientUid,patientvisituid:identity.visitUid,mode:expected==='home-med-opd'?'opd':'ipd'};
            if(!context.incusToken) {
              const revert=document.getElementById('btnRevert');
              if(revert) { revert.disabled=true; revert.title='Open a new pilot from ArcusAir to refresh live data'; }
            }
          } else {
            const boundary=HMReportBoundary.fromLegacy({type:messageType,context});
            say('Building report…');
            await waitReady(await api('/api/report-sessions',{method:'POST',body:JSON.stringify({request:boundary.request,context})}));
            const url=new URL(location.href);url.searchParams.set('report',session.id);history.replaceState(null,'',url);
          }
          receive({type:messageType,context});
          say('Report ready. Edits save to this server session.');
          button.hidden=true;box.elements.username.hidden=true;box.elements.password.hidden=true;
        } catch(e) { say(e.message); } finally {button.disabled=false;}
      });
      window.opener?.postMessage({type:'HM_PILOT_READY'},'*'); // readiness only; no patient data
    },
  };
  window.BKNData={
    getServerUrl:async()=>location.origin,
    loadCapture:async()=>({}),
    loadMedCache:async()=>session?.edits?.medicines ? {kind:'homeMedSheet',meds:session.edits.medicines,pharmNote:session.edits.pharmNote||''} : null,
    saveMedCache(puid,vid,data) {
      const snapshot=structuredClone(data);
      saves=saves.then(async()=>{
        if(failedSave) throw new Error('Save stopped after a conflict/error. Reopen the pilot before editing further.');
        say('Saving…');
        session=await api('/api/report-sessions/'+session.id+'/edits',{method:'PUT',body:JSON.stringify({expectedRevision:session.revision,edits:{medicines:snapshot.meds,pharmNote:snapshot.pharmNote||''}})});
        window.__HM_HOSTED_DEBUG__={status:session.status,revision:session.revision,reportType:session.request.reportType};
        say('Saved.');
      }).catch(e=>{failedSave=true;say('Not saved: '+e.message);});
      return saves;
    },
    async serverFetch(path,opts={}) {
      try {
        if(path==='/api/report/home-med-api'||path==='/api/report/home-med-opd') {
          const body=JSON.parse(opts.body||'{}');
          if(body.forceLive) {
            if(!context?.incusToken) throw new Error('Open a new pilot from ArcusAir for live refresh.');
            await saves;
            if(failedSave) throw new Error('Resolve the save error before refreshing.');
            say('Refreshing live report…');
            await waitReady(await api('/api/report-sessions/'+session.id+'/refresh',{method:'POST',body:JSON.stringify({expectedRevision:session.revision,context})}));
            say('Live report refreshed.');
          }
          return {ok:true,status:200,json:session.source};
        }
        return {ok:true,status:200,json:await api(path,opts)};
      }catch(e){return {ok:false,status:0,error:e.message};}
    },
  };
})();
