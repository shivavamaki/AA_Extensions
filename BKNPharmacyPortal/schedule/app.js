/* No per-month night or weekend caps — set to Infinity so canAssign never
   blocks on those soft limits. Only hard rules apply (canNight / canWeekend,
   role matrix, max consecutive nights, max work streak). */
const NO_CAP = Infinity;

const statusProfiles = {
  general: {
    label: "General Pharmacy",
    targetFactor: 1,
    canNight: true,
    canWeekend: true,
    maxNight: NO_CAP,
    maxWeekend: NO_CAP,
    shiftPreference: ["Clinic", "OPD", "IPD", "Night", "Floor2", "Special"],
    description: "Can fill all required operational shifts except Office. Special is allowed only by admin manual assignment."
  },
  clinical: {
    label: "Clinical Pharmacy",
    targetFactor: 1,
    canNight: true,
    canWeekend: true,
    maxNight: NO_CAP,
    maxWeekend: NO_CAP,
    shiftPreference: ["Clinic", "Night"],
    description: "Must fill Clinic shifts first. If C1/C2 are already filled that day, can cover other shifts (Night and weekend allowed)."
  },
  hod: {
    label: "HOD",
    targetFactor: 0,
    canNight: false,
    canWeekend: false,
    maxNight: NO_CAP,
    maxWeekend: NO_CAP,
    shiftPreference: ["Office", "Special"],
    description: "Can only fill Office and Special shifts; excluded from common required shift allocation."
  },
  deputy: {
    label: "Deputy",
    targetFactor: 0.85,
    canNight: false,
    canWeekend: true,
    maxNight: NO_CAP,
    maxWeekend: NO_CAP,
    shiftPreference: ["Office", "OPD", "IPD", "Clinic", "Floor2"],
    description: "Default office shift 08:00-16:00. Can cover other non-night shifts only if manpower is not enough."
  },
  parttime: {
    label: "Part time",
    targetFactor: 0.45,
    canNight: false,
    canWeekend: true,
    maxNight: NO_CAP,
    maxWeekend: NO_CAP,
    shiftPreference: ["OPD", "IPD", "Clinic", "Floor2"],
    description: "Can be allocated only on self-booked available days. Not allowed: Office, Night, Special."
  }
};

const initialPharmacists = [
  { id: "P01", name: "เกษราภรณ์", target: 168, status: "hod", skills: ["D", "M", "H"] },
  { id: "P02", name: "อัปสร", target: 202, status: "general", skills: ["D", "M", "H", "V"] },
  { id: "P03", name: "ปิยะธิดา", target: 205, status: "general", skills: ["D", "M", "O", "V"] },
  { id: "P04", name: "ภัทรานิษฐ์", target: 202, status: "clinical", skills: ["D", "O", "H", "Che"] },
  { id: "P05", name: "สุจีรา", target: 202, status: "general", skills: ["D", "M", "V"] },
  { id: "P06", name: "อลิสาร์", target: 205, status: "general", skills: ["D", "O", "H", "V"] },
  { id: "P07", name: "ชนนาถ", target: 201, status: "general", skills: ["D", "M", "O", "V"] },
  { id: "P08", name: "ปัทมพร", target: 201, status: "deputy", skills: ["D", "O", "V"] },
  { id: "P09", name: "เบญศ์", target: 202, status: "general", skills: ["D", "O", "H"] },
  { id: "P10", name: "ปุณยพร", target: 202, status: "general", skills: ["D", "M", "V"] },
  { id: "P11", name: "เปรมวนันท์", target: 202, status: "clinical", skills: ["D", "O", "H"] },
  { id: "P12", name: "เมราวี", target: 201, status: "general", skills: ["D", "M", "O"] },
  { id: "P13", name: "พิจารณ", target: 201, status: "general", skills: ["D", "O", "V"] },
  { id: "P14", name: "ศิราวุธ", target: 204, status: "general", skills: ["C2", "O"] },
  { id: "P15", name: "อนัญญา", target: 202, status: "general", skills: ["C1", "D", "M"] },
  { id: "P16", name: "นาตยา", target: 203, status: "general", skills: ["C1", "D", "O"] },
  { id: "P17", name: "ชนนวา", target: 203, status: "general", skills: ["C1", "D", "O"] },
  { id: "P18", name: "ธัญนิตา", target: 204, status: "general", skills: ["C1", "D", "O"] },
  { id: "P19", name: "อุดมชัย", target: 201, status: "general", skills: ["C2", "D", "O"] },
  { id: "P20", name: "ภาณนี", target: 201, status: "parttime", skills: ["C2", "D", "V"] }
];

let shiftTemplates = {
  OFF: { label: "OFF", hours: 0, type: "OFF", dayGroup: "system", system: true },
  REQ_OFF: { label: "REQ OFF", hours: 0, type: "OFF", dayGroup: "system", system: true },
  PT_AVAILABLE: { label: "PT Available", hours: 0, type: "available", dayGroup: "system", system: true },
  "C1": { label: "C1", hours: 9, type: "Clinic", dayGroup: "both" },
  "C2": { label: "C2", hours: 9, type: "Clinic", dayGroup: "both" },
  "8-16 Office": { label: "8-16 Office", hours: 8, type: "Office", dayGroup: "weekday", optional: true },
  "9-18IV": { label: "9-18IV", hours: 9, type: "IPD", dayGroup: "both" },
  "7-15I": { label: "7-15I", hours: 8, type: "IPD", dayGroup: "both" },
  "10-20HM": { label: "10-20HM", hours: 10, type: "IPD", dayGroup: "both" },
  "8-16HM": { label: "8-16HM", hours: 8, type: "IPD", dayGroup: "weekend" },
  "9-17D": { label: "9-17D", hours: 8, type: "IPD", dayGroup: "both" },
  "11-21I": { label: "11-21I", hours: 10, type: "IPD", dayGroup: "both" },
  "7-15O": { label: "7-15O", hours: 8, type: "OPD", dayGroup: "weekday" },
  "7-16O": { label: "7-16O", hours: 9, type: "OPD", dayGroup: "weekend" },
  "10-20M": { label: "10-20M", hours: 10, type: "OPD", dayGroup: "both" },
  "9-18O": { label: "9-18O", hours: 9, type: "OPD", dayGroup: "both" },
  "20-7O": { label: "20-7O", hours: 11, type: "Night", dayGroup: "both" },
  "20-7I": { label: "20-7I", hours: 11, type: "Night", dayGroup: "both" },
  "9-20F2": { label: "9-20F2", hours: 11, type: "Floor2", dayGroup: "both" },
  "9-16CHE": { label: "9-16CHE", hours: 7, type: "Special", dayGroup: "both", special: true, optional: true },
  "T": { label: "T", hours: 8, type: "Special", dayGroup: "both", special: true, optional: true }
};

/* dateMeta is rebuilt whenever the selected month changes */
const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function buildDateMeta(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  return Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(y, m - 1, i + 1);
    const dow = DOW_NAMES[d.getDay()];
    return { day: i + 1, dow, weekend: dow === "Sat" || dow === "Sun", saturday: dow === "Sat", sunday: dow === "Sun" };
  });
}
let dateMeta = buildDateMeta(typeof currentMonthKey !== "undefined" ? currentMonthKey : "2026-06");

const SHIFT_TYPE_OPTIONS = ["Clinic", "Office", "IPD", "OPD", "Night", "Floor2", "OFF", "Special"];
const SHIFT_DAY_GROUP_OPTIONS = ["weekday", "weekend", "both"];

function isOperationalShiftCode(code) {
  const normalized = normalizeShift(code);
  return !["OFF", "REQ_OFF", "PT_AVAILABLE"].includes(normalized) && !!shiftTemplates[normalized];
}

function shiftAllowedOnDay(code, date) {
  const shift = shiftTemplates[normalizeShift(code)];
  if (!shift || shift.system) return false;
  if (shift.dayGroup === "both") return true;
  if (date.weekend) return shift.dayGroup === "weekend";
  return shift.dayGroup === "weekday";
}

function getCoverageShiftsForDay(date) {
  const weekdayRequired = ["C1", "C2", "7-15O", "9-18O", "10-20M", "9-18IV", "7-15I", "10-20HM", "9-17D", "11-21I", "9-20F2", "20-7O", "20-7I"];
  const required = date.weekend
    ? weekdayRequired.map((s) => (s === "7-15O" ? "7-16O" : s))
    : weekdayRequired;
  const optional = date.weekend ? [] : ["8-16 Office"];
  const available = Object.keys(shiftTemplates).filter((code) => {
    const shift = shiftTemplates[normalizeShift(code)];
    return isOperationalShiftCode(code) && shiftAllowedOnDay(code, date) && !shift.special;
  });
  const preferred = [...required, ...optional];
  return [...preferred.filter((code) => available.includes(normalizeShift(code))), ...available.filter((code) => !preferred.includes(code))];
}

function getRequiredCoverageShiftsForDay(date) {
  return getCoverageShiftsForDay(date).filter((code) => {
    const shift = shiftTemplates[normalizeShift(code)];
    return shift && !shift.optional && !shift.special && !["Office", "OFF", "Special"].includes(shift.type);
  });
}


