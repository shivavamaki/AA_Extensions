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

let overrides = {};   // { phrase: { th, en, mode? } } — pharmacist-saved, server-persisted
let builtins  = {};   // { phrase: { th } } — shipped defaults from AUXILIARY_PHRASES (read-only)
let order = [];        // phrase keys, in display order (built-ins first, then custom)

// Snapshot the built-in phrases exposed by medical-glossary.js. Only the Thai
// value is surfaced (the sheet renders Thai); the full multi-language object
// stays in code. If the glossary didn't load, this is just empty.
function loadBuiltins() {
  const src = (typeof window !== "undefined" && window.AUXILIARY_PHRASES) || {};
  builtins = {};
  Object.keys(src).forEach((k) => {
    const key = normalizeKey(k);
    builtins[key] = { th: (src[k] && src[k].th) || "" };
  });
}

/** Source classification for a phrase key. */
function sourceOf(key) {
  const hasOverride = !!overrides[key];
  const hasBuiltin = Object.prototype.hasOwnProperty.call(builtins, key);
  if (hasBuiltin && hasOverride) return "override"; // built-in shadowed by an edit
  if (hasBuiltin) return "builtin";                 // shipped default, untouched
  return "custom";                                  // pharmacist-added phrase
}

/** The Thai value shown for a key: override wins, else the built-in default. */
function thaiFor(key) {
  if (overrides[key] && overrides[key].th != null) return overrides[key].th;
  if (builtins[key]) return builtins[key].th;
  return "";
}

/** Rebuild the display order: built-in keys first (stable), then custom keys. */
function rebuildOrder() {
  const builtinKeys = Object.keys(builtins);
  const customKeys = Object.keys(overrides).filter((k) => !builtins[k]);
  order = [...builtinKeys, ...customKeys];
}

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

// Ensure an override entry exists for `key`, seeded from the built-in default
// so the first keystroke doesn't blank a shipped phrase. Returns the entry.
function ensureOverride(key) {
  if (!overrides[key]) {
    overrides[key] = {};
    if (builtins[key] && builtins[key].th) overrides[key].th = builtins[key].th;
  }
  return overrides[key];
}

function render() {
  const filter = normalizeKey(searchEl.value);
  rowsEl.innerHTML = "";
  order
    .filter(key => !filter || key.includes(filter))
    .forEach(key => {
      const source = sourceOf(key);           // "builtin" | "override" | "custom"
      const isBuiltin = builtins[key] != null;

      const tr = document.createElement("tr");
      tr.dataset.key = key;
      if (source === "builtin") tr.className = "builtin";

      // ── English phrase (key) — built-in keys are read-only (renaming a
      //    built-in would just orphan it from the engine). Custom keys rename. ──
      const tdKey = document.createElement("td");
      const inKey = document.createElement("input");
      inKey.type = "text";
      inKey.value = key;
      if (isBuiltin) {
        inKey.readOnly = true;
        inKey.title = "Built-in phrase key — cannot be renamed";
      } else {
        inKey.addEventListener("change", () => renameKey(key, inKey.value));
      }
      tdKey.appendChild(inKey);

      // ── Thai translation — editing a built-in creates an override. ──
      const tdTh = document.createElement("td");
      const inTh = document.createElement("input");
      inTh.type = "text";
      inTh.value = thaiFor(key);
      inTh.addEventListener("input", () => {
        const wasBuiltinOnly = sourceOf(key) === "builtin";
        ensureOverride(key).th = inTh.value;
        // First edit of a built-in flips it to an "override" row — reflect the
        // badge/Reset without stealing focus.
        if (wasBuiltinOnly) refreshRowMeta(tr, key);
      });
      tdTh.appendChild(inTh);

      // ── Source badge ──
      const tdSrc = document.createElement("td");
      tdSrc.className = "src-cell";
      tdSrc.appendChild(_srcBadge(source));

      // ── Match mode: "exact" (default) or "replace" (substring) ──
      const tdMode = document.createElement("td");
      const selMode = document.createElement("select");
      for (const [val, label] of [["exact", "Exact / verb"], ["replace", "Replace (substring)"]]) {
        const o = document.createElement("option");
        o.value = val; o.textContent = label;
        selMode.appendChild(o);
      }
      selMode.value = (overrides[key] && overrides[key].mode) || "exact";
      selMode.addEventListener("change", () => {
        const wasBuiltinOnly = sourceOf(key) === "builtin";
        const ov = ensureOverride(key);
        if (selMode.value === "replace") ov.mode = "replace";
        else delete ov.mode;               // exact is the default — keep JSON lean
        if (wasBuiltinOnly) refreshRowMeta(tr, key);
      });
      tdMode.appendChild(selMode);

      // ── Actions: Reset (override→built-in) or Remove (custom). ──
      const tdAct = document.createElement("td");
      tdAct.className = "actions";
      tdAct.appendChild(_rowActionBtn(key));

      tr.appendChild(tdKey);
      tr.appendChild(tdTh);
      tr.appendChild(tdSrc);
      tr.appendChild(tdMode);
      tr.appendChild(tdAct);
      rowsEl.appendChild(tr);
    });
}

