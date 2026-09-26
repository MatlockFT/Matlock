const { test, expect } = require('@playwright/test');
const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.SITE_BASE_URL || 'https://mmamatlock.com';
const SCREENSHOT_DIR = process.env.VISUAL_SMOKE_DIR || 'artifacts/site-visual-smoke';

const pages = [
  { slug: 'home', path: '/', ready: '[data-globe-home]' },
  { slug: 'news', path: '/news/', ready: '.news-page' },
  { slug: 'fight-cards', path: '/upcoming-events/', ready: '.upcoming-events-page' },
  { slug: 'event-map', path: '/event-map/', ready: '.event-map-page' },
  { slug: 'on-this-day', path: '/on-this-day/', ready: '.otd-page' },
  { slug: 'roster', path: '/ufc-roster/', ready: '.ufc-roster-page' },
  { slug: 'breakdowns', path: '/breakdowns/', ready: '.archive-page' },
  { slug: 'live', path: '/live/', ready: '.live-page' }
];

const viewports = [
  { name: 'desktop', width: 1365, height: 900, isMobile: false, hasTouch: false },
  { name: 'mobile-430', width: 430, height: 932, isMobile: true, hasTouch: true },
  { name: 'mobile-390', width: 390, height: 844, isMobile: true, hasTouch: true }
];

const centeredControlSelectors = [
  '.navigation-list a',
  '.home-tool-link',
  '.home-next-actions a',
  '.event-map-range button',
  '.event-map-near-button',
  '.event-map-detail-actions a',
  '.event-map-detail-actions button',
  '.otd-control-button',
  '.otd-mini-button',
  '.news-source-chip',
  '.news-show-more'
].join(',');

function targetUrl(relativePath) {
  return new URL(relativePath, BASE).toString();
}

async function waitForPage(page, entry) {
  await page.goto(targetUrl(entry.path), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await expect(page.locator(entry.ready).first()).toBeVisible({ timeout: 30000 });

  if (entry.slug === 'event-map') {
    await expect(page.locator('[data-map-loading]')).toBeHidden({ timeout: 30000 });
  } else if (entry.slug === 'news') {
    await page.waitForTimeout(1200);
  } else if (entry.slug === 'on-this-day') {
    await page.waitForFunction(() => {
      const list = document.querySelector('[data-otd-list]');
      return list && list.children.length > 0;
    }, null, { timeout: 30000 }).catch(() => {});
  } else if (entry.slug === 'roster') {
    await page.waitForFunction(() => {
      const list = document.querySelector('[data-roster-list]');
      return list && list.getAttribute('aria-busy') === 'false';
    }, null, { timeout: 30000 }).catch(() => {});
  }

  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  await page.waitForTimeout(120);
}

async function geometryReport(page) {
  return page.evaluate(selector => {
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const overflow = root.scrollWidth - viewportWidth;
    const h1 = document.querySelector('main h1, .site-main h1, h1');
    const h1Rect = h1?.getBoundingClientRect?.() || null;

    function firstTextNode(element) {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
      });
      return walker.nextNode();
    }

    const controlOffsets = [];
    for (const element of document.querySelectorAll(selector)) {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        rect.width < 1 ||
        rect.height < 1 ||
        rect.bottom < 0 ||
        rect.top > innerHeight * 2
      ) continue;

      const textNode = firstTextNode(element);
      if (!textNode) continue;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const textRect = range.getBoundingClientRect();
      if (!textRect.height) continue;

      const elementCenter = rect.top + rect.height / 2;
      const textCenter = textRect.top + textRect.height / 2;
      controlOffsets.push({
        text: (element.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 70),
        selector: element.className || element.tagName,
        offset: Number((textCenter - elementCenter).toFixed(2)),
        height: Number(rect.height.toFixed(2))
      });
    }

    return {
      viewportWidth,
      scrollWidth: root.scrollWidth,
      overflow,
      h1: h1Rect ? {
        left: h1Rect.left,
        right: h1Rect.right,
        width: h1Rect.width,
        height: h1Rect.height
      } : null,
      controlOffsets
    };
  }, centeredControlSelectors);
}

for (const viewport of viewports) {
  test.describe(`site geometry ${viewport.name}`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile,
      hasTouch: viewport.hasTouch
    });

    for (const entry of pages) {
      test(`${entry.slug} stays inside the viewport and keeps row text centered`, async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await waitForPage(page, entry);

        const report = await geometryReport(page);
        expect(report.overflow, `${entry.slug} horizontal overflow`).toBeLessThanOrEqual(2);
        if (report.h1) {
          expect(report.h1.left, `${entry.slug} h1 left edge`).toBeGreaterThanOrEqual(-2);
          expect(report.h1.right, `${entry.slug} h1 right edge`).toBeLessThanOrEqual(report.viewportWidth + 2);
          expect(report.h1.height, `${entry.slug} h1 height`).toBeGreaterThan(0);
        }

        const badOffsets = report.controlOffsets.filter(item => Math.abs(item.offset) > 8);
        expect(badOffsets, `${entry.slug} vertically off-center controls: ${JSON.stringify(badOffsets)}`).toEqual([]);
        expect(pageErrors, `${entry.slug} page errors`).toEqual([]);

        const dir = path.join(SCREENSHOT_DIR, viewport.name);
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, `${entry.slug}.png`), fullPage: false });
      });
    }

    if (viewport.name !== 'mobile-430') {
      test('representative article stays inside the viewport', async ({ page }) => {
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await page.goto(targetUrl('/breakdowns/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
        const href = await page.locator('.article-card a[href]').first().getAttribute('href');
        expect(href).toBeTruthy();
        await page.goto(targetUrl(href), { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.evaluate(() => document.fonts?.ready).catch(() => {});
        await page.waitForTimeout(120);
        const report = await geometryReport(page);
        expect(report.overflow, 'article horizontal overflow').toBeLessThanOrEqual(2);
        expect(pageErrors, 'article page errors').toEqual([]);

        const dir = path.join(SCREENSHOT_DIR, viewport.name);
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, 'article.png'), fullPage: false });
      });
    }
  });
}