let staff = structuredClone(initialPharmacists);
let requests = {};
let parttimeAvailability = {};
let viewMode = "auto";
let activeTab = "setupTab";
let lastSchedule = {};
let lastResult = { rows: [], violations: [], fairnessScore: 0 };
let adminOverrides = {};
let editingCell = null;
let selectedShiftCode = null;
let allocationRun = 0;
let allocationStarted = false;
let reqOffLocked = false;
let isDirty = false;
let lockedDays = new Set();
/* bookingNotes[personId][dayIndex] = "preferred shift / reason text" */
let bookingNotes = {};
const STORAGE_KEY_BASE = "pharmacyScheduleStateV5_BOOKING";
const BOOKING_STORAGE_KEY = "pharmacyMonthlyBookingsV1";
const SCHEDULE_MONTH_STORAGE_KEY = "pharmacyScheduleSelectedMonthV1";
function _currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
let SCHEDULE_MONTH_KEY = localStorage.getItem(SCHEDULE_MONTH_STORAGE_KEY) || _currentMonthKey();
/* Month-scoped storage key so each month has its own saved schedule */
function storageKey() { return `${STORAGE_KEY_BASE}_${SCHEDULE_MONTH_KEY}`; }
/* Re-sync dateMeta in case stored month differs from initial default */
dateMeta = buildDateMeta(SCHEDULE_MONTH_KEY);

const $ = (id) => document.getElementById(id);

function normalizeShift(code) {
  if (!code || code === "OFF") return "OFF";
  if (code === "REQ_OFF" || code === "PT_AVAILABLE") return code;
  const raw = String(code).trim();
  if (shiftTemplates[raw]) return raw;
  const compact = raw.replace(/[\s()]/g, "").toUpperCase();
  const aliases = {
    "8-17C1": "C1",
    "10-19C2": "C2",
    "7-15O": "7-15O",
    "7-16O": "7-16O",
    "9-18O": "9-18O",
    "9-18V": "9-18O",
    "10-20M": "10-20M",
    "9-18IV": "9-18IV",
    "7-15I": "7-15I",
    "10-20HM": "10-20HM",
    "8-16HM": "8-16HM",
    "9-17D": "9-17D",
    "11-21I": "11-21I",
    "20-7O": "20-7O",
    "20-7I": "20-7I",
    "9-20F2": "9-20F2",
    "9-16CHE": "9-16CHE",
    "T": "T"
  };
  if (aliases[compact]) return aliases[compact];
  if (compact.startsWith("20-7I")) return "20-7I";
  if (compact.startsWith("20-7O")) return "20-7O";
  if (compact.startsWith("7-16O")) return "7-16O";
  if (compact.startsWith("7-15O")) return "7-15O";
  if (compact.startsWith("9-18IV")) return "9-18IV";
  if (compact.startsWith("9-18")) return "9-18O";
  if (compact.startsWith("10-20HM")) return "10-20HM";
  if (compact.startsWith("10-20")) return "10-20M";
  if (compact.startsWith("11-21")) return "11-21I";
  if (compact.startsWith("7-15I")) return "7-15I";
  if (compact.startsWith("9-20")) return "9-20F2";
  if (compact.startsWith("9-17")) return "9-17D";
  if (compact === "C1") return "C1";
  if (compact === "C2") return "C2";
  return raw;
}

function makeOffCell(requested = false) {
  return { code: requested ? "REQ OFF" : "OFF", normalized: requested ? "REQ_OFF" : "OFF", requested, ptAvailable: false, locked: requested };
}

/* Placeholder cell for un-allocated slots during REQ OFF setup mode.
   Displays empty in the grid. Treated as OFF for scheduling math
   (zero hours, not a working shift) but distinguishable in the renderer. */
function makeBlankCell() {
  return { code: "", normalized: "OFF", requested: false, ptAvailable: false, locked: false, blank: true };
}

function makePartTimeAvailableCell() {
  return { code: "PT Available", normalized: "PT_AVAILABLE", requested: false, ptAvailable: true, locked: true };
}

function makeAdminCell(shift, remark = "") {
  const normalized = normalizeShift(shift);
  const label = normalized === "OFF" ? "OFF" : shiftTemplates[normalized]?.label || shift;
  return {
    code: label,
    normalized,
    requested: false,
    ptAvailable: normalized === "PT_AVAILABLE",
    locked: true,
    manual: true,
    remark: remark || "Changed by admin"
  };
}

function getOverride(personId, dayIndex) {
  return adminOverrides[personId]?.[dayIndex] || null;
}

function setOverride(personId, dayIndex, shift, remark) {
  const normalized = normalizeShift(shift);
  if (isOperationalShiftCode(normalized)) {
    staff.forEach((p) => {
      if (p.id === personId) return;
      const other = getOverride(p.id, dayIndex);
      if (other && normalizeShift(other.shift) === normalized) removeOverride(p.id, dayIndex);
    });
  }
  if (!adminOverrides[personId]) adminOverrides[personId] = {};
  adminOverrides[personId][dayIndex] = { shift: normalized, remark: remark || "Changed by admin" };
}

function removeOverride(personId, dayIndex) {
  if (!adminOverrides[personId]) return;
  delete adminOverrides[personId][dayIndex];
  if (Object.keys(adminOverrides[personId]).length === 0) delete adminOverrides[personId];
}

function dayHasShift(rows, dayIndex, shift, excludePersonId = null) {
  const normalized = normalizeShift(shift);
  if (!isOperationalShiftCode(normalized)) return false;
  return staff.some((p) => p.id !== excludePersonId && normalizeShift(rows[p.id]?.[dayIndex]?.normalized) === normalized);
}

function clearDuplicateDailyShift(rows, personId, dayIndex, shift) {
  const normalized = normalizeShift(shift);
  if (!isOperationalShiftCode(normalized)) return;
  staff.forEach((p) => {
    if (p.id === personId) return;
    const cell = rows[p.id]?.[dayIndex];
    if (cell && normalizeShift(cell.normalized) === normalized) {
      rows[p.id][dayIndex] = p.status === "parttime" && (parttimeAvailability[p.id] || []).includes(dayIndex) ? makePartTimeAvailableCell() : makeOffCell(false);
      removeOverride(p.id, dayIndex);
    }
  });
}


function buildRequestOffSchedule() {
  const rows = {};
  staff.forEach((p) => {
    rows[p.id] = dateMeta.map((_, dayIndex) => {
      if (p.status === "hod") return makeBlankCell();
      if (requests[p.id]?.includes(dayIndex)) return makeOffCell(true);
      if (p.status === "parttime") return parttimeAvailability[p.id]?.includes(dayIndex) ? makePartTimeAvailableCell() : makeBlankCell();
      return makeBlankCell();
    });
  });
  return rows;
}

function getHours(cell) {
  if (!cell) return 0;
  return shiftTemplates[cell.normalized]?.hours ?? 0;
}

function getShiftType(cellOrCode) {
  const normalized = typeof cellOrCode === "string" ? normalizeShift(cellOrCode) : cellOrCode?.normalized;
  return shiftTemplates[normalized]?.type ?? "OPD";
}

function isNight(cellOrCode) {
  return getShiftType(cellOrCode) === "Night";
}

function requestedStats(cells) {
  return cells.reduce((acc, c, i) => {
    if (!c.requested) return acc;
    acc.total += 1;
    if (dateMeta[i].saturday) acc.sat += 1;
    if (dateMeta[i].sunday) acc.sun += 1;
    return acc;
  }, { total: 0, sat: 0, sun: 0 });
}

function canBookRequestedOff(cells, dayIndex) {
  const stats = requestedStats(cells);
  const day = dateMeta[dayIndex];
  if (stats.total >= 5) return { ok: false, reason: "Request OFF ได้สูงสุด 5 วัน/เดือน" };
  if (day.saturday && stats.sat >= 1) return { ok: false, reason: "Request OFF วันเสาร์ได้สูงสุด 1 วัน/เดือน" };
  if (day.sunday && stats.sun >= 1) return { ok: false, reason: "Request OFF วันอาทิตย์ได้สูงสุด 1 วัน/เดือน" };
  return { ok: true, reason: "" };
}

function targetHours() {
  const mode = $("targetMode").value;
  return Object.fromEntries(staff.map((p) => {
    const profile = statusProfiles[p.status] ?? statusProfiles.general;
    const manual = Number($("manualTarget")?.value) || 202;
    const target = mode === "manual" ? manual : mode === "equal" ? 202 : mode === "status" ? Math.round(p.target * profile.targetFactor) : p.target;
    return [p.id, target];
  }));
}

function clinicalShiftsAlreadyFilled(rows, dayIndex) {
  return ["C1", "C2"].every((code) => dayHasShift(rows, dayIndex, code));
}

function roleCanFillShift(person, shift, dayIndex, rows) {
  const type = getShiftType(shift);
  const date = dateMeta[dayIndex];
  if (!shiftAllowedOnDay(shift, date)) return false;
  if (person.status === "hod") return type === "Office" || type === "Special";
  if (person.status === "general") return type !== "Office";
  if (person.status === "clinical") {
    if (type === "Office") return false;
    if (type === "Clinic") return true;
    if (type === "Night")  return true;
    return clinicalShiftsAlreadyFilled(rows, dayIndex);
  }
  if (person.status === "deputy") return type !== "Night";
  if (person.status === "parttime") {
    const available = (parttimeAvailability[person.id] || []).includes(dayIndex);
    return available && type !== "Night" && type !== "Office" && type !== "Special";
  }
  return type !== "Office";
}

