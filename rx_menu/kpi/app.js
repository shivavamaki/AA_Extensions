const KPI_SCHEMA_VERSION = '1.0.0';
const KPI_APP_NAME = 'pharmacy-kpi-data-system';
const SERVER_KEY = 'pharm_kpi.server_url';

const APP_UPDATE_SOURCE_PATH = '\\\\10.134.10.5\\BKNinfo\\24 Pharmacy\\EXT\\pharmacy';
const APP_TARGET_PATH = 'D:\\pharmacy';
const APP_FILE_NAME = 'pharmacy-data-app.html';

const OPD_CHECKS = [
  { key:'shoes',   label:'รองเท้าเป็นระเบียบ' },
  { key:'trash',   label:'ขวดน้ำ / แก้วน้ำ / ขยะ / ของกิน / กระเป๋า', sub:'ห้องยา + ห้อง HM' },
  { key:'break',   label:'ความเรียบร้อยห้องเบรค', sub:'ขยะ / ของกิน' },
  { key:'temp',    label:'รายงานอุณหภูมิ (ตู้เย็น - ความชื้น)', sub:'ความชื้นปกติ ไม่เกิน 65%' },
  { key:'tv',      label:'ตรวจสอบโทรทัศน์คิวหน้าห้องยา เวลา 08.00 น.', sub:'เปิด / ยังไม่เปิด (ตาม IT)' },
  { key:'expiry',  label:'ตรวจสอบวันหมดอายุเวชภัณฑ์ (ที่เปิดใช้)', sub:'Alcohol / Handi-c / Germa Way' },
  { key:'dehumid', label:'เครื่องดูดความชื้น เทน้ำเรียบร้อย' },
  { key:'coldbag', label:'กระเป๋ายาเย็น', sub:'มี/ไม่มียาตกค้างในกระเป๋า — Replenish / หน้าห้องยา' },
  { key:'it',      label:'สำรวจอุปกรณ์ IT', sub:'ไอแพด / โทรศัพท์ / สายชาร์ท / โน้ตบุ้ค — ครบ/ไม่ครบ' },
  { key:'narc1',   label:'รายงานยอดยาเสพติด - วัตถุออกฤทธิ์ (ชั้น 1)', sub:'ตรง / ถ้าไม่ตรง ระบุสาเหตุ' },
  { key:'narc2',   label:'รายงานยอดยาเสพติด - วัตถุออกฤทธิ์ (ชั้น 2)', sub:'ตรง / ถ้าไม่ตรง ระบุสาเหตุ' },
];

const IPD_CHECKS = [
  { key:'shoes',   label:'รองเท้าเป็นระเบียบ' },
  { key:'trash',   label:'เศษขยะ ของกิน ในพื้นที่ทำงาน' },
  { key:'bottles', label:'ขวดน้ำ / แก้วน้ำ' },
  { key:'temp',    label:'รายงานอุณหภูมิ (ตู้เย็น - ความชื้น)', sub:'ความชื้นปกติ ไม่เกิน 65%' },
  { key:'sink',    label:'ซิงค์ล้างมือ', sub:'ไม่มีจาน-ชาม / ไม่มีของค้างส่งอบ' },
  { key:'fridge',  label:'ตู้ยาเย็น - ตู้ Freeze', sub:'มี/ไม่มีอาหารเครื่องดื่ม' },
  { key:'dehumid', label:'เครื่องดูดความชื้น เทน้ำเรียบร้อย' },
  { key:'expiry',  label:'ตรวจสอบวันหมดอายุเวชภัณฑ์ (ที่เปิดใช้)', sub:'หน้าลิฟ / ตรงผสมยาน้ำ / ห้องยา IV' },
  { key:'narc',    label:'รายงานยาเสพติด - วัตถุออกฤทธิ์', sub:'ตรง / ถ้าไม่ตรง อธิบายสาเหตุ' },
  { key:'std',     label:'ตรวจสอบยา STD. ก่อนส่ง Ward', sub:'ผิด / ไม่ผิด' },
  { key:'it',      label:'สำรวจอุปกรณ์ IT', sub:'ไอแพด / ปากกา / โทรศัพท์ / สายชาร์ท — ครบ/ไม่ครบ' },
];

const OPD_DEPTS = ['PED','OBG','MED','SUR','ENT','EYE','ORT','DER','PSY','ER','Other'];
const IPD_WARDS = ['ward 4','ward 5','ward 6','ward 7','ward 8','ward 9','ICU','CCU','NICU','LR','OR','Other'];

let savedRecords=[], reportRecords=[], opdStatRows=[], ipdStatRows=[];
let opdBriefState={}, ipdBriefState={};

// ── DRAFT AUTOSAVE ──
const DRAFT_KEY = 'kpi_draft';
function saveDraft(){
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      date: new Date().toISOString().split('T')[0],
      opdStatRows, ipdStatRows, opdBriefState, ipdBriefState
    }));
  } catch(_) {}
}
function restoreDraft(){
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw);
    if (draft.date !== new Date().toISOString().split('T')[0]) { localStorage.removeItem(DRAFT_KEY); return false; }
    if (Array.isArray(draft.opdStatRows) && draft.opdStatRows.some(r => isRowStarted(r))) opdStatRows = draft.opdStatRows;
    if (Array.isArray(draft.ipdStatRows) && draft.ipdStatRows.some(r => isRowStarted(r))) ipdStatRows = draft.ipdStatRows;
    if (draft.opdBriefState && typeof draft.opdBriefState === 'object') opdBriefState = draft.opdBriefState;
    if (draft.ipdBriefState && typeof draft.ipdBriefState === 'object') ipdBriefState = draft.ipdBriefState;
    return true;
  } catch(_) { return false; }
}


// ── SERVER CONNECTION ──
let serverUrl = '';

function getServerUrl() {
  return (localStorage.getItem(SERVER_KEY) || '').replace(/\/$/, '');
}

function updateFolderUI(isActive, labelText) {
  const dot = document.getElementById('folderDot');
  const path = document.getElementById('folderPath');
  if (dot) dot.classList.toggle('active', !!isActive);
  if (path) {
    path.textContent = labelText || (isActive
      ? serverUrl
      : 'ยังไม่ได้ตั้งค่า Server — กด "ตั้งค่า Server URL"');
  }
}

