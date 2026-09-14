"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");
const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));
const event = () => ({ listeners: [], addListener(fn) { this.listeners.push(fn); } });
function area(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    async get(keys) {
      if (keys == null) return structuredClone(values);
      if (typeof keys === "string") keys = [keys];
      return Object.fromEntries(keys.filter((key) => key in values)
        .map((key) => [key, structuredClone(values[key])]));
    },
    async set(patch) { Object.assign(values, structuredClone(patch)); },
    async remove(key) { delete values[key]; },
  };
}
function background(storage = { local: area(), session: area() }) {
  const chrome = { storage, runtime: { onMessage: event() }, tabs: { onRemoved: event() } };
  vm.runInNewContext(source("tab-settings.js"), { chrome, crypto: { randomUUID } });
  return {
    storage, chrome,
    request(tabId, message, frameId = 0) {
      return new Promise((resolve) => {
        chrome.runtime.onMessage.listeners[0](message, { tab: { id: tabId }, frameId }, resolve);
      });
    },
  };
}
function client(bg, tabId, session = new Map()) {
  const window = {};
  const chrome = { runtime: {
    lastError: null,
    sendMessage(message, callback) { bg.request(tabId, message).then(callback); },
  } };
  vm.runInNewContext(source("content/tab-settings.js"), {
    window, chrome, console,
    sessionStorage: { getItem: (key) => session.get(key), setItem: (key, value) => session.set(key, value) },
  });
  return { settings: window.ArcusTabSettings, session };
}
test("concurrent tabs isolate settings, dismissals and override preferences", async () => {
  const bg = background();
  const a = client(bg, 1), b = client(bg, 2);
  await Promise.all([
    a.settings.set({ arcusMode: "allocate", arcusAutoOverrideEnabled: true, arcusDismissed: true }),
    b.settings.set({ arcusMode: "dispense", arcusAutoOverrideEnabled: false }),
  ]);
  assert.deepEqual(plain(await a.settings.get(null)), {
    arcusMode: "allocate", arcusAutoOverrideEnabled: true, arcusDismissed: true,
  });
  assert.deepEqual(plain(await b.settings.get(null)), {
    arcusMode: "dispense", arcusAutoOverrideEnabled: false,
  });
});
test("reload and service-worker restart retain same tab settings", async () => {
  let bg = background();
  const a = client(bg, 10);
  await a.settings.set({ arcusWards: ["WARD 4"], arcusPanel: { left: "25px" } });
  bg = background(bg.storage);
  const reloaded = client(bg, 10, a.session);
  assert.deepEqual(plain(await reloaded.settings.get("arcusWards")), { arcusWards: ["WARD 4"] });
});
test("duplicated tab token is forked, including active override preference", async () => {
  const bg = background(), a = client(bg, 1);
  await a.settings.set({ arcusAutoOverrideEnabled: true });
  const b = client(bg, 2, new Map(a.session));
  assert.deepEqual(plain(await b.settings.get(null)), {});
  assert.notEqual(b.session.get("arcusToolkitTabProfile"), a.session.get("arcusToolkitTabProfile"));
  await b.settings.set({ arcusAutoOverrideEnabled: false });
  assert.equal((await a.settings.get(null)).arcusAutoOverrideEnabled, true);
});
test("restored tab token recovers local profile after browser session restart", async () => {
  const bg = background(), a = client(bg, 3);
  await a.settings.set({ arcusMode: "semi" });
  const restarted = background({ local: bg.storage.local, session: area() });
  const restored = client(restarted, 99, new Map(a.session));
  assert.equal((await restored.settings.get(null)).arcusMode, "semi");
  const fresh = client(restarted, 3);
  assert.deepEqual(plain(await fresh.settings.get(null)), {});
});
test("another PC/profile never reads the first PC settings even with same token", async () => {
  const a = client(background(), 1);
  await a.settings.set({ arcusMode: "semi" });
  const b = client(background(), 1, new Map(a.session));
  assert.deepEqual(plain(await b.settings.get(null)), {});
});
test("simultaneous updates to one tab merge without lost keys", async () => {
  const bg = background(), a = client(bg, 4);
  await a.settings.ready;
  await Promise.all([
    bg.request(4, { type: "tabSettingsSet", values: { arcusWards: ["WARD 5"] } }),
    bg.request(4, { type: "tabSettingsSet", values: { arcusPanel: { minimized: false } } }),
  ]);
  const result = await a.settings.get(null);
  assert.deepEqual(plain(result), { arcusWards: ["WARD 5"], arcusPanel: { minimized: false } });
});
test("scoped callbacks honor defaults and writes queued before reads", async () => {
  const a = client(background(), 8);
  a.settings.set({ arcusValue: false });
  const result = await new Promise((resolve) => a.settings.get({ arcusValue: true, arcusMissing: 42 }, resolve));
  assert.deepEqual(plain(result), { arcusValue: false, arcusMissing: 42 });
});
test("sender identity cannot be replaced by a requested tab/profile", async () => {
  const bg = background();
  await bg.request(1, { type: "tabSettingsInit" });
  await bg.request(2, { type: "tabSettingsInit" });
  await bg.request(1, { type: "tabSettingsSet", tabId: 2, values: { arcusValue: "one" } });
  assert.deepEqual(plain((await bg.request(2, { type: "tabSettingsGet" })).values), {});
  assert.equal((await bg.request(1, { type: "tabSettingsGet" }, 2)).ok, false);
});
test("closed tab binding is removed, saved profile can be restored", async () => {
  const bg = background(), a = client(bg, 12);
  await a.settings.set({ arcusMode: "semi" });
  bg.chrome.tabs.onRemoved.listeners[0](12);
  const restored = client(bg, 13, new Map(a.session));
  assert.equal((await restored.settings.get(null)).arcusMode, "semi");
});
class Element {
  constructor(id = "") {
    this.id = id; this.parentNode = null; this.children = []; this.listeners = {};
    const classes = new Set();
    this.classList = { add: (...xs) => xs.forEach(x => classes.add(x)),
      remove: (...xs) => xs.forEach(x => classes.delete(x)), contains: x => classes.has(x) };
    const style = new Map();
    this.style = { getPropertyValue: key => style.get(key) || "",
      setProperty: (key, value) => style.set(key, value), removeProperty: key => style.delete(key) };
    this.rect = { left: 20, top: 20, right: 320, bottom: 420 };
  }
  appendChild(child) { child.remove(); this.children.push(child); child.parentNode = this; return child; }
  remove() {
    if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(x => x !== this);
    this.parentNode = null;
  }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  querySelectorAll() { return this.children.filter(x => /-(close|minimize)$/.test(x.id)); }
  getBoundingClientRect() { return this.rect; }
}
function host() {
  const window = { addEventListener() {} };
  const observers = [];
  const document = { documentElement: new Element("html") };
  vm.runInNewContext(source("content/panel-host.js"), {
    window, document, innerWidth: 1200, innerHeight: 800, setInterval() {},
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
  });
  return { host: window.ArcusPanelHost, document, mutate: () => observers.forEach(fn => fn()) };
}
test("running panel retains original controls, progress and Stop listener after DOM replacement", () => {
  const { host: h, document, mutate } = host();
  let running = false, stops = 0;
  const panel = new Element("arcus-auto-panel");
  const stop = panel.appendChild(new Element("arcus-btn-stop"));
  stop.addEventListener("click", () => stops++);
  panel.progress = 7;
  const body = document.documentElement.appendChild(new Element("body"));
  body.appendChild(panel);
  h.register(panel, () => running);
  running = true; h.refresh();
  assert.equal(panel.parentNode, document.documentElement);
  panel.remove(); mutate();
  assert.equal(panel.parentNode, document.documentElement);
  assert.equal(panel.progress, 7);
  stop.listeners.click[0]();
  assert.equal(stops, 1);
  assert.equal(h.restore(panel.id), true);
});
test("running panel expands, blocks Close/Minimize, and releases them after stopping", () => {
  const { host: h } = host();
  let running = true;
  const panel = new Element("arcus-ipfill-panel");
  const close = panel.appendChild(new Element("arcus-ipfill-close"));
  const minimize = panel.appendChild(new Element("arcus-ipfill-minimize"));
  panel.classList.add("is-minimized", "is-idle");
  h.register(panel, () => running);
  assert.equal(panel.classList.contains("is-minimized"), false);
  assert.equal(close.disabled, true);
  assert.equal(minimize.disabled, true);
  let prevented = false, blocked = false;
  panel.listeners.click[0]({ target: { closest: () => close },
    preventDefault() { prevented = true; }, stopImmediatePropagation() { blocked = true; } });
  assert.equal(prevented && blocked, true);
  running = false; h.refresh();
  assert.equal(close.disabled, false);
  assert.equal(minimize.disabled, false);
  panel.remove();
  assert.equal(h.restore(panel.id), false);
});
test("one tab's panel host never restores or modifies another tab", () => {
  const a = host(), b = host();
  const panel = new Element("arcus-auto-panel");
  a.host.register(panel, () => true);
  assert.equal(b.host.restore(panel.id), false);
  b.mutate();
  assert.equal(panel.parentNode, a.document.documentElement);
});
test("offscreen running panels are moved back into the viewport", () => {
  const { host: h } = host();
  const panel = new Element("arcus-di-panel");
  panel.rect = { left: -500, top: -500, right: -100, bottom: -100 };
  h.register(panel, () => true);
  assert.equal(panel.style.top, "8px");
  assert.equal(panel.style.right, "8px");
});
test("all active panels register lifecycle and use scoped settings; popup injection includes dependencies", () => {
  const manifest = JSON.parse(source("manifest.json"));
  assert.deepEqual(manifest.content_scripts[0].js.slice(0, 2),
    ["content/tab-settings.js", "content/panel-host.js"]);
  for (const file of manifest.content_scripts[0].js) {
    const code = source(file);
    assert.doesNotMatch(code, /chrome\.storage(?:\?\.)?\.(?:local|sync)/);
    new vm.Script(code, { filename: file });
  }
  for (const file of ["panel", "ipfill_panel", "drug-image", "frequency-master", "order-item", "translation"]) {
    const code = source("content/" + file + ".js");
    assert.match(code, /ArcusPanelHost\.register/);
    assert.match(code, /function removePanel\(\)\s*\{\s*if \(state\.(?:running|isRunning)\)/);
  }
  assert.match(source("popup.js"), /"content\/tab-settings.js",\s*"content\/panel-host.js"/);
});
test("parallel image downloads keep their own filenames even when callbacks finish out of order", async () => {
  const listeners = [], requests = [];
  const chrome = {
    runtime: { onMessage: { addListener: fn => listeners.push(fn) }, lastError: null },
    downloads: { download: (options, callback) => requests.push({ options, callback }) },
  };
  vm.runInNewContext(source("background.js"), { chrome, importScripts() {} });
  const request = (id) => new Promise(resolve => listeners[0]({
    type: "downloadMedImage", imageUrl: "https://example.test/" + id, filename: id + ".jpg",
  }, { tab: { id } }, resolve));
  const a = request(1), b = request(2);
  requests[1].callback(102); requests[0].callback(101);
  assert.equal((await a).downloadId, 101);
  assert.equal((await b).downloadId, 102);
  assert.equal(requests[0].options.filename, "1.jpg");
  assert.equal(requests[1].options.filename, "2.jpg");
  assert.doesNotMatch(source("background.js"), /nextDownloadName|onDeterminingFilename/);
});


test("startup barrier waits for settings callbacks and their follow-up writes", async () => {
  const a = client(background(), 40);
  let restored = false;
  a.settings.get(null, () => {
    restored = true;
    a.settings.set({ arcusMode: "restored" });
  });
  await a.settings.flush();
  assert.equal(restored, true);
  assert.equal((await a.settings.get(null)).arcusMode, "restored");
});

