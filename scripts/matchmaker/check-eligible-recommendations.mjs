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

// Mirrors the failure mode behind Grasso/Rose: a fresh, close-ranked matchup can be
// eligible while the descriptive confidence model still calls it low confidence.
const grasso = fighter('alexa-grasso', 'Alexa Grasso', 3, 'W');
const rose = fighter('rose-namajunas', 'Rose Namajunas', 5, 'L');
const roster = [grasso, rose];
const ctx = {
  asOf: '2026-09-15T00:00:00Z',
  event: {
    date: '2026-09-12',
    bouts: [{ fighters: [{ id: grasso.id, result: 'W' }] }]
  },
  locks: [],
  overrides: {}
};

const pair = E.evaluatePair(grasso, rose, { ...ctx, fighterIndex: new Map(roster.map(f => [f.id, f])) }, false, true);
assert.equal(pair.eligible, true, 'Close-ranked fresh matchup should pass hard eligibility');
assert.equal(pair.case.code, 'divisional-sorting', 'Fixture must exercise the generic low-confidence case');
assert.equal(pair.confidence, 'low', 'Fixture must remain low confidence so confidence cannot silently become eligibility');
assert.equal(pair.publishable, true, 'An eligible automatic matchup must not be vetoed by confidence');

const recommendations = E.recommendations(grasso, roster, ctx);
assert.equal(recommendations.length, 1, 'Eligible matchup should produce a recommendation instead of an empty card');
assert.equal(recommendations[0].fighter.id, rose.id, 'The eligible opponent must survive recommendation publication');

console.log('Eligible recommendation gate: low confidence no longer vetoes a hard-eligible matchup.');
