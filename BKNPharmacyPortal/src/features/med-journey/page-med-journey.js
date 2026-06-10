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
let _rows = [];            // [{drug, code, admission, ward, home, status, note, provider, phases}]
let _dates = { admission: "", discharge: "" };  // timeline endpoints
// Instructions are shown exactly as the server sends them (English). No client
// translation — the report is intentionally not localised.

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

/* Phase metadata in display order: key, Thai label, short tag. */
const PHASES = [
  { key: "admission", label: "ก่อน/แรกรับ", short: "ก่อน" },
  { key: "ward",      label: "ระหว่างนอน รพ.", short: "ward" },
  { key: "home",      label: "กลับบ้าน", short: "home" },
];

/** Pick the representative instruction for a drug: prefer home → ward → admission
 * (the most patient-relevant non-empty phase). Shown as-is (no translation). */
function _repInstruction(row) {
  return row.home || row.ward || row.admission || "";
}

/** Compact phase bar: 3 segments (ก่อน│ward│home), filled when the drug is
 * present in that phase, tinted by status. Each segment tooltips its own text. */
function _phaseBar(row) {
  const segs = PHASES.map((p) => {
    const v = norm(row[p.key] || "");
    const on = v ? "on" : "";
    const tip = v ? `${p.label}: ${v}` : `${p.label}: —`;
    return `<span class="pb-seg ${on}" data-no-translate translate="no" title="${escapeHtml(tip)}"><span class="pb-lbl">${p.short}</span></span>`;
  }).join("");
  return `<div class="phase-bar" data-no-translate translate="no">${segs}</div>`;
}

function _buildRow(row, i) {
  const tr = document.createElement("tr");
  tr.className = "j-row";
  tr.dataset.index = String(i);
  tr.dataset.status = row.status || "";
  const repText = _repInstruction(row);
  tr.innerHTML = `
    <td class="col-act no-print"><button type="button" class="row-del" title="Remove">−</button></td>
    <td class="col-drug">
      <div class="drug-name" contenteditable="true" data-field="drug" data-ph="ชื่อยา" data-no-translate translate="no">${escapeHtml(row.drug || "")}</div>
      ${row.code ? `<div class="drug-code" data-no-translate translate="no">Code: ${escapeHtml(row.code)}</div>` : ""}
    </td>
    <td class="col-instr" contenteditable="true" data-field="${escapeHtml(_repField(row))}" data-ph="—">${escapeHtml(repText)}</td>
    <td class="col-bar">${_phaseBar(row)}</td>
    <td class="col-status">
      <select class="status-sel no-print" data-field="status">${_statusOptions(row.status)}</select>
      <span class="status-print" data-no-translate translate="no">${escapeHtml(STATUS_TH[row.status] || row.status || "")}</span>
    </td>
    <td class="col-note" contenteditable="true" data-field="note" data-ph="หมายเหตุ">${escapeHtml(row.note || "")}</td>
  `;
  return tr;
}

/** Which field the representative instruction edits (so blur commits the right one). */
function _repField(row) {
  if (row.home)      return "home";
  if (row.ward)      return "ward";
  return "admission";
}

function _buildAddRow() {
  const tr = document.createElement("tr");
  tr.className = "add-row no-print";
  tr.innerHTML = `
    <td class="col-act"><button type="button" class="row-add" title="Add">+</button></td>
    <td colspan="5">
      <div class="add-wrap">
        <input type="text" class="add-input" placeholder="พิมพ์ชื่อยาเพื่อเพิ่ม… (type a medicine to add)" autocomplete="off" />
        <div class="add-suggest" hidden></div>
      </div>
    </td>`;
  return tr;
}

function renderRows() {
  const tbody = document.querySelector("#journeyTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  if (!_rows.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="6" class="empty">ไม่พบรายการยา — เพิ่มด้านล่าง (No orders found — add below)</td>`;
    tbody.appendChild(tr);
  }
  _rows.forEach((r, i) => tbody.appendChild(_buildRow(r, i)));
  tbody.appendChild(_buildAddRow());
  _bindEditing(tbody);
  renderTimeline();  // keep the bottom timeline in sync with the row set
}

