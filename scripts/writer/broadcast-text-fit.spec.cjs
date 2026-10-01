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
  await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector('[data-mfc-panel]').getBoundingClientRect();
    const header = document.querySelector('[data-mfc-header]'), headerBox = header.parentElement.getBoundingClientRect();
    const fields = ['eyebrow', 'title', 'body'].map(name => {
      const node = document.querySelector('[data-mfc-' + name + ']'), box = node.getBoundingClientRect();
      return { name, inPanel: box.left >= panel.left && box.right <= panel.right + 1 && box.top >= panel.top && box.bottom <= panel.bottom + 1,
        overflowX: node.scrollWidth > node.clientWidth + 1, overflowY: node.scrollHeight > node.clientHeight + 1 };
    });
    const box = header.getBoundingClientRect();
    return { fields, headerBounds: { box: box.toJSON(), parent: headerBox.toJSON(), scrollWidth: header.scrollWidth, clientWidth: header.clientWidth }, headerFits: box.left >= headerBox.left && box.right <= headerBox.right + 1 && box.top >= headerBox.top && box.bottom <= headerBox.bottom + 1 && header.scrollWidth <= header.clientWidth + 1 };
  });
  expect(geometry.headerFits, JSON.stringify(geometry.headerBounds)).toBe(true);
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

test('Control, homepage-sized embeds, narrow monitors and wide hosts share one composition and page count', async ({ page }) => {
  setText('Complete news text with fighter names and results. '.repeat(65), { duration: 600 });
  async function composition(locator) {
    return locator.evaluate(screen => {
      const stage = screen.getBoundingClientRect();
      const keys = ['header', 'eyebrow', 'title', 'body', 'date', 'clock'];
      return { ratio: stage.width / stage.height, pages: screen.querySelector('[data-mfc-copy-page]').textContent,
        fields: keys.map(key => {
          const node = screen.querySelector('[data-mfc-' + key + ']'), box = node.getBoundingClientRect();
          return { key, font: getComputedStyle(node).fontSize, left: (box.left - stage.left) / stage.width,
            top: (box.top - stage.top) / stage.height, width: box.width / stage.width, height: box.height / stage.height };
        }) };
    });
  }
  await page.setViewportSize({ width: 1440, height: 900 }); await page.goto(fixture.origin + '/broadcast/control/');
  const preview = page.frameLocator('[data-preview-frame]');
  await expect(preview.locator('[data-mfc-copy-page]')).toBeVisible();
  const reference = await composition(preview.locator('[data-mfc-screen]'));
  for (const viewport of [{ width: 640, height: 480 }, { width: 390, height: 844 }, { width: 300, height: 225 }, { width: 900, height: 300 }, { width: 1440, height: 900, standalone: true }]) {
    await page.setViewportSize(viewport); await page.goto(fixture.origin + '/broadcast/?' + (viewport.standalone ? '' : 'embed=1'));
    await expect(page.locator('[data-mfc-copy-page]')).toBeVisible();
    const actual = await composition(page.locator('[data-mfc-screen]'));
    expect(actual.ratio).toBeCloseTo(4 / 3, 5); expect(actual.pages).toBe(reference.pages);
    actual.fields.forEach((field, index) => {
      expect(field.font, field.key).toBe(reference.fields[index].font);
      for (const dimension of ['left', 'top', 'width', 'height']) expect(field[dimension], field.key + ' ' + dimension).toBeCloseTo(reference.fields[index][dimension], 4);
    });
    const placement = await page.locator('[data-mfc-screen]').evaluate(node => {
      const box = node.getBoundingClientRect(); return { left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: innerWidth, height: innerHeight };
    });
    expect(placement.left).toBeGreaterThanOrEqual(-1); expect(placement.top).toBeGreaterThanOrEqual(-1);
    expect(placement.right).toBeLessThanOrEqual(placement.width + 1); expect(placement.bottom).toBeLessThanOrEqual(placement.height + 1);
    await assertFits(page);
  }
});

