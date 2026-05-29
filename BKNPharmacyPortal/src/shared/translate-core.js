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
        node.nodeValue = translated;
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

    /* ================= FIX MEAL SEQUENCE ================= */

    // ensure commas so Google Translate keeps lunch
    t = t.replace(
    /After Breakfast Lunch and Dinner/gi,
    "after breakfast, lunch, and dinner"
    );

    t = t.replace(
    /After Breakfast Lunch Dinner/gi,
    "after breakfast, lunch, and dinner"
    );

    t = t.replace(
    /Breakfast Lunch Dinner/gi,
    "breakfast, lunch, and dinner"
    );

    // morning evening pattern
    t = t.replace(
    /Morning and Evening/gi,
    "morning and evening"
    );

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

    return out;

  }

  function escapeRegex(str) {

    return str.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

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