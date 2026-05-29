/* ── page-medication-journey.js ─────────────────────────────────────────────
   ADR Drug Timeline — Gantt-style chart matching the ADR Timeline.png format.
──────────────────────────────────────────────────────────────────────────── */
"use strict";

/* ── Mutable state ──────────────────────────────────────────────────────── */
let _journeyData   = null;
let _editSnapshot  = null;
let _currentRange  = null;
let _rangeOverride = null; /* { start: Date, end: Date } — set by date range picker */
let _persistTimer  = null; /* debounce ADR timeline saves to server */

/* ── BKN server persistence (debounced) ──────────────────────────────────── */
async function _bknServerUrl() {
  return new Promise(resolve => {
    try { chrome.storage.local.get(["bknks.serverUrl"], r => resolve((r && r["bknks.serverUrl"]) || "")); }
    catch (_) { resolve(""); }
  });
}
async function _bknServerFetch(path, opts) {
  opts = opts || {};
  const base = (await _bknServerUrl()).replace(/\/$/, "");
  if (!base) return { ok: false };
  const url = base + (path.startsWith("/") ? path : "/" + path);
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage({
        type: "BKN_SERVER_PROXY", url,
        method: opts.method || "GET", headers: opts.headers || {},
        body: opts.body !== undefined ? opts.body : null,
      }, resp => resolve(resp || { ok: false }));
    } catch (_) { resolve({ ok: false }); }
  });
}
function _persistAdrTimeline() {
  if (!_journeyData) return;
  const ctx = _journeyData.patientContext || {};
  if (!ctx.patientuid) return;
  clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => {
    const payload = {
      customEvents:      _journeyData.customEvents      || [],
      customMedications: _journeyData.customMedications || [],
      adrEvent:          _journeyData.adrEvent          || null,
    };
    _bknServerFetch(`/api/patients/${encodeURIComponent(ctx.patientuid)}/adr-timeline`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  }, 600);
}

/* ── Utilities ──────────────────────────────────────────────────────────── */
function esc(str) {
  return String(str || "")
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }
function _uid() { return Math.random().toString(36).slice(2, 9); }

const EVT_PRESETS = [
  { val: "Hold medicine",   color: "#ef6c00", lbl: "⏸ Hold medicine"   },
  { val: "Resume medicine", color: "#2e7d32", lbl: "▶ Resume medicine"  },
  { val: "Dose change",     color: "#1565c0", lbl: "✏️ Dose change"      },
  { val: "ADR suspected",   color: "#c62828", lbl: "⚠️ ADR suspected"   },
  { val: "Lab result",      color: "#6a1b9a", lbl: "🔬 Lab result"       },
  { val: "",                color: "#546e7a", lbl: "📝 Other..."         },
];
function _evtColor(val) {
  const p = EVT_PRESETS.find(x => x.val === val);
  return p ? p.color : "#546e7a";
}

/* ── Date helpers ───────────────────────────────────────────────────────── */
function parseDate(str) {
  if (!str || str === "unknown") return null;
  const s = String(str);
  let m;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);   if (m) return new Date(+m[1],+m[2]-1,+m[3]); // YYYY-MM-DD
  m = s.match(/^(\d{4})\/(\d{2})\/(\d{2})/);  if (m) return new Date(+m[1],+m[2]-1,+m[3]); // YYYY/MM/DD
  m = s.match(/^(\d{2})-(\d{2})-(\d{4})/);   if (m) return new Date(+m[3],+m[2]-1,+m[1]); // DD-MM-YYYY (Jasper)
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);  if (m) return new Date(+m[3],+m[2]-1,+m[1]); // DD/MM/YYYY
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
  const d = String(dt).slice(0, 10);
  const p = d.split(/[-\/]/);
  if (p.length !== 3) return d;
  if (p[0].length === 4) return `${p[2]}/${p[1]}/${p[0]}`;   /* YYYY-MM-DD or YYYY/MM/DD → DD/MM/YYYY */
  if (p[2].length === 4) return `${p[0]}/${p[1]}/${p[2]}`;   /* DD-MM-YYYY or DD/MM/YYYY → keep as DD/MM/YYYY */
  return d;
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
    ...(jd.activeMedications   || []).map(m => Object.assign({},m,{_secType:"active"})),
    ...(jd.stoppedMedications  || []).map(m => Object.assign({},m,{_secType:"stopped"})),
    ...(jd.prnMedications      || []).map(m => Object.assign({},m,{_secType:"prn"})),
    ...(jd.diluentMedications  || []).map(m => Object.assign({},m,{_secType:"diluent"})),
    ...(jd.customMedications   || []).map(m => Object.assign({},m,{_secType:"active",_isCustom:true})),
  ];
}

