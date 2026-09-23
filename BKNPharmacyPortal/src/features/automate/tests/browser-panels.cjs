"use strict";
// Offline smoke test: actual content modules, mocked Chrome services, no Arcus API.
// Usage: node BKNPharmacyPortal/src/features/automate/tests/browser-panels.cjs [path-to-chrome]
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
  const extra = file === "content/shared.js"
    ? '<script>ArcusShared.isWorkbenchPage = () => location.hash.startsWith("#!/pharmacy/dispenseworkbench/pharmacy/");</script>' : "";
  return '<script src="/' + file + '"></script>' + extra;
}).join("\n");
const html = '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"></head><body><script>' +
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
  const result = await call("Runtime.evaluate", {
    awaitPromise:true, returnByValue:true,
    expression: `(async () => {
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const check = (ok, text) => { if (!ok) throw Error(text); };
      const cases = [
        ["#!/pharmacy/dispenseworkbench/pharmacy/dispense","arcus-auto-panel","arcus-btn-stop",null],
        ["#!/pharmacy/dispenseworkbench/pharmacy/ipfill","arcus-ipfill-panel","arcus-ipfill-stop",null],
        ["#!/inventories/itemmaster","arcus-di-panel","arcus-di-stop","arcus-di-run"],
        ["#!/ordermanagement/frequencymaster","arcus-fm-panel","arcus-fm-stop","arcus-fm-run"],
        ["#!/ordermanagement/orderitem","arcus-oi-panel","arcus-oi-stop","arcus-oi-run"],
        ["#!/ordermanagement/translation","arcus-tr-panel","arcus-tr-stop","arcus-tr-run"],
      ];
      const passed = [];
      for (const [route,id,stopId,runId] of cases) {
        location.hash = route;
        await sleep(900);
        const panel = document.getElementById(id);
        check(panel, id + " did not appear");
        if (id === "arcus-auto-panel") {
          ArcusStore.core.state.isRunning = true;
          ArcusPanel.updateButtonState();
          ArcusPanel.setStatus("Smoke test progress 7/10");
        } else if (id === "arcus-ipfill-panel") {
          ArcusStore.ipfill.state.running = true;
          document.getElementById(stopId).disabled = false;
        } else {
          const run = document.getElementById(runId);
          check(run, "Missing start " + runId);
          run.click();
        }
        await sleep(100);
        check(!document.getElementById(stopId).disabled, id + " did not enter running state");
        const originalStop = document.getElementById(stopId);
        panel.remove();
        document.body.replaceChildren(document.createElement("main"));
        location.hash = "#!/test-essential-step";
        await sleep(100);
        check(document.getElementById(id) === panel, id + " node was lost or replaced");
        check(document.getElementById(stopId) === originalStop, id + " Stop control was replaced");
        check(getComputedStyle(panel).display !== "none" && panel.getBoundingClientRect().height > 0, id + " is hidden");
        check(!panel.classList.contains("is-minimized"), id + " is minimized");
        const close = panel.querySelector('button[id$="-close"]');
        check(close.disabled, id + " close was not locked");
        originalStop.click();
        if (id === "arcus-auto-panel") {
          check(ArcusStore.core.state.stopRequested, "Workbench Stop listener lost");
          ArcusStore.core.state.isRunning = false;
          ArcusPanel.updateButtonState();
        } else if (id === "arcus-ipfill-panel") {
          check(ArcusStore.ipfill.state.stopRequested, "IP Fill Stop listener lost");
          ArcusStore.ipfill.state.running = false;
        } else {
          check(/stopping/i.test(panel.textContent), id + " Stop listener lost");
        }
        passed.push(id);
        await sleep(2200);
      }
      check(testErrors.length === 0, testErrors.join("; "));
      return {passed};
    })()`
  });
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
