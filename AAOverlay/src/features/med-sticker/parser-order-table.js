"use strict";

/**
 * features/med-sticker/parser-order-table.js
 * ─────────────────────────────────────────────────────────────────
 * Scrapes the #ordertable on the pharmacy dispense page and returns
 * an array of row objects keyed by normalised (lowercase) header.
 *
 * Fixes carried forward:
 *  - Headers are normalised once at parse time (lowercase, no arrows,
 *    collapsed whitespace) so page scripts never need to guess casing.
 *  - Uses textContent (not innerText) to capture text inside hidden
 *    or nested elements.
 *  - All debug console.log calls removed; only console.warn on error.
 * ─────────────────────────────────────────────────────────────────
 */

(function () {
  const _g = typeof globalThis !== "undefined" ? globalThis
           : typeof window !== "undefined" ? window : {};
  if (_g.ParserOrderTable) return;

  const ParserOrderTable = (() => {

  const { normHeader, norm } = window.CoreDom;

  const TABLE_SEL = "#ordertable";

  /**
   * Parse #ordertable and return normalised rows.
   *
   * @returns {{ headers: string[], rows: Record<string,string>[] } | null}
   *   null when the table element is not found.
   */
  function parse() {
    const table = document.querySelector(TABLE_SEL);
    if (!table) {
      console.warn("[ParserOrderTable] #ordertable not found");
      return null;
    }

    // ── Headers ────────────────────────────────────────────────────
    // Normalise once; row values are stored under these normalised keys.
    const headers = Array.from(table.querySelectorAll("thead th"))
      .map((th) => normHeader(th.textContent));

    // ── Rows ───────────────────────────────────────────────────────
    const rows = [];

    table.querySelectorAll("tbody tr").forEach((tr) => {
      const cells = Array.from(tr.children);
      if (!cells.length) return;

      const row = {};
      headers.forEach((h, i) => {
        row[h] = norm(cells[i]?.textContent || "");
      });

      rows.push(row);
    });

    return { headers, rows };
  }

  /**
   * Convenience: just return the rows array (most callers only need rows).
   * Returns [] when the table is not found or has no rows.
   *
   * @returns {Record<string,string>[]}
   */
  function parseRows() {
    const result = parse();
    return result ? result.rows : [];
  }

  return { parse, parseRows };

})();

  _g.ParserOrderTable = ParserOrderTable;
})();
