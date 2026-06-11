"use strict";

/**
 * features/patient-sticker/parser-patient.js
 *
 * FIX: Angular's scope destroy wipes window.ParserPatient via its
 * "Remove X stutus" cleanup. The old IIFE guard `if (_g.ParserPatient) return`
 * meant it never re-registered after that wipe.
 *
 * Solution: build all parse functions ONCE inside this IIFE closure
 * (immune to Angular global wipes), and re-assign window.ParserPatient
 * on every public call so the global is always fresh when needed.
 */

(function () {
  const _g = typeof globalThis !== "undefined" ? globalThis
           : typeof window     !== "undefined" ? window : {};

  /* ── Inline norm — don't rely on window.CoreDom which may also be wiped ── */
  function _norm(s) {
    return (s || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  }

  const BANNER_ROOT_SEL = "patient-emr-banner";

  const ORDER_SEL =
    "body > div.full-height.ng-scope.layout-row > div > md-content > md-content" +
    " > div > md-card > md-content.md-whiteframe-z2.padding-left-14-imp.margin-5" +
    ".stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme" +
    ".width-70-per > div.ng-isolate-scope.flex-initial" +
    " > h4.margin-top-12.margin-bottom-10.font-weight-500-imp.ng-binding.ng-scope";

  function _getBannerRoot() {
    const banner = document.querySelector(BANNER_ROOT_SEL);
    if (!banner) return null;
    return banner.querySelector(".main-banner") || banner;
  }

  function _extractFullName(root) {
    // aria-hidden="false" (or absent) = visible; "true" = hidden alternate language
    for (const el of root.querySelectorAll(".padding-left-8-imp.flex div.overme.ng-binding")) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      const t = _norm(el.textContent);
      if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/")) return t;
    }
    // Broader fallback
    for (const el of root.querySelectorAll("div.overme.ng-binding")) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      const t = _norm(el.textContent);
      if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/") && !t.includes(":")) return t;
    }
    return "-";
  }

  function _extractHN(root) {
    for (const el of root.querySelectorAll(
      ".padding-left-8-imp.flex span.overme.ng-binding, " +
      ".padding-left-8-imp.flex .layout-align-start-center span.overme.ng-binding"
    )) {
      const t = _norm(el.textContent);
      if (/^\d{2}-\d{2}-\d{6}$/.test(t)) return t;
    }
    // Broad fallback — scan all spans in banner
    for (const el of root.querySelectorAll("span.overme.ng-binding")) {
      const t = _norm(el.textContent);
      if (/^\d{2}-\d{2}-\d{6}$/.test(t)) return t;
    }
    return "-";
  }

  function _extractOrderId(root) {
    const h4 = document.querySelector(ORDER_SEL);
    if (h4) {
      const m = _norm(h4.innerText || h4.textContent).match(/\((.*?)\)/);
      if (m) return m[1];
    }
    const section = root.querySelector(".main-banner-section");
    if (section) {
      for (const el of section.querySelectorAll("div.overme.ng-binding")) {
        const t = _norm(el.textContent);
        const m = t.match(/^([OI]\d{2}-\d{2}-\d{6})\s*\//i);
        if (m) return m[1];
      }
    }
    const m2 = _norm(root.innerText || root.textContent).match(/\b([OI]\d{2}-\d{2}-\d{6})\b/i);
    return m2 ? m2[1] : "-";
  }

  function _extractRoom(root) {
    // Split on FIRST "/" only — room codes like "424/01" must be preserved
    for (const span of root.querySelectorAll('span[ng-repeat*="bedoccupancy"]')) {
      const t = _norm(span.textContent);
      if (!t) continue;
      const slashIdx = t.indexOf("/");
      if (slashIdx !== -1) {
        const room = _norm(t.slice(slashIdx + 1));
        if (room) return room;
      } else {
        return t;
      }
    }
    return "-";
  }

  /* ─────────────────────────────────────────────
   * PUBLIC
   * Re-assign window.ParserPatient on every call —
   * Angular's scope destroy wipes the global, but
   * this IIFE closure keeps _api alive permanently.
   * ───────────────────────────────────────────── */
  function parseFromEmrBanner() {
    _g.ParserPatient = _api;   // heal the global if Angular wiped it
    const root = _getBannerRoot();
    if (!root) return null;
    return {
      fullName: _extractFullName(root),
      hn:       _extractHN(root),
      orderId:  _extractOrderId(root),
      room:     _extractRoom(root),
    };
  }

  function parseDialogAddress() {
    _g.ParserPatient = _api;   // heal the global if Angular wiped it
    const container = document.querySelector('[id^="dialogContent"] > div');
    if (!container) return null;
    const data = {};
    container.querySelectorAll(".flex-50").forEach((el) => {
      const label = el.querySelector("span, label");
      const value = el.querySelector(".ng-binding");
      if (!label || !value) return;
      const key = label.innerText.trim().toLowerCase().replace(/\s+/g, "_");
      data[key] = value.innerText.trim();
    });
    return Object.keys(data).length ? data : null;
  }

  /* _api lives in closure — survives Angular global wipes */
  const _api = { parseFromEmrBanner, parseDialogAddress };
  _g.ParserPatient = _api;

})();