async function pingServer(url, timeoutMs = 3000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${url}/ping`, { signal: ctrl.signal });
    clearTimeout(t);
    return await r.json();
  } catch { clearTimeout(t); return null; }
}

const SERVER_CANDIDATES = [
  'http://localhost:8765',
  'http://10.134.10.5:8765',
  'http://10.134.10.91:8765',
];

async function autoDiscoverServer() {
  for (const candidate of SERVER_CANDIDATES) {
    const j = await pingServer(candidate, 1500);
    if (j?.ok) {
      const lanUrl = j.url || candidate;
      serverUrl = lanUrl;
      localStorage.setItem(SERVER_KEY, lanUrl);
      return lanUrl;
    }
  }
  return null;
}

async function restoreFolderAccess() {
  serverUrl = getServerUrl();

  // Try saved URL first
  if (serverUrl) {
    const j = await pingServer(serverUrl, 2000);
    if (j?.ok) { updateFolderUI(true); return; }
  }

  // Auto-discover across known candidates
  updateFolderUI(false, 'กำลังค้นหา Server ...');
  const found = await autoDiscoverServer();
  if (found) {
    updateFolderUI(true);
    showToast('🌐', 'เชื่อมต่อ Server สำเร็จ: ' + found);
    return;
  }

  // Server not reachable — alert and show lock screen
  updateFolderUI(false, 'ไม่พบ Server — กด "ค้นหา Server" เพื่อลองใหม่');
  alert('ไม่พบ KPI Server\n\nกรุณาตรวจสอบ:\n• เปิด start_server.bat บนเครื่อง Server แล้วหรือยัง\n• เครื่องนี้อยู่ใน Network เดียวกันหรือไม่\n\nกด "ค้นหา Server" บนหน้าจอเพื่อเชื่อมต่อใหม่');
}

window.addEventListener('DOMContentLoaded', async () => {
  const today = new Date().toISOString().split('T')[0];
  ['opd-brief-date','ipd-brief-date','opd-stat-date','ipd-stat-date','med-error-date'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value=today;
  });

  const hasDraft = restoreDraft();

  buildChecklist(OPD_CHECKS,'opd-brief-checks',opdBriefState);
  buildChecklist(IPD_CHECKS,'ipd-brief-checks',ipdBriefState);

  ensureSingleTrailingRow('opd-stat-body');
  const opdCfg = statConfig('opd-stat-body');
  renderStatTable('opd-stat-body', opdCfg.rows, opdCfg.depts, opdCfg.target, opdCfg.onSummary);

  ensureSingleTrailingRow('ipd-stat-body');
  const ipdCfg = statConfig('ipd-stat-body');
  renderStatTable('ipd-stat-body', ipdCfg.rows, ipdCfg.depts, ipdCfg.target, ipdCfg.onSummary);

  updateBadges();
  initDropZone();
  await restoreFolderAccess();
  enforceAppLock();

  if (hasDraft) showToast('💾', 'กู้คืนข้อมูล draft จากเมื่อกี้แล้ว');

  window.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveDraft();
      showToast('💾', 'บันทึก draft แล้ว');
    }
  });

  // ── Static button event listeners ──
  document.getElementById('btn-update-app').addEventListener('click', () => updateWebApp());
  document.getElementById('btn-export-all').addEventListener('click', () => exportAllJSON());
  document.getElementById('btn-pick-folder').addEventListener('click', () => pickFolder());
  document.getElementById('btn-show-records').addEventListener('click', () => showRecords());
  document.getElementById('btn-save-opd-brief').addEventListener('click', () => saveOPDBrief());
  document.getElementById('btn-clear-opd-brief').addEventListener('click', () => clearOPDBrief());
  document.getElementById('btn-save-ipd-brief').addEventListener('click', () => saveIPDBrief());
  document.getElementById('btn-clear-ipd-brief').addEventListener('click', () => clearIPDBrief());
  document.getElementById('btn-save-opd-stat').addEventListener('click', () => saveOPDStat());
  document.getElementById('btn-save-ipd-stat').addEventListener('click', () => saveIPDStat());
  document.getElementById('btn-save-med-error').addEventListener('click', () => saveMedError());
  document.getElementById('btn-clear-med-error').addEventListener('click', () => clearMedError());
  document.getElementById('btn-trigger-import').addEventListener('click', () => triggerImportJSON());
  document.getElementById('btn-clear-records').addEventListener('click', () => clearAllRecords());
  document.getElementById('btn-load-report').addEventListener('click', () => loadSharedFolderReport());
  document.getElementById('btn-clear-report-filters').addEventListener('click', () => clearReportFilters());
  document.getElementById('btn-load-dashboard').addEventListener('click', () => loadSharedFolderDashboard());
  document.getElementById('btn-export-excel').addEventListener('click', () => exportDashboardExcel());
  document.getElementById('btn-export-datastudio').addEventListener('click', () => exportDashboardDataStudioJSON());
  document.getElementById('btn-export-pdf').addEventListener('click', () => exportDashboardPDF());
  document.getElementById('btn-clear-dash-filters').addEventListener('click', () => clearDashboardFilters());
  document.getElementById('btn-pick-folder-lock').addEventListener('click', () => pickFolder());

  // ── Tab event listeners ──
  document.getElementById('ptab-opd').addEventListener('click', () => switchService('opd'));
  document.getElementById('ptab-ipd').addEventListener('click', () => switchService('ipd'));
  document.getElementById('ptab-med-error').addEventListener('click', () => switchService('med-error'));
  document.getElementById('ptab-records').addEventListener('click', () => switchService('records'));
  document.getElementById('ptab-report').addEventListener('click', () => switchService('report'));
  document.getElementById('ptab-dashboard').addEventListener('click', () => switchService('dashboard'));
  document.getElementById('stab-brief').addEventListener('click', () => switchSubTab('brief'));
  document.getElementById('stab-stat').addEventListener('click', () => switchSubTab('stat'));

  // ── Input change event listeners ──
  document.getElementById('import-json-input').addEventListener('change', function() { handleImportFiles(this.files); });
  document.getElementById('report-filter-type').addEventListener('change', () => renderReport());
  document.getElementById('report-filter-date-from').addEventListener('change', () => renderReport());
  document.getElementById('report-filter-date-to').addEventListener('change', () => renderReport());
  document.getElementById('dash-filter-date-from').addEventListener('change', () => renderDashboard());
  document.getElementById('dash-filter-date-to').addEventListener('change', () => renderDashboard());

  // ── Checklist delegation ──
  document.getElementById('opd-brief-checks').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    setCheck(btn.dataset.container, btn.dataset.key, btn.dataset.action === 'check-ok');
  });
  document.getElementById('ipd-brief-checks').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    setCheck(btn.dataset.container, btn.dataset.key, btn.dataset.action === 'check-ok');
  });

  // ── Stat table delegation ──
  ['opd-stat-body','ipd-stat-body'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('input', e => {
      const inp = e.target;
      if (!inp.dataset.field) return;
      if (inp.dataset.field === 'fileNo') handleStatInput(inp);
      else handleTimeText(inp);
    });
    el.addEventListener('keydown', e => {
      if (e.target.dataset.field) handleStatKeyDown(e);
    });
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-action="del-row"]');
      if (btn) deleteRow(btn.dataset.tbody, Number(btn.dataset.idx));
    });
  });

  // ── Records list delegation ──
  document.getElementById('records-container').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    if (btn.dataset.action === 'reexport') reExportRecord(idx);
    else if (btn.dataset.action === 'delete-rec') deleteRecord(idx);
  });

  // ── Report container delegation ──
  document.getElementById('report-container').addEventListener('click', e => {
    const btn = e.target.closest('[data-action="toggle-detail"]');
    if (btn) toggleReportDetail(btn.dataset.target);
  });

  // ── Dashboard container delegation ──
  document.getElementById('dashboard-container').addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'dash-excel') exportDashboardExcel();
    else if (btn.dataset.action === 'dash-datastudio') exportDashboardDataStudioJSON();
    else if (btn.dataset.action === 'dash-pdf') exportDashboardPDF();
  });
});

// ── SERVER CONNECTION ──

function isFolderConnected() { return !!serverUrl; }
function enforceAppLock() {
  const locked = !isFolderConnected();
  document.getElementById('app-lock')?.classList.toggle('show', locked);
  document.body.classList.toggle('app-locked', locked);
  return !locked;
}
function requireFolderSetup() {
  if (enforceAppLock()) return true;
  showToast('🌐', 'กรุณาตั้งค่า Server URL ก่อนใช้งาน');
  return false;
}

async function pickFolder() {
  updateFolderUI(false, 'กำลังค้นหา Server ...');
  const found = await autoDiscoverServer();
  if (found) {
    updateFolderUI(true);
    enforceAppLock();
    showToast('🌐', 'เชื่อมต่อ Server สำเร็จ: ' + found);
  } else {
    updateFolderUI(false, 'ไม่พบ Server — กด "ค้นหา Server" เพื่อลองใหม่');
    alert('ไม่พบ KPI Server\n\nกรุณาตรวจสอบ:\n• เปิด start_server.bat บนเครื่อง Server แล้วหรือยัง\n• เครื่องนี้อยู่ใน Network เดียวกันหรือไม่');
  }
}

// ── CHECKLIST ──
function buildChecklist(checks, containerId, stateObj) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  checks.forEach((c,i) => {
    stateObj[c.key] = stateObj[c.key] ?? null;
    const v = stateObj[c.key];
    const div = document.createElement('div');
    div.className = 'check-item' + (v===true?' checked':v===false?' issue':'');
    div.id = containerId+'-'+c.key;
    div.innerHTML = `
      <div class="check-num">${i+1}</div>
      <div class="check-label">${c.label}${c.sub?`<div class="check-sub">${c.sub}</div>`:''}</div>
      <div class="check-toggle">
        <button class="toggle-btn${v===true?' selected-ok':''}" data-action="check-ok" data-container="${containerId}" data-key="${c.key}">✓ ปกติ</button>
        <button class="toggle-btn${v===false?' selected-x':''}" data-action="check-x" data-container="${containerId}" data-key="${c.key}">✗ ผิดปกติ</button>
      </div>`;
    container.appendChild(div);
  });
}

function setCheck(containerId, key, val) {
  const state = containerId==='opd-brief-checks' ? opdBriefState : ipdBriefState;
  state[key] = val;

  const item = document.getElementById(containerId+'-'+key);
  if(!item) return; // ✅ prevent crash

  item.className = 'check-item '+(val?'checked':'issue');

  const btns = item.querySelectorAll('.toggle-btn');
  if(btns[0]) btns[0].className = 'toggle-btn'+(val?' selected-ok':'');
  if(btns[1]) btns[1].className = 'toggle-btn'+(val?''  :' selected-x');
  saveDraft();
}

// ── STAT TABLE ──
function timeToMin(t) { if(!t) return null; const [h,m]=t.split(':').map(Number); return h*60+m; }
function calcDiff(t1,t2) { const a=timeToMin(t1),b=timeToMin(t2); if(a===null||b===null) return null; let d=b-a; if(d<0)d+=1440; return d; }

// Central config for OPD vs IPD — eliminates repeated ternary patterns throughout
function statConfig(tbodyId) {
  const isOPD = tbodyId === 'opd-stat-body';
  return {
    isOPD,
    rows:      isOPD ? opdStatRows : ipdStatRows,
    setRows:   v => { if (isOPD) opdStatRows = v; else ipdStatRows = v; },
    depts:     isOPD ? OPD_DEPTS : IPD_WARDS,
    target:    isOPD ? 5 : 15,
    onSummary: isOPD ? updateOPDSummary : updateIPDSummary,
    cntId:     isOPD ? 'opd-cnt' : 'ipd-cnt',
    avgId:     isOPD ? 'opd-avg' : 'ipd-avg',
    passId:    isOPD ? 'opd-pass' : 'ipd-pass',
    pctId:     isOPD ? 'opd-pct' : 'ipd-pct',
  };
}

function sanitizeFileNo(value){
  let v = String(value || '');

  // ❌ reject non-digit instead of silently removing
  if(/\D/.test(v)){
    return v.replace(/\D/g,''); // still clean but visible to user
  }

  if(v.length > 4) v = v.slice(-4);
  return v;
}

function renderStatTable(tbodyId, rows, options, limitMin, updateFn) {
  const tbody = document.getElementById(tbodyId);

  // ✅ keep focus info before rerender
  const active = document.activeElement;
  const activeField = active?.dataset?.field;
  const activeIdx = active?.dataset?.idx;

  tbody.innerHTML = '';

  rows.forEach((row, i) => {
    const fileNo = sanitizeFileNo(row.fileNo || '');
    const timeStart = row.timeStart || '';
    const timeEnd = row.timeEnd || '';

    const diff = calcDiff(timeStart, timeEnd);
    const suspicious = diff !== null && diff > 120;
    const pass = diff !== null && !suspicious ? diff <= limitMin : null;

    const fileReady = fileNo.length === 4;
    const startReady = fileReady && !!timeStart;

    const timeClass = diff === null ? '' : suspicious ? 'time-sus' : pass ? 'time-ok' : 'time-fail';
    const timeLabel = diff === null ? '—' : suspicious ? `${diff} m ⚠` : `${diff} m`;
    const checkIcon = diff === null
      ? '<span style="color:var(--text3)">—</span>'
      : suspicious
        ? '<span style="color:var(--yellow-txt)" title="เวลาอาจผิดปกติ กรุณาตรวจสอบ">⚠</span>'
        : pass
          ? '<span style="color:var(--green-txt)">✓</span>'
          : '<span style="color:var(--red-txt)">✗</span>';

    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td style="color:var(--text3);font-family:var(--mono);font-size:11px;padding:6px 8px">${i+1}</td>

      <td>
        <input type="text"
          value="${fileNo}"
          placeholder="4 digits"
          inputmode="numeric"
          maxlength="4"
          style="width:90px"
          data-tbody="${tbodyId}"
          data-idx="${i}"
          data-field="fileNo">
      </td>

      <td>
        <input type="text"
          value="${timeStart.replace(':','')}"
          inputmode="numeric"
          placeholder="HHMM"
          maxlength="4"
          style="width:80px"
          data-tbody="${tbodyId}"
          data-idx="${i}"
          data-field="timeStart">
      </td>

      <td>
        <input type="text"
          value="${timeEnd.replace(':','')}"
          inputmode="numeric"
          placeholder="HHMM"
          maxlength="4"
          style="width:80px"
          data-tbody="${tbodyId}"
          data-idx="${i}"
          data-field="timeEnd">
      </td>

      <td>
        <span class="time-display ${timeClass}">${timeLabel}</span>
      </td>

      <td style="text-align:center;font-size:16px">${checkIcon}</td>

      <td>
        <button class="del-btn" data-action="del-row" data-tbody="${tbodyId}" data-idx="${i}">×</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  updateFn();

  // ✅ restore focus AFTER render
  if (activeField !== undefined && activeIdx !== undefined) {
    focusTableField(tbodyId, Number(activeIdx), activeField);
  }
}

function parseHHMM(val){
  if(!val || val.length !== 4) return '';

  const hh = val.slice(0,2);
  const mm = val.slice(2,4);

  if(Number(hh) > 23 || Number(mm) > 59) return '';

  return `${hh}:${mm}`;
}

function handleTimeText(el){
  let v = el.value.replace(/\D/g,'');
  if(v.length > 4) v = v.slice(0,4);
  el.value = v;

  const tbodyId = el.dataset.tbody;
  const idx = Number(el.dataset.idx);
  const field = el.dataset.field;
  const cfg = statConfig(tbodyId);
  const { rows } = cfg;

  const parsed = parseHHMM(v);
  rows[idx][field] = parsed || '';

  if(v.length === 4 && parsed){
    if(field === 'timeStart'){
      focusTableField(tbodyId, idx, 'timeEnd');
      return;
    }
    if(field === 'timeEnd'){
      if(!rows[idx+1]) rows.push({ id: crypto.randomUUID(), fileNo:'', timeStart:'', timeEnd:'' });
      renderStatTable(tbodyId, rows, cfg.depts, cfg.target, cfg.onSummary);
      focusTableField(tbodyId, idx+1, 'fileNo');
    }
  }

  cfg.onSummary();
  saveDraft();
}

function handleTimeDone(el){
  handleStatInput(el);

  const tbodyId = el.dataset.tbody;
  const idx = Number(el.dataset.idx);
  const field = el.dataset.field;
  const cfg = statConfig(tbodyId);
  const { rows } = cfg;
  const row = rows[idx];

  if(field === 'timeStart' && row.timeStart){
    focusTableField(tbodyId, idx, 'timeEnd');
    return;
  }

  if(field === 'timeEnd' && row.timeEnd){
    if(!rows[idx+1]) rows.push({ id: crypto.randomUUID(), fileNo:'', timeStart:'', timeEnd:'' });
    renderStatTable(tbodyId, rows, cfg.depts, cfg.target, cfg.onSummary);
    focusTableField(tbodyId, idx+1, 'fileNo');
  }
}

function isRowComplete(row){return sanitizeFileNo(row.fileNo).length===4 && !!String(row.timeStart||'').trim() && !!String(row.timeEnd||'').trim();}
function isRowStarted(row){return !!(sanitizeFileNo(row.fileNo) || String(row.timeStart||'').trim() || String(row.timeEnd||'').trim());}

function focusTableField(tbodyId, idx, field){
  setTimeout(() => {
    const target = document.querySelector(
      `[data-tbody="${tbodyId}"][data-idx="${idx}"][data-field="${field}"]`
    );

    if(target && !target.disabled){
      target.focus();

      if(field === 'fileNo' && target.select){
        target.select();
      }
    }
  }, 0); // ✅ let render finish first
}

function handleTimeInput(el){
  handleStatInput(el);

  const tbodyId = el.dataset.tbody;
  const idx = Number(el.dataset.idx);
  const field = el.dataset.field;
  const cfg = statConfig(tbodyId);
  const { rows } = cfg;
  const row = rows[idx];

  if(field === 'timeStart' && row.timeStart){
    focusTableField(tbodyId, idx, 'timeEnd');
    return;
  }

  if(field === 'timeEnd' && row.timeEnd){
    if(!rows[idx + 1]) rows.push({ id: crypto.randomUUID(), fileNo:'', timeStart:'', timeEnd:'' });
    renderStatTable(tbodyId, rows, cfg.depts, cfg.target, cfg.onSummary);
    focusTableField(tbodyId, idx + 1, 'fileNo');
  }
}

function handleStatInput(el){
  const tbodyId = el.dataset.tbody;
  const idx = Number(el.dataset.idx);
  const field = el.dataset.field;
  const cfg = statConfig(tbodyId);
  const { rows } = cfg;
  const row = rows[idx];

  let value = el.value;

  if(field === 'fileNo'){
    value = sanitizeFileNo(value);
    if(el.value !== value) el.value = value;
    row.fileNo = value;

    if(value.length === 4){
      renderStatTable(tbodyId, rows, cfg.depts, cfg.target, cfg.onSummary);
      focusTableField(tbodyId, idx, 'timeStart');
    }

    updateSummary(rows, cfg.target, cfg.cntId, cfg.avgId, cfg.passId, cfg.pctId);
    saveDraft();
    return;
  }

  row[field] = value;
  updateSummary(rows, cfg.target, cfg.cntId, cfg.avgId, cfg.passId, cfg.pctId);

  if(isRowComplete(row)){
    ensureSingleTrailingRow(tbodyId);
    renderStatTable(tbodyId, statConfig(tbodyId).rows, cfg.depts, cfg.target, cfg.onSummary);
  }
  saveDraft();
}

function ensureSingleTrailingRow(tbodyId){
  const cfg = statConfig(tbodyId);
  const cleaned = cfg.rows.filter(r => isRowStarted(r));
  cleaned.push({ id: crypto.randomUUID(), fileNo:'', timeStart:'', timeEnd:'' });
  cfg.setRows(cleaned);
}

function updateRow(tbodyId, idx, field, val, rerender=true){
  const cfg = statConfig(tbodyId);
  if(field === 'fileNo') val = sanitizeFileNo(val);
  cfg.rows[idx][field] = val;
  if(rerender){
    renderStatTable(tbodyId, cfg.rows, cfg.depts, cfg.target, cfg.onSummary);
  } else {
    cfg.onSummary();
  }
}

function deleteRow(tbodyId, idx){
  statConfig(tbodyId).rows.splice(idx, 1);
  ensureSingleTrailingRow(tbodyId);
  const cfg = statConfig(tbodyId);
  renderStatTable(tbodyId, cfg.rows, cfg.depts, cfg.target, cfg.onSummary);
  saveDraft();
}

function addOPDRow(){
  const last = opdStatRows[opdStatRows.length - 1];
  if(last && !isRowStarted(last)) return; // ✅ prevent duplicate empty row

  opdStatRows.push({id:crypto.randomUUID(),fileNo:'',timeStart:'',timeEnd:''});
  renderStatTable('opd-stat-body',opdStatRows,OPD_DEPTS,5,updateOPDSummary);
}

function addIPDRow(){
  const last = ipdStatRows[ipdStatRows.length - 1];
  if(last && !isRowStarted(last)) return;

  ipdStatRows.push({id:crypto.randomUUID(),fileNo:'',timeStart:'',timeEnd:''});
  renderStatTable('ipd-stat-body',ipdStatRows,IPD_WARDS,15,updateIPDSummary);
}

function updateSummary(rows,limitMin,cntId,avgId,passId,pctId){
  const filledRows=rows.filter(r=>isRowStarted(r));
  const valid=filledRows.filter(r=>calcDiff(r.timeStart,r.timeEnd)!==null);
  const diffs=valid.map(r=>calcDiff(r.timeStart,r.timeEnd));
  const pass=diffs.filter(d=>d<=limitMin);
  document.getElementById(cntId).textContent=filledRows.length;
  document.getElementById(avgId).textContent=diffs.length?(diffs.reduce((a,b)=>a+b,0)/diffs.length).toFixed(1):'—';
  document.getElementById(passId).textContent=pass.length;
  document.getElementById(pctId).textContent=diffs.length?Math.round(pass.length/diffs.length*100)+'%':'—';
  updateBadges();
}
function updateOPDSummary(){updateSummary(opdStatRows,5,'opd-cnt','opd-avg','opd-pass','opd-pct');}
function updateIPDSummary(){updateSummary(ipdStatRows,15,'ipd-cnt','ipd-avg','ipd-pass','ipd-pct');}

// ── SAVE ──
function createRecordEnvelope(type, date, payload){
  return {
    schemaVersion: KPI_SCHEMA_VERSION,
    appName: KPI_APP_NAME,
    type,
    date,
    payloadVersion: 1,
    ...payload,
    savedAt: new Date().toISOString()
  };
}

function collectOPDBrief(){
  return createRecordEnvelope('opd-brief', document.getElementById('opd-brief-date').value, {
    signature: document.getElementById('opd-brief-sign').value,
    checks: {...opdBriefState},
    issues: document.getElementById('opd-brief-issues').value
  });
}
function collectIPDBrief(){
  return createRecordEnvelope('ipd-brief', document.getElementById('ipd-brief-date').value, {
    signature: document.getElementById('ipd-brief-sign').value,
    checks: {...ipdBriefState},
    issues: document.getElementById('ipd-brief-issues').value
  });
}
function filterFilledEntries(rows){return rows.filter(r=>isRowStarted(r));}
function collectOPDStat(){
  const entries = filterFilledEntries(opdStatRows).map(r => {
    const minutesUsed = calcDiff(r.timeStart, r.timeEnd);
    return {...r, minutesUsed, withinTarget: minutesUsed !== null ? minutesUsed <= 5 : null, targetMinutes: 5};
  });
  return createRecordEnvelope('opd-stat', document.getElementById('opd-stat-date').value, {targetMinutes: 5, entries});
}
function collectIPDStat(){
  const entries = filterFilledEntries(ipdStatRows).map(r => {
    const minutesUsed = calcDiff(r.timeStart, r.timeEnd);
    return {...r, minutesUsed, withinTarget: minutesUsed !== null ? minutesUsed <= 15 : null, targetMinutes: 15};
  });
  return createRecordEnvelope('ipd-stat', document.getElementById('ipd-stat-date').value, {targetMinutes: 15, entries});
}
function collectMedError(){
  return createRecordEnvelope('med-error', document.getElementById('med-error-date').value, {
    item: document.getElementById('med-error-item').value.trim(),
    errorType: document.getElementById('med-error-type').value,
    detail: document.getElementById('med-error-detail').value.trim(),
    location: document.getElementById('med-error-location').value.trim(),
    signature: document.getElementById('med-error-signature').value.trim(),
    note: document.getElementById('med-error-note').value.trim()
  });
}

async function saveOPDBrief() {
  if (!requireFolderSetup()) return;
  const data = collectOPDBrief();
  if (!data.date) { showToast('⚠', 'กรุณาระบุวันที่'); return; }
  const ok = await saveSection('opdBrief', data);
  if (ok) { savedRecords = savedRecords.filter(r => !(r.type === 'opd-brief' && r.date === data.date)); savedRecords.push(data); updateBadges(); showToast('✓', `บันทึก OPD Brief ${data.date} สำเร็จ`); }
}
async function saveIPDBrief() {
  if (!requireFolderSetup()) return;
  const data = collectIPDBrief();
  if (!data.date) { showToast('⚠', 'กรุณาระบุวันที่'); return; }
  const ok = await saveSection('ipdBrief', data);
  if (ok) { savedRecords = savedRecords.filter(r => !(r.type === 'ipd-brief' && r.date === data.date)); savedRecords.push(data); updateBadges(); showToast('✓', `บันทึก IPD Brief ${data.date} สำเร็จ`); }
}
async function saveOPDStat() {
  if (!requireFolderSetup()) return;
  const data = collectOPDStat();
  if (!data.entries.length) { showToast('⚠', 'ไม่มีข้อมูล OPD Stat'); return; }
  const ok = await saveSection('opdStat', data);
  if (ok) { savedRecords = savedRecords.filter(r => !(r.type === 'opd-stat' && r.date === data.date)); savedRecords.push(data); updateBadges(); showToast('✓', `บันทึก OPD Stat ${data.date} สำเร็จ`); }
}
async function saveIPDStat() {
  if (!requireFolderSetup()) return;
  const data = collectIPDStat();
  if (!data.entries.length) { showToast('⚠', 'ไม่มีข้อมูล IPD Stat'); return; }
  const ok = await saveSection('ipdStat', data);
  if (ok) { savedRecords = savedRecords.filter(r => !(r.type === 'ipd-stat' && r.date === data.date)); savedRecords.push(data); updateBadges(); showToast('✓', `บันทึก IPD Stat ${data.date} สำเร็จ`); }
}
async function saveMedError() {
  if (!requireFolderSetup()) return;
  const data = collectMedError();
  if (!data.date || !data.item || !data.errorType || !data.detail || !data.location || !data.signature) { showToast('⚠', 'กรุณากรอกวันที่, รายการยา, Error, รายละเอียด, Location และลงชื่อ'); return; }
  const ok = await saveSection('medErrors', data);
  if (ok) { savedRecords.push(data); updateBadges(); showToast('✓', `บันทึก Med Error ${data.date} สำเร็จ`); }
}

function handleStatKeyDown(e){
  if(e.key !== 'Enter') return;
  e.preventDefault();

  const tbodyId = e.target.dataset.tbody;
  const idx = Number(e.target.dataset.idx);
  const field = e.target.dataset.field;
  const cfg = statConfig(tbodyId);
  const { rows } = cfg;
  const row = rows[idx];

  if(field === 'fileNo'){
    if(row.fileNo.length === 4) focusTableField(tbodyId, idx, 'timeStart');
    return;
  }

  if(field === 'timeStart'){
    if(row.timeStart) focusTableField(tbodyId, idx, 'timeEnd');
    return;
  }

  if(field === 'timeEnd'){
    if(row.timeEnd){
      if(!rows[idx + 1]) rows.push({ id: crypto.randomUUID(), fileNo:'', timeStart:'', timeEnd:'' });
      renderStatTable(tbodyId, rows, cfg.depts, cfg.target, cfg.onSummary);
      focusTableField(tbodyId, idx + 1, 'fileNo');
    }
    return;
  }
}

// ── SERVER I/O ──

function emptyDayDoc(date) {
  const now = new Date().toISOString();
  return { date, createdAt: now, updatedAt: now, opdBrief: null, ipdBrief: null, opdStat: null, ipdStat: null, medErrors: [] };
}

async function getDayDoc(date) {
  if (!serverUrl) return emptyDayDoc(date);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    const r = await fetch(`${serverUrl}/api/kpi/${date}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (r.ok) { const d = await r.json(); if (d && typeof d === 'object') return d; }
  } catch {}
  return emptyDayDoc(date);
}

