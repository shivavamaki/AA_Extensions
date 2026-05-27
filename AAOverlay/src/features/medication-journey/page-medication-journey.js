/* ── page-medication-journey.js ─────────────────────────────────────────────
   ADR Drug Timeline — Gantt-style chart matching the ADR Timeline.png format.
──────────────────────────────────────────────────────────────────────────── */
"use strict";

/* ── Mutable state ──────────────────────────────────────────────────────── */
let _journeyData  = null;
let _editSnapshot = null;
let _currentRange = null;

/* ── Utilities ──────────────────────────────────────────────────────────── */
function esc(str) {
  return String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/* ── Date helpers ───────────────────────────────────────────────────────── */
function parseDate(str) {
  if (!str || str === "unknown") return null;
  let m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2]-1, +m[3]);
  m = String(str).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(+m[3], +m[2]-1, +m[1]);
  return null;
}
function dayStart(d)    { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n)  { const r = new Date(d); r.setDate(r.getDate()+n); return r; }
function diffDays(a, b) { return Math.round((dayStart(b) - dayStart(a)) / 86400000); }

/* Fractional day offset including time component ("YYYY-MM-DDTHH:MM") */
function diffDaysFrac(start, dtStr) {
  const base = parseDate(dtStr);
  if (!base) return null;
  const days = diffDays(start, base);
  const m = String(dtStr).match(/T(\d{2}):(\d{2})/);
  if (m) return days + (parseInt(m[1]) * 60 + parseInt(m[2])) / 1440;
  return days;
}

function fmtDate(dt) {
  if (!dt) return "";
  const d = String(dt).slice(0,10), p = d.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : d;
}
function fmtDateRange(s, e) {
  const sd = fmtDate(s), ed = fmtDate(e);
  if (sd && ed) return `${sd} – ${ed}`;
  return sd || ed || "";
}
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/* ── Collect all medications ────────────────────────────────────────────── */
function getAllMeds(jd) {
  return [
    ...(jd.activeMedications  || []).map(m => Object.assign({},m,{_secType:"active"})),
    ...(jd.stoppedMedications || []).map(m => Object.assign({},m,{_secType:"stopped"})),
    ...(jd.prnMedications     || []).map(m => Object.assign({},m,{_secType:"prn"})),
    ...(jd.diluentMedications || []).map(m => Object.assign({},m,{_secType:"diluent"})),
  ];
}

/* ── Calculate date range ───────────────────────────────────────────────── */
function calcRange(meds, ctx) {
  const dates = [];
  const admit = parseDate(ctx && ctx.admitDate);
  if (admit) dates.push(admit);
  for (const m of meds) {
    const s = parseDate(m.startDateTime), e = parseDate(m.endDateTime);
    if (s) dates.push(s);
    if (e) dates.push(e);
  }
  if (!dates.length) {
    const t = dayStart(new Date());
    return { start: addDays(t,-14), end: addDays(t,3), totalDays:17 };
  }
  const minTs = Math.min(...dates.map(d=>d.getTime()));
  const maxTs = Math.max(...dates.map(d=>d.getTime()));
  const start = dayStart(addDays(new Date(minTs),-1));
  const end   = dayStart(addDays(new Date(maxTs), 3));
  return { start, end, totalDays: Math.max(diffDays(start,end),1) };
}

function pct(n, total) { return (n/total*100).toFixed(3); }

/* ── Bar color per medication type ──────────────────────────────────────── */
function getMedColor(med) {
  if (med.isCancelled || med._secType==="stopped") return "#90a4ae";
  if (med._isIv)               return "#1565c0";
  if (med._secType==="prn")    return "#00838f";
  if (med._secType==="diluent")return "#78909c";
  return "#388e3c";
}

/* ── Build admin-times lookup from journey.adminTimes ───────────────────── */
function buildAdminTimesMap(journeyData) {
  const map = {};
  if (!Array.isArray(journeyData.adminTimes)) return map;
  for (const at of journeyData.adminTimes) {
    map[(at.drugName || "").toLowerCase().trim()] = at.adminDatetimes || [];
  }
  return map;
}

