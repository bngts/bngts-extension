import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const code = fs.readFileSync(new URL("../soop-audio-recovery.js", import.meta.url), "utf8");
function fixture({ referrer = "https://bngts.com/multiview/watch/s:alpha", top = false, saved = null } = {}) {
  let now = 0;
  const timers = new Set(), listeners = new Map(), contexts = [];
  const video = {
    currentTime: 10, paused: false, ended: false, seeking: false, muted: false,
    volume: 0.58, playbackRate: 1, readyState: 4, isConnected: true,
    buffered: { length: 1, start: () => 0, end: () => 30 },
  };
  const videos = [video];
  const storage = new Map(saved ? [["bngts:soop-web-audio", saved]] : []);
  const document = {
    referrer, hidden: false, querySelectorAll: () => videos,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  };
  class AudioContext {
    state = "running";
    destination = {};
    bindings = [];
    constructor() { contexts.push(this); }
    async resume() { this.state = "running"; }
    async suspend() { this.state = "suspended"; }
    async close() { this.state = "closed"; }
    createMediaElementSource(element) {
      const binding = { element, connects: 0, disconnects: 0,
        connect() { this.connects++; }, disconnect() { this.disconnects++; },
      };
      this.bindings.push(binding);
      return binding;
    }
  }
  const context = vm.createContext({ document, AudioContext, URL, console: { info() {} },
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    location: { hostname: "play.sooplive.com", pathname: "/alpha/direct" },
    performance: { now: () => now },
    setInterval: (fn) => { timers.add(fn); return fn; },
    clearInterval: (fn) => timers.delete(fn),
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
  });
  vm.runInContext(`window = globalThis; window.top = ${top ? "window" : "{}"}`, context);
  vm.runInContext(code, context);
  const tick = async (ms = 1000) => { now += ms; for (const fn of timers) fn(); await new Promise(resolve => setImmediate(resolve)); };
  const stall = async () => { for (let i = 0; i < 6; i++) await tick(); };
  return { video, videos, document, contexts, listeners, timers, context, tick, stall, storage };
}

test("recovers buffered audible clock stall once, preserving volume, mute and playback", async () => {
  const f = fixture();
  await f.stall(); await f.stall();
  assert.equal(f.contexts.length, 1);
  assert.equal(f.contexts[0].bindings.length, 1);
  assert.equal(f.contexts[0].bindings[0].element, f.video);
  assert.equal(f.video.volume, 0.58);
  assert.equal(f.video.muted, false);
  assert.equal(f.video.paused, false);
  assert.equal(f.video.currentTime, 10);
});

test("normal playback never creates an audio context", async () => {
  const f = fixture();
  for (let i = 0; i < 20; i++) { f.video.currentTime += 0.25; await f.tick(); }
  assert.equal(f.contexts.length, 0);
});

test("persists the working output path and applies it immediately to future players", async () => {
  const first = fixture(); await first.stall();
  assert.equal(first.storage.get("bngts:soop-web-audio"), "1");
  const next = fixture({ saved: first.storage.get("bngts:soop-web-audio") });
  await next.tick();
  assert.equal(next.contexts[0].bindings.length, 1);
});

test("other SOOP frames learn the recovered output path through storage events", async () => {
  const f = fixture();
  f.listeners.get("storage")({ key: "bngts:soop-web-audio", newValue: "1" });
  await f.tick(); assert.equal(f.contexts[0].bindings.length, 1);
});

for (const [name, update] of Object.entries({
  paused: (f) => f.video.paused = true,
  ended: (f) => f.video.ended = true,
  muted: (f) => f.video.muted = true,
  silent: (f) => f.video.volume = 0,
  seeking: (f) => f.video.seeking = true,
  loading: (f) => f.video.readyState = 2,
  unbuffered: (f) => f.video.buffered.length = 0,
  hidden: (f) => f.document.hidden = true,
  stoppedRate: (f) => f.video.playbackRate = 0,
})) test(`does not recover ${name} playback`, async () => {
  const f = fixture(); update(f); await f.stall(); assert.equal(f.contexts.length, 0);
});

test("a throttled timer is not evidence of a clock stall", async () => {
  const f = fixture();
  await f.tick(); await f.tick(6000);
  assert.equal(f.contexts.length, 0);
});

test("replacement video recovers; removed video disconnects; reinsertion reuses its source", async () => {
  const f = fixture(); await f.stall();
  const original = f.contexts[0].bindings[0];
  f.videos.splice(0, 1); f.video.isConnected = false; await f.tick();
  assert.equal(original.disconnects, 1);
  const replacement = { ...f.video, isConnected: true };
  f.videos.push(replacement); await f.stall();
  assert.equal(f.contexts[0].bindings.length, 2);
  f.video.isConnected = true; f.videos.push(f.video); await f.tick();
  assert.equal(original.connects, 2);
  assert.equal(f.contexts[0].bindings.length, 2);
});

test("page removal releases audio and timers; bfcache restores the existing graph", async () => {
  const f = fixture(); await f.stall();
  f.listeners.get("pagehide")({ persisted: true });
  assert.equal(f.timers.size, 0); assert.equal(f.contexts[0].state, "suspended");
  f.listeners.get("pageshow")({ persisted: true });
  assert.equal(f.timers.size, 1); assert.equal(f.contexts[0].state, "running");
  f.listeners.get("pagehide")({ persisted: false });
  assert.equal(f.timers.size, 0); assert.equal(f.contexts[0].state, "closed");
  assert.equal(f.contexts[0].bindings[0].disconnects, 1);
});

test("does not affect standalone SOOP or embeds on unrelated sites", async () => {
  for (const options of [{ top: true }, { referrer: "https://example.com/" }, { referrer: "" }]) {
    const f = fixture(options); await f.stall(); assert.equal(f.timers.size, 0);
  }
});

test("duplicate installation does not bind a video twice", async () => {
  const f = fixture(); vm.runInContext(code, f.context); await f.stall();
  assert.equal(f.timers.size, 1); assert.equal(f.contexts[0].bindings.length, 1);
});

test("an existing media source owned by another extension is never retried in a loop", async () => {
  const f = fixture(); let attempts = 0;
  f.context.AudioContext.prototype.createMediaElementSource = () => { attempts++; throw new Error("already bound"); };
  await f.stall(); await f.stall(); assert.equal(attempts, 1);
});

test("autoplay rejection leaves native audio untouched", async () => {
  const f = fixture();
  f.context.AudioContext.prototype.resume = async function () { this.state = "suspended"; throw new Error("NotAllowedError"); };
  await f.stall();
  assert.equal(f.contexts[0].bindings.length, 0);
  assert.equal(f.video.muted, false); assert.equal(f.video.paused, false);
});
