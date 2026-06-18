"use strict";

/*
 * medical-glossary.js
 *
 * Two-layer translation:
 *
 * Layer 1 — PATTERNS (sentence-level regex)
 *   matchPattern(text, lang) tries each pattern in order.
 *   If matched, returns the fully-translated sentence immediately.
 *   No Google API call needed.
 *
 * Layer 2 — TERMS (word-level glossary)
 *   applyGlossary() in translate-core.js uses MEDICAL_GLOSSARY
 *   for word substitutions on text that didn't match any pattern.
 *
 * Pattern syntax:
 *   Each entry: { re: RegExp, fn: (match, lang) => string }
 *   Capture groups in `re` are passed to `fn` as m[1], m[2], ...
 *
 * Variables used in templates:
 *   {N}   = number of units (tablets, capsules, drops, sprays)
 *   {U}   = unit name (already translated)
 *   {F}   = frequency (once/twice/3x etc., already translated)
 *   {T}   = timing (before/after breakfast etc., already translated)
 *   {D}   = number of days
 */

/* ── Shared number/unit helpers ─────────────────────────────── */

// Translate digit quantity to word in target lang (optional, used by some langs)
function _qty(n, lang) {
  const MAP = {
    th:    ["", "หนึ่ง","สอง","สาม","สี่","ห้า","หก","เจ็ด","แปด","เก้า","สิบ"],
    lo:    ["", "ໜຶ່ງ","ສອງ","ສາມ","ສີ່","ຫ້າ","ຫົກ","ເຈັດ","ແປດ","ເກົ້າ","ສິບ"],
    my:    ["", "တစ်","နှစ်","သုံး","လေး","ငါး","ခြောက်","ခုနစ်","ရှစ်","ကိုး","တစ်ဆယ်"],
    km:    ["", "មួយ","ពីរ","បី","បួន","ប្រាំ","ប្រាំមួយ","ប្រាំពីរ","ប្រាំបី","ប្រាំបួន","ដប់"],
    "zh-CN":["","一","二","三","四","五","六","七","八","九","十"],
    "zh-TW":["","一","二","三","四","五","六","七","八","九","十"],
    ja:    ["","1","2","3","4","5","6","7","8","9","10"],
    ko:    ["","1","2","3","4","5","6","7","8","9","10"],
    ar:    ["","واحد","اثنان","ثلاثة","أربعة","خمسة","ستة","سبعة","ثمانية","تسعة","عشرة"],
    hi:    ["","एक","दो","तीन","चार","पाँच","छह","सात","आठ","नौ","दस"],
    vi:    ["","một","hai","ba","bốn","năm","sáu","bảy","tám","chín","mười"],
  };
  const words = MAP[lang];
  if (!words) return String(n);
  const i = parseInt(n);
  return (i >= 1 && i <= 10) ? words[i] : String(n);
}

// Unit translation: "tablet"/"capsule"/"drop"/"spray"/"ml"/"bottle"/"vial"/...
function _unit(raw, lang, count) {
  const r = raw.toLowerCase().replace(/s$/, ""); // singularise
  const UNITS = {
    tablet:  { th:"เม็ด", lo:"ເມັດ", my:"ဆေးပြား", km:"គ្រាប់", vi:"viên",   "zh-CN":"片", "zh-TW":"錠",  ja:"錠",    ko:"정",   ar:"قرص",   hi:"गोली",  id:"tablet", ms:"tablet", ru:"таблетку", fr:"comprimé", de:"Tablette", es:"comprimido", pt:"comprimido", tr:"tablet" },
    capsule: { th:"แคปซูล", lo:"ແຄັບຊູນ", my:"တောင့်", km:"កម្រៀប",  vi:"viên nang","zh-CN":"粒", "zh-TW":"粒",  ja:"カプセル",ko:"캡슐", ar:"كبسولة", hi:"कैप्सूल",id:"kapsul",ms:"kapsul", ru:"капсулу",  fr:"gélule",  de:"Kapsel",    es:"cápsula",    pt:"cápsula",   tr:"kapsül" },
    drop:    { th:"หยด",   lo:"ຢອດ",  my:"စက်",   km:"ដំណក់",  vi:"giọt",  "zh-CN":"滴", "zh-TW":"滴",  ja:"滴",    ko:"방울",ar:"قطرة",  hi:"बूँद",  id:"tetes",  ms:"titik",  ru:"каплю",   fr:"goutte",  de:"Tropfen",   es:"gota",       pt:"gota",      tr:"damla" },
    spray:   { th:"ครั้ง", lo:"ເທື່ອ",my:"ဖျန်း",  km:"ដង",     vi:"lần",   "zh-CN":"喷", "zh-TW":"噴",  ja:"回",    ko:"번",  ar:"رشة",   hi:"स्प्रे",id:"semprotan",ms:"semburan",ru:"вдох",  fr:"bouffée", de:"Hub",       es:"pulverización",pt:"pulverização",tr:"puf" },
    ml:       { th:"มล.",  lo:"ມລ",   my:"မီလီ",  km:"មីលីលីត្រ",vi:"ml",  "zh-CN":"毫升","zh-TW":"毫升",ja:"ml",   ko:"ml",  ar:"مل",    hi:"मिली",  id:"ml",     ms:"ml",     ru:"мл",      fr:"ml",      de:"ml",        es:"ml",         pt:"ml",        tr:"ml" },
    bottle:  { th:"ขวด",   lo:"ຂວດ",  my:"ပုလင်း", km:"ដប",     vi:"chai",  "zh-CN":"瓶", "zh-TW":"瓶",  ja:"本",    ko:"병",  ar:"زجاجة", hi:"बोतल",  id:"botol",  ms:"botol",  ru:"флакон",  fr:"flacon",  de:"Flasche",   es:"frasco",     pt:"frasco",    tr:"şişe" },
    vial:    { th:"ขวด",   lo:"ຂວດ",  my:"ပုလင်း", km:"ដប",     vi:"lọ",    "zh-CN":"瓶", "zh-TW":"瓶",  ja:"バイアル",ko:"바이알",ar:"قارورة",hi:"शीशी",  id:"vial",   ms:"vial",   ru:"флакон",  fr:"flacon",  de:"Fläschchen",es:"vial",       pt:"frasco",    tr:"flakon" },
    box:     { th:"กล่อง", lo:"ກ່ອງ", my:"သေတ္တာ", km:"ប្រអប់",  vi:"hộp",   "zh-CN":"盒", "zh-TW":"盒",  ja:"箱",    ko:"상자",ar:"علبة",  hi:"डिब्बा",id:"kotak",  ms:"kotak",  ru:"коробку", fr:"boîte",   de:"Schachtel", es:"caja",       pt:"caixa",     tr:"kutu" },
    ampoule: { th:"แอมพูล",lo:"ຫຼອດ", my:"အင်ပူး", km:"ដបតូច", vi:"ống",   "zh-CN":"安瓿","zh-TW":"安瓿",ja:"アンプル",ko:"앰플",ar:"أمبولة",hi:"एम्पुल",id:"ampul",  ms:"ampul",  ru:"ампулу",  fr:"ampoule", de:"Ampulle",   es:"ampolla",    pt:"ampola",    tr:"ampul" },
    tube:    { th:"หลอด", lo:"ຫຼອດ", my:"ပိုက်",  km:"បំពង់",   vi:"tuýp",  "zh-CN":"管", "zh-TW":"管",  ja:"チューブ",ko:"튜브",ar:"أنبوب", hi:"ट्यूब",id:"tabung", ms:"tiub",   ru:"тюбик",   fr:"tube",    de:"Tube",      es:"tubo",       pt:"tubo",      tr:"tüp" },
    sachet:  { th:"ซอง",  lo:"ຊອງ",  my:"ထုပ်",   km:"កញ្ចប់", vi:"gói",   "zh-CN":"袋", "zh-TW":"包",  ja:"袋",    ko:"포",  ar:"كيس",   hi:"पाउच",  id:"sachet", ms:"sachet", ru:"пакетик",fr:"sachet",  de:"Beutel",    es:"sobre",      pt:"sachê",     tr:"poşet" },
    syringe: { th:"กระบอก",lo:"ກະບອກ",my:"ဆေးထိုးအပ်",km:"ស្រាំ",vi:"ống tiêm","zh-CN":"支","zh-TW":"支", ja:"本",    ko:"개",  ar:"محقنة", hi:"सिरिंज",id:"jarum",  ms:"picagari",ru:"шприц",   fr:"seringue",de:"Spritze",   es:"jeringa",    pt:"seringa",   tr:"şırınga" },
    patch:   { th:"แผ่น", lo:"ແຜ່ນ",  my:"ပြင်",    km:"ប្លែក",  vi:"miếng", "zh-CN":"贴",  "zh-TW":"貼",   ja:"枚",         ko:"장",   ar:"لصقة",  hi:"पैच",   id:"lembar", ms:"keping",  ru:"пластырь", fr:"timbre",  de:"Pflaster",  es:"parche",     pt:"adesivo",   tr:"yama" },
    pack:    { th:"แพ็ค", lo:"ແພັກ", my:"ထုပ်",   km:"កញ្ចប់", vi:"gói",   "zh-CN":"包", "zh-TW":"包",  ja:"パック",ko:"팩",  ar:"عبوة",  hi:"पैक",   id:"paket",  ms:"pek",    ru:"упаковку",fr:"paquet",  de:"Packung",   es:"paquete",    pt:"pacote",    tr:"paket" },
    piece:   { th:"ชิ้น", lo:"ອັນ",  my:"ခု",     km:"គ្រឿង",  vi:"chiếc", "zh-CN":"个", "zh-TW":"個",  ja:"個",    ko:"개",  ar:"قطعة",  hi:"टुकड़ा",id:"buah",   ms:"biji",   ru:"штуку",   fr:"pièce",   de:"Stück",     es:"unidad",     pt:"unidade",   tr:"adet" },
  };
  // Aliases
  const aliases = {
    millilitre:"ml", milliliter:"ml", millitre:"ml", millilitr:"ml", litre:"ml", liter:"ml",
    ampule:"ampoule", amp:"ampoule",
    pcs:"piece", pc:"piece",
    puff:"spray",  // metered-dose inhaler puff
  };
  const rr = aliases[r] || r;
  const map = UNITS[rr];
  if (!map) return raw;
  return map[lang] || raw;
}

// Frequency translation
function _freq(raw, lang) {
  const r = raw.toLowerCase().trim();
  const FREQ = {
    "once daily":        { th:"วันละ 1 ครั้ง",   lo:"ມື້ລະ 1 ເທື່ອ",  my:"တစ်နေ့ တစ်ကြိမ်",   km:"ថ្ងៃ 1 ដង",     vi:"1 lần/ngày",    "zh-CN":"每天一次",  "zh-TW":"每天一次",  ja:"1日1回",   ko:"하루 1회",  ar:"مرة يومياً",     hi:"दिन में एक बार", id:"sekali sehari",  ms:"sekali sehari",  ru:"один раз в день",  fr:"une fois par jour",  de:"einmal täglich",     es:"una vez al día",    tr:"günde bir kez" },
    "twice daily":       { th:"วันละ 2 ครั้ง",   lo:"ມື້ລະ 2 ເທື່ອ",  my:"တစ်နေ့ နှစ်ကြိမ်",  km:"ថ្ងៃ 2 ដង",     vi:"2 lần/ngày",    "zh-CN":"每天两次",  "zh-TW":"每天兩次",  ja:"1日2回",   ko:"하루 2회",  ar:"مرتين يومياً",   hi:"दिन में दो बार",id:"dua kali sehari", ms:"dua kali sehari", ru:"два раза в день",  fr:"deux fois par jour", de:"zweimal täglich",    es:"dos veces al día",  tr:"günde iki kez" },
    "three times daily": { th:"วันละ 3 ครั้ง",   lo:"ມື້ລະ 3 ເທື່ອ",  my:"တစ်နေ့ သုံးကြိမ်",  km:"ថ្ងៃ 3 ដង",     vi:"3 lần/ngày",    "zh-CN":"每天三次",  "zh-TW":"每天三次",  ja:"1日3回",   ko:"하루 3회",  ar:"ثلاث مرات يومياً",hi:"दिन में तीन बार",id:"tiga kali sehari",ms:"tiga kali sehari",ru:"три раза в день",  fr:"trois fois par jour",de:"dreimal täglich",   es:"tres veces al día", tr:"günde üç kez" },
    "four times daily":  { th:"วันละ 4 ครั้ง",   lo:"ມື້ລະ 4 ເທື່ອ",  my:"တစ်နေ့ လေးကြိမ်",   km:"ថ្ងៃ 4 ដង",     vi:"4 lần/ngày",    "zh-CN":"每天四次",  "zh-TW":"每天四次",  ja:"1日4回",   ko:"하루 4회",  ar:"أربع مرات يومياً",hi:"दिन में चार बार",id:"empat kali sehari",ms:"empat kali sehari",ru:"четыре раза в день",fr:"quatre fois par jour",de:"viermal täglich",es:"cuatro veces al día",tr:"günde dört kez" },
    "every 4 hours":     { th:"ทุก 4 ชั่วโมง",  lo:"ທຸກ 4 ຊົ່ວໂມງ",my:"နာရီ 4 ကြိမ်တစ်",  km:"រៀងរាល់ 4 ម៉ោង",vi:"mỗi 4 giờ",     "zh-CN":"每4小时",   "zh-TW":"每4小時",  ja:"4時間毎",  ko:"4시간마다",ar:"كل 4 ساعات",     hi:"हर 4 घंटे",    id:"setiap 4 jam",   ms:"setiap 4 jam",   ru:"каждые 4 часа",    fr:"toutes les 4 heures", de:"alle 4 Stunden",    es:"cada 4 horas",      tr:"her 4 saatte" },
    "every 6 hours":     { th:"ทุก 6 ชั่วโมง",  lo:"ທຸກ 6 ຊົ່ວໂມງ",my:"နာရီ 6 ကြိမ်တစ်",  km:"រៀងរាល់ 6 ម៉ោង",vi:"mỗi 6 giờ",     "zh-CN":"每6小时",   "zh-TW":"每6小時",  ja:"6時間毎",  ko:"6시간마다",ar:"كل 6 ساعات",     hi:"हर 6 घंटे",    id:"setiap 6 jam",   ms:"setiap 6 jam",   ru:"каждые 6 часов",   fr:"toutes les 6 heures", de:"alle 6 Stunden",    es:"cada 6 horas",      tr:"her 6 saatte" },
    "every 8 hours":     { th:"ทุก 8 ชั่วโมง",  lo:"ທຸກ 8 ຊົ່ວໂມງ",my:"နာရီ 8 ကြိမ်တစ်",  km:"រៀងរាល់ 8 ម៉ោង",vi:"mỗi 8 giờ",     "zh-CN":"每8小时",   "zh-TW":"每8小時",  ja:"8時間毎",  ko:"8시간마다",ar:"كل 8 ساعات",     hi:"हर 8 घंटे",    id:"setiap 8 jam",   ms:"setiap 8 jam",   ru:"каждые 8 часов",   fr:"toutes les 8 heures", de:"alle 8 Stunden",    es:"cada 8 horas",      tr:"her 8 saatte" },
    "every 12 hours":    { th:"ทุก 12 ชั่วโมง", lo:"ທຸກ 12 ຊົ່ວໂມງ",my:"နာရီ 12 ကြိမ်တစ်",km:"រៀងរាល់ 12 ម៉ោង",vi:"mỗi 12 giờ",   "zh-CN":"每12小时",  "zh-TW":"每12小時", ja:"12時間毎", ko:"12시간마다",ar:"كل 12 ساعة",   hi:"हर 12 घंटे",   id:"setiap 12 jam",  ms:"setiap 12 jam",  ru:"каждые 12 часов",  fr:"toutes les 12 heures",de:"alle 12 Stunden",  es:"cada 12 horas",     tr:"her 12 saatte" },
    "once a week":       { th:"สัปดาห์ละ 1 ครั้ง",lo:"ອາທິດລະ 1 ເທື່ອ",my:"တစ်ပတ် တစ်ကြိမ်",km:"ម្តងក្នុងមួយសប្តាហ៍",vi:"1 lần/tuần","zh-CN":"每周一次","zh-TW":"每週一次",ja:"週1回",   ko:"주 1회",  ar:"مرة في الأسبوع", hi:"सप्ताह में एक बार",id:"sekali seminggu",ms:"sekali seminggu",ru:"один раз в неделю",fr:"une fois par semaine",de:"einmal wöchentlich",es:"una vez a la semana",tr:"haftada bir kez" },
    "once at bedtime":   { th:"วันละ 1 ครั้ง ก่อนนอน",lo:"ກ່ອນນອນ 1 ເທື່ອ",my:"အိပ်ရာမဝင်မီ တစ်ကြိမ်",km:"មុនពេលគេង 1 ដង",vi:"1 lần trước khi ngủ","zh-CN":"睡前一次","zh-TW":"睡前一次",ja:"就寝前1回",ko:"취침 전 1회",ar:"مرة واحدة عند النوم",hi:"सोने से पहले एक बार",id:"sekali sebelum tidur",ms:"sekali sebelum tidur",ru:"один раз перед сном",fr:"une fois au coucher",de:"einmal zur Schlafenszeit",es:"una vez al acostarse",tr:"yatmadan önce bir kez" },
  };
  // Detect & strip PRN suffix so it can be appended after frequency lookup
  const PRN_SUFFIX = {
    th:"เมื่อมีอาการ",        lo:"ເມື່ອມີອາການ",     my:"လိုအပ်သောအခါ",      km:"ពេលត្រូវការ",
    vi:"khi cần",            "zh-CN":"必要时",        "zh-TW":"必要時",        ja:"必要時",
    ko:"필요 시",            ar:"عند الحاجة",        hi:"जरूरत पड़ने पर",     id:"bila perlu",
    ms:"bila perlu",         ru:"при необходимости", fr:"si nécessaire",       de:"bei Bedarf",
    es:"si es necesario",    pt:"se necessário",     tr:"gerektiğinde",
  };
  const prnRe = /\b(if\s+needed|when\s+needed|as\s+needed|prn|p\.r\.n\.?)\b/i;
  const isPrn = prnRe.test(r);
  const rNoPrn = isPrn ? r.replace(prnRe, "").replace(/\s+/g, " ").trim() : r;

  // Normalise input
  const norm = rNoPrn
    // "N times a day" / "N times daily" / "N times per day" → canonical
    .replace(/\b(\d+)\s*times?\s*(?:a|per)?\s*day\b/i, (_, n) => {
      const i = parseInt(n);
      if (i === 1) return "once daily";
      if (i === 2) return "twice daily";
      if (i === 3) return "three times daily";
      if (i === 4) return "four times daily";
      return `${n} times daily`;
    })
    .replace(/\b(\d+)\s*times?\s*daily\b/i, (_, n) => {
      const i = parseInt(n);
      if (i === 1) return "once daily";
      if (i === 2) return "twice daily";
      if (i === 3) return "three times daily";
      if (i === 4) return "four times daily";
      return `${n} times daily`;
    })
    .replace(/\bonce\s+daily\b/i, "once daily")
    .replace(/\btwice\s+daily\b/i, "twice daily")
    .replace(/\bevery\s+(\d+)\s*hours?\b/i, (_, h) => `every ${h} hours`)
    .replace(/\bonce\s+a\s+week\b/i, "once a week")
    .replace(/\bat\s+bedtime\b/i, "once at bedtime");

  // Standalone PRN (no frequency given) — just return "when needed"
  if (isPrn && !norm) return PRN_SUFFIX[lang] || null;

  const map = FREQ[norm];
  if (!map) return null;
  const base = map[lang] || null;
  if (!base) return null;
  if (!isPrn) return base;
  const suffix = PRN_SUFFIX[lang];
  return suffix ? `${base} ${suffix}` : base;
}

