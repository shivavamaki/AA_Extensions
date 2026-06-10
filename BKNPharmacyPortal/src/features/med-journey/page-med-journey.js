"use strict";

/**
 * features/med-journey/page-med-journey.js
 * Medication Journey timeline — each drug across phases (before/admission →
 * ward → discharge) with an editable status + note. Data from the ArcusAir
 * getallorderitem API (all order types), grouped server-side.
 */

const { norm, escapeHtml, safeSetText } = window.CoreDom;
const { MSG } = window.CoreMessages;

let _context = null;
let _rows = [];            // [{drug, code, admission, ward, home, status, note, provider}]
let _currentLang = "th";   // instructions default to Thai (shared glossary)

const STATUSES = ["continued", "new", "changed", "stopped"];
const STATUS_TH = { continued: "ใช้ต่อ", new: "เริ่มใหม่", changed: "เปลี่ยน", stopped: "หยุด" };

/** Group rows by status (legend order), then alphabetically by medicine name. */
function _sortRows() {
  const order = (s) => {
    const i = STATUSES.indexOf(s);
    return i === -1 ? STATUSES.length : i;
  };
  _rows.sort((a, b) =>
    order(a.status) - order(b.status) ||
    (a.drug || "").localeCompare(b.drug || "", "en", { sensitivity: "base" })
  );
}

/* ───────────────────────── Server access ──────────────────────────────── */
async function _serverBase() {
  try { if (window.BKNData?.getServerUrl) return (await window.BKNData.getServerUrl()) || ""; }
  catch (_) { /* ignore */ }
  return "";
}

function _setStatus(text) {
  const el = document.getElementById("fetchStatus");
  if (el) el.textContent = text;
}

/* ───────────────────────── Patient / banner ───────────────────────────── */
function populateHeader(header, context) {
  const h = header || {};
  const c = context || {};
  safeSetText("patientName", h.patientName || c.patientName || "-");
  safeSetText("patientHN",   h.hn || c.hn || "-");
  safeSetText("patientAN",   h.an || c.an || "-");
  safeSetText("patientRoom", h.room || "-");
  safeSetText("sheetDate",   new Date().toLocaleDateString("th-TH"));
  safeSetText("pharmacistName", c.pharmacistName || "-");
}

function renderDiagnosis(diagnosis) {
  const line = document.getElementById("dxLine");
  const valEl = document.getElementById("diagnosisValue");
  if (!line || !valEl) return;
  const dx = norm(diagnosis || "");
  if (dx) { valEl.textContent = dx; line.classList.remove("empty"); }
  else { line.classList.add("empty"); }
}

function renderAllergies(allergies) {
  const banner = document.getElementById("allergyBanner");
  const valEl = document.getElementById("allergyValue");
  if (!banner || !valEl) return;
  const a = allergies || {};
  const items = Array.isArray(a.items) ? a.items : [];
  if (items.length) {
    banner.classList.remove("nkda");
    valEl.textContent = items.map((it) => it.reaction ? `${it.allergen} (${it.reaction})` : it.allergen)
      .filter(Boolean).join(", ") || "มีประวัติแพ้ยา";
  } else if (a.nkda) {
    banner.classList.add("nkda");
    valEl.textContent = "No Known Drug Allergies (ไม่มีประวัติแพ้ยา)";
  } else {
    banner.classList.add("nkda");
    valEl.textContent = "ไม่มีข้อมูลแพ้ยา (allergy info unavailable)";
  }
}

/* ───────────────────────── Row rendering ──────────────────────────────── */
function _statusOptions(sel) {
  return STATUSES.map((s) =>
    `<option value="${s}"${s === sel ? " selected" : ""}>${STATUS_TH[s]} (${s})</option>`
  ).join("");
}

