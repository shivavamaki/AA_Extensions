(() => {
  if (window.__ARCUS_API_CLIENT_LOADED__) return;
  window.__ARCUS_API_CLIENT_LOADED__ = true;

  // ── Arcus API client ─────────────────────────────────────────────────────
  //
  // Talks to the Arcus REST endpoints directly instead of driving the UI.
  //
  // The app authenticates with a set of custom headers (incus-token, orguid,
  // useruid, ...) rather than a plain cookie, so we cannot simply fetch(). We
  // learn them by watching the requests the page itself makes: setRequestHeader
  // is hooked once, and every Arcus API call records its headers for reuse.
  //
  // Nothing is ever sent anywhere except back to the same origin the page is
  // already talking to, and headers stay in memory for the life of the tab.

  const CAPTURE_KEYS = [
    "incus-token",
    "orguid",
    "parentorguid",
    "useruid",
    "roleuid",
    "departmentuid",
    "appname",
    "utcoffset",
    "hasanonymouspermission",
  ];

  // Header names are case-insensitive; normalise so lookups are predictable.
  const captured = new Map();
  let captureCount = 0;

  // API calls the page made, reported by the MAIN-world hook. Used to discover
  // which endpoint actually backs a page rather than guessing its name.
  let observedCalls = [];

  function recordHeader(name, value) {
    const key = String(name || "").toLowerCase();
    if (!CAPTURE_KEYS.includes(key)) return;
    if (value == null || value === "") return;
    if (captured.get(key) !== String(value)) {
      captured.set(key, String(value));
    }
  }

  /**
   * Receive auth headers from the MAIN-world page hook.
   *
   * Content scripts run in an isolated world with their own XMLHttpRequest, so
   * a hook installed here would never observe the Angular app's requests. The
   * capture therefore lives in page-hook.js (declared world:"MAIN" in the
   * manifest) and forwards what it sees over postMessage.
   */
  function installHook() {
    if (window.__ARCUS_API_HOOK_INSTALLED__) return;
    window.__ARCUS_API_HOOK_INSTALLED__ = true;

    window.addEventListener("message", (event) => {
      // Only trust messages from this page. A cross-origin frame cannot forge
      // event.origin, so that is the real security check; the event.source test
      // is a belt-and-braces same-window check, skipped when the environment
      // does not populate it.
      if (event.origin && event.origin !== location.origin) return;
      if (event.source && event.source !== window) return;

      const data = event.data;
      if (!data || data.source !== "arcus-page-hook") return;
      if (data.type !== "auth" && data.type !== "calls") return;

      if (data.type === "calls") {
        observedCalls = Array.isArray(data.calls) ? data.calls : [];
        return;
      }

      const headers = data.headers || {};
      let changed = false;
      Object.keys(headers).forEach((key) => {
        const before = captured.get(key.toLowerCase());
        recordHeader(key, headers[key]);
        if (captured.get(key.toLowerCase()) !== before) changed = true;
      });
      if (changed) captureCount += 1;
    });

    requestAuthFromPage();
  }

  /** Ask the page hook for anything it has already captured. */
  function requestAuthFromPage() {
    try {
      window.postMessage({ source: "arcus-content", type: "requestAuth" }, location.origin);
    } catch (_) {}
  }

  /** Recently observed API calls, newest last. */
  function getObservedCalls(filter) {
    try {
      window.postMessage({ source: "arcus-content", type: "requestCalls" }, location.origin);
    } catch (_) {}
    if (!filter) return observedCalls.slice();
    const re = filter instanceof RegExp ? filter : new RegExp(String(filter), "i");
    return observedCalls.filter((c) => re.test(c.url));
  }

  function hasAuth() {
    // incus-token plus an org is the minimum the endpoints check.
    return captured.has("incus-token") && captured.has("orguid");
  }

  function getHeaders(extra) {
    const headers = {
      "Content-Type": "application/json;charset=UTF-8",
      Accept: "*/*",
    };
    captured.forEach((value, key) => {
      headers[key] = value;
    });
    return Object.assign(headers, extra || {});
  }

  function describeAuth() {
    return {
      ready: hasAuth(),
      keys: Array.from(captured.keys()).sort(),
      observedCalls: captureCount,
    };
  }

  /**
   * Make sure we have credentials, nudging the app if we do not.
   *
   * `trigger` is an optional async callback that provokes a real API request
   * (clicking the page's own Search button, say). We only call it when the hook
   * has not seen anything yet.
   */
  async function ensureAuth(trigger, timeoutMs = 15000) {
    installHook();
    if (hasAuth()) return { ok: true, source: "already captured" };

    if (typeof trigger === "function") {
      try {
        await trigger();
      } catch (_) {}
    }

    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (hasAuth()) return { ok: true, source: "captured after trigger" };
      requestAuthFromPage();
      await new Promise((resolve) => setTimeout(resolve, 150));
    }

    return {
      ok: false,
      error:
        "Could not capture Arcus API credentials. Use the page once (press Search) and try again.",
    };
  }

  /**
   * POST to an Arcus endpoint with the captured auth headers.
   *
   * credentials:"include" keeps the session cookie attached alongside the
   * custom headers — the server checks both.
   */
  async function post(path, body, options) {
    const opts = options || {};
    if (!hasAuth()) {
      return { ok: false, status: 0, error: "no captured credentials" };
    }

    const url = path.startsWith("http")
      ? path
      : `${location.origin}${path.startsWith("/") ? "" : "/"}${path}`;

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        credentials: "include",
        headers: getHeaders(opts.headers),
        body: JSON.stringify(body || {}),
      });
    } catch (err) {
      return { ok: false, status: 0, error: err.message || String(err) };
    }

    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    try {
      return { ok: true, status: response.status, data: await response.json() };
    } catch (err) {
      return { ok: false, status: response.status, error: "invalid JSON response" };
    }
  }

  /** GET an Arcus endpoint with the captured auth headers. */
  async function get(path) {
    if (!hasAuth()) {
      return { ok: false, status: 0, error: "no captured credentials" };
    }

    const url = path.startsWith("http")
      ? path
      : `${location.origin}${path.startsWith("/") ? "" : "/"}${path}`;

    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: getHeaders(),
      });
    } catch (err) {
      return { ok: false, status: 0, error: err.message || String(err) };
    }

    if (!response.ok) {
      return { ok: false, status: response.status, error: `HTTP ${response.status}` };
    }

    try {
      return { ok: true, status: response.status, data: await response.json() };
    } catch (err) {
      return { ok: false, status: response.status, error: "invalid JSON response" };
    }
  }

  /**
   * Walk a paginated endpoint until it stops returning new records.
   *
   * The API reports no total and no "last page" flag, so termination is by
   * observation: stop on an empty page, on a page whose records we have all
   * seen before (some endpoints repeat the last page instead of returning
   * empty), or at maxPages as a hard backstop.
   *
   * `onPage` receives each page's rows so callers can show progress.
   */
  async function fetchAllPages(path, options) {
    const opts = options || {};
    const collection = opts.collection;
    const basePayload = opts.payload || {};
    const maxPages = opts.maxPages || 200;
    const idOf = opts.idOf || ((row) => row && row._id);
    const onPage = opts.onPage;
    const shouldStop = opts.shouldStop || (() => false);
    const firstPage = opts.firstPage == null ? 1 : opts.firstPage;

    const rows = [];
    const seen = new Set();

    for (let page = firstPage; page < firstPage + maxPages; page++) {
      if (shouldStop()) return { ok: true, rows, stopped: true, pages: page - firstPage };

      const result = await post(path, Object.assign({}, basePayload, { pagenumber: page }));
      if (!result.ok) {
        // Partial data is still worth keeping.
        return {
          ok: false,
          rows,
          error: result.error,
          status: result.status,
          pages: page - firstPage,
        };
      }

      const payload = result.data || {};
      const batch = collection
        ? payload[collection]
        : payload[Object.keys(payload).find((k) => Array.isArray(payload[k]))];

      if (!Array.isArray(batch) || batch.length === 0) {
        return { ok: true, rows, pages: page - firstPage, reason: "empty page" };
      }

      let added = 0;
      for (const row of batch) {
        const id = idOf(row);
        const key = id == null ? JSON.stringify(row) : String(id);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
        added += 1;
      }

      if (onPage) {
        try {
          onPage({ page, added, total: rows.length, batchSize: batch.length });
        } catch (_) {}
      }

      // A page of entirely familiar records means we have wrapped around.
      if (added === 0) {
        return { ok: true, rows, pages: page - firstPage + 1, reason: "no new records" };
      }
    }

    return { ok: true, rows, pages: maxPages, reason: "max pages reached" };
  }

  installHook();

  window.ArcusApi = {
    installHook,
    requestAuthFromPage,
    getObservedCalls,
    hasAuth,
    ensureAuth,
    describeAuth,
    getHeaders,
    post,
    get,
    fetchAllPages,
    // Exposed for tests and diagnostics.
    _captured: captured,
    CAPTURE_KEYS,
  };
})();
