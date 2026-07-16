'use strict';

// ══════════════════════════════════════════════════════════════════
// DATA
// ══════════════════════════════════════════════════════════════════

const DEFAULT_DRUGS = [
  { name:'5-Fluorouracil',               trade:'5-FU',       exp:3,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:50,    unit:'mg',  cmt:'Do not refrigerate',                                                     rate:'IV Bolus',                                   dil:'NSS',        route:'IV'  },
  { name:'5-Fluorouracil (IV Bolus)',    trade:'5-FU',       exp:7,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:50,    unit:'mg',  cmt:'Do not refrigerate',                                                     rate:'IV Bolus',                                   dil:'NSS',        route:'IV'  },
  { name:'Atezolizumab',                 trade:'Tecentriq',  exp:1,  expU:'day', stor:'2-8°C', storAlt:'6 hr at Room temp',  mono:true,  conc:60,    unit:'mg',  cmt:'-',                                                                      rate:'IV push slowly over 30 min',                 dil:'D5W',        route:'IV'  },
  { name:'Bendamustine',                 trade:'Ribomustin', exp:1,  expU:'day', stor:'2-8°C', storAlt:'6 hr at Room temp',  mono:false, conc:2.5,   unit:'mg',  cmt:'Keep in refrigerator (2-8°C). Use only NON-PVC set',                     rate:'IV drip in 30 min',                          dil:'0.45% NaCl', route:'IV'  },
  { name:'Bevacizumab (Vegzelma)',        trade:'',           exp:2,  expU:'day', stor:'RT',    storAlt:'',                   mono:true,  conc:25,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'IV drip in 60 min',                          dil:'D5S',        route:'IV'  },
  { name:'Bevacizumab (Zirabev)',         trade:'',           exp:2,  expU:'day', stor:'RT',    storAlt:'',                   mono:true,  conc:25,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'IV drip in 60 min',                          dil:'D5S',        route:'IV'  },
  { name:'Bleomycin',                    trade:'',           exp:1,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:1,     unit:'mg',  cmt:'-',                                                                      rate:'IV drip in 1 hr',                            dil:'D5N/2',      route:'IV'  },
  { name:'Bortezomib (IV)',              trade:'MyBorte',    exp:15, expU:'day', stor:'2-8°C', storAlt:'',                   mono:false, conc:1,     unit:'mg',  cmt:'Keep in refrigerator (2-8°C). Protect from light',                       rate:'IV drip in 30 min',                          dil:'NSS',        route:'IV'  },
  { name:'Bortezomib (SC)',              trade:'MyBorte',    exp:15, expU:'day', stor:'2-8°C', storAlt:'',                   mono:false, conc:2.5,   unit:'mg',  cmt:'Keep in refrigerator (2-8°C). Protect from light',                       rate:'SC injection',                               dil:'',           route:'SC'  },
  { name:'Carboplatin (in D5W)',          trade:'',           exp:7,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:10,    unit:'mg',  cmt:'-',                                                                      rate:'IV drip in 2 hr',                            dil:'D5W',        route:'IV'  },
  { name:'Carboplatin (in NSS)',          trade:'',           exp:1,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:10,    unit:'mg',  cmt:'-',                                                                      rate:'IV drip in 3 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Cetuximab',                    trade:'Erbitux',    exp:2,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:5,     unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'IV drip in 4 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Cisplatin',                    trade:'',           exp:3,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:1,     unit:'mg',  cmt:'Do not refrigerate',                                                     rate:'IV drip in 22 hr',                           dil:'NSS',        route:'IV'  },
  { name:'Cyclophosphamide',             trade:'',           exp:1,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:20,    unit:'mg',  cmt:'-',                                                                      rate:'IV push slowly',                             dil:'NSS',        route:'IV'  },
  { name:'Cytarabine',                   trade:'Cytosar',    exp:7,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:100,   unit:'mg',  cmt:'-',                                                                      rate:'IV push slowly',                             dil:'NSS',        route:'IV'  },
  { name:'Daratumumab',                  trade:'Darzalex',   exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:20,    unit:'mg',  cmt:'Keep in (2-8°C). Protect from light. With filter 0.22 micron',           rate:'IV drip in 24 hr',                           dil:'NSS',        route:'IV'  },
  { name:'Denosumab',                    trade:'',           exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:70.59, unit:'mg',  cmt:'Protect from light',                                                     rate:'IV drip in 6 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Docetaxel',                    trade:'Daxotel',    exp:3,  expU:'day', stor:'2-8°C', storAlt:'6 hr at Room temp',  mono:false, conc:20,    unit:'mg',  cmt:'Use only NON-PVC set',                                                   rate:'IV drip in 2 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Doxorubicin',                  trade:'',           exp:2,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:2,     unit:'mg',  cmt:'-',                                                                      rate:'IV drip in 2 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Durvalumab',                   trade:'Imfinzi',    exp:1,  expU:'day', stor:'2-8°C', storAlt:'8 hr at Room temp',  mono:true,  conc:50,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'IV drip in 1 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Etoposide',                    trade:'',           exp:1,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:20,    unit:'mg',  cmt:'Use only NON-PVC set',                                                   rate:'IV drip in 2 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Fludarabine',                  trade:'Fludara',    exp:2,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:25,    unit:'mg',  cmt:'-',                                                                      rate:'IV drip in 30 min',                          dil:'NSS',        route:'IV'  },
  { name:'Gemcitabine',                  trade:'Gemita',     exp:7,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:38,    unit:'mg',  cmt:'Do not refrigerate',                                                     rate:'IV drip 80 mL/hr for 1 hr, then 150 mL/hr', dil:'NSS',        route:'IV'  },
  { name:'Idarubicin',                   trade:'Zavedos',    exp:3,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:1,     unit:'mg',  cmt:'-',                                                                      rate:'IV push slowly',                             dil:'NSS',        route:'IV'  },
  { name:'Ipilimumab',                   trade:'Yervoy',     exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:5,     unit:'mg',  cmt:'Keep in refrigerator (2-8°C). With in-line filter 0.22 micron',          rate:'IV drip in 90 min',                          dil:'NSS',        route:'IV'  },
  { name:'Irinotecan',                   trade:'Irinotel',   exp:1,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:20,    unit:'mg',  cmt:'-',                                                                      rate:'IV drip in 90 min',                          dil:'D5W',        route:'IV'  },
  { name:'Leucovorin',                   trade:'',           exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:false, conc:10,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'IV drip in 2 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Liposomal Doxorubicin',        trade:'Lipodox',    exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:false, conc:2,     unit:'mg',  cmt:'D5W only',                                                               rate:'IV drip in 4-6 hr',                          dil:'D5W',        route:'IV'  },
  { name:'Methotrexate',                 trade:'MTX',        exp:7,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:25,    unit:'mg',  cmt:'-',                                                                      rate:'IV drip in 90 min',                          dil:'NSS',        route:'IV'  },
  { name:'Mitomycin',                    trade:'',           exp:7,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:1,     unit:'mg',  cmt:'Protect from light',                                                     rate:'SC at abdomen / bladder irrigation',          dil:'SWI/NSS',    route:'SC'  },
  { name:'Mitoxantrone',                 trade:'',           exp:2,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:2,     unit:'mg',  cmt:'-',                                                                      rate:'IV drip in 30 min',                          dil:'NSS',        route:'IV'  },
  { name:'Nivolumab',                    trade:'Opdivo',     exp:1,  expU:'day', stor:'2-8°C', storAlt:'8 hr at Room temp',  mono:true,  conc:10,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C). With in-line filter 0.22 micron',          rate:'As directed',                                dil:'NSS',        route:'IV'  },
  { name:'Oxaliplatin',                  trade:'Eloxatin',   exp:1,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:5,     unit:'mg',  cmt:'D5W only. Do NOT use NaCl',                                              rate:'IV drip in 2 hr',                            dil:'D5W',        route:'IV'  },
  { name:'Paclitaxel',                   trade:'Intaxel',    exp:1,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:6,     unit:'mg',  cmt:'Use only NON-PVC set',                                                   rate:'IV drip in 3 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Panitumumab',                  trade:'Vectibix',   exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:20,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'IV drip in 60 min',                          dil:'NSS',        route:'IV'  },
  { name:'Pembrolizumab',                trade:'Keytruda',   exp:1,  expU:'day', stor:'2-8°C', storAlt:'6 hr at Room temp',  mono:true,  conc:25,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C). With in-line filter 0.22 micron',          rate:'IV drip in 30 min',                          dil:'NSS',        route:'IV'  },
  { name:'Pemetrexed',                   trade:'Pexeda',     exp:1,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:25,    unit:'mg',  cmt:'Reconstitute/dilute with NSS only',                                      rate:'IV drip in 10 min',                          dil:'NSS',        route:'IV'  },
  { name:'Ramucirumab',                  trade:'Cyramza',    exp:1,  expU:'day', stor:'2-8°C', storAlt:'4 hr at Room temp',  mono:true,  conc:10,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C). With in-line filter 0.22 micron',          rate:'IV drip in 60 min',                          dil:'NSS',        route:'IV'  },
  { name:'Rituximab',                    trade:'Mabthera',   exp:1,  expU:'day', stor:'2-8°C', storAlt:'12 hr at Room temp', mono:true,  conc:10,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C). With in-line filter 0.22 micron',          rate:'IV drip — step rate (see rate card)',         dil:'NSS',        route:'IV'  },
  { name:'Teclistamab',                  trade:'Tecvayli',   exp:20, expU:'hr',  stor:'2-8°C', storAlt:'',                   mono:true,  conc:90,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'IV drip in 1 hr',                            dil:'NSS',        route:'IV'  },
  { name:'Tislelizumab',                 trade:'Tevimbra',   exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:10,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C). With in-line filter 0.22 micron',          rate:'IV Drip Over 3 hr',                          dil:'NSS',        route:'IV'  },
  { name:'Trastuzumab',                  trade:'Herceptin',  exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:21,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'IV drip in 30 min',                          dil:'NSS',        route:'IV'  },
  { name:'Trastuzumab (Herzuma)',         trade:'Herzuma',    exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:21,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'IV drip in 30 min',                          dil:'NSS',        route:'IV'  },
  { name:'Trastuzumab deruxtecan',       trade:'ENHERTU',    exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:false, conc:20,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C). With in-line filter 0.22 micron',          rate:'IV drip in 30 min',                          dil:'D5W',        route:'IV'  },
  { name:'Trastuzumab-Emtansine',        trade:'Kadcyla',    exp:1,  expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:20,    unit:'mg',  cmt:'Keep in refrigerator (2-8°C). With in-line filter 0.22 micron',          rate:'IV drip in 30 min',                          dil:'NSS',        route:'IV'  },
  { name:'Vabysmo (Faricimab)',           trade:'Vabysmo',    exp:37, expU:'day', stor:'2-8°C', storAlt:'',                   mono:true,  conc:120,   unit:'mg',  cmt:'Keep in refrigerator (2-8°C)',                                           rate:'Intravitreal injection into the eye',         dil:'',           route:'IVT' },
  { name:'Vincristine',                  trade:'',           exp:2,  expU:'day', stor:'RT',    storAlt:'',                   mono:false, conc:1,     unit:'mg',  cmt:'-',                                                                      rate:'IV push slowly',                             dil:'NSS',        route:'IV'  },
];

