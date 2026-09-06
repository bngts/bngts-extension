import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { publishChrome } from './upload.mjs';
import { ensureChromeAuthorization } from './chrome-auth.mjs';
import { releaseNotes } from './release-notes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const target = args[0];
const dryRun = args.includes('--dry-run');
const uploadOnly = args.includes('--upload-only');
const run = (file, args) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [file, ...args], { cwd: root, env: process.env, stdio: 'inherit', shell: false, windowsHide: true });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(file)} 실패 (exit ${code})`)));
});

async function main() {
  if (!['chrome', 'firefox', 'all'].includes(target) || args.slice(1).some(arg => !['--dry-run', '--upload-only'].includes(arg)))
    throw new Error('사용법: node bin/publish.mjs chrome|firefox|all [--dry-run] [--upload-only]');
  if (uploadOnly && target !== 'chrome') throw new Error('--upload-only는 Chrome에서만 지원합니다.');
  const envPath = path.join(root, '.env.store');
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
  const platforms = target === 'all' ? ['chrome', 'firefox'] : [target];
  const required = {
    chrome: ['CWS_PUBLISHER_ID', 'CWS_EXTENSION_ID', 'CWS_CLIENT_ID', 'CWS_CLIENT_SECRET'],
    firefox: ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET'],
  };
  const missing = platforms.flatMap(platform => required[platform]).filter(key => !process.env[key]?.trim());
  if (missing.length && !dryRun) throw new Error(`.env.store에 설정이 필요합니다: ${missing.join(', ')}`);
  const accessToken = !dryRun && platforms.includes('chrome')
    ? await ensureChromeAuthorization({ envPath }) : undefined;
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const notes = releaseNotes(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
  const manifestVersion = JSON.parse(fs.readFileSync(path.join(root, 'src/manifests/manifest.base.json'), 'utf8')).version;
  if (version !== manifestVersion) throw new Error('버전 불일치: npm run postversion 실행 후 다시 시도하세요.');
  // Build removes these directories; reject redirected paths before doing so.
  for (const relative of ['dist', 'dist/chrome', 'dist/firefox']) {
    const directory = path.join(root, relative);
    if (fs.existsSync(directory) && fs.realpathSync(directory) !== directory) throw new Error(`빌드 경로가 리디렉션되어 있습니다: ${relative}`);
  }
  await run(path.join(root, 'build.mjs'), []);
  const metadataPath = path.join(root, 'dist', `amo-metadata-${version}.json`);
  fs.writeFileSync(metadataPath, JSON.stringify(notes.metadata, null, 2) + '\n');
  fs.writeFileSync(path.join(root, 'dist', `release-notes-${version}.txt`), notes.text + '\n');
  for (const platform of platforms) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'dist', platform, 'manifest.json'), 'utf8'));
    if (manifest.version !== version) throw new Error(`${platform} 빌드 버전 불일치`);
    if (platform === 'firefox' && !manifest.browser_specific_settings?.gecko?.id) throw new Error('Firefox add-on ID 누락');
    const zipPath = path.join(root, 'dist', `bngts-plus-${version}-${platform}.zip`);
    if (!fs.statSync(zipPath).size) throw new Error(`${platform} ZIP이 비어 있습니다.`);
    if (dryRun) { console.log(`[dry-run] ${platform} ${version}: 빌드 확인 완료, 업로드하지 않음`); continue; }
    if (platform === 'chrome') await publishChrome({ zipPath, uploadOnly, accessToken });
    else {
      await run(path.join(root, 'node_modules/web-ext/bin/web-ext.js'), [
        'sign', '--source-dir', path.join(root, 'dist/firefox'), '--artifacts-dir', path.join(root, 'dist/firefox-signed'),
        '--channel', 'listed', '--approval-timeout', '0', '--no-input',
        '--amo-metadata', metadataPath,
      ]);
      console.log('Firefox 제출 명령 완료. 실제 심사/공개 상태는 AMO에서 확인하세요.');
    }
  }
  if (dryRun && missing.length) console.log(`실제 제출 전 필요한 설정: ${missing.join(', ')}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
