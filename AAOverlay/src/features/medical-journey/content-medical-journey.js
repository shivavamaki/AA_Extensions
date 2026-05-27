// src/features/medical-journey/content-medical-journey.js
"use strict";

(function () {
  const _GUARD = Symbol.for("__ARCUS_MJ__");
  if (document[_GUARD]) return;
  document[_GUARD] = true;

  const MJ_STORAGE_KEY = "arcusMJState";
  const MJ_URL_PATTERN = "/emr/emrview/emr/orders";

  function _isOnOrdersPage() {
    return location.href.includes(MJ_URL_PATTERN);
  }

  function _norm(s) {
    return (s || "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
  }

  function _injectStyle(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  // ── Panel state ────────────────────────────────────────────────────
  let _state = { open: false, minimized: false, x: null, y: null };

  function _loadState() {
    try {
      const raw = localStorage.getItem(MJ_STORAGE_KEY);
      if (raw) _state = { ..._state, ...JSON.parse(raw) };
    } catch (_) {}
  }

  function _saveState() {
    try { localStorage.setItem(MJ_STORAGE_KEY, JSON.stringify(_state)); } catch (_) {}
  }

  // ── Data extraction ────────────────────────────────────────────────
  function _getBannerRoot() {
    const custom = document.querySelector("patient-emr-banner");
    if (custom) return custom.querySelector(".main-banner") || custom;
    return document.querySelector("div.main-banner");
  }

  function _extractName(root) {
    const container = root.querySelector(".padding-left-8-imp");
    if (container) {
      for (const el of container.querySelectorAll('.overme.ng-binding[aria-hidden="false"]')) {
        const t = _norm(el.textContent);
        if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/")) return t;
      }
    }
    for (const el of root.querySelectorAll('.overme.ng-binding[aria-hidden="false"]')) {
      const t = _norm(el.textContent);
      if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/") && t.length > 2) return t;
    }
    return null;
  }

  function _extractHN(root) {
    for (const el of root.querySelectorAll("span.ng-binding, span.overme.ng-binding")) {
      const t = _norm(el.textContent);
      if (/^\d{2}-\d{2}-\d+$/.test(t)) return t;
    }
    return null;
  }

  function _extractAN(root) {
    for (const el of root.querySelectorAll("span.ng-binding, div.ng-binding")) {
      const t = _norm(el.textContent);
      if (/^[A-Z]\d{2}-\d{2}-\d+/.test(t)) {
        const parts = t.split("/");
        return { an: parts[0].trim(), admitDate: parts[1] ? parts[1].trim() : null };
      }
    }
    return {};
  }

  function _extractGender(root) {
    for (const el of root.querySelectorAll('span.white-space-nowrap.overme.ng-binding[aria-hidden="false"]')) {
      const t = _norm(el.textContent);
      if (t === "Male" || t === "Female" || t === "ชาย" || t === "หญิง") return t;
    }
    return null;
  }

  function _extractDobAge(root) {
    const els = root.querySelectorAll("span.margin-left-5.white-space-nowrap.overme.ng-binding");
    return { dob: els[0] ? _norm(els[0].textContent) : null, age: els[1] ? _norm(els[1].textContent) : null };
  }

  function _extractBed(root) {
    const container = root.querySelector('[ng-repeat*="bedoccupancy"]');
    if (!container) return null;
    const t = _norm(container.textContent);
    if (!t) return null;
    const slash = t.indexOf("/");
    return slash !== -1 ? _norm(t.slice(slash + 1)) || t : t;
  }

  function _extractVitals(root) {
    const vitals = [];
    root.querySelectorAll('[ng-repeat*="vitalSign"]').forEach(vel => {
      const labelEl = vel.querySelector(".vital-sign-banner[aria-label]");
      const valueEl = vel.querySelector(".padding-right-15px.ng-binding");
      if (!labelEl || !valueEl) return;
      const label = _norm(labelEl.getAttribute("aria-label") || labelEl.textContent);
      const value = _norm(valueEl.textContent);
      if (label && value) vitals.push({ label, value });
    });
    return vitals;
  }

  function _extractDeptDoctor(root) {
    const sections = root.querySelectorAll(".main-banner-section");
    for (const sec of sections) {
      const spans = Array.from(sec.querySelectorAll("span.ng-binding")).filter(sp => {
        const t = _norm(sp.textContent);
        return t.length > 2 && !/^\d{2}-\d{2}-\d+/.test(t) && !/^[A-Z]\d{2}/.test(t);
      });
      if (spans.length >= 1) {
        return { dept: _norm(spans[0].textContent), doctor: spans[1] ? _norm(spans[1].textContent) : null };
      }
    }
    return {};
  }

  function _extractData() {
    const root = _getBannerRoot();
    if (!root) return null;
    const anInfo  = _extractAN(root);
    const dobAge  = _extractDobAge(root);
    const deptDoc = _extractDeptDoctor(root);
    return {
      name:      _extractName(root),
      hn:        _extractHN(root),
      an:        anInfo.an || null,
      admitDate: anInfo.admitDate || null,
      gender:    _extractGender(root),
      dob:       dobAge.dob,
      age:       dobAge.age,
      dept:      deptDoc.dept || null,
      doctor:    deptDoc.doctor || null,
      bed:       _extractBed(root),
      vitals:    _extractVitals(root),
    };
  }

  // ── Styles ─────────────────────────────────────────────────────────
  const MJ_CSS = `
/* Medical Journey tab button */
#arcus-mj-tab-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 16px;
  height: 100%;
  min-height: 40px;
  border: none;
  background: transparent;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #455a64;
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 3px solid transparent;
  transition: color .15s, border-color .15s, background .15s;
  outline: none;
  vertical-align: top;
  box-sizing: border-box;
}
#arcus-mj-tab-btn:hover { color: #1565c0; background: rgba(21,101,192,.06); }
#arcus-mj-tab-btn.mj-active { color: #1565c0; border-bottom-color: #1565c0; font-weight: 600; }

/* Medical Journey panel */
#arcus-mj-panel {
  position: fixed;
  bottom: 24px;
  left: 24px;
  z-index: 2147483647;
  width: 320px;
  max-height: 82vh;
  overflow: hidden;
  background: #fff;
  border: 1px solid #bbdefb;
  border-radius: 12px;
  box-shadow: 0 10px 36px rgba(13,71,161,.18), 0 2px 8px rgba(0,0,0,.12);
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  font-size: 12px;
  color: #222;
  box-sizing: border-box;
  line-height: 1.4;
}
#arcus-mj-panel.is-dragging { box-shadow: 0 16px 44px rgba(13,71,161,.26), 0 4px 14px rgba(0,0,0,.18); }
#arcus-mj-panel.is-minimized #arcus-mj-body { display: none; }
#arcus-mj-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
  padding: 11px 12px 9px;
  border-bottom: 1px solid #e3f2fd;
  background: linear-gradient(to bottom, #e8f0fe, #f8fbff);
  cursor: move; user-select: none;
  border-radius: 12px 12px 0 0;
}
#arcus-mj-panel .mj-title-wrap { flex: 1; min-width: 0; }
#arcus-mj-panel .mj-title { font-size: 13px; font-weight: 700; color: #0d47a1; margin-bottom: 2px; }
#arcus-mj-panel .mj-subtitle { font-size: 11px; color: #1565c0; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#arcus-mj-panel .mj-actions { display: flex; gap: 4px; flex-shrink: 0; align-items: center; }
#arcus-mj-panel .mj-icon-btn {
  width: 26px; height: 26px;
  border: 1px solid #bbdefb; border-radius: 5px;
  background: #e8f0fe; color: #1565c0;
  cursor: pointer; font-size: 13px; font-weight: 700; line-height: 1;
  flex: none; display: flex; align-items: center; justify-content: center; padding: 0;
  transition: background .12s;
}
#arcus-mj-panel .mj-icon-btn:hover { background: #c5cae9; }
#arcus-mj-body {
  padding: 10px 12px 12px;
  max-height: calc(82vh - 60px);
  overflow-y: auto;
}
#arcus-mj-body::-webkit-scrollbar { width: 4px; }
#arcus-mj-body::-webkit-scrollbar-track { background: #f0f4ff; border-radius: 99px; }
#arcus-mj-body::-webkit-scrollbar-thumb { background: #90caf9; border-radius: 99px; }
#arcus-mj-panel .mj-info-grid {
  background: #f8fbff; border: 1px solid #e3f2fd;
  border-radius: 8px; padding: 8px 10px; margin-bottom: 10px;
}
#arcus-mj-panel .mj-row {
  display: flex; align-items: baseline; gap: 6px;
  padding: 3px 0; border-bottom: 1px solid #e8eaf6;
}
#arcus-mj-panel .mj-row:last-child { border-bottom: none; }
#arcus-mj-panel .mj-lbl { font-size: 10px; font-weight: 700; color: #607d8b; text-transform: uppercase; letter-spacing: .3px; min-width: 48px; flex-shrink: 0; }
#arcus-mj-panel .mj-val { font-size: 12px; color: #1a237e; font-weight: 500; word-break: break-word; }
#arcus-mj-panel .mj-section-title { font-size: 10px; font-weight: 700; color: #607d8b; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 6px; }
#arcus-mj-panel .mj-vitals { display: grid; grid-template-columns: repeat(3,1fr); gap: 5px; margin-bottom: 4px; }
#arcus-mj-panel .mj-vital { background: #e8f5e9; border: 1px solid #c8e6c9; border-radius: 7px; padding: 6px 5px 5px; text-align: center; }
#arcus-mj-panel .mj-vital-lbl { font-size: 9px; color: #388e3c; font-weight: 700; text-transform: uppercase; letter-spacing: .2px; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#arcus-mj-panel .mj-vital-val { font-size: 13px; font-weight: 700; color: #1b5e20; line-height: 1; }
#arcus-mj-panel .mj-empty { font-size: 11px; color: #9e9e9e; font-style: italic; text-align: center; padding: 12px 0; }
`;

  // ── Panel rendering ────────────────────────────────────────────────
  function _buildCopyText(d) {
    const lines = [
      `Patient: ${d.name || "—"}`,
      `HN: ${d.hn || "—"}`,
      `AN: ${d.an || "—"}`,
      d.admitDate ? `Admit: ${d.admitDate}` : null,
      `Gender: ${d.gender || "—"}`,
      `DOB: ${d.dob || "—"}`,
      `Age: ${d.age || "—"}`,
      d.dept   ? `Dept: ${d.dept}`     : null,
      d.doctor ? `Doctor: ${d.doctor}` : null,
      d.bed    ? `Bed: ${d.bed}`       : null,
    ].filter(Boolean);
    if (d.vitals && d.vitals.length) {
      lines.push("", "Vital Signs:");
      d.vitals.forEach(v => lines.push(`  ${v.label}: ${v.value}`));
    }
    return lines.join("\n");
  }

  function _renderPanel(d) {
    document.getElementById("arcus-mj-panel")?.remove();
    _injectStyle("arcus-mj-css", MJ_CSS);

    const panel = document.createElement("div");
    panel.id = "arcus-mj-panel";
    if (_state.minimized) panel.classList.add("is-minimized");

    if (_state.x !== null && _state.y !== null) {
      panel.style.left   = _state.x + "px";
      panel.style.top    = _state.y + "px";
      panel.style.right  = "auto";
      panel.style.bottom = "auto";
    }

    const hasData = !!(d && d.name);
    const infoRows = hasData ? [
      ["HN", d.hn], ["AN", d.an],
      d.admitDate ? ["Admit", d.admitDate] : null,
      ["Gender", d.gender], ["DOB", d.dob], ["Age", d.age],
      d.dept   ? ["Dept", d.dept]     : null,
      d.doctor ? ["Doctor", d.doctor] : null,
      d.bed    ? ["Bed", d.bed]       : null,
    ].filter(Boolean) : [];

    const vitalsHtml = hasData && d.vitals && d.vitals.length
      ? `<div class="mj-section-title">Vital Signs</div>
         <div class="mj-vitals">${d.vitals.map(v =>
           `<div class="mj-vital"><div class="mj-vital-lbl">${v.label}</div><div class="mj-vital-val">${v.value}</div></div>`
         ).join("")}</div>`
      : (hasData ? `<div class="mj-section-title">Vital Signs</div><div class="mj-empty">No vital signs recorded</div>` : "");

    panel.innerHTML = `
      <div id="arcus-mj-header">
        <div class="mj-title-wrap">
          <div class="mj-title">Medical Journey</div>
          <div class="mj-subtitle">${hasData ? (d.name || "—") : "No patient data"}</div>
        </div>
        <div class="mj-actions">
          <button class="mj-icon-btn" id="arcus-mj-btn-refresh" title="Refresh">↻</button>
          <button class="mj-icon-btn" id="arcus-mj-btn-copy" title="Copy to clipboard">⎘</button>
          <button class="mj-icon-btn" id="arcus-mj-btn-min" title="Minimize">−</button>
          <button class="mj-icon-btn" id="arcus-mj-btn-close" title="Close">✕</button>
        </div>
      </div>
      <div id="arcus-mj-body">
        ${hasData
          ? `<div class="mj-info-grid">${infoRows.map(([l, v]) =>
              `<div class="mj-row"><span class="mj-lbl">${l}</span><span class="mj-val">${v || "—"}</span></div>`
            ).join("")}</div>${vitalsHtml}`
          : `<div class="mj-empty">Patient banner not found.<br>Navigate to a patient's order page first.</div>`
        }
      </div>`;

    document.body.appendChild(panel);
    _makeDraggable(panel, document.getElementById("arcus-mj-header"));

    document.getElementById("arcus-mj-btn-min").addEventListener("click", () => {
      _state.minimized = !_state.minimized;
      panel.classList.toggle("is-minimized", _state.minimized);
      _saveState();
    });

    document.getElementById("arcus-mj-btn-close").addEventListener("click", _closePanel);

    document.getElementById("arcus-mj-btn-refresh").addEventListener("click", () => {
      _renderPanel(_extractData());
    });

    document.getElementById("arcus-mj-btn-copy").addEventListener("click", () => {
      if (!d) return;
      navigator.clipboard.writeText(_buildCopyText(d)).then(() => {
        const btn = document.getElementById("arcus-mj-btn-copy");
        if (btn) { btn.textContent = "✓"; setTimeout(() => { btn.textContent = "⎘"; }, 1500); }
      }).catch(() => {});
    });
  }

  function _openPanel() {
    _state.open = true;
    _saveState();
    _renderPanel(_extractData());
    document.getElementById("arcus-mj-tab-btn")?.classList.add("mj-active");
  }

  function _closePanel() {
    _state.open = false;
    _saveState();
    document.getElementById("arcus-mj-panel")?.remove();
    document.getElementById("arcus-mj-tab-btn")?.classList.remove("mj-active");
  }

  // ── Drag ───────────────────────────────────────────────────────────
  function _makeDraggable(panel, handle) {
    let sX, sY, sL, sT;
    handle.addEventListener("mousedown", e => {
      if (e.target.classList.contains("mj-icon-btn")) return;
      e.preventDefault();
      const r = panel.getBoundingClientRect();
      sX = e.clientX; sY = e.clientY; sL = r.left; sT = r.top;
      panel.classList.add("is-dragging");
      panel.style.right = "auto"; panel.style.bottom = "auto";
      panel.style.left = sL + "px"; panel.style.top = sT + "px";

      const onMove = e => {
        const nL = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth,  sL + e.clientX - sX));
        const nT = Math.max(0, Math.min(window.innerHeight - 40,                sT + e.clientY - sY));
        panel.style.left = nL + "px"; panel.style.top = nT + "px";
        _state.x = nL; _state.y = nT;
      };
      const onUp = () => {
        panel.classList.remove("is-dragging");
        _saveState();
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ── Tab button injection ───────────────────────────────────────────
  function _injectTabButton() {
    if (document.getElementById("arcus-mj-tab-btn")) return;
    const wrapper = document.querySelector("md-pagination-wrapper");
    if (!wrapper) return;

    _injectStyle("arcus-mj-css", MJ_CSS);

    const btn = document.createElement("button");
    btn.id = "arcus-mj-tab-btn";
    btn.type = "button";
    btn.innerHTML = `<span style="font-size:14px;line-height:1">🧭</span> Medical Journey`;
    if (_state.open) btn.classList.add("mj-active");

    btn.addEventListener("click", () => {
      if (document.getElementById("arcus-mj-panel")) _closePanel(); else _openPanel();
    });

    wrapper.appendChild(btn);

    if (_state.open) _openPanel();
  }

  // ── SPA navigation ────────────────────────────────────────────────
  let _lastHref = location.href;

  function _onNav() {
    const href = location.href;
    if (href === _lastHref) return;
    _lastHref = href;
    if (!_isOnOrdersPage()) {
      document.getElementById("arcus-mj-panel")?.remove();
      document.getElementById("arcus-mj-tab-btn")?.remove();
      return;
    }
    setTimeout(_injectTabButton, 700);
  }

  window.addEventListener("hashchange", _onNav);

  const _origPush = history.pushState.bind(history);
  history.pushState = function (...a) { _origPush(...a); setTimeout(_onNav, 0); };
  const _origReplace = history.replaceState.bind(history);
  history.replaceState = function (...a) { _origReplace(...a); setTimeout(_onNav, 0); };

  // ── Observer (idempotent injection) ───────────────────────────────
  let _scheduled = false;
  new MutationObserver(() => {
    if (!_isOnOrdersPage()) return;
    if (document.getElementById("arcus-mj-tab-btn")) return;
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(() => {
      _injectTabButton();
      _scheduled = false;
    });
  }).observe(document.body, { childList: true, subtree: true });

  // ── Init ──────────────────────────────────────────────────────────
  _loadState();
  if (_isOnOrdersPage()) setTimeout(_injectTabButton, 900);
})();
