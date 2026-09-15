import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');

const bout = (date, result) => ({ date, result, opponentIds: [], text: '' });
const coverage = { source: 'UFCStats', verified: true, checkedAt: '2026-09-15T00:00:00Z' };
const fighter = (id, name, rank, latestResult) => ({
  id,
  name,
  active: true,
  division: "Women's Flyweight",
  rank,
  lastFight: '2026-09-12',
  historyModelVersion: 2,
  history: [
    bout('2026-09-12', latestResult),
    bout('2026-05-01', 'W'),
    bout('2026-01-01', 'W')
  ],
  verifiedMeetings: [],
  meetingCoverage: coverage
});

// Confidence remains diagnostic only. Use a wider but still hard-eligible ranked pairing
// so this regression stays independent of the separate close-ranked hierarchy test.
const rankThree = fighter('rank-three', 'Rank Three', 3, 'W');
const rankNine = fighter('rank-nine', 'Rank Nine', 9, 'L');
const roster = [rankThree, rankNine];
const ctx = {
  asOf: '2026-09-15T00:00:00Z',
  event: {
    date: '2026-09-12',
    bouts: [{ fighters: [{ id: rankThree.id, result: 'W' }] }]
  },
  locks: [],
  overrides: {}
};

const pair = E.evaluatePair(rankThree, rankNine, { ...ctx, fighterIndex: new Map(roster.map(f => [f.id, f])) }, false, true);
assert.equal(pair.eligible, true, 'Fixture must pass hard eligibility');
assert.equal(pair.case.code, 'divisional-sorting', 'Fixture must exercise the generic low-confidence case');
assert.equal(pair.confidence, 'low', 'Fixture must remain low confidence so confidence cannot silently become eligibility');
assert.equal(pair.publishable, true, 'An eligible automatic matchup must not be vetoed by confidence');

const recommendations = E.recommendations(rankThree, roster, ctx);
assert.equal(recommendations.length, 1, 'Eligible matchup should produce a recommendation instead of an empty card');
assert.equal(recommendations[0].fighter.id, rankNine.id, 'The eligible opponent must survive recommendation publication');

console.log('Eligible recommendation gate: low confidence no longer vetoes a hard-eligible matchup.');
