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

test('Image blocks can upload a still image and keep it in the selected draft block', async ({ page }) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );

  await page.goto(fixture.origin + '/broadcast/control/');
  await page.locator('[data-add-program="image"]').click();
  await expect(page.locator('[data-program-image-upload]')).toHaveCount(1);

  await page.locator('[data-program-image-upload]').setInputFiles({
    name: 'Fight Card.png',
    mimeType: 'image/png',
    buffer: png
  });

  await expect(page.locator('[data-upload-results]')).toContainText('Fight Card.png — Ready in draft', { timeout: 20000 });
  const imageUrl = page.locator('[data-program-fields]').getByLabel('Image URL', { exact: true });
  await expect(imageUrl).toHaveValue(/raw\.githubusercontent\.com\/MatlockFT\/Matlock\/main\/assets\/uploads\/broadcast\/images\/.*broadcast-image-Fight-Card-.*\.png$/);
  await expect(page.locator('[data-video-library-list] .mfc-video-asset')).toContainText('Image');

  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  const saved = fixture.state.draft.program.at(-1);
  expect(saved.type).toBe('image');
  expect(saved.mediaUrl).toMatch(/raw\.githubusercontent\.com\/MatlockFT\/Matlock\/main\/assets\/uploads\/broadcast\/images\/.*broadcast-image-Fight-Card-.*\.png$/);
  expect(saved.duration).toBe(20);
});

test('image framing controls change fit, zoom and position in Preview and persist to draft', async ({ page }) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGP8//8/AwwwMSABFA4Aby0DAyMYAwQAAAAASUVORK5CYII=',
    'base64'
  );
  fixture.media.set('/fixtures/framing.png', { data: png, type: 'image/png' });
  fixture.state.draft.program = [{
    id: 'framing-image',
    type: 'image',
    header: 'MMA NEWS',
    eyebrow: 'PHOTO',
    title: 'FRAMING TEST',
    mediaUrl: fixture.origin + '/fixtures/framing.png',
    duration: 20,
    mediaFit: 'cover',
    mediaScale: 100,
    mediaX: 50,
    mediaY: 50
  }];

  await page.goto(fixture.origin + '/broadcast/control/');
  const fit = page.getByLabel('Media fit', { exact: true });
  const zoom = page.getByLabel('Zoom', { exact: true });
  const x = page.getByLabel('Horizontal position', { exact: true });
  const y = page.getByLabel('Vertical position', { exact: true });

  await fit.selectOption('contain');
  await zoom.fill('150');
  await x.fill('25');
  await y.fill('75');

  const preview = page.frameLocator('[data-preview-frame]');
  const image = preview.locator('[data-mfc-image]');
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS('object-fit', 'contain');
  await expect(image).toHaveCSS('object-position', '25% 75%');
  await expect(image).toHaveCSS('transform', /matrix\(1\.5, 0, 0, 1\.5, 0, 0\)/);

  await fit.selectOption('cover');
  await zoom.fill('100');
  const coverBase = await image.evaluate(node => Number(node.dataset.mediaBaseScale || 1));
  expect(coverBase).toBeGreaterThan(1);
  const coverScale = await image.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).a);
  expect(coverScale).toBeGreaterThan(1);

  await zoom.fill('75');
  const zoomedOutScale = await image.evaluate(node => new DOMMatrix(getComputedStyle(node).transform).a);
  expect(zoomedOutScale).toBeLessThan(coverScale);
  expect(zoomedOutScale).toBeLessThanOrEqual(1.01);

  await fit.selectOption('contain');
  await zoom.fill('150');

  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  expect(fixture.state.draft.program[0]).toMatchObject({
    mediaFit: 'contain',
    mediaScale: 150,
    mediaX: 25,
    mediaY: 75
  });

  await page.getByRole('button', { name: 'Reset framing' }).click();
  await expect(fit).toHaveValue('contain');
  await expect(page.getByLabel('Zoom', { exact: true })).toHaveValue('100');
  await expect(page.getByLabel('Horizontal position', { exact: true })).toHaveValue('50');
  await expect(page.getByLabel('Vertical position', { exact: true })).toHaveValue('50');

  const box = await image.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .35, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByLabel('Horizontal position', { exact: true }).inputValue())).toBeGreaterThan(50);
  await expect.poll(async () => Number(await page.getByLabel('Vertical position', { exact: true }).inputValue())).toBeGreaterThan(50);
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
});

