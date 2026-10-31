import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaSessionHandler, getMediaSession } from '../netlify/functions/writer-media-session.mjs';
import { getWriterSession } from '../netlify/functions/_writer-session.mjs';
import { MAX_VIDEO_CHUNKS, validateMediaMetadata } from '../netlify/functions/_writer-media.mjs';
const memory = () => { const data = new Map(); return { async get(k) {return data.get(k) || null;}, async setJSON(k,v) { data.set(k,v); } }; };
const request = (body={}, extra={}) => new Request('https://netlify.test/api/writer/media-session', { method:'POST', headers:{Authorization:'Bearer github_owner_test_credential', 'Content-Type':'application/json',...extra}, body:JSON.stringify(body) });
const github = async url => Response.json(url.endsWith('/user') ? {login:'MatlockFT'} : {full_name:'MatlockFT/Matlock',permissions:{push:true}});

test('upload-only session verifies GitHub ownership, renews in place and cannot authorize article saving', async()=>{
 const store=memory(); const handler=createMediaSessionHandler({storeFactory:()=>store,fetcher:github});
 const first=await handler(request()); assert.equal(first.status,200);
 const session=await first.json();assert.match(session.sessionId,/^mwm_/);assert.equal(session.token,undefined);
 assert.equal((await getMediaSession(session.sessionId,{store})).login,'MatlockFT');
 assert.equal(await getWriterSession(session.sessionId),null);
 const renewed=await (await handler(request({previousId:session.sessionId}))).json(); assert.equal(renewed.sessionId,session.sessionId);
 assert.equal(await getMediaSession('mws_not_media',{store}),null);
});
test('browser-origin bootstrap, wrong owner and read-only tokens are rejected',async()=>{
 const store=memory();const handler=createMediaSessionHandler({storeFactory:()=>store,fetcher:github});
 assert.equal((await handler(request({}, {Origin:'https://mmamatlock.com'}))).status,403);
 for(const fetcher of [async()=>Response.json({login:'someone-else'}),async url=>Response.json(url.endsWith('/user')?{login:'MatlockFT'}:{full_name:'MatlockFT/Matlock',permissions:{push:false}})]){
  assert.equal((await createMediaSessionHandler({storeFactory:()=>store,fetcher})(request())).status,403);
 }
});
test('expired upload authorization is rejected and upstream failures do not disclose tokens',async()=>{
 const store=memory();const handler=createMediaSessionHandler({storeFactory:()=>store,fetcher:github});
 assert.equal((await handler(request({tokenExpiresAt:Date.now()-1}))).status,401);
 const response=await createMediaSessionHandler({storeFactory:()=>store,fetcher:async()=>{throw Error('github_secret_should_not_leak')}})(request());
 assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/github_secret/);
});
test('Netlify supports 100-200 MiB and the Writer limit with bounded small chunks',()=>{
 for(const size of [100*1024**2,200*1024**2,2*1024**3-1]){
  const chunks=Math.ceil(size/3_500_000);assert.ok(chunks<=MAX_VIDEO_CHUNKS);
  assert.equal(validateMediaMetadata({assetName:'long-video.mp4',fileSize:size,fileType:'video/mp4',chunkCount:chunks}).fileSize,size);
 }
});
test('upload diagnostics retain state transitions without accumulating chunk entries',async()=>{
 const { setStatus, statusKey } = await import('../netlify/functions/_writer-media.mjs');
 const values = new Map();
 const store = {
   async get(key) { return values.get(key) || null; },
   async setJSON(key, value) { values.set(key, value); }
 };
 const scope = 'abcdefabcdefabcdefabcdef', id = 'diagnosticupload123';
 await setStatus(store, scope, id, { state: 'uploading', fileSize: 123 });
 await setStatus(store, scope, id, { state: 'queued', fileSize: 123 });
 await setStatus(store, scope, id, { state: 'preparing', fileSize: 123 });
 await setStatus(store, scope, id, { state: 'publishing', fileSize: 123 });
 await setStatus(store, scope, id, { state: 'error', failureStage: 'github-transfer', httpStatus: 502, error: 'Upstream response' });
 const entry = values.get(statusKey(scope,id));
 assert.deepEqual(entry.history.map(x=>x.state), ['queued','preparing','publishing','error']);
 assert.equal(entry.history.at(-1).httpStatus, 502);
 assert.equal(entry.history.at(-1).failureStage, 'github-transfer');
 assert.ok(entry.startedAt && entry.updatedAt);
 assert.ok(!JSON.stringify(entry).includes('github_owner_test_credential'));
});
