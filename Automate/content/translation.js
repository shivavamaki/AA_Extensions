"use strict";

(() => {
  if (window.__ARCUS_TRANSLATION_LOADED__) return;
  window.__ARCUS_TRANSLATION_LOADED__ = true;

  // ── HIS Translations scraper ────────────────────────────────────────────
  //
  // Walks the Order Management > Translation list and captures each row's full
  // detail, including the per-language translated texts that only exist on the
  // CRUD page.
  //
  // Flow per row:
  //   list → Modify → /translation/crud → scrape → Cancel → confirm Yes →
  //   back to list → Search (refresh) → next row
  //
  // Unlike Frequency Master (which reuses one dialog), Translation navigates to
  // a separate route and the return trip re-runs the search. That re-renders the
  // table, so element references do not survive a round trip: every row is
  // re-found by its {code, name} key on each iteration.

  const LIST_HASH = "!/ordermanagement/translation";
  const CRUD_HASH = "!/ordermanagement/translation/crud";
  const PANEL_STATE_KEY = "arcusTranslationPanelState";
  const MODE_KEY = "arcusTranslationMode";
  const PANEL_DISMISSED_KEY = "arcusTranslationPanelDismissed";

  const SELECTORS = {
    searchBtn: "#translationFormSearch",
    modifyBtnPrefix: "button[id^='translationFormModify']",
    type: "#translationtype",
    referenceInput: "#selectedReference input[type='search']",
    code: "#code",
    name: "#name",
    description: "#description",
    activeFrom: "md-date-selector#activefrom input",
    activeTo: "md-date-selector#activeto input",
    cancelBtn: "#orderresultitemFormCancel",
    saveBtn: "#orderresultitemFormSave",
  };

  // The list page is backed by this endpoint. It returns every field the CRUD
  // page shows (type, activefrom/activeto, description) for all translation
  // types, so API mode needs no per-row navigation at all.
  const API = {
    searchPath: "/ordermanagement/sigcode/search",
    collection: "sigcode",
    // `all`/`includeall` came from a captured *filtered* search and restrict the
    // result set — with them false the endpoint returned only 163 of several
    // hundred records (3 ROUTE, 4 FREQUENCY, vs. the dozens visible in the UI).
    // Request everything, including inactive entries.
    payload: { code: "", name: "", all: true, includeall: true },
    // Per-record detail. The search endpoint omits translatedtexts, so the
    // local-language values (Thai) only come from here, one GET per record.
    detailPath: "/ordermanagement/translation/getdetail/",
    // Concurrent detail requests. Enough to be quick over ~200 records without
    // hammering a production server.
    detailConcurrency: 6,
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const Driver = window.ArcusDriver;
  const Api = window.ArcusApi;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const state = {
    running: false,
    stopRequested: false,
    dismissed: false,
    dismissedExplicit: false,
    rows: [],
    logItems: [],
    mode: "api",   // "api" = direct endpoint (fast); "dom" = UI walk (fallback)
  };

  window.ArcusStore = window.ArcusStore || {};
  window.ArcusStore.translation = { state, SELECTORS, version: "4.3.0" };

  // ── Page predicates ──────────────────────────────────────────────────────

  function isCrudPage() {
    return location.href.includes(CRUD_HASH);
  }

  // The CRUD route contains the list route as a prefix, so the list check has to
  // exclude it explicitly.
  function isListPage() {
    return location.href.includes(LIST_HASH) && !isCrudPage();
  }

  function isTranslationPage() {
    return location.href.includes(LIST_HASH);
  }

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function textOf(el) {
    return ((el && (el.innerText || el.textContent)) || "").replace(/\s+/g, " ").trim();
  }

  // ── Driver-backed primitives ─────────────────────────────────────────────

  async function waitFor(fn, timeoutMs = 12000, _intervalMs = 250) {
    return Driver.waitFor(fn, timeoutMs, { shouldAbort: () => state.stopRequested });
  }

  async function clickLikeUser(el) {
    if (!el) return false;
    const result = await Driver.click(el);
    return !!result.ok;
  }

  async function clickAndSettle(el, maxMs = 12000) {
    if (!el) return false;
    const result = await Driver.clickAndSettle(el, { timeoutMs: maxMs });
    return !!result.ok;
  }

  async function settle(maxMs = 4000) {
    const result = await Driver.waitForSettle({ timeoutMs: maxMs });
    return !!result.ok;
  }

  /**
   * Click a button that lives inside an $mdDialog.
   *
   * Do NOT try to $eval the ng-click expression here. The confirm dialog's
   * button carries ng-click="dialog.hide()", but $mdDialog binds `dialog` to
   * its own controller — not to the scope reachable via angular.element(el).
   * Evaluating it there resolves `dialog` to undefined, so $eval succeeds
   * silently, nothing happens, and the dialog stays open forever.
   *
   * A real DOM click is what actually drives it. We dispatch the full mouse
   * sequence because md-dialog's button wiring can ignore a bare .click().
   */
  function dialogClick(el) {
    if (!el) return false;
    try {
      el.focus();
    } catch (_) {}
    for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    if (typeof el.click === "function") {
      try { el.click(); } catch (_) {}
    }
    return true;
  }

  // Buttons that dismiss a dialog affirmatively. Order matters: the confirm
  // class is the reliable $mdDialog marker, text is the fallback for alerts
  // that Arcus renders without it.
  const DISMISS_TEXT = /^(yes|ok|okay|confirm|close|accept|continue)$/i;

  /**
   * Locate the affirmative dismiss button within a dialog.
   *
   * Deliberately never returns .md-cancel-button — on the close confirm that is
   * "No", which would cancel the close and leave us stuck on the CRUD page.
   */
  function findDismissButton(dialog) {
    if (!dialog) return null;

    const confirm =
      dialog.querySelector("md-dialog-actions .md-confirm-button") ||
      dialog.querySelector(".md-confirm-button");
    if (confirm && isVisible(confirm)) return confirm;

    const buttons = Array.from(dialog.querySelectorAll("md-dialog-actions button, button"))
      .filter((button) => isVisible(button) && !button.classList.contains("md-cancel-button"));

    return buttons.find((button) => DISMISS_TEXT.test(textOf(button)))
      // A single-button alert is unambiguous whatever its label.
      || (buttons.length === 1 ? buttons[0] : null);
  }

  // Retained under the old name for the close-confirm call sites.
  function findConfirmButton(dialog) {
    return findDismissButton(dialog);
  }

  // ── List table ───────────────────────────────────────────────────────────

  function getDataRows() {
    return Array.from(document.querySelectorAll("table.md-table tbody tr, tbody tr"))
      .filter((row) => row.querySelector(SELECTORS.modifyBtnPrefix))
      .filter((row, index, rows) => rows.indexOf(row) === index);
  }

  function readTableRow(row) {
    const cells = Array.from(row.querySelectorAll("td[md-cell], td"));
    return {
      code: textOf(cells[0]),
      name: textOf(cells[1]),
      description: textOf(cells[2]),
    };
  }

  function getRowKey(rowData) {
    return `${rowData.code || ""}::${rowData.name || ""}`;
  }

  function findRowByKey(key) {
    for (const row of getDataRows()) {
      if (getRowKey(readTableRow(row)) === key) return row;
    }
    return null;
  }

  // ── Navigation ───────────────────────────────────────────────────────────

  async function ensureListPage() {
    if (isCrudPage()) {
      // Left over from an aborted run: close it before touching the list.
      await cancelCrud();
    }
    if (!isListPage()) {
      location.hash = LIST_HASH;
      const ok = await waitFor(() => isListPage(), 15000, 200);
      if (!ok) throw new Error("Cannot navigate to Translation page");
      await settle(3000);
    }
  }

  async function clickSearch() {
    // Search is also blocked by any open alert; drain first.
    if (getOpenDialogs().length) await closeAllDialogs();

    // The Search button only exists on the list route. If a previous row left
    // us on /crud, waiting for the button here would burn the full timeout and
    // then fail with a misleading "not found" — get back to the list first.
    if (!isListPage()) {
      pushLog("info", "Not on list route before Search; navigating back");
      const back = await forceBackToList();
      if (!back) throw new Error("Cannot reach Translation list to search");
    }

    const searchBtn = await waitFor(() => {
      if (!isListPage()) return null;
      const el = document.querySelector(SELECTORS.searchBtn);
      return el && isVisible(el) && !el.disabled ? el : null;
    }, 15000);

    if (!searchBtn) {
      // One more forced reload of the route before giving up: the list can be
      // slow to re-render right after a navigation.
      await forceBackToList();
      const retry = await waitFor(() => {
        const el = document.querySelector(SELECTORS.searchBtn);
        return el && isVisible(el) && !el.disabled ? el : null;
      }, 10000);
      if (!retry) throw new Error("#translationFormSearch not found");
      await clickAndSettle(retry, 20000);
      const retryRows = await waitFor(
        () => (getDataRows().length ? getDataRows() : null),
        20000,
        300
      );
      if (!retryRows) throw new Error("Translation table did not render rows");
      return retryRows;
    }

    // The table is the point of this click: wait for its fetch, then for rows.
    await clickAndSettle(searchBtn, 20000);
    const rows = await waitFor(
      () => (getDataRows().length ? getDataRows() : null),
      20000,
      300
    );
    if (!rows) throw new Error("Translation table did not render rows");
    return rows;
  }

  // ── CRUD page readers ────────────────────────────────────────────────────

  function readInputValue(selector, root = document) {
    const el = root.querySelector(selector);
    return el ? String(el.value || "").trim() : "";
  }

  /** The md-select renders its chosen label into md-select-value. */
  function readType() {
    const el = document.querySelector(SELECTORS.type);
    if (!el) return "";
    const label = el.querySelector("md-select-value .md-text");
    if (label) return textOf(label);
    return textOf(el.querySelector("md-select-value"));
  }

  /**
   * Reference Type is an md-autocomplete. Its resolved value lives in the
   * element's title attribute; the visible input only holds the search text,
   * which can be blank even when a value is selected.
   */
  function readReference() {
    const wrap = document.querySelector("#selectedReference");
    if (!wrap) return "";
    const title = (wrap.getAttribute("title") || "").trim();
    if (title) return title;
    return readInputValue(SELECTORS.referenceInput);
  }

  /**
   * The translated texts are an ng-repeat over vm.translation.translatedtexts.
   * Each entry pairs a language autocomplete (title = language name) with a
   * description input (#desc0, #desc1, ...).
   */
  function readTranslatedTexts() {
    const out = [];
    const inputs = Array.from(document.querySelectorAll("input[id^='desc']"))
      .filter((el) => /^desc\d+$/.test(el.id));

    for (const input of inputs) {
      const index = input.id.replace("desc", "");
      const auto = document.querySelector(`#sellanguage${index}`);
      const language =
        (auto && (auto.getAttribute("title") || "").trim()) ||
        (auto ? readInputValue("input[type='search']", auto) : "");
      const text = String(input.value || "").trim();
      if (!language && !text) continue;
      out.push({ language, text });
    }
    return out;
  }

  function scrapeCrudPage() {
    return {
      type: readType(),
      reference: readReference(),
      code: readInputValue(SELECTORS.code),
      name: readInputValue(SELECTORS.name),
      description: readInputValue(SELECTORS.description),
      activeFrom: readInputValue(SELECTORS.activeFrom),
      activeTo: readInputValue(SELECTORS.activeTo),
      translations: readTranslatedTexts(),
    };
  }

  /** Wait until the CRUD form has actually populated with this row's data. */
  async function waitForCrudLoaded(rowData) {
    const wantCode = (rowData.code || "").trim();
    const wantName = (rowData.name || "").trim();

    const ready = await waitFor(() => {
      if (!isCrudPage()) return null;
      const code = readInputValue(SELECTORS.code);
      const name = readInputValue(SELECTORS.name);
      if (!code && !name) return null;
      // Accept when either identifier matches; some rows key on name only.
      if ((wantCode && code === wantCode) || (wantName && name === wantName)) return true;
      return null;
    }, 15000, 150);

    return !!ready;
  }

  // ── Confirm dialog ───────────────────────────────────────────────────────

  /**
   * Every dialog currently on screen, topmost LAST.
   *
   * Arcus can stack several alerts at once (a save warning behind the close
   * confirm, for instance). Angular Material appends each new md-dialog after
   * the previous one, so document order is stacking order: the last entry is
   * the one actually on top and the only one that will accept input.
   */
  function getOpenDialogs() {
    return Array.from(document.querySelectorAll("md-dialog, [role='dialog']"))
      .filter((dialog) => isVisible(dialog));
  }

  /** The dialog on top of the stack, which is the only clickable one. */
  function getTopDialog() {
    const dialogs = getOpenDialogs();
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
  }

  /**
   * The topmost dialog, but only when it is a confirm/alert we know how to
   * dismiss. Kept for callers that specifically wait on the close confirm.
   */
  function getConfirmDialog() {
    const top = getTopDialog();
    if (!top) return null;
    return findDismissButton(top) ? top : null;
  }

  /**
   * Cancel out of the CRUD page: click Cancel, confirm "Yes", and wait for the
   * router to land back on the list.
   */
  /**
   * Dismiss the "Do you want to close this screen" confirm.
   *
   * The click is retried and verified rather than fired once and assumed: an
   * md-dialog that is still animating in can swallow the first click, which
   * previously left the dialog open and stalled the whole run.
   */
  function pressEscape() {
    for (const target of [document, document.body]) {
      if (!target) continue;
      target.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true,
      }));
    }
  }

  /**
   * Close every open dialog, not just one.
   *
   * Arcus can raise several alerts at once, and Angular Material only delivers
   * input to the topmost. So this works down the stack from the top, and after
   * each dismissal re-reads the DOM rather than trusting a cached list — closing
   * one dialog can reveal, or even spawn, another.
   *
   * Budgeted by total passes so a dialog that re-opens itself cannot spin here
   * forever; callers fall back to forced navigation if it gives up.
   */
  async function closeAllDialogs(maxPasses = 8) {
    let lastSignature = null;
    let stuckPasses = 0;

    for (let pass = 0; pass < maxPasses; pass++) {
      const dialogs = getOpenDialogs();
      if (!dialogs.length) return true;

      // Detect a dialog that will not respond, so we stop early instead of
      // burning the whole budget on it.
      const signature = dialogs.length + "::" + shortLabel(dialogs[dialogs.length - 1]);
      if (signature === lastSignature) {
        stuckPasses += 1;
        if (stuckPasses >= 3) {
          pushLog("info", `Dialog will not close: ${signature}`);
          return false;
        }
      } else {
        stuckPasses = 0;
        lastSignature = signature;
      }

      // Topmost first — the covered ones cannot receive the click anyway.
      const top = dialogs[dialogs.length - 1];
      const btn = findDismissButton(top);

      if (btn) {
        dialogClick(btn);
      } else {
        pressEscape();
      }

      // Wait for THIS dialog to go, or for the stack depth to drop.
      const before = dialogs.length;
      await waitFor(() => {
        const now = getOpenDialogs();
        if (!now.length) return true;
        return now.length < before || !now.includes(top) ? true : null;
      }, 2500, 100);
    }

    return getOpenDialogs().length === 0;
  }

  /** Short human-readable tag for a dialog, used for logging and stuck-detection. */
  function shortLabel(dialog) {
    if (!dialog) return "";
    const title = dialog.querySelector(".md-title, h2");
    const body = dialog.querySelector(".md-dialog-content-body, md-dialog-content");
    return (textOf(title) || textOf(body) || "dialog").slice(0, 60);
  }

  /**
   * Dismiss the "Do you want to close this screen" confirm, plus any other
   * dialogs stacked with it.
   */
  async function confirmCloseDialog() {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (!getOpenDialogs().length) return true;
      if (await closeAllDialogs()) return true;
      pushLog("info", `Dialogs still open, retry ${attempt}`);
      await sleep(300);
    }
    return getOpenDialogs().length === 0;
  }

  /**
   * Get back to the list, escalating until it works.
   *
   * Setting location.hash is not enough on its own: the CRUD controller guards
   * $locationChangeStart, so it can cancel the route change and re-raise the
   * close confirm. That produced the observed loop — "forcing navigation",
   * dialog returns, still not on the list. Each round therefore clears the
   * dialogs, navigates, and then re-checks; a full reload is the final answer
   * because it cannot be vetoed by any in-page guard.
   */
  async function forceBackToList() {
    for (let round = 1; round <= 3; round++) {
      // Clear anything blocking, including a confirm the guard just re-raised.
      if (getOpenDialogs().length) {
        await closeAllDialogs(4);
        if (getOpenDialogs().length) {
          pressEscape();
          await waitFor(() => (getOpenDialogs().length ? null : true), 1500, 120);
        }
      }

      // Only treat this as recovered when the list is reachable AND nothing is
      // still covering it — a surviving modal would swallow the next click.
      if (isListPage() && !getOpenDialogs().length) {
        await settle(3000);
        return true;
      }

      location.hash = LIST_HASH;

      // The route guard may re-raise a confirm; accept either outcome and let
      // the next round deal with whatever is on screen.
      const settled = await waitFor(
        () => (isListPage() ? "list" : (getOpenDialogs().length ? "dialog" : null)),
        4000,
        120
      );

      if (settled === "list" && !getOpenDialogs().length) {
        await settle(3000);
        return true;
      }
    }

    // Nothing in-page worked. A reload cannot be vetoed by a route guard, but it
    // also destroys this script's state — so bank the results first, then stop.
    // Silently reloading mid-run would discard every row scraped so far.
    pushLog("fail", "Stuck on CRUD page; saving results and stopping");
    if (state.rows.length) {
      const saved = await exportRows("stuck-on-crud");
      if (saved) pushLog("success", `Saved ${state.rows.length} rows to ${saved}`);
    }
    setStatus(
      `Stuck on the CRUD page and could not return to the list.
` +
      `${state.rows.length} rows saved. Reload the page, then press Start to continue.`
    );
    state.stopRequested = true;
    return false;
  }

  async function cancelCrud() {
    if (!isCrudPage()) {
      // A confirm dialog can outlive the route change; never leave one open.
      if (getOpenDialogs().length) await confirmCloseDialog();
      return true;
    }

    const cancelBtn = await waitFor(() => {
      const el = document.querySelector(SELECTORS.cancelBtn);
      return el && isVisible(el) ? el : null;
    }, 10000);

    if (!cancelBtn) return forceBackToList();

    await clickLikeUser(cancelBtn);

    // The confirm may take a moment to appear; if it never does, the app may
    // have closed the screen outright, which the isListPage check below covers.
    const dialog = await waitFor(() => (getOpenDialogs().length ? true : null), 5000, 120);
    if (dialog) await confirmCloseDialog();

    const back = await waitFor(() => isListPage(), 15000, 200);
    if (back) {
      await settle(3000);
      return true;
    }

    // Still stuck: force the route rather than aborting the run.
    pushLog("info", "Cancel did not return to list; forcing navigation");
    const forced = await forceBackToList();
    if (!forced) throw new Error("Did not return to Translation list after Cancel");
    return true;
  }

  // ── Per-row scrape ───────────────────────────────────────────────────────

  async function scrapeOne(rowData, index) {
    const key = getRowKey(rowData);
    const row = findRowByKey(key);
    if (!row) throw new Error(`Row disappeared: ${rowData.code || rowData.name}`);

    const btn = row.querySelector(SELECTORS.modifyBtnPrefix);
    if (!btn) throw new Error(`Modify button not found: ${rowData.code || rowData.name}`);

    // An alert left over from the previous row would sit above the table and
    // swallow this click, so clear the stack before opening the row.
    if (getOpenDialogs().length) {
      pushLog("info", "Clearing dialog(s) before opening row");
      await closeAllDialogs();
    }

    setStatus(`Opening ${index + 1}: ${rowData.code || rowData.name}`);
    await clickAndSettle(btn, 15000);

    const routed = await waitFor(() => isCrudPage(), 15000, 200);
    if (!routed) throw new Error(`CRUD page did not open for ${rowData.code || rowData.name}`);

    const loaded = await waitForCrudLoaded(rowData);
    if (!loaded) {
      await cancelCrud();
      throw new Error(`CRUD form did not load for ${rowData.code || rowData.name}`);
    }

    const detail = scrapeCrudPage();

    // Never carry a previous row forward: the scraped record must identify as
    // the row we clicked on at least one of code/name.
    const dc = (detail.code || "").trim();
    const dn = (detail.name || "").trim();
    const rc = (rowData.code || "").trim();
    const rn = (rowData.name || "").trim();
    if (rc && dc && dc !== rc && rn && dn && dn !== rn) {
      await cancelCrud();
      throw new Error(`CRUD mismatch for ${rc || rn} (got ${dc || dn})`);
    }

    await cancelCrud();

    // Fold the translated texts into a language-keyed map for easy lookup,
    // while keeping the ordered list for anything with duplicate languages.
    const lang = {};
    for (const entry of detail.translations) {
      if (entry.language && entry.text && !lang[entry.language]) {
        lang[entry.language] = entry.text;
      }
    }

    return {
      code: dc || rc,
      name: dn || rn,
      description: detail.description || rowData.description || "",
      type: detail.type,
      reference: detail.reference,
      activeFrom: detail.activeFrom,
      activeTo: detail.activeTo,
      lang,
      translations: detail.translations,
      scrapedAt: new Date().toISOString(),
    };
  }

  // ── Lazy-loaded table ────────────────────────────────────────────────────

  function getTableContainer() {
    const table = document.querySelector("table.md-table");
    if (table) {
      let el = table.parentElement;
      for (let depth = 0; depth < 6 && el; depth++) {
        if (el.scrollHeight > el.clientHeight + 10) return el;
        el = el.parentElement;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  function hasMoreDataHint() {
    return Array.from(document.querySelectorAll("div, span"))
      .some((el) => isVisible(el) && /scroll to load more data/i.test(textOf(el)));
  }

  async function scrollToLoadMore() {
    const container = getTableContainer();
    if (!container) return false;

    const beforeRows = getDataRows().length;
    const beforeHeight = container.scrollHeight;
    const beforeTop = container.scrollTop;

    for (let i = 0; i < 5; i++) {
      await Driver.scroll(container, 700);
      await sleep(150);
    }
    // Give the lazy loader its fetch, bounded rather than a flat wait.
    await settle(2500);

    return getDataRows().length > beforeRows
      || container.scrollHeight !== beforeHeight
      || container.scrollTop !== beforeTop;
  }

  // ── Export ───────────────────────────────────────────────────────────────

  /**
   * True only when the extension messaging channel is actually usable.
   *
   * Reloading the extension while this page stays open invalidates the context:
   * `chrome.runtime` becomes undefined, so even reading `.sendMessage` throws.
   * Accessing `chrome.runtime.id` is the cheap way to detect that.
   */
  function isExtensionContextAlive() {
    try {
      return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  /**
   * Save via a Blob + anchor, entirely inside the page.
   *
   * The fallback for a dead extension context. A scrape can take many minutes,
   * so losing the results to a background-channel failure at the final step is
   * the worst possible outcome — this path needs no extension APIs at all.
   */
  function downloadInPage(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 30000);
    return filename;
  }

  async function downloadJson(data) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `his-translations-${stamp}.json`;

    if (isExtensionContextAlive()) {
      const response = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: "downloadJson", filename, data }, (resp) => {
            // A dropped channel surfaces here rather than as a throw.
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(resp || { ok: false, error: "No response from extension background" });
          });
        } catch (err) {
          resolve({ ok: false, error: err.message });
        }
      });

      if (response.ok) return filename;
      pushLog("info", `Background download failed (${response.error}); saving from page`);
    } else {
      pushLog("info", "Extension context invalidated; saving from page");
    }

    return downloadInPage(filename, data);
  }

  /**
   * Persist whatever has been scraped so far.
   * Called from the run's finally block so a crash mid-run still yields data.
   */
  async function exportRows(reason) {
    if (!state.rows.length) return null;
    const payload = {
      source: "Arcus HIS Translations",
      url: location.href,
      scrapedAt: new Date().toISOString(),
      count: state.rows.length,
      mode: state.mode,
      reason,
      rows: state.rows,
    };
    try {
      return await downloadJson(payload);
    } catch (err) {
      // Last resort: never lose the data to a download problem.
      try {
        console.log("[Translation] export payload:", payload);
        return downloadInPage(`his-translations-recovered.json`, payload);
      } catch (_) {
        return null;
      }
    }
  }

  // ── Main loop ────────────────────────────────────────────────────────────

  /**
   * Map an API record onto the same shape the DOM scraper produces, so both
   * modes export an identical file.
   *
   * The API has no per-language translated texts (those live on a different
   * endpoint), so `lang` stays empty here and `translations` is absent rather
   * than falsely empty — consumers can tell the two modes apart by `mode`.
   */
  function mapApiRow(record) {
    const toDate = (value) => {
      if (!value) return "";
      // Arcus renders dates as DD-MM-YYYY in the UI; match that.
      const d = new Date(value);
      if (isNaN(d.getTime())) return String(value);
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
    };

    return {
      code: String(record.code || "").trim(),
      name: String(record.name || "").trim(),
      description: String(record.description || "").trim(),
      type: String(record.type || "").trim(),
      activeFrom: toDate(record.activefrom),
      activeTo: toDate(record.activeto),
      statusFlag: record.statusflag || "",
      id: record._id || "",
      scrapedAt: new Date().toISOString(),
    };
  }

  /**
   * Fold a detail response's translatedtexts into a language-keyed map.
   *
   * Shape from the API:
   *   translatedtexts: [{ reflanguid: { valuedescription: "Thai" },
   *                       localtext: "เข้าทางปาก" }]
   */
  function readDetailTranslations(detail) {
    const list = Array.isArray(detail && detail.translatedtexts)
      ? detail.translatedtexts
      : [];

    const translations = [];
    const lang = {};

    for (const entry of list) {
      const language = String(
        (entry && entry.reflanguid && entry.reflanguid.valuedescription) || ""
      ).trim();
      const text = String((entry && entry.localtext) || "").trim();
      if (!language && !text) continue;
      translations.push({ language, text });
      if (language && text && !lang[language]) lang[language] = text;
    }

    return { translations, lang };
  }

  /**
   * Fetch each record's detail and merge in the local-language texts.
   *
   * Runs a small pool of concurrent requests rather than one at a time: with
   * ~200 records, sequential GETs would take minutes. Failures are recorded on
   * the row and never abort the batch — a partial enrichment is still useful.
   */
  async function enrichWithDetails(rows) {
    if (!rows.length) return { enriched: 0, failed: 0 };

    const concurrency = Math.max(1, API.detailConcurrency);
    let next = 0;
    let enriched = 0;
    let failed = 0;

    async function worker() {
      while (true) {
        if (state.stopRequested) return;
        const index = next++;
        if (index >= rows.length) return;

        const row = rows[index];
        if (!row.id) {
          row.lang = {};
          row.translations = [];
          continue;
        }

        const result = await Api.get(API.detailPath + encodeURIComponent(row.id));

        if (!result.ok) {
          row.lang = {};
          row.translations = [];
          row.detailError = result.error || `HTTP ${result.status}`;
          failed += 1;
        } else {
          const detail = (result.data && result.data.translation) || null;

          // A 200 with no translation object means the id does not belong to
          // this collection. Record it: silently writing an empty lang{} made a
          // whole-batch mismatch look like a successful run.
          if (!detail) {
            row.lang = {};
            row.translations = [];
            row.detailError = "200 but no translation object (wrong id/collection?)";
            failed += 1;
            continue;
          }

          const { translations, lang } = readDetailTranslations(detail);
          row.translations = translations;
          row.lang = lang;
          // The detail record is authoritative for these; the search payload
          // can be stale for recently edited entries.
          if (detail.locallangdesc) row.localLangDesc = String(detail.locallangdesc).trim();
          if (detail.reftypeuid) row.refTypeUid = detail.reftypeuid;
          enriched += 1;
        }

        const done = enriched + failed;
        if (done % 5 === 0 || done === rows.length) {
          setStatus(`Fetching details ${done}/${rows.length}...`);
          setProgress(done, rows.length);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, rows.length) }, () => worker())
    );

    return { enriched, failed };
  }

  /**
   * Provoke a real API call so the page hook can capture auth headers.
   * Used only when nothing has been captured yet.
   */
  async function triggerAuthCapture() {
    if (!isListPage()) await forceBackToList();
    const btn = document.querySelector(SELECTORS.searchBtn);
    if (btn && isVisible(btn) && !btn.disabled) {
      pushLog("info", "Pressing Search once to capture API credentials");
      await clickAndSettle(btn, 15000);
    }
  }

  /**
   * Pull every translation straight from the API.
   *
   * This replaces the whole Modify -> scrape -> Cancel -> Search walk: no
   * routing, no dialogs, no stale-row risk, and it returns the fields that
   * previously required opening each record.
   */
  async function runApiScrape() {
    if (!Api) throw new Error("API client not loaded");

    setStatus("Capturing API credentials...");
    const auth = await Api.ensureAuth(triggerAuthCapture, 20000);
    if (!auth.ok) throw new Error(auth.error || "no API credentials");
    pushLog("success", `API credentials ready (${auth.source})`);

    setStatus("Fetching translations from API...");
    const result = await Api.fetchAllPages(API.searchPath, {
      collection: API.collection,
      payload: API.payload,
      shouldStop: () => state.stopRequested,
      onPage: ({ page, total }) => {
        setStatus(`Fetching page ${page}... ${total} records`);
        setProgress(total, total);
      },
    });

    // Keep partial data: a failure on page 9 must not discard pages 1-8.
    state.rows = result.rows.map(mapApiRow);
    setProgress(state.rows.length, state.rows.length);

    if (!result.ok) {
      pushLog("fail", `API stopped after ${result.pages} page(s): ${result.error}`);
      if (!state.rows.length) throw new Error(result.error || "API request failed");
      pushLog("info", `Keeping ${state.rows.length} records fetched before the error`);
    } else {
      pushLog("success", `Fetched ${state.rows.length} records over ${result.pages} page(s)`);
    }

    // Sanity-check the harvest against what the page itself shows. The search
    // flags (all/includeall) change how much the endpoint returns, and getting
    // them wrong silently yields a partial export rather than an error.
    const byType = {};
    state.rows.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + 1; });
    pushLog("info", `Types: ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(", ")}`);

    const visibleRows = getDataRows().length;
    if (visibleRows > state.rows.length) {
      pushLog(
        "fail",
        `Only ${state.rows.length} records fetched but the page lists at least ` +
        `${visibleRows}. The export is incomplete.`
      );
    }

    // Second pass: the search endpoint has no translatedtexts, so the Thai
    // values need one detail GET per record.
    if (!state.stopRequested && state.rows.length) {
      setStatus(`Fetching per-record details for ${state.rows.length} records...`);
      const detail = await enrichWithDetails(state.rows);
      const withThai = state.rows.filter((r) => r.lang && Object.keys(r.lang).length).length;
      pushLog(
        detail.failed ? "info" : "success",
        `Details: ${detail.enriched} ok, ${detail.failed} failed, ${withThai} with local text`
      );

      // Enrichment that "succeeds" for everything yet yields no local text at
      // all means the detail endpoint did not recognise these ids.
      if (state.rows.length && withThai === 0) {
        pushLog(
          "fail",
          `No local-language text on any of ${state.rows.length} records. The ids from ` +
          `${API.searchPath} are probably not valid for ${API.detailPath} ` +
          `(different collection).`
        );
        setStatus(
          "Warning: no Thai text found. The search and detail endpoints may not match." +
          "\nSee the log."
        );
      }
    }
  }

  async function runScraper() {
    if (state.running) return;
    state.running = true;
    state.stopRequested = false;
    state.rows = [];
    updateButtons();
    setProgress(0, 0);
    pushLog("info", "Scrape started");

    const seen = new Set();
    let idleScrolls = 0;
    let exported = false;

    try {
      if (state.mode === "api") {
        try {
          await runApiScrape();
        } catch (err) {
          // The endpoint or its auth may change; the DOM walk still works.
          pushLog("fail", `API mode failed: ${err.message || err}`);
          pushLog("info", "Falling back to DOM scraping");
          setStatus("API unavailable, using DOM mode...");
          state.rows = [];
          await runDomScrape(seen);
        }
      } else {
        await runDomScrape(seen);
      }

      exported = true;
      const verb = state.stopRequested ? "Stopped" : "Completed";
      const filename = await exportRows(verb.toLowerCase());
      if (filename) {
        setStatus(`${verb}. Downloaded ${state.rows.length} rows to ${filename}`);
        pushLog("success", `Downloaded ${filename}`);
      } else {
        setStatus(`${verb}. No rows scraped.`);
      }
    } catch (err) {
      setStatus(`Failed: ${err.message || err}`);
      pushLog("fail", err.message || String(err));
    } finally {
      // Export from here too: a mid-run crash must never discard rows that took
      // minutes to collect. `exported` guards against saving the file twice.
      if (!exported && state.rows.length) {
        const filename = await exportRows("aborted");
        if (filename) {
          pushLog("success", `Partial results saved to ${filename}`);
          setStatus(`Saved ${state.rows.length} partial rows to ${filename}`);
        }
      }
      state.running = false;
      state.stopRequested = false;
      updateButtons();
    }
  }

  /** The original per-row UI walk, kept as the fallback path. */
  async function runDomScrape(seen) {
    let idleScrolls = 0;

    await ensureListPage();
    await clickSearch();

    while (!state.stopRequested) {
      const loaded = getDataRows().map(readTableRow).filter((row) => row.code || row.name);
      const pending = loaded.filter((row) => !seen.has(getRowKey(row)));

      if (!pending.length) {
        const moved = await scrollToLoadMore();
        idleScrolls = moved || hasMoreDataHint() ? idleScrolls + 1 : idleScrolls + 2;
        if (idleScrolls >= 4) break;
        continue;
      }

      idleScrolls = 0;

      for (const rowData of pending) {
        if (state.stopRequested) break;
        const key = getRowKey(rowData);
        if (seen.has(key)) continue;

        try {
          const detail = await scrapeOne(rowData, state.rows.length);
          state.rows.push(detail);
          seen.add(key);
          pushLog("success", `Scraped ${detail.code || detail.name}`);
        } catch (err) {
          state.rows.push({
            code: (rowData.code || "").trim(),
            name: (rowData.name || "").trim(),
            description: (rowData.description || "").trim(),
            lang: {},
            translations: [],
            error: err.message || String(err),
            scrapedAt: new Date().toISOString(),
          });
          seen.add(key);
          pushLog("fail", `${rowData.code || rowData.name}: ${err.message || err}`);
          // Make sure a failure never strands us on the CRUD page.
          try { await cancelCrud(); } catch (_) {}
        }

        setProgress(state.rows.length, Math.max(seen.size, loaded.length));

        // Step 5 of the flow: re-search so the list is fresh for the next row.
        if (!state.stopRequested) {
          try {
            await clickSearch();
          } catch (err) {
            pushLog("fail", `Refresh failed: ${err.message || err}`);
            return;
          }
        }
      }
    }
  }

  // ── Panel ────────────────────────────────────────────────────────────────

  function esc(value) {
    return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function setStatus(message) {
    const el = document.querySelector("#arcus-tr-status");
    if (el) el.textContent = message;
    console.log("[Translation]", message);
  }

  function setProgress(done, total) {
    const bar = document.querySelector("#arcus-tr-bar");
    const label = document.querySelector("#arcus-tr-label");
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    if (bar) bar.style.width = `${clamp(pct, 0, 100)}%`;
    if (label) label.textContent = total > 0 ? `${done} / ${total}` : String(done);
  }

  function pushLog(type, message) {
    state.logItems.unshift({ type, message, time: new Date().toLocaleTimeString() });
    state.logItems = state.logItems.slice(0, 200);
    renderLog();
  }

  function renderLog() {
    const el = document.querySelector("#arcus-tr-log");
    if (!el) return;
    el.innerHTML = state.logItems
      .slice(0, 60)
      .map((item) => `<div class="arcus-tr-log-${item.type}"><span>${item.time}</span>${esc(item.message)}</div>`)
      .join("");
  }

  function updateButtons() {
    const run = document.querySelector("#arcus-tr-run");
    const stop = document.querySelector("#arcus-tr-stop");
    const mode = document.querySelector("#arcus-tr-mode");
    if (run) run.disabled = state.running;
    if (stop) stop.disabled = !state.running;
    if (mode) mode.disabled = state.running;
  }

  function setPanelDismissed(value) {
    state.dismissed = !!value;
    // Mark that the user (or the popup) has made an explicit choice, so the
    // asynchronous restore below cannot overwrite it with a stale stored value.
    state.dismissedExplicit = true;
    try { chrome.storage?.local?.set({ [PANEL_DISMISSED_KEY]: !!value }); } catch (_) {}
  }

  function restorePanelDismissed(callback) {
    try {
      chrome.storage?.local?.get([PANEL_DISMISSED_KEY, MODE_KEY], (data) => {
        // If a show/hide request arrived while this read was in flight, that
        // choice wins — otherwise the panel would silently fail to appear.
        if (!state.dismissedExplicit) {
          state.dismissed = !!data?.[PANEL_DISMISSED_KEY];
        }
        if (data?.[MODE_KEY]) state.mode = data[MODE_KEY];
        callback?.();
      });
    } catch (_) {
      callback?.();
    }
  }

  function savePanelState(panel) {
    try {
      chrome.storage?.local?.set({
        [PANEL_STATE_KEY]: {
          top: panel.style.top || "",
          left: panel.style.left || "",
          minimized: panel.classList.contains("is-minimized"),
        },
      });
    } catch (_) {}
  }

  function restorePanelState(panel) {
    try {
      chrome.storage?.local?.get(PANEL_STATE_KEY, (data) => {
        const saved = data?.[PANEL_STATE_KEY];
        if (!saved) return;
        if (saved.top) panel.style.top = saved.top;
        if (saved.left) panel.style.left = saved.left;
        if (saved.top || saved.left) panel.style.right = "auto";
        if (saved.minimized) {
          panel.classList.add("is-minimized");
          const btn = panel.querySelector("#arcus-tr-minimize");
          if (btn) btn.textContent = "+";
        }
      });
    } catch (_) {}
  }

  function injectStyles() {
    if (document.querySelector("#arcus-tr-style")) return;
    const style = document.createElement("style");
    style.id = "arcus-tr-style";
    style.textContent = `
      #arcus-tr-panel {
        position:fixed; top:86px; right:16px; z-index:999999; width:300px;
        background:#fff; border:1px solid #dde4ef; border-radius:8px;
        box-shadow:0 4px 20px rgba(0,0,0,.18); font-family:'Segoe UI',system-ui,sans-serif;
        font-size:12px; color:#1a1a2e;
      }
      #arcus-tr-panel.is-minimized #arcus-tr-body { display:none; }
      #arcus-tr-header {
        background:#4527a0; color:#fff; padding:10px 12px; border-radius:8px 8px 0 0;
        display:flex; justify-content:space-between; gap:8px; cursor:move;
      }
      .arcus-tr-title { font-size:13px; font-weight:700; }
      .arcus-tr-desc { font-size:10px; opacity:.82; margin-top:2px; }
      .arcus-tr-actions { display:flex; gap:4px; }
      .arcus-tr-icon {
        width:22px; height:22px; border:0; border-radius:5px; color:#fff;
        background:rgba(255,255,255,.18); cursor:pointer;
      }
      #arcus-tr-body { padding:10px 12px 12px; }
      .arcus-tr-row { display:flex; gap:6px; margin-bottom:8px; }
      .arcus-tr-select {
        width:100%; margin-bottom:8px; padding:5px 6px; font-size:11px;
        border:1px solid #d5dbe6; border-radius:6px; background:#fff; color:#1a1a2e;
      }
      .arcus-tr-select:disabled { opacity:.5; }
      .arcus-tr-btn {
        flex:1; border:0; border-radius:6px; padding:7px 6px; font-size:11px;
        font-weight:600; color:#fff; cursor:pointer;
      }
      .arcus-tr-btn:disabled { opacity:.4; cursor:not-allowed; }
      #arcus-tr-run { background:#4527a0; }
      .arcus-tr-btn-alt { background:#546e7a; }
      #arcus-tr-stop { background:#c62828; }
      .arcus-tr-track { height:6px; background:#e0e7ef; border-radius:3px; overflow:hidden; margin-bottom:3px; }
      #arcus-tr-bar { height:100%; background:#4527a0; width:0; }
      #arcus-tr-label { font-size:10px; color:#607d8b; text-align:right; margin-bottom:8px; }
      #arcus-tr-status {
        font-size:11px; line-height:1.4; white-space:pre-line; word-break:break-word;
        padding:6px 8px; border-left:3px solid #4527a0; border-radius:4px;
        background:#f3f0fa; color:#241b3b; margin-bottom:8px;
      }
      #arcus-tr-log { max-height:150px; overflow-y:auto; font-size:10px; }
      #arcus-tr-log > div { padding:3px 0; border-bottom:1px solid #f0f0f0; line-height:1.3; }
      #arcus-tr-log span { color:#9e9e9e; margin-right:4px; }
      .arcus-tr-log-success { color:#2e7d32; }
      .arcus-tr-log-fail { color:#c62828; }
      .arcus-tr-log-info { color:#444; }
    `;
    document.head.appendChild(style);
  }

  function removePanel() {
    document.querySelector("#arcus-tr-panel")?.remove();
  }

  function createPanel() {
    if (!isTranslationPage() || state.dismissed || document.querySelector("#arcus-tr-panel")) return;
    injectStyles();

    const panel = document.createElement("div");
    panel.id = "arcus-tr-panel";
    panel.innerHTML = `
      <div id="arcus-tr-header">
        <div>
          <div class="arcus-tr-title">HIS Translations</div>
          <div class="arcus-tr-desc">Scrape list + CRUD detail to JSON</div>
        </div>
        <div class="arcus-tr-actions">
          <button id="arcus-tr-minimize" class="arcus-tr-icon" title="Minimize">-</button>
          <button id="arcus-tr-close" class="arcus-tr-icon" title="Close">X</button>
        </div>
      </div>
      <div id="arcus-tr-body">
        <select id="arcus-tr-mode" class="arcus-tr-select">
          <option value="api">API mode - fast, all pages</option>
          <option value="dom">DOM mode - opens each row</option>
        </select>
        <div class="arcus-tr-row">
          <button id="arcus-tr-run" class="arcus-tr-btn">Start</button>
          <button id="arcus-tr-stop" class="arcus-tr-btn" disabled>Stop</button>
        </div>
        <div class="arcus-tr-row">
          <button id="arcus-tr-detect" class="arcus-tr-btn arcus-tr-btn-alt"
                  title="Press SEARCH on the page first, then click this to see which endpoint it called">Detect endpoint</button>
        </div>
        <div class="arcus-tr-track"><div id="arcus-tr-bar"></div></div>
        <div id="arcus-tr-label">0</div>
        <div id="arcus-tr-status">Ready. Click Start to search and scrape all loaded rows.</div>
        <div id="arcus-tr-log"></div>
      </div>
    `;
    document.body.appendChild(panel);
    restorePanelState(panel);

    const header = panel.querySelector("#arcus-tr-header");
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener("mousedown", (event) => {
      if (event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      dragging = true;
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      panel.style.left = `${rect.left}px`;
      panel.style.top = `${rect.top}px`;
      panel.style.right = "auto";
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      panel.style.left = `${clamp(startLeft + event.clientX - startX, 8, window.innerWidth - panel.offsetWidth - 8)}px`;
      panel.style.top = `${clamp(startTop + event.clientY - startY, 8, window.innerHeight - panel.offsetHeight - 8)}px`;
    });

    window.addEventListener("mouseup", () => {
      if (!dragging) return;
      dragging = false;
      savePanelState(panel);
    });

    const modeSelect = panel.querySelector("#arcus-tr-mode");
    if (modeSelect) {
      modeSelect.value = state.mode;
      modeSelect.addEventListener("change", () => {
        state.mode = modeSelect.value === "dom" ? "dom" : "api";
        try { chrome.storage?.local?.set({ [MODE_KEY]: state.mode }); } catch (_) {}
        setStatus(state.mode === "api"
          ? "API mode: fetches every page directly. Much faster."
          : "DOM mode: opens each row in the UI. Slow, used as a fallback.");
      });
    }

    panel.querySelector("#arcus-tr-detect")?.addEventListener("click", async () => {
      // Ask the page hook, then give it a moment to answer over postMessage.
      Api?.getObservedCalls();
      await sleep(300);
      const calls = Api?.getObservedCalls(/translation|sigcode/i) || [];

      if (!calls.length) {
        setStatus("No API calls seen yet.\nPress SEARCH on the page, then click Detect endpoint again.");
        return;
      }

      calls.slice(-6).forEach((c) => {
        pushLog("info", `${c.method} ${c.url}${c.body ? " " + c.body : ""}`);
      });

      // The list request is the POST that is not the per-record detail GET.
      const search = calls.filter((c) => c.method === "POST" && !/getdetail/i.test(c.url)).pop();
      if (search) {
        setStatus(`Page uses: ${search.method} ${search.url}\nSee the log for the payload.`);
        console.log("[Translation] page search call:", search);
      } else {
        setStatus("Saw API calls but no list POST.\nPress SEARCH on the page, then try again.");
      }
    });

    panel.querySelector("#arcus-tr-run")?.addEventListener("click", runScraper);

    panel.querySelector("#arcus-tr-stop")?.addEventListener("click", () => {
      state.stopRequested = true;
      setStatus("Stopping...");
      pushLog("info", "Stop requested");
      updateButtons();
    });

    panel.querySelector("#arcus-tr-minimize")?.addEventListener("click", () => {
      const minimized = panel.classList.toggle("is-minimized");
      panel.querySelector("#arcus-tr-minimize").textContent = minimized ? "+" : "-";
      savePanelState(panel);
    });

    panel.querySelector("#arcus-tr-close")?.addEventListener("click", () => {
      setPanelDismissed(true);
      removePanel();
    });

    renderLog();
    updateButtons();
  }

  function initIfNeeded() {
    if (!isTranslationPage() || state.dismissed) {
      removePanel();
      return;
    }
    createPanel();
  }

  /**
   * Enrich an already-exported file in place.
   *
   * Lets an earlier export (which lacked translatedtexts) gain its local-language
   * values without re-running the whole search. Call from the page console:
   *   await ArcusTranslation.enrichExport(<parsed JSON>)
   */
  async function enrichExport(payload) {
    const rows = Array.isArray(payload) ? payload : (payload && payload.rows);
    if (!Array.isArray(rows) || !rows.length) throw new Error("no rows in payload");

    const auth = await Api.ensureAuth(triggerAuthCapture, 20000);
    if (!auth.ok) throw new Error(auth.error || "no API credentials");

    state.rows = rows;
    const detail = await enrichWithDetails(rows);
    const withThai = rows.filter((r) => r.lang && Object.keys(r.lang).length).length;
    pushLog("success", `Enriched ${detail.enriched}, failed ${detail.failed}, ${withThai} with local text`);

    const out = Array.isArray(payload)
      ? { source: "Arcus HIS Translations", count: rows.length, rows }
      : Object.assign({}, payload, { rows, enrichedAt: new Date().toISOString() });

    await downloadJson(out);
    return { enriched: detail.enriched, failed: detail.failed, withThai };
  }

  window.ArcusTranslation = { enrichExport, state, API };

  window.addEventListener("arcus-toolkit:show-translation-panel", () => {
    setPanelDismissed(false);
    initIfNeeded();
    // The route may still be settling right after a navigation; retry briefly
    // so an explicit request never ends in silence.
    let tries = 0;
    const timer = setInterval(() => {
      if (document.querySelector("#arcus-tr-panel") || ++tries > 10) {
        clearInterval(timer);
        return;
      }
      initIfNeeded();
    }, 300);
  });

  window.addEventListener("arcus-toolkit:remove-translation-panel", () => {
    setPanelDismissed(true);
    removePanel();
  });

  restorePanelDismissed(() => initIfNeeded());

  // The panel must survive the list <-> crud round trip the scraper performs,
  // so it stays mounted for both routes (isTranslationPage covers each).
  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(initIfNeeded, 400);
    } else if (isTranslationPage() && !document.querySelector("#arcus-tr-panel") && !state.dismissed) {
      createPanel();
    } else if (!isTranslationPage() && document.querySelector("#arcus-tr-panel")) {
      removePanel();
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("hashchange", () => setTimeout(initIfNeeded, 400));
})();