function _srcBadge(source) {
  const span = document.createElement("span");
  span.className = "src-badge " + source;
  span.textContent = source === "builtin" ? "Built-in"
                   : source === "override" ? "Override" : "Custom";
  return span;
}

// Reset (for a built-in that has an override) drops the override so the shipped
// default applies again; Remove (for a custom phrase) deletes the row.
function _rowActionBtn(key) {
  const source = sourceOf(key);
  if (source === "custom") {
    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "✕";
    btn.title = "Remove this phrase";
    btn.addEventListener("click", () => removeKey(key));
    return btn;
  }
  if (source === "override") {
    const btn = document.createElement("button");
    btn.className = "linklike";
    btn.textContent = "↩ Reset";
    btn.title = "Drop this override — fall back to the built-in translation";
    btn.addEventListener("click", () => resetToBuiltin(key));
    return btn;
  }
  // built-in, untouched — nothing to reset/remove
  return document.createTextNode("");
}

// Update just the badge + action cell of a row in place (no full re-render, so
// the input keeps focus while typing the first edit of a built-in).
function refreshRowMeta(tr, key) {
  if (tr.dataset.key !== key) return;
  tr.classList.toggle("builtin", sourceOf(key) === "builtin");
  const srcCell = tr.querySelector(".src-cell");
  if (srcCell) { srcCell.innerHTML = ""; srcCell.appendChild(_srcBadge(sourceOf(key))); }
  const actCell = tr.querySelector("td.actions");
  if (actCell) { actCell.innerHTML = ""; actCell.appendChild(_rowActionBtn(key)); }
}

// Drop an override for a built-in phrase → the shipped default applies again.
function resetToBuiltin(key) {
  delete overrides[key];
  render();
}

function renameKey(oldKey, newRaw) {
  const newKey = normalizeKey(newRaw);
  if (!newKey || newKey === oldKey) { render(); return; }
  if (overrides[newKey] || builtins[newKey]) {
    setStatus(`"${newKey}" already exists — merge manually first.`, "error");
    render();
    return;
  }
  overrides[newKey] = overrides[oldKey];
  delete overrides[oldKey];
  const i = order.indexOf(oldKey);
  if (i >= 0) order[i] = newKey; else order.push(newKey);
  render();
}

function removeKey(key) {
  delete overrides[key];
  rebuildOrder();
  render();
}

function addRow() {
  let base = "new phrase", key = base, n = 1;
  while (overrides[key] || builtins[key]) key = `${base} ${++n}`;
  overrides[key] = { th: "" };
  rebuildOrder();
  searchEl.value = "";
  render();
  const lastInput = rowsEl.querySelector("tr:last-child input");
  if (lastInput) lastInput.focus();
}

