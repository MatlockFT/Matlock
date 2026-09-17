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

test('Writer shell adapts to desktop and ultrawide viewports without stretching normal text', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const app = await openWriter(page);

  let box = await app.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(1840);
  expect(box.width).toBeLessThan(1900);
  expect(1920 - box.width).toBeLessThan(80);

  await page.click('[data-writer-ux-width="normal"]');
  const dropzone = page.locator('[data-editor-dropzone]');
  const normalBox = await dropzone.boundingBox();
  expect(normalBox).not.toBeNull();
  expect(normalBox.width).toBeLessThanOrEqual(762);

  await page.setViewportSize({ width: 3440, height: 1200 });
  box = await app.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(2998);
  expect(box.width).toBeLessThanOrEqual(3002);

  // Below the adaptive desktop breakpoint, preserve the existing compact shell.
  await page.setViewportSize({ width: 1024, height: 900 });
  box = await app.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThanOrEqual(950);
  expect(box.width).toBeLessThanOrEqual(970);
});
