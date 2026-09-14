import fs from 'node:fs/promises';
import path from 'node:path';
import { clean, key } from './sources/ufc.mjs';
import { parseMirrorFighters, parseMirrorHistory } from './sources/ufcstats.mjs';
import { reconcileProfileHistory } from './history-reconcile.mjs';
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
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MMAMatlockMatchmaker/2.1; +https://mmamatlock.com/)' },
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
  const tokens = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const variants = new Set([key(raw)]);
  if (tokens.length > 2 && SUFFIXES.has(tokens.at(-1))) variants.add(key(tokens.slice(0, -1).join(' ')));
  return [...variants].filter(Boolean);
}

function isProfileUfcBout(entry) {
  const text = clean(entry?.text || entry?.event || '');
  return /^(?:UFC\b|Noche UFC\b|The Ultimate Fighter\b)/i.test(text);
}
function profileHistoryOf(fighter) {
  return Array.isArray(fighter.profileHistory) ? fighter.profileHistory : Array.isArray(fighter.history) ? fighter.history : [];
}
function nearDate(a, b, toleranceDays = 2) {
  const left = Date.parse(a), right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= toleranceDays * DAY;
}

const [fightCsv, eventCsv, fighterCsv] = await Promise.all([getText(FIGHT_URL), getText(EVENT_URL), getText(FIGHTER_URL)]);
const statsFighters = parseMirrorFighters(fighterCsv);
const mirrorFights = parseMirrorHistory(fightCsv, eventCsv, cutoff);
if (statsFighters.length < 3000) throw new Error(`UFCStats fighter directory is implausibly small: ${statsFighters.length}`);
if (mirrorFights.length < 8000) throw new Error(`UFCStats fight ledger is implausibly small: ${mirrorFights.length}`);
const mirrorLatest = mirrorFights[0]?.date;
const mirrorEarliest = mirrorFights.at(-1)?.date;
if (!mirrorLatest || !mirrorEarliest) throw new Error('UFCStats mirror has no usable date span.');

