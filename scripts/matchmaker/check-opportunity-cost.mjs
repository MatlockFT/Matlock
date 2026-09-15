import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');

const bout = (date, result) => ({ date, result, opponentIds: [], text: '' });
function fighter(id, rank, results = ['W', 'W', 'L']) {
  return {
    id,
    name: id.toUpperCase(),
    active: true,
    division: 'Lightweight',
    rank,
    rankings: [{ division: 'Lightweight', rank }],
    lastFight: '2026-08-01',
    history: results.map((result, index) => bout(`2026-0${8 - index}-01`, result)),
    verifiedMeetings: [],
    meetingCoverage: { source: 'UFCStats', verified: true, checkedAt: '2026-09-14T00:00:00Z' },
    historyModelVersion: 2
  };
}

const a = fighter('alpha', 3, ['W', 'W', 'L']);
const b = fighter('bravo', 7, ['L', 'W', 'W']);
const c = fighter('charlie', 8, ['L', 'L', 'W']);
const champion = fighter('champion', 0, ['W', 'W', 'W']);
const roster = [a, b, c];
const ctx = { asOf: '2026-09-14T00:00:00Z', event: null, locks: [], overrides: {}, fighterIndex: new Map(roster.map(f => [f.id, f])) };

const natural = E.evaluatePair(b, c, ctx, false, true);
assert(natural.eligible, 'Synthetic natural alternative must be hard-eligible.');

const proposedScore = Math.max(0, natural.score - 14);
const wasteful = E.opportunityCost(a, { fighter: b, score: proposedScore }, roster, ctx, true);
assert.equal(wasteful.bestAlternativeId, c.id, 'The only remaining eligible divisional alternative should be identified.');
assert(wasteful.gap >= 14, 'The synthetic alternative must be materially stronger than the proposed pairing.');
assert(wasteful.penalty > 0, 'A materially stronger natural alternative must create opportunity-cost penalty.');
assert(wasteful.rankingScore < proposedScore, 'Opportunity cost must lower only the recommendation-order score.');

const close = E.opportunityCost(a, { fighter: b, score: natural.score - 3 }, roster, ctx, true);
assert.equal(close.penalty, 0, 'Near-equivalent alternatives must not be penalized.');
assert.equal(close.rankingScore, natural.score - 3, 'Near-equivalent alternatives must preserve recommendation-order score.');

const titleCtx = { ...ctx, fighterIndex: new Map([champion, b, c].map(f => [f.id, f])) };
const titleExempt = E.opportunityCost(champion, { fighter: b, score: 20 }, [champion, b, c], titleCtx, true);
assert.equal(titleExempt.penalty, 0, 'Champion matchmaking must stay under the dedicated title-claim ordering model.');

const ranked = E.candidates(a, roster, ctx);
assert(ranked.every(item => typeof item.rankingScore === 'number' && item.opportunityCost), 'Non-title candidate output must expose board-aware ranking diagnostics.');

console.log(`Opportunity-cost checks passed: natural ${natural.score}, penalty ${wasteful.penalty}, reciprocal rank ${wasteful.reciprocalRank}.`);
