import fs from 'node:fs/promises';
import { clean, key } from './sources/ufc.mjs';
import { parseMirrorFighters, parseMirrorHistory } from './sources/ufcstats.mjs';

const DATA_PATH = 'assets/data/matchmaker/current.json';
const OUTPUT_PATH = 'assets/data/matchmaker/historical-universe.json';
const FIGHT_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fight_results.csv';
const EVENT_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_event_details.csv';
const FIGHTER_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fighter_details.csv';
const TRACKED_CLASSES = new Set(['ufc', 'tuf', 'road-to-ufc']);

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const cutoff = String(data.generatedAt || new Date().toISOString()).slice(0, 10);

async function getText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MMAMatlockMatchmaker/2.3; +https://github.com/MatlockFT/Matlock)' },
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

function syntheticId(statsId) {
  return `history-${statsId}`;
}

function recordFromHistory(history) {
  const counts = { W: 0, L: 0, D: 0 };
  for (const bout of history) if (Object.hasOwn(counts, bout.result)) counts[bout.result]++;
  return `${counts.W}-${counts.L}-${counts.D}`;
}

const [fightCsv, eventCsv, fighterCsv] = await Promise.all([
  getText(FIGHT_URL),
  getText(EVENT_URL),
  getText(FIGHTER_URL)
]);
const statsFighters = parseMirrorFighters(fighterCsv);
const fights = parseMirrorHistory(fightCsv, eventCsv, cutoff).filter(fight => TRACKED_CLASSES.has(fight.competitionClass));
if (statsFighters.length < 3000) throw new Error(`Historical universe fighter directory is implausibly small: ${statsFighters.length}.`);
if (fights.length < 7000) throw new Error(`Historical universe fight ledger is implausibly small: ${fights.length}.`);

const statsById = new Map(statsFighters.map(fighter => [fighter.id, fighter]));
const statsIdsByName = new Map();
for (const fighter of statsFighters) {
  const nameKey = key(fighter.name);
  const ids = statsIdsByName.get(nameKey) || [];
  ids.push(fighter.id);
  statsIdsByName.set(nameKey, ids);
}
function statsIdentity(name) {
  const ids = statsIdsByName.get(key(name)) || [];
  return ids.length === 1 ? statsById.get(ids[0]) : null;
}

const currentIdByStatsId = new Map();
const currentIdsByName = new Map();
for (const fighter of data.fighters || []) {
  const statsId = fighter.meetingCoverage?.ufcStatsId;
  if (/^[a-f0-9]{16}$/i.test(statsId || '')) {
    const existing = currentIdByStatsId.get(statsId);
    currentIdByStatsId.set(statsId, existing && existing !== fighter.id ? null : fighter.id);
  }
  const nameKey = key(fighter.name);
  const ids = currentIdsByName.get(nameKey) || [];
  ids.push(fighter.id);
  currentIdsByName.set(nameKey, ids);
}

function canonicalId(statsFighter) {
  if (!statsFighter) return null;
  const stable = currentIdByStatsId.get(statsFighter.id);
  if (stable) return stable;
  const exact = currentIdsByName.get(key(statsFighter.name)) || [];
  if (exact.length === 1) return exact[0];
  return syntheticId(statsFighter.id);
}

const sidesByStatsId = new Map();
let unresolvedSides = 0;
function push(statsId, meeting) {
  if (!statsId) return;
  const list = sidesByStatsId.get(statsId) || [];
  list.push(meeting);
  sidesByStatsId.set(statsId, list);
}

for (const fight of fights) {
  const aStats = statsIdentity(fight.aName);
  const bStats = statsIdentity(fight.bName);
  if (!aStats || !bStats) {
    unresolvedSides += (!aStats ? 1 : 0) + (!bStats ? 1 : 0);
    continue;
  }
  const aId = canonicalId(aStats);
  const bId = canonicalId(bStats);
  const common = {
    fightStatsId: fight.fightStatsId || null,
    date: fight.date,
    event: fight.event,
    competitionClass: fight.competitionClass,
    weightClass: fight.weightClass || null,
    method: fight.method || null,
    round: fight.round || null,
    time: fight.time || null,
    source: 'UFCStats',
    sourceUrl: fight.sourceUrl
  };
  push(aStats.id, { ...common, result: fight.aResult, opponentId: bId, opponentStatsId: bStats.id, opponentName: bStats.name });
  push(bStats.id, { ...common, result: fight.bResult, opponentId: aId, opponentStatsId: aStats.id, opponentName: aStats.name });
}

const historicalOnly = [];
let canonicalMapped = 0;
for (const statsFighter of statsFighters) {
  const history = [...(sidesByStatsId.get(statsFighter.id) || [])]
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.fightStatsId || '').localeCompare(String(b.fightStatsId || '')));
  if (!history.length) continue;
  const id = canonicalId(statsFighter);
  if (!id) continue;
  const mappedToCurrent = !id.startsWith('history-');
  if (mappedToCurrent) {
    canonicalMapped++;
    continue;
  }
  historicalOnly.push({
    id,
    name: statsFighter.name,
    statsId: statsFighter.id,
    source: statsFighter.url,
    historicalOnly: true,
    active: false,
    division: null,
    rank: null,
    rankings: [],
    champion: false,
    interim: false,
    formerChampion: false,
    booking: null,
    record: recordFromHistory(history),
    lastFight: history[0].date,
    history: history.map(meeting => ({
      date: meeting.date,
      result: meeting.result,
      opponentIds: [meeting.opponentId],
      opponentStatsId: meeting.opponentStatsId,
      opponentName: meeting.opponentName,
      event: meeting.event,
      competitionClass: meeting.competitionClass,
      weightClass: meeting.weightClass,
      method: meeting.method,
      round: meeting.round,
      time: meeting.time,
      fightStatsId: meeting.fightStatsId,
      source: meeting.source,
      sourceUrl: meeting.sourceUrl,
      text: `${meeting.event}: ${statsFighter.name} vs ${meeting.opponentName}. ${meeting.result}. ${meeting.method || ''}`.trim()
    })),
    verifiedMeetings: history,
    meetingCoverage: {
      source: 'UFCStats',
      transport: 'historical-universe-mirror',
      sourceUrl: FIGHT_URL,
      fighterDirectoryUrl: FIGHTER_URL,
      checkedAt: data.generatedAt,
      verified: true,
      ufcStatsId: statsFighter.id,
      identityMethod: 'source-native-ufcstats-id',
      bouts: history.length
    }
  });
}

const statsIdToCanonicalId = {};
for (const statsFighter of statsFighters) {
  const id = canonicalId(statsFighter);
  if (id && sidesByStatsId.has(statsFighter.id)) statsIdToCanonicalId[statsFighter.id] = id;
}

const output = {
  schemaVersion: 1,
  generatedAt: data.generatedAt,
  cutoff,
  sources: { fights: FIGHT_URL, events: EVENT_URL, fighters: FIGHTER_URL },
  coverage: {
    statsFighters: statsFighters.length,
    trackedFights: fights.length,
    fightersWithTrackedHistory: sidesByStatsId.size,
    canonicalMapped,
    historicalOnly: historicalOnly.length,
    unresolvedFightSides: unresolvedSides
  },
  statsIdToCanonicalId,
  fighters: historicalOnly
};

await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
console.log(`Historical Matchmaker universe: ${historicalOnly.length} historical-only fighters + ${canonicalMapped} current canonical identities from ${fights.length} tracked UFC/TUF/Road-to-UFC fights; ${unresolvedSides} unresolved fight sides.`);
