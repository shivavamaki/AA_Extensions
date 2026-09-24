(() => {
  if (window.__ARCUS_AUTOMATION_LOADED__) return;
  window.__ARCUS_AUTOMATION_LOADED__ = true;

  const {
    CONFIG,
    state,
    clickLikeUser,
    clickAndSettle,
    settle,
    waitForWorkbenchReady,
    waitForSelectorVisible,
    waitForRouteContains,
    waitForAllocatePageReady,
    waitForDispenseToDeptPageReady,
    findOpenDialog,
    isAlertDialog,
    dialogLooksLikeManualOverride,
    acknowledgeAlertRowsIfPresent,
    closeAlertDialogIfPresent,
    closeGenericToolbarDialogIfPresent,
    waitForManualOverrideCompletion,
    waitFor,
    isWorkbenchPage,
    isAllocatePage,
    isDispenseToDeptPage,
    getRowSnapshots,
    findRowBySnapshot,
    getSelectedRowFilterLabel,
    getSelectedRowFilters,
    matchesRowFilter,
    isVisible,
    textOf,
    sleep,
    isValidOrderNo,
    getEffectivePharmacyType,
  } = window.ArcusShared;

  // After a save response lands, Angular still needs a digest to paint the
  // override/alert dialog. Wait for either a dialog or a route change rather
  // than a blanket sleep, capped so a clean save costs almost nothing.
  /**
   * Block while auto-override has stopped on an alert a pharmacist must see.
   *
   * Turbo runs unattended, so the loop must not race ahead, time out, or skip
   * the row: it waits until the dialog is dealt with. Stop still works.
   */
  /**
   * Let auto-override finish whatever it is doing before the flow inspects the
   * page. Without this the flow can look for a dialog that auto-override has
   * already closed, or act while it is mid-way through filling one in.
   */
  async function waitForAutoOverrideIdle(maxMs = 20000) {
    const AutoOverride = window.ArcusAutoOverride;
    if (!AutoOverride || !AutoOverride.state) return;
    const deadline = Date.now() + maxMs;
    while (AutoOverride.state.busy && Date.now() < deadline) {
      if (state.stopRequested) return;
      await sleep(150);
    }
  }

  async function waitForPharmacistIfNeeded() {
    const AutoOverride = window.ArcusAutoOverride;
    if (!AutoOverride || !AutoOverride.isAwaitingHuman || !AutoOverride.isAwaitingHuman()) {
      return true;
    }

    let announced = false;
    while (AutoOverride.isAwaitingHuman()) {
      if (state.stopRequested) return false;
      if (!announced) {
        announced = true;
        setStep("Waiting for pharmacist", "Drug allergy alert - review and save or cancel");
        window.ArcusPanel?.pushLog(
          "info",
          "Paused: drug allergy alert needs a pharmacist",
          AutoOverride.state.awaitingReason
        );
      }
      await sleep(500);
    }

    window.ArcusPanel?.pushLog("info", "Alert handled; resuming run");
    return true;
  }

  /**
   * Wait for Angular to finish re-rendering after a purely client-side change.
   *
   * settle() only observes the network, so it returns almost immediately when
   * nothing was fetched — which is exactly the case after closing an alert
   * dialog. Watch the DOM instead and resolve once it has been quiet briefly.
   */
  async function settleDomRender(quietMs = 250, maxMs = 3000) {
    return new Promise((resolve) => {
      let timer = null;
      let observer = null;
      const finish = () => {
        if (observer) observer.disconnect();
        if (timer) clearTimeout(timer);
        clearTimeout(cap);
        resolve(true);
      };
      const cap = setTimeout(finish, maxMs);
      const bump = () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(finish, quietMs);
      };
      try {
        observer = new MutationObserver(bump);
        observer.observe(document.documentElement, { childList: true, subtree: true });
      } catch (_) {}
      bump();
    });
  }

  async function settleDialogRender(maxMs = 900) {
    const startHref = location.href;
    await window.ArcusDriver.waitFor(
      () => findOpenDialog() || (location.href !== startHref ? true : null),
      maxMs,
      { shouldAbort: () => state.stopRequested }
    );
  }

  /**
   * Wait for a toolbar action button to become usable.
   *
   * The button exists in the DOM from the start but stays disabled until the
   * row selection has propagated through Angular. waitForSelectorVisible treats
   * `disabled` as not-visible, so it reports "not found" for what is really
   * "not ready yet" — and the timeout it burns is the whole action budget.
   * Distinguish the two so the failure reason is honest.
   */
  async function waitForActionButton(selector, timeoutMs) {
    const found = await window.ArcusDriver.waitFor(() => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return null;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      if (el.disabled || el.getAttribute("aria-disabled") === "true") return null;
      if (el.closest("[disabled]")) return null;
      return el;
    }, timeoutMs, { shouldAbort: () => state.stopRequested });

    if (found) return { ok: true, el: found };

    // Say which of the two it was, so the log points at the real cause.
    const present = document.querySelector(selector);
    return {
      ok: false,
      el: null,
      reason: present
        ? `${selector} stayed disabled (row selection may not have registered)`
        : `${selector} not found in the DOM`,
    };
  }

  function clearHighlight() {
    document.querySelectorAll(".arcus-row-highlight").forEach((el) => el.classList.remove("arcus-row-highlight"));
  }

  function highlightRow(el) {
    clearHighlight();
    if (el) el.classList.add("arcus-row-highlight");
  }

  function setStep(step, detail = "") {
    window.ArcusPanel?.setStep(step, detail);
  }

  function getAutoModeLabel() {
    return state.settings.automationMode === "auto" ? "Auto refresh-search mode" : "Semi-auto selected-order mode";
  }

  async function refreshDispenseSearch() {
    setStep("Refresh search", "Clicking #searchdispense");
    const btn = await waitForSelectorVisible("#searchdispense", 8000);
    if (!btn) return { ok: false, reason: "#searchdispense not found or not clickable" };
    // The search round trip is exactly what the settle wait is for: we resume
    // when the result set actually lands, not 1200ms later.
    await clickAndSettle(btn, { timeoutMs: 12000 });
    await waitForWorkbenchReady();
    return { ok: true };
  }

  function normalizeStatus(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function getCellText(row, columnIndex) {
    const cell =
      row.querySelector(`td:nth-child(${columnIndex}) > span`) ||
      row.querySelector(`td:nth-child(${columnIndex})`);
    return cell ? textOf(cell) : "";
  }

  function getAutoRowIdentity(row) {
    return String(getCellText(row, 10) || "").replace(/\s+/g, " ").trim();
  }

  function getOrderPatternLabel() {
    return getEffectivePharmacyType() === "outpatient" ? "O* or E*" : "I*";
  }

  function isValidAutoIdentity(row) {
    const identity = getAutoRowIdentity(row);
    return isValidOrderNo(identity);
  }

  const ROW_SELECTOR =
    "tr[id^='slectDispense'], tr[id^='selectDispense'], [id^='slectDispense'], [id^='selectDispense']";

  /**
   * Read status, order number and order type for every candidate row in ONE
   * pass inside the page.
   *
   * The previous version called textOf() and getBoundingClientRect() per row
   * from the content script, forcing a layout flush on each one; on a 200-row
   * workbench that dominated the scan. Here the whole traversal happens in a
   * single page-side function, so with turbo it is one CDP round trip and the
   * layout is flushed at most once.
   *
   * Returns rows in document order with the index needed to re-find the element.
   */
  async function harvestRows(selector) {
    const result = await window.ArcusDriver.harvest((args) => {
      const norm = (v) => String(v || "").replace(/\s+/g, " ").trim();
      const cellText = (row, n) => {
        const cell = row.querySelector("td:nth-child(" + n + ") > span")
          || row.querySelector("td:nth-child(" + n + ")");
        return cell ? norm(cell.innerText || cell.textContent) : "";
      };

      const out = [];
      const nodes = document.querySelectorAll(args.selector);

      for (let i = 0; i < nodes.length; i++) {
        const row = nodes[i];
        if (!(row instanceof HTMLElement)) continue;

        const style = getComputedStyle(row);
        if (style.display === "none" || style.visibility === "hidden") continue;
        const rect = row.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;

        // OPD order type lives in a bound span rather than a fixed column.
        let opdType = "unknown";
        const bound = row.querySelectorAll(".ng-binding");
        for (let j = 0; j < bound.length; j++) {
          const t = norm(bound[j].innerText || bound[j].textContent).toLowerCase();
          if (t === "stat") { opdType = "stat"; break; }
          if (t === "routine") { opdType = "routine"; break; }
        }

        out.push({
          index: i,
          status: norm(cellText(row, 8)).toLowerCase(),
          identity: norm(cellText(row, 10)),
          text: norm(row.innerText || row.textContent),
          opdType,
          top: rect.top,
        });
      }
      return out;
    }, { selector });

    return result.ok && Array.isArray(result.value) ? result.value : null;
  }

  /** Classify an IPD row from its text, mirroring shared.getRowTypeFromText. */
  function ipdTypeOf(text) {
    const t = (text || "").toUpperCase();
    if (t.includes("DISCHARGE MEDICATION")) return "discharge";
    if (t.includes("CONTINUOUS ORDER")) return "continuous";
    if (t.includes("DAILY ORDER")) return "daily";
    return "unknown";
  }

  function rowRecordMatchesFilter(record) {
    const selected = getSelectedRowFilters();
    if (!selected.length || selected.includes("all")) return true;
    if (getEffectivePharmacyType() === "outpatient") return selected.includes(record.opdType);
    return selected.includes(ipdTypeOf(record.text));
  }

  /**
   * Rows matching the target status, as live elements.
   * Falls back to the original per-row DOM scan if the harvest fails, so a CDP
   * hiccup never costs us the run.
   */
  async function findStatusRows(targetStatus) {
    const wanted = normalizeStatus(targetStatus);
    const records = await harvestRows(ROW_SELECTOR);

    if (records) {
      const nodes = document.querySelectorAll(ROW_SELECTOR);
      return records
        .filter((r) => r.status === wanted && isValidOrderNo(r.identity) && rowRecordMatchesFilter(r))
        .map((r) => nodes[r.index])
        .filter((el) => el instanceof HTMLElement);
    }

    const rows = Array.from(document.querySelectorAll(ROW_SELECTOR))
      .filter((row) => row instanceof HTMLElement && isVisible(row));

    return rows.filter((row) => {
      const statusText = normalizeStatus(getCellText(row, 8));
      return statusText === wanted && isValidAutoIdentity(row) && matchesRowFilter(textOf(row), getSelectedRowFilters(), row);
    });
  }

  async function findFirstRowByStatusAfterRefresh(targetStatus) {
    const refresh = await refreshDispenseSearch();
    if (!refresh.ok) return { ok: false, reason: refresh.reason };

    setStep("Finding row", `Status column = ${targetStatus} AND column 10 starts with ${getOrderPatternLabel()}`);
    const started = Date.now();
    while (Date.now() - started < 8000) {
      if (state.stopRequested) return { ok: false, reason: "stopped" };
      const rows = await findStatusRows(targetStatus);
      if (rows.length) return { ok: true, row: rows[0], count: rows.length };
      await sleep(400);
    }

    return { ok: false, reason: `No row with status ${targetStatus} and column 10 starts with ${getOrderPatternLabel()}` };
  }

  async function closeAllocationInfoAlert(meta) {
    const dialog = findOpenDialog();
    if (!dialog) return true;
    if (!isAlertDialog(dialog) || dialogLooksLikeManualOverride(dialog) ||
        window.ArcusAutoOverride?.blockedAlerts(dialog).length) return false;
    setStep("Closing alert", "Closing the informational alert before Allocate");
    await closeAlertDialogIfPresent(meta);
    await settleDomRender();
    return !findOpenDialog();
  }

  async function clickAllocateSaveAndHandleOverride(functionName) {
    const meta = functionName + " / allocate";
    const fail = reason => ({ ok: false, done: true, reason });
    setStep("Waiting allocate page", "Looking for Allocate button");
    await settleDialogRender(1200);
    if (!(await closeAllocationInfoAlert(meta))) return fail("Review the existing dialog before allocating");
    let saveBtn = await waitForAllocatePageReady();
    if (findOpenDialog()) {
      if (!(await closeAllocationInfoAlert(meta))) return fail("Review the existing dialog before allocating");
      saveBtn = await waitForAllocatePageReady();
    }
    if (!saveBtn || state.stopRequested) return fail("allocate page not ready or stopped");

    setStep("Saving allocate", "Sending Allocate once");
    if (!(await clickAndSettle(saveBtn, { timeoutMs: CONFIG.maxSaveSettleMs }))) {
      return fail("allocate confirm button could not be clicked");
    }
    window.ArcusPanel?.pushLog("info", "Allocate submitted once; waiting for result", meta);
    let deadline = Date.now() + CONFIG.maxRouteWaitMs;
    while (!state.stopRequested && Date.now() < deadline) {
      const override = window.ArcusAutoOverride;
      if (isWorkbenchPage()) {
        if (await waitForWorkbenchReady()) return { ok: true, reason: "allocated and returned to workbench" };
        return fail("workbench returned but did not become ready");
      }
      const dialog = findOpenDialog();
      if (dialog && override?.isEnabled?.()) {
        // Act explicitly; do not race the observer's debounce timer.
        await override.handleIfPresent();
        while (override.state.busy && !state.stopRequested) await sleep(100);
        if (state.stopRequested) break;
        if (override.isAwaitingHuman()) {
          setStep("Waiting for pharmacist", override.state.awaitingReason || "Review the override dialog");
          const reviewed = await waitForManualOverrideCompletion(meta);
          if (!reviewed.ok) return fail(reviewed.reason);
        } else if (findOpenDialog()) {
          return fail("Unrecognized dialog left open for review");
        }
        deadline = Date.now() + CONFIG.maxRouteWaitMs;
      } else if (dialog) {
        if (!dialogLooksLikeManualOverride(dialog) || !state.settings.waitManualOverride) {
          return fail("Dialog requires review; no automatic close or repeat Allocate was sent");
        }
        const reviewed = await waitForManualOverrideCompletion(meta);
        if (!reviewed.ok) return fail(reviewed.reason);
        deadline = Date.now() + CONFIG.maxRouteWaitMs;
      }
      // Saving the reason can trigger allocation itself. Never re-submit saveData
      // simply because Angular has not navigated yet.
      await sleep(150);
    }
    return fail(state.stopRequested ? "stopped; sent allocation is not undone" :
      "Allocation result not confirmed. Check the order before retrying; no repeat Allocate was sent.");
  }

  /**
   * Finish a save that was interrupted by a dialog.
   *
   * Dismissing the override/alert dialog drops the user back on the allocate or
   * dispense page with nothing committed, so the confirm button must be clicked
   * a second time. Previously the code assumed the app navigated back by itself
   * and reported success without ever re-clicking, which left the order sitting
   * unsaved on the confirm screen.
   */
  async function commitAfterDialog({ meta, label, isPage, waitForPage, attempt = 1 }) {
    // The app may have navigated back on its own; nothing more to do.
    const already = await waitFor(() => (isWorkbenchPage() ? true : null), 2500, 200);
    if (already) return { ok: true, reason: `${label} saved and returned to workbench` };

    if (!isPage()) {
      const back = await waitForWorkbenchReady();
      if (!back) return { ok: false, reason: `did not return to workbench after ${label} dialog` };
      return { ok: true, reason: `${label} saved after dialog handling` };
    }

    setStep(`Re-confirming ${label}`, "Clicking the confirm button again after the dialog");
    const saveBtn = await waitForPage();
    if (!saveBtn) {
      return { ok: false, reason: `${label} confirm button not ready after dialog` };
    }

    // The driver refuses to click a disabled control, so a false here means the
    // button was never actually pressed. Treating that as success is exactly
    // how an uncommitted order gets counted as done.
    const clicked = await clickAndSettle(saveBtn, {
      timeoutMs: CONFIG.maxSaveSettleMs,
      allowRepeat: true,          // deliberate re-press after a dialog
    });
    if (!clicked) {
      return { ok: false, reason: `${label} confirm button could not be clicked` };
    }
    window.ArcusPanel?.pushLog("info", `Re-clicked ${label} confirm after dialog`, meta);
    await settleDialogRender();
    await waitForAutoOverrideIdle();

    // A further dialog can appear on this second attempt. Auto-override may
    // have taken it already; only step in if one is still sitting there.
    if (findOpenDialog()) {
      await closeGenericToolbarDialogIfPresent(meta);
      await closeAlertDialogIfPresent(meta);
    }

    // An allergy alert stops the run for a pharmacist; wait rather than fail.
    if (!(await waitForPharmacistIfNeeded())) {
      return { ok: false, reason: "stopped while waiting for pharmacist" };
    }

    const back = await waitForWorkbenchReady();
    if (back) {
      return { ok: true, reason: `${label} confirmed after dialog and returned to workbench` };
    }

    // Still on the confirm page. Before pressing again, make sure the previous
    // save is not simply still running: re-entering saveData() while its
    // request is in flight makes Arcus operate on half-mutated state, and a
    // recording showed that produces no commit at all.
    if (isPage() && attempt < 3) {
      await settle(8000);

      // The save may well have landed during that wait.
      if (isWorkbenchPage()) {
        return { ok: true, reason: `${label} committed while waiting` };
      }
      if (!isPage()) {
        const landed = await waitForWorkbenchReady();
        if (landed) return { ok: true, reason: `${label} committed while waiting` };
      }

      return commitAfterDialog({ meta, label, isPage, waitForPage, attempt: attempt + 1 });
    }

    return { ok: false, reason: `did not return to workbench after re-confirming ${label}` };
  }

  async function handleAllocateFlow(functionName) {
    return clickAllocateSaveAndHandleOverride(functionName);
  }

  async function clickDispenseToDeptSaveAndHandleOverride(functionName) {
    const meta = `${functionName} • dispensetodept route`;

    setStep("Waiting dispense page", "Looking for Save button");
    const saveBtn = await waitForDispenseToDeptPageReady();
    if (!saveBtn) {
      // waitForDispenseToDeptPageReady has already traced which stage stalled.
      return { ok: false, reason: "dispensetodept page/save button not ready" };
    }

    setStep("Saving dispense", "Clicked Save button");
    const before = window.ArcusShared.describeDispensePage();
    console.log("[dispense] state before click:", before);

    if (!(await clickAndSettle(saveBtn, { timeoutMs: CONFIG.maxSaveSettleMs }))) {
      return { ok: false, reason: "dispense confirm button could not be clicked" };
    }
    window.ArcusPanel?.pushLog("info", "Clicked dispensetodept save button", meta);
    await settleDialogRender();
    await waitForAutoOverrideIdle();

    // If the click left us on the same page with no dialog, verifyDispense()
    // most likely threw. Say so rather than reporting a vague timeout later.
    const after = window.ArcusShared.describeDispensePage();
    console.log("[dispense] state after click:", after);

    const dialog = findOpenDialog();
    if (!dialog && after.route && after.itemCount === before.itemCount) {
      window.ArcusPanel?.pushLog(
        "warn",
        "Dispense click produced no dialog and no navigation",
        JSON.stringify(after)
      );
    }
    if (dialog && dialogLooksLikeManualOverride(dialog) && state.settings.waitManualOverride) {
      setStep("Manual override", "Please select override reason and Save");
      const waitResult = await waitForManualOverrideCompletion(meta);
      if (!waitResult.ok) return waitResult;
      // As with allocate: dismissing the dialog commits nothing, so the confirm
      // button must be pressed again.
      return commitAfterDialog({
        meta,
        label: "dispense",
        isPage: isDispenseToDeptPage,
        waitForPage: waitForDispenseToDeptPageReady,
      });
    }

    if (dialog) {
      await closeGenericToolbarDialogIfPresent(meta);
      await closeAlertDialogIfPresent(meta);
      return commitAfterDialog({
        meta,
        label: "dispense",
        isPage: isDispenseToDeptPage,
        waitForPage: waitForDispenseToDeptPageReady,
      });
    }

    // Same reasoning as allocate: auto-override may have already closed a
    // dialog, leaving us on the dispense page with nothing committed.
    return commitAfterDialog({
      meta,
      label: "dispense",
      isPage: isDispenseToDeptPage,
      waitForPage: waitForDispenseToDeptPageReady,
    });
  }

  async function handleDispenseFlow(functionName) {
    const meta = `${functionName} • dispense`;

    setStep("Finding dispense button", "Waiting for #dispensetodept");
    const dispense = await waitForActionButton(CONFIG.actionSelectors.dispenseFromWorkbench, CONFIG.maxActionWaitMs);
    if (!dispense.ok) return { ok: false, reason: dispense.reason };

    setStep("Opening dispense", "Clicked dispense button");
    await clickAndSettle(dispense.el, { timeoutMs: CONFIG.maxSaveSettleMs });
    window.ArcusPanel?.pushLog("info", "Clicked dispense button", meta);

    const routeHit = await waitForRouteContains(CONFIG.routes.dispenseToDept, CONFIG.maxRouteWaitMs);
    if (!routeHit) return { ok: false, reason: "route did not change to dispensetodept" };

    return clickDispenseToDeptSaveAndHandleOverride(functionName);
  }

  async function processSingleRow(snapshot, mode, functionName) {
    for (let attempt = 1; attempt <= CONFIG.maxRetriesPerRow + 1; attempt++) {
      if (state.stopRequested) return { ok: false, reason: "stopped" };

      try {
        setStep("Finding row", window.ArcusShared.shortText(snapshot.text, 90));
        const row = findRowBySnapshot(snapshot);
        if (!row) return { ok: false, reason: "row not found" };

        setStep("Opening row", window.ArcusShared.shortText(snapshot.text, 90));
        await waitForWorkbenchReady();
        highlightRow(row);
        await clickAndSettle(row, { timeoutMs: CONFIG.maxRowSettleMs });

        const meta = `${functionName} • attempt ${attempt}`;
        await settleDialogRender(1200);
        if (findOpenDialog() && isAlertDialog()) {
          await acknowledgeAlertRowsIfPresent(meta);
          await closeAlertDialogIfPresent(meta);
          if (findOpenDialog()) return { ok: false, done: true, reason: "Row alert remains open; review before allocating" };
          // No XHR follows a dialog close; wait for the re-render, not the network.
          await settleDomRender();
        }

        if (mode === "allocate") {
          setStep("Finding allocate button", "Waiting for #allocatedispense");
          const allocate = await waitForActionButton(CONFIG.actionSelectors.allocateFromWorkbench, CONFIG.maxActionWaitMs);
          if (!allocate.ok) {
            if (attempt <= CONFIG.maxRetriesPerRow) continue;
            return { ok: false, reason: allocate.reason };
          }
          setStep("Opening allocate", "Clicked allocate button");
          await clickAndSettle(allocate.el, { timeoutMs: CONFIG.maxSaveSettleMs });
          const routeHit = await waitForRouteContains(CONFIG.routes.allocateDispense, CONFIG.maxRouteWaitMs);
          if (!routeHit) {
            if (attempt <= CONFIG.maxRetriesPerRow) continue;
            return { ok: false, reason: "route did not change to allocatedispense" };
          }
          return handleAllocateFlow(functionName);
        }

        if (mode === "dispense") return handleDispenseFlow(functionName);
        return { ok: false, reason: `unknown mode: ${mode}` };
      } catch (error) {
        if (attempt <= CONFIG.maxRetriesPerRow) {
          await sleep(700);
          continue;
        }
        return { ok: false, reason: error.message || "unknown error" };
      }
    }
    return { ok: false, reason: "retry exhausted" };
  }

  async function processAutoStatusRow({ functionName, mode, targetStatus }) {
    const found = await findFirstRowByStatusAfterRefresh(targetStatus);
    if (!found.ok) {
      const noMatch = String(found.reason || "").toLowerCase().includes("no row with status");
      return { ok: false, noMatch, done: !noMatch, reason: found.reason };
    }

    const rowText = window.ArcusShared.shortText(textOf(found.row), 120);
    const rowIdentity = getAutoRowIdentity(found.row);
    setStep("Opening target row", `${targetStatus} • ${rowIdentity} • ${rowText}`);
    highlightRow(found.row);
    await clickAndSettle(found.row, { timeoutMs: CONFIG.maxRowSettleMs });

    const meta = `${functionName} • auto status ${targetStatus}`;
    await settleDialogRender(1200);
    if (findOpenDialog() && isAlertDialog()) {
      await acknowledgeAlertRowsIfPresent(meta);
      await closeAlertDialogIfPresent(meta);
      if (findOpenDialog()) return { ok: false, done: true, reason: "Row alert remains open; review before allocating" };
      // No XHR follows a dialog close; wait for the re-render, not the network.
      await settleDomRender();
    }

    if (mode === "allocate") {
      setStep("Finding allocate button", "Waiting for #allocatedispense");
      const allocate = await waitForActionButton(CONFIG.actionSelectors.allocateFromWorkbench, CONFIG.maxActionWaitMs);
      if (!allocate.ok) return { ok: false, done: false, reason: allocate.reason };
      setStep("Opening allocate", "Clicked allocate button");
      await clickAndSettle(allocate.el, { timeoutMs: CONFIG.maxSaveSettleMs });
      const routeHit = await waitForRouteContains(CONFIG.routes.allocateDispense, CONFIG.maxRouteWaitMs);
      if (!routeHit) return { ok: false, done: false, reason: "route did not change to allocatedispense" };
      return handleAllocateFlow(functionName);
    }

    return handleDispenseFlow(functionName);
  }

  async function waitBeforeNextAutoSearch(targetStatus, loop) {
    const totalSeconds = Math.max(1, Math.round((CONFIG.autoNoMatchIntervalMs || 30000) / 1000));

    for (let left = totalSeconds; left > 0; left--) {
      if (state.stopRequested) return { stopped: true };
      setStep(
        "No matching row",
        `No ${targetStatus} + ${getOrderPatternLabel()} row found. Refresh again in ${left}s. Loop ${loop}`
      );
      window.ArcusPanel?.setStatus(
        `Auto mode waiting\nNo ${targetStatus} + ${getOrderPatternLabel()} row found.\nRefresh again in ${left}s. Press Stop to cancel.`
      );
      await sleep(1000);
    }

    return { stopped: false };
  }

  async function runAutoStatusAutomation({ functionName, mode }) {
    const targetStatus = mode === "allocate" ? "Ordered" : "Allocated";
    const maxLoops = 500;

    state.isRunning = true;
    state.stopRequested = false;
    state.stats = { processed: 0, success: 0, fail: 0 };
    window.ArcusPanel?.renderStats();
    window.ArcusPanel?.updateButtonState();
    window.ArcusPanel?.setStatus(`${functionName}\n${getAutoModeLabel()}\nTarget status: ${targetStatus}`);
    setStep("Starting", `Target status: ${targetStatus}`);

    try {
      for (let loop = 1; loop <= maxLoops; loop++) {
        if (state.stopRequested) break;
        setStep(`Auto loop ${loop}`, `Refresh search → find ${targetStatus} + I* row`);
        const result = await processAutoStatusRow({ functionName, mode, targetStatus });

        if (result.noMatch) {
          const waitResult = await waitBeforeNextAutoSearch(targetStatus, loop);
          if (waitResult.stopped) break;
          continue;
        }

        if (result.done && !result.ok) {
          setStep("Stopped by error", result.reason);
          window.ArcusPanel?.setStatus(`${functionName}\nStopped. ${result.reason}\nSuccess ${state.stats.success}, Fail ${state.stats.fail}`);
          break;
        }

        state.stats.processed += 1;
        if (result.ok) {
          state.stats.success += 1;
          setStep("Row completed", `Success ${state.stats.success}, Fail ${state.stats.fail}`);
        } else {
          state.stats.fail += 1;
          setStep("Row failed", result.reason || "unknown reason");
        }
        window.ArcusPanel?.renderStats();
        if (result.done && !result.ok) {
          window.ArcusPanel?.setStatus(functionName + "\nStopped for review: " + result.reason);
          return;
        }
        await sleep(CONFIG.loopDelayMs);
      }

      if (state.stopRequested) {
        window.ArcusPanel?.setStatus(`${functionName}\nStopped.`);
        setStep("Stopped", `${state.stats.processed} processed`);
      }
    } finally {
      state.isRunning = false;
      state.stopRequested = false;
      clearHighlight();
      window.ArcusPanel?.updateButtonState();
    }
  }

  async function runSemiAutomation({ functionName, mode }) {
    const snapshots = getRowSnapshots();
    if (!snapshots.length) {
      window.ArcusPanel?.setStatus(`${functionName}\nNo rows found for ${getSelectedRowFilterLabel()}.`);
      setStep("No rows found", getSelectedRowFilterLabel());
      return;
    }

    state.isRunning = true;
    state.stopRequested = false;
    state.stats = { processed: 0, success: 0, fail: 0 };
    window.ArcusPanel?.renderStats();
    window.ArcusPanel?.updateButtonState();
    window.ArcusPanel?.setStatus(`${functionName}\n${getAutoModeLabel()}\nFilter: ${getSelectedRowFilterLabel()}\nFound ${snapshots.length} rows`);

    try {
      for (let i = 0; i < snapshots.length; i++) {
        if (state.stopRequested) break;
        const snapshot = snapshots[i];
        window.ArcusPanel?.setStatus(`${functionName}\n${getSelectedRowFilterLabel()}\nProcessing ${i + 1}/${snapshots.length}\n${snapshot.text}`);
        setStep(`Row ${i + 1}/${snapshots.length}`, `[${snapshot.rowType}] ${window.ArcusShared.shortText(snapshot.text, 100)}`);

        const result = await processSingleRow(snapshot, mode, functionName);
        state.stats.processed += 1;
        if (result.ok) {
          state.stats.success += 1;
          setStep("Row completed", `Success ${state.stats.success}, Fail ${state.stats.fail}`);
        } else {
          state.stats.fail += 1;
          setStep("Row failed", result.reason || "unknown reason");
        }
        window.ArcusPanel?.renderStats();
        await sleep(CONFIG.loopDelayMs);
      }

      if (state.stopRequested) {
        window.ArcusPanel?.setStatus(`${functionName}\nStopped.`);
        setStep("Stopped", `${state.stats.processed} processed`);
      } else {
        window.ArcusPanel?.setStatus(`${functionName}\nCompleted. Success ${state.stats.success}, Fail ${state.stats.fail}`);
        setStep("Completed", `Success ${state.stats.success}, Fail ${state.stats.fail}`);
      }
    } finally {
      state.isRunning = false;
      state.stopRequested = false;
      clearHighlight();
      window.ArcusPanel?.updateButtonState();
    }
  }

  async function runAutomation({ functionName, mode }) {
    if (window.ArcusPaperless?.isActive()) { alert("Stop Paperless Checker before starting batch automation."); return; }
    await window.ArcusTabSettings.flush();
    if (window.ArcusPaperless?.isActive()) return;
    if (!window.ArcusShared.isWorkbenchPage()) {
      alert("This function works only on Arcus dispense workbench pharmacy routes.");
      return;
    }
    if (window.ArcusAutoOverride?.state.busy) { alert("Wait for the current override to finish."); return; }
    if (state.isRunning) {
      alert("Another workbench task is already running.");
      return;
    }

    window.ArcusAutoOverride?.resume();
    if (state.settings.automationMode === "auto") {
      return runAutoStatusAutomation({ functionName, mode });
    }
    return runSemiAutomation({ functionName, mode });
  }

  window.ArcusAutomation = { runAutomation, clearHighlight, highlightRow };
})();
