'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../../pharmacy_server/www/static/hm-hosted.js'),'utf8');
const id='a'.repeat(32);
let record={id,status:'ready',revision:2,request:{reportType:'home-med-ipd',identity:{patientUid:'p',visitUid:'v'}},source:{ok:true,patient:{},meds:[]},edits:{}};
let conflict=false;
function boot(resume=false) {
 const handlers={},calls=[];let form,received;
 function element(tag){return {tag,textContent:'',elements:{username:{value:'tester'},password:{value:'password'}},button:{},setAttribute(){},append(){},querySelector(){return this.button},addEventListener(n,f){this[n]=f}};}
 const revert={};
 const sandbox={URL,URLSearchParams,structuredClone,setTimeout,console,location:{origin:'http://localhost',href:'http://localhost/hm.html'+(resume?'?report='+id:''),search:resume?'?report='+id:''},history:{replaceState(a,b,u){sandbox.location.href=String(u)}},document:{createElement(t){const e=element(t);if(t==='form')form=e;return e},querySelector(){return {prepend(){}}},getElementById(){return revert}},HMReportBoundary:{fromLegacy(m){return {request:{schemaVersion:1,reportType:'home-med-ipd',identity:{patientUid:m.context.patientuid,visitUid:m.context.patientvisituid}}}}}};
 sandbox.window=sandbox;sandbox.opener={postMessage(){}};sandbox.addEventListener=(n,f)=>handlers[n]=f;
 sandbox.fetch=async(url,opts)=>{
  calls.push({url,opts});const body=opts.body?JSON.parse(opts.body):{};
  if(url==='/api/auth/login')return {ok:true,json:async()=>({token:'login-secret'})};
  assert.equal(opts.headers.Authorization,'Bearer login-secret');
  if(url==='/api/report-sessions'&&opts.method==='POST') assert.equal(body.context.incusToken,'arcus-secret');
  if(url.endsWith('/edits')){
   if(conflict)return {ok:false,json:async()=>({error:'Revision conflict'})};
   assert.equal(body.expectedRevision,record.revision);record={...record,revision:record.revision+1,edits:body.edits};
  }
  if(url.endsWith('/refresh'))record={...record,revision:record.revision+2,edits:{}};
  return {ok:true,json:async()=>structuredClone(record)};
 };
 vm.createContext(sandbox);vm.runInContext(code,sandbox);
 sandbox.HMHosted.subscribe('LOAD_MED_TABLE','payload_sheet',m=>received=m);
 return {sandbox,calls,revert,form,handlers,get received(){return received}};
}
(async()=>{
 const b=boot();
 const message={type:'HM_PILOT_CONTEXT',context:{patientuid:'p',patientvisituid:'v',incusToken:'arcus-secret'}};
 b.handlers.message({source:{},origin:'chrome-extension://test',data:message});
 await b.form.submit({preventDefault(){}});assert.equal(b.calls.length,0,'untrusted sender must not set context');
 b.handlers.message({source:b.sandbox.opener,origin:'chrome-extension://test',data:message});
 await b.form.submit({preventDefault(){}});assert.equal(b.received.context.patientuid,'p');
 assert(b.sandbox.location.href.endsWith('?report='+id));assert(!b.sandbox.location.href.includes('secret'));
 await b.sandbox.BKNData.saveMedCache('p','v',{meds:[{code:'test',quantity:'2',instruction:'edited'}]});
 assert.equal(record.edits.medicines[0].quantity,'2');
 const r=boot(true);await r.form.submit({preventDefault(){}});
 assert.equal(r.revert.disabled,true);assert.equal(r.received.context.incusToken,undefined);
 const cached=await r.sandbox.BKNData.loadMedCache();assert.equal(cached.meds[0].instruction,'edited');
 assert(!r.calls.some(c=>c.url==='/api/report-sessions'));
 const refresh=await r.sandbox.BKNData.serverFetch('/api/report/home-med-api',{body:JSON.stringify({forceLive:true})});assert.equal(refresh.ok,false);
 await r.sandbox.BKNData.saveMedCache('p','v',{meds:[]});
 const empty=boot(true);await empty.form.submit({preventDefault(){}});
 assert.equal((await empty.sandbox.BKNData.loadMedCache()).meds.length,0);
 conflict=true;await r.sandbox.BKNData.saveMedCache('p','v',{meds:[]});
 const writes=r.calls.filter(c=>c.url.endsWith('/edits')).length;
 await r.sandbox.BKNData.saveMedCache('p','v',{meds:[]});assert.equal(r.calls.filter(c=>c.url.endsWith('/edits')).length,writes);
 console.log('PASS: hosted handoff validation, login/build, edit/save, saved-session reopen, token-free URL, refresh guard and conflict stop');
})().catch(e=>{console.error(e);process.exitCode=1});
