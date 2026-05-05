"use strict";

/**
 * page-allergy-card.js
 *
 * Renders 8cm × 3.5cm allergy stickers.
 * Fixes:
 * - Reads and displays sideEffect data from Arcus allergy table.
 * - Prevents duplicated text such as "Side Effect" appearing as a detail line.
 * - Uses larger medicine name text and safer page splitting.
 */

const { escapeHtml } = window.CoreDom;
const { MSG }        = window.CoreMessages;

const FIRST_BUDGET = 2;
const CONT_BUDGET  = 3;

function _normText(text) {
  return String(text || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function _splitDetailText(text) {
  return _normText(text)
    .split(/\s*(?:\n|,|;|\||—)\s*/)
    .map(_normText)
    .filter(Boolean);
}

function _sameText(a, b) {
  return _normText(a).toLowerCase() === _normText(b).toLowerCase();
}

function _buildDetailParts(a) {
  const type = _normText(a.type);
  const drug = _normText(a.drug);
  const candidates = [
    ..._splitDetailText(a.symptom),
    ..._splitDetailText(a.sideEffect),
    ..._splitDetailText(a.comment),
  ];

  const unique = [];
  candidates.forEach(part => {
    if (!part) return;
    // Do not show event type again as detail, e.g. "Side Effect" under "(Side Effect)".
    if (_sameText(part, type)) return;
    if (_sameText(part, drug)) return;
    if (unique.some(x => _sameText(x, part))) return;
    unique.push(part);
  });
  return unique;
}

function _row(a) {
  const drug = escapeHtml(_normText(a.drug));
  const type = escapeHtml(_normText(a.type));
  const detailParts = _buildDetailParts(a);
  const detail = detailParts.length ? escapeHtml(detailParts.join(", ")) : "";

  return `<div class="c-allergy-row">
    <div class="c-drug-line">
      <span class="c-warn">⚠</span>
      <span class="c-drug">${drug}</span>
      ${type ? `<span class="c-type">(${type})</span>` : ""}
    </div>
    ${detail ? `<div class="c-detail">${detail}</div>` : ""}
  </div>`;
}

function _patientHeader(hn, name, suffix = "") {
  const safeName = escapeHtml(_normText(name) || "-");
  const safeHn   = escapeHtml(_normText(hn) || "-");
  const safeSuffix = suffix ? `<span class="c-page-suffix">${escapeHtml(suffix)}</span>` : "";

  return `
    <div class="c-header">
      <div class="c-name">${safeName}${safeSuffix}</div>
      <div class="c-hn">HN: ${safeHn}</div>
    </div>`;
}

function _buildFirstCard(hn, name, rows) {
  const rowsHtml = rows.length
    ? rows.map(_row).join("")
    : `<div class="c-allergy-row c-nkda">ไม่มีประวัติแพ้ยา (NKDA)</div>`;
  return `
    <div class="card">
      ${_patientHeader(hn, name)}
      <div class="c-allergies">${rowsHtml}</div>
    </div>`;
}

function _buildContCard(hn, name, rows, pageNum, total) {
  return `
    <div class="card-cont">
      ${_patientHeader(hn, name, `(ต่อ ${pageNum}/${total})`)}
      <div class="c-allergies">${rows.map(_row).join("")}</div>
    </div>`;
}

function renderCard(data) {
  const preview  = document.getElementById("preview");
  const emptyMsg = document.getElementById("empty-msg");
  if (!preview) return;

  if (!data || !data.hn) {
    preview.innerHTML = "";
    if (emptyMsg) { preview.appendChild(emptyMsg); emptyMsg.style.display = "block"; }
    return;
  }

  const allergies = Array.isArray(data.allergies) ? data.allergies : [];

  if (!allergies.length) {
    preview.innerHTML = _buildFirstCard(data.hn, data.fullName, []);
    return;
  }

  const firstBatch = allergies.slice(0, FIRST_BUDGET);
  const rest       = allergies.slice(FIRST_BUDGET);

  const contPages = [];
  for (let i = 0; i < rest.length; i += CONT_BUDGET) {
    contPages.push(rest.slice(i, i + CONT_BUDGET));
  }

  const totalPages = 1 + contPages.length;
  let html = _buildFirstCard(data.hn, data.fullName, firstBatch);

  contPages.forEach((batch, idx) => {
    html += _buildContCard(data.hn, data.fullName, batch, idx + 2, totalPages);
  });

  preview.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnPrint")?.addEventListener("click", () => window.print());

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== MSG.OPEN_ALLERGY_CARD) return;
    renderCard(msg);
  });
});
