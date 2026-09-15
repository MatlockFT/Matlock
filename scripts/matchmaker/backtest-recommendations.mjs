import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');
const P = require('../../assets/matchmaker-public.js');

const DATA_PATH = 'assets/data/matchmaker/current.json';
const REPORT_PATH = 'assets/data/matchmaker/backtest-report.json';
const DAY = 86400000;
const DEFAULT_LOOKBACK_DAYS = 730;
const DEFAULT_MAX_CASES = 120;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const lookbackDays = Math.max(90, Number(argument('--lookback-days', DEFAULT_LOOKBACK_DAYS)) || DEFAULT_LOOKBACK_DAYS);
const maxCases = Math.max(10, Number(argument('--max-cases', DEFAULT_MAX_CASES)) || DEFAULT_MAX_CASES);
const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const generatedDay = String(data.generatedAt || '').slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(generatedDay)) throw new Error('Backtest requires a valid Matchmaker generatedAt timestamp.');

const currentIndex = new Map(data.fighters.map(fighter => [fighter.id, fighter]));
const knownDivisions = [...new Set([
  ...(data.rankingsCurrent || []).map(item => item.division),
  ...data.fighters.map(fighter => fighter.division)
].filter(Boolean))].sort((a, b) => String(b).length - String(a).length || String(a).localeCompare(String(b)));

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function dayDiff(later, earlier) {
  const a = Date.parse(later), b = Date.parse(earlier);
  return Number.isFinite(a) && Number.isFinite(b) ? (a - b) / DAY : Infinity;
}

function divisionFromWeightClass(weightClass) {
  const source = normalize(weightClass);
  if (!source) return null;
  return knownDivisions.find(division => source.includes(normalize(division))) || null;
}

function historicalDivision(fighter, cutoff) {
  const meetings = [...(fighter.verifiedMeetings || [])]
    .filter(meeting => meeting.date && meeting.date <= cutoff && ['ufc', 'tuf', 'road-to-ufc'].includes(meeting.competitionClass))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const meeting of meetings) {
    const inferred = divisionFromWeightClass(meeting.weightClass);
    if (inferred) return inferred;
  }
  const history = [...(fighter.history || [])]
    .filter(bout => bout.date && bout.date <= cutoff)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const bout of history) {
    const inferred = divisionFromWeightClass(bout.weightClass);
    if (inferred) return inferred;
  }
  return null;
}

function reconstructRecord(history) {
  const counts = { W: 0, L: 0, D: 0 };
  for (const bout of history) if (Object.hasOwn(counts, bout.result)) counts[bout.result]++;
  return `${counts.W}-${counts.L}-${counts.D}`;
}

function freezeFighter(fighter, cutoff) {
  if (!fighter?.id || fighter.meetingCoverage?.verified !== true) return null;
  const history = [...(fighter.history || [])]
    .filter(bout => bout.date && bout.date <= cutoff)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!history.length) return null;
  const verifiedMeetings = [...(fighter.verifiedMeetings || [])]
    .filter(meeting => meeting.date && meeting.date <= cutoff)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const division = historicalDivision(fighter, cutoff);
  if (!division) return null;
  const lastFight = history[0]?.date || null;
  const active = Boolean(lastFight && dayDiff(cutoff, lastFight) <= 730);
  return {
    ...fighter,
    active,
    division,
    rank: null,
    rankings: [],
    booking: null,
    formerChampion: false,
    interim: false,
    history,
    verifiedMeetings,
    lastFight,
    record: reconstructRecord(history),
    meetingCoverage: { ...(fighter.meetingCoverage || {}), verified: true }
  };
}

function linkedOpponentId(fighter, bout) {
  const direct = (bout?.opponentIds || []).find(id => currentIndex.has(id));
  if (direct) return direct;
  const meeting = (fighter.verifiedMeetings || []).find(item =>
    item.date === bout?.date && item.result === bout?.result && item.opponentId && currentIndex.has(item.opponentId)
  );
  return meeting?.opponentId || null;
}