async function saveDayDoc(doc) {
  if (!serverUrl) { enforceAppLock(); showToast('🌐', 'กรุณาตั้งค่า Server URL ก่อนบันทึก'); return false; }
  doc.updatedAt = new Date().toISOString();
  try {
    const r = await fetch(`${serverUrl}/api/kpi/${doc.date}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    });
    const j = await r.json();
    if (!j.ok) throw new Error('Server returned error');
    return true;
  } catch (e) { showToast('✗', 'บันทึกไม่สำเร็จ: ' + e.message); return false; }
}

async function saveSection(sectionKey, data) {
  const doc = await getDayDoc(data.date);
  if (sectionKey === 'medErrors') {
    if (!Array.isArray(doc.medErrors)) doc.medErrors = [];
    doc.medErrors.push(data);
  } else {
    doc[sectionKey] = data;
  }
  if (!doc.createdAt) doc.createdAt = new Date().toISOString();
  return saveDayDoc(doc);
}

// Flatten a daily doc back to individual type-based records for report/dashboard
function flattenDayDoc(doc) {
  const records = [];
  const d = doc.date;
  if (doc.opdBrief) records.push({ ...doc.opdBrief, type: 'opd-brief', date: doc.opdBrief.date || d });
  if (doc.ipdBrief) records.push({ ...doc.ipdBrief, type: 'ipd-brief', date: doc.ipdBrief.date || d });
  if (doc.opdStat)  records.push({ ...doc.opdStat,  type: 'opd-stat',  date: doc.opdStat.date  || d });
  if (doc.ipdStat)  records.push({ ...doc.ipdStat,  type: 'ipd-stat',  date: doc.ipdStat.date  || d });
  if (Array.isArray(doc.medErrors)) {
    doc.medErrors.forEach(e => records.push({ ...e, type: 'med-error', date: e.date || d }));
  }
  return records;
}

function exportAllJSON(){
  const source = reportRecords.length ? reportRecords : savedRecords;
  if(!source.length){showToast('⚠','ยังไม่มีบันทึก');return;}
  const fn=`pharmacy_export_${new Date().toISOString().split('T')[0]}.json`;
  downloadBlob(fn, JSON.stringify(source,null,2), 'application/json;charset=utf-8');
  showToast('⬇',`Export ${source.length} รายการ → ${fn}`);
}

// ── TABS ──
let currentService = 'opd';
let opdSubTab = 'brief';
let ipdSubTab = 'brief';

function switchService(service) {
  if (!requireFolderSetup()) return;
  currentService = service;

  document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('ptab-' + service)?.classList.add('active');

  const subBar = document.getElementById('service-subtabs');
  const isService = service === 'opd' || service === 'ipd';
  subBar.style.display = isService ? 'flex' : 'none';

  if (isService) {
    subBar.className = 'sub-tabs svc-' + service;
    const sub = service === 'opd' ? opdSubTab : ipdSubTab;
    document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
    document.getElementById('stab-' + sub)?.classList.add('active');
    document.getElementById('section-' + service + '-' + sub)?.classList.add('active');
    updateStatBadge();
  } else {
    document.getElementById('section-' + service)?.classList.add('active');
    if (service === 'records') renderRecords();
    if (service === 'report') renderReport();
    if (service === 'dashboard') renderDashboard();
  }
}

function switchSubTab(sub) {
  if (!requireFolderSetup()) return;
  if (currentService === 'opd') opdSubTab = sub;
  else if (currentService === 'ipd') ipdSubTab = sub;

  document.querySelectorAll('.stab').forEach(t => t.classList.remove('active'));
  document.getElementById('stab-' + sub)?.classList.add('active');

  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById('section-' + currentService + '-' + sub)?.classList.add('active');
}

function updateStatBadge() {
  const n = currentService === 'ipd'
    ? filterFilledEntries(ipdStatRows).length
    : filterFilledEntries(opdStatRows).length;
  const badge = document.getElementById('badge-stat');
  if (badge) badge.textContent = n;
}

/* backward-compat wrapper for any remaining switchTab('opd-stat') etc. calls */
function switchTab(name) {
  if (name === 'opd-brief')  { currentService = 'opd'; opdSubTab = 'brief'; switchService('opd'); }
  else if (name === 'ipd-brief') { currentService = 'ipd'; ipdSubTab = 'brief'; switchService('ipd'); }
  else if (name === 'opd-stat')  { currentService = 'opd'; opdSubTab = 'stat';  switchService('opd'); }
  else if (name === 'ipd-stat')  { currentService = 'ipd'; ipdSubTab = 'stat';  switchService('ipd'); }
  else switchService(name);
}

function showRecords() { if (!requireFolderSetup()) return; switchService('records'); }

function updateBadges() {
  document.getElementById('badge-records').textContent = savedRecords.length;
  document.getElementById('badge-report').textContent = reportRecords.length;
  const dashBadge = document.getElementById('badge-dashboard');
  if (dashBadge) dashBadge.textContent = reportRecords.length;
  updateStatBadge();
}

// ── RECORDS ──
function renderRecords(){
  const c=document.getElementById('records-container');
  if(!savedRecords.length){c.innerHTML='<div class="empty-state"><div class="icon">📭</div>ยังไม่มีบันทึก</div>';return;}
  const lbl={'opd-brief':'OPD Brief','ipd-brief':'IPD Brief','opd-stat':'OPD Stat','ipd-stat':'IPD Stat','med-error':'Med Error'};
  c.innerHTML='<div class="records-list">'+[...savedRecords].reverse().map((r,i)=>{
    const ri=savedRecords.length-1-i;
    const cnt=r.entries?r.entries.length+' รายการ':(r.checks?Object.keys(r.checks).length+' items':(r.type==='med-error'?(r.errorType||'med error'):''));
    return`<div class="record-item"><div class="record-meta"><span class="record-date">${r.date}</span><span class="record-type type-${r.type}">${lbl[r.type]}</span><span class="record-count">${cnt}</span></div><div class="record-actions"><button class="btn btn-ghost btn-sm" data-action="reexport" data-idx="${ri}">⬇ JSON</button><button class="btn btn-danger btn-sm" data-action="delete-rec" data-idx="${ri}">✕</button></div></div>`;
  }).join('')+'</div>';
}
function reExportRecord(idx){const r=savedRecords[idx];downloadBlob(`${r.type}_${r.date}_reexport.json`,JSON.stringify(r,null,2),'application/json;charset=utf-8');showToast('⬇','Download: '+r.type+' '+r.date);}
function deleteRecord(idx){savedRecords.splice(idx,1);updateBadges();renderRecords();}
function clearAllRecords(){if(!requireFolderSetup()) return; if(!confirm('ลบบันทึกทั้งหมด?'))return;savedRecords=[];updateBadges();renderRecords();}

// ── IMPORT / DRAG & DROP ──
function triggerImportJSON(){if(!requireFolderSetup()) return;
  document.getElementById('import-json-input').click();
}
function initDropZone(){
  const dz=document.getElementById('drop-zone');
  if(!dz) return;
  ['dragenter','dragover'].forEach(evt=>dz.addEventListener(evt,(e)=>{
    e.preventDefault(); e.stopPropagation(); dz.classList.add('drop-zone-active');
  }));
  ['dragleave','dragend','drop'].forEach(evt=>dz.addEventListener(evt,(e)=>{
    e.preventDefault(); e.stopPropagation(); dz.classList.remove('drop-zone-active');
  }));
  dz.addEventListener('drop',(e)=>{
    const files=e.dataTransfer?.files;
    if(files?.length) handleImportFiles(files);
  });
}
async function handleImportFiles(fileList){
  const files=Array.from(fileList||[]).filter(f=>/\.json$/i.test(f.name) || f.type==='application/json');
  if(!files.length){ showToast('⚠','กรุณาเลือกไฟล์ JSON'); return; }
  let imported=0;
  for(const file of files){
    try{
      const text=await file.text();
      const parsed=JSON.parse(text);
      const validItems=normalizeImportedRecords(parsed);
      savedRecords.push(...validItems);
      imported += validItems.length;
    }catch(e){
      console.error('Import failed:', file.name, e);
    }
  }
  updateBadges();
  renderRecords();
  showToast(imported?'✓':'⚠', imported ? `Import ${imported} รายการเรียบร้อย` : 'ไม่พบข้อมูลที่ import ได้');
  const input=document.getElementById('import-json-input');
  if(input) input.value='';
}



// ── REPORT FROM SHARED FOLDER ──
function normalizeImportedRecords(parsed){
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const flat = [];
  items.forEach(x => {
    if (!x || typeof x !== 'object') return;
    // Old flat record format
    if (x.type && x.date) { flat.push(x); return; }
    // New daily doc format
    if (x.date && (x.opdBrief || x.ipdBrief || x.opdStat || x.ipdStat || x.medErrors)) {
      flat.push(...flattenDayDoc(x));
    }
  });
  return flat;
}

function escapeHTML(value){
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

function getReportDetail(record){
  if (record.type === 'med-error') {
    return [record.item, record.errorType, record.location].filter(Boolean).join(' · ') || 'Med Error';
  }
  if (record.entries) {
    return `${record.entries.length} รายการ`;
  }
  if (record.checks) {
    const issueCount = Object.values(record.checks).filter(v => v === false).length;
    return issueCount ? `พบผิดปกติ ${issueCount}` : 'ไม่พบผิดปกติ';
  }
  return '—';
}

function formatReportRecordDetails(record){
  const detailItems = [];
  if (record.signature) detailItems.push(`<div class="report-detail-item"><strong>ผู้บันทึก:</strong> ${escapeHTML(record.signature)}</div>`);
  if (record.savedAt) detailItems.push(`<div class="report-detail-item"><strong>เวลาบันทึก:</strong> ${escapeHTML(new Date(record.savedAt).toLocaleString('th-TH'))}</div>`);
  if (record.__sourceFile) detailItems.push(`<div class="report-detail-item"><strong>ไฟล์ต้นทาง:</strong> ${escapeHTML(record.__sourceFile)}</div>`);
  if (record.type) detailItems.push(`<div class="report-detail-item"><strong>ประเภท:</strong> ${escapeHTML(record.type)}</div>`);

  let body = `<div class="report-detail-grid">${detailItems.join('')}</div>`;

  if (record.issues) {
    body += `<div class="report-issues"><strong>หมายเหตุ/ปัญหา:</strong> ${escapeHTML(record.issues)}</div>`;
  }

  if (record.type === 'med-error') {
    body += `<div class="report-detail-grid">
      <div class="report-detail-item"><strong>รายการยา:</strong> ${escapeHTML(record.item || '—')}</div>
      <div class="report-detail-item"><strong>Error:</strong> ${escapeHTML(record.errorType || '—')}</div>
      <div class="report-detail-item"><strong>Location:</strong> ${escapeHTML(record.location || '—')}</div>
    </div>`;
    if (record.detail) body += `<div class="report-issues"><strong>รายละเอียด:</strong> ${escapeHTML(record.detail)}</div>`;
    if (record.note) body += `<div class="report-issues"><strong>หมายเหตุ/การแก้ไข:</strong> ${escapeHTML(record.note)}</div>`;
  }

  if (record.checks && typeof record.checks === 'object') {
    const failed = Object.entries(record.checks).filter(([,v]) => v === false);
    const passed = Object.entries(record.checks).filter(([,v]) => v === true).length;
    body += `<div class="report-issues"><strong>Checklist:</strong> ผ่าน ${passed} รายการ${failed.length ? ` · ผิดปกติ ${failed.length} รายการ` : ''}</div>`;
    if (failed.length) {
      body += `<ul class="report-list">${failed.map(([k]) => `<li>${escapeHTML(k)}</li>`).join('')}</ul>`;
    }
  }

  if (Array.isArray(record.entries) && record.entries.length) {
    const entryRows = record.entries.map((entry, idx) => {
      const slot = entry.dept || entry.ward || '—';
      const mins = entry.minutesUsed ?? '—';
      const target = entry.withinTarget === null || entry.withinTarget === undefined ? '—' : (entry.withinTarget ? 'ผ่าน' : 'ไม่ผ่าน');
      const note = entry.note ? ` · หมายเหตุ: ${escapeHTML(entry.note)}` : '';
      return `<li>#${idx + 1} เลขที่ไฟล์: ${escapeHTML(entry.fileNo || '—')} · จุดบริการ: ${escapeHTML(slot)} · เวลา ${escapeHTML(entry.timeStart || '—')} → ${escapeHTML(entry.timeEnd || '—')} · ใช้ ${escapeHTML(mins)} นาที · ${target}${note}</li>`;
    }).join('');
    body += `<div class="report-issues"><strong>รายละเอียดรายการ:</strong></div><ul class="report-list">${entryRows}</ul>`;
  }

  body += `<details class="report-json"><summary>ดู JSON เต็ม</summary><pre>${escapeHTML(JSON.stringify(record, null, 2))}</pre></details>`;
  return `<div class="report-detail-box">${body}</div>`;
}


