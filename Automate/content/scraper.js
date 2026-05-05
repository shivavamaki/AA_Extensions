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

  // ── PDPA cleansing ────────────────────────────────────────────────────────
  // Patterns for identifiers that must be redacted under Thai PDPA
  const HN_RE        = /\b\d{2}-\d{2}-\d{6}\b/g;
  const ENC_RE       = /\b[IO]\d{2}-\d{2}-\d{6}\b/g;
  const ORDER_ID_RE  = /\b[OI]\d{10}\b/g;
  // DOB appears after MALE/FEMALE gender word in summary
  const DOB_GENDER_RE = /(MALE|FEMALE)\s+\d{2}-\d{2}-\d{4}/g;
  // Thai patient title + name words (Thai Unicode block ฀-๿)
  const THAI_NAME_RE = /(ด\.ช\.|ด\.ญ\.|นาย|นางสาว|น\.ส\.|นาง|นพ\.|พญ\.|ทพ\.|ทพญ\.|ภก\.|ภญ\.)\s*[฀-๿]+(?:\s+[฀-๿]+)*/g;
  // English patient title + UPPERCASE name (stops before MALE/FEMALE/digits)
  const ENG_NAME_RE  = /(MR\.|MRS\.|MISS|MS\.)\s+[A-Z][A-Z\s\-\.]+?(?=\s+(?:MALE|FEMALE|\d{2}-\d{2}))/g;

  function cleanseSummary(text) {
    if (!text) return text;
    return text
      .replace(THAI_NAME_RE, (_, title) => title + " [NAME]")
      .replace(ENG_NAME_RE,  (_, title) => title + " [NAME]")
      .replace(HN_RE,        "[HN]")
      .replace(ENC_RE,       "[ENC]")
      .replace(ORDER_ID_RE,  "[ORDER]")
      .replace(DOB_GENDER_RE, (_, gender) => gender + " [DOB]");
  }

  function cleanseDetail(text) {
    if (!text) return text;
    // Strip the personal header block ("Details …" up to the first vital sign "WT :").
    // This removes: name, HN, gender word, exact DOB, encounter ID, doctor name, payer info.
    let s = text.replace(/^Details[\s\S]*?(?=WT\s*:)/, "[PATIENT INFO REDACTED] ");
    // Redact any order/encounter IDs remaining in medication / Order Details section
    s = s.replace(ENC_RE, "[ENC]").replace(ORDER_ID_RE, "[ORDER]");
    return s;
  }

  function cleanseItem(item) {
    return {
      index:   item.index,
      rowType: item.rowType,
      summary: cleanseSummary(item.summary),
      detail:  cleanseDetail(item.detail),
    };
  }

  // ── Milestone save ────────────────────────────────────────────────────────
  function saveMilestone(data, label) {
    try {
      const toSave = state.scraper.pdpa ? data.map(cleanseItem) : data;
      const suffix = state.scraper.pdpa ? "_pdpa" : "";
      const json = JSON.stringify(toSave, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `arcus_scrape_${label}${suffix}_${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      panel().pushLog("info", `Saved ${toSave.length} rows (${label}${suffix})`, "Scraper • save");
    } catch (err) {
      panel().pushLog("fail", `Save failed: ${err?.message || "unknown"}`, "Scraper • save");
    }
  }

  // Helper: always route panel calls to the scraper-specific panel
  function panel() {
    return window.ArcusScraperPanel || {
      setStatus: () => {},
      pushLog:   () => {},
      renderStats: () => {},
      updateButtonState: () => {},
    };
  }

  // ── Row highlight ─────────────────────────────────────────────────────────
  function clearHighlight() {
    document.querySelectorAll(".arcus-row-highlight").forEach((el) =>
      el.classList.remove("arcus-row-highlight")
    );
  }

  function highlightRow(el) {
    clearHighlight();
    if (el) el.classList.add("arcus-row-highlight");
  }

  // ── Single-row scrape ─────────────────────────────────────────────────────
  async function scrapeSingleRow(snapshot, index, total) {
    const row = findRowBySnapshot(snapshot);
    if (!row) return { ok: false, reason: "row not found" };

    highlightRow(row);
    await clickLikeUser(row);
    await sleep(CONFIG.settleAfterRowClickMs);

    const meta = `Scraper • row ${index + 1}/${total}`;
    if (findOpenDialog() && isAlertDialog()) {
      await acknowledgeAlertRowsIfPresent(meta);
      await closeAlertDialogIfPresent(meta);
      await sleep(500);
    }

    const paneText = (await waitForDetailPaneText()) || "";
    if (!paneText) panel().pushLog("info", "No detail pane text captured", meta);

    await closeDetailPaneIfPresent();
    return {
      ok: true,
      item: { index: index + 1, rowType: snapshot.rowType, summary: snapshot.text, detail: paneText },
    };
  }

  // ── Main scraper loop ─────────────────────────────────────────────────────
  async function runSharedScraper({ pdpa = true } = {}) {
    if (!window.ArcusShared.isWorkbenchPage()) {
      state.scraper.state  = "error";
      state.scraper.reason = "Scraper works only on the Arcus dispense workbench route.";
      syncScraperState();
      panel().setStatus("Error: wrong page.");
      return;
    }

    if (state.isRunning || state.scraper.state === "running") {
      panel().setStatus("Another task is already running.");
      return;
    }

    let snapshots = getRowSnapshots();
    if (!snapshots.length) {
      state.scraper.state  = "error";
      state.scraper.reason = `No order rows found for ${ORDER_FILTERS[state.settings.rowFilter]}.`;
      syncScraperState();
      panel().setStatus(`No rows found.`);
      panel().pushLog("fail", "No order rows found", "Scraper");
      return;
    }

    // Initialise run
    state.scraper.pdpa         = pdpa;
    state.scraper.state        = "running";
    state.scraper.data         = [];
    state.scraper.reason       = "";
    state.scraper.progressText = `0/${snapshots.length}`;
    state.scraperStopRequested = false;
    state.stats = { processed: 0, success: 0, fail: 0 };
    syncScraperState();
    panel().renderStats();
    panel().updateButtonState();

    const pdpaNote = pdpa ? " • PDPA cleanse ON" : " • PDPA cleanse OFF";
    panel().setStatus(`Scraper started\nFilter: ${ORDER_FILTERS[state.settings.rowFilter]}${pdpaNote}\n${snapshots.length} rows visible`);
    panel().pushLog("info", `Start. ${snapshots.length} rows visible.${pdpaNote}`, "Scraper");

    const seenKeys = new Set();
    let processedIndex = 0;
    let emptyScrollAttempts = 0;

    try {
      while (!state.scraperStopRequested) {
        snapshots = getRowSnapshots();
        const nextSnapshot = snapshots.find((s) => !seenKeys.has(s.key || s.text));

        if (!nextSnapshot) {
          if (emptyScrollAttempts >= CONFIG.maxEmptyScrollAttempts) break;
          emptyScrollAttempts += 1;
          state.scraper.progressText = `${state.scraper.data.length} captured • loading more ${emptyScrollAttempts}/${CONFIG.maxEmptyScrollAttempts}`;
          syncScraperState();
          panel().setStatus(`Scraper\n${state.scraper.data.length} captured\nLooking for more… ${emptyScrollAttempts}/${CONFIG.maxEmptyScrollAttempts}`);
          await scrollMainContainerToLoadMore();
          await sleep(CONFIG.loopDelayMs);
          continue;
        }

        emptyScrollAttempts = 0;
        seenKeys.add(nextSnapshot.key || nextSnapshot.text);
        processedIndex += 1;
        state.scraper.progressText = `${processedIndex} processed • ${state.scraper.data.length} captured`;
        syncScraperState();
        panel().setStatus(`Scraper\n${ORDER_FILTERS[state.settings.rowFilter]}\nRow ${processedIndex}: ${window.ArcusShared.shortText(nextSnapshot.text, 80)}`);

        const result = await scrapeSingleRow(nextSnapshot, processedIndex - 1, processedIndex);
        state.stats.processed += 1;

        if (result.ok) {
          state.stats.success += 1;
          state.scraper.data.push(result.item);
          panel().pushLog("success", `[${nextSnapshot.rowType}] ${window.ArcusShared.shortText(nextSnapshot.text)}`, "Scraper");
          panel().renderStats();

          const every = CONFIG.milestoneSaveEvery || 50;
          if (state.scraper.data.length % every === 0) {
            saveMilestone(state.scraper.data, `milestone_${state.scraper.data.length}`);
          }
        } else {
          state.stats.fail += 1;
          panel().pushLog("fail", `[${nextSnapshot.rowType}] ${window.ArcusShared.shortText(nextSnapshot.text)}`, `Scraper • ${result.reason}`);
        }

        panel().renderStats();
        syncScraperState();
        await scrollMainContainerToLoadMore();
        await sleep(CONFIG.loopDelayMs);
      }

      // ── Normal end ────────────────────────────────────────────────────────
      if (state.scraperStopRequested) {
        state.scraper.state  = "stopped";
        state.scraper.reason = "Stopped by user.";
        syncScraperState();
        panel().pushLog("info", "Stopped by user", "Scraper");
        panel().setStatus(`Scraper stopped.\n${state.scraper.data.length} rows captured.`);
      } else {
        state.scraper.state        = "done";
        state.scraper.progressText = `${state.scraper.data.length} captured`;
        syncScraperState();
        panel().setStatus(`Scraper done.\n${state.scraper.data.length} rows captured.`);
        panel().pushLog("info", `Completed – ${state.scraper.data.length} items`, "Scraper");
      }

      // Final save (covers both stopped and done)
      if (state.scraper.data.length > 0) {
        const finalLabel = state.scraperStopRequested ? "stopped" : "final";
        saveMilestone(state.scraper.data, `${finalLabel}_${state.scraper.data.length}`);
      }

    } catch (error) {
      // ── Error: save immediately before anything else ───────────────────────
      if (state.scraper.data.length > 0) {
        saveMilestone(state.scraper.data, `error_${state.scraper.data.length}`);
      }
      state.scraper.state  = "error";
      state.scraper.reason = error?.message || "Unknown error";
      syncScraperState();
      panel().setStatus(`Scraper error:\n${state.scraper.reason}`);
      panel().pushLog("fail", state.scraper.reason, "Scraper • error");

    } finally {
      state.scraperStopRequested = false;
      clearHighlight();
      panel().updateButtonState();
    }
  }

  window.ArcusScraper = { runSharedScraper, saveMilestone, cleanseItem };
})();
