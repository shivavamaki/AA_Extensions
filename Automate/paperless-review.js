"use strict";
(() => {
  const KEY = "paperless.review.sessions", PAGE_SIZE = 100;
  const $ = id => document.getElementById(id);
  const time = new Intl.DateTimeFormat(undefined, {dateStyle:"short", timeStyle:"medium"});
  const stamp = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? "—" : time.format(d); };
  const text = (id, value) => { $(id).textContent = value; };
  let sessions = [], live = null, source = new URLSearchParams(location.search).get("tab") || "";
  let sessionId = "", page = 0, loading = false, revision = 0;
  function options(id, rows, selected) {
    const node = $(id), signature = JSON.stringify(rows);
    if (node.dataset.options !== signature) {
      node.replaceChildren(...rows.map(([value, title]) => new Option(title, value)));
      node.dataset.options = signature;
    }
    node.value = selected;
  }
  function allSessions() {
    return live ? [live, ...sessions.filter(s => s.sessionId !== live.sessionId)] : sessions;
  }
  function currentSession() { return allSessions().find(s => s.sessionId === sessionId); }
  function eventKind(event) {
    if (event.kind) return "scan";
    return /reject|ignored|invalid|not verified|not clicked|cancelled|timed out|blocked/i.test(event.event || "") ? "attention" : "action";
  }
  function filteredEvents() {
    const query = $("search").value.trim().toLowerCase(), kind = $("kind").value;
    return [...(currentSession()?.events || [])].reverse().filter(e =>
      (!kind || eventKind(e) === kind) && (!query || [e.prescription,e.code,e.event,e.verification,e.kind].join(" ").toLowerCase().includes(query)));
  }
  function renderLogs() {
    const list = allSessions();
    if (!list.some(s => s.sessionId === sessionId)) { sessionId = live?.sessionId || list[0]?.sessionId || ""; page = 0; }
    options("session", list.length ? list.map(s => [s.sessionId, `${stamp(s.startedAt)} · Tab ${s.tabId ?? source} · ${s.active ? "Last seen active" : "Stopped"}`]) : [["", "No saved sessions"]], sessionId);
    const session = currentSession(), events = filteredEvents();
    const pages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    const fragment = document.createDocumentFragment();
    for (const event of events.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
      const row = document.createElement("tr");
      for (const value of [stamp(event.at), event.prescription || "—", event.kind || eventKind(event), event.code || "—", event.event || event.verification || "—"]) {
        const cell = document.createElement("td"); cell.textContent = value; row.append(cell);
      }
      fragment.append(row);
    }
    if (!events.length) {
      const row = document.createElement("tr"), cell = document.createElement("td");
      cell.colSpan = 5; cell.textContent = "No events match this selection."; row.append(cell); fragment.append(row);
    }
    $("logs").replaceChildren(fragment);
    text("session-info", session ? `Last snapshot: ${stamp(session.updatedAt)} · ${session.events.length} of ${session.eventCount ?? session.events.length} session events retained. Saved activity is not proof of a completed transaction.` : "Open the checker to begin recording a session.");
    text("count", `${events.length} matching events`); text("page", `${page + 1} / ${pages}`);
    $("previous").disabled = page === 0; $("next").disabled = page + 1 >= pages; $("export").disabled = !session;
  }
  function renderCurrent(connected, error = "") {
    text("connection", connected ? (live ? "Live checker" : "Checker inactive") : "Not connected");
    text("state", live ? (live.busy ? "Working" : "Open") : "Inactive");
    text("mode", live ? ({Ordered:"First check",Second:"Second check"}[live.mode] || "Waiting for mode selection") : "Choose Open Checker in the ArcusAir tab");
    text("prescription", live?.prescription || "—"); text("status", live?.status || "No current status");
    text("progress", live ? `${live.checked} / ${live.total}` : "—");
    text("current-message", live?.message || "No current check.");
    text("notice", error || live?.saveError || (live?.pendingFinal?.sent ? "Final Dispense click sent. Server completion is not verified." : ""));
    const medicines = (live?.medicines || []).map(m => {
      const node = document.createElement("span"); node.className = "medicine" + (m.checked ? " checked" : "");
      node.textContent = `${m.checked ? "✓ Checked" : "Pending"} · ${m.code}`; return node;
    });
    if (!medicines.length) { const node = document.createElement("p"); node.textContent = "No medicine rows captured."; medicines.push(node); }
    $("medicines").replaceChildren(...medicines); $("open-tab").disabled = !source;
  }
  async function refresh() {
    if (loading) return;
    loading = true;
    const version = revision;
    try {
      const [stored, tabs] = await Promise.all([chrome.storage.local.get(KEY), chrome.tabs.query({url:"https://arcusair.bdms.co.th/*"})]);
      if (version !== revision) return;
      sessions = stored[KEY] || [];
      if (!tabs.some(t => String(t.id) === source)) source = tabs.length ? String(tabs[0].id) : "";
      options("source", tabs.length ? tabs.map(t => [String(t.id), `Tab ${t.id} · ${t.title || "ArcusAir"}`]) : [["", "No ArcusAir tabs open"]], source);
      live = null;
      let connected = false, error = "";
      if (source) {
        try {
          const result = await chrome.scripting.executeScript({target:{tabId:Number(source)}, func:() => ({available:typeof window.ArcusPaperless?.snapshot === "function",snapshot:window.ArcusPaperless?.snapshot?.() || null})});
          if (version !== revision) return;
          connected = !!result[0]?.result?.available;
          live = result[0]?.result?.snapshot || null;
          if (live) live.tabId = Number(source);
          if (!connected) error = "Reload Arcus Toolkit and this ArcusAir tab to enable current data.";
        } catch (_) { error = "This tab is unavailable. Saved logs remain available below."; }
      }
      if (version !== revision) return;
      renderCurrent(connected, error); renderLogs(); text("updated", `Updated ${new Date().toLocaleTimeString()}`);
    } catch (error) { text("notice", `Review could not refresh: ${error.message}`); }
    finally { loading = false; if (version !== revision) refresh(); }
  }
  $("source").addEventListener("change", () => { source = $("source").value; sessionId = ""; live = null; revision++; refresh(); });
  $("refresh").addEventListener("click", refresh);
  $("auto").addEventListener("change", () => { if ($("auto").checked) refresh(); });
  $("session").addEventListener("change", () => { sessionId = $("session").value; page = 0; renderLogs(); });
  let searchTimer;
  $("search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => {page = 0; renderLogs();}, 120); });
  $("kind").addEventListener("change", () => {page = 0; renderLogs();});
  $("previous").addEventListener("click", () => {page--; renderLogs();});
  $("next").addEventListener("click", () => {page++; renderLogs();});
  $("open-tab").addEventListener("click", async () => {
    try { const tab = await chrome.tabs.update(Number(source), {active:true}); await chrome.windows.update(tab.windowId, {focused:true}); }
    catch (error) { text("notice", error.message); }
  });
  $("export").addEventListener("click", () => {
    const session = currentSession(); if (!session) return;
    const data = {feature:"paperless-checker-review",exportedAt:new Date().toISOString(),sessionId:session.sessionId,startedAt:session.startedAt,
      filter:{search:$("search").value,kind:$("kind").value},events:filteredEvents()};
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
    const link = document.createElement("a"); link.href = url; link.download = `paperless-review-${session.sessionId}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  });
  setInterval(() => {if ($("auto").checked && !document.hidden) refresh();},3000);
  document.addEventListener("visibilitychange", () => {if (!document.hidden && $("auto").checked) refresh();});
  refresh();
})();
