"use strict";
// Run: node test/test-meal-slots.js
const assert = require("node:assert/strict");
require("../src/shared/meal-slots.js");
const { doseSnippet, gridHTML } = globalThis.BKNMealSlots;
const instruction = "พ่นจมูกข้างละ 1 กด วันละ 2 ครั้ง เช้า เย็น";
assert.equal(doseSnippet(instruction), "1 กด");
assert.equal(doseSnippet("พ่นจมูกข้างละ 2 กด วันละ 1 ครั้ง"), "2 กด");
assert.equal(doseSnippet("รับประทาน 2 แคปซูล วันละ 2 ครั้ง หลังอาหาร เช้า เย็น"), "2 แคปซูล");
assert.equal(doseSnippet("รับประทาน 5 มล. วันละ 2 ครั้ง"), "5 มล.");
assert.equal(doseSnippet("ทาบริเวณที่เป็น วันละ 2 ครั้ง"), "");
const html = gridHTML([{
  drug: "Avamys Nasal Spray (27.5 Mcg/D) (60 Doses)",
  text: instruction,
  dose: doseSnippet(instruction),
}]);
assert.ok(html.includes('class="mc-slot t-abf"'));
assert.ok(html.includes('class="mc-slot t-adn"'));
assert.equal((html.match(/class="mc-dose">1 กด<\/span>/g) || []).length, 2);
// Preserve the half-tablet wording from the instruction, not the drug strength.
const halfTabletCases = [
  ["Levofloxacin 500 mg TABLET", "รับประทาน ครึ่ง เม็ด วันละ 1 ครั้ง หลังอาหารเช้า", "abf"],
  ["Paracetamol 500 mg TABLET", "รับประทาน ครึ่ง เม็ด ทุก 6 ชั่วโมง เวลามีอาการ", "prn"],
];
for (const [drug, text, slot] of halfTabletCases) {
  const dose = doseSnippet(text);
  assert.equal(dose, "ครึ่ง เม็ด");
  const card = gridHTML([{ drug, text, dose }]);
  assert.ok(card.includes(`class="mc-slot t-${slot}"`));
  assert.ok(card.includes('class="mc-dose">ครึ่ง เม็ด</span>'));
  assert.ok(!card.includes('class="mc-dose">500 mg</span>'));
}
assert.equal(doseSnippet("รับประทาน ครึ่งเม็ด วันละ 1 ครั้ง"), "ครึ่งเม็ด");
assert.equal(doseSnippet("รับประทาน 1/2 เม็ด วันละ 1 ครั้ง"), "1/2 เม็ด");
assert.equal(doseSnippet("รับประทาน 0.5 เม็ด วันละ 1 ครั้ง"), "0.5 เม็ด");
assert.equal(doseSnippet("วันละ 1 ครั้ง หลังอาหารเช้า"), "");
console.log("Meal-slot dose regression checks passed.");
