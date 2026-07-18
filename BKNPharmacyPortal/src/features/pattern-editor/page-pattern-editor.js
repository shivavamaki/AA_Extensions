"use strict";

/**
 * src/features/pattern-editor/page-pattern-editor.js
 *
 * Standalone admin page (same convention as knowledge/, formulary/) for
 * editing the curated phrase-override dictionary consumed by
 * matchAuxiliaryPhrase() in medical-glossary.js.
 *
 * Server contract: data/rx/pattern-overrides.json, a dict keyed by the
 * lowercased/trimmed English phrase:
 *   { "shake well before use": { "th": "...", "en": "..." }, ... }
 * Served via the generic rx-collection routes already used by
 * premix-drugs/medication-db/etc:
 *   GET /api/pattern-overrides
 *   PUT /api/pattern-overrides   (body: the whole dict)
 */

const SERVER_URL = "http://10.134.110.81:8765";

let overrides = {};   // { phrase: { th, en } }
let order = [];        // phrase keys, in display order (preserves row order)

const rowsEl   = document.getElementById("rows");
const statusEl = document.getElementById("status");
const searchEl = document.getElementById("search");

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls || "";
}

function normalizeKey(raw) {
  return String(raw || "").trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");
}

function render() {
  const filter = normalizeKey(searchEl.value);
  rowsEl.innerHTML = "";
  order
    .filter(key => !filter || key.includes(filter))
    .forEach(key => {
      const tr = document.createElement("tr");
      tr.dataset.key = key;

      const tdKey = document.createElement("td");
      const inKey = document.createElement("input");
      inKey.type = "text";
      inKey.value = key;
      inKey.addEventListener("change", () => renameKey(key, inKey.value));
      tdKey.appendChild(inKey);

      const tdTh = document.createElement("td");
      const inTh = document.createElement("input");
      inTh.type = "text";
      inTh.value = (overrides[key] && overrides[key].th) || "";
      inTh.addEventListener("input", () => {
        overrides[key] = overrides[key] || {};
        overrides[key].th = inTh.value;
      });
      tdTh.appendChild(inTh);

      // Match mode: "exact" (whole-line / verb-prefix, default) or "replace"
      // (substring find→replace anywhere in the text).
      const tdMode = document.createElement("td");
      const selMode = document.createElement("select");
      for (const [val, label] of [["exact", "Exact / verb"], ["replace", "Replace (substring)"]]) {
        const o = document.createElement("option");
        o.value = val; o.textContent = label;
        selMode.appendChild(o);
      }
      selMode.value = (overrides[key] && overrides[key].mode) || "exact";
      selMode.addEventListener("change", () => {
        overrides[key] = overrides[key] || {};
        if (selMode.value === "replace") overrides[key].mode = "replace";
        else delete overrides[key].mode;   // exact is the default — keep JSON lean
      });
      tdMode.appendChild(selMode);

      const tdAct = document.createElement("td");
      tdAct.className = "actions";
      const btnDel = document.createElement("button");
      btnDel.className = "danger";
      btnDel.textContent = "✕";
      btnDel.title = "Remove this phrase";
      btnDel.addEventListener("click", () => removeKey(key));
      tdAct.appendChild(btnDel);

      tr.appendChild(tdKey);
      tr.appendChild(tdTh);
      tr.appendChild(tdMode);
      tr.appendChild(tdAct);
      rowsEl.appendChild(tr);
    });
}

function renameKey(oldKey, newRaw) {
  const newKey = normalizeKey(newRaw);
  if (!newKey || newKey === oldKey) { render(); return; }
  if (overrides[newKey]) {
    setStatus(`"${newKey}" already exists — merge manually first.`, "error");
    render();
    return;
  }
  overrides[newKey] = overrides[oldKey];
  delete overrides[oldKey];
  order[order.indexOf(oldKey)] = newKey;
  render();
}

function removeKey(key) {
  delete overrides[key];
  order = order.filter(k => k !== key);
  render();
}

