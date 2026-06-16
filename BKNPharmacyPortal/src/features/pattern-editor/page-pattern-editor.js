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