test.describe('Broadcast control program monitor', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false });

  test('renders modular split desk, updates layout, and removes/restores sources', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(targetUrl('/broadcast-control/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-program-monitor-frame]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-preview-renderer]')).toHaveText('ONLINE', { timeout: 30000 });

    const previewAudio = page.locator('[data-preview-audio]');
    await expect(previewAudio).toBeVisible();
    await expect(previewAudio).toHaveAttribute('aria-pressed','true');
    await expect.poll(async () => page.locator('[data-program-monitor-frame]').evaluate(frame => frame.contentWindow.MatlockBroadcastPreview?.audioState?.().muted)).toBeTruthy();
    await previewAudio.click();
    await expect(previewAudio).toHaveAttribute('aria-pressed','false');
    await expect.poll(async () => page.locator('[data-program-monitor-frame]').evaluate(frame => frame.contentWindow.MatlockBroadcastPreview?.audioState?.().muted)).toBeFalsy();
    await expect(page.locator('[data-path="visual.layout"]')).toHaveValue('splitDesk');

    const frame = page.frameLocator('[data-program-monitor-frame]');
    await expect(frame.locator('[data-broadcast]')).toBeVisible({ timeout: 30000 });
    await expect(frame.locator('[data-stage]')).toHaveClass(/split-desk/, { timeout: 30000 });
    await expect(frame.locator('[data-video-shell]')).toBeVisible({ timeout: 30000 });
    await expect(frame.locator('.topbar')).toHaveCount(0);
    await expect(frame.locator('[data-clock]')).toHaveCount(0);
    await expect(frame.locator('body')).not.toContainText('COMBAT NEWS LIVE');

    const programFonts = await frame.locator('[data-broadcast]').evaluate(root => {
      const seen = new Set();
      [root, ...root.querySelectorAll('*')].forEach(node => {
        const family = getComputedStyle(node).fontFamily;
        if (family) seen.add(family);
      });
      return [...seen];
    });
    const normalizedFonts = programFonts.map(f => f.toLowerCase());
    expect(normalizedFonts.every(f => f.includes('gobold') || f.includes('arial') || f.includes('helvetica') || f.includes('sans-serif'))).toBeTruthy();


    const newsToggle = page.locator('[data-path="modules.news"]');
    if (!(await newsToggle.isChecked())) {
      await newsToggle.check();
    }
    await expect(frame.locator('[data-title]')).not.toHaveText('Waiting for an eligible article', { timeout: 30000 });
    await expect(frame.locator('.article-reader-card')).toBeVisible({ timeout: 30000 });
    await expect(frame.locator('.article-reader-body')).toBeVisible({ timeout: 30000 });
    const readerStyle = await frame.locator('.article-reader-card').evaluate(node => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(readerStyle.background).not.toBe('rgb(243, 240, 232)');
    expect(readerStyle.background).not.toBe('rgb(255, 255, 255)');
    expect(readerStyle.color).not.toBe('rgb(18, 18, 18)');

    const tickerStyle = await frame.locator('footer.ticker').evaluate(node => {
      const style = getComputedStyle(node);
      return { background: style.backgroundColor, color: style.color };
    });
    expect(tickerStyle.background).not.toBe('rgb(243, 240, 232)');
    expect(tickerStyle.background).not.toBe('rgb(255, 255, 255)');
    expect(tickerStyle.color).not.toBe('rgb(17, 17, 17)');

    await expect(frame.locator('.next-event-label')).toHaveText('NEXT EVENT');
    await expect(frame.locator('.next-event-name')).not.toHaveText('');
    const nextEventUi = await frame.locator('[data-next-event]').evaluate(node => {
      const root = getComputedStyle(node);
      const name = getComputedStyle(node.querySelector('.next-event-name'));
      return {
        justifyItems: root.justifyItems,
        textAlign: root.textAlign,
        weight: name.fontWeight,
        family: name.fontFamily
      };
    });
    expect(nextEventUi.justifyItems).toBe('center');
    expect(nextEventUi.textAlign).toBe('center');
    expect(Number(nextEventUi.weight)).toBeGreaterThanOrEqual(700);
    expect(nextEventUi.family.toLowerCase()).toContain('gobold');

    const nextEventWrap = await frame.locator('.next-event-name').evaluate(node => {
      const style = getComputedStyle(node);
      return { whiteSpace: style.whiteSpace, textOverflow: style.textOverflow, overflow: style.overflow };
    });
    expect(nextEventWrap.whiteSpace).toBe('normal');
    expect(nextEventWrap.textOverflow).toBe('clip');

    for (const target of ['overview','programming','sources','timing','display','custom']) {
      await page.locator('[data-nav-target="'+target+'"]').click();
      await expect(page.locator('[data-section="'+target+'"] [data-save-config]')).toBeVisible();
    }
    await expect(page.locator('[data-nav-target="rundown"]')).toHaveCount(0);
    await expect(page.locator('[data-nav-target="queue"]')).toHaveCount(0);
    await expect(page.locator('[data-nav-target="live-content"]')).toHaveCount(0);

    await page.locator('[data-nav-target="programming"]').click();
    await expect(page.locator('[data-section="programming"]')).toBeVisible();
    await expect(page.locator('.bc-preview-column [data-program-pool]')).toBeVisible();
    await expect(page.locator('[data-section="programming"] [data-program-pool]')).toHaveCount(0);
    const poolLayout = await page.locator('.bc-preview-column [data-program-pool]').evaluate(node => getComputedStyle(node).gridTemplateColumns);
    expect(poolLayout.split(' ').length).toBeGreaterThanOrEqual(2);
    await expect(page.locator('[data-program-mode="auto"]')).toHaveAttribute('aria-pressed','true');
    await page.locator('[data-program-pool-tab="news"]').click();
    const poolItems = page.locator('[data-program-pool] .bc-program-item');
    await expect(poolItems.first()).toBeVisible({ timeout: 10000 });
    await expect(poolItems.first().locator('.bc-program-title')).toHaveAttribute('href', /^https?:\/\//);

    const firstPoolTitle = (await poolItems.first().locator('.bc-program-title').textContent() || '').trim();
    await poolItems.first().dragTo(page.locator('[data-program-manual-queue]'));
    await expect(page.locator('[data-program-mode="hybrid"]')).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('[data-program-manual-queue] .bc-program-queue-item')).toHaveCount(1);
    await expect(page.locator('[data-program-manual-queue] .bc-program-title')).toHaveText(firstPoolTitle);

    await page.locator('[data-program-mode="manual"]').click();
    await expect(page.locator('[data-program-mode="manual"]')).toHaveAttribute('aria-pressed','true');
    await expect.poll(async () => page.locator('[data-program-monitor-frame]').evaluate(frame => {
      const q = frame.contentWindow.MatlockBroadcastPreview?.snapshot?.();
      return (q?.article?.length || 0) + (q?.video?.length || 0) + (q?.program?.length || 0);
    })).toBe(1);
    await expect(page.locator('[data-program-output] .bc-queue-item').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-program-output] .bc-queue-item').first().locator('.bc-queue-item-title-link')).toHaveAttribute('href', /^https?:\/\//);

    await page.locator('[data-program-mode="auto"]').click();
    await expect(page.locator('[data-program-mode="auto"]')).toHaveAttribute('aria-pressed','true');
    await expect(frame.locator('[data-title]')).not.toHaveText('', { timeout: 30000 });

    const width = page.locator('[data-path="visual.videoWidth"]');
    await width.evaluate(node => {
      node.value = '70';
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect.poll(async () => frame.locator('[data-stage]').evaluate(node => node.style.getPropertyValue('--video-width'))).toBe('70%');
    await expect(page.locator('[data-preview-program]')).toHaveText('DRAFT');

    await page.locator('[data-nav-target="sources"]').click();
    await expect(page.locator('[data-section="sources"]')).toBeVisible();
    const firstNewsRow = page.locator('[data-news-sources] .bc-source-row').first();
    await expect(firstNewsRow).toBeVisible({ timeout: 30000 });
    const sourceName = (await firstNewsRow.locator('label span').textContent() || '').trim();
    expect(sourceName).toBeTruthy();
    await firstNewsRow.locator('.bc-source-remove').click();
    await expect(page.locator('[data-news-sources] .bc-source-removed')).toContainText(sourceName);
    await page.locator('[data-news-sources] [data-restore-source="news"]').filter({ hasText: sourceName }).click();
    await expect(page.locator('[data-news-sources] .bc-source-row').filter({ hasText: sourceName })).toBeVisible();

    await page.locator('[data-nav-target="overview"]').click();
    await expect(page.locator('[data-section="overview"]')).toBeVisible();
    await page.locator('[data-preset="video"]').click();
    await expect(page.locator('[data-draft-title]')).toContainText('Video heavy');
    await expect(page.locator('[data-preview-renderer]')).toHaveText('ONLINE', { timeout: 10000 });
    await expect(frame.locator('[data-stage]')).toHaveClass(/split-desk/);
    await expect(frame.locator('.article-reader-card')).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});


test.describe('Editorial top spacing consistency', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  const peers = [
    ['/news/', '.news-page-v3', '.news-page-header h1'],
    ['/breakdowns/', '.archive-page-v3', '.archive-header h1'],
    ['/upcoming-events/', '.upcoming-events-page-v3', '.upcoming-events-header h1'],
    ['/event-map/', '.event-map-page-v3', '.event-map-hero h1']
  ];

  async function topGeometry(page, route, rootSelector, headingSelector) {
    await page.goto(targetUrl(route), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator(rootSelector).first()).toBeVisible({ timeout: 30000 });
    return page.evaluate(({ rootSelector, headingSelector }) => {
      const masthead = document.querySelector('.logo-banner')?.getBoundingClientRect();
      const wordmark = document.querySelector('.v3-wordmark')?.getBoundingClientRect();
      const root = document.querySelector(rootSelector)?.getBoundingClientRect();
      const heading = document.querySelector(headingSelector)?.getBoundingClientRect();
      return {
        mastheadHeight: masthead?.height || 0,
        mastheadBottom: masthead?.bottom || 0,
        wordmarkHeight: wordmark?.height || 0,
        rootTop: root?.top || 0,
        headingTop: heading?.top || 0,
        mastheadToRoot: (root?.top || 0) - (masthead?.bottom || 0),
        mastheadToHeading: (heading?.top || 0) - (masthead?.bottom || 0)
      };
    }, { rootSelector, headingSelector });
  }

  test('Live uses the same masthead and top rhythm as editorial peers', async ({ page }) => {
    const live = await topGeometry(page, '/live/', '.live-page', '.live-page__head h1');
    const samples = [];
    for (const [route, rootSelector, headingSelector] of peers) {
      samples.push(await topGeometry(page, route, rootSelector, headingSelector));
    }

    const median = values => {
      const sorted = [...values].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length / 2)];
    };

    expect(live.mastheadHeight,
      'Live masthead should be no taller than the editorial masthead median')
      .toBeLessThanOrEqual(median(samples.map(item => item.mastheadHeight)));
    expect(Math.abs(live.wordmarkHeight - median(samples.map(item => item.wordmarkHeight))),
      'Live must not shrink or enlarge the MATLOCK wordmark').toBeLessThanOrEqual(2);
    expect(Math.abs(live.mastheadToRoot - median(samples.map(item => item.mastheadToRoot))),
      'Live page start should align with editorial peers').toBeLessThanOrEqual(8);
    expect(Math.abs(live.mastheadToHeading - median(samples.map(item => item.mastheadToHeading))),
      'Live title spacing should match editorial peers').toBeLessThanOrEqual(18);

    await page.goto(targetUrl('/live/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const navToWordmark = await page.evaluate(() => {
      const nav = document.querySelector('.site-navigation')?.getBoundingClientRect();
      const wordmark = document.querySelector('.v3-wordmark')?.getBoundingClientRect();
      return Math.round((wordmark?.top || 0) - (nav?.bottom || 0));
    });
    expect(navToWordmark, 'Live MATLOCK masthead should sit close to the navigation rail')
      .toBeLessThanOrEqual(32);
  });
});


