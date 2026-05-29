"use strict";

/**
 * features/home-med/parser-home-med.js
 * Robust patient parser for the Home Medication Sheet.
 *
 * Strategy: try targeted DOM-element queries first (same approach used by
 * parser-patient.js which works for patient stickers), then fall back to
 * regex-on-innerText for any fields that were not found.
 */
(function () {
  const _g = typeof globalThis !== "undefined" ? globalThis
           : typeof window !== "undefined" ? window : {};
  if (_g.ParserHomeMed) return;

  const ParserHomeMed = (() => {
    const { norm } = window.CoreDom;

    function cleanLines(text) {
      return String(text || "")
        .split("\n")
        .map((s) => norm(s))
        .filter(Boolean);
    }

    function flatten(text) {
      return norm(String(text || "").replace(/\n/g, " "));
    }

    function normalizeHN(value) {
      const m = flatten(value).match(/(\d{2})\s*-\s*(\d{2})\s*-\s*(\d{6})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
    }

    function findVisitDateTime(lines, flat) {
      const visitLine = lines.find((line) =>
        /[IO]\d{2}[-\s]?\d{2}[-\s]?\d{4,6}/i.test(line) &&
        /\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}/.test(line)
      );
      if (visitLine) {
        const parts = visitLine.split("/").map(norm);
        return { an: parts[0] || null, visitDateTime: parts[1] || null };
      }

      const m = flat.match(/\b([IO]\d{2}[-\s]?\d{2}[-\s]?\d{4,6})\b\s*\/\s*(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2})/i);
      return { an: m ? m[1] : null, visitDateTime: m ? m[2] : null };
    }

    function findAge(lines) {
      const ageLine = lines.find((line) => /\b\d+\s*Y\b/i.test(line));
      return ageLine || null;
    }

    function findRoomFromSelector() {
      const selectors = [
        "body > div.full-height.ng-scope.layout-row > div > md-content > div > div > div > div.layout-row.flex-100 > patient-banner > div > div.ng-scope.layout-xs-column.layout-row.flex > div.patient-banner-visit-details.layout-align-space-between-start.layout-column.flex-xs-100.flex-50 > div.patient-banner-description.full-width.layout-align-start-center.layout-row > span",
        "patient-banner .patient-banner-visit-details .patient-banner-description span",
        "patient-emr-banner .main-banner"
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel);
        const text = flatten(el?.innerText || el?.textContent || "");
        if (!text) continue;

        const slashParts = text.split("/").map(norm).filter(Boolean);
        if (slashParts.length >= 2) return slashParts[slashParts.length - 1];

        const roomMatch = text.match(/\b(?:Room|Bed)\s*[:#-]?\s*([A-Za-z0-9-]+)\b/i);
        if (roomMatch) return roomMatch[1];

        const compactMatch = text.match(/\b([A-Z]{1,4}\d{1,4}|\d{2,4})\b/);
        if (compactMatch) return compactMatch[1];
      }

      return null;
    }

    function findName(lines, flat, hn) {
      if (!lines.length) return null;

      const hnPattern = hn
        ? new RegExp(`\\(?\\s*${hn.replace(/-/g, "\\s*-\\s*")}\\s*\\)?`, "i")
        : null;

      let candidate = lines[0];
      if (hn && !normalizeHN(candidate) && lines[1] && normalizeHN(lines[0] + " " + lines[1])) {
        candidate = `${lines[0]} ${lines[1]}`;
      }

      let name = hnPattern ? candidate.replace(hnPattern, "") : candidate;
      name = name.replace(/\(\s*\)?/g, "").replace(/\s{2,}/g, " ").trim();

      if ((!name || /^\d/.test(name)) && hn) {
        name = flat.split(hn)[0].replace(/[()]/g, "").trim();
      }

      return name || null;
    }

    /* ── DOM-element based extractors (same approach as parser-patient.js) ── */

    function _getBannerRoot(sel) {
      const el = document.querySelector(sel);
      if (!el) return null;
      return el.querySelector(".main-banner") || el;
    }

    function _domHN(root) {
      if (!root) return null;
      for (const el of root.querySelectorAll("span.overme.ng-binding")) {
        const t = norm(el.textContent);
        if (/^\d{2}-\d{2}-\d{6}$/.test(t)) return t;
      }
      return null;
    }

    function _domName(root) {
      if (!root) return null;
      // Specific selector first (patient-emr-banner layout)
      for (const el of root.querySelectorAll(".padding-left-8-imp.flex div.overme.ng-binding")) {
        if (el.getAttribute("aria-hidden") === "true") continue;
        const t = norm(el.textContent);
        if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/")) return t;
      }
      // Broader fallback
      for (const el of root.querySelectorAll("div.overme.ng-binding")) {
        if (el.getAttribute("aria-hidden") === "true") continue;
        const t = norm(el.textContent);
        if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/") && !t.includes(":")) return t;
      }
      return null;
    }

    function _domRoom(root) {
      if (!root) return null;
      for (const span of root.querySelectorAll('span[ng-repeat*="bedoccupancy"]')) {
        const t = norm(span.textContent);
        if (!t) continue;
        const i = t.indexOf("/");
        const room = i !== -1 ? norm(t.slice(i + 1)) : t;
        if (room) return room;
      }
      return null;
    }

    /** @returns {PatientData|null} */
    function parseFromBanner() {
      const bannerEl = document.querySelector("patient-emr-banner, patient-banner");
      if (!bannerEl) return null;

      // Try both banner types for DOM-element extraction
      const emrRoot = _getBannerRoot("patient-emr-banner");
      const inpRoot = _getBannerRoot("patient-banner");
      const domRoot = emrRoot || inpRoot;

      const raw = bannerEl.innerText || bannerEl.textContent || "";
      const lines = cleanLines(raw);
      const flat = flatten(raw);

      // DOM-element queries first, regex fallback for each field
      const hn       = _domHN(domRoot)   || normalizeHN(flat);
      const fullName = _domName(domRoot) || findName(lines, flat, hn);
      const room     = _domRoom(domRoot) || findRoomFromSelector();
      const visit    = findVisitDateTime(lines, flat);

      return {
        fullName,
        hn,
        ageText:       findAge(lines),
        visitDateTime: visit.visitDateTime,
        an:            visit.an,
        room,
        department:    null,
        doctor:        null,
        rights:        null,
        rawText:       raw,
        rawLines:      lines,
      };
    }

    return { parseFromBanner };
  })();

  _g.ParserHomeMed = ParserHomeMed;
})();
