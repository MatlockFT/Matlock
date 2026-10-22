const {test,expect}=require('@playwright/test');
const {startWriterFixture}=require('./writer-preview-fixture.cjs');
let fixture;
test.beforeAll(async()=>{fixture=await startWriterFixture();});
test.afterAll(async()=>fixture.close());
test.beforeEach(async({page})=>{
 await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto(fixture.origin+'/write/');await page.click('[data-library-new]');
});
test('resuming a browser draft preserves a custom filename',async({page})=>{
 await page.locator('[data-field="title"]').fill('QA custom filename');
 await page.locator('.writer-meta-advanced > summary').click();
 await page.locator('[data-field="filename"]').fill('2026-10-21-custom-name.md');
 await page.locator('#writer-body').fill('Local content');
 await page.click('[data-show-library]');await page.click('[data-library-resume-local]');
 await expect(page.locator('[data-field="filename"]')).toHaveValue('2026-10-21-custom-name.md');
 await page.reload();
 await expect(page.locator('[data-field="filename"]')).toHaveValue('2026-10-21-custom-name.md');
});
for(const width of [320,390,768,1440])test('readable preview and reachable header at '+width,async({page})=>{
 await page.setViewportSize({width,height:900});
 await page.locator('#writer-body').fill('## Heading\n\n### Subheading\n\nA [source](https://example.com).');
 await expect(page.locator('[data-preview-content] h2')).toBeVisible();
 const colors=await page.locator('[data-preview-content]').evaluate(el=>{
  function luminance(color){const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
  const bg=luminance(getComputedStyle(el.closest('[data-preview-frame]')).backgroundColor);
  return [...el.querySelectorAll('h2,h3,a')].map(n=>{const fg=luminance(getComputedStyle(n).color);return (Math.max(bg,fg)+.05)/(Math.min(bg,fg)+.05)});
 });
 for(const ratio of colors)expect(ratio).toBeGreaterThanOrEqual(4.5);
 if(width<=700){
  const boxes=await page.locator('.writer-topbar h1,.writer-topbar button:not([hidden])').evaluateAll(nodes=>nodes.filter(n=>n.getBoundingClientRect().width&&getComputedStyle(n).visibility!=='hidden').map(n=>({text:n.textContent,...n.getBoundingClientRect().toJSON()})));
  for(const a of boxes){expect(a.left).toBeGreaterThanOrEqual(0);expect(a.right).toBeLessThanOrEqual(width);for(const b of boxes){if(a===b)continue;expect(Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top))).toBe(0);}}
 }
 await page.screenshot({path:require('path').join(__dirname,'../../test-results','writer-fixed-'+width+'.png'),fullPage:true});
});