function addRow() {
  let base = "new phrase", key = base, n = 1;
  while (overrides[key]) key = `${base} ${++n}`;
  overrides[key] = { th: "" };
  order.push(key);
  searchEl.value = "";
  render();
  const lastInput = rowsEl.querySelector("tr:last-child input");
  if (lastInput) lastInput.focus();
}

async function load() {
  setStatus("Loading…");
  try {
    const r = await fetch(`${SERVER_URL}/api/pattern-overrides`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    overrides = await r.json() || {};
    order = Object.keys(overrides);
    render();
    setStatus(`Loaded ${order.length} phrase(s).`, "ok");
  } catch (e) {
    overrides = {};
    order = [];
    render();
    setStatus(`⚠ Could not reach pharmacy server (${SERVER_URL}) — ${e.message}`, "error");
  }
}

async function save() {
  // Drop empty-key rows before saving.
  const clean = {};
  order.forEach(key => {
    if (key && overrides[key]) clean[key] = overrides[key];
  });
  setStatus("Saving…");
  try {
    const r = await fetch(`${SERVER_URL}/api/pattern-overrides`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clean),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setStatus(`✅ Saved ${Object.keys(clean).length} phrase(s).`, "ok");
  } catch (e) {
    setStatus(`⚠ Save failed — ${e.message}`, "error");
  }
}

document.getElementById("btnAdd").addEventListener("click", addRow);
document.getElementById("btnSave").addEventListener("click", save);
document.getElementById("btnReload").addEventListener("click", load);
searchEl.addEventListener("input", render);

load();

/* ══════════════════════════════════════════════════════════════════════════
   Tabs
════════════════════════════════════════════════════════════════════════════ */
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "drugs" && !_drugDb) loadDrugDb();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   Drug Instructions (medication-db CRUD)
   GET  /api/medication-db          → whole DB (dict keyed by code)
   PUT  /api/rx-note/{code}         → set Patient Instruction { th, en, manual:true }
   DELETE /api/rx-note/{code}       → remove Patient Instruction(s)
════════════════════════════════════════════════════════════════════════════ */
let _drugDb = null;          // { code: entry }
let _drugSelectedCode = null;

const drugSearchEl  = document.getElementById("drug-search");
const drugResultsEl = document.getElementById("drug-results");
const drugEditorEl  = document.getElementById("drug-editor");
const drugStatusEl  = document.getElementById("drug-status");
const drugCountEl   = document.getElementById("drug-count");

function setDrugStatus(msg, cls) {
  drugStatusEl.textContent = msg || "";
  drugStatusEl.className = cls || "";
  drugStatusEl.style.marginTop = "10px";
  drugStatusEl.style.fontSize = "13px";
}

// The curated Patient Instruction (TH/EN) for an entry, if any.
function patientInstruction(entry) {
  const inss = (entry && entry.instructions) || [];
  return inss.find((i) => (i.type || "") === "Patient Instruction") || null;
}

