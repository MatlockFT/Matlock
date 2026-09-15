import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');
const P = require('../../assets/matchmaker-public.js');

const DATA_PATH = 'assets/data/matchmaker/current.json';
const UNIVERSE_PATH = 'assets/data/matchmaker/historical-universe.json';
const REPORT_PATH = 'assets/data/matchmaker/backtest-report.json';
const RANKING_DIR = 'assets/data/matchmaker/rankings';
const STATE_DIR = 'assets/data/matchmaker/state';
const DAY = 86400000;
const DEFAULT_LOOKBACK_DAYS = 730;
const DEFAULT_MAX_CASES = 120;
const DEFAULT_MAX_RANKING_SNAPSHOT_AGE_DAYS = 14;
const DEFAULT_MAX_STATE_SNAPSHOT_AGE_DAYS = 7;
const STANDARD_CLASSES = new Set(['ufc', 'tuf', 'road-to-ufc']);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] !== undefined ? process.argv[index + 1] : fallback;
}

const lookbackDays = Math.max(90, Number(argument('--lookback-days', DEFAULT_LOOKBACK_DAYS)) || DEFAULT_LOOKBACK_DAYS);
const maxCases = Math.max(10, Number(argument('--max-cases', DEFAULT_MAX_CASES)) || DEFAULT_MAX_CASES);
const maxRankingSnapshotAgeDays = Math.max(0, Number(argument('--max-ranking-snapshot-age-days', DEFAULT_MAX_RANKING_SNAPSHOT_AGE_DAYS)) || DEFAULT_MAX_RANKING_SNAPSHOT_AGE_DAYS);
const maxStateSnapshotAgeDays = Math.max(0, Number(argument('--max-state-snapshot-age-days', DEFAULT_MAX_STATE_SNAPSHOT_AGE_DAYS)) || DEFAULT_MAX_STATE_SNAPSHOT_AGE_DAYS);

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const universe = JSON.parse(await fs.readFile(UNIVERSE_PATH, 'utf8'));
if (universe?.schemaVersion !== 1 || !Array.isArray(universe.fighters)) throw new Error('Historical universe is missing or incompatible.');
const generatedDay = String(data.generatedAt || '').slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(generatedDay)) throw new Error('Backtest requires a valid Matchmaker generatedAt timestamp.');
if (String(universe.generatedAt || '').slice(0, 10) !== generatedDay) throw new Error('Historical universe does not match the current Matchmaker generation date.');

const currentIds = new Set((data.fighters || []).map(fighter => fighter.id));
const allFighters = [...(data.fighters || []), ...universe.fighters.filter(fighter => !currentIds.has(fighter.id))];
const allIndex = new Map(allFighters.map(fighter => [fighter.id, fighter]));
const statsIdToId = new Map(Object.entries(universe.statsIdToCanonicalId || {}));
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
function cutoffInstant(cutoff) {
  return Date.parse(`${cutoff}T23:59:59Z`);
}
function rate(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 0;
}
function bump(object, value) {
  const key = value || 'unknown';
  object[key] = (object[key] || 0) + 1;
}
function sortedCounts(object) {
  return Object.fromEntries(Object.entries(object).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

async function loadDatedSnapshots(directory, payloadKey) {
  let entries = [];
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return []; throw error; }
  const snapshots = [];
  for (const entry of entries) {
    const match = entry.isFile() && entry.name.match(/^(\d{4}-\d{2}-\d{2})\.json$/);
    if (!match) continue;
    try {
      const raw = JSON.parse(await fs.readFile(`${directory}/${entry.name}`, 'utf8'));
      const payload = typeof raw?.content === 'string' ? JSON.parse(raw.content) : raw;
      if (payloadKey && !Array.isArray(payload?.[payloadKey])) continue;
      const capturedAt = payload.capturedAt || `${match[1]}T00:00:00Z`;
      if (!Number.isFinite(Date.parse(capturedAt))) continue;
      snapshots.push({ date: match[1], capturedAt, payload });
    } catch (error) {
      console.warn(`Skipping unreadable temporal snapshot ${entry.name}: ${error.message}`);
    }
  }
  return snapshots.sort((a, b) => a.date.localeCompare(b.date) || a.capturedAt.localeCompare(b.capturedAt));
}

const rankingSnapshots = (await loadDatedSnapshots(RANKING_DIR, 'rankings')).map(snapshot => ({
  date: snapshot.date,
  capturedAt: snapshot.capturedAt,
  rankings: snapshot.payload.rankings
}));
const stateSnapshots = (await loadDatedSnapshots(STATE_DIR, 'fighters')).map(snapshot => ({
  date: snapshot.date,
  capturedAt: snapshot.capturedAt,
  fighterIndex: new Map(snapshot.payload.fighters.filter(item => item?.id).map(item => [item.id, item]))
}));

function snapshotForCutoff(snapshots, cutoff, maxAgeDays) {
  const cutoffMs = cutoffInstant(cutoff);
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const snapshot = snapshots[i];
    const capturedMs = Date.parse(snapshot.capturedAt);
    if (snapshot.date > cutoff || capturedMs > cutoffMs) continue;
    const ageDays = (cutoffMs - capturedMs) / DAY;
    if (ageDays <= maxAgeDays) return { ...snapshot, ageDays: Number(ageDays.toFixed(3)) };
    break;
  }
  return null;
}

