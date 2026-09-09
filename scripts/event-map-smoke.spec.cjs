const { test, expect } = require('@playwright/test');

const BASE = process.env.EVENT_MAP_BASE_URL || 'https://mmamatlock.com/event-map/';

async function ready(page, url = BASE) {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-map-loading]')).toBeHidden({ timeout: 30000 });
  await expect(page.locator('.event-map-pin-group').first()).toBeVisible({ timeout: 30000 });
  return pageErrors;
}

async function title(page) {
  return (await page.locator('[data-detail-title]').textContent() || '').trim();
}

async function expectNoHorizontalOverflow(page, tolerance = 2) {
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }));
  expect(overflow.page - overflow.viewport).toBeLessThanOrEqual(tolerance);
}

async function expectActionUrls(page) {
  const calendarHref = await page.locator('[data-detail-calendar]').getAttribute('href');
  expect(calendarHref || '').toMatch(/^blob:/);

  const source = page.locator('[data-detail-source]:not([hidden])');
  if (await source.count()) expect(await source.getAttribute('href')).toMatch(/^https?:\/\//);

  const tickets = page.locator('[data-detail-tickets]:not([hidden])');
  if (await tickets.count()) expect(await tickets.getAttribute('href')).toMatch(/^https?:\/\//);

  const picker = page.locator('[data-detail-picker]:not([hidden])');
  if (await picker.count()) {
    const href = await picker.getAttribute('href');
    expect(href || '').toContain('/upcoming-events/');
    expect(href || '').toContain('#');
  }
}

test.describe('Event Map desktop interaction chain', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('first through later selections, history, hover, zoom and results stay coherent', async ({ page }) => {
    const pageErrors = await ready(page);
    const singles = page.locator('.event-map-pin-group:not(.event-map-cluster)');
    const count = await singles.count();
    expect(count).toBeGreaterThan(0);

    await singles.nth(0).click();
    await expect(page.locator('[data-event-detail-card]')).toBeVisible();
    const firstTitle = await title(page);
    const firstUrl = page.url();
    expect(new URL(firstUrl).searchParams.get('event')).toBeTruthy();
    await expectActionUrls(page);

    if (count > 1) {
      await singles.nth(1).hover();
      await page.waitForTimeout(120);
      await expect.poll(() => title(page)).toBe(firstTitle);

      await singles.nth(1).click();
      const secondTitle = await title(page);
      const secondUrl = page.url();
      expect(secondTitle).not.toBe('');
      expect(secondTitle).not.toBe(firstTitle);
      expect(secondUrl).not.toBe(firstUrl);

      if (count > 2) {
        await singles.nth(2).click();
        const thirdTitle = await title(page);
        expect(thirdTitle).not.toBe('');
        expect(thirdTitle).not.toBe(secondTitle);

        await page.goBack();
        await expect.poll(() => title(page), { timeout: 5000 }).toBe(secondTitle);
        await page.goBack();
        await expect.poll(() => title(page), { timeout: 5000 }).toBe(firstTitle);
        expect(page.url()).toBe(firstUrl);

        await page.goForward();
        await expect.poll(() => title(page), { timeout: 5000 }).toBe(secondTitle);
        await page.goBack();
        await expect.poll(() => title(page), { timeout: 5000 }).toBe(firstTitle);
      } else {
        await page.goBack();
        await expect.poll(() => title(page), { timeout: 5000 }).toBe(firstTitle);
        expect(page.url()).toBe(firstUrl);
      }
    }

    await page.locator('[data-map-zoom-in]').click();
    await page.waitForTimeout(350);
    await expect.poll(() => title(page)).toBe(firstTitle);
    await page.locator('[data-map-zoom-out]').click();
    await page.waitForTimeout(350);
    await expect.poll(() => title(page)).toBe(firstTitle);

    await page.locator('[data-range="week"]').click();
    await expect(page.locator('[data-range="week"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-range="all"]').click();
    await expect(page.locator('[data-range="all"]')).toHaveAttribute('aria-pressed', 'true');

    const results = page.locator('.event-map-result');
    expect(await results.count()).toBeGreaterThan(0);
    await results.first().click();
    await expect(page.locator('[data-event-detail-card]')).toBeVisible();
    expect(new URL(page.url()).searchParams.get('event')).toBeTruthy();
    await expectActionUrls(page);
    await expectNoHorizontalOverflow(page);

    expect(pageErrors).toEqual([]);
  });

  test('a committed deep link survives direct load and reload', async ({ page }) => {
    const pageErrors = await ready(page);
    const single = page.locator('.event-map-pin-group:not(.event-map-cluster)').first();
    await single.click();
    const selectedTitle = await title(page);
    const selectedUrl = page.url();
    expect(new URL(selectedUrl).searchParams.get('event')).toBeTruthy();

    await page.goto(selectedUrl, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-map-loading]')).toBeHidden({ timeout: 30000 });
    await expect.poll(() => title(page), { timeout: 10000 }).toBe(selectedTitle);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-map-loading]')).toBeHidden({ timeout: 30000 });
    await expect.poll(() => title(page), { timeout: 10000 }).toBe(selectedTitle);
    await expectActionUrls(page);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('Event Map mobile interaction chain', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('repeated pin taps, history, zoom, controls and clusters remain touch-safe', async ({ page }) => {
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

    const historyTitles = [firstTitle];
    const taps = Math.min(count, 3);
    for (let index = 1; index < taps; index += 1) {
      await singles.nth(index).tap();
      const currentTitle = await title(page);
      expect(currentTitle).not.toBe('');
      expect(currentTitle).not.toBe(historyTitles.at(-1));
      historyTitles.push(currentTitle);
      const afterTap = await page.evaluate(() => window.scrollY);
      expect(Math.abs(afterTap - before)).toBeLessThan(130);
    }

    for (let index = historyTitles.length - 2; index >= 0; index -= 1) {
      await page.goBack();
      await expect.poll(() => title(page), { timeout: 5000 }).toBe(historyTitles[index]);
    }

    await page.locator('[data-map-zoom-in]').tap();
    await page.waitForTimeout(350);
    await expect.poll(() => title(page)).toBe(firstTitle);
    await page.locator('[data-map-zoom-out]').tap();
    await page.waitForTimeout(350);
    await expect.poll(() => title(page)).toBe(firstTitle);

    await page.locator('[data-range="week"]').tap();
    await expect(page.locator('[data-range="week"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-range="all"]').tap();
    await expect(page.locator('[data-range="all"]')).toHaveAttribute('aria-pressed', 'true');

    const clusters = page.locator('.event-map-pin-group.event-map-cluster');
    if (await clusters.count()) {
      await clusters.first().tap();
      await expect(page.locator('[data-cluster-card]')).toBeVisible();
      await expect(page.locator('.event-map-cluster-event').first()).toBeVisible();
      await page.locator('.event-map-cluster-event').first().tap();
      await expect(page.locator('[data-event-detail-card]')).toBeVisible();
      await expectActionUrls(page);
    }

    await expectNoHorizontalOverflow(page);
    expect(pageErrors).toEqual([]);
  });
});
