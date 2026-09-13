"use strict";
const viewport = document.querySelector(".viewport");
const pages = document.querySelector(".pages");
const zoom = document.querySelector("#zoom");
const contentSize = document.querySelector("#contentSize");
const [firstPage, secondPage] = pages.querySelectorAll(".page");
const labels = pages.querySelectorAll(".page-label");
const firstFooter = firstPage.querySelector(".footer");
const secondFooter = secondPage.querySelector(".footer");
const meal = document.createElement("section");
meal.className = "meal-section";
// Keep heading, information note and all meal cards together.
for (const element of Array.from(secondPage.children)) {
  if (!element.matches("header, .footer")) meal.append(element);
}
const extra = document.createElement("div");
extra.className = "demo-extra";
extra.textContent = "บันทึกเพิ่มเติม (ข้อมูลตัวอย่าง) / Additional notes — sample space to demonstrate a longer sheet.";
firstPage.insertBefore(extra, firstFooter);

function resize() {
  const scale = zoom.value === "fit"
    ? Math.min(1, (document.querySelector("main").clientWidth - 64) / pages.offsetWidth,
      (innerHeight - 120) / (297 * 96 / 25.4 + 30))
    : Number(zoom.value);
  const safe = Math.max(.2, scale);
  pages.style.transform = `scale(${safe})`;
  viewport.style.width = pages.offsetWidth * safe + "px";
  viewport.style.height = pages.offsetHeight * safe + "px";
}

function paginate() {
  extra.hidden = contentSize.value !== "long";
  // Measure unscaled layout coordinates, reserving footer space and an 8px gap.
  firstPage.insertBefore(meal, firstFooter);
  const fits = meal.offsetTop + meal.offsetHeight <= firstFooter.offsetTop - 8;
  if (!fits) secondPage.insertBefore(meal, secondFooter);
  secondPage.hidden = fits;
  labels[1].hidden = fits;
  const count = fits ? 1 : 2;
  labels[0].textContent = `Page 1 of ${count} · A4 portrait`;
  labels[1].textContent = `Page 2 of ${count} · A4 portrait`;
  firstFooter.lastElementChild.textContent = `Page 1 / ${count}`;
  secondFooter.lastElementChild.textContent = `Page 2 / ${count}`;
  document.querySelector(".top .sub").textContent = `A4 portrait · 8 mm margins · ${count} page${count > 1 ? "s" : ""}`;
  document.querySelector("#paginationStatus").textContent = fits
    ? "มีพื้นที่เพียงพอ: จัดตามมื้ออยู่หน้าเดียวกัน"
    : "พื้นที่ไม่พอ: ย้ายจัดตามมื้อทั้งหมดไปหน้าถัดไป";
  resize();
}
zoom.addEventListener("change", resize);
contentSize.addEventListener("change", paginate);
window.addEventListener("resize", resize);
window.addEventListener("beforeprint", paginate);
document.querySelector("#print").addEventListener("click", async () => {
  await document.fonts.ready;
  paginate();
  window.print();
});
function renderSavedPatient() {
  const data = window.demoPatientData;
  if (!data || !Array.isArray(data.meds)) throw new Error("Saved patient data unavailable");
  const set = (id, value) => { document.getElementById(id).textContent = value || "—"; };
  set("patientName", data.name);
  set("patientHN", data.hn);
  for (const id of ["patientAN", "patientRoom", "diagnosisValue", "allergyValue"]) set(id, "—");
  set("physicianNameTop", [...new Set(data.meds.map(m => m.provider).filter(Boolean))].join(", "));
  const stamp = new Date(data.savedAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" });
  set("dataSource", `Saved Home Medication sheet: ${stamp} (Bangkok). Missing fields shown as —.`);
  firstPage.querySelector("header > .sub").textContent = stamp;
  secondPage.querySelector("header .sub").textContent = `${data.name} · ${data.hn}`;
  for (const footer of [firstFooter, secondFooter]) footer.firstElementChild.textContent = `${data.name} · ${data.hn}`;
  const tbody = firstPage.querySelector("tbody");
  tbody.replaceChildren();
  for (const [i, med] of data.meds.entries()) {
    const row = tbody.insertRow();
    row.insertCell().textContent = i + 1;
    row.insertCell().textContent = med.drug;
    const cell = row.insertCell();
    const instruction = document.createElement("div");
    instruction.className = "instruction";
    instruction.textContent = med.instruction;
    cell.append(instruction);
    if (med.note) {
      const note = document.createElement("div");
      note.className = "note";
      note.textContent = med.note;
      cell.append(note);
    }
    row.insertCell().textContent = med.quantity || "—";
  }
  const checklist = document.querySelector(".checklist-body");
  checklist.replaceChildren();
  for (const title of ["รับยาปฏิชีวนะก่อนกลับบ้าน", "คืนยาเหลือแล้ว", "ไม่มียาเสพติดค้าง", "อธิบายยากลับบ้าน"]) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    label.append(input, document.createTextNode(title));
    checklist.append(label);
  }
  const status = document.createElement("small");
  status.textContent = "ยังไม่ได้โหลดสถานะ Checklist";
  checklist.append(status);
  meal.querySelector(".tip")?.remove();
  const cards = meal.querySelector(".cards");
  cards.replaceChildren();
  const items = data.meds.map(m => {
    // Preserve source wording, including English long-form volume units.
    const volume = m.instruction.match(/\d+(?:\.\d+)?\s*millilit(?:re|er)s?/i);
    return { drug: m.drug, text: m.instruction, dose: window.BKNMealSlots.doseSnippet(m.instruction) || volume?.[0] || "" };
  });
  const { buckets, unslotted } = window.BKNMealSlots.bucket(items);
  const groups = window.BKNMealSlots.MEAL_SLOTS.map(slot => ({ title: slot.th, key: slot.key, items: buckets[slot.key] }));
  groups.push({ title: "อื่นๆ / ตามแพทย์สั่ง", key: "prn", items: unslotted });
  for (const group of groups.filter(g => g.items.length)) {
    const card = document.createElement("div");
    card.className = `card ${group.key === "prn" ? "prn" : /adn|bed/.test(group.key) ? "evening" : ""}`;
    const title = document.createElement("h3");
    title.textContent = group.title;
    card.append(title);
    for (const item of group.items) {
      const line = document.createElement("div");
      line.className = "line";
      for (const value of [item.drug, item.dose]) {
        const span = document.createElement("span");
        span.textContent = value;
        line.append(span);
      }
      card.append(line);
    }
    cards.append(card);
  }
}
renderSavedPatient();
document.fonts.ready.then(paginate);
paginate();