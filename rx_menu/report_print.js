'use strict';

const $ = (id) => document.getElementById(id);
let currentPayload = null;

function escHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function txt(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function getTypeFromUrl() {
  const p = new URLSearchParams(location.search);
  return (p.get('type') || '').toLowerCase() || 'exp';
}

function setStatus(text) {
  const el = $('controlStatus');
  if (el) el.textContent = text;
}

function setControlTitle(title, sub) {
  if ($('controlReportName')) $('controlReportName').textContent = title;
  if ($('controlSubText')) $('controlSubText').textContent = sub;
}

function td(value, cls = '') {
  return `<td${cls ? ` class="${cls}"` : ''}>${escHtml(value)}</td>`;
}

function th(label, cls = '') {
  return `<th${cls ? ` class="${cls}"` : ''}>${escHtml(label)}</th>`;
}

function normalizeObserve(row) {
  const raw = row.observe ?? row['Observe in visite'] ?? row['Observe in visit'] ?? row['observe'] ?? row['OBSERVE'] ?? '';
  const s = txt(raw).toUpperCase();
  if (s.startsWith('Y')) return 'Y';
  if (s.startsWith('N')) return 'N';
  return s || 'Blank';
}

function deriveExpCategory(row) {
  const explicit = txt(row?.category || row?.Category || row?.itemCategory || row?.type || row?.Type || '');
  if (explicit) return explicit;

  const name = txt(row?.name || row?.Name || row?.itemName || '').toLowerCase();
  const uom = txt(row?.uom || row?.UOM || '').toLowerCase();

  if (/inj|injection|vial|amp|syringe/.test(name) || /^(amp|vial|syringe)$/i.test(uom)) return 'Injectable / IV';
  if (/cream|crean|ointment|gel|lotion|paste|tub|tube/.test(name) || /^(tub|tube|gm|g)$/i.test(uom)) return 'Topical';
  if (/eye|ophthalm|otic|ear drop|drop/.test(name)) return 'Eye / Ear / Drop';
  if (/syrup|suspension|solution|oral sol|elixir|mouthwash/.test(name) || /^(bot|bottle)$/i.test(uom)) return 'Liquid / Solution';
  if (/tablet|tab\b|capsule|cap\b|chewable/.test(name) || /^(tab|cap|tablet|capsule)$/i.test(uom)) return 'Oral solid';
  if (/suppository|enema|rectal/.test(name)) return 'Rectal';
  if (/patch/.test(name)) return 'Patch';
  if (/pack|set|pad|gauze|strip/.test(name) || /^(pack|pck|set|pad)$/i.test(uom)) return 'Supply / Other';
  return 'Uncategorized';
}

function getGroupMode() {
  const el = $('groupMode');
  return (el?.value || 'storebin').toLowerCase();
}

function storeBinGroupPrefix(value) {
  const bin = txt(value);
  if (!bin) return 'No StoreBin';

  // Group StoreBin by the first segment before '-' or '/'.
  // Examples:
  //   2-B-15  -> 2
  //   16-A-10 -> 16
  //   16-B-2  -> 16
  //   NH      -> NH
  const m = bin.match(/^([A-Za-z0-9]+)(?:[-/].*)?$/);
  return m ? m[1].toUpperCase() : bin;
}

function getRowStoreBin(row) {
  return txt(row?.storeBin ?? row?.StoreBin ?? row?.storebin ?? '');
}

function getStoreBinFilter() {
  const el = $('storeBinFilter');
  return (el?.value || '').trim();
}

function storeBinFilterLabel(value) {
  if (!value) return 'All StoreBin';
  if (value === '__NO_STOREBIN__') return 'No StoreBin';
  return value;
}

function getExpPageBreakMode() {
  const el = $('expPageBreakMode');
  return (el?.value || 'group').toLowerCase() === 'continue' ? 'continue' : 'group';
}

function expPageBreakLabel(mode) {
  return mode === 'continue' ? 'Continue printing' : 'Page break per group';
}

function rowMatchesStoreBinFilter(row, selected) {
  if (!selected) return true;
  const bin = getRowStoreBin(row);
  if (selected === '__NO_STOREBIN__') return !bin;

  // The selector uses StoreBin prefix, matching popup behavior.
  // Example: selecting 16 shows 16-A-10, 16-B-2, etc.
  return bin.toUpperCase().startsWith(selected.toUpperCase());
}

function buildStoreBinOptions(rows) {
  const prefixes = new Set();
  let hasNoStoreBin = false;

  rows.forEach((row) => {
    const bin = getRowStoreBin(row);
    if (!bin) {
      hasNoStoreBin = true;
      return;
    }
    prefixes.add(storeBinGroupPrefix(bin));
  });

  const priority = ['01','02','03','04','05','06','07','08','09','1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','NH','R1','R2','AD','CS','IV','MS','P','BW','CH'];
  const sorted = [...prefixes].sort((a, b) => {
    const ia = priority.indexOf(String(a).toUpperCase());
    const ib = priority.indexOf(String(b).toUpperCase());
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  });

  return [
    { value: '', label: 'All StoreBin' },
    ...(hasNoStoreBin ? [{ value: '__NO_STOREBIN__', label: 'No StoreBin' }] : []),
    ...sorted.map(v => ({ value: v, label: v })),
  ];
}

function syncStoreBinSelector(rows) {
  const el = $('storeBinFilter');
  if (!el) return;

  const previous = el.value;
  const options = buildStoreBinOptions(rows);
  el.innerHTML = options
    .map(o => `<option value="${escHtml(o.value)}">${escHtml(o.label)}</option>`)
    .join('');

  if (options.some(o => o.value === previous)) {
    el.value = previous;
  } else {
    el.value = '';
  }
}

function groupLabelForRow(row, mode) {
  if (mode === 'category') return deriveExpCategory(row);
  return storeBinGroupPrefix(getRowStoreBin(row));
}

function groupRows(rows, mode) {
  const map = new Map();
  rows.forEach((row) => {
    const key = groupLabelForRow(row, mode);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  });

  const priority = ['No StoreBin', 'Injectable / IV', 'Topical', 'Eye / Ear / Drop', 'Liquid / Solution', 'Oral solid', 'Rectal', 'Patch', 'Supply / Other', 'Uncategorized'];
  return [...map.entries()].sort((a, b) => {
    const ia = priority.indexOf(a[0]);
    const ib = priority.indexOf(b[0]);
    if (ia !== -1 || ib !== -1) return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    return String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true });
  });
}

