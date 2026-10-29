const { test, expect } = require('@playwright/test');
const URL = 'http://127.0.0.1:4173/copper-orchard-47/';
test.beforeEach(async ({ page }) => {
  page.on('dialog', async d => d.accept());
  await page.goto(URL);
});
async function setup(page){
  await page.click('#newEventBtn');
  await page.fill('#eventName','Test UFC card');
  await page.fill('#boutLeft','Blue fighter');
  await page.fill('#boutRight','Red fighter');
  await page.fill('#boutDivision','Lightweight');
  await page.click('#addBout');
  await page.locator('.bout-row .primary').click();
  await expect(page.locator('#wbLeft')).toHaveText('Blue fighter');
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
  expect(obj.events[0].fights[0].left).toBe('Blue fighter');
});
