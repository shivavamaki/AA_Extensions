"use strict";
// Offline smoke test: actual content modules, mocked Chrome services, no Arcus API.
// Usage: node Automate/tests/browser-panels.cjs [path-to-chrome]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const root = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const chromePath = process.argv[2] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "arcus-panel-test-"));
const stub = `
window.chrome = { runtime: {
  id: "offline-test", lastError: null,
  sendMessage(message, callback) {
    if (message.type === "paperlessReviewSave") {
      window.testReviews ||= [];
      window.testReviews.push(structuredClone(message.snapshot));
      return queueMicrotask(() => callback({ok:true}));
    }
    if (message.type === "tabSettingsInit") return queueMicrotask(() => callback({ok:true,token:"11111111-1111-1111-1111-111111111111"}));
    if (message.type === "tabSettingsGet") return queueMicrotask(() => callback({ok:true,values:window.testSettings || {}}));
    if (message.type === "tabSettingsSet") {
      window.testSettings = {...window.testSettings,...message.values};
      return queueMicrotask(() => callback({ok:true}));
    }
    setTimeout(() => callback({ok:false,error:"Offline test: service disabled"}), 2000);
  }
}};
window.testErrors = [];
window.addEventListener("error", event => testErrors.push(event.message));
`;
const scripts = manifest.content_scripts[0].js.map(file => {
  const extra = file === "content/shared.js"
    ? '<script>ArcusShared.isWorkbenchPage = () => location.hash.startsWith("#!/pharmacy/dispenseworkbench/pharmacy/");</script>' : "";
  return '<script src="/' + file + '"></script>' + extra;
}).join("\n");
const html = fs.readFileSync(path.join(__dirname,"fixtures/paperless.html"),"utf8").replace('<script src="overlay.js"></script>', '<script>'+stub+'</script>'+scripts);
const allowed = new Set([...manifest.content_scripts[0].js, "styles.css"]);
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
  const result = await call("Runtime.evaluate", {awaitPromise:true, returnByValue:true, expression:"(async()=>{\nconst check=(v,m)=>{if(!v)throw Error(m)},sleep=ms=>new Promise(r=>setTimeout(r,ms));\ncheck(!document.querySelector('#arcus-paperless-panel'),'checker opt-in');\nArcusShared.state.isRunning=true;check(!ArcusPaperless.open().ok,'batch blocks checker');ArcusShared.state.isRunning=false;\ncheck(ArcusPaperless.open().ok,'open checker');const panel=document.querySelector('#arcus-paperless-panel'),root=panel.shadowRoot,input=root.querySelector('#scan-input');\nconst scan=code=>{input.value=code;root.querySelector('#scan-form').dispatchEvent(new Event('submit',{cancelable:true}));};\nwindow.alert=()=>{};\nawait ArcusAutomation.runAutomation({functionName:'test',mode:'allocate'});check(!ArcusShared.state.isRunning,'checker blocks batch');\ncheck((await ArcusAutoOverride.handleIfPresent()).reason==='paperless checker owns this tab','checker suspends override');\npanel.remove();await sleep(100);check(document.querySelector('#arcus-paperless-panel')===panel,'shared host retains checker');\nwindow.finalWrong=false;window.finalDisabled=false;\ndocument.querySelector('#ordernumber').value='I-OLD';\nroot.querySelector('[data-status=\"Ordered\"]').click();await sleep(350);\ncheck(window.modeActions[0]==='clear'&&window.modeActions[1]==='status'&&window.modeActions[2]==='search'&&document.querySelector('#ordernumber').value==='','first mode clears before status and Search');\nwindow.modeActions=[];document.querySelector('#ordernumber').value='O-OLD';\nroot.querySelector('[data-status=\"Second\"]').click();await sleep(350);\ncheck(window.modeActions[0]==='clear'&&window.modeActions[1]==='status'&&window.modeActions[2]==='search'&&document.querySelector('#ordernumber').value==='','second mode clears before status and Search');\nconst statuses=[...document.querySelectorAll('md-option[aria-selected=\"true\"]')].map(o=>o.textContent);\ncheck(statuses.length===5&&!statuses.includes('All'),'five statuses');\nscan('X123');check(document.querySelector('#ordernumber').value==='','bad prefix rejected');\nscan('I123');await sleep(1000);scan('WRONG');check(!document.querySelector('[data-bkn-medicine-check]'),'wrong medicine blocked');\nscan('MED-A');scan('MED-A');check(document.querySelectorAll('[data-bkn-medicine-check]').length===1,'duplicate ignored');\nscan('MED-B');await sleep(1200);check(window.dispenseClicks===1&&window.finalClicks===1,'both dispensing steps exactly once');\ndocument.querySelector('#final-page').remove();document.querySelector('.full-height').style.display='';\nlocation.hash='#!/pharmacy/dispenseworkbench/pharmacy/dispense';await sleep(1000);\ncheck(document.querySelector('#ordernumber').value===''&&!input.disabled&&root.activeElement===input,'standby and focus');\nscan('O456');await sleep(1000);check(root.querySelector('#scan-context').textContent.includes('O456 opened'),'next prescription');\nlet auditBlob;const originalCreate=URL.createObjectURL;URL.createObjectURL=blob=>{auditBlob=blob;return originalCreate(blob);};\nroot.querySelector('#export-audit').click();URL.createObjectURL=originalCreate;\nconst audit=JSON.parse(await auditBlob.text());check(audit.events.some(e=>e.code==='MED-A')&&audit.events.some(e=>e.event.includes('Final Dispense click sent')),'session export includes scans and final action');\ncheck(ArcusPaperless.snapshot().prescription==='O456','live review prescription');const snapshot=ArcusPaperless.snapshot();snapshot.events.length=0;check(ArcusPaperless.snapshot().events.length>0,'snapshot isolation');root.querySelector('#stop').click();check(testReviews.at(-1).active===false&&testReviews.at(-1).events.some(e=>e.event?.includes('Checker stopped')),'stopped session persisted');check(ArcusPaperless.snapshot()===null,'stopped live snapshot cleared');check(!ArcusPaperless.isActive()&&!document.querySelector('#arcus-paperless-panel'),'Stop releases ownership');\ncheck(ArcusPaperless.open().ok,'reopen');ArcusPaperless.stop();check(!ArcusPaperless.isActive(),'popup stop API');\ncheck(testErrors.length===0,testErrors.join('; '));\nreturn {passed:['opt-in startup','mutual batch guard','auto-override suspended','shared panel host retention','five-status search','prefix rejection','medicine matching','duplicate protection','two-page dispensing once','standby and focus','next prescription','Stop and reopen']};\n})()"});
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);

  await call("Runtime.evaluate",{expression:"ArcusPaperless.open()"});
  const before=await call("Runtime.evaluate",{returnByValue:true,expression:"(()=>{const p=document.querySelector('#arcus-paperless-panel'),r=p.getBoundingClientRect();return {x:r.x,y:r.y};})()"});
  const pos=before.result.value;
  await call("Input.dispatchMouseEvent",{type:"mouseMoved",x:pos.x+65,y:pos.y+20});
  await call("Input.dispatchMouseEvent",{type:"mousePressed",x:pos.x+65,y:pos.y+20,button:"left",clickCount:1});
  await call("Input.dispatchMouseEvent",{type:"mouseMoved",x:150,y:140,button:"left",buttons:1});
  await call("Input.dispatchMouseEvent",{type:"mouseReleased",x:150,y:140,button:"left",clickCount:1});
  await new Promise(r=>setTimeout(r,400));
  const dragCheck=await call("Runtime.evaluate",{awaitPromise:true,returnByValue:true,expression:"(async()=>{const p=document.querySelector('#arcus-paperless-panel'),r=p.getBoundingClientRect(),v=await ArcusTabSettings.get('paperless.position');return r.x<200&&r.y<200&&Number.isFinite(v['paperless.position']?.x);})()"});
  if(!dragCheck.result.value)throw Error("Checker drag and saved position failed");
  console.log("PASS: header drag and tab-local position persistence");

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

