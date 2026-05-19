"use strict";

// Workbook parsing and sticker-block normalization.
window.JasperParser = (() => {
  const { cleanupCell, decodeHtmlEntities } = window.JasperShared;

  function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  function parseHtmlTableWorkbook(text) {
    const doc    = new DOMParser().parseFromString(text, 'text/html');
    const tables = [...doc.querySelectorAll('table')];
    const sheets = {};

    if (tables.length) {
      tables.forEach((table, i) => {
        const name = table.getAttribute('name') || table.getAttribute('id') || `Table ${i + 1}`;
        sheets[name] = [...table.querySelectorAll('tr')].map((tr) =>
          [...tr.querySelectorAll('th,td')].map((td) => cleanupCell(td.textContent))
        );
      });
      return { sheetNames: Object.keys(sheets), sheets };
    }

    // Fallback: plain text (CSV / TSV)
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    sheets['Raw Text'] = lines.map((line) =>
      line.split(/\t|,/).map((cell) => cleanupCell(decodeHtmlEntities(cell)))
    );
    return { sheetNames: ['Raw Text'], sheets };
  }

  async function workbookToRows(arrayBuffer, contentType = '') {
    const probe      = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer.slice(0, 5000));
    const looksHtml  = /<html|<table|<tr|<td/i.test(probe) || /text\/html/i.test(contentType);

    if (looksHtml) {
      const text = new TextDecoder('utf-8', { fatal: false }).decode(arrayBuffer);
      return parseHtmlTableWorkbook(text);
    }

    if (!window.XLSX) {
      throw new Error('XLSX parser library is missing — check src/libs/xlsx.full.min.js loading order.');
    }

    const opts     = { type: 'array', cellDates: true, raw: false };
    const workbook = typeof XLSX.readAsync === 'function'
      ? await XLSX.readAsync(arrayBuffer, opts)
      : XLSX.read(arrayBuffer, opts);

    const sheets = {};
    workbook.SheetNames.forEach((name) => {
      sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false });
    });
    return { sheetNames: workbook.SheetNames, sheets };
  }

  function guessStickerBlocks(rows) {
    const useful  = rows.filter((row) => row.some((c) => cleanupCell(c) !== ''));
    const blocks  = [];
    let current   = [];

    useful.forEach((row) => {
      const joined = row.map(cleanupCell).filter(Boolean).join(' | ');
      const isNewBlock = /\bHN\b|ผู้ป่วย|Patient|Drug|ยา|AN\b/i.test(joined) && current.length >= 3;
      if (isNewBlock) { blocks.push(current); current = []; }
      current.push(row);
    });

    if (current.length) blocks.push(current);
    return blocks.length ? blocks : [useful];
  }

  function findValueByLabel(text, labels) {
    for (const label of labels) {
      const m = text.match(new RegExp(`${label}\\s*[:：]?\\s*([^|]+)`, 'i'));
      if (m) return cleanupCell(m[1]);
    }
    return '';
  }

  function normalizeBlock(block, index, requestPayload) {
    const flat = block.flat().map(cleanupCell).filter(Boolean);
    const text = flat.join(' | ');

    const hn          = findValueByLabel(text, ['HN']);
    const an          = findValueByLabel(text, ['AN']);
    const patientName = findValueByLabel(text, ['Patient Name', 'Patient', 'ชื่อผู้ป่วย', 'ผู้ป่วย']);
    const ward        = findValueByLabel(text, ['Ward', 'หอผู้ป่วย']);
    const bed         = findValueByLabel(text, ['Bed', 'เตียง']);
    const dose        = findValueByLabel(text, ['Dose', 'ขนาดยา']);
    const route       = findValueByLabel(text, ['Route', 'วิธีให้']);
    const frequency   = findValueByLabel(text, ['Freq', 'Frequency', 'ความถี่']);
    const qty         = findValueByLabel(text, ['Qty', 'Quantity', 'จำนวน']);

    const drugCandidates = flat.filter((x) =>
      !/^(HN|AN|Ward|Bed|Patient|ผู้ป่วย|ชื่อผู้ป่วย|Qty|Dose|Route|Freq)/i.test(x) &&
      !/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(x) &&
      x.length > 3
    );
    const drugName = findValueByLabel(text, ['Drug Name', 'Drug', 'Medication', 'ยา']) || drugCandidates[0] || '';

    return {
      id:          `sticker-${index + 1}`,
      index:       index + 1,
      hn, an, patientName, ward, bed,
      drugName, dose, route, frequency, qty,
      extraText: 'CUSTOM: Verify patient, medication, dose, route, and time before administration.',
      qrText:    JSON.stringify({
        source:          'jasper-ipdsticker',
        capturedAt:      requestPayload.capturedAt,
        patientvisituid: requestPayload.patientvisituid,
        searchstring:    requestPayload.searchstring,
        stickerIndex:    index + 1,
        hn, an, patientName, drugName, dose, route, frequency,
      }),
      rawLines: flat,
      rawBlock: block,
    };
  }

  function normalizeStickerData(parsedWorkbook, requestPayload) {
    const rows = parsedWorkbook.sheets[parsedWorkbook.sheetNames[0]] || [];
    return guessStickerBlocks(rows).map((block, i) => normalizeBlock(block, i, requestPayload));
  }

  return { base64ToArrayBuffer, workbookToRows, normalizeStickerData };
})();
