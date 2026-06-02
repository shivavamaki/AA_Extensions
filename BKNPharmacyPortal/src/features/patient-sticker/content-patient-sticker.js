// src/features/patient-sticker/content-patient-sticker.js
"use strict";

(function () {
  /* ═══════════════════════════════════════════════════════════════
   * GUARD — use a Symbol stored on document so Angular CANNOT
   * enumerate or delete it (Angular only wipes window.* properties).
   * ═══════════════════════════════════════════════════════════════ */
  const _GUARD = Symbol.for("__HM_PATIENT_MODULE__");
  if (document[_GUARD]) return;
  document[_GUARD] = true;

  /* ═══════════════════════════════════════════════════════════════
   * INLINE HELPERS
   * All logic is inlined here — no window.* globals relied upon.
   * Angular wipes every window property on scope destroy, so
   * window.CoreDom / window.ParserPatient / window.CoreMessages
   * are all gone after the first patient. Using closures instead.
   * ═══════════════════════════════════════════════════════════════ */

  function _norm(s) {
    return (s || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  }

  function _escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function _injectStyle(id, css) {
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id; s.textContent = css;
    document.head.appendChild(s);
  }


  function _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function _retry(fn, { attempts = 8, delay = 150, validate = v => !!v } = {}) {
    let lastValue = null;
    for (let i = 0; i < attempts; i++) {
      try {
        lastValue = fn();
        if (validate(lastValue)) return lastValue;
      } catch (e) {
        console.warn("[HM] retry read failed", e);
      }
      await _sleep(delay);
    }
    return lastValue;
  }

  async function parseFromEmrBannerReady() {
    return await _retry(parseFromEmrBanner, {
      attempts: 10,
      delay: 120,
      validate: p => !!p && p.hn && p.hn !== "-" && p.fullName && p.fullName !== "-",
    });
  }

  function _createIconButton({ icon, title = "", className = "", onClick }) {
    const btn = document.createElement("button");
    btn.className  = `hm-btn ${className}`.trim();
    btn.innerHTML  = icon;
    btn.title      = title;
    btn.dataset.hm = "1";
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.hmBusy === "1") return;
      btn.dataset.hmBusy = "1";
      btn.style.opacity = "0.45";
      try {
        await onClick?.(e);
      } finally {
        btn.dataset.hmBusy = "0";
        btn.style.opacity = "0.85";
      }
    }, true);
    Object.assign(btn.style, {
      background: "transparent", border: "none", outline: "none",
      cursor: "pointer", padding: "0", marginLeft: "6px",
      fontSize: "18px", opacity: "0.85",
      transition: "transform .15s ease, opacity .15s ease",
    });
    btn.addEventListener("mouseenter", () => { btn.style.transform = "scale(1.2)"; btn.style.opacity = "1"; });
    btn.addEventListener("mouseleave", () => { btn.style.transform = "scale(1)";   btn.style.opacity = "0.85"; });
    return btn;
  }

  /* ── MSG constants inlined ── */
  const MSG = Object.freeze({
    OPEN_PATIENT_STICKER: "OPEN_PATIENT_STICKER",
    OPEN_MED_RECONCILE:   "OPEN_MED_RECONCILE",
    OPEN_ALLERGY_CARD:    "OPEN_ALLERGY_CARD",
  });

  /* ── Parser inlined (no window.ParserPatient dependency) ── */
  const BANNER_ROOT_SEL = "patient-emr-banner";
  const ORDER_SEL =
    "body > div.full-height.ng-scope.layout-row > div > md-content > md-content" +
    " > div > md-card > md-content.md-whiteframe-z2.padding-left-14-imp.margin-5" +
    ".stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme" +
    ".width-70-per > div.ng-isolate-scope.flex-initial" +
    " > h4.margin-top-12.margin-bottom-10.font-weight-500-imp.ng-binding.ng-scope";

  function _getBannerRoot() {
    const banner = document.querySelector(BANNER_ROOT_SEL);
    if (!banner) return null;
    return banner.querySelector(".main-banner") || banner;
  }

  function _extractFullName(root) {
    for (const el of root.querySelectorAll(".padding-left-8-imp.flex div.overme.ng-binding")) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      const t = _norm(el.textContent);
      if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/")) return t;
    }
    for (const el of root.querySelectorAll("div.overme.ng-binding")) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      const t = _norm(el.textContent);
      if (t && /[ก-๙A-Za-z]/.test(t) && !t.includes("/") && !t.includes(":")) return t;
    }
    return "-";
  }

  function _extractHN(root) {
    for (const el of root.querySelectorAll(
      ".padding-left-8-imp.flex span.overme.ng-binding," +
      ".padding-left-8-imp.flex .layout-align-start-center span.overme.ng-binding"
    )) {
      const t = _norm(el.textContent);
      if (/^\d{2}-\d{2}-\d{6}$/.test(t)) return t;
    }
    for (const el of root.querySelectorAll("span.overme.ng-binding")) {
      const t = _norm(el.textContent);
      if (/^\d{2}-\d{2}-\d{6}$/.test(t)) return t;
    }
    return "-";
  }

  function _extractOrderId(root) {
    const h4 = document.querySelector(ORDER_SEL);
    if (h4) {
      const m = _norm(h4.innerText || h4.textContent).match(/\((.*?)\)/);
      if (m) return m[1];
    }
    const section = root.querySelector(".main-banner-section");
    if (section) {
      for (const el of section.querySelectorAll("div.overme.ng-binding")) {
        const m = _norm(el.textContent).match(/^([OI]\d{2}-\d{2}-\d{6})\s*\//i);
        if (m) return m[1];
      }
    }
    const m2 = _norm(root.innerText || root.textContent).match(/\b([OI]\d{2}-\d{2}-\d{6})\b/i);
    return m2 ? m2[1] : "-";
  }

  function _extractRoom(root) {
    for (const span of root.querySelectorAll('span[ng-repeat*="bedoccupancy"]')) {
      const t = _norm(span.textContent);
      if (!t) continue;
      const i = t.indexOf("/");
      if (i !== -1) { const r = _norm(t.slice(i + 1)); if (r) return r; }
      else return t;
    }
    return "-";
  }

  function parseFromEmrBanner() {
    const root = _getBannerRoot();
    if (!root) return null;
    return {
      fullName: _extractFullName(root),
      hn:       _extractHN(root),
      orderId:  _extractOrderId(root),
      room:     _extractRoom(root),
    };
  }

  function parseDialogAddress() {
    const container = document.querySelector('[id^="dialogContent"] > div');
    if (!container) return null;
    const data = {};
    container.querySelectorAll(".flex-50").forEach((el) => {
      const label = el.querySelector("span, label");
      const value = el.querySelector(".ng-binding");
      if (!label || !value) return;
      const key = label.innerText.trim().toLowerCase().replace(/\s+/g, "_");
      data[key] = value.innerText.trim();
    });
    return Object.keys(data).length ? data : null;
  }

  /* ═══════════════════════════════════════════════════════════════
   * STYLES
   * ═══════════════════════════════════════════════════════════════ */
  const BUTTON_CSS = `
    button.hm-btn {
      all: unset !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      background: transparent !important;
      border: none !important;
      padding: 0 !important;
      margin-left: 6px !important;
      cursor: pointer !important;
      font-size: 16px !important;
      line-height: 1 !important;
      min-width: auto !important;
      height: auto !important;
      box-shadow: none !important;
      outline: none !important;
      transition: 0.15s ease !important;
    }
    button.hm-btn:hover {
      transform: scale(1.15) !important;
      background: rgba(0,0,0,0.06) !important;
      border-radius: 6px !important;
    }
    /* ── Collapsible BKN tool group ──────────────────────────────────── */
    .bkn-tool-group {
      display: inline-flex !important;
      align-items: center !important;
      vertical-align: middle !important;
      margin-left: 6px !important;
      padding: 2px 4px 2px 4px !important;
      border-radius: 16px !important;
      background: transparent !important;
      box-shadow: 0 0 0 0 rgba(0,0,0,0) !important;
      transition: background .18s ease, box-shadow .18s ease, padding .18s ease !important;
      overflow: visible !important;
    }
    .bkn-tool-group .bkn-tool-trigger {
      all: unset !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 22px !important;
      height: 22px !important;
      border-radius: 50% !important;
      background: #e3f2fd !important;
      border: 1.5px solid #1976d2 !important;
      color: #0d47a1 !important;
      font-size: 13px !important;
      line-height: 1 !important;
      cursor: pointer !important;
      transition: background .15s, transform .15s !important;
    }
    .bkn-tool-group .bkn-tool-trigger:hover { background: #bbdefb !important; }
    .bkn-tool-group .bkn-tool-flyout {
      display: inline-flex !important;
      align-items: center !important;
      max-width: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
      margin-left: 0 !important;
      transition: max-width .25s ease, opacity .18s ease, margin-left .25s ease !important;
    }
    .bkn-tool-group:hover,
    .bkn-tool-group:focus-within {
      background: #ffffff !important;
      box-shadow: 0 2px 10px rgba(15,23,42,.18) !important;
      padding: 2px 8px 2px 4px !important;
    }
    .bkn-tool-group:hover .bkn-tool-flyout,
    .bkn-tool-group:focus-within .bkn-tool-flyout {
      max-width: 320px !important;
      opacity: 1 !important;
      margin-left: 4px !important;
    }
    .bkn-tool-group .bkn-tool-flyout > * { margin-left: 4px !important; }
    .bkn-tool-group .bkn-tool-flyout > *:first-child { margin-left: 0 !important; }
  `;

  const STICKER_BTN_SEL =
    "div.main-banner-section.padding-left-6-imp button.hm-btn.hm-patient-btn";

  function ensureStyles() {
    _injectStyle("hm-patient-style", BUTTON_CSS);
  }

  /* ═══════════════════════════════════════════════════════════════
   * MESSAGE SENDER
   * ═══════════════════════════════════════════════════════════════ */
  function _sendMessage(payload) {
    if (!chrome?.runtime?.sendMessage) {
      alert("⚠️ Extension was updated or disconnected.\nPlease refresh this page (F5) to reconnect.");
      return;
    }
    try {
      chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
    } catch (e) {
      if (e.message?.includes("Extension context invalidated") || e.message?.includes("Cannot read properties")) {
        alert("⚠️ Extension was updated or disconnected.\nPlease refresh this page (F5) to reconnect.");
      } else {
        console.error("[HM] sendMessage failed:", e);
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * ACTIONS
   * ═══════════════════════════════════════════════════════════════ */
  async function openPatientSticker() {
    const data = await parseFromEmrBannerReady();
    if (!data) { alert("Patient data not ready. Please try again after the page finishes loading."); return; }
    _sendMessage({ type: MSG.OPEN_PATIENT_STICKER, patientData: data });
  }

  async function openAddressSticker() {
    const patient    = await parseFromEmrBannerReady();
    const dialogData = await _retry(parseDialogAddress, { attempts: 8, delay: 150, validate: v => !!v });
    if (!dialogData) return;
    const payload = {
      fullName: patient?.fullName ?? "-",
      hn:       patient?.hn       ?? "-",
      ...dialogData,
    };
    const url = chrome.runtime.getURL("src/features/patient-sticker/page-patient-address.html") +
      "?data=" + encodeURIComponent(JSON.stringify(payload));
    window.open(url, "_blank");
  }

  function openMedReconcile() {
    const patient = parseFromEmrBanner();
    if (!patient) return;
    const drugCells = Array.from(document.querySelectorAll(
      "#medreconcile table tbody tr td:nth-child(3)"
    ));
    let drugs = [...new Set(
      drugCells.map(td => (td.innerText || td.textContent || "").trim()).filter(t => t.length > 2)
    )];
    if (!drugs.length) {
      const manual = prompt("No drugs detected automatically.\nEnter drug names (one per line):");
      if (!manual?.trim()) return;
      drugs = manual.split("\n").map(s => s.trim()).filter(Boolean);
    }
    const pharmEl = document.querySelector(
      "body > div.full-height.ng-scope.layout-row > div > md-toolbar > div > md-menu:nth-child(9) > button > span"
    );
    const pharmacist = pharmEl ? (pharmEl.innerText || pharmEl.textContent || "").trim() : (patient.pharmacist || "");
    _sendMessage({
      type: MSG.OPEN_MED_RECONCILE,
      hn: patient.hn || "-", room: patient.room || "-",
      fullName: patient.fullName || "-", pharmacist,
      date: _today(), drugs: drugs.map(name => ({ name })),
    });
  }

  async function openAllergyCard() {
    const patient = await parseFromEmrBannerReady();
    if (!patient) { alert("Patient data not ready. Please try again after the page finishes loading."); return; }
    const ALLERGY_SEL =
      "patient-emr-banner div.sec-banner table, " +
      "body > div.full-height.ng-scope.layout-row > div > md-content > md-content > div > md-card > " +
      "md-content.md-whiteframe-z2.padding-left-14-imp.margin-5.stickydiv.incus-border-1.overflow-x-hide.ng-scope._md.md-incustheme-theme.width-70-per > " +
      "div.ng-isolate-scope.flex-initial > div:nth-child(1) > patient-emr-banner > div > " +
      "div.sec-banner.ng-scope > div.banner-details.ng-scope.layout-row > div:nth-child(1) > table";

    const table = await _retry(() => document.querySelector(ALLERGY_SEL), {
      attempts: 12,
      delay: 150,
      validate: tbl => !!tbl && tbl.querySelectorAll("tbody tr").length > 0,
    });

    function cellText(tr, className, fallbackIndex) {
      const byClass = tr.querySelector(className);
      const raw = byClass
        ? (byClass.innerText || byClass.textContent || "")
        : (tr.children[fallbackIndex]?.innerText || tr.children[fallbackIndex]?.textContent || "");
      return _norm(raw);
    }

    const allergies = [];
    if (table) {
      table.querySelectorAll("tbody tr").forEach(tr => {
        // Allergy table has an icon column first, so fallback indexes start at 1.
        const drug = cellText(tr, ".patientbanner-breakword-allergyname", 1);
        if (!drug) return;
        allergies.push({
          drug,
          type:       cellText(tr, ".patientbanner-breakword-eventtype",   2),
          symptom:    cellText(tr, ".patientbanner-breakword-symptoms",    3),
          sideEffect: cellText(tr, ".patientbanner-breakword-sideeffects", 4),
          comment:    cellText(tr, ".patientbanner-breakword-comments",    5),
        });
      });
    }
    _sendMessage({ type: MSG.OPEN_ALLERGY_CARD, hn: patient.hn || "-", fullName: patient.fullName || "-", allergies });
  }

  async function openUnreceivable() {
    const patient    = await parseFromEmrBannerReady();
    const dialogData = await _retry(parseDialogAddress, { attempts: 8, delay: 150, validate: v => !!v });
    const drugs = [];
    document.querySelectorAll("#ordertable tbody tr").forEach(tr => {
      const cells  = tr.querySelectorAll("td");
      const nameEl = tr.querySelector("[id^='showMonographname']");
      const name   = (nameEl?.innerText || nameEl?.textContent || "").trim();
      const qty    = (cells[4]?.innerText || cells[4]?.textContent || "").trim();
      if (name) drugs.push({ name, qty });
    });
    const pharmEl2 = document.querySelector(
      "body > div.full-height.ng-scope.layout-row > div > md-toolbar > div > md-menu:nth-child(9) > button > span"
    );
    const pharmacist2 = pharmEl2 ? (pharmEl2.innerText || pharmEl2.textContent || "").trim() : "";
    const payload = {
      fullName: patient?.fullName ?? "-", hn: patient?.hn ?? "-",
      tel: dialogData?.tel ?? "", address: dialogData?.address ?? "",
      area: dialogData?.area ?? "", city: dialogData?.city ?? "",
      state: dialogData?.state ?? "", postcode: dialogData?.postcode ?? "",
      pharmacist: pharmacist2, drugs,
    };
    const url = chrome.runtime.getURL("src/features/patient-sticker/page-unreceivable.html") +
      "?data=" + encodeURIComponent(JSON.stringify(payload));
    window.open(url, "_blank");
  }

  function _today() {
    const d = new Date();
    return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  }

  /* ═══════════════════════════════════════════════════════════════
   * BIND #allocatedispense
   *
   * KEY FIX: clicking #allocatedispense triggers Angular navigation
   * to /allocatedispense, which destroys patient-emr-banner BEFORE
   * our click handler runs — so parseFromEmrBanner() returns null.
   *
   * Solution: capture patient data on `mousedown` (fires before
   * Angular's click handler and before DOM teardown), cache it, then
   * send it in the `click` handler which fires right after.
   * ═══════════════════════════════════════════════════════════════ */
  let _capturedPatientData = null;

  function bindAllocateDispense() {
    const btn = document.querySelector("#allocatedispense");
    if (!btn || btn.dataset.hmBound) return;

    // mousedown fires BEFORE Angular's click handler navigates away
    btn.addEventListener("mousedown", () => {
      const firstCells = document.querySelectorAll(
        "#orderdetailtable tbody tr td:first-child"
      );
      const hasDischarge = Array.from(firstCells).some(td =>
        (td.innerText || td.textContent || "").trim().toUpperCase().includes("DISCHARGE")
      );
      if (!hasDischarge) { _capturedPatientData = null; return; }

      // Parse NOW while banner DOM is still intact
      _capturedPatientData = parseFromEmrBanner();
    });

    // click fires after Angular has already navigated — use cached data
    btn.addEventListener("click", () => {
      if (!_capturedPatientData) return;
      _sendMessage({ type: MSG.OPEN_PATIENT_STICKER, patientData: _capturedPatientData });
      _capturedPatientData = null;
    });

    btn.dataset.hmBound = "1";
  }

  /* ═══════════════════════════════════════════════════════════════
   * SHARED COLLAPSIBLE BUTTON GROUP next to #paprint
   * Other features (ADR Timeline) also call this so all extension
   * icons live in one hover-revealed flyout.
   * Exposed on document via a Symbol so guards across content scripts
   * can reuse the same factory.
   * ═══════════════════════════════════════════════════════════════ */
  const _GROUP_KEY = Symbol.for("__BKN_TOOL_GROUP_FACTORY__");
  function _getOrCreateBknGroup() {
    // Only inject on patient-specific pages (banner present). Work lists and
    // dispensing queues also have #paprint but no banner — creating the group
    // there puts a stopPropagation trigger inside patient-row containers,
    // which swallows row-click events and blocks Angular navigation.
    if (!document.querySelector("patient-emr-banner")) return null;
    const paprint = document.querySelector("#paprint");
    if (!paprint || !paprint.parentElement) return null;
    let group = paprint.parentElement.querySelector(":scope > .bkn-tool-group");
    if (group) return group;
    group = document.createElement("span");
    group.className = "bkn-tool-group";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "BKN Pharmacy tools");
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "bkn-tool-trigger";
    trigger.title = "BKN Pharmacy tools";
    trigger.textContent = "💊";
    trigger.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); });
    const flyout = document.createElement("span");
    flyout.className = "bkn-tool-flyout";
    group.appendChild(trigger);
    group.appendChild(flyout);
    paprint.insertAdjacentElement("afterend", group);
    return group;
  }
  document[_GROUP_KEY] = _getOrCreateBknGroup;

  /* ═══════════════════════════════════════════════════════════════
   * INSERT BUTTONS (idempotent)
   * ═══════════════════════════════════════════════════════════════ */
  function insertButtons() {
    ensureStyles();

    // Slot 1: 🏷️ sticker — inside collapsible BKN tool group
    const group = _getOrCreateBknGroup();
    const flyout = group && group.querySelector(".bkn-tool-flyout");
    if (flyout && !flyout.querySelector(".hm-patient-btn")) {
      flyout.appendChild(_createIconButton({
        icon: "🏷️", title: "Print Patient Sticker",
        className: "hm-patient-btn", onClick: openPatientSticker,
      }));
    }

    // Slot 2 + 2b: inside patient dialog
    const dlgH2 = document.querySelector(
      "body > div.md-dialog-container.ng-scope > md-dialog > form > md-toolbar > div > h2"
    );
    if (dlgH2 && dlgH2.innerText.toLowerCase().includes("patient")) {
      if (!dlgH2.parentElement.querySelector(".hm-dialog-btn")) {
        dlgH2.insertAdjacentElement("afterend", _createIconButton({
          icon: "⛺", title: "Open Address Sticker",
          className: "hm-dialog-btn", onClick: openAddressSticker,
        }));
      }
      const dlgDiv = dlgH2.parentElement;
      if (!dlgDiv.querySelector(".hm-unreceivable-btn")) {
        const newBtn = _createIconButton({
          icon: "📋", title: "Unreceivable Medicine Form",
          className: "hm-unreceivable-btn", onClick: openUnreceivable,
        });
        const existing = dlgDiv.querySelector(".hm-dialog-btn");
        if (existing) existing.insertAdjacentElement("afterend", newBtn);
        else          dlgDiv.appendChild(newBtn);
      }
    }

    // Slot 3: 💊 Med Reconcile
    const mrAnchor = document.querySelector("#reviewContainer md-input-container");
    if (mrAnchor && !mrAnchor.querySelector(".mr-patient-btn")) {
      mrAnchor.appendChild(_createIconButton({
        icon: "💊", title: "Print Med Reconcile Sticker",
        className: "mr-patient-btn", onClick: openMedReconcile,
      }));
    }

    // Slot 4: ⚠️ Allergy card — inside the same collapsible BKN group
    if (flyout && !flyout.querySelector(".hm-allergy-btn")) {
      flyout.appendChild(_createIconButton({
        icon: "⚠️", title: "Print Allergy Card",
        className: "hm-allergy-btn", onClick: openAllergyCard,
      }));
    }

    // Wire #allocatedispense
    bindAllocateDispense();
  }

  /* ═══════════════════════════════════════════════════════════════
   * OBSERVER
   * ═══════════════════════════════════════════════════════════════ */
  let _scheduled = false;
  new MutationObserver(() => {
    if (_scheduled) return;
    _scheduled = true;
    requestAnimationFrame(() => {
      ensureStyles();
      insertButtons();
      _scheduled = false;
    });
  }).observe(document.body, { childList: true, subtree: true });

  insertButtons();
})();
