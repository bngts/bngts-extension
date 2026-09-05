import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function observer() {
  const snapshots = [];
  const listeners = new Map();
  const events = {};
  const network = { calls: 0, lastPromise: null };
  const data = {
    result: 1,
    data: {
      title_no: 123,
      bj_id: "alpha",
      writer_nick: "알파",
      quickview: "QUICKVIEW",
      subscribed: false,
      active_subscription: true,
      preroll_showyn: true,
      midroll_showyn: true,
      file_type: "REVIEW",
      is_ppv: false,
      file: "SECRET-MEDIA-URL",
      ticket: "SECRET-TICKET",
    },
  };
  class FakeXHR extends EventTarget {
    open(...args) {
      this.openArgs = args;
      return "original-open-result";
    }
  }
  const core = {
    config: { titleNo: 123, loginId: "test-account", isUseQuickViewPlus: false },
    on(name, fn) {
      listeners.set(name, fn);
    },
    off(name) {
      listeners.delete(name);
    },
    adController: { rollType: "PRE" },
  };
  for (const name of [
    "AD_PLAYING",
    "AD_TIMEUPDATE",
    "NO_AD",
    "AD_API_ERROR",
    "AD_BLOCK",
    "AD_ENDED",
    "PLAYING",
    "ENDED",
  ])
    events[name] = name;
  const eventHandlers = new Map();
  const context = vm.createContext({
    URL,
    Response,
    Event,
    XMLHttpRequest: FakeXHR,
    location: {
      href: "https://vod.sooplive.com/player/123",
      origin: "https://vod.sooplive.com",
      hostname: "vod.sooplive.com",
    },
    setInterval: () => 1,
    clearInterval: () => {},
    fetch: () => {
      network.calls++;
      network.lastPromise = Promise.resolve(new Response(JSON.stringify(data)));
      return network.lastPromise;
    },
    addEventListener: (name, fn) => eventHandlers.set(name, fn),
    postMessage: (message) => snapshots.push(JSON.parse(JSON.stringify(message.snapshot))),
    vodCore: core,
    AfVodPlayerCore: { Events: events },
  });
  vm.runInContext("window = globalThis", context);
  for (const file of ["playback-status-model.js", "soop-playback-main.js"]) {
    vm.runInContext(fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), context);
  }
  return { context, network, snapshots, listeners, eventHandlers, data, core };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("VOD observation makes no request on its own and preserves the original fetch response", async () => {
  const o = observer();
  assert.equal(o.network.calls, 0);
  const promise = o.context.fetch("https://api.m.sooplive.com/station/video/a/view");
  assert.equal(promise, o.network.lastPromise);
  const response = await promise;
  assert.deepEqual(await response.json(), o.data);
  await settle();
  await settle();
  assert.equal(o.snapshots.at(-1).quickview, "basic");
  assert.equal(o.snapshots.at(-1).subscribed, false);
  assert.doesNotMatch(JSON.stringify(o.snapshots), /SECRET|test-account/);
});
test("VOD actual events update and clear ads without calling any playback action", async () => {
  const o = observer();
  await o.context.fetch("https://api.m.sooplive.com/station/video/a/view");
  await settle();
  await settle();
  o.listeners.get("AD_PLAYING")({ data: { adPlayingRollType: "PRE" } });
  assert.equal(o.snapshots.at(-1).placements.pre.state, "playing");
  o.listeners.get("NO_AD")({ data: { adPlayingRollType: "PRE" } });
  assert.equal(o.snapshots.at(-1).placements.pre.state, "no_fill");
  o.listeners.get("AD_API_ERROR")({ data: { adPlayingRollType: "MID" } });
  assert.equal(o.snapshots.at(-1).placements.mid.state, "error");
  o.listeners.get("PLAYING")();
  assert.equal(o.snapshots.at(-1).placements.mid.state, "unknown");
  o.eventHandlers.get("pagehide")();
  assert.equal(o.listeners.size, 0);
});
test("XHR observer preserves arguments/return value and ignores all unrelated responses", () => {
  const o = observer();
  const xhr = new o.context.XMLHttpRequest();
  assert.equal(
    xhr.open("POST", "https://api.m.sooplive.com/station/video/a/view", true),
    "original-open-result"
  );
  assert.deepEqual(xhr.openArgs, ["POST", "https://api.m.sooplive.com/station/video/a/view", true]);
  xhr.status = 200;
  xhr.responseType = "json";
  xhr.response = o.data;
  xhr.dispatchEvent(new Event("load"));
  assert.equal(o.snapshots.at(-1).quickview, "basic");
  const count = o.snapshots.length;
  xhr.open("POST", "https://api.m.sooplive.com/private/account");
  xhr.response = { result: 1, data: { ...o.data.data, subscribed: true } };
  xhr.dispatchEvent(new Event("load"));
  assert.equal(o.snapshots.length, count);
});
test("late metadata cannot overwrite a newer subscription response", () => {
  const o = observer();
  const older = new o.context.XMLHttpRequest();
  const newer = new o.context.XMLHttpRequest();
  const endpoint = "https://api.m.sooplive.com/station/video/a/view";
  older.open("POST", endpoint);
  newer.open("POST", endpoint);
  for (const xhr of [older, newer]) {
    xhr.status = 200;
    xhr.responseType = "json";
  }
  newer.response = { result: 1, data: { ...o.data.data, subscribed: true } };
  newer.dispatchEvent(new Event("load"));
  older.response = o.data;
  older.dispatchEvent(new Event("load"));
  assert.equal(o.snapshots.at(-1).subscribed, true);
});
test("ad time updates recover an already-running ad without a playback command", () => {
  const o = observer();
  o.listeners.get("AD_TIMEUPDATE")({ data: { adCurrentTime: 3 } });
  assert.equal(o.snapshots.at(-1).placements.pre.state, "playing");
  assert.equal(o.network.calls, 0);
});
