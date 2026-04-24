/* ═══════════════════════════════════════════════════════
   IV Sticker System — iv_sticker.js
   All state, data, rendering, label generation,
   print, CRUD, and navigation logic.
   ═══════════════════════════════════════════════════════ */

'use strict';

// ── EMBEDDED DEFAULT DATA ─────────────────────────────────────────────────
const DEFAULT_DRUGS = [
  {"codeName":"KCl","generic":"KCl","type":"HAD","exp":7,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"50%MgSO4","generic":"50%MgSO4","type":"HAD","exp":30,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"KCl+MgSO4","generic":"KCl+MgSO4","type":"HAD","exp":2,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"3%NaCl (inhale with nebulizer)","generic":"3%NaCl (inhale with nebulizer)","type":"HAD","exp":1,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"KCl 10 mEq + K2PO4 40 mEq","generic":"KCl 10 mEq + K2PO4 40 mEq","type":"HAD","exp":90,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"Dipotassium Phosphate","generic":"Dipotassium Phosphate","type":"HAD","exp":7,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"3%NaCl","generic":"3%NaCl","type":"HAD","exp":1,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"Fentanyl","generic":"Fentanyl","type":"HAD","exp":30,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"Morphine","generic":"Morphine","type":"HAD","exp":60,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"Morphine 30 mg in NSS 30 mL","generic":"Morphine","type":"HAD","exp":60,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":"ฉีดตามแพทย์สั่ง"},
  {"codeName":"PCEA (Bupivacaine)","generic":"PCEA (Bupivacaine)","type":"HAD","exp":30,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"PCEA (Chirocaine)","generic":"PCEA (Chirocaine)","type":"HAD","exp":2,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"FENtanyl (5 mL)","generic":"FENtanyl (5 mL)","type":"PFS","exp":30,"storage":"Keep in Room Temp.","had":"","conc":"10 mcg/mL","rate":""},
  {"codeName":"MORphine (3 mL)","generic":"MORphine (3 mL)","type":"PFS","exp":60,"storage":"Keep in Room Temp.","had":"","conc":"1 mg/mL","rate":""},
  {"codeName":"PEThidine (2.5 mL)","generic":"PEThidine (2.5 mL)","type":"PFS","exp":28,"storage":"Keep in Room Temp.","had":"","conc":"10 mg/mL","rate":""},
  {"codeName":"Succinyl (2 mL)","generic":"Succinyl (2 mL)","type":"PFS","exp":7,"storage":"Keep in Room Temp.","had":"","conc":"50 mg/mL","rate":""},
  {"codeName":"Adrenaline","generic":"Adrenaline","type":"PFS","exp":90,"storage":"Keep in Room Temp.","had":"","conc":"","rate":""},
  {"codeName":"Fentanyl 50 mcg/mL PFS","generic":"Fentanyl","type":"PFS","exp":7,"storage":"Keep in Room Temp.","had":"","conc":"50 mcg/mL","rate":""},
  {"codeName":"Midazolam 1 mg/mL PFS","generic":"Midazolam","type":"PFS","exp":7,"storage":"Keep in Room Temp.","had":"","conc":"1 mg/mL","rate":""},
  {"codeName":"Norepinephrine 0.1 mg/mL","generic":"Norepinephrine","type":"PFS","exp":2,"storage":"Keep in Room Temp.","had":"","conc":"0.1 mg/mL","rate":""},
  {"codeName":"Cefazolin (ceFAZolin 1 Gm)","generic":"Cefazolin","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 60 ml/hr"},
  {"codeName":"Ceftriaxone 1 g","generic":"Ceftriaxone","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 10 ml/hr"},
  {"codeName":"Vancomycin 500 mg","generic":"Vancomycin","type":"ATB","exp":14,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip in 30 min"},
  {"codeName":"Pip/Tazo 4.5 g","generic":"Piperacillin/Tazobactam","type":"ATB","exp":2,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip every 8 hr"},
  {"codeName":"Rocephin 2 g","generic":"Rocephin","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 1 Gm/hr"},
  {"codeName":"Dalacin-C 600 mg","generic":"Dalacin-C","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 30 mL/hr"},
  {"codeName":"Meropenem 1 g","generic":"Meropenem","type":"ATB","exp":2,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip every 24 hr"},
  {"codeName":"Invanz 1 g","generic":"Invanz","type":"ATB","exp":3,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip in 1 hr"},
  {"codeName":"Amikacin 500 mg","generic":"Amikacin","type":"ATB","exp":5,"storage":"Keep in Refrigerator","had":"","conc":"","rate":""},
  {"codeName":"Levofloxacin 750 mg","generic":"Levofloxacin","type":"ATB","exp":2,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip every 5 hr"},
  {"codeName":"Ceftazidime 1 g","generic":"Ceftazidime","type":"ATB","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip 1 Gm/hr"},
  {"codeName":"5-FU","generic":"5-FU","type":"Cytotoxic","exp":28,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"Methotrexate","generic":"Methotrexate","type":"Cytotoxic","exp":7,"storage":"Keep in Room Temp.","had":"High Alert Drugs","conc":"","rate":""},
  {"codeName":"Gemcitabine 200 mg","generic":"Gemcitabine","type":"Cytotoxic","exp":7,"storage":"Keep in Room Temp.","had":"","conc":"","rate":""},
  {"codeName":"Vancomycin Eye","generic":"Vancomycin","type":"EYE","exp":14,"storage":"Keep in Refrigerator","had":"","conc":"","rate":"IV drip in 30 min"},
  {"codeName":"Ceftazidime Eye","generic":"Ceftazidime","type":"EYE","exp":7,"storage":"Keep in Refrigerator","had":"","conc":"","rate":""}
];

const DEFAULT_STAFF = [
  {"name":"Akira","role":"Pharmacist"},{"name":"Apsorn","role":"Pharmacist"},
  {"name":"Cha","role":"Pharmacist"},{"name":"Ket","role":"Pharmacist"},
  {"name":"JOHN","role":"Pharmacist"},{"name":"Waram","role":"Pharmacist"},
  {"name":"Nattaya","role":"Pharmacist"},{"name":"Narudee","role":"Phar.Assist"},
  {"name":"Chayaporn","role":"Pharmacist"},{"name":"Oum","role":"Pharmacist"},
  {"name":"Phatt","role":"Pharmacist"},{"name":"Piyathida","role":"Pharmacist"},
  {"name":"Tunyaporn","role":"Pharmacist"},{"name":"Metawee","role":"Pharmacist"},
  {"name":"Siwawoot","role":"Pharmacist"},{"name":"Sucheera","role":"Pharmacist"},
  {"name":"Wannaporn","role":"Pharmacist"},{"name":"Ananya","role":"Pharmacist"},
  {"name":"Chanapa","role":"Pharmacist"},{"name":"Nongnapas","role":"Pharmacist"},
  {"name":"Paraporn","role":"Pharmacist"},{"name":"Rattiyakorn","role":"Phar.Assist"},
  {"name":"Thantita","role":"Pharmacist"},{"name":"Onamon","role":"Phar.Assist"},
  {"name":"Tussanee","role":"Phar.Assist"},{"name":"Punyaporn","role":"Pharmacist"},
  {"name":"Arunya","role":"Phar.Assist"},{"name":"Patcharee","role":"Pharmacist"},
  {"name":"Pijarin","role":"Pharmacist"},{"name":"Tanit","role":"Pharmacist"},
  {"name":"Arisara","role":"Phar.Assist"},{"name":"Rattanan","role":"Phar.Assist"},
  {"name":"Wanika","role":"Phar.Assist"},{"name":"Pornsiri","role":"Phar.Assist"},
  {"name":"Pitsanu","role":"Phar.Assist"},{"name":"DUSADEE","role":"Phar.Assist"},
  {"name":"Siriporn","role":"Phar.Assist"},{"name":"Paninee","role":"Pharmacist"}
];

// ── STATE ─────────────────────────────────────────────────────────────────
let drugs       = [];
let staff       = [];
let history     = [];
let editDrugIdx = -1;

// ── DATA BOOTSTRAP ────────────────────────────────────────────────────────
function loadData() {
  try {
    const s = localStorage.getItem('iv_drugs');
    drugs = s ? JSON.parse(s) : JSON.parse(JSON.stringify(DEFAULT_DRUGS));
  } catch { drugs = JSON.parse(JSON.stringify(DEFAULT_DRUGS)); }

  try {
    const s = localStorage.getItem('iv_staff');
    staff = s ? JSON.parse(s) : JSON.parse(JSON.stringify(DEFAULT_STAFF));
  } catch { staff = JSON.parse(JSON.stringify(DEFAULT_STAFF)); }

  try {
    const s = localStorage.getItem('iv_history');
    history = s ? JSON.parse(s) : [];
  } catch { history = []; }

  populateSelects();
}

function saveState() {
  try {
    localStorage.setItem('iv_drugs',   JSON.stringify(drugs));
    localStorage.setItem('iv_staff',   JSON.stringify(staff));
    localStorage.setItem('iv_history', JSON.stringify(history.slice(0, 200)));
  } catch (e) {
    showToast('ไม่สามารถบันทึกได้: ' + e.message, 'error');
  }
}

function resetToDefaults() {
  if (!confirm('รีเซ็ตข้อมูลยาและบุคลากรกลับค่าเริ่มต้น?')) return;
  localStorage.removeItem('iv_drugs');
  localStorage.removeItem('iv_staff');
  loadData();
  showToast('รีเซ็ตสำเร็จ');
}

// ── UTILITIES ─────────────────────────────────────────────────────────────
function fmtDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function fmtDatetime(d) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${fmtDate(d)}, ${hh}:${mi}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + (parseInt(n) || 0));
  return r;
}

function getExpStr(daysEl, manualEl) {
  const manual = manualEl?.value?.trim();
  if (manual) return manual;
  const days = parseInt(daysEl?.value) || 7;
  return fmtDatetime(addDays(new Date(), days)) + ' น.';
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pushHistory(type, drug, patient, prep) {
  history.unshift({ t: new Date().toISOString(), type, drug, patient, prep });
  history = history.slice(0, 200);
  saveState();
}

// ── TOAST ─────────────────────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const c = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-dot"></span>${esc(msg)}`;
  c.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; }, 2800);
  setTimeout(() => { t.remove(); }, 3100);
}

// ── NAVIGATION ────────────────────────────────────────────────────────────
const PAGE_META = {
  ipd:     { title: 'IPD Label',         sub: '8×3.5 cm sticker — A4 landscape' },
  pfs:     { title: 'PFS Small Label',  sub: 'Prefilled Syringe sticker — A4 landscape' },
  succ:    { title: 'PFS in A4',         sub: 'Prefilled Syringe sticker — A4 portrait' },
  drugs:   { title: 'Drug Master',      sub: 'รายการยาทั้งหมด (แก้ไขได้)' },
  staff:   { title: 'Staff',            sub: 'บุคลากรเภสัชกรรม' },
  history: { title: 'History',          sub: 'บันทึกการพิมพ์ label' },
};

function goPage(id) {
  document.querySelectorAll('.ivs-page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.dataset.page === id) n.classList.add('active');
  });
  const meta = PAGE_META[id] || {};
  document.getElementById('topbar-title').textContent = meta.title || id;
  document.getElementById('topbar-sub').textContent   = meta.sub   || '';
  if (id === 'drugs')   renderDrugTable();
  if (id === 'staff')   renderStaffTable();
  if (id === 'history') renderHistory();
}

// ── SELECT POPULATION ─────────────────────────────────────────────────────
function populateSelects() {
  const staffOpts = '<option value="">— เลือก —</option>' +
    staff.map(s => `<option>${esc(s.name)}</option>`).join('');

  const pfsOpts = '<option value="">— เลือกยา PFS —</option>' +
    drugs.filter(d => d.type === 'PFS').map(d => `<option>${esc(d.codeName)}</option>`).join('');

  const staffSelects = ['ipd-prep','ipd-label','ipd-check','pfs-prep','succ-prep'];
  const pfsSelects   = ['pfs-drug','succ-drug'];

  staffSelects.forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    const cur = el.value; el.innerHTML = staffOpts; if (cur) el.value = cur;
  });
  pfsSelects.forEach(id => {
    const el = document.getElementById(id); if (!el) return;
    const cur = el.value; el.innerHTML = pfsOpts; if (cur) el.value = cur;
  });

  // IPD drug list: filtered by selected type (or all if blank)
  populateIpdDrugs();
}

