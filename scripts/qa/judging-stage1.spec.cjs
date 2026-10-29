const { test, expect } = require('@playwright/test');
const URL = 'http://127.0.0.1:4173/copper-orchard-47/';
test.beforeEach(async ({ page }) => {
  page.__scorecardErrors=[];
  page.on('pageerror', err => page.__scorecardErrors.push(err.message));
  page.on('dialog', async d => d.accept());
  await page.route('https://accounts.google.com/gsi/client',route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.goto(URL,{waitUntil:'domcontentloaded'});
});
test.afterEach(async ({page}) => {
  expect(page.__scorecardErrors).toEqual([]);
});
async function setup(page){
  await page.click('#newEventBtn');
  await page.fill('#eventName','Test UFC card');
  await page.fill('#boutLeft','Red fighter');
  await page.fill('#boutRight','Blue fighter');
  await page.selectOption('#boutDivision','Lightweight');
  await page.click('#addBout');
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#wbLeft')).toHaveText('Red fighter');
}
async function scoreRound(page,side,margin='9'){
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#observationsCount')).toHaveText('2 exchanges');
  await page.click('#endBtn');
  await expect(page.locator('#scoreOverlay')).toBeVisible();
  await page.keyboard.press(side==='a'?'ArrowLeft':'ArrowRight');
  await page.keyboard.press(margin);
  await page.keyboard.press('Enter');
  await expect(page.locator('#scoreOverlay')).toBeHidden();
}
test('complete three-round fight with explicit scores and persistence', async ({ page })=>{
  await setup(page);
  await scoreRound(page,'a');
  await expect(page.locator('#wbRound')).toHaveText('ROUND 2 OF 3');
  await scoreRound(page,'b');
  await scoreRound(page,'a');
  await expect(page.locator('#wbTotal')).toHaveText('29 – 28');
  await expect(page.locator('#finishBtn')).toHaveText('Finalize decision');
  await page.click('#finishBtn');
  await expect(page.locator('#resultWinner')).toHaveValue('a');
  await page.click('#confirmFinish');
  await expect(page.locator('#resultLabel')).toContainText('DECISION');
  await page.reload();
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#wbTotal')).toHaveText('29 – 28');
  await expect(page.locator('#resultLabel')).toContainText('DECISION');
});
test('observation count never chooses the round score', async ({ page })=>{
  await setup(page);
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.click('#endBtn');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('8');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wbTotal')).toHaveText('8 – 10');
});
test('the same round can be rescored and changed to a draw', async ({ page })=>{
  await setup(page);
  await scoreRound(page,'a');
  await page.locator('#scoreBody tr:first-child button').click();
  await page.keyboard.press('0');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wbTotal')).toHaveText('10 – 10');
});
test('old sessions can be imported before any new event exists', async ({ page })=>{
  await page.evaluate(()=>{
    const obj={version:1,id:'legacy-test-1',info:{event:'Old event',fight:'Flyweight',date:'2026-10-20',judge:'Judge',left:'Old A',right:'Old B',rounds:'3',duration:'300',notes:''},current:0,roundData:[{elapsed:72,ended:false,moments:[{side:0,time:15},{side:1,time:40}],manual:null,deductions:[0,0]}]};
    localStorage.setItem('copper47.current.v1',JSON.stringify(obj));
  });
  await page.reload();
  await expect(page.locator('#legacyBtn')).toBeVisible();
  await page.click('#legacyBtn');
  await expect(page.locator('.bout-row')).toHaveCount(1);
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#observationsCount')).toHaveText('2 exchanges');
});
test('full workspace exports as JSON backup', async ({ page })=>{
  await setup(page);
  await page.click('#backBtn');
  const [download]=await Promise.all([
    page.waitForEvent('download'),
    page.click('#exportAll')
  ]);
  expect(download.suggestedFilename()).toMatch(/^judging-backup-/);
  const text=await (await require('node:fs/promises').readFile(await download.path(),'utf8'));
  const obj=JSON.parse(text);
  expect(obj.version).toBe(2);
  expect(obj.events[0].fights[0].left).toBe('Red fighter');
});

test('red is left and blue right in controls, scorecard, graph and result', async ({page})=>{
  await setup(page);
  await expect(page.locator('.wb-head .micro.red')).toContainText('Red corner');
  await expect(page.locator('.wb-head .micro.blue')).toContainText('Blue corner');
  await expect(page.locator('.legend .red')).toHaveText('RED FIGHTER');
  await expect(page.locator('.legend .blue')).toHaveText('BLUE FIGHTER');
  await expect(page.locator('#scoreBody').locator('tr')).toHaveCount(1);
  await expect(page.locator('#scoreHeadRed')).toHaveText('RED FIGHTER');
  await expect(page.locator('#scoreHeadBlue')).toHaveText('BLUE FIGHTER');
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#momentLog .red')).toHaveText('Red fighter');
  await expect(page.locator('#momentLog .blue')).toHaveText('Blue fighter');
  await page.click('#endBtn');
  await expect(page.locator('#selectA')).toContainText('Red corner');
  await expect(page.locator('#selectB')).toContainText('Blue corner');
  await expect(page.locator('.deductions')).toContainText('Red deductions');
  await expect(page.locator('.deductions')).toContainText('Blue deductions');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
});
test('reset the current round after a false start and persist the clean state', async ({page})=>{
  await setup(page);
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#observationsCount')).toHaveText('2 exchanges');
  await expect(page.locator('#resetBtn')).toBeEnabled();
  await page.click('#resetBtn');
  await expect(page.locator('#observationsCount')).toHaveText('0 exchanges');
  await expect(page.locator('#clock')).toHaveText('5:00');
  await expect(page.locator('#roundState')).toHaveText('Ready');
  await expect(page.locator('#resetBtn')).toBeDisabled();
  await page.reload();
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#clock')).toHaveText('5:00');
  await expect(page.locator('#observationsCount')).toHaveText('0 exchanges');
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#observationsCount')).toHaveText('1 exchanges');
});
test('declined reset retains the current observations and state', async ({page})=>{
  await setup(page);
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  page.removeAllListeners('dialog');
  page.once('dialog', async d => {await d.dismiss()});
  await page.click('#resetBtn');
  await expect(page.locator('#observationsCount')).toHaveText('1 exchanges');
  await expect(page.locator('#roundState')).toHaveText('Recording');
});
test('reset from score prompt restarts same round and does not alter previous scores', async ({page})=>{
  await setup(page);
  await scoreRound(page,'a');
  await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
  await page.click('#startBtn');
  await page.keyboard.press('ArrowRight');
  await page.click('#endBtn');
  await expect(page.locator('#resetFromScore')).toBeVisible();
  await page.click('#resetFromScore');
  await expect(page.locator('#scoreOverlay')).toBeHidden();
  await expect(page.locator('#wbRound')).toHaveText('ROUND 2 OF 3');
  await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
  await expect(page.locator('#clock')).toHaveText('5:00');
  await expect(page.locator('#observationsCount')).toHaveText('0 exchanges');
});
test('previous v2 scorecard keeps original fighter identity after layout migration', async ({page})=>{
  // Seed before the application initializes. Writing to localStorage in a running
  // page is overwritten by its pagehide autosave during navigation.
  await page.addInitScript(()=>{
    if(localStorage.getItem('corner-migration-seeded'))return;
    const old={version:2,selected:'event-1',events:[{
      id:'event-1',name:'Old event',date:'2026-10-28',judge:'Judge',
      fights:[{id:'fight-1',left:'Original blue',right:'Original red',division:'Flyweight',rounds:3,duration:300,index:1,status:'in-progress',result:null,legacyId:null,
        roundData:[
          {elapsed:300,observations:[{side:'a',time:15},{side:'b',time:20}],score:{winner:'a',margin:9,deductions:[0,1],confirmedAt:'2026-10-28'}},
          {elapsed:0,observations:[],score:null}
        ]
      }]
    }]};
    localStorage.setItem('copper47.workspace.v2',JSON.stringify(old));
    localStorage.setItem('corner-migration-seeded','1');
  });
  await page.reload();
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#wbLeft')).toHaveText('Original red');
  await expect(page.locator('#wbRight')).toHaveText('Original blue');
  await expect(page.locator('#wbTotal')).toHaveText('8 – 10');
  await page.locator('#roundTabs button').first().click();
  await expect(page.locator('#momentLog .red')).toHaveText('Original red');
  await expect(page.locator('#momentLog .blue')).toHaveText('Original blue');
  const original=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')).events[0].fights[0]);
  expect(original.cornerLayout).toBe('red-left');
  expect(original.roundData[0].score.winner).toBe('b');
  expect(original.roundData[0].score.deductions).toEqual([1,0]);
  await page.reload();
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#wbLeft')).toHaveText('Original red');
  await expect(page.locator('#wbTotal')).toHaveText('8 – 10');
});


test('live moment counts and tally preselect a red 10–9 score', async ({page})=>{
  await setup(page);
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#wbMomentsA')).toHaveText('2');
  await expect(page.locator('#wbMomentsB')).toHaveText('1');
  await expect(page.locator('#momentLead')).toHaveText('Red +1');
  await page.click('#endBtn');
  await expect(page.locator('#scoreMomentsA')).toHaveText('2');
  await expect(page.locator('#scoreMomentsB')).toHaveText('1');
  await expect(page.locator('#selectA')).toHaveClass(/selected/);
  await expect(page.locator('[data-margin="9"]')).toHaveClass(/selected/);
  await expect(page.locator('#suggestionText')).toContainText('suggested 10–9 for Red');
  await expect(page.locator('#draftScore')).toHaveText('10 – 9');
  await page.keyboard.press('Enter');
  await expect(page.locator('#scoreOverlay')).toBeHidden();
  await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
  await expect(page.locator('#scoreBody tr:first-child')).toContainText('2–1');
});

test('equal recorded moments preselect 10–10 without forcing it', async ({page})=>{
  await setup(page);
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#momentLead')).toHaveText('Even');
  await page.click('#endBtn');
  await expect(page.locator('[data-margin="10"]')).toHaveClass(/selected/);
  await expect(page.locator('#suggestionText')).toContainText('10–10 suggested');
  await expect(page.locator('#draftScore')).toHaveText('10 – 10');
  await page.keyboard.press('Enter');
  await expect(page.locator('#scoreOverlay')).toBeHidden();
  await expect(page.locator('#wbTotal')).toHaveText('10 – 10');
});

test('strongly one-sided tally suggests 10–8 but manual override wins', async ({page})=>{
  await setup(page);
  await page.click('#startBtn');
  for(let i=0;i<8;i++)await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.click('#endBtn');
  await expect(page.locator('#scoreMomentsA')).toHaveText('8');
  await expect(page.locator('#scoreMomentsB')).toHaveText('1');
  await expect(page.locator('[data-margin="8"]')).toHaveClass(/selected/);
  await expect(page.locator('#selectA')).toHaveClass(/selected/);
  await expect(page.locator('#draftScore')).toHaveText('10 – 8');
  await expect(page.locator('#suggestionText')).toContainText('impact, dominance and duration');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('9');
  await expect(page.locator('#draftScore')).toHaveText('9 – 10');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wbTotal')).toHaveText('9 – 10');
  await page.locator('#scoreBody tr:first-child button').click();
  await expect(page.locator('#draftScore')).toHaveText('9 – 10');
  await expect(page.locator('[data-margin="9"]')).toHaveClass(/selected/);
});

test('no observed moments asks judge to choose instead of inventing a score', async ({page})=>{
  await setup(page);
  await page.click('#startBtn');
  await page.click('#endBtn');
  await expect(page.locator('#scoreMomentsA')).toHaveText('0');
  await expect(page.locator('#scoreMomentsB')).toHaveText('0');
  await expect(page.locator('#suggestionText')).toContainText('Select a score manually');
  await expect(page.locator('#confirmScore')).toBeDisabled();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#confirmScore')).toBeEnabled();
  await page.keyboard.press('Enter');
  await expect(page.locator('#wbTotal')).toHaveText('9 – 10');
});

test('undo and reset immediately recalculate the tallies', async ({page})=>{
  await setup(page);
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#wbMomentsA')).toHaveText('1');
  await expect(page.locator('#wbMomentsB')).toHaveText('0');
  await expect(page.locator('#momentLead')).toHaveText('Red +1');
  await page.click('#resetBtn');
  await expect(page.locator('#wbMomentsA')).toHaveText('0');
  await expect(page.locator('#wbMomentsB')).toHaveText('0');
  await expect(page.locator('#momentLead')).toHaveText('');
  await expect(page.locator('#clock')).toHaveText('5:00');
});


test('editing an already completed decision preserves completed status and updates winner', async ({page})=>{
  await setup(page);
  await scoreRound(page,'a');
  await scoreRound(page,'b');
  await scoreRound(page,'a');
  await page.click('#finishBtn');
  await expect(page.locator('#resultWinner')).toHaveValue('a');
  await page.click('#confirmFinish');
  await expect(page.locator('#resultLabel')).toContainText('Red fighter');
  await page.locator('#scoreBody tr:nth-child(3) button').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wbTotal')).toHaveText('28 – 29');
  await expect(page.locator('#resultLabel')).toContainText('Blue fighter');
  await expect(page.locator('#startBtn')).toBeDisabled();
  await page.click('#backBtn');
  await expect(page.locator('.bout-row .bout-meta')).toContainText('complete');
  await page.reload();
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#resultLabel')).toContainText('Blue fighter');
});

test('clock expiry disables further recording and reset restores usable round', async ({page})=>{
  await page.addInitScript(()=>{
    if(localStorage.getItem('qa-clock-seeded'))return;
    const f={id:'f-qa',left:'Red clock',right:'Blue clock',division:'',rounds:3,duration:300,index:0,status:'in-progress',result:null,legacyId:null,cornerLayout:'red-left',roundData:[{elapsed:299.6,observations:[],score:null}]};
    localStorage.setItem('copper47.workspace.v2',JSON.stringify({version:2,selected:'e-qa',events:[{id:'e-qa',name:'QA event',date:'2026-10-29',judge:'',fights:[f]}]}));
    localStorage.setItem('qa-clock-seeded','1');
  });
  await page.reload();
  await page.locator('.bout-row .primary').click();
  await page.click('#startBtn');
  await expect(page.locator('#clock')).toHaveText('0:00',{timeout:4000});
  await expect(page.locator('#startBtn')).toBeDisabled();
  await expect(page.locator('#roundState')).toHaveText('Paused');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#wbMomentsA')).toHaveText('0');
  await page.click('#resetBtn');
  await expect(page.locator('#clock')).toHaveText('5:00');
  await expect(page.locator('#startBtn')).toBeEnabled();
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#wbMomentsA')).toHaveText('1');
});

test('v1 left/right legacy data preserves its original corners and manual scores', async ({page})=>{
  await page.evaluate(()=>{
    const old={version:1,id:'oldredleft',info:{event:'Old event',fight:'Welterweight',date:'2026-10-20',judge:'Judge',left:'Old left',right:'Old right',rounds:'3',duration:'300',notes:''},current:1,roundData:[
      {elapsed:300,ended:true,moments:[{side:0,time:10},{side:0,time:15},{side:1,time:20}],manual:[10,9],deductions:[0,0]},
      {elapsed:80,ended:false,moments:[{side:1,time:25}],manual:null,deductions:[0,0]}
    ]};
    localStorage.setItem('copper47.current.v1',JSON.stringify(old));
  });
  await page.reload();
  await page.click('#legacyBtn');
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#wbLeft')).toHaveText('Old left');
  await expect(page.locator('#wbRight')).toHaveText('Old right');
  await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
  await expect(page.locator('#wbMomentsA')).toHaveText('0');
  await expect(page.locator('#wbMomentsB')).toHaveText('1');
  await page.locator('#roundTabs button').first().click();
  await expect(page.locator('#momentLog .red')).toHaveCount(2);
  await expect(page.locator('#momentLog .blue')).toHaveCount(1);
  await page.click('#backBtn');
  await page.click('#legacyBtn');
  await expect(page.locator('.bout-row')).toHaveCount(1);
});

test('scorecard draw is preselected when all confirmed round totals are tied', async ({page})=>{
  await setup(page);
  for(let i=0;i<3;i++){
    await page.click('#startBtn');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await page.click('#endBtn');
    await expect(page.locator('#draftScore')).toHaveText('10 – 10');
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('#wbTotal')).toHaveText('30 – 30');
  await page.click('#finishBtn');
  await expect(page.locator('#resultType')).toHaveValue('draw');
  await expect(page.locator('#resultWinner')).toHaveValue('');
  await page.click('#confirmFinish');
  await expect(page.locator('#resultLabel')).toContainText('DRAW');
});

test('pause prevents moment recording, resume restores it and totals are kept', async ({page})=>{
  await setup(page);
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#wbMomentsA')).toHaveText('1');
  await page.keyboard.press(' ');
  await expect(page.locator('#roundState')).toHaveText('Paused');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#wbMomentsA')).toHaveText('1');
  await page.keyboard.press(' ');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#wbMomentsB')).toHaveText('1');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#wbMomentsB')).toHaveText('0');
});

test('event session and two independent fights survive reload', async ({page})=>{
  await setup(page);
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.click('#endBtn');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
  await page.click('#backBtn');
  await page.fill('#boutLeft','Another red');
  await page.fill('#boutRight','Another blue');
  await page.selectOption('#boutDivision','Welterweight');
  await page.click('#addBout');
  await page.locator('.bout-row .primary').nth(1).click();
  await expect(page.locator('#wbTotal')).toHaveText('0 – 0');
  await expect(page.locator('#wbMomentsA')).toHaveText('0');
  await page.click('#backBtn');
  await page.reload();
  await expect(page.locator('.bout-row')).toHaveCount(2);
  await page.locator('.bout-row .primary').first().click();
  await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
  await page.click('#backBtn');
  await page.locator('.bout-row .primary').nth(1).click();
  await expect(page.locator('#wbTotal')).toHaveText('0 – 0');
});

test('5-round scorecard handles referee deduction and a preselected 10–8', async ({page})=>{
  await page.click('#newEventBtn');
  await page.fill('#eventName','Five round QA');
  await page.fill('#boutLeft','Red fighter');
  await page.fill('#boutRight','Blue fighter');
  await page.selectOption('#boutRounds','5');
  await page.selectOption('#boutDivision','Middleweight');
  await page.click('#addBout');
  await page.locator('.bout-row .primary').click();
  await page.click('#startBtn');
  for(let i=0;i<7;i++)await page.keyboard.press('ArrowLeft');
  await page.click('#endBtn');
  await expect(page.locator('#draftScore')).toHaveText('10 – 8');
  await page.keyboard.press('Enter');
  await scoreRound(page,'b');
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.click('#endBtn');
  await page.keyboard.press('ArrowLeft');
  await page.locator('[data-dside="0"][data-delta="1"]').click();
  await expect(page.locator('#draftScore')).toHaveText('9 – 9');
  await page.keyboard.press('Enter');
  await scoreRound(page,'b');
  await scoreRound(page,'a');
  await expect(page.locator('#wbTotal')).toHaveText('47 – 46');
  await page.click('#finishBtn');
  await expect(page.locator('#resultWinner')).toHaveValue('a');
  await page.click('#confirmFinish');
  await expect(page.locator('#resultLabel')).toContainText('DECISION');
});

test('judging interface stays within laptop viewport and round modal fits', async ({page})=>{
  await page.setViewportSize({width:1366,height:768});
  await setup(page);
  let sizes=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(sizes.width).toBeLessThanOrEqual(sizes.viewport+1);
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await page.click('#endBtn');
  await expect(page.locator('#scoreOverlay')).toBeVisible();
  sizes=await page.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:window.innerWidth}));
  expect(sizes.width).toBeLessThanOrEqual(sizes.viewport+1);
  await expect(page.locator('#confirmScore')).toBeInViewport();
});