function _buildRow(row, i) {
  const tr = document.createElement("tr");
  tr.className = "j-row";
  tr.dataset.index = String(i);
  tr.dataset.status = row.status || "";
  tr.innerHTML = `
    <td class="col-act no-print"><button type="button" class="row-del" title="Remove">−</button></td>
    <td class="col-drug">
      <div class="drug-name" contenteditable="true" data-field="drug" data-ph="ชื่อยา" data-no-translate translate="no">${escapeHtml(row.drug || "")}</div>
      ${row.code ? `<div class="drug-code">Code: ${escapeHtml(row.code)}</div>` : ""}
    </td>
    <td class="col-phase" contenteditable="true" data-field="admission" data-ph="—"${row.admissionFreqTh ? ` data-freq-th="${escapeHtml(row.admissionFreqTh)}"` : ""}>${escapeHtml(row.admission || "")}${row.admissionTag ? ` <span class="phase-tag" data-no-translate translate="no">${escapeHtml(row.admissionTag)}</span>` : ""}</td>
    <td class="col-phase" contenteditable="true" data-field="ward" data-ph="—">${escapeHtml(row.ward || "")}</td>
    <td class="col-phase" contenteditable="true" data-field="home" data-ph="—">${escapeHtml(row.home || "")}</td>
    <td class="col-status">
      <select class="status-sel no-print" data-field="status">${_statusOptions(row.status)}</select>
      <span class="status-print" data-no-translate translate="no">${escapeHtml(STATUS_TH[row.status] || row.status || "")}</span>
    </td>
    <td class="col-note" contenteditable="true" data-field="note" data-ph="หมายเหตุ">${escapeHtml(row.note || "")}</td>
  `;
  return tr;
}

function _buildAddRow() {
  const tr = document.createElement("tr");
  tr.className = "add-row no-print";
  tr.innerHTML = `
    <td class="col-act"><button type="button" class="row-add" title="Add">+</button></td>
    <td colspan="6">
      <div class="add-wrap">
        <input type="text" class="add-input" placeholder="พิมพ์ชื่อยาเพื่อเพิ่ม… (type a medicine to add)" autocomplete="off" />
        <div class="add-suggest" hidden></div>
      </div>
    </td>`;
  return tr;
}

