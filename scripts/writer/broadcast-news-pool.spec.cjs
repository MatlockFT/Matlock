const { test, expect } = require('@playwright/test');
const { startServer } = require('./broadcast-test-server.cjs');
let fixture;
// Deterministic stand-in for the external IFrame API, not a claim of real YouTube availability.
const sdk = `window.__yt = {players:[]}; window.YT = {Player: class {
  constructor(host, options) {
    this.options=options; this.state=5; this.time=0; this.since=performance.now(); this.volume=0; this.muted=true; this.seeks=[]; this.loads=[];
    this.frame=document.createElement('iframe'); this.frame.title='Mock YouTube player'; host.replaceWith(this.frame);
    window.__yt.players.push(this); setTimeout(()=>options.events.onReady(),10);
  }
  getIframe(){return this.frame} getPlayerState(){return this.state}
  getCurrentTime(){return this.time+(this.state===1?(performance.now()-this.since)/1000:0)}
  loadVideoById(value){this.loads.push(value);this.id=value.videoId;this.time=value.startSeconds;this.playVideo()}
  playVideo(){this.time=this.getCurrentTime();this.since=performance.now();this.state=1;this.options.events.onStateChange({data:1})}
  pauseVideo(){this.time=this.getCurrentTime();this.state=2}
  seekTo(value){this.seeks.push(value);this.time=value;this.since=performance.now()}
  mute(){this.muted=true} unMute(){this.muted=false} setVolume(value){this.volume=value}
}};window.onYouTubeIframeAPIReady();`;
test.beforeEach(async ({ context }) => {
  fixture = await startServer();
  await context.route('**/*', route => {
    if (route.request().url() === 'https://www.youtube.com/iframe_api') return route.fulfill({ contentType: 'text/javascript', body: sdk });
    return new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
});
test.afterEach(async () => fixture.close());
async function openPool(page) {
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('tab', { name: /News Pool/ }).click();
  await expect(page.locator('.mfc-news-card')).toHaveCount(3);
}

test('articles and full-length videos are searchable and filterable; Shorts never enter pool', async ({ page }) => {
  await openPool(page);
  await expect(page.locator('[data-news-status]')).toContainText('Videos: 1');
  await expect(page.locator('[data-news-list]')).not.toContainText('Short clip');
  await page.locator('[data-news-kind]').selectOption('video');
  await expect(page.locator('.mfc-news-card')).toHaveCount(1);
  await page.locator('[data-news-kind]').selectOption('all');
  await page.locator('[data-news-source]').selectOption('MMA Junkie');
  await expect(page.locator('.mfc-news-card')).toHaveCount(1);
  await page.locator('[data-news-search]').fill('unmatched');
  await expect(page.locator('[data-news-list]')).toContainText('No matches');
  await page.locator('[data-news-search]').fill('UFC');
  await expect(page.locator('.mfc-news-card')).toHaveCount(1);
  await page.locator('.mfc-news-card a').click({ trial: true });
  expect(await page.locator('.mfc-news-card a').getAttribute('href')).toBe('https://example.com/event');
});

test('quick additions preserve source metadata, prevent duplicates, undo, save and reload without publishing', async ({ page }) => {
  await openPool(page);
  const article = page.locator('[data-news-id="article-1"]');
  await article.getByRole('button', { name: 'Add headline' }).click();
  await expect(article.getByRole('button', { name: 'In draft' })).toBeDisabled();
  await page.locator('[data-undo]').click();
  await expect(article.getByRole('button', { name: 'Add headline' })).toBeEnabled();
  await page.locator('[data-redo]').click();
  await article.getByRole('button', { name: 'Add to ticker' }).click();
  await expect(article.getByRole('button', { name: 'In ticker' })).toBeDisabled();
  await page.locator('[data-news-id="abcdefghijk"]').getByRole('button', { name: 'Add video', exact: true }).click();
  await expect(page.locator('[data-readiness-summary]')).toContainText('Loop settings ready');
  await page.locator('[data-news-unused]').check();
  await expect(page.locator('.mfc-news-card')).toHaveCount(1);
  await page.locator('[data-save-draft]').click();
  await expect(page.locator('[data-draft-status]')).toHaveText('Saved');
  expect(fixture.state.draft.program).toHaveLength(3); expect(fixture.state.live.program).toHaveLength(1);
  expect(fixture.state.draft.program[1]).toMatchObject({ source: 'MMA Fighting', sourceUrl: 'https://example.com/title-fight', eyebrow: 'MMA Fighting', duration: 20 });
  expect(fixture.state.draft.program[2]).toMatchObject({ type: 'youtube', youtubeId: 'abcdefghijk', duration: 300, sourceDuration: 300, musicBehavior: 'duck' });
  expect(fixture.state.draft.ticker).toContain('Local fighter returns for title fight — MMA Fighting');
  await page.reload(); await page.getByRole('tab', { name: /News Pool/ }).click();
  await expect(article.getByRole('button', { name: 'In draft' })).toBeDisabled();
  await expect(page.locator('[data-news-id="abcdefghijk"]').getByRole('button', { name: 'In draft' })).toBeDisabled();
});

test('refresh failure retains loaded items; video preview stops when closed', async ({ page }) => {
  await openPool(page);
  await page.locator('[data-news-id="abcdefghijk"]').getByRole('button', { name: 'Preview video' }).click();
  await expect(page.locator('[data-news-preview] iframe')).toHaveAttribute('src', /youtube-nocookie.com\/embed\/abcdefghijk/);
  await expect(page.locator('[data-news-preview] iframe')).toHaveAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  await page.locator('[data-news-preview-close]').click();
  await expect(page.locator('[data-news-preview] iframe')).toHaveCount(0);
  fixture.controls.newsFailure = true;
  await page.locator('[data-news-refresh]').click();
  await expect(page.locator('[data-news-status]')).toContainText('Keeping previously loaded items');
  await expect(page.locator('.mfc-news-card')).toHaveCount(3);
});

test('mobile pool has no horizontal overflow and preview is at least 200 pixels tall', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openPool(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-news-id="abcdefghijk"]').getByRole('button', { name: 'Preview video' }).click();
  const box = await page.locator('[data-news-preview] iframe').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(200); expect(box.height).toBeGreaterThanOrEqual(200);
});

test('visible YouTube player loops, uses mixer volume, reports autoplay blocks and skips failed embeds', async ({ page }) => {
  const item = { id: 'youtube-test', type: 'youtube', title: 'Test interview', youtubeId: 'abcdefghijk', mediaUrl: 'https://www.youtube.com/watch?v=abcdefghijk', sourceDuration: 300, duration: 2, videoAudio: true };
  fixture.state = { ...fixture.state, live: { ...fixture.state.live, program: [item], startedAt: new Date().toISOString() } };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixture.origin + '/broadcast/');
  await expect(page.locator('[data-mfc-youtube] iframe')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__yt?.players[0]?.loads.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__yt.players[0].seeks.length), { timeout: 6000 }).toBeGreaterThan(0);
  const box = await page.locator('[data-mfc-youtube] iframe').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(200); expect(box.width).toBeGreaterThanOrEqual(200);
  await page.locator('[data-mfc-sound]').click();
  await expect.poll(() => page.evaluate(() => window.__yt.players[0].muted)).toBe(false);
  expect(await page.evaluate(() => window.__yt.players[0].volume)).toBe(40);
  await page.evaluate(() => window.__yt.players[0].options.events.onAutoplayBlocked());
  await expect(page.locator('[data-mfc-sound]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-mfc-playback-status]')).toContainText('autoplay was blocked');
  await page.evaluate(() => window.__yt.players[0].options.events.onError({ data: 101 }));
  await expect(page.locator('[data-mfc-title]')).toHaveText('NO PROGRAMMING');
  expect(await page.evaluate(() => window.__yt.players[0].state)).toBe(2);
});