function findAdminTimes(med, atMap) {
  const name = (med.drugName || "").toLowerCase().trim();
  if (atMap[name]) return atMap[name];
  /* Fuzzy: match on first meaningful word */
  const firstWord = name.replace(/\d.*$/, "").trim().split(/\s+/)[0];
  if (firstWord.length < 3) return [];
  for (const [k, v] of Object.entries(atMap)) {
    if (k.startsWith(firstWord) || firstWord.startsWith(k.split(/\s+/)[0])) return v;
  }
  return [];
}

/* ═══════════════════════════════════════════════════════════════════════════
   GANTT CHART RENDERING
═══════════════════════════════════════════════════════════════════════════ */

/* ── Date header row ────────────────────────────────────────────────────── */
function buildDateHeader(range) {
  const { start, totalDays } = range;
  const mid = addDays(start, Math.floor(totalDays/2));
  const monthLabel = `${MONTH_SHORT[mid.getMonth()]} ${mid.getFullYear()} exposure timeline`;

  let ticks = "";
  for (let i = 0; i <= totalDays; i++) {
    const d = addDays(start, i);
    ticks += `<div class="mj-day-tick" style="left:${pct(i,totalDays)}%">${d.getDate()}</div>`;
  }
  return `<div class="mj-date-hdr">
  <div class="mj-month-label">${esc(monthLabel)}</div>
  <div class="mj-days-row">${ticks}</div>
</div>`;
}

/* ── Single Gantt row ───────────────────────────────────────────────────── */
function buildGanttRow(med, range, vlineHtml, atMap) {
  const { start, totalDays } = range;
  const sDate = parseDate(med.startDateTime);

  /* Drug column */
  const badges = [];
  if (med._isIv)    badges.push(`<span class="mj-drug-bdg mj-bdg-iv">IV</span>`);
  if (med._secType==="prn")    badges.push(`<span class="mj-drug-bdg mj-bdg-prn">PRN</span>`);
  if (med._secType==="stopped"||med.isCancelled) badges.push(`<span class="mj-drug-bdg mj-bdg-stopped">หยุดใช้</span>`);
  if (med._secType==="diluent")badges.push(`<span class="mj-drug-bdg mj-bdg-diluent">สารน้ำ</span>`);

  const drugCol = `<div class="mj-drug-col">
    <div class="mj-dn">${esc(med.drugName||"–")} ${badges.join("")}</div>
    <div class="mj-dd">${esc(med.displayDose||"")}</div>
    <div class="mj-ddate">${esc(fmtDateRange(med.startDateTime,med.endDateTime))}</div>
  </div>`;

  if (!sDate) {
    return `<div class="mj-gantt-row">${drugCol}<div class="mj-bars-col">${vlineHtml}</div></div>`;
  }

  const isStopped = med._secType==="stopped" || med.isCancelled;
  const eDate = parseDate(med.endDateTime) || (isStopped ? sDate : new Date());
  const sOff  = Math.max(0, Math.min(totalDays, diffDays(start, sDate)));
  const eOff  = Math.max(sOff+0.3, Math.min(totalDays, diffDays(start, eDate)));
  const lp    = pct(sOff, totalDays);
  const wp    = pct(eOff-sOff, totalDays);
  const color = getMedColor(med);
  const alpha = isStopped ? "0.55" : "1";

  /* Admin-time ticks for oral medications */
  let ticksHtml = "";
  if (med._isOral && atMap) {
    const times = findAdminTimes(med, atMap);
    for (const dtStr of times) {
      const frac = diffDaysFrac(start, dtStr);
      if (frac === null || frac < 0 || frac > totalDays) continue;
      ticksHtml += `<div class="mj-admin-tick" style="left:${pct(frac,totalDays)}%"></div>`;
    }
  }

  const barLabel = med.pharmacistNote
    ? `<span class="mj-bar-lbl">${esc(med.pharmacistNote)}</span>` : "";
  const stopX = isStopped
    ? `<div class="mj-stop-x" style="left:calc(${lp}% + ${wp}% - 5px)">✕</div>` : "";

  const barCol = `<div class="mj-bars-col">
    ${vlineHtml}
    <div class="mj-bar" style="left:${lp}%;width:${wp}%;background:${color};opacity:${alpha}">${barLabel}</div>
    ${stopX}
    ${ticksHtml}
  </div>`;

  return `<div class="mj-gantt-row">${drugCol}${barCol}</div>`;
}

