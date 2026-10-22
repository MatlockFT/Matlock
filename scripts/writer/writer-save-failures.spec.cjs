const {test,expect}=require('@playwright/test');
const {startWriterFixture}=require('./writer-preview-fixture.cjs');
let fixture;
test.beforeAll(async()=>{fixture=await startWriterFixture();});
test.afterAll(async()=>{await fixture.close();});
test('failed save retains local draft',async({page})=>{
 let release, payload;
 const gate=new Promise(resolve=>release=resolve);
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type,accept,x-github-api-version','access-control-allow-methods':'GET,PUT,OPTIONS'};
 await page.route('https://mmamatlock-writer-auth.fighttalkmma.workers.dev/**',r=>r.fulfill({status:401,headers,body:'{}'}));
 await page.route('https://api.github.com/**',async r=>{
  const req=r.request(),url=new URL(req.url());
  if(req.method()==='OPTIONS')return r.fulfill({status:204,headers});
  if(req.method()==='PUT'){
   payload=req.postDataJSON(); await gate;
   return r.fulfill({status:500,headers,body:JSON.stringify({message:'Simulated server failure'})});
  }
  if(url.pathname.endsWith('/Matlock'))return r.fulfill({status:200,headers,body:'{"owner":{"login":"MatlockFT"},"name":"Matlock"}'});
  if(url.pathname.endsWith('/_posts'))return r.fulfill({status:200,headers,body:'[]'});
  return r.fulfill({status:404,headers,body:'{"message":"Not Found"}'});
 });
 await page.goto(fixture.origin+'/write/');
 await page.click('[data-library-new]');
 await page.fill('[data-field="title"]','Save race QA');
 await page.fill('#writer-body','Before save.');
 await page.click('[data-github-connect]');
 await page.locator('.writer-token-fallback').evaluate(el=>el.open=true);
 await page.fill('[data-github-token]','github_pat_qa_fake');
 await page.click('[data-github-authorize]');
 await expect(page.locator('[data-github-status]')).toContainText('Connected to MatlockFT/Matlock');
 await page.click('[data-save-draft]');
 await expect.poll(()=>Boolean(payload)).toBe(true);
 expect(Buffer.from(payload.content,'base64').toString()).toContain('Before save.');
 await page.fill('#writer-body','Before save. Added while saving.');
 release();
 await expect(page.locator('[data-save-draft]')).toBeEnabled();
 await expect(page.locator('[data-save-state]')).toBeVisible();
 await expect(page.locator('[data-save-state]')).toContainText('Save failed');
 const recovered=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key==='matlock-writer:new').map(([,v])=>JSON.parse(v)));
 expect(recovered.some(s=>s.body==='Before save. Added while saving.' && s.currentSha==='')).toBe(true);
});

test('failed save with unavailable storage must not promise recovery',async({page})=>{
 let release, payload;
 const gate=new Promise(resolve=>release=resolve);
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type,accept,x-github-api-version','access-control-allow-methods':'GET,PUT,OPTIONS'};
 await page.route('https://mmamatlock-writer-auth.fighttalkmma.workers.dev/**',r=>r.fulfill({status:401,headers,body:'{}'}));
 await page.route('https://api.github.com/**',async r=>{
  const req=r.request(),url=new URL(req.url());
  if(req.method()==='OPTIONS')return r.fulfill({status:204,headers});
  if(req.method()==='PUT'){
   payload=req.postDataJSON(); await gate;
   return r.fulfill({status:500,headers,body:JSON.stringify({message:'Simulated server failure'})});
  }
  if(url.pathname.endsWith('/Matlock'))return r.fulfill({status:200,headers,body:'{"owner":{"login":"MatlockFT"},"name":"Matlock"}'});
  if(url.pathname.endsWith('/_posts'))return r.fulfill({status:200,headers,body:'[]'});
  return r.fulfill({status:404,headers,body:'{"message":"Not Found"}'});
 });
 await page.goto(fixture.origin+'/write/');
 await page.click('[data-library-new]');
 await page.fill('[data-field="title"]','Save race QA');
 await page.fill('#writer-body','Before save.');
 await page.click('[data-github-connect]');
 await page.locator('.writer-token-fallback').evaluate(el=>el.open=true);
 await page.fill('[data-github-token]','github_pat_qa_fake');
 await page.click('[data-github-authorize]');
 await expect(page.locator('[data-github-status]')).toContainText('Connected to MatlockFT/Matlock');
 await page.evaluate(()=>{Storage.prototype.setItem=function(){throw new DOMException('QA quota','QuotaExceededError')};});
 await page.click('[data-save-draft]');
 await expect.poll(()=>Boolean(payload)).toBe(true);
 expect(Buffer.from(payload.content,'base64').toString()).toContain('Before save.');
 await page.fill('#writer-body','Before save. Added while saving.');
 release();
 await expect(page.locator('[data-save-draft]')).toBeEnabled();
 await expect(page.locator('[data-save-state]')).not.toContainText('local copy safe');
 const recovered=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key==='matlock-writer:new').map(([,v])=>JSON.parse(v)));
 expect(recovered).toEqual([]);
 await expect(page.locator('#writer-body')).toHaveValue('Before save. Added while saving.');
});
