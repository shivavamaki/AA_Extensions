const statusProfiles = {
  general: {
    label: "General Pharmacy",
    targetFactor: 1,
    canNight: true,
    canWeekend: true,
    maxNight: 6,
    maxWeekend: 6,
    shiftPreference: ["Clinic", "OPD", "IPD", "Night", "Floor2", "Special"],
    description: "Can fill all required operational shifts except Office. Special is allowed only by admin manual assignment."
  },
  clinical: {
    label: "Clinical Pharmacy",
    targetFactor: 1,
    canNight: false,
    canWeekend: false,
    maxNight: 0,
    maxWeekend: 1,
    shiftPreference: ["Clinic"],
    description: "Must fill Clinic shifts first. If C1/C2 are already filled that day, can cover other non-night shifts."
  },
  hod: {
    label: "HOD",
    targetFactor: 0,
    canNight: false,
    canWeekend: false,
    maxNight: 0,
    maxWeekend: 0,
    shiftPreference: ["Office", "Special"],
    description: "Can only fill Office and Special shifts; excluded from common required shift allocation."
  },
  deputy: {
    label: "Deputy",
    targetFactor: 0.85,
    canNight: false,
    canWeekend: true,
    maxNight: 0,
    maxWeekend: 2,
    shiftPreference: ["Office", "OPD", "IPD", "Clinic", "Floor2"],
    description: "Default office shift 08:00-16:00. Can cover other non-night shifts only if manpower is not enough."
  },
  parttime: {
    label: "Part time",
    targetFactor: 0.45,
    canNight: false,
    canWeekend: true,
    maxNight: 0,
    maxWeekend: 8,
    shiftPreference: ["OPD", "IPD", "Office", "Floor2", "Special"],
    description: "Can be allocated only on self-booked available days. Night shift is not allowed."
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
  "7-16O": { label: "7-16O", hours: 9, type: "OPD", dayGroup: "both" },
  "10-20M": { label: "10-20M", hours: 10, type: "OPD", dayGroup: "both" },
  "9-18O": { label: "9-18O", hours: 9, type: "OPD", dayGroup: "both" },
  "20-7O": { label: "20-7O", hours: 11, type: "Night", dayGroup: "both" },
  "20-7I": { label: "20-7I", hours: 11, type: "Night", dayGroup: "both" },
  "9-20F2": { label: "9-20F2", hours: 11, type: "Floor2", dayGroup: "both" },
  "9-16CHE": { label: "9-16CHE", hours: 7, type: "Special", dayGroup: "both", special: true, optional: true },
  "T": { label: "T", hours: 8, type: "Special", dayGroup: "both", special: true, optional: true }
};

const dateMeta = Array.from({ length: 30 }, (_, i) => {
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dow = weekdays[i % 7];
  return { day: i + 1, dow, weekend: dow === "Sat" || dow === "Sun", saturday: dow === "Sat", sunday: dow === "Sun" };
});

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
const STORAGE_KEY = "pharmacyScheduleStateV5_BOOKING";
const BOOKING_STORAGE_KEY = "pharmacyMonthlyBookingsV1";
const SCHEDULE_MONTH_KEY = "2026-06";

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
      if (p.status === "hod") return makeOffCell(false);
      if (requests[p.id]?.includes(dayIndex)) return makeOffCell(true);
      if (p.status === "parttime") return parttimeAvailability[p.id]?.includes(dayIndex) ? makePartTimeAvailableCell() : makeOffCell(false);
      return makeOffCell(false);
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
    if (type === "Night" || type === "Office") return false;
    if (type === "Clinic") return true;
    return clinicalShiftsAlreadyFilled(rows, dayIndex);
  }
  if (person.status === "deputy") return type !== "Night";
  if (person.status === "parttime") {
    const available = (parttimeAvailability[person.id] || []).includes(dayIndex);
    return available && type !== "Night" && type !== "Office";
  }
  return type !== "Office";
}

