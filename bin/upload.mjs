import fs from 'node:fs';

export async function publishChrome({ env = process.env, zipPath, uploadOnly = false, accessToken, fetchImpl = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const request = async (url, options = {}) => {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Chrome API HTTP ${response.status}; 스토어 대시보드와 API 권한을 확인하세요.`);
    return response.json();
  };
  const token = accessToken ? { access_token: accessToken } : await request('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({ client_id: env.CWS_CLIENT_ID, client_secret: env.CWS_CLIENT_SECRET, refresh_token: env.CWS_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (!token.access_token) throw new Error('Chrome OAuth access token 발급 실패');
  const name = `publishers/${encodeURIComponent(env.CWS_PUBLISHER_ID)}/items/${encodeURIComponent(env.CWS_EXTENSION_ID)}`;
  const base = `https://chromewebstore.googleapis.com/v2/${name}`;
  const headers = { Authorization: `Bearer ${token.access_token}` };
  let result = await request(`https://chromewebstore.googleapis.com/upload/v2/${name}:upload`, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/zip' }, body: fs.readFileSync(zipPath),
  });
  let state = result.uploadState;
  for (let attempt = 0; ['IN_PROGRESS', 'UPLOAD_IN_PROGRESS'].includes(state) && attempt < 30; attempt++) {
    await wait(2000);
    result = await request(`${base}:fetchStatus`, { headers });
    state = result.lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`Chrome 업로드 미완료 (${state || 'unknown'}). 게시하지 않았습니다.`);
  console.log('Chrome ZIP 업로드 완료');
  if (!uploadOnly) {
    await request(`${base}:publish`, { method: 'POST', headers });
    console.log('Chrome 심사 제출 완료. 실제 공개 상태는 스토어 대시보드에서 확인하세요.');
  }
}
