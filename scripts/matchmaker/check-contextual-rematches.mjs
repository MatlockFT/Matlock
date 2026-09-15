import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');
const ctx = { asOf: '2026-09-15', overrides: {}, locks: [], event: { id: 'test', date: '2026-09-15', bouts: [] } };
const coverage = { verified: true, source: 'UFCStats' };

function meeting({ id, opponentId, opponentName, date, result, method = 'Decision - Unanimous', round = 3, weightClass = 'Lightweight Bout' }) {
  return {
    fightStatsId: id,
    opponentId,
    opponentName,
    date,
    result,
    method,
    round,
    competitionClass: 'ufc',
    weightClass,
    text: `${opponentName}. ${result}. ${method}`
  };
}

function fighter(id, name, rank, history, verifiedMeetings = []) {
  return {
    id,
    name,
    active: true,
    division: 'Lightweight',
    rank,
    rankings: [{ division: 'Lightweight', rank }],
    history,
    verifiedMeetings,
    meetingCoverage: coverage,
    lastFight: history[0]?.date || '2026-01-01'
  };
}

function pair({ date, method, round = 3, weightClass = 'Lightweight Bout', aRank = 4, bRank = 5, aWins = [], bWins = [] }) {
  const aPrior = meeting({ id: 'prior-1', opponentId: 'bravo', opponentName: 'Bravo', date, result: 'W', method, round, weightClass });
  const bPrior = meeting({ id: 'prior-1', opponentId: 'alpha', opponentName: 'Alpha', date, result: 'L', method, round, weightClass });
  const aHistory = [...aWins.map((winDate, i) => meeting({ id: `a-win-${i}`, opponentId: `a-op-${i}`, opponentName: `A Opp ${i}`, date: winDate, result: 'W' })), aPrior].sort((x, y) => y.date.localeCompare(x.date));
  const bHistory = [...bWins.map((winDate, i) => meeting({ id: `b-win-${i}`, opponentId: `b-op-${i}`, opponentName: `B Opp ${i}`, date: winDate, result: 'W' })), bPrior].sort((x, y) => y.date.localeCompare(x.date));
  return [
    fighter('alpha', 'Alpha', aRank, aHistory, [aPrior]),
    fighter('bravo', 'Bravo', bRank, bHistory, [bPrior])
  ];
}

{
  const [a, b] = pair({ date: '2026-08-01', method: 'Decision - Split', round: 5, weightClass: 'Lightweight Title Bout', aRank: 0, bRank: 1 });
  const result = E.rematchCase(a, b, ctx);
  assert.equal(result.allowed, true, 'A close title decision with the current champion involved should support an immediate rematch.');
  assert.equal(result.profile.closeDecision, true);
  assert.equal(result.profile.titleBout, true);
  const evaluated = E.evaluatePair(a, b, ctx);
  assert.equal(evaluated.eligible, true, 'A supported close title rematch must survive the normal title-claim veto.');
  assert.equal(evaluated.case.code, 'title-case');
}

{
  const [a, b] = pair({ date: '2026-08-01', method: 'Decision - Unanimous', round: 5, weightClass: 'Lightweight Title Bout', aRank: 0, bRank: 1 });
  assert.equal(E.rematchCase(a, b, ctx).allowed, false, 'An ordinary recent unanimous title decision must not automatically create an immediate rematch.');
  assert.equal(E.evaluatePair(a, b, ctx).eligible, false, 'The ordinary unanimous title rematch must remain excluded end-to-end.');
}

{
  const [a, b] = pair({ date: '2022-01-01', method: 'Decision - Unanimous', aWins: ['2026-05-01', '2025-06-01'], bWins: ['2026-04-01', '2025-05-01'] });
  const result = E.rematchCase(a, b, ctx);
  assert.equal(result.allowed, true, 'An old decision with two meaningful UFC wins each since should be recyclable.');
  assert(result.reason.includes('two UFC wins'));
}

{
  const [a, b] = pair({ date: '2022-01-01', method: 'KO/TKO', round: 1, aWins: ['2026-05-01', '2025-06-01', '2024-07-01'], bWins: ['2026-04-01', '2025-05-01', '2024-06-01'] });
  const result = E.rematchCase(a, b, ctx);
  assert.equal(result.allowed, false, 'A prior early finish should require more than ordinary decision separation before recycling the matchup.');
  assert.equal(result.profile.earlyFinish, true);
}

{
  const [a, b] = pair({ date: '2020-01-01', method: 'Submission', round: 2, aWins: ['2026-05-01', '2025-06-01', '2024-07-01'], bWins: ['2026-04-01', '2025-05-01', '2024-06-01'] });
  assert.equal(E.rematchCase(a, b, ctx).allowed, true, 'A finish can become recyclable after five years and three UFC wins each.');
}

{
  const firstA = meeting({ id: 'series-1', opponentId: 'bravo', opponentName: 'Bravo', date: '2025-01-01', result: 'W', method: 'Decision - Unanimous', round: 5, weightClass: 'Lightweight Title Bout' });
  const secondA = meeting({ id: 'series-2', opponentId: 'bravo', opponentName: 'Bravo', date: '2026-06-01', result: 'L', method: 'Decision - Unanimous', round: 5, weightClass: 'Lightweight Title Bout' });
  const firstB = { ...firstA, opponentId: 'alpha', opponentName: 'Alpha', result: 'L' };
  const secondB = { ...secondA, opponentId: 'alpha', opponentName: 'Alpha', result: 'W' };
  const a = fighter('alpha', 'Alpha', 1, [secondA, firstA], [secondA, firstA]);
  const b = fighter('bravo', 'Bravo', 0, [secondB, firstB], [secondB, firstB]);
  const result = E.rematchCase(a, b, ctx);
  assert.equal(result.allowed, true, 'A 1-1 championship series should support a deciding trilogy while the title remains involved.');
  assert.equal(result.profile.balancedSeries, true);
  const evaluated = E.evaluatePair(a, b, ctx);
  assert.equal(evaluated.eligible, true, 'A supported title trilogy must survive the title-claim gate.');
  assert.equal(evaluated.case.code, 'title-case');
}

console.log('Contextual rematch checks passed: close title rematches, title trilogies, old decisions, and stricter prior-finish recycling.');
