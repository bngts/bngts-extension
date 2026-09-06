import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureChromeAuthorization, saveRefreshToken } from '../bin/chrome-auth.mjs';
const config = () => ({CWS_CLIENT_ID:'test-client',CWS_CLIENT_SECRET:'test-secret',CWS_REFRESH_TOKEN:'test-refresh'});
const response = (ok, status, body) => async () => ({ok,status,json:async()=>body});
test('valid refresh token skips browser login', async()=>{
 let opened=false;const token=await ensureChromeAuthorization({env:config(),fetchImpl:response(true,200,{access_token:'access'}),authorize:async()=>{opened=true}});
 assert.equal(token,'access');assert.equal(opened,false);
});
test('revoked refresh token opens login and continues with new access token', async()=>{
 let opened=0;const token=await ensureChromeAuthorization({env:config(),fetchImpl:response(false,400,{error:'invalid_grant'}),authorize:async()=>{opened++;return 'new-access'}});
 assert.equal(token,'new-access');assert.equal(opened,1);
});
test('missing refresh token opens login without a failing refresh request',async()=>{
 const env=config();delete env.CWS_REFRESH_TOKEN;
 const token=await ensureChromeAuthorization({env,fetchImpl:async()=>{throw Error('unexpected request')},authorize:async()=>'new-access'});assert.equal(token,'new-access');
});
test('invalid client and network failures do not cause browser login loops',async()=>{
 for(const fetchImpl of [response(false,401,{error:'invalid_client'}),async()=>{throw Error('network failure')}])
 await assert.rejects(ensureChromeAuthorization({env:config(),fetchImpl,authorize:async()=>assert.fail('must not launch browser')}));
});
test('CI invalid token fails with reauthentication instructions',async()=>{
 await assert.rejects(ensureChromeAuthorization({env:{...config(),CI:'true'},fetchImpl:response(false,400,{error:'invalid_grant'}),authorize:async()=>assert.fail('must not launch')}),/npm run auth:chrome/);
});
test('saving new refresh token preserves other store credentials',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bngts-auth-')),file=path.join(dir,'.env.store');
 try {fs.writeFileSync(file,'CWS_CLIENT_ID=client\nCWS_REFRESH_TOKEN=old\nWEB_EXT_API_SECRET=keep\n');saveRefreshToken(file,'new-token');const s=fs.readFileSync(file,'utf8');assert.match(s,/CWS_REFRESH_TOKEN="new-token"/);assert.match(s,/WEB_EXT_API_SECRET=keep/);assert.match(s,/CWS_CLIENT_ID=client/);}
 finally{fs.unlinkSync(file);fs.rmdirSync(dir)}
});
