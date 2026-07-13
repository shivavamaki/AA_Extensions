'use strict';

const SERVER = 'http://10.134.110.81:8765';
const TASK_KEYS = ['orderItem', 'tariff', 'drugMaster', 'code', 'storeBin'];

let ITEMS = [];
let filter = 'all';
let query = '';
let saveTimer = null;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function isDone(item) {
  return TASK_KEYS.every(k => item.tasks[k]);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2200);
}

function setConn(state) {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  dot.className = 'conn-dot' + (state === 'ok' ? ' ok' : state === 'err' ? ' err' : '');
  label.textContent = state === 'ok' ? 'Server connected' : state === 'err' ? 'Server offline' : 'Connecting…';
}

async function loadItems() {
  try {
    const r = await fetch(`${SERVER}/api/pending-code`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    ITEMS = Array.isArray(data) ? data : [];
    setConn('ok');
  } catch (e) {
    console.warn('[PendingCode] load failed:', e.message);
    setConn('err');
    toast('Cannot reach pharmacy server');
    ITEMS = [];
  }
  render();
}

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const r = await fetch(`${SERVER}/api/pending-code`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ITEMS),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setConn('ok');
    } catch (e) {
      console.warn('[PendingCode] save failed:', e.message);
      setConn('err');
      toast('Save failed — check pharmacy server');
    }
  }, 250);
}

function nextId() {
  let max = 0;
  for (const it of ITEMS) {
    const m = /^pc-(\d+)$/.exec(it.id || '');
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `pc-${max + 1}`;
}

function matchesFilter(item) {
  if (filter === 'pending' && isDone(item)) return false;
  if (filter === 'done' && !isDone(item)) return false;
  if (query) {
    const q = query.toLowerCase();
    const hay = `${item.materialCode} ${item.description}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function updateProgress() {
  const total = ITEMS.length;
  const done = ITEMS.filter(isDone).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  document.getElementById('progressFill').style.width = `${pct}%`;
  document.getElementById('progressLabel').textContent =
    total ? `${done} / ${total} done (${pct}%) — ${total - done} pending` : 'No items yet';
}

function render() {
  updateProgress();
  const tbody = document.getElementById('tbody');
  tbody.innerHTML = '';
  const visible = ITEMS.filter(matchesFilter);
  document.getElementById('emptyState').hidden = visible.length !== 0;

  visible.forEach((item) => {
    const i = ITEMS.indexOf(item);
    const done = isDone(item);
    const tr = document.createElement('tr');
    tr.className = done ? 'row-done' : '';
    tr.innerHTML = `
      <td class="col-no">${esc(item.no || '')}</td>
      <td><input type="text" class="code-input" value="${esc(item.materialCode)}" data-field="materialCode" title="${esc(item.materialCode)}"></td>
      <td><input type="text" class="desc-input" value="${esc(item.description)}" data-field="description" title="${esc(item.description)}"></td>
      ${TASK_KEYS.map(k => `<td class="col-task"><input type="checkbox" data-task="${k}" ${item.tasks[k] ? 'checked' : ''}></td>`).join('')}
      <td><input type="text" class="qty-input" value="${esc(item.opdQty)}" data-field="opdQty"></td>
      <td><input type="text" class="qty-input" value="${esc(item.ipdQty)}" data-field="ipdQty"></td>
      <td><input type="text" value="${esc(item.notes)}" data-field="notes" placeholder="—"></td>
      <td class="col-status"><span class="status-pill ${done ? 'done' : 'pending'}">${done ? 'Done' : 'Pending'}</span></td>
      <td class="col-del"><button class="del-btn" data-del title="Delete">&#10005;</button></td>
    `;
    tr.dataset.idx = i;
    tbody.appendChild(tr);
  });
}

function onTableChange(e) {
  const tr = e.target.closest('tr[data-idx]');
  if (!tr) return;
  const item = ITEMS[parseInt(tr.dataset.idx, 10)];
  if (!item) return;

  if (e.target.dataset.task) {
    item.tasks[e.target.dataset.task] = e.target.checked;
    item.updatedAt = new Date().toISOString();
    persist();
    render();
    return;
  }
  if (e.target.dataset.field) {
    item[e.target.dataset.field] = e.target.value;
    item.updatedAt = new Date().toISOString();
    persist();
  }
}

function onTableClick(e) {
  if (!e.target.closest('[data-del]')) return;
  const tr = e.target.closest('tr[data-idx]');
  if (!tr) return;
  const idx = parseInt(tr.dataset.idx, 10);
  const item = ITEMS[idx];
  if (!item) return;
  if (!confirm(`Delete "${item.description || item.materialCode}"?`)) return;
  ITEMS.splice(idx, 1);
  persist();
  render();
}

function addItem() {
  const now = new Date().toISOString();
  ITEMS.push({
    id: nextId(),
    no: '',
    materialCode: '',
    description: 'New item',
    altCodeNote: '',
    tasks: { orderItem: false, tariff: false, drugMaster: false, code: false, storeBin: false },
    opdQty: '',
    ipdQty: '',
    notes: '',
    createdAt: now,
    updatedAt: now,
  });
  filter = 'all';
  document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  persist();
  render();
  requestAnimationFrame(() => {
    const rows = document.querySelectorAll('#tbody tr');
    rows[rows.length - 1]?.querySelector('.desc-input')?.focus();
    rows[rows.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function init() {
  document.getElementById('tbody').addEventListener('change', onTableChange);
  document.getElementById('tbody').addEventListener('click', onTableClick);
  document.getElementById('btnAdd').addEventListener('click', addItem);
  document.getElementById('search').addEventListener('input', (e) => {
    query = e.target.value.trim();
    render();
  });
  document.getElementById('filterSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    filter = btn.dataset.filter;
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === btn));
    render();
  });
  loadItems();
}

init();
