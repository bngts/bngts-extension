// Firefox 전용 백그라운드 코드 (Event Page / Background Script)

// Firefox에서의 파티션된 쿠키 설정
// Firefox는 Total Cookie Protection을 사용하며, partitionKey 처리가 다름
const setPartitionedCookie = async (cookie, url, partitionKey) => {
  // Firefox는 firstPartyDomain을 사용
  if (cookie.firstPartyDomain != null && cookie.firstPartyDomain !== "") {
    return;
  }
  const { hostOnly, session, ...rest } = cookie;

  try {
    // Firefox에서는 partitionKey 대신 firstPartyDomain 사용
    const domain = new URL(partitionKey.topLevelSite).hostname;
    await browser.cookies.set({
      ...rest,
      sameSite: "no_restriction",
      secure: true,
      url,
      firstPartyDomain: domain,
    });
  } catch (e) {
    // firstPartyDomain이 지원되지 않는 경우 기본 방식으로 설정
    try {
      await browser.cookies.set({
        ...rest,
        sameSite: "no_restriction",
        secure: true,
        url,
      });
    } catch {}
  }
};

// 초기화
const init = async () => {
  const granted = await checkPermission();
  if (!granted) {
    return;
  }
  for (const { name, url } of COOKIES) {
    const cookie = await browser.cookies.get({ name, url });
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

// 이벤트 리스너 등록 (Background Script)
browser.runtime.onInstalled.addListener(init);
browser.runtime.onStartup.addListener(init);
browser.runtime.onInstalled.addListener(initBadge);
browser.runtime.onStartup.addListener(initBadge);

browser.permissions.onRemoved.addListener(checkPermission);

// 알람 설정 (5분 간격)
browser.alarms.create("checkLiveStatus", { periodInMinutes: 5 });

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkLiveStatus") {
    updateLiveStatusCache();
  }
});

browser.storage.local.onChanged.addListener((changes) => {
  if (changes.liveStatusCache != null) {
    updateBadge();
  }
});

browser.notifications.onClicked.addListener(handleNotificationClick);

browser.cookies.onChanged.addListener((changeInfo) => {
  handleCookieChange(changeInfo, setPartitionedCookie);
});
