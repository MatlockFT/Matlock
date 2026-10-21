const { test, expect } = require('@playwright/test');
const { startWriterFixture } = require('./writer-preview-fixture.cjs');
let fixture;
const tweet = '[EMBED X](https://x.com/MMAMatlock/status/2100109052697051428)';
test.beforeEach(async ({ page }) => {
  fixture = await startWriterFixture();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.href === 'https://platform.x.com/widgets.js') return route.fulfill({ contentType: 'text/javascript', body: `
      window.widgetMounts=0;window.frameLoads=0;
      window.twttr={widgets:{load(container){container.querySelectorAll('blockquote.twitter-tweet').forEach(quote=>{
        const frame=document.createElement('iframe'); frame.src='/__tweet?mount='+ ++window.widgetMounts;
        frame.style.cssText='height:210px;width:300px;border:0';frame.onload=()=>window.frameLoads++;
        quote.replaceWith(frame);
      });}}};` });
    return route.abort();
  });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(fixture.origin + '/write/');
  await page.locator('[data-library-new]').click();
});
test.afterEach(async () => fixture.close());

async function rememberFrames(page, count = 1) {
  await expect.poll(() => page.evaluate(() => window.frameLoads)).toBe(count);
  await page.evaluate(() => {
    window.savedFrames = [...document.querySelectorAll('[data-preview-content] iframe')].map(frame => ({ frame, token: frame.contentWindow.mountToken }));
    window.frameDetachments = 0;
    new MutationObserver(records => records.forEach(record => record.removedNodes.forEach(node => {
      if (window.savedFrames.some(({frame}) => node === frame || node.contains(frame))) window.frameDetachments++;
    }))).observe(document.querySelector('[data-preview-content]'), { childList: true, subtree: true });
  });
}
async function assertFrames(page, count = 1) {
  const result = await page.evaluate(() => ({
    unchanged: window.savedFrames.every(({frame,token}) => frame.isConnected && frame.contentWindow?.mountToken === token),
    mounts: window.widgetMounts, loads: window.frameLoads, detachments: window.frameDetachments
  }));
  expect(result).toEqual({ unchanged: true, mounts: count, loads: count, detachments: 0 });
}
async function typeAtMarker(page, marker, value) {
  // One rendering frame per real input event: a debounce cannot pass this assertion.
  for (const character of value) {
    const text = await page.locator('#writer-body').evaluate((editor, { marker, character }) => new Promise(resolve => {
      const position = editor.value.indexOf(marker);
      editor.setRangeText(character, position, position, 'end');
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: character }));
      requestAnimationFrame(() => resolve(document.querySelector('[data-preview-content]').textContent));
    }), { marker, character });
    expect(text).toContain(character + marker);
  }
}
for (const [name, body] of [
  ['standalone', 'Opening MARKER\n\n' + tweet + '\n\nEnding.'],
  ['same paragraph', tweet + ' MARKER'],
  ['list item', '- ' + tweet + ' MARKER'],
  ['blockquote', '> ' + tweet + '\n>\n> MARKER'],
  ['table cell', '| Post | Notes |\n| --- | --- |\n| ' + tweet + ' | MARKER |']
]) test(`${name}: typing updates next frame without reloading an embedded tweet`, async ({ page }) => {
  await page.locator('#writer-body').fill(body);
  await rememberFrames(page);
  await typeAtMarker(page, 'MARKER', 'A premium live preview ');
  await assertFrames(page);
});

test('removing a preceding paragraph and changing its formatting never detaches a following tweet', async ({ page }) => {
  const editor = page.locator('#writer-body');
  await editor.fill('Remove me.\n\n' + tweet + '\n\nStable ending.');
  await rememberFrames(page);
  await editor.fill('## New heading\n\n' + tweet + '\n\nStable ending.');
  await expect(page.locator('[data-preview-content] h2')).toHaveText('New heading');
  await assertFrames(page);
  await editor.fill(tweet + '\n\nStable ending.');
  await expect(page.locator('[data-preview-content] h2')).toHaveCount(0);
  await assertFrames(page);
});

test('duplicate tweets remain separate; changing a URL replaces only the changed embed', async ({ page }) => {
  const editor = page.locator('#writer-body');
  await editor.fill(tweet + '\n\nMARKER\n\n' + tweet);
  await rememberFrames(page, 2);
  await typeAtMarker(page, 'MARKER', 'Updated ');
  await assertFrames(page, 2);
  await editor.fill(tweet + '\n\nUpdated MARKER\n\n' + tweet.replace('2100109052697051428', '2100109052697051429'));
  await expect.poll(() => page.evaluate(() => window.widgetMounts)).toBe(3);
  expect(await page.evaluate(() => window.savedFrames[0].frame.isConnected && window.savedFrames[0].frame.contentWindow.mountToken === window.savedFrames[0].token)).toBe(true);
});

test('inserting and deleting list items preserves nested tweets and surrounding formatting', async ({ page }) => {
  const editor = page.locator('#writer-body');
  const body = '- First item.\n- ' + tweet + ' **Bold MARKER**\n- Last item.';
  await editor.fill(body);
  await rememberFrames(page);
  await typeAtMarker(page, 'MARKER', 'Instant ');
  const typed = await editor.inputValue();
  await editor.fill('- Inserted item.\n' + typed);
  await expect(page.locator('[data-preview-content] li')).toHaveCount(4);
  await assertFrames(page);
  await editor.fill(typed.replace('- First item.\n', ''));
  await expect(page.locator('[data-preview-content] li')).toHaveCount(2);
  await expect(page.locator('[data-preview-content] strong')).toHaveText('Bold Instant MARKER');
  await assertFrames(page);
});

test('text and formatting changes preserve a YouTube iframe; deleting it removes it', async ({ page }) => {
  await page.route('https://www.youtube.com/embed/**', route => route.fulfill({ contentType: 'text/html', body: '<body>Video</body>' }));
  const editor = page.locator('#writer-body');
  const video = '<iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>';
  await editor.fill('Opening MARKER\n\n' + video + '\n\nEnding.');
  await expect(page.locator('[data-preview-content] iframe')).toHaveCount(1);
  await page.evaluate(() => {
    window.videoFrame = document.querySelector('[data-preview-content] iframe');
    window.videoDetachments = 0;
    new MutationObserver(records => records.forEach(record => record.removedNodes.forEach(node => {
      if (node === window.videoFrame || node.contains(window.videoFrame)) window.videoDetachments++;
    }))).observe(document.querySelector('[data-preview-content]'), { childList:true, subtree:true });
  });
  await typeAtMarker(page, 'MARKER', 'Instant ');
  await editor.fill('## New heading\n\n' + video + '\n\nEnding.');
  await expect(page.locator('[data-preview-content] h2')).toHaveText('New heading');
  expect(await page.evaluate(() => window.videoFrame.isConnected && window.videoDetachments === 0)).toBe(true);
  await editor.fill('## New heading\n\nEnding.');
  await expect(page.locator('[data-preview-content] iframe')).toHaveCount(0);
});