function getFilteredReportRecords(){
  const type = document.getElementById('report-filter-type')?.value || 'all';
  const dateFrom = document.getElementById('report-filter-date-from')?.value || '';
  const dateTo = document.getElementById('report-filter-date-to')?.value || '';
  return reportRecords.filter(record => {
    const recDate = record.date || '';
    if (type !== 'all' && record.type !== type) return false;
    if (dateFrom && recDate && recDate < dateFrom) return false;
    if (dateTo && recDate && recDate > dateTo) return false;
    if ((dateFrom || dateTo) && !recDate) return false;
    return true;
  });
}

function clearReportFilters(){
  const a=document.getElementById('report-filter-type'); if(a) a.value='all';
  const b=document.getElementById('report-filter-date-from'); if(b) b.value='';
  const c=document.getElementById('report-filter-date-to'); if(c) c.value='';
  renderReport();
}

function toggleReportDetail(id){
  const row = document.getElementById(id);
  if(!row) return;
  const isOpen = row.classList.toggle('open');
  const btn = document.querySelector(`[data-target="${id}"]`);
  if (btn) btn.textContent = isOpen ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียด';
}

function updateReportSummary(recordsForView = null){
  const source = recordsForView || reportRecords;
  const files = new Set(source.map(r => r.__sourceFile || 'unknown'));
  const dates = new Set(source.map(r => r.date).filter(Boolean));
  document.getElementById('report-files').textContent = files.size;
  document.getElementById('report-records').textContent = source.length;
  document.getElementById('report-dates').textContent = dates.size;
  updateBadges();
}

