import fs from 'node:fs/promises';
import { DATA_PATH, norm } from './upcoming-events-data.mjs';

const OUT_PATH = '_data/upcoming_events_verdict_watch.json';
const EVENTS_URL = 'https://verdictmma.com/events';
const ORIGIN = 'https://verdictmma.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const TIMEOUT = 20000;

const decode = (value = '') => String(value)
  .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
  .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(Number(x)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#039;|&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>');

const text = (html = '') => decode(String(html)
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim();

const dateFromText = value => {
  const match = String(value || '').match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(\d{4})\b/i);
  if (!match) return '';
  const date = new Date(`${match[1]} ${match[2]}, ${match[3]} 12:00:00 UTC`);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

const todayEt = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

const daysApart = (a, b) => Math.abs((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
const promotionFrom = label => {
  if (/\bDWCS/i.test(label)) return 'dwcs';
  if (/\bRIZIN/i.test(label)) return 'rizin';
  if (/\bPFL/i.test(label)) return 'pfl';
  if (/\b(?:UFC|UFN)\b/i.test(label)) return 'ufc';
  return '';
};

async function get(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT),
    headers: {
      'user-agent': UA,
      'accept-language': 'en-US,en;q=0.9',
      accept: 'text/html,application/xhtml+xml,*/*'
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.text();
}

function discoverVerdictEvents(html) {
  const found = new Map();
  const rx = /<a\b[^>]*href=["']\/event\/(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(rx)) {
    const id = match[1];
    const label = text(match[2]);
    const date = dateFromText(label);
    if (!date || label.length < 4) continue;
    const promotion = promotionFrom(label);
    const candidate = { id, url: `${ORIGIN}/event/${id}`, label, date, promotion };
    const current = found.get(id);
    if (!current || candidate.label.length > current.label.length) found.set(id, candidate);
  }
  return [...found.values()];
}

function localBoutList(event) {
  return (event.sections || []).flatMap(section => section.bouts || []).map(bout => ({
    order: bout.order,
    fighters: (bout.fighters || []).map(fighter => fighter.name).filter(Boolean)
  })).filter(bout => bout.fighters.length === 2);
}

function titleScore(event, verdict) {
  const local = norm(`${event.promotion || ''} ${event.title || ''}`);
  const remote = norm(verdict.label);
  let score = 0;
  for (const token of local.split(/\s+/).filter(token => token.length >= 3)) if (remote.includes(token)) score += 1;
  if (event.promotion_key === verdict.promotion) score += 8;
  if (event.date === verdict.date) score += 8;
  else if (daysApart(event.date, verdict.date) === 1) score += 3;
  if (event.promotion_key === 'dwcs') {
    const week = String(event.title || '').match(/week\s*(\d+)/i)?.[1];
    if (week && new RegExp(`DWCS(?:10)?W?${week}\\b`, 'i').test(verdict.label.replace(/\s+/g, ''))) score += 8;
  }
  return score;
}

function matchVerdictEvent(event, verdictEvents) {
  return verdictEvents
    .filter(candidate => candidate.promotion === event.promotion_key && daysApart(event.date, candidate.date) <= 1)
    .map(candidate => ({ candidate, score: titleScore(event, candidate) }))
    .sort((a, b) => b.score - a.score)[0]?.candidate || null;
}

function fighterAppears(label, name) {
  const haystack = norm(label);
  const wanted = norm(name);
  if (!haystack || !wanted) return false;
  if (haystack.includes(wanted)) return true;
  const parts = wanted.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return haystack.includes(parts[0]);
  const first = parts[0];
  const last = parts.at(-1);
  return haystack.includes(last) && (first.length < 3 || haystack.includes(first));
}

function verdictCardFromHtml(html, localBouts) {
  const plain = text(html);
  const countMatch = plain.match(/\bAll\s+(\d+)\s+Main\s+\d+(?:\s+Prelims\s+\d+)?\b/i)
    || plain.match(/\bAll\s+(\d+)\b/i);
  const remoteCount = countMatch ? Number(countMatch[1]) : null;
  const confirmed = [];
  const missing = [];

  for (const bout of localBouts) {
    const hit = fighterAppears(plain, bout.fighters[0]) && fighterAppears(plain, bout.fighters[1]);
    (hit ? confirmed : missing).push(bout);
  }

  // A current Verdict event page is usable if it exposes its card count or confirms
  // at least one of our local matchups. We don't require per-fight hyperlinks.
  return {
    readable: Number.isFinite(remoteCount) || confirmed.length > 0,
    remoteCount,
    confirmed,
    missing
  };
}

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const currentEvents = (data.events || []).filter(event => event.date >= todayEt());

let eventsHtml;
try {
  eventsHtml = await get(EVENTS_URL);
} catch (error) {
  console.warn(`Verdict watchdog: events page unavailable; preserving previous snapshot. ${error.message}`);
  process.exit(0);
}

const verdictEvents = discoverVerdictEvents(eventsHtml);
if (!verdictEvents.length) {
  console.warn('Verdict watchdog: no usable upcoming event links; preserving previous snapshot.');
  process.exit(0);
}

const coverage = [];
const discrepancies = [];

for (const event of currentEvents) {
  const localBouts = localBoutList(event);
  const match = matchVerdictEvent(event, verdictEvents);
  if (!match) {
    coverage.push({
      event_id: event.id,
      promotion: event.promotion_key,
      date: event.date,
      title: event.title,
      status: 'coverage_gap',
      local_fight_count: localBouts.length
    });
    continue;
  }

  let card = { readable: false, remoteCount: null, confirmed: [], missing: [] };
  try {
    card = verdictCardFromHtml(await get(match.url), localBouts);
  } catch (error) {
    console.warn(`Verdict watchdog: could not read ${match.url}: ${error.message}`);
  }

  if (card.readable) {
    if (Number.isFinite(card.remoteCount) && card.remoteCount !== localBouts.length) {
      discrepancies.push({
        type: 'bout_count_mismatch',
        event_id: event.id,
        verdict_event_id: match.id,
        local_fight_count: localBouts.length,
        verdict_fight_count: card.remoteCount
      });
    }

    for (const bout of card.missing) {
      discrepancies.push({
        type: 'local_bout_not_found_on_verdict',
        event_id: event.id,
        verdict_event_id: match.id,
        order: bout.order,
        fighters: bout.fighters
      });
    }
  }

  if (daysApart(event.date, match.date) > 0) {
    discrepancies.push({
      type: 'date_mismatch',
      event_id: event.id,
      verdict_event_id: match.id,
      local_date: event.date,
      verdict_date: match.date
    });
  }

  coverage.push({
    event_id: event.id,
    promotion: event.promotion_key,
    date: event.date,
    title: event.title,
    status: card.readable ? 'matched' : 'event_matched_card_unreadable',
    verdict_event_id: match.id,
    verdict_url: match.url,
    verdict_date: match.date,
    local_fight_count: localBouts.length,
    verdict_fight_count: card.readable ? card.remoteCount : null,
    confirmed_local_bouts: card.readable ? card.confirmed.length : null
  });
}

coverage.sort((a, b) => a.date.localeCompare(b.date) || a.event_id.localeCompare(b.event_id));
discrepancies.sort((a, b) => `${a.event_id}|${a.type}|${a.order || 0}`.localeCompare(`${b.event_id}|${b.type}|${b.order || 0}`));

const output = {
  schema_version: 1,
  source: 'Verdict MMA',
  source_url: EVENTS_URL,
  mode: 'read-only-watchdog',
  coverage,
  discrepancies
};

const serialized = JSON.stringify(output, null, 2) + '\n';
let previous = '';
try { previous = await fs.readFile(OUT_PATH, 'utf8'); } catch {}
if (previous !== serialized) {
  await fs.writeFile(OUT_PATH, serialized);
  console.log(`Verdict watchdog updated: ${coverage.length} event(s), ${discrepancies.length} discrepancy item(s).`);
} else {
  console.log(`Verdict watchdog unchanged: ${coverage.length} event(s), ${discrepancies.length} discrepancy item(s).`);
}
