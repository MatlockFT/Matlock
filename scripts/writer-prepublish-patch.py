from pathlib import Path
import re

writer_path = Path('assets/writer.js')
writer = writer_path.read_text(encoding='utf-8')

new_collect = r'''  function collectPublishChecks() {
    const issues = [];
    const body = bodyEditor.value || '';
    const expandedBody = expandHtmlBlocks(body);
    const title = fields.title.value.trim();
    const description = fields.description.value.trim();
    const filename = fields.filename.value.trim();
    const articleDate = fields.date.value;

    const add = (level, title, detail = '') => issues.push({ level, title, detail });

    if (!title) add('blocker', 'Title is missing', 'Add the article title before publishing.');
    if (!articleDate) add('blocker', 'Article date is missing', 'Choose the article date before publishing.');
    if (!filename) {
      add('blocker', 'Filename is missing', 'Add a Jekyll post filename before publishing.');
    } else if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/i.test(filename)) {
      add('blocker', 'Filename format is invalid', 'Use YYYY-MM-DD-article-name.md.');
    } else {
      if (articleDate && !filename.startsWith(`${articleDate}-`)) add('warning', 'Filename date does not match article date', `Article date is ${articleDate}, but the filename is ${filename}.`);
      if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(filename)) {
        add('warning', 'Filename looks unusual', 'Lowercase words separated by single hyphens are safest for the public article URL.');
      }
      const slug = filename.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.md$/i, '');
      if (/^(?:article|untitled|draft|test|new-article|copy)(?:-\d+)?$/i.test(slug)) {
        add('warning', 'Filename looks temporary', `The filename is ${filename}. Make sure this is the public URL slug you want.`);
      }
    }

    if (!description) add('warning', 'Description is empty', 'The article can publish, but its listing and social summary will have no description.');
    if (!expandedBody.trim()) add('warning', 'Article body is empty', 'There is no article content below the front matter.');
    if (fields.imagePath.value.trim() && !fields.imageAlt.value.trim()) add('warning', 'Featured image alt text is missing', 'Add a short description of the featured image for accessibility.');
    if (/!\[\s*\]\([^)]+\)/.test(body)) add('warning', 'Inline image is missing alt text', 'At least one Markdown image uses ![](...) with no description.');
    if (dirty) add('warning', 'Unsaved local changes', currentPath
      ? 'This article has changes that have not yet been saved to GitHub. Publishing will save the current version.'
      : 'This new article has not yet been saved to GitHub. Publishing will save the current version.');

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
  }'''

writer, count = re.subn(r"  function collectPublishChecks\(\) \{.*?\n    return issues;\n  \}", lambda _: new_collect, writer, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'collectPublishChecks patch count was {count}')

new_request = r'''  function requestPublishWithChecks() {
    const issues = collectPublishChecks();
    if (!issues.length) { saveArticle('publish'); return; }
    renderPublishChecks(issues);
  }'''
writer, count = re.subn(r"  function requestPublishWithChecks\(\) \{.*?\n  \}", lambda _: new_request, writer, count=1, flags=re.S)
if count != 1:
    raise SystemExit(f'requestPublishWithChecks patch count was {count}')

writer_path.write_text(writer, encoding='utf-8')

smoke_path = Path('scripts/writer-smoke.spec.cjs')
smoke = smoke_path.read_text(encoding='utf-8')
anchor = "  await expect(page.locator('[data-github-status]')).toContainText('Connected to MatlockFT/Matlock', { timeout: 10000 });\n\n  await page.click('[data-save-draft]');"
insert = """  await expect(page.locator('[data-github-status]')).toContainText('Connected to MatlockFT/Matlock', { timeout: 10000 });

  const cleanFilename = await page.locator('[data-field=\"filename\"]').inputValue();
  await page.fill('[data-field=\"filename\"]', `${date}-draft.md`);
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-dialog]')).toBeVisible();
  await expect(page.locator('[data-publish-check-list]')).toContainText('Filename looks temporary');
  await expect(page.locator('[data-publish-check-list]')).toContainText('Unsaved local changes');
  await expect(page.locator('[data-publish-check-proceed]')).toBeVisible();
  await page.locator('[data-publish-check-dialog]').getByRole('button', { name: 'Back to editor' }).click();
  await page.fill('[data-field=\"filename\"]', cleanFilename);

  await page.fill('[data-field=\"title\"]', '');
  await page.click('[data-publish]');
  await expect(page.locator('[data-publish-check-dialog]')).toBeVisible();
  await expect(page.locator('[data-publish-check-list]')).toContainText('Title is missing');
  await expect(page.locator('[data-publish-check-proceed]')).toBeHidden();
  await page.locator('[data-publish-check-dialog]').getByRole('button', { name: 'Back to editor' }).click();
  await page.fill('[data-field=\"title\"]', 'Writer Production Smoke Test');

  await page.click('[data-save-draft]');"""
if anchor not in smoke:
    raise SystemExit('smoke insertion anchor was not found')
smoke = smoke.replace(anchor, insert, 1)
smoke_path.write_text(smoke, encoding='utf-8')