/* ── Calculate date range ───────────────────────────────────────────────── */
function calcRange(meds, ctx) {
  /* User-set override takes full precedence */
  if (_rangeOverride && _rangeOverride.start && _rangeOverride.end) {
    const start = dayStart(_rangeOverride.start);
    const end   = dayStart(_rangeOverride.end);
    return { start, end, totalDays: Math.max(diffDays(start, end), 1) };
  }

  const today = dayStart(new Date());
  const dates = [ addDays(today, -7), addDays(today, 2) ]; /* minimum window */

  const _ok = d => d && d.getFullYear() >= 1990 && d.getFullYear() <= 2100;
  const admit = parseDate(ctx && ctx.admitDate);
  if (_ok(admit)) dates.push(admit);
  for (const m of meds) {
    const s = parseDate(m.startDateTime), e = parseDate(m.endDateTime);
    if (_ok(s)) dates.push(s);
    if (_ok(e)) dates.push(e);
  }

  const minTs = Math.min(...dates.map(d => d.getTime()));
  const maxTs = Math.max(...dates.map(d => d.getTime()));
  const start = dayStart(new Date(minTs));
  const end   = dayStart(addDays(new Date(maxTs), 1));
  return { start, end, totalDays: Math.max(diffDays(start, end), 1) };
}

function pct(n, total) { return (n/total*100).toFixed(3); }

