const { test, expect } = require('@playwright/test');

const baseUrl = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';

test('Writer preview receives no script-driven scrollTop writes during per-keystroke live renders', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

  const app = page.locator('[data-writer-app]');
  await expect(app).toBeVisible();

  const library = page.locator('[data-library-view]');
  if (await library.isVisible()) await page.click('[data-library-new]');

  const editor = page.locator('#writer-body');
  const previewPane = page.locator('.writer-preview-pane');
  const splitButton = page.locator('[data-view="split"]');
  if (await splitButton.isVisible()) await splitButton.click();

  const body = [
    'Opening paragraph used to verify preview scrolling while text is edited above the viewport.',
    ...Array.from({ length: 48 }, (_, index) =>
      'Paragraph ' + (index + 1) + '. Stable filler keeps the preview tall enough to scroll while the editor remains focused.'
    ),
    'Final paragraph used to ensure the document has a full preview length.'
  ].join('\n\n');

  await editor.fill(body);
  await expect(previewPane).toBeVisible();
  await expect(page.locator('[data-preview-content]')).toContainText('Opening paragraph');
  await page.waitForTimeout(140);

  const previewRange = await previewPane.evaluate(el => {
    const max = el.scrollHeight - el.clientHeight;
    if (max < 300) throw new Error('Preview is not sufficiently scrollable for this test (max=' + max + ')');
    el.scrollTop = Math.round(max * 0.4);
    return { max, scrollTop: el.scrollTop };
  });
  expect(previewRange.scrollTop).toBeGreaterThan(50);

  await editor.evaluate(el => {
    el.focus({ preventScroll: true });
    el.setSelectionRange(0, 0);
  });

  await previewPane.evaluate(el => {
    let owner = el;
    let descriptor;
    while (owner && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(owner, 'scrollTop');
      owner = Object.getPrototypeOf(owner);
    }
    if (!descriptor?.get || !descriptor?.set) throw new Error('Could not instrument preview scrollTop.');

    window.__writerPreviewScrollAssignments = [];
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() { return descriptor.get.call(el); },
      set(value) {
        window.__writerPreviewScrollAssignments.push({
          value,
          before: descriptor.get.call(el)
        });
        descriptor.set.call(el, value);
      }
    });
  });

  // The pause exceeds the live-preview debounce, so this exercises repeated renders,
  // not a single batched update at the end of typing.
  await page.keyboard.type('Added words before the current preview viewport. '.repeat(2), { delay: 55 });
  await page.waitForTimeout(180);

  const result = await previewPane.evaluate(el => ({
    explicitWrites: window.__writerPreviewScrollAssignments,
    scrollTop: el.scrollTop,
    anchorEnabled: getComputedStyle(el).overflowAnchor
  }));
  expect(result.anchorEnabled).toBe('auto');
  expect(
    result.explicitWrites,
    'A live preview render must never assign preview.scrollTop; doing so can make it step down with each keystroke.'
  ).toEqual([]);
});
