/* iv-drug-db.js — the IV reference database, generated from
 * IV_ATB_Master 2026.xlsx ("Stock + IV Off" + "database" sheets).
 *
 * This is the pharmacy's own master list, so it — not a guess — decides:
 *   • whether an order is an IV preparation at all (name is in this table)
 *   • the diluent            (`adult` / `child`, e.g. "NSS 50 mL")
 *   • the stability clock    (`shelfDays`, the sheet's own shelf life)
 *   • high-alert status      (`type: "HAD"` → KCl, 50%MgSO4)
 *   • whether PHARMACY prepares it (`wardPrepares` — see below)
 *
 * ⚠ `wardPrepares: true` marks the 14 drugs the sheet annotates
 * "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" — the ward mixes these itself, so
 * they must NOT appear on the pharmacy worklist. Filtering them out is the
 * difference between a real work queue and a list of things nobody is doing.
 *
 * Dilution volume, from the Form sheet (BZ/CA/CB):  volume mL = dose mg ÷ conc
 * `conc` (mg/mL) is only filled in for the few drugs where the sheet computes
 * it; everything else uses the fixed `adult` diluent string.
 *
 * Regenerate from the workbook rather than hand-editing.
 */
(function (root) {
  'use strict';

  const DRUGS = [
    { name: "Levoflox",                  shelfDays: 2,    type: "ATB",  adult: "undiluted",       child: "undiluted", conc: null,  wardPrepares: false, freq: "q 12 hrs",  note: "exp. 14 day update 27/2/23" },
    { name: "Omegacin",                  shelfDays: 1,    type: "ATB",  adult: "NSS 100 mL",      child: "-",       conc: null,  wardPrepares: true,  freq: "q 12 hrs",  note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "meicelin",                  shelfDays: 1,    type: "ATB",  adult: "NSS 100 mL",      child: "-",       conc: null,  wardPrepares: false, freq: "q 12 hrs",  note: "" },
    { name: "Azithromycin",              shelfDays: 7,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: false, freq: "",          note: "" },
    { name: "Cefoperazone/Sulbactam",    shelfDays: 3,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: false, freq: "",          note: "" },
    { name: "Clindamycin",               shelfDays: 7,    type: "ATB",  adult: "NSS 50 mL",       child: "NSS",     conc: null,  wardPrepares: false, freq: "q 8 hrs",   note: "" },
    { name: "Cefotaxime",                shelfDays: 5,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: false, freq: "",          note: "" },
    { name: "PIP/TAZO",                  shelfDays: 7,    type: "ATB",  adult: "NSS 50 mL",       child: "-",       conc: null,  wardPrepares: false, freq: "q 8 hrs",   note: "exp. 7 day update 27/2/23, siam exp. 7 days" },
    { name: "Rocephin",                  shelfDays: 7,    type: "ATB",  adult: "NSS 50 mL",       child: "SWI",     conc: 100.0, wardPrepares: false, freq: "q 24 hrs",  note: "" },
    { name: "Cef-3",                     shelfDays: 7,    type: "ATB",  adult: "NSS 50 mL",       child: "SWI",     conc: 100.0, wardPrepares: false, freq: "q 24 hrs",  note: "" },
    { name: "Meropenem",                 shelfDays: 2,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: false, freq: "",          note: "" },
    { name: "MERONEM®",                  shelfDays: 2,    type: "ATB",  adult: "NSS 50 mL",       child: "SWI",     conc: null,  wardPrepares: false, freq: "q 8 hrs",   note: "Concentration > 20mg/ml และ Syringe 50 mg/ mL" },
    { name: "Ertapenem (Invanz)",        shelfDays: 1,    type: "ATB",  adult: "NSS 50 mL",       child: "SWI",     conc: null,  wardPrepares: true,  freq: "q 24 hrs",  note: "exp. 1 day update 27/2/23 ไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "Fosfomycin",                shelfDays: 7,    type: "ATB",  adult: "NSS 50 mL",       child: "SWI",     conc: null,  wardPrepares: false, freq: "q 12 hrs",  note: "" },
    { name: "Ceftazidime",               shelfDays: 7,    type: "ATB",  adult: "NSS 50 mL",       child: "SWI",     conc: null,  wardPrepares: false, freq: "q 8 hrs",   note: "" },
    { name: "Unasyn",                    shelfDays: 3,    type: "ATB",  adult: "NSS 50 mL",       child: "SWI",     conc: null,  wardPrepares: false, freq: "q 6 hrs",   note: "Conc. 30 mg/mL เก็บได้ 3 วัน" },
    { name: "Sulbactam",                 shelfDays: 3,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: true,  freq: "",          note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "Sulbactam",                 shelfDays: 2,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: true,  freq: "",          note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "KCl",                       shelfDays: 7,    type: "HAD",  adult: "NSS 50 mL",       child: "SWI",     conc: null,  wardPrepares: false, freq: "q 6 hrs",   note: "" },
    { name: "Cefazolin",                 shelfDays: 7,    type: "ATB",  adult: "NSS 50 mL",       child: "SWI",     conc: 100.0, wardPrepares: false, freq: "q 6 hrs",   note: "" },
    { name: "Vancomycin",                shelfDays: 14,   type: "ATB",  adult: "NSS 250 mL",      child: "SWI",     conc: null,  wardPrepares: false, freq: "q 8 hrs",   note: "" },
    { name: "zithromax",                 shelfDays: 7,    type: "ATB",  adult: "NSS 250 mL",      child: "SWI",     conc: 2.0,   wardPrepares: true,  freq: "q 24 hrs",  note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "Gentamicin",                shelfDays: 7,    type: "ATB",  adult: "NSS 100 mL",      child: "SWI",     conc: null,  wardPrepares: false, freq: "q 24 hrs",  note: "" },
    { name: "Cloxacillin",               shelfDays: 1,    type: "ATB",  adult: "NSS 100 mL",      child: "SWI",     conc: null,  wardPrepares: true,  freq: "q 6 hrs",   note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "Sulcef",                    shelfDays: 3,    type: "ATB",  adult: "NSS 100 mL",      child: "SWI",     conc: null,  wardPrepares: false, freq: "q 12 hrs",  note: "" },
    { name: "Sulperazone",               shelfDays: 5,    type: "ATB",  adult: "NSS 100 mL",      child: "SWI",     conc: null,  wardPrepares: false, freq: "q 12 hrs",  note: "" },
    { name: "Meicelin",                  shelfDays: 1,    type: "ATB",  adult: "NSS 100 mL",      child: "SWI",     conc: null,  wardPrepares: true,  freq: "q 12 hrs",  note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "Liposome Amphotericin B",   shelfDays: 1,    type: "ATB",  adult: "D-5-W",           child: "",        conc: null,  wardPrepares: false, freq: "q 24 hrs",  note: "" },
    { name: "Amikacin",                  shelfDays: 5,    type: "ATB",  adult: "conc. 20 mg/mL",  child: "SWI",     conc: null,  wardPrepares: false, freq: "q 24 hrs",  note: "" },
    { name: "ciproflox",                 shelfDays: 2,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: false, freq: "",          note: "" },
    { name: "Colistin",                  shelfDays: 7,    type: "ATB",  adult: "-",               child: "SWI",     conc: null,  wardPrepares: true,  freq: "q 12 hrs",  note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "Cefuroxime",                shelfDays: 7,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: false, freq: "",          note: "" },
    { name: "Amphotericin B",            shelfDays: 1,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: true,  freq: "q 24 hrs",  note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "Tygacil",                   shelfDays: 2,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: true,  freq: "q 12 hrs",  note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "Cymevene",                  shelfDays: 1,    type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: true,  freq: "q 12 hrs",  note: "as package insert ไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "amoxiclav",                 shelfDays: null, type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: true,  freq: "q 8 hrs",   note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "cravit",                    shelfDays: null, type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: true,  freq: "q 24 hrs",  note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "ciproflox",                 shelfDays: null, type: "ATB",  adult: "",                child: "",        conc: null,  wardPrepares: true,  freq: "q 12 hrs",  note: "ปกติไม่ได้เตรียมเด้อออออ วอร์ดเตรียมเองจ้า" },
    { name: "50%MgSO4",                  shelfDays: 30,   type: "HAD",  adult: "",                child: "",        conc: null,  wardPrepares: false, freq: "",          note: "" },
  ];

  /* The sheet lists some drugs twice — a bare generic row with no dilution and
   * a brand row that carries it (Meropenem / MERONEM®). Alias the thin one onto
   * the row that actually has the data, or a "Meropenem 1 g" order resolves to
   * the empty entry and the sticker prints no diluent. */
  const ALIAS = {
    'meropenem': 'meronem®',
    'piperacillin/tazobactam': 'pip/tazo',
    'tazocin': 'pip/tazo',
    'ceftriaxone': 'rocephin',
    'ampicillin/sulbactam': 'unasyn',
  };

  const _idx = new Map();
  DRUGS.forEach(d => _idx.set(d.name.trim().toLowerCase(), d));
  // Resolve aliases only where the target really is the richer row.
  Object.keys(ALIAS).forEach(k => {
    const target = _idx.get(ALIAS[k]);
    const own = _idx.get(k);
    if (target && (!own || (!own.adult && target.adult))) _idx.set(k, target);
  });

  /** Loose lookup: ArcusAir names carry strengths/brands the sheet omits. */
  function find(name) {
    if (!name) return null;
    const k = String(name).trim().toLowerCase();
    if (_idx.has(k)) return _idx.get(k);
    // longest matching entry wins, so "Meropenem 1 g" prefers "Meropenem"
    let best = null;
    _idx.forEach((d, key) => {
      if ((k.indexOf(key) !== -1 || key.indexOf(k) !== -1) &&
          (!best || key.length > best.name.trim().length)) best = d;
    });
    return best;
  }

  /** Is this an IV preparation the PHARMACY makes? */
  function isPharmacyIV(name) {
    const d = find(name);
    return !!d && !d.wardPrepares;
  }

  /** Diluent string for the sticker: the sheet's own adult/child column. */
  function diluent(name, isChild) {
    const d = find(name);
    if (!d) return '';
    const v = isChild ? (d.child || d.adult) : d.adult;
    return (v && v !== '-' ) ? v : (d.adult || '');
  }

  /** Form sheet BZ/CA/CB — volume mL = dose mg / conc (mg/mL). */
  function dilutionVolume(name, doseMg) {
    const d = find(name);
    if (!d || !(doseMg > 0)) return null;
    // Some rows carry the concentration only inside the diluent text
    // ("conc. 20 mg/mL") rather than the numeric column.
    let conc = d.conc;
    if (!conc) {
      const m = /([\d.]+)\s*mg\s*\/\s*m[lL]/.exec(d.adult || '');
      if (m) conc = parseFloat(m[1]);
    }
    if (!conc) return null;
    return Math.round((doseMg / conc) * 10) / 10;
  }

  /** Stability window in hours, from the sheet's shelf life in DAYS. */
  function stabilityHours(name) {
    const d = find(name);
    return d && d.shelfDays ? d.shelfDays * 24 : 24;
  }

  function isHad(name) {
    const d = find(name);
    return !!d && d.type === 'HAD';
  }

  root.IVDrugDB = { DRUGS, find, isPharmacyIV, diluent, dilutionVolume, stabilityHours, isHad };
})(typeof window !== 'undefined' ? window : globalThis);