async function loadDrugDb() {
  setDrugStatus("Loading medication DB…");
  try {
    const r = await fetch(`${SERVER_URL}/api/medication-db`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    _drugDb = await r.json() || {};
    drugCountEl.textContent = `${Object.keys(_drugDb).length} drugs`;
    setDrugStatus("");
    renderDrugResults();
  } catch (e) {
    _drugDb = null;
    setDrugStatus(`⚠ Could not load medication DB — ${e.message}`, "error");
  }
}

function renderDrugResults() {
  if (!_drugDb) { drugResultsEl.innerHTML = ""; return; }
  const q = (drugSearchEl.value || "").trim().toLowerCase();
  drugResultsEl.innerHTML = "";
  if (q.length < 2) {
    drugResultsEl.innerHTML = `<div class="drug-row" style="cursor:default;color:#9ca3af">Type at least 2 characters to search…</div>`;
    return;
  }
  const matches = [];
  for (const code of Object.keys(_drugDb)) {
    const e = _drugDb[code] || {};
    const name = String(e.name || "").toLowerCase();
    if (name.includes(q) || code.toLowerCase().includes(q)) matches.push(code);
    if (matches.length >= 50) break;
  }
  if (!matches.length) {
    drugResultsEl.innerHTML = `<div class="drug-row" style="cursor:default;color:#9ca3af">No match.</div>`;
    return;
  }
  matches.forEach((code) => {
    const e = _drugDb[code] || {};
    const ins = patientInstruction(e);
    const row = document.createElement("div");
    row.className = "drug-row";
    row.innerHTML =
      `${escapeText(e.name || "(no name)")}<span class="rc"> · ${escapeText(code)}</span>` +
      (ins ? `<span class="ri">✓ has instruction</span>` : "");
    row.addEventListener("click", () => selectDrug(code));
    drugResultsEl.appendChild(row);
  });
}

function escapeText(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function selectDrug(code) {
  _drugSelectedCode = code;
  const e = _drugDb[code] || {};
  const ins = patientInstruction(e) || {};
  drugEditorEl.innerHTML = `
    <div class="drug-card">
      <div class="drug-hd">${escapeText(e.name || "(no name)")}<span class="drug-code">Code: ${escapeText(code)}</span></div>
      <div class="fld">
        <label>Patient Instruction — Thai (shown on the sheet)</label>
        <textarea id="di-th" rows="2">${escapeText(ins.TH || "")}</textarea>
      </div>
      <div class="fld">
        <label>Patient Instruction — English (fallback / other languages)</label>
        <textarea id="di-en" rows="2">${escapeText(ins.EN || "")}</textarea>
      </div>
      <div class="toolbar" style="margin-top:12px">
        <button class="primary" id="di-save">💾 Save instruction</button>
        <button class="danger" id="di-del">🗑 Remove instruction</button>
      </div>
    </div>`;
  document.getElementById("di-save").addEventListener("click", saveDrugInstruction);
  document.getElementById("di-del").addEventListener("click", deleteDrugInstruction);
  setDrugStatus("");
}

async function saveDrugInstruction() {
  if (!_drugSelectedCode) return;
  const th = document.getElementById("di-th").value.trim();
  const en = document.getElementById("di-en").value.trim();
  if (!th && !en) { setDrugStatus("⚠ Enter a Thai (or English) instruction first.", "error"); return; }
  setDrugStatus("Saving…");
  try {
    const r = await fetch(`${SERVER_URL}/api/rx-note/${encodeURIComponent(_drugSelectedCode)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ th: th || en, en, manual: true }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
    // Update local cache so the results list reflects the change immediately.
    _applyLocalInstruction(_drugSelectedCode, th || en, en);
    renderDrugResults();
    setDrugStatus("✅ Saved. Refresh a Home Med Sheet tab to see it.", "ok");
  } catch (e) {
    setDrugStatus(`⚠ Save failed — ${e.message}`, "error");
  }
}

async function deleteDrugInstruction() {
  if (!_drugSelectedCode) return;
  if (!confirm("Remove this drug's Patient Instruction?")) return;
  setDrugStatus("Removing…");
  try {
    const r = await fetch(`${SERVER_URL}/api/rx-note/${encodeURIComponent(_drugSelectedCode)}`, { method: "DELETE" });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
    _applyLocalInstruction(_drugSelectedCode, null, null);
    selectDrug(_drugSelectedCode);   // re-render the (now empty) editor
    renderDrugResults();
    setDrugStatus("✅ Removed.", "ok");
  } catch (e) {
    setDrugStatus(`⚠ Remove failed — ${e.message}`, "error");
  }
}

// Keep the in-memory DB in sync with a save/delete so the UI reflects it without
// a full reload.
function _applyLocalInstruction(code, th, en) {
  const e = _drugDb && _drugDb[code];
  if (!e) return;
  let inss = (e.instructions || []).filter((i) => (i.type || "") !== "Patient Instruction");
  if (th != null) inss.push({ type: "Patient Instruction", TH: th, EN: en || th });
  e.instructions = inss;
  e.instructionCount = inss.length;
}

drugSearchEl.addEventListener("input", renderDrugResults);
document.getElementById("drug-reload").addEventListener("click", loadDrugDb);