test('YouTube news can be trimmed, muted and taken live; blocked SDK falls through to other content', async ({ page }) => {
  await openPool(page);
  await page.locator('[data-news-id="abcdefghijk"]').getByRole('button', { name: 'Add video', exact: true }).click();
  await page.getByRole('tab', { name: /Rundown/ }).click();
  await page.getByLabel('Playback duration (min:sec)', { exact: true }).fill('0:02');
  await page.getByLabel('Playback duration (min:sec)', { exact: true }).press('Tab');
  await page.getByRole('combobox', { name: 'Video audio', exact: true }).selectOption('off');
  await page.locator('[data-take-live]').click();
  await expect.poll(() => fixture.state.live.program.length).toBe(2);
  expect(fixture.state.live.program[1]).toMatchObject({ duration: 2, sourceDuration: 300, videoAudio: false });
  // An unavailable SDK cannot freeze the loop on this item.
  fixture.state = { ...fixture.state, live: { ...fixture.state.live, revision: 'sdk-fail', startedAt: new Date().toISOString(), program: [fixture.state.live.program[1], fixture.state.live.program[0]] } };
  await page.route('https://www.youtube.com/iframe_api', route => route.abort());
  await page.goto(fixture.origin + '/broadcast/');
  await expect(page.locator('[data-mfc-title]')).toHaveText('LOCAL TEST CHANNEL');
});

test('long attributed headline and excerpt fit the broadcast panel on mobile', async ({ page }) => {
  fixture.state = { ...fixture.state, live: { ...fixture.state.live, program: [{ id: 'long-news', type: 'headline',
    title: 'A lengthy fight announcement with several fighter names and event details included for an attributed news headline',
    body: 'This article excerpt includes useful background about the event, several details about the fighters, and enough context for viewers to understand the story while the broadcast continues through its rotating news feed.',
    sourceUrl: 'https://example.com/story', eyebrow: 'MMA Fighting', duration: 20 }], startedAt: new Date().toISOString() } };
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(fixture.origin + '/broadcast/');
  await expect(page.locator('[data-mfc-title]')).toContainText('A LENGTHY FIGHT');
  await expect.poll(() => page.locator('[data-mfc-panel]').evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
  expect(await page.locator('[data-mfc-body]').evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(9);
});
