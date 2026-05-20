'use strict';

// ── Vaccine database ────────────────────────────────────────────
const VACCINES = [
  {
    name: 'BCG',
    route: 'ID',
    factor: 'STAT',
    schedule: [0],
    remark: '0.1 ml ไหล่ซ้าย ไม่ควรฉีดที่สะโพก',
    remarkExtra: null,
    available: null,
  },
  {
    name: 'Dengvaxia Vaccine (0.5 mL)',
    route: null,
    factor: 'month',
    schedule: [0, 6, 12],
    remark: 'Dengvaxia 6–45 yrs และเคยติดเชื้อมาก่อน\nไม่แนะนำในผู้ที่ไม่เคยติดเชื้อมาก่อน',
    remarkExtra: null,
    available: 'Dengvaxia Vaccine (0.5 mL)',
  },
  {
    name: 'dT (Diphtheria/Tetanus)',
    route: 'IM',
    factor: 'month',
    schedule: [0, 1, 6],
    remark: 'สำหรับเด็กอายุตั้งแต่ 7 ปีขึ้นไป\nใช้เป็น Dose กระตุ้น ในกรณีผู้ที่เคยได้รับวัคซีนครบ Course แล้ว\nควรฉีดกระตุ้นทุกๆ 10 ปี',
    remarkExtra: null,
    available: 'Diphtheria/Tetanus VAC(dT, Single Adult) (0.5 mL)',
  },
  {
    name: 'DTP (Boostrix)',
    route: null,
    factor: 'STAT',
    schedule: [0],
    remark: 'Boostrix, Boostagen',
    remarkExtra: null,
    available: 'Boostrix Pfs Vaccine (0.5 Ml)',
  },
  {
    name: 'Hep A+B (Twinrix)',
    route: null,
    factor: 'month',
    schedule: [0, 1, 6],
    remark: 'Twinrix Vaccine',
    remarkExtra: null,
    available: 'Twinrix Vaccine',
  },
  {
    name: 'Hepatitis-A',
    route: null,
    factor: 'month',
    schedule: [0, 6],
    remark: 'เข็มที่ 2: 0, 6–18 เดือน\n1–15 ปี → Avaxim 80 U Pediatric\n16 ปีขึ้นไป → Avaxim 160 U\n1–18 ปี → Vaqta (0.5 ml); 19 ปีขึ้นไป → Vaqta (1 ml)\nกรณีต้องการฉีดกระตุ้นด้วย VAQTA สามารถฉีดหลังได้ HAVRIX ไปแล้ว 6–12 เดือน',
    remarkExtra: null,
    available: 'Avaxim 80 U Pediatric / Avaxim 160 U / Vaqta (Hepatitis A) VACCINE',
  },
  {
    name: 'Hepatitis-B',
    route: null,
    factor: 'month',
    schedule: [0, 1, 6],
    remark: 'Engerix-B, Euvax — 3 เข็ม: 0, 1–2, 6 เดือน\n16 ปีขึ้นไป ฉีด 1 ml\nฉีดกระตุ้นทุก 5 ปี',
    remarkExtra: null,
    available: 'Euvax-B (1 Ml) / Euvax-B (Ped) 0.5 Ml / Engerix-B (0.5 Ml) / Engerix-B (1 Ml)',
  },
  {
    name: 'HPV Vaccine (Gardasil)',
    route: null,
    factor: 'month',
    schedule: [0, 2, 6],
    remark: 'Gardasil\n>15 years: เข็ม 0, 1–2, 6 เดือน\n<15 years: เข็ม 0, 6–12 เดือน\nหากมีการเลื่อนนัด dose 3 ต้องห่างจาก dose 2 อย่างน้อย 4 เดือน',
    remarkExtra: null,
    available: 'Gardasil 0.5 Ml / Cervarix 0.5 Ml',
  },
  {
    name: 'Influenza',
    route: null,
    factor: 'STAT',
    schedule: [0],
    remark: 'Vaxigrip, Influvac — ฉีดปีละ 1 ครั้ง\n>3 ปี ฉีด 0.5 ml',
    remarkExtra: null,
    available: 'Fluquadri VACCINE (0.5 mL) / Fluquadri VACCINE Ped (0.25 mL)',
  },
  {
    name: 'Live JE (Imojev)',
    route: 'ID',
    factor: 'month',
    schedule: [0, 12],
    remark: 'Imojev 9 เดือนขึ้นไป ฉีด 2 เข็ม\nเข็มแรกที่อายุ 9–12 เดือน เข็มต่อมาห่างจากเข็มแรก 1–2 ปี\nในผู้ใหญ่ ไม่จำเป็นต้องฉีดกระตุ้นภายใน 5 ปี หลังฉีด Imojev เข็มแรก',
    remarkExtra: null,
    available: 'Imojev Vaccine (0.5 Ml)',
  },
  {
    name: 'Meningococcal (Menactra)',
    route: 'IM',
    factor: 'month',
    schedule: [0, 3],
    remark: 'Menactra\nอายุ 9–23 เดือน: 2 เข็ม ห่างกัน 3 เดือน\nอายุ 2–55 ปี: 1 เข็ม',
    remarkExtra: null,
    available: 'Menactra Vaccine (0.5 Ml) Vial',
  },
  {
    name: 'MMR (Priorix)',
    route: 'SC',
    factor: 'month',
    schedule: [0, 1, 9],
    remark: 'ฉีด 2 ครั้ง เข็มแรกเมื่ออายุ 9–12 เดือน เข็มที่ 2 เมื่ออายุ 18 เดือน\nในผู้ใหญ่ เข็ม 2 ห่างจากเข็มแรก 1 เดือน (ถ้ามีการระบาด/สัมผัสโรค/อยากฉีดให้ครบโดยเร็ว)',
    remarkExtra: null,
    available: 'Priorix PRTC 0.5 mL (MMR)',
  },
  {
    name: 'Pneumococcal (Synflorix/Prevnar)',
    route: 'IM',
    factor: 'month',
    schedule: [0, 2, 4],
    remark: 'Synflorix ฉีด 6 สัปดาห์–5 ปี\nPrevnar13 ฉีด 6 สัปดาห์ขึ้นไป\nให้ 3 ครั้ง ที่อายุ 2, 4, 6 เดือน (ห่างเข็มละ 2 เดือน)\nฉีดกระตุ้นที่อายุ 12–15 เดือน (ห่างเข็มสุดท้ายอย่างน้อย 2 เดือน)',
    remarkExtra: null,
    available: 'Synflorix Vaccine (0.5 Ml) / Prevnar 13 Vaccine (0.5 Ml)',
  },
  {
    name: 'Qdenga (Dengue)',
    route: null,
    factor: 'month',
    schedule: [0, 3],
    remark: 'Qdenga Dengue tetravalent vaccine (live, attenuated)\nTwo-dose schedule: 0 and 3 months',
    remarkExtra: null,
    available: 'Dengue tetravalent vaccine (live, attenuated)',
  },
  {
    name: 'Rabies ID',
    route: 'ID',
    factor: 'day',
    schedule: [0, 3, 7, 30],
    remark: 'Speeda, Verorab\nหลังสัมผัสโรค (ไม่เคยได้รับวัคซีน): ID 4 dose\nก่อนสัมผัสโรค: ID 2 dose (0, 7)',
    remarkExtra: null,
    available: 'Speeda',
  },
  {
    name: 'Rabies IM',
    route: 'IM',
    factor: 'day',
    schedule: [0, 3, 7, 14, 30],
    remark: 'Speeda, Verorab\nหลังสัมผัสโรค (ไม่เคยได้รับวัคซีน): IM 5 dose\nก่อนสัมผัสโรค: IM 2 dose (0, 7 หรือ 0, 21)',
    remarkExtra: null,
    available: 'Speeda',
  },
  {
    name: 'Rotavirus (Rotarix/Rotateq)',
    route: 'Oral',
    factor: 'month',
    schedule: [0, 2, 4],
    remark: 'Rotarix (human monovalent): 2 ครั้ง เมื่ออายุ 2, 4 เดือน\nRotaTeq/Rotasil (pentavalent): 3 ครั้ง เมื่ออายุ 2, 4, 6 เดือน\nเริ่มให้ครั้งแรกได้เมื่ออายุ 6–15 สัปดาห์ และครั้งสุดท้ายอายุไม่เกิน 8 เดือน',
    remarkExtra: 'การให้แต่ละครั้งห่างกันไม่น้อยกว่า 4 สัปดาห์',
    available: 'Rotarix (oral suspension) vaccine (1.5 ml.) / Rotateq vaccine (2 ml.)',
  },
  {
    name: 'TT (Tetanus Toxoid)',
    route: null,
    factor: 'month',
    schedule: [0, 1, 6],
    remark: 'Bio-TT',
    remarkExtra: null,
    available: 'Bio-TT',
  },
  {
    name: 'Typhoid (Typhim)',
    route: 'IM',
    factor: 'STAT',
    schedule: [0],
    remark: 'Typhim IM/SC Single dose\nตั้งแต่ 2 ปีขึ้นไป\nฉีดกระตุ้นทุก 3 ปี ถ้ายังมีโอกาสสัมผัสเชื้อ',
    remarkExtra: null,
    available: 'Typhim',
  },
  {
    name: 'Varicella (Varivax)',
    route: 'SC',
    factor: 'month',
    schedule: [0, 1],
    remark: 'Varivax SC — ฉีดทั้งหมด 2 เข็ม\nเด็กอายุ 1–12 ปี: Dose แรกอายุ 12–18 เดือน, Dose ที่ 2 อายุ 4–6 ปี\nอายุ 13 ปีขึ้นไป: 2 เข็ม ห่างกันอย่างน้อย 1 เดือน',
    remarkExtra: null,
    available: 'Varivax vaccine (0.5 ml.) vial',
  },
  {
    name: 'Gardasil 9',
    route: null,
    factor: 'month',
    schedule: [0, 2, 6],
    remark: 'Gardasil 9 — HPV 9-valent\n>15 years: เข็ม 0, 1–2, 6 เดือน\n<15 years: เข็ม 0, 6–12 เดือน',
    remarkExtra: null,
    available: null,
  },
];