function expBodyRows(rows) {
  return rows.map((r, idx) => `
    <tr>
      ${td(r.no || idx + 1, 'num nowrap')}
      ${td(r.code, 'nowrap')}
      ${td(r.name)}
      ${td(r.category || deriveExpCategory(r), 'nowrap')}
      ${td(r.storeBin, 'nowrap')}
      ${td(r.qty, 'qty nowrap')}
      ${td(r.uom, 'nowrap')}
      ${td('')}
    </tr>`).join('');
}

function expTable(rows) {
  const body = expBodyRows(rows);
  return `
    <table class="report-table exp-table">
      <thead>
        <tr>
          ${th('No.', 'c-no')}
          ${th('Code', 'c-code')}
          ${th('Name', 'c-name')}
          ${th('Category', 'c-cat')}
          ${th('StoreBin', 'c-bin')}
          ${th('Quality', 'c-qty')}
          ${th('UOM', 'c-uom')}
          ${th('Count note', 'c-note')}
        </tr>
      </thead>
      <tbody>${body || `<tr><td colspan="8" class="center">No EXP data</td></tr>`}</tbody>
    </table>`;
}

function renderExp(payload) {
  const sourceRows = payload.rows || [];
  syncStoreBinSelector(sourceRows);
  const selectedStoreBin = getStoreBinFilter();
  const rows = sourceRows.filter(row => rowMatchesStoreBinFilter(row, selectedStoreBin));
  const meta = payload.meta || {};
  const title = meta.title || `Stock expired checking${meta.stockLocation ? `: ${meta.stockLocation}` : ''}`;
  const stockLocation = meta.stockLocation || meta.floorLabel || '-';
  const date = meta.date || '-';
  const groupMode = getGroupMode();
  const pageBreakMode = getExpPageBreakMode();
  const grouped = groupRows(rows, groupMode);

  setControlTitle('EXP Report', `${rows.length}/${sourceRows.length} rows · ${grouped.length} groups · A4 portrait · ${expPageBreakLabel(pageBreakMode)}`);
  setStatus(`${rows.length}/${sourceRows.length} rows / ${grouped.length} groups`);

  const groupSections = grouped.map(([group, groupRows], index) => `
    <section class="group-section ${index === 0 ? 'first-group' : ''}">
      <div class="section-title group-title">
        <span>${escHtml(groupMode === 'category' ? 'Category' : 'StoreBin group')}: ${escHtml(group)}</span>
        <span>${groupRows.length} item${groupRows.length === 1 ? '' : 's'}</span>
      </div>
      ${expTable(groupRows)}
    </section>`).join('');

  return `
    <section class="report-page exp-report exp-break-${pageBreakMode === 'continue' ? 'continuous' : 'by-group'}">
      <header class="report-header">
        <div>
          <h1 class="report-title">${escHtml(title)}</h1>
          <div class="report-subtitle">Stock Location: ${escHtml(stockLocation)}</div>
        </div>
        <div class="report-meta">
          <div>Date: ${escHtml(date)}</div>
          <div>Group by: ${escHtml(groupMode === 'category' ? 'Category' : 'StoreBin prefix')}</div>
          <div>StoreBin: ${escHtml(storeBinFilterLabel(selectedStoreBin))}</div>
          <div>Print: ${escHtml(expPageBreakLabel(pageBreakMode))}</div>
        </div>
      </header>

      <div class="summary-strip">
        <div class="summary-box"><b>Shown rows</b>${rows.length}/${sourceRows.length}</div>
        <div class="summary-box"><b>Groups</b>${grouped.length}</div>
        <div class="summary-box"><b>StoreBin filter</b>${escHtml(storeBinFilterLabel(selectedStoreBin))}</div>
        <div class="summary-box"><b>Print setup</b>${escHtml(expPageBreakLabel(pageBreakMode))}</div>
      </div>

      ${groupSections || expTable([])}

      <footer class="signature-row">
        <div>Assistant Pharmacist: ........................................</div>
        <div>Pharmacist: ........................................</div>
      </footer>
    </section>`;
}

