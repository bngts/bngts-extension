(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const model = globalThis.BngtsPlayback;
  if (!model?.contextFromUrl(location.href)) return;
  let lastSent = 0;
  const send = (message) => {
    try {
      Promise.resolve(api.runtime.sendMessage(message)).catch(() => {});
    } catch {}
  };
  window.addEventListener("message", (event) => {
    if (
      event.source !== window ||
      event.origin !== location.origin ||
      event.data?.type !== "bngts:soop-player-snapshot"
    )
      return;
    if (Date.now() - lastSent < 300) return;
    const snapshot = model.sanitizePlayer(event.data.snapshot, location.href);
    if (!snapshot) return;
    lastSent = Date.now();
    send({ type: "bngts:player-status", snapshot });
  });
  api.runtime.onMessage.addListener((message) => {
    if (message?.type === "bngts:refresh-player-status")
      window.dispatchEvent(new Event("bngts:refresh-soop-player"));
  });
  window.addEventListener("pagehide", () => send({ type: "bngts:player-status-remove" }));
  window.dispatchEvent(new Event("bngts:refresh-soop-player"));
})();
