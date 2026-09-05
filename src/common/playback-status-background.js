(() => {
  const api = typeof browser !== "undefined" ? browser : chrome;
  const model = globalThis.BngtsPlayback;
  const tabs = new Map();
  const ignoredTabs = new Map();
  const IGNORE_STORAGE_KEY = "playbackIgnoredTabs";
  const POPUP_STORAGE_KEY = "playbackDismissedAlerts";
  let popupIgnored = [];
  // Session-only identifiers survive MV3 suspension, never a browser restart.
  const ignoreReady = (async () => {
    try {
      const saved = await api.storage?.session?.get(IGNORE_STORAGE_KEY);
      for (const [id, value] of Object.entries(saved?.[IGNORE_STORAGE_KEY] || {})) {
        if (Number.isInteger(Number(id)) && value && Array.isArray(value.keys))
          ignoredTabs.set(Number(id), {
            all: value.all === true,
            keys: value.keys
              .filter((key) => typeof key === "string" && key.length < 300)
              .slice(0, 128),
          });
      }
    } catch {}
  })();
  const popupReady = (async () => {
    try {
      const saved = await api.storage?.local?.get(POPUP_STORAGE_KEY);
      if (Array.isArray(saved?.[POPUP_STORAGE_KEY]))
        popupIgnored = saved[POPUP_STORAGE_KEY].filter((key) =>
          ["soop-login", "chzzk-login"].includes(key)
        );
    } catch {}
  })();
  let ignoreWrite = Promise.resolve();
  function saveIgnored() {
    const data = Object.fromEntries(ignoredTabs);
    ignoreWrite = ignoreWrite
      .catch(() => {})
      .then(() => api.storage?.session?.set({ [IGNORE_STORAGE_KEY]: data }));
    return ignoreWrite.catch(() => {});
  }
  const MAX_AGE = 12_000;
  const extensionRoot = api.runtime.getURL("");
  const trustedTab = (url) =>
    model.isStatusPage(url) ||
    !!model.contextFromUrl(url) ||
    (() => {
      try {
        return new URL(url).origin === "https://chzzk.naver.com";
      } catch {
        return false;
      }
    })();

  function remember(message, sender) {
    if (!Number.isInteger(sender.tab?.id) || !trustedTab(sender.tab.url)) return;
    const snapshot = model.sanitizePlayer(message.snapshot, sender.url);
    if (!snapshot) return;
    let frames = tabs.get(sender.tab.id);
    if (!frames) {
      frames = new Map();
      tabs.set(sender.tab.id, frames);
    }
    // Cap untrusted page traffic without retaining a user's viewing history.
    if (!frames.has(sender.frameId) && frames.size >= 32) return;
    frames.set(sender.frameId, {
      snapshot,
      url: sender.url,
      documentId: sender.documentId,
      at: Date.now(),
    });
  }

  function playersForTab(tabId) {
    const frames = tabs.get(tabId);
    if (!frames) return [];
    const unique = new Map();
    for (const [frameId, entry] of frames) {
      if (Date.now() - entry.at > MAX_AGE) {
        frames.delete(frameId);
        continue;
      }
      const player = entry.snapshot;
      const key = `${player.kind}:${player.streamerId}:${player.contentId}:${player.mode}`;
      const previous = unique.get(key);
      if (!previous || !model.playerAlerts(previous).length || model.playerAlerts(player).length)
        unique.set(key, player);
    }
    if (!frames.size) tabs.delete(tabId);
    return [...unique.values()];
  }

  async function cookieStatus(url = "https://nid.naver.com/", names = ["NID_AUT", "NID_SES"]) {
    let timer;
    try {
      const result = await Promise.race([
        Promise.all(names.map((name) => api.cookies.get({ url, name }))),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("timeout")), 2500);
        }),
      ]);
      return { loggedIn: Boolean(result[0] && result[1]) };
    } catch {
      return { loggedIn: null };
    } finally {
      clearTimeout(timer);
    }
  }

  async function getLoginStatus(sender) {
    if (sender.url !== `${extensionRoot}popup.html`) throw new Error("unsupported login origin");
    await popupReady;
    const [soop, chzzk] = await Promise.all([
      cookieStatus("https://login.sooplive.com/", ["AuthTicket", "UserTicket"]),
      cookieStatus(),
    ]);
    return { schemaVersion: 2, scope: "login-only", soop, chzzk, ignored: { keys: popupIgnored } };
  }

  async function resolveTarget(message, sender) {
    const isPopup = sender.url === `${extensionRoot}popup.html`;
    const isPage = sender.frameId === 0 && model.isStatusPage(sender.url);
    if (!isPopup && !isPage) throw new Error("unsupported status origin");
    let tabId = isPage ? sender.tab?.id : message.tabId;
    if (isPopup && !Number.isInteger(tabId)) {
      const active = await api.tabs.query({ active: true, currentWindow: true });
      tabId = active[0]?.id;
    }
    return { tabId, isPage, isPopup };
  }

  async function getStatus(message, sender) {
    const { tabId } = await resolveTarget(message, sender);
    await ignoreReady;
    await popupReady;
    // This only requests a fresh read, never reloads/takes over/changes playback.
    if (Number.isInteger(tabId)) {
      try {
        Promise.resolve(api.tabs.sendMessage(tabId, { type: "bngts:refresh-player-status" })).catch(
          () => {}
        );
      } catch {}
    }
    // Reply from the bounded cache immediately. The refresh is asynchronous; don't keep
    // a message port pending on service-worker timers during navigation/suspension.
    const players = playersForTab(tabId);
    return {
      schemaVersion: 2,
      scope: "current-tab",
      tabId,
      ignored: ignoredTabs.get(tabId) || { all: false, keys: [] },
      checkedAt: Date.now(),
      // Legacy account fields cannot predict the rights of every player in this tab.
      soop: { loggedIn: null, hasQuickView: null, players },
      // No ad observation exists for CHZZK yet; cookies are not evidence of advertising.
      chzzk: { loggedIn: null },
    };
  }

  async function changeIgnored(message, sender) {
    const isPopup = sender.url === `${extensionRoot}popup.html`;
    const { tabId } = isPopup ? {} : await resolveTarget(message, sender);
    if (!isPopup && !Number.isInteger(tabId)) throw new Error("missing tab");
    await ignoreReady;
    await popupReady;
    if (isPopup) {
      if (message.type === "bngts:restore-playback-alerts") {
        popupIgnored = [];
      } else {
        const available = ["soop-login", "chzzk-login"];
        const keys = Array.isArray(message.keys)
          ? message.keys
          : message.all
            ? available
            : [message.key];
        if (keys.length > 128 || keys.some((key) => !available.includes(key)))
          throw new Error("unknown alert");
        popupIgnored = [...new Set([...popupIgnored, ...keys])];
      }
      // Keep only acknowledgement identifiers, never player snapshots or account details.
      await api.storage?.local?.set({ [POPUP_STORAGE_KEY]: popupIgnored });
      return { ok: true };
    }
    if (message.type === "bngts:restore-playback-alerts") {
      ignoredTabs.delete(tabId);
    } else if (message.all === true) {
      ignoredTabs.set(tabId, { all: true, keys: [] });
    } else {
      const keys = playersForTab(tabId)
        .flatMap(model.playerAlerts)
        .map((alert) => alert.key);
      if (!keys.includes(message.key)) throw new Error("unknown alert");
      const ignored = ignoredTabs.get(tabId) || { all: false, keys: [] };
      ignored.keys = [...new Set([...ignored.keys, message.key])].slice(-128);
      ignoredTabs.set(tabId, ignored);
    }
    await saveIgnored();
    try {
      Promise.resolve(
        api.tabs.sendMessage(tabId, { type: "bngts:alerts-changed" }, { frameId: 0 })
      ).catch(() => {});
    } catch {}
    return { ok: true };
  }

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "bngts:get-login-status") {
      getLoginStatus(sender)
        .then((status) => sendResponse({ ok: true, status }))
        .catch(() => sendResponse({ ok: false, error: "로그인 상태를 확인하지 못했습니다." }));
      return true;
    }
    if (message?.type === "bngts:player-status") {
      remember(message, sender);
      return undefined;
    }
    if (message?.type === "bngts:player-status-remove") {
      const entry = tabs.get(sender.tab?.id)?.get(sender.frameId);
      if (entry && entry.url === sender.url && entry.documentId === sender.documentId)
        tabs.get(sender.tab.id).delete(sender.frameId);
      return undefined;
    }
    if (["bngts:ignore-playback-alert", "bngts:restore-playback-alerts"].includes(message?.type)) {
      changeIgnored(message, sender)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false, error: "안내를 변경하지 못했습니다." }));
      return true;
    }
    if (message?.type !== "bngts:get-playback-status") return undefined;
    getStatus(message, sender)
      .then((status) => sendResponse({ ok: true, status }))
      .catch(() => sendResponse({ ok: false, error: "상태를 확인하지 못했습니다." }));
    return true;
  });
  function clearTab(tabId) {
    tabs.delete(tabId);
    void ignoreReady.then(() => {
      if (ignoredTabs.delete(tabId)) return saveIgnored();
    });
  }
  api.tabs.onRemoved.addListener(clearTab);
  api.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status === "loading" || change.url) tabs.delete(tabId);
    // Reloads/internal navigation stay in the site's current viewing session.
    // Chrome omits change.url (and tab.url) outside granted hosts, including about:blank.
    // The tab snapshot is still present; leaving that readable site ends this session.
    const destination = change.url || tab?.pendingUrl || tab?.url;
    if (destination ? !model.isStatusPage(destination) : tab && change.status) clearTab(tabId);
  });
})();