/** Rebuild the IPD drug <select> filtered by ipd-type value. */
function populateIpdDrugs() {
  const typeFilter = (document.getElementById('ipd-type')?.value) || '';
  const filtered = typeFilter
    ? drugs.filter(d => d.type === typeFilter)
    : drugs;
  const opts = '<option value="">— เลือกยา —</option>' +
    filtered.map(d => `<option value="${esc(d.codeName)}">${esc(d.codeName)}</option>`).join('');
  const el = document.getElementById('ipd-drug');
  if (!el) return;
  const cur = el.value;
  el.innerHTML = opts;
  // Try to restore previous selection if it's still in the filtered list
  if (cur && filtered.find(d => d.codeName === cur)) el.value = cur;
}

// ── AUTOFILL ──────────────────────────────────────────────────────────────
function getDrug(name) { return drugs.find(d => d.codeName === name); }
function g(id)   { return document.getElementById(id); }
function gv(id)  { return g(id)?.value || ''; }
function sv(id, val) { if (g(id)) g(id).value = val ?? ''; }


function autofillIpdDrug() {
  const d = getDrug(gv('ipd-drug'));
  if (!d) return;
  if (d.rate) sv('ipd-rate', d.rate);
  sv('ipd-exp-days', d.exp);
  // Autofill type if not already set
  if (!gv('ipd-type') && d.type) sv('ipd-type', d.type);
}
function autofillPfs() {
  const d = getDrug(gv('pfs-drug'));
  if (!d) return;
  sv('pfs-conc', d.conc || '');
  sv('pfs-exp-days', d.exp);
}
function autofillSucc() {
  const d = getDrug(gv('succ-drug'));
  if (!d) return;
  sv('succ-conc', d.conc || '');
  sv('succ-exp-days', d.exp);
}

