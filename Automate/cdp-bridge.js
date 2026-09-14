"use strict";

// ── Arcus CDP Bridge ────────────────────────────────────────────────────
//
// Runs in the service worker. Owns chrome.debugger attachments and exposes a
// small message API to content scripts.
//
// Why CDP: content scripts can only fire synthetic MouseEvents (isTrusted:false)
// and can only *guess* when Angular has settled, which is why the DOM engine is
// littered with sleep(1800). Through the debugger we get genuinely trusted input
// and a live Network feed, so a step ends the moment its XHR resolves instead of
// when a hardcoded timer expires.

const PROTOCOL_VERSION = "1.3";

/**
 * @typedef {Object} Session
 * @property {number}  tabId
 * @property {boolean} attached
 * @property {Set<string>} inflight        Network requestIds currently open
 * @property {number}  lastActivityAt      Epoch ms of the last network transition
 * @property {Array<{resolve:Function, idleMs:number, timer:number}>} idleWaiters
 */

/** @type {Map<number, Session>} */
const sessions = new Map();

// Requests that never signal "the app did something" — polling, telemetry,
// fonts and images would otherwise keep the network permanently non-idle.
const IGNORED_URL_PATTERNS = [
  /\/heartbeat/i,
  /\/ping\b/i,
  /google-analytics|googletagmanager|doubleclick/i,
  /\.(?:png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|css)(?:\?|$)/i,
];

function isIgnorableRequest(url) {
  const value = url || "";
  return IGNORED_URL_PATTERNS.some((re) => re.test(value));
}

// ── Attach / detach ──────────────────────────────────────────────────────

function getSession(tabId) {
  return sessions.get(tabId) || null;
}

function newSession(tabId) {
  const session = {
    tabId,
    attached: false,
    inflight: new Set(),
    lastActivityAt: Date.now(),
    idleWaiters: [],
  };
  sessions.set(tabId, session);
  return session;
}

function sendCommand(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(method + ": " + err.message));
      else resolve(result);
    });
  });
}

async function attach(tabId) {
  const existing = getSession(tabId);
  if (existing && existing.attached) return { ok: true, alreadyAttached: true };

  const session = existing || newSession(tabId);

  await new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, PROTOCOL_VERSION, () => {
      const err = chrome.runtime.lastError;
      // Another client (a real DevTools window) already owns this tab.
      if (err) reject(new Error(err.message));
      else resolve();
    });
  });

  session.attached = true;

  // Network gives us the settle signal; Page gives us navigation boundaries;
  // Runtime is needed for evaluate(). DOM is deliberately NOT enabled — it
  // streams every mutation of an AngularJS digest and is pure overhead here.
  await sendCommand(tabId, "Network.enable", {});
  await sendCommand(tabId, "Page.enable", {});
  await sendCommand(tabId, "Runtime.enable", {});

  return { ok: true, alreadyAttached: false };
}

function releaseWaiters(session, reason) {
  session.idleWaiters.splice(0).forEach((waiter) => {
    clearTimeout(waiter.timer);
    waiter.resolve({ ok: false, reason });
  });
}

async function detach(tabId) {
  const session = getSession(tabId);
  if (!session || !session.attached) {
    sessions.delete(tabId);
    return { ok: true };
  }

  // Release every pending waiter so callers do not hang on a dead session.
  releaseWaiters(session, "detached");

  await new Promise((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      void chrome.runtime.lastError; // detaching an already-dead tab is fine
      resolve();
    });
  });

  sessions.delete(tabId);
  return { ok: true };
}

// ── Network activity tracking ────────────────────────────────────────────

function settleIdleWaiters(session) {
  if (session.inflight.size > 0) return;

  session.idleWaiters.slice().forEach((waiter) => {
    const quietFor = Date.now() - session.lastActivityAt;
    if (quietFor < waiter.idleMs) return;
    const index = session.idleWaiters.indexOf(waiter);
    if (index >= 0) session.idleWaiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve({ ok: true, quietFor });
  });
}

// The quiet period has to be re-checked on a timer as well as on events:
// when the last response lands, no further event arrives to trigger the check.
let idleTicker = null;

