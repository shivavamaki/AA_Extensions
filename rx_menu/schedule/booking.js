const BOOKING_STORAGE_KEY = "pharmacyMonthlyBookingsV1";

let pharmacists = [
  { id: "P01", name: "เกษราภรณ์", status: "hod" },
  { id: "P02", name: "อัปสร", status: "general" },
  { id: "P03", name: "ปิยะธิดา", status: "general" },
  { id: "P04", name: "ภัทรานิษฐ์", status: "clinical" },
  { id: "P05", name: "สุจีรา", status: "general" },
  { id: "P06", name: "อลิสาร์", status: "general" },
  { id: "P07", name: "ชนนาถ", status: "general" },
  { id: "P08", name: "ปัทมพร", status: "deputy" },
  { id: "P09", name: "เบญศ์", status: "general" },
  { id: "P10", name: "ปุณยพร", status: "general" },
  { id: "P11", name: "เปรมวนันท์", status: "clinical" },
  { id: "P12", name: "เมราวี", status: "general" },
  { id: "P13", name: "พิจารณ", status: "general" },
  { id: "P14", name: "ศิราวุธ", status: "general" },
  { id: "P15", name: "อนัญญา", status: "general" },
  { id: "P16", name: "นาตยา", status: "general" },
  { id: "P17", name: "ชนนวา", status: "general" },
  { id: "P18", name: "ธัญนิตา", status: "general" },
  { id: "P19", name: "อุดมชัย", status: "general" },
  { id: "P20", name: "ภาณนี", status: "parttime" }
];

const statusLabel = {
  general: "General Pharmacy",
  clinical: "Clinical Pharmacy",
  hod: "HOD",
  deputy: "Deputy",
  parttime: "Part time"
};

let bookings = loadBookings();
let selectedPersonId = pharmacists[1].id;
let selectedMonth = "";
let dirty = false;

const $ = (id) => document.getElementById(id);

function pad(n) { return String(n).padStart(2, "0"); }
function monthKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`; }
function monthLabel(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
}

function makeMonthOptions() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear() + 1, 11, 1);
  const months = [];
  for (let d = new Date(start); d <= end; d.setMonth(d.getMonth() + 1)) months.push(monthKey(d));
  return months;
}

function loadBookings() {
  try { return JSON.parse(localStorage.getItem(BOOKING_STORAGE_KEY) || "{}"); }
  catch { return {}; }
}

function saveBookings() {
  localStorage.setItem(BOOKING_STORAGE_KEY, JSON.stringify(bookings));
  fetch('http://10.134.110.81:8765/api/schedule/bookings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(bookings)
  }).catch(() => {});
  dirty = false;
  setStatus("Booking saved. Scheduler page can load matching month bookings on first open.");
}

function ensureMonth(key) {
  if (!bookings[key]) bookings[key] = { requests: {}, updatedAt: null };
  if (!bookings[key].requests) bookings[key].requests = {};
}

function selectedDays(personId = selectedPersonId, key = selectedMonth) {
  ensureMonth(key);
  return bookings[key].requests[personId] || [];
}

function setSelectedDays(days) {
  ensureMonth(selectedMonth);
  bookings[selectedMonth].requests[selectedPersonId] = [...days].sort((a, b) => a - b);
  bookings[selectedMonth].updatedAt = new Date().toISOString();
  dirty = true;
}

function getPerson() { return pharmacists.find((p) => p.id === selectedPersonId); }

function validateAddDay(day) {
  const person = getPerson();
  if (person.status === "hod") return { ok: false, reason: "HOD is excluded from operational schedule. Booking is not required." };
  if (person.status === "parttime") return { ok: true, reason: "" };
  const days = selectedDays();
  if (days.includes(day)) return { ok: true, reason: "" };
  if (days.length >= 5) return { ok: false, reason: "Maximum requested OFF is 5 days/month." };
  const [y, m] = selectedMonth.split("-").map(Number);
  const nextDate = new Date(y, m - 1, day);
  const dow = nextDate.getDay();
  const satCount = days.filter((d) => new Date(y, m - 1, d).getDay() === 6).length;
  const sunCount = days.filter((d) => new Date(y, m - 1, d).getDay() === 0).length;
  if (dow === 6 && satCount >= 1) return { ok: false, reason: "Only 1 requested Saturday OFF is allowed per month." };
  if (dow === 0 && sunCount >= 1) return { ok: false, reason: "Only 1 requested Sunday OFF is allowed per month." };
  return { ok: true, reason: "" };
}

function setStatus(text) { $("statusBox").textContent = text; }

function renderControls() {
  $("personSelect").innerHTML = pharmacists.map((p) => `<option value="${p.id}">${p.name} · ${statusLabel[p.status]}</option>`).join("");
  $("personSelect").value = selectedPersonId;
  const months = makeMonthOptions();
  if (!selectedMonth) selectedMonth = months.includes("2026-06") ? "2026-06" : months[0];
  $("monthSelect").innerHTML = months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("");
  $("monthSelect").value = selectedMonth;
}

function renderCalendar() {
  const person = getPerson();
  const [y, m] = selectedMonth.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const firstDow = first.getDay();
  const days = selectedDays();
  const modeText = person.status === "parttime" ? "available work day" : "requested OFF";
  $("calendarTitle").innerHTML = `<span>${monthLabel(selectedMonth)}</span><span>${person.name} · ${statusLabel[person.status]} · ${days.length} selected</span>`;
  let html = "";
  for (let i = 0; i < firstDow; i++) html += `<div class="day-cell blank"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const dt = new Date(y, m - 1, day);
    const weekend = dt.getDay() === 0 || dt.getDay() === 6;
    const selected = days.includes(day);
    const selectedClass = selected ? (person.status === "parttime" ? "selected pt" : "selected req") : "";
    html += `<button class="day-cell ${weekend ? "weekend" : ""} ${selectedClass}" data-day="${day}" type="button">
      <span><span class="day-number">${day}</span><br><span class="day-dow">${dt.toLocaleString("en-US", { weekday: "short" })}</span></span>
      <span class="badge">${selected ? (person.status === "parttime" ? "Available" : "REQ OFF") : "Click"}</span>
    </button>`;
  }
  $("calendarGrid").innerHTML = html;
  document.querySelectorAll(".day-cell[data-day]").forEach((btn) => {
    btn.addEventListener("click", () => toggleDay(Number(btn.dataset.day)));
  });
  setStatus(`${person.name}: click date to toggle ${modeText}. Regular staff max 5 days/month, max 1 Saturday and 1 Sunday.`);
}

