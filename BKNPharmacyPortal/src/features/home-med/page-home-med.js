"use strict";

/**
 * features/home-med/page-home-med.js
 *
 * Flow:
 *   1. Receive { context } (patient/report UIDs) via LOAD_MED_TABLE message or
 *      chrome.storage.session (payload_sheet).
 *   2. POST /api/report/home-med-api → server hits ArcusAir getallorderitem
 *      (DISCHARGE MEDICATION) + getallergies; returns { patient, meds, allergies }.
 *   3. Render the A4 layout. Drug photos from GET /med-image/{code} via BKNData.
 */

const { norm, escapeHtml, safeSetText } = window.CoreDom;
const { MSG } = window.CoreMessages;

/** Like norm() but PRESERVES newlines — the note-line is multi-line
 * (administrationinstruction + Patient Instruction). Collapses runs of spaces/
 * tabs, trims each line, and drops blank lines, but keeps the "\n" separators. */
function normMultiline(s) {
  return String(s || "")
    .replace(/ /g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** Today's date as an <input type="date"> value (YYYY-MM-DD, local time). */
function _todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

/** Format an ISO date (YYYY-MM-DD) as DD-MM-YYYY for the printed text view.
 * Returns "" for an empty/invalid value. */
function _fmtDateDMY(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || "").trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// Max day columns in the continued-med calendar grid. A start→end run longer
// than this is clamped so the grid never overflows the page width.
const CONTINUE_MAX_DAYS = 10;

/** Enumerate the day columns of a start→end run as { day, mon } labels.
 * Falls back to a short blank run when dates are missing/invalid so the header
 * still renders empty tick columns for the patient to fill in by hand. */
function _continueDayColumns(startIso, endIso) {
  const parse = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "").trim());
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };
  const start = parse(startIso);
  const end = parse(endIso);
  const cols = [];
  const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const pushDay = (d) => cols.push({
    day: String(d.getDate()).padStart(2, "0"),
    mon: String(d.getMonth() + 1).padStart(2, "0"),
    iso: isoOf(d),
  });
  if (start && end && end >= start) {
    // Full labelled run start → end (clamped to the max width).
    for (let d = new Date(start); d <= end && cols.length < CONTINUE_MAX_DAYS; d.setDate(d.getDate() + 1)) pushDay(d);
  } else if (start) {
    // Start only, no end: label a default span forward from the start date.
    const d = new Date(start);
    for (let i = 0; i < 5; i++) { pushDay(d); d.setDate(d.getDate() + 1); }
  } else {
    // No usable dates: a few unlabelled blank tick columns (keyed by position).
    for (let i = 0; i < 5; i++) cols.push({ day: "", mon: "", iso: `blank${i}` });
  }
  return cols;
}

let _context = null;
let _medDbByCode = null;
let _medDbLoadPromise = null;

/* ───────────────────────── Server access (BKNData) ─────────────────────── */
async function _serverBase() {
  try {
    if (window.BKNData && window.BKNData.getServerUrl) {
      return (await window.BKNData.getServerUrl()) || "";
    }
  } catch (_) { /* ignore */ }
  return "";
}

async function _loadMedicationDatabase() {
  if (_medDbByCode) return _medDbByCode;
  if (_medDbLoadPromise) return _medDbLoadPromise;

  _medDbLoadPromise = (async () => {
    try {
      if (window.BKNData && window.BKNData.serverFetch) {
        const r = await window.BKNData.serverFetch("/api/medication-db");
        if (r && r.ok && r.json) { _medDbByCode = r.json; return _medDbByCode; }
      }
    } catch (_) { /* server unavailable */ }
    _medDbByCode = {};
    return _medDbByCode;
  })();

  return _medDbLoadPromise;
}

/* Pharmacist-curated phrase overrides (src/features/pattern-editor) — layered
 * in front of the hardcoded AUXILIARY_PHRASES in medical-glossary.js so new
 * instruction phrases can be added without a code deploy. Best-effort: a
 * server-fetch failure just means no overrides apply, never blocks the sheet. */
let _patternOverridesLoadPromise = null;
async function _loadPatternOverrides() {
  if (_patternOverridesLoadPromise) return _patternOverridesLoadPromise;
  _patternOverridesLoadPromise = (async () => {
    try {
      if (window.BKNData && window.BKNData.serverFetch) {
        const r = await window.BKNData.serverFetch("/api/pattern-overrides");
        if (r && r.ok && r.json) { window.PATTERN_OVERRIDES = r.json; return; }
      }
    } catch (_) { /* server unavailable */ }
    window.PATTERN_OVERRIDES = window.PATTERN_OVERRIDES || {};
  })();
  return _patternOverridesLoadPromise;
}

/* ── Name index for image lookup + add-item autocomplete ────────────────────
 * The med DB is keyed by item code, but RT_COMMON_286 gives only drug names,
 * and user-added items are names too. Build a normalized name → entry index.
 */
let _medNameIndex = null;   // [{ key, name, code, hasImage }]
function _normName(s) {
  return norm(s || "").toLowerCase().replace(/[^a-z0-9ก-๙]+/g, " ").trim();
}
function _buildNameIndex() {
  if (_medNameIndex) return _medNameIndex;
  const db = _medDbByCode || {};
  _medNameIndex = [];
  for (const code of Object.keys(db)) {
    const e = db[code] || {};
    const name = norm(e.name || "");
    if (!name) continue;
    _medNameIndex.push({
      key: _normName(name),
      name,
      code: norm(e.code || code),
      hasImage: !!e.has_image,
    });
  }
  return _medNameIndex;
}

// Dosage-form / unit / noise words that should NOT drive a name match.
const _NAME_STOPWORDS = new Set([
  "tablet", "tablets", "tab", "tabs", "capsule", "capsules", "cap", "caps",
  "injection", "inj", "vial", "amp", "ampoule", "syrup", "syr", "solution",
  "susp", "suspension", "spray", "drop", "drops", "cream", "gel", "ointment",
  "mg", "mcg", "ml", "g", "gm", "unit", "units", "iu", "bag", "bottle",
  "sachet", "tube", "the", "of", "in", "and", "for",
]);

/** Significant tokens of a drug name (drop form/unit noise; keep dose numbers). */
function _nameTokens(name) {
  return _normName(name).split(" ").filter((t) => t && !_NAME_STOPWORDS.has(t));
}

/**
 * Best DB entry for a drug name. Exact normalized match first; otherwise score
 * candidates by shared significant tokens (brand/generic + dose number), so
 * "Sporal (100 Mg) Capsule" matches "Sporal 100 Mg Cap".
 */
function _lookupByName(drugName) {
  const idx = _buildNameIndex();
  const q = _normName(drugName);
  if (!q) return null;

  // 1) exact / prefix on the fully-normalized string.
  let hit = idx.find((e) => e.key === q);
  if (hit) return hit;

  const qTokens = _nameTokens(drugName);
  if (!qTokens.length) return null;
  const qSet = new Set(qTokens);
  const qFirst = qTokens[0];

  let best = null;
  let bestScore = 0;
  for (const e of idx) {
    const eTokens = _nameTokens(e.name);
    if (!eTokens.length) continue;
    // Require the leading (brand/generic) token to match — avoids cross-drug hits.
    if (eTokens[0] !== qFirst && !qSet.has(eTokens[0])) continue;
    let shared = 0;
    for (const t of eTokens) if (qSet.has(t)) shared += 1;
    // Normalize by the larger token count so partial names still score well.
    const score = shared / Math.max(qTokens.length, eTokens.length);
    if (score > bestScore) { bestScore = score; best = e; }
  }
  // Require a reasonable overlap to avoid false positives.
  return bestScore >= 0.5 ? best : null;
}

