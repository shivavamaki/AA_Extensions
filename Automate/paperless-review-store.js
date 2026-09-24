"use strict";
(() => {
  const KEY = "paperless.review.sessions";
  let queue = Promise.resolve();
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type !== "paperlessReviewSave") return false;
    const work = queue.then(async () => {
      const snapshot = message.snapshot;
      if (!Number.isInteger(sender.tab?.id) || (sender.frameId ?? 0) !== 0 ||
          !sender.tab.url?.startsWith("https://arcusair.bdms.co.th/") ||
          !snapshot || !/^[a-f0-9-]{36}$/.test(snapshot.sessionId) ||
          !Array.isArray(snapshot.events)) throw Error("Invalid checker snapshot");
      const stored = (await chrome.storage.local.get(KEY))[KEY] || [];
      const doc = {...snapshot, tabId: sender.tab.id, updatedAt: new Date().toISOString(),
        events: snapshot.events.slice(-1000)};
      const sessions = [doc, ...stored.filter(s => s.sessionId !== doc.sessionId)].slice(0, 20);
      const size = () => new TextEncoder().encode(JSON.stringify(sessions)).length;
      while (sessions.length > 1 && size() > 2000000) sessions.pop();
      while (doc.events.length && size() > 2000000) doc.events.shift();
      if (size() > 2000000) throw Error("Checker snapshot exceeds review storage limit");
      await chrome.storage.local.set({[KEY]: sessions});
      return {ok: true};
    });
    queue = work.catch(() => {});
    work.then(respond, error => respond({ok: false, error: error.message}));
    return true;
  });
})();

