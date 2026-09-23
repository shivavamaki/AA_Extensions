"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {randomUUID} = require('node:crypto');
function setup() {
  let listener; const state = {};
  const chrome = {runtime:{onMessage:{addListener(fn){listener=fn;}}}, storage:{local:{
    async get(key){return {[key]:structuredClone(state[key])};},
    async set(values){Object.assign(state,structuredClone(values));}
  }}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../paperless-review-store.js'),'utf8'),{chrome,TextEncoder});
  const save = (snapshot,tabId=1,url='https://arcusair.bdms.co.th/') => new Promise(resolve => listener({type:'paperlessReviewSave',snapshot},{tab:{id:tabId,url},frameId:0},resolve));
  return {save,state};
}
const snapshot = () => ({sessionId:randomUUID(),events:[{event:'Synthetic only'}],eventCount:1,active:true});
test('concurrent checker tabs retain independent sessions and stop updates replace only their session',async()=>{
 const {save,state}=setup(),a=snapshot(),b=snapshot();
 const results=await Promise.all([save(a,1),save(b,2)]);assert(results.every(r=>r.ok));
 await save({...a,active:false},1);
 const rows=state['paperless.review.sessions'];assert.equal(rows.length,2);
 assert.equal(rows.find(r=>r.sessionId===a.sessionId).active,false);
 assert.equal(rows.find(r=>r.sessionId===b.sessionId).tabId,2);
});
test('retention bounds sessions and events without changing full event count',async()=>{
 const {save,state}=setup();for(let i=0;i<22;i++)assert((await save(snapshot())).ok);
 const latest={...snapshot(),events:Array.from({length:1100},(_,i)=>({event:String(i)})),eventCount:1100};
 assert((await save(latest)).ok);
 const rows=state['paperless.review.sessions'];assert.equal(rows.length,20);assert.equal(rows[0].events.length,1000);assert.equal(rows[0].events[0].event,'100');assert.equal(rows[0].eventCount,1100);
});
test('reject non-Arcus senders and continue accepting subsequent valid requests',async()=>{
 const {save}=setup();assert.equal((await save(snapshot(),1,'https://example.com/')).ok,false);assert.equal((await save(snapshot())).ok,true);
});
