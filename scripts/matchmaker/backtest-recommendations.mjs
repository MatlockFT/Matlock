import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');
const P = require('../../assets/matchmaker-public.js');

const DATA_PATH = 'assets/data/matchmaker/current.json';
const REPORT_PATH = 'assets/data/matchmaker/backtest-report.json';
const RANKING_DIR = 'assets/data/matchmaker/rankings';
const DAY = 86400000;
const DEFAULT_LOOKBACK_DAYS = 730;
const DEFAULT_MAX_CASES = 120;
const DEFAULT_MAX_RANKING_SNAPSHOT_AGE_DAYS = 14;

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const lookbackDays = Math.max(90, Number(argument('--lookback-days', DEFAULT_LOOKBACK_DAYS)) || DEFAULT_LOOKBACK_DAYS);
const maxCases = Math.max(10, Number(argument('--max-cases', DEFAULT_MAX_CASES)) || DEFAULT_MAX_CASES);
const maxRankingSnapshotAgeDays = Math.max(0, Number(argument('--max-ranking-snapshot-age-days', DEFAULT_MAX_RANKING_SNAPSHOT_AGE_DAYS)) || DEFAULT_MAX_RANKING_SNAPSHOT_AGE_DAYS);
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

async function loadRankingSnapshots() {
  let entries = [];
  try {
    entries = await fs.readdir(RANKING_DIR, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const snapshots = [];
  for (const entry of entries) {
    const match = entry.isFile() && entry.name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) continue;
    try {
      const raw = JSON.parse(await fs.readFile(`${RANKING_DIR}/${entry.name}`, 'utf8'));
      const payload = typeof raw?.content === 'string' ? JSON.parse(raw.content) : raw;
      if (!Array.isArray(payload?.rankings)) continue;
      snapshots.push({
        date: match[1],
        capturedAt: payload.capturedAt || `${match[1]}T00:00:00Z`,
        rankings: payload.rankings
      });
    } catch (error) {
      console.warn(`Skipping unreadable ranking snapshot ${entry.name}: ${error.message}`);
    }
  }
  return snapshots.sort((a, b) => a.date.localeCompare(b.date));
}

const rankingSnapshots = await loadRankingSnapshots();

function rankingSnapshotForCutoff(cutoff) {
  for (let i = rankingSnapshots.length - 1; i >= 0; i--) {
    const snapshot = rankingSnapshots[i];
    if (snapshot.date > cutoff) continue;
    const ageDays = dayDiff(cutoff, snapshot.date);
    if (ageDays <= maxRankingSnapshotAgeDays) return { ...snapshot, ageDays };
    break;
  }
  return null;
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

function snapshotRanking(fighter, division, snapshot) {
  if (!snapshot) return null;
  const byId = snapshot.rankings.find(item => item.id === fighter.id && normalize(item.division) === normalize(division));
  const byName = byId || snapshot.rankings.find(item => normalize(item.name) === normalize(fighter.name) && normalize(item.division) === normalize(division));
  if (!byName || !Number.isFinite(Number(byName.rank))) return null;
  return {
    division,
    rank: Number(byName.rank),
    interim: Boolean(byName.interim)
  };
}

function freezeFighterResult(fighter, cutoff, snapshot = null) {
  if (!fighter?.id) return { fighter: null, reason: 'missing-fighter-id' };
  if (fighter.meetingCoverage?.verified !== true) return { fighter: null, reason: 'unverified-fight-history' };
  const history = [...(fighter.history || [])]
    .filter(bout => bout.date && bout.date <= cutoff)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!history.length) return { fighter: null, reason: 'no-pre-cutoff-ufc-history' };
  const verifiedMeetings = [...(fighter.verifiedMeetings || [])]
    .filter(meeting => meeting.date && meeting.date <= cutoff)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const division = historicalDivision(fighter, cutoff);
  if (!division) return { fighter: null, reason: 'no-historical-division' };
  const lastFight = history[0]?.date || null;
  const active = Boolean(lastFight && dayDiff(cutoff, lastFight) <= 730);
  const historicalRanking = snapshotRanking(fighter, division, snapshot);
  return {
    fighter: {
      ...fighter,
      active,
      division,
      rank: historicalRanking?.rank ?? null,
      rankings: historicalRanking ? [{ division, rank: historicalRanking.rank }] : [],
      booking: null,
      formerChampion: false,
      interim: historicalRanking?.interim || false,
      history,
      verifiedMeetings,
      lastFight,
      record: reconstructRecord(history),
      meetingCoverage: { ...(fighter.meetingCoverage || {}), verified: true }
    },
    reason: null
  };
}

function freezeFighter(fighter, cutoff, snapshot = null) {
  return freezeFighterResult(fighter, cutoff, snapshot).fighter;
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

function emptyHitStats() {
  return { evaluated: 0, eligibleTarget: 0, engineTop1: 0, engineTop3: 0, engineTop8: 0, publicTop3: 0 };
}

function finalizeHitStats(stats) {
  return {
    ...stats,
    engineTop1Rate: rate(stats.engineTop1, stats.evaluated),
    engineTop3Rate: rate(stats.engineTop3, stats.evaluated),
    engineTop8Rate: rate(stats.engineTop8, stats.evaluated),
    publicTop3Rate: rate(stats.publicTop3, stats.evaluated)
  };
}

const availableCases = candidateCases();
const cases = balancedSample(availableCases, maxCases);
const missReasons = {};
const missingTargetReasons = {};
const byDivision = {};
const examples = [];
const snapshotStats = {
  snapshotBacked: emptyHitStats(),
  unranked: emptyHitStats()
};
let evaluatedCases = 0;
let eligibleTargetCases = 0;
let engineTop1 = 0, engineTop3 = 0, engineTop8 = 0, publicTop3 = 0;
let targetMissingFromFrozenRoster = 0;
let targetUnavailableAtCutoff = 0;
let targetIneligible = 0;
let casesWithRankingSnapshot = 0;
let casesWithoutRankingSnapshot = 0;

for (const item of cases) {
  const snapshot = rankingSnapshotForCutoff(item.cutoff);
  if (snapshot) casesWithRankingSnapshot++;
  else casesWithoutRankingSnapshot++;
  const subset = snapshot ? snapshotStats.snapshotBacked : snapshotStats.unranked;

  const frozenResults = data.fighters.map(fighter => ({ source: fighter, ...freezeFighterResult(fighter, item.cutoff, snapshot) }));
  const frozen = frozenResults.filter(result => result.fighter).map(result => result.fighter);
  const allFrozenIndex = new Map(frozen.map(fighter => [fighter.id, fighter]));
  const roster = frozen.filter(fighter => normalize(fighter.division) === normalize(item.division));
  const index = new Map(roster.map(fighter => [fighter.id, fighter]));
  const subject = index.get(item.fighterId);
  const actual = index.get(item.actualOpponentId);
  const divisionStats = byDivision[item.division] || (byDivision[item.division] = { sampled: 0, evaluated: 0, eligibleTarget: 0, engineTop1: 0, engineTop3: 0, engineTop8: 0, publicTop3: 0 });
  divisionStats.sampled++;

  if (!subject || !actual) {
    targetMissingFromFrozenRoster++;
    let reason = 'target-missing-from-frozen-roster';
    if (!subject) {
      const result = frozenResults.find(entry => entry.source.id === item.fighterId);
      reason = `subject-${result?.reason || 'missing-from-frozen-roster'}`;
    } else if (!allFrozenIndex.has(item.actualOpponentId)) {
      const result = frozenResults.find(entry => entry.source.id === item.actualOpponentId);
      reason = result?.reason || 'actual-opponent-missing-from-frozen-roster';
    } else {
      const frozenActual = allFrozenIndex.get(item.actualOpponentId);
      reason = `actual-opponent-division-mismatch:${frozenActual?.division || 'unknown'}`;
    }
    bump(missingTargetReasons, reason);
    bump(missReasons, reason);
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
  subset.evaluated++;
  divisionStats.evaluated++;
  if (actualPair.eligible && actualPair.publishable) {
    eligibleTargetCases++;
    subset.eligibleTarget++;
    divisionStats.eligibleTarget++;
  } else {
    targetIneligible++;
    bump(missReasons, actualPair.reason || 'actual-opponent-ineligible');
  }

  if (engineRank === 0) {
    engineTop1++;
    subset.engineTop1++;
    divisionStats.engineTop1++;
  }
  if (engineRank >= 0 && engineRank < 3) {
    engineTop3++;
    subset.engineTop3++;
    divisionStats.engineTop3++;
  }
  if (engineRank >= 0 && engineRank < 8) {
    engineTop8++;
    subset.engineTop8++;
    divisionStats.engineTop8++;
  }
  if (publicRank >= 0 && publicRank < 3) {
    publicTop3++;
    subset.publicTop3++;
    divisionStats.publicTop3++;
  }

  if ((engineRank < 0 || engineRank >= 3 || publicRank < 0) && examples.length < 30) {
    examples.push({
      cutoff: item.cutoff,
      targetDate: item.targetDate,
      division: item.division,
      rankingSnapshotDate: snapshot?.date || null,
      rankingSnapshotAgeDays: snapshot?.ageDays ?? null,
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
  stats.engineTop8Rate = rate(stats.engineTop8, stats.evaluated);
  stats.publicTop3Rate = rate(stats.publicTop3, stats.evaluated);
}

const report = {
  schemaVersion: 2,
  generatedAt: data.generatedAt,
  engineVersion: E.VERSION,
  mode: 'temporal-hybrid-v2',
  lookbackDays,
  maxCases,
  availableCases: availableCases.length,
  sampledCases: cases.length,
  evaluatedCases,
  eligibleTargetCases,
  rankingSnapshotCoverage: {
    archiveStart: rankingSnapshots[0]?.date || null,
    archiveEnd: rankingSnapshots.at(-1)?.date || null,
    snapshotsAvailable: rankingSnapshots.length,
    maxSnapshotAgeDays: maxRankingSnapshotAgeDays,
    sampledCasesWithSnapshot: casesWithRankingSnapshot,
    sampledCasesWithoutSnapshot: casesWithoutRankingSnapshot,
    snapshotBackedMetrics: finalizeHitStats(snapshotStats.snapshotBacked),
    unrankedMetrics: finalizeHitStats(snapshotStats.unranked)
  },
  coverage: {
    targetMissingFromFrozenRoster,
    missingTargetReasons: Object.fromEntries(Object.entries(missingTargetReasons).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
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
    `A dated UFC ranking snapshot is used only when its snapshot date is on or before the case cutoff and no more than ${maxRankingSnapshotAgeDays} days old. Cases without a qualifying snapshot are evaluated unranked rather than using present-day rankings.`,
    'Current bookings, active-roster flags, former-champion flags and current interim-champion flags are removed before scoring; interim status is restored only when present in the qualifying historical ranking snapshot.',
    'Historical division is inferred only from source-native fight weight classes known by the cutoff date; current division is not used as a fallback.',
    'Active status is reconstructed only from whether the fighter had verified UFC history and had fought within the preceding two years.'
  ],
  limitations: [
    `The ranking snapshot archive currently spans ${rankingSnapshots[0]?.date || 'no snapshots'} through ${rankingSnapshots.at(-1)?.date || 'no snapshots'}. Earlier cases remain intentionally unranked until contemporaneous snapshots exist; current rankings are never backfilled into them.`,
    'The candidate universe is survivor-biased to fighters present in the current Matchmaker dataset; former UFC fighters absent from the current dataset cannot be reconstructed.',
    'The backtest uses each fighter\'s most recent completed next-fight pair inside the lookback window, not every historical UFC booking.',
    'A UFC booking is not automatically ground truth for quality. The report measures booking resemblance and exposes misses for review; it must not be used as an optimization target by itself.'
  ]
};

await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
console.log(`Matchmaker temporal backtest: ${evaluatedCases}/${cases.length} sampled cases evaluated from ${availableCases.length} available recent cases.`);
console.log(`Engine Top 1 ${engineTop1}/${evaluatedCases || 0} (${(report.metrics.overall.engineTop1Rate * 100).toFixed(1)}%), Top 3 ${engineTop3}/${evaluatedCases || 0} (${(report.metrics.overall.engineTop3Rate * 100).toFixed(1)}%), Top 8 ${engineTop8}/${evaluatedCases || 0} (${(report.metrics.overall.engineTop8Rate * 100).toFixed(1)}%); public Top 3 ${publicTop3}/${evaluatedCases || 0} (${(report.metrics.overall.publicTop3Rate * 100).toFixed(1)}%).`);
console.log(`Ranking snapshots: ${casesWithRankingSnapshot}/${cases.length} sampled cases backed by a <=${maxRankingSnapshotAgeDays}-day pre-cutoff snapshot; archive ${rankingSnapshots[0]?.date || 'empty'} to ${rankingSnapshots.at(-1)?.date || 'empty'}.`);
console.log(`Eligible actual targets: ${eligibleTargetCases}/${evaluatedCases || 0}; missing target reasons: ${Object.entries(missingTargetReasons).map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none'}.`);