// Timing translation
function _timing(raw, lang) {
  const r = raw.toLowerCase().trim();
  const TIMING = {
    "before breakfast":      { th:"ก่อนอาหารเช้า",    lo:"ກ່ອນອາຫານເຊົ້າ",  my:"မနက်စာမစားမီ",       km:"មុនអាហារពេលព្រឹក",    vi:"trước bữa sáng",   "zh-CN":"早饭前",    "zh-TW":"早飯前",   ja:"朝食前",    ko:"아침 식사 전",  ar:"قبل الإفطار",       hi:"नाश्ते से पहले",  id:"sebelum sarapan", ms:"sebelum sarapan",  ru:"до завтрака",         fr:"avant le petit-déjeuner",de:"vor dem Frühstück",  es:"antes del desayuno",  tr:"kahvaltıdan önce" },
    "after breakfast":       { th:"หลังอาหารเช้า",     lo:"ຫຼັງອາຫານເຊົ້າ",  my:"မနက်စာစားပြီးနောက်",  km:"ក្រោយអាហារពេលព្រឹក",  vi:"sau bữa sáng",    "zh-CN":"早饭后",    "zh-TW":"早飯後",   ja:"朝食後",    ko:"아침 식사 후",  ar:"بعد الإفطار",       hi:"नाश्ते के बाद",  id:"setelah sarapan", ms:"setelah sarapan",  ru:"после завтрака",      fr:"après le petit-déjeuner",de:"nach dem Frühstück", es:"después del desayuno",tr:"kahvaltıdan sonra" },
    "before lunch":          { th:"ก่อนอาหารกลางวัน",  lo:"ກ່ອນອາຫານທ່ຽງ",   my:"နေ့လည်စာမစားမီ",      km:"មុនអាហារថ្ងៃត្រង់",   vi:"trước bữa trưa",  "zh-CN":"午饭前",    "zh-TW":"午飯前",   ja:"昼食前",    ko:"점심 식사 전",  ar:"قبل الغداء",        hi:"दोपहर के खाने से पहले",id:"sebelum makan siang",ms:"sebelum makan tengah hari",ru:"до обеда",    fr:"avant le déjeuner",   de:"vor dem Mittagessen",es:"antes del almuerzo",  tr:"öğle yemeğinden önce" },
    "after lunch":           { th:"หลังอาหารกลางวัน",  lo:"ຫຼັງອາຫານທ່ຽງ",   my:"နေ့လည်စာစားပြီးနောက်",km:"ក្រោយអាហារថ្ងៃត្រង់", vi:"sau bữa trưa",   "zh-CN":"午饭后",    "zh-TW":"午飯後",   ja:"昼食後",    ko:"점심 식사 후",  ar:"بعد الغداء",        hi:"दोपहर के खाने के बाद",id:"setelah makan siang",ms:"setelah makan tengah hari",ru:"после обеда",  fr:"après le déjeuner",   de:"nach dem Mittagessen",es:"después del almuerzo",tr:"öğle yemeğinden sonra" },
    "before dinner":         { th:"ก่อนอาหารเย็น",     lo:"ກ່ອນອາຫານແລງ",    my:"ညနေစာမစားမီ",        km:"មុនអាហារពេលល្ងាច",    vi:"trước bữa tối",   "zh-CN":"晚饭前",    "zh-TW":"晚飯前",   ja:"夕食前",    ko:"저녁 식사 전",  ar:"قبل العشاء",        hi:"रात के खाने से पहले",id:"sebelum makan malam",ms:"sebelum makan malam",ru:"до ужина",          fr:"avant le dîner",       de:"vor dem Abendessen", es:"antes de la cena",    tr:"akşam yemeğinden önce" },
    "after dinner":          { th:"หลังอาหารเย็น",      lo:"ຫຼັງອາຫານແລງ",    my:"ညနေစာစားပြီးနောက်",  km:"ក្រោយអាហារពេលល្ងាច",  vi:"sau bữa tối",    "zh-CN":"晚饭后",    "zh-TW":"晚飯後",   ja:"夕食後",    ko:"저녁 식사 후",  ar:"بعد العشاء",        hi:"रात के खाने के बाद",id:"setelah makan malam",ms:"setelah makan malam",ru:"после ужина",        fr:"après le dîner",       de:"nach dem Abendessen",es:"después de la cena",  tr:"akşam yemeğinden sonra" },
    "before meal":           { th:"ก่อนอาหาร",          lo:"ກ່ອນອາຫານ",       my:"ထမင်းမစားမီ",         km:"មុនពេលញ៉ាំ",          vi:"trước bữa ăn",   "zh-CN":"饭前",      "zh-TW":"飯前",     ja:"食前",      ko:"식사 전",      ar:"قبل الوجبة",        hi:"खाने से पहले",    id:"sebelum makan",   ms:"sebelum makan",    ru:"до еды",              fr:"avant le repas",       de:"vor dem Essen",      es:"antes de comer",      tr:"yemekten önce" },
    "after meal":            { th:"หลังอาหาร",           lo:"ຫຼັງອາຫານ",       my:"ထမင်းစားပြီးနောက်",  km:"ក្រោយពេលញ៉ាំ",        vi:"sau bữa ăn",     "zh-CN":"饭后",      "zh-TW":"飯後",     ja:"食後",      ko:"식사 후",      ar:"بعد الوجبة",        hi:"खाने के बाद",    id:"setelah makan",   ms:"setelah makan",    ru:"после еды",           fr:"après le repas",       de:"nach dem Essen",     es:"después de comer",    tr:"yemekten sonra" },
    "with meal":             { th:"พร้อมอาหาร",          lo:"ພ້ອມກັບອາຫານ",    my:"အစာနှင့်အတူ",         km:"ជាមួយនឹងអាហារ",        vi:"cùng bữa ăn",    "zh-CN":"随餐",      "zh-TW":"隨餐",     ja:"食事と共に",  ko:"식사와 함께",  ar:"مع الوجبة",         hi:"खाने के साथ",    id:"bersama makan",   ms:"bersama makan",    ru:"во время еды",        fr:"avec le repas",        de:"zum Essen",          es:"con la comida",       tr:"yemekle birlikte" },
    "with breakfast":        { th:"พร้อมอาหารเช้า",        lo:"ພ້ອມອາຫານເຊົ້າ",  my:"မနက်စာနှင့်အတူ",      km:"ជាមួយអាហារពេលព្រឹក",   vi:"cùng bữa sáng",   "zh-CN":"随早餐",    "zh-TW":"隨早餐",   ja:"朝食と共に",  ko:"아침 식사와 함께",ar:"مع الإفطار",       hi:"नाश्ते के साथ",   id:"bersama sarapan", ms:"bersama sarapan",  ru:"во время завтрака",   fr:"avec le petit-déjeuner",de:"zum Frühstück",     es:"con el desayuno",    tr:"kahvaltıyla birlikte" },
    "with lunch":            { th:"พร้อมอาหารกลางวัน",     lo:"ພ້ອມອາຫານທ່ຽງ",   my:"နေ့လည်စာနှင့်အတူ",    km:"ជាមួយអាហារថ្ងៃត្រង់",  vi:"cùng bữa trưa",   "zh-CN":"随午餐",    "zh-TW":"隨午餐",   ja:"昼食と共に",  ko:"점심 식사와 함께",ar:"مع الغداء",        hi:"दोपहर के खाने के साथ",id:"bersama makan siang",ms:"bersama makan tengah hari",ru:"во время обеда",fr:"avec le déjeuner",   de:"zum Mittagessen",     es:"con el almuerzo",   tr:"öğle yemeğiyle birlikte" },
    "with dinner":           { th:"พร้อมอาหารเย็น",        lo:"ພ້ອມອາຫານແລງ",    my:"ညနေစာနှင့်အတူ",       km:"ជាមួយអាហារពេលល្ងាច",   vi:"cùng bữa tối",    "zh-CN":"随晚餐",    "zh-TW":"隨晚餐",   ja:"夕食と共に",  ko:"저녁 식사와 함께",ar:"مع العشاء",        hi:"रात के खाने के साथ",id:"bersama makan malam",ms:"bersama makan malam",ru:"во время ужина",    fr:"avec le dîner",      de:"zum Abendessen",     es:"con la cena",       tr:"akşam yemeğiyle birlikte" },
    "before scheduled time": { th:"ก่อนเวลาที่กำหนด",      lo:"ກ່ອນເວລາທີ່ກຳນົດ", my:"သတ်မှတ်ထားသောအချိန်မတိုင်မီ",km:"មុនពេលកំណត់",       vi:"trước giờ quy định","zh-CN":"在预定时间前","zh-TW":"在預定時間前",ja:"指定時刻前",ko:"지정된 시간 전",ar:"قبل الموعد المحدد",hi:"निर्धारित समय से पहले",id:"sebelum waktu yang ditentukan",ms:"sebelum waktu yang ditetapkan",ru:"перед назначенным временем",fr:"avant l'heure prévue",de:"vor der vorgesehenen Zeit",es:"antes de la hora programada",tr:"belirlenen saatten önce" },
    "at scheduled time":     { th:"ตามเวลาที่กำหนด",       lo:"ຕາມເວລາທີ່ກຳນົດ", my:"သတ်မှတ်ထားသောအချိန်တွင်", km:"តាមពេលកំណត់",       vi:"đúng giờ quy định","zh-CN":"按预定时间","zh-TW":"按預定時間",ja:"指定時刻に",ko:"지정된 시간에",ar:"في الموعد المحدد",hi:"निर्धारित समय पर",id:"pada waktu yang ditentukan",ms:"pada waktu yang ditetapkan",ru:"в назначенное время",fr:"à l'heure prévue",de:"zur vorgesehenen Zeit",es:"a la hora programada",tr:"belirlenen saatte" },
    "before bedtime":        { th:"ก่อนนอน",             lo:"ກ່ອນນອນ",         my:"အိပ်ရာမဝင်မီ",        km:"មុនពេលគេង",           vi:"trước khi ngủ",  "zh-CN":"睡前",      "zh-TW":"睡前",     ja:"就寝前",    ko:"취침 전",      ar:"قبل النوم",         hi:"सोने से पहले",    id:"sebelum tidur",   ms:"sebelum tidur",    ru:"перед сном",          fr:"avant le coucher",     de:"vor dem Schlafen",   es:"antes de dormir",     tr:"yatmadan önce" },
    "at bedtime":            { th:"ก่อนนอน",             lo:"ກ່ອນນອນ",         my:"အိပ်ရာမဝင်မီ",        km:"មុនពេលគេង",           vi:"khi đi ngủ",     "zh-CN":"睡前",      "zh-TW":"睡前",     ja:"就寝前",    ko:"취침 시",      ar:"عند النوم",         hi:"सोते समय",        id:"saat tidur",      ms:"ketika tidur",     ru:"перед сном",          fr:"au coucher",           de:"zur Schlafenszeit",  es:"al acostarse",        tr:"yatarken" },
    "in the morning":        { th:"ตอนเช้า",             lo:"ຕອນເຊົ້າ",        my:"နံနက်",               km:"ពេលព្រឹក",             vi:"vào buổi sáng",  "zh-CN":"早上",      "zh-TW":"早上",     ja:"朝",        ko:"아침에",       ar:"في الصباح",         hi:"सुबह में",        id:"di pagi hari",    ms:"pada waktu pagi",  ru:"утром",               fr:"le matin",             de:"morgens",            es:"por la mañana",       tr:"sabahları" },
    "in the evening":        { th:"ตอนเย็น",             lo:"ຕອນແລງ",          my:"ညနေ",                km:"ពេលល្ងាច",             vi:"vào buổi tối",   "zh-CN":"晚上",      "zh-TW":"晚上",     ja:"夕方",      ko:"저녁에",       ar:"في المساء",         hi:"शाम में",         id:"di malam hari",   ms:"pada waktu petang","ru":"вечером",           fr:"le soir",              de:"abends",             es:"por la tarde/noche",  tr:"akşamları" },
    "at night":              { th:"ตอนกลางคืน",          lo:"ຕອນກາງຄືນ",       my:"ညဘက်",               km:"ពេលយប់",               vi:"vào ban đêm",    "zh-CN":"夜间",      "zh-TW":"夜間",     ja:"夜",        ko:"밤에",         ar:"في الليل",          hi:"रात में",         id:"di malam hari",   ms:"pada waktu malam", ru:"ночью",               fr:"la nuit",              de:"nachts",             es:"por la noche",        tr:"geceleri" },
    "when needed":           { th:"เมื่อมีอาการ",         lo:"ເມື່ອຕ້ອງການ",    my:"လိုအပ်သောအခါ",        km:"ពេលត្រូវការ",           vi:"khi cần",        "zh-CN":"必要时",    "zh-TW":"必要時",   ja:"必要時",    ko:"필요 시",      ar:"عند الحاجة",        hi:"जरूरत पड़ने पर",  id:"bila diperlukan", ms:"bila perlu",       ru:"при необходимости",   fr:"si nécessaire",        de:"bei Bedarf",         es:"cuando sea necesario",tr:"gerektiğinde" },
    "at noon":               { th:"ตอนเที่ยง",        lo:"ຕອນທ່ຽງ",         my:"နေ့လည်",              km:"ពេលថ្ងៃត្រង់",          vi:"vào buổi trưa",  "zh-CN":"中午",      "zh-TW":"中午",     ja:"昼",        ko:"점심때",       ar:"ظهراً",             hi:"दोपहर में",       id:"siang hari",     ms:"tengah hari",    ru:"в обед",              fr:"à midi",               de:"mittags",            es:"al mediodía",         tr:"öğle vakti" },
    "at lunchtime":          { th:"ตอนเที่ยง",        lo:"ຕອນທ່ຽງ",         my:"နေ့လည်",              km:"ពេលថ្ងៃត្រង់",          vi:"lúc trưa",       "zh-CN":"午餐时",    "zh-TW":"午餐時",   ja:"昼食時",    ko:"점심때",       ar:"وقت الغداء",        hi:"दोपहर के वक्त",  id:"waktu makan siang",ms:"waktu makan tengah hari",ru:"в обеденное время",fr:"à l'heure du déjeuner",de:"zur Mittagszeit",    es:"a la hora del almuerzo",tr:"öğle yemeği zamanı" },
    "at noon":               { th:"ตอนเที่ยง",        lo:"ຕອນທ່ຽງ",         my:"နေ့လည်",              km:"ពេលថ្ងៃត្រង់",          vi:"vào buổi trưa",  "zh-CN":"中午",      "zh-TW":"中午",     ja:"昼",        ko:"점심때",       ar:"ظهراً",             hi:"दोपहर में",       id:"siang hari",     ms:"tengah hari",    ru:"в обед",              fr:"à midi",               de:"mittags",            es:"al mediodía",         tr:"öğle vakti" },
    "as needed":             { th:"เมื่อมีอาการ",         lo:"ເມື່ອຕ້ອງການ",    my:"လိုအပ်သောအခါ",        km:"ពេលត្រូវការ",           vi:"khi cần",        "zh-CN":"必要时",    "zh-TW":"必要時",   ja:"必要時",    ko:"필요 시",      ar:"حسب الحاجة",        hi:"जैसी जरूरत हो",   id:"sesuai kebutuhan",ms:"mengikut keperluan",ru:"по необходимости",    fr:"au besoin",            de:"nach Bedarf",        es:"según sea necesario", tr:"gerektiği gibi" },
    "before noon":           { th:"ก่อนเที่ยง",          lo:"ກ່ອນທ່ຽງ",        my:"နေ့လည်မတိုင်မီ",     km:"មុនថ្ងៃត្រង់",          vi:"trước trưa",     "zh-CN":"中午前",    "zh-TW":"中午前",   ja:"昼前",      ko:"점심 전",      ar:"قبل الظهر",          hi:"दोपहर से पहले",  id:"sebelum siang",  ms:"sebelum tengah hari",ru:"до полудня",         fr:"avant midi",            de:"vor Mittag",         es:"antes del mediodía",  tr:"öğleden önce" },
    "after noon":            { th:"หลังเที่ยง",          lo:"ຫຼັງທ່ຽງ",        my:"နေ့လည်ပြီးနောက်",     km:"ក្រោយថ្ងៃត្រង់",        vi:"sau trưa",       "zh-CN":"中午后",    "zh-TW":"中午後",   ja:"昼後",      ko:"점심 후",      ar:"بعد الظهر",          hi:"दोपहर के बाद",   id:"setelah siang",  ms:"selepas tengah hari",ru:"после полудня",      fr:"après midi",            de:"nach Mittag",        es:"después del mediodía",tr:"öğleden sonra" },
    // Single-word timing tokens used by some HIS frequency names (e.g. "Once Daily Morning")
    "morning":               { th:"เช้า",               lo:"ເຊົ້າ",           my:"နံနက်",               km:"ព្រឹក",                vi:"sáng",           "zh-CN":"早上",      "zh-TW":"早上",     ja:"朝",        ko:"아침",         ar:"صباح",               hi:"सुबह",            id:"pagi",            ms:"pagi",             ru:"утром",               fr:"matin",                de:"morgens",            es:"mañana",              tr:"sabah" },
    "evening":               { th:"เย็น",               lo:"ແລງ",             my:"ညနေ",                km:"ល្ងាច",                vi:"chiều",          "zh-CN":"晚上",      "zh-TW":"晚上",     ja:"夕方",      ko:"저녁",         ar:"مساء",               hi:"शाम",             id:"sore",            ms:"petang",           ru:"вечером",             fr:"soir",                 de:"abends",             es:"tarde",               tr:"akşam" },
    "noon":                  { th:"เที่ยง",             lo:"ທ່ຽງ",            my:"နေ့လည်",              km:"ថ្ងៃត្រង់",             vi:"trưa",           "zh-CN":"中午",      "zh-TW":"中午",     ja:"昼",        ko:"점심",         ar:"ظهراً",              hi:"दोपहर",           id:"siang",           ms:"tengah hari",      ru:"в обед",              fr:"midi",                 de:"mittags",            es:"mediodía",            tr:"öğle" },
    "lunch":                 { th:"กลางวัน",            lo:"ທ່ຽງ",            my:"နေ့လည်",              km:"ថ្ងៃត្រង់",             vi:"trưa",           "zh-CN":"中午",      "zh-TW":"中午",     ja:"昼",        ko:"점심",         ar:"الغداء",             hi:"दोपहर",           id:"siang",           ms:"tengah hari",      ru:"в обед",              fr:"déjeuner",             de:"mittags",            es:"mediodía",            tr:"öğle" },
    "bedtime":               { th:"ก่อนนอน",            lo:"ກ່ອນນອນ",         my:"အိပ်ရာမဝင်မီ",        km:"មុនពេលគេង",            vi:"trước khi ngủ",  "zh-CN":"睡前",      "zh-TW":"睡前",     ja:"就寝前",    ko:"취침 전",      ar:"قبل النوم",          hi:"सोने से पहले",    id:"sebelum tidur",   ms:"sebelum tidur",    ru:"перед сном",          fr:"coucher",              de:"vor dem Schlafen",   es:"acostarse",           tr:"yatmadan önce" },
  };
  const map = TIMING[r];
  if (!map) return null;
  return map[lang] || null;
}