const statsById = new Map(statsFighters.map(fighter => [fighter.id, fighter]));
const statsByVariant = new Map();
for (const fighter of statsFighters) for (const variant of nameVariants(fighter.name)) {
  const ids = statsByVariant.get(variant) || new Set();
  ids.add(fighter.id);
  statsByVariant.set(variant, ids);
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

const eventNamesById = new Map();
const participants = new Set();
for (const event of data.events || []) for (const bout of event.bouts || []) for (const entry of bout.fighters || []) {
  participants.add(entry.id);
  const names = eventNamesById.get(entry.id) || new Set();
  if (entry.name) names.add(entry.name);
  eventNamesById.set(entry.id, names);
}
const fighterById = new Map(data.fighters.map(fighter => [fighter.id, fighter]));
function allKnownNames(fighter) {
  const names = new Set([fighter.name, ...(eventNamesById.get(fighter.id) || [])]);
  for (const alias of fighter.aliases || []) if (typeof alias === 'string' && alias) names.add(alias.replace(/-/g, ' '));
  return [...names].filter(Boolean);
}

// Build a source-native ledger before canonical identity matching. This lets fight signatures resolve
// renamed/ambiguous UFC.com identities without guessing from spelling alone.
const rawByStatsId = new Map();
const rawByLedgerName = new Map();
const signatureIndex = new Map();
function push(map, id, value) {
  if (!id) return;
  const list = map.get(id) || [];
  list.push(value);
  map.set(id, list);
}
function rawMeeting(fight, opponentStats, opponentName, result) {
  return {
    fightStatsId: fight.fightStatsId || null,
    opponentStatsId: opponentStats?.id || null,
    opponentLedgerKey: key(opponentName),
    opponentId: null,
    opponentName,
    date: fight.date,
    result,
    event: fight.event,
    competitionClass: fight.competitionClass || 'ufc',
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
  const a = rawMeeting(fight, bStats, fight.bName, fight.aResult);
  const b = rawMeeting(fight, aStats, fight.aName, fight.bResult);
  if (aStats) push(rawByStatsId, aStats.id, a);
  if (bStats) push(rawByStatsId, bStats.id, b);
  push(rawByLedgerName, key(fight.aName), a);
  push(rawByLedgerName, key(fight.bName), b);
  if (aStats) push(signatureIndex, `${fight.date}|${fight.aResult}`, { statsId: aStats.id, opponentName: fight.bName });
  if (bStats) push(signatureIndex, `${fight.date}|${fight.bResult}`, { statsId: bStats.id, opponentName: fight.aName });
}

function directIdentity(fighter) {
  const previousId = fighter.meetingCoverage?.ufcStatsId;
  if (previousId && statsById.has(previousId)) return { statsId: previousId, ledgerKey: key(statsById.get(previousId).name), method: 'stable-ufcstats-id' };
  const primary = statsByVariant.get(key(fighter.name));
  if (primary?.size === 1) {
    const statsId = [...primary][0];
    return { statsId, ledgerKey: key(statsById.get(statsId).name), method: 'exact-name' };
  }
  const candidates = new Set();
  for (const name of allKnownNames(fighter)) for (const variant of nameVariants(name)) {
    const matches = statsByVariant.get(variant);
    if (matches?.size === 1) candidates.add([...matches][0]);
  }
  if (candidates.size === 1) {
    const statsId = [...candidates][0];
    return { statsId, ledgerKey: key(statsById.get(statsId).name), method: 'unique-alias' };
  }
  return null;
}

const identities = new Map();
for (const fighter of data.fighters) {
  const identity = directIdentity(fighter);
  if (identity) identities.set(fighter.id, identity);
}
const directlyClaimedStats = new Set([...identities.values()].map(identity => identity.statsId).filter(Boolean));

function opponentNameMatches(entry, opponentName) {
  const opponentKey = key(opponentName);
  if (!opponentKey) return false;
  if (key(entry.text || '').includes(opponentKey)) return true;
  for (const opponentId of entry.opponentIds || []) {
    const opponent = fighterById.get(opponentId);
    if (!opponent) continue;
    if (allKnownNames(opponent).some(name => nameVariants(name).includes(opponentKey))) return true;
  }
  return false;
}

function signatureIdentity(fighter) {
  const bouts = profileHistoryOf(fighter).filter(isProfileUfcBout).slice(0, 10);
  if (!bouts.length) return null;
  const scores = new Map();
  for (const bout of bouts) {
    if (!bout.date || !['W', 'L', 'D', 'NC'].includes(bout.result)) continue;
    const sides = signatureIndex.get(`${bout.date}|${bout.result}`) || [];
    for (const side of sides) {
      if (directlyClaimedStats.has(side.statsId)) continue;
      const score = scores.get(side.statsId) || { points: 0, dates: new Set(), opponentMatches: 0 };
      score.points += 2;
      score.dates.add(bout.date);
      if (opponentNameMatches(bout, side.opponentName)) { score.points += 4; score.opponentMatches++; }
      scores.set(side.statsId, score);
    }
  }
  const ranked = [...scores.entries()].sort((a, b) => b[1].points - a[1].points || b[1].dates.size - a[1].dates.size || a[0].localeCompare(b[0]));
  if (!ranked.length) return null;
  const [topId, top] = ranked[0], runner = ranked[1]?.[1];
  const enoughEvidence = top.dates.size >= 2 || top.dates.size === 1 && top.opponentMatches >= 1 && bouts.length <= 2;
  const uniqueLead = !runner || top.points >= runner.points + 3;
  if (!enoughEvidence || !uniqueLead) return null;
  return { statsId: topId, ledgerKey: key(statsById.get(topId)?.name), method: 'fight-signature' };
}
for (const fighter of data.fighters) if (!identities.has(fighter.id)) {
  const identity = signatureIdentity(fighter);
  if (identity) identities.set(fighter.id, identity);
}

// Last-resort source-native identity for brand-new fighters whose UFCStats bout exists before the
// fighter-directory mirror catches up. It is only accepted when profile dates/results all reconcile.
function ledgerIdentity(fighter) {
  const profileBouts = profileHistoryOf(fighter).filter(isProfileUfcBout).slice(0, 10);
  const candidates = new Set();
  for (const name of allKnownNames(fighter)) {
    const ledgerKey = key(name);
    if (ledgerKey && rawByLedgerName.has(ledgerKey)) candidates.add(ledgerKey);
  }
  const viable = [...candidates].filter(ledgerKey => {
    const meetings = rawByLedgerName.get(ledgerKey) || [];
    return reconcileProfileHistory(profileBouts, meetings).missing.length === 0;
  });
  return viable.length === 1 ? { statsId: null, ledgerKey: viable[0], method: 'ledger-name' } : null;
}
for (const fighter of data.fighters) if (!identities.has(fighter.id)) {
  const identity = ledgerIdentity(fighter);
  if (identity) identities.set(fighter.id, identity);
}

const canonicalByStatsId = new Map();
const canonicalByLedgerKey = new Map();
for (const fighter of data.fighters) {
  const identity = identities.get(fighter.id);
  if (!identity) continue;
  if (identity.statsId) {
    const existing = canonicalByStatsId.get(identity.statsId);
    canonicalByStatsId.set(identity.statsId, existing && existing !== fighter.id ? null : fighter.id);
  }
  if (identity.ledgerKey) {
    const existing = canonicalByLedgerKey.get(identity.ledgerKey);
    canonicalByLedgerKey.set(identity.ledgerKey, existing && existing !== fighter.id ? null : fighter.id);
  }
}

function rawMeetingsFor(identity) {
  if (!identity) return [];
  if (identity.statsId) return rawByStatsId.get(identity.statsId) || [];
  if (identity.ledgerKey) return rawByLedgerName.get(identity.ledgerKey) || [];
  return [];
}
function resolveOpponentId(meeting) {
  if (meeting.opponentStatsId) {
    const canonical = canonicalByStatsId.get(meeting.opponentStatsId);
    if (canonical) return canonical;
  }
  if (meeting.opponentLedgerKey) {
    const canonical = canonicalByLedgerKey.get(meeting.opponentLedgerKey);
    if (canonical) return canonical;
  }
  return null;
}

const ledgerByCanonical = new Map();
for (const fighter of data.fighters) {
  const identity = identities.get(fighter.id);
  const meetings = rawMeetingsFor(identity).map(meeting => ({ ...meeting, opponentId: resolveOpponentId(meeting) }));
  ledgerByCanonical.set(fighter.id, meetings);
}

// Official UFC cards reconcile the newest results on top of the mirrored source-native ledger.
for (const event of data.events || []) for (const bout of event.bouts || []) {
  if (!Array.isArray(bout.fighters) || bout.fighters.length !== 2) continue;
  const [left, right] = bout.fighters;
  for (const [self, opponent] of [[left, right], [right, left]]) {
    const list = ledgerByCanonical.get(self.id) || [];
    const opponentIdentity = identities.get(opponent.id);
    list.push({
      fightStatsId: null,
      opponentStatsId: opponentIdentity?.statsId || null,
      opponentLedgerKey: opponentIdentity?.ledgerKey || key(opponent.name),
      opponentId: opponent.id,
      opponentName: opponent.name,
      date: event.date,
      result: self.result,
      event: event.title,
      competitionClass: 'ufc',
      weightClass: bout.division || null,
      method: bout.method || null,
      round: bout.round || null,
      time: bout.time || null,
      referee: null,
      details: null,
      source: 'UFC.com',
      sourceUrl: event.source
    });
    ledgerByCanonical.set(self.id, list);
  }
}

function dedupeMeetings(meetings) {
  const unique = new Map();
  for (const meeting of meetings) {
    const opponentKey = meeting.opponentId || meeting.opponentStatsId || meeting.opponentLedgerKey || key(meeting.opponentName);
    const id = `${meeting.date}|${opponentKey}`;
    const existing = unique.get(id);
    if (!existing) { unique.set(id, meeting); continue; }
    if (meeting.source === 'UFC.com') unique.set(id, { ...existing, ...meeting, fightStatsId: existing.fightStatsId || meeting.fightStatsId });
    else if (!existing.fightStatsId && meeting.fightStatsId) unique.set(id, { ...existing, ...meeting });
  }
  return [...unique.values()].sort((a, b) => b.date.localeCompare(a.date) || String(a.opponentName).localeCompare(String(b.opponentName)));
}

function canonicalEntry(fighter, meeting) {
  return {
    date: meeting.date,
    result: meeting.result,
    opponentIds: meeting.opponentId ? [meeting.opponentId] : [],
    opponentStatsId: meeting.opponentStatsId || null,
    opponentName: meeting.opponentName,
    event: meeting.event,
    competitionClass: meeting.competitionClass || 'ufc',
    weightClass: meeting.weightClass || null,
    method: meeting.method || null,
    round: meeting.round || null,
    time: meeting.time || null,
    fightStatsId: meeting.fightStatsId || null,
    source: meeting.source,
    sourceUrl: meeting.sourceUrl,
    text: `${meeting.event}: ${fighter.name} vs ${meeting.opponentName}. ${meeting.result}. ${meeting.method || ''}`.trim()
  };
}

let verified = 0;
let participantVerified = 0;
let activePopulation = 0;
let activeVerified = 0;
let identityMisses = 0;
let canonicalOpponentLinks = 0;
let unresolvedOpponentLinks = 0;
let sourceDiscrepancyCount = 0;
const missNames = [];
const participantMissNames = [];
const discrepancyExamples = [];

for (const fighter of data.fighters) {
  const identity = identities.get(fighter.id) || null;
  const profileHistory = profileHistoryOf(fighter);
  const meetings = dedupeMeetings(ledgerByCanonical.get(fighter.id) || []);
  const profileUfc = profileHistory.filter(isProfileUfcBout);
  const reconciliation = reconcileProfileHistory(profileUfc.slice(0, 12), meetings);
  const duplicateIdentity = identity?.statsId && canonicalByStatsId.get(identity.statsId) === null || identity?.ledgerKey && canonicalByLedgerKey.get(identity.ledgerKey) === null;
  const coverageVerified = Boolean(identity && !duplicateIdentity && reconciliation.missing.length === 0 && (meetings.length > 0 || profileUfc.length === 0));
  const matchedMeetings = new Set(reconciliation.matches.map(match => match.meeting));
  const canonicalMeetings = meetings.filter(meeting => meeting.source === 'UFC.com' || ['ufc', 'tuf'].includes(meeting.competitionClass) || matchedMeetings.has(meeting));

  if (!identity) {
    identityMisses++;
    if (fighter.active || participants.has(fighter.id)) missNames.push(`${fighter.name} (not-found)`);
    if (participants.has(fighter.id)) participantMissNames.push(`${fighter.name} (not-found)`);
  } else if (duplicateIdentity || !coverageVerified) {
    const missing = reconciliation.missing.map(entry => `${entry.date}:${entry.result || '?'}`).join('|');
    if (fighter.active || participants.has(fighter.id)) missNames.push(`${fighter.name} (${duplicateIdentity ? 'identity-collision' : `history-gap:${missing}`})`);
    if (participants.has(fighter.id)) participantMissNames.push(`${fighter.name} (${duplicateIdentity ? 'identity-collision' : `history-gap:${missing}`})`);
  }

  sourceDiscrepancyCount += reconciliation.discrepancies.length;
  for (const discrepancy of reconciliation.discrepancies.slice(0, 3)) {
    if (discrepancyExamples.length < 20) discrepancyExamples.push(`${fighter.name}: ${discrepancy.type} ${JSON.stringify(discrepancy)}`);
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
    ufcStatsId: identity?.statsId || null,
    ledgerNameKey: identity?.ledgerKey || null,
    identityMethod: identity?.method || 'not-found',
    bouts: meetings.length,
    canonicalBouts: coverageVerified ? canonicalMeetings.length : 0,
    canonicalOpponentLinks: meetings.filter(meeting => meeting.opponentId).length,
    unresolvedOpponentLinks: meetings.filter(meeting => !meeting.opponentId).length,
    profileUfcBouts: profileUfc.length,
    missingProfileBouts: reconciliation.missing.map(entry => ({ date: entry.date, result: entry.result || null, text: entry.text || null })),
    sourceDiscrepancies: reconciliation.discrepancies,
    mirrorThrough: mirrorLatest,
    officialThrough: (data.events || []).map(event => event.date).sort().at(-1) || mirrorLatest
  };

  // Engine-facing history is canonical UFC competitive history. Verified feeder meetings remain in
  // verifiedMeetings for rematch detection, but do not inflate UFC streak/experience unless UFC.com
  // itself lists the bout as part of the fighter's UFC history.
  fighter.history = coverageVerified ? canonicalMeetings.map(meeting => canonicalEntry(fighter, meeting)) : [];
  fighter.lastFight = coverageVerified ? fighter.history[0]?.date || null : null;
  fighter.historyCoverage = coverageVerified
    ? 'Canonical UFCStats fight ledger reconciled with official UFC event results; UFC.com profile prose is retained as a fallible cross-check.'
    : 'Structured UFC fight history could not be verified; matchmaking is withheld.';

  if (coverageVerified) verified++;
  if (participants.has(fighter.id) && coverageVerified) participantVerified++;
  if (fighter.active && (profileUfc.length > 0 || canonicalMeetings.length > 0 || participants.has(fighter.id))) {
    activePopulation++;
    if (coverageVerified) activeVerified++;
  }
}

const participantCount = participants.size;
const activeRatio = activePopulation ? activeVerified / activePopulation : 0;
console.log(`History-v2 preflight: participants ${participantVerified}/${participantCount}; active population ${activeVerified}/${activePopulation} (${(activeRatio * 100).toFixed(1)}%).`);
console.log(`Profile cross-check: ${sourceDiscrepancyCount} source discrepancy record(s) reconciled without letting profile prose override structured history.`);
if (discrepancyExamples.length) console.log(`Source discrepancy examples: ${discrepancyExamples.join(' || ')}`);
if (participantVerified !== participantCount) throw new Error(`Verified history must cover every displayed event fighter: ${participantVerified}/${participantCount}. Missing: ${participantMissNames.join(', ')}`);
if (activePopulation && activeRatio < 0.9) throw new Error(`Verified history coverage is too low for the active matchmaking population: ${activeVerified}/${activePopulation} (${(activeRatio * 100).toFixed(1)}%).`);

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
  note: 'Canonical structured fight histories for the matchmaking roster. Stable UFCStats fighter IDs are preferred; fight-signature and source-native ledger identity resolve naming differences; profile prose is cross-checked but cannot override structured fight records.'
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
  ufcStatsMissNames: missNames,
  canonicalOpponentLinks,
  unresolvedOpponentLinks,
  sourceDiscrepancyCount,
  mirrorFightCount: mirrorFights.length,
  mirrorFighterCount: statsFighters.length
};

validateData(data);
const tmp = `${DATA_PATH}.verified-history-v2.tmp`;
await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
await fs.rename(tmp, DATA_PATH);
console.log(`Verified history v2: ${verified}/${data.fighters.length} roster records; ${activeVerified}/${activePopulation} active matchmaking histories (${(activeRatio * 100).toFixed(1)}%); ${participantVerified}/${participantCount} displayed-event fighters; ${mirrorFights.length} tracked fights; ${statsFighters.length} UFCStats identities.`);
console.log(`Opponent identity links: ${canonicalOpponentLinks} canonical / ${unresolvedOpponentLinks} historical-only.`);
if (missNames.length) console.warn(`Withheld histories (${missNames.length} relevant): ${missNames.slice(0, 30).join(', ')}${missNames.length > 30 ? ', …' : ''}`);
