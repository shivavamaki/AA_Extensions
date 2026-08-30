/* iv-user.js — who is at the bench.
 *
 * Three sources, in order of trust, matching how the rest of the portal already
 * identifies a person (see hmq/content-hmr `detectUsername()`):
 *
 *   1. a name the user explicitly picked here (sticky, per browser)
 *   2. ArcusAir's own header user menu (.headUserDetBtn) — the logged-in account
 *   3. the portal's /api/auth/me session
 *
 * …and always a free-text box on top, because the person who MIXED a bag is
 * often not the person logged into the workstation. Signing someone else's name
 * by accident is worse than typing your own, so the field is editable, the
 * detected name is only ever a default, and whatever is used gets written into
 * the audit trail verbatim.
 *
 * `preparedBy` and `checkedBy` are deliberately separate selections: the whole
 * point of the second check is that it is a different person.
 */
(function (root) {
  'use strict';

  const LS_PREP  = 'ivw.preparedBy';
  const LS_CHECK = 'ivw.checkedBy';

  const state = {
    staff: [],          // [{name, role}] from rx/iv-staff.json
    preparedBy: '',
    checkedBy: '',
    detected: '',       // ArcusAir / portal session, for the "you are" hint
  };

  /* localStorage can throw outright (private mode, site-data blocked), so every
     read and write is guarded — a workstation with storage off must still work,
     just without remembering the name between reloads. */
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  /** ArcusAir header user menu — the same heuristic hmq/hmr already use. */
  function detectFromArcus() {
    try {
      const el = document.querySelector('.headUserDetBtn span.ng-binding');
      const t = el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
      if (t) return t;
      // Fallback: a span carrying a pharmacist title. Scanned second because it
      // can match a PATIENT whose name happens to carry ภก./ภญ.
      for (const s of document.querySelectorAll('span.ng-binding')) {
        const v = (s.textContent || '').replace(/\s+/g, ' ').trim();
        if (v && v.includes(',') && (v.includes('ภก.') || v.includes('ภญ.'))) return v;
      }
    } catch (_) {}
    return '';
  }

  async function detectFromPortal() {
    try {
      if (root.BKNData && root.BKNData.serverFetch) {
        const r = await root.BKNData.serverFetch('/api/auth/me');
        if (r && r.ok && r.json) return r.json.name || r.json.username || '';
      }
      const r = await fetch('/api/auth/me');
      if (r.ok) { const j = await r.json(); return j.name || j.username || ''; }
    } catch (_) {}
    return '';
  }

  async function loadStaff() {
    try {
      const r = root.BKNData && root.BKNData.serverFetch
        ? await root.BKNData.serverFetch('/api/iv-staff')
        : await fetch('/api/iv-staff');
      const j = r.json !== undefined ? r.json : await r.json();
      if (Array.isArray(j) && j.length) return j;
    } catch (_) {}
    return root.IV_STAFF_FALLBACK || [];
  }

  async function init() {
    state.staff = await loadStaff();
    state.detected = detectFromArcus() || await detectFromPortal();
    // A remembered choice always wins over detection — the person chose it.
    state.preparedBy = lsGet(LS_PREP) || state.detected || '';
    state.checkedBy  = lsGet(LS_CHECK) || '';
    return state;
  }

  function setPreparedBy(v) { state.preparedBy = (v || '').trim(); lsSet(LS_PREP, state.preparedBy); }
  function setCheckedBy(v)  { state.checkedBy  = (v || '').trim(); lsSet(LS_CHECK, state.checkedBy); }

  function pharmacists() { return state.staff.filter(s => /pharmacist/i.test(s.role || '')); }
  function assistants()  { return state.staff.filter(s => /assist/i.test(s.role || '')); }

  /**
   * Can this person sign the second check on that bag?
   * The rule the whole HAD path rests on: not the same person who mixed it.
   */
  function canCheck(preparedBy, checkedBy) {
    const a = (preparedBy || '').trim().toLowerCase();
    const b = (checkedBy || '').trim().toLowerCase();
    if (!b) return { ok: false, why: 'เลือกผู้ตรวจสอบก่อน · Pick who is checking' };
    if (a && a === b) return { ok: false, why: 'ผู้ตรวจสอบต้องคนละคนกับผู้เตรียม · Checker must differ from preparer' };
    return { ok: true, why: '' };
  }

  root.IVUser = {
    state, init,
    setPreparedBy, setCheckedBy,
    pharmacists, assistants, canCheck,
    detectFromArcus,
  };
})(typeof window !== 'undefined' ? window : globalThis);
