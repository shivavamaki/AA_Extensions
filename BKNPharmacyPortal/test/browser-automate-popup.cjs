"use strict";
// Offline smoke test: actual content modules, mocked Chrome services, no Arcus API.
// Usage: node BKNPharmacyPortal/test/browser-automate-popup.cjs [path-to-chrome]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const root = path.resolve(__dirname, "..");

const chromePath = process.argv[2] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "arcus-panel-test-"));
const stub = `
window.testErrors=[];window.testStorage={};window.testCalls=[];
addEventListener("error",e=>testErrors.push(e.message));
addEventListener("unhandledrejection",e=>testErrors.push(String(e.reason)));
const finish=(value,cb)=>{if(cb)queueMicrotask(()=>cb(value));return Promise.resolve(value)};
const area={get:(keys,cb)=>finish({...testStorage},cb),set:(values,cb)=>{Object.assign(testStorage,values);return finish(undefined,cb)},remove:(key,cb)=>finish(undefined,cb)};
window.chrome={runtime:{id:"offline",lastError:null,getManifest:()=>({version:"3.62.0"}),getURL:f=>location.origin+"/"+f,onMessage:{addListener(){}},sendMessage:(m,cb)=>finish({ok:false,error:"Offline fixture"},cb)},storage:{local:area,session:area},tabs:{query:(q,cb)=>finish([{id:7,url:"https://arcusair.bdms.co.th/"}],cb),create:o=>{testCalls.push(o);return Promise.resolve({id:7})}},windows:{create:o=>Promise.resolve(o)}};
window.fetch=async()=>({ok:true,status:200,json:async()=>({}),text:async()=>""});
`;
const html = fs.readFileSync(path.join(root,"popup.html"),"utf8").replace("<head>","<head><script>"+stub+"</script>").replace(/<link[^>]+https:[^>]*>/g,"");
const allowed=new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m=>m[1]).filter(f=>!/^https?:/.test(f)));
const server=http.createServer((req,res)=>{
 const file=req.url.slice(1);
 res.setHeader("Content-Security-Policy","default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:");
 if(!file){res.setHeader("Content-Type","text/html");return res.end(html)}
 if(!allowed.has(file)){res.statusCode=404;return res.end()}
 res.setHeader("Content-Type",file.endsWith(".css")?"text/css":file.endsWith(".svg")?"image/svg+xml":"text/javascript");
 res.end(fs.readFileSync(path.join(root,file)));
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
  const result = await call("Runtime.evaluate", {awaitPromise:true,returnByValue:true,expression:"(async()=>{\nconst check=(v,m)=>{if(!v)throw Error(m)};\nconst tabs=[...document.querySelectorAll(\".tab-btn\")];\ncheck(tabs.length===5,\"five portal tabs\");\nfor(const tab of tabs){tab.click();check(document.querySelectorAll(\".tab-panel.active\").length===1,\"one active panel\");check(document.getElementById(tab.dataset.tab).classList.contains(\"active\"),tab.dataset.tab);}\nconst panel=document.getElementById(\"tab-automate\");\ncheck(panel.querySelectorAll(\".section\").length===7,\"seven feature cards\");\ncheck(panel.querySelectorAll(\"button\").length===16,\"all sixteen controls\");\ncheck(testStorage.activeTab===\"tab-automate\",\"tab persists\");\nfor(const el of panel.querySelectorAll(\"button\")){const box=el.getBoundingClientRect();check(box.width>0&&box.height>0,el.id+\" visible\");}\ndocument.getElementById(\"reviewPaperless\").click();await new Promise(r=>setTimeout(r,20));\ncheck(testCalls[0].url.includes(\"/src/features/automate/paperless-review.html?tab=7\"),\"review route\");\ncheck(testErrors.length===0,testErrors.join(\"; \"));\nreturn {passed:[\"five tabs\",\"seven Automate cards\",\"sixteen controls\",\"tab persistence\",\"review link\",\"no JS errors\"]};\n})()"});
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  console.log(JSON.stringify(result.result.value, null, 2));
  if (process.env.AUTOMATE_SCREENSHOT) {
    const screenshot = await call("Page.captureScreenshot", {format:"png", captureBeyondViewport:true});
    fs.writeFileSync(path.resolve(process.env.AUTOMATE_SCREENSHOT), Buffer.from(screenshot.data, "base64"));
  }
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
