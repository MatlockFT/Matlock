const { test, expect } = require('@playwright/test');

const baseUrl = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';

async function openArticleEditor(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const library = page.locator('[data-library-view]');
  if (await library.isVisible()) await page.click('[data-library-new]');
  const editor = page.locator('#writer-body');
  await expect(editor).toBeVisible();
  await expect(page.locator('[data-wordtool="h3"]')).toBeVisible();
  return editor;
}

async function openMore(page) {
  const more = page.locator('[data-writer-ux-more]');
  await expect(more).toHaveCount(1);
  const isOpen = await more.evaluate(element => element.open);
  if (!isOpen) await more.locator('summary').click();
  await expect(more.locator('.writer-ux-more-panel')).toBeVisible();
}

async function openModeMore(page) {
  const more = page.locator('[data-writer-mode-more]');
  await expect(more).toHaveCount(1);
  if (!(await more.evaluate(el => el.open))) await more.locator('summary').click();
  await expect(more.locator('[data-writer-mode-more-panel]')).toBeVisible();
}

async function setCaret(editor, pos) {
  await editor.evaluate((el, position) => {
    el.focus();
    el.setSelectionRange(position, position);
    el.dispatchEvent(new Event('select', { bubbles: true }));
  }, pos);
}

test('Writer word processor tools work in production', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));
  page.on('dialog', dialog => dialog.accept());

  const editor = await openArticleEditor(page);
  await openModeMore(page);

  // Browser-native basics stay out of the toolbar.
  await expect(page.locator('[data-wordtool="undo"]')).toHaveCount(0);
  await expect(page.locator('[data-wordtool="redo"]')).toHaveCount(0);
  await expect(page.locator('[data-wordtool="h3"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="bullets"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="numbers"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="indent"]')).toHaveCount(1);
  await expect(page.locator('[data-wordtool="outdent"]')).toHaveCount(1);
  await expect(page.locator('[data-wordtool="clear"]')).toHaveCount(1);
  await expect(page.locator('[data-wordtool="move-up"]')).toHaveCount(1);
  await expect(page.locator('[data-wordtool="move-down"]')).toHaveCount(1);
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

  await openMore(page);
  await page.click('[data-wordtool="indent"]');
  await expect(editor).toHaveValue(/  - First item\n  - Second item/);
  await page.click('[data-wordtool="outdent"]');
  await expect(editor).toHaveValue(/- First item\n- Second item/);
  const bulleted = await editor.inputValue();
  const bulletStart = bulleted.indexOf('- First item');
  const bulletEnd = bulleted.indexOf('- Second item') + '- Second item'.length;
  await editor.evaluate((el, range) => {
    el.focus();
    el.setSelectionRange(range.start, range.end);
  }, { start: bulletStart, end: bulletEnd });
  await page.click('[data-wordtool="numbers"]');
  await expect(editor).toHaveValue(/1\. First item\n2\. Second item/);

  // Tab/Shift+Tab are Markdown-aware only when the caret is in a list/quote.
  const numbered = await editor.inputValue();
  const firstNumbered = numbered.indexOf('1. First item');
  await setCaret(editor, firstNumbered);
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

  // Paragraph movement works from both the More menu and the keyboard shortcut.
  await editor.fill('Alpha paragraph\n\nBeta paragraph\n\nGamma paragraph');
  let value = await editor.inputValue();
  let beta = value.indexOf('Beta paragraph');
  await setCaret(editor, beta);
  await openMore(page);
  await page.click('[data-wordtool="move-up"]');
  await expect(editor).toHaveValue(/^Beta paragraph\n\nAlpha paragraph\n\nGamma paragraph$/);
  await editor.focus();
  await page.keyboard.press('Alt+Shift+ArrowDown');
  await expect(editor).toHaveValue(/^Alpha paragraph\n\nBeta paragraph\n\nGamma paragraph$/);

  // Clear formatting removes Markdown without collapsing paragraph spacing.
  await editor.fill('## **Bold heading**\n\n> [Linked words](https://example.com)');
  await editor.evaluate(el => el.setSelectionRange(0, el.value.length));
  await openMore(page);
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

  // Bitmap clipboard paste is intercepted cleanly instead of falling through as text/HTML.
  await editor.fill('Clipboard image anchor');
  await editor.focus();
  await editor.evaluate(el => {
    el.setSelectionRange(el.value.length, el.value.length);
    const transfer = new DataTransfer();
    const file = new File([new Blob(['clipboard-image'], { type: 'image/png' })], 'image.png', { type: 'image/png' });
    transfer.items.add(file);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('[data-connect-dialog]')).toBeVisible();
  await expect(editor).toHaveValue('Clipboard image anchor');
  await page.locator('[data-connect-dialog] .writer-dialog-close').click();
  await expect(page.locator('[data-connect-dialog]')).not.toBeVisible();

  // YouTube preview keeps the same iframe node while unrelated text is typed.
  await page.click('[data-tool="youtube"]');
  await page.fill('[data-youtube-url]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.fill('[data-youtube-title]', 'Stable preview test');
  await page.click('[data-youtube-insert]');
  const stableFrame = page.locator('[data-preview-content] .writer-embed iframe');
  await expect(stableFrame).toBeVisible();
  await stableFrame.evaluate(el => { el.dataset.previewNodeSentinel = 'keep'; });
  await editor.evaluate(el => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
  await page.keyboard.type(' More copy after the embed.');
  await page.waitForTimeout(180);
  await expect(page.locator('[data-preview-content] .writer-embed iframe')).toHaveAttribute('data-preview-node-sentinel', 'keep');

  // Smart Paste converts formatting, Unicode bullets, figures/captions and strips unsafe embeds.
  await editor.fill('');
  await editor.focus();
  await editor.evaluate(el => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'Bold text\n• Item one\n• Item two');
    transfer.setData('text/html', '<p><strong>Bold text</strong></p><blockquote><p>Pasted quote one</p><p>Pasted quote two</p></blockquote><ul><li>Item one</li><li>Item two</li></ul><figure><img src="https://example.com/test.jpg" alt="Test image"><figcaption>Photo caption</figcaption></figure><iframe src="https://evil.example"></iframe>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(editor).toHaveValue(/\*\*Bold text\*\*/);
  await expect(editor).toHaveValue(/> Pasted quote one\n>\s*\n> Pasted quote two/);

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

test('Writer usability layer keeps long-form editing compact and predictable', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  const editor = await openArticleEditor(page);
  const app = page.locator('[data-writer-app]');
  await openModeMore(page);

  // Low-frequency actions live behind one compact More control.
  await expect(page.locator('[data-writer-ux-more]')).toHaveCount(1);
  await expect(page.locator('[data-wordtool="clear"]')).not.toBeVisible();
  await openMore(page);
  await expect(page.locator('[data-wordtool="clear"]')).toBeVisible();

  // Reading width is explicit and persists as UI state.
  await page.click('[data-writer-ux-width="wide"]');
  await expect(app).toHaveAttribute('data-writer-ux-width', 'wide');
  expect(await page.evaluate(() => localStorage.getItem('mma-writer-reading-width'))).toBe('wide');
  await page.click('[data-writer-ux-width="normal"]');
  await expect(app).toHaveAttribute('data-writer-ux-width', 'normal');

  // The toolbar reflects the Markdown structure under the caret.
  await editor.fill('## Main heading\n\n- List item\n\n**Bold text** and [linked words](https://example.com)');
  let text = await editor.inputValue();

  await setCaret(editor, text.indexOf('Main heading') + 2);
  await expect(page.locator('[data-insert="h2"]')).toHaveAttribute('aria-pressed', 'true');

  await setCaret(editor, text.indexOf('List item') + 2);
  await expect(page.locator('[data-wordtool="bullets"]')).toHaveAttribute('aria-pressed', 'true');

  await setCaret(editor, text.indexOf('Bold text') + 2);
  await expect(page.locator('[data-insert="bold"]')).toHaveAttribute('aria-pressed', 'true');

  await setCaret(editor, text.indexOf('linked words') + 2);
  await expect(page.locator('[data-tool="link"]')).toHaveAttribute('aria-pressed', 'true');

  // Quote button handles multi-paragraph selections, preserves paragraph breaks, and toggles back off.
  await editor.fill('First quoted paragraph\n\nSecond quoted paragraph');
  await editor.evaluate(el => el.setSelectionRange(0, el.value.length));
  await page.click('[data-insert="quote"]');
  await expect(editor).toHaveValue('> First quoted paragraph\n>\n> Second quoted paragraph');
  await expect(page.locator('[data-preview-content] blockquote > p')).toHaveCount(2);
  await expect(page.locator('[data-preview-content] blockquote > p').nth(0)).toHaveText('First quoted paragraph');
  await expect(page.locator('[data-preview-content] blockquote > p').nth(1)).toHaveText('Second quoted paragraph');
  await page.click('[data-insert="quote"]');
  await expect(editor).toHaveValue('First quoted paragraph\n\nSecond quoted paragraph');

  // Enter continues bullets, numbers and quotes; Enter on an empty item exits the block.
  await editor.fill('- One');
  await editor.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('- One\n- ');
  await page.keyboard.type('Two');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('- One\n- Two\n- ');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain');
  await expect(editor).toHaveValue('- One\n- Two\nPlain');

  await editor.fill('3. Three');
  await editor.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('3. Three\n4. ');

  await editor.fill('> Quote');
  await editor.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('> Quote\n> ');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('> Quote\n');

  // Slash commands surface existing insert tools instead of adding more toolbar buttons.
  await editor.fill('/tab');
  await editor.focus();
  await expect(page.locator('[data-writer-ux-slash-menu]')).toBeVisible();
  await expect(page.locator('[data-writer-ux-slash-menu]')).toContainText('Table');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('');
  const tableDialog = page.locator('[data-table-dialog]');
  await expect(tableDialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(tableDialog).not.toBeVisible();

  // Outline openness is remembered and the rail remains the same H2/H3 navigator.
  await editor.fill('## One\nText\n\n### Two\nText');
  const outline = page.locator('[data-wordtools-outline]');
  if (!(await outline.isVisible())) await page.click('[data-wordtool="outline"]');
  await expect(outline).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('mma-writer-outline-open'))).toBe('1');
  await expect(outline).toHaveClass(/writer-ux-outline-rail/);
  await expect(outline.locator('.writer-wordtools-outline-item.level-3')).toContainText('Two');

  expect(pageErrors).toEqual([]);
});
