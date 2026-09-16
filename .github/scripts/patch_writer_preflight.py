from pathlib import Path

# ---------- write.html ----------
path = Path('write.html')
text = path.read_text()
anchor = '  <div class="writer-toast" data-toast role="status" aria-live="polite" hidden></div>'
if anchor not in text:
    raise SystemExit('toast anchor not found')
preflight_dialog = '''  <dialog class="writer-dialog writer-publish-check-dialog" data-publish-check-dialog>
    <form method="dialog">
      <header><div><p class="eyebrow">Publish safety check</p><h2>Before you publish</h2></div><button class="writer-dialog-close" value="cancel" aria-label="Close">×</button></header>
      <div class="writer-dialog-body">
        <div class="writer-publish-check-summary" data-publish-check-summary></div>
        <div class="writer-publish-check-list" data-publish-check-list></div>
      </div>
      <footer class="writer-dialog-actions">
        <button class="writer-button writer-button-subtle" value="cancel">Back to editor</button>
        <button class="writer-button writer-button-primary" type="button" data-publish-check-proceed>Publish anyway</button>
      </footer>
    </form>
  </dialog>

'''
text = text.replace(anchor, preflight_dialog + anchor, 1)
path.write_text(text)

# ---------- writer.js ----------
path = Path('assets/writer.js')
text = path.read_text()

old = "  const splitter = app.querySelector('[data-writer-splitter]');\n"
new = old + "  const publishCheckDialog = app.querySelector('[data-publish-check-dialog]');\n  const publishCheckSummary = app.querySelector('[data-publish-check-summary]');\n  const publishCheckList = app.querySelector('[data-publish-check-list]');\n  const publishCheckProceed = app.querySelector('[data-publish-check-proceed]');\n"
if old not in text:
    raise SystemExit('publish check DOM insertion point not found')
text = text.replace(old, new, 1)

marker = "  function validateForSave(mode) {"
if marker not in text:
    raise SystemExit('validateForSave marker not found')
helpers = r'''  function isAllowedPublishUrl(value) {
    const url = String(value || '').trim();
    if (!url) return false;
    if (/^(\/|#|mailto:)/i.test(url)) return true;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch { return false; }
  }

  function collectPublishChecks() {
    const issues = [];
    const body = bodyEditor.value || '';
    const expandedBody = expandHtmlBlocks(body);
    const description = fields.description.value.trim();
    const filename = fields.filename.value.trim();
    const articleDate = fields.date.value;

    const add = (level, title, detail = '') => issues.push({ level, title, detail });

    if (!description) add('warning', 'Description is empty', 'The article can publish, but its listing and social summary will have no description.');
    if (!expandedBody.trim()) add('warning', 'Article body is empty', 'There is no article content below the front matter.');
    if (fields.imagePath.value.trim() && !fields.imageAlt.value.trim()) add('warning', 'Featured image alt text is missing', 'Add a short description of the featured image for accessibility.');
    if (articleDate && filename && !filename.startsWith(`${articleDate}-`)) add('warning', 'Filename date does not match article date', `Article date is ${articleDate}, but the filename is ${filename}.`);
    if (/!\[\s*\]\([^)]+\)/.test(body)) add('warning', 'Inline image is missing alt text', 'At least one Markdown image uses ![](...) with no description.');

    const tokenMatches = [...body.matchAll(/^\[HTML VISUAL · .*? · #([A-Za-z0-9_-]+)\]\s*$/gm)];
    for (const match of tokenMatches) {
      if (!htmlBlocks.has(match[1])) add('blocker', 'HTML visual reference is broken', `Writer cannot find the saved HTML for block #${match[1]}.`);
    }
    for (const block of htmlBlocks.values()) {
      const code = String(block.code || '').trim();
      if (!/^<section\b[\s\S]*<\/section>\s*$/i.test(code)) add('blocker', `HTML visual is malformed: ${cleanHtmlLabel(block.label)}`, 'Each visual must be one complete <section>...</section> block.');
      if (/<script\b/i.test(code)) add('blocker', `HTML visual contains a script: ${cleanHtmlLabel(block.label)}`, 'Script tags are not supported in article visuals.');
    }
    if (/^\[HTML VISUAL · .*? · #[A-Za-z0-9_-]+\]\s*$/m.test(expandedBody)) add('blocker', 'An HTML visual would publish as a placeholder', 'One or more compact Writer HTML blocks could not be expanded back into their original code.');

    const badLinks = new Set();
    for (const match of body.matchAll(/!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
      const url = match[1].trim();
      if (!isAllowedPublishUrl(url)) badLinks.add(url || '(empty URL)');
    }
    for (const line of body.split('\n')) {
      if (/\[[^\]\n]+\]\([^)]*$/.test(line)) badLinks.add('(incomplete Markdown link)');
    }
    for (const match of expandedBody.matchAll(/<a\b[^>]*href=["']([^"']*)["']/gi)) {
      const url = match[1].trim();
      if (!isAllowedPublishUrl(url)) badLinks.add(url || '(empty href)');
    }
    if (badLinks.size) add('blocker', 'Unsafe or malformed link', [...badLinks].slice(0, 3).join(', '));

    return issues;
  }

  function renderPublishChecks(issues) {
    const blockers = issues.filter(item => item.level === 'blocker');
    const warnings = issues.filter(item => item.level === 'warning');
    publishCheckSummary.className = `writer-publish-check-summary ${blockers.length ? 'has-blockers' : 'has-warnings'}`;
    publishCheckSummary.innerHTML = blockers.length
      ? `<strong>${blockers.length} item${blockers.length === 1 ? '' : 's'} must be fixed before publishing.</strong><span>${warnings.length ? `${warnings.length} additional warning${warnings.length === 1 ? '' : 's'} can be reviewed too.` : 'Writer will not publish until the blocking issue is fixed.'}</span>`
      : `<strong>${warnings.length} warning${warnings.length === 1 ? '' : 's'} found.</strong><span>Nothing here blocks publication; review the items or publish anyway.</span>`;
    publishCheckList.innerHTML = issues.map(item => `<div class="writer-publish-check-item is-${item.level}"><span class="writer-publish-check-icon" aria-hidden="true">${item.level === 'blocker' ? '!' : 'i'}</span><div><strong>${escapeHtml(item.title)}</strong>${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ''}</div></div>`).join('');
    publishCheckProceed.hidden = blockers.length > 0;
    publishCheckProceed.disabled = blockers.length > 0;
    publishCheckDialog.showModal();
  }

  function requestPublishWithChecks() {
    try { validateForSave('publish'); }
    catch (error) { showToast(error.message); return; }
    const issues = collectPublishChecks();
    if (!issues.length) { saveArticle('publish'); return; }
    renderPublishChecks(issues);
  }

'''
text = text.replace(marker, helpers + marker, 1)