test.describe('Article social sharing', () => {
  const articlePath = '/2026/09/24/rosas-jr-vs-barcelos-ufc-vegas-121.html';

  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('renders direct platform intents and both Instagram formats', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(targetUrl(articlePath), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-native-share-top]')).toBeVisible();
    await expect(page.locator('[data-post-share]')).toBeVisible();

    expect(await page.locator('[data-share-x]').getAttribute('href')).toContain('twitter.com/intent/tweet');
    expect(await page.locator('[data-share-threads]').getAttribute('href')).toContain('threads.net/intent/post');
    expect(await page.locator('[data-share-facebook]').getAttribute('href')).toContain('facebook.com/sharer/sharer.php');
    expect(await page.locator('[data-share-reddit]').getAttribute('href')).toContain('reddit.com/submit');

    await expect(page.locator('[data-share-instagram="post"]')).toBeVisible();
    await expect(page.locator('[data-share-instagram="story"]')).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});

test.describe('Article native sharing on mobile', () => {
  const articlePath = '/2026/09/24/rosas-jr-vs-barcelos-ufc-vegas-121.html';

  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });

  test('top Share uses Web Share while platform links remain same-tab intents', async ({ page, request, browserName }) => {
    await page.addInitScript(() => {
      window.__mmaSharePayloads = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async payload => {
          window.__mmaSharePayloads.push(payload);
        }
      });
    });

    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(targetUrl(articlePath), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-native-share-top]')).toBeVisible();

    const backToTop = page.locator('[data-article-back-to-top]');
    await expect(backToTop).toBeHidden();
    await page.evaluate(() => window.scrollTo(0, Math.max(document.body.scrollHeight * .45, 1200)));
    await expect(backToTop).toBeVisible();
    await backToTop.click();
    await expect.poll(async () => page.evaluate(() => Math.round(window.scrollY)), { timeout: 3000 }).toBeLessThan(8);

    const order = await page.evaluate(() => {
      const body = document.querySelector('.post-body')?.getBoundingClientRect();
      const topics = document.querySelector('.post-topics')?.getBoundingClientRect();
      const share = document.querySelector('.post-share')?.getBoundingClientRect();
      const rail = document.querySelector('.post-rail')?.getBoundingClientRect();
      return {
        bodyBottom: body?.bottom || 0,
        topicsTop: topics?.top || 0,
        topicsBottom: topics?.bottom || 0,
        shareTop: share?.top || 0,
        shareBottom: share?.bottom || 0,
        railTop: rail?.top || 0
      };
    });

    expect(order.topicsTop).toBeGreaterThanOrEqual(order.bodyBottom - 2);
    expect(order.shareTop).toBeGreaterThanOrEqual(order.topicsBottom - 2);
    expect(order.railTop).toBeGreaterThanOrEqual(order.shareBottom - 2);

    await page.locator('[data-native-share-top]').click();

    await expect.poll(async () => page.evaluate(() => window.__mmaSharePayloads.length)).toBe(1);
    const payload = await page.evaluate(() => window.__mmaSharePayloads[0]);
    expect(payload.url).toContain(articlePath);
    expect(payload.title).toContain('Rosas Jr. vs. Barcelos');

    for (const selector of [
      '[data-share-x]',
      '[data-share-threads]',
      '[data-share-facebook]',
      '[data-share-reddit]'
    ]) {
      await expect(page.locator(selector)).not.toHaveAttribute('target', '_blank');
    }

    const videos = page.locator('.post-body figure.article-inline-video video');
    await expect(videos).toHaveCount(2);

    for (let index = 0; index < 2; index += 1) {
      const video = videos.nth(index);
      const figure = video.locator('xpath=ancestor::figure[1]');
      await video.scrollIntoViewIfNeeded();
      await expect(video).toHaveAttribute('playsinline', '');
      await expect(video).toHaveAttribute('webkit-playsinline', '');

      const source = await video.getAttribute('src');
      expect(source).toContain('/assets/article-media/');
      expect(source).toMatch(/\.mp4(?:$|\?)/i);

      const mediaResponse = await request.get(new URL(source, BASE).toString(), {
        headers: { Range: 'bytes=0-4095' },
        timeout: 30000
      });
      expect(mediaResponse.status()).toBe(206);
      expect((mediaResponse.headers()['content-type'] || '').split(';')[0].trim().toLowerCase()).toBe('video/mp4');
      expect(mediaResponse.headers()['content-range'] || '').toMatch(/^bytes 0-4095\//i);
      const mediaBytes = await mediaResponse.body();
      expect(mediaBytes.length).toBeGreaterThanOrEqual(12);
      expect(mediaBytes.toString('ascii', 4, 8)).toBe('ftyp');

      await expect.poll(async () => video.evaluate(node => (
        node.readyState >= 1 || Boolean(node.error)
      )), { timeout: 30000 }).toBeTruthy();

      const mediaState = await video.evaluate(node => ({
        readyState: node.readyState,
        error: node.error ? node.error.code : 0
      }));
      if (browserName === 'webkit') {
        expect(mediaState.error, 'WebKit should decode the same-origin MP4').toBe(0);
        expect(mediaState.readyState, 'WebKit should reach loaded metadata').toBeGreaterThanOrEqual(1);
        await expect(figure.locator('.article-inline-video-fallback')).toBeHidden();
      } else if (mediaState.error > 0) {
        await expect(figure.locator('.article-inline-video-fallback')).toBeVisible();
      } else {
        expect(mediaState.readyState).toBeGreaterThanOrEqual(1);
      }
    }

    expect(pageErrors).toEqual([]);
  });
});


test.describe.skip('Original site theme isolation', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('keeps the original homepage dark and free of V3 theme controls', async ({ page }) => {
    await page.goto(targetUrl('/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.site-theme-toggle')).toHaveCount(0);
    const scheme = await page.locator('meta[name="color-scheme"]').getAttribute('content');
    expect(scheme).toBe('dark');
  });
});


