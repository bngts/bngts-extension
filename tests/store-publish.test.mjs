import test from 'node:test';
import assert from 'node:assert/strict';
import { publishChrome } from '../bin/upload.mjs';
const env={CWS_CLIENT_ID:'test-client',CWS_CLIENT_SECRET:'test-secret',CWS_REFRESH_TOKEN:'test-refresh',CWS_PUBLISHER_ID:'publisher',CWS_EXTENSION_ID:'item'};
const zipPath=new URL('../package.json',import.meta.url);
function mock(replies){const calls=[];return {calls,fetchImpl:async(url,options)=>{calls.push({url,options});assert.ok(replies.length,'Unexpected API request');return {ok:true,status:200,json:async()=>replies.shift()}}};}
test('v2 waits for asynchronous upload before submitting review',async()=>{
 const m=mock([{access_token:'test-token'},{uploadState:'IN_PROGRESS'},{lastAsyncUploadState:'SUCCEEDED'},{}]);
 await publishChrome({env,zipPath,fetchImpl:m.fetchImpl,wait:async()=>{}});
 assert.equal(m.calls[1].url,'https://chromewebstore.googleapis.com/upload/v2/publishers/publisher/items/item:upload');
 assert.ok(m.calls[2].url.endsWith(':fetchStatus'));assert.ok(m.calls[3].url.endsWith(':publish'));
});
test('failed upload never publishes',async()=>{
 const m=mock([{access_token:'test-token'},{uploadState:'FAILED'}]);
 await assert.rejects(publishChrome({env,zipPath,fetchImpl:m.fetchImpl}),/FAILED/);assert.equal(m.calls.length,2);
});
test('upload-only does not submit review',async()=>{
 const m=mock([{access_token:'test-token'},{uploadState:'SUCCEEDED'}]);
 await publishChrome({env,zipPath,fetchImpl:m.fetchImpl,uploadOnly:true});assert.equal(m.calls.length,2);
});
test('HTTP failure stops without logging token response',async()=>{
 await assert.rejects(publishChrome({env,zipPath,fetchImpl:async()=>({ok:false,status:401})}),/HTTP 401/);
});