// "For N days" translation
function _days(n, lang) {
  const DAYS = {
    th:`เป็นเวลา ${n} วัน`, lo:`ເປັນເວລາ ${n} ວັນ`, my:`နေ့ ${n} ကြာ`,
    km:`រយៈពេល ${n} ថ្ងៃ`, vi:`trong ${n} ngày`,
    "zh-CN":`共${n}天`, "zh-TW":`共${n}天`, ja:`${n}日間`, ko:`${n}일 동안`,
    ar:`لمدة ${n} أيام`, hi:`${n} दिनों के लिए`,
    id:`selama ${n} hari`, ms:`selama ${n} hari`,
    ru:`в течение ${n} дней`,
    fr:`pendant ${n} jours`, de:`für ${n} Tage`, es:`por ${n} días`,
    pt:`por ${n} dias`, tr:`${n} gün boyunca`,
  };
  return DAYS[lang] || `for ${n} days`;
}

// Route: take N unit(s) — verb varies by dose form (oral / drop / spray / inhaler)
// `unit` (tablet|capsule|drop|spray|ml|...) drives the verb so a nasal spray
// doesn't render as "รับประทาน" (eat).
function _take(n, unit, lang) {
  const u = (unit || "").toLowerCase().replace(/s$/, "");
  const isDrop      = u === "drop";
  const isSpray     = u === "spray" || u === "puff";
  const isLiquid    = u === "ml" || /^millilit/.test(u) || u === "litre" || u === "liter";
  const isMouthSpray   = u === "mouth-spray";
  const isMouthPuff    = u === "mouth-puff";
  const isMouthUlcer   = u === "mouth-ulcer";
  const isChewSwallow  = u === "chew-tablet";
  const isPatch        = u === "patch";
  const isNasalSpray   = u === "nasal-spray";
  const isMouthCapsule = u === "mouth-capsule";

  // Oral verb (default — tablet/capsule/ml taken by mouth)
  // Thai & Lao prescriptions don't write "by mouth" — the verb already
  // implies it. The literal "ทางปาก / ທາງປາກ" reads odd to patients.
  const ORAL = {
    th:  (n, u) => `รับประทาน ${n} ${u}`,
    lo:  (n, u) => `ກິນ ${n} ${u}`,
    my:  (n, u) => `${n} ${u} ပါးစပ်မှ သောက်ပါ`,
    km:  (n, u) => `ញ៉ាំ ${n} ${u} តាមមាត់`,
    vi:  (n, u) => `Uống ${n} ${u} qua đường miệng`,
    "zh-CN": (n, u) => `口服 ${n} ${u}`,
    "zh-TW": (n, u) => `口服 ${n} ${u}`,
    ja:  (n, u) => `${n}${u}を経口服用`,
    ko:  (n, u) => `${n}${u} 경구 복용`,
    ar:  (n, u) => `تناول ${n} ${u} عن طريق الفم`,
    hi:  (n, u) => `${n} ${u} मुँह से लें`,
    id:  (n, u) => `Minum ${n} ${u} secara oral`,
    ms:  (n, u) => `Ambil ${n} ${u} secara oral`,
    ru:  (n, u) => `Принять ${n} ${u} перорально`,
    fr:  (n, u) => `Prendre ${n} ${u} par voie orale`,
    de:  (n, u) => `${n} ${u} oral einnehmen`,
    es:  (n, u) => `Tomar ${n} ${u} por vía oral`,
    pt:  (n, u) => `Tomar ${n} ${u} por via oral`,
    tr:  (n, u) => `${n} ${u} ağız yoluyla alın`,
  };

  // Drop verb ("instill")
  const DROP = {
    th:  (n, u) => `หยอด ${n} ${u}`,
    lo:  (n, u) => `ຢອດ ${n} ${u}`,
    my:  (n, u) => `${n} ${u} တို့ပါ`,
    km:  (n, u) => `ដាក់ ${n} ${u}`,
    vi:  (n, u) => `Nhỏ ${n} ${u}`,
    "zh-CN": (n, u) => `滴入 ${n} ${u}`,
    "zh-TW": (n, u) => `滴入 ${n} ${u}`,
    ja:  (n, u) => `${n}${u}を点眼/点鼻`,
    ko:  (n, u) => `${n}${u} 점적`,
    ar:  (n, u) => `قطّر ${n} ${u}`,
    hi:  (n, u) => `${n} ${u} डालें`,
    id:  (n, u) => `Teteskan ${n} ${u}`,
    ms:  (n, u) => `Titiskan ${n} ${u}`,
    ru:  (n, u) => `Закапать ${n} ${u}`,
    fr:  (n, u) => `Instiller ${n} ${u}`,
    de:  (n, u) => `${n} ${u} eintropfen`,
    es:  (n, u) => `Aplicar ${n} ${u}`,
    pt:  (n, u) => `Aplicar ${n} ${u}`,
    tr:  (n, u) => `${n} ${u} damlatın`,
  };

  // Spray verb ("spray/puff")
  const SPRAY = {
    th:  (n, u) => `พ่น ${n} ${u}`,
    lo:  (n, u) => `ພົ່ນ ${n} ${u}`,
    my:  (n, u) => `${n} ${u} ဖျန်းပါ`,
    km:  (n, u) => `បាញ់ ${n} ${u}`,
    vi:  (n, u) => `Xịt ${n} ${u}`,
    "zh-CN": (n, u) => `喷 ${n} ${u}`,
    "zh-TW": (n, u) => `噴 ${n} ${u}`,
    ja:  (n, u) => `${n}${u} 噴霧`,
    ko:  (n, u) => `${n}${u} 분무`,
    ar:  (n, u) => `رشّ ${n} ${u}`,
    hi:  (n, u) => `${n} ${u} स्प्रे करें`,
    id:  (n, u) => `Semprotkan ${n} ${u}`,
    ms:  (n, u) => `Sembur ${n} ${u}`,
    ru:  (n, u) => `Распылить ${n} ${u}`,
    fr:  (n, u) => `Pulvériser ${n} ${u}`,
    de:  (n, u) => `${n} ${u} sprühen`,
    es:  (n, u) => `Pulverizar ${n} ${u}`,
    pt:  (n, u) => `Pulverizar ${n} ${u}`,
    tr:  (n, u) => `${n} ${u} sıkın`,
  };

  // Liquid verb ("measure/take")
  const LIQUID = {
    th:  (n, u) => `รับประทาน ${n} ${u}`,
    lo:  (n, u) => `ກິນ ${n} ${u}`,
    my:  (n, u) => `${n} ${u} သောက်ပါ`,
    km:  (n, u) => `ផឹក ${n} ${u}`,
    vi:  (n, u) => `Uống ${n} ${u}`,
    "zh-CN": (n, u) => `口服 ${n} ${u}`,
    "zh-TW": (n, u) => `口服 ${n} ${u}`,
    ja:  (n, u) => `${n}${u}を服用`,
    ko:  (n, u) => `${n}${u} 복용`,
    ar:  (n, u) => `تناول ${n} ${u}`,
    hi:  (n, u) => `${n} ${u} पिएँ`,
    id:  (n, u) => `Minum ${n} ${u}`,
    ms:  (n, u) => `Minum ${n} ${u}`,
    ru:  (n, u) => `Принять ${n} ${u}`,
    fr:  (n, u) => `Prendre ${n} ${u}`,
    de:  (n, u) => `${n} ${u} einnehmen`,
    es:  (n, u) => `Tomar ${n} ${u}`,
    pt:  (n, u) => `Tomar ${n} ${u}`,
    tr:  (n, u) => `${n} ${u} alın`,
  };

  // Mouth spray: "Spray into the Mouth" → "พ่นปาก / ພົ່ນໃສ່ປາກ / ..."
  const MOUTH_SPRAY = {
    th:      (n, u) => `พ่นปาก ${n} ${u}`,
    lo:      (n, u) => `ພົ່ນໃສ່ປາກ ${n} ${u}`,
    my:      (n, u) => `ပါးစပ်ထဲ ${n} ${u} ဖျန်းပါ`,
    km:      (n, u) => `បាញ់ ${n} ${u} ក្នុងមាត់`,
    vi:      (n, u) => `Xịt ${n} ${u} vào miệng`,
    "zh-CN": (n, u) => `口腔喷 ${n} ${u}`,
    "zh-TW": (n, u) => `口腔噴 ${n} ${u}`,
    ja:      (n, u) => `口腔内へ${n}${u}噴霧`,
    ko:      (n, u) => `구강 내에 ${n}${u} 분무`,
    ar:      (n, u) => `رشّ ${n} ${u} في الفم`,
    hi:      (n, u) => `${n} ${u} मुँह में स्प्रे करें`,
    id:      (n, u) => `Semprotkan ${n} ${u} ke mulut`,
    ms:      (n, u) => `Sembur ${n} ${u} ke dalam mulut`,
    ru:      (n, u) => `${n} ${u} распылить в рот`,
    fr:      (n, u) => `Pulvériser ${n} ${u} dans la bouche`,
    de:      (n, u) => `${n} ${u} in den Mund sprühen`,
    es:      (n, u) => `Pulverizar ${n} ${u} en la boca`,
    pt:      (n, u) => `Pulverizar ${n} ${u} na boca`,
    tr:      (n, u) => `${n} ${u} ağıza sıkın`,
  };

  // Transdermal patch: "Patch on the skin" → "แปะที่ผิวหนัง / ..."
  // Thai/Lao omit the qty — one patch at a time is self-evident; other languages include it.
  const PATCH = {
    th:      (n, u) => `แปะที่ผิวหนัง`,
    lo:      (n, u) => `ຕິດທີ່ຜິວໜັງ`,
    my:      (n, u) => `အရေပြားပေါ် ${n} ${u} ကပ်ပါ`,
    km:      (n, u) => `貼 ${n} ${u} ស្បែក`,
    vi:      (n, u) => `Dán ${n} ${u} lên da`,
    "zh-CN": (n, u) => `贴 ${n} ${u} 于皮肤`,
    "zh-TW": (n, u) => `貼 ${n} ${u} 於皮膚`,
    ja:      (n, u) => `皮膚に${n}${u}貼付`,
    ko:      (n, u) => `피부에 ${n}${u} 부착`,
    ar:      (n, u) => `ضع ${n} ${u} على الجلد`,
    hi:      (n, u) => `${n} ${u} त्वचा पर लगाएँ`,
    id:      (n, u) => `Tempelkan ${n} ${u} pada kulit`,
    ms:      (n, u) => `Tampalkan ${n} ${u} pada kulit`,
    ru:      (n, u) => `Наклеить ${n} ${u} на кожу`,
    fr:      (n, u) => `Appliquer ${n} ${u} sur la peau`,
    de:      (n, u) => `${n} ${u} auf die Haut kleben`,
    es:      (n, u) => `Colocar ${n} ${u} sobre la piel`,
    pt:      (n, u) => `Colar ${n} ${u} na pele`,
    tr:      (n, u) => `${n} ${u} cilde yapıştırın`,
  };

  // "Inhale through the Mouth N puff" → "สูดยาทางปาก N กด"
  // Unit display hardcoded per-language (กด/กด/press); unitKey unused for this table.
  const INHALE_MOUTH = {
    th:      (n, u) => `สูดยาทางปาก ${n} กด`,
    lo:      (n, u) => `ສູດຢາທາງປາກ ${n} ກົດ`,
    my:      (n, u) => `ပါးစပ်မှ ရှူပါ ${n} ကြိမ်`,
    km:      (n, u) => `ស្រូបតាមមាត់ ${n} ដង`,
    vi:      (n, u) => `Hít qua miệng ${n} lần`,
    "zh-CN": (n, u) => `经口吸入 ${n} 喷`,
    "zh-TW": (n, u) => `經口吸入 ${n} 噴`,
    ja:      (n, u) => `口から${n}回吸入`,
    ko:      (n, u) => `입으로 ${n}회 흡입`,
    ar:      (n, u) => `استنشاق عن طريق الفم ${n} بخة`,
    hi:      (n, u) => `मुँह से ${n} पफ श्वास लें`,
    id:      (n, u) => `Hirup melalui mulut ${n} kali`,
    ms:      (n, u) => `Sedut melalui mulut ${n} kali`,
    ru:      (n, u) => `Вдохнуть через рот ${n} раз`,
    fr:      (n, u) => `Inhaler par la bouche ${n} bouffée`,
    de:      (n, u) => `Durch den Mund ${n}× inhalieren`,
    es:      (n, u) => `Inhalar por la boca ${n} inhalación`,
    pt:      (n, u) => `Inalar pela boca ${n} inalação`,
    tr:      (n, u) => `Ağız yoluyla ${n} kez inhale et`,
  };

  // "Spray into Nostril N Spray …" → "พ่นจมูกข้างละ N กด [freq]"
  const NASAL_SPRAY = {
    th:      (n, u) => `พ่นจมูกข้างละ ${n} กด`,
    lo:      (n, u) => `ພ່ນດັງຂ້າງລະ ${n} ກົດ`,
    my:      (n, u) => `နှာခေါင်းတစ်ဖက်စီ ${n} ကြိမ် ဖျန်းပါ`,
    km:      (n, u) => `បាញ់ ${n} ដង ក្នុងរន្ធច្រមុះ`,
    vi:      (n, u) => `Xịt ${n} lần vào mỗi lỗ mũi`,
    "zh-CN": (n, u) => `每侧鼻孔喷${n}下`,
    "zh-TW": (n, u) => `每側鼻孔噴${n}下`,
    ja:      (n, u) => `各鼻孔に${n}回噴霧`,
    ko:      (n, u) => `각 콧구멍에 ${n}회 분무`,
    ar:      (n, u) => `${n} بخة في كل منخر`,
    hi:      (n, u) => `प्रत्येक नासिका में ${n} पफ स्प्रे करें`,
    id:      (n, u) => `Semprotkan ${n} kali ke setiap lubang hidung`,
    ms:      (n, u) => `Sembur ${n} kali ke setiap lubang hidung`,
    ru:      (n, u) => `По ${n} вдыханию в каждую ноздрю`,
    fr:      (n, u) => `${n} pulvérisation dans chaque narine`,
    de:      (n, u) => `${n} Sprühstoß in jedes Nasenloch`,
    es:      (n, u) => `${n} pulsación en cada fosa nasal`,
    pt:      (n, u) => `${n} aplicação em cada narina`,
    tr:      (n, u) => `Her burun deliğine ${n} puf`,
  };

  // "Inhale through the Mouth N Capsule …" → "สูดยาทางปากครั้งละ N แคปซูล [freq]"
  const INHALE_MOUTH_CAP = {
    th:      (n, u) => `สูดยาทางปากครั้งละ ${n} ${u}`,
    lo:      (n, u) => `ສູດຢາທາງປາກຄັ້ງລະ ${n} ${u}`,
    my:      (n, u) => `ပါးစပ်မှ တစ်ကြိမ်လျှင် ${n} ${u} ရှူပါ`,
    km:      (n, u) => `ស្រូបតាមមាត់ ${n} ${u} ក្នុងមួយដង`,
    vi:      (n, u) => `Hít qua miệng ${n} ${u} mỗi lần`,
    "zh-CN": (n, u) => `经口吸入每次 ${n} ${u}`,
    "zh-TW": (n, u) => `經口吸入每次 ${n} ${u}`,
    ja:      (n, u) => `口から1回${n}${u}吸入`,
    ko:      (n, u) => `입으로 매번 ${n}${u} 흡입`,
    ar:      (n, u) => `استنشاق عن طريق الفم ${n} ${u} في كل مرة`,
    hi:      (n, u) => `मुँह से प्रत्येक बार ${n} ${u} श्वास लें`,
    id:      (n, u) => `Hirup melalui mulut ${n} ${u} setiap kali`,
    ms:      (n, u) => `Sedut melalui mulut ${n} ${u} setiap kali`,
    ru:      (n, u) => `Вдохнуть через рот ${n} ${u} за один раз`,
    fr:      (n, u) => `Inhaler par la bouche ${n} ${u} par prise`,
    de:      (n, u) => `Durch den Mund ${n} ${u} pro Einnahme inhalieren`,
    es:      (n, u) => `Inhalar por la boca ${n} ${u} por toma`,
    pt:      (n, u) => `Inalar pela boca ${n} ${u} por dose`,
    tr:      (n, u) => `Ağız yoluyla her seferinde ${n} ${u} inhale et`,
  };

  // "Apply to the Ulcer in Mouth N ml" → "ทาแผลในปากหรืออมกลั้วปาก N มิลลิลิตร"
  // unitKey = "ml" so the standard liquid unit translation is used.
  const MOUTH_ULCER = {
    th:      (n, u) => `ทาแผลในปากหรืออมกลั้วปาก ${n} ${u}`,
    lo:      (n, u) => `ທາແຜລໃນປາກ ${n} ${u}`,
    my:      (n, u) => `ခံတွင်းအနာကျော် ${n} ${u} သုတ်ပါ`,
    km:      (n, u) => `លាបដំបៅក្នុងមាត់ ${n} ${u}`,
    vi:      (n, u) => `Bôi vết loét trong miệng ${n} ${u}`,
    "zh-CN": (n, u) => `涂口腔溃疡 ${n} ${u}`,
    "zh-TW": (n, u) => `塗口腔潰瘍 ${n} ${u}`,
    ja:      (n, u) => `口内炎に${n}${u}塗布`,
    ko:      (n, u) => `구내염에 ${n}${u} 도포`,
    ar:      (n, u) => `وضع على قرحة الفم ${n} ${u}`,
    hi:      (n, u) => `मुँह के छाले पर ${n} ${u} लगाएँ`,
    id:      (n, u) => `Oleskan pada sariawan ${n} ${u}`,
    ms:      (n, u) => `Sapu pada sariawan mulut ${n} ${u}`,
    ru:      (n, u) => `Нанести на язву во рту ${n} ${u}`,
    fr:      (n, u) => `Appliquer sur l'aphte ${n} ${u}`,
    de:      (n, u) => `Auf Mundgeschwür ${n} ${u} auftragen`,
    es:      (n, u) => `Aplicar en la úlcera bucal ${n} ${u}`,
    pt:      (n, u) => `Aplicar na úlcera bucal ${n} ${u}`,
    tr:      (n, u) => `Ağız ülserine ${n} ${u} uygula`,
  };

  // "Chew Before Swallowing N tablet" → "เคี้ยวก่อนกลืน N เม็ด"
  const CHEW_SWALLOW = {
    th:      (n, u) => `เคี้ยวก่อนกลืน ${n} ${u}`,
    lo:      (n, u) => `ຊ້ຽນກ່ອນກືນ ${n} ${u}`,
    my:      (n, u) => `မျိုမချိုးဘဲ ဝါးပြီးမှ မျိုပါ ${n} ${u}`,
    km:      (n, u) => `ចិញ្ចឹមមុនបើក ${n} ${u}`,
    vi:      (n, u) => `Nhai trước khi nuốt ${n} ${u}`,
    "zh-CN": (n, u) => `嚼碎后吞服 ${n} ${u}`,
    "zh-TW": (n, u) => `嚼碎後吞服 ${n} ${u}`,
    ja:      (n, u) => `噛んでから飲み込む ${n}${u}`,
    ko:      (n, u) => `씹어서 삼키기 ${n}${u}`,
    ar:      (n, u) => `مضغ قبل البلع ${n} ${u}`,
    hi:      (n, u) => `निगलने से पहले चबाएं ${n} ${u}`,
    id:      (n, u) => `Kunyah sebelum ditelan ${n} ${u}`,
    ms:      (n, u) => `Kunyah sebelum menelan ${n} ${u}`,
    ru:      (n, u) => `Разжевать перед проглатыванием ${n} ${u}`,
    fr:      (n, u) => `Croquer avant d'avaler ${n} ${u}`,
    de:      (n, u) => `Vor dem Schlucken kauen ${n} ${u}`,
    es:      (n, u) => `Masticar antes de tragar ${n} ${u}`,
    pt:      (n, u) => `Mastigar antes de engolir ${n} ${u}`,
    tr:      (n, u) => `Yutmadan önce çiğne ${n} ${u}`,
  };

  // mouth-spray → spray unit; mouth-ulcer → ml unit; chew-tablet → tablet; mouth-capsule → capsule; others use raw unit key.
  const unitKey = isMouthSpray ? "spray" : isMouthUlcer ? "ml" : isChewSwallow ? "tablet"
                : isMouthCapsule ? "capsule" : unit;
  const TABLE = isDrop          ? DROP           : isMouthSpray   ? MOUTH_SPRAY
              : isSpray         ? SPRAY          : isLiquid       ? LIQUID
              : isPatch         ? PATCH          : isMouthPuff    ? INHALE_MOUTH
              : isMouthUlcer    ? MOUTH_ULCER    : isChewSwallow  ? CHEW_SWALLOW
              : isNasalSpray    ? NASAL_SPRAY    : isMouthCapsule ? INHALE_MOUTH_CAP : ORAL;
  const fn = TABLE[lang];
  if (!fn) return null;
  return fn(n, _unit(unitKey, lang, n));
}