/** Up to `limit` name suggestions for the add-item search box. */
function _searchMeds(query, limit = 12) {
  const idx = _buildNameIndex();
  const q = _normName(query);
  if (q.length < 2) return [];
  const starts = [];
  const contains = [];
  for (const e of idx) {
    if (e.key.startsWith(q)) starts.push(e);
    else if (e.key.includes(q)) contains.push(e);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

let _medImagesBase = "";
/** Image URL candidates for a med, matched by item code (preferred) or name. */
function _medicineImageCandidates(med) {
  const base = _medImagesBase;
  const candidates = [];
  if (!base) return candidates;

  // 1) explicit code on the med (user-added items carry it)
  let code = norm(med?.code || "");
  // 2) otherwise resolve by drug name against the DB
  if (!code && med?.drug) {
    const hit = _lookupByName(med.drug);
    if (hit && hit.hasImage) code = hit.code;
  }
  if (code) {
    // The server resolves the extension for us (jpg/jpeg/png/jfif/webp/gif/jxl…),
    // so a single by-code URL is enough — no client-side extension guessing.
    candidates.push(`${base}/med-image/${encodeURIComponent(code)}`);
  }
  return [...new Set(candidates)];
}

/* ─────────────────────────── Patient header ───────────────────────────── */
/** All distinct prescribing physicians across the discharge meds, in the
 * order they first appear (a visit can have more than one provider). */
function _uniquePhysicians(meds) {
  const seen = new Set();
  const list = [];
  (meds || []).forEach((m) => {
    const p = norm(m.provider || "");
    if (p && !seen.has(p)) { seen.add(p); list.push(p); }
  });
  return list;
}

function populateHeader(header, context, meds) {
  const h = header || {};
  const c = context || {};
  // Physician isn't in the report header; collect every distinct provider
  // across the discharge meds (a visit can involve more than one) and show
  // them inline, above Diagnosis, comma-separated.
  const physicians = _uniquePhysicians(meds);
  safeSetText("patientName", h.patientName || c.patientName || "-");
  safeSetText("patientHN",   h.hn || c.hn || c.patientId || "-");
  safeSetText("patientAN",   h.an || c.an || c.patientVisitId || "-");
  safeSetText("patientRoom", h.room || c.bed || "-");
  safeSetText("sheetDate",   h.visitDate || new Date().toLocaleDateString("th-TH"));
  safeSetText("pharmacistCheckedName", c.pharmacistName || "-");
  safeSetText("physicianNameTop", physicians.length ? physicians.join(", ") : "-");
}

/* ─────────────────────── Diagnosis + Allergy banner ───────────────────── */
function renderDiagnosis(diagnosis) {
  const line = document.getElementById("dxLine");
  const valEl = document.getElementById("diagnosisValue");
  if (!line || !valEl) return;
  const dx = norm(diagnosis || "");
  if (dx) {
    valEl.textContent = dx;
    line.classList.remove("empty");
  } else {
    // No diagnosis available → hide the diagnosis line (allergy line remains).
    line.classList.add("empty");
  }
}

function renderAllergies(allergies) {
  const banner = document.getElementById("allergyBanner");
  const valEl = document.getElementById("allergyValue");
  if (!banner || !valEl) return;

  const a = allergies || {};
  const items = Array.isArray(a.items) ? a.items : [];

  if (items.length) {
    // Has allergies → red banner listing allergen (reaction).
    banner.classList.remove("nkda");
    valEl.textContent = items
      .map((it) => it.reaction ? `${it.allergen} (${it.reaction})` : it.allergen)
      .filter(Boolean)
      .join(", ") || "มีประวัติแพ้ยา (see chart)";
  } else if (a.nkda) {
    banner.classList.add("nkda");
    valEl.textContent = "No Known Drug Allergies (ไม่มีประวัติแพ้ยา)";
  } else {
    // No record / couldn't fetch → neutral, don't claim NKDA.
    banner.classList.add("nkda");
    valEl.textContent = "ไม่มีข้อมูลแพ้ยา (allergy info unavailable)";
  }
}

const _NO_APPOINTMENT_TEXT =
  'ไม่มีนัดติดตามอาการ ' +
  'แต่ถ้าพบอาการผิดปรกติหรืออาการแย่ลง ' +
  'แนะนำให้กลับมาพบแพทย์เพื่อตรวจเพิ่มเติม';

/** Render the appointment box as one card per appointment.
 * Server joins appointments with "\n"; each appointment has two tab-separated
 * parts: row1 = date/time, row2 = dept/provider/notes.
 * Each card gets a remove button that hides it (print-hidden). */
function renderAppointments(text) {
  const el = document.getElementById("appointmentList");
  if (!el) return;
  el.innerHTML = "";

  const lines = (text || "").split("\n").map((l) => norm(l)).filter(Boolean);
  if (!lines.length) lines.push(_NO_APPOINTMENT_TEXT);

  const isEmptyState = lines.length === 1 && lines[0] === _NO_APPOINTMENT_TEXT;
  lines.forEach((line) => {
    const div = document.createElement("div");
    if (isEmptyState) {
      div.className = "appt-item empty";
      div.textContent = line;
    } else {
      div.className = "appt-item";
      const parts = line.split("\t");
      const row1 = norm(parts[0] || "");
      const row2 = norm(parts[1] || "");

      const btn = document.createElement("button");
      btn.className = "appt-remove";
      btn.title = "ลบรายการนี้";
      btn.textContent = "×";
      btn.onclick = () => {
        div.remove();
        if (el.children.length === 0) {
          const empty = document.createElement("div");
          empty.className = "appt-item empty";
          empty.textContent = _NO_APPOINTMENT_TEXT;
          el.appendChild(empty);
        }
      };

      const body = document.createElement("div");
      body.className = "appt-body";
      if (row1) {
        const r1 = document.createElement("div");
        r1.className = "appt-row1";
        r1.textContent = row1;
        body.appendChild(r1);
      }
      if (row2) {
        const r2 = document.createElement("div");
        r2.className = "appt-row2";
        r2.textContent = row2;
        body.appendChild(r2);
      }
      div.appendChild(btn);
      div.appendChild(body);
    }
    el.appendChild(div);
  });
}

/* ─────────────────────────── Med image binding ────────────────────────── */
function _renderNoImageSlot(icon) {
  return `<span class="med-photo-icon">${icon}</span><span class="med-photo-label">รูปยา</span>`;
}

// Pick a dosage-form emoji from the drug name / instruction / quantity text.
// Ordered most-specific → least; the first matching pattern wins.
const _FORM_ICONS = [
  // Injections
  [/\b(injection|inj\b|vial|ampoule|ampul|amp\b|syringe|prefilled|pen\b|subcut|s\.?c\.?\b|intramuscular|i\.?m\.?\b|intravenous|i\.?v\.?\b|inject)\b/i, "💉"],
  // Eye / ear / nasal
  [/\b(eye|ophthalmic|ophth)\b/i, "👁️"],
  [/\b(ear|otic)\b/i, "👂"],
  [/\b(nasal|nose|nostril|intranasal)\b/i, "👃"],
  // Inhaled
  [/\b(inhaler|inhalation|inhale|mdi|turbuhaler|accuhaler|evohaler|respule|nebul|nebule|puff|dpi|hfa)\b/i, "🫁"],
  // Topical (gel matches emulgel/hydrogel too)
  [/\b(cream|lotion|ointment|topical|paste|balm|apply to (the )?(skin|area)|external use)\b/i, "🧴"],
  [/gel\b/i, "🧴"],
  // Suppository / rectal / vaginal
  [/\b(suppositor|rectal|pessary|vaginal|per rectum|pr\b)\b/i, "💊"],
  // Patch
  [/\b(patch|transdermal)\b/i, "🩹"],
  // Oral solids
  [/\b(tablet|tab\b|capsule|cap\b|caplet|chewable|lozenge|troche|sublingual|orodispersible|odt)\b/i, "💊"],
  // Liquids (oral)
  [/\b(syrup|syr\b|solution|suspension|susp\b|elixir|drop|drops|sachet|powder|granule|ml|millilit(re|er)|bottle|mixture|liquid)\b/i, "🧪"],
];

function _medicineIcon(med) {
  const text = `${med?.drug || ""} ${med?.instruction || ""} ${med?.note || ""} ${med?.dosage || ""} ${med?.quantity || ""}`.toLowerCase();
  for (const [re, icon] of _FORM_ICONS) {
    if (re.test(text)) return icon;
  }
  return "💊";   // default: oral
}

// Rank a med's dosage-form icon in the _FORM_ICONS priority order, so grouping
// by form follows that intentional order (injections → eye/ear → oral → …)
// rather than emoji codepoint order. Icons not listed (incl. the "💊" default)
// sort last but stay grouped together.
const _FORM_ICON_RANK = (() => {
  const rank = {};
  _FORM_ICONS.forEach(([, icon], i) => { if (!(icon in rank)) rank[icon] = i; });
  return rank;
})();
function _medicineFormRank(med) {
  const icon = _medicineIcon(med);
  return (icon in _FORM_ICON_RANK) ? _FORM_ICON_RANK[icon] : _FORM_ICONS.length;
}

function _buildMedicinePhotoSlot(med, candidates) {
  const icon = _medicineIcon(med);
  if (candidates && candidates.length) {
    return `
      <div class="med-photo-slot has-image" data-fallback-icon="${escapeHtml(icon)}">
        <img class="med-photo" data-img-index="0" data-img-candidates="${escapeHtml(encodeURIComponent(JSON.stringify(candidates)))}" alt="Medicine picture" />
      </div>`;
  }
  return `<div class="med-photo-slot no-image" aria-label="Medicine picture placeholder">${_renderNoImageSlot(icon)}</div>`;
}

function _bindMedicineImageFallbacks(root) {
  if (!root) return;
  root.querySelectorAll("img.med-photo[data-img-candidates]").forEach((img) => {
    let candidates = [];
    try { candidates = JSON.parse(decodeURIComponent(img.dataset.imgCandidates || "%5B%5D")); }
    catch (_e) { candidates = []; }
    if (!candidates.length) return;

    img.addEventListener("error", () => {
      const nextIndex = Number(img.dataset.imgIndex || "0") + 1;
      if (nextIndex < candidates.length) {
        img.dataset.imgIndex = String(nextIndex);
        img.src = candidates[nextIndex];
        return;
      }
      const slot = img.closest(".med-photo-slot");
      if (!slot) return;
      const icon = slot.dataset.fallbackIcon || "💊";
      slot.classList.remove("has-image");
      slot.classList.add("no-image");
      slot.innerHTML = _renderNoImageSlot(icon);
    });
    img.src = candidates[0];
  });
}

/* ───────────────────────── Instruction text ───────────────────────────── */
function _cleanValue(value) {
  return norm(value).replace(/^[-–—]+$/, "");
}

/** Compose the default instruction text shown/edited in the How-to-take cell.
 * The report's `comment` already holds the full English instruction line
 * (e.g. "Take 1 Capsule Orally 1 Time Daily ..."), so prefer it as-is — the
 * offline pattern engine localises the whole line to Thai on first load.
 * `route`/`dosage`/`frequency` are only fallbacks when comment is empty — and
 * we never prepend `route` to `comment` (it doubled the verb: "Take Take …"). */
function _instructionText(med) {
  const comment = _cleanValue(med.comment);
  if (comment) return comment;
  const parts = [med.route, med.dosage, med.frequency].map(_cleanValue).filter(Boolean);
  return parts.join(" ");
}

/** The note-line text for the current language: Thai (default) or English.
 * Falls back to whichever is present so the line is never blank. */
function _noteForLang(med) {
  const th = normMultiline(med.note || "");
  const en = normMultiline(med.noteEn || "");
  return (_currentLang === "en") ? (en || th) : (th || en);
}

function _takeContinueLabel() {
  return (_currentLang === "en") ? "Take until finished" : "ทานต่อเนื่องจนหมด";
}

/** Canonical continuity options for the OPD sheet dropdown. `value` is stored on
 * the med (server-comparable), `label` is what shows on the pill. Order matters —
 * it's the dropdown order. "" is the "no tag" choice. */
const CONTINUITY_OPTIONS = [
  { value: "",          label: "—" },
  { value: "continued", label: "🟢 รับยาต่อเนื่อง" },
  { value: "adjusted",  label: "🟡 ปรับขนาดยา" },
  { value: "new",       label: "🔵 ยาใหม่" },
];

function _continuityLabelFor(value) {
  const o = CONTINUITY_OPTIONS.find((x) => x.value === value);
  return o ? o.label : "";
}

function _takeContinueMealNote() {
  return (_currentLang === "en")
    ? "🚨 Continued medications are shown in the top section for the patient to follow until the course is finished."
    : "🚨 ยาที่ทานต่อเนื่องจนหมดหรือครบระยะเวลาการรักษา";
}

function _mealCardInfoDefault() {
  return (_currentLang === "en")
    ? "ℹ️ Multiple medications in the same meal slot. Note which medicines are before or after meals."
    : "ℹ️ มียาหลายตัวในมื้อเดียวกัน โปรดสังเกตว่าตัวใดกินก่อนอาหาร และตัวใดกินหลังอาหาร";
}

/** The meal-slot objects (key/icon/label) a med's instruction matches — drives
 * the per-meal checkboxes in the continued block. */
function _mealSlots(text) {
  const MS = window.BKNMealSlots;
  if (!MS || !text) return [];
  const bucketed = MS.bucket([{ drug: "", text }]);
  return MS.MEAL_SLOTS.filter((s) => bucketed.buckets[s.key]?.length);
}

/** Swap each note-line to the current language without re-rendering the table.
 * Only swaps cells the user hasn't manually edited (current text still matches
 * one of the stored TH/EN variants). */
function _applyNoteLang() {
  document.querySelectorAll(".note-line[data-field='note']").forEach((el) => {
    const th = el.dataset.noteTh || "";
    const en = el.dataset.noteEn || "";
    const cur = normMultiline(el.textContent || "");
    // Respect a user edit: leave it alone if it isn't one of the variants.
    if (cur && cur !== normMultiline(th) && cur !== normMultiline(en)) return;
    el.textContent = (_currentLang === "en") ? (en || th) : (th || en);
  });
}

/* ─────────────────────── Editable med-list state ──────────────────────── */
// _meds is the single source of truth. Each item:
//   { drug, instruction, note, quantity, code, provider, frequencyTh }
let _meds = [];
// "How to take" defaults to Thai and is translated by the FULLY-OFFLINE engine
// (medical-glossary patterns + frequency master + curated overrides) — no
// external translation API is ever called (org-network policy). Changing the
// language dropdown just re-runs the same offline engine for that language;
// anything the offline data doesn't cover stays as-is until curated in the
// Pattern / Text-Replacement editor.
let _currentLang = "th";
// Retained for API compatibility only — the engine is offline on every path now.
let _offlineOnly = true;

function _medFromReport(m) {
  return {
    drug:        norm(m.drug || ""),
    instruction: _instructionText(m),
    note:        normMultiline(m.note || ""),     // note (admin-instr + Patient Instruction) — Thai (default)
    noteEn:      normMultiline(m.noteEn || ""),   // same note in English (for lang switch)
    quantity:    _cleanValue(m.quantity || ""),
    code:        norm(m.code || ""),
    provider:    norm(m.provider || ""),
    // Authoritative Thai frequency phrase (BKN frequency master); when present
    // it overrides the engine's frequency translation on the instruction line.
    frequencyTh: norm(m.frequencyTh || ""),
    // Continuity vs. last-5-visits history (OPD only): "" | "continued" | "adjusted"
    // | "new". Server auto-computes continued/adjusted; the pharmacist picks the
    // final value from the OPD sheet dropdown (which also offers "new").
    continuity: norm(m.continuity || ""),
    // OPD dispensing group (Checking mode): "home" (default) | "stat".
    dispenseGroup: norm(m.dispenseGroup || "") || "home",
    takeUntilFinished: false,
    continueStartDate: "",
    continueEndDate: "",
    continueNote: "",
    continueTicks: {},
  };
}

/* ─────────────────────────────── Render ───────────────────────────────── */
function _appendNoData(tbody, text) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td colspan="5" class="empty">${escapeHtml(text)}</td>`;
  tbody.appendChild(tr);
}

/** Continuity tag shown under the drug code (OPD sheet): a dropdown the
 * pharmacist picks from — 🟢 รับยาต่อเนื่อง / 🟡 ปรับขนาดยา / 🔵 ยาใหม่ / —.
 * Pre-selected from the server's auto-computed `continuity`; the pharmacist's
 * pick then wins and persists. The selected value drives the pill colour via the
 * `cont-*` class, and the screen shows a native <select>; print shows a static
 * coloured label (see OPD-Sheet.html print CSS). */
function _buildContinuityTag(med) {
  // OPD sheet only — the IPD discharge sheet has no last-5-visits comparison.
  if (!_IS_OPD_SHEET) return "";
  const val = med.continuity || "";
  const opts = CONTINUITY_OPTIONS.map((o) =>
    `<option value="${escapeHtml(o.value)}"${o.value === val ? " selected" : ""}>${escapeHtml(o.label)}</option>`
  ).join("");
  const cls = val ? ` cont-${val}` : "";
  // The static label mirrors the selection for print (select controls are hidden
  // when printing). data-field lets the generic row binder persist changes.
  return `<span class="med-continuity${cls}" data-no-translate translate="no">`
       + `<select class="continuity-select" data-field="continuity">${opts}</select>`
       + `<span class="continuity-print">${escapeHtml(_continuityLabelFor(val))}</span>`
       + `</span>`;
}

/** Build one editable medicine row. `index` is the stable position in _meds
 * (used by edit/remove/meal-card lookups); `displayNo` is the visual "#" shown
 * in the number column, which follows display order, not _meds order. */
function _buildMedRow(med, index, displayNo = index + 1) {
  const candidates = _medicineImageCandidates(med);
  const photo = _buildMedicinePhotoSlot(med, candidates);
  const tr = document.createElement("tr");
  tr.className = "med-row";
  tr.dataset.index = String(index);
  if (med.takeUntilFinished) tr.classList.add("med-continue");
  tr.innerHTML = `
    <td class="col-act no-print">
      <button type="button" class="row-cont${med.takeUntilFinished ? " active" : ""}" title="${med.takeUntilFinished ? "Unmark take until finished" : "Mark take until finished"}">🚨</button>
      <button type="button" class="row-del" title="Remove this medicine">−</button>
    </td>
    <td class="col-no">${displayNo}</td>
    <td class="col-med">
      <div class="med-cell">
${photo}
        <div class="med-text">
          <div class="med-name" contenteditable="true" data-field="drug" data-ph="ชื่อยา" data-no-translate translate="no">${escapeHtml(med.drug || "")}</div>${med.source === "pom" ? `<span class="pom-badge no-translate" data-no-translate translate="no" title="Patient's Own Medication — added from Medication Reconciliation">POM</span>` : ""}
          ${med.code ? `<div class="med-code">Code: ${escapeHtml(med.code)}</div>` : ""}
          ${_buildContinuityTag(med)}
          ${med.takeUntilFinished ? `<div class="take-continue">${escapeHtml(_takeContinueLabel())}</div>` : ""}
        </div>
      </div>
    </td>
    <td class="col-how">
      <div class="instruction-card">
        <span class="instruction-icon">${_medicineIcon(med)}</span>
        <span class="instruction-text" contenteditable="true" data-field="instruction" data-ph="วิธีใช้ยา"${med.frequencyTh ? ` data-freq-th="${escapeHtml(med.frequencyTh)}"` : ""}>${escapeHtml(med.instruction || "")}</span>
      </div>
      <div class="comment note-line" contenteditable="true" data-field="note" data-ph="หมายเหตุ (ถ้ามี)" data-no-translate translate="no" data-note-th="${escapeHtml(med.note || "")}" data-note-en="${escapeHtml(med.noteEn || "")}">${escapeHtml(_noteForLang(med))}</div>
    </td>
    <td class="col-qty" data-qty>
      <div class="qty-main" contenteditable="true" data-field="quantity" data-ph="จำนวน">${escapeHtml(med.quantity || "")}</div>
    </td>
  `;
  return tr;
}

async function renderMeds() {
  const tbody = document.querySelector("#medTable tbody");
  if (!tbody) return;
  if (!_medImagesBase) _medImagesBase = await _serverBase();

  tbody.innerHTML = "";

  // Display order (keys, in priority):
  //   1) "take until finished" meds first
  //   2) then grouped by dosage form (the 💊/🧪/💉… icon)
  //   3) then by drug code — so identical-code items (e.g. the same drug added
  //      twice) always sit next to each other.
  // dataset.index still points at each med's ORIGINAL position in _meds so
  // edits/removes/meal-card lookups stay correct regardless of display order.
  const order = _meds
    .map((med, i) => ({ med, i }))
    .sort((a, b) => {
      const ac = a.med.takeUntilFinished ? 0 : 1;
      const bc = b.med.takeUntilFinished ? 0 : 1;
      if (ac !== bc) return ac - bc;
      const af = _medicineFormRank(a.med), bf = _medicineFormRank(b.med);
      if (af !== bf) return af - bf;
      const ak = norm(a.med.code || ""), bk = norm(b.med.code || "");
      if (ak !== bk) return ak < bk ? -1 : 1;
      return a.i - b.i;   // stable within the same code
    });
  order.forEach(({ med, i }, pos) => tbody.appendChild(_buildMedRow(med, i, pos + 1)));

  // Always append the "add medicine" row at the bottom (hidden when printing).
  tbody.appendChild(_buildAddRow());

  _bindMedicineImageFallbacks(tbody);
  _bindRowEditing(tbody);

  // Re-init the fully-offline translation engine on the freshly rendered table
  // and localise (patterns + glossary + curated overrides; no external API).
  _initTranslate();
  if (_currentLang) await _applyTranslate(_currentLang, _offlineOnly);

  renderMealCard();  // keep the by-meal card in sync with the med list

  // OPD: keep the history panel's "current order" box in sync with med edits.
  if (document.getElementById("histCurrent") && _histAllGroups.length) _renderHistView();
  // OPD review mode: keep the interactive med cards in sync too.
  renderReviewMeds();
}

/* ─────────────────── OPD review-mode medicine cards ───────────────────────
 * Editable cards mirroring the sheet's meds, shown in the center when the print
 * toolbar is minimized. Reuse the continuity/RM tags + the hover-arrow to the
 * history panel. Edits go through the same _commitField/_removeMed path. */
function _medGroup(m) { return (m.dispenseGroup === "stat") ? "stat" : "home"; }

function renderReviewMeds() {
  const homeHost = document.getElementById("reviewMedsHome");
  const statHost = document.getElementById("reviewMedsStat");
  if (!homeHost || !statHost) return;

  // Colour + continuity context (same source as the history panel).
  const colorIdx = {}, visitCount = {};
  _meds.forEach((m) => { const k = _histDrugKey(m); if (!(k in colorIdx)) colorIdx[k] = Object.keys(colorIdx).length; });
  (_histAllGroups.slice(0, _histN)).forEach((g) => {
    const seen = new Set();
    (g.meds || []).forEach((m) => {
      const k = _histDrugKey(m);
      if (!(k in colorIdx)) colorIdx[k] = Object.keys(colorIdx).length;
      if (!seen.has(k)) { seen.add(k); visitCount[k] = (visitCount[k] || 0) + 1; }
    });
  });

  const card = (m, i, group) => {
    const k = _histDrugKey(m);
    const c = _histColor(k, colorIdx[k] || 0);
    const repeats = visitCount[k] || 0;
    const rm = repeats >= 1 ? `<span class="hist-rm">RM</span>` : "";
    const cont = m.continuity ? `<span class="med-continuity cont-${escapeHtml(m.continuity)}">${escapeHtml(_continuityLabelFor(m.continuity))}</span>` : "";
    // The button MOVES the med between groups (home ⇄ stat), never deletes.
    const btnLabel = group === "home" ? "→ STAT" : "← Home";
    const btnTitle = group === "home" ? "ย้ายไป ใช้ที่ รพ./STAT" : "ย้ายกลับ ยากลับบ้าน";
    return `<div class="rev-med" data-index="${i}" data-drugkey="${escapeHtml(k)}" data-medidx="${i}"
                 style="--hc-bar:${c.bar};--hc-dot:${c.dot};--hc-soft:${c.soft};--hc-edge:${c.edge};">
      <div class="rev-idx">${i + 1}</div>
      <div>
        <div class="rev-name" contenteditable="true" data-field="drug" data-no-translate translate="no">${escapeHtml(m.drug || "")}</div>
        ${m.code ? `<div class="rev-code">Code: ${escapeHtml(m.code)}</div>` : ""}
        <div class="rev-tags">${rm}${cont}</div>
      </div>
      <div class="rev-instr" contenteditable="true" data-field="instruction">${escapeHtml(m.instruction || "")}</div>
      <div class="rev-qty" contenteditable="true" data-field="quantity">${escapeHtml(m.quantity || "")}</div>
      <button class="rev-move" type="button" title="${btnTitle}" data-target="${group === "home" ? "stat" : "home"}">${btnLabel}</button>
    </div>`;
  };

  const home = [], stat = [];
  _meds.forEach((m, i) => (_medGroup(m) === "stat" ? stat : home).push(card(m, i, _medGroup(m))));
  homeHost.innerHTML = home.length ? home.join("") : `<div class="rev-empty">ไม่มียากลับบ้าน</div>`;
  statHost.innerHTML = stat.length ? stat.join("") : `<div class="rev-empty">— ไม่มี —</div>`;
  const hc = document.getElementById("revHomeCount"); if (hc) hc.textContent = String(home.length);
  const sc = document.getElementById("revStatCount"); if (sc) sc.textContent = String(stat.length);

  _bindReviewMeds(homeHost);
  _bindReviewMeds(statHost);
}

function _bindReviewMeds(host) {
  host.querySelectorAll(".rev-med [contenteditable][data-field]").forEach((el) => {
    el.addEventListener("blur", () => {
      const card = el.closest(".rev-med");
      const idx = Number(card?.dataset.index);
      _commitField(idx, el.dataset.field, el.textContent);
      renderMeds();   // re-sync the sheet + cards
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } });
  });
  // The move button reclassifies the med (home ⇄ stat) instead of deleting.
  host.querySelectorAll(".rev-move").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.closest(".rev-med")?.dataset.index);
      if (idx < 0 || idx >= _meds.length) return;
      _meds[idx].dispenseGroup = btn.dataset.target === "stat" ? "stat" : "home";
      _persist();
      renderMeds();   // re-sync sheet + re-render both groups
    });
  });
  // Hover a review card → arrow to the same drug's history rows.
  host.querySelectorAll(".rev-med[data-drugkey]").forEach((el) => {
    el.addEventListener("mouseenter", () => { if (!_histPinned) _histSetActive(el.dataset.drugkey); _pointReviewToHistory(el); });
    el.addEventListener("mouseleave", () => { if (!_histPinned) _histSetActive(""); _hideHistArrow(); });
  });
}

/** In review mode, draw the connector arrow from a review med card to the first
 * VISIBLE matching row in the history panel. In Checking mode the current-order
 * box is hidden, so prefer a real history-list row. */
function _pointReviewToHistory(fromEl) {
  const key = fromEl.dataset.drugkey;
  const sel = `.hist-med[data-drugkey="${cssEscape(key)}"]`;
  const isVisible = (el) => el && el.getClientRects().length > 0;
  const target = [...document.querySelectorAll(`#histList ${sel}, #histCurrent ${sel}`)].find(isVisible);
  if (!target) { _hideHistArrow(); return; }
  _pointToEl(fromEl, target);
}

/* ─────────────────── Daily Pill Journey Card (by meal) ─────────────────── */
// Optional second page grouping the discharge meds by meal slot. Bucketing +
// markup come from the shared engine (window.BKNMealSlots, src/shared/
// meal-slots.js) so this matches the Medication Journey card exactly. The page
// is toggled by the "แนบหน้า จัดตามมื้อ" control (body.hm-with-mealcard).
function renderMealCard() {
  const host = document.getElementById("mealcardGrid");
  const contHost = document.getElementById("mealcardContinue");
  const info = document.getElementById("mealCardInfo");
  if (!host) return;
  const MS = window.BKNMealSlots;
  if (!_meds.length || !MS) {
    host.innerHTML = `<div class="mc-emptyall">ไม่มียากลับบ้าน (no home medications)</div>`;
    if (contHost) contHost.innerHTML = "";
    if (info) info.innerHTML = "";
    return;
  }
  // Rows are rendered continued-first, so index by their stable data-index
  // rather than DOM position to pick up any live (edited) instruction text.
  const domRowByIndex = new Map();
  document.querySelectorAll("#medTable tbody tr.med-row").forEach((row) => {
    domRowByIndex.set(Number(row.dataset.index), row);
  });
  const continuedItems = [];
  const otherItems = [];
  let _startDefaulted = false;
  _meds.forEach((m, i) => {
    // A continued med with no start date defaults to today — persist it so the
    // saved sheet keeps the concrete date rather than re-defaulting on reload.
    if (m.takeUntilFinished && !m.continueStartDate) {
      m.continueStartDate = _todayISO();
      _startDefaulted = true;
    }
    const domRow = domRowByIndex.get(i);
    const domInstr = domRow ? norm((domRow.querySelector(".instruction-text") || {}).textContent || "") : "";
    const instrTh = domInstr || norm(m.instruction || "");
    const text = norm(instrTh + " " + (m.frequencyTh || ""));
    let dose = MS.doseSnippet(instrTh);
    if (!dose && _isExternalMed(m, instrTh)) dose = "ทา";
    const drugName = m.takeUntilFinished ? `🚨 ${m.drug}` : m.drug;
    const item = {
      ...m,
      _idx: i,
      drug: drugName,
      text,
      dose,
      slots: _mealSlots(instrTh),   // matched meal-slot objects for checkboxes
    };
    if (m.takeUntilFinished) continuedItems.push(item);
    else otherItems.push(item);
  });

  const continuedHtml = continuedItems.length ? `
    <div class="mc-continue-section">
      <div class="mc-slot-head continue-head">
        <span class="mc-ico">🚨</span>
        <span>${_currentLang === "en" ? "Continue until finished" : "ยาที่ทานต่อเนื่องจนหมดหรือครบระยะเวลาการรักษา"}</span>
        <span class="mc-en">${_currentLang === "en" ? "Continue until finished" : "Continue until finished"}</span>
      </div>
      <div class="mc-continue-list">
        ${continuedItems.map((it) => {
          // Default the start date to today so the patient has a concrete
          // "start" without the pharmacist having to set it every time.
          const startIso = it.continueStartDate || _todayISO();
          const endIso = it.continueEndDate || "";
          const startDate = escapeHtml(startIso);
          const endDate = escapeHtml(endIso);
          const startTxt = escapeHtml(_fmtDateDMY(startIso));
          const endTxt = escapeHtml(_fmtDateDMY(endIso) || "…");
          const noteVal = escapeHtml(it.continueNote || "");
          const notePh = _currentLang === "en" ? "note (e.g. start tonight)" : "หมายเหตุ เช่น เริ่มเย็นนี้ / วันนี้ทานทันที";
          const startLbl = _currentLang === "en" ? "Start" : "เริ่ม";
          const endLbl = _currentLang === "en" ? "End" : "จนถึง";

          // Calendar columns: one per day of the start→end run.
          const dayCols = _continueDayColumns(startIso, endIso);
          const nCols = dayCols.length;
          // Header row: empty meal cell + one date label per day (no tick — the
          // checkboxes live in the meal rows below).
          const headRow = `<tr class="mcc-headrow">
            <th class="mcc-mealhead"></th>
            ${dayCols.map((c) => `<th class="mcc-dayhead">
              <span class="mcc-daylbl">${c.day ? `${escapeHtml(c.day)}/${escapeHtml(c.mon)}` : ""}</span>
            </th>`).join("")}
          </tr>`;
          // Meal rows: meal label + one tick per day column. A ticked box (dose
          // taken) is remembered per (meal, day) and hidden in print.
          const ticks = it.continueTicks || {};
          const mealRows = it.slots.length
            ? it.slots.map((s) => `<tr>
                <td class="mcc-meal"><span class="mcc-ico">${s.ico}</span> ${escapeHtml(_currentLang === "en" ? s.en : s.th)}</td>
                ${dayCols.map((c) => {
                  const key = `${s.key}|${c.iso}`;
                  return `<td class="mcc-tick"><input type="checkbox" class="mcc-tickbox" data-idx="${it._idx}" data-tickkey="${escapeHtml(key)}"${ticks[key] ? " checked" : ""} /></td>`;
                }).join("")}
              </tr>`).join("")
            : `<tr><td class="mcc-meal mcc-nomeal" colspan="${nCols + 1}">${escapeHtml(_currentLang === "en" ? "As directed" : "ตามแพทย์สั่ง")}</td></tr>`;
          return `<div class="mc-continue-item" data-index="${it._idx}">
            <div class="mc-continue-drug">
              <span class="mcc-name">${escapeHtml(it.drug)}${it.dose ? ` <span class="mc-dose">${escapeHtml(it.dose)}</span>` : ""}</span>
              <span class="mcc-date-edit">
                <label>${startLbl} <input type="date" class="mc-continue-date" data-idx="${it._idx}" data-field="continueStartDate" value="${startDate}" /></label>
                <label>${endLbl} <input type="date" class="mc-continue-date" data-idx="${it._idx}" data-field="continueEndDate" value="${endDate}" /></label>
                <input type="text" class="mc-continue-note" data-idx="${it._idx}" data-field="continueNote" value="${noteVal}" placeholder="${notePh}" />
              </span>
              <span class="mcc-date-print">${startLbl} ${startTxt}&nbsp;&nbsp;${endLbl} ${endTxt}<span class="mcc-note-print">${noteVal ? ` · ${noteVal}` : ""}</span></span>
            </div>
            <table class="mcc-table">
              <tbody>
                ${headRow}
                ${mealRows}
              </tbody>
            </table>
          </div>`;
        }).join("")}
      </div>
    </div>
  ` : "";

  if (contHost) contHost.innerHTML = continuedHtml;
  host.innerHTML = MS.gridHTML(otherItems, escapeHtml);
  if (info) {
    const continuedCount = continuedItems.length;
    info.innerHTML = `<div class="mc-info-detail">${escapeHtml(continuedCount ? _takeContinueMealNote() : _mealCardInfoDefault())}</div>`;
  }
  _bindMealCardControls(contHost);
  if (_startDefaulted) _persist();
}

function _bindMealCardControls(host) {
  if (!host) return;
  // Date pickers commit on "change"; the free-text note commits on "input" so
  // the manually-typed note (e.g. "เริ่มเย็นนี้") persists as the user types.
  host.querySelectorAll(".mc-continue-date").forEach((input) => {
    input.addEventListener("change", () => {
      const idx = Number(input.dataset.idx);
      const field = input.dataset.field;
      if (Number.isNaN(idx) || !field) return;
      const med = _meds[idx];
      if (!med) return;
      med[field] = input.value || "";
      _persist();
      // The calendar day-columns depend on the start/end run — re-render so the
      // grid reflects the new range live.
      renderMealCard();
    });
  });
  host.querySelectorAll(".mc-continue-note").forEach((input) => {
    input.addEventListener("input", () => {
      const idx = Number(input.dataset.idx);
      const field = input.dataset.field;
      if (Number.isNaN(idx) || !field) return;
      const med = _meds[idx];
      if (!med) return;
      med[field] = input.value || "";
      // Keep the print-only text form in sync so a typed note actually appears
      // on paper (the print span is built once at render, not re-rendered here).
      const item = input.closest(".mc-continue-item");
      const notePrint = item && item.querySelector(".mcc-note-print");
      if (notePrint) notePrint.textContent = input.value ? ` · ${input.value}` : "";
      _persist();
    });
  });
  // Meal tick-boxes: remember which (meal, day) doses are done. On screen a
  // ticked box shows an ✗; in print a ticked box is hidden (the cell is blank),
  // while unticked boxes print as empty squares. All via CSS — no re-render.
  host.querySelectorAll(".mcc-tickbox").forEach((box) => {
    box.addEventListener("change", () => {
      const idx = Number(box.dataset.idx);
      const key = box.dataset.tickkey;
      if (Number.isNaN(idx) || !key) return;
      const med = _meds[idx];
      if (!med) return;
      if (!med.continueTicks || typeof med.continueTicks !== "object") med.continueTicks = {};
      if (box.checked) med.continueTicks[key] = true;
      else delete med.continueTicks[key];
      _persist();
    });
  });
}

/** External / topical meds (creams, ointments) have no swallow-dose — they get a
 * "ทา" (apply) label instead, detected from the "ยาใช้ภายนอก / ห้ามรับประทาน"
 * note, an apply verb, or a cream/ointment/gel/lotion name. */
function _isExternalMed(m, instrTh) {
  return /ภายนอก|ห้ามรับประทาน/.test((m && m.note) || "")
    || /^\s*ทา|ทาบริเวณ|ทาภายนอก/.test(instrTh || "")
    || /cream|ครีม|ointment|ยาทา|\bgel\b|เจล|lotion|โลชั่น/i.test((m && m.drug) || "");
}

/* ───────────────────────────── Translation ────────────────────────────── */
// Reuses the shared med-sticker engine: HMTranslate + window.MEDICAL_GLOSSARY.
// Drug-name cells carry data-no-translate so only instructions/notes translate.
function _translateRoot() {
  return document.querySelector("#medTable tbody");
}

function _initTranslate() {
  if (typeof HMTranslate === "undefined") return;
  const root = _translateRoot();
  if (root) HMTranslate.init(root, { glossary: window.MEDICAL_GLOSSARY || {} });
}

async function _applyTranslate(lang, offlineOnly = false) {
  if (typeof HMTranslate === "undefined") return;
  const root = _translateRoot();
  if (!root) return;
  HMTranslate.restore();
  if (lang) await HMTranslate.translate(root, lang, { offlineOnly });
}

/** Build the trailing add-medicine row with a search box + suggestion list. */
function _buildAddRow() {
  const tr = document.createElement("tr");
  tr.className = "add-row no-print";
  tr.innerHTML = `
    <td class="col-act">
      <button type="button" class="row-add" title="Add this medicine">+</button>
    </td>
    <td class="col-no">+</td>
    <td class="col-med" colspan="3">
      <div class="add-wrap">
        <input type="text" class="add-input" placeholder="พิมพ์ชื่อยาเพื่อเพิ่ม… (type a medicine name to add)" autocomplete="off" />
        <div class="add-suggest" hidden></div>
      </div>
    </td>
  `;
  return tr;
}

/* ───────────────────── Editing / add / remove / persist ───────────────── */
function _commitField(index, field, value) {
  if (index < 0 || index >= _meds.length) return;
  // The note is multi-line (admin-instruction + Patient Instruction); keep its
  // newlines. Other fields stay single-line.
  const clean = field === "note" ? normMultiline(value) : norm(value);
  _meds[index][field] = clean;
  // A manual note edit overrides both languages so switching lang keeps it.
  if (field === "note") _meds[index].noteEn = clean;
  _persist();
}

function _removeMed(index) {
  if (index < 0 || index >= _meds.length) return;
  _meds.splice(index, 1);
  _persist();
  renderMeds();
}

function _addMed(med) {
  _meds.push({
    drug: norm(med.drug || ""), instruction: norm(med.instruction || ""),
    note: "", quantity: norm(med.quantity || ""), code: norm(med.code || ""),
    provider: "", source: norm(med.source || ""),
    // Authoritative Thai frequency phrase (used by the translation engine on the
    // instruction line, same as report-sourced rows) — POM items from Med
    // Reconcile carry it so their instruction reads natural Thai.
    frequencyTh: norm(med.frequencyTh || ""),
    takeUntilFinished: false,
    continueStartDate: "",
    continueEndDate: "",
    continueNote: "",
    continueTicks: {},
  });
  _persist();
  renderMeds();
}

/** Wire contenteditable commits, the − remove buttons, and the add box. */
function _bindRowEditing(tbody) {
  // Editable cells → commit on blur.
  tbody.querySelectorAll("[contenteditable][data-field]").forEach((el) => {
    el.addEventListener("blur", () => {
      const tr = el.closest(".med-row");
      if (!tr) return;
      const idx = Number(tr.dataset.index);
      const field = el.dataset.field;
      _commitField(idx, field, el.textContent);
      // Re-resolve the medicine image if the drug name changed.
      if (field === "drug") {
        const slot = tr.querySelector(".med-photo-slot");
        if (slot) _refreshRowImage(tr, idx);
      }
    });
    // Enter commits (except keep newlines out of single-line fields).
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); el.blur(); }
    });
  });

  // Continuity dropdown (OPD) → commit on change; re-render to update pill colour
  // + the print label.
  tbody.querySelectorAll("select.continuity-select[data-field]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const tr = sel.closest(".med-row");
      if (!tr) return;
      const idx = Number(tr.dataset.index);
      if (idx < 0 || idx >= _meds.length) return;
      _meds[idx].continuity = sel.value;
      _persist();
      renderMeds();
    });
  });

  // Toggle take-until-finished buttons.
  tbody.querySelectorAll(".row-cont").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tr = btn.closest(".med-row");
      if (!tr) return;
      const idx = Number(tr.dataset.index);
      if (idx < 0 || idx >= _meds.length) return;
      _meds[idx].takeUntilFinished = !_meds[idx].takeUntilFinished;
      _persist();
      renderMeds();
    });
  });

  // Remove buttons.
  tbody.querySelectorAll(".row-del").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tr = btn.closest(".med-row");
      if (tr) _removeMed(Number(tr.dataset.index));
    });
  });

  // Add-medicine search box.
  const addRow = tbody.querySelector(".add-row");
  if (addRow) _bindAddBox(addRow);
}

