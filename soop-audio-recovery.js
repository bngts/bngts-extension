// Recover a stalled native audio clock without reloading the live stream.
(() => {
  if (window === window.top || location.hostname !== "play.sooplive.com") return;
  if (!/^\/[a-z0-9]+\/direct\/?$/i.test(location.pathname)) return;
  let parentOrigin;
  try {
    parentOrigin = new URL(document.referrer).origin;
  } catch {
    return;
  }
  if (!new Set(["https://bngts.com", "https://www.bngts.com", "http://localhost:50001"]).has(parentOrigin)) return;

  const key = Symbol.for("bngts.soopAudioRecovery");
  if (window[key]) return;
  window[key] = true;
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) return;

  const samples = new Map();
  const sources = new WeakMap();
  const connected = new Set();
  const attempted = new WeakSet();
  let context = null;
  let stopped = false;
  let timer = null;
  // Remember the working output path in this browser so newly added players and
  // subsequent visits do not have to freeze again before receiving the fix.
  const storageKey = "bngts:soop-web-audio";
  let preferWebAudio = false;
  try { preferWebAudio = localStorage.getItem(storageKey) === "1"; } catch {}
  const onStorage = (event) => {
    if (event.key === storageKey) preferWebAudio = event.newValue === "1";
  };

  const resume = () => {
    if (!stopped && context?.state === "suspended") context.resume().catch(() => {});
  };
  const recover = async (video) => {
    if (attempted.has(video)) return;
    attempted.add(video);
    try {
      context ||= new Context();
      // Do not divert native audio into a suspended context if autoplay is blocked.
      await context.resume();
      if (stopped || !video.isConnected || context.state !== "running") {
        attempted.delete(video);
        return;
      }
      const source = context.createMediaElementSource(video);
      source.connect(context.destination);
      sources.set(video, source);
      connected.add(video);
      preferWebAudio = true;
      try { localStorage.setItem(storageKey, "1"); } catch {}
      console.info("[방통실] 정지한 SOOP 오디오 출력을 복구했습니다.");
    } catch {
      // A different extension may already own the media element's audio source.
      // Never reload, unmute, or retry binding the same element in a loop.
    }
  };

  const hasBufferedAudio = (video) => {
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime && video.buffered.end(i) - video.currentTime >= 1) return true;
    }
    return false;
  };
  const tick = () => {
    if (stopped) return;
    const videos = new Set(document.querySelectorAll("video"));
    for (const video of samples.keys()) {
      if (!videos.has(video)) samples.delete(video);
    }
    for (const video of connected) {
      if (!videos.has(video)) {
        sources.get(video).disconnect();
        connected.delete(video);
      }
    }
    const now = performance.now();
    for (const video of videos) {
      const source = sources.get(video);
      if (source) {
        if (!connected.has(video)) {
          source.connect(context.destination);
          connected.add(video);
        }
        continue;
      }
      // Pauses, muted playback, seeks, background throttling and network starvation
      // are not an audio-clock failure. Preserve all user playback/volume choices.
      if (document.hidden || video.paused || video.ended || video.seeking || video.muted || video.volume === 0 || video.playbackRate === 0 || video.readyState < 3 || !hasBufferedAudio(video)) {
        samples.delete(video);
        continue;
      }
      if (preferWebAudio) {
        void recover(video);
        continue;
      }
      const sample = samples.get(video);
      if (!sample || now - sample.lastTick > 2500 || Math.abs(video.currentTime - sample.time) > 0.1) {
        samples.set(video, { time: video.currentTime, since: now, lastTick: now });
        continue;
      }
      sample.lastTick = now;
      if (now - sample.since >= 4000) void recover(video);
    }
  };
  const onVisibility = () => {
    samples.clear();
    if (!document.hidden) resume();
  };
  const start = () => {
    if (timer !== null) return;
    stopped = false;
    samples.clear();
    timer = setInterval(tick, 1000);
    resume();
  };
  window.addEventListener("pointerdown", resume, true);
  window.addEventListener("keydown", resume, true);
  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", (event) => {
    stopped = true;
    clearInterval(timer);
    timer = null;
    samples.clear();
    if (event.persisted) {
      context?.suspend().catch(() => {});
      return;
    }
    for (const video of connected) sources.get(video).disconnect();
    connected.clear();
    context?.close().catch(() => {});
    window.removeEventListener("pointerdown", resume, true);
    window.removeEventListener("keydown", resume, true);
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisibility);
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) start();
  });
  start();
})();
