/* content-iv-worklist.js — "Add to IV Queue" inside ArcusAir's eMAR.
 *
 * Scope: the eMAR page only (#!/inpatient/emar). The button is injected into
 * the "Edit Administration Timings" dialog, on the same line as the drug name
 * heading — the one moment where ArcusAir has already told us the drug, the
 * frequency AND the exact administration time the ward intends.
 *
 * Everything is read from the open dialog rather than re-fetched, because the
 * dialog is the ward's own edit-in-progress: the time in the picker is what
 * they are about to save, which is exactly the round the bag has to make.
 *
 * The server owns the queue; this only POSTs a candidate row.
 */
(function () {
  'use strict';

  const LOG = '[BKN-IVQ]';
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();

  /* Only on the eMAR route. ArcusAir is a hash-router SPA, so this is checked
     at every injection attempt, not once at load. */
  function isEmarPage() {
    return location.href.includes('/inpatient/emar');
  }

  // ── Reading the dialog ────────────────────────────────────────────────────

  /** The "Edit Administration Timings" dialog, or null. */
  function findDialog() {
    for (const d of document.querySelectorAll('md-dialog')) {
      const label = (d.getAttribute('aria-label') || '') + ' ' + norm(d.textContent).slice(0, 80);
      if (/administration timings/i.test(label)) return d;
    }
    return null;
  }

  /** The <h4> carrying the drug name — our anchor, and the drug itself. */
  function findHeading(dialog) {
    // Structural first (matches #dialogContent_NNN > .layout-column > div:first > h4),
    // then any h4 in the dialog: the generated id changes on every open, so it
    // can never be used as a selector.
    return dialog.querySelector('md-dialog-content .layout-column > div h4') ||
           dialog.querySelector('md-dialog-content h4') ||
           dialog.querySelector('h4');
  }

  /**
   * The administration time the ward is setting.
   *
   * `.tp` time-pickers hold hour and minute in two separate inputs. The dialog
   * shows the CURRENT timing first and the NEW timing second; when a nurse is
   * moving a dose, the last picker is the one that matters, so read that.
   * `.value` is the rendered attribute — read `.value` (live) not
   * getAttribute('value') (initial), or an edited time is missed.
   */
  function readTiming(dialog) {
    const pickers = dialog.querySelectorAll('.tp');
    if (!pickers.length) return null;
    const tp = pickers[pickers.length - 1];
    const hh = tp.querySelector('input.tp_hr');
    const mm = tp.querySelector('input.tp_min');
    if (!hh || !mm) return null;
    const h = String(hh.value || '').padStart(2, '0');
    const m = String(mm.value || '').padStart(2, '0');
    if (!/^\d{2}$/.test(h) || !/^\d{2}$/.test(m)) return null;
    return h + ':' + m;
  }

  /** Drug, frequency and dates, parsed from the dialog's own text. */
  function readOrder(dialog) {
    const h4 = findHeading(dialog);
    const drug = h4 ? norm(h4.textContent) : '';
    const text = norm(dialog.textContent);
    const freq = (/Frequency\s*:\s*([^:]+?)(?:\s+Timings|\s*$)/i.exec(text) || [])[1] || '';
    return { drug, freq: norm(freq) };
  }

  /** Patient from the eMAR banner. Same heuristic hmq uses. */
  function readPatient() {
    const body = document.body ? document.body.innerText : '';
    const hn = (/\b(48-\d{2}-\d{6,7})\b/.exec(body) || [])[1] || '';

    let name = '';
    const h4 = document.querySelector('h4.patientbannername');
    if (h4) {
      const full = norm(h4.textContent);
      const m = /\((48-\d{2}-\d{6,7})\)/.exec(full);
      name = m ? norm(full.slice(0, m.index)) : full;
    }

    /* "Ward 9 / 909" in the banner. The SAME "Ward N / …" shape also precedes
       the attending doctor ("Ward 9 / สยุมพร …, พญ."), and that one comes
       first — so a loose \S+ captures the doctor's name as the room, which is
       what shipped in the first cut. Require a bed-shaped token (2-4 digits, or
       ICU/CCU/NICU + digits) and take the LAST match, which is the bed row. */
    const bedRe = /(Ward\s*\d+|ICU\s*\d*|CCU\s*\d*)\s*\/\s*([0-9]{2,4}|(?:ICU|CCU|NICU)[-\s]?\d{1,3})/ig;
    let m, wr = null;
    while ((m = bedRe.exec(body))) wr = m;
    return {
      hn, name,
      ward: wr ? norm(wr[1]) : '',
      room: wr ? norm(wr[2]) : '',
    };
  }

  // ── Server ────────────────────────────────────────────────────────────────

  async function api(path, opts) {
    if (window.BKNData && window.BKNData.serverFetch) {
      return window.BKNData.serverFetch(path, opts);
    }
    return { ok: false, status: 0, json: null };
  }

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /**
   * Is this dose already queued?
   *
   * Matched on HN + drug + slot for today, not on an order id: the eMAR dialog
   * never exposes the order-item uid, and a pharmacist adding the same bag
   * twice is the exact mistake this guard exists to prevent.
   */
  async function findExisting(pt, drug, slot) {
    const r = await api('/api/iv-worklist?date=' + todayStr());
    if (!r.ok || !Array.isArray(r.json)) return null;
    const key = drug.toLowerCase();
    return r.json.find(row =>
      row.hn === pt.hn &&
      row.slot === slot &&
      key.indexOf(String((row.drug || {}).name || '').toLowerCase()) !== -1) || null;
  }

  async function addCase(payload) {
    return api('/api/iv-worklist/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: todayStr(), rows: [payload] }),
    });
  }

  // ── Button ────────────────────────────────────────────────────────────────

  function toast(msg, kind) {
    let el = document.getElementById('ivq-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ivq-toast';
      document.body.appendChild(el);
    }
    el.className = 'ivq-toast is-' + (kind || 'ok');
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = '0'; }, 4200);
  }

  async function onClick(btn, dialog) {
    const pt = readPatient();
    const ord = readOrder(dialog);
    const slot = readTiming(dialog);

    if (!pt.hn)  return toast('ไม่พบ HN ของผู้ป่วย · No patient HN on this page', 'err');
    if (!ord.drug) return toast('ไม่พบชื่อยา · No drug name in the dialog', 'err');
    if (!slot)   return toast('ไม่พบเวลาให้ยา · No administration time set', 'err');

    btn.disabled = true;
    btn.textContent = '…';
    try {
      const dup = await findExisting(pt, ord.drug, slot);
      if (dup) {
        // Already queued — say what state it is in rather than silently adding
        // a second bag for the same round.
        toast(`มีในคิวแล้ว · Already queued: ${dup.room || ''} ${slot} — ${dup.status}`, 'warn');
        return;
      }

      const res = await addCase({
        patientvisituid: '',                 // eMAR dialog exposes no uid
        orderItemId: `emar:${pt.hn}:${ord.drug}`.slice(0, 120),
        hn: pt.hn, name: pt.name, ward: pt.ward, room: pt.room,
        slot,
        date: todayStr(),
        dueAt: `${todayStr()}T${slot}:00+07:00`,
        drug: {
          name: ord.drug,
          dose: '', solvent: '', route: 'IV', rate: '',
          freq: ord.freq,
          had: false,
          // The SERVER re-resolves stability and HAD from the workbook; these
          // are only a floor so a row is never stored without an expiry basis.
          stabilityHours: 24,
        },
        status: 'ordered',
        note: 'Added from eMAR',
        auditLog: [],
      });

      if (res.ok) toast(`เพิ่มลงคิว IV แล้ว · Added: ${ord.drug} ${slot}`, 'ok');
      else toast('เพิ่มไม่สำเร็จ · Could not add (server ' + res.status + ')', 'err');
    } catch (e) {
      console.log(LOG, 'add failed', e);
      toast('เพิ่มไม่สำเร็จ · Could not add', 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '💉 Add to IV Queue';
    }
  }

  function inject() {
    if (!isEmarPage()) return;
    const dialog = findDialog();
    if (!dialog) return;
    if (dialog.querySelector('.ivq-add-btn')) return;   // already injected

    const h4 = findHeading(dialog);
    if (!h4) return;

    const btn = document.createElement('button');
    btn.type = 'button';                 // inside a <form>: a bare button submits
    btn.className = 'ivq-add-btn';
    btn.textContent = '💉 Add to IV Queue';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      onClick(btn, dialog);
    });

    // Anchor on the same line as the heading: the h4 is a flex child, so the
    // button sits beside it rather than pushing the layout.
    h4.parentNode.style.display = 'flex';
    h4.parentNode.style.alignItems = 'center';
    h4.parentNode.style.gap = '10px';
    h4.insertAdjacentElement('afterend', btn);
  }

  /* Angular tears the dialog down and rebuilds it, so watch rather than run
     once. The observer is debounced and paired with a light poll, matching how
     content-hmr handles the same class of dialog. */
  let _t = null;
  const observer = new MutationObserver(() => {
    clearTimeout(_t);
    _t = setTimeout(inject, 120);
  });
  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  }
  setInterval(inject, 700);
  inject();
})();