function createRuleBasedSchedule() {
  const target = targetHours();
  const minOffPerMonth = Number($("minOff").value) || 0;
  const maxConsecutiveWork = Number($("maxStreak").value) || 6;
  const maxConsecutiveNights = Math.max(1, Number($("maxConsecNights")?.value) || 2);
  const rows = {};

  staff.forEach((p) => {
    rows[p.id] = dateMeta.map((d, dayIndex) => {
      if (p.status === "hod") return makeOffCell(false);
      if (requests[p.id]?.includes(dayIndex)) return makeOffCell(true);
      if (p.status === "parttime") return parttimeAvailability[p.id]?.includes(dayIndex) ? makePartTimeAvailableCell() : makeOffCell(false);
      return makeOffCell(false);
    });
  });

  staff.forEach((p) => {
    dateMeta.forEach((_, dayIndex) => {
      const override = getOverride(p.id, dayIndex);
      if (!override) return;
      rows[p.id][dayIndex] = makeAdminCell(override.shift, override.remark);
      clearDuplicateDailyShift(rows, p.id, dayIndex, override.shift);
    });
  });

  if (allocationStarted && lockedDays.size > 0) {
    lockedDays.forEach((dayIndex) => {
      staff.forEach((p) => {
        const existing = lastSchedule[p.id]?.[dayIndex];
        if (existing) rows[p.id][dayIndex] = { ...existing };
      });
    });
  }

  const coverage = (date) => getCoverageShiftsForDay(date);

  const hours = Object.fromEntries(staff.map((p) => [p.id, 0]));
  const weekends = Object.fromEntries(staff.map((p) => [p.id, 0]));
  const nights = Object.fromEntries(staff.map((p) => [p.id, 0]));
  /* Per-type counters for fair distribution after role priorities are met */
  const typeCounts = Object.fromEntries(staff.map((p) => [p.id, {}]));

  Object.entries(rows).forEach(([id, cells]) => {
    cells.forEach((c, i) => {
      hours[id] += getHours(c);
      if (dateMeta[i].weekend && !["OFF", "REQ_OFF", "PT_AVAILABLE"].includes(c.normalized)) weekends[id] += 1;
      if (isNight(c)) nights[id] += 1;
      const t = shiftTemplates[c.normalized]?.type;
      if (t && !["OFF", "available", "system"].includes(t)) {
        typeCounts[id][t] = (typeCounts[id][t] || 0) + 1;
      }
    });
  });

  function consecutiveBefore(id, dayIndex) {
    let count = 0;
    for (let i = dayIndex - 1; i >= 0; i--) {
      if (["OFF", "REQ_OFF", "PT_AVAILABLE"].includes(rows[id][i].normalized)) break;
      count += 1;
    }
    return count;
  }

  function consecutiveNightsBefore(id, dayIndex) {
    let count = 0;
    for (let i = dayIndex - 1; i >= 0; i--) {
      if (!isNight(rows[id][i])) break;
      count += 1;
    }
    return count;
  }

  function canAssign(person, dayIndex, shift, relax = {}) {
    if (lockedDays.has(dayIndex)) return false;
    const profile = statusProfiles[person.status] ?? statusProfiles.general;
    const shiftType = getShiftType(shift);
    const date = dateMeta[dayIndex];
    const cell = rows[person.id][dayIndex];
    if (cell.manual) return false;
    if (cell.requested) return false;
    if (!roleCanFillShift(person, shift, dayIndex, rows)) return false;
    if (person.status === "parttime" && !cell.ptAvailable) return false;
    if (person.status !== "parttime" && cell.normalized !== "OFF") return false;
    if (person.status === "parttime" && cell.normalized !== "PT_AVAILABLE") return false;
    if (isNight(shift) && !profile.canNight) return false;
    if (date.weekend && !profile.canWeekend) return false;
    /* Hard caps — cannot be relaxed even on backfill (safety-critical) */
    if (isNight(shift) && consecutiveNightsBefore(person.id, dayIndex) >= maxConsecutiveNights) return false;
    /* Soft caps — relaxed on backfill pass when required coverage still empty */
    if (!relax.nightsCap   && isNight(shift) && nights[person.id]   >= profile.maxNight)   return false;
    if (!relax.weekendsCap && date.weekend   && weekends[person.id] >= profile.maxWeekend) return false;
    const prev = rows[person.id][dayIndex - 1];
    if (prev && isNight(prev) && !isNight(shift)) return false;
    if (!relax.streak && consecutiveBefore(person.id, dayIndex) >= maxConsecutiveWork) return false;
    if (!relax.minOff) {
      const currentOff = rows[person.id].filter((c) => c.normalized === "OFF" || c.normalized === "REQ_OFF").length;
      const remainingDays = dateMeta.length - dayIndex - 1;
      if (person.status !== "parttime" && currentOff <= minOffPerMonth && remainingDays < minOffPerMonth) return false;
    }
    return true;
  }

  /* Status penalty + rotation helpers (used in both scoring passes) */
  function statusPenalty(person, shiftType, weekend) {
    const isOffice = shiftType === "Office";
    const isClinicalCore = shiftType === "Clinic";
    if (person.status === "hod") return 999;
    if (person.status === "clinical")  return isClinicalCore ? -45 : 12;
    if (person.status === "deputy")    return isOffice ? -25 : 18;
    if (person.status === "parttime" && !weekend) return 8;
    return 0;
  }
  function rotate(person, dayIndex) {
    return ((Number(person.id.replace("P", "")) || 0) * 17 + dayIndex * 7 + allocationRun * 13) % 11;
  }

  /* Score a candidate for a given shift on a given day.
     `fairness` mode amplifies the per-type-count penalty so once role
     priorities (Clinic/Night) are taken, remaining shifts spread evenly. */
  function score(person, dayIndex, shift, date, fairness) {
    const shiftType = getShiftType(shift);
    const profile = statusProfiles[person.status] ?? statusProfiles.general;
    const preference = profile.shiftPreference.includes(shiftType) ? 16 : -30;
    const targetGap = (target[person.id] - hours[person.id]) * 1.25;
    const burden = weekends[person.id] * (date.weekend ? 5 : 2)
                 + nights[person.id]   * (isNight(shift) ? 8 : 3);
    /* Per-type fairness: how many of this shift type does this person already
       have? Lower is better. Weight is small in priority pass, large in
       fairness pass so remaining IPD/OPD/Floor2/Special spread evenly. */
    const typeCount = typeCounts[person.id][shiftType] || 0;
    const typePenalty = typeCount * (fairness ? 22 : 4);
    return targetGap + preference - burden - statusPenalty(person, shiftType, date.weekend)
         - typePenalty + rotate(person, dayIndex);
  }

  /* Place a candidate into a cell + update all counters */
  function place(picked, dayIndex, shift, date) {
    const normalized = normalizeShift(shift);
    rows[picked.id][dayIndex] = { code: shift, normalized, requested: false, ptAvailable: false, locked: false };
    hours[picked.id] += shiftTemplates[normalized]?.hours ?? 0;
    if (date.weekend) weekends[picked.id] += 1;
    if (isNight(shift)) nights[picked.id] += 1;
    const t = shiftTemplates[normalized]?.type;
    if (t && !["OFF", "available", "system"].includes(t)) {
      typeCounts[picked.id][t] = (typeCounts[picked.id][t] || 0) + 1;
    }
  }

  /* ── Pass 1 — Role-priority shifts (Clinic + Night first) ──────────────
     Clinical pharmacists go to Clinic, qualified staff cover Night.
     These types have the strongest role bias, so we assign them before
     the general-purpose shifts to lock in role-driven coverage. */
  const ROLE_PRIORITY_TYPES = new Set(["Clinic", "Night"]);
  dateMeta.forEach((date, dayIndex) => {
    coverage(date)
      .filter((shift) => ROLE_PRIORITY_TYPES.has(getShiftType(shift)))
      .forEach((shift) => {
        if (dayHasShift(rows, dayIndex, shift)) return;
        const candidates = staff
          .filter((p) => canAssign(p, dayIndex, shift))
          .sort((a, b) => score(b, dayIndex, shift, date, false) - score(a, dayIndex, shift, date, false));
        const picked = candidates[0];
        if (!picked) return;
        place(picked, dayIndex, shift, date);
      });
  });

  /* ── Pass 2 — Fair-distribution shifts (IPD, OPD, Office, Floor2, Special) ──
     Now allocate remaining shifts with strong per-type fairness.
     Equal-count distribution is the primary goal here. */
  dateMeta.forEach((date, dayIndex) => {
    coverage(date)
      .filter((shift) => !ROLE_PRIORITY_TYPES.has(getShiftType(shift)))
      .forEach((shift) => {
        if (dayHasShift(rows, dayIndex, shift)) return;
        const candidates = staff
          .filter((p) => canAssign(p, dayIndex, shift))
          .sort((a, b) => score(b, dayIndex, shift, date, true) - score(a, dayIndex, shift, date, true));
        const picked = candidates[0];
        if (!picked) return;
        place(picked, dayIndex, shift, date);
      });
  });

  /* ── Backfill pass — focus on filling missing REQUIRED shifts ──────────
     Iterate any still-missing required shifts and relax soft caps in stages
     (streak → weekends cap → minOff → nights cap). The hard rules
     (consecutiveNights, night→day, locked, manual, requested, role)
     remain strict. */
  function tryFill(relax) {
    dateMeta.forEach((date, dayIndex) => {
      getRequiredCoverageShiftsForDay(date).forEach((shift) => {
        if (dayHasShift(rows, dayIndex, shift)) return;
        const candidates = staff.filter((p) => canAssign(p, dayIndex, shift, relax));
        if (!candidates.length) return;
        /* Combine target gap + type-count fairness so backfill stays even */
        candidates.sort((a, b) => {
          const ta = getShiftType(shift);
          const ca = (typeCounts[a.id][ta] || 0), cb = (typeCounts[b.id][ta] || 0);
          const gapA = target[a.id] - hours[a.id], gapB = target[b.id] - hours[b.id];
          return (gapB - cb * 8) - (gapA - ca * 8);
        });
        const picked = candidates[0];
        place(picked, dayIndex, shift, date);
      });
    });
  }
  /* Progressive relaxation stages */
  tryFill({ streak: true });
  tryFill({ streak: true, weekendsCap: true });
  tryFill({ streak: true, weekendsCap: true, minOff: true });
  tryFill({ streak: true, weekendsCap: true, minOff: true, nightsCap: true });

  return rows;
}

