import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');

const bout = (date, result) => ({ date, result, opponentIds: [], text: '' });
const fighter = (id, rank, result) => ({
  id,
  name: id.replaceAll('-', ' ').replace(/\b\w/g, letter => letter.toUpperCase()),
  active: true,
  division: "Women's Flyweight",
  rank,
  lastFight: '2026-09-12',
  history: [bout('2026-09-12', result), bout('2026-05-01', result), bout('2026-01-15', result)]
});

const winner3 = fighter('rank-three-winner', 3, 'W');
const loser5 = fighter('rank-five-loser', 5, 'L');
const loser9 = fighter('rank-nine-loser', 9, 'L');
const winner8 = fighter('rank-eight-winner', 8, 'W');

const event = {
  date: '2026-09-12',
  bouts: [{ fighters: [
    { id: winner3.id, result: 'W' },
    { id: loser5.id, result: 'L' },
    { id: loser9.id, result: 'L' },
    { id: winner8.id, result: 'W' }
  ] }]
};
const ctx = { asOf: '2026-09-15', event, locks: [], overrides: {} };

// The old engine used a two-point internal-level threshold here. Rankings #3 and #5
// are more than five internal level points apart, but are plainly adjacent contender tiers.
const state3 = E.competitiveState(winner3, ctx);
const state5 = E.competitiveState(loser5, ctx);
assert(Math.abs(state3.level - state5.level) > 2, 'Fixture must exceed the retired two-point level cutoff.');

const closeFit = E.directionalFit(winner3, loser5, ctx);
const closeReverse = E.directionalFit(loser5, winner3, ctx);
assert.equal(closeFit.hierarchySource, 'rank');
assert.equal(closeReverse.hierarchySource, 'rank');
assert.deepEqual(closeFit.band, [1, 4]);
assert.deepEqual(closeReverse.band, [4, 10]);
assert.equal(closeFit.distance, 1);
assert.equal(closeReverse.distance, 1);
assert(closeFit.parts.careerDirection >= 18 && closeReverse.parts.careerDirection >= 18, 'A fresh #3/#5 pairing should grade as normal ranked movement.');

const closePair = E.evaluatePair(winner3, loser5, ctx);
assert(closePair.eligible);
assert.equal(closePair.case.code, 'step-up-vs-rebound', 'Ranked W/L classification must use ranking positions, not the retired level cutoff.');

const distantFit = E.directionalFit(winner3, loser9, ctx);
const distantPair = E.evaluatePair(winner3, loser9, ctx);
assert.equal(distantFit.hierarchySource, 'rank');
assert(distantFit.parts.careerDirection < closeFit.parts.careerDirection, 'A #3 winner should prefer a nearby ranked opponent over dropping to #9.');
assert(closePair.score > distantPair.score, 'Nearby hierarchy should outrank a much larger downward rankings move.');
assert.notEqual(distantPair.case.code, 'step-up-vs-rebound', 'A large downward rankings move must not be mislabeled as normal progression.');

const upwardPair = E.evaluatePair(winner8, loser5, ctx);
assert(upwardPair.eligible);
assert.equal(upwardPair.case.code, 'step-up-vs-rebound', 'A #8 winner facing a #5 loser is a normal upward opportunity.');

console.log('Ranked hierarchy checks passed: actual ranking movement now drives ranked-vs-ranked direction and W/L classification.');
