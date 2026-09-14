import fs from 'node:fs/promises';
import path from 'node:path';
import { clean, key } from './sources/ufc.mjs';
import { parseMirrorFighters, parseMirrorHistory } from './sources/ufcstats.mjs';
import { validateData } from './validate.mjs';

const DATA_PATH = path.resolve('assets/data/matchmaker/current.json');
const FIGHT_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fight_results.csv';
const EVENT_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_event_details.csv';
const FIGHTER_URL = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fighter_details.csv';
const DAY = 86400000;
const SUFFIXES = new Set(['jr', 'junior', 'sr', 'senior', 'ii', 'iii', 'iv', 'filho', 'neto']);

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const checkedAt = data.generatedAt || new Date().toISOString();
const cutoff = checkedAt.slice(0, 10);

async function getText(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MMAMatlockMatchmaker/2.0; +https://mmamatlock.com/)' },
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

function nameVariants(value) {
  const raw = clean(value);
  if (!raw) return [];
  const tokens = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const variants = new Set([key(raw)]);
  if (tokens.length > 2 && SUFFIXES.has(tokens.at(-1))) variants.add(key(tokens.slice(0, -1).join(' ')));
  return [...variants].filter(Boolean);
}

const [fightCsv, eventCsv, fighterCsv] = await Promise.all([
  getText(FIGHT_URL),
  getText(EVENT_URL),
  getText(FIGHTER_URL)
]);
const statsFighters = parseMirrorFighters(fighterCsv);
const mirrorFights = parseMirrorHistory(fightCsv, eventCsv, cutoff);
if (statsFighters.length < 3000) throw new Error(`UFCStats fighter directory is implausibly small: ${statsFighters.length}`);
if (mirrorFights.length < 8000) throw new Error(`UFCStats fight ledger is implausibly small: ${mirrorFights.length}`);
const mirrorLatest = mirrorFights[0]?.date;
const mirrorEarliest = mirrorFights.at(-1)?.date;
if (!mirrorLatest || !mirrorEarliest) throw new Error('UFCStats mirror has no usable date span.');

const statsById = new Map(statsFighters.map(fighter => [fighter.id, fighter]));
const statsByVariant = new Map();
for (const fighter of statsFighters) {
  for (const variant of nameVariants(fighter.name)) {
    const ids = statsByVariant.get(variant) || new Set();
    ids.add(fighter.id);
    statsByVariant.set(variant, ids);
  }
}

const eventNamesById = new Map();
const participants = new Set();
for (const event of data.events || []) for (const bout of event.bouts || []) for (const entry of bout.fighters || []) {
  participants.add(entry.id);
  const names = eventNamesById.get(entry.id) || new Set();
  if (entry.name) names.add(entry.name);
  eventNamesById.set(entry.id, names);
}

function identityFor(fighter) {
  const previousId = fighter.meetingCoverage?.ufcStatsId;
  if (previousId && statsById.has(previousId)) return { fighter: statsById.get(previousId), method: 'stable-ufcstats-id' };
  const names = [fighter.name, ...(eventNamesById.get(fighter.id) || [])];
  const exactPrimary = statsByVariant.get(key(fighter.name));
  if (exactPrimary?.size === 1) return { fighter: statsById.get([...exactPrimary][0]), method: 'exact-name' };
  const candidates = new Set();
  for (const name of names) for (const variant of nameVariants(name)) {
    const matches = statsByVariant.get(variant);
    if (matches?.size === 1) candidates.add([...matches][0]);
  }
  if (candidates.size === 1) return { fighter: statsById.get([...candidates][0]), method: 'unique-alias' };
  return { fighter: null, method: candidates.size > 1 ? 'ambiguous' : 'not-found' };
}

const identities = new Map(data.fighters.map(fighter => [fighter.id, identityFor(fighter)]));
const canonicalByStatsId = new Map();
for (const fighter of data.fighters) {
  const statsId = identities.get(fighter.id)?.fighter?.id;
  if (!statsId) continue;
  const existing = canonicalByStatsId.get(statsId);
  canonicalByStatsId.set(statsId, existing && existing !== fighter.id ? null : fighter.id);
}

function resolveStatsName(name) {
  const exact = statsByVariant.get(key(name));
  if (exact?.size === 1) return statsById.get([...exact][0]);
  const candidates = new Set();
  for (const variant of nameVariants(name)) {
    const matches = statsByVariant.get(variant);
    if (matches?.size === 1) candidates.add([...matches][0]);
  }
  return candidates.size === 1 ? statsById.get([...candidates][0]) : null;
}

const ledgerByStatsId = new Map();
function addMeeting(statsId, meeting) {
  if (!statsId) return;
  const list = ledgerByStatsId.get(statsId) || [];
  list.push(meeting);
  ledgerByStatsId.set(statsId, list);
}
function meetingFromFight(fight, selfStats, opponentStats, result, opponentName) {
  return {
    fightStatsId: fight.fightStatsId || null,
    opponentStatsId: opponentStats?.id || null,
    opponentId: opponentStats ? canonicalByStatsId.get(opponentStats.id) || null : null,
    opponentName,
    date: fight.date,
    result,
    event: fight.event,
    weightClass: fight.weightClass || null,
    method: fight.method || null,
    round: fight.round || null,
    time: fight.time || null,
    referee: fight.referee || null,
    details: fight.details || null,
    source: 'UFCStats',
    sourceUrl: fight.sourceUrl
  };
}
for (const fight of mirrorFights) {
  const aStats = resolveStatsName(fight.aName);
  const bStats = resolveStatsName(fight.bName);
  if (aStats) addMeeting(aStats.id, meetingFromFight(fight, aStats, bStats, fight.aResult, fight.bName));
  if (bStats) addMeeting(bStats.id, meetingFromFight(fight, bStats, aStats, fight.bResult, fight.aName));
}

// Official UFC cards already in the snapshot reconcile the newest results on top of the mirrored ledger.
for (const event of data.events || []) for (const bout of event.bouts || []) {
  if (!Array.isArray(bout.fighters) || bout.fighters.length !== 2) continue;
  const [left, right] = bout.fighters;
  for (const [self, opponent] of [[left, right], [right, left]]) {
    const selfIdentity = identities.get(self.id)?.fighter;
    if (!selfIdentity) continue;
    const opponentIdentity = identities.get(opponent.id)?.fighter;
    addMeeting(selfIdentity.id, {
      fightStatsId: null,
      opponentStatsId: opponentIdentity?.id || null,
      opponentId: opponent.id,
      opponentName: opponent.name,
      date: event.date,
      result: self.result,
      event: event.title,
      weightClass: bout.division || null,
      method: bout.method || null,
      round: bout.round || null,
      time: bout.time || null,
      referee: null,
      details: null,
      source: 'UFC.com',
      sourceUrl: event.source
    });
  }
}

function dedupeMeetings(meetings) {
  const unique = new Map();
  for (const meeting of meetings) {
    const opponentKey = meeting.opponentId || meeting.opponentStatsId || key(meeting.opponentName);
    const id = `${meeting.date}|${opponentKey}`;
    const existing = unique.get(id);
    if (!existing) { unique.set(id, meeting); continue; }
    if (meeting.source === 'UFC.com') unique.set(id, { ...existing, ...meeting, fightStatsId: existing.fightStatsId || meeting.fightStatsId });
    else if (!existing.fightStatsId && meeting.fightStatsId) unique.set(id, { ...existing, ...meeting });
  }
  return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date) || String(a.opponentName).localeCompare(String(b.opponentName)));
}

