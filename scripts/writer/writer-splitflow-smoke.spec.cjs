const { test, expect } = require('@playwright/test');

const baseUrl = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';

async function openWriter(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const library = page.locator('[data-library-view]');
  if (await library.isVisible()) await page.click('[data-library-new]');
  await expect(page.locator('[data-writer-app]')).toBeVisible();
  const more = page.locator('[data-writer-mode-more]');
  if (!(await more.evaluate(el => el.open))) await more.locator('summary').click();
  await expect(page.locator('button[data-writer-sync-scroll]')).toHaveCount(0);
}

test('split workflow persists views, fills the viewport and keeps editor/preview scrolling independent', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openWriter(page);

  const workspace = page.locator('[data-workspace]');
  const editor = page.locator('#writer-body');
  const dropzone = page.locator('[data-editor-dropzone]');
  const previewPane = page.locator('.writer-preview-pane');
  const previewFrame = page.locator('[data-preview-frame]');
  const toolbar = page.locator('.writer-toolbar');
  const splitter = page.locator('[data-writer-splitter]');

  await page.click('[data-view="split"]');
  await page.click('[data-preview-size="mobile"]');

  expect(await page.evaluate(() => localStorage.getItem('mma-writer-view-mode'))).toBe('split');
  expect(await page.evaluate(() => localStorage.getItem('mma-writer-preview-size'))).toBe('mobile');

  const dropzoneBox = await dropzone.boundingBox();
  const previewBox = await previewPane.boundingBox();
  expect(dropzoneBox).not.toBeNull();
  expect(previewBox).not.toBeNull();
  expect(dropzoneBox.height).toBeGreaterThan(300);
  expect(dropzoneBox.height).toBeLessThan(previewBox.height);

  const viewportLayout = await page.evaluate(() => {
    const workspaceEl = document.querySelector('[data-workspace]');
    const editorPaneEl = document.querySelector('.writer-editor-pane');
    const previewPaneEl = document.querySelector('.writer-preview-pane');
    const workspaceRect = workspaceEl.getBoundingClientRect();
    const editorRect = editorPaneEl.getBoundingClientRect();
    const previewRect = previewPaneEl.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      documentHeight: document.documentElement.scrollHeight,
      workspaceBottom: workspaceRect.bottom,
      editorHeight: editorRect.height,
      previewHeight: previewRect.height,
      bodyOverflow: getComputedStyle(document.body).overflow,
    };
  });
  expect(viewportLayout.documentHeight).toBeLessThanOrEqual(viewportLayout.viewportHeight + 2);
  expect(viewportLayout.workspaceBottom).toBeLessThanOrEqual(viewportLayout.viewportHeight + 2);
  expect(Math.abs(viewportLayout.editorHeight - viewportLayout.previewHeight)).toBeLessThanOrEqual(3);
  expect(viewportLayout.bodyOverflow).toBe('hidden');

  const tallPreviewHeight = previewBox.height;
  await page.setViewportSize({ width: 1920, height: 820 });
  await expect.poll(async () => (await previewPane.boundingBox())?.height || 0).toBeLessThan(tallPreviewHeight - 150);
  const resizedLayout = await page.evaluate(() => ({
    viewportHeight: window.innerHeight,
    documentHeight: document.documentElement.scrollHeight,
    previewBottom: document.querySelector('.writer-preview-pane').getBoundingClientRect().bottom,
  }));
  expect(resizedLayout.documentHeight).toBeLessThanOrEqual(resizedLayout.viewportHeight + 2);
  expect(resizedLayout.previewBottom).toBeLessThanOrEqual(resizedLayout.viewportHeight + 2);
  await page.setViewportSize({ width: 1920, height: 1080 });

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

  await previewPane.evaluate(el => { el.scrollTop = 0; });
  await editor.evaluate(el => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.62;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);

  const previewProgressAfterEditorScroll = await previewPane.evaluate(el => {
    const max = el.scrollHeight - el.clientHeight;
    return max > 0 ? el.scrollTop / max : 0;
  });
  expect(previewProgressAfterEditorScroll).toBeLessThan(0.05);

  const editorScrollBeforePreview = await editor.evaluate(el => el.scrollTop);
  await previewPane.evaluate(el => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.7;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(100);
  const editorScrollAfterPreview = await editor.evaluate(el => el.scrollTop);
  expect(Math.abs(editorScrollAfterPreview - editorScrollBeforePreview)).toBeLessThanOrEqual(2);

  const targetIndex = body.indexOf('## Target Section');
  await page.locator('[data-preview-content] h2', { hasText: 'Target Section' }).click();
  await expect.poll(async () => editor.evaluate(el => el.selectionStart)).toBe(targetIndex);

  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await page.locator('[data-library-view]').isVisible()) await page.click('[data-library-new]');
  const moreAfterReload = page.locator('[data-writer-mode-more]');
  if (!(await moreAfterReload.evaluate(el => el.open))) await moreAfterReload.locator('summary').click();
  await expect(page.locator('button[data-writer-sync-scroll]')).toHaveCount(0);
  await expect(workspace).toHaveAttribute('data-view-mode', 'split');
  await expect(previewFrame).toHaveAttribute('data-preview-size', 'mobile');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(changedSplit));
  expect(await page.evaluate(() => localStorage.getItem('mma-writer-sync-scroll'))).toBeNull();
});
