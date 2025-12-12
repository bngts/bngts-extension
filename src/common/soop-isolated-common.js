// SOOP 화질 설정 전달 (ISOLATED world → MAIN world)
// Chrome/Firefox 공통 API 사용

const browserAPI = typeof browser !== "undefined" ? browser : chrome;

(async () => {
  const { settings } = await browserAPI.storage.local.get({
    settings: { soopQuality: "auto" },
  });

  // MAIN world로 설정 전달 (CustomEvent)
  window.dispatchEvent(
    new CustomEvent("bngts-settings", {
      detail: { soopQuality: settings.soopQuality },
    })
  );
})();
