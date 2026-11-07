const {test, expect}=require('@playwright/test');
const URL='http://127.0.0.1:4173/copper-orchard-47/';
const card={schema_version:3,events:[{
 id:'ufc-test-2026-11-14',promotion_key:'ufc',promotion:'UFC 334',title:'Gane vs Hokit',date:'2026-11-14',
 sections:[{kind:'main',bouts:[
  {label:'Main Event',weight_class:'Heavyweight Title Bout',fighters:[{name:'Ciryl Gane'},{name:'Josh Hokit'}]},
  {label:'Co-Main Event',weight_class:"Women's Bantamweight Title Bout",fighters:[{name:'Kayla Harrison'},{name:'Amanda Nunes'}]},
  {label:'',weight_class:'Lightweight Bout',fighters:[{name:'Drew Dober'},{name:'Chris Duncan'}]}
 ]}]
}]};
test.beforeEach(async({page})=>{
 page.errors=[];
 page.on('pageerror',e=>page.errors.push(e.message));
 page.on('dialog',d=>d.accept());
 await page.route('https://accounts.google.com/gsi/client',r=>r.fulfill({status:200,body:'',contentType:'application/javascript'}));
 await page.route('**/assets/data/upcoming-events-live.json',r=>r.fulfill({status:200,body:JSON.stringify(card),contentType:'application/json'}));
 await page.goto(URL,{waitUntil:'domcontentloaded'});
});
test.afterEach(({page})=>expect(page.errors).toEqual([]));

test('find published card, import main/title rounds, refresh without duplicate or score loss',async({page})=>{
 await page.click('#importCardBtn');
 await expect(page.locator('#lookupResults .lookup-card')).toHaveCount(1);
 await page.fill('#lookupSearch','UFC 334');
 await page.locator('#lookupResults .lookup-card').click();
 await expect(page.locator('#importPreview')).toContainText('Ciryl Gane vs Josh Hokit');
 await page.click('#importSelectedEvent');
 await expect(page.locator('.bout-row')).toHaveCount(3);
 const first=await page.evaluate(()=>{
  const s=JSON.parse(localStorage.getItem('copper47.workspace.v2'));
  return {e:s.events[0],selected:s.selected};
 });
 expect(first.e.sourceId).toBe('ufc-test-2026-11-14');
 expect(first.e.fights[0].rounds).toBe(5);
 expect(first.e.fights[1].rounds).toBe(5);
 expect(first.e.fights[2].rounds).toBe(3);
 expect(first.selected).toBe(first.e.id);
 await page.locator('.bout-row .primary').first().click();
 await page.click('#startBtn');
 await page.keyboard.press('ArrowLeft');
 await page.click('#endBtn');
 await page.keyboard.press('ArrowLeft');
 await page.keyboard.press('9');
 await page.keyboard.press('Enter');
 await page.click('#backBtn');
 await page.click('#importCardBtn');
 await page.locator('#lookupResults .lookup-card').click();
 await page.click('#importSelectedEvent');
 await expect(page.locator('.bout-row')).toHaveCount(3);
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events[0]);
 expect(after.id).toBe(first.e.id);
 expect(after.fights[0].id).toBe(first.e.fights[0].id);
 expect(after.fights[0].roundData[0].observations).toHaveLength(1);
 await page.reload();
 await expect(page.locator('.bout-row')).toHaveCount(3);
 await expect(page.locator('#eventProgress')).toContainText('0 of 3 fights finished');
});

test('completion survives reload and reopening preserves unfinished fights',async({page})=>{
 await page.click('#newEventBtn');
 await page.fill('#eventName','Saturday event');
 await page.fill('#boutLeft','Fighter Red');
 await page.fill('#boutRight','Fighter Blue');
 await page.selectOption('#boutDivision','Lightweight');
 await page.click('#addBout');
 await page.click('#completeEvent');
 await expect(page.locator('#eventProgress')).toContainText('Completed');
 await expect(page.locator('.completed-events .event-item')).toHaveCount(1);
 await page.reload();
 await expect(page.locator('#completeEvent')).toHaveText('Reopen event');
 await expect(page.locator('.completed-events')).toBeVisible();
 await page.click('#completeEvent');
 await expect(page.locator('#eventProgress')).toContainText('Active event');
 await expect(page.locator('.bout-row')).toHaveCount(1);
 await expect(page.locator('.completed-events')).toHaveCount(0);
});

test('paste csv or versus card into current event, skip duplicate matchup',async({page})=>{
 await page.click('#importCardBtn');
 await page.locator('#pasteDetails summary').click();
 await page.fill('#pasteEventName','Imported CSV');
 await page.fill('#pasteEventDate','2026-11-07');
 await page.fill('#pasteCard',
  'Red,Blue,Division,Rounds,Minutes\nRed One,Blue One,Welterweight,3,5\nRed Two,Blue Two,Heavyweight,5,5\nRed One,Blue One,Welterweight,3,5');
 await page.click('#pasteImport');
 await expect(page.locator('.bout-row')).toHaveCount(2);
 await page.click('#importCardBtn');
 await page.locator('#pasteDetails summary').click();
 await page.selectOption('#pasteDestination','current');
 await page.fill('#pasteCard','Red Two vs Blue Two | Heavyweight | 5\nRed Three vs Blue Three | Lightweight | 3');
 await page.click('#pasteImport');
 await expect(page.locator('.bout-row')).toHaveCount(3);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events[0]);
 expect(stored.fights.map(f=>f.left)).toEqual(['Red One','Red Two','Red Three']);
 expect(stored.fights[1].rounds).toBe(5);
});
