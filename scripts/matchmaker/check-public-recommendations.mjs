import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Public-page regression coverage for title-queue and weak-alternative filtering.
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

const filtered = P.filterRecommendations(winner, [
  { fighter: champion, score: 90, confidence: 'high' },
  { fighter: peer, score: 87, confidence: 'high' },
  { fighter: fighter('weak-alt', 6, 'W'), score: 70, confidence: 'medium' }
], E, ctx);
assert.deepEqual(filtered.map(item => item.fighter.id), ['champion', 'peer'], 'Weak medium-confidence filler must still be removed after applying the title-queue filter.');

console.log('Matchmaker public recommendation filters: OK');
