/* Read-only player observation. Never calls ad checks, skip, play, or QuickView takeover. */
(() => {
  const model = globalThis.BngtsPlayback;
  if (!model || !model.contextFromUrl(location.href)) return;
  let metadata = null;
  let metadataAt = 0;
  let core = null;
  let coreContent = "";
  let observed = {};
  let cleanup = [];
  let stopped = false;
  let requestSequence = 0;
  let metadataSequence = 0;

  const consumeMetadata = (response, sequence) => {
    if (sequence < metadataSequence) return;
    if (response?.result !== 1) return;
    const next = model.vodMetadata(response.data);
    if (next?.contentId !== model.contextFromUrl(location.href)?.contentId) return;
    metadata = next;
    metadataSequence = sequence;
    metadataAt = Date.now();
    publish();
  };
  const isMetadataUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      return (
        url.origin === "https://api.m.sooplive.com" && url.pathname === "/station/video/a/view"
      );
    } catch {
      return false;
    }
  };

  // Observe only the response the VOD player already requested; no new authenticated requests.
  if (location.hostname === "vod.sooplive.com") {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function (...args) {
        const responsePromise = Reflect.apply(originalFetch, this, args);
        const requestUrl =
          typeof args[0] === "string" || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
        if (isMetadataUrl(requestUrl)) {
          const sequence = ++requestSequence;
          responsePromise
            .then((response) => {
              if (!response.ok) return;
              return response
                .clone()
                .text()
                .then((body) => {
                  if (body.length < 2_000_000) consumeMetadata(JSON.parse(body), sequence);
                });
            })
            .catch(() => {});
        }
        return responsePromise;
      };
    }
    const originalOpen = XMLHttpRequest.prototype.open;
    const targets = new WeakMap();
    const installed = new WeakSet();
    XMLHttpRequest.prototype.open = function (...args) {
      const result = Reflect.apply(originalOpen, this, args);
      targets.set(this, isMetadataUrl(args[1]) ? ++requestSequence : 0);
      if (!installed.has(this)) {
        installed.add(this);
        this.addEventListener("load", () => {
          if (!targets.get(this) || this.status < 200 || this.status >= 300) return;
          try {
            if (this.responseType === "json") consumeMetadata(this.response, targets.get(this));
            else if (
              (!this.responseType || this.responseType === "text") &&
              this.responseText.length < 2_000_000
            ) {
              consumeMetadata(JSON.parse(this.responseText), targets.get(this));
            }
          } catch {}
        });
      }
      return result;
    };
  }

  function observeCore(next) {
    const content = String(next?.config?.titleNo || "");
    if (next === core && content === coreContent) return;
    for (const remove of cleanup) remove();
    cleanup = [];
    core = next;
    coreContent = content;
    observed = {};
    const events = window.AfVodPlayerCore?.Events;
    if (!next?.on || !events) return;
    const on = (name, callback) => {
      if (!events[name]) return;
      const guarded = (event) => {
        if (core === next && coreContent === content) callback(event);
      };
      next.on(events[name], guarded);
      cleanup.push(() => {
        try {
          next.off?.(events[name], guarded);
        } catch {}
      });
    };
    const roll = (event) =>
      ({ PRE: "pre", MID: "mid", POST: "post", CATCH: "catch" })[
        event?.data?.adPlayingRollType || event?.adPlayingRollType || next.adController?.rollType
      ];
    const update = (event, state) => {
      if (core !== next || coreContent !== content) return;
      const key = roll(event);
      if (key) observed[key] = state;
      publish();
    };
    on("AD_PLAYING", (event) => update(event, "playing"));
    on("AD_TIMEUPDATE", (event) => update(event, "playing"));
    on("NO_AD", (event) => update(event, "no_fill"));
    on("AD_API_ERROR", (event) => update(event, "error"));
    on("AD_BLOCK", (event) => update(event, "error"));
    on("AD_ENDED", (event) => update(event, "not_scheduled"));
    on("PLAYING", () => {
      observed = {};
      publish();
    });
    on("ENDED", () => {
      observed = {};
      publish();
    });
  }

  function publish() {
    if (stopped) return;
    try {
      const context = model.contextFromUrl(location.href);
      if (!context) return;
      let snapshot;
      if (context.kind === "live") {
        const api = window.LivePlayer?.externalInterface;
        snapshot = model.fromLive(api?.getPlayerInfo?.(), api?.getAdInfo?.(), location.href);
      } else {
        observeCore(window.vodCore);
        // Metadata is a snapshot, not a permanent subscription claim.
        const recent = Date.now() - metadataAt < 60_000 ? metadata : null;
        snapshot = model.fromVod(recent, core?.config, observed, location.href);
      }
      if (snapshot)
        window.postMessage({ type: "bngts:soop-player-snapshot", snapshot }, location.origin);
    } catch {
      // A player update may remove internal getters; unknown is safer than a false missing benefit.
      const context = model.contextFromUrl(location.href);
      if (context)
        window.postMessage(
          { type: "bngts:soop-player-snapshot", snapshot: context },
          location.origin
        );
    }
  }
  window.addEventListener("bngts:refresh-soop-player", publish);
  let timer = setInterval(publish, 2000);
  window.addEventListener("pagehide", () => {
    stopped = true;
    clearInterval(timer);
    cleanup.forEach((remove) => remove());
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    stopped = false;
    core = null;
    cleanup = [];
    timer = setInterval(publish, 2000);
    publish();
  });
  publish();
})();
