(async () => {
  const API_BASE = "https://bngts.com/api";

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

  let { streams, data } = await chrome.storage.local.get({
    streams: [],
    data: {},
  });
  let streamsSet = new Set(streams);

  const list = document.getElementById("streams");
  const input = document.getElementById("streamer-id");
  const suggestions = document.getElementById("suggestions");
  const watchBtn = document.getElementById("watch");
  const soopWarning = document.getElementById("soop-warning");

  const updateStatus = () => {
    const enabledStreams = [...streamsSet].filter((s) => !data[s]?.disabled);
    const enabledCount = enabledStreams.length;
    const soopCount = enabledStreams.filter((s) => getPlatformFromId(s) === "s").length;

    watchBtn.disabled = enabledCount === 0;
    soopWarning.classList.toggle("show", soopCount > 4);
  };

  const createStreamItem = (s) => {
    const platform = getPlatformFromId(s);
    const rawId = getIdWithoutPrefix(s);
    const platformInfo = PLATFORMS[platform] || { name: "?", class: "" };
    const nick = data[s]?.nick;

    const item = document.createElement("div");
    item.dataset.id = s;

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

  const renderStreams = () => {
    list.innerHTML = "";
    for (const s of streamsSet) {
      list.appendChild(createStreamItem(s));
    }
  };

  const addStream = async (platform, id, nick = null) => {
    if (!id.trim()) return;

    const streamId = platform + ":" + id;

    if (streamsSet.has(streamId)) {
      alert("이미 등록된 스트리머입니다.");
      return;
    }

    streamsSet.add(streamId);
    if (nick) {
      data[streamId] = { nick };
    }
    await chrome.storage.local.set({ streams: [...streamsSet], data });

    list.appendChild(createStreamItem(streamId));
  };

  const hideSuggestions = () => {
    suggestions.classList.remove("show");
    suggestions.innerHTML = "";
    selectedSuggestionIndex = -1;
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

  // Render initial streams and update button state
  renderStreams();
  updateStatus();

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
})();
