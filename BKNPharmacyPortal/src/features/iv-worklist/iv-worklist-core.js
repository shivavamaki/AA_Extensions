/* iv-worklist-core.js — pure logic for the IV Worklist.
 *
 * No DOM, no fetch, no chrome.* — so the status machine can be unit-tested and
 * reused later by the ArcusAir content script. Everything here is a pure
 * function of its arguments plus an injected `now`, never `Date.now()` read
 * ambiently: the board re-renders on a timer and tests need a fixed clock.
 */
(function (root) {
  'use strict';

  // ── Status machine ────────────────────────────────────────────────────────
  // Ordered: the board's columns render in this sequence.
  const FLOW = ['ordered', 'pending', 'preparing', 'checked', 'sent'];
  const TERMINAL = ['cancelled', 'returned'];

  const NEXT = {
    ordered:   ['pending', 'cancelled'],
    pending:   ['preparing', 'cancelled'],
    preparing: ['checked', 'sent', 'cancelled'],
    checked:   ['sent', 'cancelled'],
    sent:      ['returned'],
    cancelled: [],
    returned:  [],
  };

  const LABEL = {
    ordered:   { th: 'สั่งแล้ว',    en: 'Ordered',   icon: '📥' },
    pending:   { th: 'รอเตรียม',    en: 'Pending',   icon: '⏳' },
    preparing: { th: 'กำลังเตรียม', en: 'Preparing', icon: '🧪' },
    checked:   { th: 'ตรวจสอบแล้ว', en: 'Checked',   icon: '✅' },
    sent:      { th: 'ส่งแล้ว',     en: 'Sent',      icon: '🚚' },
    cancelled: { th: 'ยกเลิก',      en: 'Cancelled', icon: '✖' },
    returned:  { th: 'ส่งคืน',      en: 'Returned',  icon: '↩' },
  };

  /** Can `from` legally become `to`? */
  function canTransition(from, to) {
    return Array.isArray(NEXT[from]) && NEXT[from].indexOf(to) !== -1;
  }

  /**
   * Why a transition is refused, or '' if allowed.
   *
   * The HAD rule lives here AND on the server. Here it disables the button;
   * there it is enforced. A stale script must never be able to skip the
   * second check on a high-alert drug.
   */
  function transitionError(row, to) {
    if (!row) return 'No record';
    const from = row.status;
    if (from === to) return '';
    if (!canTransition(from, to)) {
      return `Cannot go ${LABEL[from]?.en || from} → ${LABEL[to]?.en || to}`;
    }
    if (to === 'sent' && from === 'preparing' && row.drug && row.drug.had) {
      return 'High-alert drug — needs a second-person check first';
    }
    return '';
  }

  // ── Stability clock ───────────────────────────────────────────────────────

  /**
   * expiresAt for a bag mixed at `preparedAt`.
   *
   * Computed once server-side at the `preparing` transition and then stored —
   * clients only ever compare the stored value to now. Recomputing per render
   * would let two workstations with different clock skew disagree about
   * whether a bag is still good.
   */
  function computeExpiry(preparedAtISO, stabilityHours) {
    if (!preparedAtISO || !(stabilityHours > 0)) return null;
    const t = new Date(preparedAtISO).getTime();
    if (!isFinite(t)) return null;
    return new Date(t + stabilityHours * 3600e3).toISOString();
  }

  const URGENT_MS = 30 * 60e3;   // "expiring soon" window

  /**
   * Expiry state for the badge: 'none' | 'ok' | 'soon' | 'expired'.
   * Only meaningful once a bag exists (preparing onward, not once sent).
   */
  function expiryState(row, now) {
    if (!row || !row.expiresAt) return 'none';
    if (row.status === 'cancelled' || row.status === 'sent') return 'none';
    const left = new Date(row.expiresAt).getTime() - now;
    if (!isFinite(left)) return 'none';
    if (left <= 0) return 'expired';
    if (left <= URGENT_MS) return 'soon';
    return 'ok';
  }

  /** Lateness against the ward's due time: 'none' | 'due' | 'late'. */
  function dueState(row, now) {
    if (!row || !row.dueAt) return 'none';
    if (['sent', 'cancelled', 'returned'].indexOf(row.status) !== -1) return 'none';
    const left = new Date(row.dueAt).getTime() - now;
    if (!isFinite(left)) return 'none';
    if (left <= 0) return 'late';
    if (left <= URGENT_MS) return 'due';
    return 'none';
  }

  /** "in 25 min" / "12 min ago" — compact, for badges. */
  function relTime(iso, now) {
    if (!iso) return '';
    const d = new Date(iso).getTime() - now;
    if (!isFinite(d)) return '';
    const past = d < 0;
    let m = Math.round(Math.abs(d) / 60e3);
    let s;
    if (m < 1) s = 'now';
    else if (m < 60) s = m + ' min';
    else {
      const h = Math.floor(m / 60);
      const rm = m % 60;
      s = rm ? `${h} h ${rm} min` : `${h} h`;
    }
    if (s === 'now') return 'now';
    return past ? s + ' ago' : 'in ' + s;
  }

  function hhmm(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (!isFinite(d.getTime())) return '—';
    return String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0');
  }

  // ── Sorting & grouping ────────────────────────────────────────────────────

  const PRIORITY_RANK = { stat: 0, urgent: 1, routine: 2 };

  /**
   * Board order: what must be dealt with first, first.
   *   expired bags → STAT → due time → priority
   * An expired bag sorts to the very top even though nothing can be done with
   * it but discard: it is blocking a dose that still has to be re-made.
   */
  function compareRows(a, b, now) {
    const ax = expiryState(a, now) === 'expired' ? 0 : 1;
    const bx = expiryState(b, now) === 'expired' ? 0 : 1;
    if (ax !== bx) return ax - bx;

    const ap = PRIORITY_RANK[a.priority] ?? 2;
    const bp = PRIORITY_RANK[b.priority] ?? 2;
    if (ap !== bp) return ap - bp;

    const at = new Date(a.dueAt || 0).getTime();
    const bt = new Date(b.dueAt || 0).getTime();
    if (at !== bt) return at - bt;

    return String(a.id).localeCompare(String(b.id));
  }

  function sortRows(rows, now) {
    return rows.slice().sort((a, b) => compareRows(a, b, now));
  }

  /** Rows bucketed by status, each bucket sorted. Drives the board columns. */
  function groupByStatus(rows, now) {
    const out = {};
    FLOW.concat(TERMINAL).forEach(s => { out[s] = []; });
    (rows || []).forEach(r => { (out[r.status] = out[r.status] || []).push(r); });
    Object.keys(out).forEach(k => { out[k] = sortRows(out[k], now); });
    return out;
  }

  function groupByWard(rows, now) {
    const m = new Map();
    (rows || []).forEach(r => {
      const w = r.ward || 'Unassigned';
      if (!m.has(w)) m.set(w, []);
      m.get(w).push(r);
    });
    return [...m.entries()]
      .map(([ward, rs]) => ({ ward, rows: sortRows(rs, now) }))
      .sort((a, b) => a.ward.localeCompare(b.ward));
  }

  // ── Aggregates for the dashboard ──────────────────────────────────────────

  function summarise(rows, now) {
    const s = {
      total: rows.length,
      ordered: 0, pending: 0, preparing: 0, checked: 0, sent: 0,
      cancelled: 0, returned: 0,
      expired: 0, expiringSoon: 0, late: 0, had: 0, stat: 0,
    };
    rows.forEach(r => {
      if (s[r.status] !== undefined) s[r.status]++;
      const e = expiryState(r, now);
      if (e === 'expired') s.expired++;
      else if (e === 'soon') s.expiringSoon++;
      if (dueState(r, now) === 'late') s.late++;
      if (r.drug && r.drug.had) s.had++;
      if (r.priority === 'stat') s.stat++;
    });
    s.active = s.pending + s.preparing + s.checked;
    return s;
  }

  /** Minutes from accepted→sent, for the turnaround stat. */
  function turnaroundMinutes(row) {
    if (!row || !row.sentAt) return null;
    const start = row.acceptedAt || row.preparedAt;
    if (!start) return null;
    const d = new Date(row.sentAt).getTime() - new Date(start).getTime();
    return isFinite(d) && d >= 0 ? Math.round(d / 60e3) : null;
  }

  function median(ns) {
    const a = ns.filter(n => typeof n === 'number' && isFinite(n)).sort((x, y) => x - y);
    if (!a.length) return null;
    const mid = a.length >> 1;
    return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
  }

  /** Doses per hour-of-day — the workload histogram. */
  function hourlyLoad(rows) {
    const buckets = new Array(24).fill(0);
    rows.forEach(r => {
      const t = new Date(r.dueAt || r.createdAt || 0);
      if (isFinite(t.getTime())) buckets[t.getHours()]++;
    });
    return buckets;
  }


  // ── Room / ward ordering ──────────────────────────────────────────────────

  /**
   * Rooms sort numerically, not lexically: "902" must follow "708", and plain
   * string compare puts "1002" before "902". ICU/CCU carry a letter prefix, so
   * split it and compare prefix first, then the number.
   */
  function compareRoom(a, b) {
    const parse = r => {
      const m = String(r || '').match(/^([A-Za-z]*)(\d*)/);
      return { p: (m && m[1] || '').toUpperCase(), n: m && m[2] ? parseInt(m[2], 10) : 0 };
    };
    const x = parse(a), y = parse(b);
    if (x.p !== y.p) return x.p.localeCompare(y.p);
    if (x.n !== y.n) return x.n - y.n;
    return String(a).localeCompare(String(b));
  }

  /** Ward order for the board: numbered wards ascending, then ICU/CCU. */
  function compareWard(a, b) {
    const rank = w => (/^ward/i.test(w) ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const na = (a.match(/\d+/) || [])[0], nb = (b.match(/\d+/) || [])[0];
    if (na && nb) return Number(na) - Number(nb);
    return a.localeCompare(b);
  }

  /** Ward groups, rooms in numeric order — the default board view. */
  function groupByWardRoom(rows, now) {
    const m = new Map();
    (rows || []).forEach(r => {
      const w = r.ward || 'Unassigned';
      if (!m.has(w)) m.set(w, []);
      m.get(w).push(r);
    });
    return [...m.entries()]
      .map(([ward, rs]) => ({
        ward,
        rows: rs.slice().sort((a, b) => {
          // Expired first even here — it is blocking a dose that must be re-made.
          const ax = expiryState(a, now) === 'expired' ? 0 : 1;
          const bx = expiryState(b, now) === 'expired' ? 0 : 1;
          if (ax !== bx) return ax - bx;
          const c = compareRoom(a.room, b.room);
          if (c) return c;
          return String(a.slot || '').localeCompare(String(b.slot || ''));
        }),
      }))
      .sort((a, b) => compareWard(a.ward, b.ward));
  }

  /**
   * The four board filters, applied together (AND).
   * `f` = { slots:[], wards:[], drugs:[], statuses:[], q:'' }
   */
  function applyFilters(rows, f) {
    f = f || {};
    const has = a => Array.isArray(a) && a.length;
    const q = (f.q || '').trim().toLowerCase();
    return (rows || []).filter(r => {
      if (has(f.slots)    && f.slots.indexOf(r.slot) === -1) return false;
      if (has(f.wards)    && f.wards.indexOf(r.ward) === -1) return false;
      if (has(f.drugs)    && f.drugs.indexOf(r.drug && r.drug.name) === -1) return false;
      if (has(f.statuses) && f.statuses.indexOf(r.status) === -1) return false;
      if (q) {
        const hay = [r.hn, r.name, r.room, r.ward, r.drug && r.drug.name]
          .filter(Boolean).join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /** Distinct values for populating the filter chips. */
  function facets(rows) {
    const s = { slots: new Set(), wards: new Set(), drugs: new Set() };
    (rows || []).forEach(r => {
      if (r.slot) s.slots.add(r.slot);
      if (r.ward) s.wards.add(r.ward);
      if (r.drug && r.drug.name) s.drugs.add(r.drug.name);
    });
    return {
      slots: [...s.slots].sort(),
      wards: [...s.wards].sort(compareWard),
      drugs: [...s.drugs].sort(),
    };
  }


  // ── Patient cards ─────────────────────────────────────────────────────────

  /**
   * One card per PATIENT, many dose rows inside.
   *
   * A q6h order is still four separate doses — each has its own bag, its own
   * stability clock and its own status — but the pharmacist works patient by
   * patient, so the card is the patient and the rows are the doses. Grouping
   * key is patientvisituid (falling back to HN), never the name.
   */
  function groupByPatient(rows, now) {
    const m = new Map();
    (rows || []).forEach(r => {
      const k = r.patientvisituid || r.hn || r.name;
      if (!m.has(k)) {
        m.set(k, {
          key: k, hn: r.hn, name: r.name, ward: r.ward, room: r.room,
          patientuid: r.patientuid, patientvisituid: r.patientvisituid,
          rows: [],
        });
      }
      m.get(k).rows.push(r);
    });

    const cards = [...m.values()];
    cards.forEach(c => {
      // Inside a card: chronological by round, then drug — that is the order
      // the doses are actually made in.
      c.rows.sort((a, b) => {
        const s = String(a.slot || '').localeCompare(String(b.slot || ''));
        if (s) return s;
        return String(a.drug && a.drug.name).localeCompare(String(b.drug && b.drug.name));
      });
      // Card-level flags drive the header badges.
      c.expired  = c.rows.some(r => expiryState(r, now) === 'expired');
      c.late     = c.rows.some(r => dueState(r, now) === 'late');
      c.had      = c.rows.some(r => r.drug && r.drug.had);
      c.stat     = c.rows.some(r => r.priority === 'stat');
      c.pending  = c.rows.filter(r => ['ordered', 'pending', 'preparing', 'checked'].indexOf(r.status) !== -1).length;
      c.done     = c.rows.filter(r => r.status === 'sent').length;
      c.nextSlot = (c.rows.find(r => ['ordered', 'pending', 'preparing', 'checked'].indexOf(r.status) !== -1) || {}).slot || '';
    });
    return cards;
  }

  /** Ward groups → patient cards, rooms in numeric order. The default view. */
  function groupByWardPatient(rows, now) {
    const byWard = new Map();
    groupByPatient(rows, now).forEach(c => {
      const w = c.ward || 'Unassigned';
      if (!byWard.has(w)) byWard.set(w, []);
      byWard.get(w).push(c);
    });
    return [...byWard.entries()]
      .map(([ward, cards]) => ({
        ward,
        cards: cards.sort((a, b) => {
          if (a.expired !== b.expired) return a.expired ? -1 : 1;
          return compareRoom(a.room, b.room);
        }),
        doses: cards.reduce((n, c) => n + c.rows.length, 0),
      }))
      .sort((a, b) => compareWard(a.ward, b.ward));
  }


  // ── Progress ──────────────────────────────────────────────────────────────

  /**
   * Completion for a set of doses.
   *
   * "Done" counts sent AND cancelled: a cancelled dose is resolved work — it
   * will never be made — so leaving it in the denominator would park every ward
   * short of 100% for the rest of the shift. `outstanding` is what is actually
   * left to do, which is the number the bench cares about.
   */
  function progress(rows) {
    const total = rows.length;
    let sent = 0, cancelled = 0, active = 0;
    rows.forEach(r => {
      if (r.status === 'sent') sent++;
      else if (r.status === 'cancelled' || r.status === 'returned') cancelled++;
      else active++;
    });
    const done = sent + cancelled;
    return {
      total, sent, cancelled, outstanding: active,
      done,
      pct: total ? Math.round((done / total) * 100) : 0,
      // Sent-only percentage, for when the question is "how much did we make".
      pctSent: total ? Math.round((sent / total) * 100) : 0,
    };
  }

  // ── New-case detection ────────────────────────────────────────────────────

  /**
   * Ids in `rows` that were not in `knownIds`.
   *
   * The board polls, and an order raised on the ward mid-shift must announce
   * itself rather than quietly appearing 40 rows down. Compares ids only — a
   * status change on a row already seen is not a new case.
   */
  function newCaseIds(rows, knownIds) {
    const seen = knownIds instanceof Set ? knownIds : new Set(knownIds || []);
    const out = [];
    (rows || []).forEach(r => { if (r && r.id && !seen.has(r.id)) out.push(r.id); });
    return out;
  }

  const api = {
    FLOW, TERMINAL, NEXT, LABEL, PRIORITY_RANK, URGENT_MS,
    canTransition, transitionError,
    computeExpiry, expiryState, dueState,
    relTime, hhmm,
    compareRows, sortRows, groupByStatus, groupByWard,
    compareRoom, compareWard, groupByWardRoom, applyFilters, facets,
    groupByPatient, groupByWardPatient, progress, newCaseIds,
    summarise, turnaroundMinutes, median, hourlyLoad,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.IVWorklistCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
