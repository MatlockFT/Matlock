const { test, expect } = require('@playwright/test');

const baseUrl = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';

test('Writer word processor tools work in production', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('dialog', dialog => dialog.accept());

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const library = page.locator('[data-library-view]');
  if (await library.isVisible()) await page.click('[data-library-new]');

  const editor = page.locator('#writer-body');
  await expect(editor).toBeVisible();

  // Browser-native basics stay out of the toolbar.
  await expect(page.locator('[data-wordtool="undo"]')).toHaveCount(0);
  await expect(page.locator('[data-wordtool="redo"]')).toHaveCount(0);
  await expect(page.locator('[data-wordtool="h3"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="bullets"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="numbers"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="indent"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="outdent"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="clear"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="move-up"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="move-down"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="find"]')).toHaveText('Replace');

  await editor.fill('Section one\n\nBody paragraph\n\nFirst item\nSecond item');
  await editor.evaluate(el => el.setSelectionRange(0, 'Section one'.length));
  await page.click('[data-wordtool="h3"]');
  await expect(editor).toHaveValue(/^### Section one/m);

  const bodyValue = await editor.inputValue();
  const bodyStart = bodyValue.indexOf('Body paragraph');
  await editor.evaluate((el, start) => el.setSelectionRange(start, start + 'Body paragraph'.length), bodyStart);
  await page.click('[data-wordtool="strike"]');
  await expect(editor).toHaveValue(/~~Body paragraph~~/);
  await expect(page.locator('[data-wordtools-selection-stat]')).toContainText('2 words');

  const listValue = await editor.inputValue();
  const listStart = listValue.indexOf('First item');
  await editor.evaluate((el, start) => el.setSelectionRange(start, el.value.length), listStart);
  await page.click('[data-wordtool="bullets"]');
  await expect(editor).toHaveValue(/- First item\n- Second item/);
  await page.click('[data-wordtool="indent"]');
  await expect(editor).toHaveValue(/  - First item\n  - Second item/);
  await page.click('[data-wordtool="outdent"]');
  await expect(editor).toHaveValue(/- First item\n- Second item/);
  await page.click('[data-wordtool="numbers"]');
  await expect(editor).toHaveValue(/1\. First item\n2\. Second item/);

  // Tab/Shift+Tab are Markdown-aware only when the caret is in a list/quote.
  const numbered = await editor.inputValue();
  const firstNumbered = numbered.indexOf('1. First item');
  await editor.evaluate((el, pos) => el.setSelectionRange(pos, pos), firstNumbered);
  await editor.focus();
  await page.keyboard.press('Tab');
  await expect(editor).toHaveValue(/  1\. First item/);
  await page.keyboard.press('Shift+Tab');
  await expect(editor).toHaveValue(/1\. First item/);

  // Outline shows hierarchy and tracks the current section.
  await editor.fill('## Main section\nLead\n\n### Child section\nChild copy\n\n## Final section\nEnd');
  await page.click('[data-wordtool="outline"]');
  await expect(page.locator('[data-wordtools-outline]')).toBeVisible();
  await expect(page.locator('[data-wordtools-outline-list]')).toContainText('Main section');
  await expect(page.locator('.writer-wordtools-outline-item.level-3')).toContainText('Child section');
  await page.locator('.writer-wordtools-outline-item').filter({ hasText: 'Child section' }).click();
  await expect(page.locator('.writer-wordtools-outline-item').filter({ hasText: 'Child section' })).toHaveAttribute('aria-current', 'location');

  // Paragraph movement works from both buttons and the keyboard shortcut.
  await editor.fill('Alpha paragraph\n\nBeta paragraph\n\nGamma paragraph');
  let value = await editor.inputValue();
  let beta = value.indexOf('Beta paragraph');
  await editor.evaluate((el, pos) => el.setSelectionRange(pos, pos), beta);
  await page.click('[data-wordtool="move-up"]');
  await expect(editor).toHaveValue(/^Beta paragraph\n\nAlpha paragraph\n\nGamma paragraph$/);
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(editor).toHaveValue(/^Alpha paragraph\n\nBeta paragraph\n\nGamma paragraph$/);

  // Clear formatting removes Markdown but preserves the text.
  await editor.fill('## **Bold heading**\n\n> [Linked words](https://example.com)');
  await editor.evaluate(el => el.setSelectionRange(0, el.value.length));
  await page.click('[data-wordtool="clear"]');
  await expect(editor).toHaveValue('Bold heading\n\nLinked words');

  // Ctrl/Cmd+F is left to the browser; Ctrl/Cmd+H opens Writer Find & Replace.
  const ctrlFPrevented = await page.evaluate(() => {
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
    return !window.dispatchEvent(event);
  });
  expect(ctrlFPrevented).toBe(false);

  await editor.fill('Alpha fighter opens. Alpha fighter closes.');
  await editor.focus();
  await page.keyboard.press('Control+H');
  const findDialog = page.locator('[data-wordtools-find-dialog]');
  await expect(findDialog).toBeVisible();
  await page.fill('[data-wordtools-find]', 'Alpha fighter');
  await page.fill('[data-wordtools-replace]', 'Beta fighter');
  await page.click('[data-wordtools-replace-all]');
  await expect(editor).toHaveValue('Beta fighter opens. Beta fighter closes.');
  await expect(page.locator('[data-wordtools-find-status]')).toContainText('Replaced 2 matches');
  await findDialog.locator('.writer-dialog-actions button[value="cancel"]').click();

  // Hidden Writer history still makes transformations undoable by the normal shortcut.
  await editor.focus();
  await page.keyboard.press('Control+Z');
  await expect(editor).toHaveValue('Alpha fighter opens. Alpha fighter closes.');
  await page.keyboard.press('Control+Shift+Z');
  await expect(editor).toHaveValue('Beta fighter opens. Beta fighter closes.');

  // Smart Paste converts formatting, Unicode bullets, figures/captions and strips unsafe embeds.
  await editor.fill('');
  await editor.focus();
  await editor.evaluate(el => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'Bold text\n• Item one\n• Item two');
    transfer.setData('text/html', '<p><strong>Bold text</strong></p><ul><li>Item one</li><li>Item two</li></ul><figure><img src="https://example.com/test.jpg" alt="Test image"><figcaption>Photo caption</figcaption></figure><iframe src="https://evil.example"></iframe>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(editor).toHaveValue(/\*\*Bold text\*\*/);
  await expect(editor).toHaveValue(/- Item one\n- Item two/);
  await expect(editor).toHaveValue(/!\[Test image\]\(https:\/\/example\.com\/test\.jpg\)/);
  await expect(editor).toHaveValue(/\*Photo caption\*/);
  await expect(editor).not.toHaveValue(/evil\.example/);

  await page.click('[data-wordtool="focus"]');
  await expect(page.locator('[data-writer-app]')).toHaveClass(/writer-wordtools-focus/);
  await expect(page.locator('[data-preview-frame]')).not.toBeVisible();
  await page.click('[data-wordtool="focus"]');
  await expect(page.locator('[data-writer-app]')).not.toHaveClass(/writer-wordtools-focus/);

  await page.click('[data-wordtool="fullscreen"]');
  await expect(page.locator('body')).toHaveClass(/writer-wordtools-fullscreen/);
  await page.click('[data-wordtool="fullscreen"]');
  await expect(page.locator('body')).not.toHaveClass(/writer-wordtools-fullscreen/);

  expect(pageErrors).toEqual([]);
});
