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

  async function translate(root, lang, opts = {}) {

    // The engine is fully OFFLINE — patterns + word glossary + curated phrase
    // overrides only, no external translation API (org-network policy). `opts`
    // is kept for API compatibility (e.g. a legacy offlineOnly flag) but every
    // path is offline now.
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

      // ── Quantity cells (marked data-qty) → bare "N unit" without a label ──
      // The Home Med Sheet already has a "จำนวน" column header, so the labelled
      // form ("จำนวน 7 เม็ด") would be redundant. Offline; no API call.
      const inQtyCell = node.parentElement && node.parentElement.closest("[data-qty]");
      if (inQtyCell && typeof window.matchQtyNoLabel === "function") {
        const qtyResult = window.matchQtyNoLabel(text, lang);
        if (qtyResult) { node.nodeValue = qtyResult; done++; continue; }
      }

      // ── Curated substring replacements (offline, pharmacist-editable) ──
      // Apply PATTERN_OVERRIDES entries flagged mode:"replace" as find→replace
      // anywhere in the text BEFORE pattern/glossary, so a curated Thai fragment
      // both shows up and feeds the downstream matchers. No external API.
      if (typeof window.applyTextReplacements === "function") {
        text = window.applyTextReplacements(text, lang);
      }

      // ── Layer 1: Pattern match (sentence-level, no API call) ──
      // An instruction cell may carry data-freq-th (authoritative Thai frequency
      // from the BKN frequency master) — pass it so it overrides the engine's
      // own frequency translation for the th locale.
      const freqHost = node.parentElement && node.parentElement.closest("[data-freq-th]");
      const freqTh = (lang === "th" && freqHost) ? freqHost.getAttribute("data-freq-th") : "";
      const patternResult =
        typeof window.matchMedicalPattern === "function"
          ? window.matchMedicalPattern(text, lang, freqTh ? { freqOverride: freqTh } : undefined)
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

      // Fully offline by design — no external translation API is ever called
      // (org-network policy). Keep the best offline result (glossary-substituted
      // text). Anything still English is a gap to be filled by curating a phrase
      // in the Pattern / Text-Replacement editor, not by an online call.
      if (text !== original) { node.nodeValue = text; done++; }
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

  return {

    init,
    translate,
    restore,

  };

})();