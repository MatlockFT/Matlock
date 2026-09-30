import test from 'node:test';
import assert from 'node:assert/strict';

import { allowedPath, validateDeleteBody, validateWriteBody } from '../netlify/functions/writer-github.mjs';
import { mergeRecentHistory, parseUfcProfileSummary, parseUfcStatsProfile } from '../netlify/functions/writer-fighter.mjs';
import { extractBestFightOddsCardOdds, extractBestFightOddsMoneylines, extractFittCardOdds, extractFittMoneylines, extractMoneylines, formatAmericanOdds, normalizeFighterName, parseBestFightOddsHtml, parseEspnFittHtml, scoreboardDateQueries } from '../netlify/functions/fight-odds.mjs';
import { hasCompleteDisplayedCareer, namesLikelySame, parseSherdogCareerProfile, parseUfcFightCareerProfile } from '../netlify/functions/_writer-career-fallback.mjs';
import { parseUfcFightProfile } from '../../scripts/matchmaker/sources/sherdog.mjs';
import {
  ACTIVE_UPLOAD_TTL_MS,
  COMPLETE_STATUS_TTL_MS,
  isStaleStatus,
  parseStatusKey,
  sanitizeAssetName,
  validateMediaMetadata,
  validateVideoMetadata
} from '../netlify/functions/_writer-media.mjs';
import { broadcastVideoUsage, isBroadcastVideoAsset, isManagedMediaRelease } from '../netlify/functions/writer-media-library.mjs';

