/* page-iv-worklist.js — v2 live board.
 *
 * Default view is ward-grouped, rooms in numeric order: that is the order the
 * pharmacy actually works and the porter actually walks. The kanban board is
 * still there behind a toggle for the "what stage is everything at" question.
 *
 * `loadRows()` is the ONLY place that knows where rows come from — point it at
 * GET /api/iv-worklist when the getter lands and delete the demo branch.
 */
(function () {
  'use strict';

  function root_version() { return window.IV_VERSION || null; }

  const C = window.IVWorklistCore;
  const S = window.IVSticker;
  const U = window.IVUser;
  const DEMO = new URLSearchParams(location.search).get('demo') !== '0';

  const state = {
    rows: [],
    view: 'ward',                                   // ward (default) | board
    f: { slots: [], wards: [], drugs: [], statuses: [], q: '' },
    selectedId: null,
    knownIds: new Set(),     // for new-case detection across polls
    filtersOpen: true,
    firstLoad: true,
  };

  const $ = id => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;         // textContent: patient names
    return n;
  };

  // ── Data ──────────────────────────────────────────────────────────────────

  /** The ONLY place that knows where rows come from. Server is the store. */
  async function loadRows() {
    const r = await api('/api/iv-worklist?date=' + todayStr());
    if (!r.ok) throw new Error('worklist ' + r.status);
    return r.json;
  }

  /** Bangkok-local date — the server keys a day's file on the ward's date, so
   *  a UTC-derived string would ask for the wrong file after 17:00 local. */
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* Route through BKNData when the portal's client is present (it knows the
     server URL and carries auth); fall back to a same-origin fetch. */
  async function api(path, opts) {
    if (window.BKNData && window.BKNData.serverFetch) {
      return window.BKNData.serverFetch(path, opts);
    }
    /* Reached only if shared-data-client.js failed to load. This page is served
       from chrome-extension://, so a bare fetch('/api/...') resolves against the
       EXTENSION origin and can never reach the pharmacy server — it 404s and the
       board renders empty, which looks exactly like "no work today". Say so. */
    console.warn('[iv-worklist] BKNData missing — cannot reach the pharmacy server');
    const r = await fetch(path, opts);
    let json = null;
    try { json = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, json };
  }

  // ── Filter chips ──────────────────────────────────────────────────────────

  function chip(label, active, onToggle, extraCls) {
    const b = el('button', 'ivw-chip' + (active ? ' is-on' : '') + (extraCls ? ' ' + extraCls : ''), label);
    b.addEventListener('click', onToggle);
    return b;
  }

  function toggle(arr, v) {
    const i = arr.indexOf(v);
    if (i === -1) arr.push(v); else arr.splice(i, 1);
  }

  function renderFilters() {
    const fc = C.facets(state.rows);

    // Admin time — every slot the master sheet uses, in clock order.
    const slots = $('ivw-f-slots');
    slots.textContent = '';
    fc.slots.forEach(s => slots.appendChild(
      chip(s + ':00', state.f.slots.includes(s),
           () => { toggle(state.f.slots, s); renderFilters(); render(); })));

    const wards = $('ivw-f-wards');
    wards.textContent = '';
    fc.wards.forEach(w => {
      const b = chip(w, state.f.wards.includes(w),
                     () => { toggle(state.f.wards, w); renderFilters(); render(); });
      b.dataset.ward = w;            // active chip wears the ward's own colour
      wards.appendChild(b);
    });

    const drugs = $('ivw-f-drugs');
    drugs.textContent = '';
    fc.drugs.forEach(d => drugs.appendChild(
      chip(d, state.f.drugs.includes(d),
           () => { toggle(state.f.drugs, d); renderFilters(); render(); })));

    const st = $('ivw-f-status');
    st.textContent = '';
    C.FLOW.concat(C.TERMINAL).forEach(s => st.appendChild(
      chip(C.LABEL[s].icon + ' ' + C.LABEL[s].th, state.f.statuses.includes(s),
           () => { toggle(state.f.statuses, s); renderFilters(); render(); },
           'is-' + s)));
  }

  /** Human summary of the active filters — printed on the send report. */
  function filterText() {
    const p = [];
    if (state.f.slots.length)    p.push('เวลา ' + state.f.slots.map(s => s + ':00').join(', '));
    if (state.f.wards.length)    p.push(state.f.wards.join(', '));
    if (state.f.drugs.length)    p.push(state.f.drugs.join(', '));
    if (state.f.statuses.length) p.push(state.f.statuses.map(s => C.LABEL[s].en).join(', '));
    if (state.f.q)               p.push('"' + state.f.q + '"');
    return p.length ? p.join('  ·  ') : 'ทั้งหมด · All';
  }

  // ── User (bench identity) ─────────────────────────────────────────────────

  function fillStaffList() {
    const dl = $('ivw-staff-list');
    if (!dl) return;
    dl.textContent = '';
    (U.state.staff || []).forEach(st => {
      const o = document.createElement('option');
      o.value = st.name;
      o.label = st.role || '';
      dl.appendChild(o);
    });
  }

  function wireUserBoxes() {
    const p = $('ivw-prep-by'), c = $('ivw-check-by');
    p.value = U.state.preparedBy || '';
    c.value = U.state.checkedBy || '';
    // Detected name is a hint, never a lock — the person who mixed the bag is
    // often not the account logged into this workstation.
    if (U.state.detected) p.title = 'ตรวจพบจาก ArcusAir: ' + U.state.detected;
    p.addEventListener('change', () => { U.setPreparedBy(p.value); render(); });
    c.addEventListener('change', () => { U.setCheckedBy(c.value); render(); });
  }

  // ── Progress ──────────────────────────────────────────────────────────────

  function renderProgress(rows, now) {
    const tot = C.progress(rows);
    $('ivw-ptot-num').textContent = tot.done + ' / ' + tot.total;
    $('ivw-ptot-fill').style.width = tot.pct + '%';
    $('ivw-ptot-sub').textContent =
      `ส่งแล้ว ${tot.sent} · ยกเลิก ${tot.cancelled} · คงเหลือ ${tot.outstanding}`;

    const wrap = $('ivw-ward-progress');
    wrap.textContent = '';
    C.groupByWardPatient(rows, now).forEach(g => {
      const all = g.cards.reduce((a, c) => a.concat(c.rows), []);
      const p = C.progress(all);

      const box = el('div', 'ivw-wprog');
      box.dataset.ward = g.ward;
      const head = el('div', 'ivw-wprog-head');
      head.appendChild(el('span', 'ivw-wprog-name', g.ward));
      head.appendChild(el('span', 'ivw-wprog-num', p.done + '/' + p.total));
      box.appendChild(head);

      const bar = el('div', 'ivw-bar');
      const fill = el('div', 'ivw-bar-fill');
      fill.style.width = p.pct + '%';
      if (p.pct === 100) fill.classList.add('is-complete');
      bar.appendChild(fill);
      box.appendChild(bar);

      // Clicking a ward bar filters to that ward — the number and the way to
      // act on it in one place.
      box.addEventListener('click', () => {
        state.f.wards = state.f.wards.length === 1 && state.f.wards[0] === g.ward ? [] : [g.ward];
        renderFilters(); render();
      });
      wrap.appendChild(box);
    });
  }

  // ── New-case alert ────────────────────────────────────────────────────────

  let _newIds = [];

  function announceNew(rows) {
    // First load establishes the baseline; everything is "new" then, and
    // announcing 57 doses would be noise, not a signal.
    if (state.firstLoad) {
      rows.forEach(r => state.knownIds.add(r.id));
      state.firstLoad = false;
      return;
    }
    const fresh = C.newCaseIds(rows, state.knownIds);
    if (!fresh.length) return;
    fresh.forEach(id => state.knownIds.add(id));
    _newIds = fresh;

    const first = rows.find(r => r.id === fresh[0]);
    $('ivw-alert').dataset.kind = 'new';
    $('ivw-alert-show').hidden = false;
    $('ivw-alert-text').textContent = fresh.length === 1 && first
      ? `เคสใหม่ · New: ${first.room} ${first.drug.name} ${first.slot}:00`
      : `เคสใหม่ · ${fresh.length} new doses arrived`;
    $('ivw-alert').hidden = false;
  }

  /** Persistent error strip — reuses the new-case alert row. */
  function setBanner(msg) {
    const box = $('ivw-alert');
    if (!box) return;
    if (!msg) { if (box.dataset.kind === 'err') box.hidden = true; return; }
    box.dataset.kind = 'err';
    box.hidden = false;
    $('ivw-alert-text').textContent = msg;
    $('ivw-alert-show').hidden = true;
  }

  function dismissAlert() { $('ivw-alert').hidden = true; _newIds = []; }

  function showNew() {
    // Jump to the new rows by searching their ids — no special view needed.
    if (!_newIds.length) return dismissAlert();
    const r = state.rows.find(x => x.id === _newIds[0]);
    dismissAlert();
    if (r) openDrawer(r.id);
  }

  // ── Dose row (inside a patient card) ──────────────────────────────────────

  function doseRow(r, now) {
    const exp = C.expiryState(r, now);
    const due = C.dueState(r, now);
    const d = r.drug || {};

    const n = el('div', 'ivw-dose');
    n.tabIndex = 0;
    n.dataset.id = r.id;
    if (exp === 'expired') n.classList.add('is-expired');
    else if (r.priority === 'stat') n.classList.add('is-stat');
    if (r.status === 'sent') n.classList.add('is-done');
    if (r.status === 'cancelled') n.classList.add('is-cancelled');

    const slot = el('span', 'ivw-slot', (r.slot || '--') + ':00');
    if (due === 'late') slot.classList.add('is-late');
    else if (due === 'due') slot.classList.add('is-due');
    n.appendChild(slot);

    const main = el('div', 'ivw-dose-main');
    main.appendChild(el('div', 'ivw-dose-drug', [d.name, d.dose].filter(Boolean).join(' ')));
    // The diluent here is the workbook's own column, so what the board shows and
    // what the sticker prints are the same string.
    main.appendChild(el('div', 'ivw-dose-sub',
      [d.solvent, d.freq].filter(Boolean).join('  ·  ')));
    n.appendChild(main);

    const tags = el('div', 'ivw-tags');
    if (d.had) tags.appendChild(el('span', 'ivw-tag ivw-tag-had', 'HAD'));
    if (exp === 'expired') tags.appendChild(el('span', 'ivw-tag ivw-tag-expired', 'Expired'));
    else if (exp === 'soon') tags.appendChild(el('span', 'ivw-tag ivw-tag-soon', C.relTime(r.expiresAt, now)));
    if (tags.childNodes.length) n.appendChild(tags);

    n.appendChild(el('span', 'ivw-dot is-' + r.status));

    const open = () => openDrawer(r.id);
    n.addEventListener('click', open);
    n.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return n;
  }

  /** One card per patient; every dose for that admission listed inside. */
  function patientCard(c, now) {
    const box = el('div', 'ivw-pcard');
    if (c.expired) box.classList.add('is-expired');

    const head = el('div', 'ivw-pcard-head');
    head.appendChild(el('span', 'ivw-room', c.room || '—'));

    const who = el('div', 'ivw-pcard-who');
    who.appendChild(el('div', 'ivw-pcard-name', c.name || '—'));
    who.appendChild(el('div', 'ivw-pcard-hn', c.hn || ''));
    head.appendChild(who);

    const badges = el('div', 'ivw-pcard-badges');
    if (c.had)  badges.appendChild(el('span', 'ivw-tag ivw-tag-had', 'HAD'));
    if (c.stat) badges.appendChild(el('span', 'ivw-tag ivw-tag-stat', 'STAT'));
    // "3/4" reads as three of four doses done — the card's progress at a glance.
    badges.appendChild(el('span', 'ivw-tag ivw-tag-soon',
      c.done + '/' + c.rows.length));
    head.appendChild(badges);
    box.appendChild(head);

    const doses = el('div', 'ivw-doses');
    c.rows.forEach(r => doses.appendChild(doseRow(r, now)));
    box.appendChild(doses);

    // Whole-patient printing: every bag for this admission on one action.
    box.addEventListener('dblclick', () => S.printIpd(c.rows));
    return box;
  }

  function renderWards(rows, now) {
    const wrap = $('ivw-wardlist');
    wrap.textContent = '';
    const groups = C.groupByWardPatient(rows, now);

    groups.forEach(g => {
      const box = el('div', 'ivw-wardgroup');
      box.dataset.ward = g.ward;              // drives the ward colour

      const h = el('h3');
      h.appendChild(el('span', 'ivw-wardname', '🏥 ' + g.ward));
      h.appendChild(el('span', 'ivw-col-count', g.cards.length + ' pt · ' + g.doses + ' doses'));

      const bar = el('span', 'ivw-wardbar');
      const allRows = g.cards.reduce((a, c) => a.concat(c.rows), []);
      const bLbl = el('button', 'ivw-btn ivw-btn-sm', '🏷 Labels');
      bLbl.addEventListener('click', e => { e.stopPropagation(); S.printIpd(allRows); });
      const bRep = el('button', 'ivw-btn ivw-btn-sm', '🖨 Send sheet');
      bRep.addEventListener('click', e => {
        e.stopPropagation();
        const ready = allRows.filter(r => ['checked', 'sent'].indexOf(r.status) !== -1);
        S.printReport(C.groupByWardRoom(ready.length ? ready : allRows, now),
                      { filterText: g.ward + '  ·  ' + filterText() });
      });
      bar.appendChild(bLbl); bar.appendChild(bRep);
      h.appendChild(bar);
      box.appendChild(h);

      const cards = el('div', 'ivw-wardgroup-cards');
      g.cards.forEach(c => cards.appendChild(patientCard(c, now)));
      box.appendChild(cards);
      wrap.appendChild(box);
    });

    if (!groups.length) wrap.appendChild(el('div', 'ivw-empty', 'ไม่มีรายการ · Nothing matches these filters.'));
  }

  // Kanban card — the secondary "what stage is everything at" view.
  function card(row, now) {
    const exp = C.expiryState(row, now);
    const due = C.dueState(row, now);
    const n = el('div', 'ivw-card');
    n.dataset.ward = row.ward || '';
    if (exp === 'expired') n.classList.add('is-expired');
    else if (row.priority === 'stat') n.classList.add('is-stat');

    const top = el('div', 'ivw-card-top');
    top.appendChild(el('span', 'ivw-room', row.room));
    top.appendChild(el('span', 'ivw-card-drug', row.drug ? row.drug.name : '—'));
    const d = el('span', 'ivw-card-due', (row.slot || '--') + ':00');
    if (due === 'late') d.classList.add('is-late');
    top.appendChild(d);
    n.appendChild(top);

    n.appendChild(el('div', 'ivw-card-sub',
      [row.drug && row.drug.dose, row.drug && row.drug.solvent].filter(Boolean).join(' + ')));
    n.appendChild(el('div', 'ivw-card-pt', row.name));
    n.addEventListener('click', () => openDrawer(row.id));
    return n;
  }

  function renderBoard(rows, now) {
    const board = $('ivw-board');
    board.textContent = '';
    const g = C.groupByStatus(rows, now);

    C.FLOW.forEach(status => {
      const col = el('div', 'ivw-col');
      col.dataset.status = status;
      const head = el('div', 'ivw-col-head');
      head.appendChild(el('span', null, C.LABEL[status].icon));
      head.appendChild(el('span', null, C.LABEL[status].th));
      head.appendChild(el('span', 'ivw-col-count', String(g[status].length)));
      col.appendChild(head);

      const body = el('div', 'ivw-col-body');
      if (!g[status].length) body.appendChild(el('div', 'ivw-empty', '—'));
      else g[status].forEach(r => body.appendChild(card(r, now)));
      col.appendChild(body);
      board.appendChild(col);
    });
  }

  function render() {
    const now = Date.now();
    const rows = C.applyFilters(state.rows, state.f);

    const s = C.summarise(state.rows, now);
    $('ivw-s-expired').textContent = s.expired;
    $('ivw-s-soon').textContent    = s.expiringSoon;
    $('ivw-s-late').textContent    = s.late;
    $('ivw-s-active').textContent  = s.active;
    $('ivw-s-sent').textContent    = s.sent;
    $('ivw-s-had').textContent     = s.had;

    $('ivw-count').textContent = rows.length + ' / ' + state.rows.length + ' doses';
    renderProgress(state.rows, now);
    $('ivw-filter-summary').textContent = filterText();

    $('ivw-wardlist').hidden = state.view !== 'ward';
    $('ivw-board').hidden    = state.view !== 'board';
    if (state.view === 'ward') renderWards(rows, now);
    else renderBoard(rows, now);

    if (state.selectedId) fillDrawer(state.selectedId, now);
  }

  // ── Drawer ────────────────────────────────────────────────────────────────

  function openDrawer(id) {
    state.selectedId = id;
    $('ivw-drawer').classList.add('is-open');
    $('ivw-drawer').setAttribute('aria-hidden', 'false');
    $('ivw-drawer-back').classList.add('is-open');
    fillDrawer(id, Date.now());
  }

  function closeDrawer() {
    state.selectedId = null;
    $('ivw-drawer').classList.remove('is-open');
    $('ivw-drawer').setAttribute('aria-hidden', 'true');
    $('ivw-drawer-back').classList.remove('is-open');
  }

  function fillDrawer(id, now) {
    const r = state.rows.find(x => x.id === id);
    if (!r) return closeDrawer();
    const d = r.drug || {};

    $('ivw-d-drug').textContent = d.name || '—';
    $('ivw-d-id').textContent   = r.id + '  ·  ' + C.LABEL[r.status].en;
    $('ivw-d-pt').textContent   = r.name || '—';
    $('ivw-d-hn').textContent   = r.hn || '—';
    $('ivw-d-room').textContent = (r.ward || '') + '  ·  ' + (r.room || '');
    $('ivw-d-slot').textContent = (r.slot || '--') + ':00';
    $('ivw-d-dose').textContent = d.dose || '—';
    $('ivw-d-solvent').textContent = d.solvent || '—';
    $('ivw-d-freq').textContent = d.freq || '—';
    $('ivw-d-due').textContent  = C.hhmm(r.dueAt) + '  (' + C.relTime(r.dueAt, now) + ')';
    $('ivw-d-prep').textContent = r.preparedAt ? C.hhmm(r.preparedAt) : '—';

    const exp = C.expiryState(r, now);
    $('ivw-d-exp').textContent = r.expiresAt
      ? C.hhmm(r.expiresAt) + '  (' + (exp === 'expired' ? 'EXPIRED' : C.relTime(r.expiresAt, now)) + ')'
      : '—';
    $('ivw-d-by').textContent      = r.preparedBy || '—';
    $('ivw-d-checked').textContent = r.checkedBy || '—';

    // Per-dose signing: default to the header pickers, override per bag.
    const dp = $('ivw-d-prep-by'), dc = $('ivw-d-check-by');
    dp.value = r.preparedBy || U.state.preparedBy || '';
    dc.value = r.checkedBy  || U.state.checkedBy  || '';
    dp.oninput  = () => { r.preparedBy = dp.value.trim(); refreshSignHint(r); };
    dc.oninput  = () => { r.checkedBy  = dc.value.trim(); refreshSignHint(r); };
    // Persist on blur, not per keystroke — one write per correction.
    dp.onchange = () => saveFields(r, { preparedBy: dp.value.trim() });
    dc.onchange = () => saveFields(r, { checkedBy:  dc.value.trim() });
    refreshSignHint(r);

    // Live label preview, scaled down — what will come off the printer. Built
    // from the row, so the printed expiry is always the row's own expiresAt.
    $('ivw-d-sticker').innerHTML = S.buildIpdLabel(r);

    const audit = $('ivw-d-audit');
    audit.textContent = '';
    (r.auditLog || []).forEach(a => {
      const li = el('li');
      li.appendChild(el('time', null, C.hhmm(a.ts)));
      li.appendChild(el('span', null, a.action + (a.user ? ' — ' + a.user : '')));
      audit.appendChild(li);
    });
    if (!audit.childNodes.length) audit.appendChild(el('li', null, 'No activity yet'));

    // Printing stamps the bag first: a label with no preparer and no mix time
    // is useless on a ward, so the click both records and prints.
    $('ivw-d-print-ipd').onclick   = async () => { await stampForPrint(r); S.printIpd([r]); render(); };
    $('ivw-d-print-small').onclick = async () => { await stampForPrint(r); S.printSmall([r]); render(); };

    renderActions(r);
  }

  function refreshSignHint(r) {
    const h = $('ivw-d-signhint');
    if (!h) return;
    const v = U.canCheck(r.preparedBy || U.state.preparedBy, r.checkedBy || U.state.checkedBy);
    h.textContent = v.ok ? '' : v.why;
    h.classList.toggle('is-warn', !v.ok);
  }

  /**
   * Fill in preparer + mix time if the bag has not been stamped yet.
   *
   * Printing a label IS the moment of preparation in practice, so the sticker
   * must never come out blank. Does not advance the status — that stays an
   * explicit action.
   */
  async function stampForPrint(r) {
    if (r.preparedAt) return;                       // already stamped
    // Printing a label IS the moment of preparation, and the printed expiry must
    // be the STORED one — so move the row to `preparing` server-side and print
    // what comes back, rather than inventing a time the server never saw.
    if (!r.preparedBy) r.preparedBy = U.state.preparedBy || '';
    if (r.status === 'ordered') await transition(r.id, 'pending');
    if (r.status === 'pending') await transition(r.id, 'preparing');
  }

  function renderActions(r) {
    const wrap = $('ivw-d-actions');
    const blocked = $('ivw-d-blocked');
    wrap.textContent = '';
    blocked.textContent = '';
    blocked.classList.remove('is-shown');

    (C.NEXT[r.status] || []).forEach(to => {
      const err = C.transitionError(r, to);
      const b = el('button', 'ivw-btn' + (to === 'cancelled' ? '' : ' ivw-btn-primary'),
                   C.LABEL[to].icon + ' ' + C.LABEL[to].en);
      if (err) {
        b.disabled = true;
        b.title = err;
        blocked.textContent = '⚠ ' + err;   // say why, or it's a support call
        blocked.classList.add('is-shown');
      } else {
        b.addEventListener('click', () => transition(r.id, to));
      }
      wrap.appendChild(b);
    });

    if (!wrap.childNodes.length) {
      wrap.appendChild(el('div', 'ivw-empty', 'No further action — ' + C.LABEL[r.status].en));
    }
  }

  /**
   * Status change. Demo mutates locally; against the server this must be a
   * PATCH — the server owns expiresAt, the HAD rule and the auditLog append,
   * and resolves two technicians claiming the same dose.
   */
  /**
   * Request a transition. The SERVER performs it.
   *
   * Every timestamp, `expiresAt`, the HAD rule, the different-checker rule and
   * the audit line are the server's job — it is the only place that sees all
   * workstations, so it is the only place those can be consistent. The client
   * pre-checks purely to grey out a button; it never writes the record.
   */
  async function transition(id, to) {
    const r = state.rows.find(x => x.id === id);
    if (!r) return;

    const res = await api('/api/iv-worklist/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: to,
        date: r.date,
        user: U.state.preparedBy || U.state.detected || 'Unknown',
        preparedBy: r.preparedBy || U.state.preparedBy || '',
        checkedBy:  r.checkedBy  || U.state.checkedBy  || '',
      }),
    });

    if (!res.ok) {
      // 409 carries the clinical reason (HAD needs a check, same person, …),
      // which is exactly what the pharmacist needs to see.
      const msg = (res.json && res.json.error) || ('HTTP ' + res.status);
      alert(msg);
      return;
    }
    Object.assign(r, res.json);
    render();
  }

  /** Persist a hand-typed correction (preparer, checker, note). */
  async function saveFields(r, fields) {
    const res = await api('/api/iv-worklist/' + encodeURIComponent(r.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: r.date, fields }),
    });
    if (res.ok && res.json) Object.assign(r, res.json);
  }

  // ── Send report (all wards currently in view) ──────────────────────────────

  function printSendReport() {
    const now = Date.now();
    let rows = C.applyFilters(state.rows, state.f);
    // The sheet is a delivery record: only what is actually going out on this
    // round belongs on it, so drop what is still being made or already gone.
    rows = rows.filter(r => ['checked', 'sent'].indexOf(r.status) !== -1);
    const groups = C.groupByWardRoom(rows, now);
    if (!groups.length) {
      alert('ไม่มีรายการพร้อมส่ง · Nothing is ready to send under these filters.');
      return;
    }
    S.printReport(groups, { filterText: filterText() });
  }

  // ── Wiring ────────────────────────────────────────────────────────────────

  function tickClock() {
    const d = new Date();
    $('ivw-clock').textContent = String(d.getHours()).padStart(2, '0') + ':' +
                                 String(d.getMinutes()).padStart(2, '0');
  }

  async function reload() {
    try {
      state.rows = await loadRows();
      setBanner('');
    } catch (e) {
      state.rows = [];
      console.error('[iv-worklist] load failed', e);
      // An empty board and an unreachable server look identical on screen.
      // Never let a connection failure masquerade as "nothing to prepare".
      setBanner(window.BKNData
        ? 'ต่อ Server ไม่ได้ · Cannot reach the pharmacy server — check it is running.'
        : 'โหลดไม่ครบ · shared-data-client.js did not load; reload the extension.');
    }
    announceNew(state.rows);
    renderFilters();
    render();
  }

  function toggleFilters(open) {
    state.filtersOpen = open === undefined ? !state.filtersOpen : open;
    $('ivw-filters').classList.toggle('is-collapsed', !state.filtersOpen);
    $('ivw-filters-toggle').setAttribute('aria-expanded', String(state.filtersOpen));
  }

  document.addEventListener('DOMContentLoaded', async function () {
    const v = root_version();
    if (v) $('ivw-ver').textContent = v.label;

    await U.init();
    fillStaffList();
    wireUserBoxes();

    $('ivw-filters-toggle').addEventListener('click', () => toggleFilters());
    $('ivw-alert-x').addEventListener('click', dismissAlert);
    $('ivw-alert-show').addEventListener('click', showNew);

    $('ivw-view').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      [...b.parentNode.children].forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      state.view = b.dataset.view;
      render();
    });

    $('ivw-search').addEventListener('input', e => { state.f.q = e.target.value; render(); });
    $('ivw-clear').addEventListener('click', () => {
      state.f = { slots: [], wards: [], drugs: [], statuses: [], q: '' };
      $('ivw-search').value = '';
      renderFilters(); render();
    });
    $('ivw-refresh').addEventListener('click', reload);
    $('ivw-print-report').addEventListener('click', printSendReport);
    $('ivw-d-close').addEventListener('click', closeDrawer);
    $('ivw-drawer-back').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });

    tickClock();
    setInterval(tickClock, 10e3);
    // Expiry and lateness are time-derived: a board left open must age itself.
    setInterval(render, 30e3);

    reload();
  });
})();
