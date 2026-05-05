(() => {
  if (window.__ARCUS_AUTOMATION_LOADED__) return;
  window.__ARCUS_AUTOMATION_LOADED__ = true;

  const {
    CONFIG,
    state,
    clickLikeUser,
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
    getRowSnapshots,
    findRowBySnapshot,
    getSelectedRowFilterLabel,
    isVisible,
    textOf,
    sleep,
  } = window.ArcusShared;

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
    await clickLikeUser(btn);
    await sleep(1200);
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

  function isValidAutoIdentity(row) {
    const identity = getAutoRowIdentity(row);
    return /^I/i.test(identity);
  }

  function findStatusRows(targetStatus) {
    const wanted = normalizeStatus(targetStatus);
    const rows = Array.from(document.querySelectorAll("tr[id^='slectDispense'], tr[id^='selectDispense'], [id^='slectDispense'], [id^='selectDispense']"))
      .filter((row) => row instanceof HTMLElement && isVisible(row));

    return rows.filter((row) => {
      const statusText = normalizeStatus(getCellText(row, 8));
      return statusText === wanted && isValidAutoIdentity(row);
    });
  }

  async function findFirstRowByStatusAfterRefresh(targetStatus) {
    const refresh = await refreshDispenseSearch();
    if (!refresh.ok) return { ok: false, reason: refresh.reason };

    setStep("Finding row", `Status column = ${targetStatus} AND column 10 starts with I`);
    const started = Date.now();
    while (Date.now() - started < 8000) {
      if (state.stopRequested) return { ok: false, reason: "stopped" };
      const rows = findStatusRows(targetStatus);
      if (rows.length) return { ok: true, row: rows[0], count: rows.length };
      await sleep(400);
    }

    return { ok: false, reason: `No row with status ${targetStatus} and column 10 starts with I` };
  }

  async function clickAllocateSaveAndHandleOverride(functionName) {
    const meta = `${functionName} • allocate route`;

    setStep("Waiting allocate page", "Looking for Save button");
    const saveBtn = await waitForAllocatePageReady();
    if (!saveBtn) return { ok: false, reason: "allocate page/save button not ready" };

    setStep("Saving allocate", "Clicked Save button");
    await clickLikeUser(saveBtn);
    window.ArcusPanel?.pushLog("info", "Clicked allocate save button", meta);
    await sleep(CONFIG.settleAfterSaveClickMs);

    const dialog = findOpenDialog();
    if (!dialog) {
      const back = await waitForWorkbenchReady();
      if (!back) return { ok: false, reason: "did not return to dispense workbench" };
      return { ok: true, reason: "allocate saved and returned to dispense workbench" };
    }

    if (dialogLooksLikeManualOverride(dialog) && state.settings.waitManualOverride) {
      setStep("Manual override", "Please select override reason and Save");
      const waitResult = await waitForManualOverrideCompletion(meta);
      if (!waitResult.ok) return waitResult;
      const back = await waitForWorkbenchReady();
      if (back) return { ok: true, reason: "manual override completed and returned to workbench" };
      return { ok: true, reason: waitResult.reason };
    }

    await closeGenericToolbarDialogIfPresent(meta);
    const back = await waitForWorkbenchReady();
    if (!back) return { ok: false, reason: "did not return to dispense workbench after dialog" };
    return { ok: true, reason: "allocate saved after dialog handling" };
  }

  async function handleAllocateFlow(functionName) {
    return clickAllocateSaveAndHandleOverride(functionName);
  }

  async function clickDispenseToDeptSaveAndHandleOverride(functionName) {
    const meta = `${functionName} • dispensetodept route`;

    setStep("Waiting dispense page", "Looking for Save button");
    const saveBtn = await waitForDispenseToDeptPageReady();
    if (!saveBtn) return { ok: false, reason: "dispensetodept page/save button not ready" };

    setStep("Saving dispense", "Clicked Save button");
    await clickLikeUser(saveBtn);
    window.ArcusPanel?.pushLog("info", "Clicked dispensetodept save button", meta);
    await sleep(CONFIG.settleAfterSaveClickMs);

    const dialog = findOpenDialog();
    if (dialog && dialogLooksLikeManualOverride(dialog) && state.settings.waitManualOverride) {
      setStep("Manual override", "Please select override reason and Save");
      const waitResult = await waitForManualOverrideCompletion(meta);
      if (!waitResult.ok) return waitResult;
    } else if (dialog) {
      await closeGenericToolbarDialogIfPresent(meta);
      await closeAlertDialogIfPresent(meta);
    }

    const back = await waitForWorkbenchReady();
    if (!back) return { ok: false, reason: "did not return to dispense workbench after dispensetodept save" };
    return { ok: true, reason: "dispensetodept saved and returned to dispense workbench" };
  }

  async function handleDispenseFlow(functionName) {
    const meta = `${functionName} • dispense`;

    setStep("Finding dispense button", "Waiting for #dispensetodept");
    const dispenseBtn = await waitForSelectorVisible(CONFIG.actionSelectors.dispenseFromWorkbench, CONFIG.maxActionWaitMs);
    if (!dispenseBtn) return { ok: false, reason: "dispense button not found" };

    setStep("Opening dispense", "Clicked dispense button");
    await clickLikeUser(dispenseBtn);
    window.ArcusPanel?.pushLog("info", "Clicked dispense button", meta);
    await sleep(CONFIG.settleAfterActionClickMs);

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
        await clickLikeUser(row);
        await sleep(CONFIG.settleAfterRowClickMs);

        const meta = `${functionName} • attempt ${attempt}`;
        if (findOpenDialog() && isAlertDialog()) {
          await acknowledgeAlertRowsIfPresent(meta);
          await closeAlertDialogIfPresent(meta);
          await sleep(500);
        }

        if (mode === "allocate") {
          setStep("Finding allocate button", "Waiting for #allocatedispense");
          const allocateBtn = await waitForSelectorVisible(CONFIG.actionSelectors.allocateFromWorkbench, CONFIG.maxActionWaitMs);
          if (!allocateBtn) {
            if (attempt <= CONFIG.maxRetriesPerRow) continue;
            return { ok: false, reason: "allocate button not found on workbench" };
          }
          setStep("Opening allocate", "Clicked allocate button");
          await clickLikeUser(allocateBtn);
          await sleep(CONFIG.settleAfterActionClickMs);
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
    await clickLikeUser(found.row);
    await sleep(CONFIG.settleAfterRowClickMs);

    const meta = `${functionName} • auto status ${targetStatus}`;
    if (findOpenDialog() && isAlertDialog()) {
      await acknowledgeAlertRowsIfPresent(meta);
      await closeAlertDialogIfPresent(meta);
      await sleep(500);
    }

    if (mode === "allocate") {
      setStep("Finding allocate button", "Waiting for #allocatedispense");
      const allocateBtn = await waitForSelectorVisible(CONFIG.actionSelectors.allocateFromWorkbench, CONFIG.maxActionWaitMs);
      if (!allocateBtn) return { ok: false, done: false, reason: "allocate button not found" };
      setStep("Opening allocate", "Clicked allocate button");
      await clickLikeUser(allocateBtn);
      await sleep(CONFIG.settleAfterActionClickMs);
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
        `No ${targetStatus} + I* row found. Refresh again in ${left}s. Loop ${loop}`
      );
      window.ArcusPanel?.setStatus(
        `Auto mode waiting\nNo ${targetStatus} + I* row found.\nRefresh again in ${left}s. Press Stop to cancel.`
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
    if (!window.ArcusShared.isWorkbenchPage()) {
      alert("This function works only on Arcus dispense workbench pharmacy routes.");
      return;
    }
    if (state.isRunning || state.scraper.state === "running") {
      alert("Another workbench task is already running.");
      return;
    }

    if (state.settings.automationMode === "auto") {
      return runAutoStatusAutomation({ functionName, mode });
    }
    return runSemiAutomation({ functionName, mode });
  }

  window.ArcusAutomation = { runAutomation, clearHighlight, highlightRow };
})();