// ── LABEL GENERATION ──────────────────────────────────────────────────────



/* IPD label HTML builder — used by both preview and print window */
function buildIpdLabel({ isHad, room, hn, name, drug, doseStr, inStr, rate, lot, mfd, expStr, prep, lbl, chk, note, storageStr }) {
  return `<div class="label-ipd">
  ${isHad ? '<div class="had-banner">⚠ HIGH ALERT DRUGS ⚠</div>' : ''}
  <div class="top-row"><span>ROOM: ${esc(room)}</span><span>HN: ${esc(hn)}</span></div>
  <div class="patient-name">${esc(name)}</div>
  <div class="drug-name">${esc(drug)}${doseStr ? ' ' + esc(doseStr) : ''}${esc(inStr)}</div>
  ${rate ? `<div class="rate-line">${esc(rate)}</div>` : ''}
  ${lot ? `<div class="info-grid"><div class="info-row"><span class="info-key">Lot:</span><span class="info-val">${esc(lot)}</span></div></div>` : ''}
  <div class="label-dates"><span>Mfd.: ${esc(mfd)}</span><span>Exp.: ${esc(expStr)}</span></div>
  <div class="label-sig"><span>Prep.: ${esc(prep)}</span><span>Label: ${esc(lbl)}</span><span>Check: ${esc(chk)}</span></div>
  ${note ? `<div class="label-note">Note: ${esc(note)}</div>` : ''}
  <div class="label-storage">${esc(storageStr)}</div>
</div>`;
}

/* IPD / A4 Label */
function generateIpdLabel() {
  const name    = gv('ipd-name')     || '—';
  const hn      = gv('ipd-hn')       || '—';
  const room    = gv('ipd-room')     || '—';
  const type    = gv('ipd-type');
  const isHad   = type === 'HAD' || type === 'Cytotoxic';
  const drug    = gv('ipd-drug')     || '—';
  const dose    = gv('ipd-dose');
  const unit    = gv('ipd-unit');
  const solvent = gv('ipd-solvent');
  const vol     = gv('ipd-vol');
  const rate    = gv('ipd-rate');
  const lot     = gv('ipd-lot');
  const note    = gv('ipd-note');
  const prep    = gv('ipd-prep')     || '—';
  const lbl     = gv('ipd-label')    || '—';
  const chk     = gv('ipd-check')    || '—';
  const expStr  = getExpStr(g('ipd-exp-days'), g('ipd-exp-manual'));
  const mfd     = fmtDatetime(new Date()) + ' น.';
  const inStr   = solvent ? ` in ${solvent}${vol ? ' ' + vol + ' mL' : ''}` : '';
  const doseStr = dose ? `${dose} ${unit}` : '';
  // Storage from drug master if available
  const drugData  = getDrug(drug);
  const storageStr = drugData?.storage || 'Keep in Room Temp.';

  const labelHTML = buildIpdLabel({ isHad, room, hn, name, drug, doseStr, inStr, rate, lot, mfd, expStr, prep, lbl, chk, note, storageStr });
  g('preview-ipd').innerHTML = labelHTML;

  pushHistory('IPD', drug, `${name} / ${hn}`, prep);
  showToast('สร้าง IPD Label สำเร็จ');
}

/* PFS */
function buildPfsLabel({ drug, conc, expStr, prep, lot, mfd }) {
  return `<div class="label-pfs">
  <div class="pfs-drug">${esc(drug)}</div>
  ${conc ? `<div class="pfs-conc"> • (${esc(conc)})</div>` : ''}
  <div class="pfs-exp">Exp ${esc(expStr)}</div>
  <div class="pfs-prep">Prep ${esc(mfd)} by ${esc(prep)}</div>
  ${lot ? `<div class="pfs-lot">Lot No.${esc(lot)}</div>` : ''}
</div>`;
}

function generatePfsLabel() {
  const drug    = gv('pfs-drug')    || '—';
  const conc    = gv('pfs-conc');
  const lot     = gv('pfs-lot');
  const prep    = gv('pfs-prep')    || '—';
  const expDays = parseInt(gv('pfs-exp-days')) || 60;
  const rows    = parseInt(gv('pfs-count'))    || 6;
  const now     = new Date();
  const expStr  = fmtDatetime(addDays(now, expDays)) + ' น.';
  const mfd     = fmtDate(now);
  const params  = { drug, conc, expStr, prep, lot, mfd };
  const oneLbl  = buildPfsLabel(params);

  g('preview-pfs').innerHTML = `<div class="label-pfs-wrap">${oneLbl}${oneLbl}${oneLbl}</div>`;
  window._pfsPrintData = { ...params, rows };
  pushHistory('PFS', drug, '', prep);
  showToast('สร้าง PFS Label สำเร็จ');
}