old = "  publishButton.addEventListener('click', () => saveArticle('publish'));"
new = "  publishButton.addEventListener('click', requestPublishWithChecks);"
if old not in text:
    raise SystemExit('publish click binding not found')
text = text.replace(old, new, 1)

listener_anchor = "  scheduleButton.addEventListener('click', () => saveArticle('schedule'));\n"
if listener_anchor not in text:
    raise SystemExit('schedule listener anchor not found')
text = text.replace(listener_anchor, listener_anchor + "  publishCheckProceed.addEventListener('click', () => { publishCheckDialog.close(); saveArticle('publish'); });\n", 1)
path.write_text(text)

# ---------- writer.css ----------
path = Path('assets/writer.css')
text = path.read_text()
marker = '/* Writer publish safety pass 2026-09-16 */'
if marker not in text:
    text += r'''

/* Writer publish safety pass 2026-09-16 */
.writer-publish-check-dialog{width:min(680px,calc(100% - 2rem))}
.writer-publish-check-summary{display:grid;gap:.25rem;padding:.8rem .9rem;margin-bottom:.7rem;border:1px solid rgba(255,255,255,.10);border-radius:11px;background:#101011}
.writer-publish-check-summary strong{font-size:.86rem;color:#e4e4e1}
.writer-publish-check-summary span{font-size:.73rem;line-height:1.45;color:#858587}
.writer-publish-check-summary.has-blockers{border-color:rgba(190,77,77,.28);background:rgba(111,36,36,.10)}
.writer-publish-check-summary.has-blockers strong{color:#efb4b4}
.writer-publish-check-list{display:grid;gap:.45rem}
.writer-publish-check-item{display:grid;grid-template-columns:24px minmax(0,1fr);gap:.55rem;align-items:start;padding:.68rem .72rem;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:#0e0e0f}
.writer-publish-check-item strong{display:block;font-size:.76rem;color:#d5d5d2}
.writer-publish-check-item p{margin:.2rem 0 0;color:#777;font-size:.7rem;line-height:1.45}
.writer-publish-check-icon{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;font-size:.63rem;font-weight:900;background:#1b1b1c;color:#aaa}
.writer-publish-check-item.is-blocker{border-color:rgba(190,77,77,.20)}
.writer-publish-check-item.is-blocker .writer-publish-check-icon{background:rgba(151,56,56,.20);color:#eca7a7}
.writer-publish-check-item.is-warning .writer-publish-check-icon{background:rgba(151,119,56,.16);color:#d8bf84}
'''
path.write_text(text)

# ---------- production smoke spec ----------
spec = r'''const { test, expect } = require('@playwright/test');

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

  const splitter = page.locator('[data-writer-splitter]');
  await splitter.focus();
  const beforeSplit = Number(await splitter.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => Number(await splitter.getAttribute('aria-valuenow'))).toBe(beforeSplit + 2);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-editor-view]')).toBeVisible();
  await expect(page.locator('[data-field="title"]')).toHaveValue('Writer Production Smoke Test');
  await expect(page.locator('#writer-body')).toContainText('Closing section');
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
  await expect(page.locator('#writer-body')).toContainText('Closing section');

  await page.fill('[data-field="description"]', '');
  await page.evaluate(() => { document.querySelector('[data-publish]').disabled = false; });
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-dialog]')).toBeVisible();
  await expect(page.locator('[data-publish-check-list]')).toContainText('Description is empty');
  await expect(page.locator('[data-publish-check-proceed]')).toBeVisible();
  await page.locator('[data-publish-check-dialog] button[value="cancel"]').click();

  await page.fill('[data-field="description"]', 'Production validation article for the MMA Matlock Writer workflow.');
  await page.fill('#writer-body', longBody + '\n\n[Bad link](javascript:alert(1))');
  await page.evaluate(() => { document.querySelector('[data-publish]').disabled = false; });
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-list]')).toContainText('Unsafe or malformed link');
  await expect(page.locator('[data-publish-check-proceed]')).toBeHidden();
  await page.locator('[data-publish-check-dialog] button[value="cancel"]').click();
  await page.fill('#writer-body', longBody);

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
'''
Path('scripts/writer-smoke.spec.cjs').write_text(spec)
