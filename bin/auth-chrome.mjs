import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureChromeAuthorization } from './chrome-auth.mjs';
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env.store');
try {
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
  await ensureChromeAuthorization({ envPath });
  console.log('Chrome 인증 준비 완료. 스토어에 업로드하지 않았습니다.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
