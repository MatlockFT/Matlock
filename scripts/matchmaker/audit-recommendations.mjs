import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');
const DATA_PATH = 'assets/data/matchmaker/current.json';
const REPORT_PATH = 'assets/data/matchmaker/recommendation-audit.json';
const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const index = new Map(data.fighters.map(fighter => [fighter.id, fighter]));
const caseCounts = new Map();
const confidenceCounts = new Map();
const slotCounts = new Map([[0, 0], [1, 0], [2, 0], [3, 0]]);
const genericExamples = [];
const asymmetricExamples = [];
let subjects = 0, published = 0, sameCard = 0, asymmetric = 0, genericPublished = 0;
let scheduleCoverageTotal = 0, scheduleCoverageSubjects = 0;

function bump(map, key) { map.set(key, (map.get(key) || 0) + 1); }
function eventParticipants(event) { return [...new Set((event.bouts || []).flatMap(bout => (bout.fighters || []).map(fighter => fighter.id)))]; }

for (const event of data.events || []) {
  const eventIds = new Set(eventParticipants(event));
  const ctx = { asOf: data.generatedAt, event, locks: [], overrides: {}, fighterIndex: index };
  for (const fighterId of eventIds) {
    const fighter = index.get(fighterId);
    if (!fighter || fighter.meetingCoverage?.verified !== true) continue;
    subjects++;
    const state = E.competitiveState(fighter, ctx);
    scheduleCoverageTotal += state.schedule?.coverage || 0;
    scheduleCoverageSubjects++;
    const recs = E.recommendations(fighter, data.fighters, ctx);
    bump(slotCounts, recs.length);
    published += recs.length;

    for (const rec of recs) {
      bump(caseCounts, rec.case?.code || 'missing');
      bump(confidenceCounts, rec.confidence || 'missing');
      if (eventIds.has(rec.fighter.id)) sameCard++;
      if (rec.case?.code === 'divisional-sorting') {
        genericPublished++;
        if (genericExamples.length < 20) genericExamples.push({ event: event.title, fighter: fighter.name, opponent: rec.fighter.name, score: rec.score, rationale: rec.rationale });
      }

      const reverse = E.recommendations(rec.fighter, data.fighters, ctx);
      const reverseRank = reverse.findIndex(item => item.fighter.id === fighter.id);
      if (reverseRank === -1) {
        asymmetric++;
        if (asymmetricExamples.length < 25) asymmetricExamples.push({
          event: event.title,
          fighter: fighter.name,
          opponent: rec.fighter.name,
          pairScore: rec.score,
          case: rec.case?.code || null,
          fighterRank: rec.label,
          opponentTopThree: reverse.map(item => ({ opponent: item.fighter.name, score: item.score, case: item.case?.code || null }))
        });
      }
    }
  }
}

const report = {
  generatedAt: data.generatedAt,
  engineVersion: E.VERSION,
  subjects,
  publishedRecommendations: published,
  recommendationSlots: Object.fromEntries([...slotCounts].sort((a, b) => a[0] - b[0])),
  caseCounts: Object.fromEntries([...caseCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  confidenceCounts: Object.fromEntries([...confidenceCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  averageRecentOpponentLinkCoverage: scheduleCoverageSubjects ? Number((scheduleCoverageTotal / scheduleCoverageSubjects).toFixed(4)) : 0,
  sameCardRecommendations: sameCard,
  sameCardRecommendationRatio: published ? Number((sameCard / published).toFixed(4)) : 0,
  asymmetricTopThreeRecommendations: asymmetric,
  asymmetricTopThreeRatio: published ? Number((asymmetric / published).toFixed(4)) : 0,
  genericDivisionalSortingRecommendations: genericPublished,
  genericExamples,
  asymmetricExamples,
  note: 'Top-three asymmetry is diagnostic, not automatically an error: one symmetric fight score can rank fourth or lower for the other fighter because that fighter has stronger alternatives.'
};

await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(`Matchmaker recommendation audit: ${subjects} event fighters, ${published} published recommendations.`);
console.log(`Slots: ${[0,1,2,3].map(slot => `${slot}=${slotCounts.get(slot) || 0}`).join(', ')}. Cases: ${[...caseCounts].sort((a,b)=>b[1]-a[1]).map(([name,count])=>`${name}=${count}`).join(', ') || 'none'}.`);
console.log(`Confidence: ${[...confidenceCounts].map(([name,count])=>`${name}=${count}`).join(', ') || 'none'}; same-card ${sameCard}/${published || 0}; asymmetric Top 3 ${asymmetric}/${published || 0}; recent-opponent link coverage ${(report.averageRecentOpponentLinkCoverage * 100).toFixed(1)}%.`);
if (genericPublished) throw new Error(`${genericPublished} public recommendation(s) still rely on the generic divisional-sorting fallback. Public matchups require a specific matchmaking thesis.`);
