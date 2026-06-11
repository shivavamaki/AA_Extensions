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

// Unit translation: "tablet"/"capsule"/"drop"/"spray"/"ml"
function _unit(raw, lang, count) {
  const r = raw.toLowerCase().replace(/s$/, ""); // singularise
  const UNITS = {
    tablet:  { th:"เม็ด", lo:"ເມັດ", my:"မှ",   km:"គ្រាប់", vi:"viên",   "zh-CN":"片", "zh-TW":"錠",  ja:"錠",    ko:"정",   ar:"قرص",   hi:"गोली",  id:"tablet", ms:"tablet", ru:"таблетку", fr:"comprimé", de:"Tablette", es:"comprimido", pt:"comprimido", tr:"tablet" },
    capsule: { th:"แคปซูล", lo:"ແຄັບຊູນ", my:"ကပ်ဆူး", km:"កម្រៀប",  vi:"viên nang","zh-CN":"粒", "zh-TW":"粒",  ja:"カプセル",ko:"캡슐", ar:"كبسولة", hi:"कैप्सूल",id:"kapsul",ms:"kapsul", ru:"капсулу",  fr:"gélule",  de:"Kapsel",    es:"cápsula",    pt:"cápsula",   tr:"kapsül" },
    drop:    { th:"หยด",   lo:"ຢອດ",  my:"မျက်",  km:"ដំណក់",  vi:"giọt",  "zh-CN":"滴", "zh-TW":"滴",  ja:"滴",    ko:"방울",ar:"قطرة",  hi:"बूँद",  id:"tetes",  ms:"titik",  ru:"каплю",   fr:"goutte",  de:"Tropfen",   es:"gota",       pt:"gota",      tr:"damla" },
    spray:   { th:"ครั้ง", lo:"ເທື່ອ",my:"ကြိမ်", km:"ដង",     vi:"lần",   "zh-CN":"喷", "zh-TW":"噴",  ja:"回",    ko:"번",  ar:"رشة",   hi:"स्प्रे",id:"semprotan",ms:"semburan",ru:"вдох",  fr:"bouffée", de:"Hub",       es:"pulverización",pt:"pulverização",tr:"puf" },
    ml:       { th:"มล.",  lo:"ມລ",   my:"မီလီ",  km:"មីលីលីត្រ",vi:"ml",  "zh-CN":"毫升","zh-TW":"毫升",ja:"ml",   ko:"ml",  ar:"مل",    hi:"मिली",  id:"ml",     ms:"ml",     ru:"мл",      fr:"ml",      de:"ml",        es:"ml",         pt:"ml",        tr:"ml" },
  };
  // Aliases: millilitre / milliliter / millitre all → ml
  const aliases = { millilitre:"ml", milliliter:"ml", millitre:"ml", millilitr:"ml", litre:"ml", liter:"ml" };
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
    "every 4 hours":     { th:"ทุก 4 ชั่วโมง",  lo:"ທຸກໆ 4 ຊົ່ວໂມງ",my:"နာရီ 4 ကြိမ်တစ်",  km:"រៀងរាល់ 4 ម៉ោង",vi:"mỗi 4 giờ",     "zh-CN":"每4小时",   "zh-TW":"每4小時",  ja:"4時間毎",  ko:"4시간마다",ar:"كل 4 ساعات",     hi:"हर 4 घंटे",    id:"setiap 4 jam",   ms:"setiap 4 jam",   ru:"каждые 4 часа",    fr:"toutes les 4 heures", de:"alle 4 Stunden",    es:"cada 4 horas",      tr:"her 4 saatte" },
    "every 6 hours":     { th:"ทุก 6 ชั่วโมง",  lo:"ທຸກໆ 6 ຊົ່ວໂມງ",my:"နာရီ 6 ကြိမ်တစ်",  km:"រៀងរាល់ 6 ម៉ោង",vi:"mỗi 6 giờ",     "zh-CN":"每6小时",   "zh-TW":"每6小時",  ja:"6時間毎",  ko:"6시간마다",ar:"كل 6 ساعات",     hi:"हर 6 घंटे",    id:"setiap 6 jam",   ms:"setiap 6 jam",   ru:"каждые 6 часов",   fr:"toutes les 6 heures", de:"alle 6 Stunden",    es:"cada 6 horas",      tr:"her 6 saatte" },
    "every 8 hours":     { th:"ทุก 8 ชั่วโมง",  lo:"ທຸກໆ 8 ຊົ່ວໂມງ",my:"နာရီ 8 ကြိမ်တစ်",  km:"រៀងរាល់ 8 ម៉ោង",vi:"mỗi 8 giờ",     "zh-CN":"每8小时",   "zh-TW":"每8小時",  ja:"8時間毎",  ko:"8시간마다",ar:"كل 8 ساعات",     hi:"हर 8 घंटे",    id:"setiap 8 jam",   ms:"setiap 8 jam",   ru:"каждые 8 часов",   fr:"toutes les 8 heures", de:"alle 8 Stunden",    es:"cada 8 horas",      tr:"her 8 saatte" },
    "every 12 hours":    { th:"ทุก 12 ชั่วโมง", lo:"ທຸກໆ 12 ຊົ່ວໂມງ",my:"နာရီ 12 ကြိမ်တစ်",km:"រៀងរាល់ 12 ម៉ោង",vi:"mỗi 12 giờ",   "zh-CN":"每12小时",  "zh-TW":"每12小時", ja:"12時間毎", ko:"12시간마다",ar:"كل 12 ساعة",   hi:"हर 12 घंटे",   id:"setiap 12 jam",  ms:"setiap 12 jam",  ru:"каждые 12 часов",  fr:"toutes les 12 heures",de:"alle 12 Stunden",  es:"cada 12 horas",     tr:"her 12 saatte" },
    "once a week":       { th:"สัปดาห์ละ 1 ครั้ง",lo:"ອາທິດລະ 1 ເທື່ອ",my:"တစ်ပတ် တစ်ကြိမ်",km:"ម្តងក្នុងមួយសប្តាហ៍",vi:"1 lần/tuần","zh-CN":"每周一次","zh-TW":"每週一次",ja:"週1回",   ko:"주 1회",  ar:"مرة في الأسبوع", hi:"सप्ताह में एक बार",id:"sekali seminggu",ms:"sekali seminggu",ru:"один раз в неделю",fr:"une fois par semaine",de:"einmal wöchentlich",es:"una vez a la semana",tr:"haftada bir kez" },
    "once at bedtime":   { th:"วันละ 1 ครั้ง ก่อนนอน",lo:"ກ່ອນນອນ 1 ເທື່ອ",my:"အိပ်ရာမဝင်မီ တစ်ကြိမ်",km:"មុនពេលគេង 1 ដង",vi:"1 lần trước khi ngủ","zh-CN":"睡前一次","zh-TW":"睡前一次",ja:"就寝前1回",ko:"취침 전 1회",ar:"مرة واحدة عند النوم",hi:"सोने से पहले एक बार",id:"sekali sebelum tidur",ms:"sekali sebelum tidur",ru:"один раз перед сном",fr:"une fois au coucher",de:"einmal zur Schlafenszeit",es:"una vez al acostarse",tr:"yatmadan önce bir kez" },
  };
  // Normalise input
  const norm = r
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
  const map = FREQ[norm];
  if (!map) return null;
  return map[lang] || null;
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

