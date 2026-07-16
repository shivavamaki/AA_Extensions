"use strict";

/**
 * page-allergy-card.js
 *
 * Renders 8cm × 3.5cm allergy stickers.
 * Pagination is measurement-based: a hidden probe card is used to determine
 * exactly how many allergy rows fit before the content area overflows, so no
 * text is ever clipped by a hard line-count budget.
 */

const { escapeHtml } = window.CoreDom;
const { MSG }        = window.CoreMessages;

function _normText(text) {
  return String(text || "")
    .replace(/ /g, " ")
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
    if (_sameText(part, type)) return;
    if (_sameText(part, drug)) return;
    if (unique.some(x => _sameText(x, part))) return;
    unique.push(part);
  });
  return unique;
}

function _rowHtml(a) {
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

function _headerHtml(hn, name, suffix) {
  const safeName   = escapeHtml(_normText(name) || "-");
  const safeHn     = escapeHtml(_normText(hn) || "-");
  const safeSuffix = suffix
    ? `<span class="c-page-suffix">${escapeHtml(suffix)}</span>` : "";
  return `<div class="c-header">
    <div class="c-name">${safeName}${safeSuffix}</div>
    <div class="c-hn">HN: ${safeHn}</div>
  </div>`;
}

/**
 * Measure how many allergies from `remaining` fit inside one card (8cm×3.5cm)
 * without overflowing, by rendering an off-screen probe element.
 * Returns at least 1 so pagination always makes progress.
 */
function _measureFit(hn, name, remaining, suffix) {
  const probe = document.createElement("div");
  probe.className = suffix ? "card-cont" : "card";
  probe.style.cssText =
    "position:fixed;visibility:hidden;left:-9999px;top:0;pointer-events:none";
  probe.innerHTML = _headerHtml(hn, name, suffix);

  const allergyEl = document.createElement("div");
  allergyEl.className = "c-allergies";
  probe.appendChild(allergyEl);
  document.body.appendChild(probe);

  let count = 0;
  for (const a of remaining) {
    const tmp = document.createElement("div");
    tmp.innerHTML = _rowHtml(a);
    const rowEl = tmp.firstElementChild;
    allergyEl.appendChild(rowEl);

    if (allergyEl.scrollHeight > allergyEl.clientHeight) {
      allergyEl.removeChild(rowEl);
      break;
    }
    count++;
  }

  document.body.removeChild(probe);
  return Math.max(1, count);
}

/**
 * Split allergies into pages, each fitting within one 8cm×3.5cm card.
 * Returns array of batches (each batch = allergies for one card).
 */
function _buildPages(hn, name, allergies) {
  const pages = [];
  let remaining = allergies.slice();
  let isFirst = true;

  while (remaining.length > 0) {
    const suffix = isFirst ? "" : "(ต่อ)";
    const count  = _measureFit(hn, name, remaining, suffix);
    pages.push(remaining.slice(0, count));
    remaining = remaining.slice(count);
    isFirst = false;
  }

  return pages;
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
  const hn   = data.hn;
  const name = data.fullName;

  if (!allergies.length) {
    preview.innerHTML = `
      <div class="card">
        ${_headerHtml(hn, name, "")}
        <div class="c-allergies">
          <div class="c-allergy-row c-nkda">ไม่มีประวัติแพ้ยา (NKDA)</div>
        </div>
      </div>`;
    return;
  }

  const pages     = _buildPages(hn, name, allergies);
  const total     = pages.length;
  let html = "";

  pages.forEach((batch, idx) => {
    const isFirst = idx === 0;
    const suffix  = total > 1
      ? (isFirst ? `(1/${total})` : `(ต่อ ${idx + 1}/${total})`)
      : "";
    const cls     = isFirst ? "card" : "card-cont";
    const rows    = batch.map(_rowHtml).join("");
    html += `<div class="${cls}">
      ${_headerHtml(hn, name, suffix)}
      <div class="c-allergies">${rows}</div>
    </div>`;
  });

  preview.innerHTML = html;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("btnPrint")?.addEventListener("click", () => window.print());

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type !== MSG.OPEN_ALLERGY_CARD) return;
    renderCard(msg);
  });

  chrome.storage.session.get("payload_allergyCard", (result) => {
    if (result?.payload_allergyCard) renderCard(result.payload_allergyCard);
  });
});