const bookingLedger = [];
let bookingLedgerMissingFirstSeen = 0;
for (const booking of Array.isArray(data.bookings) ? data.bookings : []) {
  const firstSeenMs = Date.parse(booking?.firstSeen);
  if (!Array.isArray(booking?.fighters) || !booking.fighters.length || !/^\d{4}-\d{2}-\d{2}$/.test(String(booking?.date || '')) || !Number.isFinite(firstSeenMs)) {
    if (!Number.isFinite(firstSeenMs)) bookingLedgerMissingFirstSeen++;
    continue;
  }
  bookingLedger.push({ ...booking, firstSeenMs });
}
bookingLedger.sort((a, b) => a.firstSeenMs - b.firstSeenMs || String(a.date).localeCompare(String(b.date)));
const bookingByFighter = new Map();
for (const booking of bookingLedger) for (const fighterId of booking.fighters) {
  const list = bookingByFighter.get(fighterId) || [];
  list.push(booking);
  bookingByFighter.set(fighterId, list);
}
const bookingLedgerStart = bookingLedger.length ? new Date(bookingLedger[0].firstSeenMs).toISOString() : null;

function divisionFromWeightClass(weightClass) {
  const source = normalize(weightClass);
  if (!source) return null;
  return knownDivisions.find(division => source.includes(normalize(division))) || null;
}

function historicalDivision(fighter, cutoff) {
  const meetings = [...(fighter.verifiedMeetings || [])]
    .filter(meeting => meeting.date && meeting.date <= cutoff && STANDARD_CLASSES.has(meeting.competitionClass || 'ufc'))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const meeting of meetings) {
    const division = divisionFromWeightClass(meeting.weightClass);
    if (division) return division;
  }
  const history = [...(fighter.history || [])]
    .filter(bout => bout.date && bout.date <= cutoff)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const bout of history) {
    const division = divisionFromWeightClass(bout.weightClass);
    if (division) return division;
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
  return { division, rank: Number(byName.rank), interim: Boolean(byName.interim) };
}

function compactBooking(booking, fighterId, evidence) {
  if (!booking) return null;
  const opponentId = Array.isArray(booking.fighters) ? booking.fighters.find(id => id !== fighterId) || null : booking.opponentId || null;
  return {
    event: booking.event || 'UFC booking',
    date: booking.date,
    source: booking.source || null,
    ...(booking.firstSeen ? { firstSeen: booking.firstSeen } : {}),
    ...(opponentId ? { opponentId, opponent: allIndex.get(opponentId)?.name || booking.opponent || null } : {}),
    evidence
  };
}

