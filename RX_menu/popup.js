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
// IPD Queue
// ──────────────────────────────────────────────────────────────────────────────
const ARCUSAIR_HOST = 'arcusair.bdms.co.th';
const MRD_ROUTE_HINTS = ['#!/mrd/reopenvisit', '/mrd/reopenvisit'];

function isMrdTab(tab) {
  const url = String(tab?.url || '');
  return url.includes(ARCUSAIR_HOST) && MRD_ROUTE_HINTS.some(hint => url.includes(hint));
}

function initIpdQueue() {
  document.getElementById('btnRefreshQueue')
    ?.addEventListener('click', loadQueueData);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'drugDeliveryResult') {
      handleDeliveryResult(msg.visitId, msg.ok, msg.errorText);
    }
  });

  restoreQueueState();
}

async function restoreQueueState() {
  const data = await chrome.storage.local.get([STORAGE_KEY_ROWS, STORAGE_KEY_SENT]);
  const rows = data[STORAGE_KEY_ROWS];
  const sent = new Set(data[STORAGE_KEY_SENT] || []);

  if (rows && rows.length > 0) {
    const tbody = document.getElementById('queueTableBody');
    const countEl = document.getElementById('queueCount');
    const statusEl = document.getElementById('queueStatus');
    renderQueueTable(rows, tbody, countEl, sent);
    setStatus(
      statusEl,
      `✓ ${rows.length} patient${rows.length !== 1 ? 's' : ''} (restored — click ↻ to reload)`,
      'ok'
    );
  }
}

