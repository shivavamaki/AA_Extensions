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
    scrollMainContainerToLoadMore,
    clickLikeUser,
    findOpenDialog,
    isAlertDialog,
    acknowledgeAlertRowsIfPresent,
    closeAlertDialogIfPresent,
    waitForDetailPaneText,
    closeDetailPaneIfPresent,
    sleep,
  } = window.ArcusShared;

  function saveMilestone(data, label) {
    try {
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `arcus_scrape_${label}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      window.ArcusPanel?.pushLog("info", `Milestone saved: ${data.length} rows (${label})`, "Scraper • milestone");
    } catch (err) {
      window.ArcusPanel?.pushLog("fail", `Milestone save failed: ${err?.message || "unknown"}`, "Scraper • milestone");
    }
  }

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

    let snapshots = getRowSnapshots();
    if (!snapshots.length) {
      state.scraper.state = "error";
      state.scraper.reason = `No real order rows found for ${ORDER_FILTERS[state.settings.rowFilter]}.`;
      syncScraperState();
      window.ArcusPanel?.setStatus(`Scraper\nNo real order rows found.`);
      window.ArcusPanel?.pushLog("fail", "No real order rows found for scraper", "Scraper");
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

    const seenKeys = new Set();
    let processedIndex = 0;
    let emptyScrollAttempts = 0;

    window.ArcusPanel?.setStatus(
      `Scraper\nFilter: ${ORDER_FILTERS[state.settings.rowFilter]}\nVisible rows ${snapshots.length}\nMouse-wheel lazy-load mode enabled`
    );
    window.ArcusPanel?.pushLog(
      "info",
      `Start Scraper. Initial visible rows: ${snapshots.length}. Mouse-wheel scroll enabled.`,
      `Scraper • ${ORDER_FILTERS[state.settings.rowFilter]}`
    );

    try {
      while (!state.stopRequested) {
        snapshots = getRowSnapshots();
        const nextSnapshot = snapshots.find((snapshot) => !seenKeys.has(snapshot.key || snapshot.text));

        if (!nextSnapshot) {
          if (emptyScrollAttempts >= CONFIG.maxEmptyScrollAttempts) {
            break;
          }

          emptyScrollAttempts += 1;
          state.scraper.progressText = `${state.scraper.data.length} captured • loading more ${emptyScrollAttempts}/${CONFIG.maxEmptyScrollAttempts}`;
          syncScraperState();
          window.ArcusPanel?.setStatus(
            `Scraper\nCaptured ${state.scraper.data.length} row(s).\nLooking for more rows... ${emptyScrollAttempts}/${CONFIG.maxEmptyScrollAttempts}`
          );

          const moved = await scrollMainContainerToLoadMore();
          await sleep(CONFIG.loopDelayMs);

          if (!moved) {
            window.ArcusPanel?.pushLog("info", "No scroll movement detected; rescanning visible rows", "Scraper");
          }
          continue;
        }

        emptyScrollAttempts = 0;
        const key = nextSnapshot.key || nextSnapshot.text;
        seenKeys.add(key);
        processedIndex += 1;

        state.scraper.progressText = `${processedIndex} processed • ${state.scraper.data.length} captured`;
        syncScraperState();

        window.ArcusPanel?.setStatus(
          `Scraper\n${ORDER_FILTERS[state.settings.rowFilter]}\nProcessing ${processedIndex}\n${nextSnapshot.text}`
        );

        const result = await scrapeSingleRow(nextSnapshot, processedIndex - 1, processedIndex);
        state.stats.processed += 1;

        if (result.ok) {
          state.stats.success += 1;
          state.scraper.data.push(result.item);
          window.ArcusPanel?.pushLog(
            "success",
            `[${nextSnapshot.rowType}] ${window.ArcusShared.shortText(nextSnapshot.text)}`,
            "Scraper • captured"
          );
          window.ArcusPanel?.renderScrapePreview(state.scraper.data);

          const every = CONFIG.milestoneSaveEvery || 50;
          if (state.scraper.data.length % every === 0) {
            saveMilestone(state.scraper.data, `milestone_${state.scraper.data.length}`);
          }
        } else {
          state.stats.fail += 1;
          window.ArcusPanel?.pushLog(
            "fail",
            `[${nextSnapshot.rowType}] ${window.ArcusShared.shortText(nextSnapshot.text)}`,
            `Scraper • ${result.reason}`
          );
        }

        window.ArcusPanel?.renderStats();
        syncScraperState();

        // Arcus lazy-load needs real mouse-wheel style scroll in some pages.
        // Scroll after each row, then rescan visible rows.
        await scrollMainContainerToLoadMore();
        await sleep(CONFIG.loopDelayMs);
      }

      if (state.stopRequested) {
        state.scraper.state = "stopped";
        state.scraper.reason = "Stopped by user.";
        syncScraperState();
        window.ArcusPanel?.pushLog("info", "Scraper stopped by user", "Scraper");
        window.ArcusPanel?.setStatus("Scraper\nStopped.");
        if (state.scraper.data.length > 0) {
          saveMilestone(state.scraper.data, `stopped_${state.scraper.data.length}`);
        }
      } else if (state.scraper.state === "running") {
        state.scraper.state = "done";
        state.scraper.progressText = `${state.scraper.data.length} captured`;
        syncScraperState();
        window.ArcusPanel?.setStatus(`Scraper\nCompleted. Captured ${state.scraper.data.length} rows.`);
        window.ArcusPanel?.pushLog(
          "info",
          `Scraper completed with ${state.scraper.data.length} items`,
          "Scraper"
        );
        if (state.scraper.data.length > 0) {
          saveMilestone(state.scraper.data, `final_${state.scraper.data.length}`);
        }
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