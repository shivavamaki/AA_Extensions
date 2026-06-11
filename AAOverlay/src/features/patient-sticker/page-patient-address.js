"use strict";

/**
 * features/patient-sticker/page-patient-address.js
 * ─────────────────────────────────────────────────────────────────
 * Page script for page-patient-address.html (address label sticker).
 * Data is passed via the URL query param `?data=<JSON>`.
 * ─────────────────────────────────────────────────────────────────
 */

(function () {

  const { showToast } = window.CoreDom;
  const { copyToClipboard } = window.CoreUtils;

  /* ─────────────────────────────────────────────
   * Parse data from URL
   * ───────────────────────────────────────────── */
  function getUrlData() {
    try {
      const raw = new URLSearchParams(window.location.search).get("data");
      return raw ? JSON.parse(decodeURIComponent(raw)) : {};
    } catch (e) {
      console.error("[page-patient-address] Failed to parse URL data:", e);
      return {};
    }
  }

  const _data = getUrlData();

  /* ─────────────────────────────────────────────
   * Default field builders
   * ───────────────────────────────────────────── */
  function defaultName() {
    return _data.fullName || "-";
  }

  function defaultAddress() {
    return [
      _data.address?.trim(),
      _data.area     ? `ต.${_data.area.trim()}`  : "",
      _data.city     ? `อ.${_data.city.trim()}`  : "",
      _data.state    ? `จ.${_data.state.trim()}` : "",
      _data.postcode?.trim(),
    ]
      .filter(Boolean)
      .join(" ");
  }

  /* ─────────────────────────────────────────────
   * Render sticker into #sticker-container
   * ───────────────────────────────────────────── */
  function render() {
    const container    = document.getElementById("sticker-container");
    const nameInput    = document.getElementById("nameInput");
    const addressInput = document.getElementById("addressInput");
    const phoneInput   = document.getElementById("phoneInput");
    if (!container) return;

    const name    = nameInput?.value    || defaultName();
    const address = addressInput?.value || defaultAddress();
    const phone   = phoneInput?.value   || "";

    container.innerHTML = `
      <div class="line name">ผู้รับ ${name}</div>
      <div class="line address">${address}</div>
      <div class="line phone">หมายเลขโทรศัพท์ ${phone || ".................."}</div>
    `;
  }

  /* ─────────────────────────────────────────────
   * Init
   * ───────────────────────────────────────────── */
  document.addEventListener("DOMContentLoaded", () => {
    const nameInput    = document.getElementById("nameInput");
    const addressInput = document.getElementById("addressInput");
    const phoneInput   = document.getElementById("phoneInput");
    const printBtn     = document.getElementById("printBtn");
    const copyBtn      = document.getElementById("copyBtn");

    // Pre-fill inputs with URL data
    if (nameInput)    nameInput.value    = defaultName();
    if (addressInput) addressInput.value = defaultAddress();

    // Re-render on input edits
    [nameInput, addressInput, phoneInput].forEach(
      (el) => el?.addEventListener("input", render)
    );

    printBtn?.addEventListener("click", () => window.print());

    copyBtn?.addEventListener("click", async () => {
      const container = document.getElementById("sticker-container");
      const text      = container?.innerText || "";
      const ok        = await copyToClipboard(text);
      showToast(ok ? "📋 Copied!" : "❌ Copy failed");
    });

    render();
  });

})();
