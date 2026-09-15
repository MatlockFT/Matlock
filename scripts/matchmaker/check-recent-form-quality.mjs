import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');

const bout = (date, result, opponentIds = []) => ({ date, result, opponentIds, text: '' });
const coverage = { source: 'UFCStats', verified: true, checkedAt: '2026-09-15T00:00:00Z' };
const fighter = (id, name, rank, history, extra = {}) => ({
  id,
  name,
  active: true,
  division: "Women's Flyweight",
  rank,
  lastFight: history[0]?.date || '2026-09-12',
  historyModelVersion: 2,
  history,
  verifiedMeetings: [],
  meetingCoverage: coverage,
  ...extra
});

const elite = fighter('elite', 'Elite Opponent', 1, [bout('2026-08-01', 'W')]);
const shallow = fighter('shallow', 'Shallow Opponent', null, [bout('2026-08-01', 'L')]);
const target = fighter('target', 'Target Winner', 5, [bout('2026-09-12', 'W'), bout('2026-05-01', 'W'), bout('2026-01-01', 'L')]);
const eliteLoss = fighter('elite-loss', 'Elite Loss', 6, [
  bout('2026-09-12', 'L', ['elite']),
  bout('2026-05-01', 'W'),
  bout('2026-01-01', 'W')
]);
const shallowLoss = fighter('shallow-loss', 'Shallow Loss', 6, [
  bout('2026-09-12', 'L', ['shallow']),
  bout('2026-05-01', 'W'),
  bout('2026-01-01', 'W')
]);
const titleLoss = fighter('title-loss', 'Title Loss', 6, [
  bout('2026-09-12', 'L', ['elite']),
  bout('2026-05-01', 'W'),
  bout('2026-01-01', 'W')
], {
  verifiedMeetings: [{
    opponentId: 'elite', opponentName: 'Elite Opponent', date: '2026-09-12', result: 'L',
    competitionClass: 'ufc', weightClass: "Women's Flyweight Title Bout", source: 'UFCStats'
  }]
});

const roster = [target, eliteLoss, shallowLoss, titleLoss, elite, shallow];
const ctx = {
  asOf: '2026-09-15T00:00:00Z',
  event: { date: '2026-09-12', bouts: [{ fighters: [{ id: target.id, result: 'W' }] }] },
  locks: [],
  overrides: {},
  fighterIndex: new Map(roster.map(f => [f.id, f]))
};

assert.equal(typeof E.recentForm, 'function', 'Engine must expose opponent-adjusted recent form');
const eliteForm = E.recentForm(eliteLoss, ctx);
const shallowForm = E.recentForm(shallowLoss, ctx);
const titleForm = E.recentForm(titleLoss, ctx);
assert(eliteForm.coverage > 0, 'Elite-loss fixture must link recent opposition');
assert(shallowForm.coverage > 0, 'Shallow-loss fixture must link recent opposition');
assert(eliteForm.score > shallowForm.score + 5, 'A loss to elite opposition must grade materially better than the same loss to shallow opposition');
assert(titleForm.score > eliteForm.score, 'A UFC title-fight loss must be protected relative to the same non-title loss');

const eliteFit = E.directionalFit(target, eliteLoss, ctx);
const shallowFit = E.directionalFit(target, shallowLoss, ctx);
assert(eliteFit.parts.trajectory > shallowFit.parts.trajectory, 'Quality-adjusted recent form must affect matchup trajectory instead of treating identical W/L records as identical form');
assert.equal(eliteFit.hierarchySource, 'rank', 'Recent-form quality must not replace ranked hierarchy');

console.log(`Recent form quality: elite-loss ${eliteForm.score.toFixed(1)}, shallow-loss ${shallowForm.score.toFixed(1)}, title-loss ${titleForm.score.toFixed(1)}; trajectory ${eliteFit.parts.trajectory} vs ${shallowFit.parts.trajectory}.`);
