(() => {
  if (window.__ARCUS_DRIVER_LOADED__) return;
  window.__ARCUS_DRIVER_LOADED__ = true;

  // ── Arcus Driver ───────────────────────────────────────────────────────
  //
  // One interaction layer for every Arcus module. Two backends behind the same
  // API:
  //
  //   turbo — chrome.debugger. Trusted input, and steps end when the network
  //           actually goes quiet instead of when a timer expires.
  //   dom   — synthetic events plus MutationObserver/XHR-hook settle detection.
  //           Still far cheaper than the old fixed sleeps, and it is what runs
  //           when the debugger is unavailable or the user declines it.
  //
  // Callers never branch on the backend. If a turbo call fails mid-run the
  // driver downgrades to dom and keeps going, so a lost debugger session
  // degrades speed rather than aborting the batch.

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const TURBO_KEY = "arcusTurboEnabled";

  const driverState = {
    mode: "dom",          // "dom" | "turbo"
    requested: false,     // user asked for turbo
    attached: false,
    tabId: null,
    lastError: null,
    // Rolling counters so the panel can show what turbo is actually saving.
    metrics: { settleWaits: 0, settleMsSaved: 0, clicks: 0, evaluates: 0, fallbacks: 0 },
  };

  // ── Service-worker messaging ─────────────────────────────────────────────

  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, error: err.message });
          else resolve(response || { ok: false, error: "no response" });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message });
      }
    });
  }

  /** Drop to DOM mode after a turbo failure, once, with a reason. */
  function degrade(reason) {
    if (driverState.mode !== "turbo") return;
    driverState.mode = "dom";
    driverState.attached = false;
    driverState.lastError = reason;
    driverState.metrics.fallbacks += 1;
    console.warn("[Arcus Driver] turbo -> dom:", reason);
    window.ArcusPanel?.pushLog?.("warn", "Turbo disabled, using DOM mode", reason);
    window.dispatchEvent(new CustomEvent("arcus-driver:mode", { detail: { mode: "dom", reason } }));
  }

  function isTurbo() {
    return driverState.mode === "turbo" && driverState.attached;
  }

  // ── Attach / detach ──────────────────────────────────────────────────────

  async function enableTurbo() {
    driverState.requested = true;
    const result = await send({ type: "cdpAttach" });

    if (!result.ok) {
      driverState.mode = "dom";
      driverState.attached = false;
      driverState.lastError = result.error || "attach failed";
      window.dispatchEvent(new CustomEvent("arcus-driver:mode", {
        detail: { mode: "dom", reason: driverState.lastError },
      }));
      return { ok: false, error: driverState.lastError };
    }

    driverState.mode = "turbo";
    driverState.attached = true;
    driverState.lastError = null;
    window.dispatchEvent(new CustomEvent("arcus-driver:mode", { detail: { mode: "turbo" } }));
    return { ok: true, alreadyAttached: result.alreadyAttached };
  }

  async function disableTurbo() {
    driverState.requested = false;
    const result = await send({ type: "cdpDetach" });
    if (!result.ok) {
      driverState.requested = isTurbo();
      driverState.lastError = result.error || "detach failed";
      window.dispatchEvent(new CustomEvent("arcus-driver:mode", {
        detail: { mode: driverState.mode, reason: driverState.lastError },
      }));
      return { ok: false, error: driverState.lastError };
    }
    driverState.mode = "dom";
    driverState.attached = false;
    window.dispatchEvent(new CustomEvent("arcus-driver:mode", { detail: { mode: "dom" } }));
    return { ok: true };
  }

  async function syncTurboPreference() {
    return new Promise((resolve) => {
      try {
        window.ArcusTabSettings?.get(TURBO_KEY, async (data) => {
          if (data && data[TURBO_KEY]) await enableTurbo();
          resolve(driverState.mode);
        });
      } catch (_) {
        resolve(driverState.mode);
      }
    });
  }

  // Nothing is persisted: turbo is a per-session choice, so it cannot silently
  // come back on a later page load and attach the debugger unasked.
  function setTurboPreference(enabled) {
    return enabled ? enableTurbo() : disableTurbo();
  }

  // ── DOM-mode settle detection ────────────────────────────────────────────
  //
  // Without CDP we cannot see the network from a content script, so we hook
  // XMLHttpRequest and fetch in the page world and count in-flight requests
  // ourselves. Installed once, lazily, and only when turbo is off.

  const domNet = { inflight: 0, lastActivityAt: Date.now(), installed: false };

  function installDomNetworkHooks() {
    if (domNet.installed) return;
    domNet.installed = true;

    const bump = (delta) => {
      domNet.inflight = Math.max(0, domNet.inflight + delta);
      domNet.lastActivityAt = Date.now();
    };

    try {
      const open = XMLHttpRequest.prototype.open;
      const send_ = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__arcusUrl = url;
        return open.call(this, method, url, ...rest);
      };

      XMLHttpRequest.prototype.send = function (...args) {
        // Only count XHRs, which in this AngularJS app means $http calls.
        bump(1);
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          bump(-1);
        };
        this.addEventListener("loadend", done);
        try {
          return send_.apply(this, args);
        } catch (err) {
          done();
          throw err;
        }
      };
    } catch (_) {}

    try {
      const origFetch = window.fetch;
      if (typeof origFetch === "function") {
        window.fetch = function (...args) {
          bump(1);
          return origFetch.apply(this, args).finally(() => bump(-1));
        };
      }
    } catch (_) {}
  }

  /**
   * Resolve when the page looks settled.
   * Turbo asks the bridge; DOM mode watches its own counters and, failing any
   * signal, waits out a short floor so a caller is never left in a hot loop.
   */
  async function waitForSettle(options) {
    const opts = options || {};
    const idleMs = opts.idleMs == null ? 220 : opts.idleMs;
    const timeoutMs = opts.timeoutMs == null ? 15000 : opts.timeoutMs;
    const started = Date.now();

    if (isTurbo()) {
      const result = await send({ type: "cdpWaitNetworkIdle", idleMs, timeoutMs });
      if (result.ok) {
        driverState.metrics.settleWaits += 1;
        // Credit against the fixed 1800ms the old engine would have burned.
        driverState.metrics.settleMsSaved += Math.max(0, 1800 - (Date.now() - started));
        return { ok: true, waited: Date.now() - started };
      }
      if (result.error) degrade(result.error);
      // A timeout just means the page is chatty; fall through to DOM polling.
    }

    installDomNetworkHooks();

    while (Date.now() - started < timeoutMs) {
      const quietFor = Date.now() - domNet.lastActivityAt;
      if (domNet.inflight === 0 && quietFor >= idleMs) {
        return { ok: true, waited: Date.now() - started };
      }
      await sleep(40);
    }

    return { ok: false, reason: "settle timeout", waited: Date.now() - started };
  }

  // ── Element readiness ────────────────────────────────────────────────────

  function isVisible(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (el.disabled) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Wait for a predicate, driven by MutationObserver rather than a fixed poll.
   * The old waitFor slept 250-400ms between checks, so an element that appeared
   * at t=10ms was still not acted on until t=250ms. This returns on the same
   * frame the DOM changes, with a slow backstop poll for non-DOM predicates
   * (route/hash changes) that no observer would report.
   */
  function waitFor(predicate, timeoutMs, options) {
    const opts = options || {};
    const timeout = timeoutMs == null ? 10000 : timeoutMs;
    const shouldAbort = opts.shouldAbort || (() => false);

    return new Promise((resolve) => {
      let done = false;
      let observer = null;
      let poll = null;
      let timer = null;

      const finish = (value) => {
        if (done) return;
        done = true;
        if (observer) observer.disconnect();
        if (poll) clearInterval(poll);
        if (timer) clearTimeout(timer);
        resolve(value);
      };

      const check = () => {
        if (done) return;
        if (shouldAbort()) return finish(null);
        let result = null;
        try {
          result = predicate();
        } catch (_) {
          result = null;
        }
        if (result) finish(result);
      };

      check();
      if (done) return;

      try {
        observer = new MutationObserver(check);
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "style", "disabled", "aria-hidden", "ng-hide"],
        });
      } catch (_) {}

      // Backstop for predicates no mutation would fire on (location.href).
      poll = setInterval(check, 120);
      timer = setTimeout(() => finish(null), timeout);
    });
  }

  function waitForVisible(selectors, timeoutMs, options) {
    const list = Array.isArray(selectors) ? selectors : [selectors].filter(Boolean);
    return waitFor(() => {
      for (const selector of list) {
        try {
          const el = document.querySelector(selector);
          if (el && isVisible(el)) return el;
        } catch (_) {}
      }
      return null;
    }, timeoutMs, options);
  }

  function waitForGone(selectors, timeoutMs, options) {
    const list = Array.isArray(selectors) ? selectors : [selectors].filter(Boolean);
    return waitFor(() => {
      for (const selector of list) {
        try {
          const el = document.querySelector(selector);
          if (el && isVisible(el)) return null;
        } catch (_) {}
      }
      return true;
    }, timeoutMs, options);
  }

  // ── Clicking ─────────────────────────────────────────────────────────────

  /**
   * Bring an element into view without the 250ms smooth-scroll wait the old
   * clickLikeUser paid on every single click. "instant" lands synchronously,
   * so the coordinates we read next are already correct.
   */
  function ensureInView(el) {
    const rect = el.getBoundingClientRect();
    const fullyVisible =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth;
    if (fullyVisible) return false;
    try {
      el.scrollIntoView({ behavior: "instant", block: "center", inline: "center" });
    } catch (_) {
      el.scrollIntoView({ block: "center", inline: "center" });
    }
    return true;
  }

  function clickPointOf(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // CDP dispatches by coordinate, so an element covered by an overlay would
    // silently deliver the click to the overlay. Verify the hit point resolves
    // back to our element (or a descendant) before trusting it.
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit) || hit.contains(el))) {
      return { x, y };
    }

    // The centre is covered by something outside this element. Angular Material
    // buttons carry a full-size .md-ripple-container child, and other overlays
    // can sit on top, so try points inset from each corner before giving up —
    // a real user would simply click a part of the button that is reachable.
    const insets = [
      [rect.left + rect.width * 0.2, rect.top + rect.height * 0.5],
      [rect.left + rect.width * 0.8, rect.top + rect.height * 0.5],
      [rect.left + rect.width * 0.5, rect.top + rect.height * 0.25],
      [rect.left + rect.width * 0.5, rect.top + rect.height * 0.75],
    ];

    for (const [px, py] of insets) {
      const probe = document.elementFromPoint(px, py);
      if (probe && (probe === el || el.contains(probe) || probe.contains(el))) {
        return { x: px, y: py };
      }
    }

    return { x, y, occluded: true };
  }

  function domClick(el) {
    const events = ["mouseover", "mouseenter", "mousedown", "mouseup", "click"];
    for (const type of events) {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    // Deliberately NO el.click() after dispatching "click" above: that fires
    // the handler a second time ~9ms later. A recording showed four ALLOCATE
    // presses for two logical clicks, and Arcus treats the re-entrant call as a
    // fresh save against state the first one is still mutating — so nothing
    // commits at all.
    return true;
  }

  /**
   * Click an element. In turbo this is a real trusted click at its coordinates;
   * otherwise it is the synthetic event sequence. Occluded elements always fall
   * back to DOM dispatch, which ignores stacking.
   */
  /** Why an element cannot be clicked right now, or null if it can. */
  function clickBlockedReason(el) {
    if (el.disabled) return "element is disabled";
    if (el.getAttribute && el.getAttribute("aria-disabled") === "true") {
      return "element is aria-disabled";
    }
    if (el.closest && el.closest("[disabled]")) return "inside a disabled container";

    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return "element is hidden";
    if (style.pointerEvents === "none") return "element ignores pointer events";

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return "element has no size";

    return null;
  }

  /**
   * Click an element.
   *
   * Refuses to act on a disabled control. Both click paths are silently
   * swallowed by a disabled button — synthetic MouseEvents are ignored and
   * el.click() is a no-op — so firing anyway and returning ok:true reports a
   * success for a click that never happened, which is how an unsaved order can
   * look like a completed one.
   */
  // Guards against a caller re-clicking the same control in a tight loop when
  // the page does not respond. A recording showed #closeBtn pressed ~60 times
  // in 1.2s while its dialog stayed open — every one of those reached Arcus.
  const recentClicks = new WeakMap();
  const REPEAT_CLICK_MS = 400;

  async function click(el, options) {
    if (!el) return { ok: false, reason: "no element" };
    const opts = options || {};

    const blocked = clickBlockedReason(el);
    if (blocked) return { ok: false, reason: blocked, clicked: false };

    const last = recentClicks.get(el) || 0;
    const since = Date.now() - last;
    if (since < REPEAT_CLICK_MS && !opts.allowRepeat) {
      return {
        ok: false,
        clicked: false,
        reason: `clicked ${since}ms ago; ignoring repeat within ${REPEAT_CLICK_MS}ms`,
      };
    }
    recentClicks.set(el, Date.now());

    const scrolled = ensureInView(el);
    if (scrolled) {
      // One frame for the layout to settle after an instant scroll.
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    }

    driverState.metrics.clicks += 1;

    if (isTurbo()) {
      const point = clickPointOf(el);
      if (point && !point.occluded) {
        const message = opts.settle
          ? {
              type: "cdpClickAndSettle",
              x: point.x,
              y: point.y,
              idleMs: opts.idleMs,
              timeoutMs: opts.timeoutMs,
            }
          : { type: "cdpClick", x: point.x, y: point.y };

        const result = await send(message);
        if (result.ok) return { ok: true, trusted: true, settled: result.settled };
        degrade(result.error || "click failed");
      }
    }

    domClick(el);
    if (opts.settle) await waitForSettle({ idleMs: opts.idleMs, timeoutMs: opts.timeoutMs });
    return { ok: true, trusted: false };
  }

  /** Click, then wait for the page to go quiet. The common automation step. */
  function clickAndSettle(el, options) {
    return click(el, Object.assign({}, options, { settle: true }));
  }

  // ── Typing ───────────────────────────────────────────────────────────────

  function setNativeValue(el, value) {
    const proto = el.tagName === "TEXTAREA"
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  /**
   * Fill a field. DOM mode sets the value directly (fast, and AngularJS only
   * needs the input event); turbo types it so keypress-driven fields such as
   * autocompletes behave as they do for a real user.
   */
  async function type(el, text, options) {
    if (!el) return { ok: false, reason: "no element" };
    const opts = options || {};

    await click(el);

    if (isTurbo() && opts.realKeys !== false) {
      // Clear via select-all + the replacement text.
      const result = await send({ type: "cdpType", text: String(text) });
      if (result.ok) return { ok: true, trusted: true };
      degrade(result.error || "type failed");
    }

    setNativeValue(el, text);
    return { ok: true, trusted: false };
  }

  async function pressKey(key) {
    const KEYS = {
      Enter: { key: "Enter", code: "Enter", keyCode: 13 },
      Escape: { key: "Escape", code: "Escape", keyCode: 27 },
      Tab: { key: "Tab", code: "Tab", keyCode: 9 },
    };
    const spec = KEYS[key];
    if (!spec) return { ok: false, reason: "unsupported key " + key };

    if (isTurbo()) {
      const result = await send(Object.assign({ type: "cdpKey" }, spec));
      if (result.ok) return { ok: true, trusted: true };
      degrade(result.error || "key failed");
    }

    const target = document.activeElement || document.body;
    ["keydown", "keypress", "keyup"].forEach((eventType) => {
      target.dispatchEvent(new KeyboardEvent(eventType, {
        key: spec.key,
        code: spec.code,
        keyCode: spec.keyCode,
        which: spec.keyCode,
        bubbles: true,
        cancelable: true,
      }));
    });
    return { ok: true, trusted: false };
  }

  // ── Scrolling ────────────────────────────────────────────────────────────

  async function scroll(el, deltaY) {
    const target = el || document.scrollingElement || document.documentElement;
    const delta = deltaY == null ? 600 : deltaY;

    if (isTurbo()) {
      const rect = target.getBoundingClientRect
        ? target.getBoundingClientRect()
        : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const x = rect.left + Math.min(rect.width / 2, window.innerWidth / 2);
      const y = rect.top + Math.min(rect.height / 2, window.innerHeight / 2);
      const result = await send({ type: "cdpScroll", x, y, deltaY: delta });
      if (result.ok) return { ok: true, trusted: true };
      degrade(result.error || "scroll failed");
    }

    try {
      target.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        view: window,
        deltaY: delta,
        deltaMode: 0,
      }));
      target.scrollTop = Math.min((target.scrollTop || 0) + delta, target.scrollHeight || 0);
      // md-virtual-repeat listens for scroll, not wheel.
      target.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch (_) {}

    return { ok: true, trusted: false };
  }

  // ── Batched reads ────────────────────────────────────────────────────────

  /**
   * Read many values from the DOM in one shot.
   *
   * `fn` is serialised and run in the page. In turbo it crosses the CDP
   * boundary once, so scraping N rows costs one round trip instead of N*k
   * property reads from the content script; in DOM mode it simply runs inline.
   * `fn` must be self-contained: it cannot close over content-script scope.
   */
  async function harvest(fn, args) {
    driverState.metrics.evaluates += 1;
    const payload = args === undefined ? "undefined" : JSON.stringify(args);

    if (isTurbo()) {
      const expression = "(" + fn.toString() + ")(" + payload + ")";
      const result = await send({ type: "cdpEvaluate", expression });
      if (result.ok) return { ok: true, value: result.value };
      // A page-side throw is the caller's bug, not a transport failure, so it
      // must not silently downgrade the whole session to DOM mode.
      if (/^(Error|TypeError|ReferenceError|SyntaxError)/.test(String(result.error))) {
        return { ok: false, error: result.error };
      }
      degrade(result.error || "evaluate failed");
    }

    try {
      return { ok: true, value: fn(args) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  function getMetrics() {
    return Object.assign({}, driverState.metrics, {
      mode: driverState.mode,
      attached: driverState.attached,
      lastError: driverState.lastError,
    });
  }

  function resetMetrics() {
    driverState.metrics = {
      settleWaits: 0,
      settleMsSaved: 0,
      clicks: 0,
      evaluates: 0,
      fallbacks: 0,
    };
  }

  window.ArcusDriver = {
    TURBO_KEY,
    state: driverState,
    isTurbo,
    getMode: () => driverState.mode,
    enableTurbo,
    disableTurbo,
    setTurboPreference,
    syncTurboPreference,
    waitForSettle,
    waitFor,
    waitForVisible,
    waitForGone,
    click,
    clickAndSettle,
    type,
    pressKey,
    scroll,
    harvest,
    isVisible,
    setNativeValue,
    sleep,
    getMetrics,
    resetMetrics,
  };

  // Turbo is deliberately NOT restored on load.
  //
  // Attaching chrome.debugger makes Chrome show a "started debugging this
  // browser" banner on the tab, so it must never switch itself on from a stored
  // preference — the user has to choose it for the session, each session.
})();
