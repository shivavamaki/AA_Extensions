"use strict";
// src/features/hmq/page-hmq-dashboard.js
// HM Process Queue Dashboard — full-page, read-only history view of the same
// data the Ward View floating popup (content-hmq.js) shows live. Opened from
// the extension popup (Ward & OPD section) via chrome.tabs.create.

(function () {
  const { norm, escapeHtml } = window.CoreDom;

  const COLUMNS = [
    { status: "new",     key: "new",  label: "🆕 New Case",       dateField: "createdAt" },
    { status: "process", key: "proc", label: "🔵 On Process",     dateField: "startedAt" },
    { status: "done",    key: "done", label: "✅ Completed",       dateField: "completedAt" },
  ];

  let _entries = [];

  function todayStr(d) {
    return (d || new Date()).toISOString().slice(0, 10);
  }

  function fmtDateTime(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    const date = d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "2-digit" });
    const time = iso.slice(11, 16);
    return { date, time };
  }

  // ── Data fetch ───────────────────────────────────────────────────────
  async function fetchQueue(from, to) {
    if (!window.BKNData) return { ok: false, reason: "Extension data bridge not available." };
    try {
      const r = await window.BKNData.serverFetch(`/api/hmq?from=${from}&to=${to}`);
      if (!r || !r.ok) return { ok: false, reason: "Could not reach the pharmacy server." };
      return { ok: true, list: Array.isArray(r.json) ? r.json : [] };
    } catch (e) {
      return { ok: false, reason: String(e) };
    }
  }

  function matchesSearch(entry, q) {
    if (!q) return true;
    // Search the FULL stored name (English + Thai) even though only the Thai
    // half is displayed, plus ward/room — so an English-name or bed search
    // still finds the case.
    const hay = `${entry.hn || ""} ${entry.name || ""} ${entry.ward || ""} ${entry.room || ""}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }

  // ── Rendering ────────────────────────────────────────────────────────
  /* Names are stored as "ENGLISH NAME - ชื่อไทย" (ArcusAir's banner format).
     Pharmacy staff read the Thai half, so show that and drop the English.
     Split on the LAST " - " because English names legitimately contain a
     hyphen (SAE-LEE, MACHA-ALE); only accept the tail if it really is Thai,
     so a purely English name (JOHN DANIEL MC CORD) is left intact. */
  const THAI_RE = /[฀-๿]/;
  function thaiName(full) {
    const s = String(full || "").trim();
    const i = s.lastIndexOf(" - ");
    if (i > 0) {
      const tail = s.slice(i + 3).trim();
      if (THAI_RE.test(tail)) return tail;
    }
    return s;
  }

  function rowHtml(entry, col) {
    const hn   = escapeHtml(entry.hn || "");
    const name = escapeHtml(thaiName(entry.name));
    const room = escapeHtml(String(entry.room || "").trim());
    const ward = escapeHtml(String(entry.ward || "").trim());
    const dt   = fmtDateTime(entry[col.dateField] || entry.createdAt);
    const dateHtml = dt === "—"
      ? "—"
      : `<b>${dt.time}</b>${dt.date}`;
    // Room/bed gets a standout badge next to the queue number (same treatment as
    // the floating Ward-View popup) — it is what staff scan the board for.
    const roomBadge = room
      ? `<span class="hmqd-room" title="Room / Bed">${room}</span>`
      : `<span class="hmqd-room hmqd-room-none" title="Room not detected">&mdash;</span>`;
    return `<div class="hmqd-row" data-id="${escapeHtml(entry.id || "")}">
      <span class="hmqd-qnum">Q${entry.queueNum != null ? entry.queueNum : "?"}</span>
      ${roomBadge}
      <div class="hmqd-row-info">
        <div class="hmqd-row-name">${name}</div>
        <div class="hmqd-row-meta">${ward || "&mdash;"}<span class="hmqd-hn">HN ${hn}</span></div>
      </div>
      <div class="hmqd-row-date">${dateHtml}</div>
      <button class="hmqd-log-btn" data-id="${escapeHtml(entry.id || "")}" title="View log">🕒</button>
    </div>`;
  }

  function renderBoard() {
    const body = document.getElementById("hmqd-body");
    const q = norm(document.getElementById("hmqd-search").value || "");
    const filtered = _entries.filter((e) => matchesSearch(e, q));

    document.getElementById("hmqd-total-badge").textContent = `${filtered.length} case${filtered.length === 1 ? "" : "s"}`;

    body.innerHTML = `<div class="hmqd-board">${COLUMNS.map((col) => {
      const rows = filtered
        .filter((e) => e.status === col.status)
        .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      return `<div class="hmqd-col">
        <div class="hmqd-col-hdr ${col.key}">
          <span>${col.label}</span>
          <span class="hmqd-col-count">${rows.length}</span>
        </div>
        <div class="hmqd-col-rows">
          ${rows.length ? rows.map((e) => rowHtml(e, col)).join("") : `<div class="hmqd-empty">— none —</div>`}
        </div>
      </div>`;
    }).join("")}</div>`;
  }

  function showError(reason) {
    document.getElementById("hmqd-body").innerHTML = `<div class="hmqd-error">⚠️ ${escapeHtml(reason)}</div>`;
    document.getElementById("hmqd-total-badge").textContent = "0 cases";
  }

  // ── Log modal ────────────────────────────────────────────────────────
  function showLog(id) {
    const entry = _entries.find((e) => e.id === id);
    if (!entry) return;
    // Modal shows the Thai name (matching the board) but keeps ward/bed and the
    // full stored name available — the audit view is where the English name is
    // still useful for cross-checking against ArcusAir.
    document.getElementById("hmqd-modal-title").textContent = thaiName(entry.name) || "Patient";
    const bed = [entry.ward, entry.room].filter(Boolean).join(" · ");
    document.getElementById("hmqd-modal-sub").textContent =
      `HN ${entry.hn || "—"} · Q${entry.queueNum != null ? entry.queueNum : "?"}`
      + (bed ? ` · ${bed}` : "");
    const logs = entry.auditLog || [];
    document.getElementById("hmqd-modal-body").innerHTML = logs.length
      ? logs.map((l) => {
          const dt = fmtDateTime(l.ts);
          const stamp = dt === "—" ? "—" : `${dt.date} ${dt.time}`;
          return `<div class="hmqd-log-entry">
            <span class="hmqd-log-time">${stamp}</span>
            <div class="hmqd-log-text">${escapeHtml(l.action || "")}<div class="hmqd-log-user">${escapeHtml(l.user || "")}</div></div>
          </div>`;
        }).join("")
      : `<div class="hmqd-log-entry"><span class="hmqd-log-text">No log entries.</span></div>`;
    document.getElementById("hmqd-modal-overlay").classList.add("open");
  }

  // ── Load / refresh ───────────────────────────────────────────────────
  async function load() {
    const from = document.getElementById("hmqd-from").value;
    const to   = document.getElementById("hmqd-to").value;
    if (!from || !to) return;
    document.getElementById("hmqd-body").innerHTML = `<div class="hmqd-loading">Loading queue…</div>`;
    const r = await fetchQueue(from, to);
    if (!r.ok) { showError(r.reason); return; }
    _entries = r.list;
    renderBoard();
    document.getElementById("hmqd-updated").textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
  }

  function setRange(days) {
    const to = new Date();
    const from = days === 0 ? new Date(to) : new Date(to.getTime() - (days - 1) * 24 * 3600 * 1000);
    document.getElementById("hmqd-from").value = todayStr(from);
    document.getElementById("hmqd-to").value   = todayStr(to);
    document.querySelectorAll(".hmqd-quick-ranges .hmqd-btn").forEach((b) => b.classList.remove("active"));
  }

  function wire() {
    document.getElementById("hmqd-refresh").addEventListener("click", load);
    document.getElementById("hmqd-search").addEventListener("input", renderBoard);

    document.querySelectorAll(".hmqd-quick-ranges .hmqd-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const range = btn.dataset.range;
        setRange(range === "today" ? 0 : Number(range));
        btn.classList.add("active");
        load();
      });
    });

    document.getElementById("hmqd-from").addEventListener("change", load);
    document.getElementById("hmqd-to").addEventListener("change", load);

    document.getElementById("hmqd-body").addEventListener("click", (e) => {
      const btn = e.target.closest(".hmqd-log-btn");
      if (btn) showLog(btn.dataset.id);
    });

    document.getElementById("hmqd-modal-close").addEventListener("click", () => {
      document.getElementById("hmqd-modal-overlay").classList.remove("open");
    });
    document.getElementById("hmqd-modal-overlay").addEventListener("click", (e) => {
      if (e.target.id === "hmqd-modal-overlay") e.currentTarget.classList.remove("open");
    });
  }

  wire();
  setRange(0);
  document.querySelector('.hmqd-quick-ranges .hmqd-btn[data-range="today"]')?.classList.add("active");
  load();
})();
