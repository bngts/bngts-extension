document.getElementById("grant").addEventListener("click", () => {
  chrome.permissions
    .request({
      origins: [
        "*://*.mul.live/*",
        "*://*.bngts.com/*",
        "*://*.naver.com/*",
        "*://*.chzzk.naver.com/*",
        "*://*.sooplive.co.kr/*",
        "*://*.sooplive.com/*",
        "*://ocean-archive.pages.dev/*",
      ],
    })
    .then((granted) => {
      if (granted) {
        window.close();
      }
    });
});