/* ───────────────────────── Drug timeline (bottom page) ────────────────── */
/** Format an ISO date (or anything Date can parse) as dd/mm/BBBB (Thai year). */
function _fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Phase span → {left%, width%} across the 3 equal zones [Before|Ward|Home].
 * Bar runs from the first present phase to the last present phase, so a
 * continued drug fills end-to-end and a stopped one ends at the ward zone. */
const _ZONE_IDX = { admission: 0, ward: 1, home: 2 };
function _barSpan(phases) {
  const present = ["admission", "ward", "home"].filter((k) => phases && phases[k]);
  if (!present.length) return null;
  const first = _ZONE_IDX[present[0]];
  const last = _ZONE_IDX[present[present.length - 1]];
  const left = (first / 3) * 100;
  const width = ((last - first + 1) / 3) * 100;
  return { left, width };
}

function renderTimeline() {
  const host = document.getElementById("timelineRows");
  if (!host) return;
  safeSetText("tlDateAdm", _fmtDate(_dates.admission));
  safeSetText("tlDateDc", _fmtDate(_dates.discharge));

  if (!_rows.length) {
    host.innerHTML = `<div class="timeline-empty">ไม่มีรายการยา (no medications)</div>`;
    return;
  }
  host.innerHTML = _rows.map((row) => {
    const span = _barSpan(row.phases);
    const cls = "s-" + (row.status || "");
    const tag = STATUS_TH[row.status] || "";
    const bar = span
      ? `<div class="tl-bar ${cls}" style="left:${span.left}%;width:${span.width}%" title="${escapeHtml(row.drug + " — " + tag)}">${escapeHtml(tag)}</div>`
      : "";
    const code = row.code ? ` <span class="tl-code">${escapeHtml(row.code)}</span>` : "";
    return `<div class="tl-row">
      <div class="tl-name" title="${escapeHtml(row.drug)}">${escapeHtml(row.drug)}${code}</div>
      <div class="tl-track">${bar}</div>
    </div>`;
  }).join("");
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
      renderTimeline();  // recolour the matching bar on the timeline page
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
  // Retry on gateway/handshake timeouts (504): the ArcusAir TLS handshake is
  // occasionally slow, and one slow handshake shouldn't fail the whole report.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      resp = await window.BKNData.serverFetch("/api/report/med-journey", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: _context }),
      });
    } catch (e) { console.error("[med-journey] serverFetch threw:", e); resp = null; }
    const isTimeout = resp && resp.status === 504;
    if (!isTimeout) break;
    if (attempt < 2) {
      _setStatus(`⏳ ArcusAir ตอบช้า — ลองใหม่ (${attempt + 2}/3)...`);
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }

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
    // Phase presence (from server flags, or derived from the cell text for
    // saved/edited rows that predate the flags).
    phases: r.phases || {
      admission: !!norm(r.admission || ""), ward: !!norm(r.ward || ""), home: !!norm(r.home || ""),
    },
  });
  if (saved && saved.length) {
    _rows = saved.map(_mapRow);
    _setStatus(`✅ ${_rows.length} รายการ (โหลดฉบับที่แก้ไขไว้)`);
  } else {
    _rows = (data.rows || []).map(_mapRow);
    _setStatus(`✅ ${_rows.length} รายการยา — แก้ไข/เพิ่ม/ลบได้`);
  }
  _sortRows();
  _dates = (data.dates && typeof data.dates === "object") ? data.dates : { admission: "", discharge: "" };

  populateHeader(data.patient || {}, _context);
  renderDiagnosis(_context && _context.diagnosis);
  renderAllergies(data.allergies);
  renderRows();   // renderRows() also draws the bottom timeline
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
