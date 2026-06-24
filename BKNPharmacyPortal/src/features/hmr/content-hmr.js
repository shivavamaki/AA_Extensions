"use strict";
// src/features/hmr/content-hmr.js
// Home Medication Review (HMR) workstation — ward view injection.
//
// Key design:
//   • visitid (I48-xx-xxxxxx) is the primary record key on the server.
//   • hn (48-xx-xxxxxxx) is stored as a secondary field.
//   • All state persists to the pharmacy server (/api/hmr/{visitid}).
//   • Server does read-merge-write on PUT, so concurrent edits from
//     multiple PCs are safe: auditLog entries are always appended,
//     checklist/step fields use last-write-wins.
//   • Every user action is logged with username + ISO timestamp.
//   • Username is read from the logged-in pharmacist span in the page.

(function () {
  if (window.__BKN_HMR_LOADED__) return;
  window.__BKN_HMR_LOADED__ = true;

  const { norm } = window.CoreDom;

  const VISITID_RE = /\b(I48-\d{2}-\d{6})\b/;
  const HN_RE      = /\b(48-\d{2}-\d{7})\b/;

  // ── Runtime state ────────────────────────────────────────────────────
  let _currentVisitId = null;   // primary key
  let _currentHN      = null;   // secondary key
  let _currentUser    = null;   // cached pharmacist display name
  let _state          = null;   // in-memory working copy (server is authoritative)
  let _lastH4         = null;

  // ── Username detection ───────────────────────────────────────────────
  // Reads <span class="ng-binding ng-scope">ศิวาวุธ มงคล, ภก.</span>

  function detectUsername() {
    if (_currentUser) return _currentUser;
    for (const el of document.querySelectorAll("span.ng-binding.ng-scope, span.ng-binding")) {
      const t = norm(el.textContent);
      if (t && t.includes(",") && (t.includes("ภก.") || t.includes("ภญ."))) {
        _currentUser = t;
        return t;
      }
    }
    return "Unknown";
  }

  // ── Visit ID + HN detection ──────────────────────────────────────────

  function detectInPanel(re) {
    const h4 = findVisitDetailsH4();
    if (h4) {
      let el = h4.parentElement;
      for (let i = 0; i < 14 && el; i++) {
        const m = re.exec(el.textContent);
        if (m) return m[1];
        el = el.parentElement;
      }
    }
    const m = re.exec(document.body.textContent);
    return m ? m[1] : null;
  }

  function detectVisitId() { return detectInPanel(VISITID_RE); }
  function detectHN()      { return detectInPanel(HN_RE); }

  // ── Server persistence ───────────────────────────────────────────────

  async function serverLoad(visitid) {
    if (!window.BKNData) return null;
    try {
      const r = await window.BKNData.serverFetch(`/api/hmr/${encodeURIComponent(visitid)}`);
      return (r && r.ok && r.json && r.json.visitid) ? r.json : null;
    } catch (_) { return null; }
  }

  async function serverSave(visitid, patch, logEntry) {
    if (!window.BKNData) return false;
    const body = {
      ...patch,
      lastModifiedBy: detectUsername(),
      lastModifiedAt: new Date().toISOString(),
      auditLog: logEntry ? [logEntry] : [],
    };
    try {
      const r = await window.BKNData.serverFetch(`/api/hmr/${encodeURIComponent(visitid)}`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
      return !!(r && r.ok);
    } catch (_) { return false; }
  }

  function makeLog(action) {
    return { ts: new Date().toISOString(), user: detectUsername(), action };
  }

  // ── Page helpers ─────────────────────────────────────────────────────

  function isWardView() {
    return location.href.includes("inpatient/wardview");
  }

  function findVisitDetailsH4() {
    for (const h of document.querySelectorAll("h4")) {
      if (norm(h.textContent) === "Visit Details") return h;
    }
    return null;
  }

  function findPatientTrackingRow() {
    for (const h of document.querySelectorAll("h4")) {
      if (norm(h.textContent) === "Patient Tracking") {
        return h.closest('[layout="row"]') || h.parentElement;
      }
    }
    return null;
  }

  function detectDischargeStatus() {
    const KEYWORDS = ["Discharge Order", "Discharge Advice"];
    for (const el of document.querySelectorAll("[ng-bind],[ng-bind-html]")) {
      const t = norm(el.textContent);
      for (const kw of KEYWORDS) {
        if (t === kw || t.startsWith(kw)) return kw;
      }
    }
    const h4 = findVisitDetailsH4();
    if (h4) {
      let c = h4.parentElement;
      for (let i = 0; i < 8 && c; i++) {
        for (const kw of KEYWORDS) {
          if (c.textContent.includes(kw)) return kw;
        }
        c = c.parentElement;
      }
    }
    return null;
  }

  // ── State factory ────────────────────────────────────────────────────

  function newState(visitid, hn) {
    return {
      visitid,
      hn:        hn || null,
      startedAt: new Date().toISOString(),
      checklist: {
        hasAtb:              null,
        medReturned:         null,
        controlledRemaining: null,
        dischargeStatus:     detectDischargeStatus(),
      },
      steps: {
        homeMedOrdered:    "pending",
        continueOrdersOff: "pending",
        allocateDispensed: "pending",
        reportsPrinted:    "pending",
      },
      lastModifiedBy: detectUsername(),
      lastModifiedAt: new Date().toISOString(),
      auditLog:    [],
      completedAt: null,
    };
  }

  // ── Render ───────────────────────────────────────────────────────────

  const CHECKS = [
    { key: "hasAtb",              th: "มี ATB ก่อน D/C?",        en: "ATB before discharge?" },
    { key: "medReturned",         th: "คืนยาเหลือแล้ว?",         en: "Unused meds returned?" },
    { key: "controlledRemaining", th: "ยาเสพติด/วอ. ค้างอยู่?", en: "Controlled drugs remaining?" },
  ];

  const STEPS = [
    { key: "homeMedOrdered",    num: 5, label: "Home med order" },
    { key: "continueOrdersOff", num: 6, label: "Off continue orders" },
    { key: "allocateDispensed", num: 7, label: "Allocate / Dispense" },
    { key: "reportsPrinted",    num: 8, label: "Print reports" },
  ];

  function renderWS(state) {
    const { checklist, steps, visitid, hn, lastModifiedBy } = state;
    const allChecked = CHECKS.every(c => checklist[c.key] !== null);
    const dc = checklist.dischargeStatus;

    const dcHtml = dc
      ? `<span class="hmr-dc-badge hmr-dc-ok">${dc} ✓</span>`
      : `<span class="hmr-dc-badge hmr-dc-warn">D/C status not detected</span>`;

    const chipLabel = visitid + (hn ? ` · HN ${hn}` : "");
    const checkHtml = CHECKS.map(c => {
      const v = checklist[c.key];
      return `<div class="hmr-check-row">
        <div class="hmr-check-text">
          <div class="hmr-ck-th">${c.th}</div>
          <div class="hmr-ck-en">${c.en}</div>
        </div>
        <div class="hmr-yn-pair">
          <button class="hmr-yn hmr-yn-yes ${v === true  ? "hmr-yn-on" : ""}" data-ck="${c.key}" data-v="true">YES</button>
          <button class="hmr-yn hmr-yn-no  ${v === false ? "hmr-yn-on" : ""}" data-ck="${c.key}" data-v="false">NO</button>
        </div>
      </div>`;
    }).join("");

    const stepHtml = STEPS.map(s => {
      const st  = steps[s.key];
      const cls = st === "done" ? "hmr-step-done" : st === "skip" ? "hmr-step-skip" : "hmr-step-pend";
      const ic  = st === "done" ? "✓" : st === "skip" ? "—" : s.num;
      return `<div class="hmr-step-row ${cls}">
        <span class="hmr-step-num">${ic}</span>
        <span class="hmr-step-name">${s.label}</span>
        <span class="hmr-step-tag">AUTO</span>
      </div>`;
    }).join("");

    const modInfo = lastModifiedBy && lastModifiedBy !== "Unknown"
      ? `Last saved by ${lastModifiedBy}`
      : "";

    return `<div class="hmr-card">
      <div class="hmr-hdr">
        <span class="hmr-title">💊 HM Process</span>
        <span class="hmr-room-chip" title="${chipLabel}">${chipLabel}</span>
        <button class="hmr-btn-start" id="hmr-btn-start" ${allChecked ? "" : "disabled"}>▶ Start Process</button>
        <button class="hmr-x-btn" id="hmr-x-btn">✕</button>
      </div>
      <div class="hmr-body">

        <div class="hmr-statusbar" id="hmr-statusbar">
          ${allChecked ? "✓ Ready — click Start Process" : "Complete all 3 manual checks above"}
          ${modInfo ? `<span class="hmr-mod-info"> · ${modInfo}</span>` : ""}
        </div>

        <div class="hmr-sec-lbl">Discharge Status <span class="hmr-auto-tag">AUTO</span></div>
        <div class="hmr-dc-row">
          ${dcHtml}
          <button class="hmr-detect-btn" id="hmr-detect-btn">↻ Detect</button>
        </div>

        <div class="hmr-sec-lbl">Manual Checks</div>
        <div class="hmr-checklist">${checkHtml}</div>

        <div class="hmr-sec-lbl">Process Steps</div>
        <div class="hmr-steps">${stepHtml}</div>

        <div class="hmr-actions">
          <button class="hmr-btn-reset" id="hmr-btn-reset">Reset</button>
        </div>

      </div>
    </div>`;
  }

  // ── Toggle button ────────────────────────────────────────────────────

  function setTriggerOpen(open) {
    const btn = document.getElementById("hmr-trig-btn");
    if (!btn) return;
    btn.classList.toggle("hmr-trig-open", open);
    btn.title = open ? "Close HM Process workstation" : "Open HM Process workstation";
  }

  function injectTriggerBtn(h4) {
    if (document.getElementById("hmr-trig-btn")) return;
    const btn = document.createElement("button");
    btn.id          = "hmr-trig-btn";
    btn.className   = "hmr-trig-btn";
    btn.title       = "Open HM Process workstation";
    btn.textContent = "HM Process";
    btn.addEventListener("click", onTriggerClick);

    const parent = h4.parentElement;
    if (parent && getComputedStyle(parent).display === "block") {
      parent.style.cssText += ";display:flex;align-items:center;flex-wrap:wrap;gap:8px;";
    }
    h4.after(btn);
  }

  async function onTriggerClick() {
    if (document.getElementById("hmr-workstation")) {
      document.getElementById("hmr-workstation").remove();
      setTriggerOpen(false);
      if (_currentVisitId) {
        await serverSave(_currentVisitId, {}, makeLog("closed workstation"));
      }
      return;
    }

    const visitid = detectVisitId();
    if (!visitid) {
      setStatus("Visit ID not found on page — cannot open workstation");
      return;
    }
    _currentVisitId = visitid;
    _currentHN      = detectHN();

    setStatus("Loading from server…");

    let state = await serverLoad(visitid);
    if (!state) {
      state = newState(visitid, _currentHN);
    } else {
      // Keep HN updated if we just found it
      if (_currentHN && !state.hn) state.hn = _currentHN;
      // Refresh discharge detection in case it changed
      const dc = detectDischargeStatus();
      if (dc && dc !== state.checklist.dischargeStatus) {
        state.checklist.dischargeStatus = dc;
      }
    }
    _state = state;

    showWorkstation(visitid, state);
    await serverSave(visitid, { ...state, auditLog: [] }, makeLog("opened workstation"));
  }

  // ── Workstation DOM ──────────────────────────────────────────────────

  function showWorkstation(visitid, state) {
    const trackingRow = findPatientTrackingRow();
    if (!trackingRow) {
      console.warn("[BKN-HMR] Patient Tracking row not found");
      return;
    }
    const ws = document.createElement("div");
    ws.id        = "hmr-workstation";
    ws.innerHTML = renderWS(state);
    trackingRow.before(ws);
    wireWS(visitid);
    setTriggerOpen(true);
  }

  function wireWS(visitid) {
    document.getElementById("hmr-x-btn")?.addEventListener("click", async () => {
      document.getElementById("hmr-workstation")?.remove();
      setTriggerOpen(false);
      await serverSave(visitid, {}, makeLog("closed workstation"));
    });

    document.getElementById("hmr-detect-btn")?.addEventListener("click", async () => {
      const dc = detectDischargeStatus();
      _state.checklist.dischargeStatus = dc;
      rerender(visitid, _state);
      const logEntry = makeLog(`D/C status re-detected: ${dc || "not found"}`);
      await serverSave(visitid, { checklist: _state.checklist }, logEntry);
    });

    document.querySelectorAll(".hmr-yn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const ckKey = btn.dataset.ck;
        const val   = btn.dataset.v === "true";
        const label = CHECKS.find(c => c.key === ckKey)?.th || ckKey;
        _state.checklist[ckKey] = val;
        rerender(visitid, _state);
        const logEntry = makeLog(`${label} = ${val ? "YES" : "NO"}`);
        await serverSave(visitid, { checklist: _state.checklist }, logEntry);
      });
    });

    document.getElementById("hmr-btn-start")?.addEventListener("click", async () => {
      setStatus("Starting HM process… (automation steps coming in next phase)");
      const logEntry = makeLog("start process clicked");
      await serverSave(visitid, {}, logEntry);
    });

    document.getElementById("hmr-btn-reset")?.addEventListener("click", async () => {
      const fresh = newState(visitid, _currentHN);
      _state = fresh;
      rerender(visitid, fresh);
      const logEntry = makeLog("workstation reset");
      await serverSave(visitid, { ...fresh, auditLog: [] }, logEntry);
    });
  }

  function rerender(visitid, state) {
    const ws = document.getElementById("hmr-workstation");
    if (!ws) return;
    ws.innerHTML = renderWS(state);
    wireWS(visitid);
  }

  function setStatus(msg) {
    const el = document.getElementById("hmr-statusbar");
    if (el) el.textContent = msg;
  }

  // ── MutationObserver loop ────────────────────────────────────────────

  function syncUI() {
    if (!isWardView()) {
      if (_lastH4) cleanup();
      return;
    }

    const h4 = findVisitDetailsH4();

    if (!h4) {
      if (_lastH4) cleanup();
      return;
    }

    // Same panel — re-inject trigger if AngularJS removed it
    if (h4 === _lastH4) {
      if (!document.getElementById("hmr-trig-btn")) {
        injectTriggerBtn(h4);
        if (document.getElementById("hmr-workstation")) setTriggerOpen(true);
      }
      return;
    }

    // Different room selected
    _lastH4         = h4;
    _currentVisitId = null;
    _currentHN      = null;
    _state          = null;
    document.getElementById("hmr-trig-btn")?.remove();
    document.getElementById("hmr-workstation")?.remove();
    injectTriggerBtn(h4);
  }

  function cleanup() {
    _lastH4         = null;
    _currentVisitId = null;
    _currentHN      = null;
    _state          = null;
    document.getElementById("hmr-trig-btn")?.remove();
    document.getElementById("hmr-workstation")?.remove();
  }

  // ── Init ─────────────────────────────────────────────────────────────

  const obs = new MutationObserver(() => syncUI());
  obs.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => setTimeout(syncUI, 600));
  syncUI();

})();
