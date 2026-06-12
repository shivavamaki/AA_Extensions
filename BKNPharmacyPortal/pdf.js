'use strict';

/*
 * pdf.js — Beedee Stock Transfer/Issue PDF
 * Fixes:
 * 1) A4 landscape layout.
 * 2) Calculate UnitCost/Sum from beedee_report.json by Hospital Code.
 * 3) More robust loading/matching of JSON cost master.
 */

let __beedeePdfStarted = false;

document.addEventListener('DOMContentLoaded', initBeedeePdf, { once: true });

async function initBeedeePdf() {
  if (__beedeePdfStarted) return;
  __beedeePdfStarted = true;

  const data = await waitForPdfData();
  console.log('📄 Loaded PDF data:', data);

  if (!data || !Array.isArray(data.items) || data.items.length === 0) {
    document.body.innerHTML = '<h2>No data found</h2>';
    alert('No data found (storage empty)');
    return;
  }

  let costMap = new Map();
  try {
    costMap = await loadBeedeeCostMap();
    console.log(`💰 Loaded Beedee cost records: ${costMap.size}`);
  } catch (e) {
    console.error('❌ Cannot load beedee_report.json:', e);
    alert('Cannot load beedee_report.json. UnitCost may show 0. Please confirm beedee_report.json is in extension root and manifest is updated.');
  }

  generatePDF(data, costMap);
}

async function waitForPdfData() {
  for (let i = 0; i < 20; i++) {
    const result = await chrome.storage.local.get('pdf_data');
    if (result && result.pdf_data) return result.pdf_data;
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

async function fetchJsonAny(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn('Cost JSON load failed:', url, e);
    }
  }
  throw lastErr || new Error('Cannot load cost JSON');
}

async function loadBeedeeCostMap() {
  const urls = [];
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    urls.push(chrome.runtime.getURL('beedee_report.json'));
    urls.push(chrome.runtime.getURL('/beedee_report.json'));
  }
  urls.push('beedee_report.json');

  const rows = await fetchJsonAny(urls);
  if (!Array.isArray(rows)) throw new Error('beedee_report.json must be an array');
  if (rows.length > 0) console.log('🔍 JSON row[0] keys:', JSON.stringify(Object.keys(rows[0])), 'values:', JSON.stringify(Object.values(rows[0])));

  const map = new Map();
  rows.forEach(row => {
    const rawVal = row['Hospital Code'] ?? row['HospitalCode'] ?? row['hospitalCode'] ?? row['Code'] ?? row.code ?? row.itemCode;
    if (rawVal == null) return;

    const rawStr  = String(rawVal).trim();
    const normStr = normalizeCode(rawVal);
    if (!rawStr) return;

    // Dynamically find cost — avoids Thai field-name encoding mismatches.
    // Hospital codes are 14-digit numbers (>> 1e8); drug prices are never that large.
    let unitCost = 0;
    for (const val of Object.values(row)) {
      if (typeof val === 'number' && val > 1e8) continue;
      const n = parseMoney(val);
      if (n > 0) { unitCost = n; break; }
    }

    // Dynamically find unit — first short, all-letter string value (TAB, CAP, BOT, Pack…).
    let unit = '';
    for (const val of Object.values(row)) {
      if (typeof val !== 'string') continue;
      const s = val.trim();
      if (s.length >= 1 && s.length <= 12 && !/[\d\s]/.test(s)) { unit = cleanText(s); break; }
    }
    const entry = { unitCost, unit, raw: row };

    // Index by both raw trimmed string and digits-only string so either format matches.
    for (const key of [rawStr, normStr]) {
      if (!key) continue;
      const old = map.get(key);
      if (!old || (old.unitCost === 0 && unitCost > 0)) map.set(key, entry);
    }
  });

  console.log(`💰 Cost map: ${map.size} keys from ${rows.length} JSON records`);
  return map;
}

function normalizeCode(value) {
  return String(value ?? '').replace(/[^0-9]/g, '').trim();
}

