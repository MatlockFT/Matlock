const { test, expect } = require('@playwright/test');

const baseUrl = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';

async function openWriter(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const library = page.locator('[data-library-view]');
  if (await library.isVisible()) await page.click('[data-library-new]');
  await expect(page.locator('[data-writer-app]')).toBeVisible();
  await expect(page.locator('button[data-writer-sync-scroll]')).toBeVisible();
}

test('split workflow persists views, fills the viewport and keeps editor/preview navigation connected', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openWriter(page);

  const workspace = page.locator('[data-workspace]');
  const editor = page.locator('#writer-body');
  const dropzone = page.locator('[data-editor-dropzone]');
  const previewPane = page.locator('.writer-preview-pane');
  const previewFrame = page.locator('[data-preview-frame]');
  const toolbar = page.locator('.writer-toolbar');
  const splitter = page.locator('[data-writer-splitter]');
  const syncButton = page.locator('button[data-writer-sync-scroll]');

  await page.click('[data-view="split"]');
  await page.click('[data-preview-size="mobile"]');

  expect(await page.evaluate(() => localStorage.getItem('mma-writer-view-mode'))).toBe('split');
  expect(await page.evaluate(() => localStorage.getItem('mma-writer-preview-size'))).toBe('mobile');

  const dropzoneBox = await dropzone.boundingBox();
  const previewBox = await previewPane.boundingBox();
  expect(dropzoneBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(dropzoneBox.height).toBeGreaterThan(850);
  expect(Math.abs(dropzoneBox.height - previewBox.height)).toBeLessThanOrEqual(3);
  expect(await toolbar.evaluate(el => getComputedStyle(el).position)).toBe('sticky');

  const beforeSplit = Number(await splitter.getAttribute('aria-valuenow'));
  await splitter.focus();
  await page.keyboard.press('ArrowRight');
  const changedSplit = Number(await splitter.getAttribute('aria-valuenow'));
  expect(changedSplit).toBeGreaterThan(beforeSplit);
  expect(Number(await page.evaluate(() => localStorage.getItem('matlock-writer:split-ratio')))).toBe(changedSplit);

  const body = [
    'Opening paragraph.',
    '',
    '## First Section',
    ...Array.from({ length: 45 }, (_, i) => `First section paragraph ${i + 1}. This is enough copy to make both panes independently scrollable.`),
    '',
    '## Target Section',
    ...Array.from({ length: 45 }, (_, i) => `Target section paragraph ${i + 1}. More copy keeps scroll synchronization measurable.`),
    '',
    '### Final Notes',
    ...Array.from({ length: 20 }, (_, i) => `Closing paragraph ${i + 1}.`),
  ].join('\n\n');

  await editor.fill(body);
  await expect(page.locator('[data-preview-content] h2', { hasText: 'Target Section' })).toBeVisible();
  await expect(syncButton).toHaveAttribute('aria-pressed', 'true');

  await editor.evaluate(el => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.62;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const previewProgress = await previewPane.evaluate(el => {
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? el.scrollTop / max : 0;
  });
  expect(previewProgress).toBeGreaterThan(0.45);
  expect(previewProgress).toBeLessThan(0.78);

  const targetIndex = body.indexOf('## Target Section');
  await page.locator('[data-preview-content] h2', { hasText: 'Target Section' }).click();
  await expect.poll(async () => editor.evaluate(el => el.selectionStart)).toBe(targetIndex);

  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await page.locator('[data-library-view]').isVisible()) await page.click('[data-library-new]');
  await expect(page.locator('button[data-writer-sync-scroll]')).toBeVisible();
  await expect(workspace).toHaveAttribute('data-view-mode', 'split');
  await expect(previewFrame).toHaveAttribute('data-preview-size', 'mobile');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(changedSplit));

  await syncButton.click();
  await expect(syncButton).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => localStorage.getItem('mma-writer-sync-scroll'))).toBe('0');
});
