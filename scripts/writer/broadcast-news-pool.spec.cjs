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
  await expect(page.locator('.mfc-news-card')).toHaveCount(4);
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

test('Japanese MMA keeps the original headline visible beside the literal English translation', async ({ page }) => {
  await openPool(page);
  const card = page.locator('[data-news-id="jp-article-1"]');
  await expect(card).toContainText('RIZIN title fight announced for Nagasaki');
  await expect(card.locator('.mfc-news-original')).toHaveText('RIZIN長崎大会でタイトル戦が決定');
  await expect(card.locator('.mfc-news-meta')).toContainText('JP · literal MT');
  await page.locator('[data-news-search]').fill('長崎大会');
  await expect(page.locator('.mfc-news-card')).toHaveCount(1);
  await expect(page.locator('[data-news-source]')).toContainText('MMAPLANET');
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
  await page.locator('[data-news-unused]').check();
  await expect(page.locator('.mfc-news-card')).toHaveCount(2);
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

test('Refresh button requests a real news rebuild and waits for the new snapshot', async ({ page }) => {
  await openPool(page);
  expect(fixture.controls.newsRefreshes).toBe(0);
  await page.locator('[data-news-refresh]').click();
  await expect.poll(() => fixture.controls.newsRefreshes).toBe(1);
  await expect(page.locator('[data-news-status]'), { timeout: 10000 }).toContainText('Fresh news loaded');
  await expect(page.locator('[data-news-refresh]')).toBeEnabled();
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
  await expect(page.locator('.mfc-news-card')).toHaveCount(4);
});

test('mobile pool has no horizontal overflow and preview is at least 200 pixels tall', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await openPool(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-news-id="abcdefghijk"]').getByRole('button', { name: 'Preview video' }).click();
  const box = await page.locator('[data-news-preview] iframe').boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(200); expect(box.height).toBeGreaterThanOrEqual(200);
});

test('late viewers join the same live program, ticker phase and world-clock zone', async ({ browser }) => {
  fixture.state = {
    ...fixture.state,
    live: {
      ...fixture.state.live,
      revision: 'global-sync-test',
      startedAt: new Date(Date.now() - 15000).toISOString(),
      updatedAt: new Date().toISOString(),
      program: [
        { id: 'sync-a', type: 'headline', title: 'SYNC A', body: 'First block', duration: 10 },
        { id: 'sync-b', type: 'headline', title: 'SYNC B', body: 'Second block', duration: 10 },
        { id: 'sync-c', type: 'headline', title: 'SYNC C', body: 'Third block', duration: 10 }
      ],
      ticker: [
        'ONE',
        'TWO',
        'THREE',
        'FOUR',
        'FIVE'
      ],
      tickerSpeed: 1
    }
  };

  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto(fixture.origin + '/broadcast/');
  await expect(first.locator('html')).not.toHaveClass(/mfc-booting/);
  await expect(first.locator('[data-mfc-title]')).toHaveText('SYNC B');

  await first.waitForTimeout(1200);
  const second = await context.newPage();
  await second.goto(fixture.origin + '/broadcast/');
  await expect(second.locator('html')).not.toHaveClass(/mfc-booting/);
  await expect(second.locator('[data-mfc-title]')).toHaveText('SYNC B');

  const [firstState, secondState] = await Promise.all([first, second].map(page => page.evaluate(() => {
    const track = document.querySelector('[data-mfc-ticker-track]');
    const clock = document.querySelector('[data-mfc-clock]');
    const transform = new DOMMatrixReadOnly(getComputedStyle(track).transform);
    return {
      x: transform.m41,
      delay: parseFloat(getComputedStyle(track).animationDelay),
      duration: parseFloat(getComputedStyle(track).animationDuration),
      zone: clock.dataset.zone
    };
  })));

  expect(firstState.delay).toBeLessThan(0);
  expect(secondState.delay).toBeLessThan(0);
  expect(firstState.duration).toBeGreaterThan(0);
  expect(secondState.duration).toBeCloseTo(firstState.duration, 1);
  expect(Math.abs(firstState.x - secondState.x)).toBeLessThan(24);
  expect(secondState.zone).toBe(firstState.zone);

  await context.close();
});

test('broadcast remains hidden until live state and WeatherSTAR fonts are ready', async ({ page }) => {
  await page.route('**/assets/uploads/broadcast.json*', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });

  const navigation = page.goto(fixture.origin + '/broadcast/', { waitUntil: 'domcontentloaded' });
  await navigation;
  await expect(page.locator('html')).toHaveClass(/mfc-booting/);
  await expect(page.locator('[data-mfc-root]')).toHaveCSS('visibility', 'hidden');
  await expect(page.locator('html')).not.toHaveClass(/mfc-booting/, { timeout: 10000 });
  await expect(page.locator('[data-mfc-root]')).toHaveCSS('visibility', 'visible');
});

