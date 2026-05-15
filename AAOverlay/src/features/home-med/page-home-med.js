"use strict";

/**
 * features/home-med/page-home-med.js
 * Reworked A4 portrait Home Medication Sheet.
 *
 * Fixes:
 * - Does not force every medicine into Bedtime.
 * - Uses real discharge-medication columns: Dosage, Route, Frequency,
 *   Duration, Quantity, Comments, Careprovider.
 * - Reads the first-open payload from chrome.storage.session to avoid an
 *   initial blank/UnknownHN sheet.
 */

const { norm, escapeHtml, safeSetText, readCell, buildHeaderIndex } = window.CoreDom;
const { MSG } = window.CoreMessages;

let _patient = null;
let _lastMsg = null;
let _pharmacistName = null;
let _medDbByCode = null;
let _medDbLoadPromise = null;

const MED_DB_PATH = "src/assets/bkn_med_database/medication_by_code.json";
const MED_DB_IMAGE_BASE_PATH = "src/assets/bkn_med_database/";
const MED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "jfif", "webp"];

function _emptyPatient() {
  return {
    fullName: null,
    hn: null,
    ageText: null,
    visitDateTime: null,
    an: null,
    room: null,
    department: null,
    doctor: null,
    rights: null,
    rawText: "",
    rawLines: [],
  };
}

function _cleanPatientName(name, hn) {
  let out = norm(name || "");
  if (!out) return "-";
  if (hn) {
    const hnLoose = hn.replace(/-/g, "\\s*-\\s*");
    out = out.replace(new RegExp(`\\(?\\s*${hnLoose}\\s*\\)?`, "i"), "");
  }
  return norm(out.replace(/\(\s*\)?/g, "")) || "-";
}

function populateHeader(p) {
  const patient = p || _emptyPatient();
  const name = _cleanPatientName(patient.fullName, patient.hn);

  safeSetText("patientName", name);
  safeSetText("patientHN", patient.hn || "-");
  safeSetText("patientAN", patient.an || "-");
  safeSetText("patientRoom", patient.room || "-");
  safeSetText("sheetDate", patient.visitDateTime || new Date().toLocaleDateString("th-TH"));
  safeSetText("pharmacistName", _pharmacistName || "-");
}

function _appendNoData(tbody, text) {
  const tr = document.createElement("tr");
  tr.innerHTML = `<td colspan="4" class="empty">${escapeHtml(text)}</td>`;
  tbody.appendChild(tr);
}

function _isGroupRow(cells) {
  return cells.length === 1 || cells.some((td) => td.hasAttribute("colspan"));
}

function _cleanValue(value) {
  return norm(value).replace(/^[-–—]+$/, "");
}

function _cleanDrugName(value) {
  return _cleanValue(value).replace(/\s+/g, " ");
}