// Route: take N unit(s) orally
function _take(n, unit, lang) {
  const TAKE = {
    th:  (n, u) => `รับประทาน ${n} ${u} ทางปาก`,
    lo:  (n, u) => `ກິນ ${n} ${u} ທາງປາກ`,
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
  const fn = TAKE[lang];
  if (!fn) return null;
  return fn(n, _unit(unit, lang, n));
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
// "Take N Unit(s) Orally FREQ TIMING For D Days"
// Each group optional except N and unit
const MASTER_RE = new RegExp(
  [
    /^Take\s+/,
    /(\d+(?:\.\d+)?|\bquarter\b|\bhalf\b|\bthree-quarter\b)\s+/,  // [1] qty
    /(tablet|capsule|drop|spray|ml|millilit(?:re|er)|millilitr)s?\s*/i,   // [2] unit (+ millilitre)
    /(?:orally\s*)?/i,
    // [3] freq: "N times a day" OR canonical forms
    /(\d+\s+times?\s+(?:a\s+)?day|once\s+daily|twice\s+daily|\d+\s+times?\s+daily|every\s+\d+\s+hours?|once\s+a\s+week|at\s+bedtime|once\s+at\s+bedtime)?\s*/i,
    // [4] compound or simple timing (greedy — capture everything before "For N days")
    /((?:(?:morning|noon|evening|night|bedtime|breakfast|lunch|dinner|meal)(?:\s+(?:and\s+)?)?)+(?:before\s+|after\s+|with\s+|at\s+|in\s+the\s+)?(?:morning|noon|evening|night|bedtime|breakfast|lunch|dinner|meal)?|before\s+breakfast|after\s+breakfast|before\s+lunch|after\s+lunch|before\s+dinner|after\s+dinner|before\s+meal|after\s+meal|with\s+meal|before\s+bedtime|at\s+bedtime|in\s+the\s+morning|in\s+the\s+evening|at\s+night|when\s+needed|as\s+needed)?\s*/i,
    /(?:for\s+(\d+)\s+days?)?\s*$/i,                                    // [5] days
  ].map(r => r.source).join(""),
  "i"
);

function matchPattern(text, lang) {
  const t = text.trim();
  const m = t.match(MASTER_RE);
  if (!m) return null;

  const rawQty    = m[1] || "1";
  const rawUnit   = m[2] || "tablet";
  const rawFreq   = (m[3] || "").trim();
  const rawTiming = (m[4] || "").trim();
  const rawDays   = m[5] || "";

  // Resolve quantity (handle fractions)
  let qty = rawQty;
  if (/^quarter$/i.test(qty))        qty = "¼";
  else if (/^half$/i.test(qty))      qty = "½";
  else if (/^three.quarter$/i.test(qty)) qty = "¾";

  // Build sentence parts
  const takePart   = _take(qty, rawUnit, lang);
  if (!takePart) return null;

  const freqPart   = rawFreq   ? _freq(rawFreq, lang)        : null;
  // Try compound timing first, fall back to single timing
  const timingPart = rawTiming
    ? (_compoundTiming(rawTiming, lang) || _timing(rawTiming, lang))
    : null;
  const daysPart   = rawDays   ? _days(rawDays, lang)        : null;

  // Assemble — language-specific word order
  const ASSEMBLERS = {
    // Thai: รับประทาน N เม็ด ทางปาก [freq] [timing] [days]
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

// Quantity-only pattern: "N Tablet(s)" / "N Capsule(s)"
const QTY_RE = /^(\d+(?:\.\d+)?)\s+(tablet|capsule|drop|spray|ml|millilit(?:re|er)|millilitr)s?$/i;

function matchQtyPattern(text, lang) {
  const m = text.trim().match(QTY_RE);
  if (!m) return null;
  const n = m[1];
  // Normalise millilitre variants → "ml" for _unit lookup
  const unitRaw = m[2].toLowerCase().replace(/s$/, "");
  const unitKey = /^millilit/.test(unitRaw) ? "ml" : unitRaw;
  const u = _unit(unitKey, lang, parseInt(n));
  // Language-specific qty+unit order
  const QTY_TMPL = {
    ja: (n, u) => `${n}${u}`,
    ko: (n, u) => `${n}${u}`,
    "zh-CN": (n, u) => `${n}${u}`,
    "zh-TW": (n, u) => `${n}${u}`,
  };
  const fn = QTY_TMPL[lang] || ((n, u) => `${n} ${u}`);
  return fn(n, u);
}

/* Public entry point used by translate-core.js */
window.matchMedicalPattern = function(text, lang) {
  return matchPattern(text, lang) || matchQtyPattern(text, lang) || null;
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
    "Drops":"หยด","Apply":"ทา","Inhale":"สูดดม","Orally":"ทางปาก",
    "Before meal":"ก่อนอาหาร","After meal":"หลังอาหาร",
    "quarter tablet":"หนึ่งส่วนสี่เม็ด","half tablet":"ครึ่งเม็ด","three-quarter tablet":"สามส่วนสี่เม็ด"
  },
  lo:{...BASE_EN,
    "Take":"ກິນ","Tablet":"ເມັດ","Capsule":"ແຄັບຊູນ",
    "Daily":"ທຸກມື້","Morning":"ຕອນເຊົ້າ","Evening":"ຕອນແລງ",
    "Spray":"ພົ່ນ","Nostril":"ຮູດັງ","Nasal":"ທາງດັງ","Bottle":"ຂວດ",
    "Drops":"ຢອດ","Apply":"ທາ","Inhale":"ສູດດົມ","Orally":"ທາງປາກ",
    "Before meal":"ກ່ອນອາຫານ","After meal":"ຫຼັງອາຫານ",
    "quarter tablet":"ໜຶ່ງສ່ວນສີ່ເມັດ","half tablet":"ເຄິ່ງເມັດ"
  },
  my:{...BASE_EN,
    "Take":"သောက်ပါ","Tablet":"မှ","Capsule":"ကပ်ဆူး",
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
