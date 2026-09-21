import assert from 'node:assert/strict';
import './matchmaker/check-roster.mjs';
import './matchmaker/check-bookings.mjs';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { validateData } from './matchmaker/validate.mjs';
import { parseEvent, parseRankings, parseProfile, eventDate } from './matchmaker/sources/ufc.mjs';
import { parseFighterDirectory, parseFighterHistory, parseMirrorHistory } from './matchmaker/sources/ufcstats.mjs';
import { reconcileProfileHistory } from './matchmaker/history-reconcile.mjs';
const require = createRequire(import.meta.url), E = require('../assets/matchmaker-engine.js');
const bout = (date, result = 'W', opponentIds = [], text = '') => ({ date, result, opponentIds, text });
const make = (id, rank = 8, extra = {}) => ({ id, name: id.toUpperCase(), active: true, division: 'Flyweight', rank, lastFight: '2026-08-01', history: [bout('2026-08-01'), bout('2026-05-01'), bout('2026-02-01')], ...extra });
const context = { asOf: '2026-09-10', event: { date: '2026-08-01', bouts: [{ fighters: [{ id: 'alpha', result: 'W' }, { id: 'bravo', result: 'L' }] }] }, locks: [], overrides: {} };
const a = make('alpha'), b = make('bravo', 6);
assert.equal(E.VERSION, 2, 'Matchmaker V2 must remain active');
assert.deepEqual(Object.keys(E.WEIGHTS), ['competitiveLevel', 'careerDirection', 'trajectory', 'opponentQuality', 'experience', 'timing'], 'Eligibility/freshness/story must not masquerade as scoring weights');
assert.equal(Object.values(E.WEIGHTS).reduce((sum, value) => sum + value, 0), 100, 'Matchmaking merit weights must total 100');
assert.deepEqual(E.targetRange(a, context), [4, 9]);
assert.deepEqual(E.targetRange(a, { ...context, event: { date: '2026-09-01', bouts: [{ fighters: [{ id: 'alpha', result: 'L' }] }] } }), [7, 13]);
assert.deepEqual(E.targetRange(make('novice', null, { history: [bout('2026-08-01')] }), context), [16, 26]);
assert(E.evaluate(a, b, context).eligible);
assert(!E.evaluate(a, a, context).eligible);
assert(!E.evaluate(a, { ...b, active: false }, context).eligible);
assert(!E.evaluate(a, { ...b, booking: { event: 'UFC test', date: '2026-10-01' } }, context, true).eligible);
assert(!E.evaluate(a, { ...b, division: 'Bantamweight' }, context).eligible);
assert(!E.evaluate(a, { ...b, history: [] }, context).eligible);
assert(!E.evaluate(a, { ...b, lastFight: '2020-01-01' }, context).eligible);
assert(!E.evaluate(a, b, { ...context, overrides: { bravo: { unavailable: 'Injured' } } }).eligible);
const rematch = { ...a, history: [bout('2026-08-01', 'W', ['bravo'])] };
assert(!E.evaluate(rematch, b, context).eligible);
assert(E.evaluate(rematch, b, { ...context, overrides: { alpha: { allowRematch: true } } }).eligible);
assert(E.rematchCase({ ...a, history: [bout('2026-08-01', 'D', ['bravo'])] }, b, context).allowed);
assert(!E.rematchCase({ ...a, history: [bout('2026-08-01', 'W', ['bravo'])] }, b, context).allowed);
assert.equal(E.rank({ ...a, rankings: [{ division: 'Flyweight', rank: 8 }] }, { ...context, overrides: { alpha: { division: 'Bantamweight' } } }), null);