function adrTable(title, rows, className = '') {
  const body = rows.map((r, idx) => `
    <tr>
      ${td(r.no || idx + 1, 'num nowrap')}
      ${td(r.hn, 'nowrap')}
      ${td(r.patient)}
      ${td(r.desc)}
      ${td(r.allergicTo)}
      ${td(r.type, 'nowrap')}
      ${td(r.status, 'nowrap')}
      ${td(r.createDate, 'nowrap')}
    </tr>`).join('');

  return `
    <section class="group-section ${className}">
      <div class="section-title group-title"><span>${escHtml(title)}</span><span>${rows.length} case${rows.length === 1 ? '' : 's'}</span></div>
      <table class="report-table adr-table">
        <thead>
          <tr>
            ${th('No.', 'c-no')}
            ${th('HN', 'c-hn')}
            ${th('Patient Name', 'c-patient')}
            ${th('Allergy Description', 'c-desc')}
            ${th('Allergic To', 'c-allergic')}
            ${th('Type', 'c-type')}
            ${th('Status', 'c-status')}
            ${th('Create Date', 'c-date')}
          </tr>
        </thead>
        <tbody>${body || `<tr><td colspan="8" class="center">No data</td></tr>`}</tbody>
      </table>
    </section>`;
}

function renderAdr(payload) {
  const rows = payload.rows || [];
  const meta = payload.meta || {};
  const yRows = rows.filter(r => normalizeObserve(r) === 'Y');
  const nRows = rows.filter(r => normalizeObserve(r) !== 'Y');
  const from = meta.from || '-';
  const to = meta.to || '-';

  setControlTitle('ADR Report', `${rows.length} rows · Y ${yRows.length} / N ${nRows.length} · A4 portrait`);
  setStatus(`${rows.length} rows`);

  return `
    <section class="report-page adr-report">
      <header class="report-header">
        <div>
          <h1 class="report-title">${escHtml(meta.title || 'ADR report')}</h1>
          <div class="report-subtitle">${escHtml(meta.reportUnit || 'RT_COMMON_256')} · ${escHtml(from)} to ${escHtml(to)}</div>
        </div>
        <div class="report-meta">
          <div>Total: ${rows.length}</div>
          <div>Observe Y: ${yRows.length} · N/blank: ${nRows.length}</div>
        </div>
      </header>

      <div class="summary-strip">
        <div class="summary-box"><b>Total ADR</b>${rows.length}</div>
        <div class="summary-box"><b>Observe in visit = Y</b>${yRows.length}</div>
        <div class="summary-box"><b>Observe in visit = N/blank</b>${nRows.length}</div>
        <div class="summary-box"><b>Period</b>${escHtml(from)} → ${escHtml(to)}</div>
      </div>

      ${adrTable('Observe in visit = Y', yRows, 'first-group')}
      ${adrTable('Observe in visit = N / blank', nRows)}

      <footer class="signature-row">
        <div>Pharmacist: ........................................</div>
        <div>Date: ........................................</div>
      </footer>
    </section>`;
}

