const { test, expect } = require('@playwright/test');
const { startServer } = require('./broadcast-test-server.cjs');
let fixture;
test.beforeEach(async ({ context }) => {
  fixture = await startServer();
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
test.afterEach(async () => fixture.close());
function setText(body, options = {}) {
  const item = { id: 'manual-text', type: 'headline', title: 'LATEST FIGHT NEWS', eyebrow: 'MATLOCK FIGHT CHANNEL', header: 'YOUR FIGHT FORECAST', body, duration: 60, ...options };
  const channel = { ...fixture.state.live, program: [item], startedAt: new Date().toISOString() };
  fixture.state = { version: 1, live: structuredClone(channel), draft: structuredClone(channel) };
  return item;
}
async function assertFits(page) {
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('[data-mfc-panel]').getBoundingClientRect();
    const header = document.querySelector('[data-mfc-header]'), headerBox = header.parentElement.getBoundingClientRect();
    const fields = ['eyebrow', 'title', 'body'].map(name => {
      const node = document.querySelector('[data-mfc-' + name + ']'), box = node.getBoundingClientRect();
      return { name, inPanel: box.left >= panel.left && box.right <= panel.right + 1 && box.top >= panel.top && box.bottom <= panel.bottom + 1,
        overflowX: node.scrollWidth > node.clientWidth + 1, overflowY: node.scrollHeight > node.clientHeight + 1 };
    });
    const box = header.getBoundingClientRect();
    return { fields, headerFits: box.left >= headerBox.left && box.right <= headerBox.right + 1 && box.top >= headerBox.top && box.bottom <= headerBox.bottom + 1 && header.scrollWidth <= header.clientWidth + 1 };
  });
  expect(geometry.headerFits).toBe(true);
  for (const field of geometry.fields) expect(field, field.name).toMatchObject({ inPanel: true, overflowX: false, overflowY: false });
}

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 300, height: 225 }]) {
  test('manual title, eyebrow, header and body fit at ' + viewport.width + 'px', async ({ page }) => {
    const item = setText('A fight announcement with context, fighter names and details. '.repeat(5), {
      type: 'results', title: 'A comprehensive fight result and all the details viewers need to understand the outcome',
      eyebrow: 'Official results and post-fight reaction', header: 'The latest fight results from around the world'
    });
    await page.setViewportSize(viewport); await page.goto(fixture.origin + '/broadcast/?embed=1');
    await expect(page.locator('[data-mfc-title]')).toHaveText(item.title.toUpperCase());
    await expect.poll(() => page.locator('[data-mfc-title]').evaluate(node => Boolean(node.style.fontSize))).toBe(true);
    await assertFits(page);
    await page.evaluate(() => document.fonts.dispatchEvent(new Event('loadingdone')));
    await assertFits(page);
  });
}

test('every character of a long body appears in fitted pages, including paragraphs and an unbroken URL; pages restart with the loop', async ({ page }) => {
  const body = 'First paragraph. '.repeat(35) + '\n\n' + 'https://example.com/' + 'longpath'.repeat(35) + '\n' + 'Last paragraph: no words may disappear. '.repeat(25) + ' 🥊';
  const item = setText(body);
  const startedAt = Date.parse(fixture.state.live.startedAt);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(stamp => { window.testOffset = 0; Date.now = () => stamp + window.testOffset; }, startedAt);
  await page.goto(fixture.origin + '/broadcast/?embed=1');
  await expect(page.locator('[data-mfc-copy-page]')).toBeVisible();
  const total = Number((await page.locator('[data-mfc-copy-page]').textContent()).split('/')[1]);
  expect(total).toBeGreaterThan(1);
  const pages = [];
  for (let index = 0; index < total; index++) {
    await page.evaluate(offset => { window.testOffset = offset; }, (index + .1) * item.duration / total * 1000);
    await expect(page.locator('[data-mfc-copy-page]')).toHaveText('PAGE ' + (index + 1) + ' / ' + total);
    pages.push(await page.locator('[data-mfc-body]').textContent()); await assertFits(page);
  }
  expect(pages.join('')).toBe(body);
  await page.evaluate(offset => { window.testOffset = offset; }, item.duration * 1000 + 100);
  await expect(page.locator('[data-mfc-copy-page]')).toHaveText('PAGE 1 / ' + total);
  await expect(page.locator('[data-mfc-body]')).toHaveText(pages[0]);
});

test('resize, hidden monitor recovery and edits recompute layout; inspector suggests sufficient reading time', async ({ page }) => {
  const item = setText('Long broadcast body with important details and a complete sentence. '.repeat(18), { duration: 2 });
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Rundown/ }).click();
  const preview = page.frameLocator('[data-preview-frame]');
  await expect(page.locator('[data-text-fit-hint]')).toContainText('Suggested reading time');
  await page.getByRole('button', { name: 'Use suggested reading time' }).click();
  const duration = Number(await page.getByLabel('Duration (seconds)', { exact: true }).inputValue());
  expect(duration).toBeGreaterThan(2);
  expect(fixture.state.live.program[0].duration).toBe(2); // The hint changes only the draft.
  await page.getByRole('tab', { name: /News Pool/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: /Rundown/ }).click();
  await expect(preview.locator('[data-mfc-copy-page]')).toBeVisible();
  await page.getByLabel('Body', { exact: true }).fill('Short body now fits on one screen.');
  await expect(preview.locator('[data-mfc-body]')).toHaveText('Short body now fits on one screen.');
  await expect(preview.locator('[data-mfc-copy-page]')).toBeHidden();
  await expect(page.locator('[data-text-fit-hint]')).toContainText('1 page');
  await page.locator('[data-program-fields]').getByLabel('Title', { exact: true }).fill('Resized title');
  await expect(preview.locator('[data-mfc-title]')).toHaveText('RESIZED TITLE');
  expect(fixture.controls.writes).toBe(0);
});
