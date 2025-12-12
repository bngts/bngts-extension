// 화질 자동 선택 (ISOLATED world에서 설정 수신)
(() => {
  // 화질 우선순위 (높은 것부터)
  const QUALITY_PRIORITY = ["1440p", "1080p", "720p", "540p", "360p"];

  let preferredQuality = "auto";
  let qualityApplied = false;

  // 설정 수신
  window.addEventListener("bngts-settings", (e) => {
    preferredQuality = e.detail?.soopQuality || "auto";
    applyQualityIfReady();
  });

  // 버튼이 사용 가능한지 확인
  const isAvailable = (btn) => {
    if (!btn) return false;
    const li = btn.closest("li");
    return li && li.style.display !== "none";
  };

  // 버튼의 화질 텍스트 가져오기
  const getQualityText = (btn) => {
    return btn?.querySelector("span")?.textContent?.trim() || "";
  };

  // 텍스트로 버튼 찾기
  const findButtonByText = (qualityBox, text) => {
    const buttons = qualityBox.querySelectorAll("ul button");
    for (const btn of buttons) {
      if (getQualityText(btn) === text && isAvailable(btn)) {
        return btn;
      }
    }
    return null;
  };

  // 화질 적용
  const applyQuality = (qualityBox) => {
    if (qualityApplied || preferredQuality === "auto") return;
    if (!QUALITY_PRIORITY.includes(preferredQuality)) return;

    // 선호 화질만 적용 (폴백 없음)
    const btn = findButtonByText(qualityBox, preferredQuality);
    if (btn && !btn.classList.contains("on")) {
      btn.click();
      qualityApplied = true;
    }
  };

  // quality_box가 준비되면 화질 적용
  const applyQualityIfReady = () => {
    const qualityBox = document.querySelector(".quality_box");
    if (qualityBox) {
      applyQuality(qualityBox);
    }
  };

  // DOM 감시하여 quality_box 등장 시 화질 적용
  const observer = new MutationObserver(() => {
    applyQualityIfReady();
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true });
  } else {
    window.addEventListener("DOMContentLoaded", () => {
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }
})();

try {
  window.parent.location.hostname;
} catch {
  const ALLOWED_ORIGINS = ["https://mul.live", "https://bngts.com"];
  const getParentOrigin = () => {
    try {
      const ref = document.referrer;
      if (ref) {
        const url = new URL(ref);
        const origin = url.origin;
        if (ALLOWED_ORIGINS.some((o) => origin === o || origin === o.replace("://", "://www."))) {
          return origin;
        }
      }
    } catch {}
    return ALLOWED_ORIGINS[0];
  };

  const style = document.createElement("style");
  style.textContent = `
.embeded_mode #webplayer.chat_open #chatting_area {
  display: none !important;
}

.embeded_mode #webplayer #player div.quality_box {
  display: block !important;
}

.popout_chat #chatting_area {
  min-width: auto !important;
}`;
  (document.head || document.documentElement).append(style);

  const params = new URLSearchParams(location.search);
  if (params.get("vtype") === "chat") {
    if (window.opener == null) {
      const id = location.pathname.split("/")[1];
      window.opener = window.parent[isNaN(Number(id)) ? id : `#${id}`];

      document.documentElement.setAttribute("dark", "true");

      window.addEventListener("DOMContentLoaded", () => {
        const modal = document.getElementById("modal");
        if (modal == null) {
          return;
        }
        const modalObserver = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const n of mutation.addedNodes) {
              if (n.querySelector?.("#layerLogin")) {
                window.open(
                  "https://login.sooplive.co.kr/afreeca/login.php",
                  "_blank"
                );
                window.parent.postMessage(
                  { cmd: "showRefreshOverlay" },
                  getParentOrigin()
                );
                return;
              }
            }
          }
        });
        modalObserver.observe(modal, { childList: true });
      });
    }
  }
}