function renderEmpty(message) {
  setControlTitle('Report Print', 'No data loaded');
  setStatus('No data');
  return `
    <section class="empty-state">
      <h1>No report data</h1>
      <p>${escHtml(message || 'Return to popup, load XLS, then click PDF/Print again.')}</p>
    </section>`;
}

function normalizePayload(rawPayload, legacyRows) {
  const urlType = getTypeFromUrl();
  if (rawPayload && Array.isArray(rawPayload.rows)) {
    return {
      type: (rawPayload.type || urlType).toLowerCase(),
      rows: rawPayload.rows,
      meta: rawPayload.meta || {},
    };
  }
  if (Array.isArray(legacyRows)) {
    return { type: urlType, rows: legacyRows, meta: {} };
  }
  return { type: urlType, rows: [], meta: {} };
}

function updateControlVisibility(type) {
  const expControlRow = $('expControlRow');
  if (expControlRow) expControlRow.hidden = type !== 'exp';
}

function renderPayload(payload) {
  const root = $('reportRoot');
  if (!root) return;
  updateControlVisibility(payload.type);

  if (!payload.rows.length) {
    root.innerHTML = renderEmpty('No rows were found in chrome.storage.local. Please regenerate this report from the popup.');
    return;
  }

  if (payload.type === 'adr') {
    root.innerHTML = renderAdr(payload);
  } else if (payload.type === 'exp') {
    root.innerHTML = renderExp(payload);
  } else {
    root.innerHTML = renderEmpty(`Unknown report type: ${payload.type}`);
  }
}

function applyControls() {
  document.body.classList.add('compact');

  $('btnPrint')?.addEventListener('click', () => window.print());
  $('btnReloadData')?.addEventListener('click', () => loadAndRender());
  $('btnCloseControl')?.addEventListener('click', () => {
    const panel = $('printControl');
    if (panel) panel.style.display = 'none';
  });

  $('btnToggleCompact')?.addEventListener('click', () => {
    const isCompact = document.body.classList.toggle('compact');
    $('btnToggleCompact').textContent = `Compact: ${isCompact ? 'ON' : 'OFF'}`;
  });

  $('fontScale')?.addEventListener('input', (e) => {
    const val = Number(e.target.value || 100);
    document.documentElement.style.setProperty('--font-scale', String(val / 100));
    if ($('fontScaleText')) $('fontScaleText').textContent = `${val}%`;
  });

  $('groupMode')?.addEventListener('change', () => {
    if (currentPayload) renderPayload(currentPayload);
  });

  $('storeBinFilter')?.addEventListener('change', () => {
    if (currentPayload) renderPayload(currentPayload);
  });

  $('expPageBreakMode')?.addEventListener('change', () => {
    if (currentPayload) renderPayload(currentPayload);
  });
}

function loadAndRender() {
  chrome.storage.local.get(['reportPrintPayload', 'reportData'], (res) => {
    currentPayload = normalizePayload(res.reportPrintPayload, res.reportData);
    renderPayload(currentPayload);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  applyControls();
  loadAndRender();
});
