const fs=require("node:fs"),vm=require("node:vm"),assert=require("node:assert/strict"),path=require("node:path");
const s=fs.readFileSync(path.join(__dirname,"../src/features/home-med/page-home-med.js"),"utf8");
const box={};
for(const name of ["_continueWeekBlocks","_continueDayColumns"]){const start=s.indexOf("function "+name+"(");const end=s.indexOf("\n}",start)+2;vm.runInNewContext(s.slice(start,end),box);}
const days=box._continueDayColumns("2026-09-12","2026-09-30");
assert.equal(days.length,19);
const blocks=box._continueWeekBlocks(days);
assert.equal(JSON.stringify(blocks.map(b=>b.length)),"[7,7,5]");
assert.equal(blocks[2][4].iso,"2026-09-30");
assert.equal(new Set(blocks.flat().map(d=>d.iso)).size,19);
assert.equal(box._continueWeekBlocks(days.slice(0,7)).length,1);
assert.equal(box._continueWeekBlocks(days.slice(0,8)).length,2);
console.log("Seven-day calendar checks passed (19 days: 7 + 7 + 5).");