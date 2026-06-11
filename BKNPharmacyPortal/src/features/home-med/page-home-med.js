"use strict";

/**
 * features/home-med/page-home-med.js
 * Reworked Home Medication Sheet page.
 *
 * Flow:
 *   1. Receive { context } (patient/report UIDs) via LOAD_MED_TABLE message or
 *      chrome.storage.session (payload_sheet).
 *   2. Build the HomeMedSheetReport/Thai Jasper URL from the context.
 *   3. Fetch the XLS via MJ_FETCH_XLS, parse with parseBiff8ToSheets.
 *   4. Map rows (header-agnostic) → meds, filter to oral / take-home only,
 *      extract the patient header from the report itself.
 *   5. Render the existing A4 layout. Images come from the pharmacy server via
 *      BKNData. From/to dates are adjustable in the toolbar (re-fetch on change).
 */

const { norm, escapeHtml, safeSetText } = window.CoreDom;
const { MSG } = window.CoreMessages;

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
function populateHeader(header, context, meds) {
  const h = header || {};
  const c = context || {};
  // Physician isn't in the report header; take it from the first med's provider.
  const physician = (meds || []).map((m) => m.provider).find(Boolean) || "-";
  safeSetText("patientName", h.patientName || c.patientName || "-");
  safeSetText("patientHN",   h.hn || c.hn || c.patientId || "-");
  safeSetText("patientAN",   h.an || c.an || c.patientVisitId || "-");
  safeSetText("patientRoom", h.room || c.bed || "-");
  safeSetText("sheetDate",   h.visitDate || new Date().toLocaleDateString("th-TH"));
  safeSetText("pharmacistName", c.pharmacistName || "-");
  safeSetText("physicianName",  physician);
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
  const th = norm(med.note || "");
  const en = norm(med.noteEn || "");
  return (_currentLang === "en") ? (en || th) : (th || en);
}

/** Swap each note-line to the current language without re-rendering the table.
 * Only swaps cells the user hasn't manually edited (current text still matches
 * one of the stored TH/EN variants). */
function _applyNoteLang() {
  document.querySelectorAll(".note-line[data-field='note']").forEach((el) => {
    const th = el.dataset.noteTh || "";
    const en = el.dataset.noteEn || "";
    const cur = norm(el.textContent || "");
    // Respect a user edit: leave it alone if it isn't one of the variants.
    if (cur && cur !== norm(th) && cur !== norm(en)) return;
    el.textContent = (_currentLang === "en") ? (en || th) : (th || en);
  });
}

/* ─────────────────────── Editable med-list state ──────────────────────── */
// _meds is the single source of truth. Each item:
//   { drug, instruction, note, quantity, code, provider, frequencyTh }
let _meds = [];
// "How to take" defaults to Thai. On first load we translate with the OFFLINE
// engine only (medical-glossary patterns + frequency master), so the sheet reads
// Thai — verb/unit/route/frequency/qty — without any Google Translate call.
// Changing the language dropdown re-translates and DOES allow the Google
// fallback (Layer 3) for residual English / other languages.
let _currentLang = "th";
// First render localises offline only (no network). User-chosen languages flip
// this off so the full engine (incl. Google fallback) runs.
let _offlineOnly = true;

function _medFromReport(m) {
  return {
    drug:        norm(m.drug || ""),
    instruction: _instructionText(m),
    note:        norm(m.note || ""),     // Patient Instruction note — Thai (default)
    noteEn:      norm(m.noteEn || ""),   // same note in English (for lang switch)
    quantity:    _cleanValue(m.quantity || ""),
    code:        norm(m.code || ""),
    provider:    norm(m.provider || ""),
    // Authoritative Thai frequency phrase (BKN frequency master); when present
    // it overrides the engine's frequency translation on the instruction line.
    frequencyTh: norm(m.frequencyTh || ""),
  };
}

/* ─────────────────────────────── Render ───────────────────────────────── */
function _appendNoData(tbody, text) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td colspan="5" class="empty">${escapeHtml(text)}</td>`;
  tbody.appendChild(tr);
}

/** Build one editable medicine row. */
function _buildMedRow(med, index) {
  const candidates = _medicineImageCandidates(med);
  const photo = _buildMedicinePhotoSlot(med, candidates);
  const tr = document.createElement("tr");
  tr.className = "med-row";
  tr.dataset.index = String(index);
  tr.innerHTML = `
    <td class="col-act no-print">
      <button type="button" class="row-del" title="Remove this medicine">−</button>
    </td>
    <td class="col-no">${index + 1}</td>
    <td class="col-med">
      <div class="med-cell">
${photo}
        <div class="med-text">
          <div class="med-name" contenteditable="true" data-field="drug" data-ph="ชื่อยา" data-no-translate translate="no">${escapeHtml(med.drug || "")}</div>
          ${med.code ? `<div class="med-code">Code: ${escapeHtml(med.code)}</div>` : ""}
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

  _meds.forEach((med, i) => tbody.appendChild(_buildMedRow(med, i)));

  // Always append the "add medicine" row at the bottom (hidden when printing).
  tbody.appendChild(_buildAddRow());

  _bindMedicineImageFallbacks(tbody);
  _bindRowEditing(tbody);

  // Re-init the translation engine on the freshly rendered table and localise.
  // First load runs offline-only (no Google) — the glossary patterns already
  // produce full Thai. Later renders (after a language change / edits) allow the
  // Google fallback so any residual English / other languages still translate.
  _initTranslate();
  if (_currentLang) await _applyTranslate(_currentLang, _offlineOnly);
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
  _meds[index][field] = norm(value);
  // A manual note edit overrides both languages so switching lang keeps it.
  if (field === "note") _meds[index].noteEn = norm(value);
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
    provider: "",
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
    if (cached && cached.kind === "homeMedSheet" && Array.isArray(cached.meds)) {
      return cached.meds;
    }
  } catch (_) { /* ignore */ }
  return null;
}