test('rescoring an already completed decision to tied totals updates recorded result to draw', async ({page})=>{
  await setup(page);
  await scoreRound(page,'a');
  await scoreRound(page,'b');
  await scoreRound(page,'a');
  await page.click('#finishBtn');
  await page.click('#confirmFinish');
  await expect(page.locator('#resultLabel')).toContainText('DECISION');
  await page.locator('#scoreBody tr:nth-child(3) button').click();
  await page.keyboard.press('0');
  await page.keyboard.press('Enter');
  await expect(page.locator('#wbTotal')).toHaveText('29 – 29');
  await expect(page.locator('#resultLabel')).toContainText('DRAW');
  await expect(page.locator('#startBtn')).toBeDisabled();
  await page.reload();
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#resultLabel')).toContainText('DRAW');
});


async function stubGoogleSheets(page,options={}){
 await page.evaluate(failCreate=>{
  window.google={accounts:{oauth2:{
   initTokenClient:cfg=>({requestAccessToken(){cfg.callback({access_token:'qa-token',expires_in:3600})}}),
   hasGrantedAllScopes:()=>true,
   revoke:(_t,cb)=>{if(cb)cb()}
  }}};
  window.__sheetRequests=[];
  window.__failNextWrite=false;window.__mockColumnCount=26;
  window.__masterFiles={};let nextId=123;
  const originalFetch=window.fetch.bind(window);
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
  window.fetch=async(url,init={})=>{
   const address=String(url);
   if(!address.startsWith('https://sheets.googleapis.com/v4/spreadsheets'))return originalFetch(url,init);
   const u=new window.URL(address),path=u.pathname,method=init.method||'GET',body=init.body?JSON.parse(init.body):null;
   window.__sheetRequests.push({path,method,body,authorization:init.headers?.Authorization});
   if(failCreate&&method==='POST'&&path==='/v4/spreadsheets')
    return response({error:{message:'Sheets API is not enabled'}},403);
   if(method==='POST'&&path==='/v4/spreadsheets'){
    const id='qa-spreadsheet-'+nextId++;
    window.__masterFiles[id]={title:body.properties.title,tabs:Object.fromEntries(body.sheets.map(s=>[s.properties.title,[]]))};
    return response({spreadsheetId:id});
   }
   const match=path.match(/^\/v4\/spreadsheets\/([\w-]+)(.*)$/),id=match?.[1],tail=match?.[2]||'';
   const file=window.__masterFiles[id];
   if(!file)return response({error:{message:'Spreadsheet not found'}},404);
   if(method==='GET'&&tail==='/values:batchGet'){
    const ranges=u.searchParams.getAll('ranges');
    return response({valueRanges:ranges.map(range=>{
     const tab=range.match(/^'([^']+)'!/)?.[1]||'';
     return {range,values:file.tabs[tab]||[]};
    })});
   }
   if(method==='GET'){
    return response({sheets:Object.keys(file.tabs).map((title,i)=>({
     properties:{title,sheetId:i+11,gridProperties:{rowCount:1000,columnCount:window.__mockColumnCount}}
    }))});
   }
   if(method==='POST'&&tail==='/values:batchUpdate'){
    if(window.__failNextWrite){window.__failNextWrite=false;return response({error:{message:'Temporary Google write failure'}},503)}
    for(const d of body.data){
     const tab=d.range.match(/^'([^']+)'!/)?.[1];
     if(!tab)return response({error:{message:'Invalid sheet range'}},400);
     const old=file.tabs[tab]||[];
     const values=d.values.map(row=>row.slice());
     file.tabs[tab]=values.concat(old.slice(values.length));
    }
    return response({spreadsheetId:id,responses:[]});
   }
   if(method==='POST'&&tail==='/values:batchClear'){
    for(const range of body.ranges){
     const tab=range.match(/^'([^']+)'!/)?.[1];
     const row=Number(range.match(/!A(\d+):Z/)?.[1]||1)-1;
     file.tabs[tab]=file.tabs[tab].slice(0,row);
    }
    return response({spreadsheetId:id,responses:[]});
   }
   if(method==='POST'&&tail===':batchUpdate')return response({spreadsheetId:id,responses:[]});
   return response({error:{message:'Unmocked Sheets request '+method+' '+path}},400);
  };
 },!!options.failCreate);
}
test('UFC men and women dropdown plus custom catchweight and edit dialog',async ({page})=>{
 await page.click('#newEventBtn');
 await page.fill('#boutLeft','Red fighter');await page.fill('#boutRight','Blue fighter');
 await page.click('#addBout');
 await expect(page.locator('.bout-row')).toHaveCount(0);
 await expect(page.locator('#boutDivision option[value="Flyweight"]')).toContainText('125');
 await expect(page.locator('#boutDivision option[value="Women\'s Strawweight"]')).toContainText('115');
 await page.selectOption('#boutDivision',"Women's Flyweight");
 await page.click('#addBout');
 await expect(page.locator('.bout-row')).toHaveCount(1);
 await expect(page.locator('.bout-meta')).toContainText("Women's Flyweight");
 await page.locator('.bout-row button').filter({hasText:'Edit'}).click();
 await expect(page.locator('#editDivision')).toHaveValue("Women's Flyweight");
 await page.selectOption('#editDivision','custom');
 await page.fill('#editCustomDivision','Catchweight 165 lb');
 await page.click('#saveEdit');
 await expect(page.locator('.bout-meta')).toContainText('Catchweight 165 lb');
 await page.fill('#boutLeft','Second red');await page.fill('#boutRight','Second blue');
 await page.selectOption('#boutDivision','custom');
 await expect(page.locator('#customDivisionWrap')).toBeVisible();
 await page.fill('#boutCustomDivision','Openweight — regional');
 await page.click('#addBout');
 await expect(page.locator('.bout-row')).toHaveCount(2);
 await expect(page.locator('.bout-meta').nth(1)).toContainText('Openweight — regional');
 await page.reload();
 await expect(page.locator('.bout-meta').first()).toContainText('Catchweight 165 lb');
 await page.locator('.bout-row button').filter({hasText:'Edit'}).first().click();
 await expect(page.locator('#editDivision')).toHaveValue('custom');
 await expect(page.locator('#editCustomDivision')).toHaveValue('Catchweight 165 lb');
});


