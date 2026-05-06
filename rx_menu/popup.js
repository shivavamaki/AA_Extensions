/**
 * popup.js — BKN Pharmacy Extension v2.1
 *
 * Compatible with:
 * - content_script.js MRD page action: getMrdRows
 * - background relay action: sendToDrugDelivery
 * - background/content result action: drugDeliveryResult
 *
 * Features:
 * 1. Tab navigation (persisted)
 * 2. IPD Queue — fetch, group by ward prefix, render table
 * 3. Persist full table data + sent state in chrome.storage.local
 * 4. Display errors reported back from drugdelivery page
 * 5. RT_COMMON_257 Report — URL builder, XLS parser, PDF Summary + Detail
 * 6. RT_COMMON_917 Report — URL builder, XLS parser, grouped sticker PDF
 */

'use strict';

const STORAGE_KEY_ROWS = 'ipdQueue_rows';
const STORAGE_KEY_SENT = 'ipdQueue_sent';

// ──────────────────────────────────────────────────────────────────────────────
// Init
// ──────────────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initIpdQueue();
  initIvSticker();
  initAuxSticker();
  initReport();
  initReportToggles();
  initStockPickingReport();
  initExpReport();
  initAdrReport();
  initFormularyTab();
  initKnowledgeTab();
  initWorkspaceSections();
});

// ──────────────────────────────────────────────────────────────────────────────
// Tab Navigation
// ──────────────────────────────────────────────────────────────────────────────
function initTabs() {
  const btns = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');

  chrome.storage.local.get(['activeTab'], ({ activeTab }) => {
    if (activeTab) activateTab(activeTab);
  });

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.tab);
      chrome.storage.local.set({ activeTab: btn.dataset.tab });
    });
  });

  function activateTab(id) {
    btns.forEach(b => b.classList.toggle('active', b.dataset.tab === id));
    panels.forEach(p => p.classList.toggle('active', p.id === id));
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// IPD Queue — RT_COMMON_288 (Current Patient in Ward)
// ──────────────────────────────────────────────────────────────────────────────
const IPD_QUEUE_URL = 'https://aa-report.bdms.co.th/jasperserver/flow.html?_flowId=viewReportFlow&output=xls&reportUnit=%2FBDMS%2FOther%2FRT_COMMON_288&userTimezone=Asia/bangkok&decorate=no&selectedorganisationuid=5b20f438d1202e29ce16f710&loginuid=5bb325cb3e4efabebd8ea549&logindepartmentuid=5b857e32136d276403482bca&organisationuid=5b20f438d1202e29ce16f710&userLocale=th&fromamount=null&toamount=null&isduplicate=false&pp=u=5bb325cb3e4efabebd8ea549&r=5b83f09c3238d86bf0d583c7&o=569794170946a3d0d588efe6';

function initIpdQueue() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'drugDeliveryResult') {
      handleDeliveryResult(msg.visitId, msg.ok, msg.errorText);
    }
  });

  // Generate URL button
  const btnGen = document.getElementById('btnQueueGenUrl');
  const btnOpen = document.getElementById('btnQueueOpenXls');
  const urlWrap = document.getElementById('queueUrlWrap');
  const urlBox  = document.getElementById('queueUrlBox');

  btnGen?.addEventListener('click', () => {
    urlBox.textContent = IPD_QUEUE_URL;
    urlWrap.style.display = 'block';
    btnOpen.style.display = '';
    urlBox.onclick = () => chrome.tabs.create({ url: IPD_QUEUE_URL });
  });

  btnOpen?.addEventListener('click', () => chrome.tabs.create({ url: IPD_QUEUE_URL }));

  // File input
  document.getElementById('queueFileInput')?.addEventListener('change', async function (ev) {
    const file = (ev?.target?.files && ev.target.files[0]) || (this?.files && this.files[0]);
    if (!file) return;
    const statusEl = document.getElementById('queueStatus');
    setStatus(statusEl, '⏳ Reading file…', 'loading');
    try {
      const sheets = await readXlsFile(file);
      const rows = parseIPDQueueXls(sheets);
      const sentData = await chrome.storage.local.get(STORAGE_KEY_SENT);
      const sent = new Set(sentData[STORAGE_KEY_SENT] || []);
      await chrome.storage.local.set({ [STORAGE_KEY_ROWS]: rows });
      const tbody  = document.getElementById('queueTableBody');
      const countEl = document.getElementById('queueCount');
      renderQueueTable(rows, tbody, countEl, sent);
      setStatus(statusEl, `✓ ${rows.length} คน จาก ${file.name}`, 'ok');
    } catch (e) {
      setStatus(document.getElementById('queueStatus'), `✗ ${e.message}`, 'err');
    }
  });

  restoreQueueState();
}

async function restoreQueueState() {
  const data = await chrome.storage.local.get([STORAGE_KEY_ROWS, STORAGE_KEY_SENT]);
  const rows = data[STORAGE_KEY_ROWS];
  const sent = new Set(data[STORAGE_KEY_SENT] || []);
  if (rows && rows.length > 0) {
    const tbody   = document.getElementById('queueTableBody');
    const countEl = document.getElementById('queueCount');
    const statusEl = document.getElementById('queueStatus');
    renderQueueTable(rows, tbody, countEl, sent);
    setStatus(statusEl, `✓ ${rows.length} คน (restored — load new XLS to update)`, 'ok');
  }
}

function parseIPDQueueXls(sheets) {
  const rows = [];
  if (!sheets || !sheets.length) return rows;
  const raw = sheets[0].rows;
  let currentWard = '';

  for (const r of raw) {
    const c0 = String(r[0] ?? '').trim();
    const c2 = String(r[2] ?? '').trim();   // EN
    const c5 = String(r[5] ?? '').trim();   // Name

    if (!c0 || c0 === 'Current Patient in Ward' || c0 === 'No.') continue;
    if (c5.startsWith('จำนวน') || c0.startsWith('Print')) continue;

    // Ward header: non-numeric col0, empty EN col
    if (isNaN(parseFloat(c0)) && !c2) {
      currentWard = c0;
      continue;
    }

    // Summary / stats page rows (LOCATION, TOTAL etc.)
    if (c0 === 'LOCATION' || c0 === 'GRAND TOTAL' || c0 === 'Cardiac Care Unit' && c5 === '') continue;

    // Data row
    const no = parseFloat(c0);
    if (!isNaN(no) && c2.startsWith('I')) {
      rows.push({
        wardBed:   currentWard,
        name:      c5 || '—',
        visitId:   c2,
        hn:        String(r[3] ?? '').trim(),
        room:      String(r[9] ?? '').trim(),
        age:       r[14] !== undefined && r[14] !== '' ? String(Math.floor(parseFloat(String(r[14])))) : '',
        doctor:    String(r[16] ?? '').trim(),
        diagnosis: String(r[21] ?? '').trim(),
      });
    }
  }
  return rows;
}

function wardGroup(wardBed) {
  if (!wardBed) return 'Unknown';
  const slashIdx = wardBed.indexOf(' / ');
  return slashIdx !== -1 ? wardBed.slice(0, slashIdx).trim() : wardBed.trim();
}

const GROUP_PALETTE = [
  { bg: '#e8f4fd', border: '#90caf9', text: '#1565c0' },
  { bg: '#e8f8f2', border: '#80cbc4', text: '#00695c' },
  { bg: '#fdf3e8', border: '#ffcc80', text: '#e65100' },
  { bg: '#f3e8fd', border: '#ce93d8', text: '#6a1b9a' },
  { bg: '#fde8ec', border: '#f48fb1', text: '#880e4f' },
  { bg: '#e8fde8', border: '#a5d6a7', text: '#1b5e20' },
  { bg: '#fdf8e8', border: '#fff176', text: '#f57f17' },
];
const groupColorMap = new Map();
let colorIndex = 0;

function groupColor(key) {
  if (!groupColorMap.has(key)) {
    groupColorMap.set(key, GROUP_PALETTE[colorIndex % GROUP_PALETTE.length]);
    colorIndex++;
  }
  return groupColorMap.get(key);
}

function renderQueueTable(rows, tbody, countEl, sentSet = new Set()) {
  countEl.textContent = rows.length || '0';
  tbody.innerHTML = '';
  groupColorMap.clear();
  colorIndex = 0;

  if (rows.length === 0) {
    tbody.innerHTML = '<tr class="queue-empty-row"><td colspan="3">No active patients found</td></tr>';
    return;
  }

  const groups = new Map();
  rows.forEach(row => {
    const key = wardGroup(row.wardBed || '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  groups.forEach((patients, groupKey) => {
    const color = groupColor(groupKey);

    const groupTr = document.createElement('tr');
    groupTr.className = 'queue-group-header';
    groupTr.style.cssText = `--gh-bg:${color.bg};--gh-border:${color.border};--gh-text:${color.text}`;

    const groupTd = document.createElement('td');
    groupTd.colSpan = 3;
    groupTd.innerHTML = `
      <div class="queue-group-label">
        <span class="queue-group-name">${escHtml(groupKey)}</span>
        <span class="queue-group-count">${patients.length}</span>
      </div>`;
    groupTr.appendChild(groupTd);
    tbody.appendChild(groupTr);

    patients.forEach(({ name, visitId, room }) => {
      const tr = document.createElement('tr');
      tr.dataset.visitId = visitId;

      const isSent = sentSet.has(visitId);
      if (isSent) tr.classList.add('row-sent');

      const tdName = document.createElement('td');
      tdName.className = 'cell-name';
      tdName.textContent = name || '—';
      tdName.title = name || '';

      const tdVisit = document.createElement('td');
      tdVisit.className = 'cell-visit';
      tdVisit.innerHTML = `<span class="cell-visit-en">${escHtml(visitId || '—')}</span>${room ? `<span class="cell-visit-room">${escHtml(room)}</span>` : ''}`;

      const tdAction = document.createElement('td');
      tdAction.className = 'cell-action';

      const btn = document.createElement('button');
      btn.className = 'queue-send-btn' + (isSent ? ' sent' : '');
      btn.textContent = isSent ? '✓ Sent' : 'Send ▶';
      btn.disabled = isSent;
      btn.title = isSent ? `Already sent: ${visitId}` : `Send ${visitId} to Drug Delivery`;

      if (!isSent) {
        btn.addEventListener('click', () => handlePopupSend(btn, tr, visitId));
      }

      tdAction.appendChild(btn);
      tr.append(tdName, tdVisit, tdAction);
      tbody.appendChild(tr);
    });
  });
}

async function handlePopupSend(btn, tr, visitId) {
  if (btn.disabled) return;

  const statusEl = document.getElementById('queueStatus');

  btn.disabled = true;
  btn.textContent = '⏳';
  btn.classList.remove('error', 'sent');
  btn.title = `Sending ${visitId} to Drug Delivery...`;

  setStatus(statusEl, `⏳ Sending ${visitId} to Drug Delivery...`, 'loading');

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'sendToDrugDelivery', visitId });

    if (resp && resp.ok === false) {
      throw new Error(resp.error || 'Background rejected request');
    }

    btn.textContent = '…';
    btn.title = `Waiting result for ${visitId}...`;
  } catch (e) {
    btn.textContent = '✗ Retry';
    btn.classList.add('error');
    btn.title = `Failed: ${e.message}`;
    btn.disabled = false;
    setStatus(statusEl, `✗ ${visitId}: ${e.message}`, 'err');
  }
}

async function handleDeliveryResult(visitId, ok, errorText) {
  const safeId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(visitId)) : String(visitId);
  const tr = document.querySelector(`tr[data-visit-id="${safeId}"]`);
  const btn = tr?.querySelector('.queue-send-btn');
  if (!tr || !btn) return;

  const statusEl = document.getElementById('queueStatus');

  if (ok) {
    btn.textContent = '✓ Sent';
    btn.classList.remove('error');
    btn.classList.add('sent');
    btn.disabled = true;
    btn.title = `Sent successfully: ${visitId}`;
    tr.classList.add('row-sent');

    const data = await chrome.storage.local.get(STORAGE_KEY_SENT);
    const sent = new Set(data[STORAGE_KEY_SENT] || []);
    sent.add(visitId);
    await chrome.storage.local.set({ [STORAGE_KEY_SENT]: [...sent] });

    setStatus(statusEl, `✓ Sent ${visitId} successfully`, 'ok');
  } else {
    btn.textContent = '✗ Retry';
    btn.classList.remove('sent');
    btn.classList.add('error');
    btn.disabled = false;
    btn.title = `Error: ${errorText || 'Drug delivery returned an error'}`;

    setStatus(
      statusEl,
      `✗ ${visitId}: ${errorText || 'Drug delivery returned an error'}`,
      'err'
    );
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────────
function msgTab(tabId, payload) {
  return new Promise(resolve =>
    chrome.tabs.sendMessage(tabId, payload, resp =>
      chrome.runtime.lastError ? resolve(null) : resolve(resp)
    )
  );
}

function setStatus(el, msg, type = '') {
  if (!el) return;
  el.textContent = msg;
  el.className = 'queue-status ' + type;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function normalizeWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function repairJasperThaiArtifacts(s) {
  // Jasper BIFF sometimes splits Thai UTF-16 bytes into visible/control pairs:
  //   \x0E\x22\x0E\x32... => ยา...
  // Convert those pairs back to real Thai characters before any control cleanup.
  return String(s || '').replace(/(?:\x0E[\x00-\x7F]){2,}/g, block => {
    let out = '';
    for (let i = 0; i + 1 < block.length; i += 2) {
      if (block.charCodeAt(i) === 0x0E) {
        out += String.fromCharCode(0x0E00 + block.charCodeAt(i + 1));
      }
    }
    return out || block;
  });
}

function cleanExp174Text(value, options = {}) {
  let s = repairJasperThaiArtifacts(String(value ?? ''));

  // Remove only non-Thai control characters after repairing Thai byte-pairs.
  s = s.replace(/[\x00-\x08\x0B-\x0C\x0F-\x1F\x7F-\x9F]/g, ' ');

  // Legacy fallback for already-damaged non-Thai residue.
  s = s.replace(/\(\s*[\"'“”]?\s*2\s*-\s*1\s*5\s*\)/g, ' ');
  s = s.replace(/\(\s*[\"'“”]?\s*2\s*-\s*1\s*5\s*/g, ' ');

  s = normalizeWhitespace(s);
  if (options.name) {
    // Repair names accidentally rendered as spaced letters, but avoid joining normal units.
    s = s.replace(/((?:\b[A-Za-z]\s+){4,}[A-Za-z]\b)/g, m => m.replace(/\s+/g, ''));
    s = s
      .replace(/m\s+L\b/g, 'mL')
      .replace(/M\s+L\b/g, 'ML')
      .replace(/m\s+g\b/g, 'mg')
      .replace(/M\s+g\b/g, 'Mg')
      .replace(/m\s+c\s+g\b/g, 'mcg')
      .replace(/G\s+m\b/g, 'Gm');
    s = normalizeWhitespace(s);
  }
  return s;
}

function getExp174SelectedStoreBinLabel() {
  const el = document.getElementById('exp174-storebin');
  const value = el?.value || '';
  if (!value) return 'All';
  if (value === '__NO_STOREBIN__') return 'No StoreBin';
  return value;
}

// ──────────────────────────────────────────────────────────────────────────────
// Open pages
// ──────────────────────────────────────────────────────────────────────────────
function initIvSticker() {
  document.getElementById('openIvSticker')
    ?.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('iv_sticker.html') });
    });
}

function initAuxSticker() {
  document.getElementById('openAuxSticker')
    ?.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('aux_sticker.html') });
    });
}