function isProfileUfcBout(entry) {
  const text = clean(entry?.text || entry?.event || '');
  return /^(?:UFC\b|Noche UFC\b|The Ultimate Fighter\b)/i.test(text);
}
function nearDate(a, b, toleranceDays = 2) {
  const left = Date.parse(a), right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= toleranceDays * DAY;
}

let verified = 0;
let participantVerified = 0;
let activePopulation = 0;
let activeVerified = 0;
let identityMisses = 0;
let ambiguousIdentities = 0;
let canonicalOpponentLinks = 0;
let unresolvedOpponentLinks = 0;
const missNames = [];

for (const fighter of data.fighters) {
  const identity = identities.get(fighter.id) || { fighter: null, method: 'not-found' };
  const profileHistory = Array.isArray(fighter.profileHistory)
    ? fighter.profileHistory
    : Array.isArray(fighter.history)
      ? fighter.history
      : [];
  const statsId = identity.fighter?.id || null;
  const meetings = dedupeMeetings(statsId ? ledgerByStatsId.get(statsId) || [] : []);
  const profileUfc = profileHistory.filter(isProfileUfcBout);
  const recentProfile = profileUfc.slice(0, 12);
  const missingProfileDates = recentProfile
    .filter(entry => entry.date && !meetings.some(meeting => nearDate(meeting.date, entry.date)))
    .map(entry => entry.date);
  const latestProfile = profileUfc[0]?.date || null;
  const latestStructured = meetings[0]?.date || null;
  const latestCovered = !latestProfile || latestStructured && (latestStructured >= latestProfile || nearDate(latestStructured, latestProfile));
  const duplicateIdentity = statsId && canonicalByStatsId.get(statsId) === null;
  const coverageVerified = Boolean(statsId && !duplicateIdentity && latestCovered && missingProfileDates.length === 0 && (meetings.length > 0 || profileUfc.length === 0));

  if (!statsId) {
    identityMisses++;
    if (identity.method === 'ambiguous') ambiguousIdentities++;
    if (fighter.active || participants.has(fighter.id)) missNames.push(`${fighter.name} (${identity.method})`);
  }

  for (const meeting of meetings) {
    if (meeting.opponentId) canonicalOpponentLinks++;
    else unresolvedOpponentLinks++;
  }

  fighter.profileHistory = profileHistory;
  fighter.verifiedMeetings = meetings;
  fighter.historyModelVersion = 2;
  fighter.meetingCoverage = {
    source: 'UFCStats',
    transport: 'GitHubMirror+UFC.com',
    sourceUrl: FIGHT_URL,
    fighterDirectoryUrl: FIGHTER_URL,
    checkedAt,
    verified: coverageVerified,
    ufcStatsId: statsId,
    identityMethod: identity.method,
    bouts: meetings.length,
    canonicalOpponentLinks: meetings.filter(meeting => meeting.opponentId).length,
    unresolvedOpponentLinks: meetings.filter(meeting => !meeting.opponentId).length,
    profileUfcBouts: profileUfc.length,
    missingProfileDates,
    mirrorThrough: mirrorLatest,
    officialThrough: (data.events || []).map(event => event.date).sort().at(-1) || mirrorLatest
  };

  // The engine's `history` field is now canonical competitive history. Unverified records fail closed.
  fighter.history = coverageVerified ? meetings.map(meeting => ({
    date: meeting.date,
    result: meeting.result,
    opponentIds: meeting.opponentId ? [meeting.opponentId] : [],
    opponentStatsId: meeting.opponentStatsId || null,
    opponentName: meeting.opponentName,
    event: meeting.event,
    weightClass: meeting.weightClass || null,
    method: meeting.method || null,
    round: meeting.round || null,
    time: meeting.time || null,
    fightStatsId: meeting.fightStatsId || null,
    source: meeting.source,
    sourceUrl: meeting.sourceUrl,
    text: `${meeting.event}: ${fighter.name} vs ${meeting.opponentName}. ${meeting.result}. ${meeting.method || ''}`.trim()
  })) : [];
  fighter.lastFight = coverageVerified ? fighter.history[0]?.date || null : null;
  fighter.historyCoverage = coverageVerified
    ? 'Canonical UFCStats fight ledger reconciled with recent official UFC event results.'
    : 'Structured UFC fight history could not be verified; matchmaking is withheld.';

  if (coverageVerified) verified++;
  if (participants.has(fighter.id) && coverageVerified) participantVerified++;
  if (fighter.active && (profileUfc.length > 0 || meetings.length > 0 || participants.has(fighter.id))) {
    activePopulation++;
    if (coverageVerified) activeVerified++;
  }
}

