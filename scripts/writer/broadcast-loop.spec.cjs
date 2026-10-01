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

test('music URLs accept YouTube links, manual duration fallbacks and direct media', async ({ page }) => {
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
  await page.locator('[data-music-url-title]').fill('YouTube music test');
  await page.locator('[data-music-url-duration]').fill('4:12');
  await page.locator('[data-confirm-music-url]').click();
  await expect(page.locator('[data-url-dialog]')).toBeHidden();
  await expect(page.locator('[data-music-id]')).toHaveCount(2);

  await page.locator('[data-add-music-url]').click();
  await page.locator('[data-music-url]').fill('https://cdn.example.test/music-bed.mp3');
  await page.locator('[data-music-url-duration]').fill('3:15');
  await page.locator('[data-confirm-music-url]').click();
  await expect(page.locator('[data-url-dialog]')).toBeHidden();
  await expect(page.locator('[data-music-id]')).toHaveCount(3);

  await page.locator('[data-add-music-url]').click();
  await page.locator('[data-music-url]').fill(fixture.origin + '/fixtures/tone.wav');
  await page.locator('[data-confirm-music-url]').click();
  await expect(page.locator('[data-url-dialog]')).toBeHidden();
  await expect(page.locator('[data-music-id]')).toHaveCount(4);

  await page.locator('[data-take-live]').click();
  await expect.poll(() => fixture.state.live.music.length).toBe(4);
  expect(fixture.state.live.music[1]).toMatchObject({
    url: 'https://youtu.be/T5umkDLypsw',
    youtubeId: 'T5umkDLypsw',
    sourceType: 'youtube',
    duration: 252
  });
  expect(fixture.state.live.music[2]).toMatchObject({ url: 'https://cdn.example.test/music-bed.mp3', duration: 195 });
  expect(fixture.state.live.music[3].duration).toBe(2);
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

test('unsaved draft survives refresh, restores only Preview, and clears its backup after save', async ({ page }) => {
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Graphics/ }).click();
  await page.locator('[data-ticker-input]').fill('Recovered local ticker');
  await expect(page.locator('[data-recovery-status]')).toContainText('backed up');
  await page.reload();
  await expect(page.locator('[data-recovery-panel]')).toBeVisible();
  expect(fixture.controls.writes).toBe(0);
  await page.locator('[data-restore-recovery]').click();
  await expect(page.locator('[data-ticker-input]')).toHaveValue('Recovered local ticker');
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
  expect(fixture.state.live.ticker[0]).toBe('LOCAL TEST PREVIEW');
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  await expect(page.locator('[data-recovery-status]')).toContainText('saved to your account');
  await page.reload();
  await expect(page.locator('[data-recovery-panel]')).toBeHidden();
  await expect(page.locator('[data-ticker-input]')).toHaveValue('Recovered local ticker');
});

test('recovery warns when remote changed and explicit Reload discards local edits', async ({ page }) => {
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Graphics/ }).click();
  await page.locator('[data-ticker-input]').fill('Local work');
  await expect(page.locator('[data-recovery-status]')).toContainText('backed up');
  fixture.state.draft.ticker = ['New remote draft'];
  fixture.state = structuredClone(fixture.state);
  await page.reload();
  await expect(page.locator('[data-recovery-panel]')).toBeVisible();
  await expect(page.locator('[data-recovery-detail]')).toContainText('saved draft has changed');
  await page.locator('[data-discard-recovery]').click();
  await expect(page.locator('[data-ticker-input]')).toHaveValue('New remote draft');
  await page.locator('[data-ticker-input]').fill('Discard this local work');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-reload-state]').click();
  await expect(page.locator('[data-ticker-input]')).toHaveValue('New remote draft');
  await expect(page.locator('[data-recovery-panel]')).toBeHidden();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
});

test('undo and redo restore removed blocks and preserve saved-state tracking', async ({ page }) => {
  await page.goto(fixture.origin + '/broadcast/control/');
  await expect(page.locator('[data-undo]')).toBeDisabled();
  await page.locator('[data-add-program="headline"]').click();
  await expect(page.locator('[data-program-id]')).toHaveCount(2);
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  await page.locator('[data-delete-program]').click();
  await expect(page.locator('[data-program-id]')).toHaveCount(1);
  await page.locator('[data-undo]').click();
  await expect(page.locator('[data-program-id]')).toHaveCount(2);
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  await page.locator('[data-redo]').click();
  await expect(page.locator('[data-program-id]')).toHaveCount(1);
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
  await page.locator('[data-undo]').click();
  await page.locator('[data-add-program="results"]').click();
  await expect(page.locator('[data-redo]')).toBeDisabled();
  expect(fixture.state.live.program.length).toBe(1);
});