async function connectQaGoogle(page){
 await page.locator('#clientId').evaluate(el=>el.closest('details').open=true);
 await page.fill('#clientId','qa-client.apps.googleusercontent.com');
 await page.click('#connectDrive');
 await expect(page.locator('#driveStatus')).toHaveText('Connected');
}
test('sync creates one master with Events, Fights, Rounds and Moments, and resyncs without duplication',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);
 await page.click('#startBtn');
 for(const key of ['ArrowLeft','ArrowRight','ArrowLeft'])await page.keyboard.press(key);
 await page.click('#endBtn');await page.keyboard.press('Enter');await page.click('#backBtn');
 await connectQaGoogle(page);
 await page.click('#syncEvent');
 await expect(page.locator('#syncEvent')).toBeEnabled();
 await expect(page.locator('#sheetLink')).toHaveAttribute('href','https://docs.google.com/spreadsheets/d/qa-spreadsheet-123/edit');
 let archive=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123']);
 expect(Object.keys(archive.tabs)).toEqual(['Events','Fights','Rounds','Moments']);
 expect(archive.tabs.Events).toHaveLength(2);
 expect(archive.tabs.Fights).toHaveLength(2);
 expect(archive.tabs.Rounds).toHaveLength(3);
 expect(archive.tabs.Moments).toHaveLength(4);
 const eid=archive.tabs.Events[1][0];
 expect(archive.tabs.Fights[1][0]).toBe(eid);
 expect(archive.tabs.Rounds[1][0]).toBe(eid);
 expect(archive.tabs.Moments[1][0]).toBe(eid);
 expect(archive.tabs.Rounds[1][10]).toBe(2); // red moments
 expect(archive.tabs.Rounds[1][11]).toBe(1); // blue exchanges
 expect(archive.tabs.Rounds[1][14]).toBe(10); // confirmed red
 expect(archive.tabs.Rounds[1][15]).toBe(9); // confirmed blue
 expect(archive.tabs.Moments.slice(1).map(x=>x[11])).toEqual(['Red','Blue','Red']);
 await page.click('#syncEvent');
 await expect(page.locator('#syncEvent')).toBeEnabled();
 archive=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123']);
 expect(archive.tabs.Events).toHaveLength(2);
 expect(archive.tabs.Moments).toHaveLength(4);
 const created=await page.evaluate(()=>window.__sheetRequests.filter(x=>x.method==='POST'&&x.path==='/v4/spreadsheets'));
 expect(created).toHaveLength(1);
 expect(created[0].body.properties.title).toContain('Master');
 expect(await page.evaluate(()=>window.__sheetRequests.every(x=>x.authorization==='Bearer qa-token'))).toBe(true);
 await page.reload();
 await expect(page.locator('#sheetLink')).toHaveAttribute('href','https://docs.google.com/spreadsheets/d/qa-spreadsheet-123/edit');
});
test('two separate events sync into ONE master, and event-only resync preserves the other',async({page})=>{
 await stubGoogleSheets(page);
 await page.click('#newEventBtn');await page.fill('#eventName','Event A');
 await page.fill('#boutLeft','A red');await page.fill('#boutRight','A blue');
 await page.selectOption('#boutDivision','Welterweight');await page.click('#addBout');
 await page.click('#newEventBtn');await page.fill('#eventName','Event B');
 await page.fill('#boutLeft','B red');await page.fill('#boutRight','B blue');
 await page.selectOption('#boutDivision',"Women's Bantamweight");await page.click('#addBout');
 await connectQaGoogle(page);
 await page.click('#syncAllEvents');await expect(page.locator('#syncAllEvents')).toBeEnabled();
 let archive=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123']);
 expect(archive.tabs.Events).toHaveLength(3);
 expect(archive.tabs.Fights).toHaveLength(3);
 expect(archive.tabs.Events.slice(1).map(x=>x[1])).toEqual(['Event A','Event B']);
 const firstEventId=archive.tabs.Events[1][0],secondEventId=archive.tabs.Events[2][0];
 await page.click('#newEventBtn');await page.fill('#eventName','Event C');
 await page.fill('#boutLeft','C red');await page.fill('#boutRight','C blue');
 await page.selectOption('#boutDivision','Lightweight');await page.click('#addBout');
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 archive=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123']);
 expect(archive.tabs.Events).toHaveLength(4);
 expect(archive.tabs.Events.slice(1).map(x=>x[0])).toContain(firstEventId);
 expect(archive.tabs.Events.slice(1).map(x=>x[0])).toContain(secondEventId);
 const created=await page.evaluate(()=>window.__sheetRequests.filter(x=>x.method==='POST'&&x.path==='/v4/spreadsheets'));
 expect(created).toHaveLength(1);
 await page.locator('.event-item').first().click();
 await page.fill('#eventName','Renamed Event A');
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 archive=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123']);
 expect(archive.tabs.Events).toHaveLength(4);
 expect(archive.tabs.Events.find(x=>x[0]===firstEventId)[1]).toBe('Renamed Event A');
 expect(archive.tabs.Events.find(x=>x[0]===secondEventId)[1]).toBe('Event B');
});
test('existing old per-event spreadsheet links remain untouched during master migration',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);await page.click('#backBtn');
 await page.addInitScript(()=>{
  if(localStorage.getItem('qa-legacy-master-link-seeded'))return;
  const key='copper47.workspace.v2',workspace=JSON.parse(localStorage.getItem(key));
  if(!workspace?.events?.[0])return;
  workspace.events[0].sheetId='older-event-sheet-12345';
  workspace.events[0].sheetSyncedAt='2026-10-20T00:00:00.000Z';
  localStorage.setItem(key,JSON.stringify(workspace));
  localStorage.setItem('qa-legacy-master-link-seeded','1');
 });
 await page.reload();
 await stubGoogleSheets(page); // Reload clears the browser-only OAuth/API test simulation.
 await connectQaGoogle(page);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const workspace=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')));
 expect(workspace.masterSheetId).toBe('qa-spreadsheet-123');
 expect(workspace.events[0].sheetId).toBe('older-event-sheet-12345');
 const requests=await page.evaluate(()=>window.__sheetRequests);
 expect(requests.some(x=>x.path.includes('older-event-sheet'))).toBe(false);
});
test('failed Google Sheets creation does not damage locally saved fights',async({page})=>{
 await stubGoogleSheets(page,{failCreate:true});
 await setup(page);await page.click('#backBtn');
 await connectQaGoogle(page);
 await page.click('#syncEvent');
 await expect(page.locator('#sheetMessage')).toContainText('Sheets API is not enabled');
 await expect(page.locator('#sheetLink')).toBeHidden();
 await page.reload();
 await expect(page.locator('.bout-row')).toHaveCount(1);
 await page.locator('.bout-row .primary').click();
 await expect(page.locator('#wbLeft')).toHaveText('Red fighter');
});
test('master linking accepts existing URL and never creates a second spreadsheet',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);await page.click('#backBtn');
 await connectQaGoogle(page);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 await page.click('#unlinkSheet');
 await expect(page.locator('#sheetLink')).toBeHidden();
 await page.locator('#masterSheetInput').evaluate(el=>el.closest('details').open=true);
 await page.fill('#masterSheetInput','https://docs.google.com/spreadsheets/d/qa-spreadsheet-123/edit#gid=11');
 await page.click('#attachMaster');
 await expect(page.locator('#sheetLink')).toBeVisible();
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const created=await page.evaluate(()=>window.__sheetRequests.filter(x=>x.path==='/v4/spreadsheets'&&x.method==='POST'));
 expect(created).toHaveLength(1);
});
test('missing master tabs are rejected without modifying remote records',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);await page.click('#backBtn');await connectQaGoogle(page);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 await page.evaluate(()=>{delete window.__masterFiles['qa-spreadsheet-123'].tabs.Moments});
 await page.click('#syncEvent');
 await expect(page.locator('#sheetMessage')).toContainText('missing one or more required tabs');
 const tabs=await page.evaluate(()=>Object.keys(window.__masterFiles['qa-spreadsheet-123'].tabs));
 expect(tabs).toEqual(['Events','Fights','Rounds']);
});
test('copy cleanup and fighter surnames in scorecard and timeline',async({page})=>{
 await page.click('#newEventBtn');
 await page.fill('#eventName','UFC 334');
 await page.fill('#boutLeft','Ciryl Gane');await page.fill('#boutRight','Josh Hokit');
 await page.selectOption('#boutDivision','Heavyweight');await page.click('#addBout');
 await page.locator('.bout-row .primary').click();
 await expect(page.locator('.timeline-title h2')).toHaveText('Exchanges');
 await expect(page.locator('.footer-grid h2').nth(1)).toHaveText('Exchange log');
 await expect(page.locator('#scoreHeadRed')).toHaveText('GANE');
 await expect(page.locator('#scoreHeadBlue')).toHaveText('HOKIT');
 await expect(page.locator('#graphRedName')).toHaveText('GANE');
 await expect(page.locator('#graphBlueName')).toHaveText('HOKIT');
 await expect(page.locator('#resultLabel')).toBeHidden();
 await expect(page.locator('#momentLog')).toContainText('No exchanges logged this round.');
 await expect(page.locator('.hints')).toContainText('exchange winner');
 await expect(page.locator('body')).not.toContainText('Moment counts are advisory');
 await expect(page.locator('body')).not.toContainText('Unofficial scorecard · moment-based suggestions');
 await expect(page.locator('body')).not.toContainText('Round observations');
 await page.click('#startBtn');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');
 await expect(page.locator('#observationsCount')).toHaveText('2 exchanges');
 await expect(page.locator('#momentLog')).toContainText('Ciryl Gane');
 await expect(page.locator('#momentLog')).toContainText('Josh Hokit');
 await page.click('#endBtn');await page.keyboard.press('Enter');
 await expect(page.locator('#scoreHeadRed')).toHaveText('GANE');
 await expect(page.locator('#scoreHeadBlue')).toHaveText('HOKIT');
});

