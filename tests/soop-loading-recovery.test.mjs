import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const code = fs.readFileSync(new URL("../soop-loading-recovery.js", import.meta.url), "utf8");
function fixture({ pending = true, connected = true, responds = true } = {}) {
  let now = 0, tick, opens = 0, closes = 0;
  const request = {}, listeners = new Map();
  const socket = {
    promiseList: pending ? { HTMLPORT: request } : {}, socket: { oWS: { readyState: connected ? 1 : 0 } },
    openStreamer() { opens++; if (responds) delete this.promiseList.HTMLPORT; },
    async close() { closes++; delete this.promiseList.HTMLPORT; },
  };
  const context = vm.createContext({
    URL, Symbol, performance: { now: () => now },
    location: { hostname: "play.sooplive.com", pathname: "/alpha/direct" },
    document: { referrer: "https://bngts.com/multiview/watch/s:alpha" },
    navigator: { locks: { request: async (name, run) => run() } },
    livePlayer: { streamConnector: { packageSocket: socket } },
    setInterval: fn => { tick = fn; return 1; }, clearInterval: () => {},
    setTimeout: (fn, ms) => { now += ms; queueMicrotask(fn); return 1; },
    addEventListener: (name, fn) => listeners.set(name, fn),
  });
  vm.runInContext("window = globalThis; top = {}", context);
  vm.runInContext(code, context);
  return { socket, listeners, get opens() { return opens; }, get closes() { return closes; },
    async advance(ms) { now += ms; tick(); await new Promise(resolve => setImmediate(resolve)); },
  };
}
test("normal and still-connecting players are not queued or restarted", async () => {
  for (const options of [{ pending: false }, { connected: false }]) {
    const f = fixture(options); await f.advance(0); await f.advance(10000);
    assert.equal(f.opens, 0); assert.equal(f.closes, 0);
  }
});
test("only an unanswered open connection is retried and stops when the real response arrives", async () => {
  const f = fixture(); await f.advance(0); await f.advance(2999); assert.equal(f.opens, 0);
  await f.advance(1); assert.equal(f.opens, 1);
  await f.advance(10000); assert.equal(f.opens, 1); assert.equal(f.closes, 0);
});
test("three unanswered retries hand failure back to SOOP instead of looping forever", async () => {
  const f = fixture({ responds: false }); await f.advance(0);
  for (let i = 0; i < 5; i++) await f.advance(3000);
  assert.equal(f.opens, 3); assert.equal(f.closes, 1);
});
test("removing the iframe cancels pending recovery", async () => {
  const f = fixture(); await f.advance(0); f.listeners.get("pagehide")();
  await f.advance(10000); assert.equal(f.opens, 0);
});
