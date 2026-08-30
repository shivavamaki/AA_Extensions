/* iv-version.js — feature version + offline staff fallback.
 *
 * ALPHA. 0.0.1 is deliberate: the board runs against real data but the
 * ArcusAir getter is not written yet, so nothing here should be trusted as the
 * system of record. The banner in the header says so on every screen — a
 * pharmacist must never mistake this for the live queue.
 */
(function (root) {
  'use strict';

  root.IV_VERSION = {
    version: '0.0.1',
    stage: 'alpha',
    label: 'v0.0.1 alpha',
    built: '2026-08-30',
  };

  /* Mirror of rx/iv-staff.json, used only when the server is unreachable so the
     name pickers are never empty. The server copy is authoritative. */
  root.IV_STAFF_FALLBACK = [
    { name: "Akira", role: "Pharmacist" },
    { name: "Apsorn", role: "Pharmacist" },
    { name: "Cha", role: "Pharmacist" },
    { name: "Ket", role: "Pharmacist" },
    { name: "JOHN", role: "Pharmacist" },
    { name: "Waram", role: "Pharmacist" },
    { name: "Nattaya", role: "Pharmacist" },
    { name: "Narudee", role: "Phar.Assist" },
    { name: "Chayaporn", role: "Pharmacist" },
    { name: "Oum", role: "Pharmacist" },
    { name: "Phatt", role: "Pharmacist" },
    { name: "Piyathida", role: "Pharmacist" },
    { name: "Tunyaporn", role: "Pharmacist" },
    { name: "Metawee", role: "Pharmacist" },
    { name: "Siwawoot", role: "Pharmacist" },
    { name: "Sucheera", role: "Pharmacist" },
    { name: "Wannaporn", role: "Pharmacist" },
    { name: "Ananya", role: "Pharmacist" },
    { name: "Chanapa", role: "Pharmacist" },
    { name: "Nongnapas", role: "Pharmacist" },
    { name: "Paraporn", role: "Pharmacist" },
    { name: "Rattiyakorn", role: "Phar.Assist" },
    { name: "Thantita", role: "Pharmacist" },
    { name: "Onamon", role: "Phar.Assist" },
    { name: "Tussanee", role: "Phar.Assist" },
    { name: "Punyaporn", role: "Pharmacist" },
    { name: "Arunya", role: "Phar.Assist" },
    { name: "Patcharee", role: "Pharmacist" },
    { name: "Pijarin", role: "Pharmacist" },
    { name: "Tanit", role: "Pharmacist" },
    { name: "Arisara", role: "Phar.Assist" },
    { name: "Rattanan", role: "Phar.Assist" },
    { name: "Wanika", role: "Phar.Assist" },
    { name: "Pornsiri", role: "Phar.Assist" },
    { name: "Pitsanu", role: "Phar.Assist" },
    { name: "DUSADEE", role: "Phar.Assist" },
    { name: "Siriporn", role: "Phar.Assist" },
    { name: "Paninee", role: "Pharmacist" }
  ];
})(typeof window !== 'undefined' ? window : globalThis);