test('charcoal colors and graph pixels update as moments are logged',async({page})=>{
 await setup(page);
 const bg=await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor);
 const root=await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--bg').trim());
 expect(root).toBe('#111214');
 const panel=await page.locator('.timeline').evaluate(el=>getComputedStyle(el).backgroundImage);
 expect(panel).toContain('gradient');
 const getCanvas=()=>page.locator('#graph').evaluate(el=>({
   data:el.toDataURL('image/png'),
   label:el.getAttribute('aria-label'),
   width:el.width,height:el.height
 }));
 const initial=await getCanvas();expect(initial.width).toBeGreaterThan(200);
 await page.click('#startBtn');await page.keyboard.press('ArrowLeft');
 await expect(page.locator('#wbMomentsA')).toHaveText('1');
 const red=await getCanvas();
 expect(red.data).not.toBe(initial.data);
 expect(red.label).toContain('1 red moments');
 await page.keyboard.press('ArrowRight');
 await expect(page.locator('#wbMomentsB')).toHaveText('1');
 const blue=await getCanvas();
 expect(blue.data).not.toBe(red.data);
 expect(blue.label).toContain('1 blue exchanges');
 await page.click('#resetBtn');
 await expect(page.locator('#observationsCount')).toHaveText('0 exchanges');
 expect((await getCanvas()).label).toContain('0 red exchanges, 0 blue exchanges');
});

