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

  /**
   * Patient from the eMAR banner (`.main-banner` / `patient-emr-banner`).
   *
   * Scoped to the banner element rather than scanning document.body: the eMAR
   * page also lists every ordered drug, the attending doctor and a ward column,
   * so a whole-page regex picks up whichever match happens to come first. That
   * is how room once came back as the doctor's name.
   */
  function bannerRoot() {
    return document.querySelector('.main-banner') ||
           document.querySelector('patient-emr-banner') ||
           null;
  }

  /**
   * Candidate texts to mine, most-specific first.
   *
   * Deliberately a LIST, not a single winner. The previous version picked the
   * banner and fell back to the page only when the banner was empty — but
   * .main-banner can hold the patient photo subtree and still return a bit of
   * text, so it never looked "empty", never fell through, and the HN was
   * missed while the console happily reported "banner element found: true".
   * Now every source is tried in turn until one yields the field.
   */
  function textSources() {
    const out = [];
    const push = el => { if (el) { const t = norm(el.textContent); if (t) out.push(t); } };
    push(bannerRoot());
    push(document.querySelector('patient-emr-banner'));
    push(document.querySelector('.sec-banner'));
    // The header strip above the tabs carries HN + ward on the eMAR page.
    document.querySelectorAll('md-content, .full-height').forEach(el => {
      if (out.length < 6) push(el);
    });
    push(document.body);
    return out;
  }

  /** First regex hit across the candidate texts. */
  function findIn(re, group) {
    for (const t of textSources()) {
      const m = re.exec(t);
      re.lastIndex = 0;
      if (m) return m[group || 1];
    }
    return '';
  }

  function readPatient() {
    const hn = findIn(/(\d{2}-\d{2}-\d{6,7})/);

    let name = '';
    const nameEl = document.querySelector('h4.patientbannername') ||
                   document.querySelector('.patientbannername');
    if (nameEl) {
      const full = norm(nameEl.textContent);
      const m = /\((\d{2}-\d{2}-\d{6,7})\)/.exec(full);
      name = m ? norm(full.slice(0, m.index)) : full;
    }
    if (!name && hn) {
      /* "ด.ช. ชนิดนัย พมมะจัก 48-24-006947" — the name precedes the HN.
         Split on the HN and take the tail of the left side, rather than
         building a RegExp from a string: writing '\s' inside a normal string
         collapses to a bare "s", which silently turned the character class
         into [...s] and the separator into "s*". */
      for (const t of textSources()) {
        const i = t.indexOf(hn);
        if (i <= 0) continue;
        const before = t.slice(0, i).trim();
        // Last run of Thai/Latin name characters immediately before the HN.
        /* The banner repeats the romanised name twice before the Thai one
           ("MASTER X MASTER X ด.ช. …"). Prefer the trailing Thai form —
           it is what ward staff read on a label — and fall back to the
           last romanised run only when there is no Thai. */
        const th = /([฀-๿][฀-๿.\s]{2,59})$/.exec(before);
        const la = /([A-Za-z][A-Za-z.\s]{2,59})$/.exec(before);
        const hit = th || la;
        if (hit) { name = norm(hit[1]); break; }
      }
    }

    /* Ward / bed. "Ward N / …" appears twice — once before the attending
       doctor, once before the bed — so require a bed-shaped token and take the
       LAST match in whichever source supplies it. */
    let ward = '', room = '';
    for (const t of textSources()) {
      const re = /(Ward\s*\d+|ICU\s*\d*|CCU\s*\d*|NICU\s*\d*)\s*\/\s*([0-9]{2,4}|(?:ICU|CCU|NICU)[-\s]?\d{1,3})/ig;
      let m, last = null;
      while ((m = re.exec(t))) last = m;
      if (last) { ward = norm(last[1]); room = norm(last[2]); break; }
    }

    return {
      hn, name, ward, room,
      visitNo: findIn(/(I\d{2}-\d{2}-\d{6,7})/),
      age: findIn(/(\d{1,3})\s*Y/i),
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

    if (!pt.hn) {
      // Distinguish "banner missing" from "banner present but unreadable" —
      // the two need different fixes and the old message covered both.
      // Dump what we actually saw, so a failure is diagnosable from the
      // console instead of guessing at selectors.
      const srcs = textSources();
      console.log(LOG, 'no HN. banner found:', !!bannerRoot(),
                  '| text sources:', srcs.length);
      srcs.forEach((t, i) => console.log(LOG, '  [' + i + ']', t.slice(0, 200)));
      return toast(bannerRoot()
        ? 'อ่าน HN ไม่ได้ · Found the banner but could not read the HN — please report this'
        : 'ไม่พบแถบข้อมูลผู้ป่วย · No patient banner on this page', 'err');
    }
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
        visitNo: pt.visitNo, age: pt.age,
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