/* Succinyl */
function buildSuccLabel({ drug, conc, expStr, prep, mfd }) {
  return `<div class="label-succ">
  <div class="succ-drug">${esc(drug)}</div>
  ${conc ? `<div class="succ-conc"> • (${esc(conc)})</div>` : ''}
  <div class="succ-exp">Exp ${esc(expStr)}</div>
  <div class="succ-prep">Prep ${esc(mfd)} by ${esc(prep)}</div>
</div>`;
}

function generateSuccLabel() {
  const drug    = gv('succ-drug')    || '—';
  const conc    = gv('succ-conc');
  const prep    = gv('succ-prep')    || '—';
  const expDays = parseInt(gv('succ-exp-days')) || 60;
  const rows    = parseInt(gv('succ-count'))    || 3;
  const now     = new Date();
  const expStr  = fmtDatetime(addDays(now, expDays)) + ' น.';
  const mfd     = fmtDate(now);
  const params  = { drug, conc, expStr, prep, mfd };
  const oneLbl  = buildSuccLabel(params);

  g('preview-succ').innerHTML = `<div class="label-succ-wrap">${oneLbl}${oneLbl}${oneLbl}${oneLbl}</div>`;
  window._succPrintData = { ...params, rows };
  pushHistory('Succinyl', drug, '', prep);
  showToast('สร้าง Succinyl Label สำเร็จ');
}

// ── PRINT ─────────────────────────────────────────────────────────────────
/**
 * Open a dedicated print window for each label type.
 * This is the only reliable way to enforce physical cm dimensions across browsers.
 * Each window sets @page size exactly matching the sticker/sheet, then auto-prints.
 */
function printLabel(type) {

  if (type === 'ipd') {
    // ── IPD: one sticker per page, exact 8 × 3.5 cm ──────────────────────
    const previewInner = g('preview-ipd').innerHTML;
    if (!previewInner || previewInner.includes('ivs-empty-state')) {
      showToast('กรุณาสร้าง Preview ก่อน', 'error'); return;
    }
    openPrintWindow(previewInner, `
      @page { size: 8cm 3.5cm; margin: 0; }
      @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin: 0; padding: 0; width: 8cm; height: 3.5cm; font-family: 'Sarabun', sans-serif; }
      .label-ipd {
        font-family: 'Sarabun', sans-serif;
        background: #fff; color: #000;
        border: none;
        padding: 4px 7px;
        width: 8cm; height: 3.5cm;
        overflow: hidden;
        box-sizing: border-box;
        display: flex; flex-direction: column; justify-content: space-between;
      }
      .had-banner { background: #c00 !important; color: #fff !important; text-align: center; font-size: 7.5pt; font-weight: 800; letter-spacing: .12em; padding: 2px 0; margin: -4px -7px 3px; flex-shrink: 0; }
      .top-row    { display: flex; justify-content: space-between; font-size: 8pt; font-weight: 700; margin-bottom: 1px; flex-shrink: 0; }
      .patient-name { font-size: 8.5pt; font-weight: 500; margin-bottom: 1px; flex-shrink: 0; }
      .drug-name  { font-size: 9.5pt; font-weight: 700; margin-bottom: 2px; line-height: 1.15; flex-shrink: 0; }
      .rate-line  { font-size: 7.5pt; color: #333; margin-bottom: 2px; flex-shrink: 0; }
      .info-grid  { display: flex; gap: 0 8px; font-size: 7pt; flex-shrink: 0; flex-wrap: wrap; }
      .info-row   { display: flex; gap: 2px; }
      .info-key   { color: #555; white-space: nowrap; }
      .info-val   { font-weight: 600; }
      .label-dates{ display: flex; gap: 10px; font-size: 7pt; border-top: 0.5px solid #ccc; padding-top: 2px; margin-top: 2px; flex-shrink: 0; }
      .label-sig  { font-size: 7pt; color: #555; display: flex; justify-content: space-between; flex-wrap: wrap; margin-top: 1px; flex-shrink: 0; }
      .label-note { font-size: 6.5pt; margin-top: 1px; border-top: 0.5px solid #eee; padding-top: 1px; color: #333; flex-shrink: 0; }
      .label-storage { font-size: 6.5pt; color: #888; text-align: right; flex-shrink: 0; }
    `);

  } else if (type === 'pfs') {
    // ── PFS: A4 landscape, 3-up grid rows ─────────────────────────────────
    const d = window._pfsPrintData;
    if (!d) { showToast('กรุณาสร้าง Preview ก่อน', 'error'); return; }
    let rows = '';
    for (let r = 0; r < d.rows; r++) {
      rows += `<div class="label-pfs-wrap">`;
      for (let c = 0; c < 3; c++) rows += buildPfsLabel(d);
      rows += `</div>`;
    }
    openPrintWindow(rows, `
      @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin: 0; padding: 0; width: 210mm; font-family: 'Sarabun', sans-serif; }
      .label-pfs-wrap { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-bottom: 4mm; break-inside: avoid; page-break-inside: avoid; }
      .label-pfs { background: #fff; color: #000; border: 1px dashed #aaa; border-radius: 3px; padding: 5px 7px; break-inside: avoid; }
      .pfs-drug { font-size: 9pt; font-weight: 700; line-height: 1.2; }
      .pfs-conc { font-size: 8pt; margin-top: 1px; }
      .pfs-exp  { font-size: 7.5pt; margin-top: 2px; }
      .pfs-prep { font-size: 7.5pt; color: #333; }
      .pfs-lot  { font-size: 7.5pt; color: #666; }
    `);

  } else if (type === 'succ') {
    // ── PFS-in-A4: A4 portrait, 4-up grid rows ────────────────────────────
    const d = window._succPrintData;
    if (!d) { showToast('กรุณาสร้าง Preview ก่อน', 'error'); return; }
    let rows = '';
    for (let r = 0; r < d.rows; r++) {
      rows += `<div class="label-succ-wrap">`;
      for (let c = 0; c < 4; c++) rows += buildSuccLabel(d);
      rows += `</div>`;
    }
    openPrintWindow(rows, `
      @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap');
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin: 0; padding: 0; width: 210mm; font-family: 'Sarabun', sans-serif; }
      .label-succ-wrap { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-bottom: 4mm; break-inside: avoid; page-break-inside: avoid; }
      .label-succ { background: #fff; color: #000; border: 1px dashed #aaa; border-radius: 3px; padding: 5px 7px; break-inside: avoid; }
      .succ-drug { font-size: 9pt; font-weight: 700; }
      .succ-conc { font-size: 7.5pt; }
      .succ-exp  { font-size: 7.5pt; margin-top: 2px; }
      .succ-prep { font-size: 7.5pt; color: #444; }
    `);
  }
}

