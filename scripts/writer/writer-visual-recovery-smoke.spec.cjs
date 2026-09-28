const { test, expect } = require('@playwright/test');

const BASE = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';
const PATH = '_posts/2026-09-25-visual-recovery-smoke.md';
const SHA = 'visual-recovery-sha';

function corsHeaders() {
  return {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'https://mmamatlock.com',
    'access-control-allow-methods': 'GET,OPTIONS',
    'access-control-allow-headers': 'authorization,content-type,x-github-api-version,accept'
  };
}

function encodeBase64(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

test('Writer repairs missing visual payloads from the GitHub article', async ({ page }) => {
  test.setTimeout(30000);

  const taleConfig = encodeURIComponent(JSON.stringify({
    version: 6,
    a: { name: 'Alpha Fighter' },
    b: { name: 'Beta Fighter' },
    rows: []
  }));
  const statsConfig = encodeURIComponent(JSON.stringify({
    version: 3,
    fighterA: 'Alpha Fighter',
    fighterB: 'Beta Fighter',
    rows: []
  }));

  const remoteText = `---
layout: post
title: "Visual Recovery Smoke"
description: ""
date: 2026-09-25
category: Breakdown
author: Matlock
published: false
---

## Alpha Fighter vs. Beta Fighter

<section class="article-html-visual" data-writer-block="tale" data-writer-config="${taleConfig}">
<div class="fight-compare-sleek"><strong>Alpha Fighter</strong><span>MATCHUP</span><strong>Beta Fighter</strong></div>
</section>

<section class="article-html-visual" data-writer-block="stats" data-writer-config="${statsConfig}">
<div class="fight-stats-sleek"><strong>Alpha Fighter</strong><span>STATS</span><strong>Beta Fighter</strong></div>
</section>
`;

  await page.route('https://mmamatlock-writer-auth.netlify.app/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/auth/github/health')) {
      return route.fulfill({
        status: 200,
        headers: { ...corsHeaders(), 'access-control-allow-origin': '*' },
        body: JSON.stringify({ ok: true, configured: false })
      });
    }
    return route.fulfill({
      status: 401,
      headers: { ...corsHeaders(), 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: false })
    });
  });

  await page.route('https://api.github.com/repos/MatlockFT/Matlock/**', async route => {
    const url = new URL(route.request().url());
    const headers = corsHeaders();
    if (route.request().method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers, body: '' });
    }

    const repoRoot = '/repos/MatlockFT/Matlock';
    if (url.pathname === `${repoRoot}/contents/_posts`) {
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify([{ type: 'file', name: PATH.split('/').pop(), path: PATH, sha: SHA }])
      });
    }

    if (url.pathname === `${repoRoot}/contents/${PATH}`) {
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          name: PATH.split('/').pop(),
          path: PATH,
          sha: SHA,
          content: encodeBase64(remoteText)
        })
      });
    }

    return route.fulfill({
      status: 404,
      headers,
      body: JSON.stringify({ message: `Unhandled mock route: ${url.pathname}` })
    });
  });

  const brokenLocalBody = `## Alpha Fighter vs. Beta Fighter

[HTML VISUAL · Alpha Fighter vs. Beta Fighter · #tale1234]

[HTML VISUAL · Alpha Fighter vs. Beta Fighter · Stats · #stats123]
`;

  await page.addInitScript(({ path, sha, body }) => {
    localStorage.setItem(`matlock-writer:${path}`, JSON.stringify({
      title: 'Visual Recovery Smoke',
      description: '',
      date: '2026-09-25',
      category: 'Breakdown',
      tags: '',
      imagePath: '',
      imageAlt: '',
      imagePosition: 'center center',
      filename: path.split('/').pop(),
      publishAt: '',
      showToc: false,
      spoilerWarning: false,
      pinned: false,
      body,
      htmlBlocks: [],
      currentPath: path,
      currentSha: sha,
      originalFrontmatter: '',
      currentPublished: false,
      savedAt: Date.now()
    }));
  }, { path: PATH, sha: SHA, body: brokenLocalBody });

  await page.goto(`${BASE}?path=${encodeURIComponent(PATH)}`, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-editor-view]')).toBeVisible();
  await expect(page.locator('[data-save-state]')).toContainText('visuals repaired');
  await expect(page.locator('[data-preview-content] .writer-preview-visual-recovery')).toHaveCount(0);

  const tale = page.locator('[data-preview-content] section[data-writer-block="tale"]');
  const stats = page.locator('[data-preview-content] section[data-writer-block="stats"]');
  await expect(tale).toBeVisible();
  await expect(stats).toBeVisible();
  await expect(tale).toContainText('MATCHUP');
  await expect(stats).toContainText('STATS');

  await expect(page.locator('#writer-body')).toHaveValue(/HTML VISUAL · Alpha Fighter vs\. Beta Fighter/);
  await expect(page.locator('[data-html-block-panel-toggle]')).toBeVisible();
  await expect(page.locator('[data-html-block-count]')).toHaveText('2');
});
