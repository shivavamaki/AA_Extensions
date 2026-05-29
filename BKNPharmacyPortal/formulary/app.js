const STORAGE_KEY = 'bkn_formula_webapp.formulas.v4';
const DB_URL = 'data/formulas.json';
const $ = id => document.getElementById(id);
let formulas = [];
let editingId = '';

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }
function escapeHtml(v){ return String(v ?? '').replace(/[&<>'"]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[s])); }
function fmt(n){
  n = Number(n || 0);
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return n.toFixed(2).replace(/\.00$/,'').replace(/0$/,'');
}
function todayISO(d=new Date()){
  return d.toLocaleDateString('th-TH', {year:'numeric', month:'2-digit', day:'2-digit'});
}
function addDays(d, days){ const x = new Date(d); x.setDate(x.getDate()+Number(days||0)); return x; }
async function loadFormulas(){
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      formulas = JSON.parse(saved);
      return;
    } catch(err) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  try {
    const res = await fetch(DB_URL, {cache: 'no-store'});
    if (!res.ok) throw new Error('Cannot load formulas.json');
    formulas = await res.json();
  } catch(err) {
    if (Array.isArray(window.DEFAULT_FORMULAS)) {
      formulas = clone(window.DEFAULT_FORMULAS);
      return;
    }
    document.body.classList.add('db-load-error');
    formulas = [];
    setTimeout(() => {
      alert('Cannot load data/formulas.json. Please open this app using run_local_server.bat or import formulas.json manually.');
    }, 200);
  }
}
function saveAll(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(formulas)); }
function getFormula(id){ return formulas.find(f => f.id === id) || formulas[0]; }

function compute(formula, qty){
  const total = Number(qty || formula.defaultQty || 0);
  const working = (formula.ingredients || []).map((it) => {
    let amount = 0;
    const baseAmount = Number(it.baseAmount || 0);
    const baseTotal = Number(it.baseTotal || total || 1);
    if (it.calc === 'ratio') amount = total * baseAmount / baseTotal;
    else if (it.calc === 'qsto') amount = total;
    else if (it.calc === 'remainder') {
      const sub = (it.subtract || []).reduce((sum, subIdx) => {
        const subItem = formula.ingredients[subIdx];
        if (!subItem) return sum;
        const subBaseTotal = Number(subItem.baseTotal || total || 1);
        return sum + (total * Number(subItem.baseAmount || 0) / subBaseTotal);
      }, 0);
      amount = total - sub;
    } else amount = baseAmount;
    const prefix = it.prefix || '';
    const amountText = `${prefix ? prefix + ' ' : ''}${fmt(amount)} ${it.uom || ''}`.trim();
    return {...it, amount, amountText};
  });
  working.total = total;
  working.totalUom = formula.uom || '';
  working.totalText = `${fmt(total)} ${formula.uom || ''}`.trim();
  return working;
}
function tokenValue(key, w){
  if (key === 'total') return fmt(w.total);
  if (key === 'total75') return fmt(w.total * 0.75);
  if (key === 'totalUom') return w.totalUom;
  if (key === 'totalText') return w.totalText;
  const m = key.match(/^ing(\d+)\.(.+)$/);
  if (m) return w[Number(m[1])]?.[m[2]] ?? '';
  return '';
}
function renderMethod(template, w){
  return String(template || '').replace(/\{([^}]+)\}/g, (_, key) => tokenValue(key.trim(), w));
}

