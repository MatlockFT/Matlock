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
  await expect(page.locator('[data-wordtool="undo"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="redo"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="h3"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="bullets"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="numbers"]')).toBeVisible();
  await expect(page.locator('[data-wordtool="find"]')).toBeVisible();

  await editor.fill('Section one\n\nBody paragraph\n\nFirst item\nSecond item');
  await editor.evaluate(el => el.setSelectionRange(0, 'Section one'.length));
  await page.click('[data-wordtool="h3"]');
  await expect(editor).toHaveValue(/^### Section one/m);

  const bodyValue = await editor.inputValue();
  const bodyStart = bodyValue.indexOf('Body paragraph');
  await editor.evaluate((el, start) => el.setSelectionRange(start, start + 'Body paragraph'.length), bodyStart);
  await page.click('[data-wordtool="strike"]');
  await expect(editor).toHaveValue(/~~Body paragraph~~/);
  await expect(page.locator('[data-wordtools-selection-stat]')).toBeVisible();
  await expect(page.locator('[data-wordtools-selection-stat]')).toContainText('2 words');

  const listValue = await editor.inputValue();
  const listStart = listValue.indexOf('First item');
  await editor.evaluate((el, start) => el.setSelectionRange(start, el.value.length), listStart);
  await page.click('[data-wordtool="bullets"]');
  await expect(editor).toHaveValue(/- First item\n- Second item/);
  await page.click('[data-wordtool="numbers"]');
  await expect(editor).toHaveValue(/1\. First item\n2\. Second item/);

  await page.click('[data-wordtool="outline"]');
  await expect(page.locator('[data-wordtools-outline]')).toBeVisible();
  await expect(page.locator('[data-wordtools-outline-list]')).toContainText('Section one');
  await page.locator('.writer-wordtools-outline-item').filter({ hasText: 'Section one' }).click();
  await expect.poll(async () => editor.evaluate(el => el.selectionStart)).toBe(0);

  await editor.fill('Alpha fighter opens. Alpha fighter closes.');
  await page.click('[data-wordtool="find"]');
  const findDialog = page.locator('[data-wordtools-find-dialog]');
  await expect(findDialog).toBeVisible();
  await page.fill('[data-wordtools-find]', 'Alpha fighter');
  await page.fill('[data-wordtools-replace]', 'Beta fighter');
  await page.click('[data-wordtools-replace-all]');
  await expect(editor).toHaveValue('Beta fighter opens. Beta fighter closes.');
  await expect(page.locator('[data-wordtools-find-status]')).toContainText('Replaced 2 matches');
  await findDialog.locator('.writer-dialog-actions button[value="cancel"]').click();

  await page.click('[data-wordtool="undo"]');
  await expect(editor).toHaveValue('Alpha fighter opens. Alpha fighter closes.');
  await page.click('[data-wordtool="redo"]');
  await expect(editor).toHaveValue('Beta fighter opens. Beta fighter closes.');

  await editor.fill('');
  await editor.focus();
  await editor.evaluate(el => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'Bold text\nItem one\nItem two');
    transfer.setData('text/html', '<p><strong>Bold text</strong></p><ul><li>Item one</li><li>Item two</li></ul>');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  });
  await expect(editor).toHaveValue(/\*\*Bold text\*\*/);
  await expect(editor).toHaveValue(/- Item one\n- Item two/);

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