function historicalBooking(fighterId, cutoff, stateSnapshot = null) {
  if (!currentIds.has(fighterId)) return null;
  const cutoffMs = cutoffInstant(cutoff);
  const candidates = [];
  for (const booking of bookingByFighter.get(fighterId) || []) {
    if (booking.firstSeenMs <= cutoffMs && booking.date > cutoff) candidates.push(compactBooking(booking, fighterId, 'first-seen-ledger'));
  }
  const stateEntry = stateSnapshot?.fighterIndex?.get(fighterId);
  if (stateEntry?.booking?.date > cutoff) candidates.push(compactBooking(stateEntry.booking, fighterId, 'daily-state-snapshot'));
  candidates.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.firstSeen || '').localeCompare(String(b.firstSeen || '')));
  return candidates[0] || null;
}

function hasStandardUfcBout(fighter, cutoff) {
  return (fighter.verifiedMeetings || fighter.history || []).some(bout => bout.date && bout.date <= cutoff && (bout.competitionClass || 'ufc') === 'ufc');
}

function historicalActive(fighter, cutoff, stateSnapshot = null) {
  const stateEntry = currentIds.has(fighter.id) ? stateSnapshot?.fighterIndex?.get(fighter.id) : null;
  if (stateEntry && typeof stateEntry.active === 'boolean') return { active: stateEntry.active, source: 'daily-state-snapshot' };
  const history = [...(fighter.history || [])].filter(bout => bout.date && bout.date <= cutoff).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const lastFight = history[0]?.date || null;
  return {
    active: Boolean(hasStandardUfcBout(fighter, cutoff) && lastFight && dayDiff(cutoff, lastFight) <= 730),
    source: fighter.historicalOnly ? 'ufcstats-recency-fallback' : 'fight-recency-fallback'
  };
}

function freezeFighterResult(fighter, cutoff, rankingSnapshot = null, stateSnapshot = null) {
  if (!fighter?.id) return { fighter: null, reason: 'missing-fighter-id' };
  if (fighter.meetingCoverage?.verified !== true) return { fighter: null, reason: 'unverified-fight-history' };
  const history = [...(fighter.history || [])].filter(bout => bout.date && bout.date <= cutoff).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (!history.length) return { fighter: null, reason: 'no-pre-cutoff-ufc-history' };
  const verifiedMeetings = [...(fighter.verifiedMeetings || [])].filter(meeting => meeting.date && meeting.date <= cutoff).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const division = historicalDivision(fighter, cutoff);
  if (!division) return { fighter: null, reason: 'no-historical-division' };
  const activeState = historicalActive(fighter, cutoff, stateSnapshot);
  const historicalRanking = snapshotRanking(fighter, division, rankingSnapshot);
  return {
    fighter: {
      ...fighter,
      active: activeState.active,
      division,
      rank: historicalRanking?.rank ?? null,
      rankings: historicalRanking ? [{ division, rank: historicalRanking.rank }] : [],
      booking: historicalBooking(fighter.id, cutoff, stateSnapshot),
      champion: historicalRanking?.rank === 0,
      formerChampion: false,
      interim: historicalRanking?.interim || false,
      history,
      verifiedMeetings,
      lastFight: history[0]?.date || null,
      record: reconstructRecord(history),
      temporalActiveSource: activeState.source,
      meetingCoverage: { ...(fighter.meetingCoverage || {}), verified: true }
    },
    reason: null
  };
}

function resolveOpponentId(fighter, bout) {
  const direct = (bout?.opponentIds || []).find(id => allIndex.has(id));
  if (direct) return direct;
  if (bout?.opponentStatsId && statsIdToId.has(bout.opponentStatsId)) return statsIdToId.get(bout.opponentStatsId);
  const meeting = (fighter.verifiedMeetings || []).find(item => item.date === bout?.date && item.result === bout?.result);
  if (meeting?.opponentId && allIndex.has(meeting.opponentId)) return meeting.opponentId;
  if (meeting?.opponentStatsId && statsIdToId.has(meeting.opponentStatsId)) return statsIdToId.get(meeting.opponentStatsId);
  return null;
}

