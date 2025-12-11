import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// package.json에서 버전 읽기
const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, "package.json"), "utf-8")
);
const version = packageJson.version;

// manifest.base.json 업데이트
const manifestPath = path.join(rootDir, "src", "manifests", "manifest.base.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
manifest.version = version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.log(`✅ Version synced to ${version}`);
