const { test, expect } = require('@playwright/test');

const BASE = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';

function corsHeaders() {
  return {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'https://mmamatlock.com',
    'access-control-allow-methods': 'GET,PUT,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-github-api-version,accept'
  };
}

function decodeBase64(value) {
  return Buffer.from(String(value || ''), 'base64').toString('utf8');
}

function encodeBase64(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

test('Writer production workflow survives long-form editing, rich blocks, restore, schedule and publish', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  let remote = null;
  let shaCounter = 1;

  await page.route('https://platform.x.com/widgets.js', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: 'window.twttr={widgets:{load:function(){}}};'
    });
  });

  await page.route('https://mmamatlock-writer-auth.netlify.app/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/github/health')) {
      return route.fulfill({ status: 200, headers: { ...corsHeaders(), 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, configured: false }) });
    }
    return route.fulfill({ status: 401, headers: { ...corsHeaders(), 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false }) });
  });

  await page.route('https://api.github.com/repos/MatlockFT/Matlock', async route => {
    const method = route.request().method();
    const headers = corsHeaders();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (method === 'GET') return route.fulfill({ status: 200, headers, body: JSON.stringify({ owner: { login: 'MatlockFT' }, name: 'Matlock' }) });
    return route.fulfill({ status: 405, headers, body: JSON.stringify({ message: `Unhandled repo root method: ${method}` }) });
  });

  await page.route('https://api.github.com/repos/MatlockFT/Matlock/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = corsHeaders();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });

    const repoRoot = '/repos/MatlockFT/Matlock';
    if (url.pathname === `${repoRoot}/contents/_posts` && method === 'GET') {
      const list = remote ? [{ type: 'file', name: remote.name, path: remote.path, sha: remote.sha }] : [];
      return route.fulfill({ status: 200, headers, body: JSON.stringify(list) });
    }
    if (url.pathname.startsWith(`${repoRoot}/contents/_posts/`)) {
      const path = decodeURIComponent(url.pathname.slice(`${repoRoot}/contents/`.length));
      if (method === 'GET') {
        if (!remote || remote.path !== path) return route.fulfill({ status: 404, headers, body: JSON.stringify({ message: 'Not Found' }) });
        return route.fulfill({ status: 200, headers, body: JSON.stringify({ name: remote.name, path: remote.path, sha: remote.sha, content: encodeBase64(remote.text) }) });
      }
      if (method === 'PUT') {
        const payload = request.postDataJSON();
        const nextSha = `mocksha${shaCounter++}`;
        remote = { path, name: path.split('/').pop(), sha: nextSha, text: decodeBase64(payload.content) };
        return route.fulfill({ status: 200, headers, body: JSON.stringify({ content: { path, sha: nextSha }, commit: { sha: `commit${shaCounter}` } }) });
      }
    }
    if (url.pathname === `${repoRoot}/commits` && method === 'GET') return route.fulfill({ status: 200, headers, body: '[]' });
    return route.fulfill({ status: 404, headers, body: JSON.stringify({ message: `Unhandled mock route: ${method} ${url.pathname}` }) });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-writer-app]')).toBeVisible();
  await expect(page.locator('[data-library-view]')).toBeVisible();

  await page.click('[data-library-new]');
  await expect(page.locator('[data-editor-view]')).toBeVisible();
  await expect(page.locator('.writer-preview-article')).toHaveClass(/post-page-v3/);
  await expect(page.locator('.writer-preview-article')).toHaveAttribute('data-editorial-v3', '');
  expect(await page.locator('.writer-preview-article .post-breadcrumbs ol').evaluate(el => getComputedStyle(el).listStyleType)).toBe('none');

  const more = page.locator('[data-writer-mode-more]');
  await more.locator('summary').click();
  await expect(more.locator('[data-writer-mode-more-panel]')).toBeVisible();
  await more.locator('summary').click();

  const previewFrame = page.locator('[data-preview-frame]');
  await expect(previewFrame).toHaveAttribute('data-preview-theme', 'light');
  await page.click('[data-preview-theme-toggle]');
  await expect(previewFrame).toHaveAttribute('data-preview-theme', 'dark');
  expect(await previewFrame.evaluate(el => getComputedStyle(el).getPropertyValue('--v3-paper').trim())).toBe('#0b0b0b');
  await page.click('[data-preview-theme-toggle]');
  await expect(previewFrame).toHaveAttribute('data-preview-theme', 'light');

  const date = await page.locator('[data-field="date"]').inputValue();
  const filename = `${date}-writer-production-smoke.md`;
  const longBody = Array.from({ length: 5200 }, (_, i) => `word${i}`).join(' ') + '\n\n## Closing section\n\nA final paragraph with a [valid source](https://example.com/source).';

  await page.fill('[data-field="title"]', 'Writer Production Smoke Test');
  await page.fill('[data-field="description"]', 'Production validation article for the MMA Matlock Writer workflow.');
  await page.fill('[data-field="category"]', 'Breakdown');
  await page.fill('[data-field="tags"]', 'Writer QA, Production Smoke');
  const advancedDetails = page.locator('.writer-meta-advanced');
  if (!(await advancedDetails.evaluate(el => el.open))) await advancedDetails.locator('summary').click();
  await page.fill('[data-field="filename"]', filename);
  await page.fill('#writer-body', longBody);

  await expect(page.locator('[data-save-state]')).toContainText('Unsaved');
  await expect(page.locator('[data-local-status]')).toContainText('Saved locally', { timeout: 5000 });

  const editor = page.locator('#writer-body');
  await editor.evaluate(el => { el.focus(); el.setSelectionRange(250, 250); });
  await page.keyboard.type(' CURSOR_SENTINEL ');
  const cursorAfterTyping = await editor.evaluate(el => el.selectionStart);
  await page.waitForTimeout(700);
  expect(await editor.evaluate(el => el.selectionStart)).toBe(cursorAfterTyping);
  await expect(editor).toHaveValue(/CURSOR_SENTINEL/);

  await page.click('[data-tool="image"]');
  await page.fill('[data-inline-image-url]', 'https://example.com/writer-smoke.jpg');
  await page.fill('[data-inline-image-alt]', 'Writer smoke image');
  await page.fill('[data-inline-image-caption]', 'Writer smoke caption');
  await page.selectOption('[data-inline-image-flow]', 'wrap');
  await page.selectOption('[data-inline-image-align]', 'right');
  await page.selectOption('[data-inline-image-width]', 'medium');
  await page.click('[data-image-insert]');
  const placedImage = page.locator('[data-preview-content] .article-inline-image');
  await expect(placedImage).toHaveClass(/article-inline-image--wrap/);
  await expect(placedImage).toHaveClass(/article-inline-image--right/);
  await expect(placedImage).toHaveClass(/article-inline-image--medium/);
  await expect(placedImage.locator('img[alt="Writer smoke image"]')).toHaveAttribute('src', 'https://example.com/writer-smoke.jpg');
  await expect(placedImage.locator('figcaption')).toHaveText('Writer smoke caption');

  await page.click('[data-tool="youtube"]');
  await page.fill('[data-youtube-url]', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await page.fill('[data-youtube-title]', 'Writer smoke YouTube');
  await page.click('[data-youtube-insert]');
  await expect(page.locator('[data-preview-content] iframe')).toHaveAttribute('src', /youtube\.com\/embed\/dQw4w9WgXcQ/);

  await page.click('[data-tool="x"]');
  await page.fill('[data-x-url]', 'https://x.com/MMAMatlock/status/2100109052697051428?s=20');
  await page.click('[data-x-insert]');
  await expect(page.locator('#writer-body')).toHaveValue(/\[EMBED X\]\(https:\/\/x\.com\/MMAMatlock\/status\/2100109052697051428\)/);
  await expect(page.locator('[data-preview-content] blockquote.twitter-tweet a')).toHaveAttribute('href', 'https://x.com/MMAMatlock/status/2100109052697051428');

  await page.click('[data-tool="table"]');
  await page.fill('[data-table-headers]', 'Metric, Alpha, Beta');
  await page.fill('[data-table-rows]', 'Record\nReach');
  await page.click('[data-table-insert]');
  await expect(page.locator('[data-preview-content]')).toContainText('Metric');
  await expect(page.locator('[data-preview-content]')).toContainText('Reach');

  await page.click('[data-tool="tale"]');
  await page.fill('[data-tale-a]', 'Alpha Fighter');
  await page.fill('[data-tale-b]', 'Beta Fighter');
  await page.fill('[data-tale-row="record"][data-side="a"]', '10-1');
  await page.fill('[data-tale-row="record"][data-side="b"]', '9-2');
  await page.fill('[data-tale-row="reach"][data-side="a"]', '72 in');
  await page.fill('[data-tale-row="reach"][data-side="b"]', '70 in');
  await page.click('[data-tale-insert]');
  await expect(page.locator('[data-preview-content]')).toContainText('ALPHA FIGHTER');
  await expect(page.locator('[data-preview-content]')).toContainText('10-1');

  await page.click('[data-tool="html"]');
  await page.fill('[data-html-label]', 'Smoke visual');
  await page.fill('[data-html-code]', '<section class="writer-smoke-visual"><style>.writer-smoke-visual{padding:12px}</style><h2>Smoke Visual</h2><p>Rendered HTML visual.</p></section>');
  await page.click('[data-html-insert]');
  await expect(page.locator('[data-html-block-rail]')).toBeVisible();
  await expect(page.locator('[data-html-block-edit]')).toContainText('Smoke visual');
  await expect(page.locator('[data-preview-content]')).toContainText('Rendered HTML visual');
  await expect(page.locator('[data-local-status]')).toContainText('Saved locally', { timeout: 5000 });

  const previewContent = page.locator('[data-preview-content]');
  const desktopHtml = await previewContent.innerHTML();
  await page.click('[data-preview-size="mobile"]');
  await expect(page.locator('[data-preview-frame]')).toHaveAttribute('data-preview-size', 'mobile');
  expect(await previewContent.innerHTML()).toBe(desktopHtml);
  await page.click('[data-preview-size="desktop"]');
  await expect(page.locator('[data-preview-frame]')).toHaveAttribute('data-preview-size', 'desktop');
  expect(await previewContent.innerHTML()).toBe(desktopHtml);

  const splitter = page.locator('[data-writer-splitter]');
  await splitter.focus();
  const beforeSplit = Number(await splitter.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(beforeSplit + 2);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-editor-view]')).toBeVisible();
  await expect(page.locator('[data-field="title"]')).toHaveValue('Writer Production Smoke Test');
  await expect(page.locator('#writer-body')).toHaveValue(/Closing section/);
  await expect(page.locator('#writer-body')).toHaveValue(/Writer smoke image/);
  await expect(page.locator('#writer-body')).toHaveValue(/youtube\.com\/embed\/dQw4w9WgXcQ/);
  await expect(page.locator('#writer-body')).toHaveValue(/ALPHA FIGHTER/);
  await expect(page.locator('[data-html-block-rail]')).toBeVisible();
  await expect(page.locator('[data-preview-content] img[alt="Writer smoke image"]')).toBeVisible();
  await expect(page.locator('[data-preview-content] iframe')).toHaveAttribute('src', /youtube\.com\/embed\/dQw4w9WgXcQ/);

  await page.click('[data-github-connect]');
  const connectDialog = page.locator('[data-connect-dialog]');
  await expect(connectDialog).toBeVisible();
  await connectDialog.evaluate(dialog => {
    const fallback = dialog.querySelector('.writer-token-fallback');
    if (fallback) fallback.open = true;
  });
  await expect(page.locator('[data-github-token]')).toBeVisible();
  await page.fill('[data-github-token]', 'github_pat_writer_smoke_fake');
  await page.click('[data-github-authorize]');
  await expect(page.locator('[data-github-status]')).toContainText('Connected to MatlockFT/Matlock', { timeout: 10000 });

  if (!(await advancedDetails.evaluate(el => el.open))) await advancedDetails.locator('summary').click();
  const cleanFilename = await page.locator('[data-field="filename"]').inputValue();
  await page.fill('[data-field="filename"]', `${date}-draft.md`);
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-dialog]')).toBeVisible();
  await expect(page.locator('[data-publish-check-list]')).toContainText('Filename looks temporary');
  await expect(page.locator('[data-publish-check-list]')).toContainText('Unsaved local changes');
  await expect(page.locator('[data-publish-check-proceed]')).toBeVisible();
  await page.locator('[data-publish-check-dialog]').getByRole('button', { name: 'Back to editor' }).click();
  await page.fill('[data-field="filename"]', cleanFilename);

  await page.fill('[data-field="title"]', '');
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-dialog]')).toBeVisible();
  await expect(page.locator('[data-publish-check-list]')).toContainText('Title is missing');
  await expect(page.locator('[data-publish-check-proceed]')).toBeHidden();
  await page.locator('[data-publish-check-dialog]').getByRole('button', { name: 'Back to editor' }).click();
  await page.fill('[data-field="title"]', 'Writer Production Smoke Test');

  await page.click('[data-save-draft]');
  await expect(page.locator('[data-save-state]')).toContainText('Saved', { timeout: 10000 });
  await expect.poll(() => Boolean(remote && /published:\s*false/.test(remote.text))).toBe(true);
  expect(remote.text).toContain('<section class="writer-smoke-visual">');
  expect(remote.text).not.toContain('[HTML VISUAL');
  expect(remote.text).toContain('article-inline-image--wrap article-inline-image--right article-inline-image--medium');
  expect(remote.text).toContain('<img src="https://example.com/writer-smoke.jpg" alt="Writer smoke image" loading="lazy">');
  expect(remote.text).toContain('<figcaption>Writer smoke caption</figcaption>');
  expect(remote.text).toContain('youtube.com/embed/dQw4w9WgXcQ');
  expect(remote.text).toContain('| Metric | Alpha | Beta |');
  expect(remote.text).toContain('ALPHA FIGHTER');

  await page.click('[data-show-library]');
  await expect(page.locator('[data-library-list]')).toContainText('Writer Production Smoke Test', { timeout: 10000 });
  await page.locator('[data-library-path]').filter({ hasText: 'Writer Production Smoke Test' }).locator('[data-library-edit]').click();
  const articleDetails = page.locator('.writer-meta');
  await expect(articleDetails).not.toHaveAttribute('open', '');
  await expect(page.locator('#writer-body')).toHaveValue(/Closing section/);
  await expect(page.locator('#writer-body')).toHaveValue(/Writer smoke image/);
  await expect(page.locator('#writer-body')).toHaveValue(/ALPHA FIGHTER/);
  await expect(page.locator('[data-preview-content]')).toContainText('Rendered HTML visual');
  await articleDetails.locator('summary').click();
  await expect(articleDetails).toHaveAttribute('open', '');
  const advancedAfterLibrary = page.locator('.writer-meta-advanced');
  if (!(await advancedAfterLibrary.evaluate(el => el.open))) await advancedAfterLibrary.locator('summary').click();

  await page.fill('[data-field="description"]', '');
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-dialog]')).toBeVisible();
  await expect(page.locator('[data-publish-check-list]')).toContainText('Description is empty');
  await expect(page.locator('[data-publish-check-proceed]')).toBeVisible();
  await page.locator('[data-publish-check-dialog]').getByRole('button', { name: 'Back to editor' }).click();

  await page.fill('[data-field="description"]', 'Production validation article for the MMA Matlock Writer workflow.');
  const bodyWithVisual = await page.locator('#writer-body').inputValue();
  await page.fill('#writer-body', bodyWithVisual + '\n\n[Bad link](javascript:alert(1))');
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-list]')).toContainText('Unsafe or malformed link');
  await expect(page.locator('[data-publish-check-proceed]')).toBeHidden();
  await page.locator('[data-publish-check-dialog]').getByRole('button', { name: 'Back to editor' }).click();
  await page.fill('#writer-body', bodyWithVisual);

  const future = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const localFuture = new Date(future.getTime() - future.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await page.fill('[data-field="publishAt"]', localFuture);
  await page.click('[data-schedule]');
  await expect(page.locator('[data-save-state]')).toContainText('Scheduled', { timeout: 10000 });
  await expect.poll(() => Boolean(remote && /publish_at:\s*/.test(remote.text) && /published:\s*false/.test(remote.text))).toBe(true);

  await page.fill('[data-field="publishAt"]', '');
  await page.click('[data-save-draft]');
  await expect(page.locator('[data-save-state]')).toContainText('Saved', { timeout: 10000 });
  await expect.poll(() => Boolean(remote && !/publish_at:\s*['\"]?\d/.test(remote.text))).toBe(true);

  await page.click('[data-publish]');
  await expect(page.locator('[data-save-state]')).toContainText('Published', { timeout: 10000 });
  await expect.poll(() => Boolean(remote && /published:\s*true/.test(remote.text))).toBe(true);
  expect(remote.text).toContain('Writer Production Smoke Test');
  expect(remote.text).toContain('Rendered HTML visual.');
  expect(remote.text).toContain('Writer smoke image');
  expect(remote.text).toContain('dQw4w9WgXcQ');
  expect(remote.text).toContain('ALPHA FIGHTER');

  expect(pageErrors).toEqual([]);
});