/* ── Bar color per medication type ──────────────────────────────────────── */
function getMedColor(med) {
  if (med._isCustom)                               return med.color || "#7b1fa2";
  if (med.isCancelled || med._secType==="stopped") return "#90a4ae";
  if (med._isIv)                                   return "#1565c0";
  if (med._secType==="prn")                        return "#00838f";
  if (med._secType==="diluent")                    return "#78909c";
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
function buildGanttRow(med, range, vlineHtml, atMap, rowEvents) {
  const { start, totalDays } = range;
  const sDate = parseDate(med.startDateTime);

  const isStatOrOnce = med.isStatOrder ||
    /^\s*once\s*$|\bone\s+time\b|\bone\s+dose\b|\bsingle\s+dose\b|\bx\s*1\b/i.test(med.frequency || "");

  const badges = [];
  if (med._isIv)    badges.push(`<span class="mj-drug-bdg mj-bdg-iv">IV</span>`);
  if (med._secType==="prn")    badges.push(`<span class="mj-drug-bdg mj-bdg-prn">PRN</span>`);
  if (med._secType==="stopped"||med.isCancelled) badges.push(`<span class="mj-drug-bdg mj-bdg-stopped">หยุดใช้</span>`);
  if (med._secType==="diluent")badges.push(`<span class="mj-drug-bdg mj-bdg-diluent">สารน้ำ</span>`);
  if (isStatOrOnce) badges.push(`<span class="mj-drug-bdg mj-bdg-stat">${med.isStatOrder ? "STAT" : "1×"}</span>`);
  if (med._isCustom) badges.push(`<span class="mj-drug-bdg mj-bdg-custom">Manual</span>`);

  const rawKey = (med.drugName || "") + "|" + (med.startDateTime || "");
  const medKey = esc(rawKey);
  const secType = esc(med._secType || "active");

  const notePreview = med.pharmacistNote
    ? `<div class="mj-note-preview">📝 ${esc(med.pharmacistNote)}</div>` : "";

  const drugCol = `<div class="mj-drug-col">
    <div class="mj-row-ctrl">
      <button class="mj-row-del" data-medkey="${medKey}" data-sec="${secType}" title="ลบ">−</button>
      <button class="mj-row-edit" data-medkey="${medKey}" title="แก้ไข">✏️</button>
      <button class="mj-note-btn" data-medkey="${medKey}" title="บันทึก">📝</button>
    </div>
    <div class="mj-dn">${esc(med.drugName||"–")} ${badges.join("")}</div>
    <div class="mj-dd">${esc(med.displayDose||"")}</div>
    <div class="mj-ddate">${esc(fmtDateRange(med.startDateTime,med.endDateTime))}</div>
    ${notePreview}
  </div>`;

  /* Build row-level event dots (events associated with this drug) */
  let rowEvtHtml = "";
  for (const ev of (rowEvents || [])) {
    const d = parseDate(ev.date);
    if (!d) continue;
    const off = diffDays(start, d);
    if (off < 0 || off > totalDays) continue;
    const c = ev.color || "#e65100";
    rowEvtHtml += `<div class="mj-row-evt-dot" data-evtid="${esc(ev.id)}" style="left:${pct(off,totalDays)}%;border-color:${c}" title="${esc(ev.note)}">
      <div class="mj-cevt-lbl" style="color:${c};border-color:${c}">${esc(ev.note)}</div>
      <button class="mj-cevt-del" data-evtid="${esc(ev.id)}">×</button>
    </div>`;
  }

  if (!sDate) {
    return `<div class="mj-gantt-row" data-medkey="${medKey}">${drugCol}<div class="mj-bars-col">${vlineHtml}${rowEvtHtml}</div></div>`;
  }

  const isStopped = med._secType==="stopped" || med.isCancelled;
  const eDate = parseDate(med.endDateTime) || (isStopped ? sDate : new Date());
  const sOff  = Math.max(0, Math.min(totalDays, diffDays(start, sDate)));
  const eOff  = Math.max(sOff+0.3, Math.min(totalDays, diffDays(start, eDate)));
  const lp    = pct(sOff, totalDays);
  const wp    = pct(eOff-sOff, totalDays);
  const color = getMedColor(med);
  const alpha = isStopped ? "0.55" : "1";

  if (isStatOrOnce) {
    return `<div class="mj-gantt-row" data-medkey="${medKey}">${drugCol}<div class="mj-bars-col">
      ${vlineHtml}
      <div class="mj-stat-dot" style="left:${lp}%;background:${color};opacity:${alpha}"></div>
      ${rowEvtHtml}
    </div></div>`;
  }

  let ticksHtml = "";
  if (med._isOral && atMap) {
    const times = findAdminTimes(med, atMap);
    for (const dtStr of times) {
      const frac = diffDaysFrac(start, dtStr);
      if (frac === null || frac < 0 || frac > totalDays) continue;
      ticksHtml += `<div class="mj-admin-tick" style="left:${pct(frac,totalDays)}%"></div>`;
    }
  }

  const barLabel = med.pharmacistNote ? `<span class="mj-bar-lbl">${esc(med.pharmacistNote)}</span>` : "";
  const stopX    = isStopped ? `<div class="mj-stop-x" style="left:calc(${lp}% + ${wp}% - 5px)">✕</div>` : "";
  const dashed   = med._isCustom ? "border:2px dashed rgba(255,255,255,.6)" : "";

  return `<div class="mj-gantt-row" data-medkey="${medKey}">${drugCol}<div class="mj-bars-col">
    ${vlineHtml}
    <div class="mj-bar" style="left:${lp}%;width:${wp}%;background:${color};opacity:${alpha};${dashed}">${barLabel}</div>
    ${stopX}${ticksHtml}${rowEvtHtml}
  </div></div>`;
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

/* ── Custom events row ───────────────────────────────────────────────────── */
function buildEventsRow(events, range, vlineHtml) {
  const { start, totalDays } = range;
  let dots = vlineHtml;
  for (const ev of (events || [])) {
    const d = parseDate(ev.date);
    if (!d) continue;
    const off = diffDays(start, d);
    if (off < 0 || off > totalDays) continue;
    const lp = pct(off, totalDays);
    const c  = ev.color || "#e65100";
    dots += `<div class="mj-cevt-dot" data-evtid="${esc(ev.id)}" style="left:${lp}%;border-color:${c};top:50%" title="${esc(ev.note)}">
      <div class="mj-cevt-lbl" style="color:${c};border-color:${c}">${esc(ev.note)}</div>
      <button class="mj-cevt-del" data-evtid="${esc(ev.id)}">×</button>
    </div>`;
  }
  return `<div class="mj-gantt-row mj-cevt-row">
    <div class="mj-drug-col mj-cevt-hdr">📌 Events</div>
    <div class="mj-bars-col mj-cevt-bars">${dots}</div>
  </div>`;
}

/* ── Add event panel ─────────────────────────────────────────────────────── */
function buildAddEventPanel() {
  const opts = EVT_PRESETS.map(p =>
    `<option value="${esc(p.val)}" data-color="${esc(p.color)}">${esc(p.lbl)}</option>`
  ).join("");
  return `<div id="mj-add-event-panel" class="mj-add-panel" style="display:none">
  <div class="mj-add-panel-title">📌 เพิ่มเหตุการณ์บน Timeline</div>
  <div class="mj-add-panel-row">
    <label class="mj-add-panel-lbl">วันที่<input type="date" id="mj-evt-date" class="mj-adr-input"></label>
    <label class="mj-add-panel-lbl">ประเภท<select id="mj-evt-preset" class="mj-adr-input">${opts}</select></label>
    <label class="mj-add-panel-lbl mj-add-panel-full">หมายเหตุเพิ่มเติม
      <input type="text" id="mj-evt-note" class="mj-adr-input" placeholder="เช่น Hold amoxicillin เนื่องจาก rash">
    </label>
  </div>
  <div class="mj-add-panel-btns">
    <button id="mj-evt-ok"     class="mj-btn mj-btn-save">✓ เพิ่ม</button>
    <button id="mj-evt-cancel" class="mj-btn" style="background:#f5f5f5;color:#546e7a;border-color:#bdbdbd">✕ ยกเลิก</button>
  </div>
</div>`;
}

/* ── Add medication panel ────────────────────────────────────────────────── */
function buildAddMedPanel() {
  return `<div id="mj-add-med-panel" class="mj-add-panel" style="display:none">
  <div class="mj-add-panel-title">💊 เพิ่มยา (manual bar)</div>
  <div class="mj-add-panel-row">
    <label class="mj-add-panel-lbl mj-add-panel-full">ชื่อยา / dose
      <input type="text" id="mj-cmed-name" class="mj-adr-input" placeholder="เช่น Aspirin 81 mg OD">
    </label>
    <label class="mj-add-panel-lbl">วันเริ่ม<input type="date" id="mj-cmed-start" class="mj-adr-input"></label>
    <label class="mj-add-panel-lbl">วันสิ้นสุด<input type="date" id="mj-cmed-end" class="mj-adr-input"></label>
    <label class="mj-add-panel-lbl mj-add-panel-full">หมายเหตุ (แสดงบนแถบ)
      <input type="text" id="mj-cmed-note" class="mj-adr-input" placeholder="เช่น ยาที่บ้าน, ยาฉุกเฉิน">
    </label>
  </div>
  <div class="mj-add-panel-btns">
    <button id="mj-cmed-ok"     class="mj-btn mj-btn-save">✓ เพิ่ม</button>
    <button id="mj-cmed-cancel" class="mj-btn" style="background:#f5f5f5;color:#546e7a;border-color:#bdbdbd">✕ ยกเลิก</button>
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

  const atMap     = buildAdminTimesMap(journeyData);
  const dateHdr   = buildDateHeader(range);

  /* General events row (no drugKey) */
  const generalEvts = (journeyData.customEvents || []).filter(ev => !ev.drugKey);
  const eventsRow   = buildEventsRow(generalEvts, range, vlineHtml);

  /* Per-drug events */
  const rows = meds.map(m => {
    const mk = (m.drugName || "") + "|" + (m.startDateTime || "");
    const rowEvts = (journeyData.customEvents || []).filter(ev => ev.drugKey === mk);
    return buildGanttRow(m, range, vlineHtml, atMap, rowEvts);
  }).join("");

  /* Date range bar */
  const isoFmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const overFrom = _rangeOverride ? isoFmt(_rangeOverride.start) : isoFmt(range.start);
  const overTo   = _rangeOverride ? isoFmt(_rangeOverride.end)   : isoFmt(range.end);
  const rangeBar = `<div class="mj-range-bar">
    <span class="mj-range-lbl">📅 ช่วงวันที่:</span>
    <input type="date" id="mj-range-from" class="mj-range-input" value="${overFrom}">
    <span class="mj-range-sep">–</span>
    <input type="date" id="mj-range-to"   class="mj-range-input" value="${overTo}">
    <button id="mj-range-apply" class="mj-btn mj-btn-save" style="padding:3px 10px;font-size:11px">✓ ปรับ</button>
    <button id="mj-range-reset" class="mj-btn" style="padding:3px 10px;font-size:11px;background:#f5f5f5;color:#546e7a;border-color:#bdbdbd">↺ Auto</button>
  </div>`;

  /* + Add drug row at bottom */
  const addRow = `<div class="mj-gantt-row mj-add-drug-row">
    <div class="mj-drug-col" style="display:flex;align-items:center;justify-content:center;padding:6px">
      <button id="mj-inline-add-med-btn" class="mj-btn" style="background:#f3e5f5;color:#7b1fa2;border-color:#ce93d8;font-size:12px;padding:4px 14px">➕ เพิ่มยา</button>
    </div>
    <div class="mj-bars-col"></div>
  </div>`;

  return `${rangeBar}<div class="mj-gantt-scroll">
  <div class="mj-gantt">
    <div class="mj-gantt-hdr-row">
      <div class="mj-drug-col mj-drug-col-hdr">Medication / Order evidence</div>
      <div class="mj-dates-hdr-col">${dateHdr}</div>
    </div>
    ${eventsRow}
    ${rows}
    ${addRow}
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

/* ── Floating popup for click-to-add-event & note edit ──────────────────── */
function _closePopup(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function _showClickEventPopup(date, clientX, clientY, drugKey) {
  _closePopup("mj-float-popup");
  const iso = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  const opts = EVT_PRESETS.map(p =>
    `<option value="${esc(p.val)}" data-color="${esc(p.color)}">${esc(p.lbl)}</option>`
  ).join("");

  const pop = document.createElement("div");
  pop.id = "mj-float-popup";
  pop.className = "mj-float-popup";
  pop.innerHTML = `
    <div class="mj-fpop-title">📌 ${esc(fmtDate(iso))}</div>
    <select id="mj-fpop-preset" class="mj-adr-input" style="margin-bottom:6px">${opts}</select>
    <input id="mj-fpop-note" class="mj-adr-input" placeholder="หมายเหตุ...">
    <div style="display:flex;gap:6px;margin-top:8px">
      <button id="mj-fpop-ok"     class="mj-btn mj-btn-save" style="flex:1">✓ เพิ่ม</button>
      <button id="mj-fpop-cancel" class="mj-btn" style="background:#f5f5f5;color:#546e7a;border-color:#bdbdbd">✕</button>
    </div>`;

  /* Position near click, keep inside viewport */
  const vw = window.innerWidth, vh = window.innerHeight;
  let left = clientX + 8, top = clientY - 10;
  document.body.appendChild(pop);
  const pw = pop.offsetWidth || 240, ph = pop.offsetHeight || 140;
  if (left + pw > vw - 8) left = clientX - pw - 8;
  if (top + ph > vh - 8) top = vh - ph - 8;
  pop.style.left = left + "px";
  pop.style.top  = top  + "px";

  const noteEl   = document.getElementById("mj-fpop-note");
  const presetEl = document.getElementById("mj-fpop-preset");
  if (noteEl) noteEl.focus();
  if (presetEl) presetEl.addEventListener("change", () => {
    if (noteEl && presetEl.value) noteEl.value = presetEl.value;
  });

  document.getElementById("mj-fpop-cancel").addEventListener("click", () => _closePopup("mj-float-popup"));
  document.getElementById("mj-fpop-ok").addEventListener("click", () => {
    const note = noteEl ? noteEl.value.trim() : "";
    if (!note) { if (noteEl) noteEl.focus(); return; }
    const color = presetEl ? ((presetEl.selectedOptions[0] || {}).dataset || {}).color || _evtColor(presetEl.value) : "#546e7a";
    if (!_journeyData.customEvents) _journeyData.customEvents = [];
    _journeyData.customEvents.push({ id: _uid(), date: iso, note, color, drugKey: drugKey || null });
    _closePopup("mj-float-popup");
    renderMedicationJourney(_journeyData);
  });

  /* Dismiss on outside click */
  setTimeout(() => {
    function _outside(e) {
      if (!pop.contains(e.target)) { _closePopup("mj-float-popup"); document.removeEventListener("mousedown", _outside); }
    }
    document.addEventListener("mousedown", _outside);
  }, 50);
}

function _showNotePopup(medKey, currentNote, clientX, clientY) {
  _closePopup("mj-float-popup");
  const pop = document.createElement("div");
  pop.id = "mj-float-popup";
  pop.className = "mj-float-popup";
  pop.innerHTML = `
    <div class="mj-fpop-title">📝 บันทึก / Annotation</div>
    <textarea id="mj-fpop-note-ta" class="mj-adr-input" rows="3" style="resize:vertical;min-height:60px">${esc(currentNote)}</textarea>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button id="mj-fpop-note-ok"  class="mj-btn mj-btn-save" style="flex:1">✓ บันทึก</button>
      <button id="mj-fpop-note-del" class="mj-btn" style="background:#ffebee;color:#c62828;border-color:#ef9a9a">🗑️</button>
      <button id="mj-fpop-note-cancel" class="mj-btn" style="background:#f5f5f5;color:#546e7a;border-color:#bdbdbd">✕</button>
    </div>`;

  const vw = window.innerWidth, vh = window.innerHeight;
  let left = clientX + 8, top = clientY - 10;
  document.body.appendChild(pop);
  const pw = pop.offsetWidth || 260, ph = pop.offsetHeight || 160;
  if (left + pw > vw - 8) left = clientX - pw - 8;
  if (top + ph > vh - 8) top = vh - ph - 8;
  pop.style.left = left + "px";
  pop.style.top  = top  + "px";

  const ta = document.getElementById("mj-fpop-note-ta");
  if (ta) { ta.focus(); ta.select(); }

  function _save(note) {
    const [dName, sDT] = medKey.split("|");
    const secs = ["activeMedications","stoppedMedications","prnMedications","diluentMedications","customMedications"];
    for (const s of secs) {
      const arr = _journeyData[s] || [];
      const m = arr.find(x => x.drugName === dName && x.startDateTime === sDT);
      if (m) { m.pharmacistNote = note; break; }
    }
    _closePopup("mj-float-popup");
    renderMedicationJourney(_journeyData);
  }

  document.getElementById("mj-fpop-note-cancel").addEventListener("click", () => _closePopup("mj-float-popup"));
  document.getElementById("mj-fpop-note-del").addEventListener("click", () => _save(""));
  document.getElementById("mj-fpop-note-ok").addEventListener("click", () => _save(ta ? ta.value.trim() : ""));

  setTimeout(() => {
    function _outside(e) {
      if (!pop.contains(e.target)) { _closePopup("mj-float-popup"); document.removeEventListener("mousedown", _outside); }
    }
    document.addEventListener("mousedown", _outside);
  }, 50);
}

function _showEditMedPopup(med, medKey, clientX, clientY) {
  _closePopup("mj-float-popup");
  const isoFmt = d => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : "";
  const startIso = isoFmt(parseDate(med.startDateTime)) || med.startDateTime || "";
  const endIso   = isoFmt(parseDate(med.endDateTime))   || med.endDateTime   || "";

  const pop = document.createElement("div");
  pop.id = "mj-float-popup";
  pop.className = "mj-float-popup";
  pop.style.minWidth = "270px";
  pop.innerHTML = `
    <div class="mj-fpop-title">✏️ แก้ไขยา</div>
    <label style="display:flex;flex-direction:column;font-size:9px;font-weight:700;color:#90a4ae;gap:2px;margin-bottom:6px">ชื่อยา
      <input id="mj-ep-name" class="mj-adr-input" value="${esc(med.drugName||"")}">
    </label>
    <label style="display:flex;flex-direction:column;font-size:9px;font-weight:700;color:#90a4ae;gap:2px;margin-bottom:6px">ขนาด / วิธีใช้
      <input id="mj-ep-dose" class="mj-adr-input" value="${esc(med.displayDose||"")}">
    </label>
    <div style="display:flex;gap:8px;margin-bottom:6px">
      <label style="flex:1;display:flex;flex-direction:column;font-size:9px;font-weight:700;color:#90a4ae;gap:2px">วันเริ่ม
        <input type="date" id="mj-ep-start" class="mj-adr-input" value="${esc(startIso)}">
      </label>
      <label style="flex:1;display:flex;flex-direction:column;font-size:9px;font-weight:700;color:#90a4ae;gap:2px">วันสิ้นสุด
        <input type="date" id="mj-ep-end" class="mj-adr-input" value="${esc(endIso)}">
      </label>
    </div>
    <label style="display:flex;flex-direction:column;font-size:9px;font-weight:700;color:#90a4ae;gap:2px;margin-bottom:8px">บันทึก
      <input id="mj-ep-note" class="mj-adr-input" value="${esc(med.pharmacistNote||"")}">
    </label>
    <div style="display:flex;gap:6px">
      <button id="mj-ep-ok"     class="mj-btn mj-btn-save" style="flex:1">✓ บันทึก</button>
      <button id="mj-ep-cancel" class="mj-btn" style="background:#f5f5f5;color:#546e7a;border-color:#bdbdbd">✕</button>
    </div>`;

  const vw = window.innerWidth, vh = window.innerHeight;
  document.body.appendChild(pop);
  let left = clientX + 8, top = clientY - 10;
  const pw = pop.offsetWidth || 280, ph = pop.offsetHeight || 200;
  if (left + pw > vw - 8) left = clientX - pw - 8;
  if (top  + ph > vh - 8) top  = vh - ph - 8;
  pop.style.left = left + "px";
  pop.style.top  = top  + "px";

  document.getElementById("mj-ep-cancel").addEventListener("click", () => _closePopup("mj-float-popup"));
  document.getElementById("mj-ep-ok").addEventListener("click", () => {
    med.drugName      = (document.getElementById("mj-ep-name") .value || "").trim();
    med.displayDose   = (document.getElementById("mj-ep-dose") .value || "").trim();
    med.startDateTime = document.getElementById("mj-ep-start").value || med.startDateTime;
    med.endDateTime   = document.getElementById("mj-ep-end")  .value || med.endDateTime;
    med.pharmacistNote= (document.getElementById("mj-ep-note") .value || "").trim();
    _closePopup("mj-float-popup");
    renderMedicationJourney(_journeyData);
  });

  setTimeout(() => {
    function _out(e) { if (!pop.contains(e.target)) { _closePopup("mj-float-popup"); document.removeEventListener("mousedown",_out); } }
    document.addEventListener("mousedown", _out);
  }, 50);
}

/* ── Save helpers ────────────────────────────────────────────────────────── */
function _adrFilename(ctx) {
  const hn = String(ctx.hn || ctx.patientId || "patient")
    .trim().replace(/[^a-zA-Z0-9\-]/g, "");
  return hn + "_ADR_timeline";
}

function saveToPdf(journeyData) {
  const filename   = _adrFilename(journeyData.patientContext || {});
  const origTitle  = document.title;
  document.title   = filename;
  window.print();
  /* Restore title after print dialog opens */
  setTimeout(function () { document.title = origTitle; }, 1500);
}

async function saveToPng(journeyData) {
  const filename = _adrFilename(journeyData.patientContext || {});
  const root = document.getElementById("mj-root");
  if (!root) { alert("ไม่พบข้อมูล"); return; }

  try {
    /* Fetch the extension's CSS so we can inline it (avoids tainted-canvas) */
    const cssUrl  = chrome.runtime.getURL("src/features/medication-journey/medication-journey.css");
    const cssText = await fetch(cssUrl).then(r => r.text()).catch(() => "");

    /* Clone DOM — avoids modifying live page */
    const clone = root.cloneNode(true);
    clone.style.cssText = `width:${root.scrollWidth}px;overflow:visible;`;

    /* Let the inner Gantt scroll expand to full width */
    const scroll = clone.querySelector(".mj-gantt-scroll");
    if (scroll) { scroll.style.overflow = "visible"; scroll.style.width = "100%"; }

    /* Remove transient floating elements from the clone */
    ["mj-float-popup","arcus-medj-toast2","arcus-medj-err-overlay"].forEach(id => {
      const el = clone.querySelector("#" + id); if (el) el.remove();
    });

    const W = root.scrollWidth;
    const H = root.scrollHeight;

    const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <foreignObject x="0" y="0" width="${W}" height="${H}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0">
      <style>
        *,*::before,*::after{box-sizing:border-box}
        body{margin:0;padding:0;background:#f0f4f8;font-family:"Segoe UI",Arial,sans-serif;font-size:13px;color:#1a1a2e}
        ${cssText}
      </style>
      ${clone.outerHTML}
    </div>
  </foreignObject>
</svg>`;

    const DPR    = Math.min(window.devicePixelRatio || 2, 2);
    const canvas = document.createElement("canvas");
    canvas.width  = W * DPR;
    canvas.height = H * DPR;
    const ctx = canvas.getContext("2d");
    ctx.scale(DPR, DPR);
    ctx.fillStyle = "#f0f4f8";
    ctx.fillRect(0, 0, W, H);

    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url  = URL.createObjectURL(blob);

    await new Promise((resolve, reject) => {
      const img   = new Image();
      img.onload  = () => { ctx.drawImage(img, 0, 0); URL.revokeObjectURL(url); resolve(); };
      img.onerror = ()  => { URL.revokeObjectURL(url); reject(new Error("SVG render failed")); };
      img.src = url;
    });

    const pngUrl = canvas.toDataURL("image/png");  /* throws SecurityError if tainted */
    const a      = document.createElement("a");
    a.href        = pngUrl;
    a.download    = filename + ".png";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);

  } catch (e) {
    console.error("[ADR Timeline] PNG save failed:", e);
    if (confirm("ไม่สามารถบันทึก PNG ได้\nต้องการบันทึกเป็น PDF แทนหรือไม่?")) {
      saveToPdf(journeyData);
    }
  }
}

/* ── Wire view-mode interactivity ───────────────────────────────────────── */
function wireInteractivity(journeyData) {
  const $  = id => document.getElementById(id);
  const on = (id, fn) => { const el=$(id); if(el) el.addEventListener("click",fn); };

  on("mj-print-btn",  () => window.print());
  on("mj-pdf-btn",    () => saveToPdf(journeyData));
  on("mj-png-btn",    () => saveToPng(journeyData));
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
    _persistAdrTimeline();

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

  /* ── Date range controls ─────────────────────────────────────────────── */
  on("mj-range-apply", () => {
    const fromVal = $("mj-range-from") ? $("mj-range-from").value : "";
    const toVal   = $("mj-range-to")   ? $("mj-range-to").value   : "";
    if (fromVal && toVal && fromVal <= toVal) {
      _rangeOverride = { start: parseDate(fromVal), end: parseDate(toVal) };
      renderMedicationJourney(_journeyData);
    }
  });
  on("mj-range-reset", () => { _rangeOverride = null; renderMedicationJourney(_journeyData); });

  /* ── + button at bottom ──────────────────────────────────────────────── */
  on("mj-inline-add-med-btn", () => {
    const p = $("mj-add-med-panel");
    if (p) { p.style.display = ""; p.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  });

  /* ── Remove drug row ─────────────────────────────────────────────────── */
  document.querySelectorAll(".mj-row-del").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const key = btn.dataset.medkey || "";
      const [dName, sDT] = key.split("|");
      const secMap = { active:"activeMedications", stopped:"stoppedMedications", prn:"prnMedications", diluent:"diluentMedications" };
      const secKey = secMap[btn.dataset.sec] || null;
      const _rm = arr => (arr || []).filter(m => !(m.drugName === dName && m.startDateTime === sDT));
      if (secKey && _journeyData[secKey]) _journeyData[secKey] = _rm(_journeyData[secKey]);
      if (_journeyData.customMedications) _journeyData.customMedications = _rm(_journeyData.customMedications);
      renderMedicationJourney(_journeyData);
    });
  });

  /* ── Edit drug row popup ─────────────────────────────────────────────── */
  document.querySelectorAll(".mj-row-edit").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const key = btn.dataset.medkey || "";
      const [dName, sDT] = key.split("|");
      const secs = ["activeMedications","stoppedMedications","prnMedications","diluentMedications","customMedications"];
      let med = null;
      for (const s of secs) { med = (_journeyData[s]||[]).find(m=>m.drugName===dName&&m.startDateTime===sDT); if(med) break; }
      if (!med) return;
      _showEditMedPopup(med, key, e.clientX, e.clientY);
    });
  });

  /* ── Click on chart background to add event ──────────────────────────── */
  document.querySelectorAll(".mj-bars-col").forEach(col => {
    col.addEventListener("click", e => {
      if (!_currentRange) return;
      const tag = (e.target.tagName || "").toUpperCase();
      if (tag === "BUTTON" || tag === "SPAN" || e.target.classList.contains("mj-bar") ||
          e.target.classList.contains("mj-vline") || e.target.classList.contains("mj-cevt-dot") ||
          e.target.classList.contains("mj-row-evt-dot")) return;
      const rect  = col.getBoundingClientRect();
      const frac  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const off   = Math.round(frac * _currentRange.totalDays);
      const date  = addDays(_currentRange.start, off);
      /* Determine if this click belongs to a specific drug row */
      const row   = col.closest(".mj-gantt-row");
      const drugKey = (row && row.dataset.medkey) ? decodeURIComponent(row.dataset.medkey) : null;
      _showClickEventPopup(date, e.clientX, e.clientY, drugKey);
    });
  });

  /* ── Note button on each medication row ───────────────────────────────── */
  document.querySelectorAll(".mj-note-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const key = btn.dataset.medkey || "";
      const [dName, sDT] = key.split("|");
      const secs = ["activeMedications","stoppedMedications","prnMedications","diluentMedications","customMedications"];
      let currentNote = "";
      for (const s of secs) {
        const m = (_journeyData[s] || []).find(x => x.drugName === dName && x.startDateTime === sDT);
        if (m) { currentNote = m.pharmacistNote || ""; break; }
      }
      _showNotePopup(key, currentNote, e.clientX, e.clientY);
    });
  });

  /* ── Add event panel ──────────────────────────────────────────────────── */
  function _rerender() { renderMedicationJourney(_journeyData); }

  on("mj-add-event-btn", () => {
    const p = $("mj-add-event-panel");
    if (p) p.style.display = p.style.display === "none" ? "" : "none";
  });
  on("mj-evt-cancel", () => { const p = $("mj-add-event-panel"); if (p) p.style.display = "none"; });

  /* Auto-fill note from preset */
  const evtPreset = $("mj-evt-preset");
  const evtNote   = $("mj-evt-note");
  if (evtPreset) evtPreset.addEventListener("change", () => {
    if (evtNote && evtPreset.value) evtNote.value = evtPreset.value;
  });

  on("mj-evt-ok", () => {
    const date  = $("mj-evt-date")   ? $("mj-evt-date").value   : "";
    const note  = evtNote            ? evtNote.value.trim()      : "";
    const color = evtPreset          ? (() => {
      const sel = evtPreset.selectedOptions[0];
      return (sel && sel.dataset.color) || _evtColor(evtPreset.value);
    })() : "#546e7a";
    if (!date || !note) { alert("กรุณาระบุวันที่และหมายเหตุ"); return; }
    if (!_journeyData.customEvents) _journeyData.customEvents = [];
    _journeyData.customEvents.push({ id: _uid(), date, note, color });
    _rerender();
  });

  /* Delete event dot */
  document.querySelectorAll(".mj-cevt-del").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.dataset.evtid;
      if (_journeyData.customEvents)
        _journeyData.customEvents = _journeyData.customEvents.filter(ev => ev.id !== id);
      _rerender();
    });
  });

  /* ── Add medication panel ─────────────────────────────────────────────── */
  on("mj-add-med-btn", () => {
    const p = $("mj-add-med-panel");
    if (p) p.style.display = p.style.display === "none" ? "" : "none";
  });
  on("mj-cmed-cancel", () => { const p = $("mj-add-med-panel"); if (p) p.style.display = "none"; });

  on("mj-cmed-ok", () => {
    const name  = $("mj-cmed-name")  ? $("mj-cmed-name").value.trim()  : "";
    const start = $("mj-cmed-start") ? $("mj-cmed-start").value        : "";
    const end   = $("mj-cmed-end")   ? $("mj-cmed-end").value          : "";
    const note  = $("mj-cmed-note")  ? $("mj-cmed-note").value.trim()  : "";
    if (!name || !start) { alert("กรุณาระบุชื่อยาและวันเริ่ม"); return; }
    if (!_journeyData.customMedications) _journeyData.customMedications = [];
    _journeyData.customMedications.push({
      _id: _uid(), drugName: name,
      startDateTime: start, endDateTime: end || start,
      pharmacistNote: note, displayDose: note,
    });
    _rerender();
  });

  /* Delete custom medication bar */
  document.querySelectorAll(".mj-cmed-del-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.dataset.cmedid;
      if (_journeyData.customMedications)
        _journeyData.customMedications = _journeyData.customMedications.filter(m => m._id !== id);
      _rerender();
    });
  });
}

/* ── renderMedicationJourney ────────────────────────────────────────────── */
function renderMedicationJourney(journeyData) {
  _journeyData = journeyData;
  /* Persist any changes (customEvents, customMedications, adrEvent) to server */
  _persistAdrTimeline();
  const root = document.getElementById("mj-root");
  if (!root) return;

  const ctx    = journeyData.patientContext || {};
  const name   = ctx.patientName || "";
  const hn     = ctx.hn || ctx.patientId || "";
  const sub    = [name, hn ? `HN ${hn}` : "", ctx.bed ? `Room ${ctx.bed}` : ""].filter(Boolean).join(" · ");
  const pharm  = ctx.pharmacistName ? `เภสัชกรผู้บันทึก: ${ctx.pharmacistName}` : "";

  root.innerHTML = `<div class="mj-page">
<div class="mj-header">
  <div class="mj-header-left">
    <div class="mj-page-title">ADR Timeline</div>
    ${sub   ? `<div class="mj-page-sub">${esc(sub)}</div>`   : ""}
    ${pharm ? `<div class="mj-page-sub" style="color:#7b1fa2;font-weight:600">💊 ${esc(pharm)}</div>` : ""}
  </div>
  ${buildAdrCalloutWithForm(journeyData.adrEvent)}
  <div class="mj-header-actions">
    <button id="mj-add-event-btn" class="mj-btn" style="background:#fff3e0;color:#e65100;border-color:#ffcc80">📌 เหตุการณ์</button>
    <button id="mj-add-med-btn"   class="mj-btn" style="background:#f3e5f5;color:#7b1fa2;border-color:#ce93d8">💊 ยา</button>
    <button id="mj-edit-btn"      class="mj-btn mj-btn-edit">✏️ แก้ไข</button>
    <button id="mj-print-btn"     class="mj-btn mj-btn-print">🖨️ พิมพ์</button>
    <button id="mj-pdf-btn"       class="mj-btn" style="background:#fbe9e7;color:#bf360c;border-color:#ffab91">📄 PDF</button>
    <button id="mj-png-btn"       class="mj-btn" style="background:#e8eaf6;color:#283593;border-color:#9fa8da">🖼️ PNG</button>
    <button id="mj-export-btn"    class="mj-btn mj-btn-export">⬇️ JSON</button>
    <button id="mj-copy-btn"      class="mj-btn mj-btn-copy">📋 คัดลอก</button>
  </div>
</div>
${buildAddEventPanel()}
${buildAddMedPanel()}
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
  /* Store original object as JSON so readEditSection can merge back all computed fields */
  const origJson = esc(JSON.stringify(order));
  return `<div class="mj-edit-row" data-orig="${origJson}">
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
    /* Start from original to preserve _isIv, _isOral, isPrn, etc. */
    let base = {};
    try { base = JSON.parse(row.dataset.orig || "{}"); } catch (_) {}
    row.querySelectorAll("[data-prop]").forEach(el => {
      base[el.dataset.prop] = el.value.trim();
    });
    return base;
  }).filter(o => (o.drugName || "").trim());
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