const STAFF = [
  'ACRO','Akira','Ananya','Apsorn','Chaninard','Chanapa','Chayaporn',
  'Fonthip','Kanokporn','Ketsaraporn','Metawee','Narudee','Nongnapas',
  'Onamon','Paninee','Patamaporn','Patcharee','Phattranit','Piyatida',
  'Punyaporn','Siriporn','Siwawoot','Sopida','Sucheera','Suwimol',
  'Tussanee','Waramporn','Yaowaporn',
];

// ══════════════════════════════════════════════════════════════════
// DRUG DB (pharmacy-server-backed)
// ══════════════════════════════════════════════════════════════════

const SERVER = 'http://10.134.110.81:8765';

let DRUGS = DEFAULT_DRUGS.map(d => ({ ...d }));

async function loadDrugsFromServer() {
  try {
    const r = await fetch(`${SERVER}/api/chemo-drugs`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (Array.isArray(data) && data.length) {
      DRUGS = data;
    } else {
      await persistDrugs();
    }
  } catch(e) {
    console.warn('[ChemoSticker] Server unavailable, using defaults:', e.message);
    toast('Server offline — using built-in defaults');
  }
}

async function persistDrugs() {
  try {
    const r = await fetch(`${SERVER}/api/chemo-drugs`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(DRUGS),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
  } catch(e) {
    console.warn('[ChemoSticker] Save failed:', e.message);
    toast('Save failed — check pharmacy server');
  }
}

// ══════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════

function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

function doseMg(dose, unit) {
  const v = parseFloat(dose) || 0;
  if (unit === 'Gm')  return v * 1000;
  if (unit === 'mcg') return v / 1000;
  return v;
}

function fmtVol(v) {
  if (v == null) return '';
  const r = Math.round(v * 100) / 100;
  return r % 1 === 0 ? String(r) : r.toFixed(2);
}

function calcExpiry(date, time, exp, expU) {
  if (!date) return null;
  const dt = new Date(`${date}T${time || '00:00'}`);
  if (expU === 'hr') dt.setHours(dt.getHours() + exp);
  else               dt.setDate(dt.getDate() + exp);
  const p = n => String(n).padStart(2,'0');
  return {
    date: `${p(dt.getDate())}/${p(dt.getMonth()+1)}/${dt.getFullYear()}`,
    time: `${p(dt.getHours())}:${p(dt.getMinutes())} น.`,
  };
}

function storText(drug) {
  if (!drug) return '';
  if (drug.stor === 'RT')    return 'Room Temperature';
  if (drug.stor === '2-8°C') return 'Refrigerator 2–8°C' + (drug.storAlt ? ' / ' + drug.storAlt : '');
  return drug.stor;
}

function setAuto(id, text) {
  const el = document.getElementById(id);
  if (!el) return;
  if (text) { el.textContent = text; el.classList.remove('dim'); }
  else      { el.textContent = '—';  el.classList.add('dim'); }
}

// ══════════════════════════════════════════════════════════════════
// TABS
// ══════════════════════════════════════════════════════════════════

function showTab(which) {
  document.getElementById('tab-sticker').style.display = which === 'sticker' ? 'flex' : 'none';
  document.getElementById('tab-db').style.display      = which === 'db'      ? 'flex' : 'none';
  document.querySelectorAll('.tab-btn').forEach((b, i) =>
    b.classList.toggle('active', (i === 0) === (which === 'sticker'))
  );
  if (which === 'db') renderDbTable();
}

// ══════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════

async function init() {
  await loadDrugsFromServer();
  rebuildDrugSelect();

  ['f-prep','f-label','f-check'].forEach(id => {
    const sel = document.getElementById(id);
    STAFF.forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      sel.appendChild(o);
    });
  });

  const now = new Date();
  const p   = n => String(n).padStart(2,'0');
  document.getElementById('f-prepdate').value =
    `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`;
  document.getElementById('f-preptime').value =
    `${p(now.getHours())}:${p(now.getMinutes())}`;

  document.getElementById('f-drug').addEventListener('change', () => {
    const drug = getDrug();
    if (drug) {
      document.getElementById('f-unit').value = drug.unit;
      document.getElementById('f-rate').value = drug.rate;
      document.getElementById('f-bagvol').value =
        (drug.route === 'SC' || drug.route === 'IVT') ? '0' : '';
    }
    update();
  });

  document.getElementById('f-ratecard').addEventListener('change', e => {
    const on = e.target.checked;
    document.getElementById('ratetext-wrap').classList.toggle('hidden', !on);
    document.getElementById('rate-preview-outer').classList.toggle('hidden', !on);
    update();
  });

  ['f-name','f-hn','f-room','f-dose','f-unit','f-bagvol',
   'f-prepdate','f-preptime','f-rate','f-prep','f-label','f-check','f-ratetext']
  .forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.addEventListener('input', update); el.addEventListener('change', update); }
  });

  document.getElementById('btn-print').addEventListener('click', doPrint);
  document.getElementById('btn-clear').addEventListener('click', clearForm);

  // Tab nav
  document.getElementById('tab-btn-sticker').addEventListener('click', () => showTab('sticker'));
  document.getElementById('tab-btn-db').addEventListener('click',      () => showTab('db'));

  // DB toolbar
  document.getElementById('db-btn-save').addEventListener('click',  dbSaveJSON);
  document.getElementById('db-btn-load').addEventListener('click',  dbLoadJSON);
  document.getElementById('db-btn-add').addEventListener('click',   dbAddRow);
  document.getElementById('db-btn-reset').addEventListener('click', dbResetDefaults);
  document.getElementById('json-file-input').addEventListener('change', dbImportJSON);

  // DB table — delegated change/click handlers (no inline event handlers)
  const tbody = document.getElementById('db-tbody');
  tbody.addEventListener('change', e => {
    const tr = e.target.closest('tr[data-row-idx]');
    if (!tr) return;
    const i     = parseInt(tr.dataset.rowIdx);
    const field = e.target.dataset.field;
    if (!field) return;
    let val;
    if (e.target.type === 'checkbox')            val = e.target.checked;
    else if (e.target.dataset.numtype === 'int') val = parseInt(e.target.value);
    else if (e.target.dataset.numtype === 'flt') val = parseFloat(e.target.value);
    else                                          val = e.target.value;
    dbSet(i, field, val);
  });
  tbody.addEventListener('click', e => {
    const btn = e.target.closest('[data-del-row]');
    if (btn) dbDeleteRow(parseInt(btn.dataset.delRow));
  });

  update();
}