test('long surnames fit without horizontal overflow',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.click('#newEventBtn');
 await page.fill('#boutLeft','Alexandria Verylongcompoundlastname');
 await page.fill('#boutRight','Christopher van der Berg');
 await page.selectOption('#boutDivision','Lightweight');
 await page.click('#addBout');
 await page.locator('.bout-row .primary').click();
 await expect(page.locator('#scoreHeadRed')).toHaveText('VERYLONGCOMPOUNDLASTNAME');
 await expect(page.locator('#scoreHeadBlue')).toHaveText('VAN DER BERG');
 const sz=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:innerWidth}));
 expect(sz.scroll).toBeLessThanOrEqual(sz.view+1);
 await page.click('#startBtn');
 await page.keyboard.press('ArrowLeft');
 await expect(page.locator('#wbMomentsA')).toHaveText('1');
});

test('reduced motion preserves all scores and produces a readable timeline',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});
 await setup(page);
 await page.click('#startBtn');
 for(const key of ['ArrowLeft','ArrowRight','ArrowLeft'])await page.keyboard.press(key);
 await expect(page.locator('#wbMomentsA')).toHaveText('2');
 await expect(page.locator('#wbMomentsB')).toHaveText('1');
 await expect(page.locator('#graph')).toHaveAttribute('aria-label',/2 red exchanges, 1 blue exchanges/);
 await page.click('#endBtn');
 await expect(page.locator('#draftScore')).toHaveText('10 – 9');
 await page.keyboard.press('Enter');
 await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
});