function createRuleBasedSchedule() {
  const target = targetHours();
  const minOffPerMonth = Number($("minOff").value) || 0;
  const maxConsecutiveWork = Number($("maxStreak").value) || 6;
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

  Object.entries(rows).forEach(([id, cells]) => {
    cells.forEach((c, i) => {
      hours[id] += getHours(c);
      if (dateMeta[i].weekend && !["OFF", "REQ_OFF", "PT_AVAILABLE"].includes(c.normalized)) weekends[id] += 1;
      if (isNight(c)) nights[id] += 1;
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

  function canAssign(person, dayIndex, shift) {
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
    if (isNight(shift) && nights[person.id] >= profile.maxNight) return false;
    if (date.weekend && weekends[person.id] >= profile.maxWeekend) return false;
    const prev = rows[person.id][dayIndex - 1];
    if (prev && isNight(prev) && !isNight(shift)) return false;
    if (consecutiveBefore(person.id, dayIndex) >= maxConsecutiveWork) return false;
    const currentOff = rows[person.id].filter((c) => c.normalized === "OFF" || c.normalized === "REQ_OFF").length;
    const remainingDays = 30 - dayIndex - 1;
    if (person.status !== "parttime" && currentOff <= minOffPerMonth && remainingDays < minOffPerMonth) return false;
    return true;
  }

  dateMeta.forEach((date, dayIndex) => {
    coverage(date).forEach((shift) => {
      if (dayHasShift(rows, dayIndex, shift)) return;
      const shiftType = getShiftType(shift);
      const isOffice = shiftType === "Office";
      const isClinicalCore = shiftType === "Clinic";
      const candidates = staff
        .filter((p) => canAssign(p, dayIndex, shift))
        .sort((a, b) => {
          const profileA = statusProfiles[a.status] ?? statusProfiles.general;
          const profileB = statusProfiles[b.status] ?? statusProfiles.general;
          const preferenceA = profileA.shiftPreference.includes(shiftType) ? 16 : -30;
          const preferenceB = profileB.shiftPreference.includes(shiftType) ? 16 : -30;
          const targetGapA = (target[a.id] - hours[a.id]) * 1.25;
          const targetGapB = (target[b.id] - hours[b.id]) * 1.25;
          const burdenA = weekends[a.id] * (date.weekend ? 5 : 2) + nights[a.id] * (isNight(shift) ? 8 : 3);
          const burdenB = weekends[b.id] * (date.weekend ? 5 : 2) + nights[b.id] * (isNight(shift) ? 8 : 3);
          const statusPenaltyA =
            a.status === "hod" ? 999 :
            a.status === "clinical" && isClinicalCore ? -45 :
            a.status === "clinical" && !isClinicalCore ? 12 :
            a.status === "deputy" && isOffice ? -25 :
            a.status === "deputy" && !isOffice ? 18 :
            a.status === "parttime" && !date.weekend ? 8 : 0;
          const statusPenaltyB =
            b.status === "hod" ? 999 :
            b.status === "clinical" && isClinicalCore ? -45 :
            b.status === "clinical" && !isClinicalCore ? 12 :
            b.status === "deputy" && isOffice ? -25 :
            b.status === "deputy" && !isOffice ? 18 :
            b.status === "parttime" && !date.weekend ? 8 : 0;
          const rotateA = ((Number(a.id.replace("P", "")) || 0) * 17 + dayIndex * 7 + allocationRun * 13) % 11;
          const rotateB = ((Number(b.id.replace("P", "")) || 0) * 17 + dayIndex * 7 + allocationRun * 13) % 11;
          return (targetGapB + preferenceB - burdenB - statusPenaltyB + rotateB) - (targetGapA + preferenceA - burdenA - statusPenaltyA + rotateA);
        });
      const picked = candidates[0];
      if (!picked) return;
      const normalized = normalizeShift(shift);
      rows[picked.id][dayIndex] = { code: shift, normalized, requested: false, ptAvailable: false, locked: false };
      hours[picked.id] += shiftTemplates[normalized]?.hours ?? 0;
      if (date.weekend) weekends[picked.id] += 1;
      if (isNight(shift)) nights[picked.id] += 1;
    });
  });

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
    cells.forEach((c) => {
      if (["OFF", "REQ_OFF", "PT_AVAILABLE"].includes(c.normalized)) streak = 0;
      else {
        streak += 1;
        maxStreak = Math.max(maxStreak, streak);
      }
    });
    return { ...p, total, target: target[p.id] ?? p.target, diff: total - (target[p.id] ?? p.target), off, requestedOff, requestedSat, requestedSun, ptAvailable, adminChanged, night, weekend, maxStreak };
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
    if (r.weekend > profile.maxWeekend) violations.push(`${r.name}: weekend shift exceeds ${profile.label} limit`);
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

function getDailyShiftOptions(dayIndex, person) {
  const day = dateMeta[dayIndex];
  let shifts = [...getCoverageShiftsForDay(day), ...Object.keys(shiftTemplates).filter((code) => shiftTemplates[code]?.special && shiftAllowedOnDay(code, day))];
  const current = lastSchedule[person.id]?.[dayIndex];
  const currentNormalized = current?.manual ? current.normalized : null;
  const typeAllowed = (shift) => {
    const normalized = normalizeShift(shift);
    const type = getShiftType(shift);
    if (normalized === "REQ_OFF") return false;
    const prev = lastSchedule[person.id]?.[dayIndex - 1];
    if (prev && isNight(prev) && type !== "Night" && normalized !== "OFF") return false;
    if (!roleCanFillShift(person, normalized, dayIndex, lastSchedule) && normalized !== "OFF" && normalized !== "PT_AVAILABLE") return false;
    if (type === "Night" && !(statusProfiles[person.status] || statusProfiles.general).canNight) return false;
    return shiftAllowedOnDay(normalized, day);
  };
  shifts = shifts.filter(typeAllowed).filter((shift) => !dayHasShift(lastSchedule, dayIndex, shift, person.id) || normalizeShift(shift) === currentNormalized);
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
  const options = getDailyShiftOptions(dayIndex, person);
  const select = $("shiftSelect");
  const ptAvailable = (parttimeAvailability[personId] || []).includes(dayIndex);
  let optionHtml = `<option value="OFF">OFF / No operational shift</option>`;
  if (person.status === "parttime") {
    optionHtml += `<option value="PT_AVAILABLE" ${cell.normalized === "PT_AVAILABLE" ? "selected" : ""}>Part-time available only</option>`;
  }
  const regularOptions = options.filter((shift) => !shiftTemplates[normalizeShift(shift)]?.special);
  const specialOptions = options.filter((shift) => shiftTemplates[normalizeShift(shift)]?.special);
  optionHtml += regularOptions.map((shift) => `<option value="${shift}" ${cell.normalized === normalizeShift(shift) ? "selected" : ""}>${shiftTemplates[normalizeShift(shift)]?.label || shift} · ${shiftTemplates[normalizeShift(shift)]?.hours || 0} hr</option>`).join("");
  if (specialOptions.length) {
    optionHtml += `<optgroup label="─── Special ───">${specialOptions.map((shift) => `<option value="${shift}" ${cell.normalized === normalizeShift(shift) ? "selected" : ""}>${shiftTemplates[normalizeShift(shift)]?.label || shift} · ${shiftTemplates[normalizeShift(shift)]?.hours || 0} hr</option>`).join("")}</optgroup>`;
  }
  select.innerHTML = optionHtml;
  select.value = override?.shift || (cell.manual ? cell.normalized : cell.normalized === "PT_AVAILABLE" ? "PT_AVAILABLE" : cell.normalized === "REQ_OFF" ? "OFF" : cell.normalized);
  if (!select.value || !Array.from(select.options).some((opt) => opt.value === select.value)) select.value = "OFF";
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
    removeOverride(personId, dayIndex);
    setMessage(`Set OFF / cleared operational shift: ${person?.name} day ${dayIndex + 1}`);
  } else if (person?.status === "parttime" && shift === "PT_AVAILABLE") {
    const current = parttimeAvailability[personId] || [];
    if (!current.includes(dayIndex)) parttimeAvailability[personId] = [...current, dayIndex].sort((a, b) => a - b);
    removeOverride(personId, dayIndex);
    setMessage(`Marked part-time available: ${person.name} day ${dayIndex + 1}`);
  } else {
    if (!roleCanFillShift(person, shift, dayIndex, lastSchedule)) {
      setMessage(`${person?.name || "Selected pharmacist"} cannot fill ${shift} by role/shift restriction.`);
      return;
    }
    const duplicateNames = staff
      .filter((p) => p.id !== personId && isOperationalShiftCode(shift) && normalizeShift(lastSchedule[p.id]?.[dayIndex]?.normalized) === normalizeShift(shift))
      .map((p) => p.name);
    setOverride(personId, dayIndex, shift, remark);
    const duplicateText = duplicateNames.length ? ` Duplicate ${normalizeShift(shift)} was cleared from: ${duplicateNames.join(", ")}.` : "";
    setMessage(`Admin changed shift: ${person?.name} day ${dayIndex + 1} → ${shift}. Remark saved.${duplicateText}`);
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

function saveState() {
  const state = {
    staff, requests, parttimeAvailability, adminOverrides, shiftTemplates, allocationRun, allocationStarted, reqOffLocked, lockedDays: [...lockedDays],
    settings: {
      targetMode: $("targetMode")?.value,
      manualTarget: $("manualTarget")?.value,
      minOff: $("minOff")?.value,
      maxStreak: $("maxStreak")?.value
    }
  };
  if (!allocationStarted) reqOffLocked = true;
  state.reqOffLocked = reqOffLocked;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  fetch('http://10.134.110.81:8765/api/schedule/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  }).catch(() => {});
  clearDirty();
  setMessage(allocationStarted ? "State saved. Closing or refreshing the page will keep this schedule." : "REQ OFF / PT availability saved and locked. Click Auto Allocate to generate shifts.");
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
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      fetch('http://10.134.110.81:8765/api/schedule/state')
        .then(r => r.ok ? r.json() : null)
        .then(state => {
          if (state && typeof state === 'object') {
            applyState(state);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
            clearDirty();
            render();
            setTimeout(() => setMessage("Loaded saved state from server."), 0);
          }
        })
        .catch(() => {});
      return false;
    }
    const state = JSON.parse(raw);
    applyState(state);
    clearDirty();
    setTimeout(() => setMessage("Loaded saved state from this browser."), 0);
    return true;
  } catch (err) {
    console.warn("Could not load saved state", err);
    return false;
  }
}

function renderStatusOptions(select, selected) {
  select.innerHTML = Object.entries(statusProfiles).map(([key, s]) => `<option value="${key}" ${selected === key ? "selected" : ""}>${s.label}</option>`).join("");
}

function renderStatusRules() {
  $("statusRules").innerHTML = Object.entries(statusProfiles).map(([key, s]) => `
    <div class="rule-item">
      <strong>${s.label}</strong>
      <div>Target factor ${s.targetFactor} · Max night ${s.maxNight} · Max weekend ${s.maxWeekend}</div>
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
      const cell = lastSchedule[p.id]?.[i] ?? makeOffCell(false);
      const display = cell.code === "REQ OFF" ? "REQ" : cell.code === "PT Available" ? "PT" : `${cell.code}${cell.manual ? " ✎" : ""}`;
      const title = cell.manual ? `${cell.code} · Admin change: ${cell.remark || "Changed by admin"}` : cell.code;
      html += `<td class="${d.weekend ? "weekend" : ""}"><button class="cell-btn ${cellClass(cell, d.weekend)}" data-id="${p.id}" data-day="${i}" title="${title}">${display}</button></td>`;
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
  setMessage("Regenerated allocation. REQ OFF and admin edited cells are kept locked.");
  render();
}

function loadMonthlyBookingsIntoSchedule() {
  try {
    const all = JSON.parse(localStorage.getItem(BOOKING_STORAGE_KEY) || "{}");
    const month = all[SCHEDULE_MONTH_KEY];
    if (!month) return false;
    requests = {};
    parttimeAvailability = {};
    Object.entries(month.requests || {}).forEach(([personId, days]) => {
      const person = staff.find((p) => p.id === personId);
      if (!person) return;
      const indexes = (days || []).map((day) => Number(day) - 1).filter((i) => Number.isInteger(i) && i >= 0 && i < dateMeta.length);
      if (person.status === "parttime") parttimeAvailability[personId] = indexes;
      else if (person.status !== "hod") requests[personId] = indexes;
    });
    setMessage(`Loaded pharmacist bookings for ${SCHEDULE_MONTH_KEY}. Save state to lock before auto allocation.`);
    return true;
  } catch (err) {
    console.warn("Cannot load monthly bookings", err);
    return false;
  }
}

function init() {
  renderStatusOptions($("newStatus"), "general");
  renderNewShiftSelects();
  renderStatusRules();
  const hasSavedState = loadState();
  if (!hasSavedState) loadMonthlyBookingsIntoSchedule();
  $("targetMode").addEventListener("change", () => { updateManualTargetUi(); markDirty(); render(); });
  $("manualTarget").addEventListener("change", () => { markDirty(); render(); });
  $("minOff").addEventListener("change", () => { markDirty(); render(); });
  $("maxStreak").addEventListener("change", () => { markDirty(); render(); });
  $("btnAuto").addEventListener("click", () => { allocationStarted = true; reqOffLocked = true; viewMode = "auto"; markDirty(); setMessage("Auto allocation generated. REQ OFF and admin changes are protected."); render(); });
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
  setupTabs();
  updateManualTargetUi();
  render();
}

init();