/* ── ADR callout with inline editable form ──────────────────────────────── */
function buildAdrCalloutWithForm(adrEvent) {
  const ae      = adrEvent || {};
  const dateVal = ae.date    || "";
  const sympVal = ae.symptoms|| "";
  const detsVal = ae.details || "";

  const SYMP_OPTS = [
    ["Rash",            "Rash (ผื่น)"],
    ["Urticaria",       "Urticaria (ลมพิษ)"],
    ["Angioedema",      "Angioedema"],
    ["Anaphylaxis",     "Anaphylaxis"],
    ["SJS",             "SJS"],
    ["TEN",             "TEN"],
    ["DRESS",           "DRESS"],
    ["Fever",           "Fever (ไข้)"],
    ["Nausea/Vomiting", "Nausea/Vomiting"],
    ["Other",           "Other (อื่นๆ)"],
  ];

  const opts = SYMP_OPTS.map(([val, lbl]) =>
    `<option value="${esc(val)}"${sympVal===val?" selected":""}>${esc(lbl)}</option>`
  ).join("");

  const onsetSummary = dateVal
    ? `ADR onset: <strong>${esc(fmtDate(dateVal))}</strong>${sympVal ? ` — ${esc(sympVal)}` : ""}`
    : "";

  return `<div class="mj-adr-callout" id="mj-adr-callout">
  <div class="mj-adr-label">⚠️ ADR Event</div>
  <div class="mj-adr-form-row">
    <label class="mj-adr-field-label">วันที่พบ ADR
      <input type="date" id="mj-adr-date" class="mj-adr-input" value="${esc(dateVal)}">
    </label>
    <label class="mj-adr-field-label">อาการ
      <select id="mj-adr-symptoms" class="mj-adr-input">
        <option value="">-- เลือก --</option>
        ${opts}
      </select>
    </label>
  </div>
  <input type="text" id="mj-adr-details" class="mj-adr-input mj-adr-details-input"
    placeholder="รายละเอียดเพิ่มเติม..." value="${esc(detsVal)}">
  <div class="mj-adr-onset" id="mj-adr-onset-summary"${onsetSummary?"":" style=\"display:none\""}>
    ${onsetSummary}
  </div>
</div>`;
}

/* ── Full chart ─────────────────────────────────────────────────────────── */
function buildGanttChart(journeyData) {
  const ctx  = journeyData.patientContext || {};
  const meds = getAllMeds(journeyData);
  if (!meds.length) return `<div class="mj-empty-gantt">ไม่มีข้อมูลยา</div>`;

  const range = calcRange(meds, ctx);
  _currentRange = range; /* store for dynamic ADR vline updates */
  const { start, totalDays } = range;

  /* Vertical ADR event line — always rendered, show/hide via JS */
  const ae = journeyData.adrEvent || {};
  let vlineLp   = "0";
  let vlineShow = "none";
  if (ae.date) {
    const ad  = parseDate(ae.date);
    const off = ad ? diffDays(start, ad) : -1;
    if (off >= 0 && off <= totalDays) {
      vlineLp   = pct(off, totalDays);
      vlineShow = "block";
    }
  }
  const vlineHtml = `<div class="mj-vline" style="left:${vlineLp}%;display:${vlineShow}">
    <span class="mj-vline-tip">onset</span>
  </div>`;

  const atMap   = buildAdminTimesMap(journeyData);
  const dateHdr = buildDateHeader(range);
  const rows    = meds.map(m => buildGanttRow(m, range, vlineHtml, atMap)).join("");

  return `<div class="mj-gantt-scroll">
  <div class="mj-gantt">
    <div class="mj-gantt-hdr-row">
      <div class="mj-drug-col mj-drug-col-hdr">Medication / Order evidence</div>
      <div class="mj-dates-hdr-col">${dateHdr}</div>
    </div>
    ${rows}
  </div>
</div>`;
}

