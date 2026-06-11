const BOOKING_STORAGE_KEY = "pharmacyMonthlyBookingsV1";
const RULES_STORAGE_KEY   = "pharmacyBookingRulesV1";
/* Shared with scheduler index.html so both pages open on the same month */
const SHARED_MONTH_KEY    = "pharmacyScheduleSelectedMonthV1";

const DEFAULT_RULES = { maxDays: 5, maxSat: 1, maxSun: 1 };
let bookingRules = loadRules();

/* Preset note categories — admin can choose one or type a custom note */
const NOTE_CATEGORIES = [
  "ลาพักร้อน",
  "ลากิจ",
  "ลาป่วย",
  "อบรม / สัมมนา",
  "Prefer morning",
  "Prefer evening",
  "Prefer day off",
  "Family / personal",
  "Other",
];

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

function loadRules() {
  try {
    const r = JSON.parse(localStorage.getItem(RULES_STORAGE_KEY) || "null");
    if (r && Number.isFinite(r.maxDays) && Number.isFinite(r.maxSat) && Number.isFinite(r.maxSun)) return r;
  } catch {}
  return { ...DEFAULT_RULES };
}

function saveRules() {
  localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(bookingRules));
  /* Push to server so every workstation gets the same rules */
  fetch('http://10.134.110.81:8765/api/schedule/state', { method: 'GET' })
    .then(r => r.ok ? r.json() : {})
    .then(state => {
      const merged = (state && typeof state === 'object' && !Array.isArray(state)) ? state : {};
      merged.bookingRules = { ...bookingRules };
      return fetch('http://10.134.110.81:8765/api/schedule/state', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged),
      });
    })
    .catch(() => {});
}

function renderRuleText() {
  document.querySelectorAll('[data-rule]').forEach(el => {
    const k = el.dataset.rule;
    if (bookingRules[k] !== undefined) el.textContent = bookingRules[k];
  });
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
  if (!bookings[key]) bookings[key] = { requests: {}, notes: {}, updatedAt: null };
  if (!bookings[key].requests) bookings[key].requests = {};
  if (!bookings[key].notes)    bookings[key].notes    = {};
}

/* Notes are stored as: bookings[month].notes[personId][day] = "preferred shift / reason" */
function getNote(day, personId = selectedPersonId, key = selectedMonth) {
  ensureMonth(key);
  const byPerson = bookings[key].notes[personId];
  return (byPerson && byPerson[day]) || "";
}

function setNote(day, text, personId = selectedPersonId, key = selectedMonth) {
  ensureMonth(key);
  if (!bookings[key].notes[personId]) bookings[key].notes[personId] = {};
  const t = String(text || "").trim();
  if (t) bookings[key].notes[personId][day] = t;
  else delete bookings[key].notes[personId][day];
  if (Object.keys(bookings[key].notes[personId]).length === 0) delete bookings[key].notes[personId];
  bookings[key].updatedAt = new Date().toISOString();
  dirty = true;
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
  if (days.length >= bookingRules.maxDays) return { ok: false, reason: `Maximum requested OFF is ${bookingRules.maxDays} days/month.` };
  const [y, m] = selectedMonth.split("-").map(Number);
  const nextDate = new Date(y, m - 1, day);
  const dow = nextDate.getDay();
  const satCount = days.filter((d) => new Date(y, m - 1, d).getDay() === 6).length;
  const sunCount = days.filter((d) => new Date(y, m - 1, d).getDay() === 0).length;
  if (dow === 6 && satCount >= bookingRules.maxSat) return { ok: false, reason: `Only ${bookingRules.maxSat} requested Saturday OFF allowed per month.` };
  if (dow === 0 && sunCount >= bookingRules.maxSun) return { ok: false, reason: `Only ${bookingRules.maxSun} requested Sunday OFF allowed per month.` };
  return { ok: true, reason: "" };
}

function setStatus(text) { $("statusBox").textContent = text; }

