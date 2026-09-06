// The local SOOP agent can leave HTMLPORT unanswered when several embeds open.
// Retry the actual handshake, serially across frames, instead of reloading video.
(() => {
  if (window === window.top || location.hostname !== "play.sooplive.com") return;
  if (!/^\/[a-z0-9]+\/direct\/?$/i.test(location.pathname)) return;
  try {
    if (!["https://bngts.com", "https://www.bngts.com", "http://localhost:50001"].includes(new URL(document.referrer).origin)) return;
  } catch { return; }
  const key = Symbol.for("bngts.soopLoadingRecovery");
  if (window[key]) return;
  window[key] = true;
  let stopped = false;
  let timer = null;
  let waiting = null;
  let since = 0;
  let attempts = 0;
  let busy = false;
  const isPending = (socket, request) =>
    !stopped && socket === window.livePlayer?.streamConnector?.packageSocket &&
    socket.promiseList?.HTMLPORT === request && socket.socket?.oWS?.readyState === 1;

  const retry = async (socket, request) => {
    if (busy) return;
    busy = true;
    const run = async () => {
      if (!isPending(socket, request)) return;
      // Let SOOP's existing rejection handler choose its supported fallback when
      // the local agent remains unresponsive. Never fabricate port/auth responses.
      if (attempts >= 3) {
        await socket.close();
        return;
      }
      attempts++;
      socket.openStreamer();
      const deadline = performance.now() + 2000;
      while (isPending(socket, request) && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    };
    try {
      if (navigator.locks?.request) {
        await navigator.locks.request("bngts-soop-agent-handshake", run);
      } else {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1500));
        await run();
      }
    } catch {
      // An iframe may disappear while its handshake is queued.
    } finally {
      busy = false;
      since = performance.now();
    }
  };
  const tick = () => {
    const socket = window.livePlayer?.streamConnector?.packageSocket;
    const request = socket?.promiseList?.HTMLPORT;
    if (stopped || !request || socket.socket?.oWS?.readyState !== 1) {
      waiting = null;
      return;
    }
    if (typeof socket.openStreamer !== "function" || typeof socket.close !== "function") return;
    if (waiting !== request) {
      waiting = request;
      since = performance.now();
      attempts = 0;
    } else if (performance.now() - since >= 3000) {
      void retry(socket, request);
    }
  };
  const start = () => {
    stopped = false;
    if (timer === null) timer = setInterval(tick, 500);
  };
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(timer);
    timer = null;
    waiting = null;
  });
  window.addEventListener("pageshow", event => {
    if (event.persisted) start();
  });
  start();
})();
