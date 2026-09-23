"use strict";
const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"), path=require("node:path"), vm=require("node:vm");
const {randomUUID}=require("node:crypto");
const root=path.resolve(__dirname,".."), prefix="src/features/automate/";
const read=f=>fs.readFileSync(path.join(root,f),"utf8"), manifest=JSON.parse(read("manifest.json"));
const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn)},removeListener(){}});
test("manifest resources and popup controls are complete, with no duplicate IDs or scripts",()=>{
 const scripts=manifest.content_scripts.flatMap(s=>s.js||[]);
 const registrations=manifest.content_scripts.flatMap(s=>(s.js||[]).flatMap(f=>s.matches.map(host=>[host,s.world||"ISOLATED",f].join("|"))));
 assert.equal(new Set(registrations).size,registrations.length);
 for(const s of manifest.content_scripts) for(const f of [...s.js||[],...s.css||[]]) assert(fs.existsSync(path.join(root,f)),f);
 const html=read("popup.html"),ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 assert.equal(new Set(ids).size,ids.length);
 const section=html.match(/<section[^>]+id="tab-automate"[\s\S]*?<\/section>/)[0];
 for(const m of read(prefix+"popup.js").matchAll(/getElementById\("([^"]+)"\)/g)) if(m[1]!=="headerVersion") assert(section.includes('id="'+m[1]+'"'),m[1]);
 for(const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) if(!/^(https?:|#)/.test(m[1])) assert(fs.existsSync(path.join(root,m[1])),m[1]);
 assert(manifest.permissions.includes("debugger"));assert(manifest.permissions.includes("downloads"));
 assert(!scripts.some(f=>f.endsWith("/content/hmr.js")||f.includes("test-overlay")));
 assert(!fs.existsSync(path.join(root,prefix,"manifest.json")));
});
function area(){const values={};return {async get(keys){if(keys==null)return {...values};if(typeof keys==="string")keys=[keys];return Object.fromEntries(keys.map(k=>[k,values[k]]))},async set(p){Object.assign(values,p)},async remove(k){delete values[k]}};}
test("combined worker boots and each message protocol has exactly one response owner",async()=>{
 const listeners=event(),downloads=[],alarms=[];
 const chrome={runtime:{onMessage:listeners,onStartup:event(),onInstalled:event(),lastError:null,getURL:f=>"chrome-extension://test/"+f},
 tabs:{onRemoved:event(),onUpdated:event()},debugger:{onEvent:event(),onDetach:event()},storage:{local:area(),session:area()},alarms:{onAlarm:event(),create:(...a)=>alarms.push(a)}};
 const context=vm.createContext({chrome,console,URL,TextEncoder,AbortController,setTimeout,clearTimeout,crypto:{randomUUID},fetch:async()=>({ok:true,status:200,text:async()=>'{"synthetic":true}',json:async()=>({synthetic:true})})});
 context.self=context;context.importScripts=(...files)=>files.forEach(f=>vm.runInContext(read(f),context,{filename:f}));
 chrome.downloads={download:(options,callback)=>{downloads.push(options);callback(downloads.length)}};
 vm.runInContext(read("background.js"),context,{filename:"background.js"});assert.equal(alarms.length,1);
 const request=async msg=>{const replies=[];let owners=0;
 for(const fn of listeners.listeners)if(fn(msg,{tab:{id:12,url:"https://arcusair.bdms.co.th/"},frameId:0},r=>replies.push(r))===true)owners++;
 await new Promise(r=>setTimeout(r,15));assert.equal(owners,1,msg.type);assert.equal(replies.length,1,msg.type);return replies[0];};
 for(const msg of [{type:"tabSettingsInit"},{type:"downloadJson",data:{}},{type:"downloadMedImage",imageUrl:"https://example.test/a",filename:"a.jpg"},
 {type:"paperlessReviewSave",snapshot:{sessionId:randomUUID(),events:[],eventCount:0}},
 {type:"serverGet",url:"http://localhost:8765/test"},{type:"BKN_SERVER_PROXY",url:"http://localhost:8765/test"}])assert((await request(msg)).ok,msg.type);
 for(const fn of listeners.listeners)assert.notEqual(fn({type:"unknown-protocol"},{},()=>assert.fail("unknown response")),true);
 assert.equal(downloads.length,2);
});
function popup(){
 const elements=new Map(),created=[],updated=[],dispatched=[];
 const active={id:8,url:"https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/dispense"};
 const page={location:{hash:"",href:"https://arcusair.bdms.co.th/#!/ordermanagement/translation"},CustomEvent:class{constructor(type){this.type=type}},document:{querySelector:()=>({})}};
 page.window=page;page.dispatchEvent=e=>dispatched.push(e.type);page.ArcusTabSettings={set(){}};
 page.ArcusPaperless={isActive:()=>false,canOpen:()=>true,open:()=>({ok:true}),stop:()=>dispatched.push("stopPaperless")};
 let closed=0;
 const chrome={runtime:{getManifest:()=>manifest,getURL:f=>"chrome-extension://test/"+f},storage:{local:{get:async()=>({})}},
 tabs:{query:async q=>q.active?[active]:[{id:1,url:"https://arcusair.bdms.co.th/"}],update:async(id,opts)=>{updated.push(id);return {id,...opts}},create:async opts=>{created.push(opts);return {id:22,...opts}}},
 scripting:{insertCSS:async()=>{},executeScript:async spec=>spec.files?[]:[{result:vm.runInNewContext("("+spec.func.toString()+")(...args)",{...page,args:spec.args||[]})}]}};
 vm.runInNewContext(read(prefix+"popup.js"),{chrome,console,setTimeout,window:{close(){closed++}},document:{getElementById(id){if(!elements.has(id))elements.set(id,{addEventListener(type,fn){this[type]=fn}});return elements.get(id)}}});
 return {elements,created,updated,dispatched,page,click:id=>elements.get(id).click(),closed:()=>closed};
}
test("all six popup open and close controls use the active Arcus tab",async()=>{
 const p=popup();
 for(const [open,close,show,hide] of [["openWorkbench","closeWorkbenchPanel","show-panel","remove-panel"],["openIpFill","closeIpFillPanel","show-ipfill-panel","remove-ipfill-panel"],["openDrugImage","closeDrugImagePanel","show-drug-image-panel","remove-drug-image-panel"],["openFrequencyMaster","closeFrequencyPanel","show-frequency-panel","remove-frequency-panel"],["openOrderItem","closeOrderItemPanel","show-order-item-panel","remove-order-item-panel"],["openTranslation","closeTranslationPanel","show-translation-panel","remove-translation-panel"]]){
 await p.click(open);await p.click(close);assert(p.dispatched.includes("arcus-toolkit:"+show),open);assert(p.dispatched.includes("arcus-toolkit:"+hide),close);}
 assert.deepEqual(p.updated,[8,8,8,8,8,8]);assert.equal(p.closed(),6);
});
test("paperless controls retain guard, stop, review and preparation links",async()=>{
 const p=popup();p.page.ArcusPaperless.canOpen=()=>false;await p.click("openPaperless");assert.equal(p.closed(),0);assert.match(p.elements.get("paperlessStatus").textContent,/Stop the running/);
 p.page.ArcusPaperless.canOpen=()=>true;await p.click("openPaperless");assert.equal(p.closed(),1);
 await p.click("stopPaperless");assert(p.dispatched.includes("stopPaperless"));
 await p.click("reviewPaperless");assert.match(p.created[0].url,/src\/features\/automate\/paperless-review.html\?tab=8$/);
 await p.click("prepareMedication");assert.match(p.created[1].url,/\/static\/medication-preparation\/index.html$/);
});
test("both MAIN hooks chain native XHR once and retain both auth bridges",()=>{
 const messages=[],calls=[];
 class Xhr{open(){calls.push("open")}send(){calls.push("send")}setRequestHeader(){calls.push("header")}addEventListener(){}}
 const sandbox={XMLHttpRequest:Xhr,console,URL,Headers,Request,location:{origin:"https://arcusair.bdms.co.th",href:"https://arcusair.bdms.co.th/"},document:{addEventListener(){},querySelector(){return null}},setTimeout(){},setInterval(){},clearTimeout(){},fetch:async()=>({clone(){return {text:async()=>""}}}),addEventListener(){},postMessage:m=>messages.push(m)};
 sandbox.window=sandbox;const context=vm.createContext(sandbox);
 for(const f of manifest.content_scripts.find(s=>s.world==="MAIN").js)vm.runInContext(read(f),context,{filename:f});
 vm.runInContext('const xhr=new XMLHttpRequest();xhr.open("POST","pharmacy/synthetic");xhr.setRequestHeader("incus-token","synthetic-token");xhr.send("{}");',context);
 assert.deepEqual(calls,["open","header","send"]);
 assert(messages.some(m=>m.__bkn_sec__===1&&m.v==="synthetic-token"));
 assert(messages.some(m=>m.source==="arcus-page-hook"&&m.type==="auth"&&m.headers["incus-token"]==="synthetic-token"));
});