/* ── Export / copy helpers ──────────────────────────────────────────────── */
function exportJourneyJson(journeyData) {
  const blob = new Blob([JSON.stringify(journeyData,null,2)],{type:"application/json"});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const now  = new Date(), p2 = n => String(n).padStart(2,"0");
  a.href = url;
  a.download = `adr-timeline-${now.getFullYear()}${p2(now.getMonth()+1)}${p2(now.getDate())}.json`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ document.body.removeChild(a); URL.revokeObjectURL(url); },1000);
}

function copySummaryText(journeyData) {
  const ctx = journeyData.patientContext || {};
  const ae  = journeyData.adrEvent || {};
  const lines = [
    "=== ADR Drug Timeline ===",
    `ผู้ป่วย: ${ctx.patientName||"–"}  HN: ${ctx.hn||"–"}  AN: ${ctx.an||"–"}`,
    `แพทย์: ${ctx.doctor||"–"}  แผนก: ${ctx.dept||"–"}`,
  ];
  if (ae.date) lines.push(`ADR onset: ${fmtDate(ae.date)}${ae.symptoms?" — "+ae.symptoms:""}`);
  if (ae.details) lines.push(`รายละเอียด: ${ae.details}`);
  lines.push("");
  for (const m of getAllMeds(journeyData)) {
    lines.push(`• ${m.drugName}  ${m.displayDose||""}  ${fmtDateRange(m.startDateTime,m.endDateTime)}`);
    if (m.pharmacistNote) lines.push(`  📝 ${m.pharmacistNote}`);
  }
  lines.push("", `สร้างเมื่อ: ${new Date().toLocaleString("th-TH")}`);
  const text = lines.join("\n");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(()=>_fallbackCopy(text));
  } else { _fallbackCopy(text); }
}

function _fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position="fixed"; ta.style.top="-9999px";
  document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
}

/* ── Wire view-mode interactivity ───────────────────────────────────────── */
function wireInteractivity(journeyData) {
  const $  = id => document.getElementById(id);
  const on = (id, fn) => { const el=$(id); if(el) el.addEventListener("click",fn); };

  on("mj-print-btn",  ()=>window.print());
  on("mj-export-btn", ()=>exportJourneyJson(journeyData));
  on("mj-copy-btn",   ()=>{
    copySummaryText(journeyData);
    const btn = $("mj-copy-btn");
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = "✓ คัดลอกแล้ว";
    setTimeout(()=>{ btn.textContent=orig; }, 2000);
  });
  on("mj-edit-btn", ()=>{
    _editSnapshot = deepClone(_journeyData);
    renderEditPage();
  });

  /* ── ADR event form ───────────────────────────────────────────────────── */
  const adrDateEl = $("mj-adr-date");
  const adrSympEl = $("mj-adr-symptoms");
  const adrDetsEl = $("mj-adr-details");

  function _syncAdrEvent() {
    const date    = adrDateEl ? adrDateEl.value           : "";
    const symp    = adrSympEl ? adrSympEl.value           : "";
    const details = adrDetsEl ? adrDetsEl.value.trim()    : "";

    _journeyData.adrEvent = { date, symptoms: symp, details };

    /* Update onset summary line */
    const summary = $("mj-adr-onset-summary");
    if (summary) {
      if (date) {
        summary.style.display = "";
        summary.innerHTML = `ADR onset: <strong>${esc(fmtDate(date))}</strong>${symp ? ` — ${esc(symp)}` : ""}`;
      } else {
        summary.style.display = "none";
        summary.innerHTML = "";
      }
    }

    /* Update all vline positions */
    if (date && _currentRange) {
      const ad  = parseDate(date);
      const off = ad ? diffDays(_currentRange.start, ad) : -1;
      document.querySelectorAll(".mj-vline").forEach(el => {
        if (off >= 0 && off <= _currentRange.totalDays) {
          el.style.left    = pct(off, _currentRange.totalDays) + "%";
          el.style.display = "block";
        } else {
          el.style.display = "none";
        }
      });
    } else {
      document.querySelectorAll(".mj-vline").forEach(el => { el.style.display = "none"; });
    }
  }

  if (adrDateEl) adrDateEl.addEventListener("change", _syncAdrEvent);
  if (adrSympEl) adrSympEl.addEventListener("change", _syncAdrEvent);
  if (adrDetsEl) adrDetsEl.addEventListener("input",  _syncAdrEvent);
}

