"use strict";
// Offline smoke test: actual content modules, mocked Chrome services, no Arcus API.
// Usage: node BKNPharmacyPortal/src/features/automate/tests/browser-paperless-review.cjs [path-to-chrome]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const root = path.resolve(__dirname, "..");
const manifest = require("./manifest.cjs");
const chromePath = process.argv[2] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "arcus-panel-test-"));
const stub = "\nwindow.testErrors=[];window.addEventListener('error',e=>testErrors.push(e.message));\nwindow.fixture={sessionId:'11111111-1111-1111-1111-111111111111',startedAt:'2026-09-22T02:00:00Z',updatedAt:'2026-09-22T02:30:00Z',active:true,mode:'Second',prescription:'I-SYNTHETIC',status:'Allocated',checked:1,total:2,medicines:[{code:'<MED-A>',checked:true},{code:'MED-B',checked:false}],message:'Synthetic data only',events:Array.from({length:205},(_,i)=>({at:'2026-09-22T02:20:00Z',prescription:'I-SYNTHETIC',kind:i%2?'medicine':undefined,code:i%2?'MED-A':undefined,event:i%2?undefined:'Synthetic action '+i})),eventCount:205,tabId:7};\nwindow.liveFixture=fixture;\nwindow.chrome={storage:{local:{get:async()=>({'paperless.review.sessions':[fixture]})}},tabs:{query:async()=>[{id:7,title:'Synthetic ArcusAir'}],update:async()=>({windowId:1})},windows:{update:async()=>{}},scripting:{executeScript:async()=>[{result:{available:true,snapshot:structuredClone(liveFixture)}}]}};\n";
const html = fs.readFileSync(path.join(root,'paperless-review.html'),'utf8').replace('<script defer', '<script>'+stub+'</script><script defer');
const allowed = new Set(['paperless-review.js','paperless-review.css']);
const server = http.createServer((req, res) => {
  const file = req.url.slice(1);
  if (!file) { res.setHeader("Content-Type", "text/html"); return res.end(html); }
  if (!allowed.has(file)) { res.statusCode = 404; return res.end(); }
  res.setHeader("Content-Type", file.endsWith(".css") ? "text/css" : "text/javascript");
  res.end(fs.readFileSync(path.join(root, file)));
});
let browser, socket;
(async () => {
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  browser = spawn(chromePath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-extensions", "--no-proxy-server",
    "--remote-debugging-port=0", "--user-data-dir=" + profile, "about:blank",
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolve, reject) => {
    let log = "";
    const timeout = setTimeout(() => reject(Error("Chrome startup timeout")), 20000);
    browser.on("error", reject);
    browser.stderr.on("data", chunk => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const origin = new URL(endpoint).origin.replace("ws:", "http:");
  const tab = await (await fetch(origin + "/json/new?about:blank", {method:"PUT"})).json();
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await once(socket, "open");
  let seq = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(Error(message.error.message));
    else waiter.resolve(message.result);
  });
  function call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq; pending.set(id, {resolve,reject});
      socket.send(JSON.stringify({id,method,params}));
    });
  }
  await call("Page.enable");
  await call("Page.navigate", {url:"http://127.0.0.1:" + server.address().port + "/#!/pharmacy/dispenseworkbench/pharmacy/dispense"});
  await new Promise(resolve => setTimeout(resolve, 1000));
  const result = await call("Runtime.evaluate", {awaitPromise:true,returnByValue:true,expression:"(async()=>{\nconst check=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms)),el=id=>document.getElementById(id);\nel('auto').checked=false;\ncheck(el('prescription').textContent==='I-SYNTHETIC','live prescription');\ncheck(el('progress').textContent==='1 / 2','medicine progress');\ncheck(el('medicines').textContent.includes('<MED-A>')&&!document.querySelector('med-a'),'safe medicine text');\ncheck(el('logs').children.length===100&&el('page').textContent==='1 / 3','pagination');\nel('next').click();check(el('page').textContent==='2 / 3','next page');\nel('search').value='MED-A';el('search').dispatchEvent(new Event('input'));await sleep(180);\ncheck(el('count').textContent==='102 matching events','search scans');\nlet exported;URL.createObjectURL=blob=>{exported=blob;return 'blob:offline-fixture'};HTMLAnchorElement.prototype.click=function(){};\nel('export').click();const data=JSON.parse(await exported.text());check(data.events.length===102&&data.events.every(e=>e.code==='MED-A'),'filtered export');\nel('search').value='';el('kind').value='action';el('kind').dispatchEvent(new Event('change'));check(el('count').textContent==='103 matching events','event type');\nwindow.liveFixture=null;el('refresh').click();await sleep(120);check(el('state').textContent==='Inactive'&&el('logs').children.length===100,'history after stop');\ncheck(testErrors.length===0,testErrors.join('; '));return {passed:['live prescription','medicine progress','escaped text','pagination','search','filtered export','event types','history after stop']};\n})()"});
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  console.log(JSON.stringify(result.result.value, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  socket?.close();
  browser?.kill();
  server.close();
  if (browser && browser.exitCode === null) await Promise.race([once(browser,"exit"), new Promise(r=>setTimeout(r,3000))]);
  // Only remove the exact unique directory this test created under the OS temp root.
  const resolved = path.resolve(profile);
  if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith("arcus-panel-test-")) {
    try { fs.rmSync(resolved, {recursive:true,force:true,maxRetries:3,retryDelay:250}); } catch (_) {}
  }
});
