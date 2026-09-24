"use strict";
// Offline smoke test: actual content modules, mocked Chrome services, no Arcus API.
// Usage: node BKNPharmacyPortal/src/features/automate/tests/browser-panel-toggles.cjs [path-to-chrome]
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
    if (message.type === "cdpAttach") return setTimeout(() => callback(window.testAttachFailure ? {ok:false,error:"Synthetic attach refusal"} : {ok:true}), 80);
    if (message.type === "cdpDetach") return setTimeout(() => callback(window.testDetachFailure ? {ok:false,error:"Synthetic detach refusal"} : {ok:true}), 30);
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
const html = '<!doctype html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/styles.css"></head><body><script>' +
  stub + '</script>' + scripts + '</body></html>';
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
  const result = await call("Runtime.evaluate", {awaitPromise:true,returnByValue:true,expression:"(async()=>{\nconst check=(ok,msg)=>{if(!ok)throw Error(msg)},sleep=ms=>new Promise(r=>setTimeout(r,ms));\nconst panel=document.getElementById(\"arcus-auto-panel\"),get=id=>document.getElementById(id);\nconst change=(id,value)=>{const el=get(id);el.checked=value;el.dispatchEvent(new Event(\"change\",{bubbles:true}));};\nwindow.confirm=()=>false;\nchange(\"arcus-auto-override\",true);\ncheck(!ArcusAutoOverride.isEnabled()&&!get(\"arcus-auto-override\").checked,\"declined auto enable stays off\");\nwindow.confirm=()=>true;\nchange(\"arcus-manual-override\",false);await ArcusTabSettings.flush();\ncheck(!ArcusShared.state.settings.waitManualOverride&&get(\"arcus-manual-state\").textContent===\"off\",\"manual off response\");\ncheck(testSettings.arcusAutoPanelState.waitManualOverride===false,\"manual off persisted\");\nchange(\"arcus-manual-override\",true);await ArcusTabSettings.flush();\ncheck(testSettings.arcusAutoPanelState.waitManualOverride===true&&get(\"arcus-manual-state\").textContent===\"on\",\"manual on persisted\");\nchange(\"arcus-auto-override\",true);await ArcusTabSettings.flush();\ncheck(ArcusAutoOverride.isEnabled()&&testSettings.arcusAutoOverrideEnabled===true,\"auto on response and persistence\");\ncheck(get(\"arcus-auto-override-state\").textContent===\"on\"&&!get(\"arcus-override-reason-row\").hidden,\"auto on badge and reason\");\nArcusAutoOverride.cancelPending();\ncheck(get(\"arcus-auto-override-state\").textContent===\"paused\",\"Stop shows paused override\");\nArcusAutoOverride.resume();\ncheck(get(\"arcus-auto-override-state\").textContent===\"on\",\"resume shows on\");\nchange(\"arcus-auto-override\",false);await ArcusTabSettings.flush();\ncheck(!ArcusAutoOverride.isEnabled()&&testSettings.arcusAutoOverrideEnabled===false&&get(\"arcus-override-reason-row\").hidden,\"auto off response\");\nwindow.confirm=()=>false;\nchange(\"arcus-turbo\",true);\ncheck(!get(\"arcus-turbo\").checked&&!ArcusDriver.isTurbo(),\"declined Turbo stays off\");\nwindow.confirm=()=>true;\nchange(\"arcus-turbo\",true);\ncheck(get(\"arcus-turbo\").disabled&&get(\"arcus-turbo-state\").textContent===\"connecting...\",\"Turbo locks while attaching\");\nawait sleep(150);\ncheck(ArcusDriver.isTurbo()&&get(\"arcus-turbo\").checked&&!get(\"arcus-turbo\").disabled&&get(\"arcus-turbo-state\").textContent===\"on\",\"Turbo on reflects actual driver\");\nwindow.testDetachFailure=true;\nchange(\"arcus-turbo\",false);await sleep(100);\ncheck(ArcusDriver.isTurbo()&&get(\"arcus-turbo\").checked&&!get(\"arcus-turbo\").disabled&&get(\"arcus-turbo-state\").textContent===\"unavailable\",\"detach failure does not pretend Turbo is off\");\nwindow.testDetachFailure=false;\nchange(\"arcus-turbo\",false);await sleep(100);\ncheck(!ArcusDriver.isTurbo()&&!get(\"arcus-turbo\").checked&&get(\"arcus-turbo-state\").textContent===\"off\",\"Turbo off detaches\");\nwindow.testAttachFailure=true;\nchange(\"arcus-turbo\",true);await sleep(150);\ncheck(!ArcusDriver.isTurbo()&&!get(\"arcus-turbo\").checked&&!get(\"arcus-turbo\").disabled&&get(\"arcus-turbo-state\").textContent===\"unavailable\",\"Turbo refusal restores toggle and badge\");\nwindow.testAttachFailure=false;change(\"arcus-turbo\",false);await sleep(100);\nchange(\"arcus-auto-override\",true);ArcusAutoOverride.stopWatching();\nArcusShared.state.isRunning=true;ArcusPanel.updateButtonState();\ncheck(get(\"arcus-manual-override\").disabled&&get(\"arcus-override-reason\").disabled,\"run locks manual preference and reason\");\nArcusShared.state.isRunning=false;ArcusPanel.updateButtonState();\ncheck(!get(\"arcus-manual-override\").disabled&&!get(\"arcus-override-reason\").disabled,\"idle unlocks settings\");\nArcusPanel.setStatus(\"Ready\");ArcusPanel.setStep(\"Ready\");\ncheck(!get(\"arcus-btn-copy-log\")&&!get(\"arcus-auto-log\"),\"no visible log controls\");\ncheck(!panel.querySelector(\"details\").open,\"recording tools collapsed\");\ncheck(get(\"arcus-auto-status\").hidden,\"duplicate Ready hidden\");\n\nconst reason=get(\"arcus-override-reason\");\ncheck(reason.tagName===\"SELECT\" && Array.from(reason.options).map(o=>o.value).join(\"|\")===\"Doctor is Aware|For extra stock|Medically needed\",\"three selectable reasons\");\nfor (const value of [\"For extra stock\",\"Doctor is Aware\",\"Medically needed\"]) {\n  reason.value=value;reason.dispatchEvent(new Event(\"change\",{bubbles:true}));\n  await ArcusTabSettings.flush();\n  check(ArcusAutoOverride.state.reason===value,\"reason selected: \"+value);\n}\nconst menu=document.createElement(\"tri-menu\");\nmenu.innerHTML='<md-content style=\"display:block;width:234px\"><tri-menu-item>Reporting</tri-menu-item></md-content>';\ndocument.body.appendChild(menu);await sleep(100);\ncheck(menu.firstElementChild.lastElementChild===panel,\"panel docks last in menu\");\ncheck(panel.getBoundingClientRect().width<=234,\"panel fits sidebar\");\nArcusShared.state.isRunning=true;ArcusPanel.updateButtonState();ArcusPanelHost.refresh();\ncheck(menu.firstElementChild.lastElementChild===panel,\"running panel stays docked\");\nconst replacement=menu.cloneNode(false);\nreplacement.innerHTML='<md-content style=\"display:block;width:234px\"><tri-menu-item>Reporting</tri-menu-item></md-content>';\nmenu.replaceWith(replacement);await sleep(100);\ncheck(replacement.firstElementChild.lastElementChild===panel,\"same running panel survives sidebar replacement\");\ncheck(!get(\"arcus-btn-stop\").disabled,\"Stop remains enabled\");\nArcusShared.state.isRunning=false;ArcusPanel.updateButtonState();ArcusPanelHost.refresh();\nreplacement.remove();await sleep(100);\ncheck(panel.isConnected&&!panel.classList.contains(\"arcus-menu-panel\"),\"floating fallback when sidebar absent\");\nconst rect=panel.getBoundingClientRect();check(rect.height<400,\"compact height: \"+rect.height);\ncheck(testErrors.length===0,testErrors.join(\"; \"));\nreturn {passed:[\"manual on/off persistence\",\"auto on/off persistence\",\"cancelled confirmations\",\"paused/resumed override\",\"Turbo attach/detach\",\"Turbo connection failure\",\"Turbo detach failure\",\"pending-toggle lock\",\"running settings lock\",\"compact layout without logs\",\"three override choices\",\"sidebar docking and replacement\",\"missing sidebar fallback\"],height:Math.round(rect.height)};\n})()"});
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  console.log(JSON.stringify(result.result.value, null, 2));
  if (process.env.AUTOMATE_SCREENSHOT) {
    const bounds = await call("Runtime.evaluate", {returnByValue:true,expression:"(()=>{const r=document.getElementById('arcus-auto-panel').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()"});
    const shot = await call("Page.captureScreenshot", {format:"png",clip:bounds.result.value});
    fs.writeFileSync(process.env.AUTOMATE_SCREENSHOT,Buffer.from(shot.data,"base64"));
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
