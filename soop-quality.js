// Quality preferences belong to the embedding multiview, not the SOOP website.
(() => {
  if (window === window.top || location.hostname !== "play.sooplive.com" || !/^\/[a-z0-9]+\/direct\/?$/i.test(location.pathname)) return;
  let parentOrigin;
  try { parentOrigin = new URL(document.referrer).origin; } catch { return; }
  if (!["https://bngts.com", "https://www.bngts.com", "http://localhost:50001"].includes(parentOrigin)) return;
  const key = Symbol.for("bngts.soopQuality");
  if (window[key]) return;
  window[key] = true;
  const qualities = new Set(["auto", "1440p", "1080p", "720p", "540p", "360p"]);
  // SOOP's own quality buttons also write this key. Namespace those reads/writes
  // in this iframe's realm so a multiview change cannot affect standalone SOOP.
  try {
    const storage = window.localStorage;
    for (const name of ["getItem", "setItem", "removeItem"]) {
      const original = Storage.prototype[name];
      Storage.prototype[name] = function (key, ...args) {
        return Reflect.apply(original, this, [this === storage && String(key) === "quality" ? "bngts:soop-player-quality" : key, ...args]);
      };
    }
  } catch {}
  let desired = null, applied = null, appliedPreference = null, timer = null;
  const apply = () => {
    if (desired === null) return;
    const box = document.querySelector(".quality_box");
    const available = [...(box?.querySelectorAll("ul button") || [])].filter(button => {
      const item = button.closest("li");
      return item && !item.hidden && item.style.display !== "none" && !button.disabled && button.getAttribute("aria-disabled") !== "true";
    });
    const labelFor = button => button.querySelector("span")?.textContent?.trim() || "";
    let button;
    if (desired === "auto") button = available.find(button => labelFor(button) === "자동");
    else {
      const requested = parseInt(desired, 10);
      const ranked = available.map(button => ({ button, height: Number(labelFor(button).match(/(\d+)p/i)?.[1]) }))
        .filter(option => option.height > 0).sort((a, b) => b.height - a.height);
      // A preference is an upper bound: 1440p on a 1080p broadcast selects
      // 1080p, including when that broadcast is already playing at 720p.
      button = (ranked.find(option => option.height <= requested) || ranked.at(-1))?.button;
    }
    if (!button) return;
    if (button === applied && desired === appliedPreference) return;
    applied = button;
    appliedPreference = desired;
    if (!button.classList.contains("on")) button.click();
  };
  const schedule = () => {
    if (timer !== null || desired === null) return;
    timer = setTimeout(() => { timer = null; apply(); }, 100);
  };
  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== parentOrigin || event.data?.type !== "bngts:multiview-quality") return;
    if (!qualities.has(event.data.quality)) return;
    desired = event.data.quality;
    apply();
  });
  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => mutation.target.closest?.(".quality_box") ||
      [...mutation.addedNodes].some(node => node.matches?.(".quality_box") || node.querySelector?.(".quality_box")))) schedule();
  });
  const observe = () => observer.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden", "disabled", "aria-disabled"] });
  observe();
  const ready = () => window.parent.postMessage({ type: "bngts:multiview-quality-ready" }, parentOrigin);
  window.addEventListener("pagehide", () => { observer.disconnect(); clearTimeout(timer); timer = null; });
  window.addEventListener("pageshow", event => {
    if (event.persisted) { observe(); apply(); ready(); }
  });
  ready();
})();
