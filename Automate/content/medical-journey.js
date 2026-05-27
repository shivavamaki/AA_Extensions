(function () {
  if (window.__ARCUS_MJ_LOADED__) return;
  window.__ARCUS_MJ_LOADED__ = true;

  const MJ_STORAGE_KEY = "arcusMJState";
  const MJ_URL_PATTERN = "/emr/emrview/emr/orders";

  function isOnOrdersPage() {
    return location.href.includes(MJ_URL_PATTERN);
  }

  let panelState = { open: false, minimized: false, x: null, y: null };

  function loadState() {
    try {
      const raw = localStorage.getItem(MJ_STORAGE_KEY);
      if (raw) panelState = { ...panelState, ...JSON.parse(raw) };
    } catch (_) {}
  }

  function saveState() {
    try { localStorage.setItem(MJ_STORAGE_KEY, JSON.stringify(panelState)); } catch (_) {}
  }

  function normalize(text) {
    return (text || "").replace(/ /g, " ").trim();
  }

  // ── Data extraction ──────────────────────────────────────────────────
  function extractPatientData() {
    const banner = document.querySelector("div.main-banner");
    if (!banner) return null;
    const d = {};

    // Visible patient name: aria-hidden="false" inside padding-left-8-imp
    const nameContainer = banner.querySelector(".padding-left-8-imp");
    if (nameContainer) {
      const nameEl = nameContainer.querySelector('.overme.ng-binding[aria-hidden="false"]');
      if (nameEl) d.name = normalize(nameEl.textContent);
    }
    if (!d.name) {
      const allNameCands = banner.querySelectorAll('.overme.ng-binding[aria-hidden="false"]');
      for (const el of allNameCands) {
        const t = normalize(el.textContent);
        if (t && t.length > 3 && !/^\d/.test(t) && !t.includes("/")) { d.name = t; break; }
      }
    }

    // HN, AN from all ng-binding spans
    const allSpans = banner.querySelectorAll("span.ng-binding");
    for (const el of allSpans) {
      const t = normalize(el.textContent);
      if (!t) continue;
      if (!d.hn && /^\d{2}-\d{2}-\d+$/.test(t)) { d.hn = t; continue; }
      if (!d.an && /^[A-Z]\d{2}-\d{2}-\d+/.test(t)) {
        const parts = t.split("/");
        d.an = parts[0].trim();
        if (parts[1]) d.admitDate = parts[1].trim();
        continue;
      }
    }

    // Gender (white-space-nowrap, visible)
    const genderEls = banner.querySelectorAll('span.white-space-nowrap.overme.ng-binding[aria-hidden="false"]');
    for (const el of genderEls) {
      const t = normalize(el.textContent);
      if (t === "Male" || t === "Female" || t === "ชาย" || t === "หญิง") { d.gender = t; break; }
    }

    // DOB, Age (margin-left-5 white-space-nowrap)
    const dobAgeEls = banner.querySelectorAll("span.margin-left-5.white-space-nowrap.overme.ng-binding");
    if (dobAgeEls[0]) d.dob = normalize(dobAgeEls[0].textContent);
    if (dobAgeEls[1]) d.age = normalize(dobAgeEls[1].textContent);

    // Department / Doctor from main-banner-section
    const sections = banner.querySelectorAll(".main-banner-section");
    outer: for (const sec of sections) {
      const spans = sec.querySelectorAll("span.ng-binding");
      for (const sp of spans) {
        const t = normalize(sp.textContent);
        if (!t || t.length < 3) continue;
        if (!d.hn && !d.an) continue; // skip until we've confirmed this is the right section
        if (!d.dept) { d.dept = t; continue; }
        if (!d.doctor) { d.doctor = t; break outer; }
      }
    }

    // Bed
    const bedContainer = banner.querySelector("[ng-repeat*='bedoccupancy']");
    if (bedContainer) {
      const bedSpan = bedContainer.querySelector(".ng-binding");
      if (bedSpan) d.bed = normalize(bedSpan.textContent);
    }

    // Vital signs
    d.vitals = [];
    const vitalEls = banner.querySelectorAll("[ng-repeat*='vitalSign']");
    for (const vel of vitalEls) {
      const labelEl = vel.querySelector(".vital-sign-banner[aria-label]");
      const valueEl = vel.querySelector(".padding-right-15px.ng-binding");
      if (labelEl && valueEl) {
        const label = normalize(labelEl.getAttribute("aria-label") || labelEl.textContent);
        const value = normalize(valueEl.textContent);
        if (label && value) d.vitals.push({ label, value });
      }
    }

    return d;
  }

  // ── Panel ────────────────────────────────────────────────────────────
  function buildCopyText(d) {
    const lines = [
      `Patient: ${d.name || "—"}`,
      `HN: ${d.hn || "—"}`,
      `AN: ${d.an || "—"}`,
      d.admitDate ? `Admit: ${d.admitDate}` : null,
      `Gender: ${d.gender || "—"}`,
      `DOB: ${d.dob || "—"}`,
      `Age: ${d.age || "—"}`,
      d.dept ? `Dept: ${d.dept}` : null,
      d.doctor ? `Doctor: ${d.doctor}` : null,
      d.bed ? `Bed: ${d.bed}` : null,
    ].filter(Boolean);
    if (d.vitals && d.vitals.length) {
      lines.push("", "Vital Signs:");
      d.vitals.forEach(v => lines.push(`  ${v.label}: ${v.value}`));
    }
    return lines.join("\n");
  }

  function renderPanel(d) {
    const existing = document.getElementById("arcus-mj-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "arcus-mj-panel";
    if (panelState.minimized) panel.classList.add("is-minimized");

    if (panelState.x !== null && panelState.y !== null) {
      panel.style.left = panelState.x + "px";
      panel.style.top = panelState.y + "px";
      panel.style.right = "auto";
      panel.style.bottom = "auto";
    }

    const hasData = d && d.name;
    const vitalsHtml = d && d.vitals && d.vitals.length
      ? `<div class="mj-vitals-grid">${d.vitals.map(v =>
          `<div class="mj-vital"><div class="mj-vital-label">${v.label}</div><div class="mj-vital-value">${v.value}</div></div>`
        ).join("")}</div>`
      : `<div class="mj-empty">No vital signs</div>`;

    const infoRows = hasData ? [
      ["HN", d.hn],
      ["AN", d.an],
      d.admitDate ? ["Admit", d.admitDate] : null,
      ["Gender", d.gender],
      ["DOB", d.dob],
      ["Age", d.age],
      d.dept ? ["Dept", d.dept] : null,
      d.doctor ? ["Doctor", d.doctor] : null,
      d.bed ? ["Bed", d.bed] : null,
    ].filter(Boolean) : [];

    panel.innerHTML = `
      <div class="mj-header" id="arcus-mj-handle">
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
      <div class="mj-body" id="arcus-mj-body">
        ${hasData ? `<div class="mj-info-grid">${infoRows.map(([label, val]) =>
          `<div class="mj-info-row"><span class="mj-lbl">${label}</span><span class="mj-val">${val || "—"}</span></div>`
        ).join("")}</div>` : `<div class="mj-empty">Patient banner not found. Navigate to a patient order page.</div>`}
        ${hasData ? `<div class="mj-section-title">Vital Signs</div>${vitalsHtml}` : ""}
      </div>
    `;

    document.body.appendChild(panel);
    makeDraggable(panel, document.getElementById("arcus-mj-handle"));

    document.getElementById("arcus-mj-btn-min").addEventListener("click", () => {
      panelState.minimized = !panelState.minimized;
      panel.classList.toggle("is-minimized", panelState.minimized);
      saveState();
    });

    document.getElementById("arcus-mj-btn-close").addEventListener("click", closePanel);

    document.getElementById("arcus-mj-btn-refresh").addEventListener("click", () => {
      const newData = extractPatientData();
      renderPanel(newData);
    });

    document.getElementById("arcus-mj-btn-copy").addEventListener("click", () => {
      if (!d) return;
      navigator.clipboard.writeText(buildCopyText(d)).then(() => {
        const btn = document.getElementById("arcus-mj-btn-copy");
        if (btn) { btn.textContent = "✓"; setTimeout(() => { btn.textContent = "⎘"; }, 1500); }
      }).catch(() => {});
    });
  }

  function closePanel() {
    panelState.open = false;
    saveState();
    const panel = document.getElementById("arcus-mj-panel");
    if (panel) panel.remove();
    const btn = document.getElementById("arcus-mj-tab-btn");
    if (btn) btn.classList.remove("mj-tab-active");
  }

  function openPanel() {
    panelState.open = true;
    saveState();
    const data = extractPatientData();
    renderPanel(data);
    const btn = document.getElementById("arcus-mj-tab-btn");
    if (btn) btn.classList.add("mj-tab-active");
  }

  // ── Draggable ────────────────────────────────────────────────────────
  function makeDraggable(panel, handle) {
    let startX, startY, startLeft, startTop;
    handle.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("mj-icon-btn")) return;
      e.preventDefault();
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      panel.classList.add("is-dragging");
      panel.style.right = "auto"; panel.style.bottom = "auto";
      panel.style.left = startLeft + "px"; panel.style.top = startTop + "px";

      const onMove = (e) => {
        const newLeft = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, startLeft + e.clientX - startX));
        const newTop = Math.max(0, Math.min(window.innerHeight - 40, startTop + e.clientY - startY));
        panel.style.left = newLeft + "px"; panel.style.top = newTop + "px";
        panelState.x = newLeft; panelState.y = newTop;
      };
      const onUp = () => {
        panel.classList.remove("is-dragging");
        saveState();
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ── Tab button injection ─────────────────────────────────────────────
  function injectTabButton() {
    if (document.getElementById("arcus-mj-tab-btn")) return;
    const wrapper = document.querySelector("md-pagination-wrapper");
    if (!wrapper) return;

    const btn = document.createElement("button");
    btn.id = "arcus-mj-tab-btn";
    btn.className = "arcus-mj-tab-btn";
    btn.setAttribute("type", "button");
    btn.innerHTML = `<span class="mj-tab-icon">🧭</span> Medical Journey`;
    if (panelState.open) btn.classList.add("mj-tab-active");

    btn.addEventListener("click", () => {
      const panel = document.getElementById("arcus-mj-panel");
      if (panel) closePanel(); else openPanel();
    });

    wrapper.appendChild(btn);

    if (panelState.open) openPanel();
  }

  // ── SPA navigation watcher ───────────────────────────────────────────
  let lastHref = location.href;

  function handleNavChange() {
    const href = location.href;
    if (href === lastHref) return;
    lastHref = href;
    if (!isOnOrdersPage()) {
      document.getElementById("arcus-mj-panel")?.remove();
      document.getElementById("arcus-mj-tab-btn")?.remove();
      return;
    }
    setTimeout(injectTabButton, 700);
  }

  window.addEventListener("hashchange", handleNavChange);

  const _origPush = history.pushState.bind(history);
  history.pushState = function (...a) { _origPush(...a); setTimeout(handleNavChange, 0); };
  const _origReplace = history.replaceState.bind(history);
  history.replaceState = function (...a) { _origReplace(...a); setTimeout(handleNavChange, 0); };

  const bodyObserver = new MutationObserver(() => {
    if (isOnOrdersPage() && !document.getElementById("arcus-mj-tab-btn")) injectTabButton();
  });
  bodyObserver.observe(document.body, { childList: true, subtree: true });

  // ── Init ─────────────────────────────────────────────────────────────
  loadState();
  if (isOnOrdersPage()) setTimeout(injectTabButton, 900);
})();
