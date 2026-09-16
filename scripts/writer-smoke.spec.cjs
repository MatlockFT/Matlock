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

test('Writer production workflow survives long-form editing, restore, schedule and publish', async ({ page }) => {
  test.setTimeout(120000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  let remote = null;
  let shaCounter = 1;

  await page.route('https://mmamatlock-writer-auth.netlify.app/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/github/health')) {
      return route.fulfill({ status: 200, headers: { ...corsHeaders(), 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: true, configured: true }) });
    }
    return route.fulfill({ status: 401, headers: { ...corsHeaders(), 'access-control-allow-origin': '*' }, body: JSON.stringify({ ok: false }) });
  });

  await page.route('https://api.github.com/repos/MatlockFT/Matlock**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = corsHeaders();
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });

    const repoRoot = '/repos/MatlockFT/Matlock';
    if (url.pathname === repoRoot && method === 'GET') {
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ owner: { login: 'MatlockFT' }, name: 'Matlock' }) });
    }
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

  const date = await page.locator('[data-field="date"]').inputValue();
  const filename = `${date}-writer-production-smoke.md`;
  const longBody = Array.from({ length: 5200 }, (_, i) => `word${i}`).join(' ') + '\n\n## Closing section\n\nA final paragraph with a [valid source](https://example.com/source).';

  await page.fill('[data-field="title"]', 'Writer Production Smoke Test');
  await page.fill('[data-field="description"]', 'Production validation article for the MMA Matlock Writer workflow.');
  await page.fill('[data-field="category"]', 'Breakdown');
  await page.fill('[data-field="tags"]', 'Writer QA, Production Smoke');
  await page.fill('[data-field="filename"]', filename);
  await page.fill('#writer-body', longBody);

  await expect(page.locator('[data-save-state]')).toContainText('Unsaved');
  await expect(page.locator('[data-local-status]')).toContainText('Saved locally', { timeout: 5000 });

  await page.click('[data-tool="html"]');
  await page.fill('[data-html-label]', 'Smoke visual');
  await page.fill('[data-html-code]', '<section class="writer-smoke-visual"><style>.writer-smoke-visual{padding:12px}</style><h2>Smoke Visual</h2><p>Rendered HTML visual.</p></section>');
  await page.click('[data-html-insert]');
  await expect(page.locator('[data-html-block-rail]')).toBeVisible();
  await expect(page.locator('[data-html-block-card]')).toContainText('Smoke visual');
  await expect(page.locator('[data-preview-content]')).toContainText('Rendered HTML visual');
  await expect(page.locator('[data-local-status]')).toContainText('Saved locally', { timeout: 5000 });

  const splitter = page.locator('[data-writer-splitter]');
  await splitter.focus();
  const beforeSplit = Number(await splitter.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(beforeSplit + 2);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-editor-view]')).toBeVisible();
  await expect(page.locator('[data-field="title"]')).toHaveValue('Writer Production Smoke Test');
  await expect(page.locator('#writer-body')).toHaveValue(/Closing section/);
  await expect(page.locator('[data-html-block-rail]')).toBeVisible();

  await page.click('[data-github-connect]');
  const fallback = page.locator('.writer-token-fallback');
  await fallback.locator('summary').click();
  await page.fill('[data-github-token]', 'github_pat_writer_smoke_fake');
  await page.click('[data-github-authorize]');
  await expect(page.locator('[data-github-status]')).toContainText('Connected to MatlockFT/Matlock', { timeout: 10000 });

  await page.click('[data-save-draft]');
  await expect(page.locator('[data-save-state]')).toContainText('Saved', { timeout: 10000 });
  await expect.poll(() => Boolean(remote && /published:\s*false/.test(remote.text))).toBe(true);
  expect(remote.text).toContain('<section class="writer-smoke-visual">');
  expect(remote.text).not.toContain('[HTML VISUAL');

  await page.click('[data-show-library]');
  await expect(page.locator('[data-library-list]')).toContainText('Writer Production Smoke Test', { timeout: 10000 });
  await page.locator('[data-library-path]').filter({ hasText: 'Writer Production Smoke Test' }).locator('[data-library-edit]').click();
  await expect(page.locator('.writer-meta')).not.toHaveAttribute('open', '');
  await expect(page.locator('#writer-body')).toHaveValue(/Closing section/);

  await page.fill('[data-field="description"]', '');
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-dialog]')).toBeVisible();
  await expect(page.locator('[data-publish-check-list]')).toContainText('Description is empty');
  await expect(page.locator('[data-publish-check-proceed]')).toBeVisible();
  await page.locator('[data-publish-check-dialog] button[value="cancel"]').click();

  await page.fill('[data-field="description"]', 'Production validation article for the MMA Matlock Writer workflow.');
  const bodyWithVisual = await page.locator('#writer-body').inputValue();
  await page.fill('#writer-body', bodyWithVisual + '\n\n[Bad link](javascript:alert(1))');
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-list]')).toContainText('Unsafe or malformed link');
  await expect(page.locator('[data-publish-check-proceed]')).toBeHidden();
  await page.locator('[data-publish-check-dialog] button[value="cancel"]').click();
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

  expect(pageErrors).toEqual([]);
});