/** Re-resolve and swap a row's medicine image after a name edit. */
function _refreshRowImage(tr, idx) {
  const med = _meds[idx];
  const cell = tr.querySelector(".med-cell");
  if (!cell || !med) return;
  const candidates = _medicineImageCandidates(med);
  const newSlot = document.createElement("div");
  newSlot.innerHTML = _buildMedicinePhotoSlot(med, candidates);
  const oldSlot = cell.querySelector(".med-photo-slot");
  if (oldSlot && newSlot.firstElementChild) {
    oldSlot.replaceWith(newSlot.firstElementChild);
    _bindMedicineImageFallbacks(cell);
  }
}

/** Live suggestion dropdown + add behavior for the add-medicine row. */
function _bindAddBox(addRow) {
  const input = addRow.querySelector(".add-input");
  const list = addRow.querySelector(".add-suggest");
  const addBtn = addRow.querySelector(".row-add");
  if (!input || !list) return;

  const commitAdd = (name, code) => {
    const drug = norm(name || input.value);
    if (!drug) return;
    _addMed({ drug, code: code || "" });
    // renderMeds() rebuilds the table; focus the fresh add box for fast entry.
    const fresh = document.querySelector("#medTable .add-input");
    if (fresh) fresh.focus();
  };

  const renderSuggest = () => {
    const matches = _searchMeds(input.value);
    if (!matches.length) { list.hidden = true; list.innerHTML = ""; return; }
    list.innerHTML = matches.map((m) =>
      `<div class="add-opt" data-code="${escapeHtml(m.code)}" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>`
    ).join("");
    list.hidden = false;
  };

  input.addEventListener("input", renderSuggest);
  input.addEventListener("focus", renderSuggest);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitAdd(); }
    if (e.key === "Escape") { list.hidden = true; }
  });
  list.addEventListener("mousedown", (e) => {
    // mousedown (not click) so it fires before input blur hides the list.
    const opt = e.target.closest(".add-opt");
    if (!opt) return;
    e.preventDefault();
    commitAdd(opt.dataset.name, opt.dataset.code);
  });
  if (addBtn) addBtn.addEventListener("click", () => commitAdd());
  // Hide suggestions when focus leaves the add box.
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
}