test('complete five-item ticker sequence loops without a dead zone', async ({ page }) => {
  const ticker = [
    'Onosato Overcomes Late Wobble To Win Yusho',
    'Jose Aldo advises Conor McGregor to undergo ‘dietary re-education’ before taking another UFC fight',
    'Canelo Alvarez set for WBC super middleweight title fight in October',
    'UFC Headed Back to Sydney, Australia in Feb. 2027',
    'UFC 332’s King Green names BMF title as ‘ultimate honor’: ‘I wanna earn my shot’'
  ];
  fixture.state = {
    ...fixture.state,
    live: {
      ...fixture.state.live,
      revision: 'ticker-five-item-test',
      ticker,
      tickerSpeed: .4,
      startedAt: new Date().toISOString()
    }
  };

  await page.goto(fixture.origin + '/broadcast/');
  const first = page.locator('[data-mfc-ticker]');
  const clone = page.locator('[data-mfc-ticker-clone]');
  await expect(first).toContainText(ticker[0]);
  await expect(first).toContainText(ticker[4]);
  await expect(clone).toContainText(ticker[2]);

  const metrics = await page.evaluate(() => {
    const first = document.querySelector('[data-mfc-ticker]');
    const clone = document.querySelector('[data-mfc-ticker-clone]');
    const track = document.querySelector('[data-mfc-ticker-track]');
    const firstBox = first.getBoundingClientRect();
    const cloneBox = clone.getBoundingClientRect();
    const style = getComputedStyle(track);
    return {
      sequenceWidth: first.offsetWidth,
      cloneGap: Math.abs(cloneBox.left - firstBox.right),
      distance: Math.abs(parseFloat(style.getPropertyValue('--mfc-ticker-distance'))),
      duration: parseFloat(style.animationDuration),
      paddingRight: parseFloat(getComputedStyle(first).paddingRight),
      stageWidth: document.querySelector('[data-mfc-screen]').clientWidth
    };
  });

  expect(metrics.cloneGap).toBeLessThan(1.5);
  expect(metrics.distance).toBeCloseTo(metrics.sequenceWidth, 0);
  expect(metrics.paddingRight).toBeLessThan(metrics.stageWidth * .1);
  expect(metrics.duration).toBeGreaterThan(8);
});

test('Fight City Forecast renders shared local weather in the live program', async ({ page }) => {
  fixture.state = {
    ...fixture.state,
    live: {
      ...fixture.state.live,
      revision: 'fight-city-weather-test',
      startedAt: new Date().toISOString(),
      program: [{
        id: 'fight-city-test',
        type: 'weather',
        header: 'FIGHT CITY FORECAST',
        eyebrow: 'LOCAL WEATHER',
        title: 'FIGHT CITY FORECAST',
        duration: 48
      }]
    }
  };

  await page.goto(fixture.origin + '/broadcast/');
  await expect(page.locator('[data-mfc-weather]')).toBeVisible();
  await expect(page.locator('[data-mfc-copy]')).toBeHidden();
  await expect(page.locator('[data-mfc-header]')).toHaveText('FIGHT CITY FORECAST');
  await expect(page.locator('[data-mfc-weather-screen]')).toContainText('Current Conditions');
  await expect(page.locator('[data-mfc-weather-screen]')).toContainText('Salt Lake City');
  await expect(page.locator('[data-mfc-weather-screen]')).toContainText('61°');
  await expect(page.locator('[data-mfc-weather-source]')).toContainText('OPEN-METEO');
});