test('syncing an older backup prompts before overwriting newer remote event scores',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);await page.click('#backBtn');await connectQaGoogle(page);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const original=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123'].tabs.Events[1].slice());
 await page.evaluate(()=>{
  window.__masterFiles['qa-spreadsheet-123'].tabs.Events[1][7]='2099-01-01T00:00:00.000Z';
 });
 page.removeAllListeners('dialog');
 page.on('dialog',async d=>d.dismiss());
 await page.click('#syncEvent');
 await expect(page.locator('#sheetMessage')).toContainText('Sync canceled to protect newer archived scores');
 const blocked=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123'].tabs.Events[1][7]);
 expect(blocked).toBe('2099-01-01T00:00:00.000Z');
 page.removeAllListeners('dialog');
 page.on('dialog',async d=>d.accept());
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 await expect(page.locator('#sheetMessage')).toContainText('Master updated');
 expect((await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123'].tabs.Events[1][7]))).not.toBe(blocked);
});

test('failed Google write preserves the previously synced master data',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);await page.click('#backBtn');await connectQaGoogle(page);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const previous=await page.evaluate(()=>JSON.stringify(window.__masterFiles['qa-spreadsheet-123'].tabs));
 await page.fill('#eventName','Revised fight card');
 await page.evaluate(()=>{window.__failNextWrite=true});
 await page.click('#syncEvent');
 await expect(page.locator('#sheetMessage')).toContainText('Temporary Google write failure');
 const afterFailure=await page.evaluate(()=>JSON.stringify(window.__masterFiles['qa-spreadsheet-123'].tabs));
 expect(afterFailure).toBe(previous);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const afterRetry=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123'].tabs.Events[1][1]);
 expect(afterRetry).toBe('Revised fight card');
});

