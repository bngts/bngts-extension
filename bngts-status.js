(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const model = globalThis.BngtsPlayback;
  if (!model?.isStatusPage(location.href) || window.top !== window) return;
  let panel = null;
  let pending = null;
  let lastRequest = 0;

  async function refreshStatus() {
    if (pending) await pending;
    lastRequest = 0;
    return publishStatus();
  }

  async function ignoreAlert(key) {
    const response = await api.runtime.sendMessage({
      type: "bngts:ignore-playback-alert",
      ...(key ? { key } : { all: true }),
    });
    if (!response?.ok) throw new Error("ignore failed");
    return refreshStatus();
  }

  function frameContexts() {
    const contexts = [];
    for (const frame of document.querySelectorAll("iframe[src]")) {
      try {
        const url = new URL(frame.src);
        if (url.hostname === "play.sooplive.co.kr") url.hostname = "play.sooplive.com";
        const context = model.contextFromUrl(url.href);
        if (context) contexts.push(context);
      } catch {}
    }
    return contexts;
  }

  async function publishStatus() {
    if (pending) return pending;
    if (Date.now() - lastRequest < 1000) return;
    lastRequest = Date.now();
    pending = (async () => {
      let timeout;
      try {
        const response = await Promise.race([
          api.runtime.sendMessage({
            type: "bngts:get-playback-status",
          }),
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error("timeout")), 4000);
          }),
        ]);
        if (!response?.ok || response.status?.schemaVersion !== 2) throw new Error("unavailable");
        const contexts = frameContexts();
        const status = response.status;
        status.soop.players = status.soop.players.filter((player) =>
          contexts.some(
            (context) =>
              context.kind === player.kind &&
              (context.kind === "live"
                ? context.streamerId === player.streamerId
                : context.contentId === player.contentId)
          )
        );
        const alerts = model.alertsForStatus(status);
        // Separate v2 event prevents old account-only consumers treating unknown as no benefit.
        window.postMessage(
          { type: "bngts-extension-playback-status", status, alerts },
          location.origin
        );
        if (!alerts.length) {
          panel?.host.remove();
          panel = null;
          return;
        }
        if (!panel && document.body)
          panel = globalThis.BngtsStatusUI.mountPanel(
            document.body,
            api.runtime.getURL("playback-status.css"),
            refreshStatus,
            ignoreAlert
          );
        panel?.update(alerts);
      } catch {
        panel?.host.remove();
        panel = null;
      } finally {
        clearTimeout(timeout);
      }
    })();
    try {
      await pending;
    } finally {
      pending = null;
    }
  }

  window.postMessage("mullive-extension-installed", location.origin);
  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "bngts:alerts-changed") void refreshStatus();
    return undefined;
  });
  window.addEventListener("bngts-extension-status-refresh", publishStatus);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) publishStatus();
  });
  let timer = setInterval(() => {
    if (!document.hidden) publishStatus();
  }, 4000);
  window.addEventListener("pagehide", () => clearInterval(timer));
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      timer = setInterval(() => {
        if (!document.hidden) publishStatus();
      }, 4000);
      publishStatus();
    }
  });
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", publishStatus, { once: true });
  else publishStatus();
})();