function evaluate(schedule) {
  const target = targetHours();
  const rows = staff.map((p) => {
    const cells = schedule[p.id] ?? dateMeta.map(() => makeOffCell(false));
    const total = cells.reduce((sum, c) => sum + getHours(c), 0);
    const off = cells.filter((c) => c.normalized === "OFF" || c.normalized === "REQ_OFF").length;
    const requestedOff = cells.filter((c) => c.requested).length;
    const requestedSat = cells.filter((c, i) => c.requested && dateMeta[i].saturday).length;
    const requestedSun = cells.filter((c, i) => c.requested && dateMeta[i].sunday).length;
    const ptAvailable = cells.filter((c) => c.ptAvailable).length;
    const adminChanged = cells.filter((c) => c.manual).length;
    const night = cells.filter(isNight).length;
    const weekend = cells.filter((c, i) => dateMeta[i].weekend && !["OFF", "REQ_OFF", "PT_AVAILABLE"].includes(c.normalized)).length;
    let maxStreak = 0;
    let streak = 0;
    let maxNightStreak = 0;
    let nightStreak = 0;
    const typeBreakdown = {};
    cells.forEach((c) => {
      if (["OFF", "REQ_OFF", "PT_AVAILABLE"].includes(c.normalized)) streak = 0;
      else {
        streak += 1;
        maxStreak = Math.max(maxStreak, streak);
      }
      if (isNight(c)) {
        nightStreak += 1;
        maxNightStreak = Math.max(maxNightStreak, nightStreak);
      } else {
        nightStreak = 0;
      }
      const t = shiftTemplates[c.normalized]?.type;
      if (t && !["OFF", "available", "system"].includes(t)) {
        typeBreakdown[t] = (typeBreakdown[t] || 0) + 1;
      }
    });
    return { ...p, total, target: target[p.id] ?? p.target, diff: total - (target[p.id] ?? p.target), off, requestedOff, requestedSat, requestedSun, ptAvailable, adminChanged, night, weekend, maxStreak, maxNightStreak, typeBreakdown };
  });

  const totalDiff = rows.reduce((sum, r) => sum + Math.abs(r.diff), 0);
  const fairnessScore = Math.max(0, Math.round(100 - totalDiff / Math.max(rows.length, 1)));
  const violations = [];

  rows.forEach((r) => {
    const profile = statusProfiles[r.status] ?? statusProfiles.general;
    if (r.status !== "hod" && Math.abs(r.diff) > 12) violations.push(`${r.name}: hours differ from target ${r.diff > 0 ? "+" : ""}${r.diff}`);
    if (r.maxStreak > Number($("maxStreak").value || 6)) violations.push(`${r.name}: work streak ${r.maxStreak} days`);
    if (r.requestedOff > 5) violations.push(`${r.name}: requested OFF exceeds 5 days/month`);
    if (r.requestedSat > 1) violations.push(`${r.name}: requested Saturday OFF exceeds 1 day`);
    if (r.requestedSun > 1) violations.push(`${r.name}: requested Sunday OFF exceeds 1 day`);
    if (r.status === "parttime" && r.ptAvailable === 0 && r.total > 0) violations.push(`${r.name}: Part time assigned without self-booked availability`);
    if (!profile.canNight && r.night > 0) violations.push(`${r.name}: ${profile.label} should not take night shift`);
    if (Number.isFinite(profile.maxWeekend) && r.weekend > profile.maxWeekend) violations.push(`${r.name}: weekend shift exceeds ${profile.label} limit`);
    const maxConsecNights = Math.max(1, Number($("maxConsecNights")?.value) || 2);
    if (r.maxNightStreak > maxConsecNights) violations.push(`${r.name}: ${r.maxNightStreak} nights in a row exceeds max ${maxConsecNights}`);
  });

  /* Fair-distribution check: for each non-priority shift type (IPD/OPD/Floor2/Office/Special),
     compute the spread among eligible regular pharmacists. Spread > 3 flags as unfair. */
  const NON_PRIORITY_TYPES = ["IPD", "OPD", "Floor2", "Office", "Special"];
  NON_PRIORITY_TYPES.forEach((t) => {
    const counts = rows
      .filter((r) => r.status !== "hod" && (r.typeBreakdown[t] !== undefined))
      .map((r) => ({ name: r.name, n: r.typeBreakdown[t] || 0 }));
    if (counts.length < 2) return;
    const max = Math.max(...counts.map((c) => c.n));
    const min = Math.min(...counts.map((c) => c.n));
    if (max - min > 3) {
      const top = counts.find((c) => c.n === max), low = counts.find((c) => c.n === min);
      violations.push(`Unfair ${t} distribution: ${top.name} ${max} vs ${low.name} ${min} (spread ${max - min})`);
    }
  });

  Object.entries(schedule).forEach(([id, cells]) => {
    const person = staff.find((p) => p.id === id);
    cells.forEach((c, i) => {
      if (person && isOperationalShiftCode(c.normalized) && !roleCanFillShift(person, c.normalized, i, schedule)) {
        violations.push(`${person.name}: role ${statusProfiles[person.status]?.label || person.status} cannot fill ${c.normalized} on day ${i + 1}`);
      }
      const next = cells[i + 1];
      if (isNight(c) && next && !["OFF", "REQ_OFF", "PT_AVAILABLE"].includes(next.normalized) && !isNight(next)) {
        const name = staff.find((p) => p.id === id)?.name;
        violations.push(`${name}: day after night shift must be night or OFF on day ${i + 2}`);
      }
    });
  });

  if (allocationStarted) {
    dateMeta.forEach((d, dayIndex) => {
      const missing = getRequiredCoverageShiftsForDay(d).filter((shift) => !dayHasShift(schedule, dayIndex, shift));
      if (missing.length) violations.push(`Day ${dayIndex + 1}: missing required shift(s): ${missing.join(", ")}`);
    });
  }

  dateMeta.forEach((d, dayIndex) => {
    const map = new Map();
    staff.forEach((p) => {
      const cell = schedule[p.id]?.[dayIndex];
      if (!cell || !isOperationalShiftCode(cell.normalized)) return;
      const key = normalizeShift(cell.normalized);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p.name);
    });
    map.forEach((names, shift) => {
      if (names.length > 1) violations.push(`Day ${dayIndex + 1}: duplicated shift ${shift} assigned to ${names.join(", ")}`);
    });
  });

  return { rows, fairnessScore, violations };
}

function toggleCell(personId, dayIndex) {
  const person = staff.find((p) => p.id === personId);
  if (!person) return;
  if (reqOffLocked && !allocationStarted) {
    setMessage("REQ OFF / PT availability is locked after Save state. Click Auto Allocate to continue.");
    return;
  }
  if (person.status === "hod") {
    setMessage("HOD is excluded from operational schedule.");
    return;
  }
  if (person.status === "parttime") {
    const current = parttimeAvailability[personId] ?? [];
    if (current.includes(dayIndex)) {
      parttimeAvailability[personId] = current.filter((d) => d !== dayIndex);
      setMessage(`Cancelled part-time available day: ${person.name} day ${dayIndex + 1}`);
    } else {
      parttimeAvailability[personId] = [...current, dayIndex].sort((a, b) => a - b);
      setMessage(`Booked part-time available day: ${person.name} day ${dayIndex + 1}`);
    }
    viewMode = "auto";
    markDirty();
    render();
    return;
  }
  const current = requests[personId] ?? [];
  if (current.includes(dayIndex)) {
    requests[personId] = current.filter((d) => d !== dayIndex);
    setMessage(`Cancelled requested day off: ${person.name} day ${dayIndex + 1}`);
  } else {
    const mockCells = dateMeta.map((_, i) => makeOffCell(current.includes(i)));
    const check = canBookRequestedOff(mockCells, dayIndex);
    if (!check.ok) {
      setMessage(check.reason);
      return;
    }
    requests[personId] = [...current, dayIndex].sort((a, b) => a - b);
    setMessage(`Booked requested day off: ${person.name} day ${dayIndex + 1}`);
  }
  viewMode = "auto";
  markDirty();
  render();
}