test('removing a fight clears obsolete master rows while keeping the event',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);await page.click('#backBtn');
 await page.fill('#boutLeft','Second red');await page.fill('#boutRight','Second blue');
 await page.selectOption('#boutDivision','Featherweight');await page.click('#addBout');
 await connectQaGoogle(page);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 expect((await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123'].tabs.Fights)).length).toBe(3);
 await page.locator('.bout-row').nth(1).getByText('Delete',{exact:true}).click();
 await expect(page.locator('.bout-row')).toHaveCount(1);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const rows=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123'].tabs);
 expect(rows.Events).toHaveLength(2);
 expect(rows.Fights).toHaveLength(2);
 expect(rows.Fights[1][7]).toBe('Blue fighter');
 expect(rows.Fights.some(r=>r.includes('Second red'))).toBe(false);
});

test('existing master with too few columns expands to fit round details',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);await page.click('#backBtn');await connectQaGoogle(page);
 await page.evaluate(()=>{window.__mockColumnCount=6});
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const growth=await page.evaluate(()=>window.__sheetRequests.filter(x=>x.path.endsWith(':batchUpdate')&&x.body?.requests));
 expect(growth.length).toBeGreaterThan(0);
 const expanded=growth.flatMap(x=>x.body.requests).filter(x=>x.updateSheetProperties?.fields?.includes('gridProperties.columnCount'));
 expect(expanded.length).toBe(4);
 const widths=expanded.map(x=>x.updateSheetProperties.properties.gridProperties.columnCount);
 expect(Math.min(...widths)).toBeGreaterThanOrEqual(8);
 expect(Math.max(...widths)).toBe(20);
});

test('oversized master payload fails before replacing archived scores',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);await page.click('#backBtn');await connectQaGoogle(page);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const original=await page.evaluate(()=>JSON.stringify(window.__masterFiles['qa-spreadsheet-123'].tabs));
 await page.evaluate(()=>{
  const f=data.events[0].fights[0];
  data.events[0].name='A'.repeat(120);
  f.left='R'.repeat(120);f.right='B'.repeat(120);
  f.roundData[0].observations=Array.from({length:8000},(_,i)=>({side:i%2?'a':'b',time:i*.03}));
  persist();
 });
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 await expect(page.locator('#sheetMessage')).toContainText('recommended 2 MB');
 const current=await page.evaluate(()=>JSON.stringify(window.__masterFiles['qa-spreadsheet-123'].tabs));
 expect(current).toBe(original);
});



test('oversized first sync does not create an empty master spreadsheet',async({page})=>{
 await stubGoogleSheets(page);
 await setup(page);await page.click('#backBtn');
 await page.evaluate(()=>{
  const e=data.events[0],f=e.fights[0];
  e.name='U'.repeat(120);f.left='R'.repeat(120);f.right='B'.repeat(120);
  f.roundData[0].observations=Array.from({length:8000},(_,i)=>({side:i%2?'a':'b',time:i*.03}));
  persist();
 });
 await connectQaGoogle(page);
 await page.click('#syncEvent');
 await expect(page.locator('#sheetMessage')).toContainText('recommended 2 MB');
 await expect(page.locator('#sheetLink')).toBeHidden();
 const creations=await page.evaluate(()=>window.__sheetRequests.filter(x=>x.method==='POST'&&x.path==='/v4/spreadsheets'));
 expect(creations).toHaveLength(0);
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('copper47.workspace.v2')));
 expect(saved.masterSheetId).toBeFalsy();
 expect(saved.events[0].fights[0].roundData[0].observations).toHaveLength(8000);
});


test('Graph V2 updates exact moment counts, reacts to undo and resets cleanly',async({page})=>{
 await setup(page);
 await expect(page.locator('.timeline-title h2')).toHaveText('Exchanges');
 await expect(page.locator('#graphRound')).toHaveAttribute('aria-pressed','true');
 const snapshot=()=>page.locator('#graph').evaluate(c=>({png:c.toDataURL('image/png'),label:c.getAttribute('aria-label')}));
 const empty=await snapshot();
 await page.click('#startBtn');
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');
 await expect(page.locator('#observationsCount')).toHaveText('3 exchanges');
 const withThree=await snapshot();expect(withThree.png).not.toBe(empty.png);
 expect(withThree.label).toContain('2 red exchanges, 1 blue exchanges');
 await page.keyboard.press('Control+z');
 await expect(page.locator('#observationsCount')).toHaveText('2 exchanges');
 expect((await snapshot()).label).toContain('1 red exchanges, 1 blue exchanges');
 await page.click('#resetBtn');
 await expect(page.locator('#observationsCount')).toHaveText('0 exchanges');
 expect((await snapshot()).label).toContain('0 red exchanges, 0 blue exchanges');
});

test('Fight view shows multiple round tapes and does not change scoring',async({page})=>{
 await setup(page);
 await scoreRound(page,'a');
 await page.click('#startBtn');await page.keyboard.press('ArrowRight');
 await page.click('#graphFight');
 await expect(page.locator('#graphFight')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('#graphRound')).toHaveAttribute('aria-pressed','false');
 await expect(page.locator('#observationsCount')).toHaveText('3 exchanges');
 await expect(page.locator('#graph')).toHaveAttribute('aria-label',/Fight summary: 1 red exchanges, 2 blue exchanges/);
 const raw=await page.evaluate(()=>({score:data.events[0].fights[0].roundData[0].score,round:data.events[0].fights[0].index}));
 expect(raw.round).toBe(1);expect(raw.score.winner).toBe('a');
 await page.click('#graphRound');
 await expect(page.locator('#observationsCount')).toHaveText('1 exchanges');
 await expect(page.locator('#graph')).toHaveAttribute('aria-label',/Round 2: 0 red exchanges, 1 blue exchanges/);
});

test('Copy-only interface falls back to a 1600x900 PNG when clipboard is blocked',async({page})=>{
 await setup(page);
 await page.click('#startBtn');await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async()=>{throw Error('Permission denied')}}})});
 const [download]=await Promise.all([page.waitForEvent('download'),page.click('#copyGraph')]);
 expect(download.suggestedFilename()).toMatch(/test-ufc-card_red-fighter_blue-fighter_round-1\.png$/);
 const buffer=await require('node:fs/promises').readFile(await download.path());
 expect(buffer.subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a');
 expect(buffer.readUInt32BE(16)).toBe(1600);
 expect(buffer.readUInt32BE(20)).toBe(900);
 expect(buffer.length).toBeGreaterThan(18000);
});

