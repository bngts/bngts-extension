import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function background(session = {}, local = {}) {
  const callbacks = {};
  const counters = { cookies: 0 };
  let now = 100_000;
  const event = (name) => ({
    addListener(fn) {
      callbacks[name] = fn;
    },
  });
  const api = {
    storage: {
      local: {
        get: async (key) => structuredClone({ [key]: local[key] }),
        set: async (data) => Object.assign(local, structuredClone(data)),
      },
      session: {
        get: async (key) => structuredClone({ [key]: session[key] }),
        set: async (data) => Object.assign(session, structuredClone(data)),
      },
    },
    runtime: { getURL: (path) => `chrome-extension://test/${path}`, onMessage: event("message") },
    tabs: {
      onRemoved: event("removed"),
      onUpdated: event("updated"),
      query: async () => [{ id: 1 }],
      get: async () => ({ url: "https://play.sooplive.com/alpha" }),
      sendMessage: async () => null,
    },
    cookies: {
      get: async () => {
        counters.cookies++;
        return null;
      },
    },
  };
  const context = vm.createContext({
    chrome: api,
    URL,
    setTimeout,
    clearTimeout,
    Date: { now: () => now },
  });
  for (const file of ["playback-status-model.js", "src/common/playback-status-background.js"]) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
  }
  const sender = {
    url: "https://play.sooplive.com/alpha",
    tab: { id: 1, url: "https://bngts.com/multiview" },
    frameId: 2,
    documentId: "one",
  };
  const snapshot = {
    kind: "live",
    streamerId: "alpha",
    contentId: "123",
    subscribed: false,
    quickview: "none",
    placements: { pre: { state: "playing" } },
  };
  const publish = (changes = {}, who = sender) =>
    callbacks.message(
      { type: "bngts:player-status", snapshot: { ...snapshot, ...changes } },
      who,
      () => {}
    );
  const request = (tabId = 1, who = { url: "chrome-extension://test/popup.html" }) =>
    new Promise((resolve) => {
      callbacks.message({ type: "bngts:get-playback-status", tabId }, who, resolve);
    });
  const change = (
    message = {},
    who = { url: "https://bngts.com/multiview", frameId: 0, tab: { id: 1 } }
  ) =>
    new Promise((resolve) =>
      callbacks.message({ type: "bngts:ignore-playback-alert", tabId: 1, ...message }, who, resolve)
    );
  return {
    callbacks,
    counters,
    publish,
    request,
    change,
    model: context.BngtsPlayback,
    login: (who = { url: "chrome-extension://test/popup.html" }) =>
      new Promise((resolve) => callbacks.message({ type: "bngts:get-login-status" }, who, resolve)),
    sender,
    advance: (ms) => {
      now += ms;
    },
  };
}

test("background isolates active tabs and returns only sanitized snapshots", async () => {
  const b = background();
  b.publish({ cookie: "SECRET", userId: "SECRET" });
  const response = await b.request();
  assert.equal(response.ok, true);
  assert.equal(response.status.soop.players.length, 1);
  assert.doesNotMatch(JSON.stringify(response), /SECRET/);
  assert.equal((await b.request(2)).status.soop.players.length, 0);
  assert.equal(b.counters.cookies, 0, "unrelated Chzzk state is not checked on a SOOP tab");
});

test("site item ignore is scoped to its current viewing session and restorable", async () => {
  const b = background();
  b.publish();
  const initial = (await b.request()).status;
  const key = b.model.alertsForStatus(initial)[0].key;
  assert.equal((await b.change({ key })).ok, true);
  const page = { url: "https://bngts.com/multiview", frameId: 0, tab: { id: 1 } };
  const fromPage = (await b.request(2, page)).status;
  assert.equal(fromPage.tabId, 1, "page cannot target another tab");
  assert.equal(b.model.alertsForStatus(fromPage).length, 0);
  assert.equal(b.model.alertsForStatus((await b.request()).status).length, 0);
  assert.equal((await b.request(2)).status.ignored.keys.length, 0);
  await b.change({ type: "bngts:restore-playback-alerts" });
  assert.equal(b.model.alertsForStatus((await b.request()).status).length, 1);
});

test("site ignore-all survives worker suspension/reload, clears on leaving site/closing tab", async () => {
  const session = {};
  const first = background(session);
  first.publish();
  assert.equal((await first.change({ all: true })).ok, true);
  const resumed = background(session);
  resumed.publish();
  assert.equal((await resumed.request()).status.ignored.all, true);
  resumed.callbacks.updated(1, { status: "loading" });
  assert.equal((await resumed.request()).status.ignored.all, true);
  resumed.callbacks.updated(1, { url: "https://example.com/" });
  assert.equal((await resumed.request()).status.ignored.all, false);
  await resumed.change({ all: true });
  resumed.callbacks.removed(1);
  assert.equal((await resumed.request()).status.ignored.all, false);
  assert.doesNotMatch(JSON.stringify(session), /subscribed|quickview|placements|alpha/);
});

