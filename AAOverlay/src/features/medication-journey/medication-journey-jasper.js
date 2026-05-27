/* ── medication-journey-jasper.js ─────────────────────────────────────────
   Fetches the Jasper medication-review XLS and parses BIFF8/OLE2 binary.
──────────────────────────────────────────────────────────────────────────── */
"use strict";
(function () {
  const NS = (window.MedicationJourney = window.MedicationJourney || {});

  /* ── fetchMedicationReviewXls ────────────────────────────────────────── */
  NS.fetchMedicationReviewXls = function fetchMedicationReviewXls(jasperUrl) {
    return new Promise(function (resolve) {
      let done  = false;
      let timer = null;

      timer = setTimeout(function () {
        if (!done) { done = true; resolve(null); }
      }, 25000);

      try {
        chrome.runtime.sendMessage({ type: "MJ_FETCH_XLS", url: jasperUrl }, function (resp) {
          if (done) return;
          clearTimeout(timer);
          done = true;
          if (chrome.runtime.lastError || !resp) { resolve(null); return; }
          if (resp.ok && resp.data) {
            try {
              resolve(new Uint8Array(resp.data).buffer);
            } catch (_) { resolve(null); }
          } else {
            resolve(null);
          }
        });
      } catch (_) {
        if (!done) { done = true; clearTimeout(timer); resolve(null); }
      }
    });
  };

  /* ── parseBiff8ToSheets ──────────────────────────────────────────────── */
  NS.parseBiff8ToSheets = function parseBiff8ToSheets(buffer) {
    const u8  = new Uint8Array(buffer);
    const dv  = new DataView(buffer);

    /* ── DataView helpers ──────────────────────────────────────────────── */
    function U8(off)    { return dv.getUint8(off); }
    function U16(off)   { return dv.getUint16(off, true); }
    function U32(off)   { return dv.getUint32(off, true); }
    function I32(off)   { return dv.getInt32(off, true); }
    function F64(off)   { return dv.getFloat64(off, true); }

    /* ── Verify OLE2 magic ─────────────────────────────────────────────── */
    if (U32(0) !== 0xE011CFD0) return [];

    /* ── OLE2 header fields ────────────────────────────────────────────── */
    const sectorSize       = 1 << U16(0x1E);
    const miniSectorSize   = 1 << U16(0x20);
    const miniStreamCutoff = U32(0x38);
    const fatCount         = U32(0x2C);
    const dirStart         = U32(0x30);
    const miniFatStart     = U32(0x3C);

    /* ── Read FAT ──────────────────────────────────────────────────────── */
    const fat = new Int32Array(buffer.byteLength / 4);
    let fatFilled = 0;

    /* DIFAT entries in header: offsets 0x4C..0xC8 (109 entries × 4 bytes) */
    for (let i = 0; i < 109 && i < fatCount; i++) {
      const secId = U32(0x4C + i * 4);
      if (secId >= 0xFFFFFFF8) break;
      const secOff = (secId + 1) * sectorSize;
      for (let j = 0; j < sectorSize / 4; j++) {
        if (fatFilled < fat.length) fat[fatFilled++] = I32(secOff + j * 4);
      }
    }

    /* ── Follow FAT chain for a sector stream ──────────────────────────── */
    function readSectorChain(startSec, maxBytes) {
      const chunks = [];
      let sec      = startSec;
      let total    = 0;
      while (sec >= 0 && sec < 0xFFFFFFF8) {
        const off = (sec + 1) * sectorSize;
        const len = Math.min(sectorSize, buffer.byteLength - off);
        if (len <= 0) break;
        chunks.push(u8.slice(off, off + len));
        total += len;
        if (maxBytes && total >= maxBytes) break;
        sec = fat[sec];
        if (sec === undefined) break;
      }
      /* Concatenate */
      const result = new Uint8Array(total);
      let pos = 0;
      for (const c of chunks) { result.set(c, pos); pos += c.length; }
      return result;
    }

    /* ── Parse directory ───────────────────────────────────────────────── */
    const dirData  = readSectorChain(dirStart);
    const dirDV    = new DataView(dirData.buffer, dirData.byteOffset, dirData.byteLength);
    const dirCount = dirData.byteLength / 128;

    const dirEntries = [];
    for (let i = 0; i < dirCount; i++) {
      const base    = i * 128;
      const nameLen = dirDV.getUint16(base + 64, true);
      const type    = dirDV.getUint8(base + 66);
      const start   = dirDV.getUint32(base + 116, true);
      const size    = dirDV.getUint32(base + 120, true);
      /* Decode UTF-16LE name */
      let name = "";
      for (let c = 0; c < (nameLen > 0 ? nameLen - 2 : 0); c += 2) {
        name += String.fromCharCode(dirDV.getUint16(base + c, true));
      }
      dirEntries.push({ name, type, start, size });
    }

    /* Root entry (index 0) */
    const rootEntry = dirEntries[0];

    /* Find Workbook stream */
    const wbEntry = dirEntries.find(e => /^workbook$/i.test(e.name) || /^book$/i.test(e.name));
    if (!wbEntry) return [];

    /* ── Read Workbook bytes ───────────────────────────────────────────── */
    let wbBytes;

    if (wbEntry.size < miniStreamCutoff) {
      /* Read from mini stream */
      /* Root entry's data = the mini stream container */
      const miniStreamData = readSectorChain(rootEntry.start);
      /* Read mini FAT chain */
      const miniFatData = readSectorChain(miniFatStart);
      const miniFat     = new Int32Array(miniFatData.buffer, miniFatData.byteOffset, miniFatData.byteLength / 4);

      /* Follow mini FAT chain for wbEntry */
      const chunks2 = [];
      let msec = wbEntry.start;
      let totalMs = 0;
      while (msec >= 0 && msec < 0xFFFFFFF8) {
        const msOff = msec * miniSectorSize;
        const msLen = Math.min(miniSectorSize, miniStreamData.byteLength - msOff);
        if (msLen <= 0) break;
        chunks2.push(miniStreamData.slice(msOff, msOff + msLen));
        totalMs += msLen;
        msec = miniFat[msec];
        if (msec === undefined) break;
      }
      const wbRaw = new Uint8Array(totalMs);
      let pms = 0;
      for (const c of chunks2) { wbRaw.set(c, pms); pms += c.length; }
      wbBytes = wbRaw;
    } else {
      wbBytes = readSectorChain(wbEntry.start, wbEntry.size);
    }

    const wbDV = new DataView(wbBytes.buffer, wbBytes.byteOffset, wbBytes.byteLength);

    /* ── BIFF8 record parser ───────────────────────────────────────────── */
    const sheets        = [];
    let   currentSheet  = -1;   /* index into sheets[], -1 = globals */
    let   inGlobals     = true; /* true until first Worksheet BOF */
    const sst           = [];
    let   sstBuilding   = false;
    let   sstUnique     = 0;
    let   sstParsed     = 0;
    let   sstAccum      = null; /* Uint8Array accumulator for SST + CONTINUE */
    let   sstAccumOff   = 0;

    /* Decode a BIFF8 XL unicode string starting at offset in a DataView/U8 */
    function decodeBiff8String(dv2, u8_2, off, charCount) {
      const flags  = dv2.getUint8(off);
      const isWide = (flags & 0x01) !== 0;
      const hasRt  = (flags & 0x08) !== 0;
      const hasExt = (flags & 0x04) !== 0;
      let   pos    = off + 1;

      let runCount = 0;
      let extLen   = 0;
      if (hasRt)  { runCount = dv2.getUint16(pos, true); pos += 2; }
      if (hasExt) { extLen   = dv2.getUint32(pos, true); pos += 4; }

      let str = "";
      if (isWide) {
        for (let c = 0; c < charCount; c++) {
          str += String.fromCharCode(dv2.getUint16(pos, true));
          pos += 2;
        }
      } else {
        for (let c = 0; c < charCount; c++) {
          str += String.fromCharCode(u8_2[pos]);
          pos++;
        }
      }

      /* Skip rich-text run table and extended data */
      pos += runCount * 4 + extLen;

      return { str, nextOff: pos };
    }

    /* Parse accumulated SST bytes */
    function parseAccumulatedSst() {
      if (!sstAccum) return;
      const sdv = new DataView(sstAccum.buffer, sstAccum.byteOffset, sstAccum.byteLength);
      let   p   = 8; /* skip totalStrings(4) + uniqueStrings(4) */
      for (let s = 0; s < sstUnique && p < sstAccum.byteLength - 2; s++) {
        const charCount = sdv.getUint16(p, true);
        p += 2;
        try {
          const { str, nextOff } = decodeBiff8String(sdv, sstAccum, p, charCount);
          sst.push(str);
          p = nextOff;
        } catch (_) {
          sst.push("");
          p = sstAccum.byteLength; /* bail */
        }
      }
      sstBuilding = false;
      sstAccum    = null;
    }

    function setCell(sheetIdx, row, col, val) {
      if (sheetIdx < 0 || sheetIdx >= sheets.length) return;
      const sh = sheets[sheetIdx];
      while (sh.rows.length <= row) sh.rows.push([]);
      sh.rows[row][col] = val;
    }

    /* Decode RK value per BIFF8 spec */
    function decodeRk(rkVal) {
      const divBy100 = (rkVal & 0x01) !== 0;
      const isInt    = (rkVal & 0x02) !== 0;
      let   num;
      if (isInt) {
        num = rkVal >> 2;
      } else {
        const tmp = new DataView(new ArrayBuffer(8));
        tmp.setInt32(0, 0, true);
        tmp.setInt32(4, rkVal & 0xFFFFFFFC, true);
        num = tmp.getFloat64(0, true);
      }
      if (divBy100) num /= 100;
      return num;
    }

    let   pos  = 0;
    const wbLen = wbBytes.byteLength;

    while (pos + 4 <= wbLen) {
      const recType = wbDV.getUint16(pos, true);
      const recLen  = wbDV.getUint16(pos + 2, true);
      const recOff  = pos + 4;
      pos += 4 + recLen;

      if (pos > wbLen + 4) break; /* safety */

      /* CONTINUE record: append bytes to SST accumulator */
      if (recType === 0x003C) {
        if (sstBuilding && sstAccum) {
          /* Append recLen bytes starting at recOff to sstAccum */
          const extra = wbBytes.slice(recOff, recOff + recLen);
          const merged = new Uint8Array(sstAccum.byteLength + extra.byteLength);
          merged.set(sstAccum);
          merged.set(extra, sstAccum.byteLength);
          sstAccum = merged;
          /* Check if we have accumulated enough to parse */
          /* We'll keep accumulating and parse when the next non-CONTINUE record arrives */
        }
        continue;
      }

      /* If SST was accumulating and this is not CONTINUE, parse it now */
      if (sstBuilding && sstAccum) {
        parseAccumulatedSst();
      }

      switch (recType) {

        /* BOF — Beginning of a sub-stream */
        case 0x0009:
        case 0x0209:
        case 0x0409: {
          if (recLen >= 6) {
            const bofType = wbDV.getUint16(recOff + 2, true);
            /* 0x0005 = workbook globals, 0x0010 = worksheet, 0x0020 = chart */
            if (bofType === 0x0010) {
              /* Worksheet */
              currentSheet++;
              inGlobals = false;
            } else if (bofType === 0x0005) {
              inGlobals = true;
            }
          } else if (recLen >= 4) {
            /* Older BOF — just increment if not first */
            if (!inGlobals) currentSheet++;
            inGlobals = false;
          }
          break;
        }

        /* BOUNDSHEET — sheet tab definition (in globals) */
        case 0x0085: {
          if (recLen < 8) break;
          const nameLen2 = wbDV.getUint8(recOff + 6);
          const flags2   = wbDV.getUint8(recOff + 7);
          const isWide2  = (flags2 & 0x01) !== 0;
          let   shName   = "";
          const nameOff  = recOff + 8;
          if (isWide2) {
            for (let c = 0; c < nameLen2; c++) {
              shName += String.fromCharCode(wbDV.getUint16(nameOff + c * 2, true));
            }
          } else {
            for (let c = 0; c < nameLen2; c++) {
              shName += String.fromCharCode(wbBytes[nameOff + c]);
            }
          }
          sheets.push({ name: shName, rows: [] });
          break;
        }

        /* SST — Shared String Table */
        case 0x00FC: {
          if (recLen < 8) break;
          sstUnique  = wbDV.getUint32(recOff + 4, true);
          sstBuilding = true;
          sstParsed   = 0;
          sst.length  = 0;
          /* Copy all bytes of this record (including the 8-byte header) into accumulator */
          sstAccum = wbBytes.slice(recOff, recOff + recLen);
          break;
        }

        /* LABELSST — string cell referencing SST */
        case 0x00FD: {
          if (recLen < 10) break;
          const row2   = wbDV.getUint16(recOff, true);
          const col2   = wbDV.getUint16(recOff + 2, true);
          const sstIdx = wbDV.getUint32(recOff + 6, true);
          setCell(currentSheet, row2, col2, sst[sstIdx] || "");
          break;
        }

        /* LABEL — inline string cell */
        case 0x0204: {
          if (recLen < 9) break;
          const row3    = wbDV.getUint16(recOff, true);
          const col3    = wbDV.getUint16(recOff + 2, true);
          const charCnt = wbDV.getUint16(recOff + 6, true);
          try {
            const { str } = decodeBiff8String(wbDV, wbBytes, recOff + 8, charCnt);
            setCell(currentSheet, row3, col3, str);
          } catch (_) { /* skip bad string */ }
          break;
        }

        /* NUMBER — IEEE 754 double cell */
        case 0x0203: {
          if (recLen < 14) break;
          const row4 = wbDV.getUint16(recOff, true);
          const col4 = wbDV.getUint16(recOff + 2, true);
          const val4 = F64(recOff + 6);
          setCell(currentSheet, row4, col4, String(val4));
          break;
        }

        /* RK — compressed numeric value */
        case 0x0027:
        case 0x027E: {
          if (recLen < 10) break;
          const row5  = wbDV.getUint16(recOff, true);
          const col5  = wbDV.getUint16(recOff + 2, true);
          const rkVal = I32(recOff + 6);
          setCell(currentSheet, row5, col5, String(decodeRk(rkVal)));
          break;
        }

        /* MULRK — multiple RK values in one row */
        case 0x00BE: {
          if (recLen < 6) break;
          const row6     = wbDV.getUint16(recOff, true);
          const firstCol = wbDV.getUint16(recOff + 2, true);
          /* Each entry is 6 bytes: xf(2) + rk(4). Last 2 bytes = last column index. */
          const entryCount = (recLen - 2) / 6;
          for (let e = 0; e < entryCount; e++) {
            const eOff = recOff + 4 + e * 6;
            if (eOff + 6 > recOff + recLen) break;
            const rkVal2 = I32(eOff + 2);
            setCell(currentSheet, row6, firstCol + e, String(decodeRk(rkVal2)));
          }
          break;
        }

        default:
          break;
      }
    }

    /* If SST was still accumulating at end of stream */
    if (sstBuilding && sstAccum) parseAccumulatedSst();

    /* Filter empty rows */
    for (const sh of sheets) {
      sh.rows = sh.rows.filter(row => row && row.some(cell => cell !== undefined && cell !== null && cell !== ""));
    }

    return sheets;
  };

  /* ── parseJasperXlsOrders ────────────────────────────────────────────── */
  NS.parseJasperXlsOrders = function parseJasperXlsOrders(sheets) {
    const COL_MAP2 = {
      "code":                "code",
      "order item":          "drugName",
      "drug name":           "drugName",
      "drug":                "drugName",
      "order date":          "orderDate",
      "order number":        "orderNumber",
      "order no":            "orderNumber",
      "status":              "status",
      "dosage":              "dosage",
      "dose":                "dosage",
      "route":               "route",
      "frequency":           "frequency",
      "duration":            "duration",
      "quantity":            "quantity",
      "qty":                 "quantity",
      "comments":            "comments",
      "instruction":         "instruction",
      "instructions":        "instruction",
      "infusion rate":       "infusionRate",
      "infusion duration":   "infusionDuration",
      "careprovider":        "careprovider",
      "care provider":       "careprovider",
      "med review":          "medReview",
      "start date":          "startDateTime",
      "start":               "startDateTime",
      "end date":            "endDateTime",
      "end":                 "endDateTime",
      "order by":            "orderBy",
      "order type":          "orderType",
      "category type":       "categoryType",
      "type":                "type",
      "order from":          "orderFrom",
      "order to department": "orderToDepartment",
      "priority":            "priority",
    };

    /* Find first sheet with more than 1 row (skip parameter-only sheets) */
    let dataSheet = null;
    for (const sh of sheets) {
      if (sh.rows && sh.rows.length > 1) { dataSheet = sh; break; }
    }
    if (!dataSheet) return [];

    /* Build field index from first (header) row */
    const headerRow = dataSheet.rows[0] || [];
    const fieldIdx  = {};
    for (let i = 0; i < headerRow.length; i++) {
      const h = String(headerRow[i] || "").trim().toLowerCase();
      if (COL_MAP2[h]) fieldIdx[i] = COL_MAP2[h];
    }

    const orders = [];
    for (let r = 1; r < dataSheet.rows.length; r++) {
      const row = dataSheet.rows[r] || [];
      const obj = {};
      for (const [idxStr, field] of Object.entries(fieldIdx)) {
        const idx = Number(idxStr);
        obj[field] = String(row[idx] || "").trim();
      }
      if (!obj.drugName) continue;
      orders.push(obj);
    }

    return orders;
  };


  /* ── parseEmarCrosstabAdminTimes ─────────────────────────────────────── */
  NS.parseEmarCrosstabAdminTimes = function parseEmarCrosstabAdminTimes(sheets) {
    /* Returns [{ drugName, adminDatetimes: ["2026-05-20T14:00", ...] }] */

    function _parseEmarDt(str) {
      if (!str) return null;
      str = String(str).trim();
      /* "DD/MM/YYYY HH:MM" */
      let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T\s]+(\d{2}:\d{2}))?/);
      if (m) {
        const base = `${m[3]}-${String(m[2]).padStart(2,"0")}-${String(m[1]).padStart(2,"0")}`;
        return m[4] ? `${base}T${m[4]}` : base;
      }
      /* "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM" */
      m = str.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
      if (m) return `${m[1]}T${m[2]}`;
      /* "YYYY-MM-DD" alone */
      m = str.match(/^(\d{4}-\d{2}-\d{2})$/);
      if (m) return m[1];
      return null;
    }

    const adminMap = {}; /* drugName -> Set<datetimeStr> */

    for (const sh of sheets) {
      if (!sh.rows || sh.rows.length < 2) continue;
      const header = sh.rows[0] || [];

      /* ── Strategy 1: crosstab — col 0 = drug, remaining cols = datetime slots ── */
      const dtCols = [];
      for (let c = 1; c < header.length; c++) {
        const dt = _parseEmarDt(String(header[c] || "").trim());
        if (dt) dtCols.push({ col: c, dt });
      }

      if (dtCols.length > 0) {
        for (let r = 1; r < sh.rows.length; r++) {
          const row  = sh.rows[r] || [];
          const drug = String(row[0] || "").trim();
          if (!drug) continue;
          if (!adminMap[drug]) adminMap[drug] = new Set();
          for (const { col, dt } of dtCols) {
            const cell = String(row[col] || "").trim();
            /* Non-empty, not a dash/zero/N = administered */
            if (cell && cell !== "-" && cell !== "–" && cell !== "0" &&
                cell.toLowerCase() !== "n" && cell.toLowerCase() !== "no" &&
                cell.toLowerCase() !== "not given" && cell.toLowerCase() !== "refused") {
              adminMap[drug].add(dt);
            }
          }
        }
        continue; /* skip strategy 2 for this sheet */
      }

      /* ── Strategy 2: flat table — Drug | Date | Time | Status | ... ── */
      const fi = {};
      for (let c = 0; c < header.length; c++) {
        const h = String(header[c] || "").trim().toLowerCase();
        if (fi.drug    === undefined && /drug|item|order|med|ยา/.test(h))          fi.drug    = c;
        if (fi.date    === undefined && /^date$|วันที่/.test(h))                    fi.date    = c;
        if (fi.time    === undefined && /^time$|เวลา/.test(h))                      fi.time    = c;
        if (fi.dt      === undefined && /datetime|date.*time|actual.*time/.test(h)) fi.dt      = c;
        if (fi.status  === undefined && /status|given|administer|actual/.test(h))   fi.status  = c;
      }
      if (fi.drug === undefined) continue;

      for (let r = 1; r < sh.rows.length; r++) {
        const row  = sh.rows[r] || [];
        const drug = String(row[fi.drug] || "").trim();
        if (!drug) continue;

        if (fi.status !== undefined) {
          const st = String(row[fi.status] || "").trim().toLowerCase();
          if (!st || st === "not given" || st === "refused" || st === "n" || st === "missed") continue;
        }

        let dtStr = "";
        if (fi.dt !== undefined) {
          dtStr = String(row[fi.dt] || "").trim();
        } else {
          dtStr = String(row[fi.date !== undefined ? fi.date : 0] || "").trim();
          if (fi.time !== undefined) dtStr += " " + String(row[fi.time] || "").trim();
        }

        const dt = _parseEmarDt(dtStr);
        if (dt) {
          if (!adminMap[drug]) adminMap[drug] = new Set();
          adminMap[drug].add(dt);
        }
      }
    }

    return Object.entries(adminMap).map(([drugName, dtSet]) => ({
      drugName,
      adminDatetimes: Array.from(dtSet).sort(),
    }));
  };

})();
