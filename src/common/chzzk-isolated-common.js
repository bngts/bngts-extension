// 치지직 화질 설정 (localStorage 방식)
// Chrome/Firefox 공통 API 사용

const browserAPI = typeof browser !== "undefined" ? browser : chrome;

// 화질별 해상도 매핑
const QUALITY_MAP = {
  "1080p": { label: "1080p", width: 1920, height: 1080 },
  "720p": { label: "720p", width: 1280, height: 720 },
  "480p": { label: "480p", width: 852, height: 480 },
  "360p": { label: "360p", width: 640, height: 360 },
};

(async () => {
  const { settings } = await browserAPI.storage.local.get({
    settings: { chzzkQuality: "auto" },
  });

  const quality = settings.chzzkQuality;
  if (quality === "auto") return;

  const trackInfo = QUALITY_MAP[quality];
  if (trackInfo) {
    localStorage.setItem("live-player-video-track", JSON.stringify(trackInfo));
  }
})();
