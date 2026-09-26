const { test, expect } = require('@playwright/test');

const BASE = process.env.WRITER_BASE_URL || 'https://mmamatlock.com/write/';

test('fighter lookup autofills verified stats and live UFCStats can override them', async ({ page }) => {
  test.setTimeout(45000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('**/assets/data/writer-fighters.json?writer-fighters=*', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-09-26T18:00:00.000Z',
        builtAt: '2026-09-26T18:00:00.000Z',
        mirrorThrough: '2026-09-26',
        fighters: [{
          id: 'lookup-fighter',
          name: 'Lookup Fighter',
          division: 'Lightweight',
          record: '12-2-0',
          ufcRecord: '6-1-0',
          recordOutsideUfc: '6-1-0',
          rank: 9,
          image: 'https://example.com/lookup.png',
          checkedAt: '2026-09-26T18:00:00.000Z',
          ufcStatsId: 'aaaaaaaaaaaaaaaa',
          sourceUrl: 'https://ufcstats.com/fighter-details/aaaaaaaaaaaaaaaa',
          latestBoutDate: '2026-09-01',
          mirrorThrough: '2026-09-26',
          bio: { height: '5\' 10"', reach: '72"', dob: 'Jan 01, 1998' },
          stats: {
            slpm: '4.44',
            sapm: '2.22',
            strAccuracy: '50%',
            strDefense: '60%',
            tdAvg: '1.50',
            tdAccuracy: '40%',
            tdDefense: '70%',
            subAvg: '0.50',
            sample: { fights: 5, minutes: 50, latestBoutDate: '2026-09-01' }
          },
          career: {
            winsByKnockout: 5,
            winsBySubmission: 2,
            totalFinishes: 7,
            decisionWins: 5,
            unanimousDecisionWins: 4,
            splitDecisionWins: 1,
            majorityDecisionWins: 0,
            otherDecisionWins: 0,
            decisionBreakdownComplete: true
          },
          recent: [{
            result: 'W',
            opponent: 'Recent Opponent',
            method: 'Decision - Unanimous',
            date: '2026-09-01'
          }]
        }]
      })
    });
  });

  await page.route('https://mmamatlock-writer-auth.netlify.app/api/writer/fighter*', async route => {
    await new Promise(resolve => setTimeout(resolve, 80));
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        ok: true,
        source: 'UFCStats+UFC.com',
        mode: 'live',
        liveUfcStats: true,
        liveUfcProfile: true,
        fetchedAt: '2026-09-26T18:01:00.000Z',
        sourceUrl: 'https://ufcstats.com/fighter-details/aaaaaaaaaaaaaaaa',
        profile: {
          statsId: 'aaaaaaaaaaaaaaaa',
          name: 'Lookup Fighter',
          record: '12-2-0',
          height: '5\' 10"',
          reach: '72"',
          dob: 'Jan 01, 1998',
          stats: {
            slpm: '9.99',
            sapm: '1.11',
            strAccuracy: '61%',
            strDefense: '67%',
            tdAvg: '2.50',
            tdAccuracy: '50%',
            tdDefense: '80%',
            subAvg: '0.70'
          },
          career: {
            winsByKnockout: 6,
            winsBySubmission: 2,
            totalFinishes: 8,
            decisionWins: 4,
            unanimousDecisionWins: 3,
            splitDecisionWins: 1
          },
          ufcRecord: '6-1-0',
          latestBoutDate: '2026-09-01',
          recent: [{
            result: 'W',
            opponent: 'Recent Opponent',
            method: 'Decision - Unanimous',
            date: '2026-09-01'
          }]
        }
      })
    });
  });

  await page.route('https://mmamatlock-writer-auth.netlify.app/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/writer/fighter') return route.fallback();
    if (url.pathname.endsWith('/auth/github/health')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ ok: true, configured: false })
      });
    }
    return route.fulfill({
      status: 401,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: false })
    });
  });

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.click('[data-library-new]');
  await page.click('[data-tool="stats"]');

  const dialog = page.locator('[data-stats-dialog]');
  await expect(dialog).toBeVisible();
  const input = dialog.locator('[data-stats-fighter="a"]');
  await input.fill('Lookup');

  const suggestion = dialog.locator('.writer-fighter-suggestion').first();
  await expect(suggestion).toContainText('Lookup Fighter');
  await suggestion.click();

  const firstRow = dialog.locator('[data-stats-row-list] .writer-comparison-row').first();
  await expect(firstRow.locator('[data-structured-a]')).toHaveValue('4.44');
  const sourceStatus = input.locator('xpath=..').locator('.writer-fighter-source-status');
  await expect(sourceStatus).toContainText('checking live');

  await expect(firstRow.locator('[data-structured-a]')).toHaveValue('9.99');
  await expect(sourceStatus).toContainText('LIVE UFCStats');
  await expect(input).toHaveAttribute('data-source-mode', 'live');

  dialog.locator('[value="cancel"]').first().click();
  await page.click('[data-tool="tale"]');
  const taleDialog = page.locator('[data-tale-dialog]');
  const taleA = taleDialog.locator('[data-tale-a]');
  await taleA.fill('Lookup');
  await taleDialog.locator('.writer-fighter-suggestion').first().click();

  const taleRows = taleDialog.locator('[data-tale-row-list] .writer-comparison-row');
  await expect(taleRows).toHaveCount(11);
  await expect(taleRows.nth(6).locator('[data-structured-label]')).toHaveValue('Total Finishes');
  await expect(taleRows.nth(6).locator('[data-structured-a]')).toHaveValue('8');
  await expect(taleRows.nth(7).locator('[data-structured-label]')).toHaveValue('TKO / KO');
  await expect(taleRows.nth(7).locator('[data-structured-a]')).toHaveValue('6');
  await expect(taleRows.nth(8).locator('[data-structured-label]')).toHaveValue('Submission');
  await expect(taleRows.nth(8).locator('[data-structured-a]')).toHaveValue('2');
  await expect(taleRows.nth(9).locator('[data-structured-label]')).toHaveValue('Unanimous Decision');
  await expect(taleRows.nth(9).locator('[data-structured-a]')).toHaveValue('3');
  await expect(taleRows.nth(10).locator('[data-structured-label]')).toHaveValue('Split Decision');
  await expect(taleRows.nth(10).locator('[data-structured-a]')).toHaveValue('1');

  expect(pageErrors).toEqual([]);
});


