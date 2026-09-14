(() => {
  if (window.__ARCUS_AUTO_OVERRIDE_LOADED__) return;
  window.__ARCUS_AUTO_OVERRIDE_LOADED__ = true;

  // Auto override for the Arcus Alerts dialog.
  //
  // Fills the required Pharmacy Override Reason and saves, so an allocate run
  // is not blocked waiting for a human on routine alerts.
  //
  // EXCLUSIONS: drug-allergy interactions are never handled automatically. When
  // one appears the dialog is left open, the run pauses, and it resumes once a
  // pharmacist has dealt with it. Nothing is skipped or silently dismissed.
  //
  // Everything it does override is logged verbatim, so there is a trail of
  // exactly which alerts were auto-accepted and when.
  //
  // The dialog is AngularJS md-dialog. Its md-select moves options into a
  // container on <body> when opened, so a value cannot be set by assignment --
  // the select must be opened and the option clicked, like a user.

  const DEFAULT_REASON = "Medically needed";
  const ENABLED_KEY = "arcusAutoOverrideEnabled";
  const REASON_KEY = "arcusAutoOverrideReason";

  const SEL = {
    dialog: "md-dialog[aria-label='Alerts'], md-dialog.incusdialog",
    pharmacyReasonSelect: "md-select[ng-model='vm.pharmacyoverridereasonuid']",
    orderReasonSelect: "md-select[ng-model='vm.overridereasonuid']",
    saveButton: "md-dialog-actions button[ng-click='vm.saveData()']",
    cancelButton: "md-dialog-actions button[ng-click='vm.cancelData()']",
    openMenu: ".md-select-menu-container",
    option: "md-option",
    alertRows: "table.order-table tbody tr",
  };

  // Alerts that must always be seen by a pharmacist.
  //
  // Arcus marks allergy rows with this alerttype in ng-class/ng-style and
  // paints them red. Matching the attribute is exact; the text patterns are a
  // backstop for rows whose binding did not render the attribute.
  const NEVER_AUTO = {
    alertTypes: ["PATIENTORDERS.DRUGALLERGYINTERACTION"],
    textPatterns: [
      /drug\s*allergy/i,
      /allergy\s*interaction/i,
      /allergic/i,
    ],
  };

  const Driver = window.ArcusDriver;

  const state = {
    enabled: false,
    reason: DEFAULT_REASON,
    watching: false,
    handled: 0,
    skipped: 0,
    busy: false,
    lastSignature: null,
    // Set while an excluded alert is on screen, so the automation loop can wait
    // instead of racing the pharmacist.
    awaitingHuman: false,
    awaitingReason: "",
  };

  window.ArcusStore = window.ArcusStore || {};
  window.ArcusStore.autoOverride = { state, SEL, NEVER_AUTO, version: "4.6.0" };

  function log(type, message, meta) {
    window.ArcusPanel?.pushLog?.(type, message, meta || "");
    console.log("[AutoOverride]", type, message, meta || "");
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textOf(el) {
    return ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  }

  // Topmost dialog wins: Angular Material appends each new one after the last.
  function getAlertDialog() {
    const dialogs = Array.from(document.querySelectorAll(SEL.dialog)).filter(isVisible);
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  /**
   * Every alert row, with the detail needed to decide and to audit.
   * `blocked` marks a row that must not be auto-overridden.
   */
  /**
   * Decide whether one alert row is an allergy alert.
   *
   * Do NOT search the row's markup for the alert-type constant. Angular leaves
   * the ng-class EXPRESSION in the HTML of every row:
   *
   *   ng-class="{'drugallergybackground': alert.alerttype == 'PATIENTORDERS.DRUGALLERGYINTERACTION'}"
   *
   * so a substring match on that string is true for every alert. That blocked
   * every dialog and reported plain duplicate-drug alerts as allergy alerts.
   *
   * What distinguishes an allergy row is the APPLIED result: Arcus adds the
   * drugallergybackground class and paints the cells rgb(246,172,172).
   */
  function isAllergyRow(row, text) {
    // 1. The class Angular applies when the condition is actually true.
    if (row.classList && row.classList.contains("drugallergybackground")) return "class";

    // 2. The inline background Arcus sets on allergy cells.
    for (const cell of row.querySelectorAll("td")) {
      const style = (cell.getAttribute("style") || "").replace(/\s+/g, "");
      if (style.indexOf("246,172,172") !== -1) return "background";
    }

    // 3. Visible wording, for rows whose styling did not render.
    if (NEVER_AUTO.textPatterns.some((re) => re.test(text))) return "text";

    return null;
  }

  function readAlerts(dialog) {
    const out = [];
    for (const row of Array.from(dialog.querySelectorAll(SEL.alertRows))) {
      const text = textOf(row);
      if (!text || text.length < 3) continue;
      const matchedBy = isAllergyRow(row, text);
      out.push({ text, blocked: !!matchedBy, matchedBy: matchedBy || "" });
    }
    return out;
  }

  function readItemName(dialog) {
    const heading = dialog.querySelector("md-toolbar h2.ng-binding, md-dialog-content h3");
    return textOf(heading).replace(/^-\s*/, "");
  }

  /** Alerts on this dialog that must be handled by a human. */
  function blockedAlerts(dialog) {
    return readAlerts(dialog).filter((a) => a.blocked);
  }

  /**
   * Choose a value in an md-select.
   *
   * The options are not children of the select: Angular Material moves them
   * into a container on <body> when the menu opens. So open it, wait for the
   * menu, click the option, and wait for it to close.
   */
  /** The value currently shown on a closed md-select. */
  /**
   * The value a closed md-select is displaying.
   *
   * Angular Material renders the chosen value into `.md-text`, but while the
   * placeholder is showing it uses a bare <span> and marks the wrapper
   * .md-select-placeholder — with no .md-text at all. Reading only .md-text
   * therefore returns "" both when nothing is chosen AND, on some dialogs,
   * after a choice has been made, so verification failed on a click that had
   * actually worked.
   */
  function selectedTextOf(select) {
    if (!select) return "";
    const valueEl = select.querySelector("md-select-value");
    if (!valueEl) return "";

    // Still showing the placeholder: there is no selection.
    if (valueEl.classList && valueEl.classList.contains("md-select-placeholder")) return "";

    const text = valueEl.querySelector(".md-text");
    return textOf(text || valueEl);
  }

  /** Whether the select's model actually holds a value, per Angular's classes. */
  function selectHasValue(select) {
    if (!select) return false;
    if (select.classList && select.classList.contains("ng-empty")) return false;
    if (select.classList && select.classList.contains("ng-not-empty")) return true;
    return selectedTextOf(select) !== "";
  }

  /** Every option currently rendered for an open select menu, anywhere in the page. */
  /**
   * Options belonging to ONE select's menu.
   *
   * The Alerts dialog has two selects — Order Override Reason (disabled, and
   * usually pre-filled) and Pharmacy Override Reason (the required one). Each
   * renders its own md-select-menu, and both contain "Medically needed". A
   * document-wide search picked whichever came first, which was the disabled
   * Order menu, so every click was refused as "inside disabled".
   *
   * md-select owns its menu through aria-owns, so use that to scope the lookup
   * and fall back to the container the select still holds.
   */
  function optionsForSelect(select) {
    let root = null;

    const ownsId = select && select.getAttribute && select.getAttribute("aria-owns");
    if (ownsId) root = document.getElementById(ownsId);

    // While open, Angular Material moves the container to <body> but keeps the
    // same element, so look it up by id first and only then inside the select.
    if (!root && select) root = select.querySelector(SEL.openMenu);

    if (!root) return [];

    return Array.from(root.querySelectorAll(SEL.option)).filter((el) => {
      // Do NOT filter on geometry: options measure 0x0 while the menu animates,
      // and inside a virtual-repeat they can stay that way.
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    });
  }

  /** Any option menu currently rendered, used only as a fallback. */
  function visibleOptions() {
    return Array.from(document.querySelectorAll("md-select-menu " + SEL.option))
      .filter((el) => {
        const style = getComputedStyle(el);
        return style.display !== "none" && style.visibility !== "hidden";
      });
  }

  function menuIsOpen(select) {
    if (select) return optionsForSelect(select).length > 0;
    return visibleOptions().length > 0;
  }

  async function chooseSelectOption(select, wantedText) {
    if (!select) return { ok: false, reason: "select not found" };
    if (select.disabled || select.getAttribute("aria-disabled") === "true") {
      return { ok: false, reason: "select is disabled" };
    }

    const wanted = String(wantedText || "").trim().toLowerCase();

    // Already set to the wanted value: nothing to do, and re-opening the menu
    // would only risk changing it.
    if (selectedTextOf(select).toLowerCase() === wanted) {
      return { ok: true, chosen: selectedTextOf(select), already: true };
    }

    // Open the menu. Angular Material binds the click handler to the inner
    // md-select-value, so a coordinate click on the outer md-select can land on
    // a child that does not open anything. Click the value element when present
    // and fall back to keyboard activation, which md-select also honours.
    for (let attempt = 1; attempt <= 3 && !menuIsOpen(select); attempt++) {
      const target = select.querySelector("md-select-value") || select;
      await Driver.click(target);

      if (await Driver.waitFor(() => (menuIsOpen(select) ? true : null), 1200)) break;

      // Keyboard path: focus the select and press Enter.
      try {
        select.focus();
        for (const type of ["keydown", "keyup"]) {
          select.dispatchEvent(new KeyboardEvent(type, {
            key: "Enter", code: "Enter", keyCode: 13, which: 13,
            bubbles: true, cancelable: true,
          }));
        }
      } catch (_) {}
      await Driver.waitFor(() => (menuIsOpen(select) ? true : null), 1200);
    }

    if (!menuIsOpen(select)) return { ok: false, reason: "option menu did not open" };

    // Scoped to THIS select: the dialog's other select carries the same option
    // labels inside a disabled container.
    const options = optionsForSelect(select);
    const match =
      options.find((o) => textOf(o).toLowerCase() === wanted) ||
      options.find((o) => textOf(o).toLowerCase().indexOf(wanted) !== -1);

    if (!match) {
      await Driver.pressKey("Escape");
      return {
        ok: false,
        reason: "no option matching " + JSON.stringify(wantedText) +
                " (have: " + options.map(textOf).join(", ") + ")",
      };
    }

    // Wait for the menu to finish animating in. While it fades, Angular sets
    // pointer-events:none on the options and covers them with an md-backdrop
    // click-catcher, so a click dispatched now is simply swallowed — the
    // recording caught exactly that as blocked:"pointer-events:none".
    const ready = await Driver.waitFor(
      () => (optionIsReady(match) ? true : null), 3000);

    if (!ready) {
      await Driver.pressKey("Escape");
      return { ok: false, reason: "option stayed non-interactive (menu did not settle)" };
    }

    // Driver.click refuses zero-size elements — a sensible rule for page
    // buttons, wrong here. We have already found this option in an open menu
    // and matched its text, so dispatch to it directly.
    clickOptionDirectly(match);

    // Confirm by the value the select now displays, not by the menu closing:
    // the menu can close without the model updating if the click missed.
    // Accept either the displayed label matching, or Angular reporting the model
    // as non-empty: on multi-item dialogs the label can lag the model.
    const wantedLabel = textOf(match).toLowerCase();
    const applied = await Driver.waitFor(() => {
      if (selectedTextOf(select).toLowerCase() === wantedLabel) return true;
      return selectHasValue(select) ? true : null;
    }, 3000);

    if (!applied) {
      return {
        ok: false,
        reason: "clicked " + JSON.stringify(textOf(match)) +
                " but the select still shows " + JSON.stringify(selectedTextOf(select)),
      };
    }

    return { ok: true, chosen: textOf(match) };
  }

  /**
   * Click an md-option regardless of its measured size.
   *
   * Angular Material renders options inside a virtual-repeat container that can
   * report 0x0 even once the menu is open and usable. The shared driver refuses
   * zero-size elements to catch genuinely unclickable controls, so this path
   * dispatches the event sequence itself rather than fighting that rule.
   */
  /** True once the option is genuinely interactive, not mid-animation. */
  function optionIsReady(option) {
    try {
      const style = getComputedStyle(option);
      if (style.pointerEvents === "none") return false;
      if (style.visibility === "hidden" || style.display === "none") return false;
      // Angular Material fades the menu in; opacity < 1 means it is still
      // animating and clicks are swallowed by the md-backdrop click-catcher.
      const container = option.closest(".md-select-menu-container");
      if (container) {
        const cs = getComputedStyle(container);
        if (cs.opacity !== "" && parseFloat(cs.opacity) < 0.9) return false;
        if (cs.pointerEvents === "none") return false;
      }
    } catch (_) {}
    return true;
  }

  function clickOptionDirectly(option) {
    try { option.scrollIntoView({ block: "nearest" }); } catch (_) {}
    for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
      option.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    // Deliberately no el.click() here: the dispatched "click" above already
    // selected the option, and calling it again fires a second selection —
    // which the recording showed as two updateorderitemalertreasons POSTs for
    // one logical action.
  }

  function isSaveEnabled(dialog) {
    const btn = dialog.querySelector(SEL.saveButton);
    if (!btn) return false;
    return !btn.disabled && btn.getAttribute("aria-disabled") !== "true";
  }

  /**
   * Fill the required reason and save one dialog.
   *
   * Never throws, and never proceeds past an excluded alert: on any doubt the
   * dialog is left exactly as it is for a pharmacist.
   */
  async function handleDialog(dialog) {
    const item = readItemName(dialog);
    const alerts = readAlerts(dialog);
    const blocked = alerts.filter((a) => a.blocked);

    if (blocked.length) {
      state.skipped += 1;
      state.awaitingHuman = true;
      state.awaitingReason = blocked.map((a) => a.text).join(" | ");
      log(
        "fail",
        "PHARMACIST REQUIRED: " + (item || "(item)") + " - allergy alert, not auto-overridden",
        state.awaitingReason
      );
      window.ArcusPanel?.setStatus?.(
        "Paused: drug allergy alert needs a pharmacist.\n" +
        (item || "") + "\nHandle the dialog; the run continues automatically."
      );
      return { ok: false, blocked: true, reason: "drug allergy alert requires a pharmacist" };
    }

    // Audit before acting, so the record exists even if the save later fails.
    log(
      "info",
      "Auto-override: " + (item || "(item)") + " - " + alerts.length + " alert(s)",
      alerts.map((a) => a.text).join(" | ")
    );

    const select = dialog.querySelector(SEL.pharmacyReasonSelect);

    if (!select) {
      // Some alert dialogs carry no pharmacy reason; if Save is already live
      // there is nothing to fill in.
      if (isSaveEnabled(dialog)) {
        const saved = await Driver.clickAndSettle(
          dialog.querySelector(SEL.saveButton), { timeoutMs: 12000 });
        if (!saved.ok) return { ok: false, reason: "Save could not be clicked: " + saved.reason };
        return { ok: true, reason: "saved (no pharmacy reason required)" };
      }
      return { ok: false, reason: "no pharmacy reason select and Save is disabled" };
    }

    const chosen = await chooseSelectOption(select, state.reason);
    if (!chosen.ok) return { ok: false, reason: chosen.reason };

    // Angular needs a digest before Save is re-enabled.
    const ready = await Driver.waitFor(() => (isSaveEnabled(dialog) ? true : null), 4000);
    if (!ready) return { ok: false, reason: "Save stayed disabled after selecting the reason" };

    const saved = await Driver.clickAndSettle(
      dialog.querySelector(SEL.saveButton), { timeoutMs: 15000 });
    if (!saved.ok) return { ok: false, reason: "Save could not be clicked: " + saved.reason };

    const closed = await Driver.waitFor(
      () => (document.contains(dialog) && isVisible(dialog) ? null : true),
      8000
    );
    if (!closed) return { ok: false, reason: "dialog stayed open after Save" };

    state.handled += 1;
    log("success", "Override saved: " + chosen.chosen + " - " + (item || "(item)"));
    return { ok: true, reason: "saved" };
  }

  /**
   * Fingerprint a dialog so a failed or blocked attempt is not retried in a
   * tight loop against the same unchanged dialog.
   */
  function signatureOf(dialog) {
    return readItemName(dialog) + "::" +
           readAlerts(dialog).map((a) => a.text).join("|").slice(0, 200);
  }

  async function handleIfPresent() {
    if (!state.enabled || state.busy) return { ok: false, reason: "not active" };

    const dialog = getAlertDialog();
    if (!dialog) {
      // The pharmacist dealt with whatever was blocking; let the run continue.
      if (state.awaitingHuman) {
        state.awaitingHuman = false;
        state.awaitingReason = "";
        state.lastSignature = null;
        log("info", "Alert dialog cleared by pharmacist; resuming");
      }
      return { ok: false, reason: "no dialog" };
    }

    if (!dialog.querySelector(SEL.saveButton)) return { ok: false, reason: "not an override dialog" };

    const signature = signatureOf(dialog);
    if (signature === state.lastSignature) return { ok: false, reason: "already attempted" };

    state.busy = true;
    try {
      const result = await handleDialog(dialog);
      if (result.ok) {
        state.lastSignature = null;
      } else {
        // Stop retrying and let a human take over.
        state.lastSignature = signature;
        if (!result.blocked) {
          log("fail", "Auto-override failed: " + result.reason, "left open for manual handling");
        }
      }
      return result;
    } catch (err) {
      state.lastSignature = signature;
      log("fail", "Auto-override error: " + (err.message || err));
      return { ok: false, reason: err.message || String(err) };
    } finally {
      state.busy = false;
    }
  }

  /**
   * True while an excluded alert is on screen. The automation loop polls this
   * so it waits for the pharmacist rather than timing out or skipping the row.
   */
  function isAwaitingHuman() {
    if (!state.awaitingHuman) return false;
    // Self-clear if the dialog is already gone but no mutation fired.
    if (!getAlertDialog()) {
      state.awaitingHuman = false;
      state.awaitingReason = "";
      state.lastSignature = null;
      return false;
    }
    return true;
  }

  // Alerts can appear at any step of a run, so watch the DOM continuously
  // rather than checking only at known points.
  let observer = null;
  let pending = null;

  function schedule() {
    if (!state.enabled || pending) return;
    // Debounce: Angular fires many mutations while a dialog animates in.
    pending = setTimeout(() => {
      pending = null;
      handleIfPresent();
    }, 250);
  }

  function startWatching() {
    if (state.watching) return;
    state.watching = true;
    try {
      observer = new MutationObserver(schedule);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
    schedule();
    log("info", "Auto-override watching (reason: " + JSON.stringify(state.reason) +
                ", allergy alerts always manual)");
  }

  function stopWatching() {
    state.watching = false;
    if (observer) { observer.disconnect(); observer = null; }
    if (pending) { clearTimeout(pending); pending = null; }
  }

  function setEnabled(enabled, reason) {
    state.enabled = !!enabled;
    if (reason) state.reason = reason;
    state.lastSignature = null;
    state.awaitingHuman = false;

    try {
      window.ArcusTabSettings?.set({ [ENABLED_KEY]: state.enabled, [REASON_KEY]: state.reason });
    } catch (_) {}

    if (state.enabled) startWatching();
    else { stopWatching(); log("info", "Auto-override disabled"); }
    return state.enabled;
  }

  function restore(callback) {
    try {
      window.ArcusTabSettings?.get([ENABLED_KEY, REASON_KEY], (data) => {
        state.reason = (data && data[REASON_KEY]) || DEFAULT_REASON;
        if (data && data[ENABLED_KEY]) {
          state.enabled = true;
          startWatching();
        }
        callback?.(state.enabled);
      });
    } catch (_) {
      callback?.(false);
    }
  }

  restore();

  window.ArcusAutoOverride = {
    DEFAULT_REASON, ENABLED_KEY, REASON_KEY, NEVER_AUTO, state,
    setEnabled, isEnabled: () => state.enabled,
    handleIfPresent, handleDialog, chooseSelectOption,
    getAlertDialog, readAlerts, readItemName, blockedAlerts,
    isSaveEnabled, signatureOf, isAwaitingHuman,
    startWatching, stopWatching,
  };
})();