/* ───────────────────────────── Persistence ────────────────────────────── */
let _persistTimer = null;
let _pharmNote = "";        // pharmacist note (review mode), persisted per-visit
function _persist() {
  if (!window.BKNData || !window.BKNData.saveMedCache) return;
  const c = _context || {};
  if (!c.patientuid || !c.patientvisituid) return;
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    try {
      window.BKNData.saveMedCache(c.patientuid, c.patientvisituid, {
        kind: "homeMedSheet",
        meds: _meds,
        pharmNote: _pharmNote,
        savedAt: new Date().toISOString(),
      });
    } catch (_) { /* best-effort */ }
  }, 600);
}

async function _loadSavedMeds() {
  if (!window.BKNData || !window.BKNData.loadMedCache) return null;
  const c = _context || {};
  if (!c.patientuid || !c.patientvisituid) return null;
  try {
    const cached = await window.BKNData.loadMedCache(c.patientuid, c.patientvisituid);
    if (cached && cached.kind === "homeMedSheet") {
      if (typeof cached.pharmNote === "string") _pharmNote = cached.pharmNote;
      if (Array.isArray(cached.meds)) return cached.meds;
    }
  } catch (_) { /* ignore */ }
  return null;
}

/** "Send to dispensing zone" (OPD Checking mode): POST the current visit's meds
 * (grouped home/stat) + pharmacist note to the OPD queue, and log it. */
