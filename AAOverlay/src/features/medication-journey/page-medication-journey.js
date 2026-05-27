/* ── page-medication-journey.js ────────────────────────────────────────────
   Renders the journey data into page-medication-journey.html.
   No external dependencies — plain JS only.
──────────────────────────────────────────────────────────────────────────── */
"use strict";

/* ── Event type metadata ───────────────────────────────────────────────── */
const EVENT_META = {
  start:    { icon: "🟢", label: "ยาเริ่มใช้",               color: "#2e7d32" },
  continue: { icon: "🔵", label: "ยาต่อเนื่อง",              color: "#1565c0" },
  change:   { icon: "🟡", label: "ยาปรับขนาด/วิธีใช้",      color: "#e65100" },
  switch:   { icon: "🟣", label: "ยาฉีดเปลี่ยนเป็นยากิน",   color: "#7b1fa2" },
  stop:     { icon: "🔴", label: "ยาหยุดใช้แล้ว",            color: "#c62828" },
  prn:      { icon: "🩵", label: "ใช้เมื่อมีอาการ (PRN)",    color: "#00695c" },
  diluent:  { icon: "⚗️", label: "สารน้ำเจือจาง",           color: "#546e7a" },
  alert:    { icon: "⚠️", label: "มีข้อมูลแจ้งเตือน",       color: "#e65100" },
};

/* ── Utility ────────────────────────────────────────────────────────────── */
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDate(dt) {
  if (!dt) return "";
  const d = String(dt).slice(0, 10);
  if (!d || d === "unknown") return dt || "";
  /* Convert YYYY-MM-DD to DD/MM/YYYY for display */
  const parts = d.split("-");
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return d;
}

function fmtDateRange(start, end) {
  const s = fmtDate(start);
  const e = fmtDate(end);
  if (s && e) return `${s} – ${e}`;
  return s || e || "";
}

/* ── Patient card ───────────────────────────────────────────────────────── */
function buildPatientCard(ctx) {
  const fields = [
    { lbl: "ชื่อผู้ป่วย",  val: ctx.patientName    || "–" },
    { lbl: "HN",           val: ctx.hn || ctx.patientId || "–" },
    { lbl: "AN",           val: ctx.an || ctx.patientVisitId || "–" },
    { lbl: "เพศ",          val: ctx.gender   || "–" },
    { lbl: "วันเกิด",      val: ctx.dob      || "–" },
    { lbl: "อายุ",         val: ctx.age      || "–" },
    { lbl: "เตียง",        val: ctx.bed      || "–" },
    { lbl: "แผนก",         val: ctx.dept     || "–" },
    { lbl: "แพทย์",        val: ctx.doctor   || "–" },
    { lbl: "วันรับไว้",    val: ctx.admitDate|| "–" },
  ];

  const fieldHtml = fields.map(f =>
    `<div class="mj-patient-field">
       <div class="lbl">${esc(f.lbl)}</div>
       <div class="val">${esc(f.val)}</div>
     </div>`
  ).join("");

  return `<div class="mj-patient-card">${fieldHtml}</div>`;
}

/* ── Source bar ─────────────────────────────────────────────────────────── */
function buildSourceBar(source) {
  if (!source) return "";
  const parts = [];
  if (source.usedJasperXls)    parts.push(`<span class="mj-source-tag">📊 Jasper XLS</span>`);
  if (source.usedHtmlFallback) parts.push(`<span class="mj-source-tag">🌐 HTML (หน้า EMR)</span>`);
  if (source.usedMock)         parts.push(`<span class="mj-source-tag">🧪 ข้อมูลทดสอบ (Mock)</span>`);

  parts.push(`<span>ยาทั้งหมด: <strong>${source.totalOrders || 0}</strong> รายการ</span>`);
  parts.push(`<span>สร้างเมื่อ: <strong>${new Date().toLocaleString("th-TH")}</strong></span>`);

  if (source.medicationReviewUrl) {
    parts.push(`<a href="${esc(source.medicationReviewUrl)}" target="_blank" style="color:#1565c0;font-weight:600;font-size:11px">เปิดรายงาน Jasper ↗</a>`);
  }

  return `<div class="mj-source-bar">${parts.join(" · ")}</div>`;
}