test('Fight City Forecast advances through fight-day, extended and regional screens on the shared timeline', async ({ page }) => {
  const startedAt = new Date(Date.now() - 17000).toISOString();
  fixture.state = {
    ...fixture.state,
    live: {
      ...fixture.state.live,
      revision: 'fight-city-pages-test',
      startedAt,
      program: [{
        id: 'fight-city-pages',
        type: 'weather',
        header: 'FIGHT CITY FORECAST',
        eyebrow: 'LOCAL WEATHER',
        title: 'FIGHT CITY FORECAST',
        duration: 48
      }]
    }
  };

  await page.goto(fixture.origin + '/broadcast/');
  await expect(page.locator('[data-mfc-weather-screen]')).toContainText('Fight Day Forecast');
  await expect(page.locator('[data-mfc-weather-screen]')).toContainText('MAIN CARD 6:00 PM MDT');
  await expect(page.locator('[data-mfc-weather-screen]')).toContainText('HIGH 84°');

  fixture.state = {
    ...fixture.state,
    live: {
      ...fixture.state.live,
      revision: 'fight-city-extended-test',
      startedAt: new Date(Date.now() - 26000).toISOString()
    }
  };
  await page.reload();
  await expect(page.locator('[data-mfc-weather-screen]')).toContainText('Extended Forecast');
  await expect(page.locator('[data-mfc-weather-screen]')).toContainText('FIGHT DAY');

  fixture.state = {
    ...fixture.state,
    live: {
      ...fixture.state.live,
      revision: 'fight-city-regional-test',
      startedAt: new Date(Date.now() - 36000).toISOString()
    }
  };
  await page.reload();
  await expect(page.locator('[data-mfc-weather-screen]')).toContainText('Regional Forecast');
  await expect(page.locator('.mfc-wx-regional-map')).toBeVisible();
  await expect(page.locator('.mfc-wx-map-city')).toHaveCount(5);
  await expect(page.locator('.mfc-wx-map-city.is-fight-city')).toContainText('Salt Lake City');
  await expect(page.locator('.mfc-wx-map-city.is-fight-city')).toContainText('84°');
});

test('Fight City weather layouts keep titles, event slug and content in separate lanes', async ({ page }) => {
  async function showAt(seconds, revision) {
    fixture.state = {
      ...fixture.state,
      live: {
        ...fixture.state.live,
        revision,
        startedAt: new Date(Date.now() - seconds * 1000).toISOString(),
        program: [{
          id: 'fight-city-layout',
          type: 'weather',
          header: 'FIGHT CITY FORECAST',
          eyebrow: 'LOCAL WEATHER',
          title: 'FIGHT CITY FORECAST',
          duration: 48
        }]
      }
    };
    await page.reload();
    await expect(page.locator('[data-mfc-weather]')).toBeVisible();
  }

  function overlaps(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  }

  async function expectHeaderClear() {
    const layout = await page.evaluate(() => {
      const title = document.querySelector('.mfc-wx-page-title')?.getBoundingClientRect();
      const event = document.querySelector('.mfc-wx-eventline')?.getBoundingClientRect();
      const screen = document.querySelector('[data-mfc-weather-screen]')?.getBoundingClientRect();
      return {
        title: title && { left:title.left,right:title.right,top:title.top,bottom:title.bottom },
        event: event && { left:event.left,right:event.right,top:event.top,bottom:event.bottom },
        screen: screen && { left:screen.left,right:screen.right,top:screen.top,bottom:screen.bottom }
      };
    });
    expect(layout.title).toBeTruthy();
    expect(layout.event).toBeTruthy();
    expect(overlaps(layout.title, layout.event)).toBe(false);
    expect(layout.title.left).toBeGreaterThanOrEqual(layout.screen.left);
    expect(layout.event.right).toBeLessThanOrEqual(layout.screen.right + 1);
  }

  await page.goto(fixture.origin + '/broadcast/');
  await showAt(1, 'layout-current');
  await expectHeaderClear();
  const statRows = await page.locator('.mfc-wx-current-right p').evaluateAll(rows =>
    rows.map(row => ({ h: row.getBoundingClientRect().height, text: row.textContent }))
  );
  expect(statRows).toHaveLength(5);
  expect(statRows.find(row => row.text.includes('PRESSURE'))?.text).toContain('IN.');

  await showAt(13, 'layout-fightday');
  await expectHeaderClear();
  await expect(page.locator('.mfc-wx-fight-time-slot')).toHaveCount(4);
  const footerOverflow = await page.locator('.mfc-wx-fight-time').evaluate(node =>
    node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1
  );
  expect(footerOverflow).toBe(false);
  const fightTempInk = await page.locator('.mfc-wx-fight-time-slot.is-temp b').evaluate(node => {
    const r = node.getBoundingClientRect();
    const parent = node.closest('.mfc-wx-fight-time').getBoundingClientRect();
    return { top:r.top,bottom:r.bottom,parentTop:parent.top,parentBottom:parent.bottom };
  });
  expect(fightTempInk.top).toBeGreaterThanOrEqual(fightTempInk.parentTop - 1);
  expect(fightTempInk.bottom).toBeLessThanOrEqual(fightTempInk.parentBottom + 1);

  await showAt(22, 'layout-extended');
  await expectHeaderClear();
  await expect(page.locator('.mfc-wx-day')).toHaveCount(5);

  await showAt(32, 'layout-regional');
  await expectHeaderClear();
  const regionalLayout = await page.evaluate(() => {
    const map = document.querySelector('.mfc-wx-regional-map')?.getBoundingClientRect();
    const cities = [...document.querySelectorAll('.mfc-wx-map-city')].map(node => {
      const r = node.getBoundingClientRect();
      return { left:r.left,right:r.right,top:r.top,bottom:r.bottom,text:node.textContent };
    });
    return {
      map: map && { left:map.left,right:map.right,top:map.top,bottom:map.bottom },
      cities
    };
  });
  const cityRects = regionalLayout.cities;
  expect(cityRects.length).toBeLessThanOrEqual(5);
  for (const city of cityRects) {
    expect(city.left).toBeGreaterThanOrEqual(regionalLayout.map.left - 1);
    expect(city.right).toBeLessThanOrEqual(regionalLayout.map.right + 1);
    expect(city.top).toBeGreaterThanOrEqual(regionalLayout.map.top - 1);
    expect(city.bottom).toBeLessThanOrEqual(regionalLayout.map.bottom + 1);
  }
  for (let i = 0; i < cityRects.length; i += 1) {
    for (let j = i + 1; j < cityRects.length; j += 1) {
      const a = cityRects[i], b = cityRects[j];
      const width = Math.max(0, Math.min(a.right,b.right) - Math.max(a.left,b.left));
      const height = Math.max(0, Math.min(a.bottom,b.bottom) - Math.max(a.top,b.top));
      expect(width * height).toBeLessThan(120);
    }
  }

  await showAt(42, 'layout-almanac');
  await expectHeaderClear();
  const sunrise = await page.locator('.mfc-wx-sun-data p').first().evaluate(node => ({
    scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight
  }));
  expect(sunrise.scrollWidth).toBeLessThanOrEqual(sunrise.clientWidth + 1);
  expect(sunrise.scrollHeight).toBeLessThanOrEqual(sunrise.clientHeight + 1);
});