function getDailyShiftOptions(dayIndex, person, overrideRoleLimits = false) {
  const day = dateMeta[dayIndex];
  let shifts = [...getCoverageShiftsForDay(day), ...Object.keys(shiftTemplates).filter((code) => shiftTemplates[code]?.special && shiftAllowedOnDay(code, day))];
  const typeAllowed = (shift) => {
    const normalized = normalizeShift(shift);
    const type = getShiftType(shift);
    if (normalized === "REQ_OFF") return false;
    const prev = lastSchedule[person.id]?.[dayIndex - 1];
    if (prev && isNight(prev) && type !== "Night" && normalized !== "OFF") return false;
    /* Role / status checks bypassed when admin enables override */
    if (!overrideRoleLimits) {
      if (!roleCanFillShift(person, normalized, dayIndex, lastSchedule) && normalized !== "OFF" && normalized !== "PT_AVAILABLE") return false;
      if (type === "Night" && !(statusProfiles[person.status] || statusProfiles.general).canNight) return false;
    }
    return shiftAllowedOnDay(normalized, day);
  };
  shifts = shifts.filter(typeAllowed);
  return shifts;
}

function openShiftEditor(personId, dayIndex) {
  const person = staff.find((p) => p.id === personId);
  if (!person) return;
  const baseCell = lastSchedule[personId]?.[dayIndex];
  if (reqOffLocked && baseCell?.requested) {
    setMessage("This REQ OFF is saved and locked. It cannot be changed by admin shift selection.");
    return;
  }
  editingCell = { personId, dayIndex };
  const day = dateMeta[dayIndex];
  const cell = lastSchedule[personId]?.[dayIndex] || makeOffCell(false);
  const override = getOverride(personId, dayIndex);
  if ($("overrideRole")) $("overrideRole").checked = false;
  const select = $("shiftSelect");
  const ptAvailable = (parttimeAvailability[personId] || []).includes(dayIndex);

  function _holderOf(shift) {
    const norm = normalizeShift(shift);
    if (!isOperationalShiftCode(norm)) return null;
    const holders = staff
      .filter((p) => p.id !== personId)
      .filter((p) => normalizeShift(lastSchedule[p.id]?.[dayIndex]?.normalized) === norm)
      .map((p) => p.name);
    return holders.length ? holders.join(", ") : null;
  }
  function _renderOpt(shift) {
    const norm = normalizeShift(shift);
    const label = shiftTemplates[norm]?.label || shift;
    const hours = shiftTemplates[norm]?.hours || 0;
    const holder = _holderOf(shift);
    const suffix = holder ? ` ⚠️ currently ${holder}` : "";
    return `<option value="${shift}" ${cell.normalized === norm ? "selected" : ""}>${label} · ${hours} hr${suffix}</option>`;
  }

  /* Rebuildable option list — re-runs when admin toggles "Override role limits" */
  function _rebuildShiftOptions() {
    const overrideOn = $("overrideRole")?.checked || false;
    const options = getDailyShiftOptions(dayIndex, person, overrideOn);
    let optionHtml = `<option value="OFF">OFF / No operational shift</option>`;
    if (person.status === "parttime") {
      optionHtml += `<option value="PT_AVAILABLE" ${cell.normalized === "PT_AVAILABLE" ? "selected" : ""}>Part-time available only</option>`;
    }
    const regularOptions = options.filter((shift) => !shiftTemplates[normalizeShift(shift)]?.special);
    const specialOptions = options.filter((shift) =>  shiftTemplates[normalizeShift(shift)]?.special);
    optionHtml += regularOptions.map(_renderOpt).join("");
    if (specialOptions.length) {
      optionHtml += `<optgroup label="─── Special ───">${specialOptions.map(_renderOpt).join("")}</optgroup>`;
    }
    select.innerHTML = optionHtml;
    select.value = override?.shift || (cell.manual ? cell.normalized : cell.normalized === "PT_AVAILABLE" ? "PT_AVAILABLE" : cell.normalized === "REQ_OFF" ? "OFF" : cell.normalized);
    if (!select.value || !Array.from(select.options).some((opt) => opt.value === select.value)) select.value = "OFF";
  }
  _rebuildShiftOptions();
  /* Replace the checkbox node to detach any previous listener, then bind fresh.
     This keeps `_rebuildShiftOptions`'s closure scoped to the current open. */
  const oldCb = $("overrideRole");
  if (oldCb) {
    const newCb = oldCb.cloneNode(true);
    newCb.checked = false;
    oldCb.parentNode.replaceChild(newCb, oldCb);
    newCb.addEventListener("change", _rebuildShiftOptions);
  }
  $("shiftRemark").value = override?.remark || (cell.manual ? cell.remark || "Changed by admin" : "Changed by admin");
  $("editorTitle").textContent = `${person.name} · Day ${day.day} (${day.dow})`;
  const helper = person.status === "parttime" && !ptAvailable
    ? "Part time has not booked availability for this day. Select 'Part-time available only' first, or choose OFF."
    : `Current: ${cell.code}${cell.manual ? " · admin changed" : ""}`;
  $("editorHelper").textContent = helper;
  $("shiftEditor").classList.add("open");
}

function closeShiftEditor() {
  editingCell = null;
  $("shiftEditor").classList.remove("open");
}

function saveAdminShift() {
  if (!editingCell) return;
  const { personId, dayIndex } = editingCell;
  const person = staff.find((p) => p.id === personId);
  const shift = $("shiftSelect").value;
  const remark = $("shiftRemark").value.trim() || "Changed by admin";
  if (shift === "OFF") {
    /* Store OFF as an explicit admin override so the auto-allocator
       skips this cell (manual:true, locked:true) instead of refilling it. */
    setOverride(personId, dayIndex, "OFF", remark);
    setMessage(`Set OFF (locked) by admin: ${person?.name} day ${dayIndex + 1}. ${remark}`);
  } else if (person?.status === "parttime" && shift === "PT_AVAILABLE") {
    const current = parttimeAvailability[personId] || [];
    if (!current.includes(dayIndex)) parttimeAvailability[personId] = [...current, dayIndex].sort((a, b) => a - b);
    removeOverride(personId, dayIndex);
    setMessage(`Marked part-time available: ${person.name} day ${dayIndex + 1}`);
  } else {
    const overrideRoleOn = $("overrideRole")?.checked || false;
    if (!overrideRoleOn && !roleCanFillShift(person, shift, dayIndex, lastSchedule)) {
      setMessage(`${person?.name || "Selected pharmacist"} cannot fill ${shift} by role/shift restriction. Tick "Override role limits" to bypass.`);
      return;
    }
    const duplicateNames = staff
      .filter((p) => p.id !== personId && isOperationalShiftCode(shift) && normalizeShift(lastSchedule[p.id]?.[dayIndex]?.normalized) === normalizeShift(shift))
      .map((p) => p.name);
    setOverride(personId, dayIndex, shift, remark);
    const duplicateText = duplicateNames.length ? ` Duplicate ${normalizeShift(shift)} was cleared from: ${duplicateNames.join(", ")}.` : "";
    const overrideText  = overrideRoleOn ? " (⚠️ role limit override)" : "";
    setMessage(`Admin changed shift: ${person?.name} day ${dayIndex + 1} → ${shift}${overrideText}. Remark saved.${duplicateText}`);
  }
  viewMode = "auto";
  markDirty();
  closeShiftEditor();
  render();
}

function clearAdminShift() {
  if (!editingCell) return;
  const { personId, dayIndex } = editingCell;
  const person = staff.find((p) => p.id === personId);
  removeOverride(personId, dayIndex);
  setMessage(`Cleared admin change: ${person?.name} day ${dayIndex + 1}. Auto allocation can fill this cell again.`);
  viewMode = "auto";
  markDirty();
  closeShiftEditor();
  render();
}

function setMessage(text) {
  $("messageBox").textContent = text;
}

function markDirty() {
  isDirty = true;
  const btn = $("btnSaveState");
  if (btn) btn.textContent = "Save to database in server *";
}

function clearDirty() {
  isDirty = false;
  const btn = $("btnSaveState");
  if (btn) btn.textContent = "Save to database in server";
}

function scheduleStateUrl() {
  return `http://10.134.110.81:8765/api/schedule/state?month=${encodeURIComponent(SCHEDULE_MONTH_KEY)}`;
}

function stateTimestamp(state) {
  const ts = Date.parse(state?.updatedAt || "");
  return Number.isFinite(ts) ? ts : 0;
}

