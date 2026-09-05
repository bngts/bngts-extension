import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import "../playback-status-model.js";

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  closest() { return null; }
  attachShadow() { this.shadowRoot = new Element("shadow"); return this.shadowRoot; }
  focus() { this.focused = true; }
}
function setup() {
  const context = vm.createContext({
    URL,
    chrome: { runtime: { getURL: (path) => `chrome-extension://test/${path}` } },
    document: {
      createElement: (tag) => new Element(tag),
      createElementNS: (_ns, tag) => new Element(tag),
    },
  });
  vm.runInContext(fs.readFileSync(new URL("../playback-status-ui.js", import.meta.url), "utf8"), context);
  return { ui: context.BngtsStatusUI, container: new Element("div") };
}
const example = (patch = {}) => ({
  key: "alpha:pre", playerKey: "alpha", platform: "soop", channel: "알파 방송",
  title: "이 방송 미구독 · 퀵뷰 미적용", description: "입장광고가 표시될 수 있습니다.",
  actions: [{ label: "퀵뷰 확인", href: "https://item.sooplive.com/quickview.php" }],
  ...patch,
});
const find = (node, tag) => [node, ...node.children.flatMap((child) => find(child, tag))].filter((child) => child.tag === tag);

test("website notice uses bundled platform logos and named official destinations", () => {
  const { ui, container } = setup();
  // Renderer contract only: CHZZK does not currently supply observed ad alerts.
  const chzzk = example({ platform: "chzzk", channel: "치지직", actions: [{
    label: "치지직 로그인", href: "https://nid.naver.com/nidlogin.login",
  }] });
  ui.renderList(container, [example(), chzzk]);
  assert.deepEqual(find(container, "img").map((img) => img.src), [
    "chrome-extension://test/brand/soop.svg", "chrome-extension://test/brand/chzzk.png",
  ]);
  const links = find(container, "a");
  assert.equal(links.length, 2);
  assert.match(links[0].className, /is-soop/);
  assert.match(links[1].className, /is-chzzk/);
  assert.equal(new URL(links[1].href).searchParams.get("url"), "https://chzzk.naver.com/");
  for (const link of links) {
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(find(link, "small")[0].textContent, new URL(link.href).hostname);
    assert.match(link.attributes["aria-label"], /공식 사이트.*새 탭/);
  }
  assert.equal(find(container, "input").length, 0);
});

test("official branding rejects lookalikes, redirects, credentials, cross-platform and unknown paths", () => {
  const { ui, container } = setup();
  for (const [platform, href] of [
    ["soop", "https://item.sooplive.com.evil.test/quickview.php"],
    ["soop", "https://item.sooplive.com/quickview.php?redirect=https://evil.test"],
    ["soop", "https://evil.test@item.sooplive.com/quickview.php"],
    ["soop", "https://item.sooplive.com:8443/quickview.php"],
    ["soop", "https://login.sooplive.com/unverified"],
    ["chzzk", "https://nid.naver.com/nidlogin.login?url=https://evil.test/"],
    ["chzzk", "https://nid.naver.com/nidlogin.login?url=https%3A%2F%2Fchzzk.naver.com%2F&url=https://evil.test/"],
    ["soop", "https://nid.naver.com/nidlogin.login"],
    ["constructor", "https://item.sooplive.com/quickview.php"],
    ["soop", "javascript:alert(1)"],
  ]) {
    ui.renderList(container, [example({ platform, actions: [{ label: "로그인", href }] })]);
    assert.equal(find(container, "a").length, 0, href);
  }
});

test("all generated actionable website cases retain their official links", () => {
  const { ui, container } = setup();
  for (const patch of [
    { quickview: "none", subscribed: false },
    { quickview: "unapplied" },
    { loggedIn: false },
  ]) {
    const alerts = globalThis.BngtsPlayback.playerAlerts({
      kind: "live", streamerId: "alpha-beta_1", label: "알파", loggedIn: true,
      placements: { pre: { state: "playing" } }, ...patch,
    });
    assert.equal(alerts[0].platform, "soop");
    ui.renderList(container, alerts);
    assert.equal(find(container, "a").length, alerts[0].actions.length);
  }
});

test("polling preserves existing DOM; channel text is not parsed as HTML; ignore keeps original key", async () => {
  const { ui, container } = setup();
  const ignored = [];
  const alert = example({ channel: '<img src=x onerror="bad()">' });
  const handlers = { onIgnore: (key) => ignored.push(key) };
  ui.renderList(container, [alert], handlers);
  const item = container.children[0];
  assert.equal(item.children[0].children[1].textContent, alert.channel);
  ui.renderList(container, [alert], handlers);
  assert.equal(container.children[0], item);
  await find(item, "button")[0].listeners.click();
  assert.deepEqual(ignored, [alert.key]);
  assert.match(find(item, "button")[0].title, /현재 시청 세션/);
});

test("one aggregate panel starts collapsed, counts channels, supports Escape and ignore all", async () => {
  const { ui, container } = setup();
  const ignored = [];
  const panel = ui.mountPanel(container, "test.css", () => {}, (key) => ignored.push(key));
  panel.update([example(), example({ key: "alpha:mid" }), example({ key: "beta:pre", playerKey: "beta" })]);
  assert.equal(container.children.length, 1);
  const section = panel.host.shadowRoot.children[1];
  const [header, details] = section.children;
  const [toggle, dismiss] = header.children;
  assert.equal(details.hidden, true);
  assert.equal(toggle.textContent, "광고 재생 중 · 2개 방송");
  toggle.listeners.click();
  assert.equal(details.hidden, false);
  section.listeners.keydown({ key: "Escape", stopPropagation() {} });
  assert.equal(details.hidden, true);
  assert.equal(toggle.focused, true);
  await dismiss.listeners.click();
  assert.deepEqual(ignored, [null]);
});
