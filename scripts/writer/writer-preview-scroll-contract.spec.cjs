const { test, expect } = require('@playwright/test');

const baseUrl = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';

test('Writer preview holds its reading position during immediate typing and structural updates', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const app = page.locator('[data-writer-app]');
  await expect(app).toBeVisible();
  if (await page.locator('[data-library-view]').isVisible()) {
    await page.locator('[data-library-new]').click();
  }
  const editor = page.locator('#writer-body');
  const previewPane = page.locator('.writer-preview-pane');
  const previewContent = page.locator('[data-preview-content]');
  await page.locator('[data-view="split"]').click();

  const paragraphs = Array.from({ length: 65 }, (_, index) =>
    'Paragraph ' + (index + 1) + '. This unique paragraph must retain its DOM node while earlier text changes. ' +
    'The article preview is an independent reading pane.');
  await editor.fill(['Opening paragraph.', ...paragraphs, 'Final paragraph.'].join('\n\n'));
  await expect(previewContent).toContainText('Paragraph 65');
  await previewPane.evaluate(el => {
    el.scrollTop = Math.round((el.scrollHeight - el.clientHeight) * 0.45);
  });

  const before = await page.evaluate(() => {
    const pane = document.querySelector('.writer-preview-pane');
    const content = document.querySelector('[data-preview-content]');
    const paneRect = pane.getBoundingClientRect();
    const anchor = [...content.children].find(node => {
      const rect = node.getBoundingClientRect();
      return rect.top > paneRect.top + 25 && rect.bottom < paneRect.bottom - 20;
    });
    if (!anchor) throw new Error('No fully visible preview anchor.');
    window.__writerTestAnchor = anchor;
    window.__writerTestAnchorText = anchor.textContent;
    const owner = pane;
    let proto = owner;
    let descriptor;
    while (proto && !descriptor) {
      descriptor = Object.getOwnPropertyDescriptor(proto, 'scrollTop');
      proto = Object.getPrototypeOf(proto);
    }
    if (!descriptor?.get || !descriptor?.set) throw new Error('Cannot spy on preview scrollTop.');
    window.__writerPreviewScrollAssignments = [];
    Object.defineProperty(owner, 'scrollTop', {
      configurable: true,
      get() { return descriptor.get.call(owner); },
      set(value) {
        window.__writerPreviewScrollAssignments.push(value);
        descriptor.set.call(owner, value);
      }
    });
    const offset = anchor.getBoundingClientRect().top - paneRect.top;
    const original = content.innerHTML;
    return { offset, scrollTop: pane.scrollTop, original };
  });

  await editor.evaluate(el => {
    el.focus({ preventScroll: true });
    el.setSelectionRange(0, 0);
  });

  // The immediate preview must update while typing and never remove
  // the paragraph DOM just to change its text.
  await previewContent.evaluate(el => {
    window.__writerPreviewTopLevelMutations = [];
    new MutationObserver(records => {
      records.forEach(record => {
        if (record.type === 'childList') window.__writerPreviewTopLevelMutations.push(record.removedNodes.length + record.addedNodes.length);
      });
    }).observe(el, { childList: true });
  });
  await page.keyboard.type('F');
  await expect.poll(
    () => previewContent.locator('p').first().textContent(),
    { timeout: 350, message: 'immediate preview after the first keystroke' }
  ).toContain('FOpening paragraph.');
  await page.keyboard.type('irst burst second burst ', { delay: 25 });
  await expect(previewContent.locator('p').first()).toContainText('First burst second burst Opening paragraph.', { timeout: 350 });
  const typing = await page.evaluate(() => {
    const pane = document.querySelector('.writer-preview-pane');
    return {
      offset: window.__writerTestAnchor.getBoundingClientRect().top - pane.getBoundingClientRect().top,
      topLevelMutations: window.__writerPreviewTopLevelMutations
    };
  });
  expect(typing.topLevelMutations, 'typing must not remove or reinsert article blocks').toEqual([]);
  expect(Math.abs(typing.offset - before.offset), 'visual anchor drift during typing').toBeLessThan(2);

  const afterFirst = await page.evaluate(() => {
    const pane = document.querySelector('.writer-preview-pane');
    const node = window.__writerTestAnchor;
    return {
      connected: node.isConnected,
      text: node.textContent,
      offset: node.getBoundingClientRect().top - pane.getBoundingClientRect().top,
      explicitWrites: window.__writerPreviewScrollAssignments,
      anchoring: getComputedStyle(pane).overflowAnchor,
      gutter: getComputedStyle(pane).scrollbarGutter
    };
  });
  expect(afterFirst.connected).toBe(true);
  expect(afterFirst.text).toBe(await page.evaluate(() => window.__writerTestAnchorText));
  expect(Math.abs(afterFirst.offset - before.offset), 'visual anchor drift after idle update').toBeLessThan(3);
  expect(afterFirst.explicitWrites).toEqual([]);
  expect(afterFirst.anchoring).toBe('auto');
  expect(afterFirst.gutter).toContain('stable');

  // Adding a new paragraph above the viewport must keep the original
  // visible paragraph element, rather than reusing its index for new text.
  await editor.evaluate(el => {
    el.value = 'A new introduction placed above the viewport. '.repeat(30) + '\n\n' + el.value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect(previewContent.locator('p').first()).toContainText('A new introduction', { timeout: 6000 });
  const afterInsert = await page.evaluate(() => {
    const pane = document.querySelector('.writer-preview-pane');
    const node = window.__writerTestAnchor;
    return {
      connected: node.isConnected,
      text: node.textContent,
      offset: node.getBoundingClientRect().top - pane.getBoundingClientRect().top,
      explicitWrites: window.__writerPreviewScrollAssignments
    };
  });
  expect(afterInsert.connected).toBe(true);
  expect(afterInsert.text).toBe(afterFirst.text);
  expect(Math.abs(afterInsert.offset - before.offset), 'visual anchor drift after paragraph insertion').toBeLessThan(3);
  expect(afterInsert.explicitWrites).toEqual([]);
});
