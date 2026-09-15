import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');

const coverage = { source: 'UFCStats', verified: true, checkedAt: '2026-09-15T00:00:00Z' };
const bout = (date, result, opponentIds = []) => ({ date, result, opponentIds, text: '' });
const fighter = (id, rank, history, extra = {}) => ({
  id,
  name: id.replace(/-/g, ' '),
  active: true,
  division: 'Lightweight',
  rank,
  lastFight: history[0]?.date || '2026-09-01',
  historyModelVersion: 2,
  history,
  verifiedMeetings: [],
  meetingCoverage: coverage,
  ...extra
});
const ctx = { asOf: '2026-09-15', event: { date: '2026-09-01', bouts: [] }, locks: [], overrides: {} };

const champ = fighter('champion', 0, [bout('2026-08-01', 'W'), bout('2026-03-01', 'W')]);
const contender = fighter('title-contender', 3, [bout('2026-08-01', 'L'), bout('2026-03-01', 'W'), bout('2025-10-01', 'W')]);
const established = fighter('established-ranked', 7, [bout('2026-08-01', 'L'), bout('2026-03-01', 'W'), bout('2025-10-01', 'L'), bout('2025-05-01', 'W'), bout('2024-11-01', 'W'), bout('2024-05-01', 'L')]);
const risingRanked = fighter('rising-ranked', 12, [bout('2026-08-01', 'W'), bout('2026-03-01', 'W'), bout('2025-10-01', 'L'), bout('2025-05-01', 'W')]);
const fringe = fighter('fringe-ranked', 14, [bout('2026-08-01', 'L'), bout('2026-03-01', 'W'), bout('2025-10-01', 'L'), bout('2025-05-01', 'W')]);
const prospect = fighter('prospect', null, [bout('2026-08-01', 'W'), bout('2026-03-01', 'W'), bout('2025-10-01', 'W')]);
const highUnranked = fighter('high-level-unranked', null, [bout('2026-08-01', 'W'), bout('2026-03-01', 'L'), bout('2025-10-01', 'W'), bout('2025-05-01', 'W'), bout('2024-11-01', 'L'), bout('2024-05-01', 'W')]);
const rebuildingVeteran = fighter('rebuilding-veteran', null, [bout('2026-08-01', 'L'), bout('2026-03-01', 'L'), bout('2025-10-01', 'W'), bout('2025-05-01', 'L'), bout('2024-11-01', 'W'), bout('2024-05-01', 'L'), bout('2023-11-01', 'W'), bout('2023-05-01', 'W')]);
const legacy = fighter('championship-legacy', null, [bout('2026-08-01', 'L'), bout('2025-10-01', 'W'), bout('2025-02-01', 'L'), bout('2024-06-01', 'W'), bout('2023-10-01', 'W')], {
  verifiedMeetings: [
    { date: '2025-02-01', result: 'L', competitionClass: 'ufc', weightClass: 'UFC Lightweight Title Bout' },
    { date: '2024-06-01', result: 'W', competitionClass: 'ufc', weightClass: 'UFC Lightweight Title Bout' },
    { date: '2023-10-01', result: 'W', competitionClass: 'ufc', weightClass: 'UFC Lightweight Title Bout' }
  ]
});

assert.equal(E.careerStage(champ, ctx), 'champion');
assert.equal(E.careerStage(contender, ctx), 'title-contender');
assert.equal(E.careerStage(established, ctx), 'established-ranked');
assert.equal(E.careerStage(risingRanked, ctx), 'rising-ranked');
assert.equal(E.careerStage(fringe, ctx), 'fringe-ranked');
assert.equal(E.careerStage(prospect, ctx), 'prospect');
assert.equal(E.careerStage(highUnranked, ctx), 'high-level-unranked');
assert.equal(E.careerStage(rebuildingVeteran, ctx), 'rebuilding-veteran');
assert.equal(E.careerStage(legacy, ctx), 'championship-legacy');

const pool = [champ, contender, established, risingRanked, fringe, prospect, highUnranked, rebuildingVeteran, legacy];
const scoped = { ...ctx, fighterIndex: new Map(pool.map(f => [f.id, f])) };
assert.equal(E.evaluatePair(contender, rebuildingVeteran, scoped).eligible, false, 'Top contenders must not auto-match rebuilding unranked veterans.');
assert.equal(E.evaluatePair(established, rebuildingVeteran, scoped).eligible, false, 'Established ranked fighters must not auto-match rebuilding unranked veterans.');
assert.equal(E.evaluatePair(fringe, prospect, scoped).eligible, true, 'A fringe-ranked fighter may be a legitimate test for a rising prospect.');
assert.equal(E.evaluatePair(legacy, rebuildingVeteran, scoped).eligible, false, 'Championship-legacy fighters must stay out of ordinary rebuilding-veteran matchmaking pools.');

console.log('Career-state model: explicit UFC career stages constrain severe ranked/unranked and legacy mismatches.');
