/* page-iv-dashboard.js — history, workload and turnaround.
 *
 * Read-only by design: the board is where work is driven, this is where it is
 * reviewed. Same swap point as the board — `loadRange()` is the only function
 * that knows where rows come from.
 */
(function () {
  'use strict';

  const C = window.IVWorklistCore;
  const DEMO = new URLSearchParams(location.search).get('demo') !== '0';

  const state = { days: 7, rows: [] };
  const $ = id => document.getElementById(id);
  const el = (t, c, x) => {
    const n = document.createElement(t);
    if (c) n.className = c;
    if (x != null) n.textContent = x;
    return n;
  };

  async function loadRange(days) {
    if (DEMO) {
      $('ivd-demo-flag').hidden = false;
      return window.IVDemoData.buildHistory(new Date(), days);
    }
    const to = new Date();
    const from = new Date(to.getTime() - days * 86400e3);
    const q = `from=${from.toISOString().slice(0, 10)}&to=${to.toISOString().slice(0, 10)}`;
    const r = await fetch('/api/iv-worklist/range?' + q);
    if (!r.ok) throw new Error('range ' + r.status);
    return r.json();
  }

  // ── Panels ────────────────────────────────────────────────────────────────

  function renderHeadline(rows) {
    const now = Date.now();
    const s = C.summarise(rows, now);
    const days = state.days || 1;

    // "Prepared" counts doses that actually got made — an order cancelled
    // before mixing consumed no vial and should not inflate the workload.
    const prepared = rows.filter(r => r.preparedAt).length;

    $('ivd-total').textContent  = prepared;
    $('ivd-perday').textContent = Math.round(prepared / days);

    const t = C.median(rows.map(C.turnaroundMinutes).filter(n => n != null));
    $('ivd-turnaround').textContent = t == null ? '—' : t;

    $('ivd-cancelled').textContent = s.cancelled;
    // Wastage: a bag that was mixed and then not used. The number the IV team
    // actually cares about, because each one is a discarded vial.
    $('ivd-wasted').textContent = rows.filter(r =>
      r.preparedAt && (r.status === 'returned' ||
        (r.status === 'cancelled' && r.preparedAt))).length;
    $('ivd-had').textContent = s.had;
  }

  function bars(containerId, labelId, values, labels, fmt) {
    const box = $(containerId);
    const lab = $(labelId);
    box.textContent = '';
    if (lab) lab.textContent = '';
    const max = Math.max(1, ...values);

    values.forEach((v, i) => {
      const b = el('div', 'ivd-bar');
      b.style.height = Math.round((v / max) * 100) + '%';
      b.title = (labels[i] != null ? labels[i] + ': ' : '') + (fmt ? fmt(v) : v);
      box.appendChild(b);
      if (lab) lab.appendChild(el('span', null, labels[i] != null ? labels[i] : ''));
    });
  }

  function renderHours(rows) {
    const load = C.hourlyLoad(rows);
    // Night hours are noise on an IPD board — show the working window.
    const from = 6, to = 23;
    const vals = load.slice(from, to + 1);
    const labs = vals.map((_, i) => {
      const h = from + i;
      return h % 3 === 0 ? String(h).padStart(2, '0') : '';
    });
    bars('ivd-hours', 'ivd-hour-labels', vals, labs, v => v + ' doses');
  }

  function renderDrugs(rows) {
    const m = new Map();
    rows.forEach(r => {
      const n = r.drug && r.drug.name;
      if (!n) return;
      if (!m.has(n)) m.set(n, { n: 0, had: !!(r.drug && r.drug.had) });
      m.get(n).n++;
    });
    const top = [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 10);

    const tb = $('ivd-drugs');
    tb.textContent = '';
    top.forEach(([name, o]) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, name));
      tr.appendChild(el('td', 'num', String(o.n)));
      const had = el('td', 'num');
      if (o.had) had.appendChild(el('span', 'ivw-tag ivw-tag-had', 'HAD'));
      else had.textContent = '—';
      tr.appendChild(had);
      tb.appendChild(tr);
    });
    if (!top.length) tb.appendChild(el('tr')).appendChild(el('td', null, 'No data'));
  }

  function renderWards(rows) {
    const m = new Map();
    rows.forEach(r => m.set(r.ward || '—', (m.get(r.ward || '—') || 0) + 1));
    const total = rows.length || 1;
    const list = [...m.entries()].sort((a, b) => b[1] - a[1]);

    const tb = $('ivd-wards');
    tb.textContent = '';
    list.forEach(([w, n]) => {
      const tr = el('tr');
      tr.appendChild(el('td', null, w));
      tr.appendChild(el('td', 'num', String(n)));
      tr.appendChild(el('td', 'num', Math.round(n / total * 100) + '%'));
      tb.appendChild(tr);
    });
  }

  function renderDaily(rows) {
    const m = new Map();
    rows.forEach(r => { if (r.date) m.set(r.date, (m.get(r.date) || 0) + 1); });
    const days = [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    bars('ivd-daily', 'ivd-daily-labels',
         days.map(d => d[1]),
         days.map(d => d[0].slice(5)),      // MM-DD
         v => v + ' doses');
  }

  function render() {
    renderHeadline(state.rows);
    renderHours(state.rows);
    renderDrugs(state.rows);
    renderWards(state.rows);
    renderDaily(state.rows);
    $('ivd-updated').textContent = 'Updated ' + new Date().toLocaleTimeString();
  }

  async function reload() {
    try {
      state.rows = await loadRange(state.days);
    } catch (e) {
      state.rows = [];
      console.error('[iv-dashboard] load failed', e);
    }
    render();
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('ivd-range').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      [...b.parentNode.children].forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      state.days = Number(b.dataset.days) || 7;
      reload();
    });
    reload();
  });
})();
