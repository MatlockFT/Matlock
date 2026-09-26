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
  const uploadedAssets = new Map();

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
    if (url.pathname.startsWith(`${repoRoot}/contents/assets/uploads/`)) {
      const assetPath = decodeURIComponent(url.pathname.slice(`${repoRoot}/contents/`.length));
      if (method === 'GET') {
        const asset = uploadedAssets.get(assetPath);
        if (!asset) return route.fulfill({ status: 404, headers, body: JSON.stringify({ message: 'Not Found' }) });
        return route.fulfill({ status: 200, headers, body: JSON.stringify({ path: assetPath, sha: asset.sha }) });
      }
      if (method === 'PUT') {
        const payload = request.postDataJSON();
        const sha = `assetsha${shaCounter++}`;
        uploadedAssets.set(assetPath, { sha, content: payload.content });
        return route.fulfill({ status: 200, headers, body: JSON.stringify({ content: { path: assetPath, sha }, commit: { sha: `commit${shaCounter}` } }) });
      }
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
  await expect(page.locator('[data-preview-author]')).toHaveText('Matlock');
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
  await expect(placedImage).toHaveAttribute('data-media-width', '50');
  await expect(placedImage.locator('img[alt="Writer smoke image"]')).toHaveAttribute('src', 'https://example.com/writer-smoke.jpg');
  await expect(placedImage.locator('figcaption')).toHaveText('Writer smoke caption');

  // Preview media is directly editable: hover controls change wrap mode and drag-resize persists.
  await placedImage.hover();
  const mediaToolbar = placedImage.locator(':scope > .writer-media-toolbar');
  await expect(mediaToolbar).toBeVisible();
  await expect(mediaToolbar.locator('[data-media-width-label]')).toHaveText('50%');
  await mediaToolbar.locator('[data-media-layout="break"]').click();
  await expect(placedImage).toHaveAttribute('data-media-flow', 'break');
  await expect(placedImage).toHaveAttribute('data-media-align', 'center');
  await expect(editor).toHaveValue(/data-writer-media-id="media-[^"]+"/);
  await expect(editor).toHaveValue(/data-media-flow="break"/);

  const resizeHandle = placedImage.locator(':scope > .writer-media-resize-handle');
  const handleBox = await resizeHandle.boundingBox();
  expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 80, handleBox.y + handleBox.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Number(await placedImage.getAttribute('data-media-width'))).toBeGreaterThan(50);
  await expect(editor).toHaveValue(/--media-width:\s*[5-9][0-9](?:\.\d+)?%/);

  await placedImage.hover();
  await mediaToolbar.locator('[data-media-layout="wrap-right"]').click();
  await expect(placedImage).toHaveAttribute('data-media-flow', 'wrap');
  await expect(placedImage).toHaveAttribute('data-media-align', 'right');
  await expect(editor).toHaveValue(/data-media-flow="wrap"/);
  await expect(editor).toHaveValue(/data-media-align="right"/);

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

  // Markdown tables remain supported in source/preview even though the old
  // standalone Table toolbar tool was intentionally removed.
  const beforeTable = await editor.inputValue();
  await editor.fill(beforeTable + '\n\n| Metric | Alpha | Beta |\n| --- | --- | --- |\n| Record |  |  |\n| Reach |  |  |');
  await expect(page.locator('[data-preview-content]')).toContainText('Metric');
  await expect(page.locator('[data-preview-content]')).toContainText('Reach');

  const previewTableShell = page.locator('[data-preview-content] .writer-preview-table-shell').first();
  await expect(previewTableShell).toBeVisible();
  await expect(previewTableShell.locator('table')).toContainText('Metric');
  await expect(previewTableShell.locator('table')).toContainText('Reach');

  // Fighter lookup is deterministic in smoke: directory match + live UFCStats response.
  await page.route('**/assets/data/matchmaker/current.json?writer-fighters=1', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        generatedAt: '2026-09-26T18:00:00.000Z',
        fighters: [{
          id: 'lookup-fighter',
          name: 'Lookup Fighter',
          division: 'Lightweight',
          record: '12-2-0',
          rank: 9,
          image: 'https://example.com/lookup.png',
          checkedAt: '2026-09-26T18:00:00.000Z',
          verifiedMeetings: [{
            result: 'W',
            opponentName: 'Recent Opponent',
            competitionClass: 'ufc',
            method: 'Decision - Unanimous',
            date: '2026-09-01'
          }],
          meetingCoverage: { ufcStatsId: 'aaaaaaaaaaaaaaaa' }
        }]
      })
    });
  });
  await page.route('**/assets/data/writer-fighters.json?writer-fighters=*', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-09-26T18:00:00.000Z',
        builtAt: '2026-09-26T18:00:00.000Z',
        mirrorThrough: '2026-09-26',
        fighters: [{
          id: 'lookup-fighter',
          name: 'Lookup Fighter',
          division: 'Lightweight',
          record: '12-2-0',
          ufcRecord: '6-1-0',
          recordOutsideUfc: '6-1-0',
          rank: 9,
          image: 'https://example.com/lookup.png',
          checkedAt: '2026-09-26T18:00:00.000Z',
          ufcStatsId: 'aaaaaaaaaaaaaaaa',
          sourceUrl: 'https://ufcstats.com/fighter-details/aaaaaaaaaaaaaaaa',
          latestBoutDate: '2026-09-01',
          mirrorThrough: '2026-09-26',
          bio: { height: '5\' 10"', reach: '72"', dob: 'Jan 01, 1998' },
          stats: {
            slpm: '4.44',
            sapm: '2.22',
            strAccuracy: '50%',
            strDefense: '60%',
            tdAvg: '1.50',
            tdAccuracy: '40%',
            tdDefense: '70%',
            subAvg: '0.50',
            sample: { fights: 5, minutes: 50, latestBoutDate: '2026-09-01' }
          },
          recent: [{
            result: 'W',
            opponent: 'Recent Opponent',
            method: 'Decision - Unanimous',
            date: '2026-09-01'
          }]
        }]
      })
    });
  });

  await page.route('https://mmamatlock-writer-auth.netlify.app/api/writer/fighter*', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        source: 'UFCStats',
        mode: 'live',
        liveUfcStats: true,
        liveUfcProfile: false,
        liveCareerFallback: false,
        fetchedAt: '2026-09-26T18:01:00.000Z',
        sourceUrl: 'https://ufcstats.com/fighter-details/aaaaaaaaaaaaaaaa',
        profile: {
          statsId: 'aaaaaaaaaaaaaaaa',
          name: 'Lookup Fighter',
          record: '12-2-0',
          height: '5\' 10"',
          reach: '72"',
          dob: 'Jan 01, 1998',
          stats: {
            slpm: '9.99',
            sapm: '1.11',
            strAccuracy: '61%',
            strDefense: '67%',
            tdAvg: '2.50',
            tdAccuracy: '50%',
            tdDefense: '80%',
            subAvg: '0.7'
          },
          ufcRecord: '6-1-0',
          latestBoutDate: '2026-09-01',
          recent: [{ result:'W', opponent:'Recent Opponent', method:'Decision - Unanimous', date:'2026-09-01' }]
        }
      })
    });
  });

  // Structured Fight Stats: normal fields, no pipe-delimited row syntax.
  await page.click('[data-tool="stats"]');
  const statsDialog = page.locator('[data-stats-dialog]');
  await statsDialog.locator('[data-stats-fighter="a"]').fill('Alpha Fighter');
  await statsDialog.locator('[data-stats-fighter="b"]').fill('Beta Fighter');
  const firstStatRow = statsDialog.locator('[data-stats-row-list] .writer-comparison-row').first();
  await expect(firstStatRow.locator('[data-structured-label]')).toHaveValue('Significant Strikes / Minute');
  await firstStatRow.locator('[data-structured-a]').fill('4.20');
  await firstStatRow.locator('[data-structured-b]').fill('3.10');
  await statsDialog.locator('[data-stats-insert]').click();
  await expect(page.locator('[data-preview-content]')).toContainText('Alpha Fighter');
  await expect(page.locator('[data-preview-content]')).toContainText('4.20');

  // Typing a fighter name offers a match; choosing it applies live UFCStats values.
  await page.click('[data-tool="stats"]');
  const lookupStatsDialog = page.locator('[data-stats-dialog]');
  const lookupInput = lookupStatsDialog.locator('[data-stats-fighter="a"]');
  await lookupInput.fill('Lookup');
  await expect(lookupStatsDialog.locator('.writer-fighter-suggestion')).toContainText('Lookup Fighter');
  await lookupStatsDialog.locator('.writer-fighter-suggestion').click();
  await expect(lookupStatsDialog.locator('[data-stats-row-list] .writer-comparison-row').first().locator('[data-structured-a]')).toHaveValue('9.99');
  await expect(lookupInput.locator('xpath=..').locator('.writer-fighter-source-status')).toContainText('LIVE UFCStats');
  await page.keyboard.press('Escape');

  // Structured Tale of the Tape: direct comparison and recent-form controls.
  await page.click('[data-tool="tale"]');
  const taleDialog = page.locator('[data-tale-dialog]');
  await taleDialog.locator('[data-tale-a]').fill('Alpha Fighter');
  await taleDialog.locator('[data-tale-b]').fill('Beta Fighter');
  const taleRows = taleDialog.locator('[data-tale-row-list] .writer-comparison-row');
  await expect(taleRows).toHaveCount(11);
  await taleRows.nth(0).locator('[data-structured-a]').fill('10-1');
  await taleRows.nth(0).locator('[data-structured-b]').fill('9-2');
  await taleRows.nth(3).locator('[data-structured-a]').fill('72 in');
  await taleRows.nth(3).locator('[data-structured-b]').fill('70 in');
  await taleDialog.locator('[data-tale-form-add="a"]').click();
  const recent = taleDialog.locator('[data-tale-form-list="a"] .writer-recent-row').first();
  await recent.locator('[data-recent-result]').selectOption('W');
  await recent.locator('[data-recent-opponent]').fill('Gamma Fighter');
  await recent.locator('[data-recent-detail]').fill('DEC · R3');
  await taleDialog.locator('[data-tale-insert]').click();
  await expect(page.locator('[data-preview-content]')).toContainText('Alpha Fighter');
  await expect(page.locator('[data-preview-content]')).toContainText('10-1');
  await expect(page.locator('[data-preview-content]')).toContainText('Gamma Fighter');

  await page.click('[data-tool="html"]');
  await page.fill('[data-html-label]', 'Smoke visual');

  // Dialog validation must stay visible above the modal instead of disappearing behind it.
  await page.fill('[data-html-code]', '<div>Unsafe</div><script>alert(1)</script>');
  await page.click('[data-html-insert]');
  await expect(page.locator('[data-html-dialog]')).toBeVisible();
  await expect(page.locator('[data-toast]')).toBeVisible();
  await expect(page.locator('[data-toast]')).toContainText('Script tags are not supported');
  await expect.poll(async () => page.locator('[data-toast]').evaluate(el => el.matches(':popover-open'))).toBe(true);

  // Authors may paste a normal HTML/CSS fragment; Writer supplies the section wrapper.
  await page.fill('[data-html-code]', '<div class="writer-smoke-visual"><h2>Smoke Visual</h2><p>Rendered HTML visual.</p></div><style>.writer-smoke-visual{padding:12px}</style>');
  await page.click('[data-html-insert]');
  await expect(page.locator('[data-html-block-panel-toggle]')).toBeVisible();
  await expect(page.locator('[data-html-block-panel-toggle]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-html-block-rail]')).toBeVisible();
  await expect(page.locator('[data-html-block-edit][title*="Smoke visual"]')).toContainText('Smoke visual');
  await expect(page.locator('[data-preview-content]')).toContainText('Rendered HTML visual');
  await expect(page.locator('[data-local-status]')).toContainText('Saved locally', { timeout: 5000 });

  // Embedded visuals live in a vertical, scroll-ready browser instead of a horizontal strip.
  const visualList = page.locator('.writer-html-block-list');
  const visualListLayout = await visualList.evaluate(node => ({
    display: getComputedStyle(node).display,
    overflowY: getComputedStyle(node).overflowY,
    overflowX: getComputedStyle(node).overflowX
  }));
  expect(visualListLayout.display).toBe('grid');
  expect(['auto','scroll']).toContain(visualListLayout.overflowY);
  expect(visualListLayout.overflowX).toBe('hidden');
  await page.locator('[data-html-block-panel-close]').click();
  await expect(page.locator('[data-html-block-rail]')).toBeHidden();
  await page.locator('[data-html-block-panel-toggle]').click();
  await expect(page.locator('[data-html-block-rail]')).toBeVisible();

  // HTML visuals can be edited in place while seeing the finished visual.
  // The preview shell is re-rendered after visual edits, so key the smoke test to the
  // persistent block id instead of holding a text-filtered locator across that render.
  const initialHtmlVisualShell = page.locator('[data-preview-content] .writer-preview-html-shell').filter({ hasText:'Rendered HTML visual' }).first();
  const htmlVisualSection = initialHtmlVisualShell.locator('section[data-writer-html-block-id]');
  const htmlBlockId = await htmlVisualSection.getAttribute('data-writer-html-block-id');
  expect(htmlBlockId).toBeTruthy();
  const htmlVisualShell = page.locator('[data-preview-content] .writer-preview-html-shell').filter({
    has: page.locator(`section[data-writer-html-block-id="${htmlBlockId}"]`)
  }).first();

  await htmlVisualShell.hover();
  await htmlVisualShell.locator('[data-preview-html-visual-edit]').click();
  await expect(htmlVisualShell.locator('section[data-writer-html-block-id]')).toHaveAttribute('contenteditable', 'true');
  await htmlVisualShell.locator('section[data-writer-html-block-id]').evaluate(section => {
    const paragraph = section.querySelector('p');
    paragraph.textContent = 'Visually edited HTML.';
    section.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Visually edited HTML.' }));
  });
  await expect(htmlVisualShell).toContainText('Visually edited HTML.');
  await page.waitForTimeout(180);
  await htmlVisualShell.locator('[data-preview-html-visual-edit]').click();

  await htmlVisualShell.hover();
  await htmlVisualShell.locator('[data-preview-html-source-edit]').click();
  await expect(page.locator('[data-html-dialog]')).toBeVisible();
  await expect(page.locator('[data-html-code]')).toHaveValue(/Visually edited HTML\./);
  await page.locator('[data-html-dialog]').getByRole('button', { name: 'Cancel' }).click();

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
  await expect(page.locator('#writer-body')).toHaveValue(/HTML VISUAL · Alpha Fighter vs\. Beta Fighter/);
  await expect(page.locator('[data-html-block-panel-toggle]')).toBeVisible();
  await expect(page.locator('[data-html-block-rail]')).toBeHidden();
  await page.locator('[data-html-block-panel-toggle]').click();
  await expect(page.locator('[data-html-block-rail]')).toBeVisible();
  await expect(page.locator('[data-preview-content]')).toContainText('Alpha Fighter');
  await expect(page.locator('[data-preview-content]')).toContainText('Beta Fighter');
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

  // New uploads live under the article's date + filename slug rather than the flat legacy upload root.
  await page.click('[data-tool="image"]');
  await page.locator('[data-inline-image-file]').setInputFiles({
    name: 'smoke-upload.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64')
  });
  await page.fill('[data-inline-image-alt]', 'Uploaded smoke image');
  await page.click('[data-image-insert]');
  await expect.poll(() => uploadedAssets.size, { timeout: 10000 }).toBeGreaterThan(0);
  const uploadedAssetPath = [...uploadedAssets.keys()][0];
  expect(uploadedAssetPath).toMatch(new RegExp(`^assets/uploads/articles/${date.slice(0, 4)}/${date.slice(5, 7)}/writer-production-smoke(?:-test)?/`));
  await expect.poll(async () => await editor.inputValue(), { timeout: 10000 }).toContain('/' + uploadedAssetPath);

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
  expect(remote.text).toContain('<section class="article-html-visual">');
  expect(remote.text).toContain('<div class="writer-smoke-visual">');
  expect(remote.text).not.toContain('[HTML VISUAL');
  expect(remote.text).toContain('article-inline-image--wrap article-inline-image--right');
  expect(remote.text).toContain('data-media-flow="wrap"');
  expect(remote.text).toContain('data-media-align="right"');
  expect(remote.text).toContain('<img src="https://example.com/writer-smoke.jpg" alt="Writer smoke image" loading="lazy">');
  expect(remote.text).toContain('<figcaption>Writer smoke caption</figcaption>');
  expect(remote.text).toContain('youtube.com/embed/dQw4w9WgXcQ');
  expect(remote.text).toContain('| Metric | Alpha | Beta |');
  expect(remote.text).toContain('Alpha Fighter');

  await page.click('[data-show-library]');
  await expect(page.locator('[data-library-list]')).toContainText('Writer Production Smoke Test', { timeout: 10000 });
  await page.locator('[data-library-path]').filter({ hasText: 'Writer Production Smoke Test' }).locator('[data-library-edit]').click();
  const articleDetails = page.locator('.writer-meta');
  await expect(articleDetails).not.toHaveAttribute('open', '');
  await expect(page.locator('#writer-body')).toHaveValue(/Closing section/);
  await expect(page.locator('#writer-body')).toHaveValue(/Writer smoke image/);
  await expect(page.locator('#writer-body')).toHaveValue(/ALPHA FIGHTER/);
  await expect(page.locator('[data-preview-content]')).toContainText('Visually edited HTML.');
  await articleDetails.locator(':scope > summary').click();
  await expect(articleDetails).toHaveAttribute('open', '');
  const advancedAfterLibrary = page.locator('.writer-meta-advanced');
  if (!(await advancedAfterLibrary.evaluate(el => el.open))) await advancedAfterLibrary.locator(':scope > summary').click();

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
  expect(remote.text).toContain('Visually edited HTML.');
  expect(remote.text).toContain('Writer smoke image');
  expect(remote.text).toContain('dQw4w9WgXcQ');
  expect(remote.text).toContain('ALPHA FIGHTER');

  expect(pageErrors).toEqual([]);
});