/* ── Section wrapper ────────────────────────────────────────────────────── */
function buildSection(id, themeClass, icon, title, count, bodyHtml, defaultOpen) {
  const collapsed = defaultOpen ? "" : " collapsed";
  return `<div class="mj-section ${themeClass}${collapsed}" id="${id}">
  <div class="mj-section-header" data-section="${id}">
    <span>${icon}</span>
    <span>${esc(title)}</span>
    <span class="mj-badge" style="margin-left:4px;background:rgba(0,0,0,.07);color:inherit">${count}</span>
    <span class="mj-section-toggle">▾</span>
  </div>
  <div class="mj-section-body">${bodyHtml}</div>
</div>`;
}

/* ── Event card ─────────────────────────────────────────────────────────── */
function buildEventCard(ev, idx) {
  const meta    = EVENT_META[ev.type] || EVENT_META.start;
  const rawType = ev.type || "start";

  const metaItems = [];
  if (ev.startDateTime) metaItems.push(`📅 ${esc(fmtDate(ev.startDateTime))}`);
  if (ev.endDateTime)   metaItems.push(`→ ${esc(fmtDate(ev.endDateTime))}`);
  if (ev.careprovider || ev.orderBy) metaItems.push(`👨‍⚕️ ${esc(ev.careprovider || ev.orderBy)}`);
  if (ev.orderNumber)   metaItems.push(`#${esc(ev.orderNumber)}`);

  const detailId = `mj-detail-${idx}`;
  const raw      = ev._raw || {};
  const detailLines = [];
  if (raw.code)              detailLines.push(`รหัสยา: ${esc(raw.code)}`);
  if (raw.duration)          detailLines.push(`ระยะเวลา: ${esc(raw.duration)}`);
  if (raw.quantity)          detailLines.push(`จำนวน: ${esc(raw.quantity)}`);
  if (raw.instruction)       detailLines.push(`คำแนะนำ: ${esc(raw.instruction)}`);
  if (raw.infusionRate)      detailLines.push(`อัตราหยด: ${esc(raw.infusionRate)}`);
  if (raw.infusionDuration)  detailLines.push(`เวลาหยด: ${esc(raw.infusionDuration)}`);
  if (raw.comments)          detailLines.push(`หมายเหตุ: ${esc(raw.comments)}`);
  if (raw.orderType)         detailLines.push(`ประเภทคำสั่ง: ${esc(raw.orderType)}`);
  if (raw.priority)          detailLines.push(`ลำดับความสำคัญ: ${esc(raw.priority)}`);
  if (ev.pharmacistNote)     detailLines.push(`บันทึกเภสัช: ${esc(ev.pharmacistNote)}`);
  if (ev.alerts && ev.alerts.length) detailLines.push(`แจ้งเตือน: ${ev.alerts.map(esc).join(", ")}`);

  const detailHtml = detailLines.length > 0
    ? detailLines.map(l => `<div>${l}</div>`).join("")
    : "<div>ไม่มีข้อมูลเพิ่มเติม</div>";

  return `<div class="mj-event">
  <div class="mj-event-icon mj-icon-${rawType}">${meta.icon}</div>
  <div class="mj-event-main">
    <div class="mj-event-friendly mj-friendly-${rawType}">${esc(ev.patientFriendlyText || meta.label)}</div>
    <div class="mj-event-drug">${esc(ev.drugName)}</div>
    <div class="mj-event-dose">${esc(ev.displayDose || "")}</div>
    <div class="mj-event-meta">${metaItems.join(" &nbsp;·&nbsp; ")}</div>
    <span class="mj-detail-toggle" data-target="${detailId}">▸ รายละเอียด</span>
    <div class="mj-detail-panel" id="${detailId}">${detailHtml}</div>
  </div>
</div>`;
}

