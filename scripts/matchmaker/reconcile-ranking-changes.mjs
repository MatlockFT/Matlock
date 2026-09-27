import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const E = require('../../assets/matchmaker-engine.js');
const P = require('../../assets/matchmaker-public.js');

const DATA_PATH = 'assets/data/matchmaker/current.json';
const TRANSITION_PATH = 'assets/data/matchmaker/ranking-transition.json';
const REPORT_PATH = 'assets/data/matchmaker/ranking-reconciliation.json';

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const sameDivision = (a, b) => normalize(a) === normalize(b);

async function readJson(path, fallback = null) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

function rankingEntriesForFighter(fighter, rankings) {
  const exact = rankings.filter(item => item?.id && item.id === fighter.id);
  const matches = exact.length ? exact : rankings.filter(item => normalize(item?.name) === normalize(fighter.name));
  return matches.map(item => ({ division: item.division, rank: item.rank, interim: Boolean(item.interim) }));
}

function applyRankingState(fighters, rankings) {
  return fighters.map(fighter => {
    const entries = rankingEntriesForFighter(fighter, rankings);
    const primary = entries.find(item => sameDivision(item.division, fighter.division)) || null;
    return {
      ...fighter,
      rank: primary?.rank ?? null,
      champion: primary?.rank === 0,
      interim: Boolean(primary?.interim),
      rankings: entries.map(({ division, rank }) => ({ division, rank }))
    };
  });
}

function eventParticipants(event) {
  return [...new Set((event?.bouts || []).flatMap(bout => (bout.fighters || []).map(fighter => fighter.id).filter(Boolean)))];
}

function rankLabel(fighter, ctx) {
  const rank = E.rank(fighter, ctx);
  if (rank === 0) return 'Champion';
  return rank == null ? 'Unranked' : `#${rank}`;
}

function summarizeRecommendations(fighter, fighters, index, event, asOf) {
  const ctx = { asOf, event, locks: [], overrides: {}, fighterIndex: index };
  return P.selectRecommendations(fighter, fighters, E, ctx).map(rec => ({
    id: rec.fighter.id,
    name: rec.fighter.name,
    rank: rankLabel(rec.fighter, ctx),
    case: rec.case?.code || null,
    score: rec.score ?? null
  }));
}

const data = await readJson(DATA_PATH);
const transition = await readJson(TRANSITION_PATH);

if (!data || !Array.isArray(data.fighters) || !Array.isArray(data.events)) throw new Error('Current Matchmaker data is missing or invalid.');

if (!transition || transition.schemaVersion !== 1 || transition.detectedAt !== data.generatedAt) {
  console.log('Ranking reconciliation: no newly detected rankings transition in this refresh.');
} else {
  if (!Array.isArray(transition.before) || !Array.isArray(transition.after) || !Array.isArray(transition.changes)) {
    throw new Error('Ranking transition payload is incomplete.');
  }

  const beforeFighters = applyRankingState(data.fighters, transition.before);
  const afterFighters = data.fighters;
  const beforeIndex = new Map(beforeFighters.map(fighter => [fighter.id, fighter]));
  const afterIndex = new Map(afterFighters.map(fighter => [fighter.id, fighter]));
  const recommendationChanges = [];

  for (const event of data.events) {
    for (const fighterId of eventParticipants(event)) {
      const beforeFighter = beforeIndex.get(fighterId);
      const afterFighter = afterIndex.get(fighterId);
      if (!beforeFighter || !afterFighter || !afterFighter.active || afterFighter.meetingCoverage?.verified !== true) continue;

      const before = summarizeRecommendations(beforeFighter, beforeFighters, beforeIndex, event, data.generatedAt);
      const after = summarizeRecommendations(afterFighter, afterFighters, afterIndex, event, data.generatedAt);
      const beforeIds = before.map(item => item.id);
      const afterIds = after.map(item => item.id);
      if (JSON.stringify(beforeIds) === JSON.stringify(afterIds)) continue;

      const beforeCtx = { asOf: data.generatedAt, event, locks: [], overrides: {}, fighterIndex: beforeIndex };
      const afterCtx = { asOf: data.generatedAt, event, locks: [], overrides: {}, fighterIndex: afterIndex };
      recommendationChanges.push({
        eventId: event.id,
        event: event.title,
        eventDate: event.date,
        fighterId,
        fighter: afterFighter.name,
        fighterRankBefore: rankLabel(beforeFighter, beforeCtx),
        fighterRankAfter: rankLabel(afterFighter, afterCtx),
        before,
        after
      });
    }
  }

  recommendationChanges.sort((a, b) =>
    String(b.eventDate || '').localeCompare(String(a.eventDate || '')) ||
    String(a.fighter || '').localeCompare(String(b.fighter || ''))
  );

  const latestEvent = [...data.events].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0] || null;
  const latestEventChanges = latestEvent
    ? recommendationChanges.filter(change => change.eventId === latestEvent.id)
    : [];

  const report = {
    schemaVersion: 1,
    generatedAt: data.generatedAt,
    previousGeneratedAt: transition.previousGeneratedAt || null,
    rankingChanges: transition.changes,
    rankingChangeCount: transition.changes.length,
    recommendationChanges,
    recommendationChangeCount: recommendationChanges.length,
    latestEvent: latestEvent ? {
      id: latestEvent.id,
      title: latestEvent.title,
      date: latestEvent.date,
      changedFighters: latestEventChanges.map(change => ({
        fighterId: change.fighterId,
        fighter: change.fighter,
        fighterRankBefore: change.fighterRankBefore,
        fighterRankAfter: change.fighterRankAfter,
        before: change.before,
        after: change.after
      }))
    } : null,
    note: 'Recommendation differences are isolated by holding the refreshed roster, fight history, bookings and event results constant while swapping only the previous versus current official UFC ranking state.'
  };

  await fs.writeFile(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`Ranking reconciliation: ${transition.changes.length} official ranking change(s) produced ${recommendationChanges.length} public Matchmaker recommendation change(s)${latestEvent ? `, including ${latestEventChanges.length} on ${latestEvent.title}` : ''}.`);
}
