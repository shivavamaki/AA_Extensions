"use strict";
// A4 preview: render-only clones; the real source retains all editing/data hooks.
document.addEventListener("DOMContentLoaded", () => {
  // Presentation settings only; patient loading uses the original controller.
  document.getElementById("compactMode").checked = true;
  document.getElementById("includeMealCard").checked = true;
  applyPrintSettings(currentPrintSettingsFromControls());
  const scaleControl = document.getElementById("a4PreviewScale");
  const source = document.querySelector(".sheet-wrap");
  source.classList.add("a4-source");
  const preview = document.createElement("div");
  preview.className = "a4-preview";
  document.body.append(preview);
  const banner = document.createElement("div");
  banner.className = "a4-banner";
  banner.textContent = "A4 portrait · Print preview";
  document.querySelector(".toolbar").prepend(banner);
  function clean(node) {
    const clone = node.cloneNode(true);
    for (const el of [clone, ...clone.querySelectorAll("*")]) {
      el.removeAttribute("id");
      el.removeAttribute("contenteditable");
    }
    clone.querySelectorAll(".no-print, .add-row, button").forEach(el => el.remove());
    // The action column is removed in the preview. Full-width source cells
    // must span the four remaining columns, otherwise HTML creates a ghost fifth column.
    for (const cell of clone.querySelectorAll('th[colspan="5"], td[colspan="5"]')) {
      cell.colSpan = 4;
    }
    // Screen-only control delegates to the original row handler (including save/re-render).
    if (node.matches("tr.med-row")) {
      const originalType = node.querySelector("select.continuity-select");
      const previewType = clone.querySelector("select.continuity-select");
      if (originalType && previewType) {
        previewType.value = originalType.value;
        previewType.addEventListener("change", () => {
          if (!node.isConnected) return;
          originalType.value = previewType.value;
          originalType.dispatchEvent(new Event("change", { bubbles: true }));
          rebuild();
        });
      }
      // Preserve the own-medicine badge as printable text, not a removed button.
      const ownBadge = node.querySelector(".pom-badge");
      if (ownBadge) {
        const badge = document.createElement("span");
        badge.className = "pom-badge";
        badge.textContent = ownBadge.textContent;
        clone.querySelector(".med-name")?.after(badge);
      }
      const originalContinue = node.querySelector(".row-cont");
      const continueCell = clone.querySelector(".col-no");
      if (originalContinue && continueCell) {
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "a4-continue-med";
        toggle.textContent = "🚨";
        toggle.title = originalContinue.title;
        toggle.setAttribute("aria-label", originalContinue.title);
        toggle.setAttribute("aria-pressed", String(originalContinue.classList.contains("active")));
        toggle.addEventListener("click", () => {
          if (!node.isConnected) return;
          originalContinue.click();
          rebuild();
        });
        continueCell.append(toggle);
      }
      const originalRemove = node.querySelector(".row-del");
      const numberCell = clone.querySelector(".col-no");
      if (originalRemove && numberCell) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "a4-remove-med";
        remove.textContent = "−";
        remove.title = "Remove this medicine / ลบรายการยา";
        remove.setAttribute("aria-label", `Remove ${node.querySelector(".med-name")?.textContent || "medicine"}`);
        remove.addEventListener("click", () => {
          if (!node.isConnected) return;
          originalRemove.click();
          rebuild();
        });
        numberCell.append(remove);
      }
    }
    // Continuation controls also live in the meal-card clone. Delegate their
    // edits to the source so existing persistence and calendar rebuilding apply.
    const originals = node.querySelectorAll(".mc-continue-date, .mc-continue-note, .mcc-tickbox");
    const copies = clone.querySelectorAll(".mc-continue-date, .mc-continue-note, .mcc-tickbox");
    copies.forEach((input, index) => {
      const original = originals[index];
      if (!original) return;
      input.value = original.value;
      input.checked = original.checked;
      input.addEventListener("change", () => {
        if (!original.isConnected) return;
        original.value = input.value;
        original.checked = input.checked;
        original.dispatchEvent(new Event(input.matches(".mc-continue-note") ? "input" : "change", { bubbles: true }));
        rebuild();
      });
    });
    return clone;
  }
  function fit() {
    const available = document.documentElement.clientWidth - (document.body.classList.contains("toolbar-collapsed") ? 28 : 252) - 280;
    const ratio = Math.min(1, Math.max(.25, available / (210 * 96 / 25.4)), Math.max(.25, (innerHeight - 55) / (297 * 96 / 25.4)));
    const selected = scaleControl?.value || "fit";
    preview.style.zoom = String(selected === "fit" ? ratio : Number(selected));
  }
  function rebuild() {
    clearTimeout(timer);
    const rebuildStarted = performance.now();
    const original = document.getElementById("medTable");
    if (!original) return;
    const savedScroll = {left:window.scrollX, top:window.scrollY};
    const active = preview.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active && {tag:active.tagName, classes:active.className, data:JSON.stringify(active.dataset), row:active.closest("tr.med-row")?.dataset.index};
    const previousMinHeight = preview.style.minHeight;
    preview.style.minHeight = `${preview.offsetHeight}px`;
    preview.replaceChildren();
    let content, table, body;
    let overflow = false;
    function newPage(repeatMedicineHeader = false) {
      const page = document.createElement("section");
      page.className = "a4-page";
      content = document.createElement("div");
      content.className = "a4-page-content";
      table = document.createElement("table");
      table.className = "a4-print-table";
      const cols = original.querySelector("colgroup");
      if (cols) table.append(clean(cols));
      if (original.tHead) table.append(clean(original.tHead));
      body = document.createElement("tbody");
      if (repeatMedicineHeader) {
        const columnHeader = original.querySelector(".col-head-row");
        if (columnHeader) body.append(clean(columnHeader));
      }
      table.append(body);
      content.append(table);
      page.append(content);
      preview.append(page);
    }
    function add(node) {
      body.append(node);
      if (content.scrollHeight <= content.clientHeight + 1) return;
      node.remove();

      // Split a meal schedule BEFORE moving to another page. Its complete
      // cards can fill the space left after medicines on any current page.
      const entries = Array.from(node.querySelectorAll(".mc-continue-item"));
      const slots = Array.from(node.querySelectorAll(".mc-grid > .mc-slot"));
      if (node.matches(".mc-info-row") && (entries.length || slots.length)) {
        const pieces = entries.map(entry => [entry]);
        for (let i = 0; i < slots.length; i += 2) pieces.push(slots.slice(i, i + 2));
        const info = node.querySelector(".mc-info");
        pieces.forEach((group, index) => {
          const row = document.createElement("tr");
          row.className = "a4-meal-piece";
          const cell = document.createElement("td");
          cell.colSpan = 4;
          // Keep the information banner with the first actual card.
          if (index === 0 && info) cell.append(info);
          const holder = document.createElement("div");
          holder.className = group[0].matches(".mc-slot") ? "mc-grid" : "mc-continue-host";
          group.forEach(item => holder.append(item));
          cell.append(holder);
          row.append(cell);
          add(row);
        });
        return;
      }

      // An individual card/medicine moves only when it cannot fit here.
      if (body.children.length) newPage(node.matches("tr.med-row"));
      body.append(node);
      if (content.scrollHeight > content.clientHeight + 1) {
        overflow = true;
        content.closest(".a4-page").classList.add("a4-flow-page");
      }
    }    newPage();
    for (const row of original.tBodies[0]?.rows || []) {
      if (!row.matches(".add-row") && !row.hidden && getComputedStyle(row).display !== "none") add(clean(row));
    }
    const mealBody = document.getElementById("mealcardTbody");
    if (mealBody) for (const row of mealBody.rows) add(clean(row));
    const count = preview.children.length;
    for (const [index, page] of Array.from(preview.children).entries()) {
      const footer = document.createElement("div");
      footer.className = "a4-page-footer";
      footer.textContent = `${document.getElementById("patientHN")?.textContent || ""} — Page ${index + 1} / ${count}`;
      page.append(footer);
    }
    preview.dataset.overflow = String(overflow);
    banner.firstChild.textContent = "A4 portrait · Print preview";
    fit();
    if (focusKey) {
      const replacement = Array.from(preview.querySelectorAll("input,select,button")).find(el =>
        el.tagName === focusKey.tag && el.className === focusKey.classes &&
        JSON.stringify(el.dataset) === focusKey.data &&
        el.closest("tr.med-row")?.dataset.index === focusKey.row);
      replacement?.focus({preventScroll:true});
    }
    preview.style.minHeight = previousMinHeight;
    window.scrollTo({...savedScroll, behavior:"instant"});
    const stats = window.__HM_A4_PERF__ || {rebuilds:0};
    window.__HM_A4_PERF__ = {rebuilds:stats.rebuilds+1, lastMs:Math.round(performance.now()-rebuildStarted), pages:preview.children.length};
  }
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, 180); };
  new MutationObserver(schedule).observe(source, { subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:["class","style","src","hidden","value","checked"] });
  source.addEventListener("load", schedule, true);
  document.querySelector(".toolbar").addEventListener("change", event => {
    if (event.target !== scaleControl) schedule();
  });
scaleControl?.addEventListener("change", fit);
  window.addEventListener("resize", fit);
  window.addEventListener("beforeprint", rebuild);
  document.fonts.ready.then(rebuild);
  rebuild();
});