test('short and wrapped banner labels retain the same visible-glyph center; footer rows stay separate', async ({ page }) => {
  for (const header of ['I', 'DWCS RESULTS', 'THE LATEST FIGHT RESULTS AND NEWS FROM AROUND THE WORLD']) {
    setText('Fight news details.', { header, duration: 600 });
    await page.setViewportSize({ width: 640, height: 480 }); await page.goto(fixture.origin + '/broadcast/?embed=1');
    await expect.poll(() => page.locator('[data-mfc-header]').evaluate(node => Boolean(node.style.fontSize))).toBe(true);
    await assertFits(page);
    const alignment = await page.evaluate(() => {
      const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d');
      const inkBox = node => {
        const style = getComputedStyle(node), box = node.getBoundingClientRect();
        ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`; const m = ctx.measureText(node.textContent);
        const shift = (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent - m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2;
        const center = (box.top + box.bottom) / 2 + shift;
        return { center, top: center - (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2, bottom: center + (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) / 2 };
      };
      const banner = document.querySelector('.mfc-header-copy').getBoundingClientRect(), row = document.querySelector('.mfc-lower-status').getBoundingClientRect();
      const headerInk = inkBox(document.querySelector('[data-mfc-header]'));
      const date = inkBox(document.querySelector('[data-mfc-date]')), clock = inkBox(document.querySelector('[data-mfc-clock]'));
      const crawl = document.querySelector('.mfc-lower-crawl').getBoundingClientRect();
      return { headerError: Math.abs(headerInk.center - (banner.top + banner.bottom) / 2),
        dateError: Math.abs(date.center - (row.top + row.bottom) / 2), clockError: Math.abs(clock.center - (row.top + row.bottom) / 2),
        footerSeparated: date.bottom < crawl.top && clock.bottom < crawl.top };
    });
    expect(alignment.headerError, JSON.stringify(alignment)).toBeLessThan(1); expect(alignment.dateError, JSON.stringify(alignment)).toBeLessThan(1); expect(alignment.clockError, JSON.stringify(alignment)).toBeLessThan(1);
    expect(alignment.footerSeparated).toBe(true); await assertFits(page);
  }
});


test('wrapped story headlines scale down while short headlines keep the full display size', async ({ page }) => {
  const body = 'Short story context that leaves plenty of room below the headline.';
  setText(body, { title: 'SHORT FIGHT NEWS', duration: 600 });
  await page.setViewportSize({ width: 640, height: 480 });
  await page.goto(fixture.origin + '/broadcast/?embed=1');
  await expect(page.locator('[data-mfc-title]')).toHaveText('SHORT FIGHT NEWS');
  await expect.poll(() => page.locator('[data-mfc-title]').evaluate(node => Boolean(node.style.fontSize))).toBe(true);
  const short = await page.locator('[data-mfc-title]').evaluate(node => ({
    size: parseFloat(getComputedStyle(node).fontSize),
    lineHeight: parseFloat(getComputedStyle(node).lineHeight),
    height: node.offsetHeight
  }));
  expect(Math.round(short.height / short.lineHeight)).toBe(1);

  setText(body, {
    title: 'Two charged with perjury over evidence in Conor McGregor’s failed Nikita Hand appeal',
    duration: 600
  });
  await page.reload();
  await expect(page.locator('[data-mfc-title]')).toContainText('TWO CHARGED WITH PERJURY');
  await expect.poll(() => page.locator('[data-mfc-title]').evaluate(node => Boolean(node.style.fontSize))).toBe(true);
  const long = await page.locator('[data-mfc-title]').evaluate(node => ({
    size: parseFloat(getComputedStyle(node).fontSize),
    lineHeight: parseFloat(getComputedStyle(node).lineHeight),
    height: node.offsetHeight
  }));
  expect(Math.round(long.height / long.lineHeight)).toBeGreaterThanOrEqual(2);
  expect(long.size).toBeLessThan(short.size * .9);
  await assertFits(page);
});
