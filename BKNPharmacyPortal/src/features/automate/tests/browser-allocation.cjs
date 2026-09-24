"use strict";
// Offline smoke test: actual content modules, mocked Chrome services, no Arcus API.
// Usage: node BKNPharmacyPortal/src/features/automate/tests/browser-allocation.cjs [path-to-chrome]
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
const stub = `
window.chrome = { runtime: {
  id: "offline-test", lastError: null,
  sendMessage(message, callback) {
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
  const extra = file === "content/shared.js" ? '<script src="/tests/fixtures/allocation.js"></script>' : "";
  return '<script src="/' + file + '"></script>' + extra;
}).join("\n");
const html = '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><script>' +
  stub + '</script>' + scripts + '</body></html>';
const allowed = new Set([...manifest.content_scripts[0].js, "styles.css", "tests/fixtures/allocation.js"]);
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
  const result = await call("Runtime.evaluate", {awaitPromise:true,returnByValue:true,expression:"(async()=>{\nconst check=(value,message)=>{if(!value)throw Error(message)};\nconst sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));\nconst auto=ArcusAutoOverride, fixture=allocateFixture, shared=ArcusShared;\nconst run=()=>ArcusAutomation.runAutomation({functionName:\"Synthetic allocation\",mode:\"allocate\"});\nauto.setEnabled(true,\"Medically needed\");\nauto.stopWatching(); // Explicit flow must handle the dialog without observer timing.\nfixture.reset({delay:3500});\nawait run();\ncheck(shared.state.stats.success===1,\"delayed automatic return confirmed\");\ncheck(fixture.allocateClicks===1&&fixture.saves===1&&fixture.optionClicks===1,\"one Allocate and one override Save\");\ncheck(fixture.closes===0,\"override was not dismissed\");\nfixture.reset({infoRow:true,infoAllocation:true});\nawait run();\ncheck(shared.state.stats.success===1&&fixture.closes===2,\"row and allocation informational alerts close before continuing\");\ncheck(fixture.allocateClicks===1&&fixture.saves===1,\"exact actiondiv Allocate clicked once after alerts\");\nfixture.reset({autoOnce:true});\nshared.state.settings.automationMode=\"auto\";\nawait run();\ncheck(shared.state.stats.success===1&&fixture.allocateClicks===1&&fixture.saves===1,\"automatic refresh mode allocates once\");\ncheck(fixture.searches===2,\"automatic refresh continues until stopped\");\nfixture.reset({noDialog:true});\nshared.CONFIG.maxRouteWaitMs=600;\nawait run();\ncheck(fixture.allocateClicks===1&&shared.state.stats.success===0,\"unconfirmed allocation never resubmitted\");\nshared.CONFIG.maxRouteWaitMs=6000;\nauto.setEnabled(false);\nfixture.reset();\nshared.state.settings.waitManualOverride=true;\nconst manualRun=run();\nfor(let i=0;i<120&&!document.querySelector(\"md-dialog\");i++)await sleep(100);\ncheck(!!document.querySelector(\"md-dialog\")&&shared.state.isRunning&&fixture.saves===0,\"manual wait leaves override for user\");\nconst manualSave=document.querySelector(\"md-dialog button[aria-label=Save]\");\nmanualSave.disabled=false;manualSave.click();\nawait manualRun;\ncheck(shared.state.stats.success===1&&fixture.saves===1,\"manual wait resumes after user saves\");\nfixture.reset();\nshared.state.settings.waitManualOverride=false;\nawait run();\ncheck(!shared.state.isRunning&&fixture.saves===0&&!!document.querySelector(\"md-dialog\"),\"manual off stops with dialog untouched\");\ndocument.querySelector(\"md-dialog\").remove();\nauto.setEnabled(true,\"Medically needed\");auto.stopWatching();\nfixture.reset({missing:true});\nauto.resume(); const missing=fixture.openDialog(); const failed=await auto.handleIfPresent();\ncheck(!failed.ok&&auto.isAwaitingHuman()&&fixture.saves===0,\"missing reason waits for pharmacist\");\nmissing.remove();await auto.handleIfPresent();\nfixture.reset({rejectSelection:true});\nauto.resume();fixture.openDialog(); const rejected=await auto.handleIfPresent();\ncheck(!rejected.ok&&fixture.saves===0,\"old nonempty value does not verify new reason\");\ndocument.querySelector(\"md-dialog\").remove();await auto.handleIfPresent();\nfixture.reset({allergy:true});\nauto.resume();fixture.openDialog(); const allergy=await auto.handleIfPresent();\ncheck(allergy.blocked&&fixture.optionClicks===0&&fixture.saves===0,\"allergy remains manual\");\ndocument.querySelector(\"md-dialog\").remove();await auto.handleIfPresent();\nfixture.reset({stopDuringMenu:true});\nauto.resume();fixture.openDialog();await auto.handleIfPresent();\ncheck(fixture.saves===0&&fixture.optionClicks===0&&auto.state.suspended,\"Stop cancels pending override\");\nshared.state.stopRequested=false;\ndocument.querySelector(\"md-dialog\").remove();\ncheck(document.querySelector(\"#arcus-override-reason\").value===\"Medically needed\",\"reason visible with existing default\");\nauto.setEnabled(false);\ncheck(testErrors.length===0,testErrors.join(\"; \"));\nreturn {passed:[\"single allocation\",\"informational alert closing\",\"exact actiondiv Allocate readiness\",\"auto refresh allocation\",\"delayed return\",\"no blind retry\",\"manual wait on\",\"manual wait off\",\"missing reason\",\"exact selection verification\",\"allergy protection\",\"Stop cancellation\",\"visible default reason\"]};\n})()"});
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
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