function candidateCases() {
  const cases = [];
  const oldestAllowed = new Date(Date.parse(generatedDay) - lookbackDays * DAY).toISOString().slice(0, 10);
  for (const fighter of allFighters) {
    if (fighter.meetingCoverage?.verified !== true) continue;
    const history = [...(fighter.history || [])].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    if (history.length < 2) continue;
    const target = history[0];
    const cutoffBout = history[1];
    if (!target?.date || !cutoffBout?.date || target.date <= cutoffBout.date || target.date > generatedDay || cutoffBout.date < oldestAllowed) continue;
    const actualOpponentId = resolveOpponentId(fighter, target);
    if (!actualOpponentId) continue;
    const rankingSnapshot = snapshotForCutoff(rankingSnapshots, cutoffBout.date, maxRankingSnapshotAgeDays);
    const stateSnapshot = snapshotForCutoff(stateSnapshots, cutoffBout.date, maxStateSnapshotAgeDays);
    const subject = freezeFighterResult(fighter, cutoffBout.date, rankingSnapshot, stateSnapshot).fighter;
    if (!subject) continue;
    cases.push({
      fighterId: fighter.id,
      fighterName: fighter.name,
      subjectHistoricalOnly: Boolean(fighter.historicalOnly),
      cutoff: cutoffBout.date,
      targetDate: target.date,
      actualOpponentId,
      division: subject.division,
      targetDivision: divisionFromWeightClass(target.weightClass)
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

function hitStats() {
  return { evaluated: 0, top1: 0, top3: 0, top8: 0, publicTop3: 0 };
}
function addHit(stats, engineRank, publicRank) {
  stats.evaluated++;
  if (engineRank === 0) stats.top1++;
  if (engineRank >= 0 && engineRank < 3) stats.top3++;
  if (engineRank >= 0 && engineRank < 8) stats.top8++;
  if (publicRank >= 0 && publicRank < 3) stats.publicTop3++;
}
function finalizeHits(stats) {
  return {
    ...stats,
    top1Rate: rate(stats.top1, stats.evaluated),
    top3Rate: rate(stats.top3, stats.evaluated),
    top8Rate: rate(stats.top8, stats.evaluated),
    publicTop3Rate: rate(stats.publicTop3, stats.evaluated)
  };
}

const availableCases = candidateCases();
const cases = balancedSample(availableCases, maxCases);
const classifications = {};
const reasons = {};
const byDivision = {};
const caseClassifications = [];
const allHits = hitStats();
const cleanHits = hitStats();
const fullStateHits = hitStats();
let casesWithRankingSnapshot = 0;
let casesWithStateSnapshot = 0;
let historicalOnlySubjects = 0;
let historicalOnlyActualOpponents = 0;
let cleanCases = 0;
let fullStateCleanCases = 0;

function finishCase(base, classification, extra = {}) {
  bump(classifications, classification);
  if (extra.reason) bump(reasons, extra.reason);
  caseClassifications.push({ ...base, classification, ...extra });
}

for (const item of cases) {
  const rankingSnapshot = snapshotForCutoff(rankingSnapshots, item.cutoff, maxRankingSnapshotAgeDays);
  const stateSnapshot = snapshotForCutoff(stateSnapshots, item.cutoff, maxStateSnapshotAgeDays);
  if (rankingSnapshot) casesWithRankingSnapshot++;
  if (stateSnapshot) casesWithStateSnapshot++;
  if (item.subjectHistoricalOnly) historicalOnlySubjects++;
  const sourceActual = allIndex.get(item.actualOpponentId);
  if (sourceActual?.historicalOnly) historicalOnlyActualOpponents++;
  const base = {
    cutoff: item.cutoff,
    targetDate: item.targetDate,
    division: item.division,
    targetDivision: item.targetDivision || null,
    fighter: item.fighterName,
    fighterId: item.fighterId,
    actualOpponent: sourceActual?.name || item.actualOpponentId,
    actualOpponentId: item.actualOpponentId,
    subjectHistoricalOnly: item.subjectHistoricalOnly,
    actualOpponentHistoricalOnly: Boolean(sourceActual?.historicalOnly),
    rankingSnapshotDate: rankingSnapshot?.date || null,
    stateSnapshotDate: stateSnapshot?.date || null
  };

  const subjectKnownBooking = historicalBooking(item.fighterId, item.cutoff, stateSnapshot);
  if (subjectKnownBooking) {
    const sameTarget = subjectKnownBooking.opponentId === item.actualOpponentId;
    finishCase(base, sameTarget ? 'already-known-booking' : 'subject-booked-elsewhere', {
      reason: sameTarget ? 'subject-next-opponent-already-known-at-cutoff' : 'subject-already-booked-to-different-opponent-at-cutoff',
      booking: subjectKnownBooking,
      excludedFromAccuracy: true
    });
    continue;
  }

  const frozenResults = allFighters.map(fighter => ({ source: fighter, ...freezeFighterResult(fighter, item.cutoff, rankingSnapshot, stateSnapshot) }));
  const frozen = frozenResults.filter(result => result.fighter).map(result => result.fighter);
  const frozenAllIndex = new Map(frozen.map(fighter => [fighter.id, fighter]));
  const roster = frozen.filter(fighter => normalize(fighter.division) === normalize(item.division));
  const rosterIndex = new Map(roster.map(fighter => [fighter.id, fighter]));
  const subject = rosterIndex.get(item.fighterId);
  const actual = rosterIndex.get(item.actualOpponentId);

  if (!subject) {
    const result = frozenResults.find(entry => entry.source.id === item.fighterId);
    finishCase(base, 'coverage-failure', { reason: `subject-${result?.reason || 'missing-from-frozen-roster'}`, excludedFromAccuracy: true });
    continue;
  }
  if (!subject.active) {
    finishCase(base, 'coverage-failure', { reason: 'subject-inactive-at-cutoff', excludedFromAccuracy: true });
    continue;
  }
  if (!actual) {
    const actualAnyDivision = frozenAllIndex.get(item.actualOpponentId);
    const result = frozenResults.find(entry => entry.source.id === item.actualOpponentId);
    if (result?.reason === 'no-pre-cutoff-ufc-history') {
      finishCase(base, 'future-newcomer-booking', { reason: 'actual-opponent-had-no-pre-cutoff-ufc-history', excludedFromAccuracy: true });
    } else if (item.targetDivision && normalize(item.targetDivision) !== normalize(item.division)) {
      finishCase(base, 'future-division-change', { reason: `future-target-division:${item.targetDivision}`, actualHistoricalDivision: actualAnyDivision?.division || null, excludedFromAccuracy: true });
    } else if (actualAnyDivision) {
      finishCase(base, 'coverage-failure', { reason: `historical-division-mismatch:${actualAnyDivision.division || 'unknown'}`, excludedFromAccuracy: true });
    } else {
      finishCase(base, 'coverage-failure', { reason: result?.reason || 'actual-opponent-missing-from-frozen-roster', excludedFromAccuracy: true });
    }
    continue;
  }

  if (item.targetDivision && normalize(item.targetDivision) !== normalize(item.division)) {
    finishCase(base, 'future-division-change', { reason: `future-target-division:${item.targetDivision}`, actualHistoricalDivision: actual.division, excludedFromAccuracy: true });
    continue;
  }

  const ctx = {
    asOf: `${item.cutoff}T23:59:59Z`,
    event: { id: `historical-${item.cutoff}`, date: item.cutoff, bouts: [] },
    locks: [], overrides: {}, fighterIndex: rosterIndex
  };
  const actualAvailability = E.availability(actual, ctx);
  if (actualAvailability) {
    finishCase(base, 'known-availability-conflict', {
      reason: actual.booking ? 'actual-opponent-already-booked-at-cutoff' : actualAvailability,
      actualBooking: actual.booking || null,
      excludedFromAccuracy: true,
      outlierReviewCandidate: true
    });
    continue;
  }

  const actualPair = E.evaluatePair(subject, actual, ctx, false, true);
  const candidates = E.candidates(subject, roster, ctx).filter(recommendation => recommendation.publishable);
  const engineRank = candidates.findIndex(recommendation => recommendation.fighter.id === actual.id);
  const publicPool = candidates.filter(P.hasSpecificCase).slice(0, P.PUBLIC_CANDIDATE_POOL);
  const publicRecommendations = P.filterRecommendations(subject, publicPool, E, ctx);
  const publicRank = publicRecommendations.findIndex(recommendation => recommendation.fighter.id === actual.id);
  const pairEligible = Boolean(actualPair.eligible && actualPair.publishable);
  const details = {
    targetEligible: pairEligible,
    targetReason: actualPair.reason || actualPair.case?.label || null,
    engineRank: engineRank >= 0 ? engineRank + 1 : null,
    publicRank: publicRank >= 0 ? publicRank + 1 : null,
    engineTopThree: candidates.slice(0, 3).map(recommendation => ({ opponent: recommendation.fighter.name, score: recommendation.score, rankingScore: recommendation.rankingScore, case: recommendation.case?.code || null })),
    publicTopThree: publicRecommendations.map(recommendation => ({ opponent: recommendation.fighter.name, score: recommendation.score, rankingScore: recommendation.rankingScore, case: recommendation.case?.code || null }))
  };

  addHit(allHits, engineRank, publicRank);
  const divisionStats = byDivision[item.division] || (byDivision[item.division] = hitStats());
  addHit(divisionStats, engineRank, publicRank);

  if (!pairEligible) {
    const reason = actualPair.reason || 'actual-opponent-ineligible';
    const outlierReviewCandidate = /experience gap|championship-legacy|title|contender|ranked/i.test(reason);
    finishCase(base, 'hard-rule-disagreement', { ...details, reason, outlierReviewCandidate });
    continue;
  }

  cleanCases++;
  addHit(cleanHits, engineRank, publicRank);
  if (rankingSnapshot && stateSnapshot) {
    fullStateCleanCases++;
    addHit(fullStateHits, engineRank, publicRank);
  }

  if (engineRank >= 0 && engineRank < 3) finishCase(base, 'engine-top3-hit', details);
  else if (engineRank >= 3 && engineRank < 8) finishCase(base, 'engine-ranking-miss-near', details);
  else if (engineRank >= 8) finishCase(base, 'engine-ranking-miss-deep', { ...details, outlierReviewCandidate: engineRank >= 15 });
  else finishCase(base, 'engine-candidate-omission', { ...details, reason: 'eligible-target-not-returned-by-candidates', outlierReviewCandidate: true });
}

for (const [division, stats] of Object.entries(byDivision)) byDivision[division] = finalizeHits(stats);

const report = {
  schemaVersion: 4,
  generatedAt: data.generatedAt,
  engineVersion: E.VERSION,
  mode: 'temporal-historical-universe-v4',
  lookbackDays,
  maxCases,
  availableCases: availableCases.length,
  sampledCases: cases.length,
  historicalUniverseCoverage: {
    currentDatasetFighters: data.fighters.length,
    historicalOnlyFighters: universe.fighters.length,
    combinedCandidateUniverse: allFighters.length,
    trackedFights: universe.coverage?.trackedFights || null,
    fightersWithTrackedHistory: universe.coverage?.fightersWithTrackedHistory || null,
    unresolvedFightSides: universe.coverage?.unresolvedFightSides || 0,
    sampledHistoricalOnlySubjects: historicalOnlySubjects,
    sampledHistoricalOnlyActualOpponents: historicalOnlyActualOpponents
  },
  rankingSnapshotCoverage: {
    archiveStart: rankingSnapshots[0]?.date || null,
    archiveEnd: rankingSnapshots.at(-1)?.date || null,
    snapshotsAvailable: rankingSnapshots.length,
    sampledCasesWithSnapshot: casesWithRankingSnapshot,
    sampledCasesWithoutSnapshot: cases.length - casesWithRankingSnapshot,
    maxSnapshotAgeDays: maxRankingSnapshotAgeDays
  },
  temporalStateCoverage: {
    archiveStart: stateSnapshots[0]?.date || null,
    archiveEnd: stateSnapshots.at(-1)?.date || null,
    snapshotsAvailable: stateSnapshots.length,
    sampledCasesWithSnapshot: casesWithStateSnapshot,
    sampledCasesWithoutSnapshot: cases.length - casesWithStateSnapshot,
    maxSnapshotAgeDays: maxStateSnapshotAgeDays
  },
  bookingStateCoverage: {
    ledgerEntries: bookingLedger.length,
    ledgerEntriesWithoutUsableFirstSeen: bookingLedgerMissingFirstSeen,
    ledgerFirstSeen: bookingLedgerStart
  },
  classifications: sortedCounts(classifications),
  reasons: sortedCounts(reasons),
  metrics: {
    allScorablePairs: finalizeHits(allHits),
    cleanEvaluationSet: { cases: cleanCases, ...finalizeHits(cleanHits) },
    fullStateCleanSet: { cases: fullStateCleanCases, ...finalizeHits(fullStateHits) }
  },
  byDivision,
  caseClassifications,
  leakageControls: [
    'The public Matchmaker dataset is never expanded with historical-only fighters; the UFCStats universe is loaded only inside the offline backtest.',
    'Every fighter history, record, division and prior-meeting ledger is truncated at the case cutoff date.',
    'Historical-only fighters use source-native UFCStats identities and are mapped to current canonical fighter IDs only when a stable UFCStats ID or unique exact identity is available.',
    `Rankings are used only from snapshots captured on or before the cutoff and no more than ${maxRankingSnapshotAgeDays} days old.`,
    `Roster/booking state is used only from snapshots captured on or before the cutoff and no more than ${maxStateSnapshotAgeDays} days old.`,
    'Persisted bookings are restored only when firstSeen is at or before the cutoff and the booked fight occurs after the cutoff.',
    'The eventual next-fight division is never used to score candidates. It is consulted only after scoring to classify an unannounced future division change as outside the clean evaluation set.',
    'An opponent with no UFC history before the cutoff is classified as a future-newcomer booking instead of an engine miss.'
  ],
  limitations: [
    'Pre-archive roster membership still uses UFC fight-recency as a fallback; it cannot prove the exact date of every historical release or re-signing.',
    'Historical UFCStats name collisions that cannot be resolved to a unique source-native identity are omitted rather than guessed.',
    'A hard-rule disagreement is not automatically an engine error: some UFC bookings are short-notice, promotional, contractual or intentionally unusual. Outlier-review flags identify cases that need manual judgment.',
    'The full-state clean set requires both ranking and roster snapshots and will remain small until those archives mature.'
  ]
};

await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
const clean = report.metrics.cleanEvaluationSet;
console.log(`Matchmaker v4 backtest: ${cases.length} sampled from ${availableCases.length} available cases; combined historical universe ${allFighters.length} fighters (${universe.fighters.length} historical-only).`);
console.log(`Classifications: ${Object.entries(report.classifications).map(([name, count]) => `${name}=${count}`).join(', ')}.`);
console.log(`Clean evaluation set: ${clean.cases} cases; Top 1 ${(clean.top1Rate * 100).toFixed(1)}%, Top 3 ${(clean.top3Rate * 100).toFixed(1)}%, Top 8 ${(clean.top8Rate * 100).toFixed(1)}%, public Top 3 ${(clean.publicTop3Rate * 100).toFixed(1)}%.`);
console.log(`Snapshot-complete clean cases: ${fullStateCleanCases}; ranking snapshots ${casesWithRankingSnapshot}/${cases.length}, state snapshots ${casesWithStateSnapshot}/${cases.length}.`);