test('Broadcast Control can add a Fight City Forecast block without manual city entry', async ({ page }) => {
  await page.goto(fixture.origin + '/broadcast/control/');
  await page.getByRole('button', { name: '+ Fight City' }).click();
  const item = fixture.state.draft?.program;
  await expect(page.locator('[data-program-editor-title]')).toHaveText('FIGHT CITY FORECAST');
  await expect(page.locator('[data-program-fields]')).toContainText('automatically follows the next current UFC event');
  await expect(page.locator('[data-program-fields] input[type="number"]')).toHaveValue('48');
  await expect(page.locator('[data-draft-status]')).toHaveText('Unsaved');
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

test('YouTube link can supply the hidden continuous music bed', async ({ page }) => {
  const music = [{
    id: 'youtube-music',
    title: 'YouTube music',
    url: 'https://youtu.be/Busn5uUtBrs',
    youtubeId: 'Busn5uUtBrs',
    sourceType: 'youtube',
    duration: 240,
    gainDb: 0,
    fadeIn: 0,
    fadeOut: 0
  }];
  fixture.state = {
    ...fixture.state,
    live: {
      ...fixture.state.live,
      revision: 'youtube-music-test',
      program: [fixture.state.live.program[0]],
      music,
      startedAt: new Date().toISOString()
    }
  };

  await page.goto(fixture.origin + '/broadcast/');
  await expect(page.locator('[data-mfc-sound]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-mfc-sound]').click();

  await expect.poll(() => page.evaluate(() => window.__yt?.players.length || 0)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__yt.players[0].loads[0]?.videoId)).toBe('Busn5uUtBrs');
  await expect.poll(() => page.evaluate(() => window.__yt.players[0].muted)).toBe(false);
  expect(await page.evaluate(() => window.__yt.players[0].volume)).toBe(30);

  const hidden = await page.locator('[data-mfc-music-youtube-b]').evaluate(node => {
    const style = getComputedStyle(node);
    return style.opacity === '0' && parseFloat(style.left) < -1000;
  });
  expect(hidden).toBe(true);
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
