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



test('partial cached career is completed by the verified live fallback', async ({ page }) => {
  test.setTimeout(45000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('**/assets/data/writer-fighters.json?writer-fighters=*', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-09-26T21:40:00.000Z',
        builtAt: '2026-09-26T21:40:00.000Z',
        mirrorThrough: '2026-09-19',
        fighters: [{
          id: 'partial-career',
          name: 'Partial Career',
          division: 'Welterweight',
          record: '9-2-0',
          ufcRecord: '1-0-0',
          recordOutsideUfc: '8-2-0',
          rank: null,
          image: '',
          checkedAt: '2026-09-26T21:40:00.000Z',
          ufcStatsId: 'bbbbbbbbbbbbbbbb',
          sourceUrl: 'https://ufcstats.com/fighter-details/bbbbbbbbbbbbbbbb',
          latestBoutDate: '2026-08-01',
          mirrorThrough: '2026-09-19',
          bio: { height: '6\' 0"', reach: '75"', dob: 'Jan 02, 1997', weight: '170 lbs.' },
          stats: {
            slpm: '3.50',
            sapm: '2.20',
            strAccuracy: '48%',
            strDefense: '58%',
            tdAvg: '1.10',
            tdAccuracy: '42%',
            tdDefense: '71%',
            subAvg: '0.30',
            sample: { fights: 1, minutes: 15, latestBoutDate: '2026-08-01' }
          },
          career: {
            winsByKnockout: null,
            winsBySubmission: null,
            totalFinishes: null,
            decisionWins: null,
            unanimousDecisionWins: 0,
            splitDecisionWins: 0,
            majorityDecisionWins: 0,
            otherDecisionWins: 0,
            decisionBreakdownComplete: false
          },
          recent: [{
            result: 'W',
            opponent: 'UFC Opponent',
            method: 'Decision - Unanimous',
            date: '2026-08-01'
          }]
        }]
      })
    });
  });

  await page.route('https://mmamatlock-writer-auth.netlify.app/api/writer/fighter*', async route => {
    await new Promise(resolve => setTimeout(resolve, 120));
    await route.fulfill({
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({
        ok: true,
        source: 'UFCStats+UFC.com+career fallback',
        mode: 'live',
        liveUfcStats: false,
        liveUfcProfile: false,
        liveCareerFallback: true,
        completeCareer: true,
        careerSource: 'UFCFight.net',
        careerSourceUrl: 'https://ufcfight.net/partial-career/',
        fetchedAt: '2026-09-26T21:41:00.000Z',
        profile: {
          name: 'Partial Career',
          record: '9-2-0',
          career: {
            winsByKnockout: 4,
            winsBySubmission: 2,
            totalFinishes: 6,
            decisionWins: 3,
            unanimousDecisionWins: 2,
            splitDecisionWins: 1,
            majorityDecisionWins: 0,
            otherDecisionWins: 0,
            decisionBreakdownComplete: true
          }
        }
      })
    });
  });

  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.click('[data-library-new]');
  await page.click('[data-tool="tale"]');

  const dialog = page.locator('[data-tale-dialog]');
  const input = dialog.locator('[data-tale-a]');
  await input.fill('Partial Career');
  await dialog.locator('.writer-fighter-suggestion', { hasText:'Partial Career' }).click();

  const rows = dialog.locator('[data-tale-row-list] .writer-comparison-row');
  await expect(rows).toHaveCount(11);

  await expect(rows.nth(6).locator('[data-structured-a]')).toHaveValue('6');
  await expect(rows.nth(7).locator('[data-structured-a]')).toHaveValue('4');
  await expect(rows.nth(8).locator('[data-structured-a]')).toHaveValue('2');
  await expect(rows.nth(9).locator('[data-structured-a]')).toHaveValue('2');
  await expect(rows.nth(10).locator('[data-structured-a]')).toHaveValue('1');

  const status = input.locator('xpath=..').locator('.writer-fighter-source-status');
  await expect(status).toContainText('career checked live via UFCFight.net');
  await expect(input).toHaveAttribute('data-source-mode', 'live-profile');

  const values = await rows.locator('[data-structured-a]').evaluateAll(nodes =>
    nodes.map(node => node.value.trim())
  );
  expect(values.every(Boolean)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test('fighters without a UFCStats sample show explicit N/A instead of blanks', async ({ page }) => {
  test.setTimeout(45000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('**/assets/data/writer-fighters.json?writer-fighters=*', async route => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-09-26T21:32:12.000Z',
        builtAt: '2026-09-26T21:32:12.000Z',
        mirrorThrough: '2026-09-19',
        fighters: [{
          id: 'new-signing',
          name: 'New Signing',
          division: 'Lightweight',
          record: '6-0-0',
          ufcRecord: '0-0-0',
          recordOutsideUfc: '6-0-0',
          image: '',
          checkedAt: '2026-09-26T21:32:12.000Z',
          ufcStatsId: '',
          sourceUrl: null,
          latestBoutDate: null,
          bio: { height: null, reach: null, dob: null },
          stats: null,
          career: {
            winsByKnockout: 5,
            winsBySubmission: 0,
            totalFinishes: 5,
            decisionWins: 1,
            unanimousDecisionWins: 1,
            splitDecisionWins: 0,
            majorityDecisionWins: 0,
            otherDecisionWins: 0,
            decisionBreakdownComplete: true
          },
          recent: []
        }]
      })
    });
  });

  await page.route('https://mmamatlock-writer-auth.netlify.app/api/writer/fighter*', async route => {
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok:false, error:'simulated unavailable live sources' })
    });
  });

  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.click('[data-library-new]');

  await page.click('[data-tool="stats"]');
  const statsDialog = page.locator('[data-stats-dialog]');
  const statsInput = statsDialog.locator('[data-stats-fighter="a"]');
  await statsInput.fill('New Signing');
  await statsDialog.locator('.writer-fighter-suggestion', { hasText:'New Signing' }).click();

  const statValues = await statsDialog.locator('[data-stats-row-list] [data-structured-a]').evaluateAll(nodes =>
    nodes.map(node => node.value.trim())
  );
  expect(statValues).toHaveLength(8);
  expect(statValues.every(value => value === 'N/A')).toBe(true);

  await statsDialog.locator('button[value="cancel"]').first().click();
  await page.click('[data-tool="tale"]');

  const taleDialog = page.locator('[data-tale-dialog]');
  const taleInput = taleDialog.locator('[data-tale-a]');
  await taleInput.fill('New Signing');
  await taleDialog.locator('.writer-fighter-suggestion', { hasText:'New Signing' }).click();

  const taleValues = await taleDialog.locator('[data-tale-row-list] [data-structured-a]').evaluateAll(nodes =>
    nodes.map(node => node.value.trim())
  );
  expect(taleValues).toHaveLength(11);
  expect(taleValues.every(Boolean)).toBe(true);
  expect(taleValues).toContain('N/A');

  expect(pageErrors).toEqual([]);
});