function renderControls() {
  $("personSelect").innerHTML = pharmacists.map((p) => `<option value="${p.id}">${p.name} · ${statusLabel[p.status]}</option>`).join("");
  $("personSelect").value = selectedPersonId;
  const months = makeMonthOptions();
  if (!selectedMonth) {
    /* Honour shared selection from the scheduler page if it exists,
       otherwise default to current month (the first option) so admin
       always lands on something useful. */
    const shared = localStorage.getItem(SHARED_MONTH_KEY);
    if (shared && months.includes(shared)) selectedMonth = shared;
    else selectedMonth = months[0];
  }
  /* Ensure the shared month is included even if outside the default ±range */
  if (!months.includes(selectedMonth)) months.unshift(selectedMonth);
  $("monthSelect").innerHTML = months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join("");
  $("monthSelect").value = selectedMonth;
  /* Persist so the scheduler page can pick it up */
  localStorage.setItem(SHARED_MONTH_KEY, selectedMonth);
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
    const note = getNote(day);
    /* Class set: req / pt for booked days, note-only for unbooked-but-noted */
    let extraClass = "";
    if (selected)      extraClass = person.status === "parttime" ? "selected pt" : "selected req";
    else if (note)     extraClass = "noted";

    const noteHtml = note
      ? `<span class="day-note" title="${note.replace(/"/g, "&quot;")}">📝 ${esc(truncate(note, 18))}</span>`
      : "";

    let badge;
    if (selected)      badge = person.status === "parttime" ? "Available" : "REQ OFF";
    else if (note)     badge = "📝 Note";
    else               badge = "Click";

    const cellTitle = note ? note.replace(/"/g, "&quot;") : "";
    html += `<button class="day-cell ${weekend ? "weekend" : ""} ${extraClass}" data-day="${day}" type="button" title="${cellTitle}">
      <span><span class="day-number">${day}</span><br><span class="day-dow">${dt.toLocaleString("en-US", { weekday: "short" })}</span></span>
      <span class="badge">${badge}</span>
      ${noteHtml}
    </button>`;
  }
  $("calendarGrid").innerHTML = html;
  document.querySelectorAll(".day-cell[data-day]").forEach((btn) => {
    btn.addEventListener("click", (e) => toggleDay(Number(btn.dataset.day), btn, e));
  });
  setStatus(`${person.name}: click date to toggle ${modeText}. Click again to add note. Regular staff max ${bookingRules.maxDays} days/month, max ${bookingRules.maxSat} Saturday and ${bookingRules.maxSun} Sunday.`);
}

/* Tiny helpers */
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

function toggleDay(day, btn, event) {
  /* Always open the editor — user chooses inside whether to
     book REQ OFF, save a note-only, or both. */
  openNoteEditor(day, btn, event);
}

/* Floating note + REQ OFF editor — appears on the clicked day cell.
   Two independent actions:
     • Toggle REQ OFF for the day
     • Save / remove a note (works on un-booked days too) */
function openNoteEditor(day, btn /*, event */) {
  closeNoteEditor();
  const person   = getPerson();
  const days     = selectedDays();
  const isBooked = days.includes(day);
  const current  = getNote(day);

  const catOptions = NOTE_CATEGORIES.map(c =>
    `<option value="${esc(c)}"${c === current ? " selected" : ""}>${esc(c)}</option>`
  ).join("");

  /* Part-time pharmacists use "Available" terminology; everyone else uses REQ OFF */
  const bookLabel    = person.status === "parttime" ? "Mark Available"   : "Set REQ OFF";
  const unbookLabel  = person.status === "parttime" ? "Unmark Available" : "Remove REQ OFF";

  const pop = document.createElement("div");
  pop.id = "note-popover";
  pop.className = "note-popover";
  pop.innerHTML = `
    <div class="note-pop-title">📅 Day ${day} · ${person.name}</div>
    <div class="note-pop-sub">${isBooked ? "Currently REQ OFF. Edit or remove below." : "Add REQ OFF, or just leave a note for the manager."} Manager may still override.</div>

    <label class="note-pop-lbl">หมวด / Category
      <select id="notePopCategory">
        <option value="">-- choose --</option>
        ${catOptions}
      </select>
    </label>
    <label class="note-pop-lbl">หมายเหตุ / Note
      <textarea id="notePopText" rows="3" placeholder="เช่น มีนัดหมอ, รบกวนเข้าเวรเช้า, etc.">${esc(current)}</textarea>
    </label>

    <div class="note-pop-btns">
      ${isBooked
        ? `<button id="notePopUnbook" type="button" class="danger">${unbookLabel}</button>`
        : `<button id="notePopBook"   type="button" class="warn">${bookLabel}</button>`}
      <button id="notePopSaveNote" type="button" class="primary">💾 Save note only</button>
      <button id="notePopCancel"   type="button">✕ Cancel</button>
    </div>`;
  document.body.appendChild(pop);

  /* Position popover near the clicked cell */
  const rect = btn.getBoundingClientRect();
  const popW = pop.offsetWidth  || 290;
  const popH = pop.offsetHeight || 260;
  let left = rect.left + window.scrollX;
  let top  = rect.bottom + window.scrollY + 6;
  if (left + popW > window.innerWidth - 8) left = window.innerWidth - popW - 8;
  if (top  + popH > window.innerHeight + window.scrollY - 8) top = rect.top + window.scrollY - popH - 6;
  pop.style.left = `${Math.max(8, left)}px`;
  pop.style.top  = `${Math.max(8, top)}px`;

  const taEl  = document.getElementById("notePopText");
  const catEl = document.getElementById("notePopCategory");
  catEl.addEventListener("change", () => {
    if (catEl.value && !taEl.value.trim()) taEl.value = catEl.value;
  });
  taEl.focus();
  taEl.select();

  /* Always save the note (or remove it) before processing booking change */
  function commitNote() { setNote(day, taEl.value); }

  /* Book / unbook handlers */
  const bookBtn = document.getElementById("notePopBook");
  if (bookBtn) bookBtn.addEventListener("click", () => {
    const check = validateAddDay(day);
    if (!check.ok) { setStatus(check.reason); return; }
    setSelectedDays([...selectedDays(), day]);
    commitNote();
    closeNoteEditor();
    renderCalendar();
    renderSummary();
    setStatus(`${bookLabel} for day ${day}.`);
  });
  const unbookBtn = document.getElementById("notePopUnbook");
  if (unbookBtn) unbookBtn.addEventListener("click", () => {
    setSelectedDays(selectedDays().filter(d => d !== day));
    commitNote();
    closeNoteEditor();
    renderCalendar();
    renderSummary();
    setStatus(`${unbookLabel} for day ${day}.`);
  });

  document.getElementById("notePopSaveNote").addEventListener("click", () => {
    commitNote();
    closeNoteEditor();
    renderCalendar();
    renderSummary();
    const t = (taEl.value || "").trim();
    setStatus(t ? `Note saved for day ${day}.` : `Cleared note for day ${day}.`);
  });
  document.getElementById("notePopCancel").addEventListener("click", closeNoteEditor);

  setTimeout(() => {
    function onDocClick(e) {
      if (!pop.contains(e.target)) {
        document.removeEventListener("mousedown", onDocClick);
        closeNoteEditor();
      }
    }
    document.addEventListener("mousedown", onDocClick);
  }, 0);
}
function closeNoteEditor() {
  const old = document.getElementById("note-popover");
  if (old) old.remove();
}

