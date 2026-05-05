"use strict";

(function () {
  const _g = typeof globalThis !== "undefined" ? globalThis
           : typeof window !== "undefined" ? window : {};
  if (_g.ParserDischargeList) return;

  const ParserDischargeList = (() => {

  const { norm } = window.CoreDom;
  const { formatHN } = window.CoreUtils;

  const PHARMACIST_SEL =
    "body > div.full-height.ng-scope.layout-row > div > md-toolbar" +
    " > div > md-menu:nth-child(9) > button > span";

  const TABLE_CONTAINER_SEL =
    "body > div.full-height.ng-scope.layout-row > div > md-content" +
    " > div > md-card > md-card-content > md-table-container";

  // Accept any tr — don't anchor on Angular classes
  const LIST_ROWS_SEL      = "md-table-container table > tbody > tr";
  const BANNER_IN_FIRST_TD = "td:nth-child(1) patient-banner";

  const MRN_RE = /^\d{2}-\d{2}-\d{6}$/;

  /* ── Pharmacist ──────────────────────────────────────────────── */
  function getPharmacistName() {
    const el = document.querySelector(PHARMACIST_SEL);
    return el ? norm(el.textContent) : "";
  }

  /* ── Find column indices from header row ─────────────────────── */
  function _getColMap(table) {
    const map = { mrn: -1, name: -1, bed: -1, ward: -1 };
    const ths = Array.from(table.querySelectorAll("thead th"));
    ths.forEach((th, i) => {
      const h = norm(th.innerText || th.textContent || "").toLowerCase();
      if (h === "mrn" || h === "hn")           map.mrn  = i;
      else if (h === "name")                    map.name = i;
      else if (h === "bed")                     map.bed  = i;
      else if (h === "from ward" || h === "ward") map.ward = i;
    });
    return map;
  }

  /* ── Parse one <tr> DOM element → { name, hn, bed, mrn } ───── *
   * Two strategies:
   *  A) Table has plain td cells (discharge-list) — read by col index
   *  B) Table has patient-banner in first td — extract from DOM
   */
  function parsePatientRow(row, colMap) {
    if (!row) return null;

    /* ── Strategy A: plain td cells (preferred for discharge list) */
    if (colMap && colMap.mrn >= 0) {
      const tds  = Array.from(row.querySelectorAll("td"));
      const mrn  = norm(tds[colMap.mrn]?.innerText  || tds[colMap.mrn]?.textContent  || "");
      const name = norm(tds[colMap.name]?.innerText || tds[colMap.name]?.textContent || "");
      const bed  = norm(tds[colMap.bed]?.innerText  || tds[colMap.bed]?.textContent  || "");
      const ward = norm(tds[colMap.ward]?.innerText || tds[colMap.ward]?.textContent || "");

      if (MRN_RE.test(mrn)) {
        return {
          mrn,
          name:    name || mrn,
          bed:     bed  || "",
          ward:    ward || "",
          hn:      mrn,
        };
      }
      // Row might not have MRN in expected column — fall through to strategy B
    }

    /* ── Strategy B: patient-banner component (EMR / other pages) */
    const pb = row.querySelector(BANNER_IN_FIRST_TD);

    // No banner → scan every cell for MRN pattern as last resort
    if (!pb) {
      const tds = Array.from(row.querySelectorAll("td"));
      for (let i = 0; i < tds.length; i++) {
        const t = norm(tds[i].innerText || tds[i].textContent || "");
        if (MRN_RE.test(t)) {
          return { mrn: t, name: t, bed: "", ward: "", hn: t };
        }
      }
      return null;
    }

    // Banner exists — extract MRN from any span
    let mrn = "";
    for (const span of pb.querySelectorAll("span")) {
      const t = norm(span.textContent);
      if (MRN_RE.test(t)) { mrn = t; break; }
    }
    if (!mrn) return null;

    // Name: visible ng-binding text that is not the MRN
    let name = "";
    for (const el of pb.querySelectorAll("[class*='ng-binding'],[class*='overme']")) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      const t = norm(el.textContent).replace(/\(\s*\d{2}-\d{2}-\d{6}\s*\)/g, "").trim();
      if (!t || MRN_RE.test(t) || /^\d+$/.test(t) || t.length < 3) continue;
      name = t;
      break;
    }

    // Bed: scan non-banner tds for short room code
    let bed = "";
    const tds = Array.from(row.querySelectorAll("td")).slice(1);
    for (const td of tds) {
      const t = norm(td.innerText || td.textContent || "");
      if (t && t !== mrn && /^[A-Za-z]{0,4}\d{1,4}[A-Za-z/]?$/.test(t) && t.length <= 8) {
        bed = t; break;
      }
    }

    return { mrn, name: name || mrn, bed, ward: "", hn: mrn };
  }

  /* ── Parse all visible rows (no colMap — banner strategy) ────── */
  function parseAllPatientRows() {
    return Array.from(document.querySelectorAll(LIST_ROWS_SEL))
      .map(tr => parsePatientRow(tr, null))
      .filter(p => p && p.mrn);
  }

  /* ── Scrape full table ───────────────────────────────────────── */
  function scrapeTable() {
    const wrap = document.querySelector(TABLE_CONTAINER_SEL);
    if (!wrap) return { headers: [], rows: [], patientMeta: {} };

    const table = wrap.querySelector("table");
    if (!table) return { headers: [], rows: [], patientMeta: {} };

    const headers = Array.from(table.querySelectorAll("thead th"))
      .map(th => norm(th.innerText || th.textContent || ""))
      .filter(Boolean);

    // Build column map from headers
    const colMap = _getColMap(table);

    const patientMeta = {};
    const domRows     = Array.from(table.querySelectorAll("tbody tr"));

    const rows = domRows.map(tr => {
      const cells = Array.from(tr.querySelectorAll("td")).map(td =>
        norm(td.innerText || td.textContent || "")
      );
      if (!cells.some(c => c !== "")) return null;

      const parsed = parsePatientRow(tr, colMap);
      if (parsed && parsed.mrn) {
        patientMeta[parsed.mrn] = {
          name: parsed.name,
          bed:  parsed.bed,
          ward: parsed.ward,
          hn:   parsed.hn,
        };
        // Inject MRN into cells if missing
        if (!cells.some(c => MRN_RE.test(c.trim()))) cells.push(parsed.mrn);
      }
      return cells;
    }).filter(Boolean);

    return { headers, rows, patientMeta };
  }

  return {
    getPharmacistName,
    parsePatientRow,
    parseAllPatientRows,
    scrapeTable,
  };

})();

  _g.ParserDischargeList = ParserDischargeList;
})();
