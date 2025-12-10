(async () => {
  const API_BASE = "https://bngts.com/api";
  const MAX_STREAMERS = 50;
  const PAGE_SIZE = 5;

  const PLATFORMS = {
    s: { name: "SOOP", class: "soop" },
    c: { name: "치지직", class: "chzzk" },
  };

  const PLATFORM_MAP = {
    soop: "s",
    chzzk: "c",
  };

  let searchTimeout = null;
  let selectedSuggestionIndex = -1;
  let currentPage = 0;
  let currentFilter = "all"; // all, live, offline
  let currentSort = "custom"; // custom, name, live

  // 설정 로드
  let { settings } = await chrome.storage.local.get({
    settings: { notification: false, tooltip: true },
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
      const res = await fetch(
        `${API_BASE}/streamers?ids=${streamerIds.map(encodeURIComponent).join(",")}&limit=50`
      );
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
    if (/^[0-9a-f]{32}$/i.test(id)) return "c";
    if (/^[a-z0-9]{3,12}$/i.test(id)) return "s";
    return null;
  };

  const getIdWithoutPrefix = (id) => {
    if (id.startsWith("c:") || id.startsWith("s:")) {
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
  const input = document.getElementById("streamer-id");
  const suggestions = document.getElementById("suggestions");
  const watchBtn = document.getElementById("watch");
  const soopWarning = document.getElementById("soop-warning");
  const addForm = document.getElementById("add-form");
  const filterSelect = document.getElementById("filter");
  const reloadBtn = document.getElementById("reload-btn");
  const toast = document.getElementById("toast");

  let isLoading = false;

  const updateStatus = () => {
    const enabledStreams = [...streamsSet].filter((s) => !data[s]?.disabled);
    const enabledCount = enabledStreams.length;
    const soopCount = enabledStreams.filter((s) => getPlatformFromId(s) === "s").length;

    watchBtn.disabled = enabledCount === 0;
    soopWarning.classList.toggle("show", soopCount > 4);
    document.getElementById("soop-count").textContent = soopCount;
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
    const isFiltered = currentFilter !== "all";
    const isSorted = currentSort !== "custom";

    // 필터/정렬 시 추가 폼 숨김
    addForm.classList.toggle("hidden", isFiltered);

    // 필터/정렬 시 드래그 핸들 숨김
    list.classList.toggle("no-drag", isFiltered || isSorted);

    // 필터 옵션에 카운트 표시
    const liveCount = [...streamsSet].filter((s) => liveStatusMap[s]?.is_live === true).length;
    const offlineCount = streamsSet.size - liveCount;

    filterSelect.options[0].textContent = `전체 (${streamsSet.size})`;
    filterSelect.options[1].textContent = `온라인 (${liveCount})`;
    filterSelect.options[2].textContent = `오프라인 (${offlineCount})`;
  };

  const createStreamItem = (s, streamInfo = null) => {
    const platform = getPlatformFromId(s);
    const rawId = getIdWithoutPrefix(s);
    const platformInfo = PLATFORMS[platform] || { name: "?", class: "" };
    const nick = data[s]?.nick || streamInfo?.user_nick;
    const isLive = streamInfo?.is_live;

    const item = document.createElement("div");
    item.dataset.id = s;
    if (isLive) item.classList.add("live");

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

    const remove = document.createElement("button");
    remove.textContent = "\u2715";
    remove.addEventListener("click", async () => {
      streamsSet.delete(s);
      delete data[s];
      await chrome.storage.local.set({ streams: [...streamsSet], data });
      item.remove();
      updateStatus();
    });
    item.appendChild(remove);

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

    // 필터 적용
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

  const hideSuggestions = () => {
    suggestions.classList.remove("show");
    suggestions.innerHTML = "";
    selectedSuggestionIndex = -1;
  };

  const showSuggestionsSkeleton = () => {
    suggestions.innerHTML = "";
    selectedSuggestionIndex = -1;

    for (let i = 0; i < 3; i++) {
      const skeleton = document.createElement("div");
      skeleton.classList.add("suggestion-item", "skeleton");
      skeleton.innerHTML = `
        <div class="skeleton-img"></div>
        <div class="info">
          <div class="skeleton-text"></div>
          <div class="skeleton-text short"></div>
        </div>
      `;
      suggestions.appendChild(skeleton);
    }

    suggestions.classList.add("show");
  };

  const renderSuggestions = (results) => {
    suggestions.innerHTML = "";
    selectedSuggestionIndex = -1;

    if (results.length === 0) {
      suggestions.innerHTML = '<div class="no-results">검색 결과가 없습니다</div>';
      suggestions.classList.add("show");
      return;
    }

    results.forEach((streamer, index) => {
      const item = document.createElement("div");
      item.classList.add("suggestion-item");
      item.dataset.index = index;

      const platformKey = PLATFORM_MAP[streamer.platform] || "s";
      const platformInfo = PLATFORMS[platformKey];

      item.innerHTML = `
        <img src="${streamer.profile_image || "icon48.png"}" alt="" />
        <div class="info">
          <div class="nick">${streamer.user_nick}</div>
          <div class="id">${streamer.streamer_id}</div>
        </div>
        <span class="platform-badge ${platformInfo.class}">${platformInfo.name}</span>
        ${streamer.is_live ? '<span class="live-badge">LIVE</span>' : ""}
      `;

      item.addEventListener("click", () => {
        addStream(platformKey, streamer.streamer_id, streamer.user_nick);
        input.value = "";
        hideSuggestions();
        updateStatus();
      });

      suggestions.appendChild(item);
    });

    suggestions.classList.add("show");
  };

  const handleKeyNavigation = (e) => {
    const items = suggestions.querySelectorAll(".suggestion-item");
    if (items.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, items.length - 1);
      items.forEach((item, i) => {
        item.classList.toggle("selected", i === selectedSuggestionIndex);
      });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, 0);
      items.forEach((item, i) => {
        item.classList.toggle("selected", i === selectedSuggestionIndex);
      });
    } else if (e.key === "Enter" && selectedSuggestionIndex >= 0) {
      e.preventDefault();
      items[selectedSuggestionIndex].click();
    } else if (e.key === "Escape") {
      hideSuggestions();
    }
  };

  input.addEventListener("input", (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchTimeout);

    if (query.length < 1) {
      hideSuggestions();
      return;
    }

    // 즉시 스켈레톤 표시
    showSuggestionsSkeleton();

    searchTimeout = setTimeout(async () => {
      const results = await searchStreamers(query);
      renderSuggestions(results);
    }, 300);
  });

  input.addEventListener("keydown", handleKeyNavigation);

  input.addEventListener("blur", () => {
    setTimeout(hideSuggestions, 200);
  });

  // Add form event handlers
  document.getElementById("add-btn").addEventListener("click", () => {
    const platform = document.getElementById("platform").value;
    const id = input.value.trim();
    if (id) {
      addStream(platform, id);
      input.value = "";
      hideSuggestions();
      updateStatus();
    }
  });

  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter" && selectedSuggestionIndex < 0) {
      const platform = document.getElementById("platform").value;
      const id = input.value.trim();
      if (id) {
        addStream(platform, id);
        input.value = "";
        hideSuggestions();
        updateStatus();
      }
    }
  });

  // Watch button
  watchBtn.addEventListener("click", () => {
    const streamsList = [...streamsSet]
      .filter((s) => !data[s]?.disabled)
      .map((s) => {
        const platform = getPlatformFromId(s);
        const rawId = getIdWithoutPrefix(s);
        if (platform) {
          return platform + ":" + rawId;
        }
        if (/^[0-9a-f]{32}$/i.test(s)) {
          return "c:" + s;
        } else if (/^[a-z0-9]{3,12}$/i.test(s)) {
          return "s:" + s;
        }
        return s;
      });

    if (streamsList.length === 0) {
      return;
    }

    chrome.tabs.create({
      url: "https://bngts.com/multiview/watch/" + streamsList.join("/"),
    });
  });

  // Go to multiview page
  document.getElementById("go-multiview").addEventListener("click", () => {
    chrome.tabs.create({
      url: "https://bngts.com/multiview",
    });
  });

  // Filter and sort event handlers
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
    if (!settings.tooltip) return;

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

  // Settings modal
  const settingsModal = document.getElementById("settings-modal");
  const settingsBtn = document.getElementById("settings-btn");
  const settingsClose = document.getElementById("settings-close");
  const settingNotification = document.getElementById("setting-notification");
  const settingTooltip = document.getElementById("setting-tooltip");

  // 설정 UI 초기화
  settingNotification.checked = settings.notification;
  settingTooltip.checked = settings.tooltip;

  const openSettings = () => {
    settingsModal.classList.add("show");
  };

  const closeSettings = () => {
    settingsModal.classList.remove("show");
  };

  settingsBtn.addEventListener("click", openSettings);
  settingsClose.addEventListener("click", closeSettings);
  settingsModal.querySelector(".modal-backdrop").addEventListener("click", closeSettings);

  settingNotification.addEventListener("change", async (e) => {
    settings.notification = e.target.checked;
    await chrome.storage.local.set({ settings });
  });

  settingTooltip.addEventListener("change", async (e) => {
    settings.tooltip = e.target.checked;
    await chrome.storage.local.set({ settings });
    if (!settings.tooltip) {
      hideTooltip();
    }
  });
})();