/* ═══════════════════════════════════════════════════════════════
 * PATTERN LIBRARY
 * matchPattern(text, lang) → translated string | null
 * ═══════════════════════════════════════════════════════════════ */

// Compound timing map: "Morning Noon Evening and Bedtime" etc.
// Keys are lowercase, sorted for matching
const COMPOUND_TIMING = {
  "after breakfast dinner":        { th:"หลังอาหารเช้าและเย็น",       lo:"ຫຼັງອາຫານເຊົ້າ ແລະ ແລງ",      my:"မနက်စာနှင့် ညနေစာ စားပြီး",    km:"ក្រោយអាហារព្រឹក និងល្ងាច",      vi:"sau bữa sáng và tối",     "zh-CN":"早餐和晚餐后",  "zh-TW":"早餐和晚餐後",  ja:"朝食後と夕食後",    ko:"아침 식사 후와 저녁 식사 후",  ar:"بعد الإفطار والعشاء",       hi:"नाश्ते और रात के खाने के बाद",id:"setelah sarapan dan makan malam",ms:"selepas sarapan dan makan malam",ru:"после завтрака и ужина",   fr:"après le petit-déjeuner et le dîner",de:"nach dem Frühstück und Abendessen",es:"después del desayuno y la cena",tr:"kahvaltı ve akşam yemeğinden sonra" },
  "after breakfast lunch dinner":  { th:"หลังอาหารเช้า กลางวัน และเย็น",lo:"ຫຼັງອາຫານເຊົ້າ ທ່ຽງ ແລະ ແລງ",  my:"မနက်၊ နေ့လည်၊ ညနေ စားပြီး",   km:"ក្រោយអាហារព្រឹក ថ្ងៃ ល្ងាច",   vi:"sau 3 bữa",               "zh-CN":"三餐后",        "zh-TW":"三餐後",        ja:"毎食後",            ko:"매 식사 후",               ar:"بعد كل وجبة",               hi:"तीनों भोजन के बाद",           id:"setelah setiap makan",   ms:"selepas setiap makan",           ru:"после каждого приёма пищи","fr":"après chaque repas",       de:"nach jeder Mahlzeit",        es:"después de cada comida",       tr:"her öğünden sonra" },
  "before breakfast dinner":       { th:"ก่อนอาหารเช้าและเย็น",          lo:"ກ່ອນອາຫານເຊົ້າ ແລະ ແລງ",       my:"မနက်စာနှင့် ညနေစာ မစားမီ",     km:"មុនអាហារព្រឹក និងល្ងាច",        vi:"trước bữa sáng và tối",   "zh-CN":"早餐和晚餐前",  "zh-TW":"早餐和晚餐前",  ja:"朝食前と夕食前",    ko:"아침과 저녁 식사 전",          ar:"قبل الإفطار والعشاء",       hi:"नाश्ते और रात के खाने से पहले",id:"sebelum sarapan dan makan malam",ms:"sebelum sarapan dan makan malam",ru:"до завтрака и ужина",      fr:"avant le petit-déjeuner et le dîner",de:"vor dem Frühstück und Abendessen",es:"antes del desayuno y la cena",tr:"kahvaltı ve akşam yemeğinden önce" },
  "after breakfast lunch":         { th:"หลังอาหารเช้าและกลางวัน",        lo:"ຫຼັງອາຫານເຊົ້າ ແລະ ທ່ຽງ",       my:"မနက်နှင့် နေ့လည်စာ စားပြီး",   km:"ក្រោយអាហារព្រឹក និងថ្ងៃ",      vi:"sau bữa sáng và trưa",    "zh-CN":"早餐和午餐后",  "zh-TW":"早餐和午餐後",  ja:"朝食後と昼食後",    ko:"아침과 점심 식사 후",          ar:"بعد الإفطار والغداء",       hi:"नाश्ते और दोपहर के खाने के बाद",id:"setelah sarapan dan makan siang",ms:"selepas sarapan dan makan tengah hari",ru:"после завтрака и обеда","fr":"après le petit-déjeuner et le déjeuner",de:"nach dem Frühstück und Mittagessen",es:"después del desayuno y el almuerzo",tr:"kahvaltı ve öğle yemeğinden sonra" },
  "after lunch dinner":            { th:"หลังอาหารกลางวันและเย็น",         lo:"ຫຼັງອາຫານທ່ຽງ ແລະ ແລງ",        my:"နေ့လည်နှင့် ညနေစာ စားပြီး",   km:"ក្រោយអាហារថ្ងៃ និងល្ងាច",      vi:"sau bữa trưa và tối",     "zh-CN":"午餐和晚餐后",  "zh-TW":"午餐和晚餐後",  ja:"昼食後と夕食後",    ko:"점심과 저녁 식사 후",          ar:"بعد الغداء والعشاء",        hi:"दोपहर और रात के खाने के बाद",id:"setelah makan siang dan malam",ms:"selepas makan tengah hari dan malam",ru:"после обеда и ужина","fr":"après le déjeuner et le dîner",de:"nach dem Mittag- und Abendessen",es:"después del almuerzo y la cena",tr:"öğle ve akşam yemeğinden sonra" },
  "morning noon evening bedtime":       { th:"เช้า เที่ยง เย็น ก่อนนอน",         lo:"ເຊົ້າ ທ່ຽງ ແລງ ກ່ອນນອນ",           my:"မနက် နေ့လည် ညနေ အိပ်ရာမဝင်မီ",     km:"ព្រឹក ថ្ងៃត្រង់ ល្ងាច មុនពេលគេង",    vi:"sáng trưa chiều trước khi ngủ",   "zh-CN":"早中晚睡前",  "zh-TW":"早中晚睡前",  ja:"朝昼夕就寝前",    ko:"아침 점심 저녁 취침 전",  ar:"صباح ظهر مساء قبل النوم", hi:"सुबह दोपहर शाम सोने से पहले", id:"pagi siang sore sebelum tidur", ms:"pagi tengah hari petang sebelum tidur", ru:"утром днём вечером перед сном", fr:"matin midi soir coucher", de:"morgens mittags abends vor dem Schlafen", es:"mañana mediodía tarde acostarse", tr:"sabah öğle akşam yatmadan önce" },
  "morning evening bedtime":            { th:"เช้า เย็น ก่อนนอน",                lo:"ເຊົ້າ ແລງ ກ່ອນນອນ",                 my:"မနက် ညနေ အိပ်ရာမဝင်မီ",             km:"ព្រឹក ល្ងាច មុនពេលគេង",               vi:"sáng chiều trước khi ngủ",        "zh-CN":"早晚睡前",   "zh-TW":"早晚睡前",   ja:"朝夕就寝前",     ko:"아침 저녁 취침 전",       ar:"صباح مساء قبل النوم",      hi:"सुबह शाम सोने से पहले",        id:"pagi sore sebelum tidur",       ms:"pagi petang sebelum tidur",             ru:"утром вечером перед сном",       fr:"matin soir coucher",              de:"morgens abends vor dem Schlafen",    es:"mañana tarde acostarse",          tr:"sabah akşam yatmadan önce" },
  "morning noon evening":               { th:"เช้า เที่ยง เย็น",                  lo:"ເຊົ້າ ທ່ຽງ ແລງ",                    my:"မနက် နေ့လည် ညနေ",                   km:"ព្រឹក ថ្ងៃត្រង់ ល្ងាច",               vi:"sáng trưa chiều",                 "zh-CN":"早中晚",     "zh-TW":"早中晚",     ja:"朝昼夕",         ko:"아침 점심 저녁",           ar:"صباح ظهر مساء",            hi:"सुबह दोपहर शाम",                id:"pagi siang sore",               ms:"pagi tengah hari petang",               ru:"утром днём вечером",             fr:"matin midi soir",                 de:"morgens mittags abends",             es:"mañana mediodía tarde",           tr:"sabah öğle akşam" },
  "morning evening":                    { th:"เช้า เย็น",                          lo:"ເຊົ້າ ແລງ",                         my:"မနက် ညနေ",                           km:"ព្រឹក ល្ងាច",                         vi:"sáng chiều",                      "zh-CN":"早晚",       "zh-TW":"早晚",       ja:"朝夕",           ko:"아침 저녁",               ar:"صباح مساء",                hi:"सुबह शाम",                      id:"pagi sore",                     ms:"pagi petang",                           ru:"утром вечером",                  fr:"matin soir",                      de:"morgens abends",                     es:"mañana tarde",                    tr:"sabah akşam" },
  "morning bedtime":                    { th:"เช้า ก่อนนอน",                       lo:"ເຊົ້າ ກ່ອນນອນ",                     my:"မနက် အိပ်ရာမဝင်မီ",                  km:"ព្រឹក មុនពេលគេង",                    vi:"sáng trước khi ngủ",              "zh-CN":"早睡前",     "zh-TW":"早睡前",     ja:"朝就寝前",       ko:"아침 취침 전",             ar:"صباح قبل النوم",           hi:"सुबह सोने से पहले",             id:"pagi sebelum tidur",            ms:"pagi sebelum tidur",                    ru:"утром перед сном",               fr:"matin coucher",                   de:"morgens vor dem Schlafen",           es:"mañana acostarse",                tr:"sabah yatmadan önce" },
  /* 4-dose standard (Thai BKN convention written with "lunch" instead of "noon") */
  "morning lunch evening bedtime":      { th:"เช้า กลางวัน เย็น ก่อนนอน",         lo:"ເຊົ້າ ທ່ຽງ ແລງ ກ່ອນນອນ",           my:"မနက် နေ့လည် ညနေ အိပ်ရာမဝင်မီ",     km:"ព្រឹក ថ្ងៃត្រង់ ល្ងាច មុនពេលគេង",    vi:"sáng trưa chiều trước khi ngủ",   "zh-CN":"早中晚睡前",  "zh-TW":"早中晚睡前",  ja:"朝昼夕就寝前",    ko:"아침 점심 저녁 취침 전",  ar:"صباح ظهر مساء قبل النوم", hi:"सुबह दोपहर शाम सोने से पहले", id:"pagi siang sore sebelum tidur", ms:"pagi tengah hari petang sebelum tidur", ru:"утром днём вечером перед сном", fr:"matin midi soir coucher", de:"morgens mittags abends vor dem Schlafen", es:"mañana mediodía tarde acostarse", tr:"sabah öğle akşam yatmadan önce" },
  "morning lunch evening":              { th:"เช้า กลางวัน เย็น",                 lo:"ເຊົ້າ ທ່ຽງ ແລງ",                    my:"မနက် နေ့လည် ညနေ",                   km:"ព្រឹក ថ្ងៃត្រង់ ល្ងាច",               vi:"sáng trưa chiều",                 "zh-CN":"早中晚",     "zh-TW":"早中晚",     ja:"朝昼夕",         ko:"아침 점심 저녁",           ar:"صباح ظهر مساء",            hi:"सुबह दोपहर शाम",                id:"pagi siang sore",               ms:"pagi tengah hari petang",               ru:"утром днём вечером",             fr:"matin midi soir",                 de:"morgens mittags abends",             es:"mañana mediodía tarde",           tr:"sabah öğle akşam" },
  /* 4-dose with explicit meal-relation */
  "after breakfast lunch dinner bedtime": { th:"หลังอาหารเช้า กลางวัน เย็น และก่อนนอน", lo:"ຫຼັງອາຫານເຊົ້າ ທ່ຽງ ແລງ ແລະກ່ອນນອນ", my:"မနက် နေ့လည် ညနေစာ ပြီးနောက် နှင့် အိပ်ရာမဝင်မီ", km:"ក្រោយអាហារព្រឹក ថ្ងៃ ល្ងាច និងមុនពេលគេង", vi:"sau 3 bữa và trước khi ngủ", "zh-CN":"三餐后及睡前", "zh-TW":"三餐後及睡前", ja:"毎食後と就寝前", ko:"매 식사 후와 취침 전", ar:"بعد كل وجبة وقبل النوم", hi:"तीनों भोजन के बाद और सोने से पहले", id:"setelah setiap makan dan sebelum tidur", ms:"selepas setiap makan dan sebelum tidur", ru:"после каждого приёма пищи и перед сном", fr:"après chaque repas et au coucher", de:"nach jeder Mahlzeit und vor dem Schlafen", es:"después de cada comida y al acostarse", tr:"her öğünden sonra ve yatmadan önce" },
};