/* ── Timeline section ───────────────────────────────────────────────────── */
function buildTimelineSection(timeline) {
  if (!timeline || timeline.length === 0) {
    return buildSection("mj-sec-timeline", "mj-section-timeline", "📅", "Timeline การใช้ยา", 0,
      `<div class="mj-empty">ไม่มีข้อมูล Timeline</div>`, true);
  }

  let bodyHtml = "";
  let eventIdx = 0;
  for (const group of timeline) {
    const dateLabel = group.date && group.date !== "unknown"
      ? fmtDate(group.date)
      : "วันที่ไม่ระบุ";
    bodyHtml += `<div class="mj-timeline-date">📅 ${esc(dateLabel)}</div>`;
    for (const ev of (group.events || [])) {
      bodyHtml += buildEventCard(ev, eventIdx++);
    }
  }

  const totalEvents = timeline.reduce((acc, g) => acc + (g.events ? g.events.length : 0), 0);
  return buildSection("mj-sec-timeline", "mj-section-timeline", "📅", "Timeline การใช้ยา",
    totalEvents, bodyHtml, true);
}

/* ── Med list row ────────────────────────────────────────────────────────── */
function buildMedRow(order) {
  const badges = [];
  if (order._isIv)    badges.push(`<span class="mj-badge mj-badge-iv">IV</span>`);
  if (order._isOral)  badges.push(`<span class="mj-badge mj-badge-oral">Oral</span>`);
  if (order.isPrn)    badges.push(`<span class="mj-badge mj-badge-prn">PRN</span>`);
  if (order.isStatOrder) badges.push(`<span class="mj-badge mj-badge-stat">STAT</span>`);

  return `<div class="mj-med-row">
  <div class="mj-med-info">
    <div class="mj-med-name">${esc(order.drugName)} ${badges.join(" ")}</div>
    <div class="mj-med-sig">${esc(order.displayDose || "")}</div>
    <div class="mj-med-dates">${esc(fmtDateRange(order.startDateTime, order.endDateTime))}</div>
  </div>
</div>`;
}

/* ── Active medications section ─────────────────────────────────────────── */
function buildActiveSection(active) {
  const bodyHtml = active.length > 0
    ? active.map(buildMedRow).join("")
    : `<div class="mj-empty">ไม่มียาที่ใช้อยู่</div>`;
  return buildSection("mj-sec-active", "mj-section-active", "✅", "ยาที่ใช้อยู่",
    active.length, bodyHtml, true);
}

/* ── Stopped medications section ────────────────────────────────────────── */
function buildStoppedSection(stopped) {
  const bodyHtml = stopped.length > 0
    ? stopped.map(order => {
        const why = order.isCancelled ? "ยกเลิก" : "หยุดใช้";
        return `<div class="mj-med-row">
  <div class="mj-med-info">
    <div class="mj-med-name">${esc(order.drugName)} <span class="mj-badge mj-badge-stopped">${esc(why)}</span></div>
    <div class="mj-med-sig">${esc(order.displayDose || "")}</div>
    <div class="mj-med-dates">${esc(fmtDateRange(order.startDateTime, order.endDateTime))}</div>
  </div>
</div>`;
      }).join("")
    : `<div class="mj-empty">ไม่มียาที่หยุดใช้</div>`;
  return buildSection("mj-sec-stopped", "mj-section-stopped", "🛑", "ยาที่หยุดใช้แล้ว",
    stopped.length, bodyHtml, false);
}

/* ── PRN medications section ────────────────────────────────────────────── */
function buildPrnSection(prn) {
  const bodyHtml = prn.length > 0
    ? prn.map(buildMedRow).join("")
    : `<div class="mj-empty">ไม่มียา PRN</div>`;
  return buildSection("mj-sec-prn", "mj-section-prn", "🔔", "ยาใช้เมื่อมีอาการ (PRN)",
    prn.length, bodyHtml, false);
}

/* ── Diluent section ────────────────────────────────────────────────────── */
function buildDiluentSection(diluents) {
  if (diluents.length === 0) return "";
  const bodyHtml = diluents.map(buildMedRow).join("");
  return buildSection("mj-sec-diluent", "mj-section-diluent", "⚗️", "สารน้ำเจือจาง",
    diluents.length, bodyHtml, false);
}

