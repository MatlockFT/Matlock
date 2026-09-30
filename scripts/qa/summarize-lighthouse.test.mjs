import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function summarize(samples) {
  const dir = mkdtempSync(join(tmpdir(), 'matlock-lighthouse-'));
  try {
    samples.forEach((sample, i) => writeFileSync(join(dir, `home-${i + 1}.json`), JSON.stringify({
      categories: { performance: { score: sample.score } },
      audits: Object.fromEntries(Object.entries({ 'largest-contentful-paint': sample.lcp, 'total-blocking-time': sample.tbt, 'cumulative-layout-shift': sample.cls }).map(([key, numericValue]) => [key, { numericValue }]))
    })));
    return spawnSync(process.execPath, ['scripts/qa/summarize-lighthouse.mjs', dir], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '' } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const good = { score: 0.85, lcp: 3000, tbt: 120, cls: 0.02 };
test('three samples form one page and one slow outlier does not defeat the median', () => {
  const result = summarize([good, { score: 0.4, lcp: 9000, tbt: 1900, cls: 0.7 }, good]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\| home \| 3 \| 85 /);
  assert.doesNotMatch(result.stdout, /home-1/);
});
test('consistently poor measurements still fail the unchanged gate', () => {
  const result = summarize([good, { ...good, lcp: 6500 }, { ...good, lcp: 7000 }]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /LCP 6.50 s > 4.00 s/);
});
test('missing measurements fail instead of silently passing the gate', () => {
  const result = summarize([{}, {}, {}]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Missing lcp metric/);
});