function refreshSelectors(selectedId){
  const options = formulas.map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name || f.id)}</option>`).join('');
  $('formulaSelect').innerHTML = options;
  $('editFormulaSelect').innerHTML = options;
  const id = selectedId || formulas[0]?.id || '';
  if ($('formulaSelect')) $('formulaSelect').value = id;
  if ($('editFormulaSelect')) $('editFormulaSelect').value = id;
  editingId = id;
}
function renderReport(){
  const formula = getFormula($('formulaSelect').value);
  if (!formula) { $('report').innerHTML = '<div class="doc">No formulary data.</div>'; return; }
  const qty = Number($('quantity').value || formula.defaultQty || 0);
  $('uom').innerText = formula.uom || '';
  const w = compute(formula, qty);
  const prep = new Date();
  const exp = addDays(prep, formula.shelfLifeDays || 0);
  const rows = w.map(x => `<tr><td>${escapeHtml(x.no || '')}</td><td>${escapeHtml(x.code || '')}</td><td>${escapeHtml(x.name)}</td><td class="center">${escapeHtml(x.prefix || '')}</td><td class="right">${escapeHtml(fmt(x.amount))}</td><td>${escapeHtml(x.uom || '')}</td></tr>`).join('');
  const instructions = (formula.methodTemplates || []).map(t => renderMethod(t, w).trim()).filter(Boolean);
  const instructionHtml = instructions.length ? `<h4>Instruction</h4><ol class="instruction-list">${instructions.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ol>` : '';
  $('report').innerHTML = `
    <div class="doc">
      <div class="doc-title">Master Formula / Preparation Record</div>
      <div class="formula-date-row">
        <h3>${escapeHtml(formula.title || formula.name)}</h3>
        <div class="top-date"><span>Date</span> ${todayISO(prep)}</div>
      </div>
      <table class="info"><tr><th>Medicine</th><td>${escapeHtml(formula.title || formula.name)}</td><th>Total quantity</th><td>${escapeHtml(fmt(qty))} ${escapeHtml(formula.uom || '')}</td></tr><tr><th>Prep.Date</th><td>${todayISO(prep)}</td><th>EXP.Date</th><td>${todayISO(exp)}</td></tr><tr><th>Expiry note</th><td colspan="3">${escapeHtml(formula.shelfLifeText || '')}</td></tr>${formula.note ? `<tr><th>Note</th><td colspan="3">${escapeHtml(formula.note)}</td></tr>` : ''}</table>
      <h4>Working formula</h4>
      <table class="work-table"><thead><tr><th class="col-no">No.</th><th class="col-code">Code</th><th class="col-ingredient">Ingredient</th><th class="col-note">Note</th><th class="col-qty">Quantity</th><th class="col-uom">UOM</th></tr></thead><tbody>${rows}</tbody></table>
      ${instructionHtml}
      <div class="sign"><div class="sig-box"><div>Prepared by</div><div class="sig-line">____________________</div><div class="sig-date">Date: __________</div></div><div class="sig-box"><div>Checked by</div><div class="sig-line">____________________</div><div class="sig-date">Date: __________</div></div></div>
    </div>`;
}
function switchPage(pageId){
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === pageId));
  document.querySelectorAll('.nav-tab').forEach(b => b.classList.toggle('active', b.dataset.page === pageId));
}

function renderEditor(id){
  const source = getFormula(id);
  if (!source) return;
  const f = clone(source);
  editingId = f.id;
  $('editFormulaSelect').value = f.id;
  $('editId').value = f.id || '';
  $('editName').value = f.name || '';
  $('editTitle').value = f.title || '';
  $('editDefaultQty').value = f.defaultQty ?? '';
  $('editUom').value = f.uom || '';
  $('editShelfLifeDays').value = f.shelfLifeDays ?? '';
  $('editShelfLifeText').value = f.shelfLifeText || '';
  $('ingredientBody').innerHTML = (f.ingredients || []).map((it, idx) => ingredientRow(it, idx)).join('');
  if ($('methodBody')) $('methodBody').innerHTML = (f.methodTemplates || []).map((m, idx) => methodRow(m, idx)).join('');
}
function ingredientRow(it={}, idx){
  const calc = it.calc || 'ratio';
  return `<tr data-index="${idx}">
    <td><input class="ing-no" value="${escapeHtml(it.no ?? idx+1)}"></td>
    <td><input class="ing-code" value="${escapeHtml(it.code || '')}"></td>
    <td><input class="ing-name" value="${escapeHtml(it.name || '')}"></td>
    <td><input class="ing-baseAmount" type="number" step="0.0001" value="${escapeHtml(it.baseAmount ?? '')}"></td>
    <td><input class="ing-baseTotal" type="number" step="0.0001" value="${escapeHtml(it.baseTotal ?? '')}"></td>
    <td><input class="ing-uom" value="${escapeHtml(it.uom || '')}"></td>
    <td><select class="ing-calc"><option value="ratio" ${calc==='ratio'?'selected':''}>ratio</option><option value="qsto" ${calc==='qsto'?'selected':''}>qsto</option><option value="remainder" ${calc==='remainder'?'selected':''}>remainder</option><option value="fixed" ${calc==='fixed'?'selected':''}>fixed</option></select></td>
    <td><input class="ing-prefix" value="${escapeHtml(it.prefix || '')}"></td>
    <td><input class="ing-subtract" value="${escapeHtml((it.subtract || []).join(','))}" placeholder="0,1"></td>
    <td><button class="icon-btn danger remove-ing" title="Remove">×</button></td>
  </tr>`;
}
function methodRow(text='', idx){
  return `<div class="method-row" data-index="${idx}"><span>${idx+1}</span><textarea class="method-text" rows="2">${escapeHtml(text)}</textarea><button class="icon-btn danger remove-method" title="Remove">×</button></div>`;
}
function collectEditor(){
  const id = $('editId').value.trim();
  if (!id) throw new Error('Please input ID / Sheet name');
  const ingredients = [...document.querySelectorAll('#ingredientBody tr')].map((tr, idx) => {
    const subtractRaw = tr.querySelector('.ing-subtract').value.trim();
    return {
      no: tr.querySelector('.ing-no').value.trim() || idx + 1,
      code: tr.querySelector('.ing-code')?.value.trim() || '',
      name: tr.querySelector('.ing-name').value.trim(),
      baseAmount: Number(tr.querySelector('.ing-baseAmount').value || 0),
      baseTotal: Number(tr.querySelector('.ing-baseTotal').value || 0),
      uom: tr.querySelector('.ing-uom').value.trim(),
      calc: tr.querySelector('.ing-calc').value,
      prefix: tr.querySelector('.ing-prefix').value.trim(),
      subtract: subtractRaw ? subtractRaw.split(',').map(x => Number(x.trim())).filter(Number.isFinite) : []
    };
  });
  const methodTemplates = [...document.querySelectorAll('.method-text')].map(x => x.value.trim()).filter(Boolean);
  const original = getFormula(editingId);
  return {
    id,
    name: $('editName').value.trim() || id,
    title: $('editTitle').value.trim() || $('editName').value.trim() || id,
    defaultQty: Number($('editDefaultQty').value || 0),
    uom: $('editUom').value.trim() || 'mL',
    shelfLifeDays: Number($('editShelfLifeDays').value || 0),
    shelfLifeText: $('editShelfLifeText').value.trim(),
    ingredients,
    methodTemplates: methodTemplates.length ? methodTemplates : (original?.methodTemplates || [])
  };
}
function saveEditor(){
  let f;
  try { f = collectEditor(); } catch(err) { alert(err.message); return; }
  const dup = formulas.find(x => x.id === f.id && x.id !== editingId);
  if (dup) { alert('This ID already exists. Please use another ID.'); return; }
  const idx = formulas.findIndex(x => x.id === editingId);
  if (idx >= 0) formulas[idx] = f; else formulas.push(f);
  saveAll();
  refreshSelectors(f.id);
  renderEditor(f.id);
  $('quantity').value = f.defaultQty;
  renderReport();
  alert('Saved formulary');
}
function newFormula(){
  const id = `new.formula.${Date.now()}`;
  formulas.push({id, name:'New formulary', title:'New formulary', defaultQty:100, uom:'mL', shelfLifeDays:30, shelfLifeText:'', ingredients:[], methodTemplates:[]});
  saveAll(); refreshSelectors(id); renderEditor(id);
}
function duplicateFormula(){
  const f = clone(getFormula(editingId));
  f.id = `${f.id}.copy`;
  f.name = `${f.name} copy`;
  formulas.push(f); saveAll(); refreshSelectors(f.id); renderEditor(f.id);
}
function deleteFormula(){
  if (formulas.length <= 1) { alert('Cannot delete the last formulary.'); return; }
  if (!confirm('Delete this formulary?')) return;
  formulas = formulas.filter(f => f.id !== editingId);
  saveAll(); refreshSelectors(formulas[0].id); renderEditor(formulas[0].id); renderReport();
}
function exportJson(){
  const blob = new Blob([JSON.stringify(formulas, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bkn-formulas.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function importJson(file){
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error('JSON must be an array.');
      formulas = imported;
      saveAll(); refreshSelectors(formulas[0]?.id); renderEditor(formulas[0]?.id); renderReport();
      alert('Imported JSON successfully');
    } catch(err) { alert('Import failed: ' + err.message); }
  };
  reader.readAsText(file);
}
function bindEvents(){
  document.querySelectorAll('.nav-tab').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));
  $('formulaSelect').addEventListener('change', () => { const f = getFormula($('formulaSelect').value); $('quantity').value = f.defaultQty; renderReport(); });
  $('quantity').addEventListener('input', renderReport);
  $('createBtn').addEventListener('click', renderReport);
  $('printBtn').addEventListener('click', () => window.print());
  $('resetBtn').addEventListener('click', () => { const f = getFormula($('formulaSelect').value); $('quantity').value = f.defaultQty; renderReport(); });
  $('editFormulaSelect').addEventListener('change', e => renderEditor(e.target.value));
  const deleteBtn = $('deleteFormulaBtn');
  if (deleteBtn) deleteBtn.addEventListener('click', deleteFormula);
  $('saveFormulaBtn').addEventListener('click', saveEditor);
  $('previewEditedBtn').addEventListener('click', () => { saveEditor(); switchPage('reportPage'); });
  $('exportJsonBtn').addEventListener('click', exportJson);
  $('importJsonInput').addEventListener('change', e => e.target.files[0] && importJson(e.target.files[0]));
  $('restoreDefaultBtn').addEventListener('click', async () => { 
    if(confirm('Remove local edits and reload data/formulas.json?')) { 
      localStorage.removeItem(STORAGE_KEY);
      await loadFormulas();
      refreshSelectors(formulas[0]?.id);
      renderEditor(formulas[0]?.id);
      renderReport();
    } 
  });
  $('addIngredientBtn').addEventListener('click', () => $('ingredientBody').insertAdjacentHTML('beforeend', ingredientRow({no: document.querySelectorAll('#ingredientBody tr').length+1, calc:'ratio'}, document.querySelectorAll('#ingredientBody tr').length)));
  if ($('addMethodBtn') && $('methodBody')) $('addMethodBtn').addEventListener('click', () => $('methodBody').insertAdjacentHTML('beforeend', methodRow('', document.querySelectorAll('.method-row').length)));
  $('ingredientBody').addEventListener('click', e => { if (e.target.classList.contains('remove-ing')) e.target.closest('tr').remove(); });
  if ($('methodBody')) $('methodBody').addEventListener('click', e => { if (e.target.classList.contains('remove-method')) e.target.closest('.method-row').remove(); });
}
async function init(){
  await loadFormulas();
  const urlId = new URLSearchParams(location.search).get('id');
  const startId = (urlId && formulas.find(f => f.id === urlId)) ? urlId : formulas[0]?.id;
  refreshSelectors(startId);
  const f = getFormula(startId);
  $('quantity').value = f?.defaultQty || 100;
  bindEvents();
  renderEditor(startId);
  renderReport();
}
document.addEventListener('DOMContentLoaded', init);
