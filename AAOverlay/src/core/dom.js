"use strict";

/**
 * core/dom.js
 * ─────────────────────────────────────────────────────────────────
 * Shared DOM utilities.
 *
 * Consolidates the duplicated helpers that previously lived in:
 *   content.js, content-patient.js, content_discharge_list.js,
 *   sheet.js, patient-sticker.js, sticker.js
 *
 * Available globally as window.CoreDom (no bundler required).
 * ─────────────────────────────────────────────────────────────────
 */

(function () {
const _g = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {};
if (_g.CoreDom) return;
const CoreDom = (() => {

  /* ─────────────────────────────────────────────
   * Text normalisation
   * ───────────────────────────────────────────── */

  /** Collapse whitespace + replace non-breaking spaces */
  function norm(s) {
    return (s || "")
      .replace(/\u00A0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Split text into non-empty normalised lines */
  function cleanLines(text) {
    return (text || "").split("\n").map(norm).filter(Boolean);
  }

  /**
   * Normalise a table-header string for use as a dictionary key:
   *  - lowercase
   *  - collapse whitespace
   *  - strip sort-arrow characters (▼▲)
   */
  function normHeader(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[▼▲]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ─────────────────────────────────────────────
   * HTML escaping
   * ───────────────────────────────────────────── */

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ─────────────────────────────────────────────
   * Button factory
   * Creates a transparent icon-button consistent with the HIS UI style.
   *
   * @param {{ icon:string, title:string, className:string, onClick:Function }} opts
   * ───────────────────────────────────────────── */
  function createIconButton({ icon, title = "", className = "", onClick }) {
    const btn = document.createElement("button");
    btn.className  = `hm-btn ${className}`.trim();
    btn.innerHTML  = icon;
    btn.title      = title;
    btn.dataset.hm = "1";
    btn.onclick    = onClick;

    // Fallback inline styles in case the HIS Angular app purges injected CSS
    Object.assign(btn.style, {
      background:  "transparent",
      border:      "none",
      outline:     "none",
      cursor:      "pointer",
      padding:     "0",
      marginLeft:  "6px",
      fontSize:    "18px",
      opacity:     "0.85",
      transition:  "transform .15s ease, opacity .15s ease",
    });

    btn.addEventListener("mouseenter", () => {
      btn.style.transform = "scale(1.2)";
      btn.style.opacity   = "1";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "scale(1)";
      btn.style.opacity   = "0.85";
    });

    return btn;
  }

  /* ─────────────────────────────────────────────
   * Toast notification
   * ───────────────────────────────────────────── */

  /**
   * Show a short-lived toast message.
   * Looks for an element with id="toast"; does nothing if absent.
   *
   * @param {string} message
   * @param {number} [durationMs=2000]
   */
  function showToast(message = "Done", durationMs = 2000) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), durationMs);
  }

  /* ─────────────────────────────────────────────
   * Safe element text setter
   * Writes value to element.textContent; warns if element is missing.
   * ───────────────────────────────────────────── */
  function safeSetText(id, value) {
    const el = document.getElementById(id);
    if (!el) {
      console.warn(`[CoreDom] Element #${id} not found`);
      return;
    }
    el.textContent = value ?? "-";
  }

  /* ─────────────────────────────────────────────
   * Inject a <style> block once (idempotent)
   *
   * @param {string} id   – unique id attribute to guard against re-injection
   * @param {string} css  – stylesheet text
   * ───────────────────────────────────────────── */
  function injectStyle(id, css) {
    if (document.getElementById(id)) return;
    const style = document.createElement("style");
    style.id          = id;
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ─────────────────────────────────────────────
   * Read a table cell by trying a list of possible
   * header names (case-insensitive index lookup).
   *
   * @param {Element[]} cells   – array of <td> elements for one row
   * @param {Record<string,number>} idx – header→column-index map (lowercased)
   * @param {string[]} candidates       – ordered list of header names to try
   * @returns {string}
   * ───────────────────────────────────────────── */
  function readCell(cells, idx, candidates) {
    for (const h of candidates) {
      const colIdx = idx[h.toLowerCase()];
      if (colIdx !== undefined && cells[colIdx]) {
        return norm(cells[colIdx].textContent || "");
      }
    }
    return "";
  }

  /* ─────────────────────────────────────────────
   * Build a lowercase header→index map from a <table>.
   * Strips sort-arrow glyphs (▼▲) from header text.
   *
   * @param {Element} table
   * @returns {Record<string,number>}
   * ───────────────────────────────────────────── */
  function buildHeaderIndex(table) {
    const idx = {};
    Array.from(table.querySelectorAll("thead th")).forEach((th, i) => {
      idx[normHeader(th.textContent)] = i;
    });
    return idx;
  }

  /* public API */
  return {
    norm,
    cleanLines,
    normHeader,
    escapeHtml,
    createIconButton,
    showToast,
    safeSetText,
    injectStyle,
    readCell,
    buildHeaderIndex,
  };

})();

_g.CoreDom = CoreDom;
})();
