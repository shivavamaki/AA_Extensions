"use strict";

/*************************************************
 HMTranslate v6 — CLEAN MEDICAL TRANSLATION ENGINE
 Designed for prescription stickers

 Features
 - Drug name protection
 - Prescription sentence normalizer
 - Medical glossary override
 - Google translate fallback
 - Skip protected nodes
 - Restore original text
*************************************************/

const HMTranslate = (() => {

  let originalTextMap = new Map();
  let glossary = {};
  let lockedColumn = "";

  /* ================= INIT ================= */

  function init(root, opts = {}) {

    glossary = opts.glossary || {};
    lockedColumn = (opts.lockColumnName || "").toLowerCase();

    cacheOriginal(root);

  }

  /* ================= TRANSLATE ================= */

  async function translate(root, lang) {

    if (!root) return;

    // Always re-cache from the CURRENT live DOM.
    // innerHTML = _originalHTML replaces all nodes so old Map references
    // are detached — re-caching here fixes the stale-node problem.
    cacheOriginal(root);

    const nodes = [];
    collectTextNodes(root, nodes);

    console.log("HMTranslate nodes:", nodes.length);

    let done = 0;

    for (let node of nodes) {

      const original = originalTextMap.get(node);
      if (!original) continue;

      let text = normalizePrescription(original);

      if (!text || text.trim().length < 2) continue;
      if (/^\d+$/.test(text)) continue;

      // ── Layer 1: Pattern match (sentence-level, no API call) ──
      const patternResult =
        typeof window.matchMedicalPattern === "function"
          ? window.matchMedicalPattern(text, lang)
          : null;

      if (patternResult) {
        node.nodeValue = patternResult;
        done++;
        console.log(`[pattern] "${text}" → "${patternResult}"`);
        continue;
      }

      // ── Layer 2: Word glossary substitution ───────────────────
      text = applyGlossary(text, lang);

      // If glossary resolved everything (no Latin left), use as-is
      const stillEnglish = /[a-zA-Z]/.test(text);
      if (!stillEnglish) {
        node.nodeValue = text;
        done++;
        continue;
      }

      // ── Layer 3: Google Translate ─────────────────────────────
      const translated = await translateText(text, lang, "en");
      if (translated) {
        node.nodeValue = postProcessTranslation(translated, lang);
        done++;
      }

    }

    console.log(`HMTranslate finished: ${done}/${nodes.length}`);

  }

  /* ================= RESTORE ================= */

  function restore() {

    originalTextMap.forEach((val, node) => {

      if (node) node.nodeValue = val;

    });

  }

  /* ================= CACHE ORIGINAL ================= */

  function cacheOriginal(root) {

    originalTextMap.clear();

    const nodes = [];
    collectTextNodes(root, nodes);

    nodes.forEach(n => originalTextMap.set(n, n.nodeValue));

  }

  /* ================= TEXT NODE COLLECTOR ================= */

  function collectTextNodes(node, list) {

    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {

      const parent = node.parentElement;
      if (!parent) return;

      if (
        parent.closest("[data-no-translate]") ||
        parent.closest("[translate='no']")
      ) return;

      const text = node.nodeValue?.trim();
      if (!text) return;

      list.push(node);
      return;

    }

    if (!node.childNodes) return;

    node.childNodes.forEach(child => collectTextNodes(child, list));

  }

  /* ================= PRESCRIPTION NORMALIZER ================= */

  function normalizePrescription(text){

    if(!text) return text;

    let t = text;

    /* ================= REMOVE DURATION ================= */

    // remove "For XX Days"
    t = t.replace(/\bFor\s+\d+\s+(Days?|Day).*/i,"");

    /* ================= STRIP HIS NOISE ================= */

    // Strip drug-name markdown markers and trailing route slashes that the
    // HIS sometimes adds: "Zyrtec **10 Mg** Tablet//" → "Zyrtec 10 Mg Tablet"
    t = t.replace(/\*\*/g, "").replace(/\/\/+/g, " ");

    // Strip the HIS sub-tag "(S)" / "(s)" — a Spray-form marker that adds no
    // patient-facing information and only confuses MASTER_RE.
    t = t.replace(/\s*\(S\)\s*/gi, " ");

    // Strip route parentheticals: "(Mouth/Throat)" / "(Nasal)" / "(ปาก / คอ)" /
    // "(ทางจมูก)". These are reference annotations for the pharmacist; the verb
    // (spray / instill / etc.) already conveys the route to the patient.
    t = t.replace(/\s*\((?:[A-Za-z฀-๿຀-໿\s\/]+)\)\s*/g, " ");

    // Strip trailing dispense count: "... ×1" / "... x 1". The dispensed
    // quantity is already on its own sticker line.
    t = t.replace(/\s*[×xX]\s*\d+\s*$/g, "");
    // Strip a bare trailing "1"/"2"/"3" that follows a meal/time word — this
    // is the HIS dose-count, not a real frequency. Keep digits that follow
    // "times"/"hours"/"days" or precede them.
    t = t.replace(/\b(breakfast|lunch|dinner|bedtime|noon|morning|evening|night|meal|needed)\s+[1-9]\s*$/i, "$1");

    /* ================= NORMALIZE MEDICAL PATTERNS ================= */

    // fix plural markers
    t = t.replace(/SPRAY(S)/gi,"sprays");
    t = t.replace(/TABLET(S)/gi,"tablets");
    t = t.replace(/CAPSULE(S)/gi,"capsules");

    // fix "2 Time" → "2 times"
    t = t.replace(/(\d+)\s*Time\b/gi,"$1 times");

    // fix "3 Times Daily"
    t = t.replace(/(\d+)\s*Times?\s*Daily/gi,"$1 times daily");

    /* ================= DOSAGE NORMALIZATION ================= */

    // fractions → words
    t = t.replace(/\b0.25\s*(tab|tabs|tablet|tablets)\b/gi,"quarter tablet");
    t = t.replace(/\b0.5\s*(tab|tabs|tablet|tablets)\b/gi,"half tablet");
    t = t.replace(/\b0.75\s*(tab|tabs|tablet|tablets)\b/gi,"three-quarter tablet");

    // common unicode fractions
    t = t.replace(/\b¼\s*(tab|tabs|tablet|tablets)\b/gi,"quarter tablet");
    t = t.replace(/\b½\s*(tab|tabs|tablet|tablets)\b/gi,"half tablet");
    t = t.replace(/\b¾\s*(tab|tabs|tablet|tablets)\b/gi,"three-quarter tablet");

    // normalize tab → tablet
    t = t.replace(/\btab(s)?\b/gi,"tablet");

    /* ================= FIX MEAL SEQUENCE =================
     * Normalise meal-time sequences into the canonical space-delimited form
     * MASTER_RE / COMPOUND_TIMING expect. Strip commas and the Oxford "and".
     * Examples (input → normalised):
     *   "Morning, Noon, and Evening"   → "morning noon evening"
     *   "After Breakfast, Lunch, and Dinner" → "after breakfast lunch dinner"
     *   "Morning and Evening"          → "morning evening"
     * The downstream COMPOUND_TIMING lookup handles every permutation.
     */
    const MEAL_TOKENS_RE =
      /\b(morning|noon|evening|night|bedtime|breakfast|lunch|dinner|meal)\b(?:\s*,\s*\b(morning|noon|evening|night|bedtime|breakfast|lunch|dinner|meal)\b)+/gi;
    t = t.replace(MEAL_TOKENS_RE, m => m.replace(/\s*,\s*/g, " "));
    // Strip Oxford-comma "and" between meal-time tokens
    t = t.replace(
      /\b(morning|noon|evening|night|bedtime|breakfast|lunch|dinner|meal)\s+and\s+(morning|noon|evening|night|bedtime|breakfast|lunch|dinner|meal)\b/gi,
      "$1 $2"
    );
    // Collapse residual "morning  noon" double spaces (set by the strips above)
    t = t.replace(/\s{2,}/g, " ");

    /* ================= CLEAN SPACES ================= */

    t = t.replace(/\s+/g," ").trim();

    return t;

  }


  /* ================= GLOSSARY ================= */

  function applyGlossary(text, lang) {

    const g = glossary[lang];
    if (!g) return text;

    let out = text;

    Object.keys(g)
      .sort((a,b)=>b.length-a.length)
      .forEach(k=>{

        const pattern =
          new RegExp(`\\b${escapeRegex(k)}(s)?\\b`,"gi");

        out = out.replace(pattern,g[k]);

      });

    // Collapse double-spaces left by empty replacements (e.g. "Orally"→"")
    // and trim trailing whitespace.
    out = out.replace(/\s{2,}/g, " ").trim();

    return out;

  }

  function escapeRegex(str) {

    return str.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

  }

  /* ================= POST-GOOGLE CLEANUP =================
   * Google Translate emits known-bad tokens for some pharmacy terms.
   * This safety net normalises them to BKN-approved Lao/Thai wording,
   * so even when Layers 1+2 miss, the patient never sees garbled output.
   *
   * Bad tokens corrected:
   *   Lao "ແອັນຊູນ" (bogus capsule) → "ແຄັບຊູນ"
   *   Lao "ທາງປາກ" (literal "via mouth") → removed
   *   Thai "ทางปาก" → removed
   *   Other unsafe transliterations as discovered.
   */
  const POST_CLEANUP = {
    lo: [
      // Bogus "capsule" transliterations seen from Google
      [/ແອັນຊູນ/g, "ແຄັບຊູນ"],
      [/ແອັດຊູນ/g, "ແຄັບຊູນ"],
      [/ແອນຊູນ/g,  "ແຄັບຊູນ"],
      // Drop the literal "via mouth" — verb already implies it
      [/\s*ທາງປາກ\s*/g, " "],
      // Bogus "tablet" transliteration
      [/ແທັບເລັດ/g, "ເມັດ"],
      // Bogus "spray" transliterations
      [/ສະເປຣ/g, "ພົ່ນ"],
      // Tidy spaces
      [/\s{2,}/g, " "],
    ],
    th: [
      [/\s*ทางปาก\s*/g, " "],
      [/แท็บเล็ต/g, "เม็ด"],
      [/แคปซูล/g, "แคปซูล"], // already correct, no-op kept for symmetry
      [/\s{2,}/g, " "],
    ],
  };
  function postProcessTranslation(text, lang) {
    const rules = POST_CLEANUP[lang];
    if (!rules || !text) return text;
    let out = text;
    for (const [re, repl] of rules) out = out.replace(re, repl);
    return out.trim();
  }

  /* ================= GOOGLE TRANSLATE ================= */

  async function translateText(text, lang, sl = "auto") {

    try {

      const url =
        "https://translate.googleapis.com/translate_a/single" +
        "?client=gtx" +
        "&sl=" + sl +
        "&tl=" + lang +
        "&dt=t" +
        "&q=" + encodeURIComponent(text);

      const res = await fetch(url);
      const data = await res.json();

      if (!data || !data[0]) return text;

      return data[0].map(t=>t[0]).join("");

    }
    catch(e){

      console.warn("Translate error:",e);
      return text;

    }

  }

  return {

    init,
    translate,
    restore,

  };

})();