function ensureIdleTicker() {
  if (idleTicker) return;
  idleTicker = setInterval(() => {
    let anyWaiting = false;
    sessions.forEach((session) => {
      if (session.idleWaiters.length) {
        anyWaiting = true;
        settleIdleWaiters(session);
      }
    });
    if (!anyWaiting) {
      clearInterval(idleTicker);
      idleTicker = null;
    }
  }, 25);
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const session = getSession(source.tabId);
  if (!session) return;

  if (method === "Network.requestWillBeSent") {
    if (isIgnorableRequest(params && params.request && params.request.url)) return;
    session.inflight.add(params.requestId);
    session.lastActivityAt = Date.now();
    return;
  }

  if (method === "Network.loadingFinished" || method === "Network.loadingFailed") {
    if (session.inflight.delete(params.requestId)) {
      session.lastActivityAt = Date.now();
      settleIdleWaiters(session);
    }
    return;
  }

  // A main-frame navigation invalidates every id we were tracking.
  if (method === "Page.frameNavigated" && params && params.frame && !params.frame.parentId) {
    session.inflight.clear();
    session.lastActivityAt = Date.now();
  }
});

chrome.debugger.onDetach.addListener((source) => {
  const session = getSession(source.tabId);
  if (!session) return;
  session.attached = false;
  releaseWaiters(session, "detached");
  sessions.delete(source.tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
});

/**
 * Resolve once no tracked request has been open for `idleMs`.
 * This is the replacement for `await sleep(1800)`.
 */
function waitForNetworkIdle(tabId, options) {
  const opts = options || {};
  const idleMs = opts.idleMs == null ? 220 : opts.idleMs;
  const timeoutMs = opts.timeoutMs == null ? 15000 : opts.timeoutMs;

  const session = getSession(tabId);
  if (!session || !session.attached) {
    return Promise.resolve({ ok: false, reason: "not attached" });
  }

  // Already quiet for long enough — resolve without yielding a frame.
  const quietFor = Date.now() - session.lastActivityAt;
  if (session.inflight.size === 0 && quietFor >= idleMs) {
    return Promise.resolve({ ok: true, quietFor });
  }

  return new Promise((resolve) => {
    const waiter = { resolve, idleMs, timer: 0 };
    waiter.timer = setTimeout(() => {
      const index = session.idleWaiters.indexOf(waiter);
      if (index >= 0) session.idleWaiters.splice(index, 1);
      // A timeout is not fatal: the caller falls back to polling the DOM.
      resolve({ ok: false, reason: "timeout", inflight: session.inflight.size });
    }, timeoutMs);
    session.idleWaiters.push(waiter);
    ensureIdleTicker();
  });
}

// ── Trusted input ────────────────────────────────────────────────────────

/**
 * Click at viewport coordinates with real, trusted input events.
 * Angular Material ripples and md-dialog focus traps behave correctly here,
 * which synthetic MouseEvents cannot guarantee.
 */
async function trustedClick(tabId, x, y, options) {
  const opts = options || {};
  const base = {
    x: Math.round(x),
    y: Math.round(y),
    button: opts.button || "left",
    clickCount: opts.clickCount || 1,
    buttons: 1,
  };

  // Move first, so hover-gated controls (md-tooltip, ng-show on hover) are in
  // their active state before the press lands.
  await sendCommand(tabId, "Input.dispatchMouseEvent",
    Object.assign({}, base, { type: "mouseMoved", buttons: 0, clickCount: 0 }));
  await sendCommand(tabId, "Input.dispatchMouseEvent",
    Object.assign({}, base, { type: "mousePressed" }));
  await sendCommand(tabId, "Input.dispatchMouseEvent",
    Object.assign({}, base, { type: "mouseReleased" }));
  return { ok: true };
}

async function trustedType(tabId, text) {
  const value = String(text == null ? "" : text);
  for (const char of value) {
    await sendCommand(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      text: char,
      unmodifiedText: char,
    });
    await sendCommand(tabId, "Input.dispatchKeyEvent", { type: "keyUp", text: char });
  }
  return { ok: true };
}