function toggleDay(day) {
  const days = selectedDays();
  if (days.includes(day)) {
    setSelectedDays(days.filter((d) => d !== day));
    setStatus(`Removed day ${day}.`);
  } else {
    const check = validateAddDay(day);
    if (!check.ok) { setStatus(check.reason); return; }
    setSelectedDays([...days, day]);
    setStatus(`Added day ${day}.`);
  }
  renderCalendar();
  renderSummary();
}

function renderSummary() {
  ensureMonth(selectedMonth);
  const [y, m] = selectedMonth.split("-").map(Number);
  const rows = pharmacists.map((p) => {
    const days = bookings[selectedMonth].requests[p.id] || [];
    const sat = days.filter((d) => new Date(y, m - 1, d).getDay() === 6).length;
    const sun = days.filter((d) => new Date(y, m - 1, d).getDay() === 0).length;
    const ok = p.status === "parttime" || p.status === "hod" || (days.length <= 5 && sat <= 1 && sun <= 1);
    const label = p.status === "parttime" ? "Available" : p.status === "hod" ? "N/A" : "REQ OFF";
    return `<tr>
      <td>${p.name}</td><td>${statusLabel[p.status]}</td><td>${label}</td><td>${days.join(", ") || "-"}</td><td>${days.length}</td><td>${sat}</td><td>${sun}</td><td class="${ok ? "ok" : "bad"}">${ok ? "OK" : "Check rule"}</td>
    </tr>`;
  }).join("");
  $("summaryTable").innerHTML = `<table><thead><tr><th>Name</th><th>Status</th><th>Mode</th><th>Days</th><th>Total</th><th>Sat</th><th>Sun</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function clearSelectedMonth() {
  if (!confirm(`Clear all bookings for ${monthLabel(selectedMonth)}?`)) return;
  ensureMonth(selectedMonth);
  bookings[selectedMonth].requests = {};
  bookings[selectedMonth].updatedAt = new Date().toISOString();
  dirty = true;
  renderCalendar();
  renderSummary();
  setStatus("Selected month cleared. Click Save booking to persist.");
}

function init() {
  renderControls();
  ensureMonth(selectedMonth);
  renderCalendar();
  renderSummary();

  const loadBookingsFromServer = () => {
    if (!localStorage.getItem(BOOKING_STORAGE_KEY)) {
      fetch('http://10.134.110.81:8765/api/schedule/bookings')
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data && typeof data === 'object' && !Array.isArray(data)) {
            bookings = data;
            localStorage.setItem(BOOKING_STORAGE_KEY, JSON.stringify(bookings));
            ensureMonth(selectedMonth);
            renderCalendar();
            renderSummary();
            setStatus("Bookings loaded from server.");
          }
        })
        .catch(() => {});
    }
  };

  fetch('http://10.134.110.81:8765/api/schedule/state')
    .then(r => r.ok ? r.json() : null)
    .then(state => {
      if (state && Array.isArray(state.staff) && state.staff.length > 0) {
        pharmacists = state.staff.map(p => ({ id: p.id, name: p.name, status: p.status }));
        if (!pharmacists.find(p => p.id === selectedPersonId)) selectedPersonId = pharmacists.find(p => p.status !== 'hod')?.id || pharmacists[0].id;
        renderControls();
        renderCalendar();
        renderSummary();
      }
    })
    .catch(() => {})
    .finally(loadBookingsFromServer);
  $("personSelect").addEventListener("change", (e) => { selectedPersonId = e.target.value; renderCalendar(); });
  $("monthSelect").addEventListener("change", (e) => { selectedMonth = e.target.value; ensureMonth(selectedMonth); renderCalendar(); renderSummary(); });
  $("btnSave").addEventListener("click", saveBookings);
  $("btnClear").addEventListener("click", clearSelectedMonth);
  $("btnPrint").addEventListener("click", () => window.print());
  window.addEventListener("beforeunload", (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "Unsaved booking changes.";
  });
}

init();
