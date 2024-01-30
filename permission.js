document.getElementById("grant").addEventListener("click", () => {
  chrome.permissions
    .request({
      origins: [
        "*://*.mul.live/*",
        "*://*.naver.com/*",
        "*://*.chzzk.naver.com/*",
        "*://*.afreecatv.com/*",
      ],
    })
    .then((granted) => {
      if (granted) {
        window.close();
      }
    });
});