async function load() {
  setStatus("Loading…");
  loadBuiltins();
  try {
    const r = await fetch(`${SERVER_URL}/api/pattern-overrides`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    overrides = await r.json() || {};
    rebuildOrder();
    render();
    const nBuiltin = Object.keys(builtins).length;
    const nOverride = Object.keys(overrides).filter(k => builtins[k]).length;
    const nCustom = Object.keys(overrides).filter(k => !builtins[k]).length;
    setStatus(`${nBuiltin} built-in · ${nOverride} overridden · ${nCustom} custom.`, "ok");
  } catch (e) {
    overrides = {};
    rebuildOrder();   // still show the built-ins even if the server is down
    render();
    setStatus(`⚠ Could not reach pharmacy server (${SERVER_URL}) — showing built-ins only. ${e.message}`, "error");
  }
}

// Persist ONLY the pharmacist layer: custom phrases + built-in overrides that
// actually differ from the shipped default. Untouched built-ins and empty
// overrides are dropped so the server file stays the minimal delta (no drift:
// the built-ins live in code, not in the saved file).
function save() {
  const clean = {};
  Object.keys(overrides).forEach((key) => {
    if (!key) return;
    const ov = overrides[key];
    if (!ov) return;
    const th = (ov.th || "").trim();
    const mode = ov.mode;
    if (!th && !mode) return;                       // empty row — skip
    if (builtins[key] && th === (builtins[key].th || "").trim() && !mode) {
      return;                                        // identical to built-in — no need to save
    }
    const entry = {};
    if (th) entry.th = ov.th;
    if (mode) entry.mode = mode;
    clean[key] = entry;
  });
  // Reflect the pruning locally so a follow-up edit starts from the saved state.
  overrides = clean;
  rebuildOrder();
  setStatus("Saving…");
  fetch(`${SERVER_URL}/api/pattern-overrides`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(clean),
  })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); })
    .then(() => { render(); setStatus(`✅ Saved ${Object.keys(clean).length} override(s).`, "ok"); })
    .catch((e) => setStatus(`⚠ Save failed — ${e.message}`, "error"));
}

document.getElementById("btnAdd").addEventListener("click", addRow);
document.getElementById("btnSave").addEventListener("click", save);
document.getElementById("btnReload").addEventListener("click", load);
searchEl.addEventListener("input", render);

load();