/* ── renderMedicationJourney ────────────────────────────────────────────── */
function renderMedicationJourney(journeyData) {
  _journeyData = journeyData;
  const root = document.getElementById("mj-root");
  if (!root) return;

  const ctx   = journeyData.patientContext || {};
  const name  = ctx.patientName || "";
  const hn    = ctx.hn || ctx.patientId || "";
  const admit = ctx.admitDate ? `ที่จ่ายยา ${fmtDate(ctx.admitDate)}` : "";
  const sub   = [name, hn ? `HN ${hn}` : "", ctx.bed ? `เตียง ${ctx.bed}` : ""].filter(Boolean).join(" · ");

  root.innerHTML = `<div class="mj-page">
<div class="mj-header">
  <div class="mj-header-left">
    <div class="mj-page-title">ADR Timeline</div>
    ${admit ? `<div class="mj-page-sub">${esc(admit)}</div>` : ""}
    ${sub   ? `<div class="mj-page-sub">${esc(sub)}</div>`   : ""}
  </div>
  ${buildAdrCalloutWithForm(journeyData.adrEvent)}
  <div class="mj-header-actions">
    <button id="mj-edit-btn"   class="mj-btn mj-btn-edit">✏️ แก้ไข</button>
    <button id="mj-print-btn"  class="mj-btn mj-btn-print">🖨️ พิมพ์</button>
    <button id="mj-export-btn" class="mj-btn mj-btn-export">⬇️ JSON</button>
    <button id="mj-copy-btn"   class="mj-btn mj-btn-copy">📋 คัดลอก</button>
  </div>
</div>
${buildGanttChart(journeyData)}
</div>`;

  wireInteractivity(journeyData);
}

/* ═══════════════════════════════════════════════════════════════════════════
   EDIT MODE
═══════════════════════════════════════════════════════════════════════════ */

function buildPatientCardEdit(ctx) {
  const defs = [
    ["patientName","ชื่อผู้ป่วย"],["hn","HN"],["an","AN"],
    ["gender","เพศ"],["dob","วันเกิด"],["age","อายุ"],
    ["bed","เตียง"],["dept","แผนก"],["doctor","แพทย์"],["admitDate","วันรับไว้"],
  ];
  const fields = defs.map(([k,lbl]) =>
    `<div class="mj-patient-field">
      <div class="lbl">${esc(lbl)}</div>
      <input class="mj-edit-input" data-ctx="${esc(k)}" value="${esc(ctx[k]||"")}">
    </div>`
  ).join("");
  return `<div class="mj-patient-card" id="mj-patient-card-edit">${fields}</div>`;
}

function buildMedRowEdit(order) {
  return `<div class="mj-edit-row">
  <div class="mj-edit-grid">
    <label class="mj-edit-label">ชื่อยา
      <input class="mj-edit-input" data-prop="drugName" value="${esc(order.drugName||"")}" placeholder="ชื่อยา">
    </label>
    <label class="mj-edit-label">ขนาด / วิธีใช้
      <input class="mj-edit-input" data-prop="displayDose" value="${esc(order.displayDose||"")}" placeholder="เช่น 500mg oral TID">
    </label>
    <label class="mj-edit-label">วันเริ่ม
      <input class="mj-edit-input" data-prop="startDateTime" value="${esc(order.startDateTime||"")}" placeholder="YYYY-MM-DD">
    </label>
    <label class="mj-edit-label">วันสิ้นสุด
      <input class="mj-edit-input" data-prop="endDateTime" value="${esc(order.endDateTime||"")}" placeholder="YYYY-MM-DD">
    </label>
    <label class="mj-edit-label mj-edit-label-full">Annotation บนแถบ / บันทึกเภสัชกร
      <textarea class="mj-edit-input mj-edit-note" data-prop="pharmacistNote">${esc(order.pharmacistNote||"")}</textarea>
    </label>
  </div>
  <button class="mj-btn mj-btn-del" onclick="this.closest('.mj-edit-row').remove()">🗑️ ลบ</button>
</div>`;
}

