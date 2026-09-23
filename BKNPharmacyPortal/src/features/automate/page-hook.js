(() => {
  if (window.__ARCUS_PAGE_HOOK__) return;
  window.__ARCUS_PAGE_HOOK__ = true;

  // ── Page-world auth capture ──────────────────────────────────────────────
  //
  // Runs in the MAIN world, so it shares the JavaScript context with the Arcus
  // AngularJS app. That is the whole point: content scripts live in an isolated
  // world with their own XMLHttpRequest, so a hook installed there never sees
  // the app's requests. Only from here can we observe the auth headers the app
  // attaches to its own API calls.
  //
  // Captured values are handed to the content script by postMessage. Nothing
  // leaves the page.

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

  const captured = {};
  let dirty = false;

  function record(name, value) {
    const key = String(name || "").toLowerCase();
    if (CAPTURE_KEYS.indexOf(key) === -1) return;
    if (value == null || value === "") return;
    const str = String(value);
    if (captured[key] === str) return;
    captured[key] = str;
    dirty = true;
  }

  function publish() {
    if (!dirty) return;
    dirty = false;
    try {
      window.postMessage(
        { source: "arcus-page-hook", type: "auth", headers: Object.assign({}, captured) },
        window.location.origin
      );
    } catch (_) {}
  }

  // Recent API calls the app made, so the extension can discover which endpoint
  // actually backs a page instead of us guessing at its name.
  const calls = [];

  function recordCall(method, url, body) {
    try {
      if (!url || /^https?:\/\//i.test(url)) return;      // same-origin paths only
      if (!/^\/?(ordermanagement|inventories|pharmacy)\//i.test(url)) return;
      calls.push({
        method: String(method || "GET").toUpperCase(),
        url: String(url),
        body: typeof body === "string" ? body.slice(0, 500) : null,
        at: Date.now(),
      });
      if (calls.length > 50) calls.shift();
      pushEvent("xhr", { method: String(method || "GET").toUpperCase(), path: String(url) });
      window.postMessage(
        { source: "arcus-page-hook", type: "calls", calls: calls.slice(-20) },
        window.location.origin
      );
    } catch (_) {}
  }

  try {
    const setRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      try {
        record(name, value);
      } catch (_) {}
      return setRequestHeader.apply(this, arguments);
    };

    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      this.__arcusMethod = method;
      this.__arcusUrl = url;
      return open.apply(this, arguments);
    };

    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      // Headers are all set by the time send() runs.
      try {
        publish();
        recordCall(this.__arcusMethod, this.__arcusUrl, body);
      } catch (_) {}
      return send.apply(this, arguments);
    };
  } catch (_) {}

  try {
    const origFetch = window.fetch;
    if (typeof origFetch === "function") {
      window.fetch = function (input, init) {
        try {
          const headers = init && init.headers;
          if (headers) {
            if (typeof headers.forEach === "function") {
              headers.forEach((value, key) => record(key, value));
            } else {
              Object.keys(headers).forEach((key) => record(key, headers[key]));
            }
          }
          publish();
        } catch (_) {}
        return origFetch.apply(this, arguments);
      };
    }
  } catch (_) {}


  // ── Interaction recorder ────────────────────────────────────────────────
  //
  // Records what a person actually does, so automation steps are built from
  // observed selectors and timings rather than guessed ones. Every stall in
  // this toolkit so far came from guessing: the wrong ng-click handler, a
  // trailing semicolon in an attribute, a button that was disabled rather than
  // missing, a model that had not loaded yet.
  //
  // Recording is off until explicitly started, and stays in the page until the
  // user exports it.

  const rec = { on: false, redact: true, events: [], started: 0 };
  const REC_MAX = 500;

  // Values that identify a patient. Structure and timing are what make a
  // recording useful; the identifiers are not needed and should not travel.
  function scrub(text) {
    if (!rec.redact || !text) return text || "";
    return String(text)
      .replace(/\b\d{2}-\d{2}-\d{6}\b/g, "[HN]")          // 48-26-010835
      .replace(/\bI\d{2}-\d{2}-\d{6}\b/gi, "[VISIT]")     // I48-26-009307
      .replace(/\b\d{2}-\d{2}-\d{4}\b/g, "[DATE]")        // 05-05-1951
      .replace(/[\u0E00-\u0E7F]{2,}/g, "[TH]")   // Thai script (names, ward text)
      .slice(0, 300);
  }

  /** Selector candidates for one element, best first. */
  function selectorsFor(el) {
    const out = [];
    if (!el || !el.tagName) return out;
    const tag = el.tagName.toLowerCase();

    if (el.id) out.push("#" + el.id);

    const aria = el.getAttribute && el.getAttribute("aria-label");
    if (aria) out.push(tag + '[aria-label="' + aria + '"]');

    const ngClick = el.getAttribute && el.getAttribute("ng-click");
    if (ngClick) {
      // Substring form, because Arcus attributes carry a trailing semicolon.
      const handler = ngClick.replace(/^vm\./, "").replace(/\(.*$/, "");
      if (handler) out.push(tag + '[ng-click*="' + handler + '"]');
      out.push(tag + '[ng-click="' + ngClick + '"]');
    }

    const model = el.getAttribute && el.getAttribute("ng-model");
    if (model) out.push(tag + '[ng-model="' + model + '"]');

    const name = el.getAttribute && el.getAttribute("name");
    if (name) out.push(tag + '[name="' + name + '"]');

    const cls = (el.className && el.className.baseVal !== undefined)
      ? el.className.baseVal : (typeof el.className === "string" ? el.className : "");
    const stable = String(cls).split(/\s+/)
      .filter((c) => c && !/^ng-|^md-ink|ripple|^_md$/.test(c))
      .slice(0, 3);
    if (stable.length) out.push(tag + "." + stable.join("."));

    return out;
  }

  /** Why an element could not be clicked, or null. Mirrors the driver's rule. */
  function blockedReason(el) {
    try {
      if (el.disabled) return "disabled";
      if (el.getAttribute && el.getAttribute("aria-disabled") === "true") return "aria-disabled";
      if (el.closest && el.closest("[disabled]")) return "inside disabled";
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") return "hidden";
      if (st.pointerEvents === "none") return "pointer-events:none";
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return "zero size";
    } catch (_) {}
    return null;
  }

  function pushEvent(type, detail) {
    if (!rec.on) return;
    rec.events.push(Object.assign({
      t: Date.now() - rec.started,
      type,
      url: location.href,
    }, detail));
    if (rec.events.length > REC_MAX) rec.events.shift();
  }

  // A DISABLED button fires no click event at all, so a click listener alone
  // would silently miss the single most useful observation: the user tried to
  // press something that was not ready. mousedown still fires, so record from
  // there and mark whether a click followed.
  document.addEventListener("mousedown", (e) => {
    if (!rec.on) return;
    const el = e.target && e.target.closest
      ? (e.target.closest("button, md-option, a, [ng-click], input, md-select") || e.target)
      : e.target;
    if (!el || !el.tagName) return;
    const blocked = blockedReason(el);
    if (!blocked) return;          // an enabled control is covered by the click handler

    pushEvent("click-blocked", {
      tag: el.tagName.toLowerCase(),
      text: scrub((el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 80),
      selectors: selectorsFor(el),
      ngClick: (el.getAttribute && el.getAttribute("ng-click")) || null,
      ariaLabel: (el.getAttribute && el.getAttribute("aria-label")) || null,
      blocked,
    });
  }, true);

  // Capture-phase so we see the click before Angular can stop it.
  document.addEventListener("click", (e) => {
    if (!rec.on) return;
    const el = e.target && e.target.closest
      ? (e.target.closest("button, md-option, a, [ng-click], input, md-select") || e.target)
      : e.target;
    if (!el || !el.tagName) return;

    pushEvent("click", {
      tag: el.tagName.toLowerCase(),
      text: scrub((el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()).slice(0, 80),
      selectors: selectorsFor(el),
      ngClick: (el.getAttribute && el.getAttribute("ng-click")) || null,
      ariaLabel: (el.getAttribute && el.getAttribute("aria-label")) || null,
      blocked: blockedReason(el),
      trusted: e.isTrusted,
    });
  }, true);

  // Route changes: the step boundaries of every flow.
  let recLastUrl = location.href;
  setInterval(() => {
    if (!rec.on) return;
    if (location.href !== recLastUrl) {
      const from = recLastUrl;
      recLastUrl = location.href;
      pushEvent("navigate", { from, to: location.href });
    }
  }, 150);

  // Dialogs open and close: what the automation has to wait for and dismiss.
  try {
    const recObserver = new MutationObserver((records) => {
      if (!rec.on) return;
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches("md-dialog, [role='dialog']")) {
            pushEvent("dialog-open", {
              label: node.getAttribute("aria-label") || "",
              text: scrub((node.innerText || node.textContent || "").replace(/\s+/g, " ")).slice(0, 200),
              buttons: Array.from(node.querySelectorAll("button")).map((b) => ({
                text: (b.innerText || b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30),
                selectors: selectorsFor(b),
                blocked: blockedReason(b),
              })).slice(0, 8),
            });
          }
        }
        for (const node of r.removedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches("md-dialog, [role='dialog']")) {
            pushEvent("dialog-close", { label: node.getAttribute("aria-label") || "" });
          }
        }
      }
    });
    recObserver.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}

  // Answer an explicit request for whatever we hold, so the content script can
  // ask on demand rather than waiting for the next API call.
  window.addEventListener("message", (event) => {
    if (event.origin && event.origin !== window.location.origin) return;
    if (event.source && event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== "arcus-content") return;

    if (data.type === "recStart") {
      rec.on = true;
      rec.redact = data.redact !== false;
      rec.events = [];
      rec.started = Date.now();
      recLastUrl = location.href;
      pushEvent("start", { redact: rec.redact });
      return;
    }

    if (data.type === "recStop") {
      rec.on = false;
      return;
    }

    if (data.type === "recDump") {
      try {
        window.postMessage({
          source: "arcus-page-hook",
          type: "recording",
          events: rec.events.slice(),
          recording: rec.on,
          redacted: rec.redact,
        }, window.location.origin);
      } catch (_) {}
      return;
    }

    if (data.type === "requestCalls") {
      try {
        window.postMessage(
          { source: "arcus-page-hook", type: "calls", calls: calls.slice(-20) },
          window.location.origin
        );
      } catch (_) {}
      return;
    }

    // Report the dispense controller's model. Only code running in the page's
    // own world can see window.angular, so the content script cannot read this
    // itself — it has to ask us.
    if (data.type === "requestDispenseScope") {
      var state = { scopeReachable: false, hasVm: false, hasSelected: false, itemCount: -1 };
      try {
        var ng = window.angular;
        if (ng && ng.element) {
          var host = document.querySelector("md-card-content") || document.body;
          var scope = ng.element(host).scope();
          if (scope) {
            state.scopeReachable = true;
            var s = scope;
            for (var depth = 0; depth < 15 && s; depth++) {
              if (s.vm && "selecteddispense" in s.vm) {
                var sel = s.vm.selecteddispense;
                state.hasVm = true;
                state.hasSelected = !!sel;
                state.itemCount = sel && Array.isArray(sel.patientorderitems)
                  ? sel.patientorderitems.length
                  : 0;
                break;
              }
              s = s.$parent;
            }
          }
        }
      } catch (err) {
        state.error = String((err && err.message) || err);
      }

      try {
        window.postMessage(
          { source: "arcus-page-hook", type: "dispenseScope", state: state },
          window.location.origin
        );
      } catch (_) {}
      return;
    }

    if (data.type !== "requestAuth") return;
    try {
      window.postMessage(
        { source: "arcus-page-hook", type: "auth", headers: Object.assign({}, captured) },
        window.location.origin
      );
    } catch (_) {}
  });
})();
