import test from 'node:test';
import assert from 'node:assert/strict';

import { allowedPath, validateWriteBody } from '../netlify/functions/writer-github.mjs';
import { parseUfcProfileSummary, parseUfcStatsProfile } from '../netlify/functions/writer-fighter.mjs';
import {
  ACTIVE_UPLOAD_TTL_MS,
  COMPLETE_STATUS_TTL_MS,
  isStaleStatus,
  parseStatusKey,
  sanitizeAssetName,
  validateVideoMetadata
} from '../netlify/functions/_writer-media.mjs';

test('Writer GitHub proxy only allows scoped article and upload paths', () => {
  assert.equal(allowedPath('/contents/_posts?ref=main', 'GET'), true);
  assert.equal(allowedPath('/contents/_posts/2026-09-24-test.md?ref=main', 'GET'), true);
  assert.equal(allowedPath('/contents/_posts/2026-09-24-test.md', 'PUT'), true);
  assert.equal(allowedPath('/contents/assets/uploads/example.webp', 'PUT'), true);
  assert.equal(allowedPath('/contents/assets/uploads/articles/2026/09/article-slug/cover.webp', 'PUT'), true);
  assert.equal(allowedPath('/repos/MatlockFT/Matlock/actions', 'GET'), false);
  assert.equal(allowedPath('/contents/_config.yml', 'PUT'), false);
  assert.equal(allowedPath('/contents/_posts/../../_config.yml', 'PUT'), false);
});

test('Writer write validation rejects branch escapes and oversized articles', () => {
  assert.doesNotThrow(() => validateWriteBody('/contents/_posts/2026-09-24-test.md', {
    branch: 'main',
    message: 'Update test',
    content: 'SGVsbG8='
  }));

  assert.throws(() => validateWriteBody('/contents/_posts/2026-09-24-test.md', {
    branch: 'other',
    message: 'Update test',
    content: 'SGVsbG8='
  }), /main branch/);

  assert.throws(() => validateWriteBody('/contents/_posts/2026-09-24-test.md', {
    branch: 'main',
    message: 'Update test',
    content: 'A'.repeat(3 * 1024 * 1024)
  }), /Article file is too large/);
});

test('Video metadata validation enforces extension, MIME, size and chunk count', () => {
  const valid = validateVideoMetadata({
    assetName: 'Fight Clip.mp4',
    fileSize: 30 * 1024 * 1024,
    fileType: 'video/mp4',
    chunkCount: 9
  });
  assert.equal(valid.assetName, 'Fight-Clip.mp4');
  assert.equal(valid.ext, 'mp4');
  assert.equal(valid.chunkCount, 9);

  assert.throws(() => validateVideoMetadata({
    assetName: 'clip.exe',
    fileSize: 1024,
    fileType: 'video/mp4',
    chunkCount: 1
  }), /MP4, WebM or M4V/);

  assert.throws(() => validateVideoMetadata({
    assetName: 'clip.webm',
    fileSize: 1024,
    fileType: 'video/mp4',
    chunkCount: 1
  }), /MIME type/);

  assert.throws(() => validateVideoMetadata({
    assetName: 'clip.mp4',
    fileSize: 20 * 1024 * 1024,
    fileType: 'video/mp4',
    chunkCount: 1
  }), /chunk count is too small/);
});

test('Media status cleanup parsing and TTLs are deterministic', () => {
  assert.deepEqual(
    parseStatusKey('status/0123456789abcdef01234567/upload_1234567890'),
    { scope: '0123456789abcdef01234567', uploadId: 'upload_1234567890' }
  );
  assert.equal(parseStatusKey('status/not-valid'), null);

  const now = Date.now();
  assert.equal(isStaleStatus({
    state: 'uploading',
    updatedAt: new Date(now - ACTIVE_UPLOAD_TTL_MS - 1).toISOString()
  }, now), true);
  assert.equal(isStaleStatus({
    state: 'complete',
    updatedAt: new Date(now - COMPLETE_STATUS_TTL_MS + 1000).toISOString()
  }, now), false);
});

test('Asset names are reduced to release-safe characters', () => {
  assert.equal(sanitizeAssetName('  weird / fight clip (1).mp4  '), 'weird-fight-clip-1-.mp4');
});


test('UFCStats fighter parser extracts live career metrics and recent form', () => {
  const id = 'fe2babf95de24fb1';
  const html = `
    <span class="b-content__title-highlight">Raul Rosas Jr.</span>
    <span class="b-content__title-record">Record: 13-1-0</span>
    <li><i class="b-list__box-item-title">Height:</i> 5' 9"</li>
    <li><i class="b-list__box-item-title">Reach:</i> 67"</li>
    <li><i class="b-list__box-item-title">STANCE:</i> Southpaw</li>
    <li><i class="b-list__box-item-title">DOB:</i> Oct 08, 2004</li>
    <li><i class="b-list__box-item-title">SLpM:</i> 1.34</li>
    <li><i class="b-list__box-item-title">Str. Acc.:</i> 42%</li>
    <li><i class="b-list__box-item-title">SApM:</i> 1.24</li>
    <li><i class="b-list__box-item-title">Str. Def.:</i> 52%</li>
    <li><i class="b-list__box-item-title">TD Avg.:</i> 6.10</li>
    <li><i class="b-list__box-item-title">TD Acc.:</i> 54%</li>
    <li><i class="b-list__box-item-title">TD Def.:</i> 25%</li>
    <li><i class="b-list__box-item-title">Sub. Avg.:</i> 0.9</li>
    <table>
      <tr class="b-fight-details__table-row" data-link="http://ufcstats.com/fight-details/aaaaaaaaaaaaaaaa">
        <td><i class="b-flag__text">W</i></td>
        <td>
          <a href="http://ufcstats.com/fighter-details/${id}">Raul Rosas Jr.</a>
          <a href="http://ufcstats.com/fighter-details/05339613bf8e9808">Rob Font</a>
        </td>
        <td><a href="http://ufcstats.com/event-details/bbbbbbbbbbbbbbbb">UFC 326: Test</a><p>Mar. 07, 2026</p></td>
        <td>Decision - Unanimous</td>
      </tr>
    </table>
  `;
  const profile = parseUfcStatsProfile(html, id);
  assert.equal(profile.name, 'Raul Rosas Jr.');
  assert.equal(profile.record, '13-1-0');
  assert.equal(profile.height, `5' 9"`);
  assert.equal(profile.reach, '67"');
  assert.equal(profile.stats.slpm, '1.34');
  assert.equal(profile.stats.tdAccuracy, '54%');
  assert.equal(profile.latestBoutDate, '2026-03-07');
  assert.equal(profile.ufcRecord, '1-0-0');
  assert.equal(profile.recent[0].opponent, 'Rob Font');
  assert.equal(profile.recent[0].method, 'Decision - Unanimous');
});


test('UFC official profile parser extracts career win-method totals', () => {
  const html = `
    <main>
      <h1>Brad Tavares</h1>
      <div>21-13-0 (W-L-D)</div>
      <div><strong>5</strong> Wins by Knockout</div>
      <div><strong>2</strong> Wins by Submission</div>
      <div><strong>5</strong> First Round Finishes</div>
    </main>
  `;
  const profile = parseUfcProfileSummary(html);
  assert.equal(profile.record, '21-13-0');
  assert.equal(profile.career.winsByKnockout, 5);
  assert.equal(profile.career.winsBySubmission, 2);
  assert.equal(profile.career.totalFinishes, 7);
  assert.equal(profile.career.decisionWins, 14);
  assert.equal(profile.career.firstRoundFinishes, 5);
});