async function saveState() {
  const state = {
    staff, requests, parttimeAvailability, adminOverrides, shiftTemplates, allocationRun, allocationStarted, reqOffLocked, lockedDays: [...lockedDays],
    settings: {
      targetMode: $("targetMode")?.value,
      manualTarget: $("manualTarget")?.value,
      minOff: $("minOff")?.value,
      maxStreak: $("maxStreak")?.value,
      maxConsecNights: $("maxConsecNights")?.value
    }
  };
  if (!allocationStarted) reqOffLocked = true;
  state.reqOffLocked = reqOffLocked;
  state.month = SCHEDULE_MONTH_KEY;
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(storageKey(), JSON.stringify(state));
  const btn = $("btnSaveState");
  if (btn) btn.disabled = true;
  try {
    const r = await fetch(scheduleStateUrl(), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state)
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    clearDirty();
    setMessage(allocationStarted ? "State saved to server. Closing or refreshing the page will keep this schedule." : "REQ OFF / PT availability saved to server and locked. Click Auto Allocate to generate shifts.");
  } catch (err) {
    markDirty();
    setMessage(`Saved in this browser, but server save failed: ${err.message || err}. Try Save again before closing.`);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function applyState(state) {
  if (Array.isArray(state.staff)) staff = state.staff;
  if (state.requests) requests = state.requests;
  if (state.parttimeAvailability) parttimeAvailability = state.parttimeAvailability;
  if (state.adminOverrides) adminOverrides = state.adminOverrides;
  if (state.shiftTemplates) shiftTemplates = state.shiftTemplates;
  if (Number.isFinite(state.allocationRun)) allocationRun = state.allocationRun;
  if (typeof state.allocationStarted === "boolean") allocationStarted = state.allocationStarted;
  if (typeof state.reqOffLocked === "boolean") reqOffLocked = state.reqOffLocked;
  if (Array.isArray(state.lockedDays)) lockedDays = new Set(state.lockedDays);
  const settings = state.settings || {};
  if ($("targetMode") && settings.targetMode) $("targetMode").value = settings.targetMode;
  if ($("manualTarget") && settings.manualTarget) $("manualTarget").value = settings.manualTarget;
  if ($("minOff") && settings.minOff) $("minOff").value = settings.minOff;
  if ($("maxStreak") && settings.maxStreak) $("maxStreak").value = settings.maxStreak;
  if ($("maxConsecNights") && settings.maxConsecNights) $("maxConsecNights").value = settings.maxConsecNights;
}

function loadState() {
  try {
    const raw = localStorage.getItem(storageKey());
    let localState = null;
    if (raw) {
      localState = JSON.parse(raw);
      applyState(localState);
      clearDirty();
      setTimeout(() => setMessage("Loaded saved state from this browser."), 0);
    }

    fetch(scheduleStateUrl())
      .then(r => r.ok ? r.json() : null)
      .then(state => {
        if (!state || typeof state !== 'object') return;
        if (localState) {
          const serverTs = stateTimestamp(state);
          if (!serverTs || serverTs < stateTimestamp(localState)) return;
        }
        applyState(state);
        localStorage.setItem(storageKey(), JSON.stringify(state));
        clearDirty();
        render();
        setTimeout(() => setMessage("Loaded saved state from server."), 0);
      })
      .catch(() => {});
    return !!localState;
  } catch (err) {
    console.warn("Could not load saved state", err);
    return false;
  }
}

function renderStatusOptions(select, selected) {
  select.innerHTML = Object.entries(statusProfiles).map(([key, s]) => `<option value="${key}" ${selected === key ? "selected" : ""}>${s.label}</option>`).join("");
}

function renderStatusRules() {
  const fmtCap = (v) => Number.isFinite(v) ? v : "—";
  $("statusRules").innerHTML = Object.entries(statusProfiles).map(([key, s]) => `
    <div class="rule-item">
      <strong>${s.label}</strong>
      <div>Target factor ${s.targetFactor} · Night ${s.canNight ? "✅" : "❌"} · Weekend ${s.canWeekend ? "✅" : "❌"} · Max night/mo ${fmtCap(s.maxNight)} · Max weekend/mo ${fmtCap(s.maxWeekend)}</div>
      <div>${s.description}</div>
    </div>
  `).join("");
}

function renderStaffCards() {
  const rows = lastResult.rows;
  $("staffCards").innerHTML = rows.map((r) => {
    const width = Math.min(100, Math.round((r.total / Math.max(r.target, 1)) * 100));
    return `
      <div class="staff-card" data-id="${r.id}">
        <div class="staff-head">
          <input class="staff-name" value="${r.name}" />
          <button class="danger remove-staff">✕</button>
        </div>
        <div class="staff-meta">
          <select class="staff-status"></select>
          <input class="staff-target" type="number" value="${staff.find((p) => p.id === r.id)?.target ?? r.target}" />
        </div>
        <div class="progress"><div style="width:${width}%"></div></div>
        <div class="mini-stats">
          <div>${r.total}<br>hr</div><div>${r.target}<br>target</div><div>${r.requestedOff}<br>req</div><div>${r.ptAvailable}<br>PT</div><div>${r.adminChanged}<br>ADM</div>
        </div>
        <div class="diff ${Math.abs(r.diff) <= 8 ? "good" : "warn"}">${r.diff > 0 ? "+" : ""}${r.diff} hr from target</div>
      </div>
    `;
  }).join("");

  document.querySelectorAll(".staff-card").forEach((card) => {
    const id = card.dataset.id;
    const person = staff.find((p) => p.id === id);
    const statusSelect = card.querySelector(".staff-status");
    renderStatusOptions(statusSelect, person.status);
    card.querySelector(".staff-name").addEventListener("change", (e) => {
      person.name = e.target.value;
      render();
    });
    statusSelect.addEventListener("change", (e) => {
      person.status = e.target.value;
      viewMode = "auto";
      markDirty();
      render();
    });
    card.querySelector(".staff-target").addEventListener("change", (e) => {
      person.target = Number(e.target.value) || 0;
      render();
    });
    card.querySelector(".remove-staff").addEventListener("click", () => {
      staff = staff.filter((p) => p.id !== id);
      delete requests[id];
      delete parttimeAvailability[id];
      delete adminOverrides[id];
      setMessage(`Removed ${person.name}. Auto allocation updated.`);
      viewMode = "auto";
      markDirty();
      render();
    });
  });
}

function toggleDayLock(dayIndex) {
  if (lockedDays.has(dayIndex)) lockedDays.delete(dayIndex);
  else lockedDays.add(dayIndex);
  markDirty();
  render();
}

function cellClass(cell, isWeekend) {
  if (cell.blank) return "cell-blank";
  if (cell.manual) return isNight(cell) ? "cell-admin cell-night" : "cell-admin";
  if (cell.requested) return "cell-req";
  if (cell.ptAvailable) return "cell-pt";
  if (cell.normalized === "OFF" || cell.normalized === "REQ_OFF") return "cell-off";
  if (isNight(cell)) return "cell-night";
  if (isWeekend) return "cell-weekend";
  return "cell-day";
}

function renderScheduleGrid() {
  let html = `<table><thead><tr><th class="name-col">Name / status</th>`;
  dateMeta.forEach((d, i) => {
    const missing = allocationStarted ? getRequiredCoverageShiftsForDay(d).filter((shift) => !dayHasShift(lastSchedule, i, shift)) : [];
    const locked = lockedDays.has(i);
    html += `<th class="${d.weekend ? "weekend" : ""} ${missing.length ? "day-missing" : ""} ${locked ? "day-col-locked" : ""}" title="${missing.length ? `Missing: ${missing.join(", ")}` : "All required shifts filled"}"><div>${d.dow}</div><strong>${d.day}</strong><button class="day-lock-btn${locked ? " locked" : ""}" data-day="${i}" title="${locked ? "Unlock day – allow regeneration" : "Lock day – freeze all shifts"}">${locked ? "🔒" : "🔓"}</button>${missing.length ? `<em>!</em>` : ""}</th>`;
  });
  html += `<th class="total-col">Total</th></tr></thead><tbody>`;

  const ROLE_ORDER = ['hod', 'deputy', 'general', 'clinical', 'parttime'];
  const sortedStaff = [...staff].sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.status);
    const bi = ROLE_ORDER.indexOf(b.status);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  sortedStaff.forEach((p) => {
    const row = lastResult.rows.find((r) => r.id === p.id);
    html += `<tr><td class="name-col"><div class="name-main">${p.name}</div><div class="name-sub">${statusProfiles[p.status].label} · target ${row?.target ?? 0} hr · req ${row?.requestedOff ?? 0}/5</div></td>`;
    dateMeta.forEach((d, i) => {
      const cell = lastSchedule[p.id]?.[i] ?? makeBlankCell();
      const note = bookingNotes[p.id]?.[i] || "";
      let display;
      if (cell.blank) display = "";
      else if (cell.code === "REQ OFF") display = "REQ";
      else if (cell.code === "PT Available") display = "PT";
      else display = `${cell.code}${cell.manual ? " ✎" : ""}`;
      const baseTitle = cell.blank ? "Unallocated — click to add REQ OFF / shift"
                      : cell.manual ? `${cell.code} · Admin change: ${cell.remark || "Changed by admin"}` : cell.code;
      const fullTitle = note ? `${baseTitle}\n📝 ${note}` : baseTitle;
      const noteBadge = note ? `<span class="cell-note-dot" title="${note.replace(/"/g, "&quot;")}">📝</span>` : "";
      html += `<td class="${d.weekend ? "weekend" : ""}"><button class="cell-btn ${cellClass(cell, d.weekend)}" data-id="${p.id}" data-day="${i}" title="${fullTitle.replace(/"/g, "&quot;")}">${display}${noteBadge}</button></td>`;
    });
    html += `<td class="total-col"><strong>${row?.total ?? 0}</strong></td></tr>`;
  });
  html += `</tbody></table>`;
  $("scheduleGrid").innerHTML = html;

  document.querySelectorAll(".day-lock-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDayLock(Number(btn.dataset.day));
    });
  });

  document.querySelectorAll(".cell-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const day = Number(btn.dataset.day);
      if (!allocationStarted) toggleCell(btn.dataset.id, day);
      else openShiftEditor(btn.dataset.id, day);
    });
  });
}

