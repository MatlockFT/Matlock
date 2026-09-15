import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');
const ctx = { asOf: '2026-09-15', overrides: {}, locks: [], event: { id: 'timing-test', date: '2026-09-15', bouts: [] } };
const coverage = { verified: true, source: 'UFCStats' };

function canonical(date, result = 'W') {
  return { date, result, opponentIds: [], text: '' };
}

function meeting(id, date, { result = 'W', method = 'KO/TKO', round = 1, weightClass = 'Lightweight Bout' } = {}) {
  return {
    fightStatsId: id,
    opponentId: `${id}-opponent`,
    opponentName: `${id} Opponent`,
    date,
    result,
    method,
    round,
    weightClass,
    competitionClass: 'ufc'
  };
}

function fighter(id, rank, date, latestMeeting) {
  return {
    id,
    name: id,
    active: true,
    division: 'Lightweight',
    rank,
    rankings: [{ division: 'Lightweight', rank }],
    lastFight: date,
    history: [canonical(date), canonical('2026-05-01'), canonical('2026-02-01')],
    verifiedMeetings: [latestMeeting],
    meetingCoverage: coverage
  };
}

const quick = fighter('quick', 8, '2026-09-01', meeting('quick-latest', '2026-09-01', { method: 'KO/TKO', round: 1 }));
const quickPeer = fighter('quick-peer', 9, '2026-09-01', meeting('quick-peer-latest', '2026-09-01', { method: 'Submission', round: 1 }));
const titleDecision = fighter('title-decision', 7, '2026-09-01', meeting('title-latest', '2026-09-01', { method: 'Decision - Unanimous', round: 5, weightClass: 'Lightweight Title Bout' }));
const waiting = fighter('waiting', 10, '2026-03-01', meeting('waiting-latest', '2026-03-01', { method: 'KO/TKO', round: 1 }));

const quickWindow = E.turnaroundWindow(quick, ctx);
const titleWindow = E.turnaroundWindow(titleDecision, ctx);
assert.equal(quickWindow.minDays, 45, 'An early finish should receive the shortest normal turnaround window.');
assert.equal(titleWindow.minDays, 105, 'A five-round title decision should receive the longest modeled turnaround window.');
assert.equal(quickWindow.readyAt, '2026-10-16');
assert.equal(titleWindow.readyAt, '2026-12-15');

const aligned = E.turnaroundFit(quick, quickPeer, ctx);
const mixed = E.turnaroundFit(quick, titleDecision, ctx);
const delayed = E.turnaroundFit(waiting, titleDecision, ctx);
assert.equal(aligned.score, 5, 'Two fighters with aligned readiness windows should receive maximum timing fit.');
assert(mixed.score < aligned.score, 'Different recovery demands from the same card must lower timing fit.');
assert(delayed.score < mixed.score, 'A fighter ready now should be a weaker timing match for someone who plausibly needs a much later return.');

const pair = E.evaluatePair(quick, titleDecision, ctx);
assert(pair.eligible, 'Turnaround timing should rank an otherwise eligible matchup, not automatically veto it.');
assert.equal(pair.parts.a.timing, mixed.score, 'Pair scoring must use readiness-window timing rather than raw last-fight date distance.');
assert.equal(pair.directional.a.turnaround.bookingDate, '2026-12-15');

const futureUnavailable = E.availability(quick, { ...ctx, overrides: { quick: { unavailableUntil: '2026-10-01' } } });
assert.match(futureUnavailable, /Unavailable until 2026-10-01/);
assert.equal(E.availability(quick, { ...ctx, asOf: '2026-10-02', overrides: { quick: { unavailableUntil: '2026-10-01' } } }), null, 'Date-bounded unavailability must expire automatically.');

console.log('Turnaround timing checks passed: bout-depth recovery windows, synchronized readiness, and expiring unavailability.');