function parseMoney(value) {
  const s = String(value ?? '')
    .replace(/,/g, '')
    .replace(/[฿\s]/g, '')
    .trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function parseQty(value) {
  const s = String(value ?? '').replace(/,/g, '').trim();
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCost(item, costMap) {
  // Use || (not ??) so empty strings fall through to the next candidate.
  const rawCode   = item.code || item.itemCode || item['Code'] || item['Hospital Code'] || '';
  const normCode  = normalizeCode(rawCode);
  const trimCode  = String(rawCode).trim();

  // Try both the digits-only key and the raw trimmed key.
  const fromJson = costMap.get(normCode) ?? costMap.get(trimCode) ?? undefined;
  const code = normCode || trimCode;

  const unitCost = Number(fromJson?.unitCost || 0);

  const unit = cleanText(
    fromJson?.unit ||
    item.unit ||
    item.units ||
    item.Unit ||
    item['หน่วย'] ||
    ''
  );

  if (unitCost === 0 && code) {
    console.warn('⚠️ No cost for code:', JSON.stringify(code), '| normCode:', JSON.stringify(normCode), '| found:', fromJson);
  }

  return { code, unitCost, unit };
}

function generatePDF(data, costMap = new Map()) {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('jsPDF not loaded');
    return;
  }

  // User requirement: A4 landscape.
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 8;
  let y = 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Stock Transfer/Issue Report For Beedee', pageW / 2, y, { align: 'center' });
  y += 7;

  let grandTotal = 0;

  const tableData = (data.items || []).map((item, i) => {
    const qty = parseQty(item.qty ?? item.Qty ?? item.quantity);
    const { code, unitCost, unit } = resolveCost(item, costMap);
    const sum = qty * unitCost;
    grandTotal += sum;

    return [
      i + 1,
      code || cleanText(item.code),
      cleanText(item.name ?? item.itemName ?? item['Item name']),
      cleanText(item.batch ?? item.batchId ?? item['Batch ID']),
      cleanText(item.exp ?? item.expDate ?? item['Exp Date']),
      qty ? String(qty) : '',
      unit,
      unitCost.toFixed(2),
      sum.toFixed(2),
    ];
  });

  tableData.push(['', '', '', '', '', '', '', 'TOTAL', grandTotal.toFixed(2)]);

  doc.autoTable({
    startY: y,
    margin: { left: marginX, right: marginX },
    tableWidth: pageW - marginX * 2,
    head: [[
      'No',
      'Code',
      'Item name',
      'Batch ID',
      'Exp Date',
      'Qty',
      'Units',
      'UnitCost',
      'Sum',
    ]],
    body: tableData,
    styles: {
      font: 'helvetica',
      fontSize: 8,
      cellPadding: 1.2,
      overflow: 'linebreak',
      valign: 'middle',
      lineWidth: 0.1,
      minCellHeight: 5.5,
    },
    headStyles: {
      fontStyle: 'bold',
      halign: 'center',
      fillColor: [230, 230, 230],
      textColor: [0, 0, 0],
    },
    bodyStyles: {
      textColor: [0, 0, 0],
    },
    columnStyles: {
      0: { halign: 'center', cellWidth: 10 },
      1: { cellWidth: 31 },
      2: { cellWidth: 102 },
      3: { cellWidth: 31 },
      4: { cellWidth: 28 },
      5: { halign: 'right', cellWidth: 13 },
      6: { cellWidth: 22 },
      7: { halign: 'right', cellWidth: 22 },
      8: { halign: 'right', cellWidth: 22 },
    },
    didParseCell: function (hookData) {
      const lastRowIndex = tableData.length - 1;
      if (hookData.row.section === 'body' && hookData.row.index === lastRowIndex) {
        hookData.cell.styles.fontStyle = 'bold';
        if (hookData.column.index === 7) {
          hookData.cell.text = ['TOTAL'];
          hookData.cell.styles.halign = 'right';
        }
      }
    },
  });

  const filename = cleanText(data.stNumber || `Beedee_Report_${Date.now()}`) + '.pdf';
  doc.save(filename);

  setTimeout(() => window.close(), 500);
}