// Pair scoring must represent the fight, not whichever fighter happened to be the subject.
const forwardPair = E.evaluatePair(a, b, context);
const reversePair = E.evaluatePair(b, a, context);
assert(forwardPair.eligible && reversePair.eligible);
assert.equal(forwardPair.score, reversePair.score, 'A↔B must have one symmetric overall fight score');
assert.equal(forwardPair.case.code, reversePair.case.code, 'A↔B must resolve to the same matchmaking case');
assert(!/(?:no prior|no previous).*meeting/i.test(forwardPair.rationale), 'Freshness/verification must not be used as the public WHY for a matchup');
assert(forwardPair.parts.a && forwardPair.parts.b && Number.isFinite(forwardPair.parts.weakerSide), 'Pair scoring must expose both fighters’ directional fit');

// Verified strength of schedule must distinguish otherwise similar unranked fighters.
const eliteOpp = make('elite-opposition', 2);
const solidOpp = make('solid-opposition', 7);
const shallowOpp = make('shallow-opposition', null, { history: [bout('2026-08-01', 'W')] });
const tested = make('tested', null, { history: [bout('2026-08-01', 'W', ['elite-opposition']), bout('2026-05-01', 'W', ['solid-opposition']), bout('2026-02-01', 'W', ['solid-opposition'])] });
const shallow = make('shallow', null, { history: [bout('2026-08-01', 'W', ['shallow-opposition']), bout('2026-05-01', 'W', ['shallow-opposition']), bout('2026-02-01', 'W', ['shallow-opposition'])] });
const scheduleRoster = [tested, shallow, eliteOpp, solidOpp, shallowOpp];
const scheduleCtx = { ...context, fighterIndex: new Map(scheduleRoster.map(fighter => [fighter.id, fighter])) };
const testedSchedule = E.scheduleStrength(tested, scheduleCtx);
const shallowSchedule = E.scheduleStrength(shallow, scheduleCtx);
assert(testedSchedule.coverage > 0.9 && shallowSchedule.coverage > 0.9, 'Schedule fixture must be substantially linked');
assert(testedSchedule.average > shallowSchedule.average + 15, 'Recent opponent quality must separate strong and shallow schedules');
assert(E.competitiveState(tested, scheduleCtx).level > E.competitiveState(shallow, scheduleCtx).level, 'Unranked competitive state must respond to verified opposition quality');

// A verified prior meeting is a hard eligibility rule, even when weaker UFC.com profile prose missed it.
const jeanFixture = make('jean-silva', 6, {
  name: 'Jean Silva', division: 'Featherweight',
  verifiedMeetings: [{ opponentId: 'diego-lopes', opponentName: 'Diego Lopes', date: '2025-09-13', result: 'L', source: 'UFCStats', sourceUrl: 'https://ufcstats.com/fight-details/de1a3734be60e6a1' }],
  meetingCoverage: { source: 'UFCStats', verified: true, checkedAt: '2026-09-10T00:00:00Z' }
});
const diegoFixture = make('diego-lopes', 2, { name: 'Diego Lopes', division: 'Featherweight' });
const jeanContext = { ...context, asOf: '2026-09-10', event: { date: '2026-08-01', bouts: [{ fighters: [{ id: 'jean-silva', result: 'W' }] }] } };
const jeanDiego = E.evaluate(jeanFixture, diegoFixture, jeanContext);
assert.equal(jeanDiego.eligible, false, 'A verified Jean Silva vs Diego Lopes prior fight must exclude a normal fresh rematch recommendation');
assert.match(jeanDiego.reason, /Previously fought on 2025-09-13/);
const uncertain = E.evaluate(make('uncertain', 7, { name: 'Uncertain Fighter' }), make('fresh', 8, { name: 'Fresh Fighter' }), context);
assert(uncertain.eligible);
assert(!/(?:no prior|no previous).*meeting/i.test(uncertain.rationale), 'Incomplete history must not become the explanatory WHY for a matchup');
assert(uncertain.case?.code && uncertain.case?.reasons?.length >= 2, 'Every eligible V2 matchup must have a substantive matchmaking case');