async function loadQueueData() {
  const refreshBtn = document.getElementById('btnRefreshQueue');
  const statusEl = document.getElementById('queueStatus');
  const countEl = document.getElementById('queueCount');
  const tbody = document.getElementById('queueTableBody');

  refreshBtn.disabled = true;
  setStatus(statusEl, '⏳ Loading — scrolling table to fetch all rows…', 'loading');
  countEl.textContent = '…';

  try {
    const tabs = await chrome.tabs.query({});
    const mrdTab = tabs.find(isMrdTab);

    if (!mrdTab) {
      setStatus(
        statusEl,
        '⚠ No MRD tab found. Open arcusair → MRD Reopen Visit page first.',
        'err'
      );
      countEl.textContent = '—';
      return;
    }

    const resp = await msgTab(mrdTab.id, { action: 'getMrdRows' });

    if (!resp || !Array.isArray(resp.rows)) {
      setStatus(
        statusEl,
        '✗ Could not read MRD table. Make sure the tab is on the MRD Reopen Visit page.',
        'err'
      );
      countEl.textContent = '—';
      return;
    }

    const sentData = await chrome.storage.local.get(STORAGE_KEY_SENT);
    const sent = new Set(sentData[STORAGE_KEY_SENT] || []);

    await chrome.storage.local.set({ [STORAGE_KEY_ROWS]: resp.rows });

    renderQueueTable(resp.rows, tbody, countEl, sent);
    setStatus(
      statusEl,
      resp.rows.length > 0
        ? `✓ ${resp.rows.length} active patient${resp.rows.length !== 1 ? 's' : ''} (End Date empty)`
        : '✓ No active patients found.',
      'ok'
    );
  } catch (e) {
    console.error('[IPD Queue]', e);
    setStatus(statusEl, `✗ Error: ${e.message}`, 'err');
    countEl.textContent = '—';
  } finally {
    refreshBtn.disabled = false;
  }
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

    patients.forEach(({ name, visitId }) => {
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
      tdVisit.textContent = visitId || '—';

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
      merged.push(r);
    }
  }

  const sst = [];
  const sstRec = merged.find(r => r.type === 0x00FC);
  if (sstRec) {
    const d = sstRec.data;
    const sdv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const uniq = sdv.getUint32(4, true);
    let p = 8;

    for (let i = 0; i < uniq && p + 3 <= d.length; i++) {
      const charCount = sdv.getUint16(p, true);
      const flags = d[p + 2];
      const wide = !!(flags & 0x01);
      const hasRich = !!(flags & 0x08);
      const hasPhon = !!(flags & 0x04);
      p += 3;

      if (hasRich) {
        const richRuns = sdv.getUint16(p, true);
        p += 2;
        p += richRuns * 4;
      }
      if (hasPhon) {
        const phonSize = sdv.getUint32(p, true);
        p += 4;
        p += phonSize;
      }

      let str = '';
      if (wide) {
        for (let j = 0; j < charCount && p + 1 < d.length; j++, p += 2) {
          str += String.fromCodePoint(sdv.getUint16(p, true));
        }
      } else {
        for (let j = 0; j < charCount && p < d.length; j++, p++) {
          str += String.fromCharCode(d[p]);
        }
      }
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
        curSheet = { rows: {} };
        sheets.push(curSheet);
        inSheet = true;
      } else {
        inSheet = false;
      }
    } else if (type === 0x000A) {
      inSheet = false;
    }

    if (!inSheet || !curSheet) continue;

    if (type === 0x00FD) {
      const row = dv2.getUint16(0, true);
      const col = dv2.getUint16(2, true);
      const sstIdx = dv2.getUint32(6, true);
      setCell(curSheet.rows, row, col, sst[sstIdx] ?? '');
    } else if (type === 0x0203) {
      const row = dv2.getUint16(0, true);
      const col = dv2.getUint16(2, true);
      const val = dv2.getFloat64(6, true);
      setCell(curSheet.rows, row, col, formatNum(val));
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
    const rowNums = Object.keys(sh.rows).map(Number).sort((a, b) => a - b);
    if (!rowNums.length) return null;
    const maxCol = Math.max(...rowNums.map(r => Math.max(...Object.keys(sh.rows[r]).map(Number))));
    const rows = rowNums.map(r =>
      Array.from({ length: maxCol + 1 }, (_, c) => sh.rows[r][c] ?? '')
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
        const buf = ev.target.result;
        const head = new Uint8Array(buf, 0, 8);
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

  document.getElementById('rpt-file-input')?.addEventListener('change', async function () {
    const file = this.files[0];
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
            const label = String(nonEmpty[0]).trim();
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
              obj._ward = 'Ward ' + bed[0];
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
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  let y = 10;

  const cols = [
    { key: 'itemCode', label: 'Item Code', w: 28 },
    { key: 'itemName', label: 'Item Name', w: 80 },
    ...RT257_WARD_COLS.map(w => ({ key: w, label: w, w: 12 })),
    { key: 'total', label: 'Total', w: 14 },
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
  const doc = new JsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;
  let y = 10;

  const cols = [
    { key: '_ward', label: 'Ward', w: 28 },
    { key: 'HN', label: 'HN', w: 24 },
    { key: 'BED NO.', label: 'Bed', w: 20 },
    { key: 'ITEM CODE', label: 'Item Code', w: 28 },
    { key: 'ITEM NAME', label: 'Item Name', w: 110 },
    { key: 'QTY', label: 'Qty', w: 14 },
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

  document.getElementById('stk917-file-input')?.addEventListener('change', async function () {
    const file = this.files[0];
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
    if (!rows || !rows.length) return;

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

    rows.slice(headerIdx + 1).forEach(r => {
      const code = normalizeWhitespace(r[COL.code]);
      const name = normalizeWhitespace(r[COL.name]);
      const storeBin = normalizeWhitespace(r[COL.bin]);
      const qtyRaw = normalizeWhitespace(r[COL.qty]);
      const department = normalizeWhitespace(r[COL.dept]);
      const store = normalizeWhitespace(r[COL.store]);

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
  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 8;

  const storeMap = new Map();
  const STORE_ORDER = ['Outpatient Pharmacy', 'Inpatient Pharmacy', 'Pharmacy Floor 2'];

  stk917Rows.forEach(r => {
    const store = r.store || 'Outpatient Pharmacy';
    const dep = r.department || 'Unknown';
    if (!storeMap.has(store)) storeMap.set(store, new Map());
    if (!storeMap.get(store).has(dep)) storeMap.get(store).set(dep, []);
    storeMap.get(store).get(dep).push(r);
  });

  storeMap.forEach(depMap => {
    depMap.forEach((rows, dep) => {
      const merged = new Map();
      rows.forEach(r => {
        if (!merged.has(r.itemCode)) {
          merged.set(r.itemCode, { ...r, qty: 0 });
        }
        merged.get(r.itemCode).qty += Number(r.qty) || 0;
      });

      const mergedRows = [...merged.values()]
        .map(r => ({ ...r, qty: String(r.qty) }))
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode));

      depMap.set(dep, mergedRows);
    });
  });

  if (!storeMap.size) {
    rpt917Status('⚠ No rows with qty > 0 to print.', 'warn');
    return;
  }

  const sortedStores = [...storeMap.keys()].sort((a, b) => {
    const ia = STORE_ORDER.indexOf(a);
    const ib = STORE_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  function compactDateRange(from, to) {
    if (!from || !to) return '-';
    const mF = from.match(/(\d{2})\/(\d{2})\/\d{2}(\d{2})/);
    const mT = to.match(/(\d{2})\/(\d{2})\/\d{2}(\d{2})/);
    if (!mF || !mT) return `${from} – ${to}`;
    const [, dF, moF, yF] = mF;
    const [, dT, moT, yT] = mT;
    if (moF === moT && yF === yT) return `${dF}-${dT}/${moF}/${yF}`;
    if (yF === yT) return `${dF}/${moF}-${dT}/${moT}/${yF}`;
    return `${dF}/${moF}/${yF}-${dT}/${moT}/${yT}`;
  }

  const dateLabel = compactDateRange(stk917Meta.from, stk917Meta.to);

  let firstPage = true;

  sortedStores.forEach(store => {
    const depMap = storeMap.get(store);
    const deps = [...depMap.keys()].sort((a, b) => a.localeCompare(b));

    deps.forEach(dep => {
      const rows = depMap.get(dep);

      if (!firstPage) doc.addPage();
      firstPage = false;

      doc.setFontSize(14);
      doc.text(store, margin, 14);

      doc.setFontSize(10);
      doc.text(dep, margin, 21);

      doc.setFontSize(9);
      doc.text(`Date: ${dateLabel}`, pageW - margin, 14, { align: 'right' });

      let y = 28;

      doc.setFontSize(9);
      doc.rect(margin, y, 36, 8);
      doc.rect(margin + 36, y, 88, 8);
      doc.rect(margin + 124, y, 24, 8);
      doc.rect(margin + 148, y, 16, 8);

      doc.text('Item Code', margin + 1, y + 5);
      doc.text('Item Name', margin + 37, y + 5);
      doc.text('Store Bin', margin + 125, y + 5);
      doc.text('Qty', margin + 149, y + 5);

      y += 8;
      doc.setFontSize(8);

      rows.forEach(r => {
        if (y > pageH - margin - 8) {
          doc.addPage();
          y = 14;
        }

        doc.rect(margin, y, 36, 7);
        doc.rect(margin + 36, y, 88, 7);
        doc.rect(margin + 124, y, 24, 7);
        doc.rect(margin + 148, y, 16, 7);

        doc.text(String(r.itemCode || ''), margin + 1, y + 4.5, { maxWidth: 34 });
        doc.text(String(r.itemName || ''), margin + 37, y + 4.5, { maxWidth: 86 });
        doc.text(String(r.storeBin || ''), margin + 125, y + 4.5, { maxWidth: 22 });
        doc.text(String(r.qty || ''), margin + 149, y + 4.5, { maxWidth: 14 });

        y += 7;
      });
    });
  });

  doc.save(`Stock_Picking_List_${Date.now()}.pdf`);
  rpt917Status('✅ Sticker PDF created.', 'ok');
}