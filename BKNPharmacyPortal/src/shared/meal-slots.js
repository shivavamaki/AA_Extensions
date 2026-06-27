"use strict";

/**
 * shared/meal-slots.js
 * Daily Pill Journey Card engine — groups a patient's home/discharge meds into
 * meal slots (before/after × breakfast/lunch/dinner, then bedtime and PRN) by
 * parsing each med's instruction text. Language-agnostic: handles Thai
 * (เช้า/กลางวัน/เย็น, ก่อน/หลัง) and English (breakfast/lunch/dinner,
 * before/after/ac/pc) alike, so it works whether the instruction is the raw
 * English order line (med-journey) or the offline-translated Thai line
 * (home-med).
 *
 * Exposed globally as window.BKNMealSlots (no bundler). Used by both the
 * Medication Journey page and the Home Medication Sheet, so the bucketing rules
 * and the card markup stay identical across the two reports.
 *
 * Public API:
 *   BKNMealSlots.MEAL_SLOTS          → slot metadata (key, cls, ico, th, en, test)
 *   BKNMealSlots.doseSnippet(text)   → short dose phrase ("1 เม็ด", "1 Tablet")
 *   BKNMealSlots.bucket(items)       → { buckets:{key:[item]}, unslotted:[item] }
 *   BKNMealSlots.gridHTML(items,esc) → card-grid HTML for the .mc-grid container
 *
 *   `items` are plain objects: { drug, text, dose? }. `text` is the instruction
 *   used for slot matching; `drug` (and optional `dose`) is what gets displayed.
 *   `esc` is an HTML-escape function (pass CoreDom.escapeHtml).
 */
