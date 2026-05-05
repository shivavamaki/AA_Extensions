(() => {
  if (window.__ARCUS_BOOT_LOADED__) return;
  window.__ARCUS_BOOT_LOADED__ = true;

  const {
    state,
    isWorkbenchPage,
    restorePanelDismissed,
    getPanelDismissed,
    setPanelDismissed,
    syncScraperState,
  } = window.ArcusShared;

  function wirePanelButtons() {
    document.querySelector("#arcus-btn-allocate")?.addEventListener("click", () => {
      setPanelDismissed(false);
      window.ArcusAutomation?.runAutomation({
        functionName: "Auto Allocate",
        mode: "allocate",
      });
    });

    document.querySelector("#arcus-btn-dispense")?.addEventListener("click", () => {
      setPanelDismissed(false);
      window.ArcusAutomation?.runAutomation({
        functionName: "Auto Dispensed",
        mode: "dispense",
      });
    });

    document.querySelector("#arcus-btn-stop")?.addEventListener("click", () => {
      state.stopRequested = true;
      window.ArcusPanel?.setStatus("Stopping...");
      window.ArcusPanel?.pushLog("info", "Stop requested by user");
    });
  }

  function createPanelIfNeeded() {
    if (!isWorkbenchPage()) {
      window.ArcusPanel?.removePanel();
      return;
    }

    if (getPanelDismissed()) {
      return;
    }

    const existed = !!document.querySelector("#arcus-auto-panel");
    window.ArcusPanel?.createPanel();

    if (!existed && document.querySelector("#arcus-auto-panel")) {
      wirePanelButtons();
      window.ArcusPanel?.renderStats();
      window.ArcusPanel?.renderLog();
      window.ArcusPanel?.renderScrapePreview([]);
      window.ArcusPanel?.updateButtonState();
    }
  }

  function forceShowPanel() {
    setPanelDismissed(false);
    createPanelIfNeeded();
  }

  window.addEventListener("arcus-toolkit:start-scrape", () => {
    setPanelDismissed(false);
    createPanelIfNeeded();
    window.ArcusScraper?.runSharedScraper();
  });

  window.addEventListener("arcus-toolkit:stop", () => {
    state.stopRequested = true;
    if (state.scraper.state === "running") {
      state.scraper.state = "stopped";
      state.scraper.reason = "Stopped by external request.";
      syncScraperState();
    }
    window.ArcusPanel?.setStatus("Stopping...");
    window.ArcusPanel?.pushLog("info", "Stop requested by popup");
  });

  window.addEventListener("arcus-toolkit:remove-panel", () => {
    setPanelDismissed(true);
    window.ArcusPanel?.removePanel();
  });

  window.addEventListener("arcus-toolkit:show-panel", () => {
    forceShowPanel();
  });

  restorePanelDismissed(() => {
    createPanelIfNeeded();
  });

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        if (!isWorkbenchPage()) {
          window.ArcusPanel?.removePanel();
          return;
        }
        createPanelIfNeeded();
      }, 700);
    } else if (isWorkbenchPage() && !document.querySelector("#arcus-auto-panel")) {
      createPanelIfNeeded();
    } else if (!isWorkbenchPage() && document.querySelector("#arcus-auto-panel")) {
      window.ArcusPanel?.removePanel();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  window.addEventListener("hashchange", () => {
    setTimeout(() => {
      if (!isWorkbenchPage()) {
        window.ArcusPanel?.removePanel();
        return;
      }
      createPanelIfNeeded();
    }, 700);
  });
})();