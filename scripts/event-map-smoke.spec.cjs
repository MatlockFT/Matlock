const { test, expect } = require('@playwright/test');

const BASE = process.env.EVENT_MAP_BASE_URL || 'https://mmamatlock.com/event-map/';

async function ready(page) {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-map-loading]')).toBeHidden({ timeout: 30000 });
  await expect(page.locator('.event-map-pin-group').first()).toBeVisible({ timeout: 30000 });
  return pageErrors;
}

async function title(page) {
  return (await page.locator('[data-detail-title]').textContent() || '').trim();
}

test.describe('Event Map desktop interaction chain', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('first, second, back, zoom and results stay coherent', async ({ page }) => {
    const pageErrors = await ready(page);
    const singles = page.locator('.event-map-pin-group:not(.event-map-cluster)');
    const count = await singles.count();
    expect(count).toBeGreaterThan(0);

    await singles.nth(0).click();
    await expect(page.locator('[data-event-detail-card]')).toBeVisible();
    const firstTitle = await title(page);
    const firstUrl = page.url();
    expect(new URL(firstUrl).searchParams.get('event')).toBeTruthy();

    if (count > 1) {
      await singles.nth(1).click();
      const secondTitle = await title(page);
      expect(secondTitle).not.toBe('');
      expect(page.url()).not.toBe(firstUrl);

      await page.evaluate(() => history.back());
      await expect.poll(() => title(page), { timeout: 5000 }).toBe(firstTitle);
      expect(page.url()).toBe(firstUrl);
    }

    await page.locator('[data-map-zoom-in]').click();
    await page.waitForTimeout(450);
    await expect.poll(() => title(page)).toBe(firstTitle);

    const results = page.locator('.event-map-result');
    expect(await results.count()).toBeGreaterThan(0);
    await results.first().click();
    await expect(page.locator('[data-event-detail-card]')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('event')).toBeTruthy();

    const calendarHref = await page.locator('[data-detail-calendar]').getAttribute('href');
    expect(calendarHref || '').toMatch(/^blob:/);
    const source = page.locator('[data-detail-source]:not([hidden])');
    if (await source.count()) expect(await source.getAttribute('href')).toMatch(/^https?:\/\//);

    expect(pageErrors).toEqual([]);
  });
});

test.describe('Event Map mobile interaction chain', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('repeated pin taps stay on map; clusters deliberately move to chooser', async ({ page }) => {
    const pageErrors = await ready(page);
    const singles = page.locator('.event-map-pin-group:not(.event-map-cluster)');
    const count = await singles.count();
    expect(count).toBeGreaterThan(0);

    const before = await page.evaluate(() => window.scrollY);
    await singles.nth(0).tap();
    await expect(page.locator('[data-event-detail-card]')).toBeVisible();
    const firstTitle = await title(page);
    const afterFirst = await page.evaluate(() => window.scrollY);
    expect(Math.abs(afterFirst - before)).toBeLessThan(100);

    if (count > 1) {
      await singles.nth(1).tap();
      const secondTitle = await title(page);
      expect(secondTitle).not.toBe('');
      expect(secondTitle).not.toBe(firstTitle);
      const afterSecond = await page.evaluate(() => window.scrollY);
      expect(Math.abs(afterSecond - before)).toBeLessThan(120);

      await page.evaluate(() => history.back());
      await expect.poll(() => title(page), { timeout: 5000 }).toBe(firstTitle);
    }

    const clusters = page.locator('.event-map-pin-group.event-map-cluster');
    if (await clusters.count()) {
      await clusters.first().tap();
      await expect(page.locator('[data-cluster-card]')).toBeVisible();
      await expect(page.locator('.event-map-cluster-event').first()).toBeVisible();
      await page.locator('.event-map-cluster-event').first().tap();
      await expect(page.locator('[data-event-detail-card]')).toBeVisible();
    }

    expect(pageErrors).toEqual([]);
  });
});
