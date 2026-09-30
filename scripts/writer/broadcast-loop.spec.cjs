const { test, expect } = require('@playwright/test');
const { startServer, wav } = require('./broadcast-test-server.cjs');
let fixture;
test.beforeEach(async ({ context }) => {
  fixture = await startServer();
  // Test data and writes stay on the local fixture server.
  await context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
});
test.afterEach(async () => { await fixture.close(); });

test('batch upload continues after a bad file, retries chunks, auto-populates and persists music metadata', async ({ page }) => {
  fixture.controls.chunkFailures = 1;
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Media/ }).click();
  await page.locator('[data-video-library-upload]').setInputFiles([
    { name: 'not-media.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') },
    { name: 'My song.wav', mimeType: '', buffer: wav(2) },
    { name: 'Second song.wav', mimeType: 'audio/wav', buffer: wav(3) }
  ]);
  await expect(page.locator('[data-upload-results]')).toContainText('Second song.wav — Ready in draft', { timeout: 20000 });
  await expect(page.locator('[data-upload-results]')).toContainText('Unsupported format');
  await expect(page.locator('[data-music-id]')).toHaveCount(2);
  await expect(page.locator('[data-video-library-list] .mfc-video-asset')).toHaveCount(2);
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  expect(fixture.state.draft.music.map(track => track.duration)).toEqual([2, 3]);
  expect(fixture.state.draft.mediaLibrary).toHaveLength(2);
  expect(fixture.state.live.music).toHaveLength(0);
  await page.reload();
  await expect(page.locator('[data-video-library-list] .mfc-video-asset')).toHaveCount(2);
  await page.locator('[data-library-add-all]').click();
  await expect(page.locator('[data-music-id]')).toHaveCount(2); // no accidental duplicates
});

test('library-only upload can be reused and direct URLs detect duration; YouTube is rejected', async ({ page }) => {
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Media/ }).click();
  await page.locator('[data-upload-auto-add]').uncheck();
  await page.locator('[data-video-library-upload]').setInputFiles({ name: 'Bed.wav', mimeType: 'audio/wav', buffer: wav() });
  await expect(page.locator('[data-upload-results]')).toContainText('Ready in library');
  await expect(page.locator('[data-music-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add to Music' }).click();
  await expect(page.locator('[data-music-id]')).toHaveCount(1);
  await page.getByRole('tab', { name: /Audio/ }).click();
  await page.locator('[data-add-music-url]').click();
  await page.locator('[data-music-url]').fill('https://youtu.be/T5umkDLypsw');
  await page.locator('[data-confirm-music-url]').click();
  await expect(page.locator('[data-url-dialog]')).toBeVisible();
  await expect(page.locator('[data-toast]')).toContainText('direct media');
  await page.locator('[data-music-url]').fill(fixture.origin + '/fixtures/tone.wav');
  await page.locator('[data-confirm-music-url]').click();
  await expect(page.locator('[data-url-dialog]')).toBeHidden();
  await expect(page.locator('[data-music-id]')).toHaveCount(2);
  await page.locator('[data-take-live]').click();
  await expect.poll(() => fixture.state.live.music.length).toBe(2);
  expect(fixture.state.live.music[1].duration).toBe(2);
});

test('failed Take Live never changes Program, and edits made during Save remain unsaved', async ({ page }) => {
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Graphics/ }).click();
  await page.locator('[data-ticker-input]').fill('First edit');
  fixture.controls.failSaves = true;
  await page.locator('[data-take-live]').click();
  await expect(page.locator('[data-toast]')).toContainText('changed remotely');
  expect(fixture.state.live.ticker[0]).toBe('LOCAL TEST PREVIEW');
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
  fixture.controls.failSaves = false;
  fixture.controls.saveDelay = 600;
  await page.locator('[data-save-draft]').click();
  await page.locator('[data-ticker-input]').fill('Edit while saving');
  await expect.poll(() => fixture.controls.writes).toBe(1);
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
  expect(fixture.state.draft.ticker).toEqual(['First edit']);
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  expect(fixture.state.draft.ticker).toEqual(['Edit while saving']);
});

test('preview keeps its clock during edits, with explicit restart and selected-item preview', async ({ page }) => {
  await page.goto(fixture.origin + '/broadcast/control/');
  const preview = page.frameLocator('[data-preview-frame]');
  await expect(preview.locator('[data-mfc-progress]')).toHaveText(/00:0[2-5] \/ 00:06/);
  const before = await preview.locator('[data-mfc-progress]').textContent();
  await page.locator('[data-program-fields]').getByLabel('Title', { exact: true }).fill('An edited headline');
  await expect(preview.locator('[data-mfc-title]')).toHaveText('AN EDITED HEADLINE');
  expect(await preview.locator('[data-mfc-progress]').textContent()).not.toBe('00:00 / 00:06');
  await page.locator('[data-preview-restart]').click();
  await expect(preview.locator('[data-mfc-progress]')).toHaveText('00:00 / 00:06');
  await page.locator('[data-add-program="headline"]').click();
  await page.getByRole('button', { name: 'Preview this item' }).click();
  await expect(preview.locator('[data-mfc-title]')).toHaveText('NEW HEADLINE');
});