// ── Date helpers ─────────────────────────────────────────────────
const TH_MONTHS_LONG  = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_DAYS         = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
const EN_DAYS         = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const EN_MONTHS       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function addDays(base, n) {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(base, n) {
  const d = new Date(base);
  d.setMonth(d.getMonth() + n);
  return d;
}

function calcDate(startDate, offset, factor) {
  if (factor === 'day')   return addDays(startDate, offset);
  if (factor === 'month') return addMonths(startDate, offset);
  return new Date(startDate);
}

function formatTH(date) {
  const wd = TH_DAYS[date.getDay()];
  const d  = date.getDate();
  const m  = TH_MONTHS_SHORT[date.getMonth()];
  const y  = date.getFullYear() + 543;
  return `วัน${wd}ที่ ${d} ${m} ${y}`;
}

function formatEN(date) {
  const wd = EN_DAYS[date.getDay()];
  const d  = date.getDate();
  const m  = EN_MONTHS[date.getMonth()];
  const y  = date.getFullYear();
  return `${wd} ${d} ${m} ${y}`;
}

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Schedule label ───────────────────────────────────────────────
function schedLabel(offset, factor, idx) {
  const num = `เข็มที่ ${idx + 1}`;
  if (factor === 'STAT') return `${num} (STAT)`;
  if (factor === 'day')  return offset === 0 ? `${num} — Day 0 (วันแรก)` : `${num} — Day ${offset}`;
  return offset === 0 ? `${num} — Month 0 (วันแรก)` : `${num} — Month ${offset}`;
}

function schedLabelShort(offset, factor) {
  if (factor === 'STAT') return 'STAT';
  if (factor === 'day')  return `Day ${offset}`;
  return `M${offset}`;
}

// ── Build one vaccine card ────────────────────────────────────────
const DOSE_COLORS = ['dose-1','dose-2','dose-3','dose-4','dose-5'];

function buildCard(vac, startDate) {
  const card = document.createElement('div');
  card.className = 'vac-card';

  // ── Header ──
  const head = document.createElement('div');
  head.className = 'vac-card-head';

  const nameEl = document.createElement('div');
  nameEl.className = 'vac-name';
  nameEl.textContent = vac.name;

  const badgeRow = document.createElement('div');
  badgeRow.className = 'badge-row';

  if (vac.route) {
    const rb = document.createElement('span');
    rb.className = `badge badge-route-${vac.route}`;
    rb.textContent = vac.route;
    badgeRow.appendChild(rb);
  }

  const fb = document.createElement('span');
  const factorLabel = vac.factor === 'day' ? 'Day' : vac.factor === 'month' ? 'Month' : 'STAT';
  fb.className = `badge badge-factor-${vac.factor}`;
  fb.textContent = vac.factor === 'STAT' ? 'STAT' : `${factorLabel}: ${vac.schedule.join('·')}`;
  badgeRow.appendChild(fb);

  head.appendChild(nameEl);
  head.appendChild(badgeRow);
  card.appendChild(head);

  // ── Dose table ──
  const table = document.createElement('table');
  table.className = 'dose-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th style="width:36px">#</th><th style="width:80px">นัด</th><th>วันที่</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  vac.schedule.forEach((offset, idx) => {
    const date = calcDate(startDate, offset, vac.factor);
    const isToday = idx === 0;

    const tr = document.createElement('tr');

    // # cell
    const tdNum = document.createElement('td');
    const numBadge = document.createElement('div');
    numBadge.className = `dose-num ${DOSE_COLORS[idx] || DOSE_COLORS[4]}`;
    numBadge.textContent = idx + 1;
    tdNum.appendChild(numBadge);
    tr.appendChild(tdNum);

    // Schedule cell
    const tdSched = document.createElement('td');
    tdSched.className = 'dose-sched';
    tdSched.textContent = schedLabelShort(offset, vac.factor);
    tr.appendChild(tdSched);

    // Dates cell
    const tdDate = document.createElement('td');
    const datesDiv = document.createElement('div');
    datesDiv.className = 'dose-dates';

    const thDate = document.createElement('div');
    thDate.className = 'dose-date-th';
    thDate.textContent = isToday ? `${formatTH(date)} ★ วันแรก` : formatTH(date);

    const enDate = document.createElement('div');
    enDate.className = 'dose-date-en';
    enDate.textContent = isToday ? `${formatEN(date)} ★ Day 0` : formatEN(date);

    datesDiv.appendChild(thDate);
    datesDiv.appendChild(enDate);
    tdDate.appendChild(datesDiv);
    tr.appendChild(tdDate);

    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  card.appendChild(table);

  // ── Note ──
  const noteSection = document.createElement('div');
  noteSection.className = 'vac-note';

  const noteToggle = document.createElement('button');
  noteToggle.className = 'vac-note-toggle';
  noteToggle.setAttribute('aria-expanded', 'false');

  const noteText = [vac.remark, vac.remarkExtra].filter(Boolean).join('\n\n');
  const noteLines = noteText ? noteText.trim() : '';

  noteToggle.innerHTML = `<span class="note-chevron">▲</span><span>หมายเหตุ / Note</span>`;

  const noteBody = document.createElement('div');
  noteBody.className = 'vac-note-body';
  noteBody.hidden = true;

  if (noteLines) {
    noteBody.textContent = noteLines;
  }

  if (vac.available) {
    const pill = document.createElement('div');
    pill.innerHTML = `<span class="avail-pill">💊 ${esc(vac.available)}</span>`;
    noteBody.appendChild(pill.firstChild);
  }

  noteToggle.addEventListener('click', () => {
    const open = noteToggle.getAttribute('aria-expanded') === 'true';
    noteToggle.setAttribute('aria-expanded', String(!open));
    noteBody.hidden = open;
  });

  noteSection.appendChild(noteToggle);
  noteSection.appendChild(noteBody);
  card.appendChild(noteSection);

  return card;
}

// ── State ────────────────────────────────────────────────────────
let currentLang   = 'both';
let currentFactor = 'all';
let currentSearch = '';

// ── Render ───────────────────────────────────────────────────────
function render() {
  const dateVal = document.getElementById('startDate').value;
  const startDate = dateVal ? new Date(dateVal) : new Date();

  const q = currentSearch.toLowerCase();

  const filtered = VACCINES.filter(v => {
    if (currentFactor !== 'all' && v.factor !== currentFactor) return false;
    if (q && !v.name.toLowerCase().includes(q) && !(v.remark || '').toLowerCase().includes(q)) return false;
    return true;
  });

  const grid = document.getElementById('cardsGrid');
  grid.innerHTML = '';

  // Update lang class on grid
  grid.classList.toggle('lang-th-hidden', currentLang === 'en');
  grid.classList.toggle('lang-en-hidden', currentLang === 'th');

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div class="empty-state-icon">💉</div><div class="empty-state-text">ไม่พบวัคซีนที่ค้นหา</div>';
    grid.appendChild(empty);
  } else {
    filtered.forEach(v => grid.appendChild(buildCard(v, startDate)));
  }

  document.getElementById('summaryBar').textContent =
    `แสดง ${filtered.length} จาก ${VACCINES.length} วัคซีน`;
}

// ── Init ─────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const dateInput = document.getElementById('startDate');
  dateInput.value = todayISO();
  dateInput.addEventListener('change', render);

  // Language toggle
  document.getElementById('langToggle').addEventListener('click', e => {
    const btn = e.target.closest('[data-lang]');
    if (!btn) return;
    currentLang = btn.dataset.lang;
    document.querySelectorAll('#langToggle .seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });

  // Search
  document.getElementById('searchInput').addEventListener('input', e => {
    currentSearch = e.target.value;
    render();
  });

  // Factor filter
  document.getElementById('factorFilter').addEventListener('click', e => {
    const chip = e.target.closest('[data-factor]');
    if (!chip) return;
    currentFactor = chip.dataset.factor;
    document.querySelectorAll('#factorFilter .chip').forEach(c => c.classList.toggle('active', c === chip));
    render();
  });

  render();
});
