(() => {
  if (window.__ARCUS_SCRAPER_LOADED__) return;
  window.__ARCUS_SCRAPER_LOADED__ = true;

  const {
    CONFIG,
    ORDER_FILTERS,
    state,
    syncScraperState,
    getRowSnapshots,
    findRowBySnapshot,
    clickLikeUser,
    findOpenDialog,
    isAlertDialog,
    acknowledgeAlertRowsIfPresent,
    closeAlertDialogIfPresent,
    waitForDetailPaneText,
    closeDetailPaneIfPresent,
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

  async function scrapeSingleRow(snapshot, index, total) {
    const row = findRowBySnapshot(snapshot);
    if (!row) {
      return { ok: false, reason: "row not found" };
    }

    highlightRow(row);
    await clickLikeUser(row);
    await sleep(CONFIG.settleAfterRowClickMs);

    const meta = `Scraper • row ${index + 1}/${total}`;

    if (findOpenDialog() && isAlertDialog()) {
      await acknowledgeAlertRowsIfPresent(meta);
      await closeAlertDialogIfPresent(meta);
      await sleep(500);
    }

    const detail = await waitForDetailPaneText();
    const paneText = detail || "";

    if (!paneText) {
      window.ArcusPanel?.pushLog("info", "No detail pane text captured", meta);
    }

    await closeDetailPaneIfPresent();

    return {
      ok: true,
      item: {
        index: index + 1,
        rowType: snapshot.rowType,
        summary: snapshot.text,
        detail: paneText,
      },
    };
  }

  async function runSharedScraper() {
    if (!window.ArcusShared.isWorkbenchPage()) {
      state.scraper.state = "error";
      state.scraper.reason = "Shared scraper works only on Arcus dispense workbench pharmacy routes.";
      syncScraperState();
      return;
    }

    if (state.isRunning || state.scraper.state === "running") {
      state.scraper.state = "error";
      state.scraper.reason = "Another workbench task is already running.";
      syncScraperState();
      return;
    }

    const snapshots = getRowSnapshots();
    if (!snapshots.length) {
      state.scraper.state = "error";
      state.scraper.reason = `No rows found for ${ORDER_FILTERS[state.settings.rowFilter]}.`;
      syncScraperState();
      window.ArcusPanel?.setStatus(`Scraper\nNo rows found.`);
      window.ArcusPanel?.pushLog("fail", "No rows found for scraper", "Scraper");
      return;
    }

    state.scraper.state = "running";
    state.scraper.data = [];
    state.scraper.reason = "";
    state.scraper.progressText = `0/${snapshots.length}`;
    syncScraperState();

    state.stopRequested = false;
    state.stats = { processed: 0, success: 0, fail: 0 };
    window.ArcusPanel?.renderStats();
    window.ArcusPanel?.renderScrapePreview([]);
    window.ArcusPanel?.updateButtonState();

    window.ArcusPanel?.setStatus(
      `Scraper\nFilter: ${ORDER_FILTERS[state.settings.rowFilter]}\nFound ${snapshots.length} rows`
    );
    window.ArcusPanel?.pushLog(
      "info",
      `Start Scraper with ${snapshots.length} rows`,
      `Scraper • ${ORDER_FILTERS[state.settings.rowFilter]}`
    );

    try {
      for (let i = 0; i < snapshots.length; i++) {
        if (state.stopRequested) {
          state.scraper.state = "stopped";
          state.scraper.reason = "Stopped by user.";
          syncScraperState();
          window.ArcusPanel?.pushLog("info", "Scraper stopped by user", "Scraper");
          window.ArcusPanel?.setStatus("Scraper\nStopped.");
          break;
        }

        const snapshot = snapshots[i];
        state.scraper.progressText = `${i + 1}/${snapshots.length}`;
        syncScraperState();

        window.ArcusPanel?.setStatus(
          `Scraper\n${ORDER_FILTERS[state.settings.rowFilter]}\nProcessing ${i + 1}/${snapshots.length}\n${snapshot.text}`
        );

        const result = await scrapeSingleRow(snapshot, i, snapshots.length);
        state.stats.processed += 1;

        if (result.ok) {
          state.stats.success += 1;
          state.scraper.data.push(result.item);
          window.ArcusPanel?.pushLog(
            "success",
            `[${snapshot.rowType}] ${window.ArcusShared.shortText(snapshot.text)}`,
            "Scraper • captured"
          );
          window.ArcusPanel?.renderScrapePreview(state.scraper.data);
        } else {
          state.stats.fail += 1;
          window.ArcusPanel?.pushLog(
            "fail",
            `[${snapshot.rowType}] ${window.ArcusShared.shortText(snapshot.text)}`,
            `Scraper • ${result.reason}`
          );
        }

        window.ArcusPanel?.renderStats();
        syncScraperState();
        await sleep(CONFIG.loopDelayMs);
      }

      if (state.scraper.state === "running") {
        state.scraper.state = "done";
        state.scraper.progressText = `${state.scraper.data.length}/${snapshots.length}`;
        syncScraperState();
        window.ArcusPanel?.setStatus(`Scraper\nCompleted. Captured ${state.scraper.data.length} rows.`);
        window.ArcusPanel?.pushLog(
          "info",
          `Scraper completed with ${state.scraper.data.length} items`,
          "Scraper"
        );
      }
    } catch (error) {
      state.scraper.state = "error";
      state.scraper.reason = error?.message || "Unknown scraper error";
      syncScraperState();
      window.ArcusPanel?.setStatus(`Scraper\nError: ${state.scraper.reason}`);
      window.ArcusPanel?.pushLog("fail", "Scraper error", state.scraper.reason);
    } finally {
      state.stopRequested = false;
      clearHighlight();
      window.ArcusPanel?.updateButtonState();
    }
  }

  window.ArcusScraper = {
    runSharedScraper,
  };
})();