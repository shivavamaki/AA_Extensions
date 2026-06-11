"use strict";

/**
 * core/utils.js
 * ─────────────────────────────────────────────────────────────────
 * General-purpose utilities that are not DOM-specific.
 *
 * Available globally as window.CoreUtils.
 * ─────────────────────────────────────────────────────────────────
 */

(function () {
const _g = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : {};
if (_g.CoreUtils) return;
const CoreUtils = (() => {

  /* ─────────────────────────────────────────────
   * Debounce
   * ───────────────────────────────────────────── */

  /**
   * Returns a debounced version of fn that fires after `ms` milliseconds
   * of silence.
   *
   * @template T
   * @param {(...args: T[]) => void} fn
   * @param {number} ms
   * @returns {(...args: T[]) => void}
   */
  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  /* ─────────────────────────────────────────────
   * Thai digit → ASCII digit conversion
   * ───────────────────────────────────────────── */

  const THAI_DIGITS = {
    "๐": "0", "๑": "1", "๒": "2", "๓": "3", "๔": "4",
    "๕": "5", "๖": "6", "๗": "7", "๘": "8", "๙": "9",
  };

  /** Replace Thai digits (๐–๙) with ASCII equivalents */
  function toAsciiDigits(s) {
    return (s || "").replace(/[๐-๙]/g, (d) => THAI_DIGITS[d] || d);
  }

  /** Strip all non-digit characters after Thai→ASCII conversion */
  function digitsOnly(s) {
    return toAsciiDigits(String(s || "")).replace(/\D/g, "");
  }

  /**
   * Format a raw HN string to "DD-DD-DDDDDD".
   * Handles Thai digits and various separator styles.
   *
   * @param {string} s
   * @returns {string} formatted HN or empty string if pattern not found
   */
  function formatHN(s) {
    const m = toAsciiDigits(s).match(/(\d{2})\D*(\d{2})\D*(\d{6})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
  }

  /* ─────────────────────────────────────────────
   * Clipboard copy with toast support
   * ───────────────────────────────────────────── */

  /**
   * Copy text to clipboard.  Resolves with true on success.
   *
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (err) {
      console.error("[CoreUtils] clipboard copy failed:", err);
      return false;
    }
  }

  return {
    debounce,
    toAsciiDigits,
    digitsOnly,
    formatHN,
    copyToClipboard,
  };

})();

_g.CoreUtils = CoreUtils;
})();
