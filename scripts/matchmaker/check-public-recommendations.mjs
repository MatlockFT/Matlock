import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Public-page regression coverage for title-queue, weak-alternative and mutual-fit filtering.
const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');
const P = require('../../assets/matchmaker-public.js');

const bout = (date, result) => ({ date, result, opponentIds: [], text: '' });
const fighter = (id, rank, result) => ({
  id,
  name: id,
  active: true,
  division: 'Flyweight',
  rank,
  lastFight: '2026-09-01',
  history: [bout('2026-09-01', result), bout('2026-06-01', 'W'), bout('2026-03-01', 'W')]
});

const champion = fighter('champion', 0, 'W');
const winner = fighter('winner', 2, 'W');
const loser = fighter('loser', 3, 'L');
const peer = fighter('peer', 4, 'W');
const ctx = {
  asOf: '2026-09-14',
  event: { date: '2026-09-01', bouts: [{ fighters: [{ id: 'winner', result: 'W' }, { id: 'loser', result: 'L' }] }] },
  locks: [],
  overrides: {}
};

assert(P.titleQueueEligible(winner, { fighter: champion }, E, ctx), 'A ranked fighter coming off a win can remain in the automatic title queue.');
assert(!P.titleQueueEligible(loser, { fighter: champion }, E, ctx), 'A ranked fighter coming off a loss must not be automatically recommended for a title fight.');
assert(!P.titleQueueEligible(champion, { fighter: loser }, E, ctx), 'The champion view must also suppress a challenger coming off a loss.');
assert(P.titleQueueEligible(champion, { fighter: winner }, E, ctx), 'The champion view can recommend a challenger coming off a win.');
assert(P.titleQueueEligible(winner, { fighter: peer }, E, ctx), 'Non-title matchmaking must not be affected by the title-queue rule.');

const supportedTitleRematch = {
  fighter: loser,
  score: 82,
  confidence: 'high',
  rematch: {
    allowed: true,
    profile: { titleBout: true, closeDecision: true, balancedSeries: false }
  }
};
assert(P.contextualTitleRematch(supportedTitleRematch), 'Supported close title rematch fixture must be recognized by the public filter.');
assert(P.titleQueueEligible(champion, supportedTitleRematch, E, ctx), 'A verified contextual title rematch must survive the public title queue even though the challenger is coming off the title loss.');
assert(!P.titleQueueEligible(champion, { ...supportedTitleRematch, rematch: { allowed: true, profile: { titleBout: true, closeDecision: false, balancedSeries: false } } }, E, ctx), 'An ordinary prior title fight must not bypass the title-claim rule.');

const filtered = P.filterRecommendations(winner, [
  { fighter: champion, score: 90, confidence: 'high' },
  { fighter: peer, score: 87, confidence: 'high' },
  { fighter: fighter('weak-alt', 6, 'W'), score: 70, confidence: 'medium' }
], E, ctx);
assert.deepEqual(filtered.map(item => item.fighter.id), ['champion', 'peer'], 'Weak medium-confidence filler must still be removed after applying the title-queue filter.');

const oneSidedNearTie = {
  fighter: fighter('one-sided-near-tie', 5, 'W'),
  score: 88,
  rankingScore: 88,
  confidence: 'high',
  opportunityCost: { reciprocalRank: 7 }
};
const mutualNearTie = {
  fighter: fighter('mutual-near-tie', 6, 'W'),
  score: 86,
  rankingScore: 86,
  confidence: 'high',
  opportunityCost: { reciprocalRank: 2 }
};
const mutualOrder = P.orderForPublic([oneSidedNearTie, mutualNearTie]);
assert.equal(mutualOrder[0].fighter.id, mutualNearTie.fighter.id, 'A close alternative that is also high in the opponent queue should beat a slightly stronger one-sided pairing.');

const clearlyStrongerOneSided = {
  ...oneSidedNearTie,
  fighter: fighter('clearly-stronger', 5, 'W'),
  score: 92,
  rankingScore: 92
};
const strongOrder = P.orderForPublic([clearlyStrongerOneSided, mutualNearTie]);
assert.equal(strongOrder[0].fighter.id, clearlyStrongerOneSided.fighter.id, 'Reciprocal fit must remain a modest ordering nudge and must not erase a clearly stronger matchup.');
assert.equal(P.PUBLIC_CANDIDATE_POOL, 8, 'The public page should compare a small broader pool before choosing its final three.');

const fakeEngine = {
  candidates: () => [
    oneSidedNearTie,
    { ...mutualNearTie, fighter: peer },
    { fighter: fighter('third', 7, 'W'), score: 84, rankingScore: 84, confidence: 'high', opportunityCost: { reciprocalRank: 1 } },
    { fighter: fighter('fourth', 8, 'W'), score: 83, rankingScore: 83, confidence: 'high', opportunityCost: { reciprocalRank: 1 } }
  ],
  rank: E.rank,
  titleClaim: E.titleClaim,
  eventResult: E.eventResult
};
const selected = P.selectRecommendations(winner, [], fakeEngine, ctx);
assert.equal(selected.length, 3, 'Public selection must still cap the page at three recommendations.');
assert(selected.some(item => item.fighter.id === 'fourth'), 'The public selector should be able to promote a mutually stronger fourth engine candidate into the final three.');

console.log('Matchmaker public recommendation filters: OK');