function candidateCases() {
  const cases = [];
  const oldestAllowed = new Date(Date.parse(generatedDay) - lookbackDays * DAY).toISOString().slice(0, 10);
  for (const fighter of data.fighters) {
    if (fighter.meetingCoverage?.verified !== true) continue;
    const history = [...(fighter.history || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (history.length < 2) continue;
    const target = history[0];
    const cutoffBout = history[1];
    if (!target?.date || !cutoffBout?.date || target.date <= cutoffBout.date || cutoffBout.date < oldestAllowed) continue;
    const actualOpponentId = linkedOpponentId(fighter, target);
    if (!actualOpponentId) continue;
    const subject = freezeFighter(fighter, cutoffBout.date);
    if (!subject) continue;
    cases.push({
      fighterId: fighter.id,
      fighterName: fighter.name,
      cutoff: cutoffBout.date,
      targetDate: target.date,
      actualOpponentId,
      division: subject.division
    });
  }
  return cases.sort((a, b) => b.cutoff.localeCompare(a.cutoff) || a.fighterId.localeCompare(b.fighterId));
}

function balancedSample(cases, limit) {
  if (cases.length <= limit) return cases;
  const groups = new Map();
  for (const item of cases) {
    const list = groups.get(item.division) || [];
    list.push(item);
    groups.set(item.division, list);
  }
  const divisions = [...groups.keys()].sort();
  const sampled = [];
  let cursor = 0;
  while (sampled.length < limit && divisions.length) {
    const division = divisions[cursor % divisions.length];
    const list = groups.get(division);
    if (list?.length) sampled.push(list.shift());
    if (!list?.length) divisions.splice(cursor % divisions.length, 1);
    else cursor++;
  }
  return sampled;
}

function bump(object, key) {
  object[key] = (object[key] || 0) + 1;
}

function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}

const availableCases = candidateCases();
const cases = balancedSample(availableCases, maxCases);
const missReasons = {};
const byDivision = {};
const examples = [];
let evaluatedCases = 0;
let eligibleTargetCases = 0;
let engineTop1 = 0, engineTop3 = 0, engineTop8 = 0, publicTop3 = 0;
let targetMissingFromFrozenRoster = 0;
let targetUnavailableAtCutoff = 0;
let targetIneligible = 0;

for (const item of cases) {
  const frozen = data.fighters.map(fighter => freezeFighter(fighter, item.cutoff)).filter(Boolean);
  const roster = frozen.filter(fighter => normalize(fighter.division) === normalize(item.division));
  const index = new Map(roster.map(fighter => [fighter.id, fighter]));
  const subject = index.get(item.fighterId);
  const actual = index.get(item.actualOpponentId);
  const divisionStats = byDivision[item.division] || (byDivision[item.division] = { sampled: 0, evaluated: 0, eligibleTarget: 0, engineTop1: 0, engineTop3: 0, publicTop3: 0 });
  divisionStats.sampled++;

  if (!subject || !actual) {
    targetMissingFromFrozenRoster++;
    bump(missReasons, 'target-missing-from-frozen-roster');
    continue;
  }

  const ctx = {
    asOf: `${item.cutoff}T23:59:59Z`,
    event: { id: `historical-${item.cutoff}`, date: item.cutoff, bouts: [] },
    locks: [],
    overrides: {},
    fighterIndex: index
  };

  if (E.availability(actual, ctx)) {
    targetUnavailableAtCutoff++;
    bump(missReasons, 'actual-opponent-unavailable-under-temporal-rules');
  }

  const actualPair = E.evaluatePair(subject, actual, ctx, false, true);
  const candidates = E.candidates(subject, roster, ctx).filter(recommendation => recommendation.publishable);
  const engineRank = candidates.findIndex(recommendation => recommendation.fighter.id === actual.id);
  const publicPool = candidates.filter(P.hasSpecificCase).slice(0, P.PUBLIC_CANDIDATE_POOL);
  const publicRecommendations = P.filterRecommendations(subject, publicPool, E, ctx);
  const publicRank = publicRecommendations.findIndex(recommendation => recommendation.fighter.id === actual.id);

  evaluatedCases++;
  divisionStats.evaluated++;
  if (actualPair.eligible && actualPair.publishable) {
    eligibleTargetCases++;
    divisionStats.eligibleTarget++;
  } else {
    targetIneligible++;
    bump(missReasons, actualPair.reason || 'actual-opponent-ineligible');
  }

  if (engineRank === 0) { engineTop1++; divisionStats.engineTop1++; }
  if (engineRank >= 0 && engineRank < 3) { engineTop3++; divisionStats.engineTop3++; }
  if (engineRank >= 0 && engineRank < 8) engineTop8++;
  if (publicRank >= 0 && publicRank < 3) { publicTop3++; divisionStats.publicTop3++; }

  if ((engineRank < 0 || engineRank >= 3 || publicRank < 0) && examples.length < 30) {
    examples.push({
      cutoff: item.cutoff,
      targetDate: item.targetDate,
      division: item.division,
      fighter: item.fighterName,
      actualOpponent: actual.name,
      targetEligible: Boolean(actualPair.eligible && actualPair.publishable),
      targetReason: actualPair.reason || actualPair.case?.label || null,
      engineRank: engineRank >= 0 ? engineRank + 1 : null,
      publicRank: publicRank >= 0 ? publicRank + 1 : null,
      engineTopThree: candidates.slice(0, 3).map(recommendation => ({
        opponent: recommendation.fighter.name,
        score: recommendation.score,
        rankingScore: recommendation.rankingScore,
        case: recommendation.case?.code || null
      })),
      publicTopThree: publicRecommendations.map(recommendation => ({
        opponent: recommendation.fighter.name,
        score: recommendation.score,
        rankingScore: recommendation.rankingScore,
        case: recommendation.case?.code || null
      }))
    });
  }
}

for (const stats of Object.values(byDivision)) {
  stats.engineTop1Rate = rate(stats.engineTop1, stats.evaluated);
  stats.engineTop3Rate = rate(stats.engineTop3, stats.evaluated);
  stats.publicTop3Rate = rate(stats.publicTop3, stats.evaluated);
}

const report = {
  schemaVersion: 1,
  generatedAt: data.generatedAt,
  engineVersion: E.VERSION,
  mode: 'temporal-unranked-v1',
  lookbackDays,
  maxCases,
  availableCases: availableCases.length,
  sampledCases: cases.length,
  evaluatedCases,
  eligibleTargetCases,
  coverage: {
    targetMissingFromFrozenRoster,
    targetUnavailableAtCutoff,
    targetIneligible
  },
  metrics: {
    overall: {
      engineTop1Hits: engineTop1,
      engineTop1Rate: rate(engineTop1, evaluatedCases),
      engineTop3Hits: engineTop3,
      engineTop3Rate: rate(engineTop3, evaluatedCases),
      engineTop8Hits: engineTop8,
      engineTop8Rate: rate(engineTop8, evaluatedCases),
      publicTop3Hits: publicTop3,
      publicTop3Rate: rate(publicTop3, evaluatedCases)
    },
    conditionalOnEligibleTarget: {
      denominator: eligibleTargetCases,
      engineTop1Rate: rate(engineTop1, eligibleTargetCases),
      engineTop3Rate: rate(engineTop3, eligibleTargetCases),
      engineTop8Rate: rate(engineTop8, eligibleTargetCases),
      publicTop3Rate: rate(publicTop3, eligibleTargetCases)
    }
  },
  byDivision,
  missReasons: Object.fromEntries(Object.entries(missReasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
  examples,
  leakageControls: [
    'Each fighter history and verified meeting ledger is truncated at the case cutoff date.',
    'Current rankings, ranking arrays, bookings, active-roster flags, former-champion flags and interim-champion flags are removed before scoring.',
    'Historical division is inferred only from source-native fight weight classes known by the cutoff date; current division is not used as a fallback.',
    'Active status is reconstructed only from whether the fighter had verified UFC history and had fought within the preceding two years.'
  ],
  limitations: [
    'Historical UFC ranking snapshots are not yet stored, so this baseline intentionally evaluates the engine with rankings stripped rather than leaking present-day rankings backward.',
    'The candidate universe is survivor-biased to fighters present in the current Matchmaker dataset; former UFC fighters absent from the current dataset cannot be reconstructed.',
    'The backtest uses each fighter\'s most recent completed next-fight pair inside the lookback window, not every historical UFC booking.',
    'A UFC booking is not automatically ground truth for quality. The report measures booking resemblance and exposes misses for review; it must not be used as an optimization target by itself.'
  ]
};

await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(`Matchmaker temporal backtest: ${evaluatedCases}/${cases.length} sampled cases evaluated from ${availableCases.length} available recent cases.`);
console.log(`Engine Top 1 ${engineTop1}/${evaluatedCases || 0} (${(report.metrics.overall.engineTop1Rate * 100).toFixed(1)}%), Top 3 ${engineTop3}/${evaluatedCases || 0} (${(report.metrics.overall.engineTop3Rate * 100).toFixed(1)}%), Top 8 ${engineTop8}/${evaluatedCases || 0} (${(report.metrics.overall.engineTop8Rate * 100).toFixed(1)}%); public Top 3 ${publicTop3}/${evaluatedCases || 0} (${(report.metrics.overall.publicTop3Rate * 100).toFixed(1)}%).`);
console.log(`Leakage-safe baseline strips historical rankings/current bookings/current roster state. Eligible actual targets: ${eligibleTargetCases}/${evaluatedCases || 0}.`);