test('video inspector queues caption generation and keeps captions enabled', async ({ page }) => {
  fixture.state.draft.program = [{
    id: 'caption-video',
    type: 'video',
    title: 'Caption video',
    mediaUrl: fixture.origin + '/fixtures/tone.wav',
    duration: 2,
    videoAudio: true,
    captionKey: 'broadcast-video-caption-test-20261002030000000',
    captionsEnabled: true
  }];

  await page.goto(fixture.origin + '/broadcast/control/');
  await expect(page.getByLabel('Auto captions', { exact: true })).toHaveValue('on');
  await page.getByRole('button', { name: 'Regenerate captions' }).click();
  await expect.poll(() => fixture.controls.captionQueues).toBe(1);
  await expect(page.locator('[data-caption-status]')).toContainText('Captions queued');
  expect(fixture.captionRequests.size).toBe(1);
  const request = [...fixture.captionRequests.values()][0].payload;
  expect(request).toMatchObject({
    key: 'broadcast-video-caption-test-20261002030000000',
    sourceUrl: fixture.origin + '/fixtures/tone.wav'
  });
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
});

test('generated WebVTT captions render over uploaded video at the correct time', async ({ page }) => {
  const captionVtt = 'WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.600\nTHIS IS AN AUTO CAPTION\n\n2\n00:00:01.600 --> 00:00:02.000\nSECOND LINE\n';
  await page.route('https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/uploads/broadcast/captions/caption-render-test.vtt*', route => {
    route.fulfill({ status: 200, contentType: 'text/vtt', body: captionVtt });
  });
  fixture.state.draft.program = [{
    id: 'caption-render-video',
    type: 'video',
    title: 'Caption render',
    mediaUrl: fixture.origin + '/fixtures/tone.wav',
    duration: 2,
    videoAudio: false,
    captionKey: 'caption-render-test',
    captionRevision: 1,
    captionsEnabled: true
  }];
  fixture.state.draft.startedAt = new Date().toISOString();

  await page.goto(fixture.origin + '/broadcast/?mode=draft');
  const captions = page.locator('[data-mfc-captions]');
  await expect(captions).toBeVisible({ timeout: 5000 });
  await expect(captions).toHaveAttribute('data-caption-text', /AUTO CAPTION|SECOND LINE/);

  fixture.state.draft.program[0].captionsEnabled = false;
  fixture.state.draft.revision = 'caption-off-' + Date.now();
  await page.evaluate(channel => window.postMessage({ type: 'matlock-broadcast-preview', channel }, location.origin), fixture.state.draft);
  await expect(captions).toBeHidden();
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

test('ticker queue supports inline editing, add, duplicate, delete and drag reorder', async ({ page }) => {
  fixture.state.draft.ticker = ['FIRST HEADLINE', 'SECOND HEADLINE', 'THIRD HEADLINE'];
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Graphics/ }).click();

  const rows = page.locator('.mfc-ticker-row');
  await expect(rows).toHaveCount(3);
  await expect(page.locator('[data-ticker-count]')).toHaveText('3 headlines');

  await page.locator('.mfc-ticker-row-input').nth(1).fill('SECOND EDITED');
  expect(fixture.state.draft.ticker[1]).toBe('SECOND HEADLINE');
  await expect(page.locator('[data-ticker-preview]')).toContainText('SECOND EDITED');

  await page.locator('[data-ticker-add]').click();
  await expect(rows).toHaveCount(4);
  await page.locator('.mfc-ticker-row-input').nth(3).fill('FOURTH HEADLINE');

  await rows.nth(0).getByRole('button', { name: 'Duplicate' }).click();
  await expect(rows).toHaveCount(5);
  await expect(page.locator('.mfc-ticker-row-input').nth(1)).toHaveValue('FIRST HEADLINE');

  await rows.nth(1).getByRole('button', { name: 'Delete' }).click();
  await expect(rows).toHaveCount(4);

  await rows.nth(2).dragTo(rows.nth(0));
  await expect(page.locator('.mfc-ticker-row-input').first()).toHaveValue('THIRD HEADLINE');

  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  expect(fixture.state.draft.ticker).toEqual([
    'THIRD HEADLINE',
    'FIRST HEADLINE',
    'SECOND EDITED',
    'FOURTH HEADLINE'
  ]);
});

