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
 await page.addInitScript(()=>{if(sessionStorage.getItem('__qaAllowAutoToday')!=='1')localStorage.setItem('copper47.auto-today.v1','false')});
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


function seededFight(id,left,right,completed=false,reverse=false){
 return {id,left,right,division:'Lightweight',rounds:3,duration:300,index:0,cornerLayout:'red-left',
  status:completed?'complete':'ready',
  roundData:[{elapsed:0,observations:[],score:completed?{winner:reverse?'b':'a',margin:9,deductions:[0,0],confirmedAt:'2026-10-31T18:00:00Z'}:null}],
  result:completed?{type:'tko',winner:reverse?'b':'a',at:'2026-10-31T18:00:00Z'}:null,
  legacyId:null};
}
async function seedConflict(page,divergent=false){
 const original={id:'original-2026',name:'UFC Fight Night: Moicano vs. Nolan',date:'2026-10-31',
  judge:'Matlock',fights:[seededFight('o-1','Renato Moicano','Tom Nolan',true),
   seededFight('o-2','Zachary Reese','Mickey Gall',divergent)]};
 const copy={id:'duplicate-2026',name:'UFC Fight Night: Moicano vs. Nolan (conflict copy)',date:'2026-10-31',
  judge:'Matlock',fights:[seededFight('d-1','Renato Moicano','Tom Nolan',divergent,divergent),
   seededFight('d-2','Zachary Reese','Mickey Gall',!divergent)]};
 await page.evaluate(payload=>{
  localStorage.setItem('copper47.auto-today.v1','false');
  localStorage.setItem('copper47.workspace.v2',JSON.stringify(payload));
 },{version:2,selected:'duplicate-2026',masterSheetId:null,events:[original,copy]});
 await page.reload({waitUntil:'domcontentloaded'});
}
test('safe conflict copies consolidate automatically, retain unique results and create recoverable snapshot',async({page})=>{
 await seedConflict(page,false);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events.length)).toBe(1);
 const final=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')));
 expect(final.events[0].id).toBe('original-2026');
 expect(final.events[0].completedAt).toBeTruthy();
 expect(final.events[0].fights).toHaveLength(2);
 expect(final.events[0].fights.map(f=>!!f.result)).toEqual([true,true]);
 expect(final.removedEvents['duplicate-2026']).toBeTruthy();
 expect(final.selected).toBe('original-2026');
 await expect(page.locator('.completed-events .event-item')).toHaveCount(1);
 await expect(page.locator('#downloadRecovery')).toBeVisible();
 await page.reload();
 await expect(page.locator('.completed-events .event-item')).toHaveCount(1);
 const count=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events.length);
 expect(count).toBe(1);
});
test('divergent confirmed scores demand operator selection and preserve both until reviewed',async({page})=>{
 await seedConflict(page,true);
 await expect(page.locator('#integrityIssues select')).toHaveCount(1);
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')));
 expect(before.events).toHaveLength(2);
 await expect(page.locator('#resolveConflicts')).toBeDisabled();
 await page.locator('#integrityIssues select').selectOption('original');
 await expect(page.locator('#resolveConflicts')).toBeEnabled();
 await page.click('#resolveConflicts');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events.length)).toBe(1);
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events);
 expect(after[0].completedAt).toBeTruthy();
 expect(after[0].fights[0].result.winner).toBe('a');
 expect(after[0].fights[1].result).toBeTruthy();
});
test('today card auto-loads once with all available bouts and remains editable',async({page})=>{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',
  year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const part=k=>parts.find(p=>p.type===k).value;
 const today=part('year')+'-'+part('month')+'-'+part('day');
 const payload={events:[{id:'ufc-today-test',promotion:'UFC Fight Night',promotion_key:'ufc',
  title:'Testing Main Event',date:today,sections:[{kind:'main',bouts:[
   {label:'Main Event',weight_class:'Heavyweight Bout',fighters:[{name:'Waldo Cortes Acosta'},{name:'Johnny Walker'}]},
   {label:'',weight_class:'Featherweight Bout',fighters:[{name:'Austin Bashi'},{name:'Carlos Calderon'}]}
  ]}]}]};
 await page.route('**/assets/data/copper-card-catalog.json',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(payload)}));
 await page.evaluate(()=>{sessionStorage.setItem('__qaAllowAutoToday','1');localStorage.setItem('copper47.auto-today.v1','true')});
 await page.reload();
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events.length)).toBe(1);
 await expect(page.locator('.bout-row')).toHaveCount(2);
 const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events[0]);
 expect(stored.sourceId).toBe('ufc-today-test');
 expect(stored.fights[0].rounds).toBe(5);
 expect(stored.fights[1].rounds).toBe(3);
 await page.reload();
 await expect(page.locator('.bout-row')).toHaveCount(2);
 expect((await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events)).length).toBe(1);
});