function bindSendDispense() {
  const btn = document.getElementById("btnSendDispense");
  if (!btn) return;
  const status = document.getElementById("pharmNoteStatus");
  btn.addEventListener("click", async () => {
    if (!_meds.length) { if (status) status.textContent = "⚠️ ไม่มีรายการยา"; return; }
    if (!window.BKNData || !window.BKNData.serverFetch) { if (status) status.textContent = "⚠️ เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"; return; }
    const c = _context || {};
    const patEl = document.getElementById("patientName");
    const payload = {
      hn: (document.getElementById("patientHN")?.textContent || c.hn || c.patientId || "").trim(),
      name: (patEl?.textContent || "").trim(),
      visitId: (document.getElementById("patientAN")?.textContent || "").trim(),
      room: (document.getElementById("patientRoom")?.textContent || "").trim(),
      patientuid: c.patientuid || "",
      patientvisituid: c.patientvisituid || "",
      sentBy: (c.loginName || c.userName || "").trim(),
      pharmacistNote: _pharmNote || "",
      meds: _meds.map((m) => ({
        drug: norm(m.drug || ""), code: norm(m.code || ""),
        instruction: norm(m.instruction || ""), quantity: norm(m.quantity || ""),
        continuity: norm(m.continuity || ""), group: _medGroup(m),
      })),
    };
    if (!payload.hn) { if (status) status.textContent = "⚠️ ไม่พบ HN ผู้ป่วย"; return; }
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = "⏳ กำลังส่ง…";
    try {
      const r = await window.BKNData.serverFetch("/api/opd-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r && r.ok && r.json && r.json.ok) {
        btn.textContent = "✅ ส่งแล้ว";
        if (status) status.textContent = `ส่งเข้า OPD Queue: ${r.json.case?.id || ""}`;
        setTimeout(() => { btn.textContent = prev; btn.disabled = false; if (status) status.textContent = ""; }, 2500);
      } else {
        const err = (r && r.json && r.json.error) || `HTTP ${r?.status || "?"}`;
        throw new Error(err);
      }
    } catch (e) {
      btn.textContent = prev; btn.disabled = false;
      if (status) status.textContent = `❌ ส่งไม่สำเร็จ: ${e.message || e}`;
    }
  });
}

/** Pharmacist-note textarea (OPD review mode): loads the saved note, saves on
 * input (debounced via _persist), shows a tiny saved-status. */
function bindPharmNote() {
  const ta = document.getElementById("pharmNote");
  const status = document.getElementById("pharmNoteStatus");
  if (!ta) return;
  ta.value = _pharmNote || "";
  ta.addEventListener("input", () => {
    _pharmNote = ta.value;
    _persist();
    if (status) { status.textContent = "บันทึกแล้ว ✓"; clearTimeout(ta._st); ta._st = setTimeout(() => (status.textContent = ""), 1500); }
  });
}

/* ─────────────────────────── Fetch + orchestrate ──────────────────────── */
function _setStatus(text) {
  const el = document.getElementById("fetchStatus");
  if (el) el.textContent = text;
}

async function fetchAndRender() {
  const tbody = document.querySelector("#medTable tbody");
  const _isOpd = _context && _context.mode === "opd";
  // Both IPD and OPD fetch getallorderitem by patientvisituid.
  const _hasCtx = _context && _context.patientvisituid;
  if (!_hasCtx) {
    if (tbody) { tbody.innerHTML = ""; _appendNoData(tbody, "No patient context. Open from the Discharge (IPD) or OPD dispense view."); }
    return;
  }
  if (!window.BKNData || !window.BKNData.serverFetch) {
    if (tbody) { tbody.innerHTML = ""; _appendNoData(tbody, "BKNData unavailable (shared-data-client.js not loaded)."); }
    return;
  }
  if (!_context.incusToken) {
    _setStatus("❌ ไม่พบ session (incus-token) — เปิดผู้ป่วยบน ArcusAir แล้วลองใหม่");
    if (tbody) { tbody.innerHTML = ""; _appendNoData(tbody, "ไม่พบ ArcusAir session — เปิดหน้าผู้ป่วยบน ArcusAir ก่อน แล้วกดปุ่มซ้ำ"); }
    return;
  }

  _setStatus("⏳ กำลังดึงรายการยากลับบ้าน...");
  await Promise.all([_loadMedicationDatabase(), _loadPatternOverrides()]);

  // Fetch meds from ArcusAir: IPD → getallorderitem; OPD → pharmacy/dispense/search.
  const _endpoint = _isOpd ? "/api/report/home-med-opd" : "/api/report/home-med-api";
  let resp = null;
  try {
    resp = await window.BKNData.serverFetch(_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: _context }),
    });
  } catch (e) {
    console.error("[home-med] serverFetch threw:", e);
  }

  console.log("[home-med] server response:", resp);
  window.__HM_RESP__ = resp;  // inspect in console: window.__HM_RESP__

  if (!resp || !resp.ok || !resp.json || !resp.json.ok) {
    const err = (resp && resp.json && resp.json.error) || (resp && resp.error) || `HTTP ${resp && resp.status}`;
    _setStatus("❌ ดึงรายการยาไม่สำเร็จ: " + err);
    if (tbody) {
      tbody.innerHTML = "";
      _appendNoData(tbody, "ดึงรายการยาจาก ArcusAir ไม่สำเร็จ: " + err);
    }
    return;
  }

  const data = resp.json;
  const reportMeds = data.meds || [];
  console.log(`[home-med] meds=${reportMeds.length} allMeds=${data.allMeds}`);

  // Build the editable list: prefer the user's previously-saved edits for this
  // visit; otherwise seed from the ArcusAir discharge meds.
  // If the Revert button was clicked, clear the flag and skip the cache so the
  // fresh ArcusAir data is used unconditionally.
  const revertFlag = sessionStorage.getItem('hm:revert');
  if (revertFlag) sessionStorage.removeItem('hm:revert');
  const saved = revertFlag ? null : await _loadSavedMeds();
  if (saved && saved.length) {
    // Fresh server continuity signal, by code — seeds cached meds saved before this
    // field existed. A cache that DOES carry `continuity` is a pharmacist pick and
    // wins (even when blank); only when the key is absent do we take the fresh value.
    const _freshCont = {};
    reportMeds.forEach((m) => { if (m.code) _freshCont[norm(m.code)] = norm(m.continuity || ""); });
    _meds = saved.map((m) => {
      const code = norm(m.code || "");
      const continuity = Object.prototype.hasOwnProperty.call(m, "continuity")
        ? norm(m.continuity || "")
        : (_freshCont[code] || "");
      return {
      drug: norm(m.drug || ""), instruction: norm(m.instruction || ""),
      note: normMultiline(m.note || ""), noteEn: normMultiline(m.noteEn || ""),
      quantity: norm(m.quantity || ""),
      code, provider: norm(m.provider || ""),
      frequencyTh: norm(m.frequencyTh || ""),
      source: norm(m.source || ""),
      continuity,
      dispenseGroup: norm(m.dispenseGroup || "") || "home",
      takeUntilFinished: !!m.takeUntilFinished,
      continueStartDate: norm(m.continueStartDate || ""),
      continueEndDate: norm(m.continueEndDate || ""),
      continueNote: norm(m.continueNote || ""),
      continueTicks: (m.continueTicks && typeof m.continueTicks === "object") ? m.continueTicks : {},
      };
    });
    // Detect new discharge meds added after the cache was saved and inject them.
    const savedCodes = new Set(_meds.map((m) => m.code).filter(Boolean));
    const newItems = reportMeds.filter((m) => m.code && !savedCodes.has(norm(m.code)));
    if (newItems.length) {
      _meds = _meds.concat(newItems.map(_medFromReport));
      _setStatus(`✅ ${_meds.length} รายการ (แก้ไขไว้ + ${newItems.length} รายการใหม่จาก ArcusAir)`);
    } else {
      _setStatus(`✅ ${_meds.length} รายการ (โหลดฉบับที่แก้ไขไว้)`);
    }
  } else {
    _meds = reportMeds.map(_medFromReport);
    if (!_meds.length) {
      _setStatus("⚠️ ไม่พบรายการยากลับบ้าน — เพิ่มยาด้านล่าง");
    } else {
      _setStatus(`✅ ${_meds.length} รายการยากลับบ้าน — เพิ่ม/ลบ/แก้ไขได้`);
    }
  }

  populateHeader(data.patient || {}, _context, reportMeds);
  renderDiagnosis(_context && _context.diagnosis);
  renderAllergies(data.allergies);
  renderAppointments(data.appointmentText);
  if (_isOpd) {
    // OPD-Sheet.html: last-5-visits medical history panel; no Checklist / recon.
    renderVisitHistory(data.visitHistory);
    renderVisitSummary({
      patient: data.patient, allergies: data.allergies,
      diagnosis: _context && _context.diagnosis,
      ...(data.visitSummary || {}),   // vitals, visits, doctorNotes
    });
    // Sync the pharmacist-note textarea with the value loaded from the cache.
    const _ta = document.getElementById("pharmNote");
    if (_ta && _ta.value !== _pharmNote) _ta.value = _pharmNote || "";
  } else {
    const checklistHn = (data.patient && data.patient.hn) || (_context && (_context.hn || _context.patientId)) || "";
    fetchAndRenderChecklist(checklistHn);  // best-effort, non-blocking
    _setReconMeds(data.reconcileMeds);
  }
  await renderMeds();
}

/* ─────────────── OPD medical-history panel (last 5 visits) ────────────────
 * Renders data.visitHistory (from build_opd_visit_history) into the OPD sheet's
 * right sidebar (#histList), replacing the IPD Med Reconciliation panel. Each
 * group is one prior visit with its medicines. Read-only. */
/** A stable identity key for a history med — code when present (most reliable),
 * else the lowercased drug name. Used to colour + link the same drug across
 * visits. */
function _histDrugKey(m) {
  return norm(m.code || "") || norm((m.drug || "").toLowerCase());
}

/** Deterministic pastel colour for a drug key, so the SAME drug always gets the
 * SAME colour across renders. Golden-angle hue spread keeps neighbours distinct. */
function _histColor(key, idx) {
  const hue = (idx * 137.508) % 360;              // golden angle → well-spread hues
  return {
    bar:  `hsl(${hue} 70% 55%)`,
    dot:  `hsl(${hue} 70% 48%)`,
    soft: `hsl(${hue} 82% 95%)`,
    edge: `hsl(${hue} 60% 82%)`,
  };
}

let _histAllGroups = [];       // full server data (up to OPD_HISTORY_MAX visits)
let _histN         = 5;        // how many visits to show (user-selectable)
let _histPinned    = "";       // currently pinned drug key ("" = none)
let _visitSummaryData = null;  // last visit-summary payload (for review re-render)

function _histFmtDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || "-");
}

/** One coloured med row (shared by the current-order box and the history list).
 * `nowTag` marks a history row also on the current sheet. */
function _histRow(m, colorIdx, visitCount, currentCodes, isCurrent, medIdx) {
  const k = _histDrugKey(m);
  const c = _histColor(k, colorIdx[k] || 0);
  const repeats = visitCount[k] || 0;   // # of history visits containing this drug
  // "RM" (reconcile-match): a CURRENT-order drug that also appears in the visit
  // history → shown as a blue tag in front of the drug name.
  const rmTag = (isCurrent && repeats >= 1)
    ? `<span class="hist-rm" title="พบในประวัติการใช้ยา (Reconcile match)">RM</span>` : "";
  const badge = repeats >= 2
    ? `<span class="hist-repeat" title="พบใน ${repeats} ครั้ง">×${repeats}</span>` : "";
  const nowTag = (!isCurrent && m.code && currentCodes.has(norm(m.code)))
    ? `<span class="hist-now" title="อยู่ในใบสั่งยาปัจจุบัน">ครั้งนี้</span>` : "";
  const info = m.info || m.instruction || "";
  // data-medidx (current-order rows only) links the panel row to its sheet row
  // (.med-row[data-index]) so hover can draw a connector arrow.
  const idxAttr = (isCurrent && Number.isInteger(medIdx)) ? ` data-medidx="${medIdx}"` : "";
  return `<div class="hist-med" data-drugkey="${escapeHtml(k)}"${idxAttr}`
    + ` style="--hc-bar:${c.bar};--hc-dot:${c.dot};--hc-soft:${c.soft};--hc-edge:${c.edge};">`
    + `<span class="hist-dot"></span>`
    + `<span class="hist-body">${rmTag}<span class="hist-drug">${escapeHtml(m.drug || "")}</span>`
    + `${badge}${nowTag}`
    + `${info ? `<span class="hist-info">${escapeHtml(info)}</span>` : ""}</span>`
    + `</div>`;
}

/** Entry point: stash the full server groups, then render the current view. */
function renderVisitHistory(groups) {
  _histAllGroups = Array.isArray(groups) ? groups : [];
  const sel = document.getElementById("histCountSel");
  if (sel) {
    _histN = Number(sel.value) || 5;
    if (!sel._bknBound) {
      sel._bknBound = true;
      sel.addEventListener("change", () => { _histN = Number(sel.value) || 5; _renderHistView(); });
    }
  }
  _renderHistView();
}

/** Render the current-order box + the sliced history list, then wire interaction.
 * Colours + repeat counts are computed over the DISPLAYED visits plus the current
 * order, so the same drug shares a colour everywhere in the panel. */