function buildMedSectionEdit(secId, icon, title, themeClass, orders) {
  const rows = (orders||[]).map(o=>buildMedRowEdit(o)).join("");
  return `<div class="mj-section ${themeClass}">
  <div class="mj-section-header" style="cursor:default">
    <span>${icon}</span><span>${esc(title)}</span>
    <span class="mj-badge" style="margin-left:4px;background:rgba(0,0,0,.07);color:inherit">${(orders||[]).length}</span>
  </div>
  <div class="mj-section-body" id="${secId}-edit-body">
    ${rows||'<div class="mj-empty">ไม่มีรายการ</div>'}
  </div>
  <div class="mj-edit-add-row">
    <button class="mj-btn mj-btn-add" onclick="mjAddMedRow('${secId}-edit-body')">➕ เพิ่มยา</button>
  </div>
</div>`;
}

window.mjAddMedRow = function(bodyId) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  const empty = body.querySelector(".mj-empty");
  if (empty) empty.remove();
  const div = document.createElement("div");
  div.innerHTML = buildMedRowEdit({});
  body.appendChild(div.firstElementChild);
};

function readEditSection(bodyId) {
  const body = document.getElementById(bodyId);
  if (!body) return null;
  return Array.from(body.querySelectorAll(".mj-edit-row")).map(row => {
    const o = {};
    row.querySelectorAll("[data-prop]").forEach(el => {
      o[el.dataset.prop] = (el.tagName==="TEXTAREA" ? el.value : el.value).trim();
    });
    return o;
  }).filter(o => (o.drugName||"").trim());
}

function saveEdits() {
  const ctx = _journeyData.patientContext || {};
  document.querySelectorAll("#mj-patient-card-edit [data-ctx]").forEach(inp => {
    ctx[inp.dataset.ctx] = inp.value.trim();
  });
  _journeyData.patientContext = ctx;
  const active  = readEditSection("mj-sec-active-edit-body");
  const stopped = readEditSection("mj-sec-stopped-edit-body");
  const prn     = readEditSection("mj-sec-prn-edit-body");
  if (active  !== null) _journeyData.activeMedications  = active;
  if (stopped !== null) _journeyData.stoppedMedications = stopped;
  if (prn     !== null) _journeyData.prnMedications     = prn;
}

function renderEditPage() {
  const root = document.getElementById("mj-root");
  if (!root) return;
  const ctx = _journeyData.patientContext || {};
  root.innerHTML = `<div class="mj-page mj-page-edit">
<div class="mj-header mj-header-edit">
  <div class="mj-header-left">
    <div class="mj-page-title">✏️ แก้ไข ADR Timeline</div>
    <div class="mj-page-sub" style="opacity:.8">กด "บันทึก" เพื่อนำการเปลี่ยนแปลงไปใช้</div>
  </div>
  <div class="mj-header-actions">
    <button id="mj-save-btn"   class="mj-btn mj-btn-save">💾 บันทึก</button>
    <button id="mj-cancel-btn" class="mj-btn mj-btn-cancel">✕ ยกเลิก</button>
  </div>
</div>
${buildPatientCardEdit(ctx)}
${buildMedSectionEdit("mj-sec-active", "✅","ยาที่ใช้อยู่","mj-section-active",_journeyData.activeMedications||[])}
${buildMedSectionEdit("mj-sec-stopped","🛑","ยาที่หยุดใช้แล้ว","mj-section-stopped",_journeyData.stoppedMedications||[])}
${buildMedSectionEdit("mj-sec-prn",    "🔔","ยาใช้เมื่อมีอาการ (PRN)","mj-section-prn",_journeyData.prnMedications||[])}
</div>`;
  document.getElementById("mj-save-btn").addEventListener("click", ()=>{ saveEdits(); renderMedicationJourney(_journeyData); });
  document.getElementById("mj-cancel-btn").addEventListener("click", ()=>{ _journeyData=_editSnapshot; renderMedicationJourney(_journeyData); });
}

/* ── Bootstrap ──────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async function () {
  const key = "payload_medicationJourney";
  try {
    const result  = await new Promise(r => chrome.storage.session.get(key,r));
    const payload = result && result[key];
    if (payload && payload.journey) { renderMedicationJourney(payload.journey); return; }
  } catch(_) {}
  chrome.runtime.onMessage.addListener(function(msg) {
    if (msg && msg.journey) renderMedicationJourney(msg.journey);
  });
});