test('video uses master volume, source replacement reloads, and broken media does not stop the loop', async ({ page }) => {
  const live = fixture.state.live;
  live.program = [{ id: 'video', type: 'video', title: 'Video', mediaUrl: fixture.origin + '/fixtures/tone.wav', duration: 2 }];
  await page.goto(fixture.origin + '/broadcast/');
  await expect(page.locator('video')).toHaveJSProperty('volume', 0.4);
  await page.locator('[data-mfc-sound]').click();
  await expect(page.locator('video')).toHaveJSProperty('muted', false);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  // Cover more than two wraps of a single media item.
  await page.waitForTimeout(4800);
  await expect(page.locator('video')).toHaveJSProperty('paused', false);
  const messages = channel => page.evaluate(channel => window.postMessage({ type: 'matlock-broadcast-preview', channel }, location.origin), channel);
  await page.goto(fixture.origin + '/broadcast/?mode=draft');
  const channel = { ...live, startedAt: new Date().toISOString(), music: [{ id: 'same-id', url: fixture.origin + '/fixtures/tone.wav', duration: 2 }] };
  await messages(channel);
  await page.locator('[data-mfc-sound]').click();
  if (await page.locator('[data-mfc-sound]').getAttribute('aria-pressed') === 'false') await page.locator('[data-mfc-sound]').click();
  await expect(page.locator('audio[src$="tone.wav"]')).toHaveCount(1);
  channel.music[0].url = fixture.origin + '/fixtures/other.wav';
  await messages(channel);
  await expect(page.locator('audio[src$="other.wav"]')).toHaveCount(1);
  channel.program = [{ id: 'broken', type: 'video', mediaUrl: fixture.origin + '/missing.mp4', duration: 20 }, { id: 'fallback', type: 'headline', title: 'Still playing', duration: 20 }];
  channel.startedAt = new Date().toISOString();
  await messages(channel);
  await expect(page.locator('[data-mfc-title]')).toHaveText('STILL PLAYING');
});

test('mobile dashboard fits a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture.origin + '/broadcast/control/');
  for (const tab of ['Rundown', 'Media', 'Audio', 'Graphics']) {
    await page.getByRole('tab', { name: new RegExp(tab) }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('music repeats across tracks, ducks under video, restores smoothly, and obeys master mute', async ({ page }) => {
  const channel = structuredClone(fixture.state.live);
  channel.program = [{ id: 'clip', type: 'video', mediaUrl: fixture.origin + '/fixtures/tone.wav', duration: 20, videoAudio: true }];
  channel.music = [
    { id: 'a', url: fixture.origin + '/fixtures/tone.wav', duration: 2 },
    { id: 'b', url: fixture.origin + '/fixtures/other.wav', duration: 2 }
  ];
  channel.audio.crossfade = 0;
  fixture.state.live = channel;
  await page.goto(fixture.origin + '/broadcast/?mode=draft');
  const send = () => page.evaluate(channel => window.postMessage({ type: 'matlock-broadcast-preview', channel }, location.origin), channel);
  await send();
  await page.locator('[data-mfc-sound]').click();
  const activeVolume = () => page.locator('audio').evaluateAll(nodes => Math.max(...nodes.filter(node => !node.paused).map(node => node.volume), 0));
  await expect.poll(activeVolume).toBeCloseTo(0.054, 2);
  await page.waitForTimeout(4500);
  await expect(page.locator('audio[src]')).toHaveCount(2);
  expect(await page.locator('audio').evaluateAll(nodes => nodes.some(node => !node.paused && !node.error))).toBe(true);
  channel.audio.videoMusic = 'mute'; await send();
  await expect.poll(activeVolume).toBeLessThan(0.005);
  channel.audio.videoMusic = 'keep'; await send();
  await expect.poll(activeVolume).toBeCloseTo(0.3, 2);
  channel.audio.master = 0; await send();
  await expect.poll(activeVolume).toBe(0);
  await expect(page.locator('video')).toHaveJSProperty('volume', 0);
});

test('blocked monitor audio has a visible recovery control instead of falsely saying Listening', async ({ page }) => {
  fixture.state.draft.music = [{ id: 'bed', url: fixture.origin + '/fixtures/tone.wav', duration: 2 }];
  await page.addInitScript(() => {
    const original = HTMLMediaElement.prototype.play;
    let denied = false;
    HTMLMediaElement.prototype.play = function () {
      if (this.tagName === 'AUDIO' && !denied) { denied = true; return Promise.reject(new DOMException('Test autoplay block', 'NotAllowedError')); }
      return original.call(this);
    };
  });
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.locator('[data-preview-audio]').click();
  await expect(page.locator('[data-preview-audio]')).toHaveAttribute('aria-pressed', 'false');
  const sound = page.frameLocator('[data-preview-frame]').locator('[data-mfc-sound]');
  await expect(sound).toBeVisible();
  await sound.click();
  await expect(sound).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-preview-audio]')).toHaveAttribute('aria-pressed', 'true');
});
