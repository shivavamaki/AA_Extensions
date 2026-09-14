(() => {
  if (window.ArcusPanelHost) return;
  const panels = new Map();
  // Retain the original DOM node: event listeners, selected wards, progress and
  // status survive Angular removing or replacing its content/body containers.
  function restore(id) {
    const entry = panels.get(id);
    if (!entry || !entry.isRunning()) return false;
    const panel = entry.panel;
    const root = document.documentElement;
    if (root && panel.parentNode !== root) root.appendChild(panel);
    panel.classList.remove("is-minimized", "is-idle");
    for (const [property, value] of Object.entries({
      display: "block", visibility: "visible", opacity: "1",
      "z-index": "2147483647", "max-height": "calc(100vh - 16px)", "overflow-y": "auto",
    })) {
      if (panel.style.getPropertyValue(property) !== value) panel.style.setProperty(property, value);
    }
    for (const button of panel.querySelectorAll('button[id$="-close"], button[id$="-minimize"]')) {
      button.disabled = true;
      if (button.id.endsWith("-minimize") && button.textContent === "+") button.textContent = "—";
    }
    const rect = panel.getBoundingClientRect();
    if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) {
      panel.style.left = "auto";
      panel.style.top = "8px";
      panel.style.right = "8px";
      panel.style.bottom = "auto";
      panel.style.maxWidth = "calc(100vw - 16px)";
    }
    entry.pinned = true;
    return true;
  }
  function refresh() {
    for (const [id, entry] of panels) {
      if (restore(id)) continue;
      if (!entry.pinned) continue;
      entry.pinned = false;
      for (const property of ["display", "visibility", "opacity", "z-index", "max-height", "overflow-y"]) {
        entry.panel.style.removeProperty(property);
      }
      for (const button of entry.panel.querySelectorAll('button[id$="-close"], button[id$="-minimize"]')) {
        button.disabled = false;
      }
    }
  }
  function register(panel, isRunning) {
    panels.set(panel.id, { panel, isRunning, pinned: false });
    panel.addEventListener("click", (event) => {
      if (isRunning() && event.target.closest('button[id$="-close"], button[id$="-minimize"]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
    refresh();
  }
  // Registered before module observers so detached running nodes are restored
  // before a module decides to build a replacement.
  new MutationObserver(refresh).observe(document, { childList: true, subtree: true });
  window.addEventListener("resize", refresh);
  // Also observe running-flag changes that do not cause DOM mutations.
  setInterval(refresh, 250);
  window.ArcusPanelHost = { register, restore, refresh };
})();