async function trustedKey(tabId, msg) {
  const vk = msg.windowsVirtualKeyCode == null ? msg.keyCode : msg.windowsVirtualKeyCode;
  const params = {
    key: msg.key,
    code: msg.code || msg.key,
    windowsVirtualKeyCode: vk,
    nativeVirtualKeyCode: vk,
  };
  await sendCommand(tabId, "Input.dispatchKeyEvent",
    Object.assign({}, params, { type: "rawKeyDown" }));
  await sendCommand(tabId, "Input.dispatchKeyEvent",
    Object.assign({}, params, { type: "keyUp" }));
  return { ok: true };
}

async function trustedScroll(tabId, msg) {
  await sendCommand(tabId, "Input.dispatchMouseEvent", {
    type: "mouseWheel",
    x: Math.round(msg.x),
    y: Math.round(msg.y),
    deltaX: 0,
    deltaY: msg.deltaY == null ? 600 : msg.deltaY,
    pointerType: "mouse",
  });
  return { ok: true };
}

// ── Batched evaluation ───────────────────────────────────────────────────

/**
 * Run an expression in the page's main world and return a structured clone of
 * the result. One round trip replaces N content-script DOM reads, which is what
 * makes the scrapers fast: the per-row layout work happens inside the page.
 */
async function evaluate(tabId, expression, options) {
  const opts = options || {};
  const result = await sendCommand(tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: !!opts.awaitPromise,
    timeout: opts.timeoutMs == null ? 10000 : opts.timeoutMs,
    includeCommandLineAPI: false,
  });

  if (result && result.exceptionDetails) {
    const details = result.exceptionDetails;
    const text = (details.exception && details.exception.description)
      || details.text
      || "evaluate threw";
    return { ok: false, error: text };
  }
  return { ok: true, value: result && result.result ? result.result.value : undefined };
}

// ── Message API ──────────────────────────────────────────────────────────

const HANDLERS = {
  cdpAttach(_msg, tabId) {
    return attach(tabId);
  },

  cdpDetach(_msg, tabId) {
    return detach(tabId);
  },

  async cdpStatus(_msg, tabId) {
    const session = getSession(tabId);
    return {
      ok: true,
      attached: !!(session && session.attached),
      inflight: session ? session.inflight.size : 0,
    };
  },

  cdpWaitNetworkIdle(msg, tabId) {
    return waitForNetworkIdle(tabId, { idleMs: msg.idleMs, timeoutMs: msg.timeoutMs });
  },

  cdpClick(msg, tabId) {
    return trustedClick(tabId, msg.x, msg.y, {
      button: msg.button,
      clickCount: msg.clickCount,
    });
  },

  cdpType(msg, tabId) {
    return trustedType(tabId, msg.text);
  },

  cdpKey(msg, tabId) {
    return trustedKey(tabId, msg);
  },

  cdpScroll(msg, tabId) {
    return trustedScroll(tabId, msg);
  },

  cdpEvaluate(msg, tabId) {
    return evaluate(tabId, msg.expression, {
      awaitPromise: msg.awaitPromise,
      timeoutMs: msg.timeoutMs,
    });
  },

  /**
   * Click an element then wait for the resulting network burst to settle, in a
   * single round trip. This is the workhorse the automation loop calls.
   */
  async cdpClickAndSettle(msg, tabId) {
    const clicked = await trustedClick(tabId, msg.x, msg.y, {});
    if (!clicked.ok) return clicked;
    const idle = await waitForNetworkIdle(tabId, {
      idleMs: msg.idleMs == null ? 220 : msg.idleMs,
      timeoutMs: msg.timeoutMs == null ? 15000 : msg.timeoutMs,
    });
    return { ok: true, settled: idle.ok, settleReason: idle.reason };
  },
};

/** Dispatch a bridge message. Returns false when the type is not ours. */
function handleBridgeMessage(message, sender, sendResponse) {
  const handler = HANDLERS[message && message.type];
  if (!handler) return false;

  const tabId = sender.tab ? sender.tab.id : message.tabId;

  if (typeof tabId !== "number") {
    sendResponse({ ok: false, error: "no tabId" });
    return true;
  }

  Promise.resolve()
    .then(() => handler(message, tabId))
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ ok: false, error: (err && err.message) || String(err) }));

  return true; // async response
}

chrome.runtime.onMessage.addListener(handleBridgeMessage);

self.ArcusCdpBridge = { attach, detach, sessions, handleBridgeMessage };
