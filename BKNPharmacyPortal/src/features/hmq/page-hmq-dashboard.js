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

  /* "ตัวอย่าง มงคล, ภก." → "ตัวอย่าง มงคล" — drop ArcusAir's title suffix so
     the chip stays short. The full value remains in the log modal. */
  function shortUser(u) {
    const s = String(u || "").trim();
    if (!s || s === "Unknown") return "";
    return s.split(",")[0].trim() || s;
  }

  /* Latest audit-log line for the case, shown under the name so the board
     carries the current story at a glance instead of only behind the 🕒
     modal. Newest entry wins — auditLog is append-only, so that is the last
     element. The full history stays in the modal. */
  function _latestLogHtml(entry) {
    const log = Array.isArray(entry.auditLog) ? entry.auditLog : [];
    if (!log.length) return "";
    const last = log[log.length - 1] || {};
    const action = norm(last.action || "");
    if (!action) return "";
    const who = shortUser(last.user);
    const t   = String(last.ts || "").slice(11, 16);
    const meta = [t, who].filter(Boolean).join(" · ");
    return `<div class="hmqd-row-log" title="${escapeHtml(action)}">
      <span class="hmqd-log-text">${escapeHtml(action)}</span>
      ${meta ? `<span class="hmqd-log-when">${escapeHtml(meta)}</span>` : ""}
    </div>`;
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
    // Pharmacist working the case — On Process column only (mirrors the popup).
    const startedBy = escapeHtml(shortUser(entry.startedBy));
    const byHtml = (entry.status === "process" && startedBy)
      ? `<span class="hmqd-by" title="Started by">👤 ${startedBy}</span>`
      : "";
    return `<div class="hmqd-row" data-id="${escapeHtml(entry.id || "")}">
      <span class="hmqd-qnum">Q${entry.queueNum != null ? entry.queueNum : "?"}</span>
      ${roomBadge}
      <div class="hmqd-row-info">
        <div class="hmqd-row-name">${name}</div>
        ${_latestLogHtml(entry)}
        <div class="hmqd-row-meta">${ward || "&mdash;"}<span class="hmqd-hn">HN ${hn}</span>${byHtml}</div>
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

  /* ══ Statistics ═══════════════════════════════════════════════════════
     Every number here is derived from the three timestamps each case
     already carries — createdAt (queued), startedAt (pharmacist pressed
     Start), completedAt — so nothing new has to be stored server-side.

       wait    = startedAt   − createdAt   (queued, nobody working it)
       process = completedAt − startedAt   (being worked)
       total   = completedAt − createdAt

     Cases missing a timestamp are EXCLUDED from that metric rather than
     counted as zero: an unfinished case has no process time, and averaging
     it in as 0 would silently drag every average down. */
  const MIN = 60000;

  function _mins(a, b) {
    if (!a || !b) return null;
    const t0 = Date.parse(a), t1 = Date.parse(b);
    if (isNaN(t0) || isNaN(t1)) return null;
    const d = (t1 - t0) / MIN;
    return d >= 0 ? d : null;          // clock skew / reverted case
  }

  function _median(xs) {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  function fmtMins(v) {
    if (v == null) return "—";
    if (v < 1) return "<1m";
    if (v < 60) return `${Math.round(v)}m`;
    const h = Math.floor(v / 60), m = Math.round(v % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  /* Bangkok calendar day of a UTC timestamp — matches the server's own
     bucketing, so a case queued at 04:00 Bangkok lands on the right day. */
  function bkkDay(iso) {
    const t = Date.parse(iso);
    if (isNaN(t)) return "";
    return new Date(t + 7 * 3600 * 1000).toISOString().slice(0, 10);
  }
  function bkkHour(iso) {
    const t = Date.parse(iso);
    if (isNaN(t)) return null;
    return new Date(t + 7 * 3600 * 1000).getUTCHours();
  }

  function computeStats(entries) {
    const waits = [], procs = [], totals = [];
    const byDay = new Map(), byHour = new Array(24).fill(0);
    const byWard = new Map(), byPharm = new Map();
    let done = 0, active = 0, waiting = 0;

    for (const e of entries) {
      const day = bkkDay(e.createdAt);
      if (day) byDay.set(day, (byDay.get(day) || 0) + 1);
      const hr = bkkHour(e.createdAt);
      if (hr != null) byHour[hr]++;

      const ward = String(e.ward || "").trim() || "—";
      byWard.set(ward, (byWard.get(ward) || 0) + 1);

      if (e.status === "done") done++;
      else if (e.status === "process") active++;
      else waiting++;

      const w = _mins(e.createdAt, e.startedAt);
      const p = _mins(e.startedAt, e.completedAt);
      const t = _mins(e.createdAt, e.completedAt);
      if (w != null) waits.push(w);
      if (p != null) procs.push(p);
      if (t != null) totals.push(t);

      const who = shortUser(e.startedBy);
      if (who && p != null) {
        const cur = byPharm.get(who) || { n: 0, mins: 0 };
        cur.n++; cur.mins += p;
        byPharm.set(who, cur);
      }
    }

    const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    return {
      total: entries.length, done, active, waiting,
      medWait: _median(waits), medProc: _median(procs), medTotal: _median(totals),
      avgPerDay: days.length ? entries.length / days.length : 0,
      days,
      byHour,
      wards: [...byWard.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      pharmacists: [...byPharm.entries()]
        .map(([k, v]) => [k, v.n, v.mins / v.n])
        .sort((a, b) => b[1] - a[1]).slice(0, 8),
      waits, procs,
    };
  }

  /* ── Chart primitives ──────────────────────────────────────────────
     Hand-authored SVG: no library, no CDN (MV3 CSP blocks both). Marks
     are thin with 4px rounded data-ends anchored to the baseline; the
     grid is recessive; values are direct-labelled selectively, never on
     every mark. Series colours come from --c1/--c2 so both themes get
     their own validated step rather than an automatic flip. */
  function svgBars(rows, opts) {
    const o = Object.assign({ h: 150, pad: 26, label: v => v, unit: "" }, opts || {});
    if (!rows.length) return `<div class="hmqd-nodata">No data in this range.</div>`;
    const max = Math.max(...rows.map(r => r[1]), 1);
    const n = rows.length;
    const W = 640, H = o.h, bw = Math.max(3, Math.min(34, (W - o.pad) / n - 4));
    const step = (W - o.pad) / n;
    // Label every bar when they fit, otherwise thin them out — never a
    // number on every mark when they would collide.
    const every = n <= 12 ? 1 : Math.ceil(n / 12);
    const bars = rows.map((r, i) => {
      const bh = Math.max(2, (r[1] / max) * (H - 34));
      const x = o.pad + i * step + (step - bw) / 2;
      const y = H - 20 - bh;
      const lbl = (i % every === 0)
        ? `<text x="${x + bw / 2}" y="${H - 7}" class="hmqd-cx" text-anchor="middle">${escapeHtml(String(r[0]))}</text>`
        : "";
      const val = (i % every === 0 && r[1] > 0)
        ? `<text x="${x + bw / 2}" y="${y - 4}" class="hmqd-cv" text-anchor="middle">${o.label(r[1])}</text>`
        : "";
      return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="4" class="hmqd-bar">
                <title>${escapeHtml(String(r[0]))} · ${o.label(r[1])}${o.unit}</title></rect>${lbl}${val}`;
    }).join("");
    return `<svg viewBox="0 0 ${W} ${H}" class="hmqd-svg" role="img"
      aria-label="${escapeHtml(o.aria || "bar chart")}">
      <line x1="${o.pad}" y1="${H - 20}" x2="${W}" y2="${H - 20}" class="hmqd-axis"/>
      ${bars}</svg>`;
  }

  function svgHBars(rows, opts) {
    const o = Object.assign({ label: v => v, unit: "" }, opts || {});
    if (!rows.length) return `<div class="hmqd-nodata">No data in this range.</div>`;
    const max = Math.max(...rows.map(r => r[1]), 1);
    return `<div class="hmqd-hbars">` + rows.map(r => {
      const pct = (r[1] / max) * 100;
      return `<div class="hmqd-hb">
        <span class="hmqd-hb-lbl" title="${escapeHtml(String(r[0]))}">${escapeHtml(String(r[0]))}</span>
        <span class="hmqd-hb-track"><span class="hmqd-hb-fill" style="width:${pct}%"></span></span>
        <span class="hmqd-hb-val">${o.label(r[1])}${o.unit}</span>
      </div>`;
    }).join("") + `</div>`;
  }

  /* Wait vs process, stacked — the only place two series share a mark, so
     the only place a categorical palette is needed. Two series, both
     direct-labelled in the legend; a 2px surface gap separates the fills. */
  function svgStackedStage(wait, proc) {
    if (wait == null && proc == null) {
      return `<div class="hmqd-nodata">No completed cases in this range.</div>`;
    }
    const w = wait || 0, p = proc || 0, tot = w + p || 1;
    const W = 640, H = 62, x0 = 10, bw = W - 20;
    const ww = (w / tot) * bw, pw = Math.max(0, (p / tot) * bw - 2);
    return `<svg viewBox="0 0 ${W} ${H}" class="hmqd-svg" role="img"
      aria-label="Median time per stage: ${fmtMins(wait)} waiting, ${fmtMins(proc)} in process">
      <rect x="${x0}" y="14" width="${ww}" height="26" rx="4" class="hmqd-s1"><title>Waiting ${fmtMins(wait)}</title></rect>
      <rect x="${x0 + ww + 2}" y="14" width="${pw}" height="26" rx="4" class="hmqd-s2"><title>In process ${fmtMins(proc)}</title></rect>
      <text x="${x0}" y="56" class="hmqd-cx">Waiting ${fmtMins(wait)}</text>
      <text x="${W - 10}" y="56" class="hmqd-cx" text-anchor="end">In process ${fmtMins(proc)}</text>
    </svg>`;
  }

  function renderStats() {
    const el = document.getElementById("hmqd-stats");
    if (!el) return;
    const q = norm(document.getElementById("hmqd-search").value || "");
    const rows = _entries.filter(e => matchesSearch(e, q));
    if (!rows.length) {
      el.innerHTML = `<div class="hmqd-error">No cases in this range.</div>`;
      return;
    }
    const s = computeStats(rows);

    const tile = (v, lbl, sub) => `<div class="hmqd-tile">
      <div class="hmqd-tile-v">${v}</div>
      <div class="hmqd-tile-l">${lbl}</div>
      ${sub ? `<div class="hmqd-tile-s">${sub}</div>` : ""}</div>`;

    el.innerHTML = `
      <div class="hmqd-kpis">
        ${tile(s.total, "Cases", `${s.done} completed · ${s.active} on process · ${s.waiting} new`)}
        ${tile(s.avgPerDay.toFixed(1), "Cases / day", `over ${s.days.length} day${s.days.length === 1 ? "" : "s"}`)}
        ${tile(fmtMins(s.medWait), "Median wait", "queued → started")}
        ${tile(fmtMins(s.medProc), "Median process", "started → completed")}
      </div>

      <div class="hmqd-panel">
        <h3>Cases per day</h3>
        <p class="hmqd-sub">Queued per Bangkok calendar day.</p>
        ${svgBars(s.days.map(([d, n]) => [d.slice(5), n]), {
          aria: "Cases queued per day", h: 170,
        })}
      </div>

      <div class="hmqd-panel">
        <h3>Median time per stage</h3>
        <p class="hmqd-sub">Where a case's time actually goes — median of
          ${s.waits.length} waits and ${s.procs.length} processed cases.
          Median, not mean: one forgotten case left open overnight would
          otherwise dominate the average.</p>
        ${svgStackedStage(s.medWait, s.medProc)}
        <div class="hmqd-legend">
          <span><i class="hmqd-sw1"></i>Waiting (queued → started)</span>
          <span><i class="hmqd-sw2"></i>In process (started → completed)</span>
        </div>
      </div>

      <div class="hmqd-panel">
        <h3>When cases arrive</h3>
        <p class="hmqd-sub">Queued by hour of day — where the staffing pressure sits.</p>
        ${svgBars(s.byHour.map((n, h) => [String(h).padStart(2, "0"), n]), {
          aria: "Cases queued by hour of day", h: 150,
        })}
      </div>

      <div class="hmqd-grid2">
        <div class="hmqd-panel">
          <h3>Busiest wards</h3>
          <p class="hmqd-sub">Cases per ward, top 8.</p>
          ${svgHBars(s.wards, { unit: "" })}
        </div>
        <div class="hmqd-panel">
          <h3>Pharmacist workload</h3>
          <p class="hmqd-sub">Cases completed, with median process time each.</p>
          ${s.pharmacists.length
            ? svgHBars(s.pharmacists.map(p => [`${p[0]} · ${fmtMins(p[2])}`, p[1]]))
            : `<div class="hmqd-nodata">No completed cases with a recorded pharmacist.</div>`}
        </div>
      </div>

      <div class="hmqd-panel">
        <h3>Daily detail</h3>
        <div class="hmqd-scroll">
          <table class="hmqd-dtable">
            <thead><tr><th>Day</th><th>Cases</th><th>Completed</th><th>Median wait</th><th>Median process</th></tr></thead>
            <tbody>${s.days.map(([d]) => {
              const dr = rows.filter(e => bkkDay(e.createdAt) === d);
              const w = dr.map(e => _mins(e.createdAt, e.startedAt)).filter(v => v != null);
              const p = dr.map(e => _mins(e.startedAt, e.completedAt)).filter(v => v != null);
              return `<tr><td>${d}</td><td class="n">${dr.length}</td>
                <td class="n">${dr.filter(e => e.status === "done").length}</td>
                <td class="n">${fmtMins(_median(w))}</td>
                <td class="n">${fmtMins(_median(p))}</td></tr>`;
            }).reverse().join("")}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Load / refresh ───────────────────────────────────────────────────
  /* Only ever fetch the range the user is actually looking at.

     The page opens on TODAY and asks the server for today alone; the wider
     windows are fetched only when the pharmacist clicks "Last 7 days" /
     "Last 30 days" (or picks dates). Older days are never loaded speculatively
     — the archives are kept forever, so a default-wide query would grow
     unbounded.

     _lastKey additionally skips a re-fetch when the requested window has not
     changed (e.g. clicking "Today" while already on Today). The Refresh button
     passes force=true so an explicit refresh always re-queries. */
  let _lastKey = "";

  async function load(force) {
    const from = document.getElementById("hmqd-from").value;
    const to   = document.getElementById("hmqd-to").value;
    if (!from || !to) return;
    const key = `${from}|${to}`;
    if (!force && key === _lastKey) return;   // same window already on screen
    document.getElementById("hmqd-body").innerHTML = `<div class="hmqd-loading">Loading queue…</div>`;
    const r = await fetchQueue(from, to);
    if (!r.ok) { _lastKey = ""; showError(r.reason); return; }
    _lastKey = key;
    _entries = r.list;
    renderActive();
    document.getElementById("hmqd-updated").textContent = `Updated ${new Date().toLocaleTimeString("en-GB")}`;
  }

  function setRange(days) {
    const to = new Date();
    const from = days === 0 ? new Date(to) : new Date(to.getTime() - (days - 1) * 24 * 3600 * 1000);
    document.getElementById("hmqd-from").value = todayStr(from);
    document.getElementById("hmqd-to").value   = todayStr(to);
    document.querySelectorAll(".hmqd-quick-ranges .hmqd-btn").forEach((b) => b.classList.remove("active"));
  }

  /* Render whichever tab is showing. Both views read the same _entries, so
     switching tabs never re-queries the server. */
  let _tab = "board";
  function renderActive() {
    if (_tab === "stats") renderStats(); else renderBoard();
  }

  function switchTab(name) {
    _tab = name;
    document.querySelectorAll(".hmqd-tab").forEach(b => {
      const on = b.dataset.tab === name;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.getElementById("hmqd-body").hidden  = name !== "board";
    document.getElementById("hmqd-stats").hidden = name !== "stats";
    renderActive();
  }

  function wire() {
    document.querySelectorAll(".hmqd-tab").forEach(b =>
      b.addEventListener("click", () => switchTab(b.dataset.tab)));
    // Refresh forces a re-query even when the window is unchanged.
    document.getElementById("hmqd-refresh").addEventListener("click", () => load(true));
    document.getElementById("hmqd-search").addEventListener("input", renderActive);

    document.querySelectorAll(".hmqd-quick-ranges .hmqd-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const range = btn.dataset.range;
        setRange(range === "today" ? 0 : Number(range));
        btn.classList.add("active");
        load();
      });
    });

    // Wrap: a listener would otherwise pass the Event object as `force`.
    document.getElementById("hmqd-from").addEventListener("change", () => load());
    document.getElementById("hmqd-to").addEventListener("change", () => load());

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