function _renderHistView() {
  const list = document.getElementById("histList");
  if (!list) return;
  const label = document.getElementById("histCountLabel");
  const sub   = document.getElementById("histSub");
  const curBox  = document.getElementById("histCurrent");
  const curMeds = document.getElementById("histCurrentMeds");

  const shown = _histAllGroups.slice(0, _histN);
  if (label) label.textContent = String(_histN);

  // Colour index + per-drug visit counts across the SHOWN history (current order
  // seeded first so today's drugs always get a colour even if new).
  const colorIdx = {};
  const visitCount = {};
  const currentCodes = new Set(_meds.map((m) => norm(m.code || "")).filter(Boolean));
  _meds.forEach((m) => { const k = _histDrugKey(m); if (!(k in colorIdx)) colorIdx[k] = Object.keys(colorIdx).length; });
  shown.forEach((g) => {
    const seen = new Set();
    (g.meds || []).forEach((m) => {
      const k = _histDrugKey(m);
      if (!(k in colorIdx)) colorIdx[k] = Object.keys(colorIdx).length;
      if (!seen.has(k)) { seen.add(k); visitCount[k] = (visitCount[k] || 0) + 1; }
    });
  });

  // Current-order box.
  if (curBox && curMeds) {
    if (_meds.length) {
      curBox.style.display = "";
      curMeds.innerHTML = _meds.map((m, i) => _histRow(m, colorIdx, visitCount, currentCodes, true, i)).join("");
    } else {
      curBox.style.display = "none";
      curMeds.innerHTML = "";
    }
  }

  // History list.
  if (!shown.length) {
    if (sub) sub.textContent = "No prior visits found";
    list.innerHTML = `<div class="recon-empty"><span class="recon-empty-icon">🕑</span>ไม่พบประวัติการใช้ยาก่อนหน้า</div>`;
    return;
  }
  if (sub) {
    const total = _histAllGroups.length;
    const repeats = Object.values(visitCount).filter((n) => n >= 2).length;
    // Always show shown/total so it's obvious when N exceeds available visits
    // (e.g. "แสดง 3 / 3 ครั้ง (มีทั้งหมด 3)") — otherwise raising N looks like a no-op.
    const capped = _histN > total ? ` — มีประวัติ ${total} ครั้ง` : "";
    sub.textContent = `แสดง ${shown.length} / ${total} ครั้ง${capped} · ใหม่→เก่า`
      + (repeats ? ` · ${repeats} ยาซ้ำ` : "");
  }

  list.innerHTML = shown.map((g) => {
    const rows = (g.meds || []).map((m) => _histRow(m, colorIdx, visitCount, currentCodes, false)).join("");
    return `<div class="hist-visit">
      <div class="hist-visit-hd">🗓 ${escapeHtml(_histFmtDate(g.visitDate))}
        <span class="hist-count">${(g.meds || []).length} รายการ</span></div>
      <div class="hist-meds">${rows || '<div class="hist-med" style="color:#9ca3af">—</div>'}</div>
    </div>`;
  }).join("");

  _bindHistInteraction();
  if (_histPinned) _histSetActive(_histPinned);   // keep a pin across N changes
}

/** Apply the highlight for `key`. In the current-order box the matching row is
 * highlighted but rows are NEVER hidden — today's list always stays fully
 * visible. In the HISTORY list only, non-matching rows are hidden and any visit
 * group left with no match collapses, so only the relevant past dates remain. */
function _histSetActive(key) {
  const panel = document.getElementById("histPanel");
  if (!panel) return;
  // Current order: highlight the match only; never hide/collapse.
  panel.querySelectorAll("#histCurrent .hist-med").forEach((el) => {
    el.classList.toggle("hist-hot", !!key && el.dataset.drugkey === key);
    el.classList.remove("hist-hidden");
  });
  // History rows: highlight the match, hide the rest.
  panel.querySelectorAll("#histList .hist-med").forEach((el) => {
    const match = el.dataset.drugkey === key;
    el.classList.toggle("hist-hot", !!key && match);
    el.classList.toggle("hist-hidden", !!key && !match);
  });
  // Collapse history visit groups with no match (current-order box excluded).
  panel.querySelectorAll("#histList .hist-visit").forEach((grp) => {
    if (!key) { grp.classList.remove("hist-collapsed"); return; }
    const hasMatch = grp.querySelector(`.hist-med[data-drugkey="${cssEscape(key)}"]`);
    grp.classList.toggle("hist-collapsed", !hasMatch);
  });
  panel.classList.toggle("hist-filtering", !!key);
}

/** Minimal CSS.escape fallback (drug keys are codes/names — quote-safe). */
function cssEscape(s) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
}

/* ── Connector arrow: current-order row → its row on the printed sheet ────────
 * A fixed-position SVG overlay drawn from the hovered panel med to the matching
 * .med-row on the OPD sheet, so the pharmacist sees which sheet line it is. */
let _histArrowEl = null;
let _histArrowRedraw = null;   // bound redraw fn while an arrow is shown

function _ensureArrowLayer() {
  if (_histArrowEl) return _histArrowEl;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "histArrowLayer";
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    `<defs><marker id="histArrowHead" markerWidth="9" markerHeight="9" refX="7" refY="3"
        orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#1d4ed8"></path></marker></defs>
     <path id="histArrowPath" fill="none" stroke="#1d4ed8" stroke-width="2.4"
        stroke-linecap="round" marker-end="url(#histArrowHead)"></path>`;
  document.body.appendChild(svg);
  _histArrowEl = svg;
  return svg;
}

function _hideHistArrow() {
  if (_histArrowEl) _histArrowEl.classList.remove("show");
  document.querySelectorAll(".sheet-pointed").forEach((r) => r.classList.remove("sheet-pointed"));
  if (_histArrowRedraw) {
    window.removeEventListener("scroll", _histArrowRedraw, true);
    window.removeEventListener("resize", _histArrowRedraw);
    _histArrowRedraw = null;
  }
}

/** Draw the arrow from panel row `fromEl` to the current med — the sheet's
 * .med-row in editor mode, or the review card in checking mode (sheet hidden). */
function _pointToSheetRow(fromEl, idx) {
  const checking = document.body.classList.contains("toolbar-collapsed");
  const target = checking
    ? document.querySelector(`.review-meds .rev-med[data-index="${idx}"]`)
    : document.querySelector(`#medTable .med-row[data-index="${idx}"]`);
  _pointToEl(fromEl, target);
}

/** Generic connector arrow from `fromEl` to `targetEl` (curved, auto-oriented by
 * their horizontal order). Highlights the target and keeps the arrow anchored on
 * scroll/resize. Used by both the history→sheet and review→history links. */
