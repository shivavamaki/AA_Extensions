/* ═══════════════════════════════════════════════════════════════
   Auxiliary Sticker System — aux_sticker.js
   Premix Sticker + Mixing Label · BKN Pharmacy
   MV3 compliant: no inline handlers
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   SERVER CONFIG
   Override URL via localStorage key 'pharmacyServerUrl'.
────────────────────────────────────────────────────────────── */
const _PHARMACY_SERVER_DEFAULT = 'http://10.134.110.81:8765';
function _serverUrl() {
  return (localStorage.getItem('pharmacyServerUrl') || _PHARMACY_SERVER_DEFAULT).replace(/\/$/, '');
}

async function _fetchRx(endpoint) {
  const r = await fetch(`${_serverUrl()}${endpoint}`, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/* ──────────────────────────────────────────────────────────────
   DATABASE: Premix drugs (from Premix_STK_2024.xlsx > data sheet)
   Fields: name, shelf_life (days), label1, warning1, warning2
   Dates are calculated from today + shelf_life
   Fallback — live data loaded from server on init.
────────────────────────────────────────────────────────────── */
let PREMIX_DB = [
  { no:1,  name:"0.5% HIBITANE IN WATER 100 ML",                    shelf:30,  label1:"หลังเปิดใช้ เก็บได้ 24 ชั่วโมง",  w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:2,  name:"SAVLON PURE 10 ml (BACTRICIDE)",                   shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:3,  name:"1% HYDROGEN PEROXIDE 120 ML",                       shelf:7,   label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:"ใช้สำหรับกลั้วปาก" },
  { no:4,  name:"3% Acetic Acid (30 ml)",                            shelf:180, label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:null,                          w2:null },
  { no:5,  name:"Hibiscrub Soap (60 ML)",                            shelf:7,   label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:6,  name:"Lidocaine 2% Viscous 5 ml",                         shelf:180, label1:null,                               w1:null,                          w2:null },
  { no:7,  name:"Lidocaine 2% Viscous 10 ml",                        shelf:180, label1:null,                               w1:null,                          w2:null },
  { no:8,  name:"Lugol's Solution",                                  shelf:365, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:9,  name:"Savlon 1% For Dressing (Alcohol 95%) Bot",          shelf:90,  label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:10, name:"Xylocaine 2% Adrenaline 10 ml",                     shelf:3,   label1:"หลังเปิดใช้ เก็บได้ 3 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:"ยาแช่เย็น" },
  { no:11, name:"Xylocaine 1% Adrenaline 10 ml",                     shelf:3,   label1:"หลังเปิดใช้ เก็บได้ 3 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:"ยาแช่เย็น" },
  { no:12, name:"Xylocaine 1% Adrenaline 20 ml",                     shelf:3,   label1:"หลังเปิดใช้ เก็บได้ 3 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:"ยาแช่เย็น" },
  { no:13, name:"Xylocaine 2% Adrenaline 20 ml",                     shelf:3,   label1:"หลังเปิดใช้ เก็บได้ 3 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:"ยาแช่เย็น" },
  { no:14, name:"Benzac Ac 2.5% Gel",                                shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:15, name:"Differin 0.1% Gel",                                  shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:16, name:"Emla (5%) Cream 5 G",                               shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:17, name:"Silver Sulfadiazine 1% Cream (30 G)",               shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:18, name:"T.A.0.1% + 10% Urea Cream",                         shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:19, name:"White Vaseline 5 Gm",                               shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:20, name:"White Vaseline 10 Gm",                              shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:21, name:"White Vaseline 15 Gm",                              shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:22, name:"8% Lidocaine Solution 10 ml",                       shelf:90,  label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:23, name:"Lidocaine 2% Adrenaline 50 ml",                     shelf:7,   label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:24, name:"Lidocaine 1% Adrenaline 50 ml",                     shelf:7,   label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:25, name:"Lidocaine 2% Adrenaline 20 ml",                     shelf:3,   label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:26, name:"Lidocaine 1% Adrenaline 20 ml",                     shelf:3,   label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:27, name:"Lidocaine 10% Cream 15 Gm",                         shelf:180, label1:"หลังเปิดใช้ เก็บได้ 180 วัน",     w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:28, name:"Emla (5%) Cream 5 G (2)",                           shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:29, name:"Lidocaine 10% Cream 30 Gm",                         shelf:180, label1:"หลังเปิดใช้ เก็บได้ 180 วัน",     w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:30, name:"Adrenaline 0.3 mg/0.3 mL",                          shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:31, name:"White Vaseline 30 Gm",                              shelf:180, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:32, name:"Savlon Douch 1:100 Solution",                       shelf:180, label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:33, name:"Oxymetazoline 0.025% + Lidocaine 2% 20 mL",         shelf:30,  label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:34, name:"Savlon Douch 1:100 Solution (100 mL)",              shelf:180, label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:35, name:"Oxymetazoline 0.025% + Lidocaine 4% in 40 mL",      shelf:30,  label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:36, name:"Lidocaine 10% Cream 10 Gm",                         shelf:180, label1:"หลังเปิดใช้ เก็บได้ 180 วัน",     w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:37, name:"Lidocaine Powder 8 Gm",                             shelf:360, label1:null,                               w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:38, name:"3% Acetic Acid 100 ML",                             shelf:180, label1:"หลังเปิดใช้ เก็บได้ 7 วัน",       w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
  { no:39, name:"TCA 50% Solutions",                                 shelf:720, label1:"หลังเปิดใช้ เก็บได้ 180 วัน",     w1:"ยาใช้ภายนอก ห้ามรับประทาน",  w2:null },
];

/* ──────────────────────────────────────────────────────────────
   DATABASE: Mixing labels
   Fields:
     name     — drug name
     steps    — max 4 lines (Thai)
     steps_en — max 4 lines (English)
     storage  — "ตู้เย็น" | "อุณหภูมิห้อง"  (longest shelf life chosen)
     days     — shelf life after mixing (number)
     note     — optional extra (Thai · English separated by " · ")
   Fallback — live data loaded from server on init.
────────────────────────────────────────────────────────────── */
let MIXING_DB = [
  {
    name: "Samnir Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด 19 ml","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add 19 mL of clean water","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 14, note: null
    // source: room temp 7d / fridge 14d → fridge chosen (longer)
  },
  {
    name: "Moxicillin Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 14, note: null
  },
  {
    name: "Distaclor Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 14, note: null
  },
  {
    name: "Augmentin 457 mg. Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 7, note: null
  },
  {
    name: "Dicloxacillin Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด เขย่าให้เข้ากัน","3. เติมน้ำให้ถึงขีด","4. เขย่าให้เข้ากันดีอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of mark, shake well","3. Top up to mark","4. Shake again"],
    storage: "ตู้เย็น", days: 14, note: null
  },
  {
    name: "Cefspan Suspension",
    steps:    ["1. เคาะขวดยาให้ยากระจายตัว","2. เติมน้ำสะอาด 20 ml","3. เขย่าให้เข้ากันดี"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add 20 mL of clean water","3. Shake well"],
    storage: "ตู้เย็น", days: 14, note: null
  },
  {
    name: "Omnicef Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด 19 ml","3. เขย่าให้เข้ากันดี"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add 19 mL of clean water","3. Shake well"],
    storage: "ตู้เย็น", days: 14, note: null
  },
  {
    name: "Klacid Ped (125mg/5ml) 60 ml",
    steps:    ["1. เคาะขวดยาให้ยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "อุณหภูมิห้อง", days: 14, note: "15–30°C"
  },
  {
    name: "Keflex Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~2/3 ของขีด","3. เขย่าให้เข้ากัน เติมน้ำให้ถึงขีด","4. เขย่าให้เข้ากันอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~2/3 of the mark","3. Shake well, top up to mark","4. Shake again"],
    storage: "ตู้เย็น", days: 14, note: "4–8°C"
  },
  {
    name: "Zithromax Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด 9 ml","3. เขย่าให้เข้ากันดี"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add 9 mL of clean water","3. Shake well"],
    storage: "อุณหภูมิห้อง", days: 10, note: null
  },
  {
    name: "Azithromycin Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด 9 ml","3. เขย่าให้เข้ากันดี"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add 9 mL of clean water","3. Shake well"],
    storage: "อุณหภูมิห้อง", days: 10, note: null
  },
  {
    name: "AMK 457 mg Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 7, note: "กันแสง · protect from light"
  },
  {
    name: "Augmentin ES Syrup",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 10, note: "กันแสง · protect from light"
  },
  {
    name: "AMK ES-600 Syrup",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 7, note: "กันแสง · protect from light"
  },
  {
    name: "Tamiflu Oral Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด 55 ml","   (ถึงปลายหัวลูกศรที่ถ้วยตวง)","3. เขย่าให้เข้ากันดี"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add 55 mL of clean water","   (to arrow tip on measuring cup)","3. Shake well"],
    storage: "ตู้เย็น", days: 17, note: "or room temp 10 days"
    // source: fridge 17d / room temp 10d → fridge chosen (longer)
  },
  {
    name: "Vercef (125 mg/5 mL) Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 14, note: null
  },
  {
    name: "Miotin Dry Syrup",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 7, note: null
  },
  {
    name: "CAVUMOX ES 600 mg Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 10, note: null
  },
  {
    name: "Unasyn Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด","3. เขย่าให้เข้ากันดี","4. เติมน้ำให้ถึงขีด เขย่าอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of the mark","3. Shake well","4. Top up to mark, shake again"],
    storage: "ตู้เย็น", days: 14, note: null
  },
  {
    name: "Cloxacillin Suspension",
    steps:    ["1. เขย่าขวดยาให้ผงยากระจายตัว","2. เติมน้ำสะอาด ~3/4 ของขีด เขย่าให้เข้ากัน","3. เติมน้ำให้ถึงขีด","4. เขย่าให้เข้ากันดีอีกครั้ง"],
    steps_en: ["1. Tap bottle to loosen powder","2. Add water to ~3/4 of mark, shake well","3. Top up to mark","4. Shake again"],
    storage: "ตู้เย็น", days: 7, note: null
  },
];

/* ──────────────────────────────────────────────────────────────
   UTILITY FUNCTIONS
────────────────────────────────────────────────────────────── */
function todayDateObj() { return new Date(); }

function formatDateTH(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d;
}

function todayISO() {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function toast(msg, type = '') {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

/* ──────────────────────────────────────────────────────────────
   PAGE NAVIGATION
────────────────────────────────────────────────────────────── */
function showPage(id) {
  document.querySelectorAll('.ax-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  document.querySelector(`.nav-item[data-page="${id}"]`).classList.add('active');

  const titles = {
    premix: ['Prepack Sticker', '10×5 cm / 6 ดวงต่อแผ่น (3×2) · บล็อกละ 3×1.5 cm'],
    mixing: ['Mixing Label', '10×5 cm — วิธีผสมยา dry syrup / suspension'],
  };
  document.getElementById('topbar-title').textContent = titles[id][0];
  document.getElementById('topbar-sub').textContent   = titles[id][1];
}

/* ──────────────────────────────────────────────────────────────
   PREMIX PAGE LOGIC
────────────────────────────────────────────────────────────── */
function initPremix() {
  const sel     = document.getElementById('pm-drug');
  const mfgInp  = document.getElementById('pm-mfg-date');
  const expInp  = document.getElementById('pm-exp-date');
  const noteInp = document.getElementById('pm-note');
  const infoCard  = document.getElementById('pm-info-card');
  const infoContent = document.getElementById('pm-info-content');
  const previewBox  = document.getElementById('preview-pm');

  // Populate dropdown
  PREMIX_DB.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = d.name;
    sel.appendChild(opt);
  });

  // Set default mfg date = today
  mfgInp.value = todayISO();
  recalcExp();

  function recalcExp() {
    const drug = PREMIX_DB[sel.value];
    if (!drug || !mfgInp.value) { expInp.value = ''; return; }
    const expDate = addDays(mfgInp.value, drug.shelf);
    expInp.value = formatDateTH(expDate);
  }

  sel.addEventListener('change', () => {
    recalcExp();
    updateInfo();
  });
  mfgInp.addEventListener('input', recalcExp);

  function updateInfo() {
    const drug = PREMIX_DB[sel.value];
    if (!drug) { infoCard.style.display = 'none'; return; }
    infoCard.style.display = '';
    infoContent.innerHTML = `
      <span class="ax-info-label">อายุยา</span><span class="ax-info-value">${drug.shelf} วัน</span>
      ${drug.label1 ? `<span class="ax-info-label">คำเตือน 1</span><span class="ax-info-value">${drug.label1}</span>` : ''}
      ${drug.w1     ? `<span class="ax-info-label">คำเตือน 2</span><span class="ax-info-value">${drug.w1}</span>` : ''}
      ${drug.w2     ? `<span class="ax-info-label">คำเตือน 3</span><span class="ax-info-value">${drug.w2}</span>` : ''}
    `;
  }

  document.getElementById('pm-btn-preview').addEventListener('click', () => {
    const drug = PREMIX_DB[sel.value];
    if (!drug) { toast('กรุณาเลือกยา', 'error'); return; }

    recalcExp();

    const layout = document.getElementById('pm-layout').value;

    previewBox.innerHTML = '';

    if (layout === 'full') {
      previewBox.appendChild(
        buildPremixFullSticker(drug, mfgInp.value, expInp.value, noteInp.value)
      );
    } else {
      previewBox.appendChild(
        buildPremixSticker(drug, mfgInp.value, expInp.value, noteInp.value)
      );
    }
  });

  document.getElementById('pm-btn-print').addEventListener('click', () => {
    const drug = PREMIX_DB[sel.value];
    if (!drug) { toast('กรุณาเลือกยา', 'error'); return; }

    recalcExp();

    const sheets = parseInt(document.getElementById('pm-sheets').value) || 1;
    const layout = document.getElementById('pm-layout').value;

    if (layout === 'full') {
      printPremixFull(drug, mfgInp.value, expInp.value, noteInp.value, sheets);
    } else {
      printPremix(drug, mfgInp.value, expInp.value, noteInp.value, sheets);
    }
  });
}

function buildPremixFullSticker(drug, mfgISO, expDisplay, note) {
  const mfgDisplay = mfgISO ? formatDateTH(new Date(mfgISO)) : '';
  const lang = document.getElementById('pm-lang').value;

  const label1 = (lang === 'en') ? translateLabel1(drug.label1) : drug.label1;
  const w1     = (lang === 'en') ? translateW1(drug.w1)       : drug.w1;
  const w2     = (lang === 'en') ? translateW2(drug.w2)       : drug.w2;  

  const card = document.createElement('div');
  card.className = 'stk-card';

  card.innerHTML = `
    <div class="stk-card-logo"><span class="stk-card-logo-hint">LOGO ZONE</span></div>
    <div class="stk-full-body">
      <div class="stk-full-name">${escHTML(drug.name)}</div>

      <div class="stk-full-dates">
        <span><b>Prep.</b> ${escHTML(mfgDisplay)}</span>
        <span><b>Exp.</b> ${escHTML(expDisplay)}</span>
      </div>

      ${label1 ? `<div class="stk-full-sub">${escHTML(label1)}</div>` : ''}
      ${w1 ? `<div class="stk-full-warn">${escHTML(w1)}</div>` : ''}
      ${w2 ? `<div class="stk-full-warn">${escHTML(w2)}</div>` : ''}
      ${note ? `<div class="stk-full-note">${escHTML(note)}</div>` : ''}
    </div>
  `;

  return card;
}

function printPremixFull(drug, mfgISO, expDisplay, note, sheets) {
  const mfgDisplay = mfgISO ? formatDateTH(new Date(mfgISO)) : '';
  const lang = document.getElementById('pm-lang').value;

  const label1 = (lang === 'en') ? translateLabel1(drug.label1) : drug.label1;
  const w1     = (lang === 'en') ? translateW1(drug.w1)       : drug.w1;
  const w2     = (lang === 'en') ? translateW2(drug.w2)       : drug.w2;

  let html = '';

  for (let i = 0; i < sheets; i++) {
    html += `
      <div class="sheet-full">
        <div class="sheet-logo"></div>
        <div class="full-body">
          <div class="full-name">${escHTML(drug.name)}</div>

          <div class="full-dates">
            <span><b>Prep.</b> ${escHTML(mfgDisplay)}</span>
            <span><b>Exp.</b> ${escHTML(expDisplay)}</span>
          </div>

          ${label1 ? `<div class="full-sub">${escHTML(label1)}</div>` : ''}
          ${w1 ? `<div class="full-warn">${escHTML(w1)}</div>` : ''}
          ${w2 ? `<div class="full-warn">${escHTML(w2)}</div>` : ''}
          ${note ? `<div class="full-note">${escHTML(note)}</div>` : ''}
        </div>
      </div>
    `;
  }

  openPrintWindow(html, PREMIX_FULL_CSS);
}

/* Translate Thai label fields to short English for prepack blocks */
function translateLabel1(s) {
  if (!s) return null;
  // "หลังเปิดใช้ เก็บได้ X วัน" → "Shelf life X day(s) after open"
  // "หลังเปิดใช้ เก็บได้ 24 ชั่วโมง" → "Shelf life 24 hr after open"
  let m = s.match(/(\d+)\s*วัน/);
  if (m) return `Shelf life ${m[1]} day${m[1]==='1'?'':'s'} after open`;
  m = s.match(/(\d+)\s*ชั่วโมง/);
  if (m) return `Shelf life ${m[1]} hr after open`;
  return s;
}
function translateW1(s) {
  if (!s) return null;
  if (s.includes('ยาใช้ภายนอก')) return 'External use only';
  return s;
}
function translateW2(s) {
  if (!s) return null;
  if (s.includes('ยาแช่เย็น'))        return 'Keep refrigerated';
  if (s.includes('กลั้วปาก'))          return 'For gargling only';
  return s;
}

function buildPremixSticker(drug, mfgISO, expDisplay, note) {
  const mfgDisplay = mfgISO ? formatDateTH(new Date(mfgISO)) : '';
  const lang = document.getElementById('pm-lang').value;

  const label1 = (lang === 'en') ? translateLabel1(drug.label1) : drug.label1;
  const w1     = (lang === 'en') ? translateW1(drug.w1)       : drug.w1;
  const w2     = (lang === 'en') ? translateW2(drug.w2)       : drug.w2;

  function miniBlock() {
    return `<div class="prev-blk">
      <div class="prev-blk-name">${escHTML(drug.name)}</div>
      <div class="prev-blk-dates"><span><span class="prev-blk-k">Prep.</span> ${escHTML(mfgDisplay)}</span><span><span class="prev-blk-k">Exp.</span> ${escHTML(expDisplay)}</span></div>
      ${label1 ? `<div class="prev-blk-sub">${escHTML(label1)}</div>` : ''}
      ${w1 ? `<div class="prev-blk-warn">${escHTML(w1)}</div>` : ''}
      ${w2 ? `<div class="prev-blk-warn">${escHTML(w2)}</div>` : ''}
    </div>`;
  }

  const wrap = document.createElement('div');
  wrap.className = 'stk-card';
  wrap.innerHTML = `
    <div class="stk-card-logo"><span class="stk-card-logo-hint">LOGO ZONE</span></div>
    <div class="prev-grid">
      ${miniBlock()}${miniBlock()}${miniBlock()}
      ${miniBlock()}${miniBlock()}${miniBlock()}
    </div>
  `;
  return wrap;
}

function printPremix(drug, mfgISO, expDisplay, note, sheets) {
  const mfgDisplay = mfgISO ? formatDateTH(new Date(mfgISO)) : '';
  const lang = document.getElementById('pm-lang').value;

  const label1 = (lang === 'en') ? translateLabel1(drug.label1) : drug.label1;
  const w1     = (lang === 'en') ? translateW1(drug.w1)       : drug.w1;
  const w2     = (lang === 'en') ? translateW2(drug.w2)       : drug.w2;

  function miniBlock() {
    return `<div class="blk">
      <div class="blk-name">${escHTML(drug.name)}</div>
      <div class="blk-dates"><span><span class="blk-k">Prep.</span> ${escHTML(mfgDisplay)}</span><span><span class="blk-k">Exp.</span> ${escHTML(expDisplay)}</span></div>
      ${label1 ? `<div class="blk-sub">${escHTML(label1)}</div>` : ''}
      ${w1     ? `<div class="blk-warn">${escHTML(w1)}</div>` : ''}
      ${w2     ? `<div class="blk-warn">${escHTML(w2)}</div>` : ''}
      ${note   ? `<div class="blk-note">${escHTML(note)}</div>` : ''}
    </div>`;
  }

  let html = '';
  for (let s = 0; s < sheets; s++) {
    html += `<div class="sheet">
      <div class="sheet-logo"></div>
      <div class="sheet-grid">
        ${miniBlock()}${miniBlock()}${miniBlock()}
        ${miniBlock()}${miniBlock()}${miniBlock()}
      </div>
    </div>`;
  }

  openPrintWindow(html, PREMIX_CSS);
}

/* ──────────────────────────────────────────────────────────────
   MIXING PAGE LOGIC
────────────────────────────────────────────────────────────── */
function initMixing() {
  const sel         = document.getElementById('mx-drug');
  const contentCard = document.getElementById('mx-content-card');
  const contentPrev = document.getElementById('mx-content-preview');
  const previewBox  = document.getElementById('preview-mx');

  MIXING_DB.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = d.name;
    sel.appendChild(opt);
  });

  function getLang() {
    return document.querySelector('input[name="mx-lang"]:checked')?.value || 'th';
  }

  function updateContent() {
    const drug = MIXING_DB[sel.value];
    if (!drug) { contentCard.style.display = 'none'; return; }
    const lang = getLang();
    const steps = lang === 'en' ? drug.steps_en : drug.steps;
    const storageLabel = lang === 'en'
      ? (drug.storage === 'ตู้เย็น' ? '🧊 Keep refrigerated' : '🌡 Room temperature')
      : (drug.storage === 'ตู้เย็น' ? '🧊 เก็บยาในตู้เย็น' : '🌡 เก็บยาที่อุณหภูมิห้อง');
    const daysLabel = lang === 'en'
      ? `${drug.days} days after mixing`
      : `อายุหลังผสม ${drug.days} วัน`;
    contentCard.style.display = '';
    contentPrev.textContent =
      steps.join('\n') + '\n\n' +
      storageLabel + '  |  ' + daysLabel +
      (drug.note ? '  (' + drug.note + ')' : '');
  }

  sel.addEventListener('change', updateContent);
  document.querySelectorAll('input[name="mx-lang"]').forEach(r =>
    r.addEventListener('change', updateContent)
  );

  document.getElementById('mx-btn-preview').addEventListener('click', () => {
    const drug = MIXING_DB[sel.value];
    if (!drug) { toast('กรุณาเลือกยา', 'error'); return; }
    updateContent();
    previewBox.innerHTML = '';
    previewBox.appendChild(buildMixingSticker(drug, getLang()));
  });

  document.getElementById('mx-btn-print').addEventListener('click', () => {
    const drug = MIXING_DB[sel.value];
    if (!drug) { toast('กรุณาเลือกยา', 'error'); return; }
    const copies = parseInt(document.getElementById('mx-copies').value) || 1;
    printMixing(drug, getLang(), copies);
  });
}

function buildMixingSticker(drug, lang) {
  const steps = lang === 'en' ? drug.steps_en : drug.steps;
  const storageLabel = lang === 'en'
    ? (drug.storage === 'ตู้เย็น' ? '🧊 Keep refrigerated' : '🌡 Room temperature')
    : (drug.storage === 'ตู้เย็น' ? '🧊 เก็บยาในตู้เย็น' : '🌡 เก็บยาที่อุณหภูมิห้อง');
  const daysLabel = lang === 'en'
    ? `${drug.days} days after mixing${drug.note ? ' · ' + drug.note : ''}`
    : `อายุหลังผสม ${drug.days} วัน${drug.note ? ' · ' + drug.note : ''}`;
  const title = lang === 'en'
    ? `How to mix ${drug.name}`
    : `วิธีผสมยา ${drug.name}`;

  const card = document.createElement('div');
  card.className = 'stk-card';
  card.innerHTML = `
    <div class="stk-card-logo"><span class="stk-card-logo-hint">LOGO ZONE</span></div>
    <div class="stk-card-body">
      <div class="stk-mix-title">${escHTML(title)}</div>
      <div class="stk-mix-steps">${steps.map(s => escHTML(s)).join('<br>')}</div>
      <div class="stk-mix-footer-row">
        <span class="stk-mix-storage">${storageLabel}</span>
        <span class="stk-mix-days">${escHTML(daysLabel)}</span>
      </div>
    </div>
  `;
  return card;
}

function printMixing(drug, lang, copies) {
  const steps = lang === 'en' ? drug.steps_en : drug.steps;
  const storageLabel = lang === 'en'
    ? (drug.storage === 'ตู้เย็น' ? 'Keep refrigerated' : 'Room temperature')
    : (drug.storage === 'ตู้เย็น' ? 'เก็บยาในตู้เย็น' : 'เก็บยาที่อุณหภูมิห้อง');
  const daysLabel = lang === 'en'
    ? `${drug.days} days after mixing${drug.note ? ' · ' + drug.note : ''}`
    : `อายุหลังผสม ${drug.days} วัน${drug.note ? ' · ' + drug.note : ''}`;
  const title = lang === 'en'
    ? `How to mix ${drug.name}`
    : `วิธีผสมยา ${drug.name}`;

  let stickerHTML = '';
  for (let i = 0; i < copies; i++) {
    stickerHTML += `
      <div class="stk">
        <div class="stk-logo-zone"></div>
        <div class="stk-body">
          <div class="stk-mix-title">${escHTML(title)}</div>
          <div class="stk-mix-steps">${steps.map(s => `<div>${escHTML(s)}</div>`).join('')}</div>
          <div class="stk-mix-footer-row">
            <span class="stk-mix-storage">${escHTML(storageLabel)}</span>
            <span class="stk-mix-days">${escHTML(daysLabel)}</span>
          </div>
        </div>
      </div>
    `;
  }

  openPrintWindow(stickerHTML, MIXING_CSS);
}

/* ──────────────────────────────────────────────────────────────
   PRINT ENGINE  (mirrors iv_sticker.js openPrintWindow pattern)
────────────────────────────────────────────────────────────── */
function escHTML(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* Print sheet: 10×5cm with 15mm logo zone
   Content grid: 3 cols × 2 rows of 30mm × 15mm mini blocks     */
const PREMIX_CSS = `
@page { size: 10cm 5cm; margin: 0; }
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@600;700;800&display=swap');
* { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
html, body { margin: 0; padding: 0; width: 10cm; font-family: 'Noto Sans Thai', sans-serif; }
.sheet { width: 10cm; height: 5cm; display: flex; flex-direction: column; page-break-after: always; break-after: page; overflow: hidden; }
.sheet-logo { height: 15mm; flex-shrink: 0; border-bottom: 0.6pt solid #000; }
.sheet-grid { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); padding: 1mm; gap: 0; border: 0.4pt solid #000; }
.blk { display: flex; flex-direction: column; padding: 0.8mm 1.2mm; overflow: hidden; border-right: 0.4pt solid #000; border-bottom: 0.4pt solid #000; }
.blk:nth-child(3n) { border-right: none; }
.blk:nth-child(n+4) { border-bottom: none; }
.blk-name  { font-size: 6.5pt; font-weight: 800; color: #000; line-height: 1.2; margin-bottom: 0.3mm; }
.blk-dates { display: flex; justify-content: space-between; gap: 2pt; font-size: 5.5pt; font-weight: 600; color: #000; line-height: 1.3; }
.blk-k     { font-weight: 800; }
.blk-sub   { font-size: 5pt; font-weight: 600; color: #000; line-height: 1.2; margin-top: 0.2mm; }
.blk-warn  { font-size: 5pt; font-weight: 800; color: #000; line-height: 1.2; margin-top: 0.2mm; }
.blk-note  { font-size: 4.5pt; font-weight: 600; color: #000; margin-top: 0.2mm; }
`;

const PREMIX_FULL_CSS = `
@page { size: 10cm 5cm; margin: 0; }
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@600;700;800&display=swap');

* {box-sizing: border-box;-webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;}
html, body {  margin: 0;  padding: 0;  width: 10cm;  height: 5cm;  font-family: 'Noto Sans Thai', sans-serif;}
.sheet-full {  width: 10cm;  height: 5cm;  display: flex;  flex-direction: column;  page-break-after: always;  break-after: page;}
.sheet-logo {  height: 15mm;  border-bottom: 0.6pt solid #000;  flex-shrink: 0;}
.full-body {  flex: 1;  padding: 3mm 4mm;  display: flex;  flex-direction: column;  justify-content: flex-start;}
.full-name {  font-size: 13pt;  font-weight: 800;  margin-bottom: 2mm;  line-height: 1.2;}
.full-dates {  display: flex;  justify-content: space-between;  font-size: 10pt;  font-weight: 700;  margin-bottom: 1mm;}
.full-sub {  font-size: 9pt;  margin-top: 1mm;}
.full-warn {  font-size: 9pt;  font-weight: 800;  margin-top: 1mm;}
.full-note {  font-size: 8pt;  margin-top: 1mm;}
`;

const MIXING_CSS = `
@page { size: 10cm 5cm; margin: 0; }
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@600;700;800&display=swap');
* { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
html, body { margin: 0; padding: 0; width: 10cm; height: 5cm; font-family: 'Sarabun', 'Noto Sans Thai', sans-serif; }
.stk { width: 10cm; height: 5cm; display: flex; flex-direction: column; overflow: hidden; page-break-after: always; break-after: page; }
.stk-logo-zone { height: 15mm; flex-shrink: 0; border-bottom: 0.6pt solid #000; }
/* Keep the printed geometry in sync with the screen preview. The previous print-only
   font sizes were larger than preview, so step 4 was clipped in the PDF. */
.stk-body { flex: 1; padding: 2.0mm 3.0mm 1.45mm; display: flex; flex-direction: column; gap: 0.55mm; overflow: hidden; }
.stk-mix-title  { font-size: 8.6pt; font-weight: 800; color: #000; line-height: 1.2; margin: 0 0 0.35mm; flex-shrink: 0; }
.stk-mix-steps  { font-size: 7.85pt; font-weight: 600; color: #000; line-height: 1.42; flex: 1 1 auto; overflow: visible; }
.stk-mix-steps div { margin: 0; padding: 0; line-height: 1.42; }
.stk-mix-footer-row { display: flex; justify-content: space-between; align-items: baseline;
                      border-top: 0.6pt solid #000; padding-top: 0.65mm; margin-top: 0.45mm; flex-shrink: 0; gap: 4pt; }
.stk-mix-storage { font-size: 7.5pt; font-weight: 800; color: #000; white-space: nowrap; }
.stk-mix-days    { font-size: 7.5pt; font-weight: 800; color: #000; text-align: right; }
`;

/**
 * Open a self-contained print popup — exactly like iv_sticker.js.
 * bodyHTML : the sticker markup
 * css      : full CSS string (including @page and @import)
 */
function openPrintWindow(bodyHTML, css) {
  const w = window.open('', '_blank', 'width=900,height=600');
  if (!w) { toast('Pop-up ถูกบล็อก กรุณาอนุญาต pop-up สำหรับหน้านี้', 'error'); return; }
  w.document.write(`<!DOCTYPE html>
<html lang="th"><head><meta charset="UTF-8">
<style>${css}</style>
</head><body>${bodyHTML}</body></html>`);
  w.document.close();
  // Guard against double-fire (onload + setTimeout)
  let printed = false;
  function doPrint() {
    if (printed) return;
    printed = true;
    try { w.focus(); w.print(); w.close(); } catch(_) {}
  }
  w.onload = doPrint;
  setTimeout(doPrint, 900);
}

/* ──────────────────────────────────────────────────────────────
   CLEAR FORM
────────────────────────────────────────────────────────────── */
function clearCurrentForm() {
  const active = document.querySelector('.nav-item.active');
  if (!active) return;
  const page = active.dataset.page;
  if (page === 'premix') {
    document.getElementById('pm-drug').value = '';
    document.getElementById('pm-mfg-date').value = todayISO();
    document.getElementById('pm-exp-date').value = '';
    document.getElementById('pm-note').value = '';
    document.getElementById('pm-info-card').style.display = 'none';
    document.getElementById('preview-pm').innerHTML = '<div class="ax-empty-state">เลือกยาแล้วกด "สร้าง Preview"</div>';
  } else if (page === 'mixing') {
    document.getElementById('mx-drug').value = '';
    document.getElementById('mx-content-card').style.display = 'none';
    document.getElementById('preview-mx').innerHTML = '<div class="ax-empty-state">เลือกยาแล้วกด "สร้าง Preview"</div>';
    const thRadio = document.querySelector('input[name="mx-lang"][value="th"]');
    if (thRadio) thRadio.checked = true;
  }
  toast('ล้างฟอร์มแล้ว');
}

/* ──────────────────────────────────────────────────────────────
   INIT
────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => showPage(item.dataset.page));
  });

  // Clear form button
  document.getElementById('btn-clear-form').addEventListener('click', clearCurrentForm);

  // Try to load live data from server; silently fall back to embedded constants
  try {
    const [premix, mixing] = await Promise.all([
      _fetchRx('/api/premix-drugs'),
      _fetchRx('/api/mixing-protocols'),
    ]);
    if (Array.isArray(premix) && premix.length) PREMIX_DB = premix;
    if (Array.isArray(mixing) && mixing.length) MIXING_DB = mixing;
  } catch (_) { /* server unavailable — embedded fallback data used */ }

  // Init pages (use whatever PREMIX_DB / MIXING_DB resolved to)
  initPremix();
  initMixing();

  // Default page
  showPage('premix');
});