// ──────────────────────────────────────────────────────────────────────────────
// RT_COMMON_257 — Pending IP Fill Report
// ──────────────────────────────────────────────────────────────────────────────
const RT257_BASE = 'https://aa-report.bdms.co.th/jasperserver/flow.html';
const RT257_FIXED = {
  _flowId: 'viewReportFlow',
  output: 'xls',
  reportUnit: '/BDMS/Other/RT_COMMON_257',
  userTimezone: 'Asia/bangkok',
  decorate: 'no',
  selectedorganisationuid: '5b20f438d1202e29ce16f710',
  loginuid: '5bb325cb3e4efabebd8ea549',
  logindepartmentuid: '5ee83dd361de5822deed220d',
  organisationuid: '5b20f438d1202e29ce16f710',
  userLocale: 'th',
  isduplicate: 'FALSE',
  pp: 'u=5bb325cb3e4efabebd8ea549&r=5b83f09c3238d86bf0d583c7&o=569794170946a3d0d588efe6',
};

const RT257_WARD_COLS = ['4', '5', '6', '7', '8', '9', 'ICU', 'CCU', 'NICU', 'LR', 'No Room'];

let rptSummaryRows = [];
let rptDetailRows = [];
let rptFromLabel = '';
let rptToLabel = '';

function bkkDayStart(dateStr) {
  return dateStr + 'T17:00:00.000Z';
}

function bkkDayEnd(dateStr) {
  return dateStr + 'T16:59:59.999Z';
}

function buildRt257Url(fromDate, toDate) {
  const params = Object.assign({}, RT257_FIXED, {
    fromdate: bkkDayStart(fromDate),
    todate: bkkDayEnd(toDate),
  });
  const rawEncode = v => String(v).replace(/%/g, '%25').replace(/ /g, '%20');
  const qs = Object.entries(params).map(([k, v]) => `${k}=${rawEncode(v)}`).join('&');
  return `${RT257_BASE}?${qs}`;
}

function rptStatus(msg, type = '') {
  const el = document.getElementById('rpt-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'rpt-status ' + type;
}

// ──────────────────────────────────────────────────────────────────────────────
// BIFF8 / OLE2 XLS Parser
// ──────────────────────────────────────────────────────────────────────────────
function parseBiff8(buffer) {
  const data = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const SECT = 512;
  const FREE = 0xFFFFFFFF;
  const EOCH = 0xFFFFFFFE;
  const FATS = 0xFFFFFFFD;

  const u32 = (pos) => dv.getUint32(pos, true);

  function sectorBytes(secId) {
    const off = (secId + 1) * SECT;
    return data.slice(off, off + SECT);
  }

  const fatSecIds = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(0x4C + i * 4);
    if (s === FREE || s === EOCH) break;
    fatSecIds.push(s);
  }

  const fat = [];
  for (const sid of fatSecIds) {
    const sec = sectorBytes(sid);
    const sv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    for (let i = 0; i < 128; i++) fat.push(sv.getUint32(i * 4, true));
  }

  function followChain(start) {
    const parts = [];
    let cur = start;
    let guard = 0;
    while (cur !== EOCH && cur !== FREE && cur !== FATS && guard++ < 10000) {
      parts.push(sectorBytes(cur));
      cur = fat[cur];
    }
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  const firstDir = u32(0x30);
  const dirBytes = followChain(firstDir);
  const dirDv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);

  const entries = [];
  for (let i = 0; i * 128 < dirBytes.length; i++) {
    const base = i * 128;
    const nameLen = dirDv.getUint16(base + 64, true);
    let name = '';
    if (nameLen > 2) {
      for (let j = 0; j < (nameLen - 2) / 2; j++) {
        name += String.fromCharCode(dirDv.getUint16(base + j * 2, true));
      }
    }
    const objType = dirBytes[base + 66];
    const startSec = dirDv.getUint32(base + 116, true);
    const size = dirDv.getUint32(base + 120, true);
    entries.push({ name, objType, startSec, size });
  }

  const wbEntry = entries.find(e => e.name === 'Workbook' || e.name === 'Book');
  if (!wbEntry) throw new Error('No Workbook stream in OLE2 file');

  const wb = followChain(wbEntry.startSec).slice(0, wbEntry.size);
  const wbDv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);

  const recs = [];
  let pos = 0;
  while (pos + 4 <= wb.length) {
    const rtype = wbDv.getUint16(pos, true);
    const rlen = wbDv.getUint16(pos + 2, true);
    recs.push({ type: rtype, data: wb.slice(pos + 4, pos + 4 + rlen) });
    pos += 4 + rlen;
  }

  const merged = [];
  for (const r of recs) {
    if (r.type === 0x003C && merged.length) {
      const prev = merged[merged.length - 1];
      const skip = prev.type === 0x00FC ? 1 : 0;
      const combined = new Uint8Array(prev.data.length + r.data.length - skip);
      combined.set(prev.data);
      combined.set(r.data.slice(skip), prev.data.length);
      prev.data = combined;
    } else {
      // Important: push a new object, not the original recs object.
      // Otherwise merging CONTINUE into SST mutates recs[sstStart].data,
      // then the SST parser reads the already-merged data plus CONTINUE again.
      // That truncates SST around index ~873 and later department values become blank.
      merged.push({ type: r.type, data: r.data });
    }
  }

  const sst = [];
  const sstStart = recs.findIndex(r => r.type === 0x00FC);

  if (sstStart >= 0) {
    const sstSegments = [recs[sstStart].data];
    for (let i = sstStart + 1; i < recs.length && recs[i].type === 0x003C; i++) {
      sstSegments.push(recs[i].data);
    }

    let seg = 0;
    let off = 0;

    function curData() {
      return sstSegments[seg] || null;
    }

    function nextSeg() {
      seg++;
      off = 0;
      return seg < sstSegments.length && !!curData();
    }

    function readByte() {
      let d = curData();
      while (seg < sstSegments.length && (!d || off >= d.length)) {
        if (!nextSeg()) return 0;
        d = curData();
      }
      if (!d || off >= d.length) return 0;
      return d[off++] ?? 0;
    }

    function readU16() {
      const b0 = readByte();
      const b1 = readByte();
      return b0 | (b1 << 8);
    }

    function readU32() {
      const b0 = readByte();
      const b1 = readByte();
      const b2 = readByte();
      const b3 = readByte();
      return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
    }

    function skipBytes(n) {
      for (let i = 0; i < n; i++) readByte();
    }

    function ensureTextBytes(currentWide) {
      const needed = currentWide ? 2 : 1;
      const d = curData();
      if (!d) return currentWide;
      if (seg < sstSegments.length && off + needed > d.length) {
        if (!nextSeg()) return currentWide;
        const flags = readByte();
        return !!(flags & 0x01);
      }
      return currentWide;
    }

    function readStringChars(charCount, wide) {
      let str = '';
      for (let j = 0; j < charCount; j++) {
        wide = ensureTextBytes(wide);
        if (wide) {
          const lo = readByte();
          const hi = readByte();
          str += String.fromCharCode(lo | (hi << 8));
        } else {
          str += String.fromCharCode(readByte());
        }
      }
      return str;
    }

    // SST header
    readU32(); // total strings
    const uniq = readU32();

    for (let i = 0; i < uniq && seg < sstSegments.length; i++) {
      const charCount = readU16();
      const flags = readByte();
      let wide = !!(flags & 0x01);
      const hasRich = !!(flags & 0x08);
      const hasPhon = !!(flags & 0x04);

      let richRuns = 0;
      let phonSize = 0;
      if (hasRich) richRuns = readU16();
      if (hasPhon) phonSize = readU32();

      const str = readStringChars(charCount, wide);

      if (hasRich) skipBytes(richRuns * 4);
      if (hasPhon) skipBytes(phonSize);

      sst.push(str);
    }
  }

  const sheets = [];
  let curSheet = null;
  let inSheet = false;

  for (const { type, data: d } of merged) {
    const dv2 = new DataView(d.buffer, d.byteOffset, d.byteLength);

    if (type === 0x0809) {
      const bofType = d.length >= 4 ? dv2.getUint16(2, true) : 0;
      if (bofType === 0x0010) {
        curSheet = { rows: {}, merges: [] };
        sheets.push(curSheet);
        inSheet = true;
      } else {
        inSheet = false;
      }
    } else if (type === 0x000A) {
      inSheet = false;
    }

    if (!inSheet || !curSheet) continue;

    if (type === 0x00E5) {
      // MERGEDCELLS: Jasper often stores Department/Store as merged cells.
      // Without expanding these ranges, later rows become blank and print as Unknown.
      const count = d.length >= 2 ? dv2.getUint16(0, true) : 0;
      for (let mi = 0; mi < count; mi++) {
        const off = 2 + mi * 8;
        if (off + 7 >= d.length) break;
        curSheet.merges.push({
          r1: dv2.getUint16(off, true),
          r2: dv2.getUint16(off + 2, true),
          c1: dv2.getUint16(off + 4, true),
          c2: dv2.getUint16(off + 6, true),
        });
      }
    } else if (type === 0x00FD) {
      const row = dv2.getUint16(0, true);
      const col = dv2.getUint16(2, true);
      const sstIdx = dv2.getUint32(6, true);
      setCell(curSheet.rows, row, col, sst[sstIdx] ?? '');
    } else if (type === 0x0203) {
      const row = dv2.getUint16(0, true);
      const col = dv2.getUint16(2, true);
      const val = dv2.getFloat64(6, true);
      setCell(curSheet.rows, row, col, formatNum(val));
    } else if (type === 0x0204) {
      // LABEL: some Jasper XLS cells are stored as inline strings, not LABELSST.
      const row = dv2.getUint16(0, true);
      const col = dv2.getUint16(2, true);
      const charCount = d.length >= 9 ? dv2.getUint16(6, true) : 0;
      const flags = d.length >= 9 ? d[8] : 0;
      const wide = !!(flags & 0x01);
      let p = 9;
      let str = '';
      if (wide) {
        for (let j = 0; j < charCount && p + 1 < d.length; j++, p += 2) {
          str += String.fromCharCode(dv2.getUint16(p, true));
        }
      } else {
        for (let j = 0; j < charCount && p < d.length; j++, p++) {
          str += String.fromCharCode(d[p]);
        }
      }
      setCell(curSheet.rows, row, col, str);
    } else if (type === 0x027E) {
      const row = dv2.getUint16(0, true);
      const col = dv2.getUint16(2, true);
      const rk = dv2.getUint32(6, true);
      let val;

      if (rk & 2) {
        val = (rk >> 2) / (rk & 1 ? 100 : 1);
      } else {
        const tmp = new DataView(new ArrayBuffer(8));
        tmp.setUint32(4, rk & 0xFFFFFFFC, true);
        val = tmp.getFloat64(0, true);
        if (rk & 1) val /= 100;
      }
      setCell(curSheet.rows, row, col, formatNum(val));
    } else if (type === 0x0201) {
      const row = dv2.getUint16(0, true);
      const col = dv2.getUint16(2, true);
      setCell(curSheet.rows, row, col, '');
    }
  }

  return sheets.map((sh, i) => {
    // Expand merged cells before converting to dense rows.
    // This fixes Jasper XLS where Department/Store values are merged over many item rows.
    (sh.merges || []).forEach(m => {
      // Only expand vertical merges. Horizontal title/header merges should not be copied
      // into every column because that breaks column detection.
      if (m.r2 <= m.r1) return;
      const topLeft = sh.rows[m.r1]?.[m.c1];
      if (topLeft === undefined || topLeft === null || topLeft === '') return;
      for (let rr = m.r1; rr <= m.r2; rr++) {
        if (!sh.rows[rr]) sh.rows[rr] = {};
        for (let cc = m.c1; cc <= m.c2; cc++) {
          if (sh.rows[rr][cc] === undefined || sh.rows[rr][cc] === null || sh.rows[rr][cc] === '') {
            sh.rows[rr][cc] = topLeft;
          }
        }
      }
    });

    const rowNums = Object.keys(sh.rows).map(Number).sort((a, b) => a - b);
    if (!rowNums.length) return null;
    const maxCol = Math.max(0, ...rowNums.map(r => {
      const cols = Object.keys(sh.rows[r] || {}).map(Number).filter(Number.isFinite);
      return cols.length ? Math.max(...cols) : 0;
    }));
    const rows = rowNums.map(r =>
      Array.from({ length: maxCol + 1 }, (_, c) => (sh.rows[r] || {})[c] ?? '')
    );
    return { name: `Sheet${i + 1}`, rows };
  }).filter(Boolean);
}