/* ── Alerts section ─────────────────────────────────────────────────────── */
function buildAlertsSection(alerts) {
  if (!alerts || alerts.length === 0) return "";
  const bodyHtml = alerts.map(ev => {
    const alertList = (ev.alerts || []).map(a => `<div class="mj-alert-text">${esc(a)}</div>`).join("");
    return `<div class="mj-alert-item">
  <span class="mj-alert-icon">⚠️</span>
  <div>
    <div class="mj-alert-text" style="margin-bottom:2px">${esc(ev.drugName)}</div>
    ${alertList}
    <div style="font-size:10px;color:#9e9e9e;margin-top:3px">
      ${ev.orderNumber ? `#${esc(ev.orderNumber)} · ` : ""}${esc(fmtDate(ev.startDateTime))}
    </div>
  </div>
</div>`;
  }).join("");
  return buildSection("mj-sec-alerts", "mj-section-alerts", "⚠️", "แจ้งเตือน",
    alerts.length, bodyHtml, true);
}

/* ── Export JSON ─────────────────────────────────────────────────────────── */
function exportJourneyJson(journeyData) {
  const blob  = new Blob([JSON.stringify(journeyData, null, 2)], { type: "application/json" });
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  const now   = new Date();
  const pad2  = n => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}${pad2(now.getMonth()+1)}${pad2(now.getDate())}`;
  a.href     = url;
  a.download = `medication-journey-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
}

/* ── Copy summary ────────────────────────────────────────────────────────── */
function copySummaryText(journeyData) {
  const ctx   = journeyData.patientContext || {};
  const lines = [];

  lines.push("=== Medication Journey Summary ===");
  lines.push(`ผู้ป่วย: ${ctx.patientName || "–"}`);
  lines.push(`HN: ${ctx.hn || ctx.patientId || "–"}  AN: ${ctx.an || ctx.patientVisitId || "–"}`);
  lines.push(`แพทย์: ${ctx.doctor || "–"}  แผนก: ${ctx.dept || "–"}`);
  lines.push("");

  const active = journeyData.activeMedications || [];
  if (active.length > 0) {
    lines.push("--- ยาที่ใช้อยู่ ---");
    for (const m of active) {
      lines.push(`• ${m.drugName}  ${m.displayDose || ""}`);
    }
    lines.push("");
  }

  const stopped = journeyData.stoppedMedications || [];
  if (stopped.length > 0) {
    lines.push("--- ยาที่หยุดใช้ ---");
    for (const m of stopped) {
      const why = m.isCancelled ? "(ยกเลิก)" : "(หยุดใช้)";
      lines.push(`• ${m.drugName}  ${why}`);
    }
    lines.push("");
  }

  const prn = journeyData.prnMedications || [];
  if (prn.length > 0) {
    lines.push("--- ยา PRN ---");
    for (const m of prn) {
      lines.push(`• ${m.drugName}  ${m.displayDose || ""}`);
    }
    lines.push("");
  }

  /* Key timeline events */
  const keyTypes = ["start", "switch", "stop", "change", "alert"];
  const keyEvents = (journeyData.allEvents || []).filter(e => keyTypes.includes(e.type));
  if (keyEvents.length > 0) {
    lines.push("--- เหตุการณ์สำคัญ ---");
    for (const ev of keyEvents) {
      const meta = EVENT_META[ev.type] || {};
      lines.push(`[${fmtDate(ev.startDateTime)}] ${meta.label || ev.type}: ${ev.drugName}`);
    }
    lines.push("");
  }

  lines.push(`สร้างเมื่อ: ${new Date().toLocaleString("th-TH")}`);

  const text = lines.join("\n");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(function () {
      _fallbackCopy(text);
    });
  } else {
    _fallbackCopy(text);
  }
}

function _fallbackCopy(text) {
  const ta      = document.createElement("textarea");
  ta.value      = text;
  ta.style.position = "fixed";
  ta.style.top  = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

/* ── Wire up interactivity ──────────────────────────────────────────────── */
function wireInteractivity(journeyData) {
  /* Section collapse toggles */
  document.querySelectorAll(".mj-section-header[data-section]").forEach(function (hdr) {
    hdr.addEventListener("click", function () {
      const sec    = document.getElementById(hdr.dataset.section);
      const toggle = hdr.querySelector(".mj-section-toggle");
      if (!sec) return;
      sec.classList.toggle("collapsed");
      if (toggle) toggle.textContent = sec.classList.contains("collapsed") ? "▸" : "▾";
    });
  });

  /* Detail panel toggles */
  document.querySelectorAll(".mj-detail-toggle").forEach(function (btn) {
    btn.addEventListener("click", function () {
      const panel = document.getElementById(btn.dataset.target);
      if (!panel) return;
      panel.classList.toggle("open");
      btn.textContent = panel.classList.contains("open") ? "▾ ซ่อนรายละเอียด" : "▸ รายละเอียด";
    });
  });

  /* Print */
  const printBtn = document.getElementById("mj-print-btn");
  if (printBtn) printBtn.addEventListener("click", function () { window.print(); });

  /* Export JSON */
  const exportBtn = document.getElementById("mj-export-btn");
  if (exportBtn) exportBtn.addEventListener("click", function () { exportJourneyJson(journeyData); });

  /* Copy summary */
  const copyBtn = document.getElementById("mj-copy-btn");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      copySummaryText(journeyData);
      const orig = copyBtn.textContent;
      copyBtn.textContent = "✓ คัดลอกแล้ว";
      setTimeout(function () { copyBtn.textContent = orig; }, 2000);
    });
  }
}

/* ── renderMedicationJourney ─────────────────────────────────────────────── */
function renderMedicationJourney(journeyData) {
  const root = document.getElementById("mj-root");
  if (!root) return;

  const ctx     = journeyData.patientContext || {};
  const source  = journeyData.source         || {};
  const hn      = ctx.hn || ctx.patientId || "";
  const name    = ctx.patientName || "";
  const titleSub = [name, hn].filter(Boolean).join(" · ");

  const headerHtml = `<div class="mj-header">
  <div>
    <h1>💊 Medication Journey</h1>
    ${titleSub ? `<div style="font-size:13px;margin-top:4px;opacity:.85">${esc(titleSub)}</div>` : ""}
  </div>
  <div class="mj-actions">
    <button id="mj-print-btn"  class="mj-btn mj-btn-print">🖨️ พิมพ์</button>
    <button id="mj-export-btn" class="mj-btn mj-btn-export">⬇️ Export JSON</button>
    <button id="mj-copy-btn"   class="mj-btn mj-btn-copy">📋 คัดลอกสรุป</button>
  </div>
</div>`;

  const patientCard  = buildPatientCard(ctx);
  const sourceBar    = buildSourceBar(source);
  const activeSection  = buildActiveSection(journeyData.activeMedications  || []);
  const timelineSection = buildTimelineSection(journeyData.timeline         || []);
  const stoppedSection  = buildStoppedSection(journeyData.stoppedMedications || []);
  const prnSection      = buildPrnSection(journeyData.prnMedications        || []);
  const diluentSection  = buildDiluentSection(journeyData.diluentMedications || []);
  const alertsSection   = buildAlertsSection(journeyData.alerts             || []);

  const pageHtml = `<div class="mj-page">
${headerHtml}
${patientCard}
${sourceBar}
${alertsSection}
${activeSection}
${timelineSection}
${stoppedSection}
${prnSection}
${diluentSection}
</div>`;

  root.innerHTML = pageHtml;
  wireInteractivity(journeyData);
}

/* ── Data loading ───────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async function () {
  const key    = "payload_medicationJourney";

  /* Try session storage first (set by openOrReuseTab before tab creation) */
  try {
    const result  = await new Promise(function (resolve) {
      chrome.storage.session.get(key, resolve);
    });
    const payload = result && result[key];
    if (payload && payload.journey) {
      renderMedicationJourney(payload.journey);
      return;
    }
  } catch (_) { /* storage not available yet */ }

  /* Also listen for a live message from the background (tab already open case) */
  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.journey) {
      renderMedicationJourney(msg.journey);
    }
  });
});
