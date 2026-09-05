import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.attributes = {};
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}
function setup() {
  const context = vm.createContext({
    URL,
    document: {
      createElement: (tag) => new Element(tag),
      createElementNS: (_ns, tag) => new Element(tag),
    },
  });
  vm.runInContext(
    fs.readFileSync(new URL("../popup-login-ui.js", import.meta.url), "utf8"),
    context
  );
  return { render: context.BngtsLoginUI.render, container: new Element("div") };
}
test("two logged-out platforms render one compact notice with official destination links", () => {
  const { render, container } = setup();
  render(container, [{ key: "soop-login" }, { key: "chzzk-login" }]);
  assert.equal(container.children.length, 1);
  assert.equal(container.children[0].className, "bngts-login-notice");
  const links = container.children[0].children;
  assert.equal(links.length, 2);
  assert.equal(new URL(links[0].href).hostname, "login.sooplive.com");
  assert.equal(new URL(links[1].href).hostname, "nid.naver.com");
  assert.equal(new URL(links[1].href).searchParams.get("url"), "https://chzzk.naver.com/");
  for (const link of links) {
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener noreferrer");
    assert.equal(link.children[1].textContent, new URL(link.href).hostname);
    assert.match(link.children[0].children[0].src, /^brand\//);
  }
});
test("untrusted alert fields cannot alter login destinations or add extra notices", () => {
  const { render, container } = setup();
  render(container, [
    { key: "soop-login", actions: [{ href: "https://evil.test/" }] },
    { key: "soop-login" },
    { key: "unknown-login" },
  ]);
  assert.equal(container.children[0].children.length, 1);
  assert.equal(
    container.children[0].children[0].href,
    "https://login.sooplive.com/afreeca/login.php"
  );
});
test("unchanged login state preserves link focus and empty state removes the notice", () => {
  const { render, container } = setup();
  render(container, [{ key: "chzzk-login" }]);
  const notice = container.children[0];
  render(container, [{ key: "chzzk-login" }]);
  assert.equal(container.children[0], notice);
  render(container, []);
  assert.equal(container.children.length, 0);
});
test("official brand assets are bundled locally without active SVG content", () => {
  const build = fs.readFileSync(new URL("../build.mjs", import.meta.url), "utf8");
  for (const name of ["popup-login-ui.js", "brand/soop.svg", "brand/chzzk.png"])
    assert.ok(build.includes(`"${name}"`));
  const svg = fs.readFileSync(new URL("../brand/soop.svg", import.meta.url), "utf8");
  assert.doesNotMatch(svg, /<script|<foreignObject|\bonload\s*=|\bhref\s*=/i);
  const png = fs.readFileSync(new URL("../brand/chzzk.png", import.meta.url));
  assert.equal(png.subarray(1, 4).toString(), "PNG");
});
