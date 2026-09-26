import fs from 'node:fs/promises';
import { clean, key } from './sources/ufc.mjs';
import { parseCsv, statsId } from './sources/ufcstats.mjs';
import { completeDisplayedCareer, enrichSherdogCareers } from './sources/sherdog.mjs';

const DATA_PATH = 'assets/data/matchmaker/current.json';
const OUTPUT_PATH = 'assets/data/writer-fighters.json';

const FIGHT_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fight_results.csv';
const EVENT_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_event_details.csv';
const FIGHTER_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fighter_details.csv';
const TOTT_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fighter_tott.csv';
const STATS_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fight_stats.csv';

async function getText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MMAMatlockWriterData/1.0; +https://mmamatlock.com/write/)' },
        signal: AbortSignal.timeout(30000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }
  throw lastError;
}

function parseDate(value) {
  const date = new Date(clean(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function pair(value) {
  const match = clean(value).match(/(\d+)\s+of\s+(\d+)/i);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function finalSeconds(value) {
  const match = clean(value).match(/^(\d+):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : 0;
}

function roundLengths(value) {
  const match = clean(value).match(/\(([^)]+)\)/);
  if (!match) return [];
  return match[1].split('-').map(item => Number(item)).filter(Number.isFinite);
}

function fightDurationMinutes(result) {
  const round = Number(result.ROUND) || 0;
  if (!round) return 0;
  const lengths = roundLengths(result['TIME FORMAT']);
  let seconds = finalSeconds(result.TIME);
  for (let index = 0; index < round - 1; index++) {
    seconds += 60 * (lengths[index] || 5);
  }
  return seconds / 60;
}

function fightKey(event, bout) {
  return key(event) + '|' + key(bout);
}

function emptyTotals() {
  return {
    fights: 0,
    minutes: 0,
    sigLanded: 0,
    sigAttempted: 0,
    oppSigLanded: 0,
    oppSigAttempted: 0,
    tdLanded: 0,
    tdAttempted: 0,
    oppTdLanded: 0,
    oppTdAttempted: 0,
    subAttempts: 0,
    latestBoutDate: null
  };
}

function sumPairs(rows, field) {
  return rows.reduce((totals, row) => {
    const [landed, attempted] = pair(row[field]);
    totals[0] += landed;
    totals[1] += attempted;
    return totals;
  }, [0, 0]);
}

function sumNumber(rows, field) {
  return rows.reduce((total, row) => total + (Number(clean(row[field])) || 0), 0);
}

function metrics(totals) {
  if (!totals || totals.minutes <= 0) return null;
  const rate = value => (value / totals.minutes).toFixed(2);
  const per15 = value => ((value / totals.minutes) * 15).toFixed(2);
  const pct = (landed, attempted, defense = false) => {
    if (!attempted) return null;
    const value = defense ? 1 - landed / attempted : landed / attempted;
    return Math.round(Math.max(0, Math.min(1, value)) * 100) + '%';
  };
  return {
    slpm: rate(totals.sigLanded),
    sapm: rate(totals.oppSigLanded),
    strAccuracy: pct(totals.sigLanded, totals.sigAttempted),
    strDefense: pct(totals.oppSigLanded, totals.oppSigAttempted, true),
    tdAvg: per15(totals.tdLanded),
    tdAccuracy: pct(totals.tdLanded, totals.tdAttempted),
    tdDefense: pct(totals.oppTdLanded, totals.oppTdAttempted, true),
    subAvg: per15(totals.subAttempts),
    sample: {
      fights: totals.fights,
      minutes: Number(totals.minutes.toFixed(2)),
      latestBoutDate: totals.latestBoutDate
    }
  };
}

function countRecord(history, allowed = null) {
  const counts = { W: 0, L: 0, D: 0 };
  for (const fight of history || []) {
    if (allowed && !allowed.has(fight.competitionClass || 'ufc')) continue;
    if (Object.hasOwn(counts, fight.result)) counts[fight.result]++;
  }
  return counts.W + '-' + counts.L + '-' + counts.D;
}

function subtractRecords(overall, ufc) {
  const parse = value => clean(value).match(/^(\d+)-(\d+)-(\d+)/)?.slice(1, 4).map(Number);
  const a = parse(overall), b = parse(ufc);
  if (!a || !b) return null;
  return a.map((value, index) => Math.max(0, value - b[index])).join('-');
}

function decisionBreakdown(history) {
  const counts = { unanimous: 0, split: 0, majority: 0, other: 0 };
  for (const fight of history || []) {
    if (fight.result !== 'W') continue;
    const method = clean(fight.method).toLowerCase();
    if (!method.includes('decision')) continue;
    if (method.includes('unanimous')) counts.unanimous++;
    else if (method.includes('split')) counts.split++;
    else if (method.includes('majority')) counts.majority++;
    else counts.other++;
  }
  return counts;
}

function normalizedCareer(career, history, record) {
  const decisions = decisionBreakdown(history);
  const rawKnockout = Number.isFinite(career?.winsByKnockout) ? career.winsByKnockout : null;
  const rawSubmission = Number.isFinite(career?.winsBySubmission) ? career.winsBySubmission : null;

  // UFC athlete pages omit zero-value method cards for some fighters. If one finish
  // category is present, a missing counterpart is a verified zero rather than unknown.
  const winsByKnockout = rawKnockout !== null ? rawKnockout : rawSubmission !== null ? 0 : null;
  const winsBySubmission = rawSubmission !== null ? rawSubmission : rawKnockout !== null ? 0 : null;
  const totalFinishes = Number.isFinite(career?.totalFinishes)
    ? career.totalFinishes
    : Number.isFinite(winsByKnockout) && Number.isFinite(winsBySubmission)
      ? winsByKnockout + winsBySubmission
      : null;
  const recordWins = Number(clean(record).match(/^(\d+)-/)?.[1]);
  const decisionWins = Number.isFinite(career?.decisionWins)
    ? career.decisionWins
    : Number.isFinite(recordWins) && Number.isFinite(totalFinishes)
      ? Math.max(0, recordWins - totalFinishes)
      : null;
  const classifiedDecisionWins = decisions.unanimous + decisions.split + decisions.majority + decisions.other;
  return {
    winsByKnockout,
    winsBySubmission,
    firstRoundFinishes: Number.isFinite(career?.firstRoundFinishes) ? career.firstRoundFinishes : null,
    totalFinishes,
    decisionWins,
    unanimousDecisionWins: decisions.unanimous,
    splitDecisionWins: decisions.split,
    majorityDecisionWins: decisions.majority,
    otherDecisionWins: decisions.other,
    decisionBreakdownComplete: decisionWins !== null ? classifiedDecisionWins >= decisionWins : false,
    decisionBreakdownKnownWins: classifiedDecisionWins
  };
}

const current = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const builtAt = new Date().toISOString();

const [fightText, eventText, fighterText, tottText, statText] = await Promise.all([
  getText(FIGHT_URL),
  getText(EVENT_URL),
  getText(FIGHTER_URL),
  getText(TOTT_URL),
  getText(STATS_URL)
]);

const eventRows = parseCsv(eventText);
const fightRows = parseCsv(fightText);
const fighterRows = parseCsv(fighterText);
const tottRows = parseCsv(tottText);
const statRows = parseCsv(statText);

if (fighterRows.length < 3000) throw new Error(`UFCStats fighter directory is implausibly small: ${fighterRows.length}`);
if (fightRows.length < 8000) throw new Error(`UFCStats fight ledger is implausibly small: ${fightRows.length}`);
if (statRows.length < 20000) throw new Error(`UFCStats stat ledger is implausibly small: ${statRows.length}`);

const eventDates = new Map(eventRows.map(row => [key(row.EVENT), parseDate(row.DATE)]));
const fightResults = new Map();
for (const row of fightRows) {
  const id = fightKey(row.EVENT, row.BOUT);
  fightResults.set(id, {
    date: eventDates.get(key(row.EVENT)) || null,
    duration: fightDurationMinutes(row),
    sourceUrl: String(row.URL || '').replace(/^http:/i, 'https:')
  });
}

const statsIdsByName = new Map();
for (const row of fighterRows) {
  const id = statsId(row.URL);
  const name = clean([row.FIRST, row.LAST].filter(Boolean).join(' '));
  if (!id || !name) continue;
  const nameKey = key(name);
  const ids = statsIdsByName.get(nameKey) || [];
  ids.push(id);
  statsIdsByName.set(nameKey, ids);
}
function uniqueStatsId(name) {
  const ids = statsIdsByName.get(key(name)) || [];
  return ids.length === 1 ? ids[0] : null;
}

const resultHistoryByStatsId = new Map();
function pushResult(statsIdValue, row) {
  if (!statsIdValue) return;
  const list = resultHistoryByStatsId.get(statsIdValue) || [];
  list.push(row);
  resultHistoryByStatsId.set(statsIdValue, list);
}
for (const row of fightRows) {
  const names = clean(row.BOUT).split(/\s+vs\.?\s+/i).map(clean);
  const outcomes = clean(row.OUTCOME).split('/').map(value => value.toUpperCase());
  if (names.length !== 2 || outcomes.length !== 2) continue;
  const aId = uniqueStatsId(names[0]);
  const bId = uniqueStatsId(names[1]);
  const date = eventDates.get(key(row.EVENT)) || null;
  const common = {
    date,
    event: clean(row.EVENT) || null,
    method: clean(row.METHOD) || null,
    round: Number(row.ROUND) || null,
    time: clean(row.TIME) || null,
    sourceUrl: String(row.URL || '').replace(/^http:/i, 'https:')
  };
  pushResult(aId, { ...common, result: outcomes[0] || null, opponent: names[1], opponentStatsId: bId });
  pushResult(bId, { ...common, result: outcomes[1] || null, opponent: names[0], opponentStatsId: aId });
}
for (const history of resultHistoryByStatsId.values()) {
  history.sort((a,b) => String(b.date || '').localeCompare(String(a.date || '')));
}

const mirrorFighters = new Map();
for (const row of fighterRows) {
  const id = statsId(row.URL);
  if (!id) continue;
  mirrorFighters.set(id, {
    id,
    name: clean([row.FIRST, row.LAST].filter(Boolean).join(' ')),
    nickname: clean(row.NICKNAME),
    url: 'https://ufcstats.com/fighter-details/' + id
  });
}

const bioById = new Map();
for (const row of tottRows) {
  const id = statsId(row.URL);
  if (!id) continue;
  bioById.set(id, {
    height: clean(row.HEIGHT) && clean(row.HEIGHT) !== '--' ? clean(row.HEIGHT) : null,
    weight: clean(row.WEIGHT) && clean(row.WEIGHT) !== '--' ? clean(row.WEIGHT) : null,
    reach: clean(row.REACH) && clean(row.REACH) !== '--' ? clean(row.REACH) : null,
    stance: clean(row.STANCE) || null,
    dob: clean(row.DOB) || null
  });
}

const statFights = new Map();
for (const row of statRows) {
  const id = fightKey(row.EVENT, row.BOUT);
  const list = statFights.get(id) || [];
  list.push(row);
  statFights.set(id, list);
}

const totalsByName = new Map();
for (const [id, rows] of statFights) {
  const result = fightResults.get(id);
  if (!result || !result.duration) continue;
  const sides = new Map();
  for (const row of rows) {
    const nameKey = key(row.FIGHTER);
    if (!nameKey) continue;
    const list = sides.get(nameKey) || [];
    list.push(row);
    sides.set(nameKey, list);
  }
  if (sides.size !== 2) continue;
  const entries = [...sides.entries()];
  for (let index = 0; index < 2; index++) {
    const [nameKey, ownRows] = entries[index];
    const opponentRows = entries[index === 0 ? 1 : 0][1];
    const totals = totalsByName.get(nameKey) || emptyTotals();
    const [sigLanded, sigAttempted] = sumPairs(ownRows, 'SIG.STR.');
    const [oppSigLanded, oppSigAttempted] = sumPairs(opponentRows, 'SIG.STR.');
    const [tdLanded, tdAttempted] = sumPairs(ownRows, 'TD');
    const [oppTdLanded, oppTdAttempted] = sumPairs(opponentRows, 'TD');
    totals.fights++;
    totals.minutes += result.duration;
    totals.sigLanded += sigLanded;
    totals.sigAttempted += sigAttempted;
    totals.oppSigLanded += oppSigLanded;
    totals.oppSigAttempted += oppSigAttempted;
    totals.tdLanded += tdLanded;
    totals.tdAttempted += tdAttempted;
    totals.oppTdLanded += oppTdLanded;
    totals.oppTdAttempted += oppTdAttempted;
    totals.subAttempts += sumNumber(ownRows, 'SUB.ATT');
    if (result.date && (!totals.latestBoutDate || result.date > totals.latestBoutDate)) totals.latestBoutDate = result.date;
    totalsByName.set(nameKey, totals);
  }
}

const fighters = [];
let withStats = 0;
let withBio = 0;
for (const fighter of current.fighters || []) {
  const ufcStatsId = fighter.meetingCoverage?.ufcStatsId || '';
  if (!ufcStatsId) continue;
  const mirror = mirrorFighters.get(ufcStatsId);
  const mirrorName = mirror?.name || fighter.name;
  const stats = metrics(totalsByName.get(key(mirrorName)));
  const bio = bioById.get(ufcStatsId) || null;
  const verifiedHistory = Array.isArray(fighter.verifiedMeetings) && fighter.verifiedMeetings.length
    ? fighter.verifiedMeetings
    : (Array.isArray(fighter.history) ? fighter.history : []);
  const mirrorHistory = resultHistoryByStatsId.get(ufcStatsId) || [];
  const recentHistory = mirrorHistory.length ? mirrorHistory : verifiedHistory;
  const career = normalizedCareer(fighter.career, mirrorHistory.length ? mirrorHistory : verifiedHistory, fighter.record);
  const ufcMirrorHistory = mirrorHistory.filter(fight => /^(?:UFC\b|Noche UFC\b)/i.test(fight.event || ''));
  const ufcRecord = ufcMirrorHistory.length
    ? (() => {
        const counts = { W:0,L:0,D:0 };
        for (const fight of ufcMirrorHistory) if (Object.hasOwn(counts,fight.result)) counts[fight.result]++;
        return counts.W + '-' + counts.L + '-' + counts.D;
      })()
    : countRecord(verifiedHistory, new Set(['ufc']));
  if (stats) withStats++;
  if (bio) withBio++;
  fighters.push({
    id: fighter.id,
    name: fighter.name,
    division: fighter.division || null,
    record: fighter.record || null,
    ufcRecord,
    recordOutsideUfc: subtractRecords(fighter.record, ufcRecord),
    rank: fighter.rank ?? null,
    image: fighter.image || null,
    booking: fighter.booking || null,
    checkedAt: fighter.checkedAt || current.generatedAt || builtAt,
    ufcStatsId,
    sourceUrl: mirror?.url || ('https://ufcstats.com/fighter-details/' + ufcStatsId),
    latestBoutDate: stats?.sample?.latestBoutDate || recentHistory[0]?.date || null,
    mirrorThrough: fighter.meetingCoverage?.mirrorThrough || null,
    bio,
    stats,
    career,
    recent: recentHistory.slice(0, 5).map(fight => ({
      result: fight.result || null,
      opponent: fight.opponent || fight.opponentName || null,
      date: fight.date || null,
      method: fight.method || null,
      round: fight.round || null,
      time: fight.time || null,
      event: fight.event || null,
      sourceUrl: fight.sourceUrl || null
    }))
  });
}

fighters.sort((a, b) => a.name.localeCompare(b.name));

const sherdogCareer = await enrichSherdogCareers(fighters, {
  cachePath: 'assets/data/writer-fighter-career-fallbacks.json'
});
const mirrorThrough = eventRows.map(row => parseDate(row.DATE)).filter(Boolean).sort().at(-1) || null;
const withCareer = fighters.filter(fighter => completeDisplayedCareer(fighter.career)).length;

const output = {
  schemaVersion: 1,
  generatedAt: current.generatedAt || builtAt,
  builtAt,
  mirrorThrough,
  sources: {
    fighters: FIGHTER_URL,
    bios: TOTT_URL,
    fightStats: STATS_URL,
    fightResults: FIGHT_URL,
    events: EVENT_URL,
    careerFallback: 'https://www.sherdog.com/stats/fightfinder'
  },
  coverage: {
    fighters: fighters.length,
    withStats,
    withBio,
    withCareer,
    sherdogCareer
  },
  fighters
};

if (fighters.length < 500) throw new Error(`Writer fighter index is implausibly small: ${fighters.length}`);
if (withStats < 400) throw new Error(`Writer fighter index has implausibly low stat coverage: ${withStats}`);
const minimumCareerCoverage = Math.max(800, Math.floor(fighters.length * 0.90));
if (withCareer < minimumCareerCoverage) {
  const missing = fighters.filter(fighter => !completeDisplayedCareer(fighter.career)).slice(0, 20).map(fighter => fighter.name);
  throw new Error(`Writer fighter index has incomplete career-method coverage: ${withCareer}/${fighters.length}; examples: ${missing.join(', ')}`);
}
const incompleteBooked = fighters.filter(fighter => fighter.booking && !completeDisplayedCareer(fighter.career));
if (incompleteBooked.length) {
  throw new Error('Booked fighters have incomplete Writer career data: ' + incompleteBooked.map(fighter => fighter.name).join(', '));
}

await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
console.log(`Writer fighter index: ${fighters.length} fighters, ${withStats} with UFCStats career metrics, ${withBio} with Tale data, ${withCareer} with complete displayed career totals. Sherdog resolved ${sherdogCareer.resolved}, reused ${sherdogCareer.appliedFromCache}, missed ${sherdogCareer.missed}. Mirror through ${mirrorThrough || 'unknown'}.`);
