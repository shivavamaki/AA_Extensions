"use strict";

/**
 * features/home-med/parser-home-med.js
 * Robust patient parser for the Home Medication Sheet.
 *
 * Important: the discharge-medication dialog table does not contain patient
 * demographics. This parser only extracts fields that can be read reliably
 * from the page banner and intentionally avoids filling weak fields such as
 * physician/department/age when the banner text is ambiguous.
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

        // Common formats include: "Ward 4 / 401", "WARD 4 / W407", or only a room/bed code.
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

      // Common case: first line contains both name and HN, possibly with HN
      // broken across lines: "Name ( 48-26-\n004323 )".
      const hnPattern = hn
        ? new RegExp(`\\(?\\s*${hn.replace(/-/g, "\\s*-\\s*")}\\s*\\)?`, "i")
        : null;

      let candidate = lines[0];
      if (hn && !normalizeHN(candidate) && lines[1] && normalizeHN(lines[0] + " " + lines[1])) {
        candidate = `${lines[0]} ${lines[1]}`;
      }

      let name = hnPattern ? candidate.replace(hnPattern, "") : candidate;
      name = name.replace(/\(\s*\)?/g, "").replace(/\s{2,}/g, " ").trim();

      // Fallback from flattened text before HN.
      if ((!name || /^\d/.test(name)) && hn) {
        name = flat.split(hn)[0].replace(/[()]/g, "").trim();
      }

      return name || null;
    }

    /** @returns {PatientData|null} */
    function parseFromBanner() {
      const banner = document.querySelector("patient-banner, patient-emr-banner");
      if (!banner) return null;

      const raw = banner.innerText || banner.textContent || "";
      const lines = cleanLines(raw);
      const flat = flatten(raw);
      const hn = normalizeHN(flat);
      const visit = findVisitDateTime(lines, flat);

      return {
        fullName: findName(lines, flat, hn),
        hn,
        ageText: findAge(lines),
        visitDateTime: visit.visitDateTime,
        an: visit.an,
        room: findRoomFromSelector(),
        department: null,
        doctor: null,
        rights: null,
        rawText: raw,
        rawLines: lines,
      };
    }

    return { parseFromBanner };
  })();

  _g.ParserHomeMed = ParserHomeMed;
})();