async function renderRows() {
  const tbody = document.querySelector("#journeyTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!_rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7" class="empty">ไม่พบรายการยา — เพิ่มด้านล่าง (No orders found — add below)</td>`;
    tbody.appendChild(tr);
  }
  _rows.forEach((r, i) => tbody.appendChild(_buildRow(r, i)));
  tbody.appendChild(_buildAddRow());
  _bindEditing(tbody);
  _initTranslate();
  if (_currentLang) await _applyTranslate(_currentLang);
}

/* ───────────────────────── Editing / add / remove ─────────────────────── */
function _commit(i, field, value) {
  if (i < 0 || i >= _rows.length) return;
  _rows[i][field] = norm(value);
  _persist();
}

function _bindEditing(tbody) {
  tbody.querySelectorAll("[contenteditable][data-field]").forEach((el) => {
    el.addEventListener("blur", () => {
      const tr = el.closest(".j-row"); if (!tr) return;
      _commit(Number(tr.dataset.index), el.dataset.field, el.textContent);
    });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); el.blur(); } });
  });
  tbody.querySelectorAll(".status-sel").forEach((sel) => {
    sel.addEventListener("change", () => {
      const tr = sel.closest(".j-row"); if (!tr) return;
      const i = Number(tr.dataset.index);
      _commit(i, "status", sel.value);
      tr.dataset.status = sel.value;
      const sp = tr.querySelector(".status-print");
      if (sp) sp.textContent = STATUS_TH[sel.value] || sel.value;
    });
  });
  tbody.querySelectorAll(".row-del").forEach((b) => {
    b.addEventListener("click", () => {
      const tr = b.closest(".j-row"); if (!tr) return;
      _rows.splice(Number(tr.dataset.index), 1);
      _persist(); renderRows();
    });
  });
  const addRow = tbody.querySelector(".add-row");
  if (addRow) _bindAddBox(addRow);
}

function _bindAddBox(addRow) {
  const input = addRow.querySelector(".add-input");
  const list = addRow.querySelector(".add-suggest");
  const addBtn = addRow.querySelector(".row-add");
  if (!input || !list) return;

  const commitAdd = (name, code) => {
    const drug = norm(name || input.value);
    if (!drug) return;
    _rows.push({ drug, code: code || "", admission: "", ward: "", home: "", status: "new", note: "", provider: "" });
    _persist(); renderRows();
    const fresh = document.querySelector("#journeyTable .add-input");
    if (fresh) fresh.focus();
  };
  const renderSuggest = () => {
    const matches = _searchMeds(input.value);
    if (!matches.length) { list.hidden = true; list.innerHTML = ""; return; }
    list.innerHTML = matches.map((m) => `<div class="add-opt" data-code="${escapeHtml(m.code)}" data-name="${escapeHtml(m.name)}">${escapeHtml(m.name)}</div>`).join("");
    list.hidden = false;
  };
  input.addEventListener("input", renderSuggest);
  input.addEventListener("focus", renderSuggest);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); commitAdd(); } if (e.key === "Escape") list.hidden = true; });
  list.addEventListener("mousedown", (e) => { const o = e.target.closest(".add-opt"); if (!o) return; e.preventDefault(); commitAdd(o.dataset.name, o.dataset.code); });
  if (addBtn) addBtn.addEventListener("click", () => commitAdd());
  input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
}

/* ───────────────────────── Med DB name index (add search) ─────────────── */
let _medDb = null, _medNameIndex = null;
async function _loadMedDb() {
  if (_medDb) return _medDb;
  try {
    if (window.BKNData?.serverFetch) {
      const r = await window.BKNData.serverFetch("/api/medication-db");
      if (r && r.ok && r.json) { _medDb = r.json; return _medDb; }
    }
  } catch (_) { /* ignore */ }
  _medDb = {};
  return _medDb;
}
function _normName(s) { return norm(s || "").toLowerCase().replace(/[^a-z0-9ก-๙]+/g, " ").trim(); }
function _buildNameIndex() {
  if (_medNameIndex) return _medNameIndex;
  const db = _medDb || {};
  _medNameIndex = [];
  for (const code of Object.keys(db)) {
    const e = db[code] || {}; const name = norm(e.name || "");
    if (name) _medNameIndex.push({ key: _normName(name), name, code: norm(e.code || code) });
  }
  return _medNameIndex;
}
function _searchMeds(query, limit = 12) {
  const idx = _buildNameIndex();
  const q = _normName(query);
  if (q.length < 2) return [];
  const starts = [], contains = [];
  for (const e of idx) {
    if (e.key.startsWith(q)) starts.push(e);
    else if (e.key.includes(q)) contains.push(e);
    if (starts.length >= limit) break;
  }
  return [...starts, ...contains].slice(0, limit);
}

/* ───────────────────────── Translation (instructions only) ────────────── */
function _translateRoot() { return document.querySelector("#journeyTable tbody"); }
function _initTranslate() {
  if (typeof HMTranslate === "undefined") return;
  const root = _translateRoot();
  if (root) HMTranslate.init(root, { glossary: window.MEDICAL_GLOSSARY || {} });
}
async function _applyTranslate(lang) {
  if (typeof HMTranslate === "undefined") return;
  const root = _translateRoot(); if (!root) return;
  HMTranslate.restore();
  if (lang) await HMTranslate.translate(root, lang);
}

/* ───────────────────────── Persistence (per visit) ────────────────────── */
// Journey edits persist under a visituid suffixed with "__journey" so they do
// NOT collide with the Home Med sheet's cache (same patient/visit). The suffix
// uses underscores because the server's visituid validation allows only
// [A-Za-z0-9_-].
function _journeyKey() {
  const c = _context || {};
  if (!c.patientuid || !c.patientvisituid) return null;
  return { puid: c.patientuid, vuid: c.patientvisituid + "__journey" };
}
let _persistTimer = null;
function _persist() {
  if (!window.BKNData?.saveMedCache) return;
  const k = _journeyKey(); if (!k) return;
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    try { window.BKNData.saveMedCache(k.puid, k.vuid, { kind: "medJourney", rows: _rows, savedAt: new Date().toISOString() }); }
    catch (_) { /* best-effort */ }
  }, 600);
}
async function _loadSaved() {
  if (!window.BKNData?.loadMedCache) return null;
  const k = _journeyKey(); if (!k) return null;
  try {
    const cached = await window.BKNData.loadMedCache(k.puid, k.vuid);
    if (cached && cached.kind === "medJourney" && Array.isArray(cached.rows)) return cached.rows;
  } catch (_) { /* ignore */ }
  return null;
}

/* ───────────────────────── Fetch + orchestrate ────────────────────────── */
async function fetchAndRender() {
  const tbody = document.querySelector("#journeyTable tbody");
  if (!_context || !_context.patientvisituid) {
    if (tbody) { tbody.innerHTML = ""; const tr = document.createElement("tr"); tr.innerHTML = `<td colspan="7" class="empty">No patient context. Open from the Dispense Workbench.</td>`; tbody.appendChild(tr); }
    return;
  }
  if (!_context.incusToken) {
    _setStatus("❌ ไม่พบ session (incus-token) — เปิดผู้ป่วยบน ArcusAir แล้วลองใหม่");
    return;
  }

  _setStatus("⏳ กำลังดึงเส้นทางยา...");
  await _loadMedDb();

  let resp = null;
  try {
    resp = await window.BKNData.serverFetch("/api/report/med-journey", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context: _context }),
    });
  } catch (e) { console.error("[med-journey] serverFetch threw:", e); }

  console.log("[med-journey] server response:", resp);
  window.__MJ_RESP__ = resp;

  if (!resp || !resp.ok || !resp.json || !resp.json.ok) {
    const err = (resp && resp.json && resp.json.error) || (resp && resp.error) || `HTTP ${resp && resp.status}`;
    _setStatus("❌ ดึงข้อมูลไม่สำเร็จ: " + err);
    return;
  }

  const data = resp.json;
  const saved = await _loadSaved();
  const _mapRow = (r) => ({
    drug: norm(r.drug || ""), code: norm(r.code || ""),
    admission: norm(r.admission || ""), ward: norm(r.ward || ""), home: norm(r.home || ""),
    admissionFreqTh: norm(r.admissionFreqTh || ""), admissionTag: norm(r.admissionTag || ""),
    status: r.status || "", note: norm(r.note || ""), provider: norm(r.provider || ""),
  });
  if (saved && saved.length) {
    _rows = saved.map(_mapRow);
    _setStatus(`✅ ${_rows.length} รายการ (โหลดฉบับที่แก้ไขไว้)`);
  } else {
    _rows = (data.rows || []).map(_mapRow);
    _setStatus(`✅ ${_rows.length} รายการยา — แก้ไข/เพิ่ม/ลบได้`);
  }
  _sortRows();

  populateHeader(data.patient || {}, _context);
  renderDiagnosis(_context && _context.diagnosis);
  renderAllergies(data.allergies);
  await renderRows();
}

/* ───────────────────────── Toolbar ────────────────────────────────────── */
function buildFileName() {
  const hnEl = document.getElementById("patientHN");
  const hn = hnEl ? norm(hnEl.textContent) : "";
  const safe = (hn && hn !== "-") ? hn : (_context?.hn || "UnknownHN");
  return `MedicationJourney_${String(safe).replace(/[^\w-]+/g, "_")}`;
}

function bindToolbar() {
  const p = document.getElementById("btnPrint");
  const pdf = document.getElementById("btnPdf");
  const rev = document.getElementById("btnRevert");
  // Header prints once at the top; the column-header row repeats via <thead>.
  if (p) p.onclick = () => { document.title = buildFileName(); window.print(); };
  if (pdf) pdf.onclick = () => { document.title = buildFileName(); window.print(); };
  if (rev) rev.onclick = () => location.reload();
  const reg = document.getElementById("btnRegroup");
  if (reg) reg.onclick = () => { _sortRows(); renderRows(); };
  const sel = document.getElementById("lang");
  if (sel) {
    sel.value = _currentLang;
    sel.addEventListener("change", async (e) => {
      _currentLang = e.target.value || "";
      _setStatus(_currentLang ? "⏳ กำลังแปล…" : "");
      await _applyTranslate(_currentLang);
      _setStatus(_currentLang ? "✅ แปลแล้ว" : "");
    });
  }
}

/* ───────────────────────────── Boot ───────────────────────────────────── */
function _apply(msg) {
  if (!msg || msg.type !== MSG.OPEN_MED_JOURNEY) return;
  _context = msg.context || null;
  fetchAndRender();
}

document.addEventListener("DOMContentLoaded", () => {
  bindToolbar();
  chrome.runtime.onMessage.addListener((msg) => { if (msg.type === MSG.OPEN_MED_JOURNEY) _apply(msg); });
  chrome.storage.session.get("payload_medJourney", (res) => {
    const stored = res?.payload_medJourney;
    if (stored?.type === MSG.OPEN_MED_JOURNEY) _apply(stored);
  });
});