test('Writer GitHub proxy only allows scoped article and upload paths', () => {
  assert.equal(allowedPath('/contents/_posts?ref=main', 'GET'), true);
  assert.equal(allowedPath('/contents/_posts/2026-09-24-test.md?ref=main', 'GET'), true);
  assert.equal(allowedPath('/contents/_posts/2026-09-24-test.md', 'PUT'), true);
  assert.equal(allowedPath('/contents/_posts/2026-09-24-test.md', 'DELETE'), true);
  assert.equal(allowedPath('/contents/assets/uploads/example.webp', 'PUT'), true);
  assert.equal(allowedPath('/contents/assets/uploads/example.webp', 'DELETE'), false);
  assert.equal(allowedPath('/contents/assets/uploads/articles/2026/09/article-slug/cover.webp', 'PUT'), true);
  assert.equal(allowedPath('/contents/assets/data/broadcast.json?ref=main', 'GET'), true);
  assert.equal(allowedPath('/contents/assets/data/broadcast.json', 'PUT'), true);
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

test('Writer delete validation requires main branch and a GitHub blob SHA', () => {
  assert.doesNotThrow(() => validateDeleteBody('/contents/_posts/2026-09-24-test.md', {
    branch: 'main',
    message: 'Delete test',
    sha: '0123456789abcdef0123456789abcdef01234567'
  }));

  assert.throws(() => validateDeleteBody('/contents/_posts/2026-09-24-test.md', {
    branch: 'other',
    message: 'Delete test',
    sha: '0123456789abcdef0123456789abcdef01234567'
  }), /main branch/);

  assert.throws(() => validateDeleteBody('/contents/_posts/2026-09-24-test.md', {
    branch: 'main',
    message: 'Delete test',
    sha: 'not-a-sha'
  }), /file SHA/);
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

test('Broadcast media metadata accepts common audio formats', () => {
  const valid = validateMediaMetadata({
    assetName: 'Weather Groove.mp3',
    fileSize: 8 * 1024 * 1024,
    fileType: 'audio/mpeg',
    chunkCount: 3
  });
  assert.equal(valid.assetName, 'Weather-Groove.mp3');
  assert.equal(valid.ext, 'mp3');

  assert.throws(() => validateVideoMetadata({
    assetName: 'Weather Groove.mp3',
    fileSize: 8 * 1024 * 1024,
    fileType: 'audio/mpeg',
    chunkCount: 3
  }), /MP4, WebM or M4V/);
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


test('Broadcast video library only exposes managed broadcast video release assets', () => {
  assert.equal(isManagedMediaRelease({ tag_name: 'writer-media-2026-09' }), true);
  assert.equal(isManagedMediaRelease({ tag_name: 'v1.0.0' }), false);

  assert.equal(isBroadcastVideoAsset({
    name: 'broadcast-video-main-event-20260930050000000.mp4',
    content_type: 'video/mp4'
  }), true);
  assert.equal(isBroadcastVideoAsset({
    name: 'broadcast-audio-theme-20260930050000000.mp3',
    content_type: 'audio/mpeg'
  }), false);
  assert.equal(isBroadcastVideoAsset({
    name: 'writer-video-article-clip.mp4',
    content_type: 'video/mp4'
  }), false);
});

test('Broadcast video usage guard finds saved draft and live references', () => {
  const url = 'https://github.com/example/video.mp4';
  const state = {
    draft: {
      program: [
        { type: 'headline', title: 'A' },
        { type: 'video', mediaUrl: url }
      ]
    },
    live: {
      program: [
        { type: 'video', mediaUrl: 'https://github.com/example/other.mp4' }
      ]
    }
  };
  assert.deepEqual(broadcastVideoUsage(state, url), { draft: true, live: false });
  state.live.program.push({ type: 'video', mediaUrl: url });
  assert.deepEqual(broadcastVideoUsage(state, url), { draft: true, live: true });
  assert.deepEqual(broadcastVideoUsage(state, ''), { draft: false, live: false });
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

test('UFC official profile parser treats omitted zero-value career cards as zero', () => {
  const knockoutOnly = parseUfcProfileSummary(`
    <main>
      <h1>Alex Pereira</h1>
      <div>13-4-0 (W-L-D)</div>
      <div><strong>11</strong> Wins by Knockout</div>
      <div><strong>5</strong> First Round Finishes</div>
    </main>
  `);
  assert.equal(knockoutOnly.career.winsByKnockout, 11);
  assert.equal(knockoutOnly.career.winsBySubmission, 0);
  assert.equal(knockoutOnly.career.totalFinishes, 11);
  assert.equal(knockoutOnly.career.decisionWins, 2);

  const submissionOnly = parseUfcProfileSummary(`
    <main>
      <h1>Example Grappler</h1>
      <div>15-1-0 (W-L-D)</div>
      <div><strong>8</strong> Wins by Submission</div>
      <div><strong>4</strong> First Round Finishes</div>
    </main>
  `);
  assert.equal(submissionOnly.career.winsByKnockout, 0);
  assert.equal(submissionOnly.career.winsBySubmission, 8);
  assert.equal(submissionOnly.career.totalFinishes, 8);
  assert.equal(submissionOnly.career.decisionWins, 7);
});


test('direct career fallback parser extracts record, finish methods, bio and decision subtypes', () => {
  const html = `
    <article>
      <h1>Adam Livingston MMA Profile Record and Fight History</h1>
      <h2>ADAM LIVINGSTON</h2>
      <div>W-L-D 8-1-0</div>
      <div>BIRTHDATE 8/15/2001 (25)</div>
      <div>HT / WT 6′ 1″, 155 lbs</div>
      <section>WINS 8 KO/TKO 5 SUB 1 DECISION 2 LOSSES 1 KO/TKO 0 SUB 1 DECISION 0</section>
      <h2>Adam Livingston Fight History</h2>
      <table>
        <tr><td>Sep 1, 2026</td><td>Hunter Smith</td><td>W (Decision – Split)</td></tr>
        <tr><td>Jun 16, 2023</td><td>Daniel Mahoney</td><td>W (Decision – Unanimous)</td></tr>
      </table>
    </article>
  `;
  const profile = parseUfcFightProfile(html, 'https://ufcfight.net/adam-livingston/');
  assert.equal(profile.name, 'ADAM LIVINGSTON');
  assert.equal(profile.record, '8-1-0');
  assert.equal(profile.career.winsByKnockout, 5);
  assert.equal(profile.career.winsBySubmission, 1);
  assert.equal(profile.career.totalFinishes, 6);
  assert.equal(profile.career.decisionWins, 2);
  assert.equal(profile.career.unanimousDecisionWins, 1);
  assert.equal(profile.career.splitDecisionWins, 1);
  assert.equal(profile.career.decisionBreakdownComplete, true);
  assert.equal(profile.bio.dob, '8/15/2001');
  assert.equal(profile.bio.weight, '155 lbs');
});


test('on-demand career fallback parser fills all displayed Tale career fields', () => {
  const html = `
    <article>
      <h2>AKBAR ABDULLAEV</h2>
      <div>W-L-D 14-0-0</div>
      <div>HT / WT 5′ 9″, 155 lbs</div>
      <div>BIRTHDATE 9/21/1997 (28)</div>
      <section>WINS 14 KO/TKO 13 SUB 1 DECISION 0 LOSSES 0 KO/TKO 0 SUB 0 DECISION 0</section>
      <h2>Akbar Abdullaev Fight History</h2>
      <table>
        <tr><td>Sep 15, 2026</td><td>Ednilson Santos</td><td>W (KO/TKO)</td></tr>
      </table>
    </article>
  `;
  const profile = parseUfcFightCareerProfile(html, 'https://ufcfight.net/akbar-abdullaev/');
  assert.equal(profile.name, 'AKBAR ABDULLAEV');
  assert.equal(profile.record, '14-0-0');
  assert.equal(profile.career.totalFinishes, 14);
  assert.equal(profile.career.winsByKnockout, 13);
  assert.equal(profile.career.winsBySubmission, 1);
  assert.equal(profile.career.unanimousDecisionWins, 0);
  assert.equal(profile.career.splitDecisionWins, 0);
  assert.equal(hasCompleteDisplayedCareer(profile.career), true);
});

test('Sherdog fallback exposes complete professional history for pre-UFC fighters', () => {
  const html = `
    <main>
      <h1>Lucas Armand</h1>
      <div>AGE 30 / Oct 26, 1995</div>
      <div>WEIGHT 265 lbs</div>
      <section>
        <div>Wins 6</div>
        <div>KO / TKO 5</div>
        <div>SUBMISSIONS 0</div>
        <div>DECISIONS 1</div>
        <div>Losses 0</div>
        <div>Draws 0</div>
      </section>
      <h2>FIGHT HISTORY - PRO</h2>
      <table>
        <tr>
          <td>win</td>
          <td><a href="/fighter/Cameron-Graham-296215">Cameron Graham</a></td>
          <td><a href="/events/2PP-War-at-the-Wex-8-111552">War at the Wex 8</a> Mar / 07 / 2026</td>
          <td>TKO (Strikes)<br>Vance Swerdan</td><td>4</td><td>0:16</td>
        </tr>
        <tr>
          <td>win</td>
          <td><a href="/fighter/Braxton-Smith-159321">Braxton Smith</a></td>
          <td><a href="/events/2PP-War-at-the-Wex-7-110361">War at the Wex 7</a> Nov / 22 / 2025</td>
          <td>TKO (Strikes)<br>Vance Swerdan</td><td>1</td><td>1:54</td>
        </tr>
        <tr><td>win</td><td><a href="/fighter/Lawrence-Phillips-336823">Lawrence Phillips</a></td><td>Jun / 28 / 2025</td><td>TKO</td><td>2</td><td>3:59</td></tr>
        <tr><td>win</td><td><a href="/fighter/Marcus-Maulding-241031">Marcus Maulding</a></td><td>May / 17 / 2025</td><td>TKO (Strikes)</td><td>1</td><td>1:38</td></tr>
        <tr><td>win</td><td><a href="/fighter/Chris-Cameron-243999">Chris Cameron</a></td><td>Feb / 08 / 2025</td><td>TKO (Retirement)</td><td>2</td><td>5:00</td></tr>
        <tr><td>win</td><td><a href="/fighter/Jonathan-Martin-299429">Jonathan Martin</a></td><td>Nov / 16 / 2024</td><td>Decision (Unanimous)</td><td>3</td><td>5:00</td></tr>
      </table>
      <h2>FIGHT HISTORY - AMATEUR</h2>
      <table><tr><td>loss</td><td>Amateur Opponent</td><td>Dec / 02 / 2023</td></tr></table>
    </main>
  `;
  const profile = parseSherdogCareerProfile(html,'https://www.sherdog.com/fighter/Lucas-Armand-420549');
  assert.equal(profile.record,'6-0-0');
  assert.equal(profile.historyComplete,true);
  assert.equal(profile.history.length,6);
  assert.equal(profile.recent.length,5);
  assert.equal(profile.history[0].opponent,'Cameron Graham');
  assert.equal(profile.history[0].date,'2026-03-07');
  assert.equal(profile.history[5].opponent,'Jonathan Martin');
  assert.equal(profile.latestBoutDate,'2026-03-07');
});

test('regional recent form survives even when full career completeness is unavailable', () => {
  const merged = mergeRecentHistory(
    [
      {result:'W',opponent:'Regional Five',date:'2026-02-01',method:'TKO'},
      {result:'W',opponent:'Regional Four',date:'2025-12-01',method:'Decision'},
      {result:'W',opponent:'Regional Three',date:'2025-10-01',method:'Submission'},
      {result:'L',opponent:'Regional Two',date:'2025-08-01',method:'Decision'}
    ],
    [
      {result:'W',opponent:'UFC Opponent',date:'2026-03-01',method:'Decision'},
      {result:'W',opponent:'Regional Five',date:'2026-02-01',method:'TKO'}
    ]
  );
  assert.deepEqual(merged.map(row => row.opponent),[
    'UFC Opponent','Regional Five','Regional Four','Regional Three','Regional Two'
  ]);
});

test('Sherdog fallback accepts minor spelling variants only as likely name matches', () => {
  assert.equal(namesLikelySame('Benardo Sopaj','Bernardo Sopai'),true);
  assert.equal(namesLikelySame('Eric Nolan','Eric Nolan'),true);
  assert.equal(namesLikelySame('Eric Nolan','Eric Nelson'),false);
});

test('Sherdog parser still exposes recent pro fights when full-history completeness is false', () => {
  const html = `
    <main>
      <h1>Example Regional</h1>
      <div>Wins 8</div><div>KO / TKO 4</div><div>SUBMISSIONS 2</div><div>DECISIONS 2</div>
      <div>Losses 1</div><div>Draws 0</div>
      <h2>FIGHT HISTORY - PRO</h2>
      <table>
        <tr><td>win</td><td><a href="/fighter/A-1">Opponent A</a></td><td>Sep / 01 / 2026</td><td>TKO</td><td>1</td><td>1:00</td></tr>
        <tr><td>win</td><td><a href="/fighter/B-2">Opponent B</a></td><td>Jun / 01 / 2026</td><td>Decision (Unanimous)</td><td>3</td><td>5:00</td></tr>
        <tr><td>win</td><td><a href="/fighter/C-3">Opponent C</a></td><td>Mar / 01 / 2026</td><td>Submission</td><td>2</td><td>2:00</td></tr>
        <tr><td>win</td><td><a href="/fighter/D-4">Opponent D</a></td><td>Jan / 01 / 2026</td><td>TKO</td><td>1</td><td>3:00</td></tr>
        <tr><td>win</td><td><a href="/fighter/E-5">Opponent E</a></td><td>Oct / 01 / 2025</td><td>Decision (Split)</td><td>3</td><td>5:00</td></tr>
      </table>
    </main>
  `;
  const profile=parseSherdogCareerProfile(html,'https://www.sherdog.com/fighter/Example-Regional-1');
  assert.equal(profile.historyComplete,false);
  assert.equal(profile.recent.length,5);
  assert.deepEqual(profile.recent.map(row=>row.opponent),['Opponent A','Opponent B','Opponent C','Opponent D','Opponent E']);
});

test('BestFightOdds parser prefers sportsbook prices and resolves full-card fallbacks', () => {
  const html = `
    <table class="odds-table"><tbody>
      <tr><th><a href="/fighters/anthony-wint-16320"><span class="t-b-fcc">Anthony Wint</span></a></th>
        <td class="but-sg" data-li="[29,1,45074]"><span>-382</span></td>
        <td class="but-sg" data-li="[21,1,45074]"><span>-390</span></td>
        <td class="but-sg" data-li="[20,1,45074]"><span class="bestbet">-350</span></td>
      </tr>
      <tr><th><a href="/fighters/lucas-armand-22904"><span class="t-b-fcc">Lucas Armand</span></a></th>
        <td class="but-sg" data-li="[29,2,45074]"><span>+279</span></td>
        <td class="but-sg" data-li="[21,2,45074]"><span class="bestbet">+280</span></td>
        <td class="but-sg" data-li="[20,2,45074]"><span>+260</span></td>
      </tr>
      <tr><th><a href="/fighters/king-green-19196"><span class="t-b-fcc">King Green</span></a></th>
        <td class="but-sg" data-li="[21,1,45051]"><span>+200</span></td>
      </tr>
      <tr><th><a href="/fighters/esteban-ribovics-14245"><span class="t-b-fcc">Esteban Ribovics</span></a></th>
        <td class="but-sg" data-li="[21,2,45051]"><span>-240</span></td>
      </tr>
    </tbody></table>
  `;
  const markets = parseBestFightOddsHtml(html);
  assert.equal(markets.length,2);
  assert.deepEqual(
    extractBestFightOddsMoneylines(html,'Anthony Wint','Lucas Armand'),
    {fighterA:'-390',fighterB:'+280',provider:'FanDuel'}
  );
  assert.deepEqual(
    extractBestFightOddsMoneylines(html,'Bobby Green','Esteban Ribovics'),
    {fighterA:'+200',fighterB:'-240',provider:'FanDuel'}
  );
  const card = extractBestFightOddsCardOdds(html);
  assert.equal(card.length,2);
  assert.equal(card[0].source,'BestFightOdds');
  assert.equal(normalizeFighterName('King Green'),normalizeFighterName('Bobby Green'));
});

test('fight odds lookup searches the upcoming UFC window when no date is stored', () => {
  const queries = scoreboardDateQueries('', new Date('2026-09-27T12:00:00Z'));
  assert.deepEqual(queries, ['20260927-20261226']);
});

test('fight odds lookup keeps exact fight-date checks but falls back to the upcoming window', () => {
  const queries = scoreboardDateQueries('2026-10-03', new Date('2026-09-27T12:00:00Z'));
  assert.deepEqual(queries, ['20261002','20261003','20261004','20260927-20261226']);
});

test('fight odds formatter keeps American moneylines compact', () => {
  assert.equal(formatAmericanOdds(-1050), '-1050');
  assert.equal(formatAmericanOdds(675), '+675');
  assert.equal(formatAmericanOdds('+120'), '+120');
  assert.equal(formatAmericanOdds('EVEN'), 'EVEN');
  assert.equal(formatAmericanOdds(null), null);
});

test('fight odds parser maps ESPN home and away moneylines to named fighters', () => {
  const competition = {
    competitors: [
      { id:'a1', homeAway:'home', athlete:{displayName:'Natalia Silva'} },
      { id:'b1', homeAway:'away', athlete:{displayName:'Wang Cong'} }
    ]
  };
  const payload = {
    items: [{
      provider:{name:'ESPN BET',priority:1},
      homeTeamOdds:{favorite:true,moneyLine:-180},
      awayTeamOdds:{favorite:false,moneyLine:150}
    }]
  };
  assert.deepEqual(
    extractMoneylines(competition,payload,'Natalia Silva','Wang Cong'),
    {fighterA:'-180',fighterB:'+150',provider:'ESPN BET'}
  );
});

test('fight odds parser supports named MMA outcomes without home-away semantics', () => {
  const competition = {
    competitors: [
      { id:'a1', order:1, athlete:{displayName:'Natalia Silva'} },
      { id:'b1', order:2, athlete:{displayName:'Wang Cong'} }
    ]
  };
  const payload = {
    items: [{
      provider:{name:'DraftKings',priority:1},
      outcomes:[
        {name:'Wang Cong',moneyLine:145},
        {name:'Natalia Silva',moneyLine:-170}
      ]
    }]
  };
  assert.deepEqual(
    extractMoneylines(competition,payload,'Natalia Silva','Wang Cong'),
    {fighterA:'-170',fighterB:'+145',provider:'DraftKings'}
  );
});


test('ESPN FightCenter embedded odds map directly to MMA fighter names', () => {
  const fitt = {
    page:{content:{gamepackage:{cardSegs:[{mtchs:[{
      id:'fight-1',
      awy:{
        dspNm:'Wang Cong',
        bets:{provider:{name:'BetMGM'},odds:[{abbreviation:'ML',values:[{odds:'+145'}]}]}
      },
      hme:{
        dspNm:'Natalia Silva',
        bets:{provider:{name:'BetMGM'},odds:[{abbreviation:'ML',values:[{odds:'-170'}]}]}
      }
    }]}]}}}
  };
  assert.deepEqual(
    extractFittMoneylines(fitt,'Natalia Silva','Wang Cong'),
    {fighterA:'-170',fighterB:'+145',provider:'BetMGM'}
  );
});

test('ESPN FightCenter HTML parser extracts the embedded JSON payload', () => {
  const html = '<html><script>window[\'__espnfitt__\']={"page":{"content":{}}};</script></html>';
  assert.deepEqual(parseEspnFittHtml(html),{page:{content:{}}});
});


test('ESPN FightCenter parser can return all posted moneylines on a card', () => {
  const fitt = {
    page:{content:{gamepackage:{cardSegs:[{mtchs:[
      {
        id:'fight-1',
        awy:{dspNm:'Wang Cong',bets:{provider:{name:'BetMGM'},odds:[{abbreviation:'ML',values:[{odds:'+145'}]}]}},
        hme:{dspNm:'Natalia Silva',bets:{provider:{name:'BetMGM'},odds:[{abbreviation:'ML',values:[{odds:'-170'}]}]}}
      },
      {
        id:'fight-2',
        awy:{dspNm:'Fighter Blue',bets:{provider:{name:'BetMGM'},odds:[{abbreviation:'ML',values:[{odds:'+110'}]}]}},
        hme:{dspNm:'Fighter Red',bets:{provider:{name:'BetMGM'},odds:[{abbreviation:'ML',values:[{odds:'-130'}]}]}}
      }
    ]}]}}}
  };
  const rows = extractFittCardOdds(fitt);
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0].fighters,[
    {name:'Wang Cong',moneyline:'+145'},
    {name:'Natalia Silva',moneyline:'-170'}
  ]);
});