function renderReport(){
  const container = document.getElementById('report-container');
  if (!reportRecords.length) {
    updateReportSummary();
    container.innerHTML = '<div class="empty-state"><div class="icon">📊</div>ยังไม่มีข้อมูลรายงานจาก Shared Folder</div>';
    return;
  }

  const filteredRecords = getFilteredReportRecords();
  if (!filteredRecords.length) {
    updateReportSummary(filteredRecords);
    container.innerHTML = '<div class="empty-state"><div class="icon">🔎</div>ไม่พบข้อมูลตามตัวกรองที่เลือก</div>';
    return;
  }

  const groups = {};
  [...filteredRecords]
    .sort((a,b) => (b.date || '').localeCompare(a.date || '') || (b.savedAt || '').localeCompare(a.savedAt || ''))
    .forEach(record => {
      const date = record.date || 'ไม่ระบุวันที่';
      if (!groups[date]) groups[date] = [];
      groups[date].push(record);
    });

  const labels = {'opd-brief':'OPD Brief','ipd-brief':'IPD Brief','opd-stat':'OPD Stat','ipd-stat':'IPD Stat','med-error':'Med Error'};
  const typeClass = {'opd-brief':'type-opd-brief','ipd-brief':'type-ipd-brief','opd-stat':'type-opd-stat','ipd-stat':'type-ipd-stat','med-error':'type-med-error'};
  container.innerHTML = Object.keys(groups).sort((a,b)=>b.localeCompare(a)).map(date => {
    const rows = groups[date].map((record, idx) => {
      const detailId = `report-detail-${date.replace(/[^a-zA-Z0-9_-]/g,'_')}-${idx}`;
      return `
      <tr>
        <td>${idx + 1}</td>
        <td><span class="record-type ${typeClass[record.type] || ''}">${labels[record.type] || escapeHTML(record.type)}</span></td>
        <td>${escapeHTML(getReportDetail(record))}</td>
        <td>${escapeHTML(record.signature || '')}</td>
        <td>${escapeHTML(record.savedAt ? new Date(record.savedAt).toLocaleString('th-TH') : '')}</td>
        <td>${escapeHTML(record.__sourceFile || '')}</td>
        <td><button class="report-expand-btn" data-action="toggle-detail" data-target="${detailId}">ดูรายละเอียด</button></td>
      </tr>
      <tr class="report-detail-row" id="${detailId}">
        <td colspan="7">${formatReportRecordDetails(record)}</td>
      </tr>`;
    }).join('');
    return `
      <div class="report-group">
        <div class="report-group-title">วันที่ ${escapeHTML(date)} · ${groups[date].length} รายการ</div>
        <div style="overflow-x:auto;">
          <table class="entries-table">
            <thead><tr><th>#</th><th>ประเภท</th><th>สรุป</th><th>ผู้บันทึก</th><th>เวลาบันทึก</th><th>ไฟล์ต้นทาง</th><th></th></tr></thead>
            <tbody>${rows || `<tr><td colspan="7" class="report-empty-inline">ไม่มีข้อมูล</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  }).join('');
  updateReportSummary(filteredRecords);
}

