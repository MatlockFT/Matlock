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
  await expect(page.locator('#observationsCount')).toHaveText('2 recorded');
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
  await expect(page.locator('#observationsCount')).toHaveText('2 recorded');
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
  await expect(page.locator('.legend .red')).toHaveText('RED • ABOVE CENTER');
  await expect(page.locator('.legend .blue')).toHaveText('BLUE • BELOW CENTER');
  await expect(page.locator('#scoreBody').locator('tr')).toHaveCount(1);
  await expect(page.locator('.score-rows thead')).toContainText('Red');
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
  await expect(page.locator('#observationsCount')).toHaveText('2 recorded');
  await expect(page.locator('#resetBtn')).toBeEnabled();
  await page.click('#resetBtn');
  await expect(page.locator('#observationsCount')).toHaveText('0 recorded');
  await expect(page.locator('#clock')).toHaveText('5:00');
  await expect(page.locator('#roundState')).toHaveText('Ready');
  await expect(page.locator('#resetBtn')).toBeDisabled();
  await page.reload();
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#clock')).toHaveText('5:00');
  await expect(page.locator('#observationsCount')).toHaveText('0 recorded');
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#observationsCount')).toHaveText('1 recorded');
});
test('declined reset retains the current observations and state', async ({page})=>{
  await setup(page);
  await page.click('#startBtn');
  await page.keyboard.press('ArrowLeft');
  page.removeAllListeners('dialog');
  page.once('dialog', async d => {await d.dismiss()});
  await page.click('#resetBtn');
  await expect(page.locator('#observationsCount')).toHaveText('1 recorded');
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
  await expect(page.locator('#observationsCount')).toHaveText('0 recorded');
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
  await expect(page.locator('#momentLead')).toHaveText('Moments even');
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
  await page.keyboard.press('Backspace');
  await expect(page.locator('#wbMomentsA')).toHaveText('1');
  await expect(page.locator('#wbMomentsB')).toHaveText('0');
  await expect(page.locator('#momentLead')).toHaveText('Red +1');
  await page.click('#resetBtn');
  await expect(page.locator('#wbMomentsA')).toHaveText('0');
  await expect(page.locator('#wbMomentsB')).toHaveText('0');
  await expect(page.locator('#momentLead')).toHaveText('No moments');
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
  await page.keyboard.press('Backspace');
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


async function stubGoogleSheets(page,requests,options={}){
 await page.evaluate(()=>{
  window.google={accounts:{oauth2:{
   initTokenClient:cfg=>({requestAccessToken(){cfg.callback({access_token:'qa-token',expires_in:3600})}}),
   hasGrantedAllScopes:()=>true,
   revoke:(_t,cb)=>{if(cb)cb()}
  }}};
 });
 await page.route('https://sheets.googleapis.com/v4/spreadsheets**',async route=>{
  const req=route.request(),u=new (require('node:url').URL)(req.url()),method=req.method();
  const body=req.postData() ? JSON.parse(req.postData()) : null;
  requests.push({method,path:u.pathname,body,authorization:req.headers().authorization});
  if(options.failCreate&&method==='POST'&&u.pathname==='/v4/spreadsheets'){
   await route.fulfill({status:403,json:{error:{message:'Sheets API is not enabled'}}});return
  }
  if(method==='POST'&&u.pathname==='/v4/spreadsheets'){
   await route.fulfill({json:{spreadsheetId:'qa-spreadsheet-123'}});return
  }
  if(method==='GET'){
   await route.fulfill({json:{sheets:[
    {properties:{title:'Fights',sheetId:11,gridProperties:{rowCount:1000,columnCount:26}}},
    {properties:{title:'Rounds',sheetId:12,gridProperties:{rowCount:1000,columnCount:26}}},
    {properties:{title:'Moments',sheetId:13,gridProperties:{rowCount:1000,columnCount:26}}}
   ]}});return
  }
  if(method==='POST'&&(u.pathname.endsWith(':batchUpdate')||u.pathname.endsWith(':batchClear'))){
   await route.fulfill({json:{spreadsheetId:'qa-spreadsheet-123',responses:[]}});return
  }
  await route.fulfill({status:400,json:{error:{message:'Unmocked Sheets request'}}});
 });
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

test('google Sheets sync creates a per-event Fights, Rounds and Moments spreadsheet',async ({page})=>{
 const requests=[];await stubGoogleSheets(page,requests);
 await setup(page);
 await page.click('#startBtn');
 await page.keyboard.press('ArrowLeft');await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowLeft');
 await page.click('#endBtn');await page.keyboard.press('Enter');
 await page.click('#backBtn');
 await page.locator('#clientId').evaluate(el=>el.closest('details').open=true);
 await page.fill('#clientId','qa-client.apps.googleusercontent.com');
 await page.click('#connectDrive');
 await expect(page.locator('#driveStatus')).toHaveText('Connected');
 await page.click('#syncEvent');
 await page.waitForTimeout(900);
 console.log('GOOGLE_SYNC_TRACE',JSON.stringify(requests.map(r=>({path:r.path,method:r.method}))),await page.locator('#sheetMessage').textContent());
 await expect(page.locator('#syncEvent')).toBeEnabled();
 await expect(page.locator('#sheetLink')).toBeVisible();
 await expect(page.locator('#sheetLink')).toHaveAttribute('href','https://docs.google.com/spreadsheets/d/qa-spreadsheet-123/edit');
 const created=requests.filter(r=>r.method==='POST'&&r.path==='/v4/spreadsheets');
 expect(created).toHaveLength(1);
 expect(created[0].body.sheets.map(x=>x.properties.title)).toEqual(['Fights','Rounds','Moments']);
 const writes=requests.filter(r=>r.path.endsWith('/values:batchUpdate'));
 expect(writes).toHaveLength(1);
 const payload=writes[0].body;expect(payload.valueInputOption).toBe('RAW');
 const range=title=>payload.data.find(x=>x.range==="'"+title+"'!A1").values;
 const f=range('Fights'),rd=range('Rounds'),m=range('Moments');
 expect(f).toHaveLength(2);expect(rd).toHaveLength(3);expect(m).toHaveLength(4);
 expect(f[1]).toContain('Lightweight');
 expect(rd[1][9]).toBe(2);expect(rd[1][10]).toBe(1);
 expect(rd[1][13]).toBe(10);expect(rd[1][14]).toBe(9);
 expect(m.slice(1).map(x=>x[10])).toEqual(['Red','Blue','Red']);
 expect(requests.every(x=>x.authorization==='Bearer qa-token')).toBe(true);
 // Resync must update the same file rather than create another one.
 await page.click('#syncEvent');
 await expect(page.locator('#syncEvent')).toBeEnabled();
 expect(requests.filter(r=>r.method==='POST'&&r.path==='/v4/spreadsheets')).toHaveLength(1);
 expect(requests.filter(r=>r.path.endsWith('/values:batchClear'))).toHaveLength(2);
 await page.reload();
 await expect(page.locator('#sheetLink')).toHaveAttribute('href','https://docs.google.com/spreadsheets/d/qa-spreadsheet-123/edit');
});

test('sync-all creates one spreadsheet per event and keeps histories independent',async ({page})=>{
 const requests=[];await stubGoogleSheets(page,requests);
 await page.click('#newEventBtn');await page.fill('#eventName','Event A');
 await page.fill('#boutLeft','A red');await page.fill('#boutRight','A blue');
 await page.selectOption('#boutDivision','Welterweight');await page.click('#addBout');
 await page.click('#newEventBtn');await page.fill('#eventName','Event B');
 await page.fill('#boutLeft','B red');await page.fill('#boutRight','B blue');
 await page.selectOption('#boutDivision',"Women's Bantamweight");await page.click('#addBout');
 await page.locator('#clientId').evaluate(el=>el.closest('details').open=true);
 await page.fill('#clientId','qa-client.apps.googleusercontent.com');await page.click('#connectDrive');
 await page.click('#syncAllEvents');
 await page.waitForTimeout(900);
 console.log('GOOGLE_ALL_TRACE',JSON.stringify(requests.map(r=>({path:r.path,method:r.method}))),await page.locator('#sheetMessage').textContent());
 await expect(page.locator('#syncAllEvents')).toBeEnabled();
 const made=requests.filter(x=>x.method==='POST'&&x.path==='/v4/spreadsheets');
 expect(made).toHaveLength(2);
 expect(made.map(x=>x.body.properties.title)).toEqual([
  expect.stringContaining('Event A'),expect.stringContaining('Event B')
 ]);
});

test('google Sheets errors never delete the locally saved fight',async ({page})=>{
 const requests=[];await stubGoogleSheets(page,requests,{failCreate:true});
 await setup(page);
 await page.click('#backBtn');
 await page.locator('#clientId').evaluate(el=>el.closest('details').open=true);
 await page.fill('#clientId','qa-client.apps.googleusercontent.com');await page.click('#connectDrive');
 await page.click('#syncEvent');
 await expect(page.locator('#sheetMessage')).toContainText('Sheets API is not enabled');
 await expect(page.locator('#sheetLink')).toBeHidden();
 await page.reload();
 await expect(page.locator('.bout-row')).toHaveCount(1);
 await page.locator('.bout-row .primary').click();
 await expect(page.locator('#wbLeft')).toHaveText('Red fighter');
});