function setCell(rowMap, row, col, val) {
  if (!rowMap[row]) rowMap[row] = {};
  rowMap[row][col] = val;
}

function formatNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1e10) / 1e10);
}

function readXlsFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = ev => {
      try {
        const buf = ev?.target?.result;
        if (!buf || buf.byteLength < 4) {
          throw new Error('File is empty or cannot be read. Please download XLS again.');
        }
        const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
        const isOle2 = head[0] === 0xD0 && head[1] === 0xCF && head[2] === 0x11 && head[3] === 0xE0;
        const isZip = head[0] === 0x50 && head[1] === 0x4B;

        if (isZip) {
          reject(new Error('File is a binary .xlsx (ZIP format). Please re-download from Jasper as .xls.'));
          return;
        }

        if (isOle2) {
          resolve(parseBiff8(buf));
          return;
        }

        const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
        const tables = Array.from(doc.querySelectorAll('table'));

        if (!tables.length) {
          throw new Error('Unrecognised file format — expected OLE2 XLS or HTML-as-XLS.');
        }

        resolve(tables.map((tbl, idx) => ({
          name: `Sheet${idx + 1}`,
          rows: Array.from(tbl.querySelectorAll('tr'))
            .map(tr => Array.from(tr.querySelectorAll('td,th'))
              .flatMap(td => Array(parseInt(td.getAttribute('colspan') || '1', 10))
                .fill((td.innerText || td.textContent || '').trim())))
            .filter(r => r.some(c => c !== ''))
        })));
      } catch (e) {
        reject(e);
      }
    };

    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsArrayBuffer(file);
  });
}


function openPrintPage(type, data, meta = {}) {
  // HTML print mode for EXP/ADR reports.
  // Keep reportData as an array for backward compatibility with older report_print.js,
  // and add reportPrintPayload for the newer richer renderer.
  const rows = Array.isArray(data) ? data : (data?.rows || []);
  const payload = {
    type,
    meta: meta || {},
    rows,
    createdAt: new Date().toISOString(),
  };

  chrome.storage.local.set({ reportData: rows, reportPrintPayload: payload }, () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL(`report_print.html?type=${encodeURIComponent(type)}`)
    });
  });
}

function getJsPDF() {
  if (typeof window.jspdf !== 'undefined') return window.jspdf.jsPDF;
  if (typeof window.jsPDF !== 'undefined') return window.jsPDF;
  return null;
}

function loadJsPDF() {
  return new Promise((resolve, reject) => {
    const existing = getJsPDF();
    if (existing) {
      resolve(existing);
      return;
    }

    const src = chrome.runtime.getURL('cdnjs/jspdf.umd.min.js');
    const s = document.createElement('script');
    s.src = src;

    s.onload = () => {
      const j = getJsPDF();
      if (j) resolve(j);
      else reject(new Error('jsPDF loaded but not found on window'));
    };

    s.onerror = () => reject(new Error(`jsPDF file not found: ${src}`));
    document.head.appendChild(s);
  });
}

function initReport() {
  const toEl = document.getElementById('rpt-to');
  const fromEl = document.getElementById('rpt-from');

  if (toEl && fromEl) {
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    toEl.value = fmt(today);

    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 1);
    fromEl.value = fmt(d1);
  }

  document.getElementById('rpt-btn-genurl')?.addEventListener('click', () => {
    const from = document.getElementById('rpt-from').value;
    const to = document.getElementById('rpt-to').value;

    if (!from || !to) {
      rptStatus('⚠ Please select both From and To dates.', 'warn');
      return;
    }
    if (from > to) {
      rptStatus('⚠ From date must be before To date.', 'warn');
      return;
    }

    const url = buildRt257Url(from, to);
    const urlWrap = document.getElementById('rpt-url-wrap');
    const urlBox = document.getElementById('rpt-url-box');
    const dlBtn = document.getElementById('rpt-btn-dlxls');

    if (urlBox) urlBox.textContent = url;
    if (urlWrap) urlWrap.style.display = 'block';
    if (dlBtn) dlBtn.style.display = 'inline-flex';

    if (urlBox) {
      const newUrlBox = urlBox.cloneNode(true);
      urlBox.parentNode.replaceChild(newUrlBox, urlBox);
      newUrlBox.addEventListener('click', () => chrome.tabs.create({ url }));
    }
    if (dlBtn) {
      const newDlBtn = dlBtn.cloneNode(true);
      dlBtn.parentNode.replaceChild(newDlBtn, dlBtn);
      newDlBtn.addEventListener('click', () => chrome.tabs.create({ url }));
    }

    rptStatus(`✅ URL ready for ${from} → ${to}. Click the link to open & download XLS.`, 'ok');
  });

  document.getElementById('rpt-file-input')?.addEventListener('change', async function (ev) {
    const file = (ev?.target?.files && ev.target.files[0]) || (this?.files && this.files[0]);
    if (!file) return;
    rptStatus('⏳ Reading file…', 'loading');

    let sheets;
    try {
      sheets = await readXlsFile(file);
    } catch (e) {
      rptStatus('❌ ' + e.message, 'err');
      return;
    }

    try {
      rptSummaryRows = [];
      rptDetailRows = [];
      rptFromLabel = '';
      rptToLabel = '';

      sheets.forEach(({ rows: raw }) => {
        raw = Array.isArray(raw) ? raw.filter(Array.isArray) : [];
        if (!raw.length) return;
        let hdrIdx = -1;
        let hdrRow = [];

        for (let i = 0; i < Math.min(raw.length, 12); i++) {
          const r = raw[i].map(c => String(c).trim().toLowerCase());
          if (r.some(c => c === 'item code' || c === 'item name' || c === 'bed no.' || c === 'hn')) {
            hdrIdx = i;
            hdrRow = raw[i].map(c => String(c).trim());
            break;
          }
        }

        if (hdrIdx === -1) return;

        for (let i = 0; i < hdrIdx; i++) {
          const joined = raw[i].map(x => String(x || '')).join(' ');
          const m = joined.match(/from\s+(\S+).*?to\s+(\S+)/i);
          if (m) {
            rptFromLabel = m[1];
            rptToLabel = m[2];
          }
        }

        let currentWard = '';

        raw.slice(hdrIdx + 1).forEach(r => {
          const nonEmpty = r.filter(c => String(c).trim() !== '');
          if (nonEmpty.length === 0) return;

          if (nonEmpty.length === 1) {
            const label = String(nonEmpty[0] ?? '').trim();
            if (/^ward\s/i.test(label)) {
              currentWard = label;
            } else if (/^(ICU|CCU|NICU|LR)\b/i.test(label)) {
              currentWard = label.match(/^([A-Z]+)/i)[1].toUpperCase();
            } else {
              currentWard = '';
            }
            return;
          }

          const obj = { _ward: currentWard };
          hdrRow.forEach((h, i) => { obj[h] = String(r[i] ?? '').trim(); });

          if (!obj._ward) {
            const bed = obj['BED NO.'] || obj['BED NO'] || '';
            const bedMatch = bed.match(/^([A-Z]+)\d/i);
            if (bedMatch) {
              obj._ward = bedMatch[1].toUpperCase();
            } else if (/^\d{3}$/.test(bed)) {
              obj._ward = 'Ward ' + String(bed || '').charAt(0);
            }
          }

          rptDetailRows.push(obj);
        });
      });

      rptSummaryRows = buildSummaryFromDetail(rptDetailRows);
      renderRptPreview();

      const pdfBtns = document.getElementById('rpt-pdf-btns');
      if (pdfBtns) pdfBtns.style.display = 'flex';

      rptStatus(`✅ Parsed: ${rptDetailRows.length} detail rows · ${rptSummaryRows.length} summary items.`, 'ok');
    } catch (err) {
      console.error('[RT257 parse]', err);
      rptStatus('❌ Parse error: ' + err.message, 'err');
    }
  });

  document.getElementById('rpt-btn-pdf2')?.addEventListener('click', async () => {
    if (!rptDetailRows.length) {
      rptStatus('⚠ No data — load XLS first.', 'warn');
      return;
    }
    rptStatus('⏳ Building PDF Detail…', 'loading');
    try {
      const JsPDF = await loadJsPDF();
      buildPdfDetail(JsPDF);
    } catch (e) {
      rptStatus('❌ ' + e.message, 'err');
    }
  });

  document.getElementById('rpt-btn-pdf1')?.addEventListener('click', async () => {
    if (!rptSummaryRows.length) {
      rptStatus('⚠ No data — load XLS first.', 'warn');
      return;
    }
    rptStatus('⏳ Building PDF Summary…', 'loading');
    try {
      const JsPDF = await loadJsPDF();
      buildPdfSummary(JsPDF);
    } catch (e) {
      rptStatus('❌ ' + e.message, 'err');
    }
  });
}

function wardShortLabel(ward) {
  if (!ward) return 'No Room';
  const m = String(ward).match(/ward\s*(\d+)/i);
  if (m) return m[1];
  const up = String(ward).toUpperCase();
  if (up.includes('ICU')) return 'ICU';
  if (up.includes('CCU')) return 'CCU';
  if (up.includes('NICU')) return 'NICU';
  if (up.includes('LR')) return 'LR';
  return 'No Room';
}

function buildSummaryFromDetail(detailRows) {
  const map = new Map();

  detailRows.forEach(row => {
    const itemCode = row['ITEM CODE'] || row['Item Code'] || row['item code'] || '';
    const itemName = row['ITEM NAME'] || row['Item Name'] || row['item name'] || '';
    const qtyRaw = row['QTY'] || row['Qty'] || row['qty'] || '0';
    const ward = wardShortLabel(row._ward);
    const qty = Number(qtyRaw) || 0;

    if (!itemCode && !itemName) return;

    const key = `${itemCode}||${itemName}`;
    if (!map.has(key)) {
      const base = { itemCode, itemName, total: 0 };
      RT257_WARD_COLS.forEach(w => { base[w] = 0; });
      map.set(key, base);
    }

    const obj = map.get(key);
    obj[ward] = (obj[ward] || 0) + qty;
    obj.total += qty;
  });

  return Array.from(map.values()).sort((a, b) => {
    if (a.itemCode !== b.itemCode) return String(a.itemCode).localeCompare(String(b.itemCode));
    return String(a.itemName).localeCompare(String(b.itemName));
  });
}

function renderRptPreview() {
  const wrap = document.getElementById('rpt-preview');
  const box = document.getElementById('rpt-tbl-inner');
  if (!wrap || !box) return;

  wrap.style.display = 'block';

  const countEl = document.getElementById('rpt-preview-count');
  if (countEl) countEl.textContent = rptSummaryRows.length;

  const summaryHead = `
    <table class="rpt-table">
      <thead>
        <tr>
          <th>Item Code</th>
          <th>Item Name</th>
          ${RT257_WARD_COLS.map(w => `<th>${escHtml(w)}</th>`).join('')}
          <th>Total</th>
        </tr>
      </thead>
      <tbody>
        ${rptSummaryRows.slice(0, 30).map(r => `
          <tr>
            <td>${escHtml(r.itemCode)}</td>
            <td>${escHtml(r.itemName)}</td>
            ${RT257_WARD_COLS.map(w => `<td>${r[w] || ''}</td>`).join('')}
            <td>${r.total}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  const detailHead = `
    <table class="rpt-table" style="margin-top:12px">
      <thead>
        <tr>
          <th>Ward</th>
          <th>HN</th>
          <th>Bed</th>
          <th>Item Code</th>
          <th>Item Name</th>
          <th>Qty</th>
        </tr>
      </thead>
      <tbody>
        ${rptDetailRows.slice(0, 50).map(r => `
          <tr>
            <td>${escHtml(r._ward || '')}</td>
            <td>${escHtml(r['HN'] || '')}</td>
            <td>${escHtml(r['BED NO.'] || r['BED NO'] || '')}</td>
            <td>${escHtml(r['ITEM CODE'] || r['Item Code'] || '')}</td>
            <td>${escHtml(r['ITEM NAME'] || r['Item Name'] || '')}</td>
            <td>${escHtml(r['QTY'] || r['Qty'] || '')}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  box.innerHTML = `
    <div class="rpt-preview-title">Summary preview (${rptSummaryRows.length} items)</div>
    ${summaryHead}
    <div class="rpt-preview-title" style="margin-top:14px">Detail preview (${rptDetailRows.length} rows)</div>
    ${detailHead}`;
}