/**
 * Open a popup window with self-contained HTML+CSS and trigger print,
 * then close automatically after the print dialog is dismissed.
 */
function openPrintWindow(bodyHTML, css) {
  const w = window.open('', '_blank', 'width=900,height=600');
  if (!w) { showToast('Pop-up blocked. Please allow pop-ups for this page.', 'error'); return; }
  w.document.write(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>${css}</style>
</head><body>${bodyHTML}</body></html>`);
  w.document.close();
  // Single trigger: use onload; setTimeout is only a fallback if onload never fires
  let printed = false;
  function doPrint() {
    if (printed) return;
    printed = true;
    try { w.focus(); w.print(); w.close(); } catch(_) {}
  }
  w.onload = doPrint;
  setTimeout(doPrint, 900);
}

// ── CLEAR FORM ────────────────────────────────────────────────────────────
function clearForm() {
  const active = document.querySelector('.ivs-page.active');
  if (!active) return;
  active.querySelectorAll('input, select, textarea').forEach(el => {
    if (el.tagName === 'SELECT') {
      el.selectedIndex = 0;
    } else if (el.type === 'number') {
      // Restore HTML default value, not empty string
      el.value = el.defaultValue !== '' ? el.defaultValue : '';
    } else {
      el.value = '';
    }
  });
  ['preview-ipd','preview-pfs','preview-succ'].forEach(id => {
    const el = g(id);
    if (el) el.innerHTML = '<div class="ivs-empty-state">กรอกข้อมูลแล้วกด "สร้าง Preview"</div>';
  });
  showToast('ล้างฟอร์มแล้ว');
}

// ── DRUG TABLE ────────────────────────────────────────────────────────────
const TYPE_BADGE_MAP = {
  HAD: 'badge-had', PFS: 'badge-pfs', ATB: 'badge-atb',
  Cytotoxic: 'badge-cyto', EYE: 'badge-eye',
};

function renderDrugTable() {
  const q  = gv('drug-search').toLowerCase();
  const ft = gv('drug-filter-type');
  const filtered = drugs.filter(d => {
    const match  = (d.codeName + d.generic + d.type).toLowerCase().includes(q);
    const typeOk = !ft || d.type === ft;
    return match && typeOk;
  });

  const tbody = g('drug-tbody');
  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="ivs-empty-state">ไม่พบยา</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(d => {
    const ri  = drugs.indexOf(d);
    const bdg = TYPE_BADGE_MAP[d.type] || 'badge-ok';
    return `<tr>
      <td><span class="ivs-tag">${esc(d.codeName)}</span></td>
      <td>${esc(d.generic)}</td>
      <td><span class="ivs-badge ${bdg}">${esc(d.type)}</span></td>
      <td style="font-size:11px;color:var(--ivs-muted)">${esc(d.storage || '')}</td>
      <td>${d.had ? '<span class="ivs-badge badge-had">HAD</span>' : ''}</td>
      <td style="font-family:monospace">${d.exp} วัน</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="ivs-btn ivs-btn-outline ivs-btn-xs" data-action="edit-drug" data-idx="${ri}">แก้ไข</button>
          <button class="ivs-btn ivs-btn-danger  ivs-btn-xs" data-action="del-drug"  data-idx="${ri}">ลบ</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function openAddDrug() {
  editDrugIdx = -1;
  ['m-codename','m-generic','m-had','m-conc','m-rate'].forEach(id => sv(id, ''));
  sv('m-type', 'HAD');
  sv('m-exp', 7);
  sv('m-storage', 'Keep in Room Temp.');
  openModal('modal-drug');
}

function editDrug(i) {
  editDrugIdx = i;
  const d = drugs[i];
  sv('m-codename', d.codeName); sv('m-generic', d.generic);
  sv('m-type', d.type); sv('m-exp', d.exp); sv('m-storage', d.storage);
  sv('m-had', d.had || ''); sv('m-conc', d.conc || ''); sv('m-rate', d.rate || '');
  openModal('modal-drug');
}

function saveDrug() {
  const d = {
    codeName: gv('m-codename'),
    generic:  gv('m-generic'),
    type:     gv('m-type'),
    exp:      parseInt(gv('m-exp')) || 7,
    storage:  gv('m-storage'),
    had:      gv('m-had'),
    conc:     gv('m-conc'),
    rate:     gv('m-rate'),
  };
  if (!d.codeName) { showToast('กรุณาใส่ชื่อยา', 'error'); return; }
  if (editDrugIdx >= 0) drugs[editDrugIdx] = d;
  else drugs.push(d);
  saveState(); populateSelects(); renderDrugTable();
  closeModal('modal-drug');
  showToast('บันทึกยาสำเร็จ');
}

function deleteDrug(i) {
  if (!confirm(`ต้องการลบ "${drugs[i].codeName}" ?`)) return;
  drugs.splice(i, 1);
  saveState(); populateSelects(); renderDrugTable();
  showToast('ลบยาแล้ว');
}

function exportDrugs() {
  const blob = new Blob([JSON.stringify(drugs, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'drugs.json',
  });
  a.click();
  showToast('Export drugs.json สำเร็จ');
}

function importDrugsFile(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('ไม่ใช่ Array');
      drugs = data;
      saveState(); populateSelects(); renderDrugTable();
      showToast(`Import สำเร็จ — ${data.length} รายการ`);
    } catch (err) {
      showToast('JSON ไม่ถูกต้อง: ' + err.message, 'error');
    }
    input.value = '';
  };
  reader.readAsText(file);
}

// ── STAFF TABLE ───────────────────────────────────────────────────────────
function renderStaffTable() {
  const tbody = g('staff-tbody');
  if (!staff.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="ivs-empty-state">ยังไม่มีบุคลากร</td></tr>';
    return;
  }
  tbody.innerHTML = staff.map((s, i) => `
    <tr>
      <td style="color:var(--ivs-muted);font-family:monospace;font-size:12px">${i + 1}</td>
      <td><strong>${esc(s.name)}</strong></td>
      <td><span class="ivs-badge ${s.role === 'Pharmacist' ? 'badge-atb' : 'badge-pfs'}">${esc(s.role)}</span></td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="ivs-btn ivs-btn-outline ivs-btn-xs" data-action="edit-staff" data-idx="${i}">แก้ไข</button>
          <button class="ivs-btn ivs-btn-danger  ivs-btn-xs" data-action="del-staff"  data-idx="${i}">ลบ</button>
        </div>
      </td>
    </tr>`).join('');
}

function openAddStaff() {
  sv('ms-name', ''); sv('ms-role', 'Pharmacist'); sv('ms-idx', -1);
  openModal('modal-staff');
}
function editStaff(i) {
  sv('ms-name', staff[i].name); sv('ms-role', staff[i].role); sv('ms-idx', i);
  openModal('modal-staff');
}
function saveStaff() {
  const name = gv('ms-name').trim();
  const role = gv('ms-role');
  const idx  = parseInt(gv('ms-idx'));
  if (!name) { showToast('กรุณาใส่ชื่อ', 'error'); return; }
  if (idx >= 0) staff[idx] = { name, role };
  else staff.push({ name, role });
  saveState(); populateSelects(); renderStaffTable();
  closeModal('modal-staff');
  showToast('บันทึกบุคลากรสำเร็จ');
}
function deleteStaff(i) {
  if (!confirm(`ลบ ${staff[i].name} ?`)) return;
  staff.splice(i, 1);
  saveState(); populateSelects(); renderStaffTable();
  showToast('ลบบุคลากรแล้ว');
}
function exportStaff() {
  const blob = new Blob([JSON.stringify(staff, null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: 'staff.json',
  });
  a.click();
  showToast('Export staff.json สำเร็จ');
}

// ── HISTORY ───────────────────────────────────────────────────────────────
function renderHistory() {
  const tbody = g('history-tbody');
  if (!history.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="ivs-empty-state">ยังไม่มีรายการ</td></tr>';
    return;
  }
  const TYPE_BADGE = { OPD:'badge-had', IPD:'badge-atb', PFS:'badge-pfs', Succinyl:'badge-ok' };
  tbody.innerHTML = history.map(h => `
    <tr>
      <td style="font-size:11px;color:var(--ivs-muted);white-space:nowrap">${new Date(h.t).toLocaleString('th-TH')}</td>
      <td><span class="ivs-badge ${TYPE_BADGE[h.type] || 'badge-ok'}">${esc(h.type)}</span></td>
      <td>${esc(h.drug)}</td>
      <td style="font-size:12px">${esc(h.patient)}</td>
      <td>${esc(h.prep)}</td>
    </tr>`).join('');
}

function clearHistory() {
  if (!confirm('ล้างประวัติทั้งหมด?')) return;
  history = []; saveState(); renderHistory();
  showToast('ล้าง History แล้ว');
}

// ── MODAL ─────────────────────────────────────────────────────────────────
function openModal(id) {
  const el = g(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = g(id);
  if (el) el.classList.remove('open');
}

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// ARCUS SCRAPE — Pre-fill IPD form from chrome.storage.local
// Key: 'iv_scrape'  (written by content_script.js on dispense workbench page)
// ══════════════════════════════════════════════════════════════════════════

let _arcusScrape = null;  // cached scrape data for this session

/**
 * Read iv_scrape from chrome.storage.local.
 * Works both inside Chrome extension context (chrome.storage) and
 * falls back gracefully if called from a plain browser context.
 */
function readArcusScrape() {
  return new Promise(resolve => {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['iv_scrape'], result => {
          resolve(result.iv_scrape || null);
        });
      } else {
        resolve(null);
      }
    } catch { resolve(null); }
  });
}

