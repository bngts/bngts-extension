(() => {
  const getReactFiber = (node) => {
    if (node == null) {
      return;
    }
    return Object.entries(node).find(([k]) =>
      k.startsWith("__reactFiber$")
    )?.[1];
  };

  const findReactState = async (node, criteria, raw = false, tries = 0) => {
    if (node == null) {
      return;
    }
    let fiber = getReactFiber(node);
    if (fiber == null) {
      if (tries > 500) {
        return;
      }
      return new Promise((r) => setTimeout(r, 50)).then(() =>
        findReactState(node, criteria, raw, tries + 1)
      );
    }
    fiber = fiber.return;
    while (fiber != null) {
      let state = fiber.memoizedState;
      while (state != null) {
        if (state.memoizedState != null && criteria(state.memoizedState)) {
          return raw ? state : state.memoizedState;
        }
        state = state.next;
      }
      fiber = fiber.return;
    }
  };

  const root = document.getElementById("root");
  const waiting = [];
  const rootObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((n) => {
        for (const elem of waiting) {
          if (n.querySelector?.(elem.query)) {
            elem.resolve(n);
          }
        }
      });
    });
  });
  const waitFor = (query) => {
    const node = root.querySelector(query);
    if (node) {
      return Promise.resolve(node);
    }
    return Promise.race([
      new Promise((resolve) => {
        waiting.push({ query, resolve });
      }),
      new Promise((resolve) => {
        setTimeout(resolve, 10000);
      }),
    ]);
  };
  rootObserver.observe(root, { childList: true, subtree: true });

  const attachBodyObserver = async () => {
    const init = async (node) => {
      if (node == null) {
        return;
      }
      const features = [];
      if (node.className.startsWith("live_")) {
        features.push(initPlayerFeatures(node, true));
        features.push(attachLiveObserver(node));
      } else if (node.className.startsWith("vod_")) {
        features.push(initPlayerFeatures(node, false));
      }
      return Promise.all(features);
    };

    const layoutBody = await waitFor("#layout-body");
    if (layoutBody == null) {
      return;
    }
    const layoutBodyObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((n) => {
          init(n.tagName === "SECTION" ? n : n.querySelector("section"));
        });
      });
    });
    layoutBodyObserver.observe(layoutBody, { childList: true });

    await init(layoutBody.querySelector("section"));
  };

  const initPlayerFeatures = async (node, isLive) => {
    if (node == null) {
      return;
    }
    const setLiveWide = await findReactState(
      isLive
        ? node.querySelector('[class^="live_information_player__"]')
        : node.querySelector("section"),
      (state) =>
        state[0]?.length === 1 &&
        state[1]?.length === 2 &&
        state[1]?.[1]?.key === "isLiveWide"
    );
    setLiveWide?.[0](true);
  };

  const initChatFeatures = (chattingContainer) => {
    if (chattingContainer == null) {
      return;
    }
    setTimeout(() => {
      chattingContainer
        .querySelector(
          '[class*="live_chatting_header_fold__"] > [class^="live_chatting_header_button__"]'
        )
        ?.click();
    }, 300);
  };

  const attachLiveObserver = (node) => {
    if (node == null) {
      return;
    }
    const liveObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((n) => {
          initChatFeatures(
            n.tagName === "ASIDE" ? n : n.querySelector("aside")
          );
        });
      });
    });
    liveObserver.observe(node, { childList: true });

    initChatFeatures(node.querySelector("aside"));
  };

  (async () => {
    if (!location.pathname.endsWith("/chat")) {
      await attachBodyObserver();
    }
    rootObserver.disconnect();
  })();
})();