function _compoundTiming(raw, lang) {
  const r = raw.toLowerCase().trim();

  // Expand "after/before X and Y" → "after X Y" for key lookup
  // e.g. "after breakfast and dinner" → "after breakfast dinner"
  const expanded = r
    .replace(/\b(after|before|with)\s+(\w+)\s+and\s+(\w+)/gi, (_, prep, a, b) => `${prep} ${a} ${prep} ${b}`)
    .replace(/\band\b/gi, " ").replace(/&/g, " ")
    .replace(/\s+/g, " ").trim();

  // Extract unique meal tokens for key
  const tokens = expanded
    .replace(/\bbedtime\b/i, "bedtime")
    .replace(/\bnoon\b/i, "noon")
    .split(/[\s,]+/).filter(Boolean);

  // Try direct key
  const key = tokens.join(" ");
  let map = COMPOUND_TIMING[key];

  if (!map) {
    // Sort tokens alphabetically and retry
    const sorted = [...tokens].sort().join(" ");
    map = Object.entries(COMPOUND_TIMING).find(([k]) =>
      [...k.split(" ")].sort().join(" ") === sorted
    )?.[1];
  }

  if (!map) return null;
  return map[lang] || null;
}

// Master regex — covers the HIS standard format:
// "<Verb> N Unit(s) [Orally|in Mouth|in Nostril|...] FREQ [once] TIMING For D Days"
// Each group optional except N and unit. Leading verb may be Take/Spray/Apply/etc.
const MASTER_RE = new RegExp(
  [
    /^(?:Take|Spray|Apply|Insert|Use|Instill|Inhale|Place|Put|Patch|Chew)\s+/i,
    /(\d+(?:\.\d+)?|\bquarter\b|\bhalf\b|\bthree-quarter\b)\s+/,  // [1] qty
    /(tablet|caplet|capsule|drop|spray|puff|ml|millilit(?:re|er)|millilitr|pack|sachet|bottle|vial|tube|ampoule|ampule|amp|piece|pcs|pc|patch)s?\s*/i,   // [2] unit
    // Optional route phrase ("orally" / "in mouth" / "in nostril" / "in eye" / ...)
    /(?:(?:orally|in\s+(?:the\s+)?(?:mouth|throat|nose|nostril|nasal|eye|ear|rectum|vagina|affected\s+area))\s*)?/i,
    // [3] freq: "N times a day" OR canonical forms, optionally suffixed with PRN
    /((?:\d+\s+times?\s+(?:a\s+)?day|once\s+daily|twice\s+daily|\d+\s+times?\s+daily|every\s+\d+\s+hours?|once\s+a\s+week|at\s+bedtime|once\s+at\s+bedtime)(?:\s+(?:if|when|as)\s+needed|\s+prn|\s+p\.r\.n\.?)?)?\s*/i,
    // [4] timing — allow optional leading "once" so "once after dinner" works
    /(?:once\s+)?((?:(?:morning|noon|evening|night|bedtime|breakfast|lunch|dinner|meal)(?:\s+(?:and\s+)?)?)+(?:before\s+|after\s+|with\s+|at\s+|in\s+the\s+)?(?:morning|noon|evening|night|bedtime|breakfast|lunch|dinner|meal)?|before\s+breakfast|after\s+breakfast|before\s+lunch|after\s+lunch|before\s+dinner|after\s+dinner|with\s+breakfast|with\s+lunch|with\s+dinner|before\s+meal|after\s+meal|with\s+meal|before\s+bedtime|at\s+bedtime|in\s+the\s+morning|in\s+the\s+evening|at\s+night|when\s+needed|as\s+needed|before\s+noon|after\s+noon|before\s+scheduled\s+time|at\s+scheduled\s+time)?\s*/i,
    /(?:for\s+(\d+)\s+days?)?\s*$/i,                                    // [5] days
  ].map(r => r.source).join(""),
  "i"
);

// Loose fallback — just the leading "<Verb> N Unit [route...]" with whatever
// trailing freq/timing text. Used when MASTER_RE can't parse the English tail
// but we still have an authoritative Thai frequency (opts.freqOverride) to use,
// so the dose verb is localised and the messy English tail is dropped.
const TAKE_QTY_RE = new RegExp(
  [
    /^(?:Take|Spray|Apply|Insert|Use|Instill|Inhale|Place|Put|Patch|Chew)\s+/i,
    /(?:(?:to|in|into|on|onto)\s+(?:the\s+)?(?:mouth|throat|nose|nostril|nasal|eye|ear|skin|affected\s+area)\s+)?/i,
    /(\d+(?:\.\d+)?|\bquarter\b|\bhalf\b|\bthree-quarter\b)\s+/,        // [1] qty
    /(tablet|caplet|capsule|drop|spray|puff|ml|millilit(?:re|er)|millilitr|pack|sachet|bottle|vial|tube|ampoule|ampule|amp|piece|pcs|pc|patch)s?\b/i, // [2] unit
  ].map(r => r.source).join(""),
  "i"
);

// Topical application verbs for instructions that have no quantity+unit, e.g.
// "Apply to the Affected Area (Topical) ..." / "Apply on Dry Skin ...". Returns
// the localised verb phrase, or "" if `t` isn't a topical-apply instruction.
function _applyVerb(t, lang) {
  if (/^apply\s+on\s+dry\s+skin/i.test(t)) {
    const M = { th:"ทาบริเวณผิวที่แห้ง", lo:"ທາບໍລິເວນຜິວທີ່ແຫ້ງ", en:"Apply on dry skin",
                "zh-CN":"涂抹于干燥皮肤", my:"ခြောက်သွေ့သောအသားအရေတွင် လိမ်းပါ", km:"លាបលើស្បែកស្ងួត" };
    return M[lang] || M.en;
  }
  if (/^apply\s+(to|on|over)\b/i.test(t)) {
    // Reuse the curated auxiliary phrase for "apply to affected area".
    const g = AUXILIARY_PHRASES["apply to affected area"];
    return (g && g[lang]) || "Apply to the affected area";
  }
  return "";
}

// Oral-rehydration / fluid instructions with no quantity+unit, e.g.
// "Drink Instead of Water Every 2-3 Hours When have Symptom" (ORS sachets).
// "Slowly" is the standard ORS counselling point (sip, don't gulp), so it's
// baked into the verb phrase rather than left to the frequency tail.
function _drinkVerb(t, lang) {
  if (/^drink\b/i.test(t)) {
    const M = { th:"ดื่มช้าๆ", lo:"ດື່ມຊ້າໆ", en:"Drink slowly",
                "zh-CN":"慢慢喝", my:"တဖြည်းဖြည်း သောက်ပါ", km:"ផឹកបន្តិចម្តងៗ" };
    return M[lang] || M.en;
  }
  return "";
}

