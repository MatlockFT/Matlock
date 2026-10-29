const { test, expect } = require('@playwright/test');
const URL = 'http://127.0.0.1:4173/copper-orchard-47/';
test.beforeEach(async ({ page }) => {
  page.on('dialog', async d => d.accept());
  await page.goto(URL);
});
async function setup(page){
  await page.click('#newEventBtn');
  await page.fill('#eventName','Test UFC card');
  await page.fill('#boutLeft','Red fighter');
  await page.fill('#boutRight','Blue fighter');
  await page.fill('#boutDivision','Lightweight');
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
  await expect(page.locator('.wb-head .micro.red')).toContainText('Left / red');
  await expect(page.locator('.wb-head .micro.blue')).toContainText('Right / blue');
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
  await expect(page.locator('#selectA')).toContainText('Left / red');
  await expect(page.locator('#selectB')).toContainText('Right / blue');
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
  await page.on('dialog', async d => {if(d.message().includes('Reset round'))await d.dismiss()});
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
  await page.evaluate(()=>{
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
