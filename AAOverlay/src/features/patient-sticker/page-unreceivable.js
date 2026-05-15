"use strict";

(function () {

  function getUrlData() {
    try {
      // URLSearchParams.get() already URL-decodes the value — do NOT call
      // decodeURIComponent again or a bare % in a drug name (e.g. "NSS 0.9 %")
      // will throw URIError: URI malformed and silently return {}.
      const raw = new URLSearchParams(window.location.search).get("data");
      return raw ? JSON.parse(raw) : {};
    } catch (_) { return {}; }
  }
  const D = getUrlData();

  function today() {
    const d = new Date();
    return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  const $ = id => document.getElementById(id);

  const LOGO = typeof chrome !== "undefined" && chrome.runtime
    ? chrome.runtime.getURL("src/features/patient-sticker/bkh-logo.png")
    : "bkh-logo.png";

  /* ── Shared: summary table ───────────────────────────────────── */
  function summaryTable(v) {
    return `
      <table class="sum-table">
        <thead><tr>
          <th style="text-align:left;">ชื่อยา <strong>(Medicine name)</strong></th>
          <th>แพทย์สั่ง</th>
          <th>จ่ายแล้ว</th>
          <th>ค้างจ่าย</th>
          <th>หน่วย</th>
        </tr></thead>
        <tbody><tr>
          <td class="name">${esc(v.medName)}</td>
          <td class="num">${esc(v.prescribed)}</td>
          <td class="num">${esc(v.dispensed)}</td>
          <td class="num">${esc(v.notDisp)}</td>
          <td>${esc(v.unit)}</td>
        </tr></tbody>
      </table>`;
  }

  /* ── TOP 60%: สำหรับห้องยา — no header/logo, no sig (sig lives at page bottom) ── */
  function buildPharmacy(v) {
    return `
      <div class="f-for">สำหรับห้องยา</div>

      ${summaryTable(v)}

      <div class="f-delivery">
        <span class="lbl">การรับยา (Delivery):</span>
        <span style="font-weight:bold;">${esc(v.delivery)}</span>
      </div>

      <div class="f-pt-hd">ข้อมูลคนไข้ <strong>(Patient data):</strong></div>
      <div class="f-pt-row">
        <span class="lbl">ชื่อ (Name)</span>
        <span class="val">${esc(v.name)}</span>
        <span class="lbl">HN</span>
        <span class="val">${esc(v.hn)}</span>
      </div>
      <div class="f-pt-row">
        <span class="lbl">ที่อยู่ (Address)</span>
        <span class="val light" style="white-space:pre-wrap;grid-column:2/5;">${esc(v.address)}</span>
      </div>
      <div class="f-pt-row">
        <span style="grid-column:3" class="lbl">TEL</span>
        <span class="val light">${esc(v.tel)}</span>
      </div>`;
  }

  /* ── BOTTOM 40%: สำหรับคนไข้ — compact, no sig (sig lives at page bottom) ── */
  function buildPatient(v) {
    return `
      <div class="f-for">สำหรับคนไข้</div>

      <div class="f-head">
        <div class="f-logo">
          <img src="${LOGO}" alt="BKH" onerror="this.style.display='none'"/>
        </div>
        <div class="f-title-block">
          <div class="f-title">รายการยาที่ค้างจ่าย</div>
          <div class="f-sub">(UNRECEIVABLE MEDICINE)</div>
        </div>
      </div>

      <div class="f-desc">
        รายการยาที่ยังไม่สามารถจ่ายให้ตามใบสั่งแพทย์<br>
        <span class="f-desc-en">(the medicine not available for the prescription)</span>
      </div>

      ${summaryTable(v)}

      <div class="f-delivery">
        <span class="lbl">การรับยา (Delivery):</span>
        <span style="font-weight:bold;">${esc(v.delivery)}</span>
      </div>

      <div class="f-pt-hd">ข้อมูลคนไข้ <strong>(Patient data):</strong></div>
      <div class="f-pt-row">
        <span class="lbl">ชื่อ (Name)</span>
        <span class="val">${esc(v.name)}</span>
        <span class="lbl">HN</span>
        <span class="val">${esc(v.hn)}</span>
      </div>
      <div class="f-pt-row">
        <span class="lbl">ที่อยู่ (Address)</span>
        <span class="val light" style="white-space:pre-wrap;grid-column:2/5;">${esc(v.address)}</span>
      </div>
      <div class="f-pt-row">
        <span style="grid-column:3" class="lbl">TEL</span>
        <span class="val light">${esc(v.tel)}</span>
      </div>`;
  }

  /* ── Shared signature rendered at the very bottom of the A5 page ── */
  function buildSig(v) {
    return `
      <table>
        <tr><td>เภสัชกร</td><td class="sv">${esc(v.pharm)}</td></tr>
        <tr><td>วันที่</td>  <td class="sv">${esc(v.date)}</td></tr>
      </table>`;
  }

  /* ── Calc ─────────────────────────────────────────────────────── */
  function calcQty() {
    const sel        = $("inMedName");
    const idx        = sel ? Math.max(0, sel.selectedIndex) : 0;
    const drug       = (D.drugs || [])[idx] || {};
    const prescribed = parseInt(drug.qtyNum || "0") || 0;
    const unit       = ($("inUnit")?.value  || drug.unit || "").trim();
    const dispensed  = parseInt($("inDispensed")?.value || "0") || 0;
    const notDisp    = Math.max(0, prescribed - dispensed);

    const dp = $("dispPrescribed");
    const dn = $("dispNotDispensed");
    if (dp) dp.textContent = prescribed ? `${prescribed} ${unit}` : "—";
    if (dn) dn.textContent = prescribed ? `${notDisp} ${unit}`    : "—";

    return { prescribed, dispensed, notDisp, unit };
  }

  function render() {
    const q   = calcQty();
    const sel = $("inMedName");
    const v   = {
      medName:    sel?.value            || "",
      prescribed: String(q.prescribed),
      dispensed:  String(q.dispensed),
      notDisp:    String(q.notDisp),
      unit:       q.unit,
      delivery:   $("inDelivery")?.value || "",
      name:       $("inName")?.value     || "",
      hn:         $("inHN")?.value       || "",
      address:    $("inAddress")?.value  || "",
      tel:        $("inTel")?.value      || "",
      pharm:      $("inPharm")?.value    || "",
      date:       $("inDate")?.value     || today(),
    };
    const pt  = $("copy-patient");
    const ph  = $("copy-pharmacy");
    const sig = $("pageSig");
    if (pt)  pt.innerHTML  = buildPatient(v);
    if (ph)  ph.innerHTML  = buildPharmacy(v);
    if (sig) sig.innerHTML = buildSig(v);
  }

  /* ── DOM ready ────────────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    const set = (id, val) => { const el = $(id); if (el && val != null) el.value = val; };

    set("inName",  D.fullName   || "");
    set("inHN",    D.hn         || "");
    set("inPharm", D.pharmacist || "");
    set("inDate",  today());
    set("inTel",   D.tel || D.phone || "");

    if (D.address || D.area || D.city || D.state) {
      set("inAddress", [
        D.address?.trim(),
        D.area  ? `ต.${D.area.trim()}`  : "",
        D.city  ? `อ.${D.city.trim()}`  : "",
        D.state ? `จ.${D.state.trim()}` : "",
        D.postcode?.trim(),
      ].filter(Boolean).join(" "));
    }

    const medSel = $("inMedName");
    const drugs  = D.drugs || [];
    if (medSel && drugs.length) {
      drugs.forEach(d => {
        const m = (d.qty || "").match(/^(\d+)\s*(.*)$/);
        d.qtyNum = m ? parseInt(m[1]) : 0;
        d.unit   = m ? m[2].trim()   : "";
        const opt = document.createElement("option");
        opt.value = d.name;
        opt.text  = d.qty ? `${d.name}  (${d.qty})` : d.name;
        medSel.appendChild(opt);
      });
      set("inUnit", (drugs[0] || {}).unit || "");
      medSel.addEventListener("change", () => {
        const d = drugs[medSel.selectedIndex];
        if (d) set("inUnit", d.unit || "");
        render();
      });
    }

    ["inAddress","inTel","inDelivery","inUnit","inDispensed","inDate"]
      .forEach(id => $(id)?.addEventListener("input", render));

    $("btnPrint")?.addEventListener("click", () => window.print());
    render();
  });

})();