/* ══════════════════════════════════════════════════════════════════════════
   Tabs
════════════════════════════════════════════════════════════════════════════ */
// Top-level tabs only (`.tabs > .tab`) — the IV DB sub-tabs (.ivdb-sub) also
// carry .tab but are handled separately below.
document.querySelectorAll(".tabs > .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tabs > .tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
    if (tab.dataset.tab === "drugs" && !_drugDb) loadDrugDb();
    if (tab.dataset.tab === "ivdb" && !_ivdbLoaded) ivdbLoad();
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

/* ══════════════════════════════════════════════════════════════════════════
   IV Sticker DB (iv-drugs / iv-staff) — admin-only editor
   GET  /api/iv-drugs | /api/iv-staff   → array (open read)
   PUT  /api/iv-drugs | /api/iv-staff   → replace (needs Bearer admin/editor)
════════════════════════════════════════════════════════════════════════════ */
let _ivdbLoaded = false;
let _ivToken    = null;      // in-memory session token (not persisted)
let _ivUser     = null;
let _ivDrugs    = [];        // [{codeName,generic,type,exp,storage,had,conc,rate}]
let _ivStaff    = [];        // [{name,role}]

const IV_DRUG_TYPES = ["HAD", "PFS", "ATB", "Cytotoxic", "EYE", ""];
const IV_STAFF_ROLES = ["Pharmacist", "Phar.Assist"];
const IV_DRUG_FIELDS = ["codeName", "generic", "type", "exp", "storage", "had", "conc", "rate"];

function ivStatus(msg, cls) {
  const el = document.getElementById("ivdb-status");
  if (el) { el.textContent = msg || ""; el.className = cls || ""; }
}

function ivAuthed() { return !!_ivToken; }

function ivApplyAuthUI() {
  const authed = ivAuthed();
  document.getElementById("ivdb-auth-state").textContent = authed
    ? `Signed in as ${_ivUser} — you can edit.`
    : "Not signed in — sign in to edit.";
  document.getElementById("ivdb-login").hidden  = authed;
  document.getElementById("ivdb-user").hidden   = authed;
  document.getElementById("ivdb-pass").hidden   = authed;
  document.getElementById("ivdb-logout").hidden = !authed;
  // Save buttons only enabled when signed in.
  document.getElementById("ivdb-drug-save").disabled  = !authed;
  document.getElementById("ivdb-staff-save").disabled = !authed;
  // Lock/unlock the row inputs.
  document.getElementById("ivdb-panel-drugs").classList.toggle("ivdb-locked", !authed);
  document.getElementById("ivdb-panel-staff").classList.toggle("ivdb-locked", !authed);
}

async function ivLogin() {
  const u = document.getElementById("ivdb-user").value.trim();
  const p = document.getElementById("ivdb-pass").value;
  if (!u || !p) { ivStatus("Enter username and password.", "error"); return; }
  ivStatus("Signing in…");
  try {
    const r = await fetch(`${SERVER_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    const j = await r.json();
    if (!r.ok) { ivStatus(j.error || "Invalid credentials.", "error"); return; }
    if (!["super_admin", "admin", "editor"].includes(j.role)) {
      ivStatus(`Role "${j.role}" cannot edit the IV DB (need admin/editor).`, "error");
      return;
    }
    _ivToken = j.token; _ivUser = j.username;
    document.getElementById("ivdb-pass").value = "";
    ivApplyAuthUI();
    ivStatus(`Signed in as ${j.username} (${j.role}).`, "ok");
  } catch (e) {
    ivStatus(`Could not reach the server — ${e.message}`, "error");
  }
}

async function ivLogout() {
  if (_ivToken) {
    fetch(`${SERVER_URL}/api/auth/logout`, {
      method: "POST", headers: { Authorization: `Bearer ${_ivToken}` },
    }).catch(() => {});
  }
  _ivToken = null; _ivUser = null;
  ivApplyAuthUI();
  ivStatus("Signed out.", "ok");
}

async function ivFetch(col) {
  const r = await fetch(`${SERVER_URL}/api/${col}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}

async function ivdbLoad() {
  ivStatus("Loading…");
  try {
    [_ivDrugs, _ivStaff] = await Promise.all([ivFetch("iv-drugs"), ivFetch("iv-staff")]);
    _ivdbLoaded = true;
    ivRenderDrugs(); ivRenderStaff();
    ivApplyAuthUI();
    ivStatus(`Loaded ${_ivDrugs.length} drug(s), ${_ivStaff.length} staff.`, "ok");
  } catch (e) {
    ivStatus(`Could not reach the pharmacy server (${SERVER_URL}) — ${e.message}`, "error");
  }
}

// ── Drugs table ──────────────────────────────────────────────────────────
function ivRenderDrugs() {
  const filter = document.getElementById("ivdb-drug-filter").value.trim().toLowerCase();
  const tb = document.getElementById("ivdb-drug-rows");
  tb.innerHTML = "";
  _ivDrugs.forEach((d, idx) => {
    const hay = `${d.codeName || ""} ${d.generic || ""} ${d.type || ""}`.toLowerCase();
    if (filter && !hay.includes(filter)) return;
    const tr = document.createElement("tr");
    tr.appendChild(_ivTextCell(d, "codeName", idx, _ivDrugs));
    tr.appendChild(_ivTextCell(d, "generic", idx, _ivDrugs));
    tr.appendChild(_ivSelectCell(d, "type", IV_DRUG_TYPES, idx, _ivDrugs));
    tr.appendChild(_ivNumCell(d, "exp", idx, _ivDrugs));
    tr.appendChild(_ivTextCell(d, "storage", idx, _ivDrugs));
    tr.appendChild(_ivSelectCell(d, "had", ["", "High Alert Drugs"], idx, _ivDrugs));
    tr.appendChild(_ivTextCell(d, "conc", idx, _ivDrugs));
    tr.appendChild(_ivTextCell(d, "rate", idx, _ivDrugs));
    tr.appendChild(_ivDelCell(idx, _ivDrugs, ivRenderDrugs));
    tb.appendChild(tr);
  });
}

function ivRenderStaff() {
  const filter = document.getElementById("ivdb-staff-filter").value.trim().toLowerCase();
  const tb = document.getElementById("ivdb-staff-rows");
  tb.innerHTML = "";
  _ivStaff.forEach((s, idx) => {
    if (filter && !(`${s.name || ""} ${s.role || ""}`.toLowerCase().includes(filter))) return;
    const tr = document.createElement("tr");
    tr.appendChild(_ivTextCell(s, "name", idx, _ivStaff));
    tr.appendChild(_ivSelectCell(s, "role", IV_STAFF_ROLES, idx, _ivStaff));
    tr.appendChild(_ivDelCell(idx, _ivStaff, ivRenderStaff));
    tb.appendChild(tr);
  });
}

function _ivTextCell(obj, field, idx, arr) {
  const td = document.createElement("td");
  const inp = document.createElement("input");
  inp.type = "text"; inp.value = obj[field] || "";
  inp.addEventListener("input", () => { arr[idx][field] = inp.value; });
  td.appendChild(inp); return td;
}
function _ivNumCell(obj, field, idx, arr) {
  const td = document.createElement("td");
  const inp = document.createElement("input");
  inp.type = "number"; inp.min = "0"; inp.value = obj[field] != null ? obj[field] : "";
  inp.addEventListener("input", () => {
    const n = parseInt(inp.value, 10);
    arr[idx][field] = Number.isNaN(n) ? "" : n;
  });
  td.appendChild(inp); return td;
}
function _ivSelectCell(obj, field, options, idx, arr) {
  const td = document.createElement("td");
  const sel = document.createElement("select");
  options.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o; opt.textContent = o === "" ? "—" : o;
    sel.appendChild(opt);
  });
  sel.value = obj[field] || "";
  sel.addEventListener("change", () => { arr[idx][field] = sel.value; });
  td.appendChild(sel); return td;
}
function _ivDelCell(idx, arr, rerender) {
  const td = document.createElement("td"); td.className = "actions";
  const btn = document.createElement("button");
  btn.className = "danger"; btn.textContent = "✕"; btn.title = "Remove row";
  btn.addEventListener("click", () => { arr.splice(idx, 1); rerender(); });
  td.appendChild(btn); return td;
}

async function ivSave(col, arr) {
  if (!ivAuthed()) { ivStatus("Sign in first.", "error"); return; }
  // Drop blank rows (drugs need a codeName; staff need a name).
  const keyField = col === "iv-drugs" ? "codeName" : "name";
  const clean = arr.filter((x) => x && (x[keyField] || "").trim());
  ivStatus("Saving…");
  try {
    const r = await fetch(`${SERVER_URL}/api/${col}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${_ivToken}` },
      body: JSON.stringify(clean),
    });
    if (r.status === 401 || r.status === 403) {
      _ivToken = null; ivApplyAuthUI();
      ivStatus("Session expired or not authorised — sign in again.", "error");
      return;
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    ivStatus(`✅ Saved ${clean.length} ${col === "iv-drugs" ? "drug(s)" : "staff"}.`, "ok");
  } catch (e) {
    ivStatus(`Save failed — ${e.message}`, "error");
  }
}