// Direct UFCStats parser fixtures remain covered even though production uses a GitHub-hosted mirror.
const statsJean = '52ef95b5860fb28c', statsDiego = 'f166e93d04a8c274';
const directoryFixture = `<table><tr><td><a href="http://ufcstats.com/fighter-details/${statsJean}">Jean</a> <a href="http://ufcstats.com/fighter-details/${statsJean}">Silva</a></td></tr><tr><td><a href="http://ufcstats.com/fighter-details/${statsDiego}">Diego</a> <a href="http://ufcstats.com/fighter-details/${statsDiego}">Lopes</a></td></tr></table>`;
const directory = parseFighterDirectory(directoryFixture);
assert(directory.some(f => f.id === statsJean && f.name === 'Jean Silva'));
assert(directory.some(f => f.id === statsDiego && f.name === 'Diego Lopes'));
const historyFixture = `<table><tr data-link="http://ufcstats.com/fight-details/de1a3734be60e6a1"><td>loss</td><td><a href="http://ufcstats.com/fighter-details/${statsJean}">Jean Silva</a><a href="http://ufcstats.com/fighter-details/${statsDiego}">Diego Lopes</a></td><td><a href="http://ufcstats.com/event-details/5efaaf313b652dd7">UFC Fight Night: Lopes vs. Silva</a></td><td>Sep. 13, 2025</td></tr></table>`;
const parsedJeanHistory = parseFighterHistory(historyFixture, `https://ufcstats.com/fighter-details/${statsJean}`, '2026-09-10T00:00:00Z');
assert.equal(parsedJeanHistory.length, 1);
assert.equal(parsedJeanHistory[0].opponentStatsId, statsDiego);
assert.equal(parsedJeanHistory[0].opponentName, 'Diego Lopes');
assert.equal(parsedJeanHistory[0].date, '2025-09-13');
assert.equal(parsedJeanHistory[0].result, 'L');

// Mirror regression: standard UFC, Noche UFC and Road to UFC rows are retained with provenance.
const mirrorEventsFixture = [
  'EVENT,URL,DATE,LOCATION',
  '"Noche UFC: Lopes vs. Silva","http://ufcstats.com/event-details/5efaaf313b652dd7","September 13, 2025","San Antonio, Texas, USA"',
  '"Road to UFC 2.7","http://ufcstats.com/event-details/cce79e827569f26e","February 03, 2024","Las Vegas, Nevada, USA"'
].join('\n') + '\n';
const mirrorFightsFixture = [
  'EVENT,BOUT,OUTCOME,WEIGHTCLASS,METHOD,ROUND,TIME,TIME FORMAT,REFEREE,DETAILS,URL',
  '"Noche UFC: Lopes vs. Silva","Diego Lopes vs. Jean Silva","W/L","Featherweight Bout","KO/TKO","2","4:48","5-5","Mike Beltran","Punches","http://ufcstats.com/fight-details/de1a3734be60e6a1"',
  '"Road to UFC 2.7","Rei Tsuruya vs. Jiniushiyue","W/L","Flyweight Bout","KO/TKO","1","4:59","5-5","Test Ref","Punches","http://ufcstats.com/fight-details/aaaaaaaaaaaaaaaa"'
].join('\n') + '\n';
const mirrorLedger = parseMirrorHistory(mirrorFightsFixture, mirrorEventsFixture, '2026-09-10');
assert.equal(mirrorLedger.length, 2);
const noche = mirrorLedger.find(row => row.aName === 'Diego Lopes');
assert.equal(noche.date, '2025-09-13');
assert.equal(noche.aResult, 'W');
assert.equal(noche.bResult, 'L');
assert.equal(noche.competitionClass, 'ufc');
assert.equal(noche.sourceUrl, 'https://ufcstats.com/fight-details/de1a3734be60e6a1');
const road = mirrorLedger.find(row => row.aName === 'Rei Tsuruya');
assert(road, 'Road to UFC history must remain available for prior-meeting verification');
assert.equal(road.competitionClass, 'road-to-ufc');
assert.equal(road.date, '2024-02-03');