function matchPattern(text, lang, opts = {}) {
  const freqOverrideRaw = (lang === "th" && opts.freqOverride) ? String(opts.freqOverride).trim() : "";

  // Normalize ArcusAir unit suffixes before regex matching (e.g. PUFF_PU → PUFF).
  let t = text.trim().replace(
    /\b(tablet|capsule|caplet|drop|spray|puff|ml|pack|sachet|bottle|vial|tube|piece|patch)_\w+/gi,
    "$1"
  );

  // Already in Thai/Lao script — return as-is; dose + frequency already embedded.
  if (/[฀-໿]/.test(t)) return t;

  // "Spray N Puff Into Each Nostril ..." — bilateral nasal spray.
  // ArcusAir encodes "1 puff per nostril, both sides" as a single instruction.
  // The standard spray verb cannot express this; handle it with a dedicated table.
  const _nostrilM = t.match(/^Spray\s+(\d+(?:\.\d+)?)\s+Puff\s+Into\s+Each\s+Nostril\b/i);
  if (_nostrilM) {
    const _n = _nostrilM[1];
    const _NT = {
      th:      n => `พ่นจมูก 2 ข้าง ข้างละ ${n} กด`,
      lo:      n => `ພົ່ນດັງ 2 ຂ້າງ ຂ້າງລະ ${n} ກົດ`,
      my:      n => `နှာခေါင်းတစ်ဖက်စီ ${n} ကြိမ် ဖျန်းပါ`,
      km:      n => `បាញ់ ${n} ដង ក្នុងរន្ធច្រមុះម្ខាង`,
      vi:      n => `Xịt ${n} lần vào mỗi lỗ mũi`,
      "zh-CN": n => `每侧鼻孔喷${n}下`,
      "zh-TW": n => `每側鼻孔噴${n}下`,
      ja:      n => `各鼻孔に${n}回噴霧`,
      ko:      n => `각 콧구멍에 ${n}회 분무`,
      ar:      n => `${n} بخة في كل منخر`,
      hi:      n => `प्रत्येक नासिका में ${n} पफ स्प्रे करें`,
      id:      n => `Semprotkan ${n} kali ke setiap lubang hidung`,
      ms:      n => `Sembur ${n} kali ke setiap lubang hidung`,
      ru:      n => `По ${n} вдыханию в каждую ноздрю`,
      fr:      n => `${n} pulvérisation dans chaque narine`,
      de:      n => `${n} Sprühstoß in jedes Nasenloch`,
      es:      n => `${n} pulsación en cada fosa nasal`,
      pt:      n => `${n} aplicação em cada narina`,
      tr:      n => `Her burun deliğine ${n} puf`,
    };
    const _fn = _NT[lang] || (n => `Spray ${n} puff into each nostril`);
    return [_fn(_n), freqOverrideRaw].filter(Boolean).join(" ");
  }

  // Normalize compound verbs before route/regex processing.
  // "Chew Before Swallowing N unit" → "Chew N unit" + preQtyRoute = "chew-swallow"
  let preQtyRoute = "";
  t = t.replace(/^(Chew)\s+Before\s+Swallowing\b\s*/i, (_, v) => {
    preQtyRoute = "chew-swallow";
    return v + " ";
  });

  // Strip route phrases between verb and qty; supports multi-word routes
  // (e.g. "Spray into the Mouth 3 spray", "Apply to the Ulcer in Mouth 1 ml").
  t = t.replace(
    /^((?:Take|Spray|Apply|Use|Instill|Inhale|Place|Put|Patch|Chew)\s+)((?:to|in|into|on|onto|through)\s+(?:the\s+)?(.+?)\s+)(?=\d|\bquarter\b|\bhalf\b|\bthree-quarter\b)/i,
    (_, verb, _rp, routeLoc) => { preQtyRoute = routeLoc.toLowerCase().trim(); return verb; }
  );

  const m = t.match(MASTER_RE);
  if (!m) {
    // No strict match. If we have an authoritative Thai frequency, salvage the
    // dose verb from the loose pattern and append the Thai frequency — so the
    // line is fully Thai instead of mixed (the unparsed English tail is dropped).
    if (freqOverrideRaw) {
      const lm = t.match(TAKE_QTY_RE);
      if (lm) {
        let unit = lm[2] || "tablet";
        if (/^caplet/i.test(unit)) unit = "tablet";
        if (preQtyRoute === "mouth" && /^spray$/i.test(unit)) unit = "mouth-spray";
        if (preQtyRoute === "mouth" && /^puff$/i.test(unit)) unit = "mouth-puff";
        if (preQtyRoute === "mouth" && /^capsule$/i.test(unit)) unit = "mouth-capsule";
        if (/ulcer.*mouth/i.test(preQtyRoute) && /^m[il]/i.test(unit)) unit = "mouth-ulcer";
        if (preQtyRoute === "chew-swallow") unit = "chew-tablet";
        if (preQtyRoute === "nostril" && /^spray$/i.test(unit)) unit = "nasal-spray";
        let q = lm[1] || "1";
        if (/^quarter$/i.test(q)) q = "¼";
        else if (/^half$/i.test(q)) q = lang === "th" ? "ครึ่ง" : lang === "lo" ? "ເຄິ່ງ" : "½";
        else if (/^three.quarter$/i.test(q)) q = "¾";
        const take = _take(q, unit, lang);
        if (take) return [take, freqOverrideRaw].filter(Boolean).join(" ");
      }
      // Topical "Apply ..." instructions carry no qty+unit, so TAKE_QTY_RE
      // misses them. Salvage the application verb (ทา ...) so it isn't reduced
      // to a bare frequency. The "(Topical)" route marker is dropped.
      const ap = _applyVerb(t, lang);
      if (ap) return [ap, freqOverrideRaw].filter(Boolean).join(" ");
      // Same for fluid/ORS instructions ("Drink Instead of Water ...") — no
      // qty+unit to match, but the verb still needs to survive into Thai.
      const dr = _drinkVerb(t, lang);
      if (dr) return [dr, freqOverrideRaw].filter(Boolean).join(" ");
      // No dose verb/qty either (e.g. "As Directed (Nasal) As directed") —
      // the Thai frequency alone is the whole instruction.
      return freqOverrideRaw;
    }
    return null;
  }

  const rawQty    = m[1] || "1";
  let   rawUnit   = m[2] || "tablet";
  if (/^caplet/i.test(rawUnit)) rawUnit = "tablet";
  if (preQtyRoute === "mouth" && /^spray$/i.test(rawUnit)) rawUnit = "mouth-spray";
  if (preQtyRoute === "mouth" && /^puff$/i.test(rawUnit))  rawUnit = "mouth-puff";
  if (preQtyRoute === "mouth" && /^capsule$/i.test(rawUnit)) rawUnit = "mouth-capsule";
  if (/ulcer.*mouth/i.test(preQtyRoute) && /^m[il]/i.test(rawUnit)) rawUnit = "mouth-ulcer";
  if (preQtyRoute === "chew-swallow") rawUnit = "chew-tablet";
  if (preQtyRoute === "nostril" && /^spray$/i.test(rawUnit)) rawUnit = "nasal-spray";
  const rawFreq   = (m[3] || "").trim();
  const rawTiming = (m[4] || "").trim();
  const rawDays   = m[5] || "";

  // Resolve quantity (handle fractions); use native words for Thai/Lao
  let qty = rawQty;
  if (/^quarter$/i.test(qty))           qty = "¼";
  else if (/^half$/i.test(qty))         qty = lang === "th" ? "ครึ่ง" : lang === "lo" ? "ເຄິ່ງ" : "½";
  else if (/^three.quarter$/i.test(qty)) qty = "¾";

  // Build sentence parts
  const takePart   = _take(qty, rawUnit, lang);
  if (!takePart) return null;

  // The BKN frequency master (opts.freqOverride) is authoritative for Thai — it
  // wins over the engine's own frequency translation whenever supplied. Covers
  // the full PRN/timing phrasing the master encodes (e.g. "วันละ 1 ครั้ง เวลามีอาการ").
  const freqOverride = freqOverrideRaw;
  const freqPart   = freqOverride || (rawFreq ? _freq(rawFreq, lang) : null);
  // The master frequency name embeds its own timing (e.g. "2 Time Daily Morning
  // and Evening" → "วันละ 2 ครั้ง เช้า เย็น"). MASTER_RE captures that trailing
  // timing separately, so when the override is used we must NOT re-append the
  // engine's timing — it would duplicate ("... เช้า เย็น เช้า เย็น").
  const timingPart = (freqOverride ? null : (rawTiming
    ? (_compoundTiming(rawTiming, lang) || _timing(rawTiming, lang))
    : null));
  const daysPart   = rawDays   ? _days(rawDays, lang)        : null;

  // Assemble — language-specific word order
  const ASSEMBLERS = {
    // Thai: รับประทาน N เม็ด [freq] [timing] [days]
    th:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(" "),
    lo:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(" "),
    my:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(" "),
    km:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(" "),
    vi:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(", "),
    "zh-CN": (take, freq, timing, days) => [freq, timing, take, days].filter(Boolean).join("，"),
    "zh-TW": (take, freq, timing, days) => [freq, timing, take, days].filter(Boolean).join("，"),
    ja:  (take, freq, timing, days) => [freq, timing, take, days].filter(Boolean).join("、"),
    ko:  (take, freq, timing, days) => [freq, timing, take, days].filter(Boolean).join(" "),
    ar:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(" "),
    hi:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(", "),
    id:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(" "),
    ms:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(" "),
    ru:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(", "),
    fr:  (take, freq, timing, days) => [take, timing, freq, days ? `(${days})` : null].filter(Boolean).join(", "),
    de:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(", "),
    es:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(", "),
    pt:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(", "),
    tr:  (take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(", "),
  };

  const assembler = ASSEMBLERS[lang] || ((take, freq, timing, days) => [take, freq, timing, days].filter(Boolean).join(" "));
  return assembler(takePart, freqPart, timingPart, daysPart);
}

// Quantity-only pattern: dispensed amount (e.g. "6 Tablets", "1 Vial", "1 Bottle").
// This appears on the dispensed-quantity line of the sticker. We prefix it
// with the per-language word for "Quantity" so the patient doesn't confuse
// it with the per-dose amount on the line above.
const QTY_RE = /^(\d+(?:\.\d+)?)\s+(tablet|capsule|caplet|drop|spray|ml|millilit(?:re|er)|millilitr|bottle|vial|box|ampoule|ampule|amp|tube|sachet|syringe|pack|piece|pcs|pc)s?$/i;

const QTY_LABEL = {
  th:"จำนวน",       lo:"ຈຳນວນ",        my:"အရေအတွက်",     km:"ចំនួន",
  vi:"Số lượng",    "zh-CN":"数量",      "zh-TW":"數量",      ja:"数量",
  ko:"수량",         ar:"الكمية",         hi:"मात्रा",         id:"Jumlah",
  ms:"Jumlah",      ru:"Количество",    fr:"Quantité",       de:"Menge",
  es:"Cantidad",    pt:"Quantidade",    tr:"Miktar",         tl:"Dami",
};

function matchQtyPattern(text, lang, opts = {}) {
  const m = text.trim().match(QTY_RE);
  if (!m) return null;
  const n = m[1];
  // Normalise millilitre variants → "ml", caplet → tablet for _unit lookup
  let unitRaw = m[2].toLowerCase().replace(/s$/, "");
  if (/^millilit/.test(unitRaw)) unitRaw = "ml";
  if (unitRaw === "caplet")      unitRaw = "tablet"; // caplet = tablet form
  const u = _unit(unitRaw, lang, parseInt(n));
  // Language-specific qty+unit order
  const QTY_TMPL = {
    ja: (n, u) => `${n}${u}`,
    ko: (n, u) => `${n}${u}`,
    "zh-CN": (n, u) => `${n}${u}`,
    "zh-TW": (n, u) => `${n}${u}`,
  };
  const fn = QTY_TMPL[lang] || ((n, u) => `${n} ${u}`);
  const body = fn(n, u);
  // Some callers (e.g. the Home Med Sheet's Qty column, which already has a
  // "จำนวน" header) want the bare "7 เม็ด" without the per-language label.
  if (opts.noLabel) return body;
  const label = QTY_LABEL[lang];
  return label ? `${label} ${body}` : body;
}

// Bare quantity localiser ("7 Tablet" → "7 เม็ด"), no label prefix. Offline.
window.matchQtyNoLabel = function (text, lang) {
  return matchQtyPattern(text, lang, { noLabel: true });
};

/* ═══════════════════════════════════════════════════════════════
 * AUXILIARY-LABEL PHRASES
 * Common Thai pharmacy auxiliary stickers (BKN convention).
 * Each entry is a full phrase, matched verbatim after the master regex
 * fails. Keys are lowercase canonical English; values are per-language
 * translations. Falls through to glossary/Google if not matched.
 * ═══════════════════════════════════════════════════════════════ */
const AUXILIARY_PHRASES = {
  "shake well before use": {
    th:"เขย่าขวดก่อนใช้",            lo:"ໝູນຂວດກ່ອນໃຊ້",
    my:"အသုံးပြုခြင်းမတိုင်မီ ကောင်းစွာလှုပ်ပါ", km:"ឱ្យល្បាស់មុនពេលប្រើ",
    vi:"Lắc đều trước khi dùng",      "zh-CN":"使用前摇匀",  "zh-TW":"使用前搖勻",
    ja:"使用前によく振ってください",     ko:"사용 전 잘 흔드세요",
    ar:"رجّ جيداً قبل الاستعمال",       hi:"उपयोग से पहले अच्छी तरह हिलाएँ",
    id:"Kocok dulu sebelum digunakan", ms:"Goncang dengan baik sebelum digunakan",
    ru:"Перед употреблением взболтать",fr:"Bien agiter avant emploi",
    de:"Vor Gebrauch gut schütteln",   es:"Agitar bien antes de usar",
    pt:"Agitar bem antes de usar",     tr:"Kullanmadan önce iyice çalkalayın",
  },
  "for external use only": {
    th:"ใช้ภายนอกเท่านั้น",           lo:"ໃຊ້ພາຍນອກເທົ່ານັ້ນ",
    my:"အပြင်ပိုင်းသာ အသုံးပြုပါ",     km:"ប្រើខាងក្រៅប៉ុណ្ណោះ",
    vi:"Chỉ dùng ngoài da",            "zh-CN":"仅供外用",     "zh-TW":"僅供外用",
    ja:"外用のみ",                       ko:"외용으로만 사용",
    ar:"للاستعمال الخارجي فقط",         hi:"केवल बाहरी उपयोग के लिए",
    id:"Hanya untuk pemakaian luar",   ms:"Untuk kegunaan luaran sahaja",
    ru:"Только для наружного применения",fr:"Usage externe uniquement",
    de:"Nur zur äußerlichen Anwendung", es:"Sólo para uso externo",
    pt:"Apenas para uso externo",      tr:"Sadece haricen kullanılır",
  },
  "do not crush or chew": {
    th:"ห้ามบดหรือเคี้ยว",             lo:"ຫ້າມບົດຫຼືຄ້ຽວ",
    my:"မချေ၊ မဝါးပါနှင့်",            km:"ហាមកិន ឬទំពាស",
    vi:"Không nghiền hoặc nhai",       "zh-CN":"勿压碎或咀嚼",  "zh-TW":"勿壓碎或咀嚼",
    ja:"砕いたり噛んだりしないでください",ko:"부수거나 씹지 마세요",
    ar:"لا تسحق أو تمضغ",               hi:"कुचलें या चबाएँ नहीं",
    id:"Jangan dihancurkan atau dikunyah",ms:"Jangan dihancurkan atau dikunyah",
    ru:"Не разламывать и не разжёвывать",fr:"Ne pas écraser ni mâcher",
    de:"Nicht zerdrücken oder kauen",  es:"No triturar ni masticar",
    pt:"Não esmagar nem mastigar",     tr:"Ezmeyin veya çiğnemeyin",
  },
  "swallow whole": {
    th:"กลืนทั้งเม็ด",                lo:"ກືນທັງເມັດ",
    my:"တလုံးလုံး မျိုပါ",            km:"លេបទាំងគ្រាប់",
    vi:"Nuốt nguyên viên",            "zh-CN":"整片吞服",     "zh-TW":"整錠吞服",
    ja:"丸ごと飲み込んでください",       ko:"통째로 삼키세요",
    ar:"ابلع كاملاً",                   hi:"पूरी गोली निगलें",
    id:"Telan utuh",                  ms:"Telan bulat-bulat",
    ru:"Глотать целиком",             fr:"Avaler en entier",
    de:"Ganz schlucken",              es:"Tragar entero",
    pt:"Engolir inteiro",             tr:"Bütün olarak yutun",
  },
  "dissolve under the tongue": {
    th:"อมใต้ลิ้นจนละลาย",            lo:"ອົມໃຕ້ລີ້ນຈົນລະລາຍ",
    my:"လျှာအောက်တွင် ပျော်ဝင်အောင်ထား",km:"រលាយក្រោមអណ្តាត",
    vi:"Ngậm dưới lưỡi đến tan",       "zh-CN":"舌下含化",     "zh-TW":"舌下含化",
    ja:"舌下で溶かしてください",          ko:"혀 밑에서 녹이세요",
    ar:"يذوب تحت اللسان",               hi:"जीभ के नीचे घुलने दें",
    id:"Larutkan di bawah lidah",       ms:"Lekapkan di bawah lidah hingga lebur",
    ru:"Рассасывать под языком",        fr:"Laisser fondre sous la langue",
    de:"Unter der Zunge auflösen",      es:"Disolver bajo la lengua",
    pt:"Dissolver sob a língua",        tr:"Dilin altında eritin",
  },
  "with a full glass of water": {
    th:"ดื่มน้ำตามมาก ๆ",              lo:"ດື່ມນ້ຳຕາມຫຼາຍໆ",
    my:"ရေအပြည့်တစ်ခွက်နှင့်",          km:"ជាមួយទឹកពេញកែវ",
    vi:"Uống với một cốc nước đầy",     "zh-CN":"用一满杯水送服","zh-TW":"用一滿杯水送服",
    ja:"コップ一杯の水で",               ko:"물 한 컵과 함께",
    ar:"مع كوب ماء كامل",                hi:"भरे गिलास पानी के साथ",
    id:"Dengan segelas penuh air",      ms:"Dengan segelas penuh air",
    ru:"Запить полным стаканом воды",   fr:"Avec un grand verre d'eau",
    de:"Mit einem vollen Glas Wasser",  es:"Con un vaso lleno de agua",
    pt:"Com um copo cheio de água",     tr:"Bir bardak dolusu suyla",
  },
  "may cause drowsiness": {
    th:"อาจทำให้ง่วงนอน",              lo:"ອາດເຮັດໃຫ້ງ່ວງນອນ",
    my:"အိပ်ငိုက်စေနိုင်သည်",          km:"អាចបណ្តាលឱ្យងងុយដេក",
    vi:"Có thể gây buồn ngủ",          "zh-CN":"可能引起嗜睡",   "zh-TW":"可能引起嗜睡",
    ja:"眠気を催すことがあります",        ko:"졸음을 유발할 수 있음",
    ar:"قد يسبب النعاس",                hi:"उनींदापन हो सकता है",
    id:"Dapat menyebabkan kantuk",     ms:"Boleh menyebabkan rasa mengantuk",
    ru:"Может вызывать сонливость",    fr:"Peut provoquer de la somnolence",
    de:"Kann Schläfrigkeit verursachen",es:"Puede causar somnolencia",
    pt:"Pode causar sonolência",       tr:"Uykuya neden olabilir",
  },
  "do not drive": {
    th:"ห้ามขับรถ",                   lo:"ຫ້າມຂັບລົດ",
    my:"ကားမမောင်းပါနှင့်",            km:"ហាមបើកបរ",
    vi:"Không lái xe",                "zh-CN":"勿驾驶",        "zh-TW":"勿駕駛",
    ja:"運転しないでください",           ko:"운전하지 마세요",
    ar:"لا تقد السيارة",                hi:"वाहन न चलाएँ",
    id:"Jangan mengemudi",            ms:"Jangan memandu",
    ru:"Не садиться за руль",          fr:"Ne pas conduire",
    de:"Nicht Auto fahren",            es:"No conducir",
    pt:"Não dirigir",                  tr:"Araç kullanmayın",
  },
  "avoid alcohol": {
    th:"งดเครื่องดื่มแอลกอฮอล์",        lo:"ງົດເຄື່ອງດື່ມທີ່ມີແອວກໍຮໍ",
    my:"အရက်ရှောင်ပါ",                 km:"ជៀសវាងគ្រឿងស្រវឹង",
    vi:"Tránh rượu bia",               "zh-CN":"避免饮酒",      "zh-TW":"避免飲酒",
    ja:"アルコールを避けてください",       ko:"음주를 피하세요",
    ar:"تجنب الكحول",                   hi:"शराब से बचें",
    id:"Hindari alkohol",              ms:"Elakkan alkohol",
    ru:"Избегайте алкоголя",           fr:"Éviter l'alcool",
    de:"Alkohol vermeiden",            es:"Evitar el alcohol",
    pt:"Evitar álcool",                tr:"Alkolden kaçının",
  },
  "store in refrigerator": {
    th:"เก็บในตู้เย็น",                lo:"ເກັບໃນຕູ້ເຢັນ",
    my:"အအေးခန်းတွင်သိုလှောင်ပါ",      km:"រក្សាទុកក្នុងទូទឹកកក",
    vi:"Bảo quản trong tủ lạnh",       "zh-CN":"冷藏保存",      "zh-TW":"冷藏保存",
    ja:"冷蔵庫で保管",                  ko:"냉장 보관",
    ar:"يحفظ في الثلاجة",              hi:"रेफ्रिजरेटर में रखें",
    id:"Simpan di lemari es",          ms:"Simpan dalam peti sejuk",
    ru:"Хранить в холодильнике",       fr:"Conserver au réfrigérateur",
    de:"Im Kühlschrank aufbewahren",   es:"Conservar en el refrigerador",
    pt:"Conservar no refrigerador",    tr:"Buzdolabında saklayın",
  },
  "store at room temperature": {
    th:"เก็บที่อุณหภูมิห้อง",          lo:"ເກັບໄວ້ໃນອຸນຫະພູມຫ້ອງ",
    my:"အခန်းအပူချိန်တွင် သိုလှောင်ပါ",km:"រក្សាទុកក្នុងសីតុណ្ហភាពបន្ទប់",
    vi:"Bảo quản ở nhiệt độ phòng",    "zh-CN":"室温保存",      "zh-TW":"室溫保存",
    ja:"室温で保管",                    ko:"실온 보관",
    ar:"يحفظ في درجة حرارة الغرفة",    hi:"कमरे के तापमान पर रखें",
    id:"Simpan pada suhu kamar",       ms:"Simpan pada suhu bilik",
    ru:"Хранить при комнатной температуре",fr:"Conserver à température ambiante",
    de:"Bei Raumtemperatur aufbewahren",es:"Conservar a temperatura ambiente",
    pt:"Conservar à temperatura ambiente",tr:"Oda sıcaklığında saklayın",
  },
  "keep out of reach of children": {
    th:"เก็บให้พ้นมือเด็ก",            lo:"ເກັບໃຫ້ພົ້ນມືເດັກ",
    my:"ကလေးများလက်လှမ်းမမီရာတွင်ထားပါ",km:"ទុកឱ្យឆ្ងាយពីដៃកុមារ",
    vi:"Để xa tầm tay trẻ em",         "zh-CN":"放在儿童触不到的地方","zh-TW":"放在兒童觸不到的地方",
    ja:"小児の手の届かない所に保管",      ko:"어린이의 손이 닿지 않는 곳에 보관",
    ar:"يحفظ بعيداً عن متناول الأطفال",hi:"बच्चों की पहुँच से दूर रखें",
    id:"Jauhkan dari jangkauan anak-anak",ms:"Jauhkan dari capaian kanak-kanak",
    ru:"Хранить в недоступном для детей месте",fr:"Tenir hors de portée des enfants",
    de:"Außerhalb der Reichweite von Kindern aufbewahren",es:"Mantener fuera del alcance de los niños",
    pt:"Manter fora do alcance das crianças",tr:"Çocukların erişemeyeceği yerde saklayın",
  },
  "apply to affected area": {
    th:"ทาบริเวณที่เป็น",              lo:"ທາບໍລິເວນທີ່ເປັນ",
    my:"ထိခိုက်သောနေရာတွင် လိမ်းပါ",   km:"លាបលើតំបន់ដែលរងគ្រោះ",
    vi:"Bôi lên vùng bị bệnh",         "zh-CN":"涂抹于患处",   "zh-TW":"塗抹於患處",
    ja:"患部に塗布",                    ko:"환부에 바르세요",
    ar:"يوضع على المنطقة المصابة",     hi:"प्रभावित स्थान पर लगाएँ",
    id:"Oleskan pada area yang bermasalah",ms:"Sapukan pada kawasan yang terjejas",
    ru:"Нанести на поражённый участок",fr:"Appliquer sur la zone affectée",
    de:"Auf die betroffene Stelle auftragen",es:"Aplicar en la zona afectada",
    pt:"Aplicar na área afetada",      tr:"Etkilenen bölgeye uygulayın",
  },
  "inhale 1 puff": {
    th:"สูดดม 1 ครั้ง",                lo:"ສູດດົມ 1 ເທື່ອ",
    my:"တစ်ကြိမ် ရှူပါ",                km:"ស្រូប 1 ដង",
    vi:"Hít 1 lần",                    "zh-CN":"吸入1喷",      "zh-TW":"吸入1噴",
    ja:"1回吸入",                       ko:"1회 흡입",
    ar:"استنشق بخّة واحدة",             hi:"1 बार साँस लें",
    id:"Hirup 1 semprotan",            ms:"Sedut 1 semburan",
    ru:"Сделать 1 ингаляцию",           fr:"Inhaler 1 bouffée",
    de:"1 Hub inhalieren",              es:"Inhalar 1 pulverización",
    pt:"Inalar 1 jato",                 tr:"1 puf çekin",
  },
  "inhale 2 puffs": {
    th:"สูดดม 2 ครั้ง",                lo:"ສູດດົມ 2 ເທື່ອ",
    my:"နှစ်ကြိမ် ရှူပါ",               km:"ស្រូប 2 ដង",
    vi:"Hít 2 lần",                    "zh-CN":"吸入2喷",      "zh-TW":"吸入2噴",
    ja:"2回吸入",                       ko:"2회 흡입",
    ar:"استنشق بختين",                  hi:"2 बार साँस लें",
    id:"Hirup 2 semprotan",            ms:"Sedut 2 semburan",
    ru:"Сделать 2 ингаляции",           fr:"Inhaler 2 bouffées",
    de:"2 Hübe inhalieren",             es:"Inhalar 2 pulverizaciones",
    pt:"Inalar 2 jatos",                tr:"2 puf çekin",
  },
  "rinse mouth after use": {
    th:"บ้วนปากหลังใช้",                lo:"ບ້ວນປາກຫຼັງໃຊ້",
    my:"အသုံးပြုပြီးနောက် ပါးစပ်ပလုပ်ပါ",km:"ល្បាងមាត់ក្រោយប្រើ",
    vi:"Súc miệng sau khi dùng",       "zh-CN":"使用后漱口",   "zh-TW":"使用後漱口",
    ja:"使用後うがいをする",             ko:"사용 후 입을 헹구세요",
    ar:"اشطف الفم بعد الاستعمال",      hi:"उपयोग के बाद कुल्ला करें",
    id:"Berkumur setelah pemakaian",   ms:"Berkumur selepas penggunaan",
    ru:"Прополоскать рот после использования",fr:"Rincer la bouche après usage",
    de:"Mund nach Gebrauch ausspülen", es:"Enjuagar la boca después de usar",
    pt:"Enxaguar a boca após o uso",   tr:"Kullanım sonrası ağzı çalkalayın",
  },
  "take with food": {
    th:"รับประทานพร้อมอาหาร",          lo:"ກິນພ້ອມອາຫານ",
    my:"အစာနှင့်အတူ သောက်ပါ",          km:"ញ៉ាំជាមួយអាហារ",
    vi:"Uống cùng thức ăn",            "zh-CN":"随餐服用",     "zh-TW":"隨餐服用",
    ja:"食事と一緒に服用",              ko:"식사와 함께 복용",
    ar:"يؤخذ مع الطعام",                hi:"भोजन के साथ लें",
    id:"Minum bersama makanan",        ms:"Ambil bersama makanan",
    ru:"Принимать с едой",              fr:"Prendre avec de la nourriture",
    de:"Mit Nahrung einnehmen",         es:"Tomar con comida",
    pt:"Tomar com alimentos",           tr:"Yiyecekle birlikte alın",
  },
  "take on empty stomach": {
    th:"รับประทานตอนท้องว่าง",          lo:"ກິນຕອນທ້ອງເປົ່າ",
    my:"အစာအိမ်ဗလာဖြင့် သောက်ပါ",      km:"ញ៉ាំពេលក្រពះទទេ",
    vi:"Uống lúc đói",                  "zh-CN":"空腹服用",     "zh-TW":"空腹服用",
    ja:"空腹時に服用",                  ko:"공복에 복용",
    ar:"يؤخذ على معدة فارغة",          hi:"खाली पेट लें",
    id:"Minum saat perut kosong",      ms:"Ambil semasa perut kosong",
    ru:"Принимать натощак",             fr:"Prendre à jeun",
    de:"Auf nüchternen Magen einnehmen",es:"Tomar con el estómago vacío",
    pt:"Tomar com o estômago vazio",   tr:"Aç karnına alın",
  },
  "complete the full course": {
    th:"รับประทานยาให้ครบตามแพทย์สั่ง",lo:"ກິນຢາໃຫ້ຄົບຕາມໝໍສັ່ງ",
    my:"ဆေးကုသမှု အပြီးအထိ သောက်ပါ",   km:"ញ៉ាំឱ្យអស់តាមការណែនាំ",
    vi:"Uống đủ liều theo chỉ định",   "zh-CN":"按医嘱完成全程","zh-TW":"按醫囑完成全程",
    ja:"処方の最後まで服用",              ko:"처방대로 모두 복용",
    ar:"أكمل العلاج كاملاً",             hi:"पूरी खुराक पूरी करें",
    id:"Habiskan sesuai resep",         ms:"Habiskan mengikut preskripsi",
    ru:"Завершить полный курс",         fr:"Terminer tout le traitement",
    de:"Behandlung vollständig abschließen",es:"Completar el tratamiento completo",
    pt:"Completar o tratamento todo",   tr:"Tedaviyi tamamlayın",
  },
  "for nasal use only": {
    th:"ใช้ทางจมูกเท่านั้น",            lo:"ໃຊ້ທາງດັງເທົ່ານັ້ນ",
    my:"နှာခေါင်းသုံးသာ",                km:"ប្រើតាមច្រមុះតែប៉ុណ្ណោះ",
    vi:"Chỉ dùng cho mũi",              "zh-CN":"仅供鼻用",      "zh-TW":"僅供鼻用",
    ja:"鼻腔用のみ",                    ko:"비강용으로만 사용",
    ar:"للاستعمال الأنفي فقط",          hi:"केवल नाक के लिए",
    id:"Hanya untuk hidung",            ms:"Untuk kegunaan hidung sahaja",
    ru:"Только для назального применения",fr:"Voie nasale uniquement",
    de:"Nur zur nasalen Anwendung",     es:"Sólo para uso nasal",
    pt:"Apenas para uso nasal",         tr:"Sadece burun için",
  },
  "for eye use only": {
    th:"ใช้หยอดตาเท่านั้น",             lo:"ໃຊ້ຢອດຕາເທົ່ານັ້ນ",
    my:"မျက်စိအတွက်သာ",                 km:"សម្រាប់ភ្នែកតែប៉ុណ្ណោះ",
    vi:"Chỉ dùng cho mắt",              "zh-CN":"仅供眼用",      "zh-TW":"僅供眼用",
    ja:"点眼用のみ",                    ko:"점안용으로만 사용",
    ar:"للاستعمال في العين فقط",        hi:"केवल आँख के लिए",
    id:"Hanya untuk mata",              ms:"Untuk kegunaan mata sahaja",
    ru:"Только для глаз",                fr:"Voie ophtalmique uniquement",
    de:"Nur zur Anwendung am Auge",     es:"Sólo para uso oftálmico",
    pt:"Apenas para uso oftálmico",     tr:"Sadece göz için",
  },
};

function matchAuxiliaryPhrase(text, lang) {
  const t = text.trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
  // Pharmacist-curated overrides (src/features/pattern-editor, persisted server-side
  // to data/rx/pattern-overrides.json) take priority — they let new phrases be added
  // without a code deploy, and can also correct a built-in AUXILIARY_PHRASES entry.
  const overrideMap = (window.PATTERN_OVERRIDES || {})[t];
  if (overrideMap && overrideMap[lang]) return overrideMap[lang];
  const map = AUXILIARY_PHRASES[t];
  if (!map) return null;
  return map[lang] || null;
}

/* ═══════════════════════════════════════════════════════════════
 * INJECTION SUB-PATTERN
 *
 * Matches HIS injection rows like:
 *   "Inject 1200 mg IV every 8 hours"
 *   "Inject 500 mg Intravenously every dose"
 *   "Inject 100 units Subcutaneously twice daily"
 *
 * Output: per-language "Inject N <unit> via <route> [freq]"
 * ═══════════════════════════════════════════════════════════════ */
const INJECT_VERB = {
  th:"ฉีด",          lo:"ສັກ",          my:"ထိုးပါ",         km:"ចាក់",
  vi:"Tiêm",         "zh-CN":"注射",     "zh-TW":"注射",      ja:"注射",
  ko:"주사",          ar:"احقن",          hi:"इंजेक्ट करें",     id:"Suntikkan",
  ms:"Suntik",       ru:"Ввести",        fr:"Injecter",       de:"Injizieren",
  es:"Inyectar",     pt:"Injetar",       tr:"Enjekte edin",
};
const INJECT_ROUTE = {
  iv: {
    th:"เข้าหลอดเลือดดำ", lo:"ເຂົ້າເສັ້ນເລືອດດຳ", my:"သွေးကြောထဲ", km:"តាមសរសៃឈាម",
    vi:"tĩnh mạch",      "zh-CN":"静脉",          "zh-TW":"靜脈",         ja:"静脈内",
    ko:"정맥내",          ar:"وريدياً",            hi:"शिरा में",          id:"intravena",
    ms:"intravena",       ru:"внутривенно",        fr:"par voie IV",       de:"intravenös",
    es:"vía IV",          pt:"via IV",             tr:"damar yoluyla",
  },
  im: {
    th:"เข้ากล้ามเนื้อ",  lo:"ເຂົ້າກ້າມຊີ້ນ",      my:"ကြွက်သားထဲ",      km:"តាមសាច់ដុំ",
    vi:"bắp thịt",        "zh-CN":"肌肉",          "zh-TW":"肌肉",          ja:"筋肉内",
    ko:"근육내",           ar:"عضلياً",            hi:"मांसपेशी में",       id:"intramuskular",
    ms:"intramuskular",    ru:"внутримышечно",     fr:"par voie IM",       de:"intramuskulär",
    es:"vía IM",           pt:"via IM",            tr:"kas içine",
  },
  sc: {
    th:"ใต้ผิวหนัง",      lo:"ໃຕ້ຜິວໜັງ",          my:"အရေပြားအောက်",     km:"ក្រោមស្បែក",
    vi:"dưới da",         "zh-CN":"皮下",          "zh-TW":"皮下",         ja:"皮下",
    ko:"피하",            ar:"تحت الجلد",          hi:"त्वचा के नीचे",     id:"subkutan",
    ms:"subkutan",        ru:"подкожно",           fr:"par voie SC",       de:"subkutan",
    es:"vía SC",          pt:"via SC",             tr:"deri altına",
  },
};
const INJECT_RE = new RegExp([
  /^Inject\s+/,
  /(\d+(?:\.\d+)?)\s*/,                 // [1] dose number
  /(mg|g|mcg|units?|iu|ml|millilit(?:re|er))s?\s*/i,  // [2] dose unit
  /(?:(intravenous(?:ly)?|iv|intra-?venous|into\s+(?:the\s+)?vein|intramuscular(?:ly)?|im|intra-?muscular|subcutaneous(?:ly)?|sc|subq|subcutan|under\s+the\s+skin)\s*)?/i, // [3] route
  /(.*)$/i,                              // [4] remainder (frequency + timing)
].map(r => r.source).join(""), "i");

function _routeKey(routeRaw) {
  const r = (routeRaw || "").toLowerCase();
  if (/^iv$|intravenous|into\s+(?:the\s+)?vein/.test(r)) return "iv";
  if (/^im$|intramuscular/.test(r))                       return "im";
  if (/^sc$|subq|subcutan|under\s+the\s+skin/.test(r))    return "sc";
  return "";
}

function matchInjectionPattern(text, lang) {
  const m = text.trim().match(INJECT_RE);
  if (!m) return null;
  const dose       = m[1];
  const doseUnit   = (m[2] || "").toLowerCase().replace(/s$/, "");
  const routeKey   = _routeKey(m[3]);
  const remainder  = (m[4] || "").trim();

  const verb = INJECT_VERB[lang];
  if (!verb) return null;

  // Translate dose unit (mg/g/units/ml). Fall back to literal English.
  const DOSE_UNIT = {
    mg:    { th:"มก.", lo:"ມກ", "zh-CN":"毫克","zh-TW":"毫克",ja:"mg",ko:"mg" },
    g:     { th:"ก.",  lo:"ກຣາມ","zh-CN":"克",  "zh-TW":"克", ja:"g", ko:"g" },
    mcg:   { th:"มคก.",lo:"ມຄກ","zh-CN":"微克","zh-TW":"微克",ja:"mcg",ko:"mcg" },
    unit:  { th:"ยูนิต",lo:"ຢູນິດ","zh-CN":"单位","zh-TW":"單位",ja:"単位",ko:"단위" },
    iu:    { th:"IU",  lo:"IU",  "zh-CN":"国际单位","zh-TW":"國際單位",ja:"IU",ko:"IU" },
    ml:    { th:"มล.",  lo:"ມລ",  "zh-CN":"毫升","zh-TW":"毫升",ja:"ml",ko:"ml" },
  };
  const duKey = /^millilit/.test(doseUnit) ? "ml" : doseUnit;
  const duMap = DOSE_UNIT[duKey];
  const localDoseUnit = (duMap && duMap[lang]) || doseUnit;

  // Try to translate the remainder via _freq (covers "every 8 hours [when needed]")
  let freqStr = "";
  if (remainder) {
    const f = _freq(remainder, lang);
    if (f) freqStr = f;
  }

  const route = routeKey ? (INJECT_ROUTE[routeKey][lang] || "") : "";

  // Assemble per language. Thai/Lao native order: verb dose-amount route freq
  const parts = [verb, `${dose} ${localDoseUnit}`, route, freqStr].filter(Boolean);
  return parts.join(" ");
}

/* Public entry point used by translate-core.js.
 * opts.freqOverride — authoritative Thai frequency phrase (BKN frequency master)
 * that replaces the engine's own frequency translation in matchPattern. */
window.matchMedicalPattern = function(text, lang, opts = {}) {
  return matchAuxiliaryPhrase(text, lang)
      || matchInjectionPattern(text, lang)
      || matchPattern(text, lang, opts)
      || matchQtyPattern(text, lang)
      || null;
};

/* ═══════════════════════════════════════════════════════════════
 * WORD-LEVEL GLOSSARY (Layer 2 fallback)
 * Used by applyGlossary() in translate-core.js
 * ═══════════════════════════════════════════════════════════════ */

const BASE_EN = {
  "Take":"Take","Tablet":"Tablet","Tablets":"Tablets",
  "Capsule":"Capsule","Capsules":"Capsules",
  "Orally":"Orally","Once":"Once","Twice":"Twice",
  "Three Times":"Three Times","Daily":"Daily",
  "Before":"Before","After":"After",
  "Before meal":"Before meal","After meal":"After meal",
  "Morning":"Morning","Evening":"Evening","Night":"Night",
  "Spray":"Spray","Nasal":"Nasal","Nostril":"Nostril",
  "Drops":"Drops","Bottle":"Bottle","Apply":"Apply",
  "Inhale":"Inhale","For":"For","Days":"Days",
  "Hours":"Hours","Time":"Time","Every":"Every",
  "quarter tablet":"quarter tablet","half tablet":"half tablet",
  "three-quarter tablet":"three-quarter tablet"
};

const MEDICAL_GLOSSARY = {
  th:{...BASE_EN,
    "Take":"รับประทาน","Tablet":"เม็ด","Capsule":"แคปซูล",
    "Daily":"ทุกวัน","Morning":"ตอนเช้า","Evening":"ตอนเย็น","Night":"ตอนกลางคืน",
    "Spray":"พ่น","Nostril":"รูจมูก","Nasal":"ทางจมูก","Bottle":"ขวด",
    "Drops":"หยด","Apply":"ทา","Inhale":"สูดดม","Orally":"",
    "Before meal":"ก่อนอาหาร","After meal":"หลังอาหาร",
    "quarter tablet":"หนึ่งส่วนสี่เม็ด","half tablet":"ครึ่งเม็ด","three-quarter tablet":"สามส่วนสี่เม็ด"
  },
  lo:{...BASE_EN,
    "Take":"ກິນ","Tablet":"ເມັດ","Tablets":"ເມັດ",
    "Capsule":"ແຄັບຊູນ","Capsules":"ແຄັບຊູນ",
    "Daily":"ທຸກມື້","Once":"ຄັ້ງດຽວ","Twice":"ສອງເທື່ອ","Three Times":"ສາມເທື່ອ",
    "Morning":"ຕອນເຊົ້າ","Evening":"ຕອນແລງ","Night":"ຕອນກາງຄືນ",
    "Before":"ກ່ອນ","After":"ຫຼັງ",
    "Spray":"ພົ່ນ","Nostril":"ຮູດັງ","Nasal":"ທາງດັງ","Bottle":"ຂວດ",
    "Drops":"ຢອດ","Apply":"ທາ","Inhale":"ສູດດົມ","Orally":"",
    "Before meal":"ກ່ອນອາຫານ","After meal":"ຫຼັງອາຫານ",
    "For":"ເປັນເວລາ","Days":"ວັນ","Hours":"ຊົ່ວໂມງ","Time":"ເທື່ອ","Every":"ທຸກ",
    "quarter tablet":"ໜຶ່ງສ່ວນສີ່ເມັດ","half tablet":"ເຄິ່ງເມັດ","three-quarter tablet":"ສາມສ່ວນສີ່ເມັດ"
  },
  my:{...BASE_EN,
    "Take":"သောက်ပါ","Tablet":"ဆေးပြား","Capsule":"တောင့်",
    "Daily":"နေ့တိုင်း","Morning":"မနက်","Evening":"ညနေ","Night":"ည",
    "Orally":"ပါးစပ်မှ","Before meal":"ထမင်းမစားမီ","After meal":"ထမင်းစားပြီး"
  },
  km:{...BASE_EN,
    "Take":"ញ៉ាំ","Tablet":"គ្រាប់","Capsule":"កម្រៀប",
    "Daily":"រៀងរាល់ថ្ងៃ","Orally":"តាមមាត់",
    "Before meal":"មុនពេលញ៉ាំ","After meal":"ក្រោយពេលញ៉ាំ"
  },
  vi:{...BASE_EN,
    "Take":"Uống","Tablet":"Viên","Capsule":"Viên nang",
    "Daily":"Hàng ngày","Morning":"Buổi sáng","Evening":"Buổi tối",
    "Spray":"Xịt","Orally":"qua đường miệng",
    "Before meal":"trước bữa ăn","After meal":"sau bữa ăn"
  },
  id:{...BASE_EN,"Take":"Minum","Tablet":"tablet","Capsule":"kapsul","Daily":"setiap hari","Orally":"secara oral"},
  ms:{...BASE_EN,"Take":"Ambil","Tablet":"tablet","Capsule":"kapsul","Daily":"setiap hari","Orally":"secara oral"},
  tl:{...BASE_EN},
  "zh-CN":{...BASE_EN,"Take":"服用","Tablet":"片","Capsule":"粒","Daily":"每天","Morning":"早上","Evening":"晚上","Orally":"口服"},
  "zh-TW":{...BASE_EN,"Take":"服用","Tablet":"錠","Capsule":"粒","Daily":"每天","Morning":"早上","Evening":"晚上","Orally":"口服"},
  ja:{...BASE_EN,"Take":"服用","Tablet":"錠","Capsule":"カプセル","Daily":"毎日","Morning":"朝","Evening":"夕方","Orally":"経口"},
  ko:{...BASE_EN,"Take":"복용","Tablet":"정","Capsule":"캡슐","Daily":"매일","Morning":"아침","Evening":"저녁","Orally":"경구"},
  mn:{...BASE_EN},
  hi:{...BASE_EN,"Take":"लें","Tablet":"गोली","Capsule":"कैप्सूल","Daily":"प्रतिदिन","Morning":"सुबह","Evening":"शाम","Orally":"मुँह से"},
  bn:{...BASE_EN},ur:{...BASE_EN},ta:{...BASE_EN},te:{...BASE_EN},
  ml:{...BASE_EN},kn:{...BASE_EN},si:{...BASE_EN},ne:{...BASE_EN},
  ar:{...BASE_EN,"Take":"تناول","Tablet":"قرص","Capsule":"كبسولة","Daily":"يومياً","Morning":"صباحاً","Evening":"مساءً","Orally":"عن طريق الفم"},
  fa:{...BASE_EN},he:{...BASE_EN},
  tr:{...BASE_EN,"Take":"Alın","Tablet":"tablet","Capsule":"kapsül","Daily":"günlük","Morning":"sabah","Evening":"akşam","Orally":"ağız yoluyla"},
  en:{...BASE_EN},de:{...BASE_EN},fr:{...BASE_EN},es:{...BASE_EN},
  pt:{...BASE_EN},it:{...BASE_EN},nl:{...BASE_EN},pl:{...BASE_EN},
  cs:{...BASE_EN},sk:{...BASE_EN},hu:{...BASE_EN},ro:{...BASE_EN},
  bg:{...BASE_EN},el:{...BASE_EN},uk:{...BASE_EN},ru:{...BASE_EN},
  sv:{...BASE_EN},da:{...BASE_EN},fi:{...BASE_EN},no:{...BASE_EN},
  "pt-BR":{...BASE_EN},ht:{...BASE_EN}
};

window.MEDICAL_GLOSSARY = MEDICAL_GLOSSARY;