test('failed Take Live never changes Program, and edits made during Save remain unsaved', async ({ page }) => {
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Graphics/ }).click();
  await page.locator('.mfc-ticker-row-input').first().fill('First edit');
  fixture.controls.failSaves = true;
  await page.locator('[data-take-live]').click();
  await expect(page.locator('[data-toast]')).toContainText('changed remotely');
  expect(fixture.state.live.ticker[0]).toBe('LOCAL TEST PREVIEW');
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
  fixture.controls.failSaves = false;
  fixture.controls.saveDelay = 600;
  await page.locator('[data-save-draft]').click();
  await page.locator('.mfc-ticker-row-input').first().fill('Edit while saving');
  await expect.poll(() => fixture.controls.writes).toBe(1);
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
  expect(fixture.state.draft.ticker).toEqual(['First edit', 'CONTINUOUS LOOP']);
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  expect(fixture.state.draft.ticker).toEqual(['Edit while saving', 'CONTINUOUS LOOP']);
});

test('Take Live lets the current loop finish and starts the new rundown at the next full wrap', async ({ page }) => {
  const runningStartedAt = new Date(Date.now() - 4_000).toISOString();
  const oldProgram = [
    { id: 'old-first', type: 'headline', title: 'OLD FIRST', body: 'Old item', duration: 10 },
    { id: 'old-second', type: 'headline', title: 'OLD SECOND', body: 'Old item', duration: 10 }
  ];
  const music = [{ id: 'bed', title: 'Bed', url: fixture.origin + '/fixtures/tone.wav', duration: 30 }];
  fixture.state.live = {
    ...fixture.state.live,
    revision: 'live-running-loop',
    startedAt: runningStartedAt,
    program: oldProgram,
    music
  };
  fixture.state.draft = {
    ...fixture.state.draft,
    program: [
      { id: 'new-first', type: 'headline', title: 'NEW FIRST', body: 'New item', duration: 8 },
      { id: 'new-second', type: 'headline', title: 'NEW SECOND', body: 'New item', duration: 8 }
    ],
    music: structuredClone(music)
  };

  await page.goto(fixture.origin + '/broadcast/control/');
  const before = Date.now();
  await page.locator('[data-take-live]').click();
  await expect.poll(() => fixture.state.pendingLive?.program?.[0]?.title).toBe('NEW FIRST');

  expect(fixture.state.live.program[0].title).toBe('OLD FIRST');
  expect(fixture.state.pendingLive.programStartedAt).toBe(fixture.state.programTransitionAt);
  expect(fixture.state.pendingLive.musicStartedAt).toBe(runningStartedAt);

  const cutAt = Date.parse(fixture.state.programTransitionAt);
  expect(cutAt).toBeGreaterThan(before + 14_000);
  expect(cutAt).toBeLessThan(before + 20_000);
  await expect(page.locator('[data-toast]')).toContainText('current live loop will finish');
});

test('mid-loop changes do not send viewers back to Block 1 early', async ({ page }) => {
  const now = Date.now();
  const durations = [10, 10, 10, 10, 10, 10];
  fixture.state.live = {
    ...fixture.state.live,
    revision: 'live-on-story-five',
    startedAt: new Date(now - 43_000).toISOString(),
    program: durations.map((duration, index) => ({
      id: 'old-' + (index + 1),
      type: 'headline',
      title: 'OLD ' + (index + 1),
      duration
    })),
    music: []
  };
  fixture.state.draft = {
    ...fixture.state.draft,
    program: durations.map((duration, index) => ({
      id: 'new-' + (index + 1),
      type: 'headline',
      title: index === 3 ? 'NEW 4 EDITED' : 'NEW ' + (index + 1),
      duration
    })),
    ticker: ['NEW TICKER']
  };

  await page.goto(fixture.origin + '/broadcast/control/');
  const before = Date.now();
  await page.locator('[data-take-live]').click();
  await expect.poll(() => fixture.state.pendingLive?.program?.[3]?.title).toBe('NEW 4 EDITED');

  // At 43s into a 60s loop, the staged version must wait for the 60s wrap.
  const cutAt = Date.parse(fixture.state.programTransitionAt);
  expect(cutAt).toBeGreaterThan(before + 15_000);
  expect(cutAt).toBeLessThan(before + 22_000);
  expect(fixture.state.live.program[4].title).toBe('OLD 5');
  expect(fixture.state.pendingLive.program[0].title).toBe('NEW 1');
  expect(fixture.state.pendingLive.ticker).toEqual(['NEW TICKER']);
});

