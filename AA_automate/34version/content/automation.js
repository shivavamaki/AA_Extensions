(() => {
  if (window.__ARCUS_AUTOMATION_LOADED__) return;
  window.__ARCUS_AUTOMATION_LOADED__ = true;

  const {
    CONFIG,
    ORDER_FILTERS,
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
    sleep,
  } = window.ArcusShared;

  function clearHighlight() {
    document.querySelectorAll(".arcus-row-highlight").forEach((el) => {
      el.classList.remove("arcus-row-highlight");
    });
  }

  function highlightRow(el) {
    clearHighlight();
    if (el) el.classList.add("arcus-row-highlight");
  }

  async function clickAllocateSaveAndHandleOverride(functionName) {
    const meta = `${functionName} • allocate route`;

    const saveBtn = await waitForAllocatePageReady();
    if (!saveBtn) {
      return { ok: false, reason: "allocate page/save button not ready" };
    }

    await clickLikeUser(saveBtn);
    window.ArcusPanel?.pushLog("info", "Clicked allocate save button", meta);
    await sleep(CONFIG.settleAfterSaveClickMs);

    const dialog = findOpenDialog();
    if (!dialog) {
      const back = await waitForWorkbenchReady();
      if (!back) {
        return { ok: false, reason: "did not return to dispense workbench" };
      }
      return { ok: true, reason: "allocate saved and returned to dispense workbench" };
    }

    if (dialogLooksLikeManualOverride(dialog) && state.settings.waitManualOverride) {
      const waitResult = await waitForManualOverrideCompletion(meta);
      if (!waitResult.ok) return waitResult;

      const back = await waitForWorkbenchReady();
      if (back) {
        return { ok: true, reason: "manual override completed and returned to workbench" };
      }
      return { ok: true, reason: waitResult.reason };
    }

    await closeGenericToolbarDialogIfPresent(meta);

    const back = await waitForWorkbenchReady();
    if (!back) {
      return { ok: false, reason: "did not return to dispense workbench after dialog" };
    }

    return { ok: true, reason: "allocate saved after dialog handling" };
  }

  async function handleAllocateFlow(functionName) {
    return clickAllocateSaveAndHandleOverride(functionName);
  }

  async function clickDispenseToDeptSaveAndHandleOverride(functionName) {
    const meta = `${functionName} • dispensetodept route`;

    const saveBtn = await waitForDispenseToDeptPageReady();
    if (!saveBtn) {
      return { ok: false, reason: "dispensetodept page/save button not ready" };
    }

    await clickLikeUser(saveBtn);
    window.ArcusPanel?.pushLog("info", "Clicked dispensetodept save button", meta);
    await sleep(CONFIG.settleAfterSaveClickMs);

    const dialog = findOpenDialog();

    if (dialog && dialogLooksLikeManualOverride(dialog) && state.settings.waitManualOverride) {
      const waitResult = await waitForManualOverrideCompletion(meta);
      if (!waitResult.ok) return waitResult;
    } else if (dialog) {
      await closeGenericToolbarDialogIfPresent(meta);
      await closeAlertDialogIfPresent(meta);
    }

    const back = await waitForWorkbenchReady();
    if (!back) {
      return { ok: false, reason: "did not return to dispense workbench after dispensetodept save" };
    }

    return { ok: true, reason: "dispensetodept saved and returned to dispense workbench" };
  }

  async function handleDispenseFlow(functionName) {
    const meta = `${functionName} • dispense`;

    const dispenseBtn = await waitForSelectorVisible(
      CONFIG.actionSelectors.dispenseFromWorkbench,
      CONFIG.maxActionWaitMs
    );
    if (!dispenseBtn) {
      return { ok: false, reason: "dispense button not found" };
    }

    await clickLikeUser(dispenseBtn);
    window.ArcusPanel?.pushLog("info", "Clicked dispense button", meta);
    await sleep(CONFIG.settleAfterActionClickMs);

    const routeHit = await waitForRouteContains(
      CONFIG.routes.dispenseToDept,
      CONFIG.maxRouteWaitMs
    );

    if (!routeHit) {
      return { ok: false, reason: "route did not change to dispensetodept" };
    }

    return await clickDispenseToDeptSaveAndHandleOverride(functionName);
  }

  async function processSingleRow(snapshot, mode, functionName) {
    for (let attempt = 1; attempt <= CONFIG.maxRetriesPerRow + 1; attempt++) {
      if (state.stopRequested) return { ok: false, reason: "stopped" };

      try {
        const row = findRowBySnapshot(snapshot);
        if (!row) return { ok: false, reason: "row not found" };

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
          const allocateBtn = await waitForSelectorVisible(
            CONFIG.actionSelectors.allocateFromWorkbench,
            CONFIG.maxActionWaitMs
          );

          if (!allocateBtn) {
            if (attempt <= CONFIG.maxRetriesPerRow) {
              window.ArcusPanel?.pushLog("info", "Retry row because allocate button not ready", meta);
              continue;
            }
            return { ok: false, reason: "allocate button not found on workbench" };
          }

          await clickLikeUser(allocateBtn);
          window.ArcusPanel?.pushLog("info", "Clicked allocate button", meta);
          await sleep(CONFIG.settleAfterActionClickMs);

          const routeHit = await waitForRouteContains(
            CONFIG.routes.allocateDispense,
            CONFIG.maxRouteWaitMs
          );
          if (!routeHit) {
            if (attempt <= CONFIG.maxRetriesPerRow) {
              window.ArcusPanel?.pushLog(
                "info",
                "Retry row because route did not change to allocatedispense",
                meta
              );
              continue;
            }
            return { ok: false, reason: "route did not change to allocatedispense" };
          }

          return await handleAllocateFlow(functionName);
        }

        if (mode === "dispense") {
          return await handleDispenseFlow(functionName);
        }

        return { ok: false, reason: `unknown mode: ${mode}` };
      } catch (error) {
        const meta = `${functionName} • attempt ${attempt}`;
        if (attempt <= CONFIG.maxRetriesPerRow) {
          window.ArcusPanel?.pushLog(
            "info",
            "Retry row after error",
            `${meta} • ${error.message || "unknown error"}`
          );
          await sleep(700);
          continue;
        }
        return { ok: false, reason: error.message || "unknown error" };
      }
    }

    return { ok: false, reason: "retry exhausted" };
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

    const snapshots = getRowSnapshots();
    if (!snapshots.length) {
      window.ArcusPanel?.setStatus(
        `${functionName}\nNo rows found for ${ORDER_FILTERS[state.settings.rowFilter]}.`
      );
      window.ArcusPanel?.pushLog("fail", "No rows found in target container", functionName);
      return;
    }

    state.isRunning = true;
    state.stopRequested = false;
    state.stats = { processed: 0, success: 0, fail: 0 };
    window.ArcusPanel?.renderStats();
    window.ArcusPanel?.updateButtonState();

    window.ArcusPanel?.setStatus(
      `${functionName}\nFilter: ${ORDER_FILTERS[state.settings.rowFilter]}\nFound ${snapshots.length} rows`
    );
    window.ArcusPanel?.pushLog(
      "info",
      `Start ${functionName} with ${snapshots.length} rows`,
      `${functionName} • ${ORDER_FILTERS[state.settings.rowFilter]}`
    );

    try {
      for (let i = 0; i < snapshots.length; i++) {
        if (state.stopRequested) {
          window.ArcusPanel?.pushLog("info", "Stopped by user", functionName);
          break;
        }

        const snapshot = snapshots[i];
        window.ArcusPanel?.setStatus(
          `${functionName}\n${ORDER_FILTERS[state.settings.rowFilter]}\nProcessing ${i + 1}/${snapshots.length}\n${snapshot.text}`
        );

        const result = await processSingleRow(snapshot, mode, functionName);
        state.stats.processed += 1;

        if (result.ok) {
          state.stats.success += 1;
          window.ArcusPanel?.pushLog(
            "success",
            `[${snapshot.rowType}] ${window.ArcusShared.shortText(snapshot.text)}`,
            `${functionName} • ${result.reason}`
          );
        } else {
          state.stats.fail += 1;
          window.ArcusPanel?.pushLog(
            "fail",
            `[${snapshot.rowType}] ${window.ArcusShared.shortText(snapshot.text)}`,
            `${functionName} • ${result.reason}`
          );
        }

        window.ArcusPanel?.renderStats();
        await sleep(CONFIG.loopDelayMs);
      }

      if (state.stopRequested) {
        window.ArcusPanel?.setStatus(`${functionName}\nStopped.`);
      } else {
        window.ArcusPanel?.setStatus(
          `${functionName}\nCompleted. Success ${state.stats.success}, Fail ${state.stats.fail}`
        );
      }
    } finally {
      state.isRunning = false;
      state.stopRequested = false;
      clearHighlight();
      window.ArcusPanel?.updateButtonState();
    }
  }

  window.ArcusAutomation = {
    runAutomation,
    clearHighlight,
    highlightRow,
  };
})();