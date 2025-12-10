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

chrome.storage.local.onChanged.addListener(({ streams }) => {
  if (streams != null) {
    chrome.action.setBadgeBackgroundColor({ color: "#737373" });
    chrome.action.setBadgeText({ text: `${streams.newValue.length}` });
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
