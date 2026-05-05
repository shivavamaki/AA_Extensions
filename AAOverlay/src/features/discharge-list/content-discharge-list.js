"use strict";

if (!window.arcusDischargeListLoaded) {
  window.arcusDischargeListLoaded = true;

  const { debounce }                          = window.CoreUtils;
  const { loadSnapshots, saveSnapshots,
          MAX_SNAPSHOTS }                     = window.CoreStorage;
  const { getPharmacistName, parsePatientRow,
          scrapeTable }                       = window.ParserDischargeList;

  const CHECKLIST_ITEMS = [
    { key: "ยาคืน",      label: "ยาคืน"        },
    { key: "ATB",        label: "ATB ก่อนกลับ"  },
    { key: "ยสค้างรับ", label: "ยส ค้างรับ"    },
    { key: "OffSTD",     label: "Off STD"        },
    { key: "ยาติดฉลาก", label: "ยาติดฉลาก"     },
  ];
  const _defaultCheck = () =>
    Object.fromEntries(CHECKLIST_ITEMS.map(i => [i.key, false]));

  const LIST_ROWS_SEL = "md-table-container table > tbody > tr";

  let _ptCheck   = {};
  let _activeMrn = null;

  function _getRoutePath() {
    const m = (window.location.hash || "").match(/^#!\/([^?&#]+)/);
    return m ? m[1] : "";
  }
  const isDischargeListRoute  = () => _getRoutePath() === "inpatient/dischargelist";
  const hasDischargeListDom   = () =>
    !!document.querySelector("md-table-container table > tbody > tr td:nth-child(1) patient-banner") ||
    !!document.querySelector("md-table-container table > tbody > tr td:nth-child(2)");
  const isDischargeListActive = () => isDischargeListRoute() && hasDischargeListDom();

  function _getVisiblePatients() {
    const { patientMeta } = scrapeTable();
    return Object.entries(patientMeta).map(([mrn, m]) => ({
      mrn, name: m.name || mrn, bed: m.bed || "", ward: m.ward || "",
    }));
  }

  function _getActiveRowMrn(patients) {
    const rows = Array.from(document.querySelectorAll(LIST_ROWS_SEL));
    for (const tr of rows) {
      if (/\bactive\b|\bselected\b|\bmd-active\b/i.test(tr.className || "")) {
        const p = parsePatientRow(tr, null);
        if (p?.mrn) return p.mrn;
      }
    }
    if (_activeMrn && patients.some(p => p.mrn === _activeMrn)) return _activeMrn;
    return patients[0]?.mrn || null;
  }

  function _ensurePatient(mrn) {
    if (mrn && !_ptCheck[mrn]) _ptCheck[mrn] = _defaultCheck();
  }

  let _rowListenersBound = false;
  function _bindRowClickListeners() {
    if (_rowListenersBound) return;
    const rows = document.querySelectorAll(LIST_ROWS_SEL);
    if (!rows.length) return;
    rows.forEach(tr => {
      tr.addEventListener("click", () => {
        const p = parsePatientRow(tr, null);
        if (!p?.mrn) return;
        _activeMrn = p.mrn;
        _ensurePatient(_activeMrn);
        _updateChecklistDisplay();
      }, { capture: true });
    });
    _rowListenersBound = true;
  }

  /* ── Save active patient only ─────────────────────────────── */
  async function updateActivePatient() {
    if (!_activeMrn) throw new Error("No patient selected");

    const pharmacist = getPharmacistName();
    const todayKey   = new Date().toISOString().slice(0, 10);
    const all        = await loadSnapshots();

    const idx = all.findIndex(s =>
      s.capturedAt?.startsWith(todayKey) && s.pharmacist === pharmacist
    );

    const patientState = JSON.parse(JSON.stringify(_ptCheck[_activeMrn] || _defaultCheck()));
    const auditEntry   = {
      at: new Date().toISOString(), by: pharmacist || "unknown",
      action: "checklist-update", mrn: _activeMrn, state: patientState,
    };

    if (idx >= 0) {
      const snap = all[idx];
      if (!snap.patientChecklist) snap.patientChecklist = {};
      snap.patientChecklist[_activeMrn] = patientState;
      snap.auditLog = [...(snap.auditLog || []), auditEntry];
      all[idx] = snap;
    } else {
      const { headers, rows, patientMeta } = scrapeTable();
      all.push({
        id: Date.now(), capturedAt: new Date().toISOString(),
        pharmacist, headers, rows, patientMeta,
        patientChecklist: { [_activeMrn]: patientState },
        auditLog: [auditEntry],
      });
      if (all.length > MAX_SNAPSHOTS) all.splice(0, all.length - MAX_SNAPSHOTS);
    }

    await saveSnapshots(all);
    return { mrn: _activeMrn };
  }

  /* ── Full table save (from popup) ─────────────────────────── */
  async function updateDcList() {
    const { headers, rows, patientMeta } = scrapeTable();
    if (!rows.length) throw new Error("No rows found in table");

    const pharmacist = getPharmacistName();
    const todayKey   = new Date().toISOString().slice(0, 10);
    const all        = await loadSnapshots();

    const idx = all.findIndex(s =>
      s.capturedAt?.startsWith(todayKey) && s.pharmacist === pharmacist
    );

    const auditEntry = {
      at: new Date().toISOString(), by: pharmacist || "unknown",
      action: idx >= 0 ? "updated" : "created",
      rowCount: rows.length,
      patientChecklist: JSON.parse(JSON.stringify(_ptCheck)),
    };

    let snapshot;
    if (idx >= 0) {
      snapshot = {
        ...all[idx], capturedAt: new Date().toISOString(),
        headers, rows, patientMeta,
        patientChecklist: JSON.parse(JSON.stringify(_ptCheck)),
        auditLog: [...(all[idx].auditLog || []), auditEntry],
      };
      all[idx] = snapshot;
    } else {
      snapshot = {
        id: Date.now(), capturedAt: new Date().toISOString(),
        pharmacist, headers, rows, patientMeta,
        patientChecklist: JSON.parse(JSON.stringify(_ptCheck)),
        auditLog: [auditEntry],
      };
      all.push(snapshot);
      if (all.length > MAX_SNAPSHOTS) all.splice(0, all.length - MAX_SNAPSHOTS);
    }

    await saveSnapshots(all);
    return { total: all.length, snapshot, updated: idx >= 0 };
  }

  /* ── Overlay ──────────────────────────────────────────────── */
  const OVERLAY_COLLAPSE_KEY = "overlay:min:dischargelist";
  function setupOverlayToggle(overlay) {
    const btn  = overlay.querySelector(".overlay-toggle");
    const body = overlay.querySelector(".overlay-body");
    if (!btn || !body) return;
    function apply(c) {
      overlay.classList.toggle("collapsed", c);
      body.style.display = c ? "none" : "";
      btn.textContent = c ? "▢" : "–";
      sessionStorage.setItem(OVERLAY_COLLAPSE_KEY, c ? "1" : "0");
    }
    apply(sessionStorage.getItem(OVERLAY_COLLAPSE_KEY) === "1");
    btn.addEventListener("click", () => apply(!overlay.classList.contains("collapsed")));
  }

  function _buildChecklistHTML(mrn) {
    const state = _ptCheck[mrn] || _defaultCheck();
    return CHECKLIST_ITEMS.map(it => `
      <label style="display:flex;align-items:center;gap:6px;padding:3px 0;cursor:pointer;font-size:12px;user-select:none;">
        <input type="checkbox" data-key="${it.key}" ${state[it.key] ? "checked" : ""}
               style="width:14px;height:14px;cursor:pointer;accent-color:#1976d2;" />
        <span>${it.label}</span>
      </label>`).join("");
  }

  function _updateChecklistDisplay() {
    const nameEl = document.getElementById("dl-pt-name");
    const boxEl  = document.getElementById("dl-checklist-boxes");
    if (!nameEl || !boxEl || !_activeMrn) return;

    const pts = _getVisiblePatients();
    const pt  = pts.find(p => p.mrn === _activeMrn);
    if (pt) {
      const room = pt.bed || pt.ward || "";
      const name = (pt.name && pt.name !== pt.mrn) ? pt.name : "";
      nameEl.textContent = [room, name].filter(Boolean).join(" — ") || pt.mrn;
    } else {
      nameEl.textContent = _activeMrn;
    }

    boxEl.innerHTML = _buildChecklistHTML(_activeMrn);
    _bindCheckboxes();

    const state = _ptCheck[_activeMrn] || {};
    const done  = CHECKLIST_ITEMS.filter(i => state[i.key]).length;
    const pct   = Math.round(done / CHECKLIST_ITEMS.length * 100);
    const fill  = document.getElementById("dl-pt-progress-fill");
    if (fill) {
      fill.style.width      = `${pct}%`;
      fill.style.background = pct === 100 ? "#2e7d32" : "#1976d2";
    }
  }

  function _bindCheckboxes() {
    document.querySelectorAll("#dl-checklist-boxes input[type=checkbox]").forEach(cb => {
      cb.addEventListener("change", () => {
        if (!_activeMrn) return;
        _ensurePatient(_activeMrn);
        _ptCheck[_activeMrn][cb.dataset.key] = cb.checked;
        _updateChecklistDisplay();
      });
    });
  }

  function ensureOverlay() {
    if (document.getElementById("dischargelist-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "dischargelist-overlay";
    overlay.style.display = "none";
    overlay.innerHTML = `
      <button class="overlay-toggle" title="Minimize">–</button>
      <div class="checklist-header">🗂️ Discharge List</div>
      <div class="overlay-body">
        <div style="display:flex;align-items:center;gap:6px;justify-content:space-between;flex-wrap:wrap;margin-bottom:8px;">
          <div id="dl-summary" style="flex:1;min-width:0;font-size:12px;">—</div>
          <button id="dl-save" class="overlay-action refresh-btn" type="button" style="flex-shrink:0;">
            <span class="icon">💾</span><span class="label">Save</span>
          </button>
        </div>
        <div style="background:#e8f0fe;border-radius:6px;padding:8px 10px;margin-bottom:6px;">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;margin-bottom:4px;">ผู้ป่วยที่เลือก</div>
          <div id="dl-pt-name" style="font-size:13px;font-weight:600;color:#1a1a2e;margin-bottom:6px;">— คลิกที่ผู้ป่วยในตาราง —</div>
          <div id="dl-pt-progress" style="height:5px;background:#dde1e7;border-radius:3px;margin-bottom:8px;">
            <div id="dl-pt-progress-fill" style="height:100%;width:0%;background:#1976d2;border-radius:3px;transition:width .3s;"></div>
          </div>
          <div id="dl-checklist-boxes"></div>
        </div>
        <div id="dl-items" style="font-size:11px;color:#6b7280;margin-top:4px;"></div>
      </div>`;
    document.body.appendChild(overlay);
    setupOverlayToggle(overlay);

    overlay.querySelector("#dl-save").addEventListener("click", async (e) => {
      const btn   = e.currentTarget;
      const label = btn.querySelector(".label");
      if (btn.disabled) return;
      btn.disabled = true;
      label.textContent = "Saving…";
      try {
        await updateActivePatient();
        label.textContent = "Saved ✓";
        setTimeout(() => { btn.disabled = false; label.textContent = "Save"; }, 1400);
      } catch (err) {
        label.textContent = err.message || "Error";
        setTimeout(() => { btn.disabled = false; label.textContent = "Save"; }, 1600);
      }
    });
  }

  function renderOverlay(patients) {
    const summary = document.getElementById("dl-summary");
    if (summary) {
      const pharm = getPharmacistName();
      summary.textContent = pharm || `${patients.length} patients`;
    }
    patients.forEach(p => _ensurePatient(p.mrn));
    const autoMrn = _getActiveRowMrn(patients);
    if (autoMrn && autoMrn !== _activeMrn) _activeMrn = autoMrn;
    else if (!_activeMrn && patients.length) _activeMrn = patients[0].mrn;
    _bindRowClickListeners();
    _updateChecklistDisplay();
    const el = document.getElementById("dl-items");
    if (el) el.textContent = `${patients.length} patient${patients.length === 1 ? "" : "s"} on page`;
  }

  function updateOverlay() {
    if (!isDischargeListActive()) return;
    ensureOverlay();
    renderOverlay(_getVisiblePatients());
  }
  const updateOverlayDebounced = debounce(updateOverlay, 300);

  function maybeShowOverlay() {
    ensureOverlay();
    const overlay = document.getElementById("dischargelist-overlay");
    if (!overlay) return;
    if (isDischargeListActive()) {
      overlay.style.display = "block";
      _rowListenersBound = false;
      updateOverlayDebounced();
    } else {
      overlay.style.display = "none";
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type !== "DC_LIST_UPDATE") return;
    updateDcList()
      .then(({ total, snapshot, updated }) =>
        sendResponse({ ok: true, updated, rows: snapshot.rows.length, total })
      )
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  });

  ensureOverlay();
  setTimeout(maybeShowOverlay, 200);
  window.addEventListener("hashchange", () => { _rowListenersBound = false; setTimeout(maybeShowOverlay, 150); });
  new MutationObserver(() => maybeShowOverlay())
    .observe(document.body, { childList: true, subtree: true });

}