function clearArcusScrape() {
  _arcusScrape = null;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove('iv_scrape');
    }
  } catch {}
  const banner = document.getElementById('arcus-banner');
  if (banner) banner.remove();
  // Restore lot field
  const lotEl = g('ipd-lot');
  if (lotEl) {
    lotEl.disabled    = false;
    lotEl.placeholder = 'AZJ024 09/04';
    lotEl.style.opacity = '';
  }
  // Restore ipd-drug back to regular select (populated from drug master)
  restoreIpdDrugToMaster();
  showToast('ล้างข้อมูล Arcus แล้ว');
}

/** Restore the ipd-drug select to the normal drug-master list */
function restoreIpdDrugToMaster() {
  populateIpdDrugs();   // rebuilds from drugs[] array
  // re-wire autofill
  g('ipd-drug')?.removeEventListener('change', autofillIpdFromArcus);
  g('ipd-drug')?.addEventListener('change', autofillIpdDrug);
}

/** Autofill IPD fields when user picks from the Arcus medicine dropdown (multi-med case) */
function autofillIpdFromArcus(e) {
  if (!_arcusScrape) return;
  const idx = parseInt(e.target.value);
  if (isNaN(idx) || idx < 0) return;
  const med = _arcusScrape.medicines[idx];
  if (!med) return;

  // dose + unit: scan all rawCells for a recognised dose+unit pattern
  const { dose, unit } = parseDoseUnit(med.unit || '', med.rawCells || []);
  sv('ipd-dose', dose);
  sv('ipd-unit', unit);
  // solvent / vol / rate — leave empty, user must fill
  sv('ipd-solvent', '');
  sv('ipd-vol',     '');
  sv('ipd-rate',    '');
  // lot stays disabled (already handled in applyArcusScrape)

  // Try to find matching drug in master for exp/type
  const masterDrug = getDrug(med.drugName) || drugs.find(d =>
    med.drugName.toLowerCase().includes(d.codeName.toLowerCase()) ||
    d.codeName.toLowerCase().includes(med.drugName.toLowerCase())
  );
  if (masterDrug) {
    sv('ipd-exp-days', masterDrug.exp);
    sv('ipd-type', masterDrug.type);
  }
}

/**
 * Parse dose and unit from the Arcus "unit" text.
 * e.g. "Infuse 40 mEq IntraVenously As directed For 1 Days"
 *   → { dose: "40", unit: "mEq" }
 * Strategy: find first number, then the word immediately after it.
 */
