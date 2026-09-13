"use strict";
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict");
const source = fs.readFileSync(path.join(__dirname, "../src/features/home-med/page-home-med-a4.js"), "utf8");
const start = source.indexOf("    function add(node) {");
const fn = source.slice(start, source.indexOf("    newPage();", start));
class Node {
  constructor(height = 0, className = "") { this.ownHeight = height; this.className = className; this.children = []; this.classList = {add(){}}; }
  append(node) { node.remove(); this.children.push(node); node.parent = this; }
  remove() { if (this.parent) { this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; } }
  get height() { return this.ownHeight + this.children.reduce((n, c) => n + c.height, 0); }
  matches(selector) { return selector === "." + this.className || selector === "tr." + this.className; }
  querySelectorAll(selector) { return this.children.flatMap(c => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
function scenario(initialHeight, cardHeights) {
  const pages = [new Node()];
  pages[0].append(new Node(initialHeight));
  const box = {document:{createElement:()=>new Node()}, body:pages[0], overflow:false};
  box.content = {clientHeight:1000, get scrollHeight(){return box.body.height;}, closest:()=>new Node()};
  box.newPage = () => { box.body = new Node(); pages.push(box.body); };
  vm.createContext(box); vm.runInContext(fn, box);
  const schedule = new Node(0, "mc-info-row");
  for (const height of cardHeights) schedule.append(new Node(height, "mc-continue-item"));
  box.add(schedule);
  return pages.map(p=>p.height);
}
assert.deepEqual(scenario(200, [400,400,400]), [1000,400]);
assert.deepEqual(scenario(850, [400,400,400]), [850,800,400]);
assert.deepEqual(scenario(200, [200,200]), [600]);
console.log("Pagination regression checks passed: remaining space filled, overflow continued, fitting schedules kept together.");