/* page-iv-presets.js — edit the IV preparation presets.
 *
 * One entry PER ARCUS ITEM CODE, not per drug. Rocephin 1 g and Rocephin 2 g
 * share the nickname "Rocephin" but are separate presets, because strength and
 * pack size change what you mix them in.
 *
 * Each entry carries an ordered list of RULES. The first match wins, so a
 * narrow dose band placed above a catch-all is honoured — which is the only way
 * to express "ceftriaxone 1500 mg is SWI 15 mL for a child but NSS 100 mL for
 * an adult". One flat value per drug cannot say that.
 *
 * Reads/writes data/rx/iv-prep-db.json through the existing rx collection route
 * (GET open, PUT admin/editor only).
 */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const state = { db: null, original: null, filter: 'all', q: '', expanded: new Set() };

  /* Must go through BKNData: served from chrome-extension://, where a bare
     fetch('/api/...') resolves against the extension origin, not the server. */
  async function api(path, opts) {
    if (window.BKNData && window.BKNData.serverFetch) {
      return window.BKNData.serverFetch(path, opts);
    }
    const r = await fetch(path, opts);
    let json = null;
    try { json = await r.json(); } catch (_) {}
    return { ok: r.ok, status: r.status, json };
  }

  const el = (t, c, txt) => {
    const n = document.createElement(t);
    if (c) n.className = c;
    if (txt != null) n.textContent = txt;
    return n;
  };

  async function load() {
    const r = await api('/api/iv-prep-db');
    if (!r.ok || !r.json || !Array.isArray(r.json.items)) {
      msg('โหลดข้อมูลไม่ได้ · Could not load the preset database', 'err');
      return;
    }
    state.db = r.json;
    state.original = JSON.parse(JSON.stringify(r.json));
    render();
  }

  // ── Filtering ─────────────────────────────────────────────────────────────

  function visible() {
    const q = state.q.trim().toLowerCase();
    return (state.db.items || []).filter(it => {
      if (state.filter === 'pharm' && it.wardPrepares) return false;
      if (state.filter === 'had' && !it.had) return false;
      if (state.filter === 'nodil' && (it.rules || []).some(r => r.diluent)) return false;
      if (!q) return true;
      return [it.nickname, it.code, it.itemName, it.note]
        .join(' ').toLowerCase().indexOf(q) !== -1;
    });
  }

  function diluentOptions() {
    const set = new Set();
    (state.db.items || []).forEach(it =>
      (it.rules || []).forEach(r => { if (r.diluent) set.add(r.diluent); }));
    ['NSS 50 mL', 'NSS 100 mL', 'NSS 250 mL', 'SWI 10 mL', 'SWI 15 mL',
     'SWI 20 mL', 'SWI', 'D-5-W'].forEach(v => set.add(v));
    return [...set].filter(Boolean).sort();
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  function input(value, cls, ph, on) {
    const i = el('input', 'ivp-in' + (cls ? ' ' + cls : ''));
    i.value = value == null ? '' : value;
    if (ph) i.placeholder = ph;
    i.addEventListener('input', () => on(i.value));
    return i;
  }

  function num(value, ph, on) {
    const i = input(value, 'num', ph, v => {
      const n = parseFloat(v);
      on(isFinite(n) && n >= 0 ? n : null);
    });
    i.inputMode = 'decimal';
    return i;
  }

  /** One rule row: when · dose range · diluent. */
  function ruleRow(it, r, idx) {
    const row = el('div', 'rule');

    const when = el('select', 'ivp-in');
    [['adult', 'ผู้ใหญ่ · Adult'], ['child', 'เด็ก · Child'], ['any', 'ทุกคน · Any']]
      .forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = v; o.textContent = t;
        if ((r.when || 'any') === v) o.selected = true;
        when.appendChild(o);
      });
    when.addEventListener('change', () => { r.when = when.value; touched(); });
    row.appendChild(when);

    row.appendChild(num(r.minMg, 'ต่ำสุด mg', v => { r.minMg = v; touched(); }));
    row.appendChild(el('span', 'rule-dash', '–'));
    row.appendChild(num(r.maxMg, 'สูงสุด mg', v => { r.maxMg = v; touched(); }));

    const dil = el('input', 'ivp-in dil');
    dil.setAttribute('list', 'dil-list');
    dil.value = r.diluent || '';
    dil.placeholder = 'ตัวทำละลาย · diluent';
    dil.addEventListener('input', () => { r.diluent = dil.value.trim(); touched(); });
    row.appendChild(dil);

    // Order matters — first match wins — so the pharmacy must be able to move a
    // narrow rule above a catch-all.
    const up = el('button', 'mini', '↑');
    up.title = 'ย้ายขึ้น · move up (earlier rules win)';
    up.disabled = idx === 0;
    up.addEventListener('click', () => {
      const a = it.rules;
      [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]];
      touched(); render();
    });
    row.appendChild(up);

    const del = el('button', 'mini danger', '✕');
    del.title = 'ลบกฎนี้ · remove rule';
    del.addEventListener('click', () => {
      it.rules.splice(idx, 1); touched(); render();
    });
    row.appendChild(del);

    return row;
  }

  function render() {
    let dl = $('dil-list');
    if (!dl) { dl = el('datalist'); dl.id = 'dil-list'; document.body.appendChild(dl); }
    dl.textContent = '';
    diluentOptions().forEach(v => {
      const o = document.createElement('option'); o.value = v; dl.appendChild(o);
    });

    const host = $('rows');
    host.textContent = '';
    const items = visible();

    items.forEach(it => {
      const key = it.code || it.nickname;
      const card = el('div', 'item');
      if (it.wardPrepares) card.classList.add('is-ward');
      if (isDirty(it)) card.classList.add('is-dirty');

      // Header: nickname (shared) + the code and item name (unique).
      const head = el('div', 'item-head');
      const left = el('div');
      const nm = el('div', 'item-nick', it.nickname);
      if (it.had) nm.appendChild(el('span', 'badge had', 'HAD'));
      if (it.wardPrepares) nm.appendChild(el('span', 'badge ward', 'ward mixes'));
      left.appendChild(nm);
      left.appendChild(el('div', 'item-code',
        (it.code ? it.code + '  ' : '— ไม่มีรหัส — ') + (it.itemName || '')));
      head.appendChild(left);

      const meta = el('div', 'item-meta');
      meta.appendChild(field('อายุ (วัน)', num(it.shelfDays, 'วัน', v => {
        it.shelfDays = v; it.stabilityHours = v ? v * 24 : null; touched();
      })));
      meta.appendChild(field('mg/mL', num(it.concMgPerMl, '', v => { it.concMgPerMl = v; touched(); })));
      meta.appendChild(field('ความถี่', input(it.defaultFreq, 'freq', 'q ? hrs',
        v => { it.defaultFreq = v.trim(); touched(); })));
      meta.appendChild(check('HAD', it.had, v => {
        it.had = v; it.type = v ? 'HAD' : 'ATB'; touched(); render();
      }));
      meta.appendChild(check('วอร์ดผสม', it.wardPrepares, v => {
        it.wardPrepares = v; touched(); render();
      }));
      head.appendChild(meta);
      card.appendChild(head);

      // Rules
      const rules = el('div', 'rules');
      it.rules = it.rules || [];
      if (!it.rules.length) {
        rules.appendChild(el('div', 'rules-empty',
          'ยังไม่มีกฎ — กด “เพิ่มกฎ” · No rules yet — add one'));
      }
      it.rules.forEach((r, i) => rules.appendChild(ruleRow(it, r, i)));

      const add = el('button', 'ivw-btn ivw-btn-sm', '+ เพิ่มกฎ · Add rule');
      add.addEventListener('click', () => {
        it.rules.push({ when: 'adult', minMg: null, maxMg: null, diluent: '' });
        touched(); render();
      });
      rules.appendChild(add);
      card.appendChild(rules);

      host.appendChild(card);
    });

    $('count').textContent = items.length + ' / ' + (state.db.items || []).length + ' รายการ';
    updateDirty();
  }

  function field(label, control) {
    const w = el('label', 'f');
    w.appendChild(el('span', 'f-l', label));
    w.appendChild(control);
    return w;
  }

  function check(label, value, on) {
    const w = el('label', 'f f-check');
    const i = el('input');
    i.type = 'checkbox';
    i.checked = !!value;
    i.addEventListener('change', () => on(i.checked));
    w.appendChild(i);
    w.appendChild(el('span', 'f-l', label));
    return w;
  }

  // ── Dirty tracking ────────────────────────────────────────────────────────

  function origOf(it) {
    return (state.original.items || []).find(x =>
      (x.code && x.code === it.code) || (!x.code && x.nickname === it.nickname));
  }
  function pick(it) {
    return {
      r: (it.rules || []).map(r => [r.when, r.minMg, r.maxMg, r.diluent]),
      s: it.shelfDays, k: it.concMgPerMl, f: it.defaultFreq || '',
      h: !!it.had, w: !!it.wardPrepares,
    };
  }
  function isDirty(it) {
    const o = origOf(it);
    return !o || JSON.stringify(pick(it)) !== JSON.stringify(pick(o));
  }
  function dirtyList() { return (state.db.items || []).filter(isDirty); }
  function touched() { updateDirty(); }
  function updateDirty() {
    const n = dirtyList().length;
    $('dirty').textContent = n
      ? (n + ' รายการที่แก้ไข · ' + n + ' changed')
      : 'ไม่มีการแก้ไข · no changes';
    $('save').disabled = n === 0;
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function save() {
    const changed = dirtyList();
    if (!changed.length) return;
    state.db._meta = state.db._meta || {};
    state.db._meta.lastEdited = new Date().toISOString();

    msg('กำลังบันทึก… · Saving…', '');
    const r = await api('/api/iv-prep-db', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state.db),
    });
    if (r.ok) {
      state.original = JSON.parse(JSON.stringify(state.db));
      msg('บันทึกแล้ว ' + changed.length + ' รายการ · Saved', 'ok');
      render();
    } else if (r.status === 401 || r.status === 403) {
      msg('ต้องเข้าสู่ระบบเป็น admin/editor ก่อน · Sign in as admin or editor to save', 'err');
    } else {
      msg('บันทึกไม่สำเร็จ (' + r.status + ') · Save failed', 'err');
    }
  }

  function msg(text, kind) {
    const m = $('msg');
    m.textContent = text;
    m.className = 'ivp-msg' + (kind ? ' ' + kind : '');
    if (kind === 'ok') setTimeout(() => { m.textContent = ''; }, 4000);
  }

  document.addEventListener('DOMContentLoaded', function () {
    $('q').addEventListener('input', e => { state.q = e.target.value; render(); });
    $('filter').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      [...b.parentNode.children].forEach(x => x.classList.remove('is-active'));
      b.classList.add('is-active');
      state.filter = b.dataset.f;
      render();
    });
    $('save').addEventListener('click', save);
    $('revert').addEventListener('click', () => {
      if (!dirtyList().length) return;
      state.db = JSON.parse(JSON.stringify(state.original));
      msg('ยกเลิกการแก้ไขแล้ว · Changes discarded', '');
      render();
    });
    window.addEventListener('beforeunload', e => {
      if (dirtyList().length) { e.preventDefault(); e.returnValue = ''; }
    });
    load();
  });
})();