test('changed music waits for its current song boundary independently of the visual cut', async ({ page }) => {
  const runningStartedAt = new Date(Date.now() - 1_000).toISOString();
  fixture.state.live = {
    ...fixture.state.live,
    revision: 'live-independent-decks',
    startedAt: runningStartedAt,
    program: [{ id: 'old-card', type: 'headline', title: 'OLD CARD', duration: 3 }],
    music: [{ id: 'old-bed', title: 'Old bed', url: fixture.origin + '/fixtures/tone.wav', duration: 8 }],
    audio: { ...fixture.state.live.audio, crossfade: 0, musicRepeat: 'fixed' }
  };
  fixture.state.draft = {
    ...fixture.state.draft,
    program: [{ id: 'new-card', type: 'headline', title: 'NEW CARD', duration: 3 }],
    music: [{ id: 'new-bed', title: 'New bed', url: fixture.origin + '/fixtures/other.wav', duration: 8 }],
    audio: { ...fixture.state.live.audio, crossfade: 0, musicRepeat: 'fixed' }
  };

  await page.goto(fixture.origin + '/broadcast/control/');
  const before = Date.now();
  await page.locator('[data-take-live]').click();
  await expect.poll(() => fixture.state.pendingLive?.music?.[0]?.id).toBe('new-bed');

  const programCut = Date.parse(fixture.state.programTransitionAt);
  const musicCut = Date.parse(fixture.state.musicTransitionAt);
  expect(programCut).toBeGreaterThan(before + 14_000);
  expect(programCut).toBeLessThan(before + 20_000);
  expect(musicCut).toBeGreaterThan(before + 14_000);
  expect(musicCut).toBeLessThan(before + 20_000);
  expect(Math.abs(musicCut - programCut)).toBeGreaterThan(250);
  expect(fixture.state.pendingLive.musicStartedAt).toBe(fixture.state.musicTransitionAt);
  await expect(page.locator('[data-toast]')).toContainText('Music changes wait for the current song to finish');
});