test('Brad Tavares stays complete when the live probe fails', async ({ page }) => {
  test.setTimeout(45000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('https://mmamatlock-writer-auth.netlify.app/api/writer/fighter*', async route => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok:false, error:'simulated live source outage' })
    });
  });

  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.click('[data-library-new]');

  await page.click('[data-tool="stats"]');
  const statsDialog = page.locator('[data-stats-dialog]');
  const statsInput = statsDialog.locator('[data-stats-fighter="a"]');
  await statsInput.fill('Brad Tavares');
  await statsDialog.locator('.writer-fighter-suggestion', { hasText:'Brad Tavares' }).first().click();

  const statValues = await statsDialog.locator('[data-stats-row-list] [data-structured-a]').evaluateAll(nodes =>
    nodes.map(node => node.value.trim())
  );
  expect(statValues).toHaveLength(8);
  expect(statValues.every(Boolean)).toBe(true);
  await expect(statsInput.locator('xpath=..').locator('.writer-fighter-source-status')).toContainText('Verified stats loaded');

  await statsDialog.locator('button[value="cancel"]').first().click();

  await page.click('[data-tool="tale"]');
  const taleDialog = page.locator('[data-tale-dialog]');
  const taleInput = taleDialog.locator('[data-tale-a]');
  await taleInput.fill('Brad Tavares');
  await taleDialog.locator('.writer-fighter-suggestion', { hasText:'Brad Tavares' }).first().click();

  const taleRows = taleDialog.locator('[data-tale-row-list] .writer-comparison-row');
  await expect(taleRows).toHaveCount(11);
  const taleValues = await taleRows.locator('[data-structured-a]').evaluateAll(nodes =>
    nodes.map(node => node.value.trim())
  );
  expect(taleValues.every(Boolean)).toBe(true);

  await expect(taleRows.nth(6).locator('[data-structured-a]')).not.toHaveValue('');
  await expect(taleRows.nth(7).locator('[data-structured-a]')).not.toHaveValue('');
  await expect(taleRows.nth(8).locator('[data-structured-a]')).not.toHaveValue('');
  await expect(taleRows.nth(9).locator('[data-structured-a]')).not.toHaveValue('');
  await expect(taleRows.nth(10).locator('[data-structured-a]')).not.toHaveValue('');
  await expect(taleInput.locator('xpath=..').locator('.writer-fighter-source-status')).toContainText('Verified stats loaded');

  expect(pageErrors).toEqual([]);
});
