import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createWriteStream } from "fs";
import archiver from "archiver";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// package.json에서 버전 정보 가져오기
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"));
const VERSION = pkg.version;

// 설정
const PLATFORMS = ["chrome", "firefox"];
const COMMON_FILES = [
  "chzzk.js",
  "soop.js",
  "bngts-status.js",
  "playback-status-model.js",
  "playback-status-ui.js",
  "popup-login-ui.js",
  "brand/soop.svg",
  "brand/chzzk.png",
  "playback-status.css",
  "soop-playback-main.js",
  "soop-playback-isolated.js",
  "popup.html",
  "popup.js",
  "popup.css",
  "permission.html",
  "permission.js",
  "permission.css",
  "rules.json",
  "icon16.png",
  "icon48.png",
  "icon128.png",
];
const LIB_DIR = "lib";

// 디렉토리 정리 및 생성
const ensureDir = (dir) => {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }
  fs.mkdirSync(dir, { recursive: true });
};

// 파일 복사
const copyFile = (src, dest) => {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
};

// 디렉토리 복사
const copyDir = (src, dest) => {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
};

// manifest.json 병합
const mergeManifests = (base, override) => {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (typeof value === "object" && !Array.isArray(value) && value !== null) {
      result[key] = mergeManifests(result[key] || {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
};

// 스크립트 빌드 (common + platform-specific 결합)
const buildScript = (scriptName, platform, destDir) => {
  const commonPath = path.join(__dirname, "src", "common", `${scriptName}-common.js`);
  const platformPath = path.join(__dirname, "src", platform, `${scriptName}-${platform}.js`);

  let content = "";
  if (scriptName === "background") {
    for (const file of ["playback-status-model.js", "src/common/playback-status-background.js"]) {
      content += fs.readFileSync(path.join(__dirname, file), "utf-8") + "\n\n";
    }
  }

  // 공통 코드 읽기
  if (fs.existsSync(commonPath)) {
    content += fs.readFileSync(commonPath, "utf-8");
    content += "\n\n";
  }

  // 플랫폼별 코드 읽기
  if (fs.existsSync(platformPath)) {
    content += fs.readFileSync(platformPath, "utf-8");
  }

  if (content) {
    fs.writeFileSync(path.join(destDir, `${scriptName}.js`), content);
  }
};

// background.js 빌드
const buildBackgroundJs = (platform, destDir) => {
  buildScript("background", platform, destDir);
};

// soop-isolated.js 빌드
const buildSoopIsolatedJs = (platform, destDir) => {
  buildScript("soop-isolated", platform, destDir);
};

// chzzk-isolated.js 빌드
const buildChzzkIsolatedJs = (platform, destDir) => {
  buildScript("chzzk-isolated", platform, destDir);
};

// ZIP 파일 생성 (forward slash 경로 사용)
const createZip = (sourceDir, outPath) => {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      console.log(`  📦 ${path.basename(outPath)} (${archive.pointer()} bytes)`);
      resolve();
    });

    archive.on("error", reject);
    archive.pipe(output);

    // 디렉토리를 재귀적으로 추가 (forward slash 보장)
    archive.directory(sourceDir, false);
    archive.finalize();
  });
};

// 플랫폼별 빌드
const buildPlatform = async (platform) => {
  console.log(`\n🔨 Building for ${platform}...`);

  const distDir = path.join(__dirname, "dist", platform);
  ensureDir(distDir);

  // 1. 공통 파일 복사
  for (const file of COMMON_FILES) {
    const src = path.join(__dirname, file);
    if (fs.existsSync(src)) {
      copyFile(src, path.join(distDir, file));
    }
  }
  // Chromium deduplicates a content-script filename across worlds in the same frame.
  // Use a separate built filename for MAIN; the source of the rules stays shared.
  copyFile(path.join(__dirname, "playback-status-model.js"), path.join(distDir, "playback-status-main-model.js"));

  // 2. lib 디렉토리 복사
  const libSrc = path.join(__dirname, LIB_DIR);
  if (fs.existsSync(libSrc)) {
    copyDir(libSrc, path.join(distDir, LIB_DIR));
  }

  // 3. manifest.json 생성 (base + platform override)
  const basePath = path.join(__dirname, "src", "manifests", "manifest.base.json");
  const overridePath = path.join(__dirname, "src", "manifests", `manifest.${platform}.json`);

  const baseManifest = JSON.parse(fs.readFileSync(basePath, "utf-8"));
  const overrideManifest = fs.existsSync(overridePath)
    ? JSON.parse(fs.readFileSync(overridePath, "utf-8"))
    : {};

  const finalManifest = mergeManifests(baseManifest, overrideManifest);
  fs.writeFileSync(
    path.join(distDir, "manifest.json"),
    JSON.stringify(finalManifest, null, 2)
  );

  // 4. background.js 빌드
  buildBackgroundJs(platform, distDir);

  // 5. soop-isolated.js 빌드
  buildSoopIsolatedJs(platform, distDir);

  // 6. chzzk-isolated.js 빌드
  buildChzzkIsolatedJs(platform, distDir);

  console.log(`  ✅ Built to dist/${platform}/`);

  // 7. ZIP 파일 생성 (릴리즈용 파일명)
  const zipPath = path.join(__dirname, "dist", `bngts-plus-${VERSION}-${platform}.zip`);
  await createZip(distDir, zipPath);
};

// 메인 빌드 프로세스
const build = async () => {
  console.log("🚀 Starting build process...");

  // dist 디렉토리 초기화
  const distDir = path.join(__dirname, "dist");
  ensureDir(distDir);

  // 각 플랫폼별 빌드
  for (const platform of PLATFORMS) {
    await buildPlatform(platform);
  }

  console.log("\n✨ Build complete!");
  console.log(`   - dist/chrome/     (Chrome Web Store)`);
  console.log(`   - dist/firefox/    (Firefox Add-ons)`);
  console.log(`   - dist/bngts-plus-${VERSION}-chrome.zip`);
  console.log(`   - dist/bngts-plus-${VERSION}-firefox.zip`);
};

build().catch((err) => {
  console.error("❌ Build failed:", err);
  process.exit(1);
});
