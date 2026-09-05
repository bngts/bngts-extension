import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const manifest = JSON.parse(
  fs.readFileSync(new URL("../src/manifests/manifest.base.json", import.meta.url), "utf8")
);

test("MAIN and isolated worlds use distinct filenames, not Chromium's deduplicated script", () => {
  const worlds = new Map();
  for (const entry of manifest.content_scripts) {
    for (const file of entry.js) {
      if (!worlds.has(file)) worlds.set(file, new Set());
      worlds.get(file).add(entry.world || "ISOLATED");
    }
  }
  for (const [file, set] of worlds)
    assert.equal(set.size, 1, `${file} must not be shared across execution worlds`);
});
test("no new sensitive browser privileges or public account/status scripts", () => {
  assert.equal(manifest.permissions.includes("webRequest"), false);
  assert.equal(manifest.permissions.includes("scripting"), false);
  const exposed = manifest.web_accessible_resources.flatMap((entry) => entry.resources);
  assert.deepEqual(exposed, ["playback-status.css", "brand/soop.svg", "brand/chzzk.png"]);
  for (const entry of manifest.web_accessible_resources)
    assert.deepEqual(entry.matches, ["https://bngts.com/*", "https://www.bngts.com/*", "http://localhost/*"]);
});
