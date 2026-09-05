(async () => {
  const API_BASE = "https://bngts.com/api";
  const MAX_STREAMERS = 50;
  const PAGE_SIZE = 5;

  const PLATFORMS = {
    s: { name: "SOOP", class: "soop" },
    c: { name: "치지직", class: "chzzk" },
    t: { name: "Twitch", class: "twitch" },
    y: { name: "YouTube", class: "youtube" },
  };

  const PLATFORM_MAP = {
    soop: "s",
    chzzk: "c",
  };

  // API 검색이 가능한 플랫폼 (방통실에 등록된 스트리머만)
  const SEARCHABLE_PLATFORMS = ["s", "c"];

  let currentPage = 0;
  let currentFilter = "all"; // all, live, offline
  let currentSort = "custom"; // custom, name, live
  let currentGroupFilter = "all"; // all, ungrouped, or group id

  // 설정 로드
  let { settings, groups, notificationHistory } = await chrome.storage.local.get({
    settings: { notification: false, viewMode: "detailed", soopQuality: "auto", chzzkQuality: "auto" },
    groups: [],
    notificationHistory: [],
  });

  const searchStreamers = async (query) => {
    if (!query || query.length < 1) return [];
    try {
      const res = await fetch(
        `${API_BASE}/streamers?search=${encodeURIComponent(query)}&limit=10`
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.data || [];
    } catch {
      return [];
    }
  };

  const fetchLiveStatus = async (streamerIds) => {
    if (streamerIds.length === 0) return {};
    try {
      const res = await fetch(`${API_BASE}/extension/streamers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: streamerIds }),
      });
      if (!res.ok) return {};
      const json = await res.json();
      const statusMap = {};
      for (const streamer of json.data || []) {
        const key = PLATFORM_MAP[streamer.platform] + ":" + streamer.streamer_id;
        statusMap[key] = {
          is_live: streamer.is_live,
          broad_title: streamer.broad_title,
          thumbnail_url: streamer.thumbnail_url,
          current_viewers: streamer.current_viewers,
          user_nick: streamer.user_nick,
        };
      }
      return statusMap;
    } catch {
      return {};
    }
  };

  const getPlatformFromId = (id) => {
    if (id.startsWith("c:")) return "c";
    if (id.startsWith("s:")) return "s";
    if (id.startsWith("t:")) return "t";
    if (id.startsWith("y:")) return "y";
    if (/^[0-9a-f]{32}$/i.test(id)) return "c";
    if (/^[a-z0-9]{3,12}$/i.test(id)) return "s";
    return null;
  };

  const getIdWithoutPrefix = (id) => {
    if (/^[csty]:/.test(id)) {
      return id.substring(2);
    }
    return id;
  };

  let { streams, data, liveStatusCache } = await chrome.storage.local.get({
    streams: [],
    data: {},
    liveStatusCache: {},
  });
  let streamsSet = new Set(streams);
  let liveStatusMap = liveStatusCache;

  const list = document.getElementById("streams");
  const soopWarning = document.getElementById("soop-warning");
  const filterSelect = document.getElementById("filter");
  const groupFilterSelect = document.getElementById("group-filter");
  const reloadBtn = document.getElementById("reload-btn");
  const toast = document.getElementById("toast");
  const playbackStatusCard = document.getElementById("playback-status-card");
  const playbackStatusList = document.getElementById("playback-status-list");
  const refreshPlaybackStatusBtn = document.getElementById("refresh-playback-status");

  let isLoading = false;

  const getCookie = (url, name) => chrome.cookies.get({ url, name });

  const getSoopAccountStatus = async () => {
    const response = await fetch("https://item.sooplive.com/quickview.php", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`SOOP status request failed: ${response.status}`);
    const html = await response.text();
    const loginMatch = html.match(/var\s+isLogin\s*=\s*['"]([^'"]*)['"]/);
    if (!loginMatch) throw new Error("SOOP login status was not found");
    const loggedIn = Boolean(loginMatch[1]);
    if (!loggedIn) return { loggedIn: false, hasQuickView: null };

    const quickViewMatch = html.match(/var\s+nQVGubun\s*=\s*parseInt\(['"](\d+)['"]\)/);
    if (!quickViewMatch) throw new Error("SOOP QuickView status was not found");
    return { loggedIn: true, hasQuickView: Number(quickViewMatch[1]) > 0 };
  };

  const renderPlaybackIssue = ({ platform, title, description, action, href }) => {
    const item = document.createElement("div");
    item.className = "playback-status-item";

    const copy = document.createElement("div");
    copy.className = "playback-status-copy";
    const heading = document.createElement("strong");
    heading.textContent = `${platform} · ${title}`;
    const detail = document.createElement("span");
    detail.textContent = description;
    copy.append(heading, detail);

    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = action;

    item.append(copy, link);
    playbackStatusList.appendChild(item);
  };

  const updatePlaybackStatus = async () => {
    refreshPlaybackStatusBtn.classList.add("loading");
    try {
      const [soopStatus, naverAuth, naverSession] = await Promise.all([
        getSoopAccountStatus(),
        getCookie("https://nid.naver.com/", "NID_AUT"),
        getCookie("https://nid.naver.com/", "NID_SES"),
      ]);

      const issues = [];
      if (!soopStatus.loggedIn) {
        issues.push({
          platform: "SOOP",
          title: "로그인 필요",
          description: "SOOP 공식 계정 응답에서 로그아웃 상태로 확인됐습니다. 채팅 로그인 연동이 되지 않습니다.",
          action: "로그인",
          href: "https://login.sooplive.com/afreeca/login.php",
        });
      } else if (soopStatus.hasQuickView === false) {
        issues.push({
          platform: "SOOP",
          title: "퀵뷰 미사용",
          description: "SOOP 공식 계정 정보상 사용 중인 퀵뷰가 없습니다. 방송 입장 영상 광고가 표시될 수 있습니다.",
          action: "퀵뷰 확인",
          href: "https://item.sooplive.com/quickview.php",
        });
      }
      if (!naverAuth || !naverSession) {
        issues.push({
          platform: "치지직",
          title: "로그인 필요",
          description: "네이버 로그인 쿠키가 없어 멀티뷰 채팅 로그인이 연동되지 않습니다.",
          action: "로그인",
          href: "https://nid.naver.com/nidlogin.login",
        });
      }
      playbackStatusList.replaceChildren();
      issues.forEach(renderPlaybackIssue);
      playbackStatusCard.classList.toggle("hidden", issues.length === 0);
    } catch {
      playbackStatusList.replaceChildren();
      renderPlaybackIssue({
        platform: "확장 프로그램",
        title: "상태 확인 실패",
        description: "로그인 연결 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        action: "방통실 열기",
        href: "https://bngts.com/multiview",
      });
      playbackStatusCard.classList.remove("hidden");
    } finally {
      refreshPlaybackStatusBtn.classList.remove("loading");
    }
  };

  refreshPlaybackStatusBtn.addEventListener("click", updatePlaybackStatus);
  updatePlaybackStatus();

  // ===== 페이지 네비게이션 =====
  const navItems = document.querySelectorAll(".nav-item");
  const pages = document.querySelectorAll(".page");

  const switchPage = (pageName) => {
    navItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.page === pageName);
    });
    pages.forEach((page) => {
      page.classList.toggle("active", page.id === `page-${pageName}`);
    });

    // 페이지별 초기화
    if (pageName === "notifications") {
      renderNotificationHistory();
      renderNotificationStreamers();
    } else if (pageName === "groups") {
      renderGroups();
    }
  };

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      switchPage(item.dataset.page);
    });
  });

  // 서브 탭 전환
  document.querySelectorAll(".sub-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const subtabId = tab.dataset.subtab;
      const parent = tab.closest(".page");

      // 탭 버튼 활성화
      parent.querySelectorAll(".sub-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      // 서브탭 콘텐츠 활성화
      parent.querySelectorAll(".subtab-content").forEach((c) => c.classList.remove("active"));
      document.getElementById(`subtab-${subtabId}`).classList.add("active");
    });
  });

  // ===== 스트리머 관리 =====

  // 멀티뷰 버튼 관련 요소 및 함수 (updateStatus에서 사용하므로 먼저 정의)
  const multiviewBtn = document.getElementById("open-multiview-selected");
  const multiviewCount = document.getElementById("multiview-count");
  const multiviewHint = document.getElementById("multiview-hint");

  const updateMultiviewButton = () => {
    const enabledStreams = [...streamsSet].filter((s) => !data[s]?.disabled);
    const count = enabledStreams.length;

    if (count > 0) {
      multiviewCount.textContent = count;
      multiviewHint.textContent = `${count}명의 스트리머로 멀티뷰 시작`;
      multiviewBtn.disabled = false;
    } else {
      multiviewCount.textContent = "";
      multiviewHint.textContent = "체크된 스트리머가 없습니다";
      multiviewBtn.disabled = true;
    }
  };

  const updateStatus = () => {
    const enabledStreams = [...streamsSet].filter((s) => !data[s]?.disabled);
    const soopCount = enabledStreams.filter((s) => getPlatformFromId(s) === "s").length;

    soopWarning.classList.toggle("show", soopCount > 4);
    document.getElementById("soop-count").textContent = soopCount;

    // 멀티뷰 버튼 상태 업데이트
    updateMultiviewButton();
  };

  document.getElementById("soop-deselect").addEventListener("click", () => {
    const soopStreams = [...streamsSet].filter((s) => getPlatformFromId(s) === "s");
    for (const s of soopStreams) {
      data[s] = { ...data[s], disabled: true };
    }
    chrome.storage.local.set({ data });
    renderStreams();
    updateStatus();
  });

  const updateFilterUI = () => {
    const isFiltered = currentFilter !== "all" || currentGroupFilter !== "all";
    const isSorted = currentSort !== "custom";

    // 필터/정렬 시 드래그 핸들 숨김
    list.classList.toggle("no-drag", isFiltered || isSorted);

    // 필터 옵션에 카운트 표시
    const liveCount = [...streamsSet].filter((s) => liveStatusMap[s]?.is_live === true).length;
    const offlineCount = streamsSet.size - liveCount;

    filterSelect.options[0].textContent = `전체 (${streamsSet.size})`;
    filterSelect.options[1].textContent = `온라인 (${liveCount})`;
    filterSelect.options[2].textContent = `오프라인 (${offlineCount})`;

    // 그룹 필터 옵션 업데이트
    updateGroupFilterOptions();
  };

  const updateGroupFilterOptions = () => {
    const currentValue = groupFilterSelect.value;
    groupFilterSelect.innerHTML = "";

    // 기본 옵션
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = `모든 그룹 (${streamsSet.size})`;
    groupFilterSelect.appendChild(allOption);

    // 그룹 없음 옵션
    const groupedStreamers = new Set();
    for (const group of groups) {
      for (const s of group.streamers) {
        if (streamsSet.has(s)) groupedStreamers.add(s);
      }
    }
    const ungroupedCount = [...streamsSet].filter((s) => !groupedStreamers.has(s)).length;

    const ungroupedOption = document.createElement("option");
    ungroupedOption.value = "ungrouped";
    ungroupedOption.textContent = `그룹 없음 (${ungroupedCount})`;
    groupFilterSelect.appendChild(ungroupedOption);

    // 각 그룹 옵션
    for (const group of groups) {
      const count = group.streamers.filter((s) => streamsSet.has(s)).length;
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = `${group.name} (${count})`;
      groupFilterSelect.appendChild(option);
    }

    // 이전 선택 유지
    if ([...groupFilterSelect.options].some((o) => o.value === currentValue)) {
      groupFilterSelect.value = currentValue;
    } else {
      groupFilterSelect.value = "all";
      currentGroupFilter = "all";
    }
  };

  const createStreamItem = (s, streamInfo = null) => {
    const platform = getPlatformFromId(s);
    const rawId = getIdWithoutPrefix(s);
    const platformInfo = PLATFORMS[platform] || { name: "?", class: "" };
    const nick = data[s]?.nick || streamInfo?.user_nick;
    const isLive = streamInfo?.is_live;
    const viewMode = settings.viewMode || "compact";

    const item = document.createElement("div");
    item.dataset.id = s;
    if (isLive) item.classList.add("live");

    if (viewMode === "detailed") {
      // 상세 뷰 (좌측 썸네일 + 우측 정보)
      const thumbnailWrapper = document.createElement("div");
      thumbnailWrapper.classList.add("stream-thumbnail-wrapper");

      if (isLive && streamInfo?.thumbnail_url) {
        const thumbnail = document.createElement("img");
        thumbnail.classList.add("stream-thumbnail");
        thumbnail.src = streamInfo.thumbnail_url;
        thumbnail.alt = "";
        thumbnail.loading = "lazy";
        thumbnailWrapper.appendChild(thumbnail);
      } else {
        const offlineText = document.createElement("div");
        offlineText.classList.add("stream-thumbnail-offline");
        offlineText.textContent = "오프라인";
        thumbnailWrapper.appendChild(offlineText);
      }

      // 체크박스 오버레이 (썸네일 좌측 하단)
      const checkboxOverlay = document.createElement("div");
      checkboxOverlay.classList.add("stream-checkbox-overlay");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !data[s]?.disabled;
      checkbox.addEventListener("change", async (e) => {
        e.stopPropagation();
        data[s] ||= {};
        data[s].disabled = !e.currentTarget.checked;
        await chrome.storage.local.set({ data });
        updateStatus();
      });
      checkboxOverlay.appendChild(checkbox);
      thumbnailWrapper.appendChild(checkboxOverlay);

      // 시청자수 오버레이 (썸네일 우측 하단, 라이브 시만)
      if (isLive && streamInfo?.current_viewers) {
        const viewersOverlay = document.createElement("div");
        viewersOverlay.classList.add("stream-viewers-overlay");
        viewersOverlay.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg><span>${streamInfo.current_viewers.toLocaleString()}</span>`;
        thumbnailWrapper.appendChild(viewersOverlay);
      }

      item.appendChild(thumbnailWrapper);

      // 삭제 버튼 오버레이 (아이템 우측 상단)
      const removeBtn = document.createElement("button");
      removeBtn.classList.add("stream-remove-btn");
      removeBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      removeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        streamsSet.delete(s);
        delete data[s];
        for (const group of groups) {
          group.streamers = group.streamers.filter((id) => id !== s);
        }
        await chrome.storage.local.set({ streams: [...streamsSet], data, groups });
        item.remove();
        updateStatus();
      });
      item.appendChild(removeBtn);

      // 우측 정보 영역
      const detailInfo = document.createElement("div");
      detailInfo.classList.add("stream-detail-info");

      // 상단 헤더 (뱃지 + 스트리머명)
      const detailHeader = document.createElement("div");
      detailHeader.classList.add("stream-detail-header");

      const badge = document.createElement("span");
      badge.classList.add("platform-badge", platformInfo.class);
      badge.textContent = platformInfo.name;
      detailHeader.appendChild(badge);

      if (isLive) {
        const liveBadge = document.createElement("span");
        liveBadge.classList.add("live-badge");
        liveBadge.textContent = "LIVE";
        detailHeader.appendChild(liveBadge);
      }

      const nameSpan = document.createElement("span");
      nameSpan.classList.add("stream-detail-title");
      nameSpan.textContent = nick || rawId;
      nameSpan.title = s;
      detailHeader.appendChild(nameSpan);

      detailInfo.appendChild(detailHeader);

      // 메타 정보 (방송 제목)
      const detailMeta = document.createElement("div");
      detailMeta.classList.add("stream-detail-meta");
      if (isLive) {
        detailMeta.classList.add("live");
        detailMeta.textContent = streamInfo?.broad_title || "";
      } else {
        detailMeta.textContent = rawId;
      }
      detailInfo.appendChild(detailMeta);

      item.appendChild(detailInfo);
    } else {
      // 컴팩트 뷰 (기존 리스트 형태)
      // 툴팁 데이터 설정
      if (streamInfo) {
        item.classList.add("has-tooltip");
        item.dataset.title = streamInfo.broad_title || "";
        item.dataset.thumbnail = streamInfo.thumbnail_url || "";
        item.dataset.viewers = streamInfo.current_viewers || 0;
        item.dataset.isLive = isLive ? "true" : "false";
      }

      const move = document.createElement("button");
      move.textContent = "\u2807";
      move.classList.add("handle");
      item.appendChild(move);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !data[s]?.disabled;
      checkbox.addEventListener("change", async (e) => {
        data[s] ||= {};
        data[s].disabled = !e.currentTarget.checked;
        await chrome.storage.local.set({ data });
        updateStatus();
      });
      item.appendChild(checkbox);

      const badge = document.createElement("span");
      badge.classList.add("platform-badge", platformInfo.class);
      badge.textContent = platformInfo.name;
      item.appendChild(badge);

      if (isLive) {
        const liveBadge = document.createElement("span");
        liveBadge.classList.add("live-badge");
        liveBadge.textContent = "LIVE";
        item.appendChild(liveBadge);
      }

      const span = document.createElement("span");
      span.classList.add("name");
      span.textContent = nick ? nick + " (" + rawId + ")" : rawId;
      span.title = s;
      item.appendChild(span);

      // 그룹 버튼
      const groupBtn = document.createElement("button");
      groupBtn.classList.add("group-btn");
      groupBtn.title = "그룹에 추가";
      const streamerGroups = groups.filter((g) => g.streamers.includes(s));
      if (streamerGroups.length > 0) {
        groupBtn.style.color = streamerGroups[0].color;
        groupBtn.title = streamerGroups.map((g) => g.name).join(", ");
      }
      groupBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`;
      groupBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        showGroupDropdown(s, groupBtn);
      });
      item.appendChild(groupBtn);

      const remove = document.createElement("button");
      remove.textContent = "\u2715";
      remove.addEventListener("click", async () => {
        streamsSet.delete(s);
        delete data[s];
        for (const group of groups) {
          group.streamers = group.streamers.filter((id) => id !== s);
        }
        await chrome.storage.local.set({ streams: [...streamsSet], data, groups });
        item.remove();
        updateStatus();
      });
      item.appendChild(remove);
    }

    return item;
  };

  const renderPagination = (filteredArray) => {
    const pagination = document.getElementById("pagination");
    const totalPages = getTotalPagesFiltered(filteredArray);

    if (totalPages <= 1) {
      pagination.classList.remove("show");
      return;
    }

    pagination.classList.add("show");
    document.getElementById("page-info").textContent = `${currentPage + 1} / ${totalPages}`;
    document.getElementById("prev-page").disabled = currentPage === 0;
    document.getElementById("next-page").disabled = currentPage >= totalPages - 1;
  };

  const getFilteredAndSortedStreams = () => {
    let streamsArray = [...streamsSet];

    // 그룹 필터 적용
    if (currentGroupFilter === "ungrouped") {
      const groupedStreamers = new Set();
      for (const group of groups) {
        for (const s of group.streamers) {
          groupedStreamers.add(s);
        }
      }
      streamsArray = streamsArray.filter((s) => !groupedStreamers.has(s));
    } else if (currentGroupFilter !== "all") {
      const group = groups.find((g) => g.id === currentGroupFilter);
      if (group) {
        const groupStreamers = new Set(group.streamers);
        streamsArray = streamsArray.filter((s) => groupStreamers.has(s));
      }
    }

    // 상태 필터 적용
    if (currentFilter === "live") {
      streamsArray = streamsArray.filter((s) => liveStatusMap[s]?.is_live === true);
    } else if (currentFilter === "offline") {
      streamsArray = streamsArray.filter((s) => liveStatusMap[s]?.is_live !== true);
    }

    // 정렬 적용
    if (currentSort === "name") {
      streamsArray.sort((a, b) => {
        const nickA = data[a]?.nick || liveStatusMap[a]?.user_nick || getIdWithoutPrefix(a);
        const nickB = data[b]?.nick || liveStatusMap[b]?.user_nick || getIdWithoutPrefix(b);
        return nickA.localeCompare(nickB, "ko");
      });
    } else if (currentSort === "live") {
      streamsArray.sort((a, b) => {
        const liveA = liveStatusMap[a]?.is_live === true ? 0 : 1;
        const liveB = liveStatusMap[b]?.is_live === true ? 0 : 1;
        return liveA - liveB;
      });
    }

    return streamsArray;
  };

  const getTotalPagesFiltered = (filteredArray) => Math.ceil(filteredArray.length / PAGE_SIZE);

  const renderStreams = () => {
    list.innerHTML = "";
    const viewMode = settings.viewMode || "compact";

    // 뷰 모드 클래스 적용
    list.classList.toggle("detailed-view", viewMode === "detailed");

    const filteredStreams = getFilteredAndSortedStreams();
    const totalPages = getTotalPagesFiltered(filteredStreams);

    if (currentPage >= totalPages && totalPages > 0) {
      currentPage = totalPages - 1;
    }
    if (currentPage < 0) currentPage = 0;

    // 빈 상태 메시지
    if (filteredStreams.length === 0 && streamsSet.size > 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.classList.add("empty-filtered");
      emptyMsg.textContent =
        currentFilter === "live"
          ? "현재 방송 중인 스트리머가 없습니다."
          : "현재 오프라인 스트리머가 없습니다.";
      list.appendChild(emptyMsg);
    } else {
      const start = currentPage * PAGE_SIZE;
      const end = start + PAGE_SIZE;
      const pageStreams = filteredStreams.slice(start, end);

      for (const s of pageStreams) {
        list.appendChild(createStreamItem(s, liveStatusMap[s]));
      }
    }

    renderPagination(filteredStreams);
    updateFilterUI();
  };

  const updateLiveStatus = async () => {
    if (isLoading) return;

    isLoading = true;
    reloadBtn.disabled = true;
    reloadBtn.classList.add("loading");
    toast.classList.add("show");

    try {
      const ids = [...streamsSet];
      liveStatusMap = await fetchLiveStatus(ids);
      await chrome.storage.local.set({ liveStatusCache: liveStatusMap });
      renderStreams();
    } finally {
      isLoading = false;
      reloadBtn.disabled = false;
      reloadBtn.classList.remove("loading");
      toast.classList.remove("show");
    }
  };

  reloadBtn.addEventListener("click", updateLiveStatus);

  const addStream = async (platform, id, nick = null) => {
    if (!id.trim()) return;

    const streamId = platform + ":" + id;

    if (streamsSet.has(streamId)) {
      alert("이미 등록된 스트리머입니다.");
      return;
    }

    if (streamsSet.size >= MAX_STREAMERS) {
      alert(`스트리머는 최대 ${MAX_STREAMERS}명까지 추가할 수 있습니다.`);
      return;
    }

    streamsSet.add(streamId);
    if (nick) {
      data[streamId] = { nick };
    }
    await chrome.storage.local.set({ streams: [...streamsSet], data });

    renderStreams();
  };

  // Filter and sort event handlers
  document.getElementById("group-filter").addEventListener("change", (e) => {
    currentGroupFilter = e.target.value;
    currentPage = 0;
    renderStreams();
  });

  document.getElementById("filter").addEventListener("change", (e) => {
    currentFilter = e.target.value;
    currentPage = 0;
    renderStreams();
  });

  document.getElementById("sort").addEventListener("change", (e) => {
    currentSort = e.target.value;
    currentPage = 0;
    renderStreams();
  });

  // Pagination event handlers
  document.getElementById("prev-page").addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage--;
      renderStreams();
    }
  });

  document.getElementById("next-page").addEventListener("click", () => {
    const filteredStreams = getFilteredAndSortedStreams();
    if (currentPage < getTotalPagesFiltered(filteredStreams) - 1) {
      currentPage++;
      renderStreams();
    }
  });

  // Display version info
  const version = chrome.runtime.getManifest().version;
  document.getElementById("version").textContent = version;
  document.getElementById("version-info").textContent = version;

  // 뷰 모드 전환 버튼
  const toggleViewModeBtn = document.getElementById("toggle-view-mode");
  const viewModeIconCompact = document.getElementById("view-mode-icon-compact");
  const viewModeIconDetailed = document.getElementById("view-mode-icon-detailed");

  const updateViewModeIcon = () => {
    const isDetailed = settings.viewMode === "detailed";
    viewModeIconCompact.classList.toggle("hidden", isDetailed);
    viewModeIconDetailed.classList.toggle("hidden", !isDetailed);
    toggleViewModeBtn.title = isDetailed ? "컴팩트 뷰로 변경" : "상세 뷰로 변경";
  };

  toggleViewModeBtn.addEventListener("click", async () => {
    settings.viewMode = settings.viewMode === "detailed" ? "compact" : "detailed";
    await chrome.storage.local.set({ settings });
    updateViewModeIcon();
    renderStreams();
  });

  // 초기 아이콘 상태 설정
  updateViewModeIcon();

  // Render initial streams and update button state
  renderStreams();
  updateStatus();

  // Check live status immediately and every 1 minute
  updateLiveStatus();
  setInterval(updateLiveStatus, 60000);

  // Sortable
  Sortable.create(list, {
    animation: 150,
    handle: ".handle",
    store: {
      set(sortable) {
        streamsSet = new Set(sortable.toArray());
        chrome.storage.local.set({ streams: [...streamsSet] });
      },
    },
  });

  // Tooltip
  const tooltip = document.getElementById("tooltip");
  let currentTooltipItem = null;

  const showTooltip = (item) => {
    // 상세 뷰에서는 툴팁 비활성화 (이미 정보가 표시됨)
    if (settings.viewMode === "detailed") return;

    const isLive = item.dataset.isLive === "true";
    const title = item.dataset.title;
    const thumbnail = item.dataset.thumbnail;
    const viewers = parseInt(item.dataset.viewers) || 0;

    if (isLive && title) {
      tooltip.innerHTML = `
        ${thumbnail ? `<img src="${thumbnail}" alt="" />` : ""}
        <div class="tooltip-content">
          <div class="tooltip-title">${title}</div>
          <div class="tooltip-viewers">👁 ${viewers.toLocaleString()}명 시청중</div>
        </div>
      `;
    } else if (!isLive) {
      tooltip.innerHTML = `<div class="tooltip-offline">오프라인</div>`;
    } else {
      return;
    }

    const rect = item.getBoundingClientRect();
    tooltip.style.top = `${rect.bottom + 4}px`;
    tooltip.classList.add("show");
    currentTooltipItem = item;
  };

  const hideTooltip = () => {
    tooltip.classList.remove("show");
    currentTooltipItem = null;
  };

  list.addEventListener("mouseover", (e) => {
    const item = e.target.closest(".has-tooltip");
    if (!item || item === currentTooltipItem) return;
    showTooltip(item);
  });

  list.addEventListener("mouseout", (e) => {
    const item = e.target.closest(".has-tooltip");
    if (!item) return;

    const related = e.relatedTarget?.closest?.(".has-tooltip");
    if (related === item) return;

    hideTooltip();
  });

  // ===== 설정 =====
  const settingSoopQuality = document.getElementById("setting-soop-quality");
  const settingChzzkQuality = document.getElementById("setting-chzzk-quality");

  // 설정 UI 초기화
  settingSoopQuality.value = settings.soopQuality;
  settingChzzkQuality.value = settings.chzzkQuality;

  settingSoopQuality.addEventListener("change", async (e) => {
    settings.soopQuality = e.target.value;
    await chrome.storage.local.set({ settings });
  });

  settingChzzkQuality.addEventListener("change", async (e) => {
    settings.chzzkQuality = e.target.value;
    await chrome.storage.local.set({ settings });
  });

  // 알림 설정 토글
  const settingNotification = document.getElementById("setting-notification");
  settingNotification.checked = settings.notification;

  settingNotification.addEventListener("change", async (e) => {
    settings.notification = e.target.checked;
    await chrome.storage.local.set({ settings });
  });

  // ===== 알림 히스토리 =====
  const notificationHistoryEl = document.getElementById("notification-history");

  const formatTimeAgo = (timestamp) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "방금 전";
    if (minutes < 60) return `${minutes}분 전`;
    if (hours < 24) return `${hours}시간 전`;
    if (days < 7) return `${days}일 전`;
    return new Date(timestamp).toLocaleDateString("ko-KR");
  };

  const renderNotificationHistory = async () => {
    // 최신 데이터 로드
    const result = await chrome.storage.local.get({ notificationHistory: [] });
    notificationHistory = result.notificationHistory;

    notificationHistoryEl.innerHTML = "";

    if (notificationHistory.length === 0) {
      const empty = document.createElement("div");
      empty.classList.add("notification-history-empty");
      empty.textContent = "알림 기록이 없습니다";
      notificationHistoryEl.appendChild(empty);
      return;
    }

    // 최신순 정렬
    const sorted = [...notificationHistory].sort((a, b) => b.timestamp - a.timestamp);

    for (const notif of sorted) {
      const platform = getPlatformFromId(notif.streamerId);
      const platformInfo = PLATFORMS[platform] || { name: "?", class: "" };

      const item = document.createElement("div");
      item.classList.add("notification-item");
      if (!notif.read) item.classList.add("unread");
      item.dataset.id = notif.id;

      const badge = document.createElement("span");
      badge.classList.add("platform-badge", platformInfo.class);
      badge.textContent = platformInfo.name;
      item.appendChild(badge);

      const content = document.createElement("div");
      content.classList.add("notification-content");

      const streamer = document.createElement("div");
      streamer.classList.add("notification-streamer");
      streamer.textContent = notif.streamerName;
      content.appendChild(streamer);

      const title = document.createElement("div");
      title.classList.add("notification-title");
      title.textContent = notif.title || "방송 시작";
      content.appendChild(title);

      const time = document.createElement("div");
      time.classList.add("notification-time");
      time.textContent = formatTimeAgo(notif.timestamp);
      content.appendChild(time);

      item.appendChild(content);

      const deleteBtn = document.createElement("button");
      deleteBtn.classList.add("notification-delete");
      deleteBtn.textContent = "✕";
      deleteBtn.title = "삭제";
      deleteBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        notificationHistory = notificationHistory.filter((n) => n.id !== notif.id);
        await chrome.storage.local.set({ notificationHistory });
        item.remove();
        if (notificationHistory.length === 0) {
          renderNotificationHistory();
        }
      });
      item.appendChild(deleteBtn);

      // 클릭 시 방송 페이지로 이동 + 읽음 처리
      item.addEventListener("click", async () => {
        // 읽음 처리
        const idx = notificationHistory.findIndex((n) => n.id === notif.id);
        if (idx !== -1) {
          notificationHistory[idx].read = true;
          await chrome.storage.local.set({ notificationHistory });
          item.classList.remove("unread");
        }

        // 방송 페이지로 이동
        const rawId = getIdWithoutPrefix(notif.streamerId);
        let url;
        if (platform === "c") {
          url = `https://chzzk.naver.com/live/${rawId}`;
        } else {
          url = `https://play.sooplive.com/${rawId}`;
        }
        chrome.tabs.create({ url });
      });

      notificationHistoryEl.appendChild(item);
    }
  };

  // 전체 읽음
  document.getElementById("mark-all-read").addEventListener("click", async () => {
    notificationHistory = notificationHistory.map((n) => ({ ...n, read: true }));
    await chrome.storage.local.set({ notificationHistory });
    renderNotificationHistory();
  });

  // 전체 삭제
  document.getElementById("clear-all-notifications").addEventListener("click", async () => {
    if (notificationHistory.length === 0) return;
    if (!confirm("모든 알림 기록을 삭제하시겠습니까?")) return;
    notificationHistory = [];
    await chrome.storage.local.set({ notificationHistory });
    renderNotificationHistory();
  });

  // ===== 알림 설정 페이지 =====
  const notificationStreamers = document.getElementById("notification-streamers");

  const renderNotificationStreamers = () => {
    notificationStreamers.innerHTML = "";

    if (streamsSet.size === 0) {
      const empty = document.createElement("div");
      empty.classList.add("notification-streamers-empty");
      empty.textContent = "등록된 스트리머가 없습니다.";
      notificationStreamers.appendChild(empty);
      return;
    }

    for (const s of streamsSet) {
      const platform = getPlatformFromId(s);
      const rawId = getIdWithoutPrefix(s);
      const platformInfo = PLATFORMS[platform] || { name: "?", class: "" };
      const nick = data[s]?.nick || liveStatusMap[s]?.user_nick || rawId;
      const notificationEnabled = data[s]?.notificationEnabled !== false;

      const item = document.createElement("div");
      item.classList.add("notification-streamer-item");

      const badge = document.createElement("span");
      badge.classList.add("platform-badge", platformInfo.class);
      badge.textContent = platformInfo.name;
      item.appendChild(badge);

      const name = document.createElement("span");
      name.classList.add("streamer-name");
      name.textContent = nick;
      item.appendChild(name);

      const toggle = document.createElement("label");
      toggle.classList.add("toggle");
      toggle.innerHTML = `
        <input type="checkbox" ${notificationEnabled ? "checked" : ""} />
        <span class="toggle-slider"></span>
      `;
      const checkbox = toggle.querySelector("input");
      checkbox.addEventListener("change", async (e) => {
        data[s] ||= {};
        data[s].notificationEnabled = e.target.checked;
        await chrome.storage.local.set({ data });
      });
      item.appendChild(toggle);

      notificationStreamers.appendChild(item);
    }
  };

  // ===== 그룹 관리 =====
  const groupsList = document.getElementById("groups-list");
  const noGroups = document.getElementById("no-groups");
  const groupModal = document.getElementById("group-modal");
  const groupModalTitle = document.getElementById("group-modal-title");
  const groupNameInput = document.getElementById("group-name");
  const groupStreamersSelect = document.getElementById("group-streamers");
  const colorPicker = document.querySelectorAll(".color-option");
  const groupDeleteBtn = document.getElementById("group-delete");
  const groupSaveBtn = document.getElementById("group-save");
  const groupCancelBtn = document.getElementById("group-cancel");
  const groupModalClose = document.getElementById("group-modal-close");

  let editingGroupId = null;
  let selectedColor = "#ef4444";

  const generateGroupId = () => `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const openGroupModal = (group = null) => {
    editingGroupId = group?.id || null;
    groupModalTitle.textContent = group ? "그룹 편집" : "새 그룹 만들기";
    groupNameInput.value = group?.name || "";
    selectedColor = group?.color || "#ef4444";
    groupDeleteBtn.classList.toggle("hidden", !group);

    // 색상 선택 초기화
    colorPicker.forEach((btn) => {
      btn.classList.toggle("selected", btn.dataset.color === selectedColor);
    });

    // 스트리머 선택 목록 렌더링
    renderGroupStreamerOptions(group?.streamers || []);

    groupModal.classList.add("show");
    groupNameInput.focus();
  };

  const closeGroupModal = () => {
    groupModal.classList.remove("show");
    editingGroupId = null;
  };

  // ===== 그룹 드롭다운 (스트리머 목록에서) =====
  let activeGroupDropdown = null;

  const showGroupDropdown = (streamerId, anchorBtn) => {
    // 기존 드롭다운 닫기
    hideGroupDropdown();

    const dropdown = document.createElement("div");
    dropdown.classList.add("group-dropdown");

    // 그룹 목록
    if (groups.length === 0) {
      const empty = document.createElement("div");
      empty.classList.add("group-dropdown-empty");
      empty.textContent = "그룹이 없습니다";
      dropdown.appendChild(empty);
    } else {
      for (const group of groups) {
        const isInGroup = group.streamers.includes(streamerId);
        const item = document.createElement("label");
        item.classList.add("group-dropdown-item");
        item.innerHTML = `
          <input type="checkbox" ${isInGroup ? "checked" : ""} />
          <span class="group-dropdown-color" style="background-color: ${group.color}"></span>
          <span class="group-dropdown-name">${group.name}</span>
        `;
        const checkbox = item.querySelector("input");
        checkbox.addEventListener("change", async (e) => {
          if (e.target.checked) {
            if (!group.streamers.includes(streamerId)) {
              group.streamers.push(streamerId);
            }
          } else {
            group.streamers = group.streamers.filter((id) => id !== streamerId);
          }
          await chrome.storage.local.set({ groups });
          // 버튼 색상 업데이트
          const streamerGroups = groups.filter((g) => g.streamers.includes(streamerId));
          if (streamerGroups.length > 0) {
            anchorBtn.style.color = streamerGroups[0].color;
            anchorBtn.title = streamerGroups.map((g) => g.name).join(", ");
          } else {
            anchorBtn.style.color = "";
            anchorBtn.title = "그룹에 추가";
          }
        });
        dropdown.appendChild(item);
      }
    }

    // 새 그룹 만들기 버튼
    const newGroupBtn = document.createElement("button");
    newGroupBtn.classList.add("group-dropdown-new");
    newGroupBtn.textContent = "+ 새 그룹 만들기";
    newGroupBtn.addEventListener("click", () => {
      hideGroupDropdown();
      switchPage("groups");
      setTimeout(() => openGroupModal(), 100);
    });
    dropdown.appendChild(newGroupBtn);

    // 위치 설정
    const rect = anchorBtn.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.right = `${document.body.clientWidth - rect.right}px`;

    document.body.appendChild(dropdown);
    activeGroupDropdown = dropdown;

    // 외부 클릭 시 닫기
    setTimeout(() => {
      document.addEventListener("click", handleDropdownOutsideClick);
    }, 0);
  };

  const hideGroupDropdown = () => {
    if (activeGroupDropdown) {
      activeGroupDropdown.remove();
      activeGroupDropdown = null;
      document.removeEventListener("click", handleDropdownOutsideClick);
    }
  };

  const handleDropdownOutsideClick = (e) => {
    if (activeGroupDropdown && !activeGroupDropdown.contains(e.target) && !e.target.closest(".group-btn")) {
      hideGroupDropdown();
    }
  };

  const renderGroupStreamerOptions = (selectedStreamers = []) => {
    groupStreamersSelect.innerHTML = "";

    if (streamsSet.size === 0) {
      groupStreamersSelect.innerHTML =
        '<div class="group-streamers-empty-modal">등록된 스트리머가 없습니다.</div>';
      return;
    }

    for (const s of streamsSet) {
      const platform = getPlatformFromId(s);
      const rawId = getIdWithoutPrefix(s);
      const platformInfo = PLATFORMS[platform] || { name: "?", class: "" };
      const nick = data[s]?.nick || liveStatusMap[s]?.user_nick || rawId;

      const option = document.createElement("label");
      option.classList.add("group-streamer-option");
      option.innerHTML = `
        <input type="checkbox" value="${s}" ${selectedStreamers.includes(s) ? "checked" : ""} />
        <span class="platform-badge ${platformInfo.class}">${platformInfo.name}</span>
        <span>${nick}</span>
      `;
      groupStreamersSelect.appendChild(option);
    }
  };

  const saveGroup = async () => {
    const name = groupNameInput.value.trim();
    if (!name) {
      alert("그룹 이름을 입력해주세요.");
      return;
    }

    const selectedStreamers = [];
    groupStreamersSelect.querySelectorAll("input:checked").forEach((checkbox) => {
      selectedStreamers.push(checkbox.value);
    });

    if (editingGroupId) {
      // 편집
      const index = groups.findIndex((g) => g.id === editingGroupId);
      if (index !== -1) {
        groups[index] = {
          ...groups[index],
          name,
          color: selectedColor,
          streamers: selectedStreamers,
        };
      }
    } else {
      // 새로 만들기
      groups.push({
        id: generateGroupId(),
        name,
        color: selectedColor,
        streamers: selectedStreamers,
      });
    }

    await chrome.storage.local.set({ groups });
    closeGroupModal();
    renderGroups();
  };

  const deleteGroup = async () => {
    if (!editingGroupId) return;
    if (!confirm("이 그룹을 삭제하시겠습니까?")) return;

    groups = groups.filter((g) => g.id !== editingGroupId);
    await chrome.storage.local.set({ groups });
    closeGroupModal();
    renderGroups();
  };

  const renderGroups = () => {
    groupsList.innerHTML = "";

    if (groups.length === 0) {
      noGroups.classList.remove("hidden");
      return;
    }

    noGroups.classList.add("hidden");

    for (const group of groups) {
      const card = document.createElement("div");
      card.classList.add("group-card");
      card.dataset.id = group.id;

      // 그룹 헤더
      const header = document.createElement("div");
      header.classList.add("group-header");

      const color = document.createElement("div");
      color.classList.add("group-color");
      color.style.backgroundColor = group.color;
      header.appendChild(color);

      const name = document.createElement("span");
      name.classList.add("group-name");
      name.textContent = group.name;
      header.appendChild(name);

      const count = document.createElement("span");
      count.classList.add("group-count");
      count.textContent = `${group.streamers.length}명`;
      header.appendChild(count);

      const actions = document.createElement("div");
      actions.classList.add("group-actions");

      // 전체 켜기/끄기 버튼
      const toggleAllBtn = document.createElement("button");
      toggleAllBtn.classList.add("group-action-btn");
      toggleAllBtn.title = "전체 켜기";
      toggleAllBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
      toggleAllBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        for (const s of group.streamers) {
          if (streamsSet.has(s)) {
            data[s] ||= {};
            data[s].disabled = false;
          }
        }
        await chrome.storage.local.set({ data });
        renderStreams();
        updateStatus();
      });
      actions.appendChild(toggleAllBtn);

      // 전체 끄기 버튼
      const toggleOffBtn = document.createElement("button");
      toggleOffBtn.classList.add("group-action-btn");
      toggleOffBtn.title = "전체 끄기";
      toggleOffBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
      toggleOffBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        for (const s of group.streamers) {
          if (streamsSet.has(s)) {
            data[s] ||= {};
            data[s].disabled = true;
          }
        }
        await chrome.storage.local.set({ data });
        renderStreams();
        updateStatus();
      });
      actions.appendChild(toggleOffBtn);

      // 편집 버튼
      const editBtn = document.createElement("button");
      editBtn.classList.add("group-action-btn");
      editBtn.title = "편집";
      editBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openGroupModal(group);
      });
      actions.appendChild(editBtn);

      header.appendChild(actions);
      card.appendChild(header);

      // 스트리머 목록 (접힌 상태)
      const streamersList = document.createElement("div");
      streamersList.classList.add("group-streamers");

      const renderGroupStreamers = () => {
        streamersList.innerHTML = "";

        for (const s of group.streamers) {
          if (!streamsSet.has(s)) continue;

          const platform = getPlatformFromId(s);
          const rawId = getIdWithoutPrefix(s);
          const platformInfo = PLATFORMS[platform] || { name: "?", class: "" };
          const nick = data[s]?.nick || liveStatusMap[s]?.user_nick || rawId;

          const streamer = document.createElement("div");
          streamer.classList.add("group-streamer");

          const badge = document.createElement("span");
          badge.classList.add("platform-badge", platformInfo.class);
          badge.textContent = platformInfo.name;
          streamer.appendChild(badge);

          const nameSpan = document.createElement("span");
          nameSpan.textContent = nick;
          streamer.appendChild(nameSpan);

          // 그룹에서 제거 버튼
          const removeBtn = document.createElement("button");
          removeBtn.classList.add("group-streamer-remove");
          removeBtn.textContent = "✕";
          removeBtn.title = "그룹에서 제거";
          removeBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            group.streamers = group.streamers.filter((id) => id !== s);
            await chrome.storage.local.set({ groups });
            renderGroupStreamers();
            count.textContent = `${group.streamers.length}명`;
          });
          streamer.appendChild(removeBtn);

          streamersList.appendChild(streamer);
        }

        // 스트리머가 없을 때
        if (group.streamers.filter((s) => streamsSet.has(s)).length === 0) {
          const empty = document.createElement("div");
          empty.classList.add("group-streamers-empty-inline");
          empty.textContent = "스트리머가 없습니다";
          streamersList.appendChild(empty);
        }

        // 스트리머 추가 버튼
        const addStreamerBtn = document.createElement("button");
        addStreamerBtn.classList.add("group-add-streamer-btn");
        addStreamerBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 스트리머 추가`;
        addStreamerBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          showGroupAddStreamerDropdown(group, addStreamerBtn, () => {
            renderGroupStreamers();
            count.textContent = `${group.streamers.length}명`;
          });
        });
        streamersList.appendChild(addStreamerBtn);
      };

      renderGroupStreamers();
      card.appendChild(streamersList);

      // 헤더 클릭 시 펼치기/접기
      header.addEventListener("click", () => {
        card.classList.toggle("expanded");
      });

      groupsList.appendChild(card);
    }
  };

  // 색상 선택
  colorPicker.forEach((btn) => {
    btn.addEventListener("click", () => {
      colorPicker.forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
      selectedColor = btn.dataset.color;
    });
  });

  // 그룹 모달 이벤트
  document.getElementById("add-group-btn").addEventListener("click", () => openGroupModal());
  document.getElementById("create-first-group").addEventListener("click", () => openGroupModal());
  groupModalClose.addEventListener("click", closeGroupModal);
  groupCancelBtn.addEventListener("click", closeGroupModal);
  groupSaveBtn.addEventListener("click", saveGroup);
  groupDeleteBtn.addEventListener("click", deleteGroup);
  groupModal.querySelector(".modal-backdrop").addEventListener("click", closeGroupModal);

  // ===== 스트리머 추가 모달 =====
  const addStreamerModal = document.getElementById("add-streamer-modal");
  const addModalSearchInput = document.getElementById("add-modal-search");
  const addModalSearchLabel = document.getElementById("add-modal-search-label");
  const addModalSuggestions = document.getElementById("add-modal-suggestions");
  const addModalSelected = document.getElementById("add-modal-selected");
  const addModalNotice = document.getElementById("add-modal-notice");
  const addModalGroups = document.getElementById("add-modal-groups");
  const addModalConfirmBtn = document.getElementById("add-streamer-confirm");
  const platformOptions = document.querySelectorAll(".platform-option");

  let addModalPlatform = "s";
  let addModalSelectedStreamer = null;
  let addModalSelectedGroups = [];
  let addModalSearchTimeout = null;

  const openAddStreamerModal = (preselectedGroupId = null) => {
    addModalPlatform = "s";
    addModalSelectedStreamer = null;
    addModalSelectedGroups = preselectedGroupId ? [preselectedGroupId] : [];
    addModalSearchInput.value = "";
    addModalSelected.innerHTML = "";
    addModalSuggestions.classList.remove("show");
    addModalNotice.classList.add("hidden");
    addModalConfirmBtn.disabled = true;

    // 플랫폼 선택 초기화
    platformOptions.forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.platform === "s");
    });

    // 검색 라벨 및 placeholder 업데이트
    updateAddModalSearchUI();

    // 그룹 목록 렌더링
    renderAddModalGroups();

    addStreamerModal.classList.add("show");
    addModalSearchInput.focus();
  };

  const closeAddStreamerModal = () => {
    addStreamerModal.classList.remove("show");
    addModalSuggestions.classList.remove("show");
  };

  const updateAddModalSearchUI = () => {
    const isSearchable = SEARCHABLE_PLATFORMS.includes(addModalPlatform);
    if (isSearchable) {
      addModalSearchLabel.textContent = "스트리머 검색";
      addModalSearchInput.placeholder = "ID 또는 이름으로 검색";
    } else {
      addModalSearchLabel.textContent = "스트리머 ID 입력";
      const platformName = PLATFORMS[addModalPlatform]?.name || "";
      addModalSearchInput.placeholder = `${platformName} ID를 입력하세요`;
    }
  };

  const renderAddModalGroups = () => {
    addModalGroups.innerHTML = "";

    if (groups.length === 0) {
      const empty = document.createElement("div");
      empty.classList.add("add-modal-groups-empty");
      empty.textContent = "등록된 그룹이 없습니다";
      addModalGroups.appendChild(empty);
      return;
    }

    for (const group of groups) {
      const isChecked = addModalSelectedGroups.includes(group.id);
      const item = document.createElement("label");
      item.classList.add("add-modal-group-item");
      if (isChecked) item.classList.add("checked");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = isChecked;
      checkbox.addEventListener("change", (e) => {
        if (e.target.checked) {
          addModalSelectedGroups.push(group.id);
          item.classList.add("checked");
        } else {
          addModalSelectedGroups = addModalSelectedGroups.filter((id) => id !== group.id);
          item.classList.remove("checked");
        }
      });
      item.appendChild(checkbox);

      const color = document.createElement("span");
      color.classList.add("add-modal-group-color");
      color.style.backgroundColor = group.color;
      item.appendChild(color);

      const name = document.createElement("span");
      name.classList.add("add-modal-group-name");
      name.textContent = group.name;
      item.appendChild(name);

      addModalGroups.appendChild(item);
    }
  };

  const selectStreamerInModal = (streamerData) => {
    addModalSelectedStreamer = streamerData;
    addModalSuggestions.classList.remove("show");
    addModalSearchInput.value = "";

    // 선택된 스트리머 표시
    addModalSelected.innerHTML = "";
    const display = document.createElement("div");
    display.classList.add("selected-streamer-display");

    if (streamerData.profile_image) {
      const img = document.createElement("img");
      img.src = streamerData.profile_image;
      img.alt = streamerData.nick || streamerData.id;
      display.appendChild(img);
    }

    const info = document.createElement("div");
    info.classList.add("info");

    const nick = document.createElement("div");
    nick.classList.add("nick");
    nick.textContent = streamerData.nick || streamerData.id;
    info.appendChild(nick);

    const id = document.createElement("div");
    id.classList.add("id");
    id.textContent = streamerData.id;
    info.appendChild(id);

    display.appendChild(info);

    const removeBtn = document.createElement("button");
    removeBtn.classList.add("remove-selected");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", () => {
      addModalSelectedStreamer = null;
      addModalSelected.innerHTML = "";
      addModalConfirmBtn.disabled = true;
      addModalNotice.classList.add("hidden");
    });
    display.appendChild(removeBtn);

    addModalSelected.appendChild(display);
    addModalConfirmBtn.disabled = false;

    // 알림 불가 안내 표시 (검색 불가 플랫폼 또는 방통실 미등록)
    if (!SEARCHABLE_PLATFORMS.includes(addModalPlatform) || !streamerData.registered) {
      addModalNotice.classList.remove("hidden");
    } else {
      addModalNotice.classList.add("hidden");
    }
  };

  const showAddModalSuggestions = async (query) => {
    if (!query || query.length < 1) {
      addModalSuggestions.classList.remove("show");
      return;
    }

    // 검색 불가 플랫폼은 바로 입력값 사용
    if (!SEARCHABLE_PLATFORMS.includes(addModalPlatform)) {
      selectStreamerInModal({
        id: query,
        nick: null,
        profile_image: null,
        registered: false,
      });
      return;
    }

    // 로딩 표시
    addModalSuggestions.innerHTML = `
      <div class="suggestion-item skeleton">
        <div class="skeleton-img"></div>
        <div class="info">
          <div class="skeleton-text"></div>
          <div class="skeleton-text short"></div>
        </div>
      </div>
    `;
    addModalSuggestions.classList.add("show");

    const results = await searchStreamers(query);
    // 현재 플랫폼 필터링
    const platformKey = addModalPlatform === "s" ? "soop" : "chzzk";
    const filtered = results.filter((r) => r.platform === platformKey);

    addModalSuggestions.innerHTML = "";

    if (filtered.length === 0) {
      // 검색 결과 없으면 직접 입력 옵션 제공
      const directItem = document.createElement("div");
      directItem.classList.add("suggestion-item");
      directItem.innerHTML = `
        <div class="info">
          <div class="nick">"${query}" 직접 추가</div>
          <div class="id">방통실에 등록되지 않은 스트리머</div>
        </div>
      `;
      directItem.addEventListener("click", () => {
        selectStreamerInModal({
          id: query,
          nick: null,
          profile_image: null,
          registered: false,
        });
      });
      addModalSuggestions.appendChild(directItem);
    } else {
      for (const streamer of filtered) {
        const item = document.createElement("div");
        item.classList.add("suggestion-item");

        if (streamer.profile_image) {
          const img = document.createElement("img");
          img.src = streamer.profile_image;
          img.alt = streamer.user_nick;
          item.appendChild(img);
        }

        const info = document.createElement("div");
        info.classList.add("info");

        const nick = document.createElement("div");
        nick.classList.add("nick");
        nick.textContent = streamer.user_nick || streamer.streamer_id;
        info.appendChild(nick);

        const id = document.createElement("div");
        id.classList.add("id");
        id.textContent = streamer.streamer_id;
        info.appendChild(id);

        item.appendChild(info);

        if (streamer.is_live) {
          const liveBadge = document.createElement("span");
          liveBadge.classList.add("live-badge");
          liveBadge.textContent = "LIVE";
          item.appendChild(liveBadge);
        }

        item.addEventListener("click", () => {
          selectStreamerInModal({
            id: streamer.streamer_id,
            nick: streamer.user_nick,
            profile_image: streamer.profile_image,
            registered: true,
          });
        });

        addModalSuggestions.appendChild(item);
      }
    }
  };

  const confirmAddStreamer = async () => {
    if (!addModalSelectedStreamer) return;

    const streamerId = `${addModalPlatform}:${addModalSelectedStreamer.id}`;

    // 이미 등록된 스트리머인지 확인
    if (streamsSet.has(streamerId)) {
      alert("이미 등록된 스트리머입니다.");
      return;
    }

    // 최대 개수 확인
    if (streamsSet.size >= MAX_STREAMERS) {
      alert(`최대 ${MAX_STREAMERS}명까지 등록할 수 있습니다.`);
      return;
    }

    // 스트리머 추가
    streamsSet.add(streamerId);
    if (addModalSelectedStreamer.nick) {
      data[streamerId] = { nick: addModalSelectedStreamer.nick };
    }

    // 그룹에 추가
    for (const groupId of addModalSelectedGroups) {
      const group = groups.find((g) => g.id === groupId);
      if (group && !group.streamers.includes(streamerId)) {
        group.streamers.push(streamerId);
      }
    }

    await chrome.storage.local.set({ streams: [...streamsSet], data, groups });

    closeAddStreamerModal();
    renderStreams();
    updateStatus();
    renderGroups();

    // 추가된 스트리머의 방송 상태 즉시 확인
    fetchLiveStatusForStreamer(streamerId);
  };

  // 단일 스트리머의 방송 상태 확인 및 캐시 갱신
  const fetchLiveStatusForStreamer = async (streamerId) => {
    try {
      const statusMap = await fetchLiveStatus([streamerId]);
      if (statusMap[streamerId]) {
        liveStatusMap[streamerId] = statusMap[streamerId];
        await chrome.storage.local.set({ liveStatusCache: liveStatusMap });
        renderStreams();
      }
    } catch {
      // 실패해도 무시 (다음 갱신 시 다시 시도)
    }
  };

  // 플랫폼 선택 이벤트
  platformOptions.forEach((opt) => {
    opt.addEventListener("click", () => {
      platformOptions.forEach((o) => o.classList.remove("active"));
      opt.classList.add("active");
      addModalPlatform = opt.dataset.platform;
      updateAddModalSearchUI();

      // 선택 초기화
      addModalSelectedStreamer = null;
      addModalSelected.innerHTML = "";
      addModalConfirmBtn.disabled = true;
      addModalNotice.classList.add("hidden");
      addModalSuggestions.classList.remove("show");
      addModalSearchInput.value = "";
    });
  });

  // 검색 입력 이벤트
  addModalSearchInput.addEventListener("input", (e) => {
    clearTimeout(addModalSearchTimeout);
    const query = e.target.value.trim();

    if (!SEARCHABLE_PLATFORMS.includes(addModalPlatform)) {
      // 검색 불가 플랫폼은 입력값이 있으면 바로 선택
      if (query) {
        selectStreamerInModal({
          id: query,
          nick: null,
          profile_image: null,
          registered: false,
        });
      } else {
        addModalSelectedStreamer = null;
        addModalSelected.innerHTML = "";
        addModalConfirmBtn.disabled = true;
        addModalNotice.classList.add("hidden");
      }
      return;
    }

    addModalSearchTimeout = setTimeout(() => {
      showAddModalSuggestions(query);
    }, 300);
  });

  // 모달 이벤트
  document.getElementById("open-add-streamer-modal").addEventListener("click", () => openAddStreamerModal());
  document.getElementById("add-streamer-modal-close").addEventListener("click", closeAddStreamerModal);
  document.getElementById("add-streamer-cancel").addEventListener("click", closeAddStreamerModal);
  addModalConfirmBtn.addEventListener("click", confirmAddStreamer);
  addStreamerModal.querySelector(".modal-backdrop").addEventListener("click", closeAddStreamerModal);

  // 새 그룹 만들기 버튼
  document.getElementById("add-modal-create-group").addEventListener("click", () => {
    closeAddStreamerModal();
    switchPage("groups");
    setTimeout(() => openGroupModal(), 100);
  });

  // 멀티뷰 버튼 클릭 이벤트
  multiviewBtn.addEventListener("click", () => {
    const enabledStreams = [...streamsSet].filter((s) => !data[s]?.disabled);
    if (enabledStreams.length === 0) {
      chrome.tabs.create({ url: "https://bngts.com/multiview" });
    } else {
      const path = enabledStreams.join("/");
      chrome.tabs.create({ url: `https://bngts.com/multiview/watch/${path}` });
    }
  });

  // 그룹 내 스트리머 추가 드롭다운 (그룹 페이지에서 사용)
  let activeAddStreamerDropdown = null;

  const showGroupAddStreamerDropdown = (group, anchorBtn, onUpdate) => {
    // 기존 드롭다운 닫기
    hideAddStreamerDropdown();

    const dropdown = document.createElement("div");
    dropdown.classList.add("group-add-dropdown");

    // 스크롤 가능한 아이템 컨테이너
    const itemsContainer = document.createElement("div");
    itemsContainer.classList.add("group-add-dropdown-items");

    // 그룹에 없는 스트리머 목록
    const availableStreamers = [...streamsSet].filter((s) => !group.streamers.includes(s));

    if (availableStreamers.length === 0) {
      const empty = document.createElement("div");
      empty.classList.add("group-add-dropdown-empty");
      empty.textContent = "추가 가능한 스트리머가 없습니다";
      itemsContainer.appendChild(empty);
    } else {
      for (const s of availableStreamers) {
        const platform = getPlatformFromId(s);
        const rawId = getIdWithoutPrefix(s);
        const platformInfo = PLATFORMS[platform] || { name: "?", class: "" };
        const nick = data[s]?.nick || liveStatusMap[s]?.user_nick || rawId;
        const isLive = liveStatusMap[s]?.is_live;

        const item = document.createElement("div");
        item.classList.add("group-add-dropdown-item");
        if (isLive) item.classList.add("live");

        const badge = document.createElement("span");
        badge.classList.add("platform-badge", platformInfo.class);
        badge.textContent = platformInfo.name;
        item.appendChild(badge);

        if (isLive) {
          const liveBadge = document.createElement("span");
          liveBadge.classList.add("live-badge");
          liveBadge.textContent = "LIVE";
          item.appendChild(liveBadge);
        }

        const name = document.createElement("span");
        name.classList.add("group-add-dropdown-name");
        name.textContent = nick;
        item.appendChild(name);

        item.addEventListener("click", async () => {
          if (!group.streamers.includes(s)) {
            group.streamers.push(s);
            await chrome.storage.local.set({ groups });
            onUpdate();
          }
          hideAddStreamerDropdown();
        });

        itemsContainer.appendChild(item);
      }
    }

    dropdown.appendChild(itemsContainer);

    // 새 스트리머 추가 버튼
    const newBtn = document.createElement("button");
    newBtn.classList.add("group-add-dropdown-new");
    newBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> 새 스트리머 추가`;
    newBtn.addEventListener("click", () => {
      hideAddStreamerDropdown();
      openAddStreamerModal(group.id);
    });
    dropdown.appendChild(newBtn);

    // 위치 설정
    const rect = anchorBtn.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 4}px`;
    dropdown.style.left = `${rect.left}px`;

    document.body.appendChild(dropdown);
    activeAddStreamerDropdown = dropdown;

    // 외부 클릭 시 닫기
    setTimeout(() => {
      document.addEventListener("click", handleAddStreamerDropdownOutsideClick);
    }, 0);
  };

  const hideAddStreamerDropdown = () => {
    if (activeAddStreamerDropdown) {
      activeAddStreamerDropdown.remove();
      activeAddStreamerDropdown = null;
      document.removeEventListener("click", handleAddStreamerDropdownOutsideClick);
    }
  };

  const handleAddStreamerDropdownOutsideClick = (e) => {
    if (activeAddStreamerDropdown && !activeAddStreamerDropdown.contains(e.target) && !e.target.closest(".group-add-streamer-btn")) {
      hideAddStreamerDropdown();
    }
  };

  // 초기 그룹 렌더링
  renderGroups();
})();
