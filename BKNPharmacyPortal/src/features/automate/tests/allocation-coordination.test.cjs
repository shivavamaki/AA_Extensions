"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../../hmr/content-hmr.js"), "utf8");
const start = source.indexOf("  function _hmrFireClose(");
const end = source.indexOf("  // Short polling fallback", start);
assert(start >= 0 && end > start, "passive closer source exists");
function setup() {
  let now = 1000, clicks = 0, escapes = 0;
  const dialog = {};
  const button = { dispatchEvent(event) { if (event.type === "click") clicks++; }, click() { clicks++; } };
  const context = vm.createContext({
    _hmrAutoRunning: false,
    _hmrFindDialog: () => dialog,
    _hmrIsAlertModal: () => true,
    _hmrQueryFirst: () => button,
    Date: { now: () => now },
    MouseEvent: class { constructor(type) { this.type = type; } },
    KeyboardEvent: class { constructor(type) { this.type = type; } },
    document: { dispatchEvent(event) { if (event.type === "keydown") escapes++; } },
  });
  context.window = context;
  vm.runInContext(source.slice(start, end), context);
  return { context, tick: () => vm.runInContext("_hmrAutoDismissAlertsOnce()", context),
    advance(ms) { now += ms; }, clicks: () => clicks, escapes: () => escapes };
}
test("HMR closer sends one click, throttles mutation bursts and bounds retries per dialog", () => {
  const t = setup();
  for (let i = 0; i < 65; i++) t.tick();
  assert.equal(t.clicks(), 1);
  assert.equal(t.escapes(), 0);
  t.advance(1500); t.tick();
  assert.equal(t.clicks(), 2);
  t.advance(1500); t.tick();
  assert.equal(t.escapes(), 1);
  for (let i = 0; i < 100; i++) { t.advance(1500); t.tick(); }
  assert.equal(t.clicks(), 2);
  assert.equal(t.escapes(), 1);
});
test("HMR passive closer yields to each active Automate owner", () => {
  for (const owner of [
    { ArcusShared: {state:{isRunning:true}} },
    { ArcusAutoOverride: {isEnabled:()=>true} },
    { ArcusStore: {ipfill:{state:{running:true}}} },
    { ArcusPaperless: {isActive:()=>true} },
    { _hmrAutoRunning: true },
  ]) {
    const t = setup(); Object.assign(t.context, owner); t.tick();
    assert.equal(t.clicks(), 0); assert.equal(t.escapes(), 0);
  }
});