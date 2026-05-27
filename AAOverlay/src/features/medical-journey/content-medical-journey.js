// src/features/medical-journey/content-medical-journey.js
"use strict";

(function () {
  const _GUARD = Symbol.for("__ARCUS_MJ__");
  if (document[_GUARD]) return;
  document[_GUARD] = true;

  const MJ_STORAGE_KEY = "arcusMJState";
  const MJ_URL_PATTERN = "/emr/emrview/emr/orders";

  function _isOnOrdersPage() {
    return location.href.includes(MJ_URL_PATTERN);
  }

  function _norm(s) {
    return (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }

  function _injectStyle(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function _esc(s) {
    return (s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── Panel state ────────────────────────────────────────────────────
  let _state = { open: false, minimized: false, x: null, y: null };

  function _loadState() {
    try {
      const raw = localStorage.getItem(MJ_STORAGE_KEY);
      if (raw) _state = { ..._state, ...JSON.parse(raw) };
    } catch (_) {}
  }

  function _saveState() {
    try { localStorage.setItem(MJ_STORAGE_KEY, JSON.stringify(_state)); } catch (_) {}
  }

  // ── Banner / patient extraction ────────────────────────────────────
  function _getBannerRoot() {
    const custom = document.querySelector("patient-emr-banner");
    if (custom) return custom.querySelector(".main-banner") || custom;
    return document.querySelector("div.main-banner");
  }

  function _extractPatient() {
    const root = _getBannerRoot();
    if (!root) return null;

    let name = null;
    const container = root.querySelector(".padding-left-8-imp");
    if (container) {
      for (const el of container.querySelectorAll('.overme.ng-binding[aria-hidden="false"]')) {
        const t = _norm(el.textContent);
        if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/")) { name = t; break; }
      }
    }
    if (!name) {
      for (const el of root.querySelectorAll('.overme.ng-binding[aria-hidden="false"]')) {
        const t = _norm(el.textContent);
        if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/") && t.length > 2) { name = t; break; }
      }
    }

    let hn = null;
    for (const el of root.querySelectorAll("span.ng-binding, span.overme.ng-binding")) {
      const t = _norm(el.textContent);
      if (/^\d{2}-\d{2}-\d+$/.test(t)) { hn = t; break; }
    }

    let an = null, admitDate = null;
    for (const el of root.querySelectorAll("span.ng-binding, div.ng-binding")) {
      const t = _norm(el.textContent);
      if (/^[A-Z]\d{2}-\d{2}-\d+/.test(t)) {
        const parts = t.split("/");
        an = parts[0].trim();
        if (parts[1]) admitDate = parts[1].trim();
        break;
      }
    }

    let gender = null;
    for (const el of root.querySelectorAll('span.white-space-nowrap.overme.ng-binding[aria-hidden="false"]')) {
      const t = _norm(el.textContent);
      if (t === "Male" || t === "Female" || t === "ชาย" || t === "หญิง") { gender = t; break; }
    }

    const dobAgeEls = root.querySelectorAll("span.margin-left-5.white-space-nowrap.overme.ng-binding");
    const dob = dobAgeEls[0] ? _norm(dobAgeEls[0].textContent) : null;
    const age = dobAgeEls[1] ? _norm(dobAgeEls[1].textContent) : null;

    let bed = null;
    const bedEl = root.querySelector('[ng-repeat*="bedoccupancy"]');
    if (bedEl) {
      const t = _norm(bedEl.textContent);
      const slash = t.indexOf("/");
      bed = slash !== -1 ? _norm(t.slice(slash + 1)) || t : t;
    }

    let dept = null, doctor = null;
    outer: for (const sec of root.querySelectorAll(".main-banner-section")) {
      const spans = Array.from(sec.querySelectorAll("span.ng-binding")).filter(sp => {
        const t = _norm(sp.textContent);
        return t.length > 2 && !/^\d{2}-\d{2}-\d+/.test(t) && !/^[A-Z]\d{2}/.test(t);
      });
      if (spans.length >= 1) {
        dept   = _norm(spans[0].textContent);
        doctor = spans[1] ? _norm(spans[1].textContent) : null;
        break outer;
      }
    }

    return { name, hn, an, admitDate, gender, dob, age, bed, dept, doctor };
  }

  // ── Allergy extraction ─────────────────────────────────────────────
  function _extractAllergies() {
    const table = document.querySelector(
      "patient-emr-banner div.sec-banner table, " +
      "div.sec-banner table"
    );
    if (!table) return [];
    const allergies = [];
    table.querySelectorAll("tbody tr").forEach(tr => {
      const nameEl = tr.querySelector(".patientbanner-breakword-allergyname");
      const drug = nameEl ? _norm(nameEl.textContent)
                          : _norm(tr.cells[1]?.textContent);  // fallback to cell index
      if (!drug) return;
      const typeEl    = tr.querySelector(".patientbanner-breakword-eventtype");
      const symptomEl = tr.querySelector(".patientbanner-breakword-symptoms");
      allergies.push({
        drug,
        type:    typeEl    ? _norm(typeEl.textContent)    : _norm(tr.cells[2]?.textContent),
        symptom: symptomEl ? _norm(symptomEl.textContent) : _norm(tr.cells[3]?.textContent),
      });
    });
    return allergies;
  }

  // ── Order table extraction ─────────────────────────────────────────
  const ORDER_TYPE_LABELS = {
    "DISCHARGE MEDICATION": "Discharge Medication",
    "CONTINUOUS ORDERS":    "Continuous Orders",
    "INPATIENT PHARMACY":   "Inpatient Pharmacy",
    "FUTURE ORDERS":        "Future Orders",
    "OUTPATIENT":           "Outpatient",
  };

  const ORDER_TYPE_COLORS = {
    "DISCHARGE MEDICATION": { bg: "#e0f2f1", border: "#80cbc4", head: "#00695c", dot: "#00897b" },
    "CONTINUOUS ORDERS":    { bg: "#e8f0fe", border: "#90caf9", head: "#1565c0", dot: "#1976d2" },
    "INPATIENT PHARMACY":   { bg: "#f3e5f5", border: "#ce93d8", head: "#6a1b9a", dot: "#8e24aa" },
    "FUTURE ORDERS":        { bg: "#fff8e1", border: "#ffe082", head: "#e65100", dot: "#f57c00" },
  };
  const DEFAULT_COLOR = { bg: "#f5f5f5", border: "#bdbdbd", head: "#455a64", dot: "#607d8b" };

  function _extractOrders() {
    const table = document.querySelector('table[name="orderprofiletable"]');
    if (!table) return [];
    const orders = [];
    table.querySelectorAll("tbody tr[md-row]").forEach(tr => {
      const nameEl = tr.querySelector('[id^="showMonographname"] span.ng-binding');
      if (!nameEl) return;
      const cells = tr.cells;
      const c = i => (cells[i] ? _norm(cells[i].textContent) : "");
      let orderType = "";
      for (const cell of cells) {
        const t = _norm(cell.textContent).toUpperCase();
        if (ORDER_TYPE_LABELS[t]) { orderType = t; break; }
      }
      const dosage = c(10), route = c(11), frequency = c(12);
      const sig = [dosage, route, frequency].filter(v => v && v.trim()).join(" · ");
      orders.push({
        name:      _norm(nameEl.textContent),
        date:      c(4),
        orderNo:   c(5),
        status:    c(8),
        priority:  c(9),
        sig,
        dosage,
        route,
        frequency,
        duration:  c(13),
        quantity:  c(14),
        startDate: c(25),
        endDate:   c(26),
        orderType,
        cancelled: tr.classList.contains("cancel-order"),
        stat:      c(9).toUpperCase() === "STAT",
      });
    });
    return orders;
  }

  function _groupOrders(orders) {
    const groups = {};
    orders.forEach(o => {
      const key = o.orderType || "Other";
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });
    const PRIORITY = ["DISCHARGE MEDICATION","CONTINUOUS ORDERS","INPATIENT PHARMACY","FUTURE ORDERS"];
    return Object.fromEntries(
      Object.entries(groups).sort(([a],[b]) => {
        const ai = PRIORITY.indexOf(a), bi = PRIORITY.indexOf(b);
        if (ai < 0 && bi < 0) return 0;
        if (ai < 0) return 1; if (bi < 0) return -1;
        return ai - bi;
      })
    );
  }

  // ── Styles ─────────────────────────────────────────────────────────
  const MJ_CSS = `
#arcus-mj-tab-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 12px; border: 1px solid #90caf9; border-radius: 16px;
  background: #e3f2fd; font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 12px; font-weight: 600; color: #1565c0;
  cursor: pointer; white-space: nowrap; outline: none;
  box-sizing: border-box; margin-left: 6px; flex-shrink: 0;
  transition: background .15s, border-color .15s, box-shadow .15s;
}
#arcus-mj-tab-btn:hover { background: #bbdefb; border-color: #1565c0; }
#arcus-mj-tab-btn.mj-active { background: #1565c0; color: #fff; border-color: #1565c0; box-shadow: 0 1px 4px rgba(21,101,192,.3); }

#arcus-mj-panel {
  position: fixed; bottom: 24px; left: 24px;
  z-index: 2147483647; width: 420px; max-height: 86vh; overflow: hidden;
  background: #fff; border: 1px solid #bbdefb; border-radius: 12px;
  box-shadow: 0 10px 36px rgba(13,71,161,.18), 0 2px 8px rgba(0,0,0,.12);
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 12px; color: #222; box-sizing: border-box; line-height: 1.4;
}
#arcus-mj-panel.is-dragging { box-shadow: 0 16px 44px rgba(13,71,161,.26), 0 4px 14px rgba(0,0,0,.18); }
#arcus-mj-panel.is-minimized #arcus-mj-body { display: none; }
#arcus-mj-panel.is-minimized #arcus-mj-patient-strip { display: none; }

#arcus-mj-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid #e3f2fd;
  background: linear-gradient(135deg, #0d47a1 0%, #1565c0 60%, #1976d2 100%);
  cursor: move; user-select: none; border-radius: 12px 12px 0 0;
}
#arcus-mj-panel .mj-title-wrap { flex: 1; min-width: 0; }
#arcus-mj-panel .mj-title { font-size: 13px; font-weight: 700; color: #fff; margin-bottom: 1px; letter-spacing: .3px; }
#arcus-mj-panel .mj-subtitle { font-size: 11px; color: rgba(255,255,255,.8); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#arcus-mj-panel .mj-actions { display: flex; gap: 4px; flex-shrink: 0; align-items: center; }
#arcus-mj-panel .mj-icon-btn {
  width: 24px; height: 24px; border: 1px solid rgba(255,255,255,.35); border-radius: 5px;
  background: rgba(255,255,255,.15); color: #fff;
  cursor: pointer; font-size: 12px; font-weight: 700;
  flex: none; display: flex; align-items: center; justify-content: center; padding: 0;
  transition: background .12s;
}
#arcus-mj-panel .mj-icon-btn:hover { background: rgba(255,255,255,.28); }
#arcus-mj-panel .mj-icon-btn.mj-pdf-btn { font-size: 11px; width: auto; padding: 0 7px; gap: 3px; }

#arcus-mj-patient-strip {
  display: flex; flex-wrap: wrap; gap: 4px 10px;
  padding: 7px 12px 6px; background: #f0f4ff; border-bottom: 1px solid #e3f2fd;
  font-size: 11px; color: #37474f;
}
.mj-pt-chip { display: inline-flex; align-items: center; gap: 3px; }
.mj-pt-chip .mj-pt-label { font-size: 9.5px; font-weight: 700; color: #90a4ae; text-transform: uppercase; letter-spacing: .3px; }
.mj-pt-chip .mj-pt-val { font-weight: 600; color: #1a237e; }

#arcus-mj-body {
  padding: 10px 12px 12px; max-height: calc(86vh - 100px); overflow-y: auto;
}
#arcus-mj-body::-webkit-scrollbar { width: 4px; }
#arcus-mj-body::-webkit-scrollbar-track { background: #f0f4ff; border-radius: 99px; }
#arcus-mj-body::-webkit-scrollbar-thumb { background: #90caf9; border-radius: 99px; }

/* Allergy section */
.mj-allergy-box {
  background: #fff3e0; border: 1.5px solid #ffb74d; border-radius: 8px;
  padding: 8px 10px; margin-bottom: 10px;
}
.mj-allergy-title {
  font-size: 10.5px; font-weight: 700; color: #e65100;
  text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px;
  display: flex; align-items: center; gap: 5px;
}
.mj-allergy-row {
  display: flex; align-items: baseline; gap: 6px;
  padding: 3px 0; border-bottom: 1px solid #ffe0b2;
  font-size: 11px;
}
.mj-allergy-row:last-child { border-bottom: none; }
.mj-allergy-drug { font-weight: 700; color: #bf360c; min-width: 120px; flex-shrink: 0; }
.mj-allergy-detail { color: #6d4c41; }
.mj-no-allergy { font-size: 11px; color: #66bb6a; font-weight: 600; }

/* Journey groups */
.mj-group { margin-bottom: 12px; }
.mj-group-header {
  display: flex; align-items: center; gap: 6px; padding: 5px 8px;
  border-radius: 6px 6px 0 0; font-size: 10.5px; font-weight: 700;
  letter-spacing: .3px; text-transform: uppercase; user-select: none;
}
.mj-group-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.mj-group-count { margin-left: auto; font-size: 10px; opacity: .75; }

.mj-med-list { display: flex; flex-direction: column; }
.mj-med-card {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 7px 10px; border-left: 3px solid transparent;
  border-bottom: 1px solid transparent; background: #fafafa; transition: background .1s;
}
.mj-med-card:last-child { border-bottom: none; border-radius: 0 0 6px 6px; }
.mj-med-card:hover { background: #f0f4ff; }
.mj-med-card.cancelled { opacity: .4; text-decoration: line-through; }
.mj-med-body { flex: 1; min-width: 0; }
.mj-med-name { font-size: 12px; font-weight: 700; color: #1a237e; margin-bottom: 2px; line-height: 1.3; }
.mj-med-sig  { font-size: 11px; color: #455a64; margin-bottom: 2px; }
.mj-med-meta { font-size: 10px; color: #90a4ae; display: flex; gap: 6px; flex-wrap: wrap; }
.mj-med-badges { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.mj-badge { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 10px; font-size: 9.5px; font-weight: 700; white-space: nowrap; }
.mj-badge-stat    { background: #ffebee; color: #c62828; }
.mj-badge-ordered { background: #e8f5e9; color: #2e7d32; }
.mj-badge-default { background: #eceff1; color: #546e7a; }

.mj-empty { font-size: 11px; color: #9e9e9e; font-style: italic; text-align: center; padding: 16px 0; }
`;

  // ── PDF export ─────────────────────────────────────────────────────
  function _buildPdfHtml(patient, allergies, orders) {
    const pt = patient || {};
    const now = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

    const allergyRows = allergies.length
      ? allergies.map(a => `<tr>
          <td style="color:#bf360c;font-weight:700">${_esc(a.drug)}</td>
          <td>${_esc(a.type)}</td>
          <td>${_esc(a.symptom)}</td>
        </tr>`).join("")
      : `<tr><td colspan="3" style="color:#388e3c;font-weight:600">No known drug allergy</td></tr>`;

    const groups = orders.length ? _groupOrders(orders) : {};
    const groupHtmlBlocks = Object.entries(groups).map(([type, items]) => {
      const col = ORDER_TYPE_COLORS[type] || DEFAULT_COLOR;
      const label = ORDER_TYPE_LABELS[type] || type || "Other";
      const rows = items.map(o => {
        const meta = [o.duration, o.quantity, o.startDate ? `▶ ${o.startDate}` : ""].filter(Boolean).join("  |  ");
        return `<tr class="${o.cancelled ? "cancelled" : ""}">
          <td style="font-weight:700">${_esc(o.name)}</td>
          <td>${_esc(o.sig)}</td>
          <td>${_esc(meta)}</td>
          <td>${_esc(o.status)}</td>
        </tr>`;
      }).join("");
      return `<div class="order-group">
        <div class="order-group-title" style="background:${col.bg};color:${col.head};border-left:4px solid ${col.dot}">${_esc(label)} (${items.length})</div>
        <table class="order-table">
          <thead><tr><th>Drug</th><th>Dosage / Route / Frequency</th><th>Duration / Qty / Start</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    }).join("");

    return `<!DOCTYPE html><html lang="th"><head>
<meta charset="UTF-8">
<title>Medical Journey — ${_esc(pt.name || "Patient")}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", Arial, sans-serif; font-size: 11pt; color: #222; padding: 20mm 18mm; background: #fff; }
  .header-bar { background: linear-gradient(135deg,#0d47a1,#1565c0); color: #fff; padding: 14px 18px; border-radius: 8px; margin-bottom: 14px; }
  .header-bar h1 { font-size: 16pt; font-weight: 700; margin-bottom: 4px; }
  .header-bar .sub { font-size: 10pt; opacity: .85; }
  .pt-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px 12px; background: #f0f4ff; border: 1px solid #e3f2fd; border-radius: 6px; padding: 10px 14px; margin-bottom: 14px; }
  .pt-field .lbl { font-size: 8.5pt; font-weight: 700; color: #90a4ae; text-transform: uppercase; letter-spacing: .3px; }
  .pt-field .val { font-size: 10.5pt; font-weight: 600; color: #1a237e; }
  .section-title { font-size: 10pt; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px; margin-top: 14px; }
  .allergy-box { background: #fff3e0; border: 1.5px solid #ffb74d; border-radius: 6px; padding: 8px 12px; margin-bottom: 14px; }
  .allergy-box .section-title { color: #e65100; margin-top: 0; }
  .allergy-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  .allergy-table th { background: #ffe0b2; color: #bf360c; padding: 4px 8px; text-align: left; font-size: 9pt; }
  .allergy-table td { padding: 4px 8px; border-bottom: 1px solid #ffe0b2; }
  .order-group { margin-bottom: 12px; }
  .order-group-title { font-size: 9.5pt; font-weight: 700; text-transform: uppercase; padding: 5px 10px; margin-bottom: 0; letter-spacing: .3px; border-radius: 4px 4px 0 0; }
  .order-table { width: 100%; border-collapse: collapse; font-size: 10pt; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 4px 4px; overflow: hidden; }
  .order-table th { background: #f5f5f5; color: #546e7a; font-size: 9pt; padding: 4px 8px; text-align: left; border-bottom: 1px solid #e0e0e0; }
  .order-table td { padding: 5px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  .order-table tr:last-child td { border-bottom: none; }
  .order-table tr:nth-child(even) td { background: #fafafa; }
  .cancelled td { opacity: .45; text-decoration: line-through; }
  .footer { margin-top: 18px; font-size: 8.5pt; color: #9e9e9e; text-align: right; border-top: 1px solid #e0e0e0; padding-top: 6px; }
  @media print {
    body { padding: 10mm 12mm; }
    .header-bar { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .allergy-box { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .order-group-title { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head><body>
<div class="header-bar">
  <h1>🧭 Medical Journey</h1>
  <div class="sub">BKN Hospital · Printed: ${_esc(now)}</div>
</div>
<div class="pt-grid">
  ${pt.name     ? `<div class="pt-field" style="grid-column:span 2"><div class="lbl">Patient Name</div><div class="val">${_esc(pt.name)}</div></div>` : ""}
  ${pt.hn       ? `<div class="pt-field"><div class="lbl">HN</div><div class="val">${_esc(pt.hn)}</div></div>` : ""}
  ${pt.an       ? `<div class="pt-field"><div class="lbl">AN</div><div class="val">${_esc(pt.an)}</div></div>` : ""}
  ${pt.gender   ? `<div class="pt-field"><div class="lbl">Gender</div><div class="val">${_esc(pt.gender)}</div></div>` : ""}
  ${pt.age      ? `<div class="pt-field"><div class="lbl">Age</div><div class="val">${_esc(pt.age)}</div></div>` : ""}
  ${pt.dob      ? `<div class="pt-field"><div class="lbl">DOB</div><div class="val">${_esc(pt.dob)}</div></div>` : ""}
  ${pt.bed      ? `<div class="pt-field"><div class="lbl">Bed</div><div class="val">${_esc(pt.bed)}</div></div>` : ""}
  ${pt.dept     ? `<div class="pt-field"><div class="lbl">Department</div><div class="val">${_esc(pt.dept)}</div></div>` : ""}
  ${pt.doctor   ? `<div class="pt-field"><div class="lbl">Doctor</div><div class="val">${_esc(pt.doctor)}</div></div>` : ""}
  ${pt.admitDate? `<div class="pt-field"><div class="lbl">Admit Date</div><div class="val">${_esc(pt.admitDate)}</div></div>` : ""}
</div>
<div class="allergy-box">
  <div class="section-title">⚠ Drug Allergy</div>
  <table class="allergy-table">
    <thead><tr><th>Drug</th><th>Type</th><th>Symptom / Reaction</th></tr></thead>
    <tbody>${allergyRows}</tbody>
  </table>
</div>
${groupHtmlBlocks || `<div style="color:#9e9e9e;font-style:italic;text-align:center;padding:20px">No medication orders found</div>`}
<div class="footer">Medical Journey · ${_esc(pt.hn || "")} · ${_esc(pt.name || "")} · ${_esc(now)}</div>
</body></html>`;
  }

  function _savePdf(patient, allergies, orders) {
    const html = _buildPdfHtml(patient, allergies, orders);
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) { alert("Pop-up blocked. Please allow pop-ups for this site and try again."); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.addEventListener("load", () => { win.focus(); win.print(); });
  }

  // ── Copy text ──────────────────────────────────────────────────────
  function _buildCopyText(patient, allergies, orders) {
    const pt = patient || {};
    const lines = [
      `Patient: ${pt.name || "—"}`,
      `HN: ${pt.hn || "—"}  AN: ${pt.an || "—"}`,
      pt.admitDate ? `Admit: ${pt.admitDate}` : null,
      `Gender: ${pt.gender || "—"}  Age: ${pt.age || "—"}  DOB: ${pt.dob || "—"}`,
      pt.bed    ? `Bed: ${pt.bed}` : null,
      pt.dept   ? `Dept: ${pt.dept}` : null,
      pt.doctor ? `Doctor: ${pt.doctor}` : null,
    ].filter(Boolean);

    if (allergies && allergies.length) {
      lines.push("", "── Drug Allergy ──");
      allergies.forEach(a => lines.push(`  ⚠ ${a.drug}${a.type ? `  [${a.type}]` : ""}${a.symptom ? `  — ${a.symptom}` : ""}`));
    } else {
      lines.push("", "Drug Allergy: None recorded");
    }

    if (orders && orders.length) {
      const groups = _groupOrders(orders);
      for (const [type, items] of Object.entries(groups)) {
        lines.push("", `── ${ORDER_TYPE_LABELS[type] || type} (${items.length}) ──`);
        items.forEach(o => {
          lines.push(`  • ${o.name}`);
          if (o.sig)      lines.push(`    ${o.sig}`);
          if (o.duration) lines.push(`    Duration: ${o.duration}  Qty: ${o.quantity}`);
        });
      }
    }
    return lines.join("\n");
  }

  // ── Panel rendering ────────────────────────────────────────────────
  function _renderPanel(patient, allergies, orders) {
    document.getElementById("arcus-mj-panel")?.remove();
    _injectStyle("arcus-mj-css", MJ_CSS);

    const panel = document.createElement("div");
    panel.id = "arcus-mj-panel";
    if (_state.minimized) panel.classList.add("is-minimized");
    if (_state.x !== null && _state.y !== null) {
      panel.style.left = _state.x + "px"; panel.style.top = _state.y + "px";
      panel.style.right = "auto"; panel.style.bottom = "auto";
    }

    const pt = patient || {};

    // Patient strip
    const ptChips = [
      pt.hn     ? `<span class="mj-pt-chip"><span class="mj-pt-label">HN</span><span class="mj-pt-val">${pt.hn}</span></span>` : "",
      pt.an     ? `<span class="mj-pt-chip"><span class="mj-pt-label">AN</span><span class="mj-pt-val">${pt.an}</span></span>` : "",
      pt.gender ? `<span class="mj-pt-chip"><span class="mj-pt-label">Sex</span><span class="mj-pt-val">${pt.gender}</span></span>` : "",
      pt.age    ? `<span class="mj-pt-chip"><span class="mj-pt-label">Age</span><span class="mj-pt-val">${pt.age}</span></span>` : "",
      pt.bed    ? `<span class="mj-pt-chip"><span class="mj-pt-label">Bed</span><span class="mj-pt-val">${pt.bed}</span></span>` : "",
      pt.dept   ? `<span class="mj-pt-chip"><span class="mj-pt-label">Dept</span><span class="mj-pt-val">${pt.dept}</span></span>` : "",
    ].filter(Boolean).join("");

    // Allergy section
    let allergyHtml = "";
    if (allergies && allergies.length) {
      const rows = allergies.map(a => {
        const detail = [a.type, a.symptom].filter(Boolean).join(" · ");
        return `<div class="mj-allergy-row">
          <span class="mj-allergy-drug">⚠ ${a.drug}</span>
          <span class="mj-allergy-detail">${detail || "—"}</span>
        </div>`;
      }).join("");
      allergyHtml = `<div class="mj-allergy-box">
        <div class="mj-allergy-title">⚠ Drug Allergy (${allergies.length})</div>
        ${rows}
      </div>`;
    } else {
      allergyHtml = `<div class="mj-allergy-box">
        <div class="mj-allergy-title">Drug Allergy</div>
        <span class="mj-no-allergy">✓ No known drug allergy</span>
      </div>`;
    }

    // Journey groups
    let journeyHtml = "";
    if (orders && orders.length) {
      const groups = _groupOrders(orders);
      for (const [type, items] of Object.entries(groups)) {
        const col = ORDER_TYPE_COLORS[type] || DEFAULT_COLOR;
        const label = ORDER_TYPE_LABELS[type] || type || "Other";
        const cards = items.map(o => {
          const badge = o.stat
            ? `<span class="mj-badge mj-badge-stat">STAT</span>`
            : `<span class="mj-badge mj-badge-ordered">${o.status || "Ordered"}</span>`;
          const meta = [
            o.duration ? `⏱ ${o.duration}` : "",
            o.quantity ? `📦 ${o.quantity}` : "",
            o.startDate ? `▶ ${o.startDate}` : "",
          ].filter(Boolean).join(" · ");
          return `<div class="mj-med-card${o.cancelled ? " cancelled" : ""}"
            style="border-left-color:${col.dot};border-bottom-color:${col.border}30;background:${col.bg}18">
            <div class="mj-med-body">
              <div class="mj-med-name">${o.name}</div>
              ${o.sig  ? `<div class="mj-med-sig">${o.sig}</div>` : ""}
              ${meta   ? `<div class="mj-med-meta">${meta}</div>` : ""}
            </div>
            <div class="mj-med-badges">${badge}</div>
          </div>`;
        }).join("");
        journeyHtml += `<div class="mj-group">
          <div class="mj-group-header" style="background:${col.bg};color:${col.head};border:1px solid ${col.border}">
            <div class="mj-group-dot" style="background:${col.dot}"></div>
            ${label}
            <span class="mj-group-count">${items.length} item${items.length > 1 ? "s" : ""}</span>
          </div>
          <div class="mj-med-list" style="border:1px solid ${col.border};border-top:none;border-radius:0 0 6px 6px">${cards}</div>
        </div>`;
      }
    } else {
      journeyHtml = `<div class="mj-empty">No medication orders found.<br>Switch to the Order Profile tab first.</div>`;
    }

    panel.innerHTML = `
      <div id="arcus-mj-header">
        <div class="mj-title-wrap">
          <div class="mj-title">🧭 Medical Journey</div>
          <div class="mj-subtitle">${pt.name || "No patient data"}</div>
        </div>
        <div class="mj-actions">
          <button class="mj-icon-btn mj-pdf-btn" id="arcus-mj-btn-pdf" title="Save to PDF">🖨 PDF</button>
          <button class="mj-icon-btn" id="arcus-mj-btn-refresh" title="Refresh">↻</button>
          <button class="mj-icon-btn" id="arcus-mj-btn-copy" title="Copy to clipboard">⎘</button>
          <button class="mj-icon-btn" id="arcus-mj-btn-min" title="Minimize">−</button>
          <button class="mj-icon-btn" id="arcus-mj-btn-close" title="Close">✕</button>
        </div>
      </div>
      ${ptChips ? `<div id="arcus-mj-patient-strip">${ptChips}</div>` : ""}
      <div id="arcus-mj-body">${allergyHtml}${journeyHtml}</div>`;

    document.body.appendChild(panel);
    _makeDraggable(panel, document.getElementById("arcus-mj-header"));

    document.getElementById("arcus-mj-btn-min").addEventListener("click", () => {
      _state.minimized = !_state.minimized;
      panel.classList.toggle("is-minimized", _state.minimized);
      _saveState();
    });
    document.getElementById("arcus-mj-btn-close").addEventListener("click", _closePanel);
    document.getElementById("arcus-mj-btn-refresh").addEventListener("click", () => {
      _renderPanel(_extractPatient(), _extractAllergies(), _extractOrders());
    });
    document.getElementById("arcus-mj-btn-copy").addEventListener("click", () => {
      navigator.clipboard.writeText(_buildCopyText(patient, allergies, orders)).then(() => {
        const btn = document.getElementById("arcus-mj-btn-copy");
        if (btn) { btn.textContent = "✓"; setTimeout(() => { btn.textContent = "⎘"; }, 1500); }
      }).catch(() => {});
    });
    document.getElementById("arcus-mj-btn-pdf").addEventListener("click", () => {
      _savePdf(patient, allergies, orders);
    });
  }

  function _openPanel() {
    _state.open = true;
    _saveState();
    _renderPanel(_extractPatient(), _extractAllergies(), _extractOrders());
    document.getElementById("arcus-mj-tab-btn")?.classList.add("mj-active");
  }

  function _closePanel() {
    _state.open = false;
    _saveState();
    document.getElementById("arcus-mj-panel")?.remove();
    document.getElementById("arcus-mj-tab-btn")?.classList.remove("mj-active");
  }

  // ── Drag ───────────────────────────────────────────────────────────
  function _makeDraggable(panel, handle) {
    let sX, sY, sL, sT;
    handle.addEventListener("mousedown", e => {
      if (e.target.classList.contains("mj-icon-btn")) return;
      e.preventDefault();
      const r = panel.getBoundingClientRect();
      sX = e.clientX; sY = e.clientY; sL = r.left; sT = r.top;
      panel.classList.add("is-dragging");
      panel.style.right = "auto"; panel.style.bottom = "auto";
      panel.style.left = sL + "px"; panel.style.top = sT + "px";
      const onMove = e => {
        const nL = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, sL + e.clientX - sX));
        const nT = Math.max(0, Math.min(window.innerHeight - 40, sT + e.clientY - sY));
        panel.style.left = nL + "px"; panel.style.top = nT + "px";
        _state.x = nL; _state.y = nT;
      };
      const onUp = () => {
        panel.classList.remove("is-dragging");
        _saveState();
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ── Tab button injection ───────────────────────────────────────────
  function _findToolbar() {
    return document.querySelector(
      "#tab-content-76 > div > div > div > div > div.groupbylist.layout-wrap.layout-align-start-center.layout-row.flex"
    ) || document.querySelector(
      "div.groupbylist.layout-wrap.layout-align-start-center.layout-row.flex"
    );
  }

  function _injectTabButton() {
    if (document.getElementById("arcus-mj-tab-btn")) return;
    const wrapper = _findToolbar();
    if (!wrapper) return;
    _injectStyle("arcus-mj-css", MJ_CSS);
    const btn = document.createElement("button");
    btn.id = "arcus-mj-tab-btn";
    btn.type = "button";
    btn.innerHTML = `<span style="font-size:14px;line-height:1">🧭</span> Medical Journey`;
    if (_state.open) btn.classList.add("mj-active");
    btn.addEventListener("click", () => {
      if (document.getElementById("arcus-mj-panel")) _closePanel(); else _openPanel();
    });
    wrapper.appendChild(btn);
    if (_state.open) _openPanel();
  }

  // ── SPA navigation ────────────────────────────────────────────────
  let _lastHref = location.href;
  function _onNav() {
    const href = location.href;
    if (href === _lastHref) return;
    _lastHref = href;
    if (!_isOnOrdersPage()) {
      document.getElementById("arcus-mj-panel")?.remove();
      document.getElementById("arcus-mj-tab-btn")?.remove();
      return;
    }
    setTimeout(_injectTabButton, 700);
  }

  window.addEventListener("hashchange", _onNav);
  const _origPush = history.pushState.bind(history);
  history.pushState = function (...a) { _origPush(...a); setTimeout(_onNav, 0); };
  const _origReplace = history.replaceState.bind(history);
  history.replaceState = function (...a) { _origReplace(...a); setTimeout(_onNav, 0); };

  let _scheduled = false;
  new MutationObserver(() => {
    if (!_isOnOrdersPage()) return;
    if (document.getElementById("arcus-mj-tab-btn")) return;
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(() => { _injectTabButton(); _scheduled = false; });
  }).observe(document.body, { childList: true, subtree: true });

  // ── Init ──────────────────────────────────────────────────────────
  _loadState();
  if (_isOnOrdersPage()) setTimeout(_injectTabButton, 900);
})();