function rebuildDrugSelect() {
  const sel = document.getElementById('f-drug');
  const cur = sel.value;
  sel.innerHTML = '<option value="">— Select drug —</option>';
  DRUGS.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = i;
    o.textContent = d.trade ? `${d.name}  [${d.trade}]` : d.name;
    sel.appendChild(o);
  });
  sel.value = cur;
}

// ══════════════════════════════════════════════════════════════════
// UPDATE
// ══════════════════════════════════════════════════════════════════

function getDrug() {
  const v = document.getElementById('f-drug').value;
  return (v !== '') ? DRUGS[parseInt(v)] : null;
}

function update() {
  const drug     = getDrug();
  const dose     = parseFloat(document.getElementById('f-dose').value) || 0;
  const unit     = document.getElementById('f-unit').value;
  const bagVol   = parseFloat(document.getElementById('f-bagvol').value) || 0;
  const prepDate = document.getElementById('f-prepdate').value;
  const prepTime = document.getElementById('f-preptime').value;

  const drugVol = drug ? (dose ? doseMg(dose, unit) / drug.conc : null) : null;

  setAuto('d-dvol',  drugVol !== null ? fmtVol(drugVol) + ' mL' : '');
  setAuto('d-dil',   drug ? (drug.dil || (drug.route !== 'IV' ? 'N/A' : '—')) : '');
  setAuto('d-stor',  drug ? storText(drug) : '');
  setAuto('d-conc',  drug ? drug.conc + ' mg/mL' : '');
  setAuto('d-cmt',   drug && drug.cmt && drug.cmt !== '-' ? drug.cmt : '');

  let expDate = '', expTime = '', expNote = '';
  if (drug && prepDate) {
    const e = calcExpiry(prepDate, prepTime, drug.exp, drug.expU);
    expDate = e.date; expTime = e.time;
    const pl = drug.exp > 1 && drug.expU === 'day' ? 's' : '';
    expNote = `${drug.exp} ${drug.expU}${pl} after preparation`;
    if (drug.storAlt) expNote += `  |  Stable ${drug.storAlt}`;
  }
  setAuto('d-expdate', expDate);
  setAuto('d-exptime', expTime);
  setAuto('d-expnote', expNote);

  const data = {
    name: document.getElementById('f-name').value.trim(),
    hn:   document.getElementById('f-hn').value.trim(),
    room: document.getElementById('f-room').value.trim(),
    drug, dose, unit, drugVol, bagVol,
    prepDate, prepTime, expDate, expTime,
    rate:  document.getElementById('f-rate').value.trim(),
    prep:  document.getElementById('f-prep').value,
    label: document.getElementById('f-label').value,
    check: document.getElementById('f-check').value,
  };

  const sHTML = buildSticker(data);
  document.getElementById('stk-screen').innerHTML = sHTML;
  document.getElementById('stk-print').innerHTML  = sHTML;

  const rcHTML = buildRateCard(data);
  document.getElementById('rc-screen').innerHTML = rcHTML;
  document.getElementById('rc-print').innerHTML  = rcHTML;
}

