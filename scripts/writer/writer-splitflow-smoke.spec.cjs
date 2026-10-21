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
  expect(await previewPane.evaluate(el => getComputedStyle(el).position)).not.toBe('sticky');
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

  const firstPreviewParagraph = page.locator('[data-preview-content] > p').first();
  await firstPreviewParagraph.evaluate(el => { window.__writerStablePreviewParagraph = el; });
  await editor.evaluate(el => { el.focus(); el.setSelectionRange(5, 5); });
  await page.keyboard.type(' marker');
  await expect.poll(async () => firstPreviewParagraph.textContent()).toContain('marker');
  expect(await page.evaluate(() =>
    window.__writerStablePreviewParagraph === document.querySelector('[data-preview-content] > p')
  )).toBe(true);

  // Typing inside formatted text must not recreate the preview's inline elements.
  const inlineBody = body.replace('Opening paragraph.', 'Opening **stable paragraph**.');
  await editor.fill(inlineBody);
  const stableInline = page.locator('[data-preview-content] > p').first().locator('strong').first();
  await expect(stableInline).toHaveText('stable paragraph');
  await stableInline.evaluate(el => { window.__writerStableInline = el; });
  const boldStart = inlineBody.indexOf('stable paragraph');
  await editor.evaluate((el, index) => {
    el.focus();
    el.setSelectionRange(index, index);
  }, boldStart);
  await page.keyboard.type('revised ');
  await expect(stableInline).toHaveText('revised stable paragraph');
  expect(await page.evaluate(() =>
    window.__writerStableInline === document.querySelector('[data-preview-content] > p strong')
  )).toBe(true);

  await editor.fill(body);

  // Browser-native scroll anchoring must keep the visible article block steady,
  // without script-driven scrollTop corrections on every preview render.
  await previewPane.evaluate(el => {
    el.scrollTop = Math.max(0, (el.scrollHeight - el.clientHeight) * 0.7);
  });
  const previewAnchorBefore = await page.evaluate(() => {
    const pane = document.querySelector('.writer-preview-pane');
    const content = document.querySelector('[data-preview-content]');
    const paneRect = pane.getBoundingClientRect();
    const node = [...content.children].find(child => {
      const rect = child.getBoundingClientRect();
      return rect.bottom > paneRect.top + 4 && rect.top < paneRect.bottom - 4;
    });
    if (!node) return null;
    window.__writerPreviewScrollAnchor = node;
    return {
      offset: node.getBoundingClientRect().top - paneRect.top,
      scrollTop: pane.scrollTop,
      text: node.textContent
    };
  });
  expect(previewAnchorBefore).not.toBeNull();
  await editor.evaluate((el, prefix) => {
    el.value = prefix + el.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, 'Extra introductory sentence to expand the content above the current preview viewport. '.repeat(45));
  await expect(page.locator('[data-preview-content] > p').first()).toContainText('Extra introductory sentence', { timeout: 6000 });
  const previewAnchorAfter = await page.evaluate(() => {
    const pane = document.querySelector('.writer-preview-pane');
    const node = window.__writerPreviewScrollAnchor;
    if (!node || !node.isConnected) return null;
    return {
      offset: node.getBoundingClientRect().top - pane.getBoundingClientRect().top,
      scrollTop: pane.scrollTop
    };
  });
  expect(previewAnchorAfter).not.toBeNull();
  expect(Math.abs(previewAnchorAfter.offset - previewAnchorBefore.offset)).toBeLessThan(3);
  expect(previewAnchorAfter.scrollTop).toBeGreaterThan(previewAnchorBefore.scrollTop + 10);

  await editor.fill(body);
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

  // Position memory must restore the editor caret and both independent scroll positions.
  await editor.focus();
  await editor.evaluate((el, index) => {
    el.setSelectionRange(index, index);
    el.dispatchEvent(new Event('select', { bubbles: true }));
    el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.62;
    el.dispatchEvent(new Event('scroll'));
  }, targetIndex);
  await previewPane.evaluate(el => {
    el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.43;
    el.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(150);
  const savedPosition = await page.evaluate(() => {
    const editor = document.querySelector('#writer-body');
    const preview = document.querySelector('.writer-preview-pane');
    return {
      selectionStart: editor.selectionStart,
      editorScrollTop: editor.scrollTop,
      previewScrollTop: preview.scrollTop,
      stored: Boolean(localStorage.getItem('matlock-writer:position:new'))
    };
  });
  expect(savedPosition.stored).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  if (await page.locator('[data-library-view]').isVisible()) await page.click('[data-library-new]');
  await expect(editor).toBeVisible();
  await expect.poll(async () => editor.evaluate(el => Math.abs(el.selectionStart - savedPosition.selectionStart))).toBeLessThanOrEqual(1);
  await expect.poll(async () => editor.evaluate(el => Math.abs(el.scrollTop - savedPosition.editorScrollTop))).toBeLessThan(6);
  await expect.poll(async () => previewPane.evaluate(el => Math.abs(el.scrollTop - savedPosition.previewScrollTop))).toBeLessThan(10);
  expect(await editor.evaluate(el => document.activeElement === el)).toBe(true);

  const moreAfterReload = page.locator('[data-writer-mode-more]');
  if (!(await moreAfterReload.evaluate(el => el.open))) await moreAfterReload.locator('summary').click();
  await expect(page.locator('button[data-writer-sync-scroll]')).toHaveCount(0);
  await expect(workspace).toHaveAttribute('data-view-mode', 'split');
  await expect(previewFrame).toHaveAttribute('data-preview-size', 'mobile');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(changedSplit));
  expect(await page.evaluate(() => localStorage.getItem('mma-writer-sync-scroll'))).toBeNull();
});
