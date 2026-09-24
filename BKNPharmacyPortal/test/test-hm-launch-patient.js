'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../src/features/home-med/content-home-med.js'), 'utf8');
const launchCode = code.slice(code.indexOf('  let _sending = false;'), code.indexOf('  function syncButton()'));
const listeners = new Set(), timers = new Map(), children = [];
let timerId = 0, resolveContext;
const sandbox = {
  URL, console, MSG: {LOAD_MED_TABLE:'LOAD_MED_TABLE', OPEN_MED_JOURNEY:'OPEN_MED_JOURNEY'},
  ensureXhrTap(){}, sheetMode:()=> 'ipd', readDiagnosis:()=>'',
  extractContext:()=>new Promise(resolve=>{resolveContext=resolve;}),
  alert(){}, setTimeout(fn, delay){timers.set(++timerId,{fn,delay});return timerId;},
  clearTimeout(id){timers.delete(id);},
  BKNData:{getServerUrl:async()=> 'http://test.local'},
  addEventListener(type,fn){listeners.add(fn);},
  removeEventListener(type,fn){listeners.delete(fn);},
  open(){const child={location:{},messages:[],postMessage(m){this.messages.push(m);},close(){this.closed=true;}};children.push(child);return child;},
};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(launchCode,sandbox);
const flush=async()=>{await Promise.resolve();await Promise.resolve();};
const ready=child=>{for(const fn of [...listeners])fn({source:child,origin:'http://test.local',data:{type:'HM_PILOT_READY'}});};
const patient=id=>({patientuid:id,patientvisituid:'visit-'+id,loginuid:'staff'});
(async()=>{
  const first=sandbox.handleSheetClick();await flush();
  resolveContext(patient('A'));await first;
  const oldListener=[...listeners][0];
  const oldTimeout=[...timers.values()].find(t=>t.delay===120000).fn;
  const oldRetry=[...timers.values()].find(t=>t.delay===300).fn;
  assert.equal(children[0].messages[0].context.patientuid,'A');
  const second=sandbox.handleSheetClick();await flush();
  const currentListener=[...listeners][0];
  ready(children[1]);
  assert.equal(children[1].messages.length,0,'READY before extraction must not deliver patient A to patient B tab');
  oldRetry();oldListener({source:children[0],origin:'http://test.local',data:{type:'HM_PILOT_READY'}});
  assert.equal(children[1].messages.length,0,'stale callbacks cannot target the new tab');
  await sandbox.handleSheetClick();
  sandbox.handleJourneyClick();
  assert.equal(children.length,2,'double click during extraction must not open another tab');
  oldTimeout();assert(listeners.has(currentListener),'old timeout must not remove the new listener');
  resolveContext(patient('B'));await second;ready(children[1]);
  assert(children[1].messages.length>0);
  assert(children[1].messages.every(m=>m.context.patientuid==='B'));
  assert(children[0].messages.every(m=>m.context.patientuid==='A'));
  const third=sandbox.handleSheetClick();await flush();ready(children[2]);
  resolveContext({});await flush();
  assert.equal(children[2].messages.length,0,'missing current identity must never fall back to patient B');
  console.log('PASS: delayed patient switch, early READY, stale retry/listener/timeout, double click, journey click and missing identity');
})().catch(e=>{console.error(e);process.exitCode=1;});
