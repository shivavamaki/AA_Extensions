"use strict";
// Settings live in this Chrome profile only. Session bindings prevent duplicate
// tabs from sharing a saved profile; the opaque page token supports tab reload.
(() => {
  const BINDING = "arcusTabBinding:";
  const PROFILE = "arcusTabProfile:";
  let queue = Promise.resolve();
  const enqueue = (work) => {
    const result = queue.then(work);
    queue = result.catch(() => {});
    return result;
  };
  const validToken = (value) => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);

  async function handle(message, sender) {
    const tabId = sender.tab?.id;
    if (!Number.isInteger(tabId) || (sender.frameId != null && sender.frameId !== 0)) {
      throw new Error("Tab settings require a top-frame tab sender");
    }
    const bindingKey = BINDING + tabId;
    let token = (await chrome.storage.session.get(bindingKey))[bindingKey];
    if (message.type === "tabSettingsInit") {
      if (!token) {
        const bindings = await chrome.storage.session.get(null);
        const candidate = message.token;
        const owned = Object.entries(bindings).some(([key, value]) =>
          key.startsWith(BINDING) && value === candidate);
        token = validToken(candidate) && !owned ? candidate : crypto.randomUUID();
        await chrome.storage.session.set({ [bindingKey]: token });
      }
      return { ok: true, token };
    }
    if (!token) throw new Error("Tab settings not initialized");
    const key = PROFILE + token;
    const values = (await chrome.storage.local.get(key))[key] || {};
    if (message.type === "tabSettingsSet") {
      const patch = message.values;
      if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
          Object.keys(patch).some((name) => !name.startsWith("arcus"))) {
        throw new Error("Invalid tab settings");
      }
      await chrome.storage.local.set({ [key]: { ...values, ...patch } });
      return { ok: true };
    }
    return { ok: true, values };
  }

  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!["tabSettingsInit", "tabSettingsGet", "tabSettingsSet"].includes(message?.type)) return false;
    enqueue(() => handle(message, sender)).then(respond,
      (error) => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    // Keep local profile for Chrome's restore-closed-tab / session restore.
    enqueue(() => chrome.storage.session.remove(BINDING + tabId)).catch((error) => {
      console.warn("[Arcus settings] Tab cleanup failed:", error.message);
    });
  });
})();

