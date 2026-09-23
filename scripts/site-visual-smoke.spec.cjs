const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.SITE_BASE_URL || 'https://mmamatlock.com';
const SCREENSHOT_DIR = process.env.VISUAL_SMOKE_DIR || 'artifacts/site-visual-smoke';

const pages = [
  { slug: 'home', path: '/', ready: '.homepage-dashboard' },
  { slug: 'homepage-v2', path: '/homepage-v2/', ready: '[data-home-flow]' },
  { slug: 'homepage-v3', path: '/homepage-v3/', ready: '[data-globe-home]' },
  { slug: 'news', path: '/news/', ready: '.news-page' },
  { slug: 'fight-cards', path: '/upcoming-events/', ready: '.upcoming-events-page' },
  { slug: 'event-map', path: '/event-map/', ready: '.event-map-page' },
  { slug: 'on-this-day', path: '/on-this-day/', ready: '.otd-page' },
  { slug: 'roster', path: '/ufc-roster/', ready: '.ufc-roster-page' },
  { slug: 'breakdowns', path: '/breakdowns/', ready: '.archive-page' }
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



test.describe('Original site theme isolation', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('keeps the original homepage dark and free of V3 theme controls', async ({ page }) => {
    await page.goto(targetUrl('/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.site-theme-toggle')).toHaveCount(0);
    const scheme = await page.locator('meta[name="color-scheme"]').getAttribute('content');
    expect(scheme).toBe('dark');
  });
});


test.describe('Homepage V3 editorial shell', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('uses Edition masthead, image-led editorial hierarchy, and detached event drawer', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(targetUrl('/homepage-v3/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
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
    expect(herkeyLoaded).toBe(true);
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
    expect(geometry.countdownColor).toBe('rgb(17, 17, 17)');
    expect(geometry.trendingScrollHeight).toBeLessThanOrEqual(geometry.trendingHeight + 2);
    expect(geometry.leadTitleAlign).toBe('left');
    expect(geometry.leadDeckAlign).toBe('left');
    expect(geometry.wordmarkFont).toContain('Edition Matlock');
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
    await expect(page.locator('.v3-pick-row')).toHaveCount(2);
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


    await expect.poll(async () => page.locator('.v3-history-feature-image img').evaluate(img =>
      Boolean(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)
    ), { timeout: 10000 }).toBe(true);

    const historyImageRatio = await page.locator('.v3-history-feature-image img').evaluate(img => {
      const rect = img.getBoundingClientRect();
      return {
        natural: img.naturalWidth / img.naturalHeight,
        rendered: rect.width / rect.height
      };
    });
    expect(Math.abs(historyImageRatio.natural - historyImageRatio.rendered)).toBeLessThan(0.03);

    const historyRenderedWidth = await page.locator('.v3-history-feature-image img').evaluate(img =>
      Math.round(img.getBoundingClientRect().width)
    );
    expect(historyRenderedWidth).toBeLessThanOrEqual(300);

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
    const darkTrendingColor = await page.locator('[data-v3-trending] a').first().evaluate(node =>
      getComputedStyle(node).color
    );
    expect(darkTrendingColor).toBe('rgb(231, 228, 222)');
    await page.locator('.site-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const tickerBottom = await page.locator('.site-live-strip').evaluate(node =>
      Math.round(node.getBoundingClientRect().bottom)
    );
    await page.locator('.site-event-primary').click();
    await expect(page.locator('.site-event-drawer')).toBeVisible();
    const drawerTop = await page.locator('.site-event-drawer').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(drawerTop - tickerBottom).toBeGreaterThanOrEqual(10);

    expect(pageErrors).toEqual([]);
  });
});


