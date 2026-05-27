/* ── medication-journey-parser-html.js ────────────────────────────────────
   Parses the ArcusAir order-profile table (DOM) into raw order objects.
──────────────────────────────────────────────────────────────────────────── */
"use strict";
(function () {
  const NS = (window.MedicationJourney = window.MedicationJourney || {});

  /* ── Column header → field name map ─────────────────────────────────── */
  const COL_MAP = {
    "code":                    "code",
    "order item":              "drugName",
    "drug name":               "drugName",
    "drug":                    "drugName",
    "order date":              "orderDate",
    "order number":            "orderNumber",
    "order no":                "orderNumber",
    "status":                  "status",
    "dosage":                  "dosage",
    "dose":                    "dosage",
    "route":                   "route",
    "frequency":               "frequency",
    "duration":                "duration",
    "quantity":                "quantity",
    "qty":                     "quantity",
    "comments":                "comments",
    "instruction":             "instruction",
    "instructions":            "instruction",
    "infusion rate":           "infusionRate",
    "infusion duration":       "infusionDuration",
    "careprovider":            "careprovider",
    "care provider":           "careprovider",
    "med review":              "medReview",
    "start date":              "startDateTime",
    "start":                   "startDateTime",
    "end date":                "endDateTime",
    "end":                     "endDateTime",
    "order by":                "orderBy",
    "order type":              "orderType",
    "category type":           "categoryType",
    "type":                    "type",
    "order from":              "orderFrom",
    "order to department":     "orderToDepartment",
    "priority":                "priority",
  };

  /* ── Fallback column positions when no header is found ──────────────── */
  const FALLBACK_COL = {
    0:  "code",
    1:  "drugName",
    4:  "orderDate",
    5:  "orderNumber",
    8:  "status",
    9:  "priority",
    10: "dosage",
    11: "route",
    12: "frequency",
    13: "duration",
    14: "quantity",
    15: "comments",
    16: "instruction",
    17: "infusionRate",
    18: "infusionDuration",
    19: "careprovider",
    20: "medReview",
    25: "startDateTime",
    26: "endDateTime",
    27: "orderBy",
    28: "orderType",
    29: "categoryType",
    30: "type",
    31: "orderFrom",
    32: "orderToDepartment",
  };

  /* ── parseOrderProfileTable ──────────────────────────────────────────── */
  NS.parseOrderProfileTable = function parseOrderProfileTable(doc) {
    doc = doc || document;
    const orders = [];

    const table = doc.querySelector('table[name="orderprofiletable"]');
    if (!table) return orders;

    /* Build column index from thead */
    const colIndex = {};
    let hasHeader  = false;
    const thead    = table.querySelector("thead");
    if (thead) {
      const headerCells = thead.querySelectorAll("th, td");
      headerCells.forEach((th, i) => {
        const text = (th.textContent || "").trim().toLowerCase();
        if (COL_MAP[text]) {
          colIndex[i]  = COL_MAP[text];
          hasHeader    = true;
        }
      });
    }

    /* Fall back to positional if no header matched */
    const resolvedIndex = hasHeader ? colIndex : FALLBACK_COL;

    /* Iterate data rows */
    const rows = table.querySelectorAll("tbody tr[md-row]");
    for (const tr of rows) {
      const cells = tr.querySelectorAll("td");
      const obj   = {};

      /* Extract each mapped column */
      cells.forEach((td, i) => {
        const field = resolvedIndex[i];
        if (!field) return;
        obj[field] = (td.textContent || "").trim();
      });

      /* Prefer drug name from monograph span if present */
      const monographSpan = tr.querySelector('[id^="showMonographname"] span.ng-binding');
      if (monographSpan) {
        const t = (monographSpan.textContent || "").trim();
        if (t) obj.drugName = t;
      }

      /* Skip rows with no drug name */
      if (!obj.drugName) continue;

      /* Detect isPrn */
      let isPrn = false;
      const prnEl = tr.querySelector('[class*="prn"]');
      if (prnEl) {
        const prnText = (prnEl.textContent || "").trim();
        if (/prn/i.test(prnText)) isPrn = true;
      }
      const btnPrn = tr.querySelector("button");
      if (btnPrn && /prn/i.test(btnPrn.textContent || "")) isPrn = true;
      if (/\bprn\b/i.test(obj.frequency || ""))   isPrn = true;
      if (/\bprn\b/i.test(obj.instruction || "")) isPrn = true;
      obj.isPrn = isPrn;

      /* Detect isCancelled */
      const isCancelled = tr.classList.contains("cancel-order") ||
                          /cancel/i.test(obj.status || "");
      obj.isCancelled = isCancelled;

      /* Detect alerts from aria-label attributes */
      const alertEls = tr.querySelectorAll("[aria-label]");
      const alerts   = [];
      for (const el of alertEls) {
        const lbl = el.getAttribute("aria-label") || "";
        if (/duplicate|alert|interaction|allerg/i.test(lbl)) {
          alerts.push(lbl);
        }
      }
      obj.alerts = alerts;

      /* Detect isDiluent */
      obj.isDiluent = /will not flow to emar/i.test(obj.instruction || "");

      orders.push(obj);
    }

    return orders;
  };

})();