test('large library pages remain searchable and bulk add covers every page', async ({ page }) => {
  for (let index = 0; index < 85; index++) fixture.assets.push({
    id: index + 1, name: `broadcast-audio-Song-${String(index).padStart(3, '0')}.wav`,
    url: fixture.origin + `/fixtures/tone.wav?track=${index}`, duration: 2, size: 32044
  });
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Media/ }).click();
  await expect(page.locator('.mfc-video-asset')).toHaveCount(40);
  await expect(page.locator('[data-library-page-label]')).toHaveText('Page 1 of 3');
  await page.locator('[data-library-next]').click();
  await expect(page.locator('[data-library-page-label]')).toHaveText('Page 2 of 3');
  await page.locator('[data-video-library-search]').fill('Song 084');
  await expect(page.locator('.mfc-video-asset')).toHaveCount(1);
  await expect(page.locator('.mfc-video-asset-title')).toHaveText('Song 084');
  await page.locator('[data-video-library-search]').fill('');
  await expect(page.locator('[data-library-page-label]')).toHaveText('Page 1 of 3');
  await page.locator('[data-library-add-all]').click();
  await expect(page.locator('[data-music-id]')).toHaveCount(85);
  await expect(page.locator('[data-save-draft]')).toBeEnabled();
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  expect(fixture.state.draft.music.length).toBe(85);
});

test('Take Live validation stays functional without tutorial panels', async ({ page }) => {
  fixture.state.draft.program.push({ id: 'missing-video', type: 'video', title: 'Missing clip', duration: 0, mediaUrl: '' });
  fixture.state.draft.music.push({ id: 'missing-song', title: 'Missing song', duration: 0, url: '' });
  await page.goto(fixture.origin + '/broadcast/control/');
  await expect(page.locator('[data-readiness]')).toHaveCount(0);
  await expect(page.locator('.mfc-workflow-guide')).toHaveCount(0);
  await page.locator('[data-take-live]').click();
  expect(fixture.controls.writes).toBe(0);
  await expect(page.locator('[data-toast]')).toContainText('Cannot Take Live: Missing clip');
  await expect(page.locator('[data-workspace-tab="rundown"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-program-editor-title]')).toHaveText('Missing clip');
});

test('late metadata cannot overwrite an undone media URL edit', async ({ page }) => {
  fixture.state.draft.program = [{ id: 'clip', type: 'video', title: 'Clip', mediaUrl: fixture.origin + '/fixtures/tone.wav', duration: 2 }];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/fixtures/other.wav', async route => { await gate; await route.continue(); });
  await page.goto(fixture.origin + '/broadcast/control/');
  const url = page.locator('[data-program-fields]').getByLabel('Video URL');
  await url.fill(fixture.origin + '/fixtures/other.wav');
  await url.press('Tab');
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
  await page.locator('[data-undo]').click();
  release();
  await expect(page.locator('[data-program-fields]').getByLabel('Video URL')).toHaveValue(fixture.origin + '/fixtures/tone.wav');
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  // Allow the old read to complete, then verify it did not generate a new edit.
  await page.waitForTimeout(500);
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  await expect(page.locator('[data-redo]')).toBeEnabled();
});

test('local storage failure does not stop editing or saving', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('matlock-broadcast-control:recovery:')) throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Graphics/ }).click();
  await page.locator('[data-ticker-input]').fill('Still save this');
  await expect(page.locator('[data-recovery-status]')).toContainText('Local recovery unavailable');
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  expect(fixture.state.draft.ticker).toEqual(['Still save this']);
});

test('stop bulk add keeps successful items and leaves remaining files unused', async ({ page }) => {
  for (let index = 0; index < 80; index++) fixture.assets.push({
    id: index + 1, name: `broadcast-audio-Track-${index}.wav`,
    url: fixture.origin + `/fixtures/tone.wav?track=${index}`, duration: 2
  });
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Media/ }).click();
  await expect(page.locator('.mfc-video-asset')).toHaveCount(40);
  await page.locator('[data-library-add-all]').click();
  await page.locator('[data-library-stop]').click();
  await expect(page.locator('[data-library-stop]')).toBeHidden();
  await expect(page.locator('[data-save-draft]')).toBeEnabled();
  const added = await page.locator('[data-music-id]').count();
  expect(added).toBeGreaterThan(0);
  expect(added).toBeLessThan(80);
  await expect(page.locator('[data-toast]')).toContainText('remaining files stay in the library');
});
