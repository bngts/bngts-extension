// 공통 상수 및 설정
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
  { topLevelSite: "http://localhost:50001" },
];

const API_BASE = "https://bngts.com/api";
const PLATFORM_MAP = { soop: "s", chzzk: "c" };
const CHECK_INTERVAL = 5 * 60 * 1000; // 5분

// 브라우저 API 추상화 (Chrome은 chrome, Firefox는 browser 사용 가능하지만 chrome도 지원)
const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// 공통 함수들
const checkPermission = async () => {
  const granted = await browserAPI.permissions.contains({
    origins: [
      "*://*.mul.live/*",
      "*://*.bngts.com/*",
      "*://*.naver.com/*",
      "*://*.chzzk.naver.com/*",
      "*://*.sooplive.co.kr/*",
      "*://localhost:50001/*",
    ],
  });
  if (!granted) {
    browserAPI.tabs.create({
      url: browserAPI.runtime.getURL("permission.html"),
    });
  }
  return granted;
};

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
  const { liveStatusCache } = await browserAPI.storage.local.get({ liveStatusCache: {} });
  const liveCount = Object.values(liveStatusCache).filter((s) => s?.is_live === true).length;

  browserAPI.action.setBadgeBackgroundColor({ color: liveCount > 0 ? "#f59e0b" : "#737373" });
  browserAPI.action.setBadgeText({ text: liveCount > 0 ? `${liveCount}` : "" });
};

const sendLiveNotification = async (streamerId, streamerInfo) => {
  const { settings, data, notificationHistory = [] } = await browserAPI.storage.local.get({
    settings: { notification: false, tooltip: true },
    data: {},
    notificationHistory: [],
  });

  // 전역 알림 설정 확인
  if (!settings.notification) return;

  // 스트리머별 알림 설정 확인
  if (data[streamerId]?.notificationEnabled === false) return;

  const nick = data[streamerId]?.nick || streamerInfo.user_nick || streamerId;
  const platform = streamerId.startsWith("c:") ? "치지직" : "SOOP";

  // 브라우저 알림 보내기
  browserAPI.notifications.create(`live-${streamerId}`, {
    type: "basic",
    iconUrl: "icon128.png",
    title: `${nick} 방송 시작!`,
    message: streamerInfo.broad_title || `${platform}에서 방송을 시작했습니다.`,
    priority: 2,
  });

  // 알림 히스토리에 저장
  const newNotification = {
    id: `${streamerId}-${Date.now()}`,
    streamerId,
    streamerName: nick,
    title: streamerInfo.broad_title || `${platform}에서 방송을 시작했습니다.`,
    timestamp: Date.now(),
    read: false,
  };

  // 최대 50개 유지
  const updatedHistory = [newNotification, ...notificationHistory].slice(0, 50);
  await browserAPI.storage.local.set({ notificationHistory: updatedHistory });
};

const updateLiveStatusCache = async () => {
  const { streams, liveStatusCache: prevCache } = await browserAPI.storage.local.get({
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

    await browserAPI.storage.local.set({ liveStatusCache });
    await updateBadge();
  }
};

// 알림 클릭 핸들러
const handleNotificationClick = (notificationId) => {
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

    browserAPI.tabs.create({ url });
    browserAPI.notifications.clear(notificationId);
  }
};

// 쿠키 변경 핸들러
const handleCookieChange = async ({ cookie, removed }, setPartitionedCookieFn) => {
  if (removed) {
    return;
  }
  const c = COOKIES.find(
    ({ name, domain }) => cookie.name === name && cookie.domain === domain
  );
  if (c != null) {
    for (const partitionKey of partitionKeys) {
      await setPartitionedCookieFn(cookie, c.url, partitionKey);
    }
  }
};
