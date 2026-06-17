"use strict";

/**
 * Standalone Node test harness for the offline pattern matcher
 * (src/shared/medical-glossary.js — matchMedicalPattern / matchPattern /
 * matchQtyPattern / matchInjectionPattern / matchAuxiliaryPhrase).
 *
 * No browser/build step needed — the glossary file only touches `window` to
 * export its public functions, so a minimal `window = global` shim is enough
 * to load and exercise it directly from Node.
 *
 * Run:
 *   node test/test-pattern-matcher.js
 *   node test/test-pattern-matcher.js --lang=lo      (run cases for another lang)
 *   node test/test-pattern-matcher.js --verbose      (print every case, not just failures)
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const GLOSSARY_PATH = path.join(__dirname, "..", "src", "shared", "medical-glossary.js");

function loadGlossary() {
  const code = fs.readFileSync(GLOSSARY_PATH, "utf8");
  const sandbox = {};
  sandbox.window = sandbox;       // `window.X = ...` exports land on the sandbox itself
  sandbox.console = console;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: GLOSSARY_PATH });
  return sandbox;
}

const sandbox = loadGlossary();
const { matchMedicalPattern, matchQtyNoLabel } = sandbox;

if (typeof matchMedicalPattern !== "function") {
  console.error("FATAL: window.matchMedicalPattern was not exported by medical-glossary.js");
  process.exit(1);
}

/* ── Test cases ──────────────────────────────────────────────────────────
 * `input` is text as it looks AFTER translate-core.js's normalizePrescription()
 * (i.e. the canonical "<Verb> N Unit(s) [Route] Frequency [Timing] [For D Days]"
 * shape — see src/features/home-med/README.md "Translation" section).
 * Add new rows here as real ArcusAir instruction strings surface edge cases. */