// ══════════════════════════════════════════════════════════════════
// BUILD STICKER
// ══════════════════════════════════════════════════════════════════

function buildSticker(d) {
  const { drug, dose, unit, drugVol, bagVol } = d;

  const mono = drug && drug.mono;
  const warnTop = mono
    ? '&#9670; CYTOTOXIC DRUG (Monoclonal Ab) &#9670;'
    : '&#9670; CYTOTOXIC DRUG &#9670;';
  const warnBot = '&#9733; HIGH ALERT MEDICATION &#9733;';

  const nameDisp  = esc(d.name) || '<span style="color:#aaa;font-weight:normal">ชื่อ-สกุลผู้ป่วย</span>';
  const hnRoomParts = [];
  if (d.hn)   hnRoomParts.push('HN: ' + esc(d.hn));
  if (d.room) hnRoomParts.push('Room ' + esc(d.room));
  const hnRoomDisp = hnRoomParts.join('&nbsp;&nbsp;');

  let drugLine = '<span style="color:#aaa;font-weight:normal;font-size:11pt;">เลือกยาและใส่ขนาดด้านบน</span>';
  let volLine  = '';

  if (drug) {
    const tradeDisp = drug.trade ? ` / ${drug.trade}` : '';
    const doseDisp  = dose ? `  ${dose} ${unit}` : '';
    const volDisp   = drugVol !== null ? `  (${fmtVol(drugVol)} mL)` : '';
    drugLine = esc(drug.name + tradeDisp) + esc(doseDisp)
      + (volDisp ? `<span style="font-weight:normal;font-size:11pt;">${esc(volDisp)}</span>` : '');

    if (drug.route === 'IV') {
      if (bagVol > 0 && drugVol !== null) {
        const dilV = Math.max(0, bagVol - drugVol);
        volLine = `+ ${fmtVol(dilV)} mL ${esc(drug.dil)}&nbsp;&nbsp;=&nbsp;&nbsp;<b>Total ${bagVol} mL</b>`;
      } else if (drug.dil) {
        volLine = `Diluent: ${esc(drug.dil)}`;
      }
    } else if (drug.route === 'SC')  volLine = 'SC injection';
    else if  (drug.route === 'IVT') volLine = 'Intravitreal injection';
  }

  const mfdDate  = d.prepDate ? esc(fmtDate(d.prepDate)) : '—';
  const mfdTime  = d.prepTime ? esc(d.prepTime) + ' น.'  : '';
  const expDate  = esc(d.expDate) || '—';
  const expTime  = esc(d.expTime) || '';
  const stabLine = drug
    ? `(${drug.exp} ${drug.expU}${drug.exp > 1 && drug.expU === 'day' ? 's' : ''})`
    : '';

  const stor = drug ? esc(storText(drug)) : '';
  const cmt  = drug && drug.cmt && drug.cmt !== '-' ? esc(drug.cmt) : '';
  const footerParts = [];
  if (stor) footerParts.push('Storage: ' + stor);
  if (cmt)  footerParts.push(cmt);
  const footerLine = footerParts.join('  |  ');

  return `
<div class="stk-header">
  <div class="stk-logospace"></div>
  <div class="stk-warn">
    <div class="stk-warn-top">${warnTop}</div>
    <div class="stk-warn-bot">${warnBot}</div>
  </div>
</div>

<div class="stk-patient">
  <div class="stk-name">${nameDisp}</div>
  <div class="stk-hn-room">${hnRoomDisp}</div>
</div>

<div class="stk-drug-sec">
  <div class="stk-drug-name">${drugLine}</div>
  ${volLine ? `<div class="stk-drug-row2">${volLine}</div>`           : ''}
  ${d.rate  ? `<div class="stk-rate-line">Rate: ${esc(d.rate)}</div>` : ''}
</div>

<div class="stk-dates-staff">
  <div class="stk-row">
    <span>Mfd: ${mfdDate}&nbsp;${mfdTime}</span>
    <span>Exp: ${expDate}&nbsp;${expTime}${stabLine ? '&nbsp;' + stabLine : ''}</span>
  </div>
  <div class="stk-row">
    <span><span class="split-role">Prep by:&nbsp;</span>${esc(d.prep)  || '—'}</span>
    <span><span class="split-role">STK by:&nbsp;</span>${esc(d.label) || '—'}</span>
    <span><span class="split-role">Check by:&nbsp;</span>${esc(d.check) || '—'}</span>
  </div>
</div>

${footerLine ? `<div class="stk-footer">${footerLine}</div>` : ''}`;
}

