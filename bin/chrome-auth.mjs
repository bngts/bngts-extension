import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export const REDIRECT_URI = 'http://127.0.0.1:8765/oauth2/callback';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
async function exchange(params, fetchImpl) {
  const response = await fetchImpl(TOKEN_URL, { method: 'POST', body: new URLSearchParams(params), signal: AbortSignal.timeout(30000) });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(`Google OAuth 인증 실패 (${response.status}, ${body.error || 'unknown'})`);
    error.oauthCode = body.error;
    throw error;
  }
  if (!body.access_token) throw new Error('Google OAuth access token 응답 누락');
  return body;
}
function openBrowser(url) {
  const chromePaths = process.platform === 'win32' ? [
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google/Chrome/Application/chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ] : [];
  const chrome = chromePaths.find(candidate => fs.existsSync(candidate));
  const command = chrome || (process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open');
  const args = process.platform === 'win32' && !chrome ? ['url.dll,FileProtocolHandler', url] : [url];
  const child = spawn(command, args, { shell: false, windowsHide: true, stdio: 'ignore', detached: true });
  child.on('error', () => console.log('브라우저를 열지 못했습니다. 위 로그인 주소를 직접 여세요.'));
  child.on('exit', code => { if (code) console.log('브라우저 실행 실패. 위 로그인 주소를 직접 여세요.'); });
  child.unref();
}
export function saveRefreshToken(envPath, token) {
  const current = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const entry = `CWS_REFRESH_TOKEN=${JSON.stringify(token)}`;
  const updated = /^CWS_REFRESH_TOKEN=.*$/m.test(current)
    ? current.replace(/^CWS_REFRESH_TOKEN=.*$/m, () => entry)
    : `${current.trimEnd()}\n${entry}\n`;
  const temporary = `${envPath}.${process.pid}.tmp`;
  try { fs.writeFileSync(temporary, updated, { mode: 0o600 }); fs.renameSync(temporary, envPath); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
export async function authorizeInBrowser({ env, envPath, fetchImpl = fetch, launch = openBrowser }) {
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({ client_id: env.CWS_CLIENT_ID, redirect_uri: REDIRECT_URI,
    response_type: 'code', scope: 'https://www.googleapis.com/auth/chromewebstore', access_type: 'offline',
    prompt: 'consent', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  let resolveCode, rejectCode;
  const callback = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
  // Attach a handler before starting the listener, avoiding an unhandled rejection.
  callback.catch(() => {});
  let accepted = false;
  const server = http.createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const url = new URL(request.url, REDIRECT_URI);
    if (request.method !== 'GET' || url.pathname !== '/oauth2/callback') { response.writeHead(404).end(); return; }
    if (url.searchParams.get('state') !== state || accepted) { response.writeHead(400).end('Invalid OAuth state'); return; }
    accepted = true;
    if (url.searchParams.has('error') || !url.searchParams.get('code')) {
      response.writeHead(400).end('로그인 승인이 취소되었습니다. 터미널에서 다시 실행하세요.');
      rejectCode(new Error('Google 로그인 승인이 취소되었습니다.')); return;
    }
    response.end('승인 코드를 받았습니다. 창을 닫고 터미널에서 배포 진행 상태를 확인하세요.');
    resolveCode(url.searchParams.get('code'));
  });
  let timeout;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(8765, '127.0.0.1', resolve); });
    timeout = setTimeout(() => rejectCode(new Error('Google 로그인 대기 시간(5분)이 끝났습니다. 다시 실행하세요.')), 300000);
    console.log(`Google 로그인 필요. OAuth 클라이언트의 승인된 리디렉션 URI: ${REDIRECT_URI}`);
    console.log(`로그인 주소: ${auth.href}`);
    launch(auth.href);
    const code = await callback;
    const tokens = await exchange({ client_id: env.CWS_CLIENT_ID, client_secret: env.CWS_CLIENT_SECRET,
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier }, fetchImpl);
    if (!tokens.refresh_token) throw new Error('Refresh Token이 발급되지 않았습니다. 동의 화면에서 다시 승인하세요.');
    saveRefreshToken(envPath, tokens.refresh_token);
    env.CWS_REFRESH_TOKEN = tokens.refresh_token;
    console.log('새 Refresh Token을 .env.store에 저장했습니다.');
    return tokens.access_token;
  } finally { clearTimeout(timeout); server.close(); server.closeAllConnections(); }
}
export async function ensureChromeAuthorization({ env = process.env, envPath, fetchImpl = fetch,
  interactive = !env.CI, authorize = authorizeInBrowser } = {}) {
  if (!env.CWS_CLIENT_ID || !env.CWS_CLIENT_SECRET) throw new Error('CWS_CLIENT_ID와 CWS_CLIENT_SECRET을 먼저 설정하세요.');
  if (env.CWS_REFRESH_TOKEN?.trim()) {
    try {
      const tokens = await exchange({ client_id: env.CWS_CLIENT_ID, client_secret: env.CWS_CLIENT_SECRET,
        grant_type: 'refresh_token', refresh_token: env.CWS_REFRESH_TOKEN }, fetchImpl);
      console.log('Chrome 토큰 유효성 확인 완료');
      return tokens.access_token;
    } catch (error) {
      // Network failures and a bad client secret are not fixed by asking for consent.
      if (error.oauthCode !== 'invalid_grant') throw error;
      console.log('Chrome Refresh Token이 만료되었거나 취소되어 재인증이 필요합니다.');
    }
  }
  if (!interactive) throw new Error('Chrome 재인증 필요: 로컬에서 npm run auth:chrome 실행 후 CI의 Refresh Token을 갱신하세요.');
  return authorize({ env, envPath, fetchImpl });
}