const participantCount = participants.size;
const activeRatio = activePopulation ? activeVerified / activePopulation : 0;
if (participantVerified !== participantCount) {
  throw new Error(`Verified history must cover every displayed event fighter: ${participantVerified}/${participantCount}. Missing: ${missNames.slice(0, 20).join(', ')}`);
}
if (activePopulation && activeRatio < 0.8) {
  throw new Error(`Verified history coverage is too low for the active matchmaking population: ${activeVerified}/${activePopulation} (${(activeRatio * 100).toFixed(1)}%).`);
}

data.sources ||= {};
data.sources.meetings = {
  source: 'UFCStats',
  historyModelVersion: 2,
  transport: 'GitHub mirrors + official UFC result reconciliation',
  url: FIGHT_URL,
  fighterDirectoryUrl: FIGHTER_URL,
  checkedAt,
  mirrorThrough: mirrorLatest,
  mirrorFrom: mirrorEarliest,
  officialThrough: (data.events || []).map(event => event.date).sort().at(-1) || mirrorLatest,
  note: 'Canonical structured UFC fight histories for the matchmaking roster. UFCStats fighter IDs anchor identity; recent official UFC event results reconcile the newest cards.'
};
data.coverage = {
  ...(data.coverage || {}),
  historyModelVersion: 2,
  verifiedRosterHistories: verified,
  rosterHistoryPopulation: data.fighters.length,
  activeHistoryPopulation: activePopulation,
  verifiedActiveHistories: activeVerified,
  verifiedActiveHistoryRatio: Number(activeRatio.toFixed(4)),
  participantHistoriesRequested: participantCount,
  verifiedParticipantHistories: participantVerified,
  ufcStatsIdentityMisses: identityMisses,
  ufcStatsAmbiguousIdentities: ambiguousIdentities,
  ufcStatsMissNames: missNames,
  canonicalOpponentLinks,
  unresolvedOpponentLinks,
  mirrorFightCount: mirrorFights.length,
  mirrorFighterCount: statsFighters.length
};

validateData(data);
const tmp = `${DATA_PATH}.verified-history-v2.tmp`;
await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
await fs.rename(tmp, DATA_PATH);
console.log(`Verified history v2: ${verified}/${data.fighters.length} roster records; ${activeVerified}/${activePopulation} active matchmaking histories (${(activeRatio * 100).toFixed(1)}%); ${participantVerified}/${participantCount} displayed-event fighters; ${mirrorFights.length} UFC fights; ${statsFighters.length} UFCStats identities.`);
console.log(`Opponent identity links: ${canonicalOpponentLinks} canonical / ${unresolvedOpponentLinks} historical-only.`);
if (missNames.length) console.warn(`Unmatched/ambiguous UFCStats identities (${missNames.length} relevant): ${missNames.slice(0, 30).join(', ')}${missNames.length > 30 ? ', …' : ''}`);