// UFC.com biography prose contains known date/result errors. Reconciliation must prefer a structured
// opponent-linked fight rather than either discarding the fighter or silently accepting the prose date.
const rakicProfileTypo = [{ date: '2024-10-30', result: 'L', opponentIds: ['magomed-ankalaev'], text: 'UFC 308 (10/30/24) Rakic lost a decision to Magomed Ankalaev' }];
const rakicVerified = [{ date: '2024-10-26', result: 'L', opponentId: 'magomed-ankalaev', opponentName: 'Magomed Ankalaev', sourceUrl: 'https://ufcstats.com/fight-details/test' }];
const rakicReconciled = reconcileProfileHistory(rakicProfileTypo, rakicVerified);
assert.equal(rakicReconciled.missing.length, 0, 'A verified opponent match must reconcile a bad profile date');
assert(rakicReconciled.discrepancies.some(item => item.type === 'profile-date' && item.verifiedDate === '2024-10-26'));
const perezYearTypo = reconcileProfileHistory(
  [{ date: '2025-06-15', result: 'L', opponentIds: ['tatsuro-taira'], text: 'Perez was stopped by Tatsuro Taira' }],
  [{ date: '2024-06-15', result: 'L', opponentId: 'tatsuro-taira', opponentName: 'Tatsuro Taira', sourceUrl: 'https://ufcstats.com/fight-details/test2' }]
);
assert.equal(perezYearTypo.missing.length, 0, 'An exact opponent/result must survive a one-year UFC.com profile typo');
assert(perezYearTypo.discrepancies.some(item => item.type === 'profile-date'));
const resultConflict = reconcileProfileHistory(
  [{ date: '2026-03-21', result: 'L', opponentIds: ['shanelle-dyer'], text: 'Oliveira was stopped by Shanelle Dyer' }],
  [{ date: '2026-03-21', result: 'W', opponentId: 'shanelle-dyer', opponentName: 'Shanelle Dyer', sourceUrl: 'https://ufcstats.com/fight-details/test3' }]
);
assert.equal(resultConflict.missing.length, 0, 'Exact opponent evidence should reconcile contradictory profile prose');
assert(resultConflict.discrepancies.some(item => item.type === 'profile-result'));
const unrelated = reconcileProfileHistory(
  [{ date: '2025-01-01', result: 'W', opponentIds: ['one'], text: 'Fighter defeated One' }],
  [{ date: '2025-08-01', result: 'W', opponentId: 'two', opponentName: 'Two', sourceUrl: 'https://ufcstats.com/fight-details/test4' }]
);
assert.equal(unrelated.missing.length, 1, 'Reconciliation must not invent a match between unrelated fights');

const lock = E.lock(a, b, context);
assert.throws(() => E.lock(a, b, { ...context, locks: [lock] }), /Reserved/);
const roster = [a, b, make('charlie', 7), make('delta', 9), make('echo', 10)];
const auto = E.autoMatch(roster, context, ['alpha', 'bravo', 'charlie']);
const paired = auto.pairs.flatMap(p => [p.a, p.b]); assert.equal(new Set(paired).size, paired.length);
assert.deepEqual(E.recommendations(a, roster, context), E.recommendations(a, [...roster].reverse(), context));
assert.throws(() => E.validateBoard({ version: 1, eventId: 'test', locks: [{ a: 'alpha', b: 'alpha' }] }, { events: [{ id: 'test' }], fighters: roster }));
assert.throws(() => parseEvent('<html>Blocked</html>', 'https://www.ufc.com/event/test'));
assert.throws(() => parseRankings('<html>Missing rankings</html>'));
assert.throws(() => parseProfile('<html>No athlete data</html>', a, '2026-09-10'));
assert.equal(eventDate('<div class="c-hero__headline-suffix">Sat, Aug 15 / 9:00 PM EDT</div>', '1786842000'), '2026-08-15');
assert.throws(() => eventDate('<html>No local date</html>', '1786842000'));
const data = JSON.parse(fs.readFileSync('assets/data/matchmaker/current.json', 'utf8'));
validateData(data);
assert.equal(data.fighters.find(f => f.id === 'michael-page')?.active, false, 'Michael Page must remain excluded');
const dataIndex = new Map(data.fighters.map(fighter => [fighter.id, fighter]));

