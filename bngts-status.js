(() => {
  const browserAPI = typeof browser !== "undefined" ? browser : chrome;

  const publishStatus = () => {
    browserAPI.runtime.sendMessage({ type: "bngts:get-playback-status" }, (response) => {
      if (browserAPI.runtime.lastError) return;
      window.postMessage({
        type: "mullive-extension-status",
        status: response?.ok ? response.status : null,
        error: response?.ok ? null : response?.error || "status check failed",
      }, window.location.origin);
    });
  };

  window.postMessage("mullive-extension-installed", window.location.origin);
  publishStatus();
  window.addEventListener("bngts-extension-status-refresh", publishStatus);
})();