function renderCoverage() {
  const cards = dateMeta.map((d, dayIndex) => {
    const working = staff.filter((p) => !["OFF", "REQ_OFF", "PT_AVAILABLE"].includes(lastSchedule[p.id]?.[dayIndex]?.normalized)).length;
    const night = staff.filter((p) => isNight(lastSchedule[p.id]?.[dayIndex])).length;
    const requested = staff.filter((p) => lastSchedule[p.id]?.[dayIndex]?.requested).length;
    const ptAvail = staff.filter((p) => lastSchedule[p.id]?.[dayIndex]?.ptAvailable).length;
    const missing = allocationStarted ? getRequiredCoverageShiftsForDay(d).filter((shift) => !dayHasShift(lastSchedule, dayIndex, shift)) : [];
    const missingHtml = missing.length ? `<div class="missing">Missing: ${missing.join(", ")}</div>` : `<div class="ok-mini">All required filled</div>`;
    return `<div class="day-card ${d.weekend ? "weekend" : ""} ${missing.length ? "coverage-missing" : ""}"><span>${d.dow}</span><strong>${d.day}</strong><div>Work ${working}</div><div>Night ${night}</div><div>Req ${requested} · PT ${ptAvail}</div>${missingHtml}</div>`;
  });
  $("coverageGrid").innerHTML = cards.join("");
}

function renderAlerts() {
  if (lastResult.violations.length === 0) {
    $("alerts").innerHTML = `<div class="alert ok">No critical rule violation found. Schedule is ready for supervisor review.</div>`;
    return;
  }
  $("alerts").innerHTML = lastResult.violations.slice(0, 40).map((v) => `<div class="alert">${v}</div>`).join("");
}

function renderShiftManagement() {
  const container = $("shiftRows");
  if (!container) return;
  const rows = Object.entries(shiftTemplates)
    .filter(([_, s]) => !s.system)
    .map(([code, s]) => `
      <div class="shift-row" data-code="${code}">
        <input class="shift-code" value="${code}" />
        <input class="shift-label" value="${s.label || code}" />
        <input class="shift-hours" type="number" min="0" max="24" step="0.5" value="${s.hours || 0}" />
        <select class="shift-type">${SHIFT_TYPE_OPTIONS.map((t) => `<option value="${t}" ${s.type === t ? "selected" : ""}>${t}</option>`).join("")}</select>
        <select class="shift-day-group">${SHIFT_DAY_GROUP_OPTIONS.map((g) => `<option value="${g}" ${(s.dayGroup || "both") === g ? "selected" : ""}>${g}</option>`).join("")}</select>
        <button class="save-shift" type="button">Save</button>
        <button class="danger delete-shift" type="button">Delete</button>
      </div>
    `).join("");
  container.innerHTML = rows || `<div class="muted-empty">No editable shifts.</div>`;

  document.querySelectorAll(".shift-row").forEach((row) => {
    const oldCode = row.dataset.code;
    row.querySelector(".save-shift").addEventListener("click", () => {
      const newCode = row.querySelector(".shift-code").value.trim();
      const label = row.querySelector(".shift-label").value.trim() || newCode;
      const hours = Number(row.querySelector(".shift-hours").value) || 0;
      const type = row.querySelector(".shift-type").value;
      const dayGroup = row.querySelector(".shift-day-group").value;
      if (!newCode) { setMessage("Shift code cannot be blank."); return; }
      if (oldCode !== newCode && shiftTemplates[newCode]) { setMessage(`Cannot rename to ${newCode}; this shift already exists.`); return; }
      const value = { label, hours, type, dayGroup };
      delete shiftTemplates[oldCode];
      shiftTemplates[newCode] = value;
      Object.values(adminOverrides).forEach((byDay) => {
        Object.values(byDay).forEach((ov) => { if (ov.shift === oldCode) ov.shift = newCode; });
      });
      setMessage(`Saved shift ${newCode}. Schedule recalculated.`);
      viewMode = "auto";
      markDirty();
      render();
    });
    row.querySelector(".delete-shift").addEventListener("click", () => {
      if (!confirm(`Delete shift ${oldCode}? Existing admin changes using this shift will be cleared.`)) return;
      delete shiftTemplates[oldCode];
      Object.entries(adminOverrides).forEach(([pid, byDay]) => {
        Object.entries(byDay).forEach(([day, ov]) => {
          if (normalizeShift(ov.shift) === oldCode) delete byDay[day];
        });
        if (Object.keys(byDay).length === 0) delete adminOverrides[pid];
      });
      setMessage(`Deleted shift ${oldCode}. Schedule recalculated.`);
      viewMode = "auto";
      markDirty();
      render();
    });
  });
}

function addShift() {
  const code = $("newShiftCode").value.trim();
  const label = $("newShiftLabel").value.trim() || code;
  const hours = Number($("newShiftHours").value) || 0;
  const type = $("newShiftType").value;
  const dayGroup = $("newShiftDayGroup").value;
  if (!code) { setMessage("Shift code cannot be blank."); return; }
  if (shiftTemplates[code]) { setMessage(`Shift ${code} already exists.`); return; }
  shiftTemplates[code] = { label, hours, type, dayGroup };
  $("newShiftCode").value = "";
  $("newShiftLabel").value = "";
  $("newShiftHours").value = "8";
  setMessage(`Added shift ${code}. ${type === "Special" ? "Special shifts are available for admin manual selection and count in work hours, but are not required/common coverage." : "It is now available for allocation and admin selection."}`);
  viewMode = "auto";
  markDirty();
  render();
}

function renderNewShiftSelects() {
  const typeSelect = $("newShiftType");
  const groupSelect = $("newShiftDayGroup");
  if (typeSelect) typeSelect.innerHTML = SHIFT_TYPE_OPTIONS.map((t) => `<option value="${t}">${t}</option>`).join("");
  if (groupSelect) groupSelect.innerHTML = SHIFT_DAY_GROUP_OPTIONS.map((g) => `<option value="${g}">${g}</option>`).join("");
}

function renderKpis() {
  const rows = lastResult.rows;
  const mean = Math.round(rows.reduce((s, r) => s + r.total, 0) / Math.max(rows.length, 1));
  const maxDiff = Math.max(0, ...rows.map((r) => Math.abs(r.diff)));
  const requestCount = Object.values(requests).reduce((s, arr) => s + arr.length, 0);
  const ptCount = Object.values(parttimeAvailability).reduce((s, arr) => s + arr.length, 0);
  const adminCount = Object.values(adminOverrides).reduce((sum, byDay) => sum + Object.keys(byDay).length, 0);
  $("fairnessScore").textContent = lastResult.fairnessScore;
  $("staffCount").textContent = staff.length;
  $("alertCount").textContent = lastResult.violations.length;
  $("meanHours").textContent = mean;
  $("maxDiff").textContent = maxDiff;
  $("requestCount").textContent = `${requestCount} / ${ptCount} / ${adminCount}`;
  $("modeLabel").textContent = !allocationStarted ? "REQ OFF setup" : "Auto";
}

function render() {
  lastSchedule = !allocationStarted ? buildRequestOffSchedule() : createRuleBasedSchedule();
  lastResult = evaluate(lastSchedule);
  renderKpis();
  renderStaffCards();
  renderScheduleGrid();
  renderCoverage();
  renderAlerts();
  renderShiftManagement();
}

function addPharmacist() {
  const name = $("newName").value.trim() || `New pharmacist ${staff.length + 1}`;
  const status = $("newStatus").value;
  const target = Number($("newTarget").value) || 202;
  const nextNumber = Math.max(0, ...staff.map((p) => Number(p.id.replace("P", "")) || 0)) + 1;
  const id = `P${String(nextNumber).padStart(2, "0")}`;
  staff.push({ id, name, status, target, skills: ["D"] });
  $("newName").value = "";
  $("newTarget").value = "202";
  setMessage(`Added ${name}. Auto allocation updated.`);
  viewMode = "auto";
  markDirty();
  render();
}

function exportCsv() {
  const header = ["Name", "Status", ...dateMeta.map((d) => `${d.day}-${d.dow}`), "TotalHr", "Target", "Diff", "RequestedOff", "PartTimeAvailable", "AdminChanged", "Night", "Weekend"].join(",");
  const body = lastResult.rows.map((r) => [
    r.name,
    statusProfiles[r.status]?.label,
    ...lastSchedule[r.id].map((c) => c.code),
    r.total,
    r.target,
    r.diff,
    r.requestedOff,
    r.ptAvailable,
    r.adminChanged,
    r.night,
    r.weekend
  ].join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pharmacy_schedule_rule_based.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function updateManualTargetUi() {
  const wrap = $("manualTargetWrap");
  if (!wrap) return;
  wrap.style.display = $("targetMode").value === "manual" ? "block" : "none";
}

function setupTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTab = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
      document.querySelectorAll(".tab-content").forEach((pane) => pane.classList.toggle("active", pane.id === activeTab));
    });
  });
}

function printScheduleTable() {
  const tableHtml = $("scheduleGrid").innerHTML;
  const win = window.open("", "_blank");
  win.document.write(`<!doctype html><html><head><title>Pharmacy Schedule</title><style>
    @page { size: A4 landscape; margin: 8mm; }
    body { font-family: Arial, sans-serif; color: #0f172a; }
    h1 { font-size: 16px; margin: 0 0 8px; }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; font-size: 7px; }
    th, td { border: 1px solid #cbd5e1; padding: 2px; text-align: center; }
    th { background: #f1f5f9; }
    .name-col { width: 95px; text-align: left; }
    .total-col { width: 28px; }
    .weekend { background: #fce7f3 !important; }
    button { border: 0; background: transparent; font: inherit; padding: 0; }
    .cell-night { background: #0f172a !important; color: white !important; }
    .cell-off { color: #e11d48 !important; }
    .cell-req { background: #f5f3ff !important; color: #6d28d9 !important; }
    .cell-pt { background: #ecfdf5 !important; color: #047857 !important; }
    .name-main { font-weight: 700; }
    .name-sub { font-size: 6px; color: #64748b; }
  </style></head><body><h1>Pharmacy Schedule · June 2026</h1>${tableHtml}</body></html>`);
  win.document.close();
  win.focus();
  win.print();
}

