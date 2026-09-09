const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.SITE_BASE_URL || 'https://mmamatlock.com';
const SCREENSHOT_DIR = process.env.VISUAL_SMOKE_DIR || 'artifacts/site-visual-smoke';

const pages = [
  { slug: 'home', path: '/', ready: '.homepage-dashboard' },
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
