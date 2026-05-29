"use strict";

/**
 * features/med-sticker/page-med-sticker.js
 * ─────────────────────────────────────────────────────────────────
 * Page script for page-med-sticker.html (Medication Label Sticker).
 *
 * Fixes carried forward:
 *  - Row field lookup uses normalised (lowercase) keys produced by
 *    parser-order-table.js — no more triple-casing guesses.
 *  - getField() helper tries aliases in priority order.
 *  - Revert always starts from clean originalHTML.
 *  - Language switch restores before re-translating.
 * ─────────────────────────────────────────────────────────────────
 */

const { escapeHtml } = window.CoreDom;
const { MSG }        = window.CoreMessages;

/* ─────────────────────────────────────────────
 * State
 * ───────────────────────────────────────────── */
let _originalHTML = "";

/* ─────────────────────────────────────────────
 * Field accessor — keys are already lowercase
 * because parser-order-table.js normalises them.
 *
 * @param {Record<string,string>} row
 * @param {...string} aliases  – normalised (lowercase) key names to try
 * @returns {string}
 * ───────────────────────────────────────────── */
function getField(row, ...aliases) {
  for (const key of aliases) {
    if (row[key]) return row[key];
  }
  return "";
}

/* ─────────────────────────────────────────────
 * Build all sticker pages from row array
 * ───────────────────────────────────────────── */
function buildStickerPages(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";

  return rows
    .map((row) => {
      const drug      = getField(row, "order item");
      const details   = getField(row, "medicine details", "dosage");
      const adminInst = getField(row, "administration instruction");
      const quantity  = getField(row, "quantity");

      return `
        <div class="page">
          <div class="top-space"></div>
          <div class="sticker">
            <div class="drug" data-no-translate translate="no">${escapeHtml(drug)}</div>
            ${details   ? `<div class="row">${escapeHtml(details)}</div>`   : ""}
            ${adminInst ? `<div class="row">${escapeHtml(adminInst)}</div>` : ""}
            ${quantity  ? `<div class="row">${escapeHtml(quantity)}</div>`  : ""}
          </div>
        </div>
      `;
    })
    .join("");
}

/* ─────────────────────────────────────────────
 * Message listener — receives rows from background
 * ───────────────────────────────────────────── */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== MSG.OPEN_STICKER) return;

  const container = document.getElementById("container");
  if (!container) {
    console.warn("[page-med-sticker] #container not found");
    return;
  }

  container.innerHTML = buildStickerPages(msg.rows || []);
  _originalHTML       = container.innerHTML;

  // Re-initialise translation engine with the freshly rendered DOM
  if (typeof HMTranslate !== "undefined") {
    HMTranslate.init(container, { glossary: window.MEDICAL_GLOSSARY || {} });
  }
});

/* ─────────────────────────────────────────────
 * Toolbar — wired up after DOM is ready
 * ───────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  const btnPrint  = document.getElementById("btnPrint");
  const btnPdf    = document.getElementById("btnPdf");
  const btnRevert = document.getElementById("btnRevert");
  const langSel   = document.getElementById("lang");

  if (btnPrint) btnPrint.addEventListener("click", () => window.print());
  if (btnPdf)   btnPdf.addEventListener("click",   () => window.print());

  /* ---- Revert ---- */
  if (btnRevert) {
    btnRevert.addEventListener("click", () => {
      if (!_originalHTML) return; // nothing loaded yet

      const container = document.getElementById("container");
      if (!container) return;

      container.innerHTML = _originalHTML;
      if (typeof HMTranslate !== "undefined") HMTranslate.restore();
      if (langSel) langSel.value = "";
    });
  }

  /* ---- Language switch ---- */
  if (langSel) {
    langSel.addEventListener("change", async (e) => {
      const lang = e.target.value;
      if (!lang || !_originalHTML) return;

      const container = document.getElementById("container");
      if (!container) return;

      // Always restore to original English first, then translate
      container.innerHTML = _originalHTML;
      if (typeof HMTranslate !== "undefined") {
        HMTranslate.restore();
        await HMTranslate.translate(container, lang);
      }
    });
  }
});
