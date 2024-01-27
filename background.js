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
    name: "PdboxTicket",
    domain: ".afreecatv.com",
    url: "https://login.afreecatv.com/app/LoginAction.php",
  },
  {
    name: "PdboxUser",
    domain: ".afreecatv.com",
    url: "https://login.afreecatv.com/app/LoginAction.php",
  },
];
const partitionKey = { topLevelSite: "https://mul.live" };

const setPartitonedCookie = async (cookie, url) => {
  if (cookie.partitionKey != null) {
    return;
  }
  delete cookie.hostOnly;
  delete cookie.session;
  await chrome.cookies.set({
    ...cookie,
    sameSite: chrome.cookies.SameSiteStatus.NO_RESTRICTION,
    secure: true,
    url,
    partitionKey,
  });
};

chrome.runtime.onStartup.addListener(async () => {
  for (const { name, url } of COOKIES) {
    const cookie = await chrome.cookies.get({ name, url });
    if (cookie != null) {
      await setPartitonedCookie(cookie, url);
    }
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://mul.live/" });
});

chrome.cookies.onChanged.addListener(async ({ cookie, removed }) => {
  if (removed) {
    return;
  }
  for (const { name, domain, url } of COOKIES) {
    if (
      cookie.name === name &&
      cookie.domain === domain &&
      cookie.partitionKey == null
    ) {
      await setPartitonedCookie(cookie, url);
      break;
    }
  }
});
