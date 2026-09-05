(() => {
  const brands = {
    soop: { logo: "brand/soop.svg", name: "SOOP", width: 46, height: 23 },
    chzzk: { logo: "brand/chzzk.png", name: "치지직", width: 20, height: 20 },
  };

  // Branding must never make an arbitrary URL look like an official destination.
  function officialUrl(href, platform) {
    try {
      const url = new URL(href);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash)
        return null;
      if (platform === "soop" && !url.search) {
        if (
          (url.hostname === "item.sooplive.com" &&
            ["/quickview.php", "/subscription.php"].includes(url.pathname)) ||
          (url.hostname === "login.sooplive.com" && url.pathname === "/afreeca/login.php") ||
          (url.hostname === "play.sooplive.com" && /^\/[a-z0-9_-]{1,64}$/i.test(url.pathname))
        )
          return url;
      }
      if (
        platform === "chzzk" &&
        url.hostname === "nid.naver.com" &&
        url.pathname === "/nidlogin.login" &&
        [...url.searchParams.keys()].every((key) => key === "url") &&
        url.searchParams.getAll("url").length <= 1 &&
        (!url.search || url.searchParams.get("url") === "https://chzzk.naver.com/")
      )
        return new URL("https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fchzzk.naver.com%2F");
    } catch {}
    return null;
  }

  function externalIcon() {
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    for (const [name, value] of Object.entries({
      viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
      "stroke-width": "2", "aria-hidden": "true",
    })) icon.setAttribute(name, value);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5");
    icon.append(path);
    return icon;
  }

  function actionButton(label, action, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.className = className;
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await action();
      } catch {
        button.textContent = "다시 시도";
        button.title = "처리하지 못했습니다. 다시 시도해 주세요.";
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  function renderList(container, alerts, { onIgnore, onRefresh } = {}) {
    const signature = JSON.stringify(alerts);
    if (container.dataset.signature === signature) return;
    container.dataset.signature = signature;
    const items = alerts.map((alert) => {
      const item = document.createElement("article");
      item.className = `bngts-ad-item ${alert.tone === "info" ? "is-info" : "is-warning"}`;
      const brand = Object.hasOwn(brands, alert.platform) ? brands[alert.platform] : null;
      const channel = document.createElement("div");
      channel.className = "bngts-ad-channel";
      if (brand) {
        const logo = document.createElement("img");
        const api = typeof browser !== "undefined" ? browser : chrome;
        logo.src = api.runtime.getURL(brand.logo);
        logo.alt = brand.name;
        logo.width = brand.width;
        logo.height = brand.height;
        channel.append(logo);
      }
      const channelName = document.createElement("span");
      channelName.textContent = alert.channel;
      channel.append(channelName);
      const title = document.createElement("strong");
      title.textContent = alert.title;
      const description = document.createElement("p");
      description.textContent = alert.description;
      item.append(channel, title, description);
      if (alert.actions?.length || onIgnore || onRefresh) {
        const actions = document.createElement("div");
        actions.className = "bngts-ad-actions";
        for (const action of alert.actions || []) {
          const url = officialUrl(action.href, alert.platform);
          if (!brand || !url) continue;
          const link = document.createElement("a");
          link.className = `bngts-ad-official is-${alert.platform}`;
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.setAttribute("aria-label", `${brand.name} 공식 사이트: ${action.label} (새 탭)`);
          const label = document.createElement("span");
          label.className = "bngts-ad-link-label";
          const text = document.createElement("span");
          text.textContent = action.label;
          label.append(text, externalIcon());
          const domain = document.createElement("small");
          domain.textContent = url.hostname;
          link.append(label, domain);
          actions.append(link);
        }
        if (onRefresh && !alert.actions?.length)
          actions.append(actionButton("다시 확인", onRefresh));
        if (onIgnore) {
          const ignore = actionButton("무시", () => onIgnore(alert.key), "bngts-ad-ignore");
          ignore.setAttribute("aria-label", `${alert.channel} ${alert.title} 안내 무시`);
          ignore.title = container.closest("dialog")
            ? "이 알림을 다시 표시하지 않습니다."
            : "현재 시청 세션에서만 무시합니다. 탭을 닫으면 해제됩니다.";
          actions.append(ignore);
        }
        item.append(actions);
      }
      return item;
    });
    container.replaceChildren(...items);
  }

  function mountPanel(parent, stylesheet, onRefresh, onIgnore) {
    const host = document.createElement("div");
    host.id = "bngts-playback-alerts";
    const root = host.attachShadow({ mode: "open" });
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = stylesheet;
    const panel = document.createElement("section");
    panel.className = "bngts-ad-panel";
    panel.setAttribute("aria-label", "방통실 광고 안내");
    const header = document.createElement("div");
    header.className = "bngts-ad-header";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "bngts-ad-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", "bngts-ad-details");
    const dismiss = actionButton("모두 무시", () => onIgnore(null), "bngts-ad-dismiss");
    dismiss.title = "현재 시청 세션의 모든 안내 무시 · 탭을 닫으면 해제";
    dismiss.setAttribute("aria-label", dismiss.title);
    const details = document.createElement("div");
    details.id = "bngts-ad-details";
    details.hidden = true;
    const list = document.createElement("div");
    list.className = "bngts-ad-list";
    const footer = document.createElement("div");
    footer.className = "bngts-ad-footer";
    const note = document.createElement("span");
    note.textContent = "공식 사이트로 이동 · 무시는 현 세션만";
    const refresh = actionButton("다시 확인", onRefresh);
    toggle.addEventListener("click", () => {
      details.hidden = !details.hidden;
      toggle.setAttribute("aria-expanded", String(!details.hidden));
    });
    panel.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || details.hidden) return;
      details.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      toggle.focus();
      event.stopPropagation();
    });
    header.append(toggle, dismiss);
    footer.append(note, refresh);
    details.append(list, footer);
    panel.append(header, details);
    root.append(style, panel);
    parent.append(host);
    return {
      host,
      update(alerts) {
        const count = new Set(
          alerts.filter((alert) => alert.playerKey).map((alert) => alert.playerKey)
        ).size;
        toggle.textContent = count ? `광고 재생 중 · ${count}개 방송` : "광고 안내";
        renderList(list, alerts, { onIgnore, onRefresh });
      },
    };
  }
  globalThis.BngtsStatusUI = { renderList, mountPanel };
})();