// ══════════════════════════════════════════════════════════════════
// BUILD RATE CARD
// ══════════════════════════════════════════════════════════════════

function buildRateCard(d) {
  const { drug, dose, unit, bagVol } = d;
  const rateText = document.getElementById('f-ratetext').value.trim()
    || (drug ? drug.rate : '');
  const bagDisp  = bagVol > 0 && drug && drug.dil
    ? ` + ${drug.dil} = Total ${bagVol} mL` : '';
  const drugLabel = drug ? `${drug.name}  ${dose ? dose+' '+unit : ''}${bagDisp}` : '';

  return `
<div class="rc-header">
  <div class="rc-logospace"></div>
  <div class="rc-title-box">&#9670; RATE INSTRUCTION — CYTOTOXIC &#9670;</div>
</div>
<div class="rc-body">
  <div class="rc-patient">${esc(d.name)}${d.hn ? '&nbsp;&nbsp;|&nbsp;&nbsp;HN: ' + esc(d.hn) : ''}</div>
  <div class="rc-drug">${esc(drugLabel)}</div>
  <div class="rc-text">${esc(rateText)}</div>
</div>`;
}

// ══════════════════════════════════════════════════════════════════
// PRINT
// ══════════════════════════════════════════════════════════════════

function doPrint() {
  const hn   = (document.getElementById('f-hn').value.trim() || 'HN').replace(/[^\w\-]/g,'_');
  const date = (document.getElementById('f-prepdate').value || '').replace(/-/g,'');
  document.title = `${hn}_prep_${date || 'date'}`;
  const hasRC = document.getElementById('f-ratecard').checked;
  document.getElementById('rc-print').classList.toggle('hidden', !hasRC);
  window.print();
  setTimeout(() => { document.title = 'Chemo Sticker'; }, 2000);
}

