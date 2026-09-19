import fs from 'node:fs/promises';
import path from 'node:path';
import { clean, key, slug, parseEvent, parseProfile, parseRankings } from './matchmaker/sources/ufc.mjs';
import { parseMirrorHistory } from './matchmaker/sources/ufcstats.mjs';
import { validateData } from './matchmaker/validate.mjs';
import { reconcileRoster } from './matchmaker/roster.mjs';
import { reconcileBookings } from './matchmaker/bookings.mjs';
const root = path.resolve('assets/data/matchmaker');
const now = new Date(), checkedAt = now.toISOString(), today = checkedAt.slice(0, 10);
const cacheDir = process.env.MATCHMAKER_CACHE || path.resolve('.cache/matchmaker');
const retrievedAt = new Map();
const fresh = value => Number.isFinite(Date.parse(value)) && Date.now() - Date.parse(value) <= 3 * 86400000;
await fs.mkdir(cacheDir, { recursive: true });
await fs.mkdir(root, { recursive: true });
const read = async (file, fallback) => JSON.parse(await fs.readFile(file, 'utf8').catch(() => JSON.stringify(fallback)));
const previous = await read(path.join(root, 'current.json'), null);
async function get(url, maxAge = 0) {
  const file = path.join(cacheDir, Buffer.from(url).toString('base64url') + '.json');
  const cached = await read(file, null);
  if (cached && Date.now() - cached.at < maxAge) { retrievedAt.set(url, new Date(cached.at).toISOString()); return cached.body; }
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MMAMatlockMatchmaker/1.0; +https://mmamatlock.com/)' }, signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      const body = await response.text();
      retrievedAt.set(url, new Date().toISOString());
      await fs.writeFile(file, JSON.stringify({ at: Date.now(), body }));
      return body;
    } catch (e) { error = e; }
  }
  throw error;
}
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (cursor < items.length) { const i = cursor++; results[i] = await fn(items[i], i); } }));
  return results;
}
const rosterUrl = 'https://github.com/MatlockFT/Matlock/releases/download/ufc-roster-data/ufc-roster-state.json';
const roster = JSON.parse(await get(rosterUrl));
if (!Array.isArray(roster.canonicalFighters) || roster.activeCount < 500 || !fresh(roster.checkedAt) || !fresh(roster.eventCardMonitor?.checkedAt)) throw new Error('Missing, undersized, or stale active roster/booking monitor. No update published.');
const rankings = parseRankings(await get('https://www.ufc.com/rankings'));
const eventIndex = await get('https://www.ufc.com/events');
const eventUrls = [...new Set([...eventIndex.matchAll(/href="(?:https:\/\/www\.ufc\.com)?(\/event\/[^"#?]+)(?:#[^"]*)?"/g)].map(m => 'https://www.ufc.com' + m[1]))].slice(0, 30);
if (eventUrls.length < 5) throw new Error('Event directory incomplete');
const parsedEvents = await mapLimit(eventUrls, 4, async url => {
  try { return parseEvent(await get(url), url); } catch (e) { console.warn(e.message); return null; }
});
const completed = parsedEvents.filter(e => e?.completed && e.date <= today).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6);
if (completed.length < 2) throw new Error('Fewer than two verified completed events. Retaining previous data.');
const images = await read('_data/fighter_portraits.json', {});
const registry = roster.canonicalFighters.map(f => ({ id: slug(f.canonicalUrl), name: f.name, active: f.active === true, source: f.canonicalUrl, aliases: [...(f.profileAliases || []), ...(f.activeProfileUrls || [])].map(slug) }));
const byAlias = new Map(registry.flatMap(f => [f.id, ...f.aliases].map(id => [id, f.id])));
const resolve = id => byAlias.get(id) || id;
for (const e of parsedEvents.filter(Boolean)) for (const b of e.bouts) for (const f of b.fighters) f.id = resolve(f.id);
for (const r of rankings) r.id = resolve(r.id);
const retainedEvents = [...completed, ...(previous?.events || []).filter(e => !completed.some(c => c.id === e.id))].sort((a, b) => b.date.localeCompare(a.date));
const participants = new Set(retainedEvents.flatMap(e => e.bouts.flatMap(b => b.fighters.map(f => f.id))));
const eventNamesById = new Map();
for (const e of retainedEvents) for (const b of e.bouts) for (const entry of b.fighters) {
  const names = eventNamesById.get(entry.id) || new Set();
  if (entry.name) names.add(entry.name);
  eventNamesById.set(entry.id, names);
}
for (const entry of retainedEvents.flatMap(e => e.bouts.flatMap(b => b.fighters))) if (!registry.some(f => f.id === entry.id)) registry.push({ id: entry.id, name: entry.name, active: false, source: `https://www.ufc.com/athlete/${entry.id}`, aliases: [] });
const wanted = registry.filter(f => f.active || participants.has(f.id));
const oldFighters = new Map((previous?.fighters || []).map(f => [f.id, f]));
let failed = 0;
console.log(`Updating ${wanted.length} fighter profiles and ${completed.length} completed cards…`);
const fighters = await mapLimit(wanted, 6, async (f, i) => {
  const ranking = rankings.find(r => r.id === f.id);
  const old = oldFighters.get(f.id);
  let profile;
  try { const html = await get(f.source, participants.has(f.id) || ranking ? 1800000 : 3 * 86400000); profile = parseProfile(html, f, retrievedAt.get(f.source)); }
  catch (e) { failed++; profile = old ? { ...old, ...f } : { ...f, division: ranking?.division || null, record: null, history: [], historyCoverage: 'Unavailable', lastFight: null, checkedAt: null }; }
  if (i % 100 === 0) console.log(`Profiles processed: ${i + 1}/${wanted.length}`);
  profile.profileStatus ||= old?.profileStatus || null;
  const image = Object.entries(images).find(([name]) => key(name) === key(f.name))?.[1]?.url || completed.flatMap(e => e.bouts.flatMap(b => b.fighters)).find(x => x.id === f.id)?.image || null;
  return {
    ...profile,
    rank: ranking?.rank ?? null,
    champion: ranking?.rank === 0,
    interim: ranking?.interim || false,
    image,
    rankings: rankings.filter(r => r.id === f.id).map(({ division, rank }) => ({ division, rank })),
    verifiedMeetings: Array.isArray(old?.verifiedMeetings) ? old.verifiedMeetings : [],
    meetingCoverage: old?.meetingCoverage || null
  };
});
if (failed > wanted.length * .1) throw new Error(`${failed} profiles failed; aborting rather than replacing the roster with incomplete data.`);

const publishedFighterIds = new Set(fighters.map(f => f.id));
for (const fighter of fighters) {
  if (!Array.isArray(fighter.verifiedMeetings)) continue;
  fighter.verifiedMeetings = fighter.verifiedMeetings.map(meeting =>
    meeting?.opponentId && !publishedFighterIds.has(meeting.opponentId)
      ? { ...meeting, opponentId: null }
      : meeting
  );
}

// Narrative UFC profile history remains useful for form, but opponent IDs found here are best-effort only.
const nameKeys = registry.map(f => ({ id: f.id, name: key(f.name) })).filter(f => f.name.length > 5);
for (const f of fighters) for (const h of f.history) h.opponentIds = nameKeys.filter(n => n.id !== f.id && key(h.text).includes(n.name)).map(n => n.id);

// Official result pages are authoritative for the newest completed cards and patch delayed athlete bios.
for (const e of completed) for (const b of e.bouts) for (const entry of b.fighters) {
  const fighter = fighters.find(f => f.id === entry.id), other = b.fighters.find(f => f.id !== entry.id);
  if (!fighter) throw new Error(`Event fighter missing from canonical roster: ${entry.name}`);
  const h = fighter.history.find(h => h.date === e.date || h.opponentIds.includes(other.id) && Math.abs(Date.parse(h.date) - Date.parse(e.date)) <= 86400000);
  if (h) { h.result = entry.result; h.opponentIds = [...new Set([...h.opponentIds, other.id])]; }
  else fighter.history.push({ date: e.date, result: entry.result, opponentIds: [other.id], text: `${e.title}: ${entry.name} vs ${other.name}. ${entry.result}. ${b.method || ''}`, source: e.source });
  fighter.history.sort((a, b) => b.date.localeCompare(a.date)); fighter.lastFight = fighter.history[0]?.date || null;
}

// Prior-opponent verification uses a GitHub-hosted mirror of UFCStats because UFCStats itself serves a
// browser challenge to GitHub Actions. The mirror supplies the historical ledger and original UFCStats
// fight-detail URLs. Official UFC result pages above reconcile the newest cards.
const mirrorFightUrl = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_fight_results.csv';
const mirrorEventUrl = 'https://raw.githubusercontent.com/Greco1899/scrape_ufc_stats/main/ufc_event_details.csv';
const [fightCsv, eventCsv] = await Promise.all([get(mirrorFightUrl, 6 * 3600000), get(mirrorEventUrl, 6 * 3600000)]);
const mirrorFights = parseMirrorHistory(fightCsv, eventCsv, today);
if (mirrorFights.length < 7000) throw new Error(`UFCStats mirror is incomplete: only ${mirrorFights.length} unique UFC fights parsed.`);
const mirrorLatest = mirrorFights[0]?.date;
const mirrorEarliest = mirrorFights.at(-1)?.date;
if (!mirrorLatest || mirrorLatest < '2025-01-01' || !mirrorEarliest || mirrorEarliest > '1995-01-01') throw new Error(`UFCStats mirror date span is implausible: ${mirrorEarliest || '?'} to ${mirrorLatest || '?'}.`);
const officialWindowOldest = completed.at(-1)?.date;
if (officialWindowOldest && mirrorLatest < officialWindowOldest) throw new Error(`UFCStats mirror (${mirrorLatest}) is older than the official reconciliation window (${officialWindowOldest}).`);

const canonicalByName = new Map();
for (const entry of registry) {
  if (!publishedFighterIds.has(entry.id)) continue;
  const k = key(entry.name);
  const existing = canonicalByName.get(k);
  if (!existing) canonicalByName.set(k, entry);
  else if (existing.id !== entry.id) canonicalByName.set(k, null);
}
const ledgerByName = new Map();
const addLedger = (fighterName, meeting) => {
  const k = key(fighterName);
  if (!k) return;
  const list = ledgerByName.get(k) || [];
  list.push(meeting);
  ledgerByName.set(k, list);
};
for (const fight of mirrorFights) {
  const aCanonical = canonicalByName.get(key(fight.aName));
  const bCanonical = canonicalByName.get(key(fight.bName));
  addLedger(fight.aName, { opponentId: bCanonical?.id || null, opponentName: fight.bName, date: fight.date, result: fight.aResult, event: fight.event, source: 'UFCStats', sourceUrl: fight.sourceUrl });
  addLedger(fight.bName, { opponentId: aCanonical?.id || null, opponentName: fight.aName, date: fight.date, result: fight.bResult, event: fight.event, source: 'UFCStats', sourceUrl: fight.sourceUrl });
}

// Patch/overwrite recent ledger entries with official UFC result pages already fetched this run.
for (const e of completed) for (const b of e.bouts) {
  const [left, right] = b.fighters;
  const leftFighter = fighters.find(f => f.id === left.id);
  const rightFighter = fighters.find(f => f.id === right.id);
  if (!leftFighter || !rightFighter) continue;
  addLedger(leftFighter.name, { opponentId: rightFighter.id, opponentName: rightFighter.name, date: e.date, result: left.result, event: e.title, source: 'UFC.com', sourceUrl: e.source });
  addLedger(rightFighter.name, { opponentId: leftFighter.id, opponentName: leftFighter.name, date: e.date, result: right.result, event: e.title, source: 'UFC.com', sourceUrl: e.source });
}

const historyTargets = fighters.filter(f => participants.has(f.id));
let statsVerified = 0, statsMisses = 0;
const statsMissNames = [];
for (const f of historyTargets) {
  const lookupKeys = new Set([key(f.name), ...[...(eventNamesById.get(f.id) || [])].map(key)].filter(Boolean));
  const rawMeetings = [...lookupKeys].flatMap(nameKey => ledgerByName.get(nameKey) || []);
  const unique = new Map();
  for (const meeting of rawMeetings) {
    const meetingKey = `${meeting.date}|${meeting.opponentId || key(meeting.opponentName)}`;
    const existing = unique.get(meetingKey);
    if (!existing || meeting.source === 'UFC.com') unique.set(meetingKey, meeting);
  }
  const meetings = [...unique.values()].sort((a, b) => b.date.localeCompare(a.date));
  if (f.history.length && !meetings.length) {
    statsMisses++;
    statsMissNames.push(`${f.name} [${[...lookupKeys].join('|')}]`);
    f.verifiedMeetings = [];
    f.meetingCoverage = { source: 'UFCStats', transport: 'GitHubMirror+UFC.com', sourceUrl: mirrorFightUrl, checkedAt, verified: false, bouts: 0, mirrorThrough: mirrorLatest, officialThrough: completed[0]?.date || mirrorLatest };
    continue;
  }
  f.verifiedMeetings = meetings;
  f.meetingCoverage = {
    source: 'UFCStats',
    transport: 'GitHubMirror+UFC.com',
    sourceUrl: mirrorFightUrl,
    checkedAt,
    verified: true,
    bouts: meetings.length,
    mirrorThrough: mirrorLatest,
    officialThrough: completed[0]?.date || mirrorLatest
  };
  statsVerified++;
}
console.log(`Structured prior-opponent ledger: ${mirrorFights.length} historical fights (${mirrorEarliest}–${mirrorLatest}); ${statsVerified}/${historyTargets.length} event participants verified; ${statsMisses} name misses.`);
if (statsMissNames.length) console.warn(`Unverified participant histories: ${statsMissNames.join(', ')}`);

// Both the site schedule and roster monitor exclude bookings, even if no opponent is known yet.
const schedule = await read('_data/upcoming_events.json', { events: [] });
if (!fresh(schedule.generated_at)) throw new Error('Upcoming schedule is stale or undated');
const booked = new Map(), bookings = [];
const oldBookings = new Map((previous?.bookings || []).map(b => [b.bookingKey || `${b.pairKey}|${b.source}`, b]));
for (const e of parsedEvents.filter(e => e && !e.completed && e.date >= today)) {
  for (const b of e.bouts) { const ids = b.fighters.map(f => f.id); const pairKey = ids.slice().sort().join('|'); const bookingKey = `${pairKey}|${e.source}`; bookings.push({ bookingKey, pairKey, fighters: ids, date: e.date, event: e.title, source: e.source, firstSeen: oldBookings.get(bookingKey)?.firstSeen || checkedAt }); for (const id of ids) booked.set(id, { event: e.title, date: e.date, source: e.source }); }
}
for (const e of roster.eventCardMonitor?.events || []) if (e.startAt?.slice(0, 10) >= today) for (const url of e.athletes || []) booked.set(resolve(slug(url)), { event: e.title, date: e.startAt.slice(0, 10), source: e.url });
for (const e of schedule.events.filter(e => e.promotion_key === 'ufc' && e.date >= today)) for (const b of e.sections.flatMap(s => s.bouts)) {
  for (const entry of b.fighters) { const f = fighters.find(f => key(f.name) === key(entry.name)); if (f) booked.set(f.id, { event: e.title, date: e.date, source: e.official_url }); }
}
const rosterOverrides = await read('_data/matchmaker-roster-overrides.json', {});
for (const f of fighters) {
  f.booking = booked.get(f.id) || null;
  if (rosterOverrides[f.id]?.active === false) f.active = false;
}
const snapshotsDir = path.join(root, 'rankings'); await fs.mkdir(snapshotsDir, { recursive: true });
const snapshots = (await fs.readdir(snapshotsDir)).filter(f => f.endsWith('.json')).sort();
const events = retainedEvents;
for (const e of events) {
  const prior = snapshots.filter(s => s.slice(0, 10) < e.date).at(-1);
  e.rankingsBeforeEvent = previous?.events.find(old => old.id === e.id)?.rankingsBeforeEvent || (prior ? await read(path.join(snapshotsDir, prior), null) : null);
}
for (const b of bookings) oldBookings.set(b.bookingKey, b);
const data = {
  schemaVersion: 1,
  generatedAt: checkedAt,
  sources: {
    rankings: { url: 'https://www.ufc.com/rankings', checkedAt },
    roster: { url: rosterUrl, checkedAt: roster.checkedAt },
    bookings: { url: 'https://www.ufc.com/events', checkedAt },
    history: { url: 'https://www.ufc.com/athletes', checkedAt, note: 'Official UFC profile histories provide form context; narrative bout lists may be incomplete.' },
    meetings: { source: 'UFCStats', transport: 'GitHub mirror + official UFC result reconciliation', url: mirrorFightUrl, checkedAt, mirrorThrough: mirrorLatest, officialThrough: completed[0]?.date || mirrorLatest, note: 'Historical UFCStats fight ledger mirrored on GitHub, reconciled through the newest official UFC result pages.' }
  },
  fighters,
  events,
  rankingsCurrent: rankings,
  bookings: [...oldBookings.values()],
  coverage: {
    profileFailures: failed,
    activeFighters: fighters.filter(f => f.active).length,
    participantHistoriesRequested: historyTargets.length,
    verifiedParticipantHistories: statsVerified,
    ufcStatsNameMisses: statsMisses,
    ufcStatsMissNames: statsMissNames,
    mirrorFightCount: mirrorFights.length
  }
};
validateData(data);
reconcileRoster(data, roster, rosterOverrides);
reconcileBookings(data, roster, schedule);
await fs.writeFile(path.join(snapshotsDir, `${today}.json`), JSON.stringify({ capturedAt: checkedAt, rankings }, null, 2) + '\n', { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
await fs.writeFile(path.join(root, 'current.json.tmp'), JSON.stringify(data, null, 2) + '\n');
await fs.rename(path.join(root, 'current.json.tmp'), path.join(root, 'current.json'));
console.log(`Validated: ${fighters.length} fighters, ${events.length} cards, ${bookings.length} announced pairings. Profile failures: ${failed}. Prior-opponent coverage: ${statsVerified}/${historyTargets.length}.`);
