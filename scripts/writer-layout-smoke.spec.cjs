const { test, expect } = require('@playwright/test');

const baseUrl = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';

async function openWriter(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const library = page.locator('[data-library-view]');
  if (await library.isVisible()) await page.click('[data-library-new]');
  const app = page.locator('[data-writer-app]');
  await expect(app).toBeVisible();
  return app;
}

async function openModeMore(page) {
  const more = page.locator('[data-writer-mode-more]');
  await expect(more).toHaveCount(1);
  if (!(await more.evaluate(el => el.open))) await more.locator('summary').click();
  await expect(more.locator('[data-writer-mode-more-panel]')).toBeVisible();
}

async function expectCenteredWithoutOverflow(page, box) {
  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  const leftGap = box.x;
  const rightGap = viewport.clientWidth - (box.x + box.width);

  expect(leftGap).toBeGreaterThanOrEqual(0);
  expect(rightGap).toBeGreaterThanOrEqual(0);
  expect(Math.abs(leftGap - rightGap)).toBeLessThanOrEqual(2);
  expect(viewport.scrollWidth - viewport.clientWidth).toBeLessThanOrEqual(1);
}

test('Writer shell and editing surface adapt to desktop and ultrawide viewports', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const app = await openWriter(page);

  let box = await app.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(1840);
  expect(box.width).toBeLessThan(1900);
  expect(1920 - box.width).toBeLessThan(80);
  await expectCenteredWithoutOverflow(page, box);

  await openModeMore(page);
  await page.click('[data-writer-ux-width="normal"]');
  const editorPane = page.locator('.writer-editor-pane');
  const dropzone = page.locator('[data-editor-dropzone]');
  const editorPaneBox = await editorPane.boundingBox();
  const normalBox = await dropzone.boundingBox();
  expect(editorPaneBox).not.toBeNull();
  expect(normalBox).not.toBeNull();
  const expectedNormalWidth = Math.min(1200, editorPaneBox.width * 0.96);
  expect(normalBox.width).toBeGreaterThan(850);
  expect(Math.abs(normalBox.width - expectedNormalWidth)).toBeLessThanOrEqual(3);

  await page.setViewportSize({ width: 3440, height: 1200 });
  box = await app.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(2998);
  expect(box.width).toBeLessThanOrEqual(3002);
  await expectCenteredWithoutOverflow(page, box);

  // Below the adaptive desktop breakpoint, preserve the existing compact shell.
  await page.setViewportSize({ width: 1024, height: 900 });
  box = await app.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(950);
  expect(box.width).toBeLessThanOrEqual(970);
  await expectCenteredWithoutOverflow(page, box);
});
