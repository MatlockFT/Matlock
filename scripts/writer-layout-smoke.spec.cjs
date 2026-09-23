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
  expect(box.width).toBeGreaterThanOrEqual(1798);
  expect(box.width).toBeLessThanOrEqual(1802);
  expect(1920 - box.width).toBeLessThanOrEqual(122);
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


test('Writer dropdowns and YouTube embeds keep their spacing at narrow desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await openWriter(page);

  const modeMore = page.locator('[data-writer-mode-more]');
  await modeMore.locator('summary').click();
  await expect(modeMore.locator('[data-writer-mode-more-panel]')).toBeVisible();
  expect(await page.locator('.writer-modebar').evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');
  await modeMore.locator('summary').click();

  const formatMore = page.locator('[data-writer-ux-more]');
  await expect(formatMore).toHaveCount(1);
  await formatMore.locator('summary').click();
  await expect(formatMore.locator('.writer-ux-more-panel')).toBeVisible();
  expect(await page.locator('.writer-toolbar').evaluate(el => getComputedStyle(el).overflowY)).toBe('visible');

  const editor = page.locator('#writer-body');
  await editor.fill('Paragraph before the video.\n<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ" title="YouTube video" allowfullscreen></iframe>\n\nParagraph after the video.');
  const embed = page.locator('[data-preview-content] .writer-embed');
  const iframe = embed.locator('iframe');
  await expect(iframe).toBeVisible();

  const spacing = await embed.evaluate(el => {
    const frame = el.querySelector('iframe');
    const wrap = getComputedStyle(el);
    const inner = getComputedStyle(frame);
    return {
      wrapTop: parseFloat(wrap.marginTop),
      wrapBottom: parseFloat(wrap.marginBottom),
      iframeTop: parseFloat(inner.marginTop),
      iframeBottom: parseFloat(inner.marginBottom)
    };
  });

  expect(spacing.wrapTop).toBeGreaterThan(0);
  expect(spacing.wrapBottom).toBeGreaterThan(spacing.wrapTop);
  expect(spacing.iframeTop).toBe(0);
  expect(spacing.iframeBottom).toBe(0);
});


test('Writer keeps embeds stable, quotes structured, and bitmap clipboard paste intentional', async ({ page }) => {
  await page.route('https://platform.x.com/widgets.js', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.twttr={widgets:{load:function(){}}};'
    });
  });

  await page.setViewportSize({ width: 1100, height: 900 });
  await openWriter(page);
  const editor = page.locator('#writer-body');

  // Quote is a real multi-paragraph block and toggles cleanly.
  await editor.fill('First quoted paragraph\n\nSecond quoted paragraph');
  await editor.evaluate(el => el.setSelectionRange(0, el.value.length));
  await page.click('[data-insert="quote"]');
  await expect(editor).toHaveValue('> First quoted paragraph\n>\n> Second quoted paragraph');
  await expect(page.locator('[data-preview-content] blockquote > p')).toHaveCount(2);
  await page.click('[data-insert="quote"]');
  await expect(editor).toHaveValue('First quoted paragraph\n\nSecond quoted paragraph');

  // YouTube stays the same iframe node when unrelated copy changes.
  await editor.fill('Copy before embed.');
  await editor.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await page.click('[data-tool="youtube"]');
  await page.fill('[data-youtube-url]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.fill('[data-youtube-title]', 'Stable YouTube');
  await page.click('[data-youtube-insert]');
  const frame = page.locator('[data-preview-content] .writer-embed iframe');
  await expect(frame).toBeVisible();
  await frame.evaluate(el => { el.dataset.keepNode = 'youtube'; });
  await editor.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await page.keyboard.type(' Copy after embed.');
  await page.waitForTimeout(180);
  await expect(page.locator('[data-preview-content] .writer-embed iframe')).toHaveAttribute('data-keep-node', 'youtube');

  // X preview wrapper is also preserved instead of being rebuilt on each keystroke.
  await page.click('[data-tool="x"]');
  await page.fill('[data-x-url]', 'https://x.com/MMAMatlock/status/2100109052697051428');
  await page.click('[data-x-insert]');
  const xEmbed = page.locator('[data-preview-content] .writer-x-embed');
  await expect(xEmbed).toBeVisible();
  await xEmbed.evaluate(el => { el.dataset.keepNode = 'x'; });
  await editor.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await page.keyboard.type(' More article copy.');
  await page.waitForTimeout(180);
  await expect(page.locator('[data-preview-content] .writer-x-embed')).toHaveAttribute('data-keep-node', 'x');

  // A bitmap clipboard image is claimed by the image workflow, not mangled into text.
  const beforePaste = await editor.inputValue();
  await editor.evaluate(el => {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Blob(['clipboard-image'], { type: 'image/png' })], 'image.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('[data-connect-dialog]')).toBeVisible();
  await expect(editor).toHaveValue(beforePaste);
});
