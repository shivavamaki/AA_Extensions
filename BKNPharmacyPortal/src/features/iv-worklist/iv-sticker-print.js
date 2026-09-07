/* iv-sticker-print.js — labels for a worklist row.
 *
 * Deliberately reuses the EXACT markup, class names and @page rules from
 * iv-aux-sticker/iv_sticker.js, so a label printed from the board comes off the
 * same roll, at the same size, as one printed from the IV Label page:
 *
 *   IPD label  — 8 × 3.5 cm, one sticker per page
 *   Small (PFS)— 4 × 2 cm
 *
 * The win over re-keying into the sticker page is that the expiry printed here
 * is the row's own `expiresAt` — the label and the board can never disagree
 * about when the bag dies.
 */
(function (root) {
  'use strict';

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  const pad = n => String(n).padStart(2, '0');

  /** dd/mm/yy HH:MM — the format the existing sticker page prints. */
  function fmtDatetime(d) {
    if (!d) return '—';
    const x = d instanceof Date ? d : new Date(d);
    if (!isFinite(x.getTime())) return '—';
    return `${pad(x.getDate())}/${pad(x.getMonth() + 1)}/${String(x.getFullYear()).slice(-2)}` +
           ` ${pad(x.getHours())}:${pad(x.getMinutes())}`;
  }

  /**
   * The ArcusAir banner prints a Latin name twice, back to back
   * ("MR. X Y MR. X Y"), and the extractor captures the whole run. On an
   * 8x3.5 cm label that doubling costs a whole line. Collapse an exact
   * repeated tail; leave anything that is not a clean repeat untouched.
   */
  function dedupeName(n) {
    const t = String(n == null ? '' : n).replace(/\s+/g, ' ').trim();
    const half = Math.floor(t.length / 2);
    for (let L = half; L >= 6; L--) {
      const a = t.slice(-L).trim();
      const b = t.slice(-2 * L, -L).trim();
      if (a && a.toLowerCase() === b.toLowerCase()) return a;
    }
    return t;
  }

  /** Short drug name for the label: the pharmacy's nickname when we have one. */
  function labelDrug(d) {
    d = d || {};
    return d.nickname || d.name || '';
  }

  /* ── IPD label: 8 × 3.5 cm ──────────────────────────────────────────────── */

  function buildIpdLabel(r) {
    const d = r.drug || {};
    const isHad = !!d.had;
    const inStr = d.solvent ? ` in ${d.solvent}` : '';
    return `<div class="label-ipd">
  ${isHad ? '<div class="had-banner">⚠ HIGH ALERT DRUGS ⚠</div>' : ''}
  <div class="top-row"><span>HN: ${esc(r.hn)}</span><span>ROOM: ${esc(r.room)}</span></div>
  <div class="patient-name">${esc(dedupeName(r.name))}${r.age ? ' · ' + esc(r.age) + ' Y' : ''}</div>
  <div class="drug-name">${esc(labelDrug(d))} ${esc(d.dose)}${esc(inStr)}</div>
  ${d.rate ? `<div class="rate-line">${esc(d.rate)}</div>` : ''}
  <div class="info-grid">
    <div class="info-row"><span class="info-key">Freq:</span><span class="info-val">${esc(d.freq || '')}</span></div>
    <div class="info-row"><span class="info-key">Time:</span><span class="info-val">${esc(r.slot || '')}:00</span></div>
  </div>
  <div class="label-dates"><span>Mfd.: ${esc(fmtDatetime(r.preparedAt))}</span><span>Exp.: ${esc(fmtDatetime(r.expiresAt))}</span></div>
  <div class="label-sig"><span>Prep.: ${esc(r.preparedBy || '—')}</span><span>Check: ${esc(r.checkedBy || '—')}</span></div>
  ${r.note ? `<div class="label-note">Note: ${esc(r.note)}</div>` : ''}
  <div class="label-storage">${esc(d.storage || 'Keep in Room Temp.')}</div>
</div>`;
  }

  // Lifted verbatim from iv_sticker.js so both paths render identically.
  const IPD_CSS = `
      @page { size: 8cm 3.5cm; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin: 0; padding: 0; width: 8cm; font-family: 'Sarabun', sans-serif; }
      .label-ipd {
        font-family: 'Sarabun', sans-serif; background: #fff; color: #000; border: none;
        padding: 4px 7px; width: 8cm; height: 3.5cm; overflow: hidden; box-sizing: border-box;
        display: flex; flex-direction: column; justify-content: space-between;
        page-break-after: always;
      }
      .had-banner { background: #c00 !important; color: #fff !important; text-align: center; font-size: 7.5pt; font-weight: 800; letter-spacing: .12em; padding: 2px 0; margin: -4px -7px 3px; flex-shrink: 0; }
      .top-row    { display: flex; justify-content: space-between; font-size: 8pt; font-weight: 700; margin-bottom: 1px; flex-shrink: 0; }
      .patient-name { font-size: 8.5pt; font-weight: 500; margin-bottom: 1px; flex-shrink: 0; }
      .drug-name  { font-size: 9.5pt; font-weight: 700; margin-bottom: 2px; line-height: 1.15; flex-shrink: 0; }
      .rate-line  { font-size: 7.5pt; color: #333; margin-bottom: 2px; flex-shrink: 0; }
      .info-grid  { display: flex; gap: 0 8px; font-size: 7pt; flex-shrink: 0; flex-wrap: wrap; }
      .info-row   { display: flex; gap: 2px; }
      .info-key   { color: #555; white-space: nowrap; }
      .info-val   { font-weight: 600; }
      .label-dates{ display: flex; gap: 10px; font-size: 7pt; border-top: 0.5px solid #ccc; padding-top: 2px; margin-top: 2px; flex-shrink: 0; }
      .label-sig  { font-size: 7pt; color: #555; display: flex; justify-content: space-between; flex-wrap: wrap; margin-top: 1px; flex-shrink: 0; }
      .label-note { font-size: 6.5pt; margin-top: 1px; border-top: 0.5px solid #eee; padding-top: 1px; color: #333; flex-shrink: 0; }
      .label-storage { font-size: 6.5pt; color: #888; text-align: right; flex-shrink: 0; }`;

  /* ── Small label: 4 × 2 cm ──────────────────────────────────────────────── */

  function buildSmallLabel(r) {
    const d = r.drug || {};
    return `<div class="label-sm">
  <div class="sm-drug">${esc(labelDrug(d))} ${esc(d.dose)}</div>
  <div class="sm-line">${esc(r.hn)} · ${esc(r.room)}</div>
  <div class="sm-line">${esc(r.slot || '')}:00 · ${esc(d.freq || '')}</div>
  <div class="sm-exp">Exp ${esc(fmtDatetime(r.expiresAt))}</div>
</div>`;
  }

  const SMALL_CSS = `
      @page { size: 4cm 2cm; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin: 0; padding: 0; width: 4cm; font-family: 'Sarabun', sans-serif; }
      .label-sm { width: 4cm; height: 2cm; padding: 2px 4px; overflow: hidden;
        display: flex; flex-direction: column; justify-content: space-between;
        background: #fff; color: #000; page-break-after: always; }
      .sm-drug { font-size: 7.5pt; font-weight: 700; line-height: 1.1; }
      .sm-line { font-size: 6pt; color: #333; }
      .sm-exp  { font-size: 6pt; font-weight: 700; border-top: .5px solid #ccc; padding-top: 1px; }`;

  /* ── Send report ────────────────────────────────────────────────────────── */

  /**
   * The sheet the porter carries to the ward. Grouped by ward then room so the
   * round is walked in order, with a signature column per row — the ward signs
   * for what it received, and that page is the delivery record.
   */
  function buildSendReport(groups, meta) {
    const rowsHtml = groups.map(g => `
      <tr class="ward-row"><td colspan="7">${esc(g.ward)} — ${g.rows.length} รายการ</td></tr>
      ${g.rows.map(r => `<tr>
        <td class="c">${esc(r.room)}</td>
        <td>${esc(r.hn)}<div class="sub">${esc(r.name)}</div></td>
        <td>${esc(r.drug.name)} ${esc(r.drug.dose)}<div class="sub">${esc(r.drug.solvent || '')}</div></td>
        <td class="c">${esc(r.slot || '')}:00</td>
        <td class="c">${r.drug.had ? '<b class="had">HAD</b>' : ''}</td>
        <td class="c">${esc(fmtDatetime(r.expiresAt))}</td>
        <td class="sig"></td>
      </tr>`).join('')}`).join('');

    const total = groups.reduce((n, g) => n + g.rows.length, 0);

    return `<div class="rep">
  <div class="rep-head">
    <div>
      <h1>ใบส่งยาฉีด · IV Delivery Report</h1>
      <div class="rep-sub">${esc(meta.filterText || 'ทั้งหมด · All')}</div>
    </div>
    <div class="rep-meta">
      <div>พิมพ์เมื่อ · Printed: ${esc(fmtDatetime(new Date()))}</div>
      <div>รวม · Total: <b>${total}</b> รายการ</div>
      <div>ผู้ส่ง · Sent by: ____________________</div>
    </div>
  </div>
  <table>
    <thead><tr>
      <th>ห้อง<br>Room</th><th>HN / ชื่อ</th><th>ยา · Drug</th>
      <th>เวลา<br>Time</th><th></th><th>หมดอายุ<br>Expires</th>
      <th>ผู้รับ · Received by</th>
    </tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
</div>`;
  }

  const REPORT_CSS = `
      @page { size: A4 portrait; margin: 10mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { font-family: 'Sarabun', sans-serif; margin: 0; color: #000; font-size: 9pt; }
      .rep-head { display: flex; justify-content: space-between; align-items: flex-start;
        border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 8px; }
      h1 { font-size: 14pt; margin: 0; }
      .rep-sub { font-size: 8pt; color: #444; margin-top: 2px; }
      .rep-meta { font-size: 8pt; text-align: right; line-height: 1.7; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 0.5px solid #999; padding: 3px 5px; vertical-align: top; }
      th { background: #eee !important; font-size: 7.5pt; text-align: left; }
      td.c { text-align: center; white-space: nowrap; }
      .sub { font-size: 7pt; color: #555; }
      .ward-row td { background: #ddd !important; font-weight: 700; font-size: 9pt; }
      .had { color: #c00; }
      .sig { width: 28mm; }
      tr { page-break-inside: avoid; }`;

  /* ── Print plumbing ─────────────────────────────────────────────────────── */

  /**
   * Print via a hidden same-document iframe rather than window.open().
   * A popup is blocked in an extension page and inside the artifact preview;
   * an iframe prints from any context and needs no popup permission.
   */
  function printHTML(bodyHTML, css) {
    const old = document.getElementById('ivw-print-frame');
    if (old) old.remove();

    const f = document.createElement('iframe');
    f.id = 'ivw-print-frame';
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(f);

    const d = f.contentDocument;
    d.open();
    d.write(`<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;700;800&display=swap">
<style>${css}</style></head><body>${bodyHTML}</body></html>`);
    d.close();

    // Wait for the webfont before printing, or the first label prints in a
    // fallback face and the sticker is the wrong width.
    const go = () => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) {} };
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(() => setTimeout(go, 60));
    else setTimeout(go, 400);
  }

  root.IVSticker = {
    esc, fmtDatetime,
    buildIpdLabel, buildSmallLabel, buildSendReport,
    IPD_CSS, SMALL_CSS, REPORT_CSS,
    printIpd:   rows => printHTML(rows.map(buildIpdLabel).join(''), IPD_CSS),
    printSmall: rows => printHTML(rows.map(buildSmallLabel).join(''), SMALL_CSS),
    printReport: (groups, meta) => printHTML(buildSendReport(groups, meta || {}), REPORT_CSS),
  };
})(typeof window !== 'undefined' ? window : globalThis);
