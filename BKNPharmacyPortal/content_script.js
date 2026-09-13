/**
 * content_script.js — BKN Pharmacy Extension v2.1
 *
 * Handles three concerns:
 *  1. drugdelivery page — receive visitId, fill form and submit
 *  2. arcusair MRD page — scroll-load table, inject "Send" buttons per row
 *  3. arcusair Dispense Workbench — scrape patient + order, push to iv_sticker
 */
(function () {
  'use strict';

  const HOST = location.hostname;

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. GENERIC MESSAGE ROUTER (used by popup)
  // ═══════════════════════════════════════════════════════════════════════════
  chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
    switch (req.action) {

      // drugdelivery page: fill + submit
      case 'fillAndSubmit': {
        fillDrugDelivery(req.visitId);
        sendResponse({ accepted: true });
        break;
      }
    }
    return true;
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. ARCUSAIR — MRD TABLE  (https://arcusair.bdms.co.th/#!/mrd/reopenvisit)
  // ═══════════════════════════════════════════════════════════════════════════
  const MRD_TABLE_SEL =
    'md-card-content md-table-container';
    // 'body > div.full-height.ng-scope.layout-row > div > md-content > ' +
    // 'md-card > md-card-content > div:nth-child(4) > md-table-container';

  // Column indices (0-based) — mapped from live HTML inspection
  // td[0]  HN
  // td[1]  Name  (text inside nested <span ng-if>)
  // td[2]  Age
  // td[3]  Gender
  // td[4]  Visit Type
  // td[5]  Visit ID   <- key field
  // td[6]  Start Date
  // td[7]  End Date   <- empty string = still active
  // td[8]  Department
  // td[9]  Doctor
  // td[10] Ward / Bed <- display field
  // td[11] Action buttons
  const COL = {
    WARD_BED:  10,
    NAME:       1,
    VISIT_ID:   5,
    END_DATE:   7,
  };

  const SEND_BTN_CLASS = 'bknExt_sendBtn';

  function isMrdPage() {
    const h = location.hash || '';
    return h.includes('/mrd/') || location.href.includes('/mrd/');
  }

  if (HOST === 'arcusair.bdms.co.th') {
    if (isMrdPage()) initMrdPage();
    // Re-evaluate on SPA hash navigation
    window.addEventListener('hashchange', () => {
      if (isMrdPage()) {
        setTimeout(initMrdPage, 600);
      } else {
        // Clean up any stray buttons if navigating away from MRD page
        document.querySelectorAll('.' + SEND_BTN_CLASS)
          .forEach(b => b.parentNode && b.parentNode.removeChild(b));
      }
    });
    // Dispense workbench button is injected via MutationObserver below (SPA navigation)
  }

  function initMrdPage() {
    if (!isMrdPage()) return;
    waitForElement(MRD_TABLE_SEL, () => {
      scrollLoadAll(MRD_TABLE_SEL).then(() => {
        injectSendButtons();
        observeTableChanges();
      });
    });
  }

  /**
   * Scroll the table container down repeatedly until no new rows appear,
   * so Angular's virtual/lazy-load renders everything.
   */
  async function scrollLoadAll(containerSel) {
    const container = document.querySelector(containerSel);
    if (!container) return;

    const scroller = findScroller(container) || document.scrollingElement;
    let lastCount = 0;
    let stable = 0;

    while (stable < 3) {
      scroller.scrollTop += 600;
      await sleep(400);
      const count = container.querySelectorAll('tbody tr').length;
      if (count === lastCount) {
        stable++;
      } else {
        stable = 0;
        lastCount = count;
      }
    }
    scroller.scrollTop = 0;
    await sleep(200);
  }

  function findScroller(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      const { overflowY } = getComputedStyle(node);
      if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function injectSendButtons() {
    if (!isMrdPage()) return;
    const table = document.querySelector(MRD_TABLE_SEL);
    if (!table) return;

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach(tr => {
      if (tr.querySelector('.' + SEND_BTN_CLASS)) return;

      const cells = tr.querySelectorAll('td');
      if (cells.length < 12) return;

      const endDate = cellText(cells[COL.END_DATE]);
      if (endDate !== '') return;

      const visitId = cellText(cells[COL.VISIT_ID]);
      if (!visitId) return;

      const btn = document.createElement('button');
      btn.className = SEND_BTN_CLASS;
      btn.type = 'button';
      btn.textContent = 'Send ▶';
      btn.title = `Send Visit ID: ${visitId} to Drug Delivery`;
      Object.assign(btn.style, {
        marginLeft: '6px',
        padding: '2px 10px',
        fontSize: '11px',
        fontWeight: '600',
        background: 'linear-gradient(135deg,#00b4d8,#0096b7)',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        verticalAlign: 'middle',
        transition: 'opacity .15s',
      });
      btn.addEventListener('mouseenter', () => btn.style.opacity = '.8');
      btn.addEventListener('mouseleave', () => btn.style.opacity = '1');
      btn.addEventListener('click', () => handleSend(btn, visitId));

      const visitCell = cells[COL.VISIT_ID];
      visitCell.appendChild(btn);
    });
  }

  async function handleSend(btn, visitId) {
    btn.disabled = true;
    btn.textContent = '…';
    try {
      await chrome.runtime.sendMessage({ action: 'sendToDrugDelivery', visitId });
      btn.textContent = '✓';
      btn.style.background = 'linear-gradient(135deg,#00c9a7,#00a688)';
      setTimeout(() => {
        btn.textContent = 'Send ▶';
        btn.style.background = 'linear-gradient(135deg,#00b4d8,#0096b7)';
        btn.disabled = false;
      }, 3000);
    } catch (e) {
      btn.textContent = '✗';
      btn.style.background = '#e05050';
      btn.disabled = false;
      console.error('[MRD Send]', e);
    }
  }

  function observeTableChanges() {
    const table = document.querySelector(MRD_TABLE_SEL);
    if (!table) return;
    let debounce = null;
    new MutationObserver(() => {
      clearTimeout(debounce);
      debounce = setTimeout(injectSendButtons, 400);
    }).observe(table, { childList: true, subtree: true });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 3. DRUGDELIVERY PAGE  (http://10.134.10.91:8809/drugdelivery/…)
  // ═══════════════════════════════════════════════════════════════════════════
  if (location.hostname === '10.134.10.91') {
    chrome.runtime.sendMessage({ action: 'drugDeliveryReady' });
  }

  const INPUT_SEL  = '#cartcode';
  const SUBMIT_SEL = '#main-wrapper form button';
  const ERROR_SEL  = '#main-wrapper li';

  async function fillDrugDelivery(visitId) {
    const input     = document.querySelector(INPUT_SEL);
    const submitBtn = document.querySelector(SUBMIT_SEL);

    if (!input || !submitBtn) {
      console.error('[DrugDelivery] Cannot find #cartcode or submit button');
      chrome.runtime.sendMessage({
        action: 'drugDeliveryResult',
        visitId,
        ok: false,
        errorText: 'Page elements not found (#cartcode or submit button)',
      });
      return;
    }

    input.focus();
    input.value = '';
    input.value = String(visitId).trim();
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    await sleep(300);
    submitBtn.click();

    const result = await waitForResult(visitId);
    chrome.runtime.sendMessage({ action: 'drugDeliveryResult', ...result });
  }

  async function waitForResult(visitId) {
    const startUrl = location.href;
    const deadline = Date.now() + 5000;

    while (Date.now() < deadline) {
      await sleep(250);

      const errEl = document.querySelector(ERROR_SEL);
      if (errEl) {
        const errorText = (errEl.innerText || errEl.textContent || '').trim();
        if (errorText) {
          return { visitId, ok: false, errorText };
        }
      }

      if (location.href !== startUrl) {
        return { visitId, ok: true };
      }
    }

    const errEl = document.querySelector(ERROR_SEL);
    if (errEl) {
      const errorText = (errEl.innerText || errEl.textContent || '').trim();
      if (errorText) {
        return { visitId, ok: false, errorText };
      }
    }

    return {
      visitId,
      ok: false,
      errorText: 'Timeout waiting for result',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. ARCUSAIR — DISPENSE WORKBENCH SCRAPER
  //    URL: https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/…
  //    Scrapes patient banner + #ordertable, saves to chrome.storage.local,
  //    then opens iv_sticker.html in a new tab.
  //    Only IPD Label is affected — PFS pages are untouched.
  // ═══════════════════════════════════════════════════════════════════════════
  const IV_BTN_ID      = 'bknExt_ivLabelBtn';
  const IV_STORAGE_KEY = 'iv_scrape';

  /** True only on Pharmacy Dispense Workbench exact SPA route */
  function isDispensePage() {
    const targetHash = '#!/pharmacy/dispenseworkbench/pharmacy/dispense';
    return location.hostname === 'arcusair.bdms.co.th' &&
      location.hash === targetHash;
  }

  // Shared Pharmacy tools flyout owns placement; no patient-banner anchor required.
  const IV_TOOL_FLYOUT_SEL = ".bkn-tool-group .bkn-tool-flyout";

  /**
   * Parse the patient banner and #ordertable, return structured JSON.
   *
   * Returned shape:
   * {
   *   scrapedAt: ISO string,
   *   patient: { name, hn, room },
   *   medicines: [{ drugName, dose, unit, solvent, rate, lot, rawCells[] }]
   * }
   * Returns null if #ordertable is missing or empty.
   */
  function scrapeDispensePage() {
    console.group('[BKN IV Scraper] scrapeDispensePage()');

    // ── Patient name ──────────────────────────────────────────────────────────
    const nameNodes = Array.from(
      document.querySelectorAll('patient-emr-banner .overme.ng-binding.flex')
    );
    const ptName = (nameNodes[0]?.innerText || nameNodes[0]?.textContent || '').trim();
    console.log('[name] selector: patient-emr-banner .overme.ng-binding.flex');
    console.log('[name] nodes found:', nameNodes.length, '| value:', JSON.stringify(ptName));

    // ── HN ────────────────────────────────────────────────────────────────────
    const allOverme = Array.from(
      document.querySelectorAll('patient-emr-banner .overme.ng-binding')
    );
    let hn = '';
    for (const el of allOverme) {
      const t = (el.innerText || el.textContent || '').trim();
      if (/48[-\s]?\d{2}[-\s]?\d{6}/.test(t) || /^48[-\s]/.test(t)) { hn = t; break; }
    }
    if (!hn) {
      for (const el of allOverme) {
        const t = (el.innerText || el.textContent || '').trim();
        if (/\d{2}-\d{2}-\d{6}/.test(t)) { hn = t; break; }
      }
    }
    console.log('[hn]   selector: patient-emr-banner .overme.ng-binding');
    console.log('[hn]   all .overme.ng-binding texts:', allOverme.map(e => (e.innerText||'').trim()));
    console.log('[hn]   resolved:', JSON.stringify(hn));

    // ── Room / Ward ───────────────────────────────────────────────────────────
    // Use the specific bedoccupancy span: yields "Ward 5 / 520" → extract "520"
    const bedSpan = document.querySelector(
      'patient-emr-banner div.main-banner-section.flex > div:nth-child(3) > span'
    );
    let room = '';
    if (bedSpan) {
      const raw = (bedSpan.innerText || bedSpan.textContent || '').trim().replace(/\s+/g, ' ');
      // "Ward 5 / 520" → take part after last "/"
      const slashIdx = raw.lastIndexOf('/');
      room = slashIdx !== -1 ? raw.slice(slashIdx + 1).trim() : raw;
    }
    // Fallback: old .main-banner-section keyword scan
    if (!room) {
      const bannerSections = Array.from(
        document.querySelectorAll('patient-emr-banner .main-banner-section')
      );
      for (const sec of bannerSections) {
        const txt = (sec.innerText || sec.textContent || '').trim();
        if (/ward|ห้อง|room|floor|icu|nicu|ccu|picu/i.test(txt)) {
          const val = sec.querySelector('span.ng-binding, span:last-child');
          room = (val?.innerText || val?.textContent || txt).trim().replace(/\n[\s\S]*/g, '');
          const si = room.lastIndexOf('/');
          if (si !== -1) room = room.slice(si + 1).trim();
          break;
        }
      }
    }
    console.log('[room] bedSpan selector: patient-emr-banner div.main-banner-section.flex > div:nth-child(3) > span');
    console.log('[room] bedSpan raw text:', bedSpan ? (bedSpan.innerText||'').trim() : 'NOT FOUND');
    console.log('[room] resolved (after / strip):', JSON.stringify(room));

    // ── Order table ───────────────────────────────────────────────────────────
    const table = document.querySelector('#ordertable');
    console.log('[table] #ordertable found:', !!table);
    if (!table) {
      console.warn('[table] #ordertable NOT FOUND — returning null');
      console.groupEnd();
      return null;
    }

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    console.log('[table] tbody tr count:', rows.length);
    if (!rows.length) {
      console.warn('[table] No rows in #ordertable tbody — returning null');
      console.groupEnd();
      return null;
    }

    // Log raw cell content of every row for remapping
    console.group('[table] Raw cell dump per row:');
    rows.forEach((tr, ri) => {
      const cells = Array.from(tr.querySelectorAll('td'))
        .map(td => (td.innerText || td.textContent || '').trim().replace(/\s+/g, ' '));
      console.log(`  row[${ri}]:`, cells);
    });
    console.groupEnd();

    // Build a robust column map from the table header.
    // Arcus rows contain icon text in the Alerts cell, so using the first
    // non-numeric cell as the drug name is unsafe. Use explicit columns:
    // Code | Order Item | Medicine Details | Quantity | Status | Start Date.
    const headerCells = Array.from(table.querySelectorAll('thead th'))
      .map(th => (th.innerText || th.textContent || '').trim().replace(/\s+/g, ' ').toLowerCase());
    const colIndex = (names, fallback) => {
      for (const name of names) {
        const idx = headerCells.findIndex(h => h === name || h.includes(name));
        if (idx >= 0) return idx;
      }
      return fallback;
    };
    const COL = {
      code:    colIndex(['code'], 1),
      name:    colIndex(['order item'], 2),
      details: colIndex(['medicine details'], 3),
      qty:     colIndex(['quantity'], 4),
      status:  colIndex(['status'], 5),
      start:   colIndex(['start date'], 6),
    };

    function cleanArcusDrugName(v) {
      return String(v || '')
        .replace(/\s*#\s*-?\s*\d{10,}\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    const medicines = [];
    for (const tr of rows) {
      const tds = Array.from(tr.querySelectorAll('td'));
      if (!tds.length) continue;

      const cells = tds.map(td => (td.innerText || td.textContent || '').trim().replace(/\s+/g, ' '));
      const code = cells[COL.code] || '';
      const orderItem = cleanArcusDrugName(cells[COL.name] || '');
      const details = cells[COL.details] || '';
      const qty = cells[COL.qty] || '';
      const status = cells[COL.status] || '';
      const startDate = cells[COL.start] || '';

      // Skip non-order/helper rows.
      if (!orderItem || !code || !/\d{8,}/.test(code)) continue;

      medicines.push({
        code: code.trim(),
        drugName: orderItem,
        dose: details,
        unit: details,
        solvent: qty,
        rate: '',
        lot: '',
        details,
        quantity: qty,
        status,
        startDate,
        rawCells: cells,
      });
    }

    if (!medicines.length) {
      console.warn('[medicines] No medicines parsed — returning null');
      console.groupEnd();
      return null;
    }

    const result = {
      scrapedAt: new Date().toISOString(),
      patient:   { name: ptName, hn, room },
      medicines,
    };

    console.log('[result] Final JSON to be stored:');
    console.log(JSON.stringify(result, null, 2));
    console.groupEnd();
    return result;
  }

  /** Persist scraped data and open iv_sticker.html in a new tab */
  async function handleSendToIvLabel(btn) {
    console.log('[BKN IV Scraper] handleSendToIvLabel() — button clicked');
    btn.innerHTML = '⏳';
    btn.disabled  = true;
    try {
      const data = scrapeDispensePage();
      if (!data) {
        console.error('[BKN IV Scraper] scrapeDispensePage() returned null');
        alert('ไม่พบข้อมูลในหน้านี้\nกรุณาตรวจสอบว่าเปิด order ของผู้ป่วยแล้ว และตารางยามีข้อมูล\n\n(ดู Console > [BKN IV Scraper] สำหรับรายละเอียด)');
        btn.disabled  = false;
        btn.innerHTML = '💉';
        return;
      }

      await new Promise((resolve, reject) => {
        chrome.storage.local.set({ [IV_STORAGE_KEY]: data }, () => {
          chrome.runtime.lastError ? reject(chrome.runtime.lastError) : resolve();
        });
      });
      console.log('[BKN IV Scraper] Data saved to chrome.storage.local key:', IV_STORAGE_KEY);

      window.open(chrome.runtime.getURL('src/features/iv-aux-sticker/iv_sticker.html'), '_blank');

      btn.innerHTML = '✅';
      setTimeout(() => {
        btn.disabled  = false;
        btn.innerHTML = '💉';
      }, 3000);

    } catch (err) {
      console.error('[BKN IV Scraper] Error:', err);
      alert('เกิดข้อผิดพลาด: ' + (err.message || String(err)));
      btn.disabled  = false;
      btn.innerHTML = '💉';
    }
  }

  /**
   * Inject the 💉 button inside the shared Pharmacy tools flyout.
   * Conditions:
   * 1) Only on https://arcusair.bdms.co.th/#!/pharmacy/dispenseworkbench/pharmacy/dispense
   * 2) Append inside the shared .bkn-tool-flyout when it is rendered
   */
  function injectIvLabelButton() {
    try {
      if (!isDispensePage()) {
        const oldBtn = document.getElementById(IV_BTN_ID);
        if (oldBtn) oldBtn.remove();
        return;
      }

      const flyout = document.querySelector(IV_TOOL_FLYOUT_SEL);
      if (!flyout) return;

    const existing = document.getElementById(IV_BTN_ID);
    if (existing) {
      // If Angular re-render moved the anchor/button, keep the button inside the current flyout.
      if (existing.parentElement !== flyout) {
        flyout.appendChild(existing);
      }
      return;
    }

    const btn = document.createElement('button');
    btn.id        = IV_BTN_ID;
    btn.type      = 'button';
    btn.innerHTML = '💉';
    btn.title     = 'ส่งไป IV Label';
    btn.setAttribute('aria-label', 'ส่งไป IV Label');

    Object.assign(btn.style, {
      height:       '24px',
      width:        '24px',
      padding:      '0',
      borderRadius: '50%',
      background:   '#0d6e3f',
      color:        '#fff',
      border:       'none',
      fontSize:     '14px',
      lineHeight:   '1',
      cursor:       'pointer',
      display:      'inline-flex',
      alignItems:   'center',
      justifyContent: 'center',
      boxShadow:    '0 2px 6px rgba(0,0,0,.22)',
      flexShrink:   '0',
      marginLeft:   '6px',
      verticalAlign:'middle',
      position:     'relative',
      top:          '-1px',
      zIndex:       '20',
    });

    btn.addEventListener('mouseenter', () => { btn.style.background = '#0a5a33'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#0d6e3f'; });
    btn.addEventListener('click', () => handleSendToIvLabel(btn));

    flyout.appendChild(btn);
    console.log('[BKN IV Scraper] IV Label button added to Pharmacy tools flyout.');
    } catch (err) {
      console.warn('[BKN IV Scraper] injectIvLabelButton failed', err);
    }
  }

  function handleArcusAirRouteChange() {
    if (!isDispensePage()) {
      const oldBtn = document.getElementById(IV_BTN_ID);
      if (oldBtn) oldBtn.remove();
    } else {
      injectIvLabelButton();
    }

    if (!isStockTransferPage()) {
      const oldExportBtn = document.getElementById('exportPdfBtn');
      if (oldExportBtn) oldExportBtn.remove();
    } else {
      waitForElement(
        'md-card-content disable-all-inputs > div',
        injectExportButton
      );
    }
  }

  function initArcusAirRouteWatchers() {
    if (HOST !== 'arcusair.bdms.co.th') return;

    window.addEventListener('hashchange', () => setTimeout(handleArcusAirRouteChange, 350));
    window.addEventListener('popstate', () => setTimeout(handleArcusAirRouteChange, 350));

    onBodyReady(() => {
      handleArcusAirRouteChange();
      // Patient changes can recreate the flyout without changing the SPA route.
      let ivButtonUpdatePending = false;
      new MutationObserver(() => {
        if (ivButtonUpdatePending) return;
        ivButtonUpdatePending = true;
        requestAnimationFrame(() => {
          ivButtonUpdatePending = false;
          injectIvLabelButton();
        });
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  initArcusAirRouteWatchers();

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. ARCUSAIR — STOCK TRANSFER PDF EXPORT
  // ═══════════════════════════════════════════════════════════════════════════

  function isStockTransferPage() {
    return /stocktransferdetail/i.test(location.href);
  }

  function injectExportButton() {
    if (document.getElementById("exportPdfBtn")) return;

    const anchor = document.querySelector("#commentsicon");

    if (!anchor) {
      console.warn("[PDF] #commentsicon not found");
      return;
    }

    const btn = document.createElement("button");
    btn.id = "exportPdfBtn";
    btn.innerText = "Export Beedee Report";

    Object.assign(btn.style, {
      marginRight: "8px",
      padding: "6px 14px",
      background: "#1976d2",
      color: "#fff",
      border: "none",
      borderRadius: "4px",
      cursor: "pointer",
      fontWeight: "600"
    });

    // prevent double trigger
    btn.addEventListener("click", handleExport, { once: true });

    // ✅ insert BEFORE comments icon
    anchor.insertAdjacentElement("beforebegin", btn);
  }

  function getStockTransferData() {
    const stNumber = document.querySelector("#stNumber")?.value || "";

    const rows = document.querySelectorAll("tbody tr");
    const items = [];

    rows.forEach((row) => {
      const cells = row.querySelectorAll("td");
      if (cells.length < 10) return;

      items.push({
        code: cells[1]?.innerText.trim(),
        name: cells[2]?.innerText.trim(),
        batch: cells[3]?.innerText.split("/")[0]?.trim(),
        exp: cells[3]?.innerText.split("/")[1]?.trim(),
        qty: cells[4]?.innerText.trim(),
        unit: cells[5]?.innerText.trim(),
        cost: cells[7]?.innerText.trim(),
        total: cells[9]?.innerText.trim(),
      });
    });

    return { stNumber, items };
  }

  let exporting = false;

  async function handleExport() {
    if (exporting) return;   // ✅ prevent double run
    exporting = true;

    await sleep(350);

    const data = getStockTransferData();

    console.log("📦 Export data:", data);

    if (!data || !data.items.length) {
      alert("No data to export");
      exporting = false;
      return;
    }

    chrome.runtime.sendMessage({
      action: "OPEN_PDF_PAGE",
      payload: data
    });

    // reset after short delay
    setTimeout(() => exporting = false, 1000);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════
  /**
   * Extract clean text from a table cell.
   * Handles Angular ng-if wrapper spans.
   */
  function cellText(td) {
    if (!td) return '';
    const child = td.querySelector('span.ng-binding, span.ng-scope, div.ng-binding, span');
    const raw = child
      ? (child.innerText || child.textContent || '')
      : (td.innerText    || td.textContent    || '');
    return raw.replace(/\s+/g, ' ').trim();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function onBodyReady(cb) {
    if (document.body) {
      cb(document.body);
      return;
    }
    window.addEventListener('DOMContentLoaded', () => cb(document.body), { once: true });
  }

  function waitForElement(sel, cb, maxWait = 10000) {
    const el = document.querySelector(sel);
    if (el) { cb(el); return; }
    const obs = new MutationObserver(() => {
      const found = document.querySelector(sel);
      if (found) { obs.disconnect(); cb(found); }
    });
    onBodyReady((body) => {
      if (body) obs.observe(body, { childList: true, subtree: true });
    });
    setTimeout(() => obs.disconnect(), maxWait);
  }

})();
