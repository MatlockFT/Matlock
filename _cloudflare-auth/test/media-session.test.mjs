import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaSessionHandler, NETLIFY_MEDIA_BASE } from '../functions/writer-media-session.mjs';
const store=()=>{const data=new Map();return {async get(k){return data.get(k)||null;},async setJSON(k,v){data.set(k,v)}}};
const request=(origin='https://mmamatlock.com')=>new Request('https://cloudflare.test/api/writer/media-session',{method:'POST',headers:{Origin:origin,'X-Writer-Session':'mws_valid_fake_session'}});

test('Cloudflare authorizes Netlify server-to-server, caches the media session and never returns GitHub credentials',async()=>{
 let calls=0; const memory=store();
 const handler=createMediaSessionHandler({storeFactory:()=>memory,getSession:async()=>({token:'github_only_on_servers',sessionExpiresAt:Date.now()+3600000}),fetcher:async(url,options)=>{
  calls++;assert.equal(url,NETLIFY_MEDIA_BASE+'/api/writer/media-session');assert.equal(options.headers.Authorization,'Bearer github_only_on_servers');assert.equal(options.redirect,'error');
  return Response.json({ok:true,sessionId:'mwm_'+'A'.repeat(48),expiresAt:Date.now()+3500000});
 }});
 for(let i=0;i<2;i++){const response=await handler(request());assert.equal(response.status,200);const body=await response.text();assert.doesNotMatch(body,/github_only_on_servers/);assert.equal(JSON.parse(body).mediaBase,NETLIFY_MEDIA_BASE);}
 assert.equal(calls,1);
});
test('expired sign-in and untrusted origins cannot bootstrap media sessions',async()=>{
 const handler=createMediaSessionHandler({getSession:async()=>null});
 assert.equal((await handler(request())).status,401);assert.equal((await handler(request('https://evil.example'))).status,403);
});
test('Netlify failure is an upload-only 503 instead of a Cloudflare sign-in failure',async()=>{
 const handler=createMediaSessionHandler({getSession:async()=>({token:'server_only_token'}),storeFactory:store,fetcher:async()=>new Response('Monthly limit reached',{status:402})});
 const response=await handler(request());assert.equal(response.status,503);assert.match((await response.json()).error,/article saving are still available/);
});
