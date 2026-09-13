"use strict";
// TEST preview: render-only clones; the real source retains all editing/data hooks.
document.addEventListener("DOMContentLoaded", () => {
  const marginControl = document.getElementById("printMargin");
  if (marginControl) { marginControl.value = "8"; marginControl.disabled = true; }
  const scaleControl = document.getElementById("previewScale");
  if (scaleControl) {
    scaleControl.replaceChildren(new Option("Fit A4 page (TEST)", "1"));
    scaleControl.disabled = true;
  }
  const source = document.querySelector(".sheet-wrap");
  source.classList.add("test-source");
  const preview = document.createElement("div");
  preview.className = "test-preview";
  document.body.append(preview);
  const banner = document.createElement("div");
  banner.className = "test-banner";
  banner.textContent = "TEST · A4 portrait preview. Edits are temporary; saved medication data is unchanged.";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "Edit sheet";
  banner.append(toggle);
  document.querySelector(".toolbar").prepend(banner);
  toggle.addEventListener("click", () => {
    const editing = document.body.classList.toggle("test-editing");
    toggle.textContent = editing ? "Show A4 preview" : "Edit sheet";
    if (!editing) rebuild();
  });
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
    return clone;
  }
  function fit() {
    const available = document.documentElement.clientWidth - (document.body.classList.contains("toolbar-collapsed") ? 28 : 252) - 280;
    const ratio = Math.min(1, Math.max(.25, available / (210 * 96 / 25.4)), Math.max(.25, (innerHeight - 55) / (297 * 96 / 25.4)));
    preview.style.zoom = String(ratio);
  }
  function rebuild() {
    const original = document.getElementById("medTable");
    if (!original) return;
    preview.replaceChildren();
    let content, table, body;
    let overflow = false;
    function newPage() {
      const page = document.createElement("section");
      page.className = "test-page";
      content = document.createElement("div");
      content.className = "test-page-content";
      table = document.createElement("table");
      table.className = "test-print-table";
      const cols = original.querySelector("colgroup");
      if (cols) table.append(clean(cols));
      if (original.tHead) table.append(clean(original.tHead));
      body = document.createElement("tbody");
      table.append(body);
      content.append(table);
      page.append(content);
      preview.append(page);
    }
    function add(node) {
      body.append(node);
      if (content.scrollHeight > content.clientHeight + 1) {
        node.remove();
        if (body.children.length) newPage();
        body.append(node);
        if (content.scrollHeight > content.clientHeight + 1) overflow = true;
      }
    }
    newPage();
    for (const row of original.tBodies[0]?.rows || []) {
      if (!row.matches(".add-row") && !row.hidden && getComputedStyle(row).display !== "none") add(clean(row));
    }
    const mealBody = document.getElementById("mealcardTbody");
    if (mealBody) for (const row of mealBody.rows) add(clean(row));
    const count = preview.children.length;
    for (const [index, page] of Array.from(preview.children).entries()) {
      const footer = document.createElement("div");
      footer.className = "test-page-footer";
      footer.textContent = `TEST · ${document.getElementById("patientHN")?.textContent || ""} — Page ${index + 1} / ${count}`;
      page.append(footer);
    }
    preview.dataset.overflow = String(overflow);
    banner.firstChild.textContent = overflow
      ? "TEST · A section exceeds one A4 page. Reduce font/picture size before printing. "
      : "TEST · A4 portrait · Temporary edits only. ";
    fit();
  }
  let timer;
  const schedule = () => { clearTimeout(timer); timer = setTimeout(rebuild, 180); };
  new MutationObserver(schedule).observe(source, { subtree:true, childList:true, characterData:true, attributes:true });
  source.addEventListener("load", schedule, true);
  document.querySelector(".toolbar").addEventListener("change", schedule);
  window.addEventListener("resize", fit);
  window.addEventListener("beforeprint", rebuild);
  document.fonts.ready.then(rebuild);
  rebuild();
});