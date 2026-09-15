import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');

const bout = (date, result, opponentIds = []) => ({ date, result, opponentIds, text: '' });
const titleMeeting = (date, result, opponentId, weightClass = 'UFC Welterweight Title Bout') => ({
  date,
  result,
  opponentId,
  opponentName: opponentId.replace(/-/g, ' '),
  competitionClass: 'ufc',
  weightClass,
  source: 'UFCStats',
  sourceUrl: `https://ufcstats.com/fight-details/${opponentId.padEnd(16, '0').slice(0, 16).replace(/[^a-f0-9]/g, 'a')}`
});

function fighter(id, { rank = null, latest = 'L', titleResults = [], experience = 9 } = {}) {
  const history = Array.from({ length: experience }, (_, index) => bout(`2026-${String(8 - Math.min(index, 7)).padStart(2, '0')}-01`, index === 0 ? latest : index % 2 ? 'W' : 'L'));
  return {
    id,
    name: id.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase()),
    active: true,
    division: 'Welterweight',
    rank,
    rankings: rank === null ? [] : [{ division: 'Welterweight', rank }],
    lastFight: '2026-08-01',
    history,
    verifiedMeetings: titleResults.map((result, index) => titleMeeting(`202${5 - index}-01-01`, result, `${id}-title-${index}`)),
    meetingCoverage: { source: 'UFCStats', verified: true, checkedAt: '2026-09-14T00:00:00Z' },
    historyModelVersion: 2
  };
}

const ctx = { asOf: '2026-09-14T00:00:00Z', event: null, locks: [], overrides: {} };
const legacy = fighter('legacy-champion', { latest: 'L', titleResults: ['W', 'W', 'L', 'W'], experience: 12 });
const ordinary = fighter('ordinary-veteran', { latest: 'W', titleResults: [], experience: 11 });
const challenger = fighter('former-challenger', { latest: 'L', titleResults: ['L'], experience: 10 });
const ranked = fighter('ranked-contender', { rank: 9, latest: 'W', titleResults: [], experience: 8 });

assert.deepEqual(E.titleExperience(legacy), { appearances: 4, wins: 3, latest: '2025-01-01' });
assert.equal(E.careerLane(legacy, ctx), 'championship-legacy');
assert.equal(E.careerLane(challenger, ctx), 'title-experienced');
assert.equal(E.careerLane(ordinary, ctx), 'standard-unranked');
assert(E.tags(legacy, ctx).includes('FORMER CHAMP'), 'Verified UFC title wins must identify former champions without a dead manual flag.');
assert(E.tags(legacy, ctx).includes('CHAMPIONSHIP LEGACY'));

const blocked = E.evaluate(legacy, ordinary, ctx);
assert.equal(blocked.eligible, false, 'An unranked championship-legacy fighter must not be auto-matched to a generic unranked veteran.');
assert.match(blocked.reason, /championship-legacy career lane/i);
assert.equal(E.evaluate(ordinary, legacy, ctx).eligible, false, 'Career-lane protection must be symmetric.');
assert(E.evaluate(legacy, challenger, ctx).eligible, 'A title-experienced unranked opponent remains in the plausible legacy matchmaking pool.');
assert(E.evaluate(legacy, ranked, ctx).eligible, 'A ranked opponent remains in the plausible legacy matchmaking pool.');
assert(E.evaluate(legacy, ordinary, ctx, true).eligible, 'Manual matchmaking must retain the ability to force an unusual promotional booking.');

const data = JSON.parse(fs.readFileSync('assets/data/matchmaker/current.json', 'utf8'));
const conor = data.fighters.find(fighter => E.normalize(fighter.name) === 'conormcgregor');
const salikhov = data.fighters.find(fighter => E.normalize(fighter.name) === 'muslimsalikhov');
assert(conor, 'Production Matchmaker data must contain Conor McGregor for the career-lane regression.');
assert(salikhov, 'Production Matchmaker data must contain Muslim Salikhov for the career-lane regression.');

const liveCtx = { asOf: data.generatedAt, event: null, locks: [], overrides: {} };
assert(E.titleExperience(conor).wins >= 2 || E.titleExperience(conor).appearances >= 3, 'McGregor must resolve from verified UFCStats title history as championship-legacy.');
assert.equal(E.careerLane(conor, liveCtx), 'championship-legacy');
assert.equal(E.titleExperience(salikhov).appearances, 0, 'Salikhov must remain a standard non-title-history veteran in verified UFC history.');
assert.equal(E.careerLane(salikhov, liveCtx), 'standard-unranked');

const livePair = E.evaluatePair({ ...conor, booking: null }, { ...salikhov, booking: null }, liveCtx, false, true);
assert.equal(livePair.eligible, false, 'Conor McGregor vs Muslim Salikhov must never survive automatic Matchmaker eligibility.');
assert.match(livePair.reason, /championship-legacy career lane/i, 'The McGregor-Salikhov rejection must come from the general career-lane rule.');

console.log(`Championship career lanes passed: McGregor ${E.titleExperience(conor).wins} title wins / ${E.titleExperience(conor).appearances} title bouts; Salikhov ${E.titleExperience(salikhov).appearances} title bouts. Automatic pairing rejected.`);
