"use strict";
// Offline smoke test: actual content modules, mocked Chrome services, no Arcus API.
// Usage: node Automate/tests/browser-panels.cjs [path-to-chrome]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const root = path.resolve(__dirname, "www/static/medication-preparation");

const chromePath = process.argv[2] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "arcus-panel-test-"));
const stub = "\nwindow.testErrors=[];window.addEventListener('error',e=>testErrors.push(e.message));\nwindow.records=[];window.postCount=0;window.failResponse=false;\nwindow.fetch=async(url,options={})=>{\n const parsed=new URL(url,location.href);let data;\n if(parsed.pathname==='/api/iv-staff')data=[{name:'Synthetic Staff',role:'pharmacist'},{name:'Synthetic Two',role:'staff'}];\n else if(options.method==='POST'){\n  postCount++;const body=JSON.parse(options.body);let record=records.find(r=>r.staffName===body.staffName&&r.orderNumber===body.orderNumber&&r.scanDate===body.scanDate);const duplicate=!!record;\n  if(!record){record={...body,id:'synthetic-'+records.length,preparedAt:new Date().toISOString()};records.push(record);}\n  if(failResponse){failResponse=false;throw Error('Synthetic response loss');}\n  data={ok:true,duplicate,record};\n } else {const rows=records.filter(r=>r.orderNumber.includes(parsed.searchParams.get('orderNumber')||''));data={rows:[...rows].reverse(),total:rows.length};}\n return {ok:true,status:200,json:async()=>data};\n};\n";
const html = fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<script defer', '<script>'+stub+'</script><script defer');
const allowed = new Set(['prepare.js','prepare.css']);
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
  const result = await call("Runtime.evaluate", {awaitPromise:true,returnByValue:true,expression:"(async()=>{\nconst check=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms)),el=id=>document.getElementById(id);\ncheck(el('order').disabled,'staff selection required');\nel('staff').value='Synthetic Staff';el('staff').dispatchEvent(new Event('change'));check(!el('order').disabled,'scanner enabled after selection');el('staff').focus();await sleep(50);check(document.activeElement===el('order'),'focus after native staff selector closes');el('connect').click();await sleep(80);check(document.activeElement===el('order'),'focus after connection reload with selected staff');el('search').focus();el('refresh').click();await sleep(80);check(document.activeElement===el('search'),'history refresh preserves search focus');\nconst submit=async code=>{el('order').value=code;el('scan-form').dispatchEvent(new Event('submit',{cancelable:true}));await sleep(80);};\nawait submit('X-INVALID');check(postCount===0,'invalid barcode blocked');\nawait submit('I-TEST');check(records.length===1&&records[0].staffName==='Synthetic Staff'&&el('feedback').textContent.startsWith('Saved'),'server-confirmed save');\ncheck(el('order').value===''&&document.activeElement===el('order'),'ready for next scan');\nawait submit('I-TEST');check(records.length===1&&el('feedback').textContent.startsWith('Already recorded'),'duplicate acknowledgement');\nel('staff').value='Synthetic Two';el('staff').dispatchEvent(new Event('change'));\nel('order').value='O-TAB';el('order').dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',cancelable:true}));await sleep(80);check(records.length===2&&records[1].staffName==='Synthetic Two','tab scanner suffix');\nwindow.failResponse=true;await submit('E-RETRY');check(el('feedback').classList.contains('error')&&el('order').readOnly&&el('staff').disabled&&sessionStorage.getItem('pharmacy.preparation.pending'),'uncertain response retains exact scan');\nconst before=records.length;el('scan-form').dispatchEvent(new Event('submit',{cancelable:true}));await sleep(80);check(records.length===before&&el('feedback').textContent.startsWith('Already recorded')&&!sessionStorage.getItem('pharmacy.preparation.pending'),'retry does not duplicate');\nel('order').value='I-IDLE';el('order').dispatchEvent(new Event('input'));await sleep(950);check(records.length===4,'idle scanner suffix');\ncheck(el('rows').children.length===4,'server history');\ncheck(testErrors.length===0,testErrors.join('; '));return {passed:['staff selection','barcode validation','server-confirmed save','scanner refocus','duplicate scans','Tab suffix','uncertain-response recovery','idle suffix','server history']};\n})()"});
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