function _runtimeUrl(path) {
  if (typeof chrome !== "undefined" && chrome.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

function _pharmacyServerUrl() {
  const stored = typeof localStorage !== "undefined"
    ? localStorage.getItem("pharmacyServerUrl")
    : null;
  return (stored || "http://10.134.110.81:8765").replace(/\/$/, "");
}

async function _loadMedicationDatabase() {
  if (_medDbByCode) return _medDbByCode;
  if (_medDbLoadPromise) return _medDbLoadPromise;

  _medDbLoadPromise = (async () => {
    // 1. Try server first
    try {
      const r = await fetch(`${_pharmacyServerUrl()}/api/medication-db`, {
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        _medDbByCode = await r.json();
        return _medDbByCode;
      }
    } catch (_) { /* server unavailable */ }

    // 2. Fall back to bundled extension asset
    try {
      const r = await fetch(_runtimeUrl(MED_DB_PATH));
      if (!r.ok) throw new Error(`status ${r.status}`);
      _medDbByCode = await r.json();
    } catch (err) {
      console.warn("[home-med] Medication database unavailable:", err);
      _medDbByCode = {};
    }
    return _medDbByCode;
  })();

  return _medDbLoadPromise;
}

function _lookupMedicationItem(med) {
  const db = _medDbByCode || {};
  const code = _cleanValue(med?.code || "");
  if (!code) return null;

  if (db[code]) return db[code];

  // Fallback for accidental formatting/spacing in item code.
  const compact = code.replace(/\D/g, "");
  if (compact && db[compact]) return db[compact];

  return null;
}

function _medicineImageCandidates(med) {
  const item = _lookupMedicationItem(med);
  const code = _cleanValue(med?.code || "").replace(/\D/g, "");
  const candidates = [];

  // 1) Prefer explicit path from medication_by_code.json when available.
  if (item) {
    const imagePath = item.image_path || (item.image_file ? `images/${item.image_file}` : "");
    if (imagePath) candidates.push(imagePath.replace(/^\/+/, ""));
  }

  // 2) Fallback: try direct filename by item code.
  // This fixes cases where the image file exists in src/assets/bkn_med_database/images/
  // but medication_by_code.json still says has_image:false or has an empty image_path.
  if (code) {
    MED_IMAGE_EXTENSIONS.forEach((ext) => candidates.push(`images/${code}.${ext}`));
  }

  return [...new Set(candidates)].map((path) => _runtimeUrl(MED_DB_IMAGE_BASE_PATH + path));
}

function _renderNoImageSlot(icon) {
  return `
    <span class="med-photo-icon">${icon}</span>
    <span class="med-photo-label">รูปยา</span>`;
}

function _buildMedicinePhotoSlot(med) {
  const icon = _medicineIcon(med);
  const candidates = _medicineImageCandidates(med);

  if (candidates.length) {
    return `
      <div class="med-photo-slot has-image" data-fallback-icon="${escapeHtml(icon)}">
        <img class="med-photo" src="${escapeHtml(candidates[0])}" data-img-index="0" data-img-candidates="${escapeHtml(encodeURIComponent(JSON.stringify(candidates)))}" alt="Medicine picture" />
      </div>`;
  }

  return `
    <div class="med-photo-slot no-image" aria-label="Medicine picture placeholder">
      ${_renderNoImageSlot(icon)}
    </div>`;
}

function _bindMedicineImageFallbacks(root) {
  if (!root) return;

  root.querySelectorAll("img.med-photo[data-img-candidates]").forEach((img) => {
    img.addEventListener("error", () => {
      let candidates = [];
      try {
        candidates = JSON.parse(decodeURIComponent(img.dataset.imgCandidates || "%5B%5D"));
      } catch (_err) {
        candidates = [];
      }

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
  });
}

function _doseUnitThai(unit) {
  const u = (unit || "").toLowerCase();
  if (/tablet|tab\b/.test(u)) return "เม็ด";
  if (/capsule|cap\b/.test(u)) return "แคปซูล";
  if (/millilitre|milliliter|ml\b/.test(u)) return "มิลลิลิตร";
  if (/bottle/.test(u)) return "ขวด";
  if (/drop/.test(u)) return "หยด";
  if (/puff|spray/.test(u)) return "พัฟ";
  if (/sachet/.test(u)) return "ซอง";
  return unit || "";
}

function _formatDoseHuman(dosage) {
  const raw = _cleanValue(dosage);
  if (!raw) return "";

  const m = raw.match(/([0-9]+(?:\.[0-9]+)?)\s*(.*)$/i);
  if (!m) return `ครั้งละ ${raw}`;

  const amount = m[1];
  const unit = _doseUnitThai(m[2].trim());
  return `ครั้งละ ${amount}${unit ? ` ${unit}` : ""}`;
}


function _medicineIcon({ dosage = "", drug = "", quantity = "" } = {}) {
  const text = `${dosage} ${drug} ${quantity}`.toLowerCase();

  // Liquid / mL / syrup items use a liquid icon.
  if (/\b(ml|millilitre|milliliter|syrup|syr\b|solution|suspension|elixir|bottle)\b/i.test(text)) {
    return "🧪";
  }

  // Tablet and capsule use the same medicine icon.
  if (/\b(tablet|tab\b|capsule|cap\b)\b/i.test(text)) {
    return "💊";
  }

  return "💊";
}

function _formatRouteHuman(route) {
  const r = _cleanValue(route);
  if (!r) return "";
  if (/oral|orally|po\b|รับประทาน/i.test(r)) return "รับประทาน";
  if (/topical|apply|ทา/i.test(r)) return "ทา";
  if (/inhal|สูด/i.test(r)) return "สูดดม";
  if (/nasal|จมูก/i.test(r)) return "ใช้ทางจมูก";
  if (/eye|ophthalmic|ตา/i.test(r)) return "ใช้กับตา";
  if (/ear|otic|หู/i.test(r)) return "ใช้กับหู";
  return r;
}

function _mealText(f) {
  if (/before/i.test(f)) {
    if (/breakfast.*lunch.*dinner/i.test(f)) return "ก่อนอาหารเช้า กลางวัน และเย็น";
    if (/breakfast.*dinner/i.test(f)) return "ก่อนอาหารเช้าและเย็น";
    if (/breakfast/i.test(f)) return "ก่อนอาหารเช้า";
    if (/lunch/i.test(f)) return "ก่อนอาหารกลางวัน";
    if (/dinner/i.test(f)) return "ก่อนอาหารเย็น";
    return "ก่อนอาหาร";
  }

  if (/after/i.test(f)) {
    if (/breakfast.*lunch.*dinner/i.test(f)) return "หลังอาหารเช้า กลางวัน และเย็น";
    if (/breakfast.*dinner/i.test(f)) return "หลังอาหารเช้าและเย็น";
    if (/breakfast/i.test(f)) return "หลังอาหารเช้า";
    if (/lunch/i.test(f)) return "หลังอาหารกลางวัน";
    if (/dinner/i.test(f)) return "หลังอาหารเย็น";
    return "หลังอาหาร";
  }

  if (/bedtime|at night|night/i.test(f)) return "ก่อนนอน";
  return "";
}

function _prnText(f) {
  if (!/if\s*needed|when\s*have\s*symptom|prn/i.test(f)) return "";
  if (/fever/i.test(f)) return "เมื่อมีไข้";
  if (/pain/i.test(f)) return "เมื่อมีอาการปวด";
  if (/nausea|vomit/i.test(f)) return "เมื่อมีอาการคลื่นไส้หรืออาเจียน";
  if (/constipation/i.test(f)) return "เมื่อท้องผูก";
  return "เมื่อมีอาการ";
}

function _frequencyText(frequency) {
  const raw = _cleanValue(frequency);
  if (!raw) return "";

  const f = raw.toLowerCase().replace(/\s+/g, " ");
  const parts = [];

  const every = f.match(/every\s+(\d+)\s+hours?/i);
  if (every) parts.push(`ทุก ${every[1]} ชั่วโมง`);
  else if (/once\s+daily|1\s*time\s*daily|daily/i.test(f)) parts.push("วันละ 1 ครั้ง");
  else if (/2\s*times?\s*daily|twice\s*daily|bid/i.test(f)) parts.push("วันละ 2 ครั้ง");
  else if (/3\s*times?\s*daily|three\s*times?\s*daily|tid/i.test(f)) parts.push("วันละ 3 ครั้ง");
  else if (/4\s*times?\s*daily|qid/i.test(f)) parts.push("วันละ 4 ครั้ง");

  const meal = _mealText(raw);
  if (meal) parts.push(meal);

  const prn = _prnText(raw);
  if (prn) parts.push(prn);

  return parts.join(" ") || raw;
}

function _buildInstruction(med) {
  const { dosage, route, frequency, comment } = med || {};
  const icon = _medicineIcon(med);
  const routeText = _formatRouteHuman(route);
  const doseText = _formatDoseHuman(dosage);
  const freqText = _frequencyText(frequency);

  const sentence = [routeText, doseText, freqText]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const html = [];
  if (sentence) {
    html.push(`<div class="instruction-card"><span class="instruction-icon">${icon}</span><span class="instruction-text">${escapeHtml(sentence)}</span></div>`);
  } else {
    html.push(`<span class="muted">No instruction</span>`);
  }

  if (comment) {
    html.push(`<div class="comment">หมายเหตุ: ${escapeHtml(comment)}</div>`);
  }

  return html.join("");
}


function _durationText(duration) {
  const d = _cleanValue(duration);
  if (!d) return "";

  // Arcus often sends duration as a plain number, meaning days.
  // Example: 7 -> 7 days.
  const numeric = d.match(/^([0-9]+(?:\.[0-9]+)?)$/);
  if (numeric) {
    const n = numeric[1];
    return `${n} day${Number(n) === 1 ? "" : "s"}`;
  }

  if (/^([0-9]+(?:\.[0-9]+)?)\s*d(?:ay)?s?$/i.test(d)) {
    const n = d.match(/^([0-9]+(?:\.[0-9]+)?)/)[1];
    return `${n} day${Number(n) === 1 ? "" : "s"}`;
  }

  return d;
}

function _isBottleUom(quantity) {
  return /\bbottles?\b/i.test(_cleanValue(quantity));
}

function _isPrnFrequency(frequency) {
  return /\bif\s+needed\b/i.test(_cleanValue(frequency));
}

function _shouldShowDuration({ quantity, frequency, duration }) {
  const d = _cleanValue(duration);
  if (!d) return false;

  // Do not print "For: 1 day" for bottle items or PRN orders.
  // Examples: "1 Bottle" and frequency containing "If Needed".
  if (_isBottleUom(quantity)) return false;
  if (_isPrnFrequency(frequency)) return false;

  return true;
}

function _buildQty({ quantity, duration, frequency }) {
  const d = _shouldShowDuration({ quantity, duration, frequency })
    ? _durationText(duration)
    : "";
  const parts = [];
  if (quantity) parts.push(`<div class="qty-main">${escapeHtml(quantity)}</div>`);
  if (d) parts.push(`<div class="muted">For: ${escapeHtml(d)}</div>`);
  return parts.length ? parts.join("") : `<span class="muted">-</span>`;
}

function _extractMedRows(html) {
  const tmp = document.createElement("div");
  tmp.innerHTML = html || "";

  const table = tmp.querySelector("table");
  if (!table) return [];

  const idx = buildHeaderIndex(table);
  const rows = [];

  Array.from(table.querySelectorAll("tbody tr")).forEach((tr) => {
    const cells = Array.from(tr.children);
    if (!cells.length || _isGroupRow(cells)) return;

    const status = _cleanValue(readCell(cells, idx, ["status"]));
    if (/cancelled/i.test(status)) return;

    const row = {
      code: _cleanValue(readCell(cells, idx, ["code"])),
      drug: _cleanDrugName(readCell(cells, idx, ["order item", "drug", "medication"])),
      dosage: _cleanValue(readCell(cells, idx, ["dosage", "dose"])),
      route: _cleanValue(readCell(cells, idx, ["route"])),
      frequency: _cleanValue(readCell(cells, idx, ["frequency", "freq"])),
      duration: _cleanValue(readCell(cells, idx, ["duration"])),
      quantity: _cleanValue(readCell(cells, idx, ["quantity", "qty"])),
      comment: _cleanValue(readCell(cells, idx, ["comments", "comment", "instruction", "sig"])),
      provider: _cleanValue(readCell(cells, idx, ["careprovider", "provider"])),
    };

    if (!row.drug && !row.dosage && !row.frequency && !row.comment) return;
    rows.push(row);
  });

  return rows;
}

function buildMedTable(html) {
  const tbody = document.querySelector("#medTable tbody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const rows = _extractMedRows(html);
  if (!rows.length) {
    _appendNoData(tbody, "No active discharge medication found");
    safeSetText("physicianName", "-");
    return;
  }

  let physician = "";

  rows.forEach((med, i) => {
    if (!physician && med.provider) physician = med.provider;
    const medPhoto = _buildMedicinePhotoSlot(med);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="col-no">${i + 1}</td>
      <td class="col-med">
        <div class="med-cell">
${medPhoto}
          <div class="med-text">
            <div class="med-name">${escapeHtml(med.drug || "-")}</div>
            ${med.code ? `<div class="med-code">Code: ${escapeHtml(med.code)}</div>` : ""}
          </div>
        </div>
      </td>
      <td class="col-how">${_buildInstruction(med)}</td>
      <td class="col-qty">${_buildQty(med)}</td>
    `;
    tbody.appendChild(tr);
  });

  _bindMedicineImageFallbacks(tbody);
  safeSetText("physicianName", physician || "-");
}

const PRINT_CONTROL_DEFAULTS = {
  marginMm: "8",
  previewScale: "1",
  fontSizeMode: "normal",
  pictureSizeMode: "normal",
  compactMode: false,
  hideLogo: false,
};

function _getPrintControls() {
  return {
    paperSize: document.getElementById("paperSize"),
    printMargin: document.getElementById("printMargin"),
    previewScale: document.getElementById("previewScale"),
    fontSizeMode: document.getElementById("fontSizeMode"),
    pictureSizeMode: document.getElementById("pictureSizeMode"),
    compactMode: document.getElementById("compactMode"),
    hideLogo: document.getElementById("hideLogo"),
    printStatus: document.getElementById("printStatus"),
  };
}

function _ensurePrintStyleTag() {
  let style = document.getElementById("hm-print-page-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "hm-print-page-style";
    document.head.appendChild(style);
  }
  return style;
}

function _loadPrintSettings() {
  try {
    const raw = localStorage.getItem("hm:homeMedPrintSettings");
    return raw ? { ...PRINT_CONTROL_DEFAULTS, ...JSON.parse(raw) } : { ...PRINT_CONTROL_DEFAULTS };
  } catch (_err) {
    return { ...PRINT_CONTROL_DEFAULTS };
  }
}

function _savePrintSettings(settings) {
  try {
    localStorage.setItem("hm:homeMedPrintSettings", JSON.stringify(settings));
  } catch (_err) {
    // localStorage can be disabled in some extension contexts; ignore safely.
  }
}

function _fontSizePx(mode) {
  if (mode === "small") return "12px";
  if (mode === "large") return "14px";
  return "13px";
}

function _pictureSizeMm(mode) {
  if (mode === "small") return "16mm";
  if (mode === "large") return "24mm";
  return "20mm";
}

function applyPrintSettings(settings) {
  const cfg = { ...PRINT_CONTROL_DEFAULTS, ...(settings || {}) };
  const root = document.documentElement;
  const body = document.body;

  root.style.setProperty("--screen-scale", cfg.previewScale);
  root.style.setProperty("--base-font-size", _fontSizePx(cfg.fontSizeMode));
  root.style.setProperty("--medicine-image-size", _pictureSizeMm(cfg.pictureSizeMode));

  body.classList.toggle("compact-mode", !!cfg.compactMode);
  body.classList.toggle("hide-logo", !!cfg.hideLogo);

  const margin = Number(cfg.marginMm) || 8;
  const style = _ensurePrintStyleTag();
  style.textContent = `@page { size: A4 portrait; margin: ${margin}mm; }`;

  const controls = _getPrintControls();
  if (controls.printStatus) {
    const compact = cfg.compactMode ? " · compact" : "";
    const logo = cfg.hideLogo ? " · logo hidden" : "";
    controls.printStatus.textContent = `A4 portrait · margin ${margin} mm · ${Math.round(Number(cfg.previewScale) * 100)}% preview${compact}${logo}`;
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

  applyPrintSettings(saved);

  [c.printMargin, c.previewScale, c.fontSizeMode, c.pictureSizeMode, c.compactMode, c.hideLogo]
    .filter(Boolean)
    .forEach((el) => {
      el.addEventListener("change", () => {
        const next = applyPrintSettings(currentPrintSettingsFromControls());
        _savePrintSettings(next);
      });
    });
}

function buildFileName(p) {
  const hn = p?.hn ? p.hn.replace(/[^\w-]+/g, "_") : "UnknownHN";
  return `HomeMedicationSheet_${hn}`;
}

function bindToolbar(patient) {
  const btnPrint = document.getElementById("btnPrint");
  const btnPdf = document.getElementById("btnPdf");
  const btnRevert = document.getElementById("btnRevert");

  if (btnPrint) {
    btnPrint.onclick = () => {
      applyPrintSettings(currentPrintSettingsFromControls());
      window.print();
    };
  }

  if (btnRevert) btnRevert.onclick = () => location.reload();

  if (btnPdf) {
    btnPdf.onclick = () => {
      document.title = buildFileName(patient);
      applyPrintSettings(currentPrintSettingsFromControls());
      window.print();
    };
  }
}

async function renderFromMessage(msg) {
  if (!msg || msg.type !== MSG.LOAD_MED_TABLE) return;
  _lastMsg = msg;
  _patient = msg.patientData || _emptyPatient();
  _pharmacistName = msg.pharmacistName || null;

  populateHeader(_patient);
  await _loadMedicationDatabase();
  buildMedTable(msg.tableHTML || "");
  bindToolbar(_patient);
}

function _buildPrintHeader() {
  const cell = document.getElementById("printHdrCell");
  if (!cell) return;
  cell.innerHTML = "";
  [".top-title", ".patient-card", ".section-title"].forEach((sel) => {
    const el = document.querySelector(sel);
    if (el) cell.appendChild(el.cloneNode(true));
  });
}

document.addEventListener("DOMContentLoaded", () => {
  bindPrintControls();
  bindToolbar(_patient || _emptyPatient());

  window.addEventListener("beforeprint", _buildPrintHeader);
  window.addEventListener("afterprint", () => {
    const cell = document.getElementById("printHdrCell");
    if (cell) cell.innerHTML = "";
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== MSG.LOAD_MED_TABLE) return;
    renderFromMessage(msg);
  });

  chrome.storage.session.get("payload_sheet", (res) => {
    const stored = res?.payload_sheet;
    if (stored?.type === MSG.LOAD_MED_TABLE) renderFromMessage(stored);
    else if (!_lastMsg) {
      const tbody = document.querySelector("#medTable tbody");
      if (tbody) _appendNoData(tbody, "No medication data loaded. Please open from the discharge medication dialog.");
    }
  });
});
