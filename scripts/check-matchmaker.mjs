import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { validateData } from './matchmaker/validate.mjs';
import { parseEvent, parseRankings, parseProfile } from './matchmaker/sources/ufc.mjs';
const require = createRequire(import.meta.url), E = require('../assets/matchmaker-engine.js');
const bout = (date, result = 'W', opponentIds = [], text = '') => ({ date, result, opponentIds, text });
const make = (id, rank = 8, extra = {}) => ({ id, name: id.toUpperCase(), active: true, division: 'Flyweight', rank, lastFight: '2026-08-01', history: [bout('2026-08-01'), bout('2026-05-01'), bout('2026-02-01')], ...extra });
const context = { asOf: '2026-09-10', event: { date: '2026-08-01', bouts: [{ fighters: [{ id: 'alpha', result: 'W' }, { id: 'bravo', result: 'L' }] }] }, locks: [], overrides: {} };
const a = make('alpha'), b = make('bravo', 6);
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
const data = JSON.parse(fs.readFileSync('assets/data/matchmaker/current.json', 'utf8'));
validateData(data);
let checked = 0;
for (const event of data.events) {
  const ctx = { ...context, event, asOf: data.generatedAt };
  for (const entry of event.bouts.flatMap(b => b.fighters)) {
    const fighter = data.fighters.find(f => f.id === entry.id), before = JSON.stringify(fighter);
    const recs = E.recommendations(fighter, data.fighters, ctx);
    assert(recs.length <= 3); assert.equal(new Set(recs.map(r => r.fighter.id)).size, recs.length);
    for (const r of recs) { assert(r.eligible && !r.fighter.booking && r.fighter.active); assert(r.score >= 0 && r.score <= 100); assert(r.rationale && r.evidence.length >= 4); checked++; }
    assert.equal(JSON.stringify(fighter), before, 'Engine must not mutate source records');
  }
  const auto = E.autoMatch(data.fighters, ctx, event.bouts.flatMap(b => b.fighters.map(f => f.id)), 1000);
  const ids = auto.pairs.flatMap(p => [p.a, p.b]); assert.equal(new Set(ids).size, ids.length, 'Auto matching double-booked a fighter');
}
const page = fs.readFileSync('matchmaker.html', 'utf8');
for (const asset of ['assets/matchmaker.js', 'assets/matchmaker-engine.js', 'assets/matchmaker.css']) assert(page.includes('/' + asset) && fs.existsSync(asset));
assert(fs.readFileSync('_config.yml', 'utf8').includes('link: "/matchmaker/"'));
console.log(`Matchmaker checks passed: rule regressions, source validation, ${data.events.length} real cards, ${checked} eligible recommendations, unique auto pairings, and page assets.`);