function renderSummary() {
  ensureMonth(selectedMonth);
  const [y, m] = selectedMonth.split("-").map(Number);
  const rows = pharmacists.map((p) => {
    const days = bookings[selectedMonth].requests[p.id] || [];
    const sat = days.filter((d) => new Date(y, m - 1, d).getDay() === 6).length;
    const sun = days.filter((d) => new Date(y, m - 1, d).getDay() === 0).length;
    const ok = p.status === "parttime" || p.status === "hod" || (days.length <= bookingRules.maxDays && sat <= bookingRules.maxSat && sun <= bookingRules.maxSun);
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

function openRuleEditor() {
  $("ruleMaxDays").value = bookingRules.maxDays;
  $("ruleMaxSat").value  = bookingRules.maxSat;
  $("ruleMaxSun").value  = bookingRules.maxSun;
  $("ruleCard").hidden   = false;
}
function closeRuleEditor() {
  $("ruleCard").hidden   = true;
}
function commitRuleEditor() {
  const d = parseInt($("ruleMaxDays").value, 10);
  const s = parseInt($("ruleMaxSat").value, 10);
  const u = parseInt($("ruleMaxSun").value, 10);
  if (!Number.isFinite(d) || d < 1 || d > 31) { setStatus("Max days must be 1–31."); return; }
  if (!Number.isFinite(s) || s < 0 || s > 5)  { setStatus("Max Saturdays must be 0–5."); return; }
  if (!Number.isFinite(u) || u < 0 || u > 5)  { setStatus("Max Sundays must be 0–5."); return; }
  bookingRules = { maxDays: d, maxSat: s, maxSun: u };
  saveRules();
  renderRuleText();
  renderCalendar();
  renderSummary();
  closeRuleEditor();
  setStatus(`Rules updated: max ${d} days/month, ${s} Sat, ${u} Sun.`);
}

function init() {
  renderControls();
  renderRuleText();
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
      if (state && typeof state === 'object') {
        if (Array.isArray(state.staff) && state.staff.length > 0) {
          pharmacists = state.staff.map(p => ({ id: p.id, name: p.name, status: p.status }));
          if (!pharmacists.find(p => p.id === selectedPersonId)) selectedPersonId = pharmacists.find(p => p.status !== 'hod')?.id || pharmacists[0].id;
        }
        if (state.bookingRules && Number.isFinite(state.bookingRules.maxDays)) {
          bookingRules = { ...DEFAULT_RULES, ...state.bookingRules };
          localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(bookingRules));
        }
        renderRuleText();
        renderControls();
        renderCalendar();
        renderSummary();
      }
    })
    .catch(() => {})
    .finally(loadBookingsFromServer);
  $("personSelect").addEventListener("change", (e) => { selectedPersonId = e.target.value; renderCalendar(); });
  $("monthSelect").addEventListener("change", (e) => {
    selectedMonth = e.target.value;
    localStorage.setItem(SHARED_MONTH_KEY, selectedMonth);
    ensureMonth(selectedMonth);
    renderCalendar();
    renderSummary();
  });
  $("btnSave").addEventListener("click", saveBookings);
  $("btnClear").addEventListener("click", clearSelectedMonth);
  $("btnPrint").addEventListener("click", () => window.print());
  $("btnEditRules").addEventListener("click", openRuleEditor);
  $("btnCloseRules").addEventListener("click", closeRuleEditor);
  $("btnRuleSave").addEventListener("click", commitRuleEditor);
  $("btnRuleCancel").addEventListener("click", closeRuleEditor);
  window.addEventListener("beforeunload", (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "Unsaved booking changes.";
  });
}

init();
