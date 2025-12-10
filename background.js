const COOKIES = [
  {
    name: "NID_AUT",
    domain: ".naver.com",
    url: "https://nid.naver.com/nidlogin.login",
  },
  {
    name: "NID_SES",
    domain: ".naver.com",
    url: "https://nid.naver.com/nidlogin.login",
  },
  {
    name: "AuthTicket",
    domain: ".sooplive.co.kr",
    url: "https://login.sooplive.co.kr/app/LoginAction.php",
  },
  {
    name: "UserTicket",
    domain: ".sooplive.co.kr",
    url: "https://login.sooplive.co.kr/app/LoginAction.php",
  },
  {
    name: "isBbs",
    domain: ".sooplive.co.kr",
    url: "https://login.sooplive.co.kr/app/LoginAction.php",
  },
];
const partitionKeys = [
  { topLevelSite: "https://mul.live" },
  { topLevelSite: "https://bngts.com" },
];

const init = async () => {
  const granted = await checkPermission();
  if (!granted) {
    return;
  }
  for (const { name, url } of COOKIES) {
    const cookie = await chrome.cookies.get({ name, url });
    if (cookie != null) {
      for (const partitionKey of partitionKeys) {
        await setPartitonedCookie(cookie, url, partitionKey);
      }
    }
  }
};

const checkPermission = async () => {
  const granted = await chrome.permissions.contains({
    origins: [
      "*://*.mul.live/*",
      "*://*.bngts.com/*",
      "*://*.naver.com/*",
      "*://*.chzzk.naver.com/*",
      "*://*.sooplive.co.kr/*",
    ],
  });
  if (!granted) {
    chrome.tabs.create({
      url: chrome.runtime.getURL("permission.html"),
    });
  }
  return granted;
};

const setPartitonedCookie = async (cookie, url, partitionKey) => {
  if (cookie.partitionKey != null) {
    return;
  }
  const { hostOnly, session, ...rest } = cookie;
  await chrome.cookies.set({
    ...rest,
    sameSite: chrome.cookies.SameSiteStatus.NO_RESTRICTION,
    secure: true,
    url,
    partitionKey,
  });
};

chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

chrome.permissions.onRemoved.addListener(checkPermission);

const API_BASE = "https://bngts.com/api";
const PLATFORM_MAP = { soop: "s", chzzk: "c" };
const CHECK_INTERVAL = 5 * 60 * 1000; // 5분

const fetchLiveStatus = async (streamerIds) => {
  if (streamerIds.length === 0) return {};
  try {
    const res = await fetch(
      `${API_BASE}/streamers?ids=${streamerIds.map(encodeURIComponent).join(",")}&limit=50`
    );
    if (!res.ok) return {};
    const json = await res.json();
    const statusMap = {};
    for (const streamer of json.data || []) {
      const key = PLATFORM_MAP[streamer.platform] + ":" + streamer.streamer_id;
      statusMap[key] = {
        is_live: streamer.is_live,
        broad_title: streamer.broad_title,
        thumbnail_url: streamer.thumbnail_url,
        current_viewers: streamer.current_viewers,
        user_nick: streamer.user_nick,
      };
    }
    return statusMap;
  } catch {
    return {};
  }
};

const updateBadge = async () => {
  const { liveStatusCache } = await chrome.storage.local.get({ liveStatusCache: {} });
  const liveCount = Object.values(liveStatusCache).filter((s) => s?.is_live === true).length;

  chrome.action.setBadgeBackgroundColor({ color: liveCount > 0 ? "#f59e0b" : "#737373" });
  chrome.action.setBadgeText({ text: liveCount > 0 ? `${liveCount}` : "" });
};

const sendLiveNotification = async (streamerId, streamerInfo) => {
  const { settings, data } = await chrome.storage.local.get({
    settings: { notification: false, tooltip: true },
    data: {},
  });

  if (!settings.notification) return;

  const nick = data[streamerId]?.nick || streamerInfo.user_nick || streamerId;
  const platform = streamerId.startsWith("c:") ? "치지직" : "SOOP";

  chrome.notifications.create(`live-${streamerId}`, {
    type: "basic",
    iconUrl: "icon128.png",
    title: `${nick} 방송 시작!`,
    message: streamerInfo.broad_title || `${platform}에서 방송을 시작했습니다.`,
    priority: 2,
  });
};

const updateLiveStatusCache = async () => {
  const { streams, liveStatusCache: prevCache } = await chrome.storage.local.get({
    streams: [],
    liveStatusCache: {},
  });
  if (streams.length === 0) return;

  const liveStatusCache = await fetchLiveStatus(streams);
  if (Object.keys(liveStatusCache).length > 0) {
    // 새로 방송 시작한 스트리머 알림
    for (const [streamerId, info] of Object.entries(liveStatusCache)) {
      const wasLive = prevCache[streamerId]?.is_live === true;
      const isNowLive = info?.is_live === true;

      if (!wasLive && isNowLive) {
        sendLiveNotification(streamerId, info);
      }
    }

    await chrome.storage.local.set({ liveStatusCache });
    await updateBadge();
  }
};

// 알람 설정 (5분 간격)
chrome.alarms.create("checkLiveStatus", { periodInMinutes: 5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkLiveStatus") {
    updateLiveStatusCache();
  }
});

chrome.storage.local.onChanged.addListener(({ liveStatusCache }) => {
  if (liveStatusCache != null) {
    updateBadge();
  }
});

// 초기화 시 즉시 체크
const initBadge = async () => {
  await updateBadge();
  await updateLiveStatusCache();
};

chrome.runtime.onInstalled.addListener(initBadge);
chrome.runtime.onStartup.addListener(initBadge);

// 알림 클릭 시 방송 페이지로 이동
chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith("live-")) {
    const streamerId = notificationId.replace("live-", "");
    const platform = streamerId.startsWith("c:") ? "chzzk" : "soop";
    const rawId = streamerId.substring(2);

    let url;
    if (platform === "chzzk") {
      url = `https://chzzk.naver.com/live/${rawId}`;
    } else {
      url = `https://play.sooplive.co.kr/${rawId}`;
    }

    chrome.tabs.create({ url });
    chrome.notifications.clear(notificationId);
  }
});

chrome.cookies.onChanged.addListener(async ({ cookie, removed }) => {
  if (removed) {
    return;
  }
  const c = COOKIES.find(
    ({ name, domain }) => cookie.name === name && cookie.domain === domain
  );
  if (c != null) {
    for (const partitionKey of partitionKeys) {
      await setPartitonedCookie(cookie, c.url, partitionKey);
    }
  }
});
