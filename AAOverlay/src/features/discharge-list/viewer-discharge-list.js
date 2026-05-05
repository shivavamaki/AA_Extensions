"use strict";

(function () {

  const { loadSnapshots, saveSnapshots, STORAGE_KEY,
          saveChecklist, mergeChecklistIntoSnapshot,
          bridgeStatus, pruneOldSyncKeys,
          debugDumpSync }                             = window.CoreStorage;
  const { escapeHtml } = window.CoreDom;

  const CHECKLIST_ITEMS = [
    { key: "ยาคืน",      label: "ยาคืน"        },
    { key: "ATB",        label: "ATB ก่อนกลับ"  },
    { key: "ยสค้างรับ", label: "ยส ค้างรับ"    },
    { key: "OffSTD",     label: "Off STD"        },
    { key: "ยาติดฉลาก", label: "ยาติดฉลาก"     },
  ];

  let _snapshots      = [];
  let _activeIndex    = -1;
  let _searchQuery    = "";
  let _pendingConfirm = null;
  let _saveTimer      = null;   // debounce checkbox saves

  /* ── Bootstrap ────────────────────────────────────────────────── */
  async function init() {
    pruneOldSyncKeys();
    _snapshots = await loadSnapshots();

    // Merge synced checklist into each snapshot
    await Promise.all(_snapshots.map(s => mergeChecklistIntoSnapshot(s)));
    // Persist merged state back to local
    if (_snapshots.length) await saveSnapshots(_snapshots);

    renderSidebar();
    updateSnapCount();
    bindToolbar();
    bindSectionToggles();
    bindSidebarToggle();
    if (_snapshots.length) selectSnapshot(_snapshots.length - 1);
  }

  /* ── Sidebar toggle ───────────────────────────────────────────── */
  function bindSidebarToggle() {
    document.getElementById("btn-toggle-sidebar")?.addEventListener("click", () => {
      document.getElementById("sidebar")?.classList.toggle("open");
    });
  }

  /* ── Section collapse toggles ─────────────────────────────────── */
  function bindSectionToggles() {
    [["toggle-audit","body-audit"], ["toggle-raw","body-raw"]].forEach(([tid, bid]) => {
      const hdr  = document.getElementById(tid);
      const body = document.getElementById(bid);
      if (!hdr || !body) return;
      hdr.addEventListener("click", () => {
        const open = body.classList.toggle("open");
        hdr.classList.toggle("open", open);
      });
    });
  }

  /* ── Sidebar ──────────────────────────────────────────────────── */
  function renderSidebar() {
    const el = document.getElementById("snap-list");
    if (!el) return;
    if (!_snapshots.length) {
      el.innerHTML = `<div class="no-snaps">No snapshots yet.<br>Use 🔄 on HIS page.</div>`;
      return;
    }
    el.innerHTML = [..._snapshots]
      .map((s, i) => ({ s, i }))
      .reverse()
      .map(({ s, i }) => {
        const d    = new Date(s.capturedAt);
        const date = d.toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "2-digit" });
        const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
        const pts  = Object.keys(s.patientChecklist || {}).length;
        const cl   = s.patientChecklist || {};
        const done = Object.values(cl).filter(c => CHECKLIST_ITEMS.every(it => c[it.key])).length;
        return `
          <div class="snap-item ${i === _activeIndex ? "active" : ""}" data-idx="${i}">
            <div class="snap-date">${date} ${time}</div>
            <div class="snap-meta">${(s.rows||[]).length} rows · ✅${done}/${pts}</div>
            <button class="snap-del" data-del="${i}" title="Delete">✕</button>
          </div>`;
      }).join("");

    el.querySelectorAll(".snap-item").forEach(item => {
      item.addEventListener("click", e => {
        if (e.target.closest(".snap-del")) return;
        selectSnapshot(+item.dataset.idx);
      });
    });
    el.querySelectorAll(".snap-del").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        confirmDeleteSnapshot(+btn.dataset.del);
      });
    });
  }

  function updateSnapCount() {
    const el = document.getElementById("snap-count");
    if (el) el.textContent = `${_snapshots.length} snapshot${_snapshots.length === 1 ? "" : "s"}`;
  }

  /* ── Select ───────────────────────────────────────────────────── */
  function selectSnapshot(idx) {
    _activeIndex = idx;
    renderSidebar();
    renderDataView();
  }

  /* ── Data view ────────────────────────────────────────────────── */
  function renderDataView() {
    const snap = _snapshots[_activeIndex];
    document.getElementById("empty-state").style.display = "none";
    document.getElementById("data-view").style.display   = "block";
    if (!snap) { showEmpty(); return; }

    const d    = new Date(snap.capturedAt);
    const date = d.toLocaleDateString("th-TH", { dateStyle: "medium" });
    const time = d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });

    document.getElementById("view-title").textContent = `${date} · ${time}`;
    document.getElementById("view-sub").textContent   = `เภสัชกร: ${snap.pharmacist || "ไม่ระบุ"}`;

    renderStats(snap);
    renderMainChecklist(snap);
    renderAuditLog(snap);
    renderRawTable(snap);
  }

  function showEmpty() {
    document.getElementById("empty-state").style.display = "flex";
    document.getElementById("data-view").style.display   = "none";
  }

  /* ── Stats ────────────────────────────────────────────────────── */
  function renderStats(snap) {
    const el  = document.getElementById("stats-strip");
    if (!el) return;
    const cl      = snap.patientChecklist || {};
    const pts     = Object.keys(cl).length;
    const allDone = Object.values(cl).filter(c => CHECKLIST_ITEMS.every(i => c[i.key])).length;
    const pending = pts - allDone;

    el.innerHTML = `
      <div class="stat-card"><div class="val">${(snap.rows||[]).length}</div><div class="lbl">ผู้ป่วย</div></div>
      <div class="stat-card"><div class="val" style="color:var(--success);">${allDone}</div><div class="lbl">ครบแล้ว</div></div>
      <div class="stat-card"><div class="val" style="color:#f59e0b;">${pending}</div><div class="lbl">ค้างอยู่</div></div>
      <div class="stat-card"><div class="val">${(snap.auditLog||[]).length}</div><div class="lbl">Edits</div></div>
      <div class="stat-card"><div class="val" style="font-size:12px;">${snap.pharmacist||"—"}</div><div class="lbl">เภสัชกร</div></div>
    `;
  }

  /* ── Main checklist table — interactive ───────────────────────── */
  function renderMainChecklist(snap) {
    const cl   = snap.patientChecklist || {};
    const meta = snap.patientMeta      || {};
    const q    = _searchQuery.toLowerCase();

    let pts = Object.entries(cl).map(([mrn, state], qi) => {
      const m       = meta[mrn] || {};
      const room    = m.bed  || m.ward || "";
      const name    = (m.name && m.name !== mrn) ? m.name : "";
      const done    = CHECKLIST_ITEMS.filter(i => state[i.key]).length;
      const allDone = done === CHECKLIST_ITEMS.length;
      return { mrn, room, name, state, done, allDone, qi: qi + 1 };
    });

    if (q) {
      pts = pts.filter(p =>
        p.room.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.mrn.toLowerCase().includes(q)
      );
    }

    // Sort descending by % done (each item = 20%), then by room ascending
    pts.sort((a, b) => {
      if (b.done !== a.done) return b.done - a.done;          // more done first
      return (a.room || a.mrn).localeCompare(b.room || b.mrn, "th");
    });

    /* Head */
    const thead = document.getElementById("cl-head");
    if (thead) {
      thead.innerHTML = `<tr>
        <th class="col-q">#</th>
        <th class="col-pt">ห้อง — ผู้ป่วย</th>
        ${CHECKLIST_ITEMS.map(i => `<th class="cl-th">${i.label}</th>`).join("")}
      </tr>`;
    }

    /* Body */
    const tbody = document.getElementById("cl-body");
    if (!tbody) return;

    if (!pts.length) {
      tbody.innerHTML = `<tr><td colspan="${CHECKLIST_ITEMS.length + 2}"
        style="text-align:center;padding:30px;color:var(--muted);">
        ${q ? `No results for "${escapeHtml(q)}"` : "No checklist data in this snapshot."}
      </td></tr>`;
      return;
    }

    tbody.innerHTML = pts.map(p => {
      const pct  = Math.round(p.done / CHECKLIST_ITEMS.length * 100);
      const bar  = `<div class="prog-bar"><div class="prog-fill ${p.allDone?"done":""}"
                      style="width:${pct}%;"></div></div>`;
      const room = p.room ? escapeHtml(p.room) : "—";
      const name = p.name ? `<div class="pt-name">${escapeHtml(p.name)}</div>` : "";
      const mrn  = `<div class="pt-mrn">${escapeHtml(p.mrn)}</div>`;

      /* Interactive checkbox cells — data-mrn + data-key for event delegation */
      const clCells = CHECKLIST_ITEMS.map(i => {
        const checked = !!p.state[i.key];
        return `<td class="cl-cell">
          <label class="cl-check-label">
            <input type="checkbox"
              class="cl-cb"
              data-mrn="${escapeHtml(p.mrn)}"
              data-key="${i.key}"
              ${checked ? "checked" : ""}
            />
            <span class="cl-check-custom ${checked ? "checked" : ""}"></span>
          </label>
        </td>`;
      }).join("");

      return `<tr class="${p.allDone ? "row-done" : ""}" data-mrn="${escapeHtml(p.mrn)}">
        <td class="col-q">${p.qi}</td>
        <td class="col-pt">
          <div class="pt-bed">${room}</div>
          ${name}${mrn}${bar}
        </td>
        ${clCells}
      </tr>`;
    }).join("");

    /* Single delegated listener on tbody — handles all checkboxes */
    tbody.removeEventListener("change", _onCheckboxChange);
    tbody.addEventListener("change", _onCheckboxChange);
  }

  /* ── Checkbox change handler ──────────────────────────────────── */
  function _onCheckboxChange(e) {
    const cb = e.target;
    if (!cb.matches("input.cl-cb")) return;

    const mrn  = cb.dataset.mrn;
    const key  = cb.dataset.key;
    const snap = _snapshots[_activeIndex];
    if (!snap || !mrn || !key) return;

    /* Update in-memory snapshot */
    if (!snap.patientChecklist)        snap.patientChecklist = {};
    if (!snap.patientChecklist[mrn])   snap.patientChecklist[mrn] = {};
    snap.patientChecklist[mrn][key] = cb.checked;

    /* Update visual custom checkbox span */
    const span = cb.nextElementSibling;
    if (span) span.classList.toggle("checked", cb.checked);

    /* Update row done class and progress bar without full re-render */
    const row  = cb.closest("tr[data-mrn]");
    const state = snap.patientChecklist[mrn];
    const done  = CHECKLIST_ITEMS.filter(i => state[i.key]).length;
    const allDone = done === CHECKLIST_ITEMS.length;
    const pct   = Math.round(done / CHECKLIST_ITEMS.length * 100);

    if (row) {
      row.classList.toggle("row-done", allDone);
      // Update cells' custom spans
      row.querySelectorAll("td.col-pt").forEach(td => {
        const fill = td.querySelector(".prog-fill");
        if (fill) {
          fill.style.width = `${pct}%`;
          fill.classList.toggle("done", allDone);
        }
      });
    }

    /* Re-sort rows: if just completed, move to top */
    _resortRows();

    /* Update stats strip */
    renderStats(snap);

    /* Debounced save to chrome.storage */
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => _persistSnapshot(), 600);
  }

  /* ── Re-sort tbody rows without full re-render ─────────────────── */
  function _resortRows() {
    const tbody = document.getElementById("cl-body");
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll("tr[data-mrn]"));
    rows.sort((a, b) => {
      // Count checked boxes per row
      const aC = a.querySelectorAll("input.cl-cb:checked").length;
      const bC = b.querySelectorAll("input.cl-cb:checked").length;
      if (bC !== aC) return bC - aC;                          // more checked first
      const aRoom = a.querySelector(".pt-bed")?.textContent || "";
      const bRoom = b.querySelector(".pt-bed")?.textContent || "";
      return aRoom.localeCompare(bRoom, "th");
    });
    rows.forEach(r => tbody.appendChild(r));
  }

  /* ── Persist updated snapshot to storage ──────────────────────── */
  async function _persistSnapshot() {
    const snap = _snapshots[_activeIndex];
    if (!snap) return;
    try {
      await saveSnapshots(_snapshots);

      // Also sync checklist to Google account
      const dateIso = (snap.capturedAt || "").slice(0, 10);
      if (dateIso) await saveChecklist(dateIso, snap.patientChecklist || {});

      _showSaveIndicator();
      renderSidebar();
    } catch (e) {
      console.error("[viewer] save failed:", e);
    }
  }

  /* ── Brief "Saved" toast on the page ─────────────────────────── */
  function _showSaveIndicator() {
    let el = document.getElementById("save-indicator");
    if (!el) {
      el = document.createElement("div");
      el.id = "save-indicator";
      el.style.cssText = `
        position:fixed;bottom:16px;right:16px;
        background:#2e7d32;color:#fff;
        padding:8px 16px;border-radius:8px;
        font-size:13px;font-weight:600;
        box-shadow:0 2px 8px rgba(0,0,0,.2);
        z-index:9999;opacity:0;
        transition:opacity .25s;
      `;
      document.body.appendChild(el);
    }
    el.textContent = "✅ Saved";
    el.style.opacity = "1";
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.opacity = "0"; }, 1500);
  }

  /* ── Audit log ────────────────────────────────────────────────── */
  function renderAuditLog(snap) {
    const el = document.getElementById("audit-panel");
    if (!el) return;
    const log = snap.auditLog || [];
    if (!log.length) {
      el.innerHTML = `<span style="color:var(--muted);font-size:12px;">No audit entries</span>`;
      return;
    }
    el.innerHTML = `<table class="audit-table">
      <thead><tr><th>Time</th><th>By</th><th>Action</th><th>Rows</th><th>Patients</th></tr></thead>
      <tbody>
        ${[...log].reverse().map(e => {
          const t   = new Date(e.at).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
          const pts = Object.keys(e.patientChecklist || {}).length;
          return `<tr>
            <td style="white-space:nowrap;">${t}</td>
            <td>${escapeHtml(e.by)}</td>
            <td><span class="action-badge action-${e.action}">${e.action}</span></td>
            <td>${e.rowCount}</td>
            <td>${pts} patients</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>`;
  }

  /* ── Raw data table ───────────────────────────────────────────── */
  function renderRawTable(snap) {
    const headers = snap.headers || [];
    const rawRows = snap.rows    || [];
    const q       = _searchQuery.toLowerCase();
    const rows    = rawRows.filter(row => !q || row.some(c => c.toLowerCase().includes(q)));

    const thead = document.getElementById("table-head");
    if (thead) {
      thead.innerHTML = `<tr>
        <th style="background:#f0f4ff;padding:6px 10px;font-size:11px;border-bottom:2px solid var(--border);">#</th>
        ${headers.map(h => `<th style="background:#f0f4ff;padding:6px 10px;font-weight:700;font-size:11px;border-bottom:2px solid var(--border);white-space:nowrap;">${escapeHtml(h)}</th>`).join("")}
      </tr>`;
    }

    const tbody = document.getElementById("table-body");
    if (!tbody) return;

    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${headers.length+1}" style="text-align:center;padding:20px;color:var(--muted);">No data</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((row, ri) => `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:5px 10px;color:var(--muted);font-size:11px;">${ri+1}</td>
        ${headers.map((_, ci) => `<td style="padding:5px 10px;font-size:12px;">${_highlight(escapeHtml(row[ci]??''), q)}</td>`).join("")}
      </tr>`).join("");
  }

  /* ── Search ───────────────────────────────────────────────────── */
  document.getElementById("search-box")?.addEventListener("input", e => {
    _searchQuery = e.target.value.trim();
    if (_activeIndex >= 0) {
      renderMainChecklist(_snapshots[_activeIndex]);
      renderRawTable(_snapshots[_activeIndex]);
    }
  });

  /* ── Toolbar ──────────────────────────────────────────────────── */
  function bindToolbar() {
    document.getElementById("btn-export-json")?.addEventListener("click", exportJSON);
    document.getElementById("btn-export-csv")?.addEventListener("click",  exportCSV);
    document.getElementById("btn-print")?.addEventListener("click",       () => window.print());
    document.getElementById("btn-clear-all")?.addEventListener("click",   confirmClearAll);
    document.getElementById("btn-delete-snap")?.addEventListener("click", () => {
      if (_activeIndex >= 0) confirmDeleteSnapshot(_activeIndex);
    });
    document.getElementById("btn-sync-refresh")?.addEventListener("click", forceSyncRefresh);
  }

  /* ── Force sync refresh — pull latest checklist from sync ─────── */
  async function forceSyncRefresh() {
    const btn = document.getElementById("btn-sync-refresh");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Syncing…"; }

    try {
      // Re-merge sync into all snapshots
      await Promise.all(_snapshots.map(s => mergeChecklistIntoSnapshot(s)));
      await saveSnapshots(_snapshots);

      renderSidebar();
      updateSnapCount();
      if (_activeIndex >= 0 && _activeIndex < _snapshots.length) {
        renderDataView();
      }

      if (btn) {
        btn.textContent = "✅ Synced";
        setTimeout(() => { btn.disabled = false; btn.textContent = "🔄 Sync"; }, 1500);
      }
    } catch (e) {
      console.error("[viewer] force sync failed:", e);
      if (btn) {
        btn.textContent = "❌ Failed";
        setTimeout(() => { btn.disabled = false; btn.textContent = "🔄 Sync"; }, 1500);
      }
    }
  }

  /* ── Export JSON ──────────────────────────────────────────────── */
  function exportJSON() {
    const snap = _activeIndex >= 0 ? _snapshots[_activeIndex] : null;
    const data = snap ?? _snapshots;
    _download(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      snap ? `dc-list-${snap.id}.json` : "dc-lists-all.json"
    );
  }

  /* ── Export CSV ───────────────────────────────────────────────── */
  function exportCSV() {
    const snap = _activeIndex >= 0 ? _snapshots[_activeIndex] : null;
    if (!snap) { alert("Please select a snapshot first."); return; }

    const cl   = snap.patientChecklist || {};
    const meta = snap.patientMeta      || {};

    const metaRows = [
      `"DC List Export"`,
      `"Date:","${snap.capturedAt}"`,
      `"Pharmacist:","${snap.pharmacist||""}"`,
      "",
    ];

    const clHeaders = CHECKLIST_ITEMS.map(i => `"${i.label}"`).join(",");
    const ptRows = [
      `"#","Bed","Name","MRN",${clHeaders}`,
      ...Object.entries(cl).map(([mrn, state], qi) => {
        const m = meta[mrn] || {};
        return [
          `"${qi+1}"`,
          `"${(m.bed||"").replace(/"/g,'""')}"`,
          `"${(m.name||mrn).replace(/"/g,'""')}"`,
          `"${mrn}"`,
          ...CHECKLIST_ITEMS.map(i => state[i.key] ? '"YES"' : '"NO"'),
        ].join(",");
      }),
    ];

    const rawSection = [
      "", `"--- Raw Data ---"`,
      [...(snap.headers||[]).map(h=>`"${h}"`)].join(","),
      ...(snap.rows||[]).map(row => row.map(c => `"${(c||"").replace(/"/g,'""')}"`).join(",")),
    ];

    const auditSection = [
      "", `"--- Audit Log ---"`,
      `"Time","By","Action","Rows","Patients"`,
      ...(snap.auditLog||[]).map(e =>
        `"${e.at}","${e.by}","${e.action}","${e.rowCount}","${Object.keys(e.patientChecklist||{}).length}"`
      ),
    ];

    const csv = [...metaRows, ...ptRows, ...rawSection, ...auditSection].join("\r\n");
    _download(new Blob(["\uFEFF"+csv], { type: "text/csv;charset=utf-8;" }), `dc-list-${snap.id}.csv`);
  }

  function _download(blob, filename) {
    const a = document.createElement("a");
    a.href  = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── Delete one ───────────────────────────────────────────────── */
  function confirmDeleteSnapshot(idx) {
    const snap = _snapshots[idx];
    const d    = new Date(snap.capturedAt).toLocaleString("th-TH");
    _showModal("Delete Snapshot", `Delete snapshot from ${d}?`, async () => {
      _snapshots.splice(idx, 1);
      await saveSnapshots(_snapshots);
      if (_activeIndex === idx)    { _activeIndex = -1; showEmpty(); }
      else if (_activeIndex > idx) { _activeIndex--; }
      renderSidebar(); updateSnapCount();
    });
  }

  /* ── Clear all ────────────────────────────────────────────────── */
  function confirmClearAll() {
    if (!_snapshots.length) return;
    _showModal("Clear All", `Delete all ${_snapshots.length} snapshots?`, async () => {
      _snapshots = []; _activeIndex = -1;
      await saveSnapshots([]);
      renderSidebar(); updateSnapCount(); showEmpty();
    });
  }

  /* ── Modal ────────────────────────────────────────────────────── */
  function _showModal(title, body, onOk) {
    document.getElementById("modal-title").textContent = title;
    document.getElementById("modal-body").textContent  = body;
    document.getElementById("confirm-modal").style.display = "flex";
    _pendingConfirm = onOk;
  }
  document.getElementById("modal-ok")?.addEventListener("click", async () => {
    document.getElementById("confirm-modal").style.display = "none";
    if (_pendingConfirm) { await _pendingConfirm(); _pendingConfirm = null; }
  });
  document.getElementById("modal-cancel")?.addEventListener("click", () => {
    document.getElementById("confirm-modal").style.display = "none";
    _pendingConfirm = null;
  });

  /* ── Highlight ────────────────────────────────────────────────── */
  function _highlight(html, q) {
    if (!q) return html;
    const safe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return html.replace(new RegExp(`(${safe})`, "gi"), "<mark>$1</mark>");
  }

  /* ── Live sync storage update — another PC ticked a checkbox ────── */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    const snap = _snapshots[_activeIndex];
    if (!snap) return;
    const dateKey = "dc_cl_" + (snap.capturedAt || "").slice(0, 10);
    if (!changes[dateKey]) return;

    const raw = changes[dateKey].newValue || {};
    const CL_KEYS = window.CoreStorage.CL_KEYS;
    Object.entries(raw).forEach(([mrn, arr]) => {
      if (!snap.patientChecklist) snap.patientChecklist = {};
      const state = {};
      CL_KEYS.forEach((k, i) => { state[k] = !!(arr && arr[i]); });
      snap.patientChecklist[mrn] = state;
    });
    renderMainChecklist(snap);
    renderStats(snap);
    renderSidebar();
  });

  /* ── Live local storage update (content script saves while viewer open) */
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[STORAGE_KEY]) return;
    _snapshots = changes[STORAGE_KEY].newValue || [];
    renderSidebar(); updateSnapCount();
    if (_activeIndex >= 0 && _activeIndex < _snapshots.length) renderDataView();
    else if (_snapshots.length) selectSnapshot(_snapshots.length - 1);
  });

  init();

})();