test('Copy graph writes image/png through clipboard API',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{
  window.__copyData=null;
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{
   write:async(items)=>{
    const blob=await items[0].getType('image/png');
    window.__copyData={type:blob.type,bytes:blob.size};
   }
  }});
 });
 await page.click('#startBtn');await page.keyboard.press('ArrowLeft');
 await page.click('#copyGraph');
 await expect.poll(()=>page.evaluate(()=>window.__copyData?.bytes||0)).toBeGreaterThan(18000);
 const info=await page.evaluate(()=>window.__copyData);
 expect(info.type).toBe('image/png');
});

test('Clipboard denial triggers automatic PNG download and retains moment data',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async()=>{throw Error('NotAllowedError')}}});
 });
 await page.click('#startBtn');await page.keyboard.press('ArrowRight');
 const [download]=await Promise.all([page.waitForEvent('download'),page.click('#copyGraph')]);
 expect(download.suggestedFilename()).toMatch(/round-1\.png$/);
 await expect(page.locator('#momentLog')).toContainText('Blue fighter');
 await expect(page.locator('#observationsCount')).toHaveText('1 exchanges');
});

test('Fight overview export and reduced-motion mobile layout stay usable',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.emulateMedia({reducedMotion:'reduce'});
 await setup(page);
 await scoreRound(page,'a');await page.click('#startBtn');await page.keyboard.press('ArrowRight');
 await page.click('#graphFight');
 const widths=await page.evaluate(()=>({page:document.documentElement.scrollWidth,screen:innerWidth}));
 expect(widths.page).toBeLessThanOrEqual(widths.screen+1);
 await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write:async()=>{throw Error('Permission denied')}}})});
 const [download]=await Promise.all([page.waitForEvent('download'),page.click('#copyGraph')]);
 expect(download.suggestedFilename()).toMatch(/_fight\.png$/);
 const buffer=await require('node:fs/promises').readFile(await download.path());
 expect(buffer.readUInt32BE(16)).toBe(1600);expect(buffer.readUInt32BE(20)).toBe(900);
 await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
});


test('Shift+arrows log major impact exchanges with exact side and timestamp, and survive reload',async({page})=>{
 await setup(page);
 await expect(page.locator('.timeline-title h2')).toHaveText('Exchanges');
 await expect(page.locator('.tape-heading .micro')).toHaveCount(0);
 await expect(page.locator('#downloadGraph')).toHaveCount(0);
 await expect(page.locator('#copyGraph')).toBeVisible();
 await page.click('#startBtn');
 await page.keyboard.press('ArrowLeft');
 await page.keyboard.press('Shift+ArrowRight');
 await page.keyboard.press('Shift+ArrowLeft');
 await expect(page.locator('#observationsCount')).toHaveText('3 exchanges · 2 major');
 const types=await page.evaluate(()=>data.events[0].fights[0].roundData[0].observations.map(o=>({side:o.side,type:o.type,time:o.time})));
 expect(types.map(o=>[o.side,o.type])).toEqual([['a','exchange'],['b','impact'],['a','impact']]);
 expect(types.every(o=>Number.isFinite(o.time)&&o.time>=0)).toBe(true);
 await expect(page.locator('#momentLog .impact-label')).toHaveCount(2);
 await expect(page.locator('#graph')).toHaveAttribute('aria-label',/1 red major impacts and 1 blue major impacts/);
 await page.click('#backBtn');await page.reload();
 await page.locator('.bout-row .primary').click();
 const restored=await page.evaluate(()=>data.events[0].fights[0].roundData[0].observations.map(o=>o.type));
 expect(restored).toEqual(['exchange','impact','impact']);
});

test('Ctrl+Z undoes a major exchange and Backspace does not undo',async({page})=>{
 await setup(page);await page.click('#startBtn');
 await page.keyboard.press('Shift+ArrowRight');
 await page.keyboard.press('Backspace');
 await expect(page.locator('#observationsCount')).toHaveText('1 exchanges · 1 major');
 await page.keyboard.press('Control+z');
 await expect(page.locator('#observationsCount')).toHaveText('0 exchanges');
 const n=await page.evaluate(()=>data.events[0].fights[0].roundData[0].observations.length);
 expect(n).toBe(0);
});

test('A major impact outweighs one ordinary exchange but cannot force a 10–8',async({page})=>{
 await setup(page);await page.click('#startBtn');
 await page.keyboard.press('ArrowLeft');
 await page.keyboard.press('Shift+ArrowRight');
 await page.click('#endBtn');
 await expect(page.locator('#suggestionText')).toContainText('Major impacts');
 await expect(page.locator('#selectB')).toHaveClass(/selected/);
 await expect(page.locator('#draftScore')).toHaveText('9 – 10');
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('Enter');
 await expect(page.locator('#wbTotal')).toHaveText('10 – 9');
});

test('Impact type survives JSON backup and is validated during restore',async({page})=>{
 await setup(page);await page.click('#startBtn');await page.keyboard.press('Shift+ArrowLeft');
 await page.click('#backBtn');
 const [download]=await Promise.all([page.waitForEvent('download'),page.click('#exportAll')]);
 const obj=JSON.parse(await require('node:fs/promises').readFile(await download.path(),'utf8'));
 expect(obj.events[0].fights[0].roundData[0].observations[0].type).toBe('impact');
 const bad=JSON.parse(JSON.stringify(obj));bad.events[0].fights[0].roundData[0].observations[0].type='invalid-type';
 expect(await page.evaluate(input=>{try{validate(input);return false}catch{return true}},bad)).toBe(true);
});

test('Master Sheets adds impact columns and safely upgrades older existing tab headers',async({page})=>{
 await stubGoogleSheets(page);await setup(page);await page.click('#startBtn');
 await page.keyboard.press('Shift+ArrowLeft');await page.keyboard.press('ArrowRight');
 await page.click('#backBtn');await connectQaGoogle(page);
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const first=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123'].tabs);
 expect(first.Moments[0].at(-1)).toBe('Exchange type');
 expect(first.Moments.slice(1).map(r=>r.at(-1))).toEqual(['Major impact','Exchange']);
 expect(first.Rounds[0].slice(-2)).toEqual(['Red major impacts','Blue major impacts']);
 expect(first.Rounds[1].slice(-2)).toEqual([1,0]);
 await page.evaluate(()=>{
  const tabs=window.__masterFiles['qa-spreadsheet-123'].tabs;
  tabs.Moments=tabs.Moments.map(row=>row.slice(0,-1));
  tabs.Rounds=tabs.Rounds.map(row=>row.slice(0,-2));
 });
 await page.click('#syncEvent');await expect(page.locator('#syncEvent')).toBeEnabled();
 const migrated=await page.evaluate(()=>window.__masterFiles['qa-spreadsheet-123'].tabs);
 expect(migrated.Moments[0].at(-1)).toBe('Exchange type');
 expect(migrated.Rounds[0].at(-1)).toBe('Blue major impacts');
 expect(migrated.Moments).toHaveLength(3);
});