// Once the structured meeting source is present, the real published data must preserve the known Lopes/Silva fight.
if (data.sources?.meetings) {
  const jean = data.fighters.find(f => f.id === 'jean-silva');
  const diego = data.fighters.find(f => f.id === 'diego-lopes');
  assert(jean && diego, 'Jean Silva and Diego Lopes must resolve to canonical Matchmaker fighters');
  assert.equal(jean.meetingCoverage?.verified, true, 'Jean Silva must have verified prior-opponent coverage before publishing recommendations');
  const meetings = E.priorMeetings(jean, diego);
  assert(meetings.some(m => m.date === '2025-09-13'), 'Published history must retain Jean Silva vs Diego Lopes on 2025-09-13');
  const ctx = { ...context, event: data.events[0], asOf: data.generatedAt, fighterIndex: dataIndex };
  assert(!E.recommendations(jean, data.fighters, ctx).some(r => r.fighter.id === 'diego-lopes'), 'Diego Lopes must not appear as a normal fresh recommendation for Jean Silva');
}

// The Delgado/McMillen example must be one fight in the engine, not two unrelated directional scores.
const delgado = data.fighters.find(f => f.name === 'Jose Miguel Delgado');
const mcmillen = data.fighters.find(f => f.name === 'Tommy McMillen');
if (delgado && mcmillen) {
  const pairEvent = data.events.find(event => {
    const ids = new Set(event.bouts.flatMap(bout => bout.fighters || []).map(f => f.id));
    return ids.has(delgado.id) && ids.has(mcmillen.id);
  }) || data.events[0];
  const pairCtx = { ...context, event: pairEvent, asOf: data.generatedAt, fighterIndex: dataIndex };
  const dm = E.evaluatePair(delgado, mcmillen, pairCtx);
  const md = E.evaluatePair(mcmillen, delgado, pairCtx);
  assert.equal(dm.eligible, md.eligible, 'Delgado/McMillen eligibility must be symmetric');
  if (dm.eligible) {
    assert.equal(dm.score, md.score, 'Delgado/McMillen must have one shared fight-plausibility score');
    assert.equal(dm.case.code, md.case.code, 'Delgado/McMillen must have one shared matchmaking case');
    assert(!/(?:no prior|no previous).*meeting/i.test(dm.rationale), 'Delgado/McMillen rationale must explain matchmaking merit, not history verification');
  }
}

let checked = 0, lowConfidencePublished = 0;
const historyV2 = Number(data.sources?.meetings?.historyModelVersion || 0) >= 2;
for (const event of data.events) {
  const ctx = { ...context, event, asOf: data.generatedAt, fighterIndex: dataIndex };
  for (const entry of event.bouts.flatMap(bout => bout.fighters)) {
    const fighter = data.fighters.find(f => f.id === entry.id), before = JSON.stringify(fighter);
    for (let i = 1; i < fighter.history.length; i++) {
      const left = fighter.history[i - 1], right = fighter.history[i];
      if (Math.abs(Date.parse(left.date) - Date.parse(right.date)) <= 86400000) assert(!left.opponentIds.some(id => right.opponentIds.includes(id)), 'One fight was counted twice across a UTC calendar boundary');
    }
    const allCandidates = historyV2 && fighter.meetingCoverage?.verified === true ? E.candidates(fighter, data.fighters, ctx) : [];
    lowConfidencePublished += allCandidates.filter(candidate => candidate.publishable && candidate.confidence === 'low').length;
    const recs = data.sources?.meetings && fighter.meetingCoverage?.verified !== true ? [] : E.recommendations(fighter, data.fighters, ctx);
    assert(recs.length <= 3); assert.equal(new Set(recs.map(r => r.fighter.id)).size, recs.length);
    for (const r of recs) {
      assert(r.eligible && !r.fighter.booking && r.fighter.active);
      if (historyV2) assert.equal(r.fighter.meetingCoverage?.verified, true, `Unverified candidate leaked into recommendations: ${r.fighter.name}`);
      assert(r.score >= 0 && r.score <= 100);
      assert(r.publishable && ['low', 'medium', 'high'].includes(r.confidence), `Recommendation lost publication/confidence state: ${fighter.name} vs ${r.fighter.name}`);
      assert(r.case?.code && r.case?.reasons?.length >= 2, `Recommendation lacks a substantive matchmaking case: ${fighter.name} vs ${r.fighter.name}`);
      assert(!/(?:no prior|no previous).*meeting/i.test(r.rationale), `Recommendation rationale fell back to history verification: ${fighter.name} vs ${r.fighter.name}`);
      assert(r.rationale && r.evidence.length >= 5); checked++;
    }
    assert.equal(JSON.stringify(fighter), before, 'Engine must not mutate source records');
  }
  const autoPairs = E.autoMatch(data.fighters, ctx, event.bouts.flatMap(bout => bout.fighters.map(f => f.id)), 1000);
  const ids = autoPairs.pairs.flatMap(p => [p.a, p.b]); assert.equal(new Set(ids).size, ids.length, 'Auto matching double-booked a fighter');
}
assert(lowConfidencePublished > 0, 'Production data should exercise at least one hard-eligible low-confidence pairing');

