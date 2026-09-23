(() => {
  if (window.ArcusTabSettings) return;
  const TOKEN_KEY = "arcusToolkitTabProfile";
  const memory = {};
  function send(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          const error = chrome.runtime.lastError;
          if (error || !response?.ok) reject(new Error(error?.message || response?.error || "Settings unavailable"));
          else resolve(response);
        });
      } catch (error) { reject(error); }
    });
  }
  let token = null;
  try { token = sessionStorage.getItem(TOKEN_KEY); } catch (_) {}
  const ready = send({ type: "tabSettingsInit", token }).then((response) => {
    try { sessionStorage.setItem(TOKEN_KEY, response.token); } catch (_) {}
    return true;
  }).catch((error) => {
    console.warn("[Arcus settings] Using tab memory only:", error.message);
    return false;
  });
  let queue = ready;
  function schedule(work, callback, fallback) {
    const result = queue.then(work).catch((error) => {
      console.warn("[Arcus settings]", error.message);
      return fallback();
    });
    queue = result;
    if (callback) result.then(callback);
    return result;
  }
  function select(values, keys) {
    if (keys == null) return { ...values };
    if (typeof keys === "string") keys = [keys];
    const defaults = Array.isArray(keys) ? {} : keys;
    const names = Array.isArray(keys) ? keys : Object.keys(keys);
    return Object.fromEntries(names.filter((key) => key in values || key in defaults)
      .map((key) => [key, key in values ? values[key] : defaults[key]]));
  }
  window.ArcusTabSettings = {
    ready,
    async flush() {
      let pending;
      do { pending = queue; await pending; } while (pending !== queue);
    },
    get(keys, callback) {
      return schedule(async () => {
        if (await ready) Object.assign(memory, (await send({ type: "tabSettingsGet" })).values);
        return select(memory, keys);
      }, callback, () => select(memory, keys));
    },
    set(values, callback) {
      return schedule(async () => {
        Object.assign(memory, values);
        if (await ready) await send({ type: "tabSettingsSet", values });
      }, callback, () => undefined);
    },
  };
})();