async function loadSharedFolderReport(){
  if(!serverUrl){ showToast('🌐','กรุณาตั้งค่า Server URL ก่อนโหลดรายงาน'); return; }
  try {
    const r = await fetch(`${serverUrl}/api/kpi`);
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const days = await r.json(); // array of daily docs
    reportRecords = days.flatMap(flattenDayDoc);
    renderReport();
    showToast('📊', `โหลดรายงาน ${days.length} วัน · ${reportRecords.length} รายการ`);
  } catch(e) { showToast('⚠','โหลดรายงานไม่สำเร็จ: ' + e.message); }
}


// ── KPI DASHBOARD ──
function getDashboardFilteredRecords(){
  const dateFrom = document.getElementById('dash-filter-date-from')?.value || '';
  const dateTo = document.getElementById('dash-filter-date-to')?.value || '';
  return reportRecords.filter(record => {
    const recDate = record.date || '';
    if (dateFrom && recDate && recDate < dateFrom) return false;
    if (dateTo && recDate && recDate > dateTo) return false;
    if ((dateFrom || dateTo) && !recDate) return false;
    return true;
  });
}

function monthKey(dateStr){
  return (dateStr || '').slice(0, 7) || 'ไม่ระบุเดือน';
}

function pctText(pass, total){
  return total ? Math.round(pass / total * 100) + '%' : '—';
}

function getKPIAnalytics(records){
  const statEntries = [];
  const medErrors = [];
  const briefRecords = [];
  records.forEach(record => {
    if ((record.type === 'opd-stat' || record.type === 'ipd-stat') && Array.isArray(record.entries)) {
      record.entries.forEach(entry => {
        if (entry.minutesUsed === null || entry.minutesUsed === undefined) return;
        statEntries.push({
          date: record.date,
          month: monthKey(record.date),
          type: record.type,
          minutesUsed: Number(entry.minutesUsed),
          withinTarget: entry.withinTarget === true,
          targetMinutes: entry.targetMinutes || record.targetMinutes || (record.type === 'opd-stat' ? 5 : 15)
        });
      });
    }
    if (record.type === 'med-error') medErrors.push(record);
    if (record.type === 'opd-brief' || record.type === 'ipd-brief') briefRecords.push(record);
  });

  const byMonth = {};
  const byType = {
    'opd-stat': {label:'OPD Stat', total:0, pass:0, minutes:[]},
    'ipd-stat': {label:'IPD Stat', total:0, pass:0, minutes:[]}
  };
  statEntries.forEach(entry => {
    if (!byMonth[entry.month]) byMonth[entry.month] = {month:entry.month, total:0, pass:0, minutes:[], opdTotal:0, opdPass:0, ipdTotal:0, ipdPass:0};
    const m = byMonth[entry.month];
    m.total += 1;
    if (entry.withinTarget) m.pass += 1;
    m.minutes.push(entry.minutesUsed);
    if (entry.type === 'opd-stat') { m.opdTotal += 1; if(entry.withinTarget) m.opdPass += 1; }
    if (entry.type === 'ipd-stat') { m.ipdTotal += 1; if(entry.withinTarget) m.ipdPass += 1; }

    byType[entry.type].total += 1;
    if (entry.withinTarget) byType[entry.type].pass += 1;
    byType[entry.type].minutes.push(entry.minutesUsed);
  });

  const errorByType = {};
  const errorByLocation = {};
  medErrors.forEach(r => {
    const t = r.errorType || 'ไม่ระบุประเภท';
    const l = r.location || 'ไม่ระบุ Location';
    errorByType[t] = (errorByType[t] || 0) + 1;
    errorByLocation[l] = (errorByLocation[l] || 0) + 1;
  });

  return {statEntries, medErrors, briefRecords, byMonth, byType, errorByType, errorByLocation};
}

function avg(arr){
  return arr.length ? (arr.reduce((a,b)=>a+b,0) / arr.length).toFixed(1) : '—';
}