function _pointToEl(fromEl, targetEl) {
  // Guard: no target, or a hidden (zero-size) target → don't draw a broken arrow.
  if (!targetEl || !fromEl) { _hideHistArrow(); return; }
  const tRect = targetEl.getBoundingClientRect();
  const fRect = fromEl.getBoundingClientRect();
  if ((tRect.width === 0 && tRect.height === 0) || (fRect.width === 0 && fRect.height === 0)) {
    _hideHistArrow(); return;
  }
  targetEl.classList.add("sheet-pointed");
  const tr = targetEl.getBoundingClientRect();
  if (tr.top < 60 || tr.bottom > window.innerHeight - 20) {
    targetEl.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const svg = _ensureArrowLayer();
  const draw = () => {
    const a = fromEl.getBoundingClientRect();
    const b = targetEl.getBoundingClientRect();
    // Anchor on the facing edges depending on which element is to the left.
    const fromLeft = a.left < b.left;
    const x1 = fromLeft ? a.right + 2 : a.left - 2;
    const y1 = a.top + a.height / 2;
    const x2 = fromLeft ? b.left - 6 : b.right + 6;
    const y2 = b.top + b.height / 2;
    const midx = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${midx} ${y1}, ${midx} ${y2}, ${x2} ${y2}`;
    svg.querySelector("#histArrowPath").setAttribute("d", d);
  };
  draw();
  svg.classList.add("show");
  if (_histArrowRedraw) {
    window.removeEventListener("scroll", _histArrowRedraw, true);
    window.removeEventListener("resize", _histArrowRedraw);
  }
  _histArrowRedraw = draw;
  window.addEventListener("scroll", _histArrowRedraw, true);
  window.addEventListener("resize", _histArrowRedraw);
}

/** Interaction model (deliberate): only the CURRENT-order rows drive the hover
 * filter — hovering a today's-med highlights + narrows the history to that drug,
 * and draws a connector arrow to that med's row on the sheet. Hovering a HISTORY
 * row does NOT filter. Click-to-pin works on both. */
function _bindHistInteraction() {
  const panel = document.getElementById("histPanel");
  if (!panel) return;
  // Hover filter + sheet arrow — current-order rows only.
  panel.querySelectorAll("#histCurrent .hist-med[data-drugkey]").forEach((el) => {
    el.addEventListener("mouseenter", () => {
      if (!_histPinned) _histSetActive(el.dataset.drugkey);
      if (el.dataset.medidx != null) _pointToSheetRow(el, Number(el.dataset.medidx));
    });
    el.addEventListener("mouseleave", () => {
      if (!_histPinned) _histSetActive("");
      _hideHistArrow();
    });
  });
  // Click to pin/unpin — any row (current or history).
  panel.querySelectorAll(".hist-med[data-drugkey]").forEach((el) => {
    el.addEventListener("click", () => {
      _histPinned = (_histPinned === el.dataset.drugkey) ? "" : el.dataset.drugkey;
      _histSetActive(_histPinned);
    });
  });
}

/* ─────────────────── HM Process Checklist card (read-only) ────────────────
 * Pulls the same checklist the ward-view HM Process widget writes
 * (src/features/hmr/content-hmr.js), via /api/hmr, matched by HN since this
 * page doesn't have the I48-xx-xxxxxx visitid HMR is keyed by. Read-only —
 * the sheet never writes back to the HMR record. */
async function fetchAndRenderChecklist(hn) {
  if (!hn || hn === "-" || !window.BKNData || !window.BKNData.serverFetch) {
    _renderChecklist(null);
    return;
  }
  try {
    const to   = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const r = await window.BKNData.serverFetch(`/api/hmr?from=${from}&to=${to}`);
    const list = (r && r.ok && Array.isArray(r.json)) ? r.json : [];
    const rec = list.find((d) => norm(d.hn || "") === norm(hn));
    _renderChecklist(rec);
  } catch (_e) {
    _renderChecklist(null);
  }
}

function _renderChecklist(rec) {
  const cl = (rec && rec.checklist) || {};
  document.querySelectorAll("#hmprocBox .hmproc-check-row[data-check]").forEach((row) => {
    const dot = row.querySelector(".chk-dot");
    if (!dot) return;
    const v = cl[row.dataset.check];
    dot.classList.remove("yes", "no");
    if (v === true)       { dot.classList.add("yes"); dot.textContent = "✓"; }
    else if (v === false) { dot.classList.add("no");  dot.textContent = "✗"; }
    else                  { dot.textContent = "—"; }
  });
  safeSetText("hmprocMeta", rec ? `Last saved by ${rec.lastModifiedBy || "-"}` : "HM Process not started for this visit");
}

/* ─────────────── Medication Reconciliation panel (right sidebar) ──────────
 * Shows the patient's pre-admission/home meds — the same ArcusAir
 * medreconcile data Medication Journey already fetches — so the pharmacist
 * can pick items to add into the sheet's medicine table, tagged POM
 * (Patient's Own Medication). Requires context.medreconcileuid, which is
 * only captured if the pharmacist opened ArcusAir's Med Reconcile screen for
 * this patient this session (see content-home-med.js). */
let _reconMeds  = [];   // [{drug, code, status, statusRaw, instruction, frequency, route, note, addable, _id, _added}]
let _reconFilter = "all";
const _reconSelected = new Set();

const _RECON_STATUS_LABEL = { continued: "CONTINUE", stopped: "STOP", changed: "CHANGE", new: "NEW" };
const _RECON_FILTERS = ["all", "continued", "stopped", "changed", "new"];

function _setReconMeds(list) {
  _reconMeds = (list || []).map((m, i) => ({ ...m, _id: i, _added: false }));
  _reconFilter = "all";
  _reconSelected.clear();
  renderReconPanel();
}

function _reconCounts() {
  const counts = { all: _reconMeds.length, continued: 0, stopped: 0, changed: 0, new: 0 };
  _reconMeds.forEach((m) => { counts[m.status] = (counts[m.status] || 0) + 1; });
  return counts;
}

function renderReconPanel() {
  const sub     = document.getElementById("reconSub");
  const filters = document.getElementById("reconFilters");
  const list    = document.getElementById("reconList");
  const addBtn  = document.getElementById("reconAddBtn");
  const footer  = document.getElementById("reconFooter");
  if (!sub || !filters || !list || !addBtn) return;

  const selectAllRow = document.getElementById("reconSelectAllRow");

  if (!_reconMeds.length) {
    sub.textContent = "";
    filters.innerHTML = "";
    footer.style.display = "none";
    if (selectAllRow) selectAllRow.style.display = "none";
    list.innerHTML = `<div class="recon-empty">
      <span class="recon-empty-icon">🔍</span>
      Reconciliation data not loaded for this visit.<br><br>
      Open <b>Med Reconcile</b> in ArcusAir for this patient once, then click ↻.
      <br><br><span style="font-size:9px;color:#b0bec5">Once captured it's saved on the pharmacy server for 24 hours, so any workstation can load it — no need to reopen Med Reconcile.</span>
    </div>`;
    return;
  }
  footer.style.display = "";

  const counts = _reconCounts();
  sub.textContent = `medreconcileuid captured · ${counts.all} items`;
  filters.innerHTML = _RECON_FILTERS.map((key) => {
    const label = key === "all" ? "All" : _RECON_STATUS_LABEL[key];
    const n = counts[key] || 0;
    if (key !== "all" && n === 0) return "";
    const active = key === _reconFilter ? "active" : "";
    return `<span class="recon-chip ${active}" data-status="${key}">${label} ${n}</span>`;
  }).join("");

  const filtered = _reconFilter === "all" ? _reconMeds : _reconMeds.filter((m) => m.status === _reconFilter);
  list.innerHTML = filtered.length
    ? filtered.map(_reconItemHtml).join("")
    : `<div class="recon-list-empty">No items in this filter</div>`;

  _syncSelectAll(filtered);
  _updateReconAddButton();
}

/** The addable, not-yet-added items in the current filter — what "Select all"
 * targets and reflects. */
function _reconSelectableItems(filtered) {
  return (filtered || _reconMeds).filter((m) => m.addable && !m._added);
}

/** Show/hide the Select-all row and reflect its checked / indeterminate state
 * against the selectable items in the current filter. */
function _syncSelectAll(filtered) {
  const row = document.getElementById("reconSelectAllRow");
  const box = document.getElementById("reconSelectAll");
  if (!row || !box) return;
  const selectable = _reconSelectableItems(filtered);
  if (!selectable.length) { row.style.display = "none"; return; }
  row.style.display = "";
  const selectedCount = selectable.filter((m) => _reconSelected.has(m._id)).length;
  box.checked = selectedCount === selectable.length;
  box.indeterminate = selectedCount > 0 && selectedCount < selectable.length;
}

/** Compose a clean instruction line for a POM item added from Med Reconcile.
 * The reconcile data gives a Thai frequency (locallangdesc), an English route
 * ("Orally"), and free-text comments — joining them raw produced a mixed-language
 * mess ("วันละ 1 ครั้ง หลังอาหารเช้า Orally"). The sheet defaults to Thai, so we
 * render the instruction natively in Thai instead of relying on the English
 * pattern engine (which needs a "Take 1 Tablet …" shape that reconcile items,
 * lacking an explicit dose, don't reliably provide):
 *   • Verb "รับประทาน" (ทา for external/topical), then the Thai frequency.
 *   • Route "Orally" is dropped (it localises to "" in Thai for report rows too).
 *   • Any free-text comment (Thai PRN/dose detail) is appended once.
 * frequencyTh is still carried so a later language switch keeps the frequency
 * authoritative, matching report-sourced rows. */
function _reconInstruction(m) {
  const freqTh = norm(m.frequencyTh || m.frequency || "");
  const comments = norm(m.instruction || m.note || "");
  const external = _isExternalMed({ drug: m.drug, note: comments }, comments);
  const verb = external ? "ทา" : "รับประทาน";

  let instruction = [verb, freqTh].filter(Boolean).join(" ");
  // Append a meaningful comment that isn't just a repeat of the frequency.
  if (comments && comments !== freqTh && !instruction.includes(comments)) {
    instruction = `${instruction} ${comments}`.trim();
  }
  return { instruction, frequencyTh: freqTh };
}

function _reconItemHtml(m) {
  const label = _RECON_STATUS_LABEL[m.status] || m.statusRaw || "—";
  const meta  = [m.frequency, m.route].filter(Boolean).map(escapeHtml).join(" · ") || escapeHtml(m.instruction || "");
  const checked  = m._added ? "checked" : "";
  const disabled = (!m.addable || m._added) ? "disabled" : "";
  return `<div class="recon-item ${m._added ? "added" : ""}" data-id="${m._id}">
    <input type="checkbox" ${checked} ${disabled} data-id="${m._id}" />
    <div class="recon-item-body">
      <div class="recon-drug">${escapeHtml(m.drug || "")}</div>
      <div class="recon-meta">${meta}</div>
      ${m._added ? `<div class="recon-added-tag">✓ Added as POM</div>` : ""}
    </div>
    <span class="recon-status ${m.status}">${label}</span>
  </div>`;
}

function _updateReconAddButton() {
  const addBtn = document.getElementById("reconAddBtn");
  if (!addBtn) return;
  const n = _reconMeds.filter((m) => m.addable && !m._added && _reconSelected.has(m._id)).length;
  addBtn.textContent = `+ Add Selected (${n}) as POM`;
  addBtn.disabled = n === 0;
}

function _bindReconPanel() {
  // OPD-Sheet.html has no reconciliation panel — bail if the elements are absent.
  if (!document.getElementById("reconFilters")) return;
  document.getElementById("reconFilters").addEventListener("click", (e) => {
    const chip = e.target.closest(".recon-chip");
    if (!chip) return;
    _reconFilter = chip.dataset.status;
    renderReconPanel();
  });

  document.getElementById("reconList").addEventListener("change", (e) => {
    const cb = e.target.closest('input[type="checkbox"]');
    if (!cb) return;
    const id = Number(cb.dataset.id);
    if (cb.checked) _reconSelected.add(id); else _reconSelected.delete(id);
    // Re-sync the header select-all checkbox (checked/indeterminate) with the
    // current per-row selection in this filter.
    const filtered = _reconFilter === "all" ? _reconMeds : _reconMeds.filter((m) => m.status === _reconFilter);
    _syncSelectAll(filtered);
    _updateReconAddButton();
  });

  const selectAll = document.getElementById("reconSelectAll");
  if (selectAll) selectAll.addEventListener("change", () => {
    const filtered = _reconFilter === "all" ? _reconMeds : _reconMeds.filter((m) => m.status === _reconFilter);
    const selectable = _reconSelectableItems(filtered);
    selectable.forEach((m) => { if (selectAll.checked) _reconSelected.add(m._id); else _reconSelected.delete(m._id); });
    renderReconPanel();  // re-render so each row checkbox reflects the change
  });

  document.getElementById("reconAddBtn").addEventListener("click", () => {
    const toAdd = _reconMeds.filter((m) => m.addable && !m._added && _reconSelected.has(m._id));
    toAdd.forEach((m) => {
      const built = _reconInstruction(m);
      _addMed({
        drug: m.drug, code: m.code, quantity: "", source: "pom",
        instruction: built.instruction, frequencyTh: built.frequencyTh,
      });
      m._added = true;
      _reconSelected.delete(m._id);
    });
    renderReconPanel();
  });

  document.getElementById("reconReloadBtn").addEventListener("click", async () => {
    const btn = document.getElementById("reconReloadBtn");
    btn.disabled = true;
    await fetchAndRenderReconcile();
    btn.disabled = false;
  });
}

/** Enrich _context with the medreconcileuid / snapshot / incus-token for this
 * visit. Two sources, in order:
 *   1) The pharmacy server's per-visit capture bag (shared cross-workstation,
 *      24h TTL, written by capture-persist.js on ANY PC that opened Med
 *      Reconcile). This is the durable source — works with no ArcusAir tab open.
 *   2) A live, currently-open ArcusAir tab (best-effort), which may carry a
 *      fresher incus-token than the stored one — layered on top.
 * Best-effort; leaves _context unchanged if neither source has anything. */
async function _refreshReconContextFromArcus() {
  if (!_context || !_context.patientvisituid) return;
  const vid  = _context.patientvisituid;
  const puid = _context.patientuid;

  // 1) Server capture bag (durable, cross-PC).
  try {
    if (puid && window.BKNData && window.BKNData.loadCapture) {
      const cap = await window.BKNData.loadCapture(puid, vid);
      if (cap) {
        if (cap.medreconcileuid)      _context.medreconcileuid     = cap.medreconcileuid;
        if (cap.medreconcileSnapshot && !_context.medreconcileuid)
          _context.medreconcileSnapshot = cap.medreconcileSnapshot;
        if (cap.incusToken)           _context.incusToken          = cap.incusToken;
      }
    }
  } catch (_e) { /* server unavailable — fall through to live tab */ }

  // 2) Live ArcusAir tab (best-effort) — a fresher token / just-captured id.
  let resp = null;
  try {
    resp = await chrome.runtime.sendMessage({ type: "HM_REFRESH_RECON_CTX", patientvisituid: vid });
  } catch (_e) { return; }
  if (!resp || !resp.ok) return;

  const uid = (resp.medreconMap || {})[vid];
  if (uid) _context.medreconcileuid = uid;

  const snap = (resp.medhistoryMap || {})[vid];
  if (snap && !_context.medreconcileuid) _context.medreconcileSnapshot = snap;

  // A fresh incus-token lets the server make the live medreconcile/getdetail
  // call (tokens expire, so a live tab's token beats the stored one).
  const token = (resp.arcusHdrs || {})["incus-token"];
  if (token) _context.incusToken = token;
}

async function fetchAndRenderReconcile() {
  if (!_context || !window.BKNData || !window.BKNData.serverFetch) {
    _setReconMeds([]);
    return;
  }
  // Pull the latest reconcile id / snapshot / token from the ArcusAir tab first,
  // so a reload picks up a medreconcileuid captured after the sheet was opened.
  await _refreshReconContextFromArcus();
  try {
    const r = await window.BKNData.serverFetch("/api/report/reconcile-api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: _context }),
    });
    _setReconMeds((r && r.ok && r.json && Array.isArray(r.json.reconcileMeds)) ? r.json.reconcileMeds : []);
    if (r && r.ok && r.json) window.__HM_RECON_RESP__ = r.json;  // console-inspectable
  } catch (_e) {
    _setReconMeds([]);
  }
}

/* ───────────────────────────── Print controls ─────────────────────────── */
const PRINT_CONTROL_DEFAULTS = {
  marginMm: "8", previewScale: "1", fontSizeMode: "normal",
  pictureSizeMode: "normal",
  compactMode: true,        // compact rows on by default
  includeMealCard: true,    // แนบหน้า จัดตามมื้อ on by default
  // fitWidth removed — the control no longer exists.
};

function _getPrintControls() {
  return {
    printMargin: document.getElementById("printMargin"),
    previewScale: document.getElementById("previewScale"),
    fontSizeMode: document.getElementById("fontSizeMode"),
    pictureSizeMode: document.getElementById("pictureSizeMode"),
    compactMode: document.getElementById("compactMode"),
    includeMealCard: document.getElementById("includeMealCard"),
    printStatus: document.getElementById("printStatus"),
  };
}

function _ensurePrintStyleTag() {
  let style = document.getElementById("hm-print-page-style");
  if (!style) { style = document.createElement("style"); style.id = "hm-print-page-style"; document.head.appendChild(style); }
  return style;
}

function _loadPrintSettings() {
  try {
    const raw = localStorage.getItem("hm:homeMedPrintSettings");
    return raw ? { ...PRINT_CONTROL_DEFAULTS, ...JSON.parse(raw) } : { ...PRINT_CONTROL_DEFAULTS };
  } catch (_e) { return { ...PRINT_CONTROL_DEFAULTS }; }
}

function _savePrintSettings(settings) {
  try { localStorage.setItem("hm:homeMedPrintSettings", JSON.stringify(settings)); } catch (_e) { /* ignore */ }
}

function _fontSizePx(mode) { return mode === "small" ? "12px" : mode === "large" ? "14px" : "13px"; }
function _pictureSizeMm(mode) { return mode === "small" ? "16mm" : mode === "large" ? "24mm" : "20mm"; }

function applyPrintSettings(settings) {
  const cfg = { ...PRINT_CONTROL_DEFAULTS, ...(settings || {}) };
  const root = document.documentElement;
  const body = document.body;
  root.style.setProperty("--screen-scale", cfg.previewScale);
  root.style.setProperty("--base-font-size", _fontSizePx(cfg.fontSizeMode));
  root.style.setProperty("--medicine-image-size", _pictureSizeMm(cfg.pictureSizeMode));
  body.classList.toggle("compact-mode", !!cfg.compactMode);
  body.classList.toggle("hm-with-mealcard", !!cfg.includeMealCard);
  const margin = Number(cfg.marginMm) || 8;
  _ensurePrintStyleTag().textContent = `@page { size: A4 portrait; margin: ${margin}mm; }`;
  const c = _getPrintControls();
  if (c.printStatus) {
    const compact = cfg.compactMode ? " · compact" : "";
    const meal = cfg.includeMealCard ? " · จัดตามมื้อ" : "";
    c.printStatus.textContent = `A4 portrait · margin ${margin} mm · ${Math.round(Number(cfg.previewScale) * 100)}% preview${compact}${meal}`;
  }
  return cfg;
}

function currentPrintSettingsFromControls() {
  const c = _getPrintControls();
  return {
    marginMm: c.printMargin?.value || PRINT_CONTROL_DEFAULTS.marginMm,
    previewScale: c.previewScale?.value || PRINT_CONTROL_DEFAULTS.previewScale,
    fontSizeMode: c.fontSizeMode?.value || PRINT_CONTROL_DEFAULTS.fontSizeMode,
    pictureSizeMode: c.pictureSizeMode?.value || PRINT_CONTROL_DEFAULTS.pictureSizeMode,
    compactMode: !!c.compactMode?.checked,
    includeMealCard: !!c.includeMealCard?.checked,
  };
}

function bindPrintControls() {
  const c = _getPrintControls();
  const saved = _loadPrintSettings();
  if (c.printMargin) c.printMargin.value = saved.marginMm;
  if (c.previewScale) c.previewScale.value = saved.previewScale;
  if (c.fontSizeMode) c.fontSizeMode.value = saved.fontSizeMode;
  if (c.pictureSizeMode) c.pictureSizeMode.value = saved.pictureSizeMode;
  if (c.compactMode) c.compactMode.checked = !!saved.compactMode;
  if (c.includeMealCard) c.includeMealCard.checked = !!saved.includeMealCard;
  applyPrintSettings(saved);
  [c.printMargin, c.previewScale, c.fontSizeMode, c.pictureSizeMode, c.compactMode, c.includeMealCard]
    .filter(Boolean)
    .forEach((el) => el.addEventListener("change", () => {
      _savePrintSettings(applyPrintSettings(currentPrintSettingsFromControls()));
    }));
}

function buildFileName(context) {
  // Prefer the HN rendered in the sheet header (from the report), then context.
  const hnEl = document.getElementById("patientHN");
  const domHn = hnEl ? norm(hnEl.textContent) : "";
  const hn = (domHn && domHn !== "-") ? domHn : (context?.hn || context?.patientId || "");
  return `HomeMedicationSheet_${hn ? String(hn).replace(/[^\w-]+/g, "_") : "UnknownHN"}`;
}

/** Meds marked "take until finished" (🚨) but missing an end date — the sheet
 * shouldn't go out telling the patient to take a med "until finished" with no
 * stop date. Returns the list of offending drug names (empty if all OK). */
function _medsMissingEndDate() {
  return _meds
    .filter((m) => m.takeUntilFinished && !norm(m.continueEndDate || ""))
    .map((m) => norm(m.drug || "") || "(ไม่มีชื่อ)");
}

/** Warn (and let the pharmacist decide) when a take-until-finished med has no end
 * date, just before printing/PDF. Returns true to proceed, false to cancel. */
function _confirmEndDatesBeforePrint() {
  const missing = _medsMissingEndDate();
  if (!missing.length) return true;
  const list = missing.map((n) => `  • ${n}`).join("\n");
  return window.confirm(
    "⚠️ ยังไม่ได้เลือกวันสิ้นสุด (end date) สำหรับยาที่ทานต่อเนื่อง:\n\n" +
    list +
    "\n\nต้องการพิมพ์ต่อโดยไม่ระบุวันสิ้นสุดหรือไม่?\n" +
    "(กด OK เพื่อพิมพ์ต่อ, Cancel เพื่อกลับไปเลือกวันที่)"
  );
}

/** Slide the print-controls toolbar off the left edge; a ribbon tab reopens it.
 * State persists in localStorage so it stays where the pharmacist left it. */
function bindToolbarCollapse() {
  const ribbon = document.getElementById("toolbarRibbon");
  const closeBtn = document.getElementById("toolbarCollapse");
  if (!ribbon && !closeBtn) return;   // sheet without the slide-out controls
  const KEY = "hm:toolbarCollapsed";
  const setCollapsed = (on) => {
    document.body.classList.toggle("toolbar-collapsed", on);
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (_e) { /* ignore */ }
  };
  let start = false;
  try { start = localStorage.getItem(KEY) === "1"; } catch (_e) { /* ignore */ }
  document.body.classList.toggle("toolbar-collapsed", start);
  if (closeBtn) closeBtn.addEventListener("click", () => setCollapsed(true));
  if (ribbon)   ribbon.addEventListener("click", () => setCollapsed(false));
}

/** Fill the current-visit summary (Checking mode center area): 3 parts —
 *   1. Patient + vital signs + allergy
 *   2. Doctor notes (emr/doctornote/search)
 *   3. Visit summary (emr/summary/getemrsummaryvisit)
 * `data` = { patient, allergies, diagnosis, vitals, visits, doctorNotes }. */
function renderVisitSummary(data) {
  const statusTarget = document.getElementById("reviewStatus");   // patient/vitals/allergy/notes
  const visitsTarget = document.getElementById("reviewVisits");   // visit summary (left column)
  if (!statusTarget && !visitsTarget) return;
  const d = data || {};
  _visitSummaryData = d;   // stash for review-mode re-render
  const fmtDT = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ""));
    return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : (iso || "");
  };

  // ── Part 1: patient + vitals + allergy ──
  const p = d.patient || {};
  const pName = escapeHtml(p.name || p.fullName || "");
  const pMeta = [p.hn && `HN ${p.hn}`, p.visitId || p.an, p.room]
    .map((x) => escapeHtml(x || "")).filter(Boolean).join(" · ");
  const dx = d.diagnosis ? `<div class="vs-dx"><b>Dx:</b> ${escapeHtml(d.diagnosis)}</div>` : "";

  const vitals = Array.isArray(d.vitals) ? d.vitals : [];
  const vitalsHtml = vitals.length
    ? `<div class="vs-vitals">` + vitals.map((v) => {
        const flag = v.flag === "H" ? " vs-hi" : v.flag === "L" ? " vs-lo" : "";
        const arrow = v.flag === "H" ? " ▲" : v.flag === "L" ? " ▼" : "";
        return `<div class="vs-vital${flag}" title="${escapeHtml(v.name || "")}${v.range ? " · ปกติ " + escapeHtml(v.range) : ""}">`
          + `<span class="vs-vk">${escapeHtml(v.key)}</span>`
          + `<span class="vs-vv">${escapeHtml(v.value)}${arrow}</span>`
          + `<span class="vs-vu">${escapeHtml(v.unit || "")}</span></div>`;
      }).join("") + `</div>`
    : `<div class="vs-none">ไม่มีข้อมูลสัญญาณชีพ</div>`;

  const alg = d.allergies || {};
  let algHtml;
  if (alg.nkda) algHtml = `<span class="vs-alg-nkda">NKDA (ไม่มีประวัติแพ้ยา)</span>`;
  else if (Array.isArray(alg.items) && alg.items.length) {
    algHtml = alg.items.map((a) => {
      const name = escapeHtml(a.allergen || a.name || a.drug || "");
      const rx = a.reaction ? ` <span class="vs-alg-rx">(${escapeHtml(a.reaction)})</span>` : "";
      return `<span class="vs-alg-item">⚠ ${name}${rx}</span>`;
    }).join("");
  } else algHtml = `<span class="vs-none">ไม่มีข้อมูลการแพ้</span>`;

  // ── Part 2: doctor notes ──
  const notes = Array.isArray(d.doctorNotes) ? d.doctorNotes : [];
  const notesHtml = notes.length
    ? notes.map((n) =>
        `<div class="vs-note">
           <div class="vs-note-hd">🩺 ${escapeHtml(n.provider || "แพทย์")}<span class="vs-note-at">${escapeHtml(fmtDT(n.at))}</span></div>
           <div class="vs-note-body">${_sanitizeNoteClient(n.html || "")}</div>
         </div>`).join("")
    : `<div class="vs-none">ไม่มีบันทึกแพทย์</div>`;

  // ── Part 3: visit summary ──
  const visits = Array.isArray(d.visits) ? d.visits : [];
  const visitsHtml = visits.length
    ? visits.map((v) =>
        `<div class="vs-visit${v.isCurrent ? " vs-cur" : ""}">
           <div class="vs-visit-hd">${v.isCurrent ? "🟢 " : ""}${escapeHtml(v.visitId || "")}
             <span class="vs-visit-at">${escapeHtml(fmtDT(v.date))}</span></div>
           <div class="vs-visit-meta">${escapeHtml(v.department || "")}${v.provider ? " · " + escapeHtml(v.provider) : ""}</div>
           ${v.complaint ? `<div class="vs-visit-cc"><b>CC:</b> ${escapeHtml(v.complaint)}</div>` : ""}
         </div>`).join("")
    : `<div class="vs-none">ไม่มีข้อมูลการมาตรวจ</div>`;

  // Center column: [patient | allergy] two-column row, then vitals (1 line),
  // then doctor notes.
  const statusHtml =
    `<div class="vs-pt-row">
       <section class="vs-sec vs-pt-col">
         <div class="vs-sec-hd">👤 ผู้ป่วย</div>
         <div class="vs-pt-name">${pName}</div>
         ${pMeta ? `<div class="vs-pt-meta">${pMeta}</div>` : ""}
         ${dx}
       </section>
       <section class="vs-sec vs-alg-col">
         <div class="vs-sec-hd">⚠️ ประวัติการแพ้</div>
         <div class="vs-alg">${algHtml}</div>
       </section>
     </div>
     <section class="vs-sec">
       <div class="vs-sec-hd">🩹 สัญญาณชีพล่าสุด</div>
       ${vitalsHtml}
     </section>
     <section class="vs-sec vs-sec-notes">
       <div class="vs-sec-hd">🩺 บันทึกแพทย์ (Doctor Notes)</div>
       ${notesHtml}
     </section>`;
  // Left column: visit summary only.
  const visitsSecHtml =
    `<section class="vs-sec">
       <div class="vs-sec-hd">📄 สรุปการมาตรวจ (Visit Summary)</div>
       ${visitsHtml}
     </section>`;
  if (statusTarget) statusTarget.innerHTML = statusHtml;
  if (visitsTarget) visitsTarget.innerHTML = visitsSecHtml;
}

/** Second-line client-side guard on note HTML (server already sanitised it):
 * keep only the whitelisted formatting tags, drop everything else. */
function _sanitizeNoteClient(html) {
  const allowed = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI"]);
  const tpl = document.createElement("div");
  tpl.innerHTML = String(html || "");
  tpl.querySelectorAll("*").forEach((el) => {
    if (!allowed.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
    [...el.attributes].forEach((a) => el.removeAttribute(a.name));   // strip all attrs
  });
  return tpl.innerHTML;
}

function bindToolbar() {
  const btnPrint = document.getElementById("btnPrint");
  const btnPdf = document.getElementById("btnPdf");
  const btnRevert = document.getElementById("btnRevert");
  // Set document.title for both Print and PDF — browsers use it as the
  // default save/print filename, so the HN ends up in the file name. The whole
  // header (logo/title, patient info, diagnosis/allergy) now lives inside
  // <thead> and repeats with the column-header row on every printed page.
  const doPrint = () => {
    if (!_confirmEndDatesBeforePrint()) return;
    document.title = buildFileName(_context);
    applyPrintSettings(currentPrintSettingsFromControls());
    window.print();
  };
  if (btnPrint) btnPrint.onclick = doPrint;
  if (btnRevert) btnRevert.onclick = () => {
    // Signal the next load to skip the saved cache and use fresh ArcusAir data.
    sessionStorage.setItem('hm:revert', '1');
    location.reload();
  };
  if (btnPdf) btnPdf.onclick = doPrint;
}

// Chrome has no CSS counter for total printed pages, so estimate it from the
// rendered sheet height vs. the A4 content height (minus margins) just before
// printing. The current-page number itself comes from the CSS position:fixed
// + counter(page) trick in page-home-med.html, which Chrome repeats per page.
function updatePageCounterTotal() {
  const counterEl = document.getElementById("pageCounter");
  const sheetEl = document.querySelector(".sheet");
  if (!counterEl || !sheetEl) return;
  const c = _getPrintControls();
  const marginMm = Number(c.printMargin?.value) || PRINT_CONTROL_DEFAULTS.marginMm;
  const MM_TO_PX = 96 / 25.4;
  const pageContentPx = (297 - marginMm * 2) * MM_TO_PX;

  // The Daily Pill Journey Card (meal card) auto-breaks onto a fresh page when
  // it doesn't fit in the room left on the current page (its header + intro +
  // continued block avoid splitting). We can't know the exact remaining space
  // here, so conservatively count it as its own page group when shown — matching
  // the common case where it lands on a new page rather than understating.
  const mealEl = document.getElementById("mealcardSection");
  const mealCardShown = document.body.classList.contains("hm-with-mealcard");

  let totalPages;
  if (mealCardShown && mealEl) {
    const mealPx = mealEl.scrollHeight;
    const mainPx = sheetEl.scrollHeight - mealPx;
    const mainPages = Math.max(1, Math.ceil(mainPx / pageContentPx));
    const mealPages = Math.max(1, Math.ceil(mealPx / pageContentPx));
    totalPages = mainPages + mealPages;
  } else {
    const totalPx = sheetEl.scrollHeight;
    totalPages = Math.max(1, Math.ceil(totalPx / pageContentPx));
  }
  counterEl.dataset.total = String(totalPages);
}

window.addEventListener("beforeprint", updatePageCounterTotal);

function bindLangControl() {
  const sel = document.getElementById("lang");
  if (!sel) return;
  // Reflect the default language (Thai) in the dropdown.
  sel.value = _currentLang;
  sel.addEventListener("change", async (e) => {
    _currentLang = e.target.value || "";
    _offlineOnly = false;   // no-op now (engine is always offline); kept for compat
    // Note-line uses the curated TH/EN Patient Instruction directly (it is
    // data-no-translate), so swap it explicitly rather than via the engine.
    _applyNoteLang();
    const fetchEl = document.getElementById("fetchStatus");
    if (_currentLang && fetchEl) fetchEl.textContent = "⏳ กำลังแปล…";
    await _applyTranslate(_currentLang, false);
    if (fetchEl) fetchEl.textContent = _currentLang ? "✅ แปลแล้ว" : "";
  });
}

/* ─────────────────────────────── Boot ─────────────────────────────────── */
// This one JS drives both sheets: page-home-med.html (IPD) and OPD-Sheet.html.
// The OPD sheet is identified by its history panel; each opens via its own
// message type + chrome.storage.session key (see background.js openOrReuseTab).
const _IS_OPD_SHEET = !!document.getElementById("histPanel");
const _MSG_TYPE     = _IS_OPD_SHEET ? MSG.LOAD_MED_TABLE_OPD : MSG.LOAD_MED_TABLE;
const _PAYLOAD_KEY  = _IS_OPD_SHEET ? "payload_sheetOpd" : "payload_sheet";

function _applyContextAndRender(msg) {
  if (!msg || msg.type !== _MSG_TYPE) return;
  _context = msg.context || null;
  populateHeader(null, _context);
  fetchAndRender();
}

document.addEventListener("DOMContentLoaded", () => {
  bindPrintControls();
  bindToolbar();
  bindToolbarCollapse();
  bindPharmNote();
  bindSendDispense();
  bindLangControl();
  _bindReconPanel();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === _MSG_TYPE) _applyContextAndRender(msg);
  });

  chrome.storage.session.get(_PAYLOAD_KEY, (res) => {
    const stored = res && res[_PAYLOAD_KEY];
    if (stored && stored.type === _MSG_TYPE) _applyContextAndRender(stored);
    else {
      const tbody = document.querySelector("#medTable tbody");
      if (tbody) _appendNoData(tbody, _IS_OPD_SHEET
        ? "No medication data loaded. Open from the OPD dispense view."
        : "No medication data loaded. Open from the Discharge Medication dispense view.");
    }
  });
});
