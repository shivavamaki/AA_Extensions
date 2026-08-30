/* iv-demo-data.js — v2. Rows derived from the real IV_ATB_Master 2026 sheet.
 *
 * Rooms, wards, drugs, doses, diluents, frequencies, the q-hour administration
 * slots and the ward remarks all come from the master CSV, so the board
 * behaves like the real worklist: 38 standing orders across 8 wards, Rocephin
 * and Cef-3 dominant, most doses landing on the 14:00 round.
 *
 * HNs and patient names are SYNTHETIC. The master sheet holds real patients and
 * none of that is reproduced here.
 *
 * DELETE THIS FILE when the ArcusAir getter lands.
 *
 * Row tuple: [room, ward, hn, name, drug, dose, unit, solvent, freq, times[], remark]
 */
(function (root) {
  'use strict';

  const MASTER = [
    ["506","Ward 5","48-16-091149","MRS. SOMYING JAIDEE","Cefazolin","1","g","NSS 50 ml","q 6 hrs",["00", "06", "12", "18"],"D/C"],
    ["603","Ward 6","48-18-037093","MR. PRASIT WONGCHAN","Rocephin","2","g","NSS 100 ml","q 24 hrs",["22"],"D/C"],
    ["517","Ward 5","48-19-058983","MISS NARISA THONGDEE","Cefazolin","1","g","NSS 50 mL","q 6 hrs",["00", "06", "12", "18"],"off RT 2"],
    ["606","Ward 6","48-25-096167","MR. ANUCHA SRIWAN","Rocephin","2","g","NSS 100 ml","q 24 hrs",["18"],"D/C"],
    ["821","Ward 8","48-15-084805","MRS. WANNA PHOMMA","Rocephin","2","g","NSS 100 ml","q 24 hrs",["22"],"D/C"],
    ["808","Ward 8","48-25-033091","MR. SOMCHAI RATTANA","Rocephin","2","g","NSS 100 ml","q 24 hrs",["22"],"D/C"],
    ["905","Ward 9","48-21-014848","MRS. PENSRI KAEWMANI","Cef-3","1600","mg","SWI 16 ml","q 24 hrs",["14"],"D/C"],
    ["611","Ward 6","48-25-069071","MR. THANAKORN BOONMEE","Rocephin","2","g","NSS 100 ml","q 24 hrs",["14"],"D/C"],
    ["610","Ward 6","48-25-038077","MISS SUDARAT INTHA","Cef-3","2000","mg","NSS 100 ml","q 24 hrs",["12"],"OFF"],
    ["922","Ward 9","48-21-040738","MR. WICHAI SAETANG","Rocephin","2000","mg","SWI 20 ml","q 24 hrs",["14"],""],
    ["402","Ward 4","48-26-016475","MRS. MALEE CHAROEN","Rocephin","2000","mg","SWI 20 ml","q 24 hrs",["06"],""],
    ["806","Ward 8","48-22-097572","MR. NIRAN PANYA","Rocephin","2","g","NSS 100 ml","q 24 hrs",["10"],""],
    ["823","Ward 8","48-19-036570","MRS. SUPHAN KLINCHAN","Rocephin","2","g","NSS 100 ml","q 24 hrs",["10"],""],
    ["803","Ward 8","48-19-060470","MR. BOONMA THEPWONG","Rocephin","2","g","NSS 100 ml","q 24 hrs",["14"],""],
    ["921","Ward 9","48-23-048047","MISS KANOKWAN SRISA","Cef-3","2000","mg","SWI 20 ml","q 24 hrs",["10"],""],
    ["908","Ward 9","48-26-065480","MR. PICHAI MANEE","Cef-3","2000","mg","SWI 20 ml","q 24 hrs",["14"],""],
    ["409","Ward 4","48-18-073902","MRS. ORAPHAN DEJKUL","Cef-3","1600","mg","SWI 16 ml","q 24 hrs",["14"],""],
    ["418","Ward 4","48-25-065161","MR. SAKSIT PROMMA","Cef-3","1500","mg","SWI 15 ml","q 24 hrs",["14"],""],
    ["422","Ward 4","48-26-076460","MISS RATTIYA CHAIYA","Cef-3","1000","mg","SWI 10 ml","q 24 hrs",["12"],""],
    ["506","Ward 5","48-24-012691","MR. WORAWUT SINTHU","Pip/Tazo","4.5","g","NSS 50 ml","q 8 hrs",["06", "14", "22"],""],
    ["506","Ward 5","48-16-022149","MRS. SOMYING JAIDEE","Amikacin","500","mg","NSS 100 ml","q 24 hrs",["14"],""],
    ["511","Ward 5","48-22-084734","MR. PRASIT WONGCHAN","Cefazolin","1","g","NSS 50 ml","q 6 hrs",["00", "12", "18"],"one day st 6.00 >> LD 24.00"],
    ["607","Ward 6","48-23-094858","MISS NARISA THONGDEE","Pip/Tazo","4.5","g","NSS 100 mL","q 6 hrs",["00", "06", "12", "18"],"pip/tazo 10-14d LD 29/8 12?. - 2/9 12?."],
    ["708","Ward 7","48-19-005343","MR. ANUCHA SRIWAN","Cef-3","1600","mg","SWI 16 ml","q 24 hrs",["14"],""],
    ["715","Ward 7","48-26-089411","MRS. WANNA PHOMMA","Rocephin","2000","mg","SWI 20 ml","q 24 hrs",["14"],""],
    ["722","Ward 7","48-19-009014","MR. SOMCHAI RATTANA","Cef-3","1000","mg","SWI 10 ml","q 24 hrs",["14"],""],
    ["818","Ward 8","48-17-087809","MRS. PENSRI KAEWMANI","Rocephin","2","g","NSS 100 ml","q 24 hrs",["18"],""],
    ["822","Ward 8","48-22-070538","MR. THANAKORN BOONMEE","Rocephin","2","g","NSS 100 ml","q 24 hrs",["06"],""],
    ["902","Ward 9","48-21-092097","MISS SUDARAT INTHA","Cef-3","1000","mg","SWI 10 ml","q 24 hrs",["14"],""],
    ["906","Ward 9","48-23-096589","MR. WICHAI SAETANG","Cef-3","1000","mg","SWI 10 ml","q 24 hrs",["12"],""],
    ["909","Ward 9","48-26-023683","MRS. MALEE CHAROEN","Rocephin","1000","mg","SWI 10 ml","q 24 hrs",["14"],""],
    ["912","Ward 9","48-19-062415","MR. NIRAN PANYA","Cef-3","900","mg","SWI 9 ml","q 24 hrs",["14"],""],
    ["CCU03","CCU","48-17-018774","MRS. SUPHAN KLINCHAN","Meronem","2","g","NSS 100 mL","q 8 hrs",["06", "14", "22"],""],
    ["ICU01","ICU","48-19-010734","MR. BOONMA THEPWONG","Meropenem","0.5","g","NSS 100 mL","q 24 hrs",["18"],""],
    ["ICU03","ICU","48-26-065634","MISS KANOKWAN SRISA","Meronem","1","g","NSS 50 ml","q 8 hrs",["02", "10", "18"],""],
    ["ICU05","ICU","48-15-072247","MR. PICHAI MANEE","Meropenem","1","g","NSS 50 ml","q 8 hrs",["06", "14", "22"],""],
    ["ICU07","ICU","48-24-094353","MRS. ORAPHAN DEJKUL","Cef-3","2","g","NSS 100 ml","q 24 hrs",["06"],""],
    ["705","Ward 7","48-15-062117","MR. SAKSIT PROMMA","Cef-3","2000","mg","SWI 20 ml","q 24 hrs",["14"],""],  ];

  /* Stability, diluent, HAD and "who prepares it" now come from the real
   * workbook (iv-drug-db.js), not a hand-written table. IV_ATB_Master 2026.xlsx
   * is the pharmacy's own master, so it is the authority. */
  const DB = () => root.IVDrugDB;

  const STAFF = ['Apsorn', 'Akira', 'Cha', 'Ket', 'Waram', 'Nattaya'];
  const SLOTS = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];

  // Deterministic: the board looks the same on every reload, so a screenshot in
  // a review still matches what the reviewer opens.
  let _seed = 20260830;
  function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
  const pick = a => a[Math.floor(rnd() * a.length)];
  const iso = ms => new Date(ms).toISOString();
  const pad = n => String(n).padStart(2, '0');

  /** One row per DOSE — a q6h order on the master sheet becomes 4 board rows. */
  function build(now) {
    const base = now instanceof Date ? new Date(now) : new Date();
    const y = base.getFullYear(), mo = base.getMonth(), da = base.getDate();
    const nowMs = base.getTime();
    const dateStr = `${y}-${pad(mo + 1)}-${pad(da)}`;
    const rows = [];
    let seq = 1;

    MASTER.forEach(m => {
      const [room, ward, hn, name, drug, dose, unit, solvent, freq, times, remark] = m;
      const db = DB();
      // The sheet marks 14 drugs "วอร์ดเตรียมเองจ้า" — the ward mixes those, so
      // they are not pharmacy work and never reach this board.
      if (db && !db.isPharmacyIV(drug)) return;
      const info = {
        hours:   db ? db.stabilityHours(drug) : 24,
        had:     db ? db.isHad(drug) : false,
        diluent: db ? db.diluent(drug) : '',
        storage: 'Keep in Room Temp.',
        rate:    '',
      };

      times.forEach(hh => {
        const dueMs = new Date(y, mo, da, Number(hh), 0, 0).getTime();
        const mins = (dueMs - nowMs) / 60000;

        // Status follows the clock, so the board reads like a real mid-shift:
        // long past = sent, near = in the hood, ahead = still queued.
        let status;
        if (mins < -150)     status = 'sent';
        else if (mins < -45) status = rnd() < 0.15 ? 'preparing' : 'sent';
        else if (mins < 30)  status = pick(['preparing', 'checked', 'checked']);
        else if (mins < 150) status = rnd() < 0.35 ? 'pending' : 'ordered';
        else                 status = 'ordered';

        // The sheet's own ward remarks drive the cancellations.
        if (/^(d\/c|off)/i.test(remark || '') && mins > 60 && rnd() < 0.5) status = 'cancelled';

        const r = {
          id: `IV-${y}${pad(mo + 1)}${pad(da)}-${String(seq++).padStart(4, '0')}`,
          date: dateStr,
          status,
          // Stable per PATIENT, not per dose — every dose for one admission
          // shares these, which is what groups them onto a single card.
          patientuid: 'demo' + hn.replace(/\D/g, '').padStart(20, '0'),
          patientvisituid: 'demov' + hn.replace(/\D/g, '').padStart(19, '0'),
          hn, name, ward, room,
          slot: hh,                       // planned administration round
          drug: {
            name: drug,
            dose: dose + ' ' + unit,
            solvent: info.diluent || solvent, route: 'IV',
            rate: info.rate, freq,
            had: info.had,
            stabilityHours: info.hours,
            storage: info.storage,
          },
          dueAt: iso(dueMs),
          acceptedAt: null, preparedAt: null, expiresAt: null,
          checkedAt: null, sentAt: null,
          preparedBy: null, checkedBy: null, sentBy: null,
          priority: info.had ? 'urgent' : (rnd() < 0.08 ? 'stat' : 'routine'),
          note: remark || '',
          auditLog: [],
        };

        const who = pick(STAFF);
        const at = min => iso(dueMs + min * 60000);
        const log = (min, user, action) => r.auditLog.push({ ts: at(min), user, action });
        const reached = s =>
          root.IVWorklistCore.FLOW.indexOf(status) >= root.IVWorklistCore.FLOW.indexOf(s);

        if (reached('pending')) { r.acceptedAt = at(-70); log(-70, who, 'Accepted into worklist'); }
        if (reached('preparing')) {
          r.preparedBy = who;
          r.preparedAt = at(-45);
          r.expiresAt = root.IVWorklistCore.computeExpiry(r.preparedAt, info.hours);
          log(-45, who, 'Started preparing');
        }
        if (reached('checked')) {
          r.checkedBy = pick(STAFF.filter(s => s !== who)) || 'Ket';
          r.checkedAt = at(-25);
          log(-25, r.checkedBy, 'Checked (second person)');
        }
        if (reached('sent')) {
          r.sentBy = 'Porter'; r.sentAt = at(-12);
          log(-12, 'Porter', 'Sent to ward');
        }
        if (status === 'cancelled') log(-90, who, 'Cancelled — ' + (r.note || 'order stopped'));

        rows.push(r);
      });
    });

    // One expired bag, so the safety path is visible on the demo board.
    const victim = rows.find(r => r.status === 'preparing' && r.drug.stabilityHours <= 4);
    if (victim) {
      victim.preparedAt = iso(nowMs - 6 * 3600e3);
      victim.expiresAt = root.IVWorklistCore.computeExpiry(victim.preparedAt, victim.drug.stabilityHours);
      victim.note = victim.note || 'Ward did not collect — check before discarding';
    }
    return rows;
  }

  function buildHistory(now, days) {
    const t0 = (now instanceof Date ? now : new Date()).getTime();
    const out = [];
    for (let d = days; d >= 1; d--) {
      build(new Date(t0 - d * 86400e3)).forEach(r => {
        if (['ordered', 'pending', 'preparing', 'checked'].indexOf(r.status) !== -1) {
          r.status = rnd() < 0.06 ? 'cancelled' : 'sent';
          if (r.status === 'sent' && !r.sentAt) r.sentAt = r.dueAt;
        }
        out.push(r);
      });
    }
    return out;
  }

  root.IVDemoData = { build, buildHistory, MASTER, STAFF, SLOTS };
})(typeof window !== 'undefined' ? window : globalThis);