function renderBarList(dataObj){
  const entries = Object.entries(dataObj).sort((a,b)=>b[1]-a[1]);
  if (!entries.length) return '<div class="empty-state" style="padding:20px">ไม่มีข้อมูล</div>';
  const max = Math.max(...entries.map(([,v]) => v), 1);
  return `<div class="dash-bar-list">${entries.map(([label, value]) => `
    <div class="dash-bar-row">
      <div title="${escapeHTML(label)}">${escapeHTML(label)}</div>
      <div class="dash-bar-track"><div class="dash-bar-fill" style="width:${Math.max(3, value / max * 100)}%"></div></div>
      <div style="font-family:var(--mono);text-align:right">${value}</div>
    </div>`).join('')}</div>`;
}

function renderDashboard(){
  const container = document.getElementById('dashboard-container');
  if (!container) return;
  if (!reportRecords.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">📈</div>ยังไม่มีข้อมูล Dashboard — กดโหลด Dashboard ก่อน</div>';
    return;
  }

  const filtered = getDashboardFilteredRecords();
  const k = getKPIAnalytics(filtered);
  const totalStat = k.statEntries.length;
  const passStat = k.statEntries.filter(x => x.withinTarget).length;
  const avgMin = avg(k.statEntries.map(x => x.minutesUsed));
  const months = Object.values(k.byMonth).sort((a,b)=>a.month.localeCompare(b.month));

  const monthRows = months.map(m => `
    <tr>
      <td>${escapeHTML(m.month)}</td>
      <td>${m.total}</td>
      <td>${pctText(m.pass, m.total)}</td>
      <td>${avg(m.minutes)}</td>
      <td>${pctText(m.opdPass, m.opdTotal)}</td>
      <td>${pctText(m.ipdPass, m.ipdTotal)}</td>
      <td>${m.opdTotal}</td>
      <td>${m.ipdTotal}</td>
    </tr>`).join('');

  const opd = k.byType['opd-stat'];
  const ipd = k.byType['ipd-stat'];

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-value">${filtered.length}</div><div class="kpi-label">Records</div><div class="kpi-sub">จำนวน record ทั้งหมด</div></div>
      <div class="kpi-card"><div class="kpi-value">${totalStat}</div><div class="kpi-label">Stat Entries</div><div class="kpi-sub">OPD/IPD dispensing time</div></div>
      <div class="kpi-card"><div class="kpi-value">${pctText(passStat, totalStat)}</div><div class="kpi-label">% Pass Overall</div><div class="kpi-sub">ผ่านเป้าหมายตามประเภทงาน</div></div>
      <div class="kpi-card"><div class="kpi-value">${avgMin}</div><div class="kpi-label">Avg Minutes</div><div class="kpi-sub">เวลาเฉลี่ยรวม</div></div>
      <div class="kpi-card"><div class="kpi-value">${k.medErrors.length}</div><div class="kpi-label">Med Error</div><div class="kpi-sub">จำนวนรายการ error</div></div>
      <div class="kpi-card"><div class="kpi-value">${k.briefRecords.length}</div><div class="kpi-label">Brief Records</div><div class="kpi-sub">OPD/IPD morning brief</div></div>
    </div>

    <div class="dash-section-title">Dispensing KPI by Service</div>
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-value">${pctText(opd.pass, opd.total)}</div><div class="kpi-label">OPD ≤ 5 min</div><div class="kpi-sub">${opd.pass}/${opd.total} รายการ · avg ${avg(opd.minutes)} min</div></div>
      <div class="kpi-card"><div class="kpi-value">${pctText(ipd.pass, ipd.total)}</div><div class="kpi-label">IPD ≤ 15 min</div><div class="kpi-sub">${ipd.pass}/${ipd.total} รายการ · avg ${avg(ipd.minutes)} min</div></div>
    </div>

    <div class="dash-section-title">Monthly Trend</div>
    <div class="dash-table-wrap">
      <table class="entries-table" id="dashboard-monthly-table">
        <thead><tr><th>เดือน</th><th>รายการทั้งหมด</th><th>% ผ่านรวม</th><th>เวลาเฉลี่ย</th><th>OPD % Pass</th><th>IPD % Pass</th><th>OPD n</th><th>IPD n</th></tr></thead>
        <tbody>${monthRows || '<tr><td colspan="8" class="report-empty-inline">ไม่มีข้อมูล OPD/IPD Stat</td></tr>'}</tbody>
      </table>
    </div>

    <div class="dash-section-title">Medication Error by Type</div>
    ${renderBarList(k.errorByType)}

    <div class="dash-section-title">Medication Error by Location</div>
    ${renderBarList(k.errorByLocation)}

    <div class="export-row">
      <button class="btn btn-ghost btn-sm" data-action="dash-excel">📊 Export Excel</button>
      <button class="btn btn-ghost btn-sm" data-action="dash-datastudio">🧩 Export Data Studio JSON</button>
      <button class="btn btn-ghost btn-sm" data-action="dash-pdf">🖨 Export PDF</button>
    </div>
  `;
}

async function loadSharedFolderDashboard(){
  await loadSharedFolderReport();
  switchTab('dashboard');
  renderDashboard();
}

function clearDashboardFilters(){
  const a=document.getElementById('dash-filter-date-from'); if(a) a.value='';
  const b=document.getElementById('dash-filter-date-to'); if(b) b.value='';
  renderDashboard();
}

function buildDashboardExportTables(){
  const filtered = getDashboardFilteredRecords();
  const k = getKPIAnalytics(filtered);
  const monthRows = Object.values(k.byMonth).sort((a,b)=>a.month.localeCompare(b.month)).map(m => ({
    month:m.month, total:m.total, passPercent:pctText(m.pass,m.total), avgMinutes:avg(m.minutes),
    opdPassPercent:pctText(m.opdPass,m.opdTotal), ipdPassPercent:pctText(m.ipdPass,m.ipdTotal), opdN:m.opdTotal, ipdN:m.ipdTotal
  }));
  return {filtered, k, monthRows};
}

function safeNumber(value){
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildDataStudioRows(records){
  const rows = [];
  records.forEach(record => {
    const date = record.date || '';
    const month = monthKey(date);
    const year = date ? date.slice(0,4) : '';
    const common = {
      schema_version: String(record.schemaVersion || 'legacy'),
      app_name: record.appName || KPI_APP_NAME,
      source_file: record.__sourceFile || '',
      saved_at: record.savedAt || '',
      date,
      year,
      month,
      record_type: record.type || '',
      service_type: '',
      row_type: '',
      row_id: '',
      file_no: '',
      time_start: '',
      time_end: '',
      target_minutes: null,
      minutes_used: null,
      within_target: null,
      pass_count: 0,
      fail_count: 0,
      stat_count: 0,
      med_error_count: 0,
      brief_count: 0,
      checklist_total: null,
      checklist_pass: null,
      checklist_issue: null,
      med_error_item: '',
      med_error_type: '',
      med_error_location: '',
      signature: record.signature || '',
      detail: '',
      note: ''
    };

    if ((record.type === 'opd-stat' || record.type === 'ipd-stat') && Array.isArray(record.entries)) {
      const service = record.type === 'opd-stat' ? 'OPD' : 'IPD';
      record.entries.forEach((entry, idx) => {
        const minutes = safeNumber(entry.minutesUsed ?? calcDiff(entry.timeStart, entry.timeEnd));
        const within = entry.withinTarget === true ? true : entry.withinTarget === false ? false : null;
        rows.push({
          ...common,
          service_type: service,
          row_type: 'stat_entry',
          row_id: entry.id || `${record.type}_${date}_${idx + 1}`,
          file_no: String(entry.fileNo || ''),
          time_start: entry.timeStart || '',
          time_end: entry.timeEnd || '',
          target_minutes: safeNumber(entry.targetMinutes || record.targetMinutes || (record.type === 'opd-stat' ? 5 : 15)),
          minutes_used: minutes,
          within_target: within,
          pass_count: within === true ? 1 : 0,
          fail_count: within === false ? 1 : 0,
          stat_count: 1,
          note: entry.note || ''
        });
      });
      return;
    }

    if (record.type === 'med-error') {
      rows.push({
        ...common,
        row_type: 'med_error',
        row_id: `${record.type}_${date}_${record.savedAt || ''}`,
        med_error_count: 1,
        med_error_item: record.item || '',
        med_error_type: record.errorType || 'ไม่ระบุประเภท',
        med_error_location: record.location || 'ไม่ระบุ Location',
        detail: record.detail || '',
        note: record.note || ''
      });
      return;
    }

    if (record.type === 'opd-brief' || record.type === 'ipd-brief') {
      const checks = record.checks && typeof record.checks === 'object' ? record.checks : {};
      const values = Object.values(checks);
      const pass = values.filter(v => v === true).length;
      const issue = values.filter(v => v === false).length;
      rows.push({
        ...common,
        service_type: record.type === 'opd-brief' ? 'OPD' : 'IPD',
        row_type: 'brief_record',
        row_id: `${record.type}_${date}_${record.savedAt || ''}`,
        brief_count: 1,
        checklist_total: values.length,
        checklist_pass: pass,
        checklist_issue: issue,
        detail: record.issues || ''
      });
    }
  });
  return rows;
}

function buildDataStudioExportObject(){
  const sourceRecords = reportRecords.length ? getDashboardFilteredRecords() : savedRecords;
  const rows = buildDataStudioRows(sourceRecords);
  return {
    schemaVersion: 'looker-studio-flat-v1',
    appName: KPI_APP_NAME,
    generatedAt: new Date().toISOString(),
    timezone: 'Asia/Bangkok',
    description: 'Flat analytics-ready JSON for Looker Studio/Data Studio. Each object in rows has the same fields; use date/month/record_type/service_type as dimensions and *_count/minutes_used as metrics.',
    rowCount: rows.length,
    rows
  };
}

function exportDashboardDataStudioJSON(){
  const sourceRecords = reportRecords.length ? getDashboardFilteredRecords() : savedRecords;
  if(!sourceRecords.length){
    showToast('⚠','ยังไม่มีข้อมูลสำหรับ Export Data Studio JSON');
    return;
  }
  const exportObject = buildDataStudioExportObject();
  const today = new Date().toISOString().slice(0,10);
  downloadBlob(
    `pharmacy_kpi_datastudio_${today}.json`,
    JSON.stringify(exportObject, null, 2),
    'application/json;charset=utf-8'
  );
  showToast('🧩', `Export Data Studio JSON ${exportObject.rowCount} rows`);
}

function exportDashboardExcel(){
  if(!reportRecords.length){ showToast('⚠','ยังไม่มีข้อมูลสำหรับ Export'); return; }
  const {k, monthRows} = buildDashboardExportTables();
  const rowsToHtml = (headers, rows) => `
    <table border="1">
      <thead><tr>${headers.map(h=>`<th>${escapeHTML(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(row=>`<tr>${headers.map(h=>`<td>${escapeHTML(row[h] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;

  const monthly = monthRows.map(r => ({
    'Month':r.month, 'Total':r.total, 'Pass %':r.passPercent, 'Avg minutes':r.avgMinutes,
    'OPD Pass %':r.opdPassPercent, 'IPD Pass %':r.ipdPassPercent, 'OPD n':r.opdN, 'IPD n':r.ipdN
  }));
  const errorType = Object.entries(k.errorByType).sort((a,b)=>b[1]-a[1]).map(([name,count]) => ({'Error Type':name,'Count':count}));
  const errorLocation = Object.entries(k.errorByLocation).sort((a,b)=>b[1]-a[1]).map(([name,count]) => ({'Location':name,'Count':count}));

  const html = `
    <html><head><meta charset="UTF-8"></head><body>
      <h2>Pharmacy KPI Dashboard Export</h2>
      <h3>Monthly Trend</h3>${rowsToHtml(['Month','Total','Pass %','Avg minutes','OPD Pass %','IPD Pass %','OPD n','IPD n'], monthly)}
      <h3>Med Error by Type</h3>${rowsToHtml(['Error Type','Count'], errorType)}
      <h3>Med Error by Location</h3>${rowsToHtml(['Location','Count'], errorLocation)}
    </body></html>`;

  downloadBlob(`pharmacy_kpi_dashboard_${new Date().toISOString().slice(0,10)}.xls`, html, 'application/vnd.ms-excel;charset=utf-8');
  showToast('📊','Export Excel เรียบร้อย');
}

function exportDashboardPDF(){
  if(!reportRecords.length){ showToast('⚠','ยังไม่มีข้อมูลสำหรับ Export'); return; }
  const html = document.getElementById('dashboard-container')?.innerHTML || '';
  const w = window.open('', '_blank');
  if(!w){ showToast('⚠','Browser block popup — กรุณา allow popups'); return; }
  w.document.write(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Pharmacy KPI Dashboard</title>
        <style>
          body{font-family:'Sarabun',Arial,sans-serif;color:#2d3548;padding:20px;font-size:13px}
          h1{font-size:20px;margin:0 0 12px}
          table{width:100%;border-collapse:collapse;margin:10px 0 18px}
          th,td{border:1px solid #dde2ef;padding:6px 8px;text-align:left}
          th{background:#eef1f8}
          .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
          .kpi-card{border:1px solid #dde2ef;border-radius:8px;padding:10px;background:#f4f6fb}
          .kpi-value{font-size:22px;font-weight:700;color:#3a6fa3}
          .kpi-label{font-size:11px;color:#5a6480;font-weight:700}
          .dash-bar-row{display:grid;grid-template-columns:150px 1fr 50px;gap:8px;margin:5px 0}
          .dash-bar-track{height:12px;background:#eef1f8;border:1px solid #dde2ef;border-radius:999px;overflow:hidden}
          .dash-bar-fill{height:100%;background:#6b9bd2}
          button,.export-row,.dashboard-note{display:none!important}
          @media print{@page{size:A4 landscape;margin:10mm}}
        </style>
      </head>
      <body>
        <h1>Pharmacy KPI Dashboard</h1>
        <div>Generated: ${escapeHTML(new Date().toLocaleString('th-TH'))}</div>
        ${html}
        <script>window.onload=function(){setTimeout(function(){window.print();},300)}<\/script>
      </body>
    </html>`);
  w.document.close();
}

function downloadBlob(filename, content, mime){
  const blob = new Blob([content], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// ── CLEAR ──
function clearOPDBrief(){if(!requireFolderSetup()) return; opdBriefState={};buildChecklist(OPD_CHECKS,'opd-brief-checks',opdBriefState);document.getElementById('opd-brief-issues').value='';document.getElementById('opd-brief-sign').value='';}
function clearIPDBrief(){if(!requireFolderSetup()) return; ipdBriefState={};buildChecklist(IPD_CHECKS,'ipd-brief-checks',ipdBriefState);document.getElementById('ipd-brief-issues').value='';document.getElementById('ipd-brief-sign').value='';}
function clearMedError(){if(!requireFolderSetup()) return;
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('med-error-date').value=today;
  document.getElementById('med-error-item').value='';
  document.getElementById('med-error-type').value='';
  document.getElementById('med-error-detail').value='';
  document.getElementById('med-error-location').value='';
  document.getElementById('med-error-signature').value='';
  document.getElementById('med-error-note').value='';
}

async function copyTextSafe(text){
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch(e) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }
}

async function updateWebApp(){
  if (!('showOpenFilePicker' in window) || !('showDirectoryPicker' in window)) {
    alert('กรุณาใช้ Chrome หรือ Edge เวอร์ชันใหม่ เพื่อรองรับการ Update App');
    return;
  }

  const copied = await copyTextSafe(APP_UPDATE_SOURCE_PATH);

  const ok = confirm([
    'ระบบจะช่วย Update Web App ไปที่เครื่องนี้',
    '',
    'Source folder:',
    APP_UPDATE_SOURCE_PATH,
    '',
    'Target folder:',
    APP_TARGET_PATH,
    '',
    copied
      ? 'คัดลอก source path ไปที่ clipboard แล้ว'
      : 'คัดลอก source path ไม่สำเร็จ กรุณา copy เอง',
    '',
    'ขั้นตอน:',
    '1) เลือกไฟล์เวอร์ชันใหม่จาก shared folder',
    '2) เลือก folder D:\\pharmacy',
    '3) ระบบจะ backup ไฟล์เดิม แล้วเขียนไฟล์ใหม่',
    '',
    'ต้องการเริ่ม Update หรือไม่?'
  ].join('\n'));

  if (!ok) return;

  try {
    // 1) Pick source HTML from shared folder
    const [sourceFileHandle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{
        description: 'Pharmacy Web App HTML',
        accept: { 'text/html': ['.html', '.htm'] }
      }]
    });

    const sourceFile = await sourceFileHandle.getFile();
    const newContent = await sourceFile.text();

    if (!newContent.includes('Pharmacy Data System') && !newContent.includes('PHARM·KPI')) {
      const force = confirm('ไฟล์ที่เลือกอาจไม่ใช่ Pharmacy Web App ต้องการ update ต่อหรือไม่?');
      if (!force) return;
    }

    // 2) Pick target D:\pharmacy folder
    await copyTextSafe(APP_TARGET_PATH);
    alert('กรุณาเลือกโฟลเดอร์ D:\\pharmacy ในหน้าต่างถัดไป\n\nระบบคัดลอก path ไป clipboard แล้ว');

    const targetDir = await window.showDirectoryPicker({ mode: 'readwrite' });

    const perm = await targetDir.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      alert('ไม่ได้รับสิทธิ์เขียนไฟล์ในโฟลเดอร์ปลายทาง');
      return;
    }

    // 3) Backup old file if exists
    try {
      const oldHandle = await targetDir.getFileHandle(APP_FILE_NAME);
      const oldFile = await oldHandle.getFile();
      const oldContent = await oldFile.text();

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, '-')
        .replace('T', '_')
        .slice(0, 19);

      const backupName = APP_FILE_NAME.replace(/\.html?$/i, '') + '_backup_' + stamp + '.html';
      const backupHandle = await targetDir.getFileHandle(backupName, { create: true });
      const backupWritable = await backupHandle.createWritable();
      await backupWritable.write(oldContent);
      await backupWritable.close();
    } catch(e) {
      console.warn('No old file to backup or backup failed:', e);
    }

    // 4) Write new app file
    const targetFileHandle = await targetDir.getFileHandle(APP_FILE_NAME, { create: true });
    const writable = await targetFileHandle.createWritable();
    await writable.write(newContent);
    await writable.close();

    showToast('✓', 'Update App สำเร็จ — กรุณาปิดแล้วเปิดไฟล์ใหม่อีกครั้ง');
    alert('Update สำเร็จ\n\nกรุณาปิดหน้าเว็บนี้ แล้วเปิดไฟล์ใหม่จาก D:\\pharmacy อีกครั้ง');

  } catch(e) {
    if (e.name === 'AbortError') {
      showToast('⚠', 'ยกเลิกการ Update');
      return;
    }
    console.error(e);
    alert('Update ไม่สำเร็จ: ' + e.message);
  }
}

// ── TOAST ──
let toastTimer=null;
function showToast(icon,msg){const t=document.getElementById('toast');document.getElementById('toast-icon').textContent=icon;document.getElementById('toast-msg').textContent=msg;t.classList.add('show');if(toastTimer)clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),3200);}