function regenerateSchedule() {
  allocationStarted = true;
  reqOffLocked = true;
  allocationRun += 1;
  viewMode = "auto";
  markDirty();
  render();
  /* After render, count any required shifts still missing so the admin knows */
  let missingTotal = 0;
  dateMeta.forEach((d, dayIndex) => {
    missingTotal += getRequiredCoverageShiftsForDay(d).filter((s) => !dayHasShift(lastSchedule, dayIndex, s)).length;
  });
  setMessage(
    missingTotal === 0
      ? "Regenerated. All required shifts are filled. REQ OFF + admin cells preserved."
      : `Regenerated. Filled missing required shifts. ${missingTotal} still uncovered (check Coverage tab).`
  );
}

function applyBookingsObject(all) {
  if (!all || typeof all !== "object") return false;
  const month = all[SCHEDULE_MONTH_KEY];
  if (!month) return false;
  /* Replace requests/parttimeAvailability with fresh data from bookings.
     Admin overrides and allocated shifts are preserved separately. */
  requests = {};
  parttimeAvailability = {};
  bookingNotes = {};
  let appliedCount = 0;

  /* 1. REQ OFF / part-time availability days */
  Object.entries(month.requests || {}).forEach(([personId, days]) => {
    const person = staff.find((p) => p.id === personId);
    if (!person) return;
    const indexes = (days || []).map((day) => Number(day) - 1).filter((i) => Number.isInteger(i) && i >= 0 && i < dateMeta.length);
    if (person.status === "parttime") parttimeAvailability[personId] = indexes;
    else if (person.status !== "hod") { requests[personId] = indexes; appliedCount++; }
  });

  /* 2. Per-day notes — independent of REQ OFF. A pharmacist may leave a note
        without requesting OFF (purely informational for the manager). */
  Object.entries(month.notes || {}).forEach(([personId, dayMap]) => {
    if (!staff.find((p) => p.id === personId)) return;
    const noteByIndex = {};
    Object.entries(dayMap || {}).forEach(([dayStr, text]) => {
      const i = Number(dayStr) - 1;
      if (Number.isInteger(i) && i >= 0 && i < dateMeta.length && text) noteByIndex[i] = String(text);
    });
    if (Object.keys(noteByIndex).length) bookingNotes[personId] = noteByIndex;
  });

  return appliedCount > 0 || Object.keys(bookingNotes).length > 0;
}

function loadMonthlyBookingsIntoSchedule() {
  /* 1. Local cache (instant) */
  let loaded = false;
  try {
    const all = JSON.parse(localStorage.getItem(BOOKING_STORAGE_KEY) || "{}");
    loaded = applyBookingsObject(all);
  } catch (err) { console.warn("Cannot read local bookings", err); }

  /* 2. Always check server too — bookings may have been made on another
        workstation since the last localStorage sync. */
  fetch('http://10.134.110.81:8765/api/schedule/bookings')
    .then(r => r.ok ? r.json() : null)
    .then(serverAll => {
      if (!serverAll || typeof serverAll !== "object") return;
      localStorage.setItem(BOOKING_STORAGE_KEY, JSON.stringify(serverAll));
      const applied = applyBookingsObject(serverAll);
      if (applied) {
        setMessage(`Loaded pharmacist bookings from server for ${SCHEDULE_MONTH_KEY}.`);
        render();
      }
    })
    .catch(() => {});

  if (loaded) setMessage(`Loaded pharmacist bookings for ${SCHEDULE_MONTH_KEY}. Save state to lock before auto allocation.`);
  return loaded;
}

function populateMonthPicker() {
  const sel = $("monthSelect");
  if (!sel) return;
  /* 12 months back, current month, 12 months forward */
  const now = new Date();
  const options = [];
  for (let offset = -12; offset <= 12; offset++) {
    const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleString("en-US", { month: "long", year: "numeric" });
    options.push(`<option value="${key}"${key === SCHEDULE_MONTH_KEY ? " selected" : ""}>${label}</option>`);
  }
  /* Ensure current saved month is in the list even if outside ±12 */
  if (!options.some((o) => o.includes(`value="${SCHEDULE_MONTH_KEY}"`))) {
    const [y, m] = SCHEDULE_MONTH_KEY.split("-").map(Number);
    const d = new Date(y, m - 1, 1);
    options.unshift(`<option value="${SCHEDULE_MONTH_KEY}" selected>${d.toLocaleString("en-US", { month: "long", year: "numeric" })}</option>`);
  }
  sel.innerHTML = options.join("");
}

function syncEyebrow() {
  const eb = $("eyebrowMonth");
  if (!eb) return;
  const [y, m] = SCHEDULE_MONTH_KEY.split("-").map(Number);
  const label = new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  eb.textContent = `${label} · Pharmacy Schedule Management`;
}

function changeMonth(newKey) {
  if (!/^\d{4}-\d{2}$/.test(newKey) || newKey === SCHEDULE_MONTH_KEY) return;
  if (isDirty && !confirm("You have unsaved changes. Switch month and discard them?")) {
    $("monthSelect").value = SCHEDULE_MONTH_KEY;
    return;
  }
  SCHEDULE_MONTH_KEY = newKey;
  localStorage.setItem(SCHEDULE_MONTH_STORAGE_KEY, newKey);
  dateMeta = buildDateMeta(newKey);
  /* Reset per-month state — load fresh from storage / server */
  requests = {};
  parttimeAvailability = {};
  adminOverrides = {};
  allocationStarted = false;
  reqOffLocked = false;
  lockedDays = new Set();
  isDirty = false;
  syncEyebrow();
  loadState();
  /* Always attempt to load bookings — applyBookingsObject guards against
     overwriting locked / allocated state. */
  loadMonthlyBookingsIntoSchedule();
  render();
  setMessage(`Switched to ${$("monthSelect").selectedOptions[0]?.textContent || newKey}.`);
}

function init() {
  populateMonthPicker();
  syncEyebrow();
  renderStatusOptions($("newStatus"), "general");
  renderNewShiftSelects();
  renderStatusRules();
  loadState();
  loadMonthlyBookingsIntoSchedule();
  $("monthSelect").addEventListener("change", (e) => changeMonth(e.target.value));
  $("targetMode").addEventListener("change", () => { updateManualTargetUi(); markDirty(); render(); });
  $("manualTarget").addEventListener("change", () => { markDirty(); render(); });
  $("minOff").addEventListener("change", () => { markDirty(); render(); });
  $("maxStreak").addEventListener("change", () => { markDirty(); render(); });
  $("maxConsecNights").addEventListener("change", () => { markDirty(); render(); });
  $("btnAuto").addEventListener("click", () => { allocationStarted = true; reqOffLocked = true; viewMode = "auto"; markDirty(); setMessage("Auto allocation generated. REQ OFF and admin changes are protected."); render(); });
  $("btnReloadBookings").addEventListener("click", () => {
    if (allocationStarted) { setMessage("Cannot reload after Auto Allocate. Reset by switching month first."); return; }
    /* Force unlock so bookings can flow back in */
    reqOffLocked = false;
    loadMonthlyBookingsIntoSchedule();
    markDirty();
    render();
    setMessage("Re-pulled bookings from the booking page / server.");
  });
  $("btnRegenerate").addEventListener("click", regenerateSchedule);
  $("btnRegenerateSetup").addEventListener("click", regenerateSchedule);
  $("btnSaveState").addEventListener("click", saveState);
  $("btnResetView").addEventListener("click", () => { viewMode = "auto"; render(); });
  $("btnAdd").addEventListener("click", addPharmacist);
  $("btnAddShift").addEventListener("click", addShift);
  $("btnExport").addEventListener("click", exportCsv);
  $("btnPrintTable").addEventListener("click", printScheduleTable);
  $("btnSaveShift").addEventListener("click", saveAdminShift);
  $("btnClearShift").addEventListener("click", clearAdminShift);
  $("btnCloseEditor").addEventListener("click", closeShiftEditor);
  $("shiftEditor").addEventListener("click", (e) => { if (e.target.id === "shiftEditor") closeShiftEditor(); });
  window.addEventListener("beforeunload", (event) => {
    if (!isDirty) return;
    event.preventDefault();
    event.returnValue = "You have unsaved schedule changes.";
  });
  /* Cross-tab sync: when booking.html changes the selected month or saves
     new bookings, refresh this page when the user returns to it. */
  window.addEventListener("focus", () => {
    const sharedMonth = localStorage.getItem(SCHEDULE_MONTH_STORAGE_KEY);
    if (sharedMonth && sharedMonth !== SCHEDULE_MONTH_KEY) {
      $("monthSelect").value = sharedMonth;
      changeMonth(sharedMonth);
    } else {
      /* Same month — but bookings may have changed; pull them again */
      loadMonthlyBookingsIntoSchedule();
      render();
    }
  });
  setupTabs();
  updateManualTargetUi();
  render();
}

init();
