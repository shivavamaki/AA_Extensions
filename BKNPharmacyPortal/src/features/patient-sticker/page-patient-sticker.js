"use strict";

/**
 * features/patient-sticker/page-patient-sticker.js
 */

const { escapeHtml, showToast } = window.CoreDom;
const { copyToClipboard }       = window.CoreUtils;
const { MSG }                   = window.CoreMessages;

const SIZE_MAP = Object.freeze({
  "10x5":  { width: "10cm", height: "5cm",   paddingTop: "0.25cm" },
  "8x3.5": { width: "8cm",  height: "3.5cm", paddingTop: "0.5cm"  },
});

let _currentData = null;

function renderSticker(data, sizeKey) {
  if (!data) return;
  const size = SIZE_MAP[sizeKey];
  if (!size) return;

  const container = document.getElementById("sticker-container");
  if (!container) return;

  const safeHn   = escapeHtml(data.hn      || "-");
  const safeRoom = escapeHtml(data.room     || "");
  const safeName = escapeHtml(data.fullName || "-");
  const safeOid  = escapeHtml(data.orderId  || "");

  container.innerHTML = `
    <div style="
      width:${size.width};height:${size.height};
      padding-top:${size.paddingTop};box-sizing:border-box;
      display:flex;flex-direction:column;justify-content:flex-start;
      font-family:'Sarabun',sans-serif;
    ">
      <div style="text-align:right;font-size:65px;font-weight:bold;padding-right:10px;line-height:1;">
        ${safeRoom}
      </div>
      <div style="text-align:right;font-size:18px;padding-right:10px;">
        HN ${safeHn}
      </div>
      <div style="
        text-align:left;font-size:22px;padding:6px 10px 0;
        word-wrap:break-word;overflow-wrap:break-word;
        white-space:normal;line-height:1.1;font-weight:normal;
      ">
        ${safeName}
      </div>
      <div style="display:flex;justify-content:center;margin-top:6px;">
        <svg id="barcode"></svg>
      </div>
      <div style="display:flex;justify-content:center;font-size:16px;margin-top:4px;">
        ${safeOid}
      </div>
    </div>
  `;

  if (data.orderId && data.orderId !== "-" && typeof JsBarcode !== "undefined") {
    try {
      JsBarcode("#barcode", data.orderId, {
        format: "CODE128", width: 2, height: 20, displayValue: false, margin: 0,
      });
    } catch (e) {
      console.warn("[page-patient-sticker] JsBarcode failed:", e);
    }
  }
}

function buildCopyText(data) {
  if (!data) return "";
  return [
    data.room || "",
    `HN ${data.hn || "-"}`,
    data.fullName || "",
    data.orderId && data.orderId !== "-" ? data.orderId : "",
  ].filter(Boolean).join("\n");
}

document.addEventListener("DOMContentLoaded", () => {
  const selector = document.getElementById("sizeSelector");
  const printBtn = document.getElementById("printBtn");
  const copyBtn  = document.getElementById("copyBtn");

  selector?.addEventListener("change", () => {
    if (_currentData) renderSticker(_currentData, selector.value);
  });

  printBtn?.addEventListener("click", () => window.print());

  copyBtn?.addEventListener("click", async () => {
    const ok = await copyToClipboard(buildCopyText(_currentData));
    showToast(ok ? "📋 Copied!" : "❌ Copy failed");
  });

  // Live message from background (tab already open, subsequent clicks)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== MSG.OPEN_PATIENT_STICKER) return;
    _currentData = msg.patientData;
    renderSticker(_currentData, selector?.value ?? "10x5");
  });

  // Session storage fallback — covers the race where the page loads AFTER
  // background already wrote the payload (first open / page refresh)
  chrome.storage.session.get("payload_patientSticker", (res) => {
    const stored = res?.payload_patientSticker;
    if (stored?.type === MSG.OPEN_PATIENT_STICKER && stored.patientData) {
      _currentData = stored.patientData;
      renderSticker(_currentData, selector?.value ?? "10x5");
    }
  });
});