test("popup only checks login cookies and never surfaces subscription/ad issues", async () => {
  const b = background();
  b.publish();
  const response = await b.login();
  assert.equal(response.status.scope, "login-only");
  assert.equal(b.model.loginAlertsForStatus(response.status).length, 2);
  assert.equal(response.status.soop.players, undefined);
  assert.equal(
    b.model.loginAlertsForStatus({
      soop: { loggedIn: true, players: (await b.request()).status.soop.players },
      chzzk: { loggedIn: true },
    }).length,
    0
  );
  assert.equal(
    b.model.loginAlertsForStatus({ soop: { loggedIn: null }, chzzk: { loggedIn: null } }).length,
    0
  );
  assert.equal((await b.login({ url: "https://bngts.com/", frameId: 0 })).ok, false);
});

test("closing popup login alerts persists across restarts without muting site advertising", async () => {
  const local = {};
  const b = background({}, local);
  const popup = { url: "chrome-extension://test/popup.html" };
  b.publish();
  assert.equal((await b.change({ keys: ["soop-login", "chzzk-login"] }, popup)).ok, true);
  assert.equal(b.model.loginAlertsForStatus((await b.login()).status).length, 0);
  assert.equal(b.model.alertsForStatus((await b.request()).status).length, 1);
  const restarted = background({}, local);
  assert.equal(restarted.model.loginAlertsForStatus((await restarted.login()).status).length, 0);
  await restarted.change({ type: "bngts:restore-playback-alerts" }, popup);
  assert.equal(restarted.model.loginAlertsForStatus((await restarted.login()).status).length, 2);
  assert.doesNotMatch(JSON.stringify(local), /alpha|quickview|subscribed|placements|AuthTicket/);
});

test("site ignore and popup login dismiss have independent lifetimes", async () => {
  const b = background();
  await b.change({ all: true });
  assert.equal(b.model.loginAlertsForStatus((await b.login()).status).length, 2);
  assert.equal(
    (await b.change({ key: "live:alpha:123:pre" }, { url: "chrome-extension://test/popup.html" }))
      .ok,
    false
  );
});

test("site session ends when Chrome hides destination URL outside host permissions", async () => {
  const b = background();
  await b.change({ all: true });
  b.callbacks.updated(1, { status: "complete" }, { id: 1, url: "https://bngts.com/multiview" });
  assert.equal((await b.request()).status.ignored.all, true);
  b.callbacks.updated(1, { status: "complete" }, { id: 1 });
  assert.equal((await b.request()).status.ignored.all, false);
});

test("ignore messages reject frames, foreign sites and fabricated keys", async () => {
  const b = background();
  b.publish();
  assert.equal((await b.change({ key: "fabricated" })).ok, false);
  assert.equal((await b.change({ all: true }, b.sender)).ok, false);
  assert.equal((await b.change({ all: true }, { url: "https://evil.test", frameId: 0 })).ok, false);
  assert.equal((await b.request()).status.ignored.all, false);
});

test("single-key ignore does not hide another placement or another broadcast", async () => {
  const b = background();
  b.publish({ placements: { pre: { state: "playing" }, post: { state: "playing" } } });
  const before = (await b.request()).status;
  assert.equal(b.model.alertsForStatus(before).length, 2);
  await b.change({ key: b.model.alertsForStatus(before)[0].key });
  assert.equal(b.model.alertsForStatus((await b.request()).status).length, 1);
  b.publish({ contentId: "124" });
  assert.equal(b.model.alertsForStatus((await b.request()).status).length, 1);
});
test("background rejects arbitrary sites, unexpected channels and page impersonation", async () => {
  const b = background();
  b.publish({}, { ...b.sender, tab: { id: 1, url: "https://evil.test/" } });
  b.publish({}, { ...b.sender, url: "https://play.sooplive.com/beta" });
  assert.equal((await b.request()).status.soop.players.length, 0);
  const response = await b.request(1, { url: "https://evil.test/", frameId: 0 });
  assert.equal(response.ok, false);
});
test("closed, navigated and stale frame data is discarded", async () => {
  const b = background();
  b.publish();
  b.advance(12_001);
  assert.equal((await b.request()).status.soop.players.length, 0);
  b.publish();
  b.callbacks.updated(1, { url: "https://bngts.com/other" });
  assert.equal((await b.request()).status.soop.players.length, 0);
  b.publish();
  b.callbacks.removed(1);
  assert.equal((await b.request()).status.soop.players.length, 0);
});
test("unload from an old document does not delete its successor", async () => {
  const b = background();
  b.publish({}, { ...b.sender, documentId: "two" });
  b.callbacks.message({ type: "bngts:player-status-remove" }, b.sender, () => {});
  assert.equal((await b.request()).status.soop.players.length, 1);
  b.callbacks.message(
    { type: "bngts:player-status-remove" },
    { ...b.sender, documentId: "two" },
    () => {}
  );
  assert.equal((await b.request()).status.soop.players.length, 0);
});

test("multiview polling never reads login cookies even when legacy callers request CHZZK", async () => {
  const b = background();
  const response = await new Promise((resolve) => b.callbacks.message({
    type: "bngts:get-playback-status", includeChzzk: true,
  }, { url: "https://bngts.com/multiview", frameId: 0, tab: { id: 1 } }, resolve));
  assert.equal(response.ok, true);
  assert.equal(response.status.chzzk.loggedIn, null);
  assert.equal(b.counters.cookies, 0);
  assert.equal((await b.change({ key: "chzzk-login" })).ok, false);
});