(function (g) {
  if (g.BKNMealSlots) return;

  // A med can take a meal "before" or "after". Instructions list several meals
  // under one qualifier — Thai "หลังอาหาร เช้า เย็น" or English "Before Breakfast
  // and Dinner" = the qualifier applies to every meal in the run. _mealQualifier
  // finds, for ONE meal word, the nearest preceding before/after qualifier
  // (Thai ก่อน/หลัง or English before/after), carrying it across a meal list.
  // Returns "before" | "after" | "" (unqualified). Works in both languages.
  const MEAL_RE = "เช้า|กลางวัน|เที่ยง|เย็น|breakfast|lunch|noon|midday|dinner|supper|evening|morning";
  const QUAL_RE = "ก่อน|หลัง|before|after|\\bac\\b|\\bpc\\b";

  function qualOf(tok) {
    const t = tok.toLowerCase();
    if (t === "ก่อน" || t === "before" || t === "ac") return "before";
    if (t === "หลัง" || t === "after" || t === "pc") return "after";
    return "";
  }
  function mealQualifier(txt, mealWord) {
    const re = new RegExp(`(${QUAL_RE})|(${MEAL_RE})`, "gi");
    let m, qual = "";
    while ((m = re.exec(txt)) !== null) {
      if (m[1]) { qual = qualOf(m[1]); continue; }   // before/after — carry it
      if (m[2] && new RegExp(mealWord, "i").test(m[2])) return qual;  // this meal
      // other meal word in the same run: keep the carried qualifier and continue.
    }
    return "";
  }
  // True if the instruction mentions this meal at all (Thai or English).
  const hasMeal = (t, re) => new RegExp(re, "i").test(t);

  // Meal slots in day order: before/after × breakfast/lunch/dinner, then bedtime
  // and PRN. A drug lands in every slot it matches (BID = two slots). Unqualified
  // meal words default to "after" — the common convention for meds taken w/ food.
  function mealSlotTest(mealRe, mealWord, wantBefore) {
    return (t) => {
      if (!hasMeal(t, mealRe)) return false;
      const q = mealQualifier(t, mealWord);
      return wantBefore ? q === "before" : q !== "before";  // unqualified → after
    };
  }
  const MEAL_SLOTS = [
    { key: "bbf", cls: "t-bbf", ico: "🌅", th: "ก่อนอาหารเช้า",  en: "Before breakfast",
      test: mealSlotTest("เช้า|breakfast|morning", "เช้า|breakfast|morning", true) },
    { key: "abf", cls: "t-abf", ico: "☀️", th: "หลังอาหารเช้า",   en: "After breakfast",
      test: mealSlotTest("เช้า|breakfast|morning", "เช้า|breakfast|morning", false) },
    { key: "blu", cls: "t-blu", ico: "🌤️", th: "ก่อนอาหารกลางวัน", en: "Before lunch",
      test: mealSlotTest("กลางวัน|เที่ยง|lunch|noon|midday", "กลางวัน|เที่ยง|lunch|noon|midday", true) },
    { key: "alu", cls: "t-alu", ico: "🌞", th: "หลังอาหารกลางวัน",  en: "After lunch",
      test: mealSlotTest("กลางวัน|เที่ยง|lunch|noon|midday", "กลางวัน|เที่ยง|lunch|noon|midday", false) },
    { key: "bdn", cls: "t-bdn", ico: "🌆", th: "ก่อนอาหารเย็น",  en: "Before dinner",
      test: mealSlotTest("เย็น|dinner|supper|evening", "เย็น|dinner|supper|evening", true) },
    { key: "adn", cls: "t-adn", ico: "🌙", th: "หลังอาหารเย็น",   en: "After dinner",
      test: mealSlotTest("เย็น|dinner|supper|evening", "เย็น|dinner|supper|evening", false) },
    { key: "bed", cls: "t-bed", ico: "🛏️", th: "ก่อนนอน",        en: "Bedtime",
      test: (t) => /ก่อนนอน|ก่อนเข้านอน|bedtime|bed\s*time|\bhs\b|at\s+night/i.test(t) },
    { key: "prn", cls: "t-prn", ico: "⭐", th: "เมื่อมีอาการ",     en: "When needed (PRN)",
      test: (t) => /เมื่อมีอาการ|เวลามีอาการ|เมื่อปวด|เมื่อจำเป็น|\bprn\b|if\s+needed|as\s+needed|when\s+required/i.test(t) },
  ];

  /** Pull a short dose phrase ("1 เม็ด", "1 Tablet", "1 PUFF") from the
   * instruction for the compact meal-card line. Falls back to "" (drug name
   * carries it). */
  function doseSnippet(txt) {
    const t = String(txt || "").trim();
    const m = t.match(/(\d+(?:[.,]\d+)?(?:\/\d+)?)\s*(เม็ด|แคปซูล|ซอง|มล\.?|ml|puff|spray\(?s?\)?|หยด|drops?|ช้อน|tablets?|capsules?|tab|cap|amp|vial|มก\.?|mg|มิลลิกรัม)/i);
    return m ? m[0] : "";
  }

  /** Bucket meds into every slot they match. A med whose schedule can't be
   * classified lands in `unslotted`. Items pass through unchanged (with `prn`
   * flagged for the slot where it matched PRN). */
  function bucket(items) {
    const buckets = Object.fromEntries(MEAL_SLOTS.map((s) => [s.key, []]));
    const unslotted = [];
    (items || []).forEach((it) => {
      const text = String(it.text || "");
      let matched = false;
      MEAL_SLOTS.forEach((s) => {
        if (s.test(text)) { buckets[s.key].push(Object.assign({ prn: s.key === "prn" }, it)); matched = true; }
      });
      // A once-daily order with NO explicit meal word defaults to the morning
      // (after-breakfast) slot — the convention for once-daily home meds. Orders
      // that DO name a meal ("Once Daily After Dinner") already matched above.
      if (!matched && /once\s*daily|วันละ\s*1\s*ครั้ง|วันละครั้ง/i.test(text)) {
        buckets["abf"].push(Object.assign({ prn: false }, it)); matched = true;
      }
      if (!matched) unslotted.push(it);
    });
    return { buckets, unslotted };
  }

  /** Build the card-grid HTML (only slots that hold a med, plus an "อื่นๆ /
   * ตามแพทย์สั่ง" card for anything unclassified). Empty slots are dropped so
   * the card stays compact and packs via the .mc-grid masonry columns. */
  function gridHTML(items, esc) {
    esc = esc || ((s) => String(s == null ? "" : s));
    const { buckets, unslotted } = bucket(items);
    const itemHtml = (it) => {
      const dose = it.dose ? ` <span class="mc-dose">${esc(it.dose)}</span>` : "";
      return `<div class="mc-item"><span class="mc-drug">${esc(it.drug)}</span>${dose}</div>`;
    };
    let html = MEAL_SLOTS.filter((s) => buckets[s.key].length).map((s) => {
      const body = buckets[s.key].map(itemHtml).join("");
      return `<div class="mc-slot ${s.cls}">
        <div class="mc-slot-head"><span class="mc-ico">${s.ico}</span><span>${s.th}</span><span class="mc-en">${s.en}</span></div>
        <div class="mc-list">${body}</div>
      </div>`;
    }).join("");
    if (unslotted.length) {
      html += `<div class="mc-slot t-prn">
        <div class="mc-slot-head"><span class="mc-ico">📋</span><span>อื่นๆ / ตามแพทย์สั่ง</span><span class="mc-en">Other / as directed</span></div>
        <div class="mc-list">${unslotted.map(itemHtml).join("")}</div>
      </div>`;
    }
    return html;
  }

  g.BKNMealSlots = { MEAL_SLOTS, doseSnippet, bucket, gridHTML };
})(typeof window !== "undefined" ? window : globalThis);