const page = fs.readFileSync('matchmaker.html', 'utf8');
for (const asset of ['assets/matchmaker-engine.js', 'assets/matchmaker-public.js', 'assets/matchmaker-simple.js', 'assets/matchmaker-simple.css']) assert(page.includes('/' + asset) && fs.existsSync(asset), `Missing simplified Matchmaker asset: ${asset}`);
for (const retired of ['assets/matchmaker.js', 'assets/matchmaker-warroom.js', 'assets/matchmaker-warroom.css', 'assets/matchmaker-doctrine.css']) assert(!page.includes('/' + retired), `Retired interactive Matchmaker asset should not load: ${retired}`);
for (const marker of ['data-matchmaker-simple', 'mm-simple-eventbar', 'data-mm-grid', 'Plausible next UFC matchups', 'Matchmaking War Room']) assert(page.includes(marker), `Missing simplified Matchmaker marker: ${marker}`);
for (const control of ['data-mm-auto', 'data-mm-undo', 'data-mm-rematch', 'data-mm-search', 'data-mm-freeze', 'data-mm-download', 'data-mm-board']) assert(!page.includes(control), `Overbuilt Matchmaker control returned: ${control}`);

const simpleJs = fs.readFileSync('assets/matchmaker-simple.js', 'utf8');
assert.doesNotThrow(() => new Function(simpleJs), 'Simplified Matchmaker JavaScript must parse');
for (const marker of ['P.selectRecommendations', 'BEST FIT', 'ALSO MAKES SENSE', 'ANOTHER OPTION', 'renderEvent', 'meetingCoverage?.verified', 'Prior-opponent history is still being verified']) assert(simpleJs.includes(marker), `Missing simplified Matchmaker behavior: ${marker}`);
assert(!/localStorage|showModal|data-mm-lock|autoMatch\(/.test(simpleJs), 'Read-only Matchmaker presentation must not restore board-building behavior');

const simpleCss = fs.readFileSync('assets/matchmaker-simple.css', 'utf8');
for (const marker of ['.mm-simple-hero', '.mm-simple-eventbar', '.mm-simple-board', '.mm-simple-file', '.mm-simple-match', 'prefers-reduced-motion']) assert(simpleCss.includes(marker), `Missing simplified Matchmaker style: ${marker}`);
assert(fs.readFileSync('_config.yml', 'utf8').includes('link: "/matchmaker/"'));
console.log(`Matchmaker checks passed: opponent-adjusted two-sided V2 scoring, substantive case rationales, hard eligibility with diagnostic confidence (${lowConfidencePublished} low-confidence eligible candidates retained), hard rematch regression, structured-history reconciliation, ${data.events.length} real cards, ${checked} published recommendations, and simplified read-only next-fight presentation.`);
