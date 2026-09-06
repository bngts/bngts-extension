// Keep multiview preferences separate from standalone CHZZK preferences.
(() => {
  if (window === window.top || location.hostname !== "chzzk.naver.com" || !/^\/(?:live|embed)\/[a-f0-9]+\/?$/i.test(location.pathname)) return;
  let parentOrigin;
  try { parentOrigin = new URL(document.referrer).origin; } catch { return; }
  if (!["https://bngts.com", "https://www.bngts.com", "http://localhost:50001"].includes(parentOrigin)) return;
  const singleton = Symbol.for("bngts.chzzkQuality");
  if (window[singleton]) return;
  window[singleton] = true;
  const tracks = {
    auto: null,
    "1080p": { label: "1080p", width: 1920, height: 1080 },
    "720p": { label: "720p", width: 1280, height: 720 },
    "480p": { label: "480p", width: 852, height: 480 },
    "360p": { label: "360p", width: 640, height: 360 },
  };
  const key = "live-player-video-track";
  const scopedKey = "bngts:chzzk-player-video-track";
  let storage, get, set, remove;
  try {
    storage = window.localStorage;
    get = Storage.prototype.getItem;
    set = Storage.prototype.setItem;
    remove = Storage.prototype.removeItem;
    for (const name of ["getItem", "setItem", "removeItem"]) {
      const original = Storage.prototype[name];
      Storage.prototype[name] = function (storageKey, ...args) {
        return Reflect.apply(original, this, [this === storage && String(storageKey) === key ? scopedKey : storageKey, ...args]);
      };
    }
  } catch { return; }
  const read = () => { try { return get.call(storage, scopedKey); } catch { return null; } };
  // The player reads the track at startup. Reload only this iframe when a new
  // selection arrives, so an already playing stream also adopts it immediately.
  let startup = read(), reloading = false;
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== "bngts:multiview-quality") return;
    const quality = event.data.quality;
    if (!Object.hasOwn(tracks, quality) || reloading) return;
    const value = tracks[quality] === null ? null : JSON.stringify(tracks[quality]);
    try {
      if (value === null) remove.call(storage, scopedKey);
      else set.call(storage, scopedKey, value);
    } catch { return; }
    if (startup !== value) { reloading = true; location.reload(); }
  });
  const ready = () => window.parent.postMessage({ type: "bngts:multiview-quality-ready" }, parentOrigin);
  window.addEventListener("pageshow", event => { if (event.persisted) ready(); });
  ready();
})();