test.describe('News V3 isolated migration', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('keeps live News legacy while the demo opts into the approved editorial shell', async ({ page }) => {
    await page.goto(targetUrl('/news/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.news-page')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-editorial-v3]')).toHaveCount(0);
    await expect(page.locator('.site-theme-toggle')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.goto(targetUrl('/news-v3/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-editorial-v3]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.v3-wordmark')).toBeVisible();
    await expect(page.locator('.news-page-heading > p')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('Current MMA and UFC headlines from trusted combat-sports sources');
    await expect(page.locator('.site-theme-toggle')).toBeVisible();
    await expect(page.locator('.v3-sticky-shell')).toHaveCount(1);
    await expect(page.locator('.v3-sticky-shell > .site-navigation')).toHaveCount(1);
    await expect(page.locator('.site-live-strip')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.v3-sticky-shell > .site-live-strip')).toHaveCount(1);

    const shellPosition = await page.locator('.v3-sticky-shell').evaluate(node =>
      getComputedStyle(node).position
    );
    expect(shellPosition).toBe('fixed');

    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const titleFont = await page.locator('.news-page-heading h1').evaluate(node =>
      getComputedStyle(node).fontFamily
    );
    expect(titleFont).toContain('Herkey');

    await expect(page.locator('.news-lead-card')).toBeVisible({ timeout: 15000 });
    const leadRadius = await page.locator('.news-lead-card').evaluate(node =>
      getComputedStyle(node).borderRadius
    );
    expect(leadRadius).toBe('0px');

    const cardRadius = await page.locator('.news-card').first().evaluate(node =>
      getComputedStyle(node).borderRadius
    );
    expect(cardRadius).toBe('0px');

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
    await page.waitForTimeout(120);
    const fixedTop = await page.locator('.v3-sticky-shell').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(Math.abs(fixedTop)).toBeLessThanOrEqual(2);

    await page.locator('.site-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkBackground = await page.locator('.news-page-v3').evaluate(node =>
      getComputedStyle(node).backgroundColor
    );
    expect(darkBackground).toBe('rgb(11, 11, 11)');

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });
});

test.describe('Breakdowns V3 isolated migration', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('preserves the live archive while the demo uses the editorial shell and working filters', async ({ page }) => {
    await page.goto(targetUrl('/breakdowns/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.archive-page')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-editorial-v3]')).toHaveCount(0);
    await expect(page.locator('.site-theme-toggle')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.goto(targetUrl('/breakdowns-v3/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-editorial-v3]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.v3-wordmark')).toBeVisible();
    await expect(page.locator('.site-theme-toggle')).toBeVisible();
    await expect(page.locator('.v3-sticky-shell')).toHaveCount(1);
    await expect(page.locator('.site-live-strip')).toBeVisible({ timeout: 10000 });

    const shellPosition = await page.locator('.v3-sticky-shell').evaluate(node =>
      getComputedStyle(node).position
    );
    expect(shellPosition).toBe('fixed');

    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const titleFont = await page.locator('.archive-header h1').evaluate(node =>
      getComputedStyle(node).fontFamily
    );
    expect(titleFont).toContain('Herkey');

    const cards = page.locator('[data-archive-card]');
    expect(await cards.count()).toBeGreaterThan(0);

    const firstCard = cards.first();
    const radius = await firstCard.evaluate(node => getComputedStyle(node).borderRadius);
    expect(radius).toBe('0px');

    const firstTitleFont = await firstCard.locator('h2').evaluate(node =>
      getComputedStyle(node).fontFamily
    );
    expect(firstTitleFont).toContain('Herkey');

    const search = page.locator('[data-archive-search]');
    await search.fill('__no_article_should_match_this__');
    await expect(page.locator('[data-archive-status]')).toContainText('Showing 0 articles');
    await expect(page.locator('[data-archive-empty]')).toBeVisible();

    await search.fill('');
    await expect(page.locator('[data-archive-empty]')).toBeHidden();

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    await page.evaluate(() => window.scrollTo({ top: 1200, behavior: 'instant' }));
    await page.waitForTimeout(120);
    const fixedTop = await page.locator('.v3-sticky-shell').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(Math.abs(fixedTop)).toBeLessThanOrEqual(2);

    await page.locator('.site-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const darkBackground = await page.locator('.archive-page-v3').evaluate(node =>
      getComputedStyle(node).backgroundColor
    );
    expect(darkBackground).toBe('rgb(11, 11, 11)');

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });
});

test.describe('Fight Cards V3 isolated migration', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('keeps live Fight Cards untouched while the V3 picker uses the editorial shell', async ({ page }) => {
    await page.goto(targetUrl('/upcoming-events/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.upcoming-events-page')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-editorial-v3]')).toHaveCount(0);
    await expect(page.locator('.site-theme-toggle')).toHaveCount(0);

    await page.goto(targetUrl('/upcoming-events-v3/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-editorial-v3]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.v3-wordmark')).toBeVisible();
    await expect(page.locator('.site-theme-toggle')).toBeVisible();
    await expect(page.locator('.v3-sticky-shell')).toHaveCount(1);

    const stylesheetHrefs = await page.locator('link[rel="stylesheet"]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('href') || '')
    );
    expect(stylesheetHrefs.some(href => href.includes('upcoming-events.css'))).toBe(false);
    expect(stylesheetHrefs.some(href => href.includes('upcoming-events-layout.css'))).toBe(false);
    expect(stylesheetHrefs.some(href => href.includes('upcoming-events-portrait-fixes.css'))).toBe(false);
    const v3Index = stylesheetHrefs.findIndex(href => href.includes('upcoming-events-v3.css'));
    const tailIndex = stylesheetHrefs.findIndex(href => href.includes('site-tail.css'));
    expect(v3Index).toBeGreaterThan(tailIndex);

    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const title = await page.locator('.upcoming-events-header h1').evaluate(node => ({
      text: node.textContent.trim(),
      font: getComputedStyle(node).fontFamily
    }));
    expect(title.text).toBe('Fight Cards');
    expect(title.font).toContain('Herkey');

    const firstEvent = page.locator('.upcoming-event-card').first();
    await expect(firstEvent).toBeVisible();
    const eventStyle = await firstEvent.evaluate(node => ({
      radius: getComputedStyle(node).borderRadius,
      shadow: getComputedStyle(node).boxShadow,
      background: getComputedStyle(node).backgroundColor
    }));
    expect(eventStyle.radius).toBe('0px');
    expect(eventStyle.shadow).toBe('none');
    expect(eventStyle.background).toBe('rgba(0, 0, 0, 0)');

    const firstBout = firstEvent.locator('.bout-card').first();
    const boutRadius = await firstBout.evaluate(node => getComputedStyle(node).borderRadius);
    expect(boutRadius).toBe('0px');

    await expect(page.locator('.prediction-actions').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.prediction-button').first()).toContainText('Download Picks');

    const firstFighter = firstBout.locator('.fighter').first();
    await firstFighter.click();
    await expect(firstFighter).toHaveClass(/is-pick/);
    await expect(firstFighter).toHaveAttribute('aria-pressed', 'true');

    const eventId = await firstEvent.getAttribute('id');
    expect(eventId).toBeTruthy();
    await page.goto(targetUrl('/upcoming-events-v3/?event=' + encodeURIComponent(eventId)), {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    await expect(page.locator('#' + CSS.escape(eventId))).toBeVisible();

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });
});

test.describe('Matchmaker V3 isolated migration', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('keeps live Matchmaker untouched while V3 preserves the recommendation engine', async ({ page }) => {
    await page.goto(targetUrl('/matchmaker/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.mm-simple')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-editorial-v3]')).toHaveCount(0);
    await expect(page.locator('.site-theme-toggle')).toHaveCount(0);

    await page.goto(targetUrl('/matchmaker-v3/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-editorial-v3]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.v3-wordmark')).toBeVisible();
    await expect(page.locator('.site-theme-toggle')).toBeVisible();
    await expect(page.locator('.v3-sticky-shell')).toHaveCount(1);

    const stylesheetHrefs = await page.locator('link[rel="stylesheet"]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('href') || '')
    );
    expect(stylesheetHrefs.some(href => href.includes('matchmaker-simple.css'))).toBe(false);
    expect(stylesheetHrefs.some(href => href.includes('matchmaker-ui-readability.css'))).toBe(false);
    expect(stylesheetHrefs.some(href => href.includes('matchmaker-compact.css'))).toBe(false);
    const v3Index = stylesheetHrefs.findIndex(href => href.includes('matchmaker-v3.css'));
    const tailIndex = stylesheetHrefs.findIndex(href => href.includes('site-tail.css'));
    expect(v3Index).toBeGreaterThan(tailIndex);

    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const title = await page.locator('.mm-simple-hero h1').evaluate(node => ({
      text: node.textContent.trim(),
      font: getComputedStyle(node).fontFamily
    }));
    expect(title.text).toBe('Matchmaker');
    expect(title.font).toContain('Herkey');

    await expect(page.locator('[data-mm-app]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-mm-event]')).toBeVisible();

    const files = page.locator('.mm-simple-file');
    expect(await files.count()).toBeGreaterThan(0);

    const firstFile = files.first();
    const fileStyle = await firstFile.evaluate(node => ({
      radius: getComputedStyle(node).borderRadius,
      shadow: getComputedStyle(node).boxShadow,
      transform: getComputedStyle(node).transform,
      background: getComputedStyle(node).backgroundColor
    }));
    expect(fileStyle.radius).toBe('0px');
    expect(fileStyle.shadow).toBe('none');
    expect(fileStyle.transform).toBe('none');
    expect(fileStyle.background).toBe('rgba(0, 0, 0, 0)');

    const fighterNameFont = await firstFile.locator('.mm-simple-fighter-head h2').evaluate(node =>
      getComputedStyle(node).fontFamily
    );
    expect(fighterNameFont).toContain('Herkey');

    const matches = firstFile.locator('.mm-simple-match');
    if (await matches.count()) {
      const firstMatch = matches.first();
      const matchStyle = await firstMatch.evaluate(node => ({
        radius: getComputedStyle(node).borderRadius,
        shadow: getComputedStyle(node).boxShadow,
        background: getComputedStyle(node).backgroundColor
      }));
      expect(matchStyle.radius).toBe('0px');
      expect(matchStyle.shadow).toBe('none');
      expect(matchStyle.background).toBe('rgba(0, 0, 0, 0)');

      const opponentFont = await firstMatch.locator('.mm-simple-match-copy strong').evaluate(node =>
        getComputedStyle(node).fontFamily
      );
      expect(opponentFont).toContain('Herkey');
    }

    const select = page.locator('[data-mm-event]');
    const options = await select.locator('option').count();
    if (options > 1) {
      const firstValue = await select.inputValue();
      const secondValue = await select.locator('option').nth(1).getAttribute('value');
      if (secondValue && secondValue !== firstValue) {
        await select.selectOption(secondValue);
        await expect(select).toHaveValue(secondValue);
        await expect(page).toHaveURL(new RegExp('event=' + encodeURIComponent(secondValue)));
      }
    }

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });
});

test.describe('Event Map V3 isolated migration', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('keeps live Event Map untouched while V3 preserves map interactions in editorial styling', async ({ page }) => {
    await page.goto(targetUrl('/event-map/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.event-map-page')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-editorial-v3]')).toHaveCount(0);
    await expect(page.locator('.site-theme-toggle')).toHaveCount(0);

    await page.goto(targetUrl('/event-map-v3/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-editorial-v3]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.v3-wordmark')).toBeVisible();
    await expect(page.locator('.site-theme-toggle')).toBeVisible();
    await expect(page.locator('.v3-sticky-shell')).toHaveCount(1);

    const stylesheetHrefs = await page.locator('link[rel="stylesheet"]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('href') || '')
    );
    expect(stylesheetHrefs.some(href => href.includes('event-map.css'))).toBe(false);
    expect(stylesheetHrefs.some(href => href.includes('event-map-detail.css'))).toBe(false);
    expect(stylesheetHrefs.some(href => href.includes('event-map-sumo.css'))).toBe(false);
    const v3Index = stylesheetHrefs.findIndex(href => href.includes('event-map-v3.css'));
    const tailIndex = stylesheetHrefs.findIndex(href => href.includes('site-tail.css'));
    expect(v3Index).toBeGreaterThan(tailIndex);

    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const title = await page.locator('.event-map-hero h1').evaluate(node => ({
      text: node.textContent.trim(),
      font: getComputedStyle(node).fontFamily
    }));
    expect(title.text).toBe('Event Map');
    expect(title.font).toContain('Herkey');

    const stageStyle = await page.locator('.event-map-stage').evaluate(node => ({
      radius: getComputedStyle(node).borderRadius,
      shadow: getComputedStyle(node).boxShadow
    }));
    expect(stageStyle.radius).toBe('0px');
    expect(stageStyle.shadow).toBe('none');

    await page.waitForFunction(() => {
      const loading = document.querySelector('[data-map-loading]');
      const states = document.querySelectorAll('.event-map-state');
      return loading?.hidden && states.length > 0;
    }, null, { timeout: 30000 });

    expect(await page.locator('.event-map-state').count()).toBeGreaterThan(0);

    const range30 = page.locator('[data-range="30"]');
    await range30.click();
    await expect(range30).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-range="week"]')).toHaveAttribute('aria-pressed', 'false');

    await page.waitForFunction(() => document.querySelectorAll('.event-map-result').length > 0, null, {
      timeout: 30000
    });

    const firstResult = page.locator('.event-map-result').first();
    await firstResult.click();
    await expect(page.locator('[data-event-detail-card]')).toBeVisible({ timeout: 10000 });

    const detailTitleFont = await page.locator('[data-detail-title]').evaluate(node =>
      getComputedStyle(node).fontFamily
    );
    expect(detailTitleFont).toContain('Herkey');

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });
});

test.describe('UFC Roster V3 isolated migration', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('keeps live roster untouched while V3 renders a flat editorial ledger', async ({ page }) => {
    await page.goto(targetUrl('/ufc-roster/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.ufc-roster-page')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-editorial-v3]')).toHaveCount(0);
    await expect(page.locator('.site-theme-toggle')).toHaveCount(0);

    await page.goto(targetUrl('/ufc-roster-v3/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-editorial-v3]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.v3-wordmark')).toBeVisible();
    await expect(page.locator('.site-theme-toggle')).toBeVisible();
    await expect(page.locator('.v3-sticky-shell')).toHaveCount(1);

    const stylesheetHrefs = await page.locator('link[rel="stylesheet"]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('href') || '')
    );
    expect(stylesheetHrefs.some(href => href.includes('ufc-roster.css'))).toBe(false);
    expect(stylesheetHrefs.some(href => href.includes('dynamic-page-stability.css'))).toBe(false);
    const v3Index = stylesheetHrefs.findIndex(href => href.includes('ufc-roster-v3.css'));
    const tailIndex = stylesheetHrefs.findIndex(href => href.includes('site-tail.css'));
    expect(v3Index).toBeGreaterThan(tailIndex);

    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const title = await page.locator('.ufc-roster-hero h1').evaluate(node => ({
      text: node.textContent.trim(),
      font: getComputedStyle(node).fontFamily
    }));
    expect(title.text).toBe('UFC Roster');
    expect(title.font).toContain('Herkey');

    const stats = page.locator('.ufc-roster-stat');
    await expect(stats).toHaveCount(3);
    const statStyle = await stats.first().evaluate(node => ({
      radius: getComputedStyle(node).borderRadius,
      shadow: getComputedStyle(node).boxShadow,
      background: getComputedStyle(node).backgroundColor
    }));
    expect(statStyle.radius).toBe('0px');
    expect(statStyle.shadow).toBe('none');
    expect(statStyle.background).toBe('rgba(0, 0, 0, 0)');

    await page.waitForFunction(() => {
      const list = document.querySelector('[data-roster-list]');
      return list && list.getAttribute('aria-busy') === 'false';
    }, null, { timeout: 30000 });

    const cards = page.locator('.ufc-roster-card');
    if (await cards.count()) {
      const cardStyle = await cards.first().evaluate(node => ({
        radius: getComputedStyle(node).borderRadius,
        shadow: getComputedStyle(node).boxShadow,
        background: getComputedStyle(node).backgroundColor
      }));
      expect(cardStyle.radius).toBe('0px');
      expect(cardStyle.shadow).toBe('none');
      expect(cardStyle.background).toBe('rgba(0, 0, 0, 0)');

      const nameFont = await cards.first().locator('.ufc-roster-name').evaluate(node =>
        getComputedStyle(node).fontFamily
      );
      expect(nameFont).toContain('Herkey');
    } else {
      await expect(page.locator('.ufc-roster-empty')).toBeVisible();
    }

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });
});

