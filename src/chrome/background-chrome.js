// Chrome 전용 백그라운드 코드 (Service Worker)

// 파티션된 쿠키 설정 (Chrome 전용 기능)
const setPartitionedCookie = async (cookie, url, partitionKey) => {
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

// 초기화
const init = async () => {
  const granted = await checkPermission();
  if (!granted) {
    return;
  }
  for (const { name, url } of COOKIES) {
    const cookie = await chrome.cookies.get({ name, url });
    if (cookie != null) {
      for (const partitionKey of partitionKeys) {
        await setPartitionedCookie(cookie, url, partitionKey);
      }
    }
  }
};

// 배지 초기화
const initBadge = async () => {
  await updateBadge();
  await updateLiveStatusCache();
};

// 이벤트 리스너 등록 (Service Worker)
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
chrome.runtime.onInstalled.addListener(initBadge);
chrome.runtime.onStartup.addListener(initBadge);

chrome.permissions.onRemoved.addListener(checkPermission);

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

chrome.notifications.onClicked.addListener(handleNotificationClick);

chrome.cookies.onChanged.addListener((changeInfo) => {
  handleCookieChange(changeInfo, setPartitionedCookie);
});