/**
 * Parse dose and unit from Arcus medicine data.
 * Scans rawCells array for a cell matching "number unit_word" pattern,
 * since the column mapping from rawCells may vary.
 * e.g. "Infuse 40 mEq IntraVenously..." → { dose:"40", unit:"mEq" }
 * e.g. "20 mEq" → { dose:"20", unit:"mEq" }
 * Falls back to the mapped unit/dose fields if rawCells not available.
 */
function parseDoseUnit(text, rawCells) {
  // Try each rawCell looking for "number + unit_word" pattern
  const candidates = rawCells && rawCells.length ? rawCells : (text ? [text] : []);
  for (const cell of candidates) {
    if (!cell) continue;
    // Match a standalone number followed by a unit word (letters only, not a full sentence word like "Infuse")
    const m = cell.match(/\b(\d+(?:\.\d+)?)\s+(mEq|mg|mcg|g|mL|L|unit|units|mmol|IU|µg|ug|%)\b/i);
    if (m) return { dose: m[1], unit: m[2] };
  }
  // Fallback: generic number + word pattern from the text string
  if (text) {
    const m = text.match(/(\d+(?:\.\d+)?)\s+([a-zA-Zµ%\/]+)/);
    if (m) return { dose: m[1], unit: m[2] };
  }
  return { dose: '', unit: '' };
}

/**
 * Apply scraped data to the IPD form.
 * - name, HN: filled as-is
 * - room: room number only (after "/" in "Ward X / RoomNo")
 * - type: always default to HAD
 * - drug: match from master or inject temp option
 * - dose + unit: parsed from the "unit" text field (e.g. "Infuse 40 mEq IntraVenously...")
 * - solvent, vol, rate: left empty (user must fill)
 * - lot: not filled (field disabled)
 */
function applyArcusScrape(data) {
  _arcusScrape = data;

  // ── Patient fields ────────────────────────────────────────────────────
  if (data.patient.name) sv('ipd-name', data.patient.name);
  if (data.patient.hn)   sv('ipd-hn',   data.patient.hn);
  if (data.patient.room) sv('ipd-room',  data.patient.room);

  // ── IPD type default = HAD ────────────────────────────────────────────
  sv('ipd-type', 'HAD');
  populateIpdDrugs();

  // ── Clear solvent, vol, rate, lot ─────────────────────────────────────
  sv('ipd-solvent', '');
  sv('ipd-vol',     '');
  sv('ipd-rate',    '');
  // lot field: disable it to indicate not used from Arcus
  const lotEl = g('ipd-lot');
  if (lotEl) {
    lotEl.value       = '';
    lotEl.disabled    = true;
    lotEl.placeholder = '— ไม่ใช้ข้อมูล Arcus —';
    lotEl.style.opacity = '0.5';
  }

  const meds = data.medicines;

  function applyMed(med) {
    // dose + unit: scan all rawCells for a recognised dose+unit pattern
    const { dose, unit } = parseDoseUnit(med.unit || '', med.rawCells || []);
    sv('ipd-dose', dose);
    sv('ipd-unit', unit);
    // solvent / rate / lot — leave empty
    sv('ipd-solvent', '');
    sv('ipd-vol',     '');
    sv('ipd-rate',    '');

    // Match drug master
    const masterDrug = getDrug(med.drugName) || drugs.find(d =>
      med.drugName.toLowerCase().includes(d.codeName.toLowerCase()) ||
      d.codeName.toLowerCase().includes(med.drugName.toLowerCase())
    );

    if (masterDrug) {
      sv('ipd-type', masterDrug.type);
      populateIpdDrugs();
      sv('ipd-drug', masterDrug.codeName);
      sv('ipd-exp-days', masterDrug.exp);
      // Safety: if codeName wasn't found in the rebuilt list, fall back to temp option
      if (!gv('ipd-drug')) {
        const el = g('ipd-drug');
        if (el) {
          const opt = document.createElement('option');
          opt.value       = med.drugName;
          opt.textContent = med.drugName;
          opt.selected    = true;
          el.insertBefore(opt, el.firstChild);
          el.value = med.drugName;
        }
      }
    } else {
      // Drug not in master — inject temporary option
      const el = g('ipd-drug');
      if (el) {
        const opt = document.createElement('option');
        opt.value       = med.drugName;
        opt.textContent = med.drugName;
        opt.selected    = true;
        el.insertBefore(opt, el.firstChild);
        el.value = med.drugName;
      }
    }
  }

  if (meds.length === 1) {
    applyMed(meds[0]);
  } else if (meds.length > 1) {
    // Multiple medicines — dropdown; apply first on selection
    const el = g('ipd-drug');
    if (el) {
      el.removeEventListener('change', autofillIpdDrug);
      el.addEventListener('change', autofillIpdFromArcus);
      el.innerHTML = '<option value="">— เลือกยาจาก Order —</option>' +
        meds.map((m, i) =>
          `<option value="${i}">${esc(m.drugName)}${m.dose ? ' · ' + esc(m.dose) : ''}</option>`
        ).join('');
    }
  }
}