const CASES = [
  {
    name: "simple oral, once daily",
    input: "Take 1 Tablet Once Daily",
    lang: "th",
    expect: "รับประทาน 1 เม็ด วันละ 1 ครั้ง",
  },
  {
    name: "twice daily after breakfast",
    input: "Take 2 Tablets Twice Daily After Breakfast",
    lang: "th",
    expect: "รับประทาน 2 เม็ด วันละ 2 ครั้ง หลังอาหารเช้า",
  },
  {
    name: "fraction tablet (half) — qty resolves to Thai word for lang=th",
    input: "Take half Tablet Once Daily",
    lang: "th",
    expect: "รับประทาน ครึ่ง เม็ด วันละ 1 ครั้ง",
  },
  {
    name: "nasal spray, twice daily, 2 nostrils",
    input: "Spray 2 Sprays Twice Daily",
    lang: "th",
    expect: "พ่น 2 ครั้ง วันละ 2 ครั้ง",
  },
  {
    name: "eye drops, every 8 hours, for 7 days",
    input: "Instill 1 Drop Every 8 hours For 7 Days",
    lang: "th",
    expect: "หยอด 1 หยด ทุก 8 ชั่วโมง เป็นเวลา 7 วัน",
  },
  {
    name: "PRN (as needed)",
    input: "Take 1 Tablet every 4 hours as needed",
    lang: "th",
    contains: ["รับประทาน 1 เม็ด", "ทุก 4 ชั่วโมง", "เมื่อมีอาการ"],
  },
  {
    name: "compound timing — three meals + bedtime",
    input: "Take 1 Tablet morning noon evening bedtime",
    lang: "th",
    expect: "รับประทาน 1 เม็ด เช้า เที่ยง เย็น ก่อนนอน",
  },
  {
    name: "curated auxiliary phrase — verbatim match",
    input: "shake well before use",
    lang: "th",
    expect: "เขย่าขวดก่อนใช้",
  },
  {
    // _applyVerb()/_drinkVerb() only kick in on the freqOverride salvage path
    // (MASTER_RE never matches qty-less topical/fluid instructions) — same as
    // the real client, which only passes freqOverride for the th locale.
    name: "topical apply-on-dry-skin salvage (needs freqOverride, no qty/unit to match MASTER_RE)",
    input: "Apply on Dry Skin twice daily",
    lang: "th",
    opts: { freqOverride: "วันละ 2 ครั้ง" },
    contains: ["ทาบริเวณผิวที่แห้ง", "วันละ 2 ครั้ง"],
  },
  {
    name: "ORS drink-slowly salvage (needs freqOverride)",
    input: "Drink Instead of Water Every 2-3 Hours When have Symptom",
    lang: "th",
    opts: { freqOverride: "ทุก 2-3 ชั่วโมง เมื่อมีอาการ" },
    contains: ["ดื่มช้าๆ"],
  },
  {
    name: "injection, IV, every 8 hours",
    input: "Inject 1200 mg IV every 8 hours",
    lang: "th",
    contains: ["ฉีด", "1200 มก.", "เข้าหลอดเลือดดำ"],
  },
  {
    name: "freqOverride takes priority over engine's own frequency",
    input: "Take 1 Tablet Once Daily",
    lang: "th",
    opts: { freqOverride: "วันละ 1 ครั้ง หลังอาหารเช้า (ตามคำสั่งแพทย์)" },
    contains: ["รับประทาน 1 เม็ด", "ตามคำสั่งแพทย์"],
  },
  {
    name: "unparseable English tail salvaged via TAKE_QTY_RE + freqOverride",
    input: "Take 1 Tablet some unparseable freeform text the regex can't match",
    lang: "th",
    opts: { freqOverride: "วันละ 1 ครั้ง" },
    expect: "รับประทาน 1 เม็ด วันละ 1 ครั้ง",
  },
  {
    name: "no match — gibberish falls through to null (glossary/Google layer)",
    input: "asdkj qwoeiu random text",
    lang: "th",
    expect: null,
  },
  {
    name: "mouth spray — pre-qty route produces พ่นปาก verb (not bare พ่น)",
    input: "Spray into the Mouth 3 SPRAY 3 times daily Before Breakfast Lunch Dinner If needed",
    lang: "th",
    opts: { freqOverride: "วันละ 3 ครั้ง ก่อนอาหาร เช้า กลางวัน เย็น เวลามีอาการ" },
    expect: "พ่นปาก 3 ครั้ง วันละ 3 ครั้ง ก่อนอาหาร เช้า กลางวัน เย็น เวลามีอาการ",
  },
  {
    name: "patch on skin — verb แปะที่ผิวหนัง not dropped (requires freqOverride)",
    input: "Patch on the skin 1 Patch Once Daily When have Symptom",
    lang: "th",
    opts: { freqOverride: "วันละ 1 ครั้ง เวลามีอาการ" },
    expect: "แปะที่ผิวหนัง วันละ 1 ครั้ง เวลามีอาการ",
  },
  {
    name: "inhale through mouth (PUFF_PU suffix) → สูดยาทางปาก N กด",
    input: "Inhale through the Mouth 1 PUFF_PU 2 times daily After Breakfast Dinner",
    lang: "th",
    opts: { freqOverride: "วันละ 2 ครั้ง หลังอาหาร เช้า เย็น" },
    expect: "สูดยาทางปาก 1 กด วันละ 2 ครั้ง หลังอาหาร เช้า เย็น",
  },
  {
    name: "apply to ulcer in mouth (ml) → ทาแผลในปากหรืออมกลั้วปาก N มิลลิลิตร",
    input: "Apply to the Ulcer in Mouth 1 MilliLitre 3 times daily Before Breakfast Lunch Dinner",
    lang: "th",
    opts: { freqOverride: "วันละ 3 ครั้ง ก่อนอาหาร เช้า กลางวัน เย็น" },
    expect: "ทาแผลในปากหรืออมกลั้วปาก 1 มล. วันละ 3 ครั้ง ก่อนอาหาร เช้า กลางวัน เย็น",
  },
];

/* ── Runner ─────────────────────────────────────────────────────────────── */
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");

let pass = 0, fail = 0;
for (const c of CASES) {
  const result = matchMedicalPattern(c.input, c.lang, c.opts);
  let ok;
  if (c.expect !== undefined) {
    ok = result === c.expect;
  } else if (c.contains) {
    ok = result != null && c.contains.every(s => result.includes(s));
  } else {
    ok = false;
  }

  if (ok) {
    pass++;
    if (verbose) console.log(`  PASS  ${c.name}\n        "${c.input}" -> "${result}"`);
  } else {
    fail++;
    console.log(`  FAIL  ${c.name}`);
    console.log(`        input:    "${c.input}"`);
    console.log(`        got:      ${JSON.stringify(result)}`);
    if (c.expect !== undefined) console.log(`        expected: ${JSON.stringify(c.expect)}`);
    if (c.contains)            console.log(`        expected to contain: ${JSON.stringify(c.contains)}`);
  }
}

console.log(`\n${pass}/${CASES.length} passed${fail ? `, ${fail} FAILED` : ""}.`);
process.exit(fail ? 1 : 0);
