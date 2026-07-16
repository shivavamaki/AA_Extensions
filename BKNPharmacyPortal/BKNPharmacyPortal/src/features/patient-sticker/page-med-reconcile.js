"use strict";

/**
 * page-med-reconcile.js
 *
 * Sticker set = 1 cover sticker + N drug stickers
 *
 * ┌─ STICKER 1: Cover (no drug name) ───────────────────────────┐
 * │ HN : 48-19-010754                            Room : 822     │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                             │
 * │                 Patient Own Medication                      │
 * │                                                             │
 * ├─────────────────────────────────────────────────────────────┤
 * │ ชื่อ : นาย อานัตพล เบี้ยไธสงค    Date: 08/04/2026          │
 * │                                   ศิวาวุธ มงคล, ภก.        │
 * │             * 4 8 - 1 9 - 0 1 0 7 5 4 *   (barcode=HN)    │
 * └─────────────────────────────────────────────────────────────┘
 *
 * ┌─ STICKER 2–N: Drug (one per medication) ────────────────────┐
 * │ HN : 48-19-010754                            Room : 822     │
 * ├─────────────────────────────────────────────────────────────┤
 * │                                                             │
 * │              omePRAzole (20 mg) capsule #                   │
 * │                                                             │
 * ├─────────────────────────────────────────────────────────────┤
 * │ ชื่อ : นาย อานัตพล...    Patient Own Medication             │
 * │                           Date: 08/04/2026                  │
 * │                           ศิวาวุธ มงคล, ภก.                │
 * └─────────────────────────────────────────────────────────────┘
 */

const { escapeHtml } = window.CoreDom;
const { MSG }        = window.CoreMessages;

let _patient = null;
let _drugs   = [];

/* ── Date helper ─────────────────────────────────────────────── */
function _today() {
  const d  = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  return `${dd}/${mm}/${yy}`;
}

/* ── Build COVER sticker HTML ────────────────────────────────── */
function _buildCover(p) {
  const hn    = escapeHtml(p.hn         || "-");
  const room  = escapeHtml(p.room       || "-");
  const name  = escapeHtml(p.fullName   || "-");
  const pharm = escapeHtml(p.pharmacist || "");
  const date  = escapeHtml(p.date       || _today());
  const order = escapeHtml(p.orderNo    || p.hn || "");

  return `
    <div class="sticker-wrap" data-type="cover">
      <div class="sticker-cover">

        <div class="s-toprow">
          <span>HN : ${hn}</span>
          <span>Room : ${room}</span>
        </div>

        <div class="s-body-center">Patient Own Medication</div>

        <div class="s-footer">
          <div class="s-name">ชื่อ : ${name}</div>
          <div class="s-footer-right">
            <div>Date: ${date}</div>
            <div>${pharm}</div>
          </div>
        </div>

        <div class="s-barcode">
          <svg id="bc-cover"></svg>
        </div>

      </div>
    </div>`;
}

/* ── Build DRUG sticker HTML ─────────────────────────────────── */
function _buildDrug(p, drugName, idx) {
  const hn    = escapeHtml(p.hn         || "-");
  const room  = escapeHtml(p.room       || "-");
  const name  = escapeHtml(p.fullName   || "-");
  const pharm = escapeHtml(p.pharmacist || "");
  const date  = escapeHtml(p.date       || _today());
  const drug  = escapeHtml(drugName);

  return `
    <div class="sticker-wrap" data-type="drug" data-idx="${idx}">
      <button class="del-btn" title="Remove">✕</button>
      <div class="sticker-drug">

        <div class="s-toprow">
          <span>HN : ${hn}</span>
          <span>Room : ${room}</span>
        </div>

        <div class="s-body-center">${drug}</div>

        <div class="s-footer">
          <div class="s-name">ชื่อ : ${name}</div>
          <div class="s-footer-right">
            <div style="font-size:10px;font-weight:bold;letter-spacing:0.02em;">Patient Own Medication</div>
            <div>Date: ${date}</div>
            <div>${pharm}</div>
          </div>
        </div>

      </div>
    </div>`;
}

/* ── Render all stickers ─────────────────────────────────────── */
function renderAll() {
  const preview  = document.getElementById("preview");
  const emptyMsg = document.getElementById("empty-msg");
  const countEl  = document.getElementById("drug-count");
  if (!preview) return;

  if (!_patient) {
    preview.innerHTML = "";
    if (emptyMsg) { preview.appendChild(emptyMsg); emptyMsg.style.display = "block"; }
    if (countEl) countEl.textContent = "";
    return;
  }

  // 1 cover + N drug stickers
  const coverHtml = _buildCover(_patient);
  const drugHtml  = _drugs.map((d, i) => _buildDrug(_patient, d.name, i)).join("");

  preview.innerHTML = coverHtml + drugHtml;

  if (countEl) {
    const total = 1 + _drugs.length;
    countEl.textContent = `${total} sticker${total === 1 ? "" : "s"} (1 cover + ${_drugs.length} drugs)`;
  }

  // Barcode on cover = order number or HN
  const barcodeVal = (_patient.orderNo || _patient.hn || "").replace(/\s/g, "");
  if (barcodeVal && typeof JsBarcode !== "undefined") {
    try {
      JsBarcode("#bc-cover", barcodeVal, {
        format: "CODE128", width: 1.6, height: 22,
        displayValue: false, margin: 0,
      });
    } catch (e) {
      console.warn("[med-reconcile] barcode error:", e.message);
    }
  }

  // Wire delete buttons on drug stickers
  preview.querySelectorAll(".del-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const wrap = btn.closest("[data-idx]");
      const idx  = parseInt(wrap?.dataset.idx ?? "-1");
      if (idx >= 0 && idx < _drugs.length) {
        _drugs.splice(idx, 1);
        renderAll();
      }
    });
  });
}

/* ── Add drug manually ───────────────────────────────────────── */
function addDrug() {
  if (!_patient) {
    alert("No patient loaded yet.");
    return;
  }
  const name = prompt("Enter drug name to add:");
  if (!name?.trim()) return;
  _drugs.push({ name: name.trim() });
  renderAll();
}

/* ── Load data from message ──────────────────────────────────── */
function loadData(msg) {
  _patient = {
    hn:         msg.hn         || msg.patientData?.hn        || "-",
    room:       msg.room       || msg.patientData?.room      || "-",
    fullName:   msg.fullName   || msg.patientData?.fullName  || "-",
    pharmacist: msg.pharmacist || msg.patientData?.pharmacist|| "",
    date:       msg.date       || _today(),
    orderNo:    msg.orderNo    || msg.patientData?.orderId   || "",
  };

  _drugs = (msg.drugs || []).map(d =>
    typeof d === "string" ? { name: d } : { name: d.name || d.drugName || String(d) }
  );

  renderAll();
}

/* ── DOM ready ───────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnPrint")?.addEventListener("click", () => window.print());
  document.getElementById("btnAdd")?.addEventListener("click", addDrug);

  // Live updates when tab is already open and background sends a new message
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== "OPEN_MED_RECONCILE") return;
    loadData(msg);
  });

  // First open: background stored the payload in session storage before creating the tab
  chrome.storage.session.get("payload_medReconcile", (result) => {
    if (result?.payload_medReconcile) loadData(result.payload_medReconcile);
  });
});
