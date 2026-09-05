/* Shared, side-effect-free status rules. Never infer entitlement from a missing ad. */
(() => {
  const STATES = new Set([
    "unknown",
    "exempt",
    "not_scheduled",
    "eligible",
    "playing",
    "no_fill",
    "error",
  ]);
  const QV = new Set(["unknown", "none", "basic", "plus", "plus_free", "unapplied"]);
  const PLACEMENTS = ["pre", "mid", "post", "catch", "banner"];
  const bool = (value) => (typeof value === "boolean" ? value : null);
  const id = (value) => (/^[a-z0-9_-]{1,64}$/i.test(String(value ?? "")) ? String(value) : "");
  const text = (value) =>
    typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, "").slice(0, 80) : "";
  const isPlus = (value) => value === "plus" || value === "plus_free";
  const placement = (state = "unknown") => ({ state });

  function contextFromUrl(value) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:") return null;
      const parts = url.pathname.split("/").filter(Boolean);
      if (url.hostname === "play.sooplive.com" && url.searchParams.get("vtype") !== "chat") {
        if (!id(parts[0]) || ["features", "embed", "direct"].includes(parts[0])) return null;
        return { kind: "live", streamerId: parts[0], contentId: "" };
      }
      if (url.hostname === "vod.sooplive.com" && parts[0] === "player" && /^\d+$/.test(parts[1])) {
        return { kind: "vod", streamerId: "", contentId: parts[1] };
      }
      return null;
    } catch {
      return null;
    }
  }

  function isStatusPage(value) {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" && ["bngts.com", "www.bngts.com"].includes(url.hostname)) ||
        url.origin === "http://localhost:50001"
      );
    } catch {
      return false;
    }
  }

  // Re-applied in the isolated world and background. No cookies, user IDs, tokens or URLs pass through.
  function sanitizePlayer(raw, url) {
    const context = contextFromUrl(url);
    if (!context || !raw || raw.kind !== context.kind) return null;
    if (context.kind === "live" && raw.streamerId !== context.streamerId) return null;
    if (context.kind === "vod" && String(raw.contentId) !== context.contentId) return null;
    return {
      ...context,
      streamerId: context.streamerId || id(raw.streamerId),
      contentId: context.contentId || id(raw.contentId),
      label: text(raw.label) || context.streamerId || `VOD ${context.contentId}`,
      quickview: QV.has(raw.quickview) ? raw.quickview : "unknown",
      subscribed: bool(raw.subscribed),
      loggedIn: bool(raw.loggedIn),
      mode: ["main", "embed", "dashboard", "unknown"].includes(raw.mode) ? raw.mode : "unknown",
      placements: Object.fromEntries(
        PLACEMENTS.map((key) => [
          key,
          placement(
            STATES.has(raw.placements?.[key]?.state) ? raw.placements[key].state : "unknown"
          ),
        ])
      ),
    };
  }

  function fromLive(info, ad, url) {
    const context = contextFromUrl(url);
    if (!context || context.kind !== "live") return null;
    const raw = { ...context, label: context.streamerId, placements: {} };
    if (!info || info.szBjId !== context.streamerId || !ad) return sanitizePlayer(raw, url);
    const mode = info.nQuickViewMode;
    const ready = Number(info.nBroadNo) > 0;
    raw.contentId = id(info.nBroadNo);
    raw.label = text(info.szBjNick) || context.streamerId;
    raw.quickview = ready
      ? { 0: "unapplied", 1: "basic", 2: "none", 8: "plus", 9: "plus" }[mode] || "unknown"
      : "unknown";
    raw.subscribed = ready && [0, 1].includes(info.nFollow) ? info.nFollow === 1 : null;
    raw.loggedIn = bool(info.isLogin);
    raw.mode = info.isDashBoard === true ? "dashboard" : info.isEmbed === true ? "embed" : "main";
    const rolls = { pre: "PREROLL", mid: "MIDROLL", post: "POSTROLL" };
    for (const [key, roll] of Object.entries(rolls)) {
      const active = ad.currentRollType === roll && ad.isAdViewing === true;
      const count = ad.advertiseCountShouldPlay?.[roll];
      let state = "unknown";
      // Observed playback wins over entitlement metadata (which may be stale).
      if (active) state = "playing";
      else if (ready && key === "pre" && (raw.subscribed || ["basic", "plus"].includes(raw.quickview)))
        state = "exempt";
      else if (
        ad.isAdShow === false ||
        raw.mode === "dashboard" ||
        (key === "pre" && info.bOrg === true) ||
        (key === "mid" && raw.mode === "embed")
      )
        state = "not_scheduled";
      else if (ready && typeof count === "number" && Number.isFinite(count)) {
        const completed = ad.currentRollType === roll && Number(ad.playEndedAdCount) >= count;
        if (
          count <= 0 ||
          completed ||
          (key === "mid" && info.isBreakTime !== true) ||
          (key === "post" && info.isPreBroadEnd !== true)
        )
          state = "not_scheduled";
        else if (
          ad.isAdShow === true &&
          (key !== "pre" || (raw.subscribed === false && raw.quickview !== "unknown"))
        )
          state = "eligible";
      }
      raw.placements[key] = placement(state);
    }
    return sanitizePlayer(raw, url);
  }

  function vodMetadata(data) {
    if (!data || !/^\d+$/.test(String(data.title_no))) return null;
    return {
      contentId: String(data.title_no),
      streamerId: id(data.bj_id),
      label: text(data.writer_nick),
      quickview:
        {
          NOT_USED: "none",
          QUICKVIEW: "basic",
          QUICKVIEW_PLUS: "plus",
          QUICKVIEW_PLUS_FREE: "plus_free",
        }[data.quickview] || "unknown",
      subscribed: bool(data.subscribed),
      pre: bool(data.preroll_showyn),
      mid: bool(data.midroll_showyn),
      fileType: text(data.file_type),
      ppv: bool(data.is_ppv),
      // active_subscription and midroll_no_reason are deliberately NOT entitlement signals.
    };
  }

  function fromVod(meta, config, observed, url) {
    const context = contextFromUrl(url);
    if (!context || context.kind !== "vod") return null;
    const sameContent = meta?.contentId === context.contentId;
    const sameCore = String(config?.titleNo) === context.contentId;
    const data = sameContent ? meta : {};
    const raw = {
      ...context,
      streamerId: data.streamerId || (sameCore ? id(config.bjId) : ""),
      label: data.label || (sameCore ? text(config.writerNick) : ""),
      quickview: data.quickview || "unknown",
      subscribed: data.subscribed ?? null,
      loggedIn: sameCore && typeof config.loginId === "string" ? config.loginId.length > 0 : null,
      placements: {},
      mode: sameCore ? (config.isEmbed ? "embed" : "main") : "unknown",
    };
    // Core's live-updated Plus state wins over an older metadata response.
    if (sameCore && config.isUseQuickViewPlus === true) raw.quickview = "plus";
    if (sameCore && config.isUseQuickViewPlus === false && isPlus(raw.quickview))
      raw.quickview = "unknown";
    const catchContent =
      data.fileType === "CATCH" || (sameCore && /catch/i.test(config.playerType || ""));
    const preview =
      sameCore &&
      (config.isPreview === true ||
        ["preview", "setMidroll", "setChapter"].includes(config.playerFunc));
    for (const key of PLACEMENTS) {
      const actual = sameCore ? observed?.[key] : null;
      let state = "unknown";
      if (actual && STATES.has(actual)) state = actual;
      else if (["pre", "mid"].includes(key)) {
        if (
          catchContent ||
          preview ||
          (key === "pre" && (data.ppv === true || config?.isPpv === true))
        )
          state = "not_scheduled";
        else if (data[key] === false) state = "not_scheduled";
        else if (isPlus(raw.quickview) || raw.subscribed === true) state = "exempt";
        // No forecast from showyn alone: seeking, notices, embed settings, and ad fill also apply.
      }
      raw.placements[key] = placement(state);
    }
    return sanitizePlayer(raw, url);
  }

  function playerAlerts(player) {
    const result = [];
    const qv = player.quickview;
    const sub = player.subscribed;
    const links = [
      { label: "퀵뷰 확인", href: "https://item.sooplive.com/quickview.php" },
      { label: "구독 확인", href: "https://item.sooplive.com/subscription.php" },
    ];
    for (const key of PLACEMENTS) {
      const state = player.placements?.[key]?.state;
      // Forecasts, missing login, and failed requests do not prove an ad is on screen.
      if (state !== "playing") continue;
      const isLive = player.kind === "live";
      const name = {
        pre: isLive ? "입장광고" : "VOD 시작광고",
        mid: isLive ? "쉬는시간 광고" : "VOD 중간광고",
        post: "방송 종료광고",
        catch: "Catch 광고",
        banner: "배너 광고",
      }[key];
      const alert = {
        key: `${player.kind}:${player.streamerId}:${player.contentId}:${key}`,
        playerKey: `${player.kind}:${player.streamerId}:${player.contentId}`,
        platform: "soop",
        channel: player.label,
        title: "",
        description: "",
        tone: "warning",
        actions: [],
        placement: key,
      };
      if ((isLive && ["mid", "post"].includes(key)) || ["catch", "banner"].includes(key)) {
        alert.tone = "info";
        alert.title = `${name} · 별도 광고`;
        alert.description =
          key === "mid"
            ? "LIVE 중간광고는 퀵뷰·구독의 입장광고 면제 대상이 아닙니다."
            : key === "catch"
              ? "Catch는 일반 VOD 광고와 별도입니다. 퀵뷰 플러스만으로 면제되지 않습니다."
              : key === "banner"
                ? "배너는 퀵뷰·구독의 영상광고 면제 범위에 포함되지 않습니다."
                : "방송 종료 시 별도 정책으로 표시되는 광고입니다. 이용권 부족으로 단정할 수 없습니다.";
      } else if (player.loggedIn === false) {
        alert.title = "SOOP 로그인이 적용되지 않은 재생창";
        alert.description = `${name} 재생이 확인됐습니다. 보유한 구독·퀵뷰 혜택이 있다면 공식 사이트에서 로그인해 주세요.`;
        alert.actions = [
          { label: "SOOP 로그인", href: "https://login.sooplive.com/afreeca/login.php" },
        ];
      } else if (qv === "unapplied") {
        alert.title = "퀵뷰가 이 재생창에 적용되지 않았어요";
        alert.description = `${name} 재생이 확인됐습니다. 다른 기기의 퀵뷰 사용 상태를 확인해 주세요.`;
        alert.actions = [
          { label: "공식 방송에서 확인", href: `https://play.sooplive.com/${player.streamerId}` },
        ];
      } else if (sub === false && qv === "none") {
        alert.title = "이 방송 미구독 · 퀵뷰 미적용";
        alert.description = `${name} 재생이 확인됐습니다. ${isLive ? "현재 방송 구독 또는 퀵뷰" : "현재 방송 구독 또는 퀵뷰 플러스"}의 적용 상태를 확인해 주세요.`;
        alert.actions = links;
      } else if (!isLive && qv === "basic" && sub === false) {
        alert.title = "이 방송 미구독 · 일반 퀵뷰 적용";
        alert.description = `일반 퀵뷰는 ${name}를 면제하지 않습니다. 해당 방송 구독 또는 퀵뷰 플러스 혜택이 필요합니다.`;
        alert.actions = links;
      } else {
        alert.title = `${name} · 적용 상태 확인 필요`;
        alert.description =
          sub === true || isPlus(qv) || (isLive && qv === "basic")
            ? "확인된 혜택과 실제 광고 상태가 다릅니다. 콘텐츠의 별도 정책 또는 세션 적용 상태를 확인해 주세요."
            : "광고 재생은 확인됐지만 구독·퀵뷰 적용 상태는 확정하지 못했습니다. 이용권이 없다는 뜻은 아닙니다.";
      }
      result.push(alert);
    }
    return result;
  }

  function alertsForStatus(status) {
    if (status?.ignored?.all) return [];
    const alerts = (status?.soop?.players || []).flatMap(playerAlerts);
    // Account-only login guidance belongs to the popup, never the multiview ad panel.
    const ignored = new Set(status?.ignored?.keys || []);
    return alerts.filter((alert) => !ignored.has(alert.key));
  }

  // The extension popup is about login connectivity only, not paid benefits or ads.
  function loginAlertsForStatus(status) {
    const ignored = new Set(status?.ignored?.keys || []);
    return [
      {
        key: "soop-login",
        platform: "soop",
        channel: "SOOP",
        href: "https://login.sooplive.com/afreeca/login.php",
      },
      {
        key: "chzzk-login",
        platform: "chzzk",
        channel: "치지직",
        href: "https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fchzzk.naver.com%2F",
      },
    ]
      .filter((item) => status?.[item.platform]?.loggedIn === false && !ignored.has(item.key))
      .map((item) => ({
        key: item.key,
        channel: item.channel,
        title: "로그인 연결 확인",
        description: "로그인 쿠키가 확인되지 않습니다. 채팅 연동을 사용하려면 로그인해 주세요.",
        tone: "info",
        actions: [{ label: `${item.channel} 로그인`, href: item.href }],
      }));
  }

  globalThis.BngtsPlayback = {
    contextFromUrl,
    isStatusPage,
    sanitizePlayer,
    fromLive,
    vodMetadata,
    fromVod,
    playerAlerts,
    alertsForStatus,
    loginAlertsForStatus,
  };
})();