// ── Wiring ───────────────────────────────────────────────────────────────
document.getElementById("ivdb-login").addEventListener("click", ivLogin);
document.getElementById("ivdb-pass").addEventListener("keydown", (e) => { if (e.key === "Enter") ivLogin(); });
document.getElementById("ivdb-logout").addEventListener("click", ivLogout);
document.getElementById("ivdb-drug-filter").addEventListener("input", ivRenderDrugs);
document.getElementById("ivdb-staff-filter").addEventListener("input", ivRenderStaff);
document.getElementById("ivdb-drug-reload").addEventListener("click", ivdbLoad);
document.getElementById("ivdb-staff-reload").addEventListener("click", ivdbLoad);
document.getElementById("ivdb-drug-add").addEventListener("click", () => {
  _ivDrugs.unshift({ codeName: "", generic: "", type: "", exp: "", storage: "Keep in Room Temp.", had: "", conc: "", rate: "" });
  ivRenderDrugs();
});
document.getElementById("ivdb-staff-add").addEventListener("click", () => {
  _ivStaff.unshift({ name: "", role: "Pharmacist" });
  ivRenderStaff();
});
document.getElementById("ivdb-drug-save").addEventListener("click", () => ivSave("iv-drugs", _ivDrugs));
document.getElementById("ivdb-staff-save").addEventListener("click", () => ivSave("iv-staff", _ivStaff));
document.querySelectorAll(".ivdb-sub").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ivdb-sub").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const sub = btn.dataset.sub;
    document.getElementById("ivdb-panel-drugs").hidden = sub !== "drugs";
    document.getElementById("ivdb-panel-staff").hidden = sub !== "staff";
  });
});