function buildPdfSummary(JsPDF) {
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' });
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 7;
  let y = 9;

  // Pending IP Fill Report must be A5 landscape.
  const wardW = RT257_WARD_COLS.length > 0 ? Math.max(7, Math.floor((196 - 24 - 66 - 12) / RT257_WARD_COLS.length)) : 8;
  const cols = [
    { key: 'itemCode', label: 'Item Code', w: 24 },
    { key: 'itemName', label: 'Item Name', w: 66 },
    ...RT257_WARD_COLS.map(w => ({ key: w, label: w, w: wardW })),
    { key: 'total', label: 'Total', w: 12 },
  ];

  function header() {
    doc.setFontSize(12);
    doc.text('Pending IP Fill Report — Summary', margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.text(`From ${rptFromLabel || '-'} To ${rptToLabel || '-'}`, margin, y);
    y += 6;

    let x = margin;
    doc.setFontSize(8);
    cols.forEach(c => {
      doc.rect(x, y, c.w, 7);
      doc.text(String(c.label), x + 1, y + 4.5, { maxWidth: c.w - 2 });
      x += c.w;
    });
    y += 7;
  }

  function rowBreakNeeded() {
    return y > pageH - margin - 7;
  }

  header();
  doc.setFontSize(7);

  rptSummaryRows.forEach(r => {
    if (rowBreakNeeded()) {
      doc.addPage();
      y = 10;
      header();
    }

    let x = margin;
    cols.forEach(c => {
      doc.rect(x, y, c.w, 6);
      const val = r[c.key] == null ? '' : String(r[c.key]);
      doc.text(val, x + 1, y + 4, { maxWidth: c.w - 2 });
      x += c.w;
    });
    y += 6;
  });

  doc.save(`Pending_IP_Fill_Summary_${Date.now()}.pdf`);
  rptStatus('✅ PDF Summary created.', 'ok');
}

function buildPdfDetail(JsPDF) {
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a5' });
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 7;
  let y = 9;

  // Pending IP Fill Report detail must be A5 landscape.
  const cols = [
    { key: '_ward', label: 'Ward', w: 24 },
    { key: 'HN', label: 'HN', w: 22 },
    { key: 'BED NO.', label: 'Bed', w: 14 },
    { key: 'ITEM CODE', label: 'Item Code', w: 25 },
    { key: 'ITEM NAME', label: 'Item Name', w: 96 },
    { key: 'QTY', label: 'Qty', w: 12 },
  ];

  function header() {
    doc.setFontSize(12);
    doc.text('Pending IP Fill Report — Detail', margin, y);
    y += 6;
    doc.setFontSize(9);
    doc.text(`From ${rptFromLabel || '-'} To ${rptToLabel || '-'}`, margin, y);
    y += 6;

    let x = margin;
    doc.setFontSize(8);
    cols.forEach(c => {
      doc.rect(x, y, c.w, 7);
      doc.text(String(c.label), x + 1, y + 4.5, { maxWidth: c.w - 2 });
      x += c.w;
    });
    y += 7;
  }

  function rowBreakNeeded() {
    return y > pageH - margin - 7;
  }

  header();
  doc.setFontSize(7);

  rptDetailRows.forEach(r => {
    if (rowBreakNeeded()) {
      doc.addPage();
      y = 10;
      header();
    }

    let x = margin;
    cols.forEach(c => {
      doc.rect(x, y, c.w, 6);
      let val = '';

      if (c.key === 'BED NO.') {
        val = r['BED NO.'] || r['BED NO'] || '';
      } else if (c.key === 'ITEM CODE') {
        val = r['ITEM CODE'] || r['Item Code'] || '';
      } else if (c.key === 'ITEM NAME') {
        val = r['ITEM NAME'] || r['Item Name'] || '';
      } else if (c.key === 'QTY') {
        val = r['QTY'] || r['Qty'] || '';
      } else {
        val = r[c.key] || '';
      }

      doc.text(String(val), x + 1, y + 4, { maxWidth: c.w - 2 });
      x += c.w;
    });
    y += 6;
  });

  doc.save(`Pending_IP_Fill_Detail_${Date.now()}.pdf`);
  rptStatus('✅ PDF Detail created.', 'ok');
}

function initReportToggles() {
  document.querySelectorAll('[data-toggle-target]').forEach(btn => {
    const id = btn.getAttribute('data-toggle-target');
    const panel = document.getElementById(id);
    if (!panel) return;

    const applyState = (expanded) => {
      panel.classList.toggle('is-hidden', !expanded);
      panel.style.display = expanded ? 'block' : 'none';
      btn.textContent = expanded ? 'Hide details' : 'Show details';
      btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    };

    applyState(false);

    btn.addEventListener('click', () => {
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      applyState(!expanded);
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// RT_COMMON_917 — Stock Picking List Report
// ──────────────────────────────────────────────────────────────────────────────
const STK917_BASE = 'https://aa-report.bdms.co.th/jasperserver/flow.html';
const STK917_FIXED = {
  _flowId: 'viewReportFlow',
  output: 'xls',
  reportUnit: '/BDMS/Other/RT_COMMON_917',
  userTimezone: 'Asia/bangkok',
  decorate: 'no',
  departmentuids: '5b857e32136d276403482bbf,5b857e32136d276403482bc7',
  careprovideruids: '',
  selectedorganisationuid: '5b20f438d1202e29ce16f710',
  loginuid: '5bb325cb3e4efabebd8ea549',
  logindepartmentuid: '5b857e32136d276403482bca',
  organisationuid: '5b20f438d1202e29ce16f710',
  userLocale: 'en',
  isduplicate: 'false',
  pp: 'u=5bb325cb3e4efabebd8ea549&r=5b83f09c3238d86bf0d583c7&o=569794170946a3d0d588efe6',
};

const STK917_TARGET_CODES = new Set([
  '51191602000030',
  '51191605000003',
  '51102713000021',
  '51102710000005',
  '51102714000004',
]);

let stk917Rows = [];
let stk917Meta = {
  from: '',
  to: '',
  title: 'Stock Picking List',
};

function rpt917Status(msg, type = '') {
  const el = document.getElementById('stk917-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'rpt-status ' + type;
}

function buildStk917Url(fromDate, toDate) {
  const params = Object.assign({}, STK917_FIXED, {
    fromdate: fromDate + 'T08:00:00.000Z',
    todate: toDate + 'T07:59:59.999Z',
  });

  const rawEncode = v => String(v).replace(/%/g, '%25').replace(/ /g, '%20');
  const qs = Object.entries(params).map(([k, v]) => `${k}=${rawEncode(v)}`).join('&');
  return `${STK917_BASE}?${qs}`;
}

function initStockPickingReport() {
  const toEl = document.getElementById('stk917-to');
  const fromEl = document.getElementById('stk917-from');

  if (toEl && fromEl) {
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    toEl.value = fmt(today);

    const d1 = new Date(today);
    d1.setDate(d1.getDate() - 1);
    fromEl.value = fmt(d1);
  }

  document.getElementById('stk917-btn-genurl')?.addEventListener('click', () => {
    const from = document.getElementById('stk917-from').value;
    const to = document.getElementById('stk917-to').value;

    if (!from || !to) {
      rpt917Status('⚠ Please select both From and To dates.', 'warn');
      return;
    }
    if (from > to) {
      rpt917Status('⚠ From date must be before To date.', 'warn');
      return;
    }

    const url = buildStk917Url(from, to);
    const wrap = document.getElementById('stk917-url-wrap');
    const box = document.getElementById('stk917-url-box');
    const openBtn = document.getElementById('stk917-btn-dlxls');

    if (box) box.textContent = url;
    if (wrap) wrap.style.display = 'block';
    if (openBtn) openBtn.style.display = 'inline-flex';

    if (box) {
      const nb = box.cloneNode(true);
      box.parentNode.replaceChild(nb, box);
      nb.addEventListener('click', () => chrome.tabs.create({ url }));
    }
    if (openBtn) {
      const nb = openBtn.cloneNode(true);
      openBtn.parentNode.replaceChild(nb, openBtn);
      nb.addEventListener('click', () => chrome.tabs.create({ url }));
    }

    rpt917Status(`✅ URL ready for ${from} → ${to}. Click to open/download XLS.`, 'ok');
  });

  document.getElementById('stk917-file-input')?.addEventListener('change', async function (ev) {
    const file = (ev?.target?.files && ev.target.files[0]) || (this?.files && this.files[0]);
    if (!file) return;

    rpt917Status('⏳ Reading file…', 'loading');

    let sheets;
    try {
      sheets = await readXlsFile(file);
    } catch (e) {
      rpt917Status('❌ ' + e.message, 'err');
      return;
    }

    try {
      stk917Rows = parseStockPickingSheets(sheets);
      renderStockPickingPreview();
      const btns = document.getElementById('stk917-pdf-btns');
      if (btns) btns.style.display = 'flex';
      rpt917Status(`✅ Parsed ${stk917Rows.length} rows (filtered target codes, qty > 0).`, 'ok');
    } catch (e) {
      console.error('[RT917 parse]', e);
      rpt917Status('❌ Parse error: ' + e.message, 'err');
    }
  });

  document.getElementById('stk917-btn-pdf')?.addEventListener('click', async () => {
    if (!stk917Rows.length) {
      rpt917Status('⚠ No data — load XLS first.', 'warn');
      return;
    }
    rpt917Status('⏳ Building sticker PDF…', 'loading');
    try {
      const JsPDF = await loadJsPDF();
      buildStockPickingPdfDetail(JsPDF);
    } catch (e) {
      rpt917Status('❌ ' + e.message, 'err');
    }
  });
}

function extractDateRange(joined) {
  const m = joined.match(/Date\s+From\s+(\S+\s+\S+)\s+To\s+(\S+\s+\S+)/i);
  if (!m) return null;
  return { from: m[1], to: m[2] };
}

function parseStockPickingSheets(sheets) {
  const out = [];
  stk917Meta = { from: '', to: '', title: 'Stock Picking List' };

  sheets.forEach(({ rows }) => {
    rows = Array.isArray(rows) ? rows.filter(Array.isArray) : [];
    if (!rows.length) return;

    let headerIdx = -1;
    let COL = { code: 0, name: 1, bin: 2, qty: 3, dept: 5, store: 6 };

    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const r = rows[i].map(v => normalizeWhitespace(String(v || '')).toLowerCase());
      if (r.some(c => c === 'code')) {
        headerIdx = i;
        r.forEach((h, idx) => {
          if (h === 'code') COL.code = idx;
          else if (h === 'name') COL.name = idx;
          else if (h === 'bin') COL.bin = idx;
          else if (h === 'qty') COL.qty = idx;
          else if (h === 'department' || h === 'dept') COL.dept = idx;
          else if (h === 'store') COL.store = idx;
        });
        break;
      }
    }

    const scanTo = headerIdx >= 0 ? headerIdx : Math.min(rows.length, 5);
    for (let i = 0; i < scanTo; i++) {
      const joined = rows[i].map(v => normalizeWhitespace(String(v || ''))).join(' ');
      if (/summary picking list/i.test(joined)) {
        stk917Meta.title = joined;
      }
      const dr = extractDateRange(joined);
      if (dr) {
        stk917Meta.from = dr.from;
        stk917Meta.to = dr.to;
      }
    }

    if (headerIdx < 0) return;

    let lastDepartment = '';
    let lastStore = '';

    rows.slice(headerIdx + 1).forEach(r => {
      const code = normalizeWhitespace(r[COL.code]);
      const name = normalizeWhitespace(r[COL.name]);
      const storeBin = normalizeWhitespace(r[COL.bin]);
      const qtyRaw = normalizeWhitespace(r[COL.qty]);

      const rawDepartment = normalizeWhitespace(r[COL.dept]);
      const rawStore = normalizeWhitespace(r[COL.store]);
      if (rawDepartment) lastDepartment = rawDepartment;
      if (rawStore) lastStore = rawStore;

      const department = rawDepartment || lastDepartment;
      const store = rawStore || lastStore;

      if (!code || !name) return;
      if (!STK917_TARGET_CODES.has(code)) return;

      const qty = Number(qtyRaw || 0);
      if (!(qty > 0)) return;

      out.push({
        itemCode: code,
        itemName: name,
        storeBin,
        qty: String(qty),
        department: department || 'Unknown',
        store: store || 'Outpatient Pharmacy',
      });
    });
  });

  return out.sort((a, b) => {
    if (a.store !== b.store) return a.store.localeCompare(b.store);
    if (a.department !== b.department) return a.department.localeCompare(b.department);
    return a.itemCode.localeCompare(b.itemCode);
  });
}

function renderStockPickingPreview() {
  const wrap = document.getElementById('stk917-preview');
  const box = document.getElementById('stk917-tbl-inner');
  const countEl = document.getElementById('stk917-preview-count');

  if (!wrap || !box) return;

  wrap.style.display = 'block';
  if (countEl) countEl.textContent = stk917Rows.length;

  box.innerHTML = `
    <table class="rpt-table">
      <thead>
        <tr>
          <th>Store</th>
          <th>Department</th>
          <th>Item Code</th>
          <th>Item Name</th>
          <th>Store Bin</th>
          <th>Qty</th>
        </tr>
      </thead>
      <tbody>
        ${stk917Rows.slice(0, 100).map(r => `
          <tr>
            <td>${escHtml(r.store)}</td>
            <td>${escHtml(r.department)}</td>
            <td>${escHtml(r.itemCode)}</td>
            <td>${escHtml(r.itemName)}</td>
            <td>${escHtml(r.storeBin)}</td>
            <td>${escHtml(r.qty)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function buildStockPickingPdfDetail(JsPDF) {
  // Stock Picking PDF pattern:
  // - real label paper size 80 × 35 mm (landscape)
  // - one page per Store + Department group; if >5 lines, split to next page
  // - layout follows uploaded reference: dark title bar, dept bar, table header, footer
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: [80, 35] });
  const pageW = doc.internal.pageSize.getWidth();   // 80 mm
  const pageH = doc.internal.pageSize.getHeight();  // 35 mm

  const STORE_ORDER = ['Outpatient Pharmacy', 'Inpatient Pharmacy', 'Pharmacy Floor 2'];
  const MAX_LINES_PER_PAGE = 5;

  // Visual font scale for 80×35 mm stock picking sticker.
  // User requested +50% font size without changing paper size/page formation.
  const STK_FONT_SCALE = 1.5;
  const STK_FONT = {
    title: 4.2 * STK_FONT_SCALE,
    store: 3.8 * STK_FONT_SCALE,
    date: 3.8 * STK_FONT_SCALE,
    dept: 3.8 * STK_FONT_SCALE,
    tableHead: 3.5 * STK_FONT_SCALE,
    item: 3.45 * STK_FONT_SCALE,
    footer: 3.4 * STK_FONT_SCALE,
  };

  function setTightTextMode(enable = true) {
    // Slightly condense text horizontally so +50% font can still stay in the same label layout.
    if (typeof doc.setCharSpace === 'function') doc.setCharSpace(enable ? -0.08 : 0);
  }

  function cleanPdfText(v) {
    return String(v ?? '')
      // Remove Jasper/control characters that make PDF text spacing weird.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      .replace(/\uFFFD/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function fmtPrintedDate(d = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  }

  function compactDateRange(from, to) {
    if (!from || !to) return '';
    const mF = String(from).match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
    const mT = String(to).match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
    if (!mF || !mT) return `${from}-${to}`;

    let [, dF, moF, yF] = mF;
    let [, dT, moT, yT] = mT;
    yF = yF.length === 4 ? yF.slice(-2) : yF;
    yT = yT.length === 4 ? yT.slice(-2) : yT;

    if (moF === moT && yF === yT) return `${dF}-${dT}/${moF}/${yF}`;
    if (yF === yT) return `${dF}/${moF}-${dT}/${moT}/${yF}`;
    return `${dF}/${moF}/${yF}-${dT}/${moT}/${yT}`;
  }

  function fitText(text, maxW, fontSize, fontStyle = 'normal') {
    doc.setFont('helvetica', fontStyle);
    doc.setFontSize(fontSize);
    const t = cleanPdfText(text);
    if (doc.getTextWidth(t) <= maxW) return t;
    let out = t;
    while (out.length > 0 && doc.getTextWidth(out + '…') > maxW) out = out.slice(0, -1);
    return out ? out + '…' : '';
  }

  // Group rows by Store + Department, and merge duplicated items within that group.
  const depMap = new Map();
  stk917Rows.forEach(r => {
    const store = cleanPdfText(r.store) || 'Outpatient Pharmacy';
    const department = cleanPdfText(r.department) || 'Unknown';
    const groupKey = `${store}||${department}`;
    if (!depMap.has(groupKey)) depMap.set(groupKey, { store, department, rows: new Map() });

    const itemCode = cleanPdfText(r.itemCode);
    const itemName = cleanPdfText(r.itemName);
    const storeBin = cleanPdfText(r.storeBin);
    const qty = Number(cleanPdfText(r.qty)) || 0;
    if (!itemCode || !itemName || !(qty > 0)) return;

    const rowKey = `${itemCode}||${itemName}||${storeBin}`;
    const group = depMap.get(groupKey);
    if (!group.rows.has(rowKey)) {
      group.rows.set(rowKey, { itemCode, itemName, storeBin, qty: 0 });
    }
    group.rows.get(rowKey).qty += qty;
  });

  const groups = [...depMap.values()].map(g => ({
    store: g.store,
    department: g.department,
    rows: [...g.rows.values()].sort((a, b) => {
      if (a.storeBin !== b.storeBin) return a.storeBin.localeCompare(b.storeBin);
      return a.itemCode.localeCompare(b.itemCode);
    })
  })).sort((a, b) => {
    const ia = STORE_ORDER.indexOf(a.store);
    const ib = STORE_ORDER.indexOf(b.store);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
      || a.store.localeCompare(b.store)
      || a.department.localeCompare(b.department);
  });

  const pages = [];
  groups.forEach(g => {
    for (let i = 0; i < g.rows.length; i += MAX_LINES_PER_PAGE) {
      pages.push({
        store: g.store,
        department: g.department,
        rows: g.rows.slice(i, i + MAX_LINES_PER_PAGE)
      });
    }
  });

  if (!pages.length) {
    rpt917Status('⚠ No rows with qty > 0 to print.', 'warn');
    return;
  }

  const dateLabel = compactDateRange(stk917Meta.from, stk917Meta.to);
  const printedDate = fmtPrintedDate();

  function drawPage(page, pageNo, totalPages) {
    // Thermal-friendly style:
    // - white background only, no gray fills
    // - black text + black borderlines for sharper thermal output
    // - Code column is +10 mm wider; Item Name column is -10 mm; Bin/Qty unchanged
    const COL_X = { code: 1.2, item: 25.0, bin: 60.0, qtyRight: pageW - 1.2 };
    const COL_W = { code: 22.5, item: 32.0, bin: 12.5 };

    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, pageW, pageH, 'F');
    doc.setDrawColor(0, 0, 0);
    doc.setTextColor(0, 0, 0);
    doc.setLineWidth(0.18);

    // Outer border and section lines
    doc.rect(0.4, 0.4, pageW - 0.8, pageH - 0.8, 'S');
    doc.line(0.4, 6.2, pageW - 0.4, 6.2);
    doc.line(0.4, 11.2, pageW - 0.4, 11.2);
    doc.line(0.4, 16.0, pageW - 0.4, 16.0);
    doc.line(0.4, pageH - 4.6, pageW - 0.4, pageH - 4.6);

    doc.setFont('helvetica', 'bold');
    setTightTextMode(true);
    doc.setFontSize(STK_FONT.title);
    doc.text('Stock Picking List', 1.2, 4.5);

    doc.setFontSize(STK_FONT.store);
    doc.text(fitText(page.store, 24, STK_FONT.store, 'bold'), pageW / 2, 4.5, { align: 'center' });

    doc.setFontSize(STK_FONT.date);
    doc.text(dateLabel || '-', pageW - 1.2, 4.5, { align: 'right' });

    // Dept row
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(STK_FONT.dept);
    doc.text('Dept:', 1.2, 9.8);
    doc.text(fitText(page.department, 58, STK_FONT.dept, 'bold'), 12.0, 9.8);

    // Table header row
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(STK_FONT.tableHead);
    doc.text('Code', COL_X.code, 14.7);
    doc.text('Item Name', COL_X.item, 14.7);
    doc.text('Bin', COL_X.bin, 14.7);
    doc.text('Qty', COL_X.qtyRight, 14.7, { align: 'right' });

    // Item rows
    const rowY0 = 18.2;
    const rowGap = 3.05;
    page.rows.forEach((r, idx) => {
      const y = rowY0 + (idx * rowGap);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(STK_FONT.item);
      doc.text(fitText(r.itemCode, COL_W.code, STK_FONT.item, 'bold'), COL_X.code, y);
      doc.text(fitText(r.itemName, COL_W.item, STK_FONT.item, 'bold'), COL_X.item, y);
      doc.text(fitText(r.storeBin || '-', COL_W.bin, STK_FONT.item, 'bold'), COL_X.bin, y);
      doc.text(String(r.qty), COL_X.qtyRight, y, { align: 'right' });
    });

    // Footer
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(STK_FONT.footer);
    doc.text(`Printed ${printedDate}`, 1.2, pageH - 1.5);
    doc.text(`${pageNo} / ${totalPages}`, pageW - 1.2, pageH - 1.5, { align: 'right' });
    setTightTextMode(false);
  }

  pages.forEach((page, idx) => {
    if (idx > 0) doc.addPage([80, 35], 'landscape');
    drawPage(page, idx + 1, pages.length);
  });

  doc.save(`Stock_Picking_List_${Date.now()}.pdf`);
  rpt917Status('✅ Stock Picking PDF created (80×35 mm, 5 rows/page, font +50%, black-line thermal style).', 'ok');
}



// ──────────────────────────────────────────────────────────────────────────────
// RT_COMMON_256 — ADR Report
// ──────────────────────────────────────────────────────────────────────────────
const ADR256_BASE = 'https://aa-report.bdms.co.th/jasperserver/flow.html';
const ADR256_FIXED = {
  _flowId: 'viewReportFlow',
  output: 'xls',
  reportUnit: '/BDMS/Other/RT_COMMON_256',
  userTimezone: 'Asia/bangkok',
  decorate: 'no',
  selectedorganisationuid: '5b20f438d1202e29ce16f710',
  loginuid: '5bb325cb3e4efabebd8ea549',
  logindepartmentuid: '5ee83dd361de5822deed220d',
  organisationuid: '5b20f438d1202e29ce16f710',
  userLocale: 'th',
  isduplicate: 'false',
  pp: 'u=5bb325cb3e4efabebd8ea549&r=5b83f09c3238d86bf0d583c7&o=569794170946a3d0d588efe6',
};

let adr256Rows = [];
let adr256Meta = { from: '', to: '', title: 'ADR report' };

function adr256Status(msg, type = '') {
  const el = document.getElementById('adr256-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'rpt-status ' + type;
}

function buildAdr256Url(fromDate, toDate) {
  const params = Object.assign({}, ADR256_FIXED, {
    fromdate: bkkDayStart(fromDate),
    todate: bkkDayEnd(toDate),
  });
  const rawEncode = v => String(v).replace(/%/g, '%25').replace(/ /g, '%20').replace(/\//g, '%2F');
  const qs = Object.entries(params).map(([k, v]) => `${k}=${rawEncode(v)}`).join('&');
  return `${ADR256_BASE}?${qs}`;
}

function initAdrReport() {
  const fromEl = document.getElementById('adr256-from');
  const toEl = document.getElementById('adr256-to');

  if (fromEl && toEl) {
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    fromEl.value = fmt(first);
    toEl.value = fmt(today);
  }

  document.getElementById('adr256-btn-genurl')?.addEventListener('click', () => {
    const from = fromEl?.value || '';
    const to = toEl?.value || '';

    if (!from || !to) {
      adr256Status('⚠ Please select both Start date and End date.', 'warn');
      return;
    }
    if (from > to) {
      adr256Status('⚠ Start date must be before End date.', 'warn');
      return;
    }

    const url = buildAdr256Url(from, to);
    const wrap = document.getElementById('adr256-url-wrap');
    const box = document.getElementById('adr256-url-box');
    const openBtn = document.getElementById('adr256-btn-dlxls');

    if (box) box.textContent = url;
    if (wrap) wrap.style.display = 'block';
    if (openBtn) openBtn.style.display = 'inline-flex';

    if (box) {
      const nb = box.cloneNode(true);
      box.parentNode.replaceChild(nb, box);
      nb.addEventListener('click', () => chrome.tabs.create({ url }));
    }
    if (openBtn) {
      const nb = openBtn.cloneNode(true);
      openBtn.parentNode.replaceChild(nb, openBtn);
      nb.addEventListener('click', () => chrome.tabs.create({ url }));
    }

    adr256Meta.from = from;
    adr256Meta.to = to;
    adr256Status(`✅ URL ready for ${from} → ${to}. Click to open/download XLS.`, 'ok');
  });

  document.getElementById('adr256-file-input')?.addEventListener('change', async function (ev) {
    const file = (ev?.target?.files && ev.target.files[0]) || (this?.files && this.files[0]);
    if (!file) return;

    adr256Status('⏳ Reading ADR XLS file…', 'loading');
    let sheets;
    try {
      sheets = await readXlsFile(file);
    } catch (e) {
      adr256Status('❌ ' + e.message, 'err');
      return;
    }

    try {
      adr256Rows = parseAdr256Sheets(sheets);
      renderAdr256Preview();
      const btns = document.getElementById('adr256-pdf-btns');
      if (btns) btns.style.display = adr256Rows.length ? 'flex' : 'none';
      adr256Status(`✅ Parsed ${adr256Rows.length} ADR rows.`, adr256Rows.length ? 'ok' : 'warn');
    } catch (e) {
      console.error('[RT256 parse]', e);
      adr256Status('❌ Parse error: ' + e.message, 'err');
    }
  });

  document.getElementById('adr256-btn-pdf')?.addEventListener('click', () => {
    if (!adr256Rows.length) {
      adr256Status('⚠ No data — load ADR XLS first.', 'warn');
      return;
    }

    const groups = adr256Groups();
    const from = adr256Meta.from || fromEl?.value || '';
    const to = adr256Meta.to || toEl?.value || '';

    adr256Status('⏳ Opening ADR print page…', 'loading');
    openPrintPage('adr', adr256Rows, {
      title: 'ADR report',
      reportUnit: 'RT_COMMON_256',
      from,
      to,
      total: adr256Rows.length,
      observeY: groups.Y.length,
      observeN: groups.N.length,
      splitBy: 'Observe in visite',
    });
    adr256Status('✅ ADR print page opened. Use Print / Save PDF in the control panel.', 'ok');
  });
}

function findAdrHeaderIndex(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i].map(v => normalizeWhitespace(v).toLowerCase());
    const hasObserve = r.some(h => h.includes('observe') || h.includes('onserve'));
    const hasAdrCols = r.some(h => h === 'hn') && r.some(h => h.includes('allergy'));
    if (hasObserve && hasAdrCols) return i;
  }
  return -1;
}

function adrHeaderMap(headers) {
  const col = { hn: -1, patient: -1, desc: -1, eventType: -1, allergicTo: -1, type: -1, status: -1, observe: -1, createDate: -1 };
  headers.forEach((raw, idx) => {
    const h = normalizeWhitespace(raw).toLowerCase();
    if (h === 'hn') col.hn = idx;
    else if (h.includes('patient')) col.patient = idx;
    else if (h.includes('allergy description')) col.desc = idx;
    else if (h.includes('event type')) col.eventType = idx;
    else if (h.includes('allergic to')) col.allergicTo = idx;
    else if (h === 'type') col.type = idx;
    else if (h === 'status') col.status = idx;
    else if (h.includes('observe') || h.includes('onserve')) col.observe = idx;
    else if (h.includes('create date')) col.createDate = idx;
  });
  return col;
}

function normalizeAdrObserve(value) {
  const s = normalizeWhitespace(value).toUpperCase();
  if (s.startsWith('Y')) return 'Y';
  if (s.startsWith('N')) return 'N';
  return s || 'Blank';
}

function parseAdr256Sheets(sheets) {
  const out = [];
  adr256Meta = { from: '', to: '', title: 'PatientAllergy List By Date' };

  sheets.forEach(({ rows }) => {
    rows = Array.isArray(rows) ? rows.filter(Array.isArray) : [];
    if (!rows.length) return;

    rows.slice(0, 12).forEach(r => {
      const joined = r.map(x => normalizeWhitespace(x)).filter(Boolean).join(' ');
      if (/PatientAllergy|Allergy\s+List|ADR/i.test(joined)) adr256Meta.title = joined;
      const m = joined.match(/From\s+Date\s*:\s*(\S+)\s+To\s+(\S+)/i);
      if (m) {
        adr256Meta.from = m[1];
        adr256Meta.to = m[2];
      }
    });

    const headerIdx = findAdrHeaderIndex(rows);
    if (headerIdx < 0) return;
    const headers = rows[headerIdx].map(v => cleanExp174Text(v));
    const col = adrHeaderMap(headers);

    rows.slice(headerIdx + 1).forEach(r => {
      const nonEmpty = r.map(v => cleanExp174Text(v)).filter(Boolean);
      if (!nonEmpty.length) return;

      const hn = col.hn >= 0 ? cleanExp174Text(r[col.hn]) : '';
      const patient = col.patient >= 0 ? cleanExp174Text(r[col.patient]) : '';
      const allergicTo = col.allergicTo >= 0 ? cleanExp174Text(r[col.allergicTo], { name: true }) : '';
      const desc = col.desc >= 0 ? cleanExp174Text(r[col.desc], { name: true }) : '';
      if (!hn && !patient && !allergicTo && !desc) return;

      out.push({
        no: out.length + 1,
        hn,
        patient,
        desc,
        eventType: col.eventType >= 0 ? cleanExp174Text(r[col.eventType]) : '',
        allergicTo,
        type: col.type >= 0 ? cleanExp174Text(r[col.type]) : '',
        status: col.status >= 0 ? cleanExp174Text(r[col.status]) : '',
        observe: normalizeAdrObserve(col.observe >= 0 ? r[col.observe] : ''),
        createDate: col.createDate >= 0 ? cleanExp174Text(r[col.createDate]) : '',
      });
    });
  });

  out.sort((a, b) => {
    const oa = a.observe === 'Y' ? 0 : a.observe === 'N' ? 1 : 2;
    const ob = b.observe === 'Y' ? 0 : b.observe === 'N' ? 1 : 2;
    return oa - ob || String(a.createDate).localeCompare(String(b.createDate)) || String(a.hn).localeCompare(String(b.hn));
  });
  out.forEach((r, i) => { r.no = i + 1; });
  return out;
}

function adr256Groups() {
  return {
    Y: adr256Rows.filter(r => r.observe === 'Y'),
    N: adr256Rows.filter(r => r.observe !== 'Y'),
  };
}

function renderAdr256Preview() {
  const wrap = document.getElementById('adr256-preview');
  const box = document.getElementById('adr256-tbl-inner');
  if (!wrap || !box) return;

  const groups = adr256Groups();
  wrap.style.display = 'block';
  const countEl = document.getElementById('adr256-preview-count');
  if (countEl) countEl.textContent = adr256Rows.length;

  const tableHtml = (title, rows) => `
    <div class="rpt-preview-title" style="margin-top:10px">${title} (${rows.length})</div>
    <table class="rpt-table">
      <thead>
        <tr>
          <th>No.</th><th>HN</th><th>Patient Name</th><th>Allergy Description</th>
          <th>Allergic To</th><th>Type</th><th>Status</th><th>Create Date</th>
        </tr>
      </thead>
      <tbody>
        ${rows.slice(0, 50).map(r => `
          <tr>
            <td>${escHtml(r.no)}</td>
            <td>${escHtml(r.hn)}</td>
            <td>${escHtml(r.patient)}</td>
            <td>${escHtml(r.desc)}</td>
            <td>${escHtml(r.allergicTo)}</td>
            <td>${escHtml(r.type)}</td>
            <td>${escHtml(r.status)}</td>
            <td>${escHtml(r.createDate)}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;

  box.innerHTML = `
    ${tableHtml('Observe in visit = Y', groups.Y)}
    ${tableHtml('Observe in visit = N / blank', groups.N)}`;
}

async function buildAdr256Pdf(JsPDF) {
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
  const pageWmm = 210;
  const pageHmm = 297;
  const scale = 6;
  const pageWpx = Math.round(pageWmm * scale);
  const pageHpx = Math.round(pageHmm * scale);
  const margin = 8;
  const fontFamily = 'Tahoma, "Leelawadee UI", "Noto Sans Thai", "Sarabun", Arial, sans-serif';
  const groups = adr256Groups();
  const metaFrom = adr256Meta.from || document.getElementById('adr256-from')?.value || '';
  const metaTo = adr256Meta.to || document.getElementById('adr256-to')?.value || '';

  const cols = [
    { label: 'No.', w: 9, getter: r => r.no },
    { label: 'HN', w: 23, getter: r => r.hn },
    { label: 'Patient Name', w: 35, getter: r => r.patient },
    { label: 'Allergy Description', w: 40, getter: r => r.desc },
    { label: 'Allergic To', w: 38, getter: r => r.allergicTo },
    { label: 'Type', w: 15, getter: r => r.type },
    { label: 'Status', w: 15, getter: r => r.status },
    { label: 'Create Date', w: 19, getter: r => r.createDate },
  ];

  const mm = v => Math.round(v * scale);
  const pxFont = pt => Math.max(5, Math.round(pt * scale * 0.56));

  function makePageCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = pageWpx;
    canvas.height = pageHpx;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    ctx.lineWidth = Math.max(1, Math.round(0.18 * scale));
    ctx.textBaseline = 'alphabetic';
    ctx.imageSmoothingEnabled = false;
    return { canvas, ctx };
  }

  function setFont(ctx, pt, weight = '400') {
    ctx.font = `${weight} ${pxFont(pt)}px ${fontFamily}`;
  }

  function cleanAdrPdfText(text) {
    return cleanExp174Text(text, { name: true });
  }

  function drawText(ctx, text, xMm, yMm, maxWMm, pt = 5.7, weight = '400', align = 'left') {
    let s = cleanAdrPdfText(text);
    const maxW = mm(maxWMm || 999);
    setFont(ctx, pt, weight);
    if (ctx.measureText(s).width > maxW) {
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      s = s + '…';
    }
    ctx.textAlign = align;
    ctx.fillText(s, mm(xMm), mm(yMm));
  }

  function drawPageHeader(ctx, pageNo) {
    setFont(ctx, 11.5, '600');
    ctx.textAlign = 'left';
    ctx.fillText('ADR report', mm(margin), mm(10));
    setFont(ctx, 7.2, '400');
    ctx.fillText(`RT_COMMON_256 · ${metaFrom || '-'} to ${metaTo || '-'}`, mm(margin), mm(16));
    ctx.textAlign = 'right';
    ctx.fillText(`Page ${pageNo}`, mm(pageWmm - margin), mm(10));
    return 22;
  }

  function drawTableHeader(ctx, y, groupTitle, count) {
    setFont(ctx, 7.5, '600');
    ctx.textAlign = 'left';
    ctx.fillText(`${groupTitle} (${count})`, mm(margin), mm(y));
    y += 3.2;
    let x = margin;
    setFont(ctx, 5.9, '600');
    cols.forEach(c => {
      ctx.strokeRect(mm(x), mm(y), mm(c.w), mm(6));
      ctx.fillText(c.label, mm(x + 0.8), mm(y + 4.0));
      x += c.w;
    });
    return y + 6;
  }

  function drawFooter(ctx) {
    setFont(ctx, 6.4, '400');
    ctx.textAlign = 'left';
    ctx.fillText('Pharmacist: ........................................', mm(margin), mm(pageHmm - 9));
    ctx.textAlign = 'right';
    ctx.fillText('Date: ................................', mm(pageWmm - margin), mm(pageHmm - 9));
  }

  let pageNo = 1;
  let current = makePageCanvas();
  let y = drawPageHeader(current.ctx, pageNo);
  const rowH = 5.5;
  const bottomLimit = pageHmm - 18;

  function finishPage() {
    drawFooter(current.ctx);
    if (pageNo > 1) doc.addPage();
    const img = current.canvas.toDataURL('image/png');
    doc.addImage(img, 'PNG', 0, 0, pageWmm, pageHmm, undefined, 'SLOW');
  }

  function newPage() {
    finishPage();
    pageNo += 1;
    current = makePageCanvas();
    y = drawPageHeader(current.ctx, pageNo);
  }

  function drawGroup(title, rows) {
    if (y > bottomLimit - 14) newPage();
    y = drawTableHeader(current.ctx, y, title, rows.length);
    rows.forEach(r => {
      if (y > bottomLimit) {
        newPage();
        y = drawTableHeader(current.ctx, y, title + ' (continued)', rows.length);
      }
      let x = margin;
      cols.forEach(c => {
        current.ctx.strokeRect(mm(x), mm(y), mm(c.w), mm(rowH));
        const val = c.getter(r) == null ? '' : String(c.getter(r));
        drawText(current.ctx, val, x + 0.8, y + 3.85, c.w - 1.6, 5.5, '400');
        x += c.w;
      });
      y += rowH;
    });
    y += 8;
  }

  drawGroup('Observe in visit = Y', groups.Y);
  drawGroup('Observe in visit = N / blank', groups.N);
  finishPage();

  doc.save(`ADR_Report_${(metaFrom || '').replaceAll('/', '-') || 'from'}_${(metaTo || '').replaceAll('/', '-') || 'to'}.pdf`);
  adr256Status('✅ ADR A4 PDF created.', 'ok');
}

// ──────────────────────────────────────────────────────────────────────────────
// RT_COMMON_174 — EXP / Stock Expired Checking Report
// ──────────────────────────────────────────────────────────────────────────────
const EXP174_BASE = 'https://aa-report.bdms.co.th/jasperserver/flow.html';
const EXP174_FIXED = {
  _flowId: 'viewReportFlow',
  output: 'xls',
  reportUnit: '/BDMS/Other/RT_COMMON_174',
  userTimezone: 'Asia/bangkok',
  decorate: 'no',
  itemuid: '',
  vendorsuid: '',
  selectedorganisationuid: '5b20f438d1202e29ce16f710',
  loginuid: '5bb325cb3e4efabebd8ea549',
  logindepartmentuid: '5b857e32136d276403482bca',
  organisationuid: '5b20f438d1202e29ce16f710',
  userLocale: 'th',
  isduplicate: 'false',
  j_username: 'bkn07',
  j_password: 'abc@123',
};

const EXP174_FLOORS = {
  floor1: { label: 'Floor 1', subtitle: 'Department', storeuid: '5b863a5c3238d86bf03f1626' },
  floor2: { label: 'Floor 2', subtitle: '', storeuid: '5c862fb8cc6035a21bb9ec1c' },
  floorG: { label: 'Floor G', subtitle: '', storeuid: '5ee8433e65ec4421d19611d5' },
};

let exp174Rows = [];
let exp174AllRows = [];
let exp174Meta = { floorKey: 'floor1', date: '', storeBin: '', stockLocation: '', title: 'Stock expired checking' };

function exp174Status(msg, type = '') {
  const el = document.getElementById('exp174-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'rpt-status ' + type;
}

function shiftIsoDate(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function exp174FromUtc(dateStr) {
  return `${shiftIsoDate(dateStr, -1)}T17:00:00.000Z`;
}

function exp174ToUtc(dateStr) {
  return `${dateStr}T16:59:59.999Z`;
}

function buildExp174Url(dateStr, floorKey) {
  const floor = EXP174_FLOORS[floorKey] || EXP174_FLOORS.floor1;
  const params = Object.assign({}, EXP174_FIXED, {
    storeuid: floor.storeuid,
    fromdate: exp174FromUtc(dateStr),
    todate: exp174ToUtc(dateStr),
  });

  const rawEncode = v => String(v).replace(/%/g, '%25').replace(/ /g, '%20').replace(/\//g, '%2F');
  const qs = Object.entries(params).map(([k, v]) => `${k}=${rawEncode(v)}`).join('&');
  return `${EXP174_BASE}?${qs}`;
}

function initExpReport() {
  const dateEl = document.getElementById('exp174-date');
  const floorEl = document.getElementById('exp174-floor');
  if (dateEl) {
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    dateEl.value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  }


  document.getElementById('exp174-btn-genurl')?.addEventListener('click', () => {
    const date = dateEl?.value || '';
    const floorKey = floorEl?.value || 'floor1';

    if (!date) {
      exp174Status('⚠ Please select report date.', 'warn');
      return;
    }

    const url = buildExp174Url(date, floorKey);
    const wrap = document.getElementById('exp174-url-wrap');
    const box = document.getElementById('exp174-url-box');
    const openBtn = document.getElementById('exp174-btn-dlxls');

    if (box) box.textContent = url;
    if (wrap) wrap.style.display = 'block';
    if (openBtn) openBtn.style.display = 'inline-flex';

    if (box) {
      const nb = box.cloneNode(true);
      box.parentNode.replaceChild(nb, box);
      nb.addEventListener('click', () => chrome.tabs.create({ url }));
    }
    if (openBtn) {
      const nb = openBtn.cloneNode(true);
      openBtn.parentNode.replaceChild(nb, openBtn);
      nb.addEventListener('click', () => chrome.tabs.create({ url }));
    }

    const floor = EXP174_FLOORS[floorKey] || EXP174_FLOORS.floor1;
    exp174Meta = {
      floorKey,
      date,
      storeBin: '',
      stockLocation: '',
      title: `Stock expired checking: ${floor.label}`,
    };
    exp174Status(`✅ URL ready for ${floor.label} · report date ${date}.`, 'ok');
  });

  document.getElementById('exp174-file-input')?.addEventListener('change', async function (ev) {
    const file = (ev?.target?.files && ev.target.files[0]) || (this?.files && this.files[0]);
    if (!file) return;

    exp174Status('⏳ Reading file…', 'loading');

    let sheets;
    try {
      sheets = await readXlsFile(file);
    } catch (e) {
      exp174Status('❌ ' + e.message, 'err');
      return;
    }

    try {
      const floorKey = floorEl?.value || 'floor1';
      const date = dateEl?.value || '';
      exp174AllRows = parseExp174Sheets(sheets, floorKey, date);
      exp174Rows = filterExp174Rows(exp174AllRows);
      renumberExp174Rows(exp174Rows);
      renderExp174Preview();
      const btns = document.getElementById('exp174-pdf-btns');
      if (btns) btns.style.display = exp174Rows.length ? 'flex' : 'none';
      exp174Status(`✅ Parsed ${exp174Rows.length} EXP rows.`, exp174Rows.length ? 'ok' : 'warn');
    } catch (e) {
      console.error('[RT174 parse]', e);
      exp174Status('❌ Parse error: ' + e.message, 'err');
    }
  });

  document.getElementById('exp174-btn-pdf')?.addEventListener('click', () => {
    if (!exp174Rows.length) {
      exp174Status('⚠ No data — load XLS first.', 'warn');
      return;
    }

    const floor = EXP174_FLOORS[exp174Meta.floorKey] || EXP174_FLOORS.floor1;
    exp174Status('⏳ Opening EXP print page…', 'loading');
    openPrintPage('exp', exp174Rows, {
      title: exp174Meta.title || `Stock expired checking: ${exp174Meta.stockLocation || floor.label}`,
      reportUnit: 'RT_COMMON_174',
      date: exp174Meta.date || document.getElementById('exp174-date')?.value || '',
      floorKey: exp174Meta.floorKey || 'floor1',
      floorLabel: floor.label,
      stockLocation: exp174Meta.stockLocation || '',
      storeBin: 'All',
      groupMode: 'storebin',
      total: exp174Rows.length,
    });
    exp174Status('✅ EXP print page opened. Use Print / Save PDF in the control panel.', 'ok');
  });
}

function isLikelyItemCode(v) {
  return /^\d{10,}$/.test(normalizeWhitespace(v));
}


function exp174Cell(row, idx, options = {}) {
  return idx >= 0 ? cleanExp174Text(row[idx], options) : '';
}

function looksLikeStoreBin(v) {
  const s = normalizeWhitespace(v);
  if (!s || s === '0') return false;
  return /^(?:\d{1,2}[-/][A-Z0-9]+(?:[-/][A-Z0-9]+)*|NH|R1|R2|AD|CS|IV|MS|P[-/].*|BW|CH)$/i.test(s);
}

function isAllowedPureStoreBin(v) {
  const s = normalizeWhitespace(v);
  return /^(?:10|11|12|13|14|15|16|17|18)$/.test(s);
}

function looksLikeQty(v) {
  const s = normalizeWhitespace(v).replace(/,/g, '');
  return /^-?\d+(?:\.\d+)?$/.test(s);
}

const EXP174_UOM_HINTS = new Set([
  'amp','bag','bottle','box','capsule','dose','each','gram','milliLitre'.toLowerCase(),
  'pack','pad','patch','piece','sachet','set','syringe','tablet','tin','tube','unit','vial'
]);

function looksLikeUom(v) {
  return EXP174_UOM_HINTS.has(normalizeWhitespace(v).toLowerCase());
}

function deriveExp174FieldsFromCells(row, codeIdx) {
  const cells = row.map(v => cleanExp174Text(v));
  const code = cells[codeIdx] || '';

  const candidates = cells.slice(codeIdx + 1).filter(Boolean);
  let storeBin = '';
  let qty = '';
  let uom = '';
  let note = '';

  const storeIndex = candidates.findIndex(looksLikeStoreBin);
  if (storeIndex >= 0) storeBin = candidates[storeIndex];

  const uomIndex = candidates.findIndex(looksLikeUom);
  if (uomIndex >= 0) uom = candidates[uomIndex];

  const qtyIndex = candidates.findIndex((v, i) => looksLikeQty(v) && i !== storeIndex && i !== uomIndex);
  if (qtyIndex >= 0) qty = candidates[qtyIndex];

  note = '';

  const stopIndexes = [storeIndex, qtyIndex, uomIndex].filter(i => i >= 0);
  const stop = stopIndexes.length ? Math.min(...stopIndexes) : candidates.length;
  const name = cleanExp174Text(candidates.slice(0, stop).join(' '), { name: true });

  return { code, name, storeBin, qty, uom, note };
}

function deriveExp174Category(row) {
  const explicit = normalizeWhitespace(row?.category || row?.Category || row?.itemCategory || row?.type || '');
  if (explicit) return explicit;

  const name = normalizeWhitespace(row?.name || '').toLowerCase();
  const uom = normalizeWhitespace(row?.uom || '').toLowerCase();

  if (/inj|injection|vial|amp|syringe/.test(name) || /^(amp|vial|syringe)$/i.test(uom)) return 'Injectable / IV';
  if (/cream|ointment|gel|lotion|paste|tub|tube/.test(name) || /^(tub|tube|gm|g)$/i.test(uom)) return 'Topical';
  if (/eye|ophthalm|otic|ear drop|drop/.test(name)) return 'Eye / Ear / Drop';
  if (/syrup|suspension|solution|oral sol|elixir|mouthwash/.test(name) || /^(bot|bottle)$/i.test(uom)) return 'Liquid / Solution';
  if (/tablet|tab|capsule|cap|chewable/.test(name) || /^(tab|cap|tablet|capsule)$/i.test(uom)) return 'Oral solid';
  if (/suppository|enema|rectal/.test(name)) return 'Rectal';
  if (/patch/.test(name)) return 'Patch';
  if (/pack|set|pad|gauze|strip/.test(name) || /^(pack|pck|set|pad)$/i.test(uom)) return 'Supply / Other';
  return 'Uncategorized';
}

function parseExp174Sheets(sheets, floorKey, dateStr) {
  const out = [];
  const floor = EXP174_FLOORS[floorKey] || EXP174_FLOORS.floor1;
  exp174Meta = {
    floorKey,
    date: dateStr,
    storeBin: '',
    stockLocation: '',
    title: `Stock expired checking: ${floor.label}`,
  };

  sheets.forEach(({ rows }) => {
    rows = Array.isArray(rows) ? rows.filter(Array.isArray) : [];
    if (!rows.length) return;

    rows.slice(0, 20).forEach(r => {
      const joined = r.map(x => cleanExp174Text(x)).filter(Boolean).join(' ');

      // Jasper RT_COMMON_174 can export different stock locations depending on the selected store.
      // Prefer the StoreName row from the XLS itself instead of the dropdown floor label.
      // Example: "StoreName : Outpatient Pharmacy (Floor 1)".
      const storeNameMatch = joined.match(/Store\s*Name\s*[:：]\s*(.+)$/i) ||
        joined.match(/StoreName\s*[:：]\s*(.+)$/i);
      if (storeNameMatch) {
        exp174Meta.stockLocation = cleanExp174Text(storeNameMatch[1]);
      }

      if (/Stock\s+expir/i.test(joined)) {
        exp174Meta.title = cleanExp174Text(joined);
      }

      const m = joined.match(/Store\s*Bin\s*[:：]?\s*([A-Za-z0-9\-_/]+)/i) ||
        joined.match(/StoreBin\s*[:：]?\s*([A-Za-z0-9\-_/]+)/i);
      if (m && !/stockqty/i.test(m[1])) exp174Meta.storeBin = m[1];
    });

    if (exp174Meta.stockLocation) {
      exp174Meta.title = `Stock expired checking: ${exp174Meta.stockLocation}`;
    }

    let headerIdx = -1;
    let headers = [];

    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const r = rows[i].map(v => normalizeWhitespace(v).toLowerCase());
      if (r.some(h => h === 'code') && (r.some(h => h === 'name' || h === 'item name') || r.some(h => h.includes('storebin') || h.includes('store bin')))) {
        headerIdx = i;
        headers = r;
        break;
      }
    }

    if (headerIdx >= 0) {
      const col = { no: -1, code: -1, name: -1, category: -1, storeBin: -1, qty: -1, uom: -1, note: -1 };

      headers.forEach((h, idx) => {
        if (h === 'no' || h === 'no.') col.no = idx;
        else if (h === 'code' || h === 'item code') col.code = idx;
        else if (h === 'name' || h === 'item name' || h === 'itemname') col.name = idx;
        else if (h.includes('category') || h.includes('กลุ่ม')) col.category = idx;
        else if (h.includes('storebin') || h.includes('store bin')) col.storeBin = idx;
        else if (h.includes('quality') || h.includes('quantity') || h.includes('stockqty') || h.includes('stock qty') || h === 'qty') col.qty = idx;
        else if (h === 'uom' || h === 'unit') col.uom = idx;
        else if (h.includes('note')) col.note = idx;
      });

      rows.slice(headerIdx + 1).forEach(r => {
        let code = exp174Cell(r, col.code);
        let codeIdx = col.code;

        // If the XLS has a real Code column, accept the value as-is.
        // Some RT_COMMON_174 stock items use short internal codes (e.g. 010725),
        // not only 10+ digit item codes. Only fall back to pattern-search when
        // the Code cell is actually empty or no Code column was detected.
        if (!code) {
          codeIdx = r.map(v => normalizeWhitespace(v)).findIndex(isLikelyItemCode);
          if (codeIdx < 0) return;
          code = normalizeWhitespace(r[codeIdx]);
        }

        const derived = deriveExp174FieldsFromCells(r, codeIdx);

        const headerStoreBin = exp174Cell(r, col.storeBin);
        const hasStoreBinHeader = col.storeBin >= 0;

        const obj = {
          no: out.length + 1,
          code,
          name: exp174Cell(r, col.name, { name: true }) || derived.name,
          category: exp174Cell(r, col.category),
          storeBin: hasStoreBinHeader ? headerStoreBin : derived.storeBin,
          qty: exp174Cell(r, col.qty) || derived.qty,
          uom: exp174Cell(r, col.uom) || derived.uom,
          note: '',
        };

        if (!obj.qty || !obj.uom || !obj.name) {
          obj.name = obj.name || derived.name;
          obj.qty = obj.qty || derived.qty;
          obj.uom = obj.uom || derived.uom;
        }
        obj.category = obj.category || deriveExp174Category(obj);

        if (obj.storeBin === '0' || (looksLikeQty(obj.storeBin) && !isAllowedPureStoreBin(obj.storeBin))) {
          obj.storeBin = '';
        }

        out.push(obj);
      });
      return;
    }

    rows.forEach(r => {
      const codeIdx = r.map(v => normalizeWhitespace(v)).findIndex(isLikelyItemCode);
      if (codeIdx < 0) return;
      const d = deriveExp174FieldsFromCells(r, codeIdx);
      out.push({
        no: out.length + 1,
        code: d.code,
        name: cleanExp174Text(d.name, { name: true }),
        category: deriveExp174Category(d),
        storeBin: d.storeBin === '0' ? '' : d.storeBin,
        qty: d.qty,
        uom: d.uom,
        note: '',
      });
    });
  });

  out.sort((a, b) =>
    String(a.storeBin || '').localeCompare(String(b.storeBin || ''), undefined, { numeric: true }) ||
    String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true })
  );

  renumberExp174Rows(out);
  return out.filter(r => r.code || r.name || r.storeBin);
}

function filterExp174Rows(rows) {
  // StoreBin filtering was moved from popup to report_print.html.
  // Keep this function as a compatibility layer so existing calls continue to work.
  return Array.isArray(rows) ? [...rows] : [];
}

function renumberExp174Rows(rows) {
  rows.forEach((r, i) => { r.no = i + 1; });
}

function renderExp174Preview() {
  const wrap = document.getElementById('exp174-preview');
  const box = document.getElementById('exp174-tbl-inner');
  if (!wrap || !box) return;

  wrap.style.display = 'block';
  const countEl = document.getElementById('exp174-preview-count');
  if (countEl) countEl.textContent = exp174Rows.length;

  box.innerHTML = `
    <div class="rpt-preview-title">A4 checklist preview (${exp174Rows.length} rows)</div>
    <table class="rpt-table">
      <thead>
        <tr>
          <th>No.</th>
          <th>Code</th>
          <th>Name</th>
          <th>Category</th>
          <th>StoreBin</th>
          <th>Quality</th>
          <th>UOM</th>
          <th>Count note</th>
        </tr>
      </thead>
      <tbody>
        ${exp174Rows.slice(0, 60).map(r => `
          <tr>
            <td>${escHtml(r.no)}</td>
            <td>${escHtml(r.code)}</td>
            <td>${escHtml(r.name)}</td>
            <td>${escHtml(r.category || deriveExp174Category(r))}</td>
            <td>${escHtml(r.storeBin)}</td>
            <td>${escHtml(r.qty)}</td>
            <td>${escHtml(r.uom)}</td>
            <td></td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

async function buildExp174Pdf(JsPDF) {
  // EXP report contains Thai text such as "(ยานอกบัญชี)" from Jasper.
  // jsPDF built-in fonts cannot render Thai glyphs. Render A4 pages to canvas
  // using browser/system Thai fonts, then add the canvas image into the PDF.
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false });
  const pageWmm = 210;
  const pageHmm = 297;
  const scale = 8;  // EXP canvas render scale; high DPI for sharper A4 PDF output
  const pageWpx = Math.round(pageWmm * scale);
  const pageHpx = Math.round(pageHmm * scale);
  const margin = 8;
  const floor = EXP174_FLOORS[exp174Meta.floorKey] || EXP174_FLOORS.floor1;
  const monthLabel = exp174Meta.date ?
    new Date(exp174Meta.date + 'T00:00:00').toLocaleString('en-US', { month: 'long' }) : '';
  const stockLocation = cleanExp174Text(exp174Meta.stockLocation || '');
  const title = cleanExp174Text(exp174Meta.title ||
    `Stock expired checking: ${stockLocation || floor.label} ${monthLabel}`);
  const dateLabel = cleanExp174Text(exp174Meta.date || '');
  const fontFamily = '"Tahoma", "Leelawadee UI", "Noto Sans Thai", "Sarabun", Arial, sans-serif';

  const cols = [
    // Tuned for canvas Thai font rendering. Wider Name and No. columns reduce clipping/odd wrap.
    { label: 'No.', w: 11, getter: r => r.no },
    { label: 'Code', w: 31, getter: r => r.code },
    { label: 'Name', w: 78, getter: r => r.name },
    { label: 'StoreBin', w: 20, getter: r => r.storeBin },
    { label: 'Quality', w: 16, getter: r => r.qty },
    { label: 'UOM', w: 16, getter: r => r.uom },
    { label: 'Count note', w: 22, getter: r => '' },
  ];

  const mm = v => Math.round(v * scale);
  const pxFont = pt => Math.max(5, Math.round(pt * scale * 0.62));

  function makePageCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = pageWpx;
    canvas.height = pageHpx;
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#000000';
    ctx.lineWidth = Math.max(1, Math.round(0.22 * scale));
    ctx.textBaseline = 'alphabetic';
    return { canvas, ctx };
  }

  function setFont(ctx, pt, weight = '400') {
    ctx.font = `${weight} ${pxFont(pt)}px ${fontFamily}`;
  }

  function drawText(ctx, text, xMm, yMm, maxWMm, pt = 7.2, weight = '400', align = 'left') {
    let s = cleanExp174Text(text, { name: true });
    const maxW = mm(maxWMm || 999);
    setFont(ctx, pt, weight);
    if (ctx.measureText(s).width > maxW) {
      while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
      s = s + '…';
    }
    ctx.textAlign = align;
    ctx.fillText(s, mm(xMm), mm(yMm));
  }

  function drawHeader(ctx) {
    setFont(ctx, 10.5, '400');
    ctx.textAlign = 'left';
    ctx.fillText(title, mm(margin), mm(10));
    setFont(ctx, 7.5, '400');
    ctx.textAlign = 'right';
    ctx.fillText(`Date: ${dateLabel}`, mm(pageWmm - margin), mm(10));
    ctx.textAlign = 'left';
    const locationLine = stockLocation
      ? `Stock Location: ${stockLocation}`
      : `Floor: ${floor.label}${floor.subtitle ? ' - ' + floor.subtitle : ''}`;
    ctx.fillText(locationLine, mm(margin), mm(16));
    ctx.textAlign = 'right';
    ctx.fillText(`StoreBin: ${getExp174SelectedStoreBinLabel()}`, mm(pageWmm - margin), mm(16));

    let x = margin;
    const y = 22;
    setFont(ctx, 6.4, '600');
    cols.forEach(c => {
      ctx.strokeRect(mm(x), mm(y), mm(c.w), mm(7));
      ctx.textAlign = 'left';
      ctx.fillText(c.label, mm(x + 0.8), mm(y + 4.6));
      x += c.w;
    });
    return y + 7;
  }

  function drawFooter(ctx, pageNo) {
    const fy = pageHmm - 15;
    setFont(ctx, 6.8, '400');
    ctx.textAlign = 'left';
    ctx.fillText('Assistant Pharmacist: ........................................', mm(margin), mm(fy));
    ctx.textAlign = 'right';
    ctx.fillText('Pharmacist: ........................................', mm(pageWmm - margin), mm(fy));
    ctx.textAlign = 'center';
    ctx.fillText(`Page ${pageNo}`, mm(pageWmm / 2), mm(pageHmm - 6));
  }

  let pageNo = 1;
  let current = makePageCanvas();
  let y = drawHeader(current.ctx);
  const rowH = 5.3;
  const bottomLimit = pageHmm - 24;

  function finishPage() {
    drawFooter(current.ctx, pageNo);
    if (pageNo > 1) doc.addPage();
    const img = current.canvas.toDataURL('image/png');
    doc.addImage(img, 'PNG', 0, 0, pageWmm, pageHmm, undefined, 'SLOW');
  }

  for (const r of exp174Rows) {
    if (y > bottomLimit) {
      finishPage();
      pageNo += 1;
      current = makePageCanvas();
      y = drawHeader(current.ctx);
    }

    let x = margin;
    for (const c of cols) {
      current.ctx.strokeRect(mm(x), mm(y), mm(c.w), mm(rowH));
      let val = c.getter(r) == null ? '' : String(c.getter(r));
      if (c.label === 'Name') val = cleanExp174Text(val, { name: true });
      if (c.label === 'Count note') val = '';
      drawText(current.ctx, val, x + 0.8, y + 3.75, c.w - 1.6, 5.9, '400', 'left');
      x += c.w;
    }
    y += rowH;
  }

  finishPage();
  const safeFloor = String(floor.label).replace(/\s+/g, '_');
  doc.save(`EXP_Checker_${safeFloor}_${dateLabel || Date.now()}.pdf`);
  exp174Status('✅ EXP A4 PDF created with Thai-compatible canvas font.', 'ok');
}

// ──────────────────────────────────────────────────────────────────────────────
// Formulary — dedicated tab + workspace inline duplicate
// ──────────────────────────────────────────────────────────────────────────────
function formularyUrl(id) {
  const base = chrome.runtime.getURL('formulary/index.html');
  return id ? `${base}?id=${encodeURIComponent(id)}` : base;
}

function initFormularyTab() {
  document.getElementById('btnOpenFormulary')
    ?.addEventListener('click', () => chrome.tabs.create({ url: formularyUrl() }));
  document.getElementById('btnOpenFormularyWS')
    ?.addEventListener('click', () => chrome.tabs.create({ url: formularyUrl() }));
  loadFormulaList();
}

function escHtmlFormulary(v) {
  return String(v ?? '').replace(/[&<>'"]/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[s])
  );
}

function populateFormulaContainer(container, formulas) {
  container.innerHTML = formulas.map(f => `
    <div class="formula-card" data-id="${escHtmlFormulary(f.id)}">
      <span class="formula-card-icon">🧪</span>
      <span class="formula-card-name">${escHtmlFormulary(f.name || f.id)}</span>
      <span class="formula-card-shelf">${escHtmlFormulary(f.shelfLifeText || (f.shelfLifeDays ? f.shelfLifeDays + ' วัน' : ''))}</span>
    </div>
  `).join('');
  container.querySelectorAll('.formula-card').forEach(card => {
    card.addEventListener('click', () =>
      chrome.tabs.create({ url: formularyUrl(card.dataset.id) })
    );
  });
}

async function loadFormulaList() {
  const containers = [
    document.getElementById('formulaList'),
    document.getElementById('formulaListWorkspace'),
  ].filter(Boolean);
  if (!containers.length) return;

  try {
    let formulas = null;

    const saved = localStorage.getItem('bkn_formula_webapp.formulas.v4');
    if (saved) formulas = JSON.parse(saved);

    if (!Array.isArray(formulas)) {
      const res = await fetch(chrome.runtime.getURL('formulary/data/formulas.json'));
      formulas = await res.json();
    }

    if (!Array.isArray(formulas) || !formulas.length) {
      containers.forEach(c => { c.innerHTML = '<div class="formula-empty">ไม่พบข้อมูล formulary</div>'; });
      return;
    }

    containers.forEach(c => populateFormulaContainer(c, formulas));
  } catch (e) {
    containers.forEach(c => { c.innerHTML = '<div class="formula-empty">กด Open เพื่อเปิด Formulary App</div>'; });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Workspace collapsible sections
// ──────────────────────────────────────────────────────────────────────────────
function initWorkspaceSections() {
  document.querySelectorAll('.ws-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body    = document.getElementById(btn.getAttribute('aria-controls'));
      if (!body) return;
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
    });
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Knowledge Sharing tab
// ──────────────────────────────────────────────────────────────────────────────
function knowledgeUrl(hash) {
  const base = chrome.runtime.getURL('knowledge/index.html');
  return hash ? `${base}#${hash}` : base;
}

function initKnowledgeTab() {
  document.getElementById('btnKsFaqs')?.addEventListener('click',  () => chrome.tabs.create({ url: knowledgeUrl('faqs') }));
  document.getElementById('btnKsItems')?.addEventListener('click', () => chrome.tabs.create({ url: knowledgeUrl('items') }));
  document.getElementById('btnKsVdos')?.addEventListener('click',  () => chrome.tabs.create({ url: knowledgeUrl('vdos') }));

  document.querySelectorAll('.ks-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const body = document.getElementById(btn.getAttribute('aria-controls'));
      if (!body) return;
      const expanded = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
    });
  });

  loadKsPreview();
}

function loadKsPreview() {
  loadKsFaqPreview();
  loadKsItemsPreview();
  loadKsVdosPreview();
}

function loadKsFaqPreview() {
  const el = document.getElementById('ksFaqList');
  if (!el) return;
  try {
    const faqs = JSON.parse(localStorage.getItem('bkn_ks.faqs.v1')) || [];
    if (!faqs.length) {
      el.innerHTML = '<div class="formula-empty">ยังไม่มีข้อมูล — เปิด Knowledge App เพื่อดูเพิ่มเติม</div>';
      return;
    }
    el.innerHTML = faqs.slice(0, 3).map(f => `
      <div class="ks-preview-item" data-ks-open="faqs">
        <span class="ks-preview-icon">💬</span>
        <div class="ks-preview-text">
          <div class="ks-preview-title">${escKs(f.question)}</div>
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-ks-open]').forEach(item => {
      item.addEventListener('click', () => chrome.tabs.create({ url: knowledgeUrl('faqs') }));
    });
  } catch { el.innerHTML = '<div class="formula-empty">เปิด Knowledge App เพื่อดู FAQs</div>'; }
}

function loadKsItemsPreview() {
  const el = document.getElementById('ksItemsList');
  if (!el) return;
  try {
    const items = JSON.parse(localStorage.getItem('bkn_ks.items.v1')) || [];
    if (!items.length) {
      el.innerHTML = '<div class="formula-empty">ยังไม่มีรายการยาใหม่</div>';
      return;
    }
    const sorted = [...items].sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
    el.innerHTML = sorted.slice(0, 3).map(i => `
      <div class="ks-preview-item" data-ks-open="items">
        <span class="ks-preview-icon">💊</span>
        <div class="ks-preview-text">
          <div class="ks-preview-title">${escKs(i.name)}</div>
          ${i.generic ? `<div class="ks-preview-sub">${escKs(i.generic)}</div>` : ''}
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-ks-open]').forEach(item => {
      item.addEventListener('click', () => chrome.tabs.create({ url: knowledgeUrl('items') }));
    });
  } catch { el.innerHTML = '<div class="formula-empty">เปิด Knowledge App เพื่อดูรายการ</div>'; }
}

function loadKsVdosPreview() {
  const el = document.getElementById('ksVdosList');
  if (!el) return;
  try {
    const vdos = JSON.parse(localStorage.getItem('bkn_ks.vdos.v1')) || [];
    if (!vdos.length) {
      el.innerHTML = '<div class="formula-empty">ยังไม่มีวิดีโอ</div>';
      return;
    }
    const sorted = [...vdos].sort((a, b) => new Date(b.addedDate) - new Date(a.addedDate));
    el.innerHTML = sorted.slice(0, 3).map(v => `
      <div class="ks-preview-item" data-ks-open="vdos">
        <span class="ks-preview-icon">🎬</span>
        <div class="ks-preview-text">
          <div class="ks-preview-title">${escKs(v.title)}</div>
          ${v.duration ? `<div class="ks-preview-sub">${escKs(v.duration)}</div>` : ''}
        </div>
      </div>`).join('');
    el.querySelectorAll('[data-ks-open]').forEach(item => {
      item.addEventListener('click', () => chrome.tabs.create({ url: knowledgeUrl('vdos') }));
    });
  } catch { el.innerHTML = '<div class="formula-empty">เปิด Knowledge App เพื่อดูวิดีโอ</div>'; }
}

function escKs(v) {
  return String(v ?? '').replace(/[&<>'"]/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[s])
  );
}
