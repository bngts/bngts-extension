/* Popup-only: one notice with branded links, never an embedded login form. */
(() => {
  const destinations = {
    "soop-login": {
      brand: "soop",
      logo: "brand/soop.svg",
      alt: "SOOP",
      label: "로그인",
      href: "https://login.sooplive.com/afreeca/login.php",
    },
    "chzzk-login": {
      brand: "chzzk",
      logo: "brand/chzzk.png",
      alt: "치지직",
      label: "치지직 로그인",
      href: "https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fchzzk.naver.com%2F",
    },
  };

  function render(container, alerts) {
    const keys = Object.keys(destinations).filter((key) =>
      alerts.some((alert) => alert.key === key)
    );
    const signature = keys.join(":");
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    if (!keys.length) {
      container.replaceChildren();
      return;
    }
    const notice = document.createElement("div");
    notice.className = "bngts-login-notice";
    for (const key of keys) {
      const target = destinations[key];
      const link = document.createElement("a");
      link.className = `bngts-login-link is-${target.brand}`;
      link.href = target.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", `${target.alt} 공식 사이트에서 로그인 (새 탭)`);
      const row = document.createElement("span");
      row.className = "bngts-login-brand";
      const logo = document.createElement("img");
      logo.src = target.logo;
      logo.alt = target.brand === "soop" ? target.alt : "";
      logo.width = target.brand === "soop" ? 60 : 24;
      logo.height = target.brand === "soop" ? 29 : 24;
      const label = document.createElement("span");
      label.textContent = target.label;
      const arrow = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      arrow.setAttribute("viewBox", "0 0 24 24");
      arrow.setAttribute("fill", "none");
      arrow.setAttribute("stroke", "currentColor");
      arrow.setAttribute("stroke-width", "2");
      arrow.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute(
        "d",
        "M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"
      );
      arrow.append(path);
      row.append(logo, label, arrow);
      const domain = document.createElement("small");
      domain.textContent = new URL(target.href).hostname;
      link.append(row, domain);
      notice.append(link);
    }
    container.replaceChildren(notice);
  }
  globalThis.BngtsLoginUI = { render };
})();
