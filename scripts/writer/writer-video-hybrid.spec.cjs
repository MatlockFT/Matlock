const {test,expect}=require('@playwright/test');
const {startWriterFixture}=require('./writer-preview-fixture.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const auth='https://mmamatlock-writer-auth.fighttalkmma.workers.dev';
const media='https://mmamatlock-writer-auth.netlify.app';
const mediaId='mwm_'+'M'.repeat(48), writerId='mws_writer_hybrid_test_session';
let fixture;
test.beforeAll(async()=>{fixture=await startWriterFixture();});test.afterAll(async()=>fixture.close());
async function setup(page,{unavailable=false}={}){
 const state={parts:new Map(),exchange:0,renewals:0,articleSaves:0,finalized:null,blocked:false};
 const headers={'access-control-allow-origin':fixture.origin,'access-control-allow-headers':'accept,content-type,x-writer-session,x-upload-id,x-chunk-index,x-chunk-count,x-file-size,x-file-type,x-asset-name','access-control-allow-methods':'GET,POST,PUT,OPTIONS'};
 await page.addInitScript(({writerId})=>{localStorage.setItem('matlock-writer:server-session',writerId)}, {writerId});
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.origin===fixture.origin)return route.continue();
  const respond=(status,body)=>route.fulfill({status,headers,body:JSON.stringify(body)});
  if(req.method()==='OPTIONS')return respond(204,null);
  if(url.origin===auth){
   if(url.pathname==='/auth/github/health')return respond(200,{ok:true,configured:true});
   if(url.pathname==='/api/writer/session')return respond(200,{ok:true,login:'MatlockFT'});
   if(url.pathname==='/api/writer/media-session'){
    expect(req.headers()['x-writer-session']).toBe(writerId);state.exchange++;
    if(!unavailable&&state.exchange===2)expect(req.postDataJSON().renew).toBe(true);
    return unavailable?respond(503,{error:'Netlify video uploads are unavailable. Article saving remains available.'}):respond(200,{ok:true,mediaBase:media,sessionId:mediaId,expiresAt:Date.now()+3600000});
   }
   if(url.pathname==='/api/writer/github'){
    expect(req.headers()['x-writer-session']).toBe(writerId);
    if(req.method()==='PUT'){state.articleSaves++;return respond(200,{content:{sha:'fake-saved-article'}})}
    const p=url.searchParams.get('path')||'';
    if(p==='')return respond(200,{owner:{login:'MatlockFT'},name:'Matlock'});
    if(p.includes('/contents/_posts/')||p.includes('/commits'))return respond(404,{message:'Not Found'});
    return respond(200,[]);
   }
   throw Error('Video bytes must never go to Cloudflare: '+url.pathname);
  }
  if(url.origin===media){
   expect(req.headers()['x-writer-session']).toBe(mediaId);
   if(url.pathname==='/api/writer/media-chunk'){
    const index=Number(req.headers()['x-chunk-index']||url.searchParams.get('chunkIndex'));
    if(req.method()==='GET')return respond(200,{found:state.parts.has(index),chunkSize:state.parts.get(index)?.length||0});
    // Expiration of upload authorization must renew it without signing out.
    if(index===1&&!state.renewals){state.renewals++;return respond(401,{error:'Upload session expired'})}
    const bytes=req.postDataBuffer();expect(bytes.length).toBeLessThanOrEqual(3500000);state.parts.set(index,bytes);
    // Stage the bytes but drop the response; confirmation must prevent a repeat.
    if(index===2&&!state.blocked){state.blocked=true;return route.abort('connectionreset')}
    return respond(200,{ok:true,chunkIndex:index,chunkSize:bytes.length});
   }
   if(url.pathname==='/api/writer/media-finalize'){state.finalized=req.postDataJSON();return respond(202,{state:'queued'})}
   if(url.pathname==='/api/writer/media-status')return respond(200,{state:'complete',url:'https://github.com/MatlockFT/Matlock/releases/download/writer-media-test/large.mp4'});
   throw Error('Unexpected media route '+url.pathname);
  }
  return route.abort();
 });
 await page.goto(fixture.origin+'/write/');await page.click('[data-library-new]');
 await expect(page.locator('[data-github-status]')).toContainText('Connected to');
 await page.fill('[data-field="title"]','Hybrid video test');
 await page.fill('#writer-body','Article content remains editable.');
 return state;
}
test('200 MiB video goes only to Netlify, confirms interrupted parts and renews upload-only authorization',async({page})=>{
 test.setTimeout(180000);const state=await setup(page);
 const file=path.join(os.tmpdir(),'matlock-hybrid-'+Date.now()+'.mp4');const size=200*1024**2;
 const fd=fs.openSync(file,'w');fs.ftruncateSync(fd,size);fs.writeSync(fd,Buffer.from('MATLOCK_START'),0,13,0);fs.writeSync(fd,Buffer.from('MATLOCK_END'),0,11,size-11);fs.closeSync(fd);
 try{
  await page.click('[data-tool="video"]');await page.locator('[data-inline-video-file]').setInputFiles(file);
  await page.click('[data-video-insert]');
  await expect(page.locator('#writer-body')).toHaveValue(/releases\/download\/writer-media-test\/large.mp4/,{timeout:150000});
  expect(state.parts.size).toBe(Math.ceil(size/3500000));
  expect([...state.parts.values()].reduce((n,v)=>n+v.length,0)).toBe(size);
  expect(state.parts.get(0).subarray(0,13).toString()).toBe('MATLOCK_START');
  const last=state.parts.get(state.parts.size-1);expect(last.subarray(last.length-11).toString()).toBe('MATLOCK_END');
  expect(state.exchange).toBe(2);expect(state.finalized.fileSize).toBe(size);expect(state.blocked).toBe(true);
  await expect(page.locator('[data-github-status]')).toContainText('Connected to');
  await page.click('[data-save-draft]');await expect.poll(()=>state.articleSaves).toBe(1);
 }finally{fs.rmSync(file,{force:true})}
});
test('Netlify unavailable leaves Cloudflare article saving connected',async({page})=>{
 const state=await setup(page,{unavailable:true});
 await page.click('[data-tool="video"]');await page.locator('[data-inline-video-file]').setInputFiles({name:'clip.mp4',mimeType:'video/mp4',buffer:Buffer.from('fake clip')});
 await page.click('[data-video-insert]');await expect(page.locator('.writer-toast')).toContainText('Netlify video uploads are unavailable');
 await expect(page.locator('[data-github-status]')).toContainText('Connected to');
 await page.keyboard.press('Escape');await page.click('[data-save-draft]');await expect.poll(()=>state.articleSaves).toBe(1);
});
test('upload manager reports stages and recovers a published video into the draft',async({page})=>{
 const state = await setup(page);
 await page.click('[data-tool="video"]');
 await page.locator('[data-inline-video-file]').setInputFiles({name:'recoverable-clip.mp4',mimeType:'video/mp4',buffer:Buffer.from('test video data')});
 await page.click('[data-video-insert]');
 await expect(page.locator('#writer-body')).toHaveValue(/releases\/download\/writer-media-test\/large.mp4/,{timeout:30000});
 await expect(page.locator('[data-video-dialog]')).not.toBeVisible();
 await page.fill('#writer-body','Restoring a previous upload.\n\n');
 await page.click('[data-tool="video"]');
 await expect(page.locator('[data-video-history-select]')).toContainText('recoverable-clip.mp4');
 await expect(page.locator('[data-video-diag-state]')).toContainText('Placed in editor');
 await page.locator('[data-video-history-details] summary').click();
 await page.click('[data-video-check-status]');
 await expect(page.locator('[data-video-diag-state]')).toContainText('On GitHub');
 await expect(page.locator('[data-video-use-upload]')).toBeVisible();
 await page.click('[data-video-use-upload]');
 await expect(page.locator('#writer-body')).toHaveValue(/releases\/download\/writer-media-test\/large.mp4/);
 await expect(page.locator('[data-video-diag-state]')).toContainText('Placed in editor');
 expect(state.finalized).not.toBeNull();
});
