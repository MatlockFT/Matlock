const { test, expect } = require('@playwright/test');

const BASE = process.env.BROADCAST_CONTROL_BASE_URL || 'https://mmamatlock.com/broadcast/control/';
const AUTH_ORIGIN = 'https://mmamatlock-writer-auth.netlify.app';

function corsHeaders() {
  return {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'https://mmamatlock.com',
    'access-control-allow-methods': 'GET,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'accept,content-type,x-writer-session'
  };
}

function encodeBase64(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function decodeBase64(value) {
  return Buffer.from(String(value || ''), 'base64').toString('utf8');
}

function initialState() {
  const audio = {
    master: 1,
    music: 0.72,
    video: 1,
    videoMusic: 'duck',
    duckLevel: 0.18,
    duckAttack: 0.4,
    duckRelease: 1.5,
    crossfade: 2.5
  };
  const program = [
    {
      id: 'smoke-headline',
      type: 'headline',
      header: 'YOUR FIGHT FORECAST',
      eyebrow: 'LATEST',
      title: 'SMOKE HEADLINE',
      body: 'CONTROL ROOM TEST',
      duration: 20
    },
    {
      id: 'smoke-result',
      type: 'results',
      header: 'FIGHT RESULTS',
      eyebrow: 'RESULTS',
      title: 'SMOKE RESULT',
      body: 'WINNER • METHOD • ROUND',
      duration: 18
    }
  ];
  const music = [
    { id: 'music-a', title: 'Track A', url: 'https://example.com/a.mp3', duration: 120, gainDb: 0, fadeIn: 1, fadeOut: 2 },
    { id: 'music-b', title: 'Track B', url: 'https://example.com/b.mp3', duration: 130, gainDb: 0, fadeIn: 1, fadeOut: 2 }
  ];
  const channel = {
    revision: 'draft-smoke',
    updatedAt: '2026-09-30T05:00:00.000Z',
    startedAt: '2026-09-30T05:00:00.000Z',
    program,
    music,
    ticker: ['SMOKE ONE', 'SMOKE TWO'],
    audio
  };
  const live = { ...JSON.parse(JSON.stringify(channel)), revision: 'live-smoke' };
  live.program.push({
    id: 'live-library-video',
    type: 'video',
    header: 'MMA VIDEO',
    eyebrow: 'VIDEO',
    title: 'LIBRARY REUSE',
    mediaUrl: 'https://example.com/broadcast-video-library-reuse.mp4',
    duration: 33,
    videoAudio: true
  });
  return {
    version: 1,
    updatedAt: channel.updatedAt,
    draft: JSON.parse(JSON.stringify(channel)),
    live
  };
}

test('Broadcast Control core buttons and state transitions stay coherent', async ({ page }) => {
  test.setTimeout(90000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  let remoteState = initialState();
  let remoteSha = '1111111111111111111111111111111111111111';
  let writes = 0;
  let libraryAssets = [
    {
      id: 101,
      name: 'broadcast-video-library-reuse-20260930050000000.mp4',
      url: 'https://example.com/broadcast-video-library-reuse.mp4',
      size: 25 * 1024 * 1024,
      contentType: 'video/mp4',
      createdAt: '2026-09-30T05:00:00.000Z',
      downloadCount: 2,
      releaseId: 10,
      releaseTag: 'writer-media-2026-09'
    },
    {
      id: 102,
      name: 'broadcast-video-unused-clip-20260930051000000.mp4',
      url: 'https://example.com/broadcast-video-unused-clip.mp4',
      size: 12 * 1024 * 1024,
      contentType: 'video/mp4',
      createdAt: '2026-09-30T05:10:00.000Z',
      downloadCount: 0,
      releaseId: 10,
      releaseTag: 'writer-media-2026-09'
    }
  ];
  const deletedAssetIds = [];

  await page.addInitScript(() => {
    localStorage.setItem('matlock-writer:server-session', 'broadcast-smoke-session');
    localStorage.setItem('matlock-writer:server-login', 'MatlockFT');
  });

  await page.route(`${AUTH_ORIGIN}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = corsHeaders();

    if (method === 'OPTIONS') {
      return route.fulfill({ status: 204, headers, body: '' });
    }

    if (url.pathname === '/api/writer/session' && method === 'GET') {
      return route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ ok: true, login: 'MatlockFT' })
      });
    }

    if (url.pathname === '/api/writer/media-library') {
      if (method === 'GET') {
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({
            ok: true,
            assets: libraryAssets,
            count: libraryAssets.length,
            totalBytes: libraryAssets.reduce((sum, asset) => sum + asset.size, 0)
          })
        });
      }
      if (method === 'DELETE') {
        const payload = request.postDataJSON();
        deletedAssetIds.push(payload.assetId);
        libraryAssets = libraryAssets.filter(asset => asset.id !== payload.assetId);
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({ ok: true, assetId: payload.assetId })
        });
      }
    }

    if (url.pathname === '/api/writer/github') {
      const apiPath = url.searchParams.get('path') || '';
      if (apiPath === '/contents/assets/uploads/broadcast.json?ref=main' && method === 'GET') {
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({
            sha: remoteSha,
            content: encodeBase64(JSON.stringify(remoteState))
          })
        });
      }

      if (apiPath === '/contents/assets/uploads/broadcast.json' && method === 'PUT') {
        const payload = request.postDataJSON();
        remoteState = JSON.parse(decodeBase64(payload.content));
        writes += 1;
        remoteSha = String(writes + 1).repeat(40).slice(0, 40);
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({
            content: { path: 'assets/uploads/broadcast.json', sha: remoteSha },
            commit: { sha: `commit-${writes}` }
          })
        });
      }
    }

    return route.fulfill({
      status: 404,
      headers,
      body: JSON.stringify({ message: `Unhandled mock request: ${method} ${url.pathname}` })
    });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('[data-control-workspace]')).toBeVisible();
  await expect(page.locator('[data-auth-panel]')).toBeHidden();
  await expect(page.locator('[data-auth-status]')).toHaveText('GitHub: MatlockFT');
  await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved');
  await expect(page.locator('[data-save-draft]')).toBeDisabled();
  await expect(page.locator('[data-take-live]')).toBeEnabled();
  await expect(page.locator('[data-reload-state]')).toBeEnabled();
  await expect(page.locator('[data-workspace-tab="rundown"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-workspace-panel="media"]')).toBeHidden();

  await page.click('[data-workspace-tab="media"]');
  await expect(page.locator('[data-workspace-panel="media"]')).toBeVisible();
  await expect(page.locator('[data-workspace-tab="media"]')).toHaveAttribute('aria-selected', 'true');

  const libraryRows = page.locator('[data-video-library-list] .mfc-video-asset');
  await expect(libraryRows).toHaveCount(2);
  await expect(page.locator('[data-video-library-summary]')).toContainText('2 videos');
  await page.selectOption('[data-video-library-filter]', 'unused');
  await expect(libraryRows).toHaveCount(1);
  await expect(libraryRows.first()).toContainText('UNUSED');
  await page.selectOption('[data-video-library-filter]', 'all');
  await expect(libraryRows).toHaveCount(2);

  const unusedRow = libraryRows.filter({ hasText: 'unused clip' });
  await expect(unusedRow).toContainText('UNUSED');
  page.once('dialog', dialog => dialog.accept());
  await unusedRow.getByRole('button', { name: 'Delete' }).click();
  await expect(libraryRows).toHaveCount(1);
  expect(deletedAssetIds).toEqual([102]);

  const reusableRow = libraryRows.filter({ hasText: 'library reuse' });
  await expect(reusableRow).toContainText('LIVE');
  await reusableRow.getByRole('button', { name: 'Add to Program' }).click();

  const programBlocks = page.locator('[data-program-track] [data-program-id]');
  await expect(programBlocks).toHaveCount(3);
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved changes');

  page.once('dialog', dialog => dialog.accept());
  await page.click('[data-reload-state]');
  await expect(programBlocks).toHaveCount(2);
  await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved');

  await page.click('[data-workspace-tab="rundown"]');
  await expect(page.locator('[data-workspace-panel="rundown"]')).toBeVisible();
  await expect(programBlocks).toHaveCount(2);
  await expect(page.locator('[data-program-fields] button', { hasText: '← Move left' })).toBeDisabled();
  await expect(page.locator('[data-program-fields] button', { hasText: 'Move right →' })).toBeEnabled();

  const musicBlocks = page.locator('[data-music-track] [data-music-id]');
  await expect(musicBlocks).toHaveCount(2);

  await page.click('[data-add-program="headline"]');
  await expect(programBlocks).toHaveCount(3);
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved changes');
  await expect(page.locator('[data-save-draft]')).toBeEnabled();
  await expect(page.locator('[data-program-fields] button', { hasText: 'Move right →' })).toBeDisabled();

  const titleInput = page.locator('[data-program-fields] input[type="text"]').first();
  await titleInput.fill('UPDATED SMOKE HEADLINE');
  await expect(page.locator('[data-program-editor-title]')).toHaveText('UPDATED SMOKE HEADLINE');

  await page.click('[data-save-draft]');
  await expect.poll(() => writes).toBe(1);
  await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved');
  await expect(page.locator('[data-save-draft]')).toBeDisabled();

  await page.click('[data-workspace-tab="graphics"]');
  await page.fill('[data-ticker-input]', 'SMOKE LIVE ONE\nSMOKE LIVE TWO');
  await expect(page.locator('[data-ticker-preview]')).toContainText('SMOKE LIVE ONE');
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved changes');
  await page.click('[data-take-live]');
  await expect.poll(() => writes).toBe(2);
  await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved');
  expect(remoteState.live.ticker).toEqual(['SMOKE LIVE ONE', 'SMOKE LIVE TWO']);
  expect(remoteState.live.program.at(-1).title).toBe('UPDATED SMOKE HEADLINE');

  await page.click('[data-workspace-tab="rundown"]');
  await page.click('[data-add-program="breaking"]');
  await expect(programBlocks).toHaveCount(4);
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved changes');

  page.once('dialog', dialog => dialog.accept());
  await page.click('[data-reload-state]');
  await expect(programBlocks).toHaveCount(3);
  await expect(page.locator('[data-draft-status]')).toHaveText('Draft saved');

  await page.click('[data-workspace-tab="audio"]');
  await expect(page.locator('[data-workspace-panel="audio"]')).toBeVisible();
  await musicBlocks.nth(1).focus();
  await page.keyboard.press('Enter');
  await expect(musicBlocks.nth(1)).toHaveClass(/is-selected/);

  await page.click('[data-add-music-url]');
  await expect(page.locator('[data-url-dialog]')).toBeVisible();
  await page.fill('[data-music-url]', 'not-a-url');
  await page.locator('[data-music-url]').press('Enter');
  await expect(page.locator('[data-url-dialog]')).toBeVisible();
  await page.locator('[data-url-dialog] button[value="cancel"]').last().click();
  await expect(page.locator('[data-url-dialog]')).toBeHidden();

  expect(pageErrors).toEqual([]);
});