test.describe('Mobile site shell', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  const routes = [
    '/',
    '/news/',
    '/live/',
    '/2026/09/24/rosas-jr-vs-barcelos-ufc-vegas-121.html'
  ];

  for (const route of routes) {
    test(`${route} uses one consolidated mobile brand row`, async ({ page }) => {
      await page.goto(targetUrl(route), { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.evaluate(() => document.fonts?.ready).catch(() => {});
      await page.waitForTimeout(150);

      const brand = page.locator('.mobile-brand').first();
      const toggle = page.locator('.navigation-toggle').first();
      const banner = page.locator('.site-header > .logo-banner').first();

      await expect(brand).toBeVisible();
      await expect(brand.locator('.mobile-brand-wordmark')).toHaveText('MATLOCK');
      const pumpkinIcon = brand.locator('.mobile-brand-pumpkin-icon');
      await expect(pumpkinIcon).toBeVisible();
      await expect(pumpkinIcon).toHaveAttribute('src', /\/assets\/icons\/pumpkin-seasonal\.svg(?:\?v=\d+)?$/);
      await expect(toggle).toBeVisible();
      await expect(banner).toBeHidden();

      const geometry = await page.evaluate(() => {
        const brand = document.querySelector('.mobile-brand')?.getBoundingClientRect();
        const toggle = document.querySelector('.navigation-toggle')?.getBoundingClientRect();
        const inner = document.querySelector('.navigation-inner')?.getBoundingClientRect();
        const scrollbarDisplay = getComputedStyle(document.documentElement, '::-webkit-scrollbar').display;
        const bodyScrollbarDisplay = getComputedStyle(document.body, '::-webkit-scrollbar').display;
        return {
          centerDelta: brand && toggle
            ? Math.abs((brand.top + brand.height / 2) - (toggle.top + toggle.height / 2))
            : 999,
          brandLeft: brand?.left ?? -1,
          toggleRight: toggle?.right ?? 9999,
          innerLeft: inner?.left ?? -1,
          innerRight: inner?.right ?? 9999,
          scrollbarDisplay,
          bodyScrollbarDisplay
        };
      });

      expect(geometry.centerDelta, 'mobile brand and hamburger should share one row').toBeLessThanOrEqual(8);
      expect(geometry.brandLeft).toBeGreaterThanOrEqual(geometry.innerLeft - 1);
      expect(geometry.toggleRight).toBeLessThanOrEqual(geometry.innerRight + 1);
      expect(
        geometry.scrollbarDisplay === 'none' || geometry.bodyScrollbarDisplay === 'none',
        'mobile viewport scrollbar should be hidden behind fixed chrome'
      ).toBeTruthy();
    });
  }
});


test.describe('Live V3 site rollout', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('offline Live state collapses media chrome and duplicate status sections', async ({ page }) => {
    const upcoming = {
      event_id: 'future:test',
      promotion_id: 'future',
      promotion: 'Future Fighting',
      short_name: 'FUTURE',
      country: 'United States',
      video_id: 'ZYXWVUTSRQP',
      title: 'Future Fighting 1',
      watch_url: 'https://www.youtube.com/watch?v=ZYXWVUTSRQP',
      status: 'upcoming',
      is_live: false,
      scheduled_start_time: '2026-09-26T20:00:00Z'
    };
    await page.route('**/assets/data/global-live.json*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 5,
          generated_at: new Date().toISOString(),
          selected_event_id: null,
          events: [],
          upcoming: [upcoming],
          live_count: 0,
          upcoming_count: 1,
          sources: {}
        })
      })
    );

    await page.goto(targetUrl('/live/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.live-page')).toHaveClass(/is-offline/, { timeout: 10000 });
    await expect(page.locator('.live-page__player-stage')).toBeHidden();
    await expect(page.locator('.live-page__control-dock')).toBeHidden();
    await expect(page.locator('[data-live-section]')).toBeHidden();
    await expect(page.locator('[data-live-now-label]')).toHaveText('Status');
    await expect(page.locator('[data-live-title]')).toHaveText('No fights live right now');
    await expect(page.locator('[data-live-promotion]')).toHaveText('1 upcoming public broadcast');
    await expect(page.locator('#up-next-title')).toHaveText('Upcoming streams');
    await expect(page.locator('[data-upcoming-list] .live-page__row')).toHaveCount(1);
    await expect(page.locator('body')).not.toContainText('Nothing is live right now.');
  });
  const routes = [
    ['/', '[data-globe-home]'], ['/news/', '[data-editorial-v3]'], ['/breakdowns/', '[data-editorial-v3]'],
    ['/upcoming-events/', '[data-editorial-v3]'], ['/event-map/', '[data-editorial-v3]'],
    ['/on-this-day/', '[data-editorial-v3]'], ['/ufc-roster/', '[data-editorial-v3]'],
    ['/matchmaker/', '[data-editorial-v3]'], ['/about/', '[data-editorial-v3]'], ['/contact/', '[data-editorial-v3]'],
    ['/privacy/', '[data-editorial-v3]'], ['/media-kit/', '[data-editorial-v3]'],
    ['/live/', '[data-editorial-v3]'], ['/mma-yellowpages', '[data-editorial-v3]'],
    ['/picture-gallery', '[data-editorial-v3]']
  ];
  test('switching from selected live stream to another keeps controls attached', async ({ page }) => {
    const rfa = {
      event_id: 'real-fight-arena:z7sfnn-WqtY',
      promotion_id: 'real-fight-arena',
      promotion: 'Real Fight Arena',
      short_name: 'RFA',
      country: 'Slovakia',
      priority: 78,
      video_id: 'z7sfnn-WqtY',
      title: 'RFA 33: Free prelims',
      watch_url: 'https://www.youtube.com/watch?v=z7sfnn-WqtY',
      status: 'live',
      is_live: true,
      embeddable: true,
      api_verified: true,
      stale: false
    };
    const fen = {
      event_id: 'fen:cv2svtEOyIw',
      promotion_id: 'fen',
      promotion: 'Fight Exclusive Night',
      short_name: 'FEN',
      country: 'Poland',
      priority: 72,
      video_id: 'cv2svtEOyIw',
      title: 'FACE TO FACE + WAŻENIE PRZED FEN 63',
      watch_url: 'https://www.youtube.com/watch?v=cv2svtEOyIw',
      status: 'live',
      is_live: true,
      embeddable: true,
      api_verified: true,
      stale: false
    };

    await page.addInitScript(() => {
      class FakePlayer {
        constructor(_id, options) {
          this.options = options || {};
          this.videoId = 'z7sfnn-WqtY';
          this.state = 5;
          setTimeout(() => this.options.events?.onReady?.({ target: this }), 0);
        }
        getPlayerState() { return this.state; }
        getVideoData() { return { isLive: false, video_id: this.videoId }; }
        getVolume() { return 0; }
        isMuted() { return true; }
        getCurrentTime() { return 0; }
        getDuration() { return 100; }
        getPlaybackQuality() { return 'auto'; }
        loadVideoById(videoId) {
          this.videoId = videoId;
          this.state = 1;
          window.__loadCalls = [...(window.__loadCalls || []), videoId];
          setTimeout(() => this.options.events?.onStateChange?.({ data: 1 }), 0);
        }
        playVideo() {
          this.state = 1;
          window.__playCalls = [...(window.__playCalls || []), this.videoId];
          this.options.events?.onStateChange?.({ data: 1 });
        }
        pauseVideo() { this.state = 2; }
        destroy() { window.__destroyCalls = (window.__destroyCalls || 0) + 1; }
      }
      window.YT = {
        Player: FakePlayer,
        PlayerState: { PLAYING: 1 }
      };
      window.__loadCalls = [];
      window.__playCalls = [];
      window.__destroyCalls = 0;
    });

    await page.route('**/assets/data/global-live.json*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 5,
          generated_at: new Date().toISOString(),
          selected_event_id: rfa.event_id,
          events: [rfa, fen],
          upcoming: [],
          live_count: 2,
          upcoming_count: 0,
          sources: {}
        })
      })
    );
    await page.route('https://www.youtube.com/embed/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>mock</title>' })
    );

    await page.goto(targetUrl('/live/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-live-title]')).toContainText('RFA 33');

    const fenRow = page.locator('[data-live-list] .live-page__row--button')
      .filter({ hasText: 'FACE TO FACE' });
    await expect(fenRow).toBeVisible({ timeout: 10000 });
    await fenRow.click();

    await expect(page.locator('[data-live-title]')).toContainText('FACE TO FACE');
    await expect.poll(
      () => page.evaluate(() => window.__loadCalls || []),
      { timeout: 5000 }
    ).toContain('cv2svtEOyIw');

    expect(await page.locator('[data-media-play]').count()).toBe(0);
    expect(await page.locator('[data-media-mute]').count()).toBe(0);
  });

  test('playing live stream with fixed duration is not removed', async ({ page }) => {
    const liveEvent = {
      event_id: 'fen:stable-duration',
      promotion_id: 'fen',
      promotion: 'Fight Exclusive Night',
      short_name: 'FEN',
      country: 'Poland',
      priority: 72,
      video_id: 'cv2svtEOyIw',
      title: 'FACE TO FACE + WAŻENIE PRZED FEN 63',
      watch_url: 'https://www.youtube.com/watch?v=cv2svtEOyIw',
      status: 'live',
      is_live: true,
      embeddable: true,
      api_verified: true,
      stale: false
    };

    await page.addInitScript(() => {
      class FakePlayer {
        constructor(_id, options) {
          this.options = options || {};
          this.state = 1;
          setTimeout(() => this.options.events?.onReady?.({ target: this }), 0);
        }
        getPlayerState() { return this.state; }
        getVideoData() { return { isLive: false }; }
        getVolume() { return 0; }
        isMuted() { return true; }
        getCurrentTime() { return 25; }
        getDuration() { return 100; }
        getPlaybackQuality() { return 'auto'; }
        mute() {}
        playVideo() { this.state = 1; }
        pauseVideo() { this.state = 2; }
        destroy() {}
      }
      window.YT = {
        Player: FakePlayer,
        PlayerState: { PLAYING: 1 }
      };
    });

    await page.route('**/assets/data/global-live.json*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 5,
          generated_at: new Date().toISOString(),
          selected_event_id: liveEvent.event_id,
          events: [liveEvent],
          upcoming: [],
          live_count: 1,
          upcoming_count: 0,
          sources: {}
        })
      })
    );
    await page.route('https://www.youtube.com/embed/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>mock</title>' })
    );

    await page.goto(targetUrl('/live/'), { waitUntil: 'domcontentloaded', timeout: 45000 });

    await expect(page.locator('[data-live-screen]')).toHaveAttribute('data-state', 'live');
    await page.waitForTimeout(6500);
    await expect(page.locator('.live-page')).toHaveClass(/is-live/);
    await expect(page.locator('[data-live-screen]')).toHaveAttribute('data-state', 'live');
    await expect(page.locator('[data-live-title]')).toContainText('FACE TO FACE');
    await expect(page.locator('[data-live-player]')).toBeVisible();
  });

  test('verified live stream plays even when YouTube isLive flag is false', async ({ page }) => {
    const liveEvent = {
      event_id: 'fen:cv2svtEOyIw',
      promotion_id: 'fen',
      promotion: 'Fight Exclusive Night',
      short_name: 'FEN',
      country: 'Poland',
      priority: 72,
      video_id: 'cv2svtEOyIw',
      title: 'FACE TO FACE + WAŻENIE PRZED FEN 63',
      watch_url: 'https://www.youtube.com/watch?v=cv2svtEOyIw',
      status: 'live',
      is_live: true,
      embeddable: true,
      api_verified: true,
      stale: false
    };

    await page.addInitScript(() => {
      class FakePlayer {
        constructor(_id, options) {
          this.options = options || {};
          this.duration = 100;
          setTimeout(() => this.options.events?.onReady?.({ target: this }), 0);
        }
        getPlayerState() { return 5; }
        getVideoData() { return { isLive: false }; }
        getVolume() { return 0; }
        isMuted() { return true; }
        getCurrentTime() { return 0; }
        getDuration() {
          this.duration += 1;
          return this.duration;
        }
        getPlaybackQuality() { return 'auto'; }
        mute() { window.__liveMuteCalls = (window.__liveMuteCalls || 0) + 1; }
        pauseVideo() {}
        playVideo() { window.__livePlayCalls = (window.__livePlayCalls || 0) + 1; }
        destroy() {}
      }
      window.YT = {
        Player: FakePlayer,
        PlayerState: { PLAYING: 1 }
      };
      window.__livePlayCalls = 0;
      window.__liveMuteCalls = 0;
    });

    await page.route('**/assets/data/global-live.json*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 5,
          generated_at: new Date().toISOString(),
          selected_event_id: liveEvent.event_id,
          events: [liveEvent],
          upcoming: [],
          live_count: 1,
          upcoming_count: 0,
          sources: {}
        })
      })
    );
    await page.route('https://www.youtube.com/embed/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>mock</title>' })
    );

    await page.goto(targetUrl('/live/'), { waitUntil: 'domcontentloaded', timeout: 45000 });

    await expect(page.locator('[data-live-screen]')).toHaveAttribute('data-state', 'live');
    const liveSrc = await page.locator('[data-live-player]').getAttribute('src');
    expect(new URL(liveSrc).searchParams.get('autoplay')).toBe('1');
    expect(new URL(liveSrc).searchParams.get('mute')).toBe('1');
    expect(new URL(liveSrc).searchParams.get('controls')).toBe('1');
    expect(await page.locator('[data-live-player]').evaluate(node => getComputedStyle(node).pointerEvents)).toBe('auto');
    expect(await page.locator('[data-media-play]').count()).toBe(0);
    expect(await page.locator('[data-media-mute]').count()).toBe(0);
    await expect.poll(
      () => page.evaluate(() => window.__livePlayCalls || 0),
      { timeout: 7000 }
    ).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__liveMuteCalls || 0)).toBeGreaterThan(0);
    await expect(page.locator('[data-live-screen]')).toHaveAttribute('data-state', 'live');
  });

  test('stuck YouTube embed collapses player into a direct-watch live row', async ({ page }) => {
    const liveEvent = {
      event_id: 'fen:cv2svtEOyIw',
      promotion_id: 'fen',
      promotion: 'Fight Exclusive Night',
      short_name: 'FEN',
      country: 'Poland',
      priority: 72,
      video_id: 'cv2svtEOyIw',
      title: 'FACE TO FACE + WAŻENIE PRZED FEN 63',
      watch_url: 'https://www.youtube.com/watch?v=cv2svtEOyIw',
      status: 'live',
      is_live: true,
      embeddable: true,
      api_verified: true,
      stale: false
    };

    await page.addInitScript(() => {
      class FakePlayer {
        constructor(_id, options) {
          this.options = options || {};
          setTimeout(() => this.options.events?.onReady?.({ target: this }), 0);
        }
        getPlayerState() { return 5; }
        getVolume() { return 0; }
        isMuted() { return true; }
        getCurrentTime() { return 0; }
        getDuration() { return 0; }
        getPlaybackQuality() { return 'auto'; }
        mute() {}
        playVideo() {}
        pauseVideo() {}
        destroy() {}
      }
      window.YT = { Player: FakePlayer, PlayerState: { PLAYING: 1 } };
    });

    await page.route('**/assets/data/global-live.json*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 5,
          generated_at: new Date().toISOString(),
          selected_event_id: liveEvent.event_id,
          events: [liveEvent],
          upcoming: [],
          live_count: 1,
          upcoming_count: 0,
          sources: {}
        })
      })
    );
    await page.route('https://www.youtube.com/embed/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>mock</title>' })
    );

    await page.goto(targetUrl('/live/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.live-page')).toHaveClass(/is-direct-only/, { timeout: 8000 });
    await expect(page.locator('[data-live-screen]')).toHaveAttribute('data-state', 'direct-only');
    await expect(page.locator('.live-page__player-stage')).toBeHidden();
    await expect(page.locator('.live-page__control-dock')).toBeHidden();
    await expect(page.locator('[data-live-now-label]')).toHaveText('Live streams');
    await expect(page.locator('#live-now-title')).toHaveText('Live streams on YouTube');
    await expect(page.locator('[data-live-section]')).toBeVisible();
    const directRow = page.locator('[data-live-list] .live-page__row.is-direct-only');
    await expect(directRow).toHaveCount(1);
    await expect(directRow).toContainText('Live · YouTube');
    await expect(directRow).toContainText('FACE TO FACE');
    await expect(directRow).toHaveAttribute('href', /cv2svtEOyIw/);
    await expect(page.locator('[data-live-source]')).toHaveAttribute('href', /cv2svtEOyIw/);
    await expect(page.locator('[data-live-embed-fallback]')).toHaveCount(0);
  });


  test('blocked selected stream falls through to another embeddable live feed', async ({ page }) => {
    const blocked = {
      event_id: 'blocked:aaaaaaaaaaa',
      promotion_id: 'blocked',
      promotion: 'Blocked Promotion',
      short_name: 'BLOCKED',
      country: 'Test',
      priority: 100,
      video_id: 'aaaaaaaaaaa',
      title: 'Blocked live feed',
      watch_url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa',
      status: 'live',
      is_live: true,
      embeddable: true,
      api_verified: true,
      stale: false
    };
    const playable = {
      event_id: 'playable:bbbbbbbbbbb',
      promotion_id: 'playable',
      promotion: 'Playable Promotion',
      short_name: 'PLAY',
      country: 'Test',
      priority: 90,
      video_id: 'bbbbbbbbbbb',
      title: 'Playable live feed',
      watch_url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb',
      status: 'live',
      is_live: true,
      embeddable: true,
      api_verified: true,
      stale: false
    };

    await page.addInitScript(() => {
      class FakePlayer {
        constructor(_id, options) {
          this.options = options || {};
          this.videoId = 'aaaaaaaaaaa';
          this.state = 5;
          setTimeout(() => this.options.events?.onReady?.({ target: this }), 0);
        }
        getPlayerState() { return this.state; }
        getVolume() { return 0; }
        isMuted() { return true; }
        getCurrentTime() { return 0; }
        getDuration() { return this.videoId === 'bbbbbbbbbbb' ? 100 : 0; }
        getPlaybackQuality() { return 'auto'; }
        mute() {}
        playVideo() {}
        pauseVideo() {}
        loadVideoById(videoId) {
          this.videoId = videoId;
          this.state = 1;
          setTimeout(() => this.options.events?.onStateChange?.({ data: 1 }), 0);
        }
        destroy() {}
      }
      window.YT = { Player: FakePlayer, PlayerState: { PLAYING: 1 } };
    });

    await page.route('**/assets/data/global-live.json*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          version: 5,
          generated_at: new Date().toISOString(),
          selected_event_id: blocked.event_id,
          events: [blocked, playable],
          upcoming: [],
          live_count: 2,
          upcoming_count: 0,
          sources: {}
        })
      })
    );
    await page.route('https://www.youtube.com/embed/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>mock</title>' })
    );

    await page.goto(targetUrl('/live/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-live-title]')).toHaveText('Playable live feed', { timeout: 9000 });
    await expect(page.locator('.live-page')).toHaveClass(/is-live/);
    await expect(page.locator('[data-live-screen]')).toHaveAttribute('data-state', 'live');
    const blockedRow = page.locator('[data-live-list] .live-page__row.is-direct-only');
    await expect(blockedRow).toContainText('Blocked live feed');
    await expect(blockedRow).toHaveAttribute('href', /aaaaaaaaaaa/);
  });

  test('ended Live video cannot autoplay or resurrect from stale status data', async ({ page }) => {
    const staleEvent = {
      event_id: 'test-promotion:abcdefghijk',
      promotion_id: 'test-promotion',
      promotion: 'Test Promotion',
      short_name: 'TEST',
      country: 'Test',
      priority: 100,
      video_id: 'abcdefghijk',
      title: 'Finished broadcast',
      watch_url: 'https://www.youtube.com/watch?v=abcdefghijk',
      status: 'live',
      is_live: true,
      embeddable: true,
      api_verified: true,
      stale: false
    };
    const stalePayload = {
      version: 5,
      generated_at: new Date().toISOString(),
      selected_event_id: staleEvent.event_id,
      events: [staleEvent],
      upcoming: [],
      live_count: 1,
      upcoming_count: 0,
      sources: {}
    };

    await page.addInitScript(() => {
      class FakePlayer {
        constructor(_id, options) {
          this.options = options || {};
          setTimeout(() => this.options.events?.onReady?.({ target: this }), 0);
        }
        getPlayerState() { return 0; }
        getVideoData() { return { isLive: false }; }
        getVolume() { return 0; }
        isMuted() { return true; }
        getCurrentTime() { return 0; }
        getDuration() { return 0; }
        getPlaybackQuality() { return 'auto'; }
        pauseVideo() {}
        playVideo() { window.__endedReplayPlayCalls = (window.__endedReplayPlayCalls || 0) + 1; }
        destroy() {}
      }
      window.YT = {
        Player: FakePlayer,
        PlayerState: { PLAYING: 1 }
      };
      window.__endedReplayPlayCalls = 0;
    });

    await page.route('**/assets/data/global-live.json*', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(stalePayload)
      })
    );
    await page.route('https://www.youtube.com/embed/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>mock</title>' })
    );

    await page.goto(targetUrl('/live/'), { waitUntil: 'domcontentloaded', timeout: 45000 });

    const iframe = page.locator('[data-live-player]');

    await expect.poll(
      () => page.evaluate(() => window.__endedReplayPlayCalls || 0),
      { timeout: 9000 }
    ).toBe(0);

    await expect(page.locator('[data-live-screen]')).toHaveAttribute('data-state', 'offline', { timeout: 9000 });
    await expect(iframe).not.toHaveAttribute('src', /abcdefghijk/);

    await page.locator('[data-live-refresh]').click();
    await page.waitForTimeout(300);
    await expect(page.locator('[data-live-screen]')).toHaveAttribute('data-state', 'offline');
    await expect(iframe).not.toHaveAttribute('src', /abcdefghijk/);
    expect(await page.evaluate(() => window.__endedReplayPlayCalls || 0)).toBe(0);
  });

  for (const [route, ready] of routes) {
    test(route + ' is live on V3', async ({ page }) => {
      await page.goto(targetUrl(route), { waitUntil: 'domcontentloaded', timeout: 45000 });
      await expect(page.locator(ready).first()).toBeVisible({ timeout: 30000 });
      await expect(page.locator('.v3-wordmark')).toBeVisible();
      await expect(page.locator('.site-theme-toggle')).toBeVisible();
      const robots = await page.locator('meta[name="robots"]').getAttribute('content');
      expect(robots || '').not.toContain('noindex');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
    });
  }
  test('On This Day September 23 lead renders real poster artwork', async ({ page }) => {
    await page.goto(targetUrl('/on-this-day/?date=09-23'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-otd-list] .otd-entry').first()).toBeVisible({ timeout: 30000 });
    const lead = page.locator('.otd-entry').filter({ hasText: 'UFC Fight Night: Fiziev vs. Gamrot' }).first();
    await expect(lead).toBeVisible({ timeout: 30000 });
    const image = lead.locator('.otd-entry-media.is-image-ready img');
    await expect(image).toBeVisible({ timeout: 30000 });
    expect(await image.evaluate(node => ({ complete: node.complete, width: node.naturalWidth, height: node.naturalHeight })))
      .toEqual(expect.objectContaining({ complete: true }));
    expect(await image.evaluate(node => node.naturalWidth)).toBeGreaterThanOrEqual(800);
    expect(await image.evaluate(node => node.naturalHeight)).toBeGreaterThanOrEqual(400);
    const pixels = await sharp(await image.screenshot()).stats();
    const visibleVariation = Math.max(...pixels.channels.slice(0, 3).map(channel => channel.stdev));
    expect(visibleVariation, 'Fiziev–Gamrot poster should contain visible artwork, not a blank hotlink response').toBeGreaterThan(18);
    await expect(lead.locator('.otd-event-poster-status')).toHaveCount(0);
  });

  test('published articles use the V3 article shell', async ({ page }) => {
    await page.goto(targetUrl('/breakdowns/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    const href = await page.locator('.article-card a[href]').first().getAttribute('href');
    expect(href).toBeTruthy();
    await page.goto(targetUrl(href), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.post-page-v3[data-editorial-v3]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.v3-wordmark')).toBeVisible();
    await expect(page.locator('.site-theme-toggle')).toBeVisible();
    await expect(page.locator('.post-reading-layout')).toBeVisible();
    await expect(page.locator('.post-rail')).toBeVisible();
    await expect(page.locator('.post-rail-article')).toHaveCount(3);
    const articleGeometry = await page.evaluate(() => {
      const body = document.querySelector('.post-body')?.getBoundingClientRect();
      const rail = document.querySelector('.post-rail')?.getBoundingClientRect();
      return {
        bodyWidth: body?.width || 0,
        bodyRight: body?.right || 0,
        railLeft: rail?.left || 0
      };
    });
    expect(articleGeometry.bodyWidth).toBeGreaterThanOrEqual(730);
    expect(articleGeometry.bodyWidth).toBeLessThanOrEqual(765);
    expect(articleGeometry.railLeft - articleGeometry.bodyRight).toBeGreaterThanOrEqual(24);
    const articleHeadingColor = await page.locator('.post-header h1').evaluate(node => getComputedStyle(node).color);
    expect(articleHeadingColor).toBe('rgb(17, 17, 17)');
    await page.waitForFunction(() => {
      const list = document.querySelector('[data-post-news-list]');
      return list?.getAttribute('aria-busy') === 'false';
    }, null, { timeout: 30000 });
    expect(await page.locator('.post-rail-news-item').count()).toBeGreaterThan(0);
  });
});

test.describe('Homepage editorial shell', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('uses Edition masthead, image-led editorial hierarchy, and detached event drawer', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(targetUrl('/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-globe-home]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.v3-wordmark')).toBeVisible();
    await expect(page.locator('.site-logo')).toHaveCount(0);
    await expect(page.locator('.v3-trending')).toBeVisible();
    await expect(page.locator('.site-live-strip-inner')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.site-theme-toggle')).toBeVisible();
    await expect(page.locator('[data-readability-toggle]')).toHaveCount(0);
    await expect(page.locator('[data-motion-toggle]')).toHaveCount(0);
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const herkeyLoaded = await page.evaluate(async () => {
      try {
        await document.fonts.load('400 32px "Herkey"');
        return document.fonts.check('400 32px "Herkey"');
      } catch {
        return false;
      }
    });
    if (!herkeyLoaded) console.warn('Herkey font loader did not confirm in this browser run; computed-family assertions remain authoritative.');
    await page.waitForTimeout(200);

    const geometry = await page.evaluate(() => {
      const nav = document.querySelector('.navigation-inner')?.getBoundingClientRect();
      const ticker = document.querySelector('.site-live-strip-inner')?.getBoundingClientRect();
      const eventName = document.querySelector('.site-event-primary-name');
      const eventCountdown = document.querySelector('.site-event-primary-countdown');
      const trending = document.querySelector('.v3-trending');
      const leadTitle = document.querySelector('.v3-lead h1');
      const leadDeck = document.querySelector('.v3-lead-deck');
      const wordmark = document.querySelector('.v3-wordmark');
      const sectionHeading = document.querySelector('.v3-section-head h2');
      const historyTitle = document.querySelector('.v3-history-feature-title');
      const trendRect = trending?.getBoundingClientRect();
      const navLink = document.querySelector('.navigation-list a');
      const trendLink = document.querySelector('[data-v3-trending] a');
      return {
        viewport: document.documentElement.clientWidth,
        navWidth: Math.round(nav?.width || 0),
        tickerWidth: Math.round(ticker?.width || 0),
        eventColor: eventName ? getComputedStyle(eventName).color : null,
        countdownColor: eventCountdown ? getComputedStyle(eventCountdown).color : null,
        countdownLive: eventCountdown?.getAttribute('data-live') === 'true',
        trendingHeight: Math.round(trendRect?.height || 0),
        trendingScrollHeight: trending?.scrollHeight || 0,
        leadTitleAlign: leadTitle ? getComputedStyle(leadTitle).textAlign : null,
        leadDeckAlign: leadDeck ? getComputedStyle(leadDeck).textAlign : null,
        leadFont: leadTitle ? getComputedStyle(leadTitle).fontFamily : null,
        sectionFont: sectionHeading ? getComputedStyle(sectionHeading).fontFamily : null,
        historyFont: historyTitle ? getComputedStyle(historyTitle).fontFamily : null,
        wordmarkFont: wordmark ? getComputedStyle(wordmark).fontFamily : null,
        navPosition: getComputedStyle(document.querySelector('.site-navigation')).position,
        tickerPosition: getComputedStyle(document.querySelector('.site-live-strip')).position,
        navTransform: navLink ? getComputedStyle(navLink).textTransform : null,
        trendingTransform: trendLink ? getComputedStyle(trendLink).textTransform : null,
        pageText: document.querySelector('[data-globe-home]')?.textContent || ''
      };
    });

    expect(geometry.navWidth).toBeGreaterThanOrEqual(geometry.viewport - 4);
    expect(geometry.tickerWidth).toBeGreaterThanOrEqual(geometry.viewport - 4);
    expect(geometry.eventColor).toBe('rgb(17, 17, 17)');
    expect(geometry.countdownColor).toBe(geometry.countdownLive ? 'rgb(196, 95, 0)' : 'rgb(17, 17, 17)');
    expect(geometry.trendingScrollHeight).toBeLessThanOrEqual(geometry.trendingHeight + 2);
    expect(geometry.leadTitleAlign).toBe('left');
    expect(geometry.leadDeckAlign).toBe('left');
    expect(geometry.wordmarkFont).toContain('Edition Matlock');
    const seasonalAccent = await page.evaluate(() => {
      const heading = document.querySelector('.v3-section-head h2');
      const trendingLabel = document.querySelector('.v3-trending > strong');
      const wordmark = document.querySelector('.v3-wordmark');
      const pumpkinStyle = wordmark ? getComputedStyle(wordmark, '::after') : null;
      return {
        headingColor: heading ? getComputedStyle(heading).color : null,
        trendingColor: trendingLabel ? getComputedStyle(trendingLabel).color : null,
        pumpkinBackground: pumpkinStyle?.backgroundImage || null,
        pumpkinBottom: pumpkinStyle?.bottom || null,
        pumpkinWidth: pumpkinStyle ? parseFloat(pumpkinStyle.width) : 0
      };
    });
    expect(seasonalAccent.headingColor).toBe('rgb(17, 17, 17)');
    expect(seasonalAccent.trendingColor).toBe('rgb(196, 95, 0)');
    expect(seasonalAccent.pumpkinBackground).toContain('/assets/icons/pumpkin.svg');
    expect(seasonalAccent.pumpkinBottom).not.toBe('auto');
    expect(seasonalAccent.pumpkinWidth).toBeGreaterThanOrEqual(16);
    expect(geometry.leadFont).toContain('Herkey');
    expect(geometry.sectionFont).toContain('Herkey');
    expect(geometry.historyFont).toContain('Herkey');
    expect(geometry.leadFont).not.toContain('Edition Matlock');
    expect(geometry.sectionFont).not.toContain('Edition Matlock');
    expect(geometry.historyFont).not.toContain('Edition Matlock');
    expect(geometry.navPosition).toBe('static');
    expect(geometry.tickerPosition).toBe('static');
    expect(geometry.navTransform).toBe('uppercase');
    expect(geometry.trendingTransform).toBe('uppercase');
    expect(geometry.pageText).not.toContain('EST. 2026');
    expect(geometry.pageText).not.toContain('Fight Talk');
    expect(geometry.pageText).not.toContain('Lead story');
    expect(geometry.pageText).not.toContain('Fight Night Desk');

    await expect(page.locator('[data-v3-trending] a').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-v3-trending] a')).toHaveCount(5);
    await expect(page.locator('.v3-rail-image')).toHaveCount(2);
    await expect(page.locator('.v3-history-feature-card')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.v3-history-feature-image')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.v3-verdict')).toHaveCount(0);
    await expect(page.locator('.v3-utility-strip')).toHaveCount(0);
    await expect(page.locator('.v3-sticky-shell')).toHaveCount(1);
    await expect(page.locator('.v3-sticky-shell > .site-navigation')).toHaveCount(1);
    await expect(page.locator('.v3-sticky-shell > .site-live-strip')).toHaveCount(1);
    await expect(page.locator('.v3-footer-grid section')).toHaveCount(4);
    await expect(page.locator('body')).not.toContainText('Independent MMA coverage');
    await expect(page.locator('body')).not.toContainText('Austin, Texas');
    await expect(page.locator('body')).not.toContainText('NO HYPE. JUST FIGHTS.');

    const toggleSize = await page.locator('.site-theme-toggle').evaluate(node => {
      const rect = node.getBoundingClientRect();
      const label = node.querySelector('.site-theme-toggle-label');
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        labelDisplay: label ? getComputedStyle(label).display : null
      };
    });
    expect(toggleSize.width).toBeLessThanOrEqual(42);
    expect(toggleSize.height).toBeLessThanOrEqual(24);
    expect(toggleSize.labelDisplay).toBe('none');


    const historyImage = page.locator('.v3-history-feature-image img');
    if (await historyImage.count()) {
      await expect.poll(async () => historyImage.evaluate(img =>
        Boolean(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)
      ), { timeout: 10000 }).toBe(true);

      const historyImageRatio = await historyImage.evaluate(img => {
        const rect = img.getBoundingClientRect();
        return {
          natural: img.naturalWidth / img.naturalHeight,
          rendered: rect.width / rect.height
        };
      });
      expect(Math.abs(historyImageRatio.natural - historyImageRatio.rendered)).toBeLessThan(0.03);

      const historyRenderedWidth = await historyImage.evaluate(img =>
        Math.round(img.getBoundingClientRect().width)
      );
      expect(historyRenderedWidth).toBeLessThanOrEqual(300);
    } else {
      await expect(page.locator('.v3-history-feature-image--fallback')).toBeVisible();
    }

    const stickyBefore = await page.locator('.v3-sticky-shell').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
    await page.waitForTimeout(120);
    const stickyAfter = await page.locator('.v3-sticky-shell').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(Math.abs(stickyBefore)).toBeLessThanOrEqual(2);
    expect(Math.abs(stickyAfter)).toBeLessThanOrEqual(2);


    const shellPosition = await page.locator('.v3-sticky-shell').evaluate(node =>
      getComputedStyle(node).position
    );
    expect(shellPosition).toBe('fixed');

    const initialTheme = await page.locator('html').getAttribute('data-theme');
    expect(initialTheme).toBe('light');
    await page.locator('.site-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.site-theme-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('html')).toHaveClass(/v3-theme-transitioning/);
    await expect(page.locator('html')).not.toHaveClass(/v3-theme-transitioning/, { timeout: 1200 });
    const darkTrendingColor = await page.locator('[data-v3-trending] a').first().evaluate(node =>
      getComputedStyle(node).color
    );
    expect(darkTrendingColor).toBe('rgb(231, 228, 222)');
    await page.locator('.site-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const tickerBottom = await page.locator('.site-live-strip').evaluate(node =>
      Math.round(node.getBoundingClientRect().bottom)
    );
    const closedDrawerMotion = await page.locator('.site-event-drawer').evaluate(node => ({
      transform: getComputedStyle(node).transform,
      transitionDuration: getComputedStyle(node).transitionDuration
    }));
    expect(closedDrawerMotion.transform).not.toBe('none');
    expect(closedDrawerMotion.transitionDuration).not.toBe('0s');

    await page.locator('.site-event-primary').click();
    await expect(page.locator('.site-event-drawer')).toBeVisible();
    const drawerTop = await page.locator('.site-event-drawer').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(drawerTop - tickerBottom).toBeGreaterThanOrEqual(10);

    await page.locator('.site-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).not.toHaveClass(/v3-theme-transitioning/, { timeout: 1200 });

    await page.locator('.site-event-primary').click();
    await expect(page.locator('.site-event-drawer')).toBeVisible();

    const eventRow = page.locator('.site-event-drawer .site-event-row').first();
    await eventRow.hover();
    const hoveredEventStyle = await eventRow.evaluate(node => ({
      background: getComputedStyle(node).backgroundColor,
      color: getComputedStyle(node).color,
      nameColor: getComputedStyle(node.querySelector('.site-event-row-name')).color,
      detailColor: getComputedStyle(node.querySelector('.site-event-row-detail')).color,
      inlineBackgroundPriority: node.style.getPropertyPriority('background-color')
    }));
    const hoveredRgb = (hoveredEventStyle.background.match(/\d+/g) || []).slice(0, 3).map(Number);
    expect(hoveredRgb).toHaveLength(3);
    expect(Math.max(...hoveredRgb)).toBeLessThan(80);
    expect(hoveredEventStyle.color).toBe('rgb(255, 255, 255)');
    expect(hoveredEventStyle.nameColor).toBe('rgb(255, 255, 255)');
    expect(hoveredEventStyle.inlineBackgroundPriority).toBe('important');

    expect(pageErrors).toEqual([]);
  });
});


test.describe('Wide news layout', () => {
  test.use({ viewport: { width: 2560, height: 1440 }, isMobile: false, hasTouch: false });

  test('news lead uses the wide column instead of a narrow headline measure', async ({ page }) => {
    await page.goto(targetUrl('/news/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-news-top-story] .news-lead-card')).toBeVisible({ timeout: 30000 });

    const geometry = await page.evaluate(() => {
      const pageNode = document.querySelector('.news-page-v3');
      const story = document.querySelector('.news-top-story');
      const title = document.querySelector('.news-lead-card h2');
      return {
        pageWidth: pageNode?.getBoundingClientRect().width || 0,
        storyWidth: story?.getBoundingClientRect().width || 0,
        titleWidth: title?.getBoundingClientRect().width || 0,
        titleMaxWidth: title ? getComputedStyle(title).maxWidth : ''
      };
    });

    expect(geometry.pageWidth).toBeGreaterThanOrEqual(1750);
    expect(geometry.storyWidth).toBeGreaterThanOrEqual(1150);
    expect(geometry.titleWidth).toBeGreaterThanOrEqual(1000);
    expect(geometry.titleMaxWidth).toBe('none');
  });
});


test.describe('On This Day share builder', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('builds post and story cards without reopening the old lightbox', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(targetUrl('/on-this-day/?date=09-08'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => {
      const list = document.querySelector('[data-otd-list]');
      return list && list.getAttribute('aria-busy') === 'false' && list.children.length > 0;
    }, null, { timeout: 30000 });

    const media = page.locator('.otd-entry-media.is-image-ready').first();
    await expect(media).toBeVisible({ timeout: 30000 });
    await media.click();

    const modal = page.locator('.otd-share-modal');
    await expect(modal).toBeVisible();
    await expect(page.locator('.otd-lightbox')).toHaveCount(0);

    const preview = page.locator('[data-otd-share-preview]');
    await expect.poll(async () => preview.evaluate(image => image.naturalWidth), { timeout: 30000 }).toBe(1080);
    await expect.poll(async () => preview.evaluate(image => image.naturalHeight), { timeout: 30000 }).toBe(1350);
    await expect(preview).toHaveAttribute('src', /otd-share-cache|blob:/);
    await expect(page.locator('[data-otd-share-download]')).toBeEnabled({ timeout: 30000 });
    await expect(page.locator('[data-otd-share-instagram]')).toBeVisible();

    await page.locator('[data-otd-share-format="story"]').click();
    await expect.poll(async () => preview.evaluate(image => image.naturalWidth), { timeout: 30000 }).toBe(1080);
    await expect.poll(async () => preview.evaluate(image => image.naturalHeight), { timeout: 30000 }).toBe(1920);
    await expect(page.locator('[data-otd-share-format="story"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-otd-share-download]')).toBeEnabled({ timeout: 30000 });

    const dir = path.join(SCREENSHOT_DIR, 'desktop');
    fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, 'otd-share-builder.png'), fullPage: false });

    await page.locator('[data-otd-share-close]').click();
    await expect(modal).toBeHidden();
    await media.click();
    await expect(page.locator('[data-otd-share-format="story"]')).toHaveAttribute('aria-pressed', 'true');

    expect(pageErrors).toEqual([]);
  });
});