test('public Program adopts a staged rundown automatically at its scheduled clean cut', async ({ page }) => {
  const now = Date.now();
  fixture.state.live = {
    ...fixture.state.live,
    revision: 'old-live',
    startedAt: new Date(now - 500).toISOString(),
    programStartedAt: new Date(now - 500).toISOString(),
    musicStartedAt: new Date(now - 500).toISOString(),
    program: [{ id: 'old', type: 'headline', title: 'OLD ON AIR', duration: 20 }],
    music: []
  };
  fixture.state.pendingLive = {
    ...fixture.state.live,
    revision: 'new-live',
    startedAt: fixture.state.live.startedAt,
    programStartedAt: new Date(now + 900).toISOString(),
    musicStartedAt: fixture.state.live.musicStartedAt,
    program: [{ id: 'new', type: 'headline', title: 'NEW ON AIR', duration: 20 }]
  };
  fixture.state.programTransitionAt = fixture.state.pendingLive.programStartedAt;
  fixture.state.musicTransitionAt = fixture.state.pendingLive.programStartedAt;

  await page.goto(fixture.origin + '/broadcast/?controls=1');
  await expect(page.locator('[data-mfc-title]')).toHaveText('OLD ON AIR');
  await expect(page.locator('[data-mfc-title]')).toHaveText('NEW ON AIR', { timeout: 2500 });
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
  await page.goto(fixture.origin + '/broadcast/?controls=1');
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

test('music uses the arranged first pass, then shuffles complete passes without repeating the seam', async ({ page }) => {
  for (const [name, seconds] of [['shuffle-a.wav', .6], ['shuffle-b.wav', .6], ['shuffle-c.wav', .6]]) {
    fixture.media.set('/fixtures/' + name, { data: wav(seconds), type: 'audio/wav' });
  }

  const channel = structuredClone(fixture.state.live);
  channel.program = [{ id: 'bed-program', type: 'headline', title: 'Music shuffle test', body: 'Test', duration: 30 }];
  channel.music = [
    { id: 'a', title: 'A', url: fixture.origin + '/fixtures/shuffle-a.wav', duration: .6 },
    { id: 'b', title: 'B', url: fixture.origin + '/fixtures/shuffle-b.wav', duration: .6 },
    { id: 'c', title: 'C', url: fixture.origin + '/fixtures/shuffle-c.wav', duration: .6 }
  ];
  channel.audio.crossfade = 0;
  channel.audio.musicRepeat = 'shuffle';
  channel.startedAt = new Date().toISOString();
  fixture.state.live = channel;

  await page.goto(fixture.origin + '/broadcast/?controls=1');
  await page.locator('[data-mfc-sound]').click();
  await expect(page.locator('[data-mfc-sound]')).toHaveAttribute('aria-pressed', 'true');

  const seen = [];
  for (let attempt = 0; attempt < 55 && seen.length < 7; attempt += 1) {
    const id = await page.locator('audio').evaluateAll(nodes => {
      const active = nodes.find(node => !node.paused && node.volume > .001 && node.dataset.trackId);
      return active?.dataset.trackId?.split(':', 1)[0] || '';
    });
    if (id && seen[seen.length - 1] !== id) seen.push(id);
    await page.waitForTimeout(100);
  }

  expect(seen.slice(0, 3)).toEqual(['a', 'b', 'c']);
  const secondPass = seen.slice(3, 6);
  expect([...secondPass].sort()).toEqual(['a', 'b', 'c']);
  expect(secondPass).not.toEqual(['a', 'b', 'c']);
  expect(secondPass[0]).not.toBe('c');
  if (seen[6]) expect(seen[6]).not.toBe(secondPass[2]);
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
  await page.locator('.mfc-ticker-row-input').first().fill('Recovered local ticker');
  await expect(page.locator('[data-recovery-status]')).toContainText('backed up');
  await page.reload();
  await expect(page.locator('[data-recovery-panel]')).toBeVisible();
  expect(fixture.controls.writes).toBe(0);
  await page.locator('[data-restore-recovery]').click();
  await expect(page.locator('.mfc-ticker-row-input').first()).toHaveValue('Recovered local ticker');
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
  expect(fixture.state.live.ticker[0]).toBe('LOCAL TEST PREVIEW');
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  await expect(page.locator('[data-recovery-status]')).toContainText('saved to your account');
  await page.reload();
  await expect(page.locator('[data-recovery-panel]')).toBeHidden();
  await expect(page.locator('.mfc-ticker-row-input').first()).toHaveValue('Recovered local ticker');
});

test('recovery warns when remote changed and explicit Reload discards local edits', async ({ page }) => {
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /Graphics/ }).click();
  await page.locator('.mfc-ticker-row-input').first().fill('Local work');
  await expect(page.locator('[data-recovery-status]')).toContainText('backed up');
  fixture.state.draft.ticker = ['New remote draft'];
  fixture.state = structuredClone(fixture.state);
  await page.reload();
  await expect(page.locator('[data-recovery-panel]')).toBeVisible();
  await expect(page.locator('[data-recovery-detail]')).toContainText('saved draft has changed');
  await page.locator('[data-discard-recovery]').click();
  await expect(page.locator('.mfc-ticker-row-input').first()).toHaveValue('New remote draft');
  await page.locator('.mfc-ticker-row-input').first().fill('Discard this local work');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('[data-reload-state]').click();
  await expect(page.locator('.mfc-ticker-row-input').first()).toHaveValue('New remote draft');
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
  await page.locator('.mfc-ticker-row-input').first().fill('Still save this');
  await expect(page.locator('[data-recovery-status]')).toContainText('Local recovery unavailable');
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  expect(fixture.state.draft.ticker).toEqual(['Still save this', 'CONTINUOUS LOOP']);
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