test.describe('On This Day V3 isolated migration', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('uses a clean editorial cascade while preserving date and share behavior', async ({ page }) => {
    await page.goto(targetUrl('/on-this-day/?date=09-08'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('.otd-page')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-editorial-v3]')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.goto(targetUrl('/on-this-day-v3/?date=09-08'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-editorial-v3]')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.v3-wordmark')).toBeVisible();
    await expect(page.locator('.site-theme-toggle')).toBeVisible();
    await expect(page.locator('.v3-sticky-shell')).toHaveCount(1);

    const stylesheetHrefs = await page.locator('link[rel="stylesheet"]').evaluateAll(nodes =>
      nodes.map(node => node.getAttribute('href') || '')
    );
    expect(stylesheetHrefs.some(href => href.includes('on-this-day.bundle.css'))).toBe(false);
    expect(stylesheetHrefs.some(href => href.includes('otd-event-poster-fallback.css'))).toBe(false);
    const v3Index = stylesheetHrefs.findIndex(href => href.includes('on-this-day-v3.css'));
    const tailIndex = stylesheetHrefs.findIndex(href => href.includes('site-tail.css'));
    expect(v3Index).toBeGreaterThan(tailIndex);

    await page.waitForFunction(() => {
      const list = document.querySelector('[data-otd-list]');
      return list && list.getAttribute('aria-busy') === 'false' && list.children.length > 0;
    }, null, { timeout: 30000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});

    await expect(page.locator('.otd-v3-eyebrow')).toHaveText('MMA History Archive');
    await expect(page.locator('.otd-v3-title-block h1')).toHaveText('On This Day');

    const heading = await page.locator('.otd-v3-title-block h1').evaluate(node => ({
      font: getComputedStyle(node).fontFamily,
      size: parseFloat(getComputedStyle(node).fontSize)
    }));
    expect(heading.font).toContain('Herkey');
    expect(heading.size).toBeLessThan(64);

    const firstPill = page.locator('.otd-day-pill').first();
    await expect(firstPill).toBeVisible();
    const pillStyle = await firstPill.evaluate(node => ({
      radius: getComputedStyle(node).borderRadius,
      shadow: getComputedStyle(node).boxShadow
    }));
    expect(pillStyle.radius).toBe('0px');
    expect(pillStyle.shadow).toBe('none');
    await expect(firstPill.locator('.otd-day-pill-image')).toBeHidden();

    const firstEntry = page.locator('.otd-entry').first();
    const entryStyle = await firstEntry.evaluate(node => ({
      radius: getComputedStyle(node).borderRadius,
      shadow: getComputedStyle(node).boxShadow,
      background: getComputedStyle(node).backgroundColor
    }));
    expect(entryStyle.radius).toBe('0px');
    expect(entryStyle.shadow).toBe('none');
    expect(entryStyle.background).toBe('rgba(0, 0, 0, 0)');

    const entryShare = page.locator('.otd-entry-share').first();
    await expect(entryShare).toBeVisible();
    const entryShareStyle = await entryShare.evaluate(node => ({
      radius: getComputedStyle(node).borderRadius,
      background: getComputedStyle(node).backgroundColor,
      shadow: getComputedStyle(node).boxShadow
    }));
    expect(entryShareStyle.radius).toBe('0px');
    expect(entryShareStyle.background).toBe('rgba(0, 0, 0, 0)');
    expect(entryShareStyle.shadow).toBe('none');

    const readyImage = page.locator('.otd-entry-media.is-image-ready img').first();
    if (await readyImage.count()) {
      await expect.poll(async () => readyImage.evaluate(img =>
        Boolean(img.complete && img.naturalWidth > 0 && img.naturalHeight > 0)
      ), { timeout: 10000 }).toBe(true);
      const ratio = await readyImage.evaluate(img => {
        const rect = img.getBoundingClientRect();
        return {
          natural: img.naturalWidth / img.naturalHeight,
          rendered: rect.width / rect.height
        };
      });
      expect(Math.abs(ratio.natural - ratio.rendered)).toBeLessThan(0.03);
    }

    const dockTop = await page.locator('.otd-nav-dock').evaluate(node =>
      parseFloat(getComputedStyle(node).top)
    );
    const railHeight = await page.evaluate(() =>
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--v3-fixed-rail-height')) || 0
    );
    expect(Math.abs(dockTop - railHeight)).toBeLessThanOrEqual(2);

    const desktopDir = path.join(SCREENSHOT_DIR, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    await page.screenshot({
      path: path.join(desktopDir, 'on-this-day-v3-rebuild.png'),
      fullPage: true
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(120);
    const mobileDir = path.join(SCREENSHOT_DIR, 'mobile-390');
    fs.mkdirSync(mobileDir, { recursive: true });
    await page.screenshot({
      path: path.join(mobileDir, 'on-this-day-v3-rebuild.png'),
      fullPage: true
    });
    await page.setViewportSize({ width: 1365, height: 900 });

    const beforeDate = (await page.locator('.otd-page-date').textContent() || '').trim();
    await page.locator('[data-otd-next]').click();
    await expect.poll(async () =>
      (await page.locator('.otd-page-date').textContent() || '').trim()
    ).not.toBe(beforeDate);

    const media = page.locator('.otd-entry-media.is-image-ready').first();
    if (await media.count()) {
      await media.click();
      await expect(page.locator('.otd-share-modal')).toBeVisible({ timeout: 30000 });
      await page.locator('.otd-share-close').click();
      await expect(page.locator('.otd-share-modal')).toBeHidden();
    }

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);

    await page.evaluate(() => window.scrollTo({ top: 1400, behavior: 'instant' }));
    await page.waitForTimeout(120);
    const fixedTop = await page.locator('.v3-sticky-shell').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(Math.abs(fixedTop)).toBeLessThanOrEqual(2);

    await page.locator('.site-theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });
});


test.describe('Homepage V2 immersive scroll', () => {
  test.use({ viewport: { width: 1365, height: 900 }, isMobile: false, hasTouch: false });

  test('scroll advances the fixed story deck instead of moving the viewport content', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(targetUrl('/homepage-v2/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('[data-immersive-stage]')).toBeVisible({ timeout: 30000 });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page.waitForTimeout(150);

    const fullBleedGeometry = await page.locator('[data-immersive-slide][data-scene-index="0"]').evaluate(node => {
      const image = node.querySelector('.home-immersive-image');
      const copy = node.querySelector('.home-immersive-copy');
      const imageRect = image?.getBoundingClientRect();
      const copyRect = copy?.getBoundingClientRect();
      return {
        viewportHeight: window.innerHeight,
        imageTop: Math.round(imageRect?.top || 0),
        imageBottom: Math.round(imageRect?.bottom || 0),
        imageHeight: Math.round(imageRect?.height || 0),
        copyTop: Math.round(copyRect?.top || 0),
        copyBottom: Math.round(copyRect?.bottom || 0)
      };
    });
    expect(Math.abs(fullBleedGeometry.imageTop)).toBeLessThanOrEqual(2);
    expect(Math.abs(fullBleedGeometry.imageBottom - fullBleedGeometry.viewportHeight)).toBeLessThanOrEqual(2);
    expect(fullBleedGeometry.imageHeight).toBeGreaterThanOrEqual(fullBleedGeometry.viewportHeight - 2);
    expect(fullBleedGeometry.copyTop).toBeGreaterThan(0);
    expect(fullBleedGeometry.copyBottom).toBeLessThanOrEqual(fullBleedGeometry.viewportHeight);

    const initialCounter = (await page.locator('[data-scene-counter]').textContent() || '').trim();
    expect(initialCounter).toMatch(/^01\s*\/\s*0?5$/);

    const initialStageTop = await page.locator('[data-immersive-stage]').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(Math.abs(initialStageTop)).toBeLessThanOrEqual(2);

    await page.evaluate(() => window.scrollBy({ top: window.innerHeight * 1.15, behavior: 'instant' }));
    await page.waitForTimeout(180);

    const secondCounter = (await page.locator('[data-scene-counter]').textContent() || '').trim();
    expect(secondCounter).toMatch(/^02\s*\/\s*0?5$/);

    const secondOpacity = await page.locator('[data-immersive-slide][data-scene-index="1"]').evaluate(node =>
      Number.parseFloat(getComputedStyle(node).getPropertyValue('--scene-opacity')) || 0
    );
    expect(secondOpacity).toBeGreaterThan(0.9);

    const stageTopAfterScroll = await page.locator('[data-immersive-stage]').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(Math.abs(stageTopAfterScroll)).toBeLessThanOrEqual(2);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(2);
    expect(pageErrors).toEqual([]);
  });

  test('site index opens as a vertical control-room index with ticker fixed at top', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.goto(targetUrl('/homepage-v2/'), { waitUntil: 'domcontentloaded', timeout: 45000 });
    await expect(page.locator('#navigation-toggle')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(120);

    const tickerTop = await page.locator('.site-live-strip').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(Math.abs(tickerTop)).toBeLessThanOrEqual(2);

    await page.locator('#navigation-toggle').click();
    await expect(page.locator('body')).toHaveClass(/navigation-is-open/);
    await expect(page.locator('#navigation-panel')).toBeVisible();

    const links = page.locator('#navigation-list > li > a');
    await expect(links).toHaveCount(7);

    const boxes = await links.evaluateAll(nodes =>
      nodes.map(node => {
        const rect = node.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        };
      })
    );

    for (let i = 1; i < boxes.length; i += 1) {
      expect(boxes[i].top).toBeGreaterThan(boxes[i - 1].top + 20);
      expect(Math.abs(boxes[i].left - boxes[0].left)).toBeLessThanOrEqual(4);
    }

    expect(boxes[0].width).toBeGreaterThan(420);

    const openTickerTop = await page.locator('.site-live-strip').evaluate(node =>
      Math.round(node.getBoundingClientRect().top)
    );
    expect(Math.abs(openTickerTop)).toBeLessThanOrEqual(2);

    await page.locator('#navigation-toggle').click();
    await expect(page.locator('body')).not.toHaveClass(/navigation-is-open/);
    expect(pageErrors).toEqual([]);
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
