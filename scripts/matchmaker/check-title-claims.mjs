import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');

const coverage = { source: 'UFCStats', verified: true, checkedAt: '2026-09-15T00:00:00Z' };
const bout = (date, result) => ({ date, result, opponentIds: [], text: '' });
const titleLoss = (date, opponentId = 'old-champion') => ({
  date,
  result: 'L',
  opponentId,
  opponentName: 'Old Champion',
  competitionClass: 'ufc',
  weightClass: 'UFC Welterweight Title Bout',
  source: 'UFCStats',
  sourceUrl: `https://ufcstats.com/fight-details/${opponentId}`
});

function fighter(id, rank, results, { titleLossDate = null } = {}) {
  const dates = ['2026-08-01', '2026-05-01', '2026-02-01', '2025-11-01', '2025-08-01'];
  return {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
    active: true,
    division: 'Welterweight',
    rank,
    rankings: [{ division: 'Welterweight', rank }],
    lastFight: dates[0],
    history: results.map((result, index) => bout(dates[index], result)),
    verifiedMeetings: titleLossDate ? [titleLoss(titleLossDate)] : [],
    meetingCoverage: coverage,
    historyModelVersion: 2
  };
}

const champion = fighter('current-champion', 0, ['W', 'W', 'W', 'W']);
const clearNo1 = fighter('clear-number-one', 1, ['W', 'W', 'W', 'L']);
const reboundNo2 = fighter('rebound-number-two', 2, ['W', 'L', 'W', 'W'], { titleLossDate: '2026-05-01' });
const cleanNo2 = fighter('clean-number-two', 2, ['W', 'L', 'W', 'W']);
const weakNo4 = fighter('weak-number-four', 4, ['W', 'L', 'L', 'W']);
const risingNo5 = fighter('rising-number-five', 5, ['W', 'W', 'L', 'W']);
const losingNo3 = fighter('losing-number-three', 3, ['L', 'W', 'W', 'W']);
const roster = [champion, clearNo1, reboundNo2, cleanNo2, weakNo4, risingNo5, losingNo3];
const ctx = {
  asOf: '2026-09-15T00:00:00Z',
  event: null,
  locks: [],
  overrides: {},
  fighterIndex: new Map(roster.map(f => [f.id, f]))
};

const clearClaim = E.titleClaim(clearNo1, ctx);
const reboundClaim = E.titleClaim(reboundNo2, ctx);
const cleanClaim = E.titleClaim(cleanNo2, ctx);
const weakClaim = E.titleClaim(weakNo4, ctx);
const risingClaim = E.titleClaim(risingNo5, ctx);
const losingClaim = E.titleClaim(losingNo3, ctx);

assert.equal(clearClaim.eligible, true, 'A winning #1 contender with sustained momentum must have a title claim.');
assert.equal(reboundClaim.eligible, true, 'A #2 contender can rebuild a title claim with a subsequent UFC win.');
assert(cleanClaim.score > reboundClaim.score, 'A recent title loss with only one rebound win must lower title priority.');
assert.equal(weakClaim.eligible, false, 'A weak single win at #4 must not automatically create a title shot.');
assert.equal(risingClaim.eligible, true, 'A #5 contender on a two-fight winning streak can earn a title claim.');
assert.equal(losingClaim.eligible, false, 'A contender coming off a loss must not receive an automatic title shot.');

const weakPair = E.evaluatePair(champion, weakNo4, ctx, false, true);
assert.equal(weakPair.eligible, false, 'Champion vs weak #4 must fail the automatic title-claim gate.');
assert.match(weakPair.reason, /No credible automatic title claim/i);
assert.equal(E.evaluatePair(champion, weakNo4, ctx, true, true).eligible, true, 'Manual matchmaking must retain the ability to force an unusual title booking.');

const clearPair = E.evaluatePair(champion, clearNo1, ctx, false, true);
assert.equal(clearPair.eligible, true, 'Champion vs clear #1 must remain eligible.');
assert.equal(clearPair.case.code, 'title-case', 'A credible champion pairing must be classified as a title case.');

const recommendations = E.recommendations(champion, roster, ctx);
assert(recommendations.length >= 2, 'Champion should have multiple credible title options in this fixture.');
assert.equal(recommendations[0].fighter.id, clearNo1.id, 'Champion recommendations must prioritize the strongest title claim, not generic pair score.');
assert(!recommendations.some(rec => rec.fighter.id === weakNo4.id), 'Weak #4 must not leak into champion recommendations.');
assert(!recommendations.some(rec => rec.fighter.id === losingNo3.id), 'Losing #3 must not leak into champion recommendations.');

console.log(`Title claims passed: #1 ${clearClaim.score}, rebound #2 ${reboundClaim.score}, clean #2 ${cleanClaim.score}; weak #4 and losing #3 rejected.`);