/* ─────────────────────────── Fetch + orchestrate ──────────────────────── */
function _setStatus(text) {
  const el = document.getElementById("fetchStatus");
  if (el) el.textContent = text;
}

async function fetchAndRender() {
  const tbody = document.querySelector("#medTable tbody");
  if (!_context || !_context.patientvisituid) {
    if (tbody) { tbody.innerHTML = ""; _appendNoData(tbody, "No patient context. Open from the Discharge Medication dispense view."); }
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
  await _loadMedicationDatabase();

  // Fetch discharge meds + allergies from the ArcusAir getallorderitem API.
  let resp = null;
  try {
    resp = await window.BKNData.serverFetch("/api/report/home-med-api", {
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
  const saved = await _loadSavedMeds();
  if (saved && saved.length) {
    _meds = saved.map((m) => ({
      drug: norm(m.drug || ""), instruction: norm(m.instruction || ""),
      note: norm(m.note || ""), noteEn: norm(m.noteEn || ""),
      quantity: norm(m.quantity || ""),
      code: norm(m.code || ""), provider: norm(m.provider || ""),
      frequencyTh: norm(m.frequencyTh || ""),
    }));
    _setStatus(`✅ ${_meds.length} รายการ (โหลดฉบับที่แก้ไขไว้)`);
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
  await renderMeds();
}

/* ───────────────────────────── Print controls ─────────────────────────── */
const PRINT_CONTROL_DEFAULTS = {
  marginMm: "8", previewScale: "1", fontSizeMode: "normal",
  pictureSizeMode: "normal", compactMode: false, hideLogo: false, fitWidth: false,
};

function _getPrintControls() {
  return {
    printMargin: document.getElementById("printMargin"),
    previewScale: document.getElementById("previewScale"),
    fontSizeMode: document.getElementById("fontSizeMode"),
    pictureSizeMode: document.getElementById("pictureSizeMode"),
    compactMode: document.getElementById("compactMode"),
    hideLogo: document.getElementById("hideLogo"),
    fitWidth: document.getElementById("fitWidth"),
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
  body.classList.toggle("hide-logo", !!cfg.hideLogo);
  body.classList.toggle("fit-width", !!cfg.fitWidth);
  const margin = Number(cfg.marginMm) || 8;
  _ensurePrintStyleTag().textContent = `@page { size: A4 portrait; margin: ${margin}mm; }`;
  const c = _getPrintControls();
  if (c.printStatus) {
    const compact = cfg.compactMode ? " · compact" : "";
    const logo = cfg.hideLogo ? " · logo hidden" : "";
    c.printStatus.textContent = `A4 portrait · margin ${margin} mm · ${Math.round(Number(cfg.previewScale) * 100)}% preview${compact}${logo}`;
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
    hideLogo: !!c.hideLogo?.checked,
    fitWidth: !!c.fitWidth?.checked,
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
  if (c.hideLogo) c.hideLogo.checked = !!saved.hideLogo;
  if (c.fitWidth) c.fitWidth.checked = !!saved.fitWidth;
  applyPrintSettings(saved);
  [c.printMargin, c.previewScale, c.fontSizeMode, c.pictureSizeMode, c.compactMode, c.hideLogo, c.fitWidth]
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

function bindToolbar() {
  const btnPrint = document.getElementById("btnPrint");
  const btnPdf = document.getElementById("btnPdf");
  const btnRevert = document.getElementById("btnRevert");
  // Set document.title for both Print and PDF — browsers use it as the
  // default save/print filename, so the HN ends up in the file name. The header
  // sections print once at the top; the column-header row repeats via <thead>.
  if (btnPrint) btnPrint.onclick = () => { document.title = buildFileName(_context); applyPrintSettings(currentPrintSettingsFromControls()); window.print(); };
  if (btnRevert) btnRevert.onclick = () => location.reload();
  if (btnPdf) btnPdf.onclick = () => { document.title = buildFileName(_context); applyPrintSettings(currentPrintSettingsFromControls()); window.print(); };
}

function bindLangControl() {
  const sel = document.getElementById("lang");
  if (!sel) return;
  // Reflect the default language (Thai) in the dropdown.
  sel.value = _currentLang;
  sel.addEventListener("change", async (e) => {
    _currentLang = e.target.value || "";
    _offlineOnly = false;   // a user-chosen language may use the Google fallback
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
function _applyContextAndRender(msg) {
  if (!msg || msg.type !== MSG.LOAD_MED_TABLE) return;
  _context = msg.context || null;
  populateHeader(null, _context);
  fetchAndRender();
}

document.addEventListener("DOMContentLoaded", () => {
  bindPrintControls();
  bindToolbar();
  bindLangControl();

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG.LOAD_MED_TABLE) _applyContextAndRender(msg);
  });

  chrome.storage.session.get("payload_sheet", (res) => {
    const stored = res?.payload_sheet;
    if (stored?.type === MSG.LOAD_MED_TABLE) _applyContextAndRender(stored);
    else {
      const tbody = document.querySelector("#medTable tbody");
      if (tbody) _appendNoData(tbody, "No medication data loaded. Open from the Discharge Medication dispense view.");
    }
  });
});
