"use strict";

/**
 * features/home-med/parser-home-med.js
 *
 * Reworked: maps the HomeMedSheetReport/Thai Jasper XLS (parsed by
 * MedicationJourney.parseBiff8ToSheets into [{name, rows}]) into structured
 * medication objects, plus extracts the patient header block from the report.
 *
 * Header-agnostic: column titles are matched by fuzzy Thai+English synonyms and
 * partial matches, so the mapper adapts to whatever the report emits. Unmatched
 * columns are reported via getLastUnmatchedColumns() for debugging.
 *
 * Exposed as window.HomeMedParser (used by page-home-med.js).
 */
(function () {
  const _g = typeof globalThis !== "undefined" ? globalThis
           : typeof window !== "undefined" ? window : {};
  if (_g.HomeMedParser) return;

  const HomeMedParser = (() => {
    function norm(s) {
      return String(s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    }
    function lc(s) {
      return norm(s).toLowerCase();
    }
    /* note: norm() above strips U+00A0 (non-breaking space) then collapses runs */

    /* ── Field synonyms (each field: ordered list of substrings to match) ──
     * Matching is partial + case-insensitive against the normalized header.
     * Thai synonyms included because the report is rendered with preflangcode=th.
     */
    const FIELD_SYNONYMS = {
      code:        ["item code", "drug code", "code", "รหัสยา", "รหัส"],
      drug:        ["order item", "drug name", "medication", "drug", "ชื่อยา", "รายการยา"],
      dosage:      ["dosage", "dose", "ขนาดยา", "ขนาด"],
      route:       ["route", "วิธีให้", "ทางให้", "ช่องทาง"],
      frequency:   ["frequency", "freq", "ความถี่"],
      duration:    ["duration", "ระยะเวลา", "จำนวนวัน"],
      quantity:    ["quantity", "qty", "จำนวน"],
      comment:     ["comments", "comment", "instruction", "instructions", "sig", "หมายเหตุ", "คำแนะนำ", "วิธีใช้"],
      provider:    ["careprovider", "care provider", "physician", "doctor", "แพทย์", "ผู้สั่ง"],
      status:      ["status", "สถานะ"],
      orderType:   ["order type", "category type", "type", "ประเภท"],
    };

    let _lastUnmatched = [];

    /** Build a column-index → field map from a header row. */
    function _mapHeaders(headerRow) {
      const fieldIdx = {};
      const used = {};
      const unmatched = [];

      headerRow.forEach((raw, i) => {
        const h = lc(raw);
        if (!h) return;

        let matchedField = null;
        // Prefer the most specific (longest) synonym hit across all fields.
        let bestLen = 0;
        for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
          if (used[field]) continue;
          for (const syn of syns) {
            if (h.includes(syn) && syn.length > bestLen) {
              matchedField = field;
              bestLen = syn.length;
            }
          }
        }

        if (matchedField) {
          fieldIdx[i] = matchedField;
          used[matchedField] = true;
        } else {
          unmatched.push({ index: i, header: norm(raw) });
        }
      });

      _lastUnmatched = unmatched;
      return fieldIdx;
    }

    /** Pick the data sheet — first sheet whose rows look like a med table. */
    function _pickDataSheet(sheets) {
      let best = null;
      let bestScore = -1;
      for (const sh of sheets || []) {
        if (!sh.rows || sh.rows.length < 2) continue;
        // Score header rows by how many known fields they expose.
        for (let h = 0; h < Math.min(sh.rows.length, 5); h++) {
          const idx = _mapHeaders(sh.rows[h] || []);
          const score = Object.keys(idx).length;
          if (score > bestScore && idx) {
            // Must at least find a drug column to be a med table.
            if (Object.values(idx).includes("drug")) {
              best = { sheet: sh, headerRowIndex: h, fieldIdx: idx };
              bestScore = score;
            }
          }
        }
      }
      return best;
    }

    /**
     * Map XLS sheets → structured medication rows.
     * @returns {{ meds: Array<object>, headerRowIndex: number } }
     */
    function mapMedications(sheets) {
      const picked = _pickDataSheet(sheets);
      if (!picked) return { meds: [], headerRowIndex: -1 };

      const { sheet, headerRowIndex, fieldIdx } = picked;
      // Re-run header mapping so _lastUnmatched reflects the chosen header row.
      const idx = _mapHeaders(sheet.rows[headerRowIndex] || []);
      const meds = [];

      for (let r = headerRowIndex + 1; r < sheet.rows.length; r++) {
        const row = sheet.rows[r] || [];
        const obj = {};
        for (const [iStr, field] of Object.entries(idx)) {
          obj[field] = norm(row[Number(iStr)] || "");
        }
        if (!obj.drug) continue;
        if (obj.status && /cancel/i.test(obj.status)) continue;
        meds.push(obj);
      }

      return { meds, headerRowIndex };
    }

    /* ── Oral + patient-self-administered take-home filter ──────────────────
     * Keep: oral (Take / รับประทาน / PO), throat/nasal/oral spray, topical
     *       (Apply / ทา / gel / cream / ointment), eye/ear drops, nasal.
     * Drop: injectables / IV (Inject / Infuse / INJ / Vial / Amp / Bag / IV).
     */
    function _matchAny(text, patterns) {
      return patterns.some((p) => p.test(text));
    }

    const DROP_PATTERNS = [
      /\binject\b/i, /\binfuse\b/i, /\binfusion\b/i,
      /\bI\.?V\.?\b/i, /\bintravenous\b/i,
      /\bINJ\b/i, /\bvial\b/i, /\bamp(?:oule|ule)?\b/i,
      /\bbag\b/i, /\bsyringe\b/i, /\bcontinuous\b/i,
      /ฉีด/, /หยดเข้าหลอดเลือด/,
    ];

    const KEEP_PATTERNS = [
      /\btake\b/i, /\boral/i, /\bp\.?o\.?\b/i, /\bswallow\b/i,
      /รับประทาน/, /กิน/,
      /\bspray\b/i, /สเปรย์/, /พ่น/,            // throat/nasal/oral spray
      /\bapply\b/i, /\btopical\b/i, /\bgel\b/i, /\bcream\b/i, /\bointment\b/i, /ทา/, // topical
      /\bdrop\b/i, /หยอด/,                        // eye/ear drops
      /\bnasal\b/i, /\bnostril\b/i, /จมูก/,       // nasal
      /\bsublingual\b/i, /\bbuccal\b/i, /อม/, /\bsachet\b/i, /ซอง/,
      /\bsuck\b/i, /\bchew\b/i, /เคี้ยว/,
    ];

    /** True if the med is an oral / patient-self-administered take-home. */
    function isTakeHome(med) {
      const text = `${med.route || ""} ${med.comment || ""} ${med.drug || ""} ${med.frequency || ""} ${med.dosage || ""} ${med.quantity || ""}`;

      // Explicit injectable/IV always drops, even if a keep token also appears.
      if (_matchAny(text, DROP_PATTERNS)) return false;

      // Otherwise keep when a take-home signal is present.
      return _matchAny(text, KEEP_PATTERNS);
    }

    function filterTakeHome(meds) {
      return (meds || []).filter(isTakeHome);
    }

    /* ── Patient header extraction from the report sheets ──────────────────
     * The HomeMedSheetReport/Thai embeds the patient block as label/value
     * pairs ("Name :", "HN :", ...) somewhere in the sheet cells. Scan all
     * cells of the data sheet (and any small parameter sheet) for these.
     */
    const HEADER_FIELDS = {
      patientName:   [/^name$/i, /ชื่อ(?:ผู้ป่วย|-สกุล)?$/],
      hn:            [/^hn$/i],
      physician:     [/^physician$/i, /แพทย์/],
      nationality:   [/^nationality$/i, /สัญชาติ/],
      visitDate:     [/visit\s*date/i, /วันที่.*(?:visit|เข้ารับ)/i],
      birthDate:     [/birth\s*date/i, /วันเกิด/],
      allergies:     [/^allerg/i, /แพ้ยา|แพ้/],
      sideEffects:   [/side\s*effect/i, /ผลข้างเคียง/],
      room:          [/^room$/i, /ห้อง|เตียง/],
      department:    [/^department$/i, /แผนก/],
      age:           [/^age$/i, /อายุ/],
      gender:        [/^gender$/i, /เพศ/],
    };

    function extractPatientHeader(sheets) {
      const out = {};
      for (const sh of sheets || []) {
        for (const row of sh.rows || []) {
          for (let c = 0; c < row.length; c++) {
            const cell = norm(row[c]);
            if (!cell) continue;
            // Label cells often end with ":" or are followed by the value cell.
            const label = cell.replace(/[:：]\s*$/, "");
            for (const [field, pats] of Object.entries(HEADER_FIELDS)) {
              if (out[field]) continue;
              if (pats.some((p) => p.test(label))) {
                // Value is the rest of this cell after ":" or the next cell.
                const inline = cell.split(/[:：]/).slice(1).join(":").trim();
                const next = norm(row[c + 1]);
                const val = inline || next;
                if (val) out[field] = val;
              }
            }
          }
        }
      }
      return out;
    }

    function getLastUnmatchedColumns() {
      return _lastUnmatched.slice();
    }

    return {
      mapMedications,
      filterTakeHome,
      isTakeHome,
      extractPatientHeader,
      getLastUnmatchedColumns,
    };
  })();

  _g.HomeMedParser = HomeMedParser;
})();