function clearForm() {
  ['f-name','f-hn','f-room','f-dose','f-bagvol','f-ratetext'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.getElementById('f-drug').value  = '';
  document.getElementById('f-unit').value  = 'mg';
  document.getElementById('f-prep').value  = '';
  document.getElementById('f-label').value = '';
  document.getElementById('f-check').value = '';
  document.getElementById('f-rate').value  = '';
  document.getElementById('f-bagvol').value = '0';
  document.getElementById('f-ratecard').checked = false;
  document.getElementById('ratetext-wrap').classList.add('hidden');
  document.getElementById('rate-preview-outer').classList.add('hidden');
  const now = new Date();
  const p   = n => String(n).padStart(2,'0');
  document.getElementById('f-prepdate').value =
    `${now.getFullYear()}-${p(now.getMonth()+1)}-${p(now.getDate())}`;
  document.getElementById('f-preptime').value =
    `${p(now.getHours())}:${p(now.getMinutes())}`;
  update();
}

// ══════════════════════════════════════════════════════════════════
// DATABASE EDITOR
// ══════════════════════════════════════════════════════════════════

function renderDbTable() {
  const tbody = document.getElementById('db-tbody');
  tbody.innerHTML = '';
  DRUGS.forEach((d, i) => {
    const tr = document.createElement('tr');
    tr.dataset.rowIdx = i;
    tr.innerHTML = `
<td style="text-align:center;color:var(--dim);width:30px;padding:4px;">${i+1}</td>
<td><input type="text"   value="${esc(d.name)}"   data-field="name"></td>
<td><input type="text"   value="${esc(d.trade)}"  data-field="trade"></td>
<td><input type="number" value="${d.exp}"          data-field="exp"    data-numtype="int" style="width:50px;"></td>
<td>
  <select data-field="expU">
    <option ${d.expU==='day'?'selected':''}>day</option>
    <option ${d.expU==='hr'?'selected':''}>hr</option>
  </select>
</td>
<td>
  <select data-field="stor">
    <option ${d.stor==='RT'?'selected':''}>RT</option>
    <option ${d.stor==='2-8°C'?'selected':''}>2-8°C</option>
  </select>
</td>
<td><input type="text"   value="${esc(d.storAlt)}" data-field="storAlt"></td>
<td style="text-align:center;">
  <input type="checkbox" ${d.mono?'checked':''} data-field="mono">
</td>
<td><input type="number" value="${d.conc}"          data-field="conc"   data-numtype="flt" style="width:70px;"></td>
<td>
  <select data-field="unit">
    ${['mg','Gm','mcg','Unit','mL'].map(u=>`<option ${d.unit===u?'selected':''}>${u}</option>`).join('')}
  </select>
</td>
<td><input type="text"   value="${esc(d.cmt)}"      data-field="cmt"></td>
<td><input type="text"   value="${esc(d.rate)}"     data-field="rate"></td>
<td><input type="text"   value="${esc(d.dil)}"      data-field="dil"   style="width:80px;"></td>
<td>
  <select data-field="route">
    ${['IV','SC','IVT'].map(r=>`<option ${d.route===r?'selected':''}>${r}</option>`).join('')}
  </select>
</td>
<td style="text-align:center;padding:4px;">
  <button class="del-btn" data-del-row="${i}">&#128465;</button>
</td>`;
    tbody.appendChild(tr);
  });
  document.getElementById('db-count').textContent = `${DRUGS.length} drugs`;
}

function dbSet(i, key, val) {
  DRUGS[i][key] = val;
  persistDrugs();
  rebuildDrugSelect();
}

function dbDeleteRow(i) {
  if (!confirm(`Delete "${DRUGS[i].name}"?`)) return;
  DRUGS.splice(i, 1);
  persistDrugs();
  rebuildDrugSelect();
  renderDbTable();
}

function dbAddRow() {
  DRUGS.push({
    name:'New Drug', trade:'', exp:1, expU:'day', stor:'RT', storAlt:'',
    mono:false, conc:1, unit:'mg', cmt:'-', rate:'IV drip', dil:'NSS', route:'IV'
  });
  persistDrugs();
  rebuildDrugSelect();
  renderDbTable();
  document.getElementById('db-tbody').lastElementChild
    .scrollIntoView({ behavior:'smooth' });
}

function dbResetDefaults() {
  if (!confirm('Reset drug list to defaults? Custom edits will be lost.')) return;
  DRUGS = DEFAULT_DRUGS.map(d => ({ ...d }));
  persistDrugs();
  rebuildDrugSelect();
  renderDbTable();
  toast('Drug list reset to defaults');
}

function dbSaveJSON() {
  const blob = new Blob([JSON.stringify(DRUGS, null, 2)], { type:'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `chemo_drugs_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Saved as JSON');
}

function dbLoadJSON() {
  document.getElementById('json-file-input').click();
}

function dbImportJSON(ev) {
  const file = ev.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Not an array');
      DRUGS = data;
      persistDrugs();
      rebuildDrugSelect();
      renderDbTable();
      toast(`Loaded ${data.length} drugs from ${file.name}`);
    } catch(err) {
      alert('Error reading JSON: ' + err.message);
    }
  };
  reader.readAsText(file);
  ev.target.value = '';
}

// ══════════════════════════════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════════════════════════════

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// ══════════════════════════════════════════════════════════════════
// START
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', init);