/** Show the teal banner at the top of the IPD page indicating Arcus data is loaded */
function showArcusBanner(data) {
  if (document.getElementById('arcus-banner')) return;

  const scrapedAt = new Date(data.scrapedAt);
  const timeStr   = `${String(scrapedAt.getHours()).padStart(2,'0')}:${String(scrapedAt.getMinutes()).padStart(2,'0')}`;
  const medCount  = data.medicines.length;

  const banner = document.createElement('div');
  banner.id = 'arcus-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
           style="width:15px;height:15px;flex-shrink:0;color:#0d6e3f">
        <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/>
        <rect x="9" y="3" width="6" height="4" rx="1"/>
        <path d="M9 12h6M9 16h4"/>
      </svg>
      <span style="font-weight:700;color:#0a5a33">📥 ข้อมูลจาก Arcus (${timeStr})</span>
      <span style="color:#2d6e45;font-size:12px">
        ${esc(data.patient.name || '—')} · HN ${esc(data.patient.hn || '—')} · ${esc(data.patient.room || '—')}
        · <strong>${medCount} รายการยา</strong>
      </span>
      <button id="arcus-clear-btn" style="
        margin-left:auto;padding:3px 10px;border-radius:5px;border:1.5px solid #b8ddc4;
        background:#fff;color:#2d6e45;font-size:11px;font-weight:600;cursor:pointer;
        font-family:Sarabun,sans-serif;">
        ✕ ล้างข้อมูล Arcus
      </button>
    </div>`;
  banner.style.cssText = [
    'background:#e8f4ec', 'border:1.5px solid #7aaa8a',
    'border-radius:10px', 'padding:10px 16px',
    'margin-bottom:16px', 'font-size:13px',
    'font-family:Sarabun,sans-serif',
    'box-shadow:0 2px 8px rgba(13,110,63,.10)',
  ].join(';');

  // Insert at top of IPD page, before first card
  const ipdPage = document.getElementById('page-ipd');
  const firstCard = ipdPage?.querySelector('.ivs-grid2');
  if (firstCard) ipdPage.insertBefore(banner, firstCard);

  document.getElementById('arcus-clear-btn')
    ?.addEventListener('click', clearArcusScrape);
}

/** Main entry: read storage and pre-fill if data is fresh (< 30 min) */
async function loadArcusScrape() {
  const data = await readArcusScrape();
  if (!data) return;

  // Stale check: ignore data older than 30 minutes
  const age = Date.now() - new Date(data.scrapedAt).getTime();
  if (age > 30 * 60 * 1000) {
    chrome.storage?.local?.remove?.('iv_scrape');
    return;
  }

  showArcusBanner(data);
  applyArcusScrape(data);
  showToast(`📥 โหลดข้อมูล Arcus: ${data.patient.name || 'ไม่ทราบชื่อ'} (${data.medicines.length} รายการยา)`);
}

// ── INIT & EVENT BINDINGS ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  goPage('ipd');
  // Load Arcus scrape data AFTER drug master is ready
  loadArcusScrape();

  // ── Sidebar navigation ──────────────────────────────────────────────
  document.querySelectorAll('.nav-item[data-page]').forEach(el => {
    el.addEventListener('click', () => goPage(el.dataset.page));
  });

  // ── Topbar clear button ──────────────────────────────────────────────
  document.querySelector('.ivs-btn-outline.ivs-btn-sm.no-print')
    ?.addEventListener('click', clearForm);

  // ── IPD / A4 Label ───────────────────────────────────────────────────
  // Type selector filters the drug list first, then drug change autofills fields
  g('ipd-type') ?.addEventListener('change', () => {
    populateIpdDrugs();       // rebuild drug list for chosen type
    g('ipd-drug').value = ''; // clear previous drug selection
  });
  g('ipd-drug') ?.addEventListener('change', autofillIpdDrug);
  g('page-ipd')?.querySelector('.ivs-btn-primary')  ?.addEventListener('click', generateIpdLabel);
  g('page-ipd')?.querySelector('.ivs-btn-secondary')?.addEventListener('click', () => printLabel('ipd'));

  // ── PFS ──────────────────────────────────────────────────────────────
  g('pfs-drug')   ?.addEventListener('change', autofillPfs);
  g('page-pfs')?.querySelector('.ivs-btn-primary')  ?.addEventListener('click', generatePfsLabel);
  g('page-pfs')?.querySelector('.ivs-btn-secondary')?.addEventListener('click', () => printLabel('pfs'));

  // ── Succinyl ──────────────────────────────────────────────────────────
  g('succ-drug')  ?.addEventListener('change', autofillSucc);
  g('page-succ')?.querySelector('.ivs-btn-primary')  ?.addEventListener('click', generateSuccLabel);
  g('page-succ')?.querySelector('.ivs-btn-secondary')?.addEventListener('click', () => printLabel('succ'));

  // ── Drug Master ───────────────────────────────────────────────────────
  g('drug-search')      ?.addEventListener('input',  renderDrugTable);
  g('drug-filter-type') ?.addEventListener('change', renderDrugTable);

  // Drug Master toolbar buttons (in order: + เพิ่มยา, Export, Import label, Reset)
  const drugToolbarBtns = g('page-drugs')?.querySelectorAll('.ivs-toolbar .ivs-btn, .ivs-toolbar label');
  if (drugToolbarBtns) {
    drugToolbarBtns[0]?.addEventListener('click', openAddDrug);
    drugToolbarBtns[1]?.addEventListener('click', exportDrugs);
    // drugToolbarBtns[2] is the Import <label> — its inner <input> handles file pick
    drugToolbarBtns[3]?.addEventListener('click', resetToDefaults);
  }

  // File import input (inside Import label)
  const importInput = g('page-drugs')?.querySelector('input[type="file"]');
  importInput?.addEventListener('change', function() { importDrugsFile(this); });

  // ── Staff ─────────────────────────────────────────────────────────────
  const staffBtns = g('page-staff')?.querySelectorAll('.ivs-toolbar .ivs-btn');
  if (staffBtns) {
    staffBtns[0]?.addEventListener('click', openAddStaff);
    staffBtns[1]?.addEventListener('click', exportStaff);
  }

  // ── History ───────────────────────────────────────────────────────────
  const histBtns = g('page-history')?.querySelectorAll('.ivs-toolbar .ivs-btn');
  if (histBtns) {
    histBtns[0]?.addEventListener('click', renderHistory);
    histBtns[1]?.addEventListener('click', clearHistory);
  }

  // ── Drug table event delegation (replaces inline onclick) ────────────────
  g('drug-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    if (btn.dataset.action === 'edit-drug')  editDrug(idx);
    if (btn.dataset.action === 'del-drug')   deleteDrug(idx);
  });

  // ── Staff table event delegation ──────────────────────────────────────────
  g('staff-tbody')?.addEventListener('click', e => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const idx = parseInt(btn.dataset.idx);
    if (btn.dataset.action === 'edit-staff') editStaff(idx);
    if (btn.dataset.action === 'del-staff')  deleteStaff(idx);
  });

  // ── Modals ────────────────────────────────────────────────────────────
  // Drug modal
  g('modal-drug')?.querySelectorAll('.ivs-btn-group .ivs-btn')[0]?.addEventListener('click', saveDrug);
  g('modal-drug')?.querySelectorAll('.ivs-btn-group .ivs-btn')[1]?.addEventListener('click', () => closeModal('modal-drug'));

  // Staff modal
  g('modal-staff')?.querySelectorAll('.ivs-btn-group .ivs-btn')[0]?.addEventListener('click', saveStaff);
  g('modal-staff')?.querySelectorAll('.ivs-btn-group .ivs-btn')[1]?.addEventListener('click', () => closeModal('modal-staff'));
});
