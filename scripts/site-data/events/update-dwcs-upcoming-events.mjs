import { readFile, writeFile } from 'node:fs/promises';
import { dateLabel, eventIsCurrent, fighter, loadData, loadPortraitCache, mergePromotion, portraitFor, updatedLabel } from './upcoming-events-data.mjs';

const SHERDOG = 'https://www.sherdog.com';
const SHERDOG_ORG = `${SHERDOG}/organizations/Dana-Whites-Contender-Series-12411`;
const UFC_DWCS = 'https://www.ufc.com/dwcs';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockDWCSUpdater/1.1; +https://mmamatlock.com/)';
const SEASON = 10;
const FIRST_DATE = new Date('2026-08-11T12:00:00Z');
const BEST_FIGHT_ODDS = 'https://www.bestfightodds.com/';
const LIVE_ODDS_PATH = 'assets/live-ufc-odds.json';
const BFO_PROVIDER_NAMES = new Map([
  [21,'FanDuel'],[22,'DraftKings'],[23,'BetMGM'],[24,'Caesars'],[25,'BetRivers'],
  [20,'BetWay'],[26,'Unibet'],[29,'Kalshi'],[28,'Polymarket']
]);
const BFO_PROVIDER_PRIORITY = [21,22,23,24,25,20,26,29,28];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const decode = (s = '') => s
  .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
  .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(Number(x)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#039;|&#39;|&apos;/gi, "'")
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>');
const text = (s = '') => decode(String(s).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const saneName = name => {
  const value = String(name || '').replace(/\s+/g, ' ').trim();
  return value.length >= 2 && value.length <= 70 && !/unknown fighter|fight card|main event|subscribe|latest news/i.test(value);
};
const normalizeWeight = value => String(value || '').replace(/women'?s/i, "Women's").replace(/\s+/g, ' ').trim();
const trackingImage = /(?:google-analytics|googletagmanager|doubleclick|analytics|tracking|pixel|beacon|\/collect(?:[/?]|$)|\/track(?:[/?]|$)|logo|sprite|placeholder)/i;

async function get(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(30000),
        headers: { 'user-agent': UA, accept: 'text/html,*/*' }
      });
      if (response.ok) return response.text();
      lastError = new Error(`${response.status} ${response.statusText} for ${url}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 3) await sleep(700 * attempt);
  }
  throw lastError;
}


function formatOdds(value) {
  const raw = String(value || '').trim();
  if (/^even$/i.test(raw)) return 'EVEN';
  const number = Number(raw.replace(/^\+/, ''));
  if (!Number.isFinite(number) || number === 0) return '';
  return number > 0 ? '+' + Math.round(number) : String(Math.round(number));
}

function normalizeOddsName(value) {
  const normalized = String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

  const aliases = new Map([
    ['salhahuddin everett', 'sal everett'],
    ['sal everett', 'sal everett'],
    ['ozzie martin', 'ozzy martin'],
    ['ozzy martin', 'ozzy martin'],
    ['roque conceicao moreira junior', 'roque conceicao'],
    ['roque conceicao moreira jr', 'roque conceicao'],
    ['roque conceicao', 'roque conceicao']
  ]);
  return aliases.get(normalized) || normalized;
}

function parseBestFightOddsMarkets(html) {
  const markets = new Map();
  for (const rowMatch of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = rowMatch[1];
    const fighterMatch = row.match(/<a\b[^>]*href=["']\/fighters\/[^"']+["'][^>]*>[\s\S]*?<span\b[^>]*class=["'][^"']*\bt-b-fcc\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
    const fighterName = text(fighterMatch?.[1] || '');
    if (!fighterName) continue;
    const cells = [...row.matchAll(/<td\b[^>]*data-li=["']\[(\d+),([12]),(\d+)\]["'][^>]*>([\s\S]*?)<\/td>/gi)];
    for (const cell of cells) {
      const providerId = Number(cell[1]);
      const side = Number(cell[2]);
      const matchupId = String(cell[3]);
      const moneyline = formatOdds(text(cell[4]).match(/(?:[+-]\d{2,5}|EVEN)/i)?.[0] || '');
      if (!moneyline) continue;
      if (!markets.has(matchupId)) markets.set(matchupId, { fighters:{}, prices:new Map() });
      const market = markets.get(matchupId);
      market.fighters[side] = fighterName;
      if (!market.prices.has(providerId)) market.prices.set(providerId, {});
      market.prices.get(providerId)[side] = moneyline;
    }
  }

  return [...markets.entries()].map(([matchupId, market]) => {
    if (!market.fighters[1] || !market.fighters[2]) return null;
    for (const providerId of BFO_PROVIDER_PRIORITY) {
      const prices = market.prices.get(providerId);
      if (!prices?.[1] || !prices?.[2]) continue;
      return {
        matchupId,
        provider:BFO_PROVIDER_NAMES.get(providerId) || 'BestFightOdds',
        fighters:[
          { name:market.fighters[1], moneyline:prices[1] },
          { name:market.fighters[2], moneyline:prices[2] }
        ]
      };
    }
    return null;
  }).filter(Boolean);
}

function bestFightOddsPair(markets, fighterA, fighterB) {
  const a = normalizeOddsName(fighterA);
  const b = normalizeOddsName(fighterB);
  for (const market of markets) {
    const first = market.fighters?.[0];
    const second = market.fighters?.[1];
    if (!first || !second) continue;
    const one = normalizeOddsName(first.name);
    const two = normalizeOddsName(second.name);
    if (one === a && two === b) return { a:first.moneyline, b:second.moneyline, provider:market.provider };
    if (one === b && two === a) return { a:second.moneyline, b:first.moneyline, provider:market.provider };
  }
  return null;
}

async function enrichDwcsOdds(event) {
  let html;
  try {
    html = await get(BEST_FIGHT_ODDS);
  } catch (error) {
    console.warn('DWCS BestFightOdds unavailable: ' + error.message);
    return 0;
  }

  const markets = parseBestFightOddsMarkets(html);
  let filled = 0;
  for (const section of event.sections || []) {
    for (const bout of section.bouts || []) {
      const left = bout.fighters?.[0];
      const right = bout.fighters?.[1];
      if (!left?.name || !right?.name) continue;
      const pair = bestFightOddsPair(markets, left.name, right.name);
      if (!pair) continue;
      left.moneyline = pair.a;
      right.moneyline = pair.b;
      bout.odds_source = 'BestFightOdds';
      bout.odds_provider = pair.provider;
      filled += 1;
    }
  }
  console.log(`BestFightOdds supplied current lines for ${filled} DWCS fight(s).`);
  return filled;
}

async function publishDwcsOdds(event) {
  const fights = (event.sections || []).flatMap(section => (section.bouts || []).map(bout => ({
    source:bout.odds_source || 'BestFightOdds',
    provider:bout.odds_provider || 'BestFightOdds',
    fighters:(bout.fighters || []).map(row => ({ name:row.name, moneyline:row.moneyline || '' }))
  }))).filter(fight =>
    fight.fighters.length === 2 &&
    fight.fighters[0].moneyline &&
    fight.fighters[1].moneyline
  );

  if (!fights.length) {
    console.warn('DWCS live odds feed: no complete markets to publish.');
    return;
  }

  let previousFeed = { events:[] };
  try { previousFeed = JSON.parse(await readFile(LIVE_ODDS_PATH, 'utf8')); } catch {}

  const today = new Date().toISOString().slice(0, 10);
  const retained = (Array.isArray(previousFeed?.events) ? previousFeed.events : [])
    .filter(item => String(item?.date || '') >= today && item?.id !== event.id);

  retained.push({
    id:event.id,
    date:event.date,
    official_url:event.official_url,
    fights
  });
  retained.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  await writeFile(LIVE_ODDS_PATH, JSON.stringify({
    generated_at:new Date().toISOString(),
    source:'UFC.com + BestFightOdds',
    events:retained
  }, null, 2) + '\n');

  console.log(`Published live DWCS odds for ${fights.length} fight(s).`);
}

function dateForWeek(week) {
  const date = new Date(FIRST_DATE);
  date.setUTCDate(date.getUTCDate() + ((week - 1) * 7));
  return date.toISOString().slice(0, 10);
}

function discoverSeasonEvents(html) {
  const source = decode(html).replaceAll('\\/', '/');
  const found = new Map();
  const rx = /href=["']([^"']*\/events\/Dana-Whites-Contender-Series-Contender-Series-2026-Week-(\d+)-\d+)["']/gi;
  for (const match of source.matchAll(rx)) {
    const week = Number(match[2]);
    if (!Number.isInteger(week) || week < 1 || week > 10) continue;
    try {
      const url = new URL(match[1], SHERDOG);
      url.search = '';
      url.hash = '';
      found.set(week, url.toString());
    } catch {}
  }
  return [...found.entries()].map(([week, url]) => ({ week, url })).sort((a, b) => a.week - b.week);
}

function parseCard(page) {
  const cardStart = page.search(/class=["'][^"']*fight_card[^"']*["']/i);
  const region = page.slice(cardStart >= 0 ? cardStart : Math.max(0, page.search(/FIGHT CARD/i)));

  const fighters = [];
  const seen = new Set();
  const fighterLink = /<a\b[^>]*href=["']([^"']*\/fighter\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of region.matchAll(fighterLink)) {
    const name = text(match[2]);
    const key = name.toLowerCase();
    if (!saneName(name) || seen.has(key)) continue;
    seen.add(key);
    let profileUrl = '';
    try { profileUrl = new URL(match[1], SHERDOG).toString(); } catch {}
    fighters.push({ name, profileUrl });
    if (fighters.length >= 10) break;
  }

  const plain = text(region);
  const weightRx = /\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Strawweight|Catchweight)\b/gi;
  const weights = [...plain.matchAll(weightRx)].map(match => normalizeWeight(match[1]));

  const pairCount = Math.min(5, Math.floor(fighters.length / 2), weights.length);
  const bouts = [];
  for (let i = 0; i < pairCount; i += 1) {
    const left = fighters[i * 2];
    const right = fighters[(i * 2) + 1];
    if (!saneName(left?.name) || !saneName(right?.name)) continue;
    bouts.push({ division: weights[i] || 'Weight class TBA', fighters: [left, right] });
  }
  return bouts;
}

function profileImage(page) {
  const candidates = [];
  for (const rx of [
    /<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i,
    /<meta\b[^>]*name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i,
    /<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i,
    /<img\b[^>]*class=["'][^"']*(?:profile_image|fighter)[^"']*["'][^>]*src=["']([^"']+)["']/i,
    /<img\b[^>]*src=["']([^"']+)["'][^>]*class=["'][^"']*(?:profile_image|fighter)[^"']*["']/i
  ]) {
    const hit = page.match(rx)?.[1];
    if (hit) candidates.push(decode(hit));
  }
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate, SHERDOG).toString();
      if (/^https?:\/\//i.test(url) && !trackingImage.test(url)) return url;
    } catch {}
  }
  return '';
}

async function resolveProfilePortraits(card) {
  const resolved = new Map();
  const fighters = card.flatMap(bout => bout.fighters || []);
  for (const entry of fighters) {
    if (!entry?.profileUrl || resolved.has(entry.name)) continue;
    try {
      const image = profileImage(await get(entry.profileUrl));
      if (image) resolved.set(entry.name, { image, image_source: 'sherdog', image_framing: 'safe' });
    } catch (error) {
      console.warn(`DWCS portrait unavailable for ${entry.name}: ${error.message}`);
    }
    await sleep(120);
  }
  return resolved;
}

const WEEK_ONE_FALLBACK = [
  { division: 'Heavyweight', fighters: [{ name: 'Anthony Wint', profileUrl: '' }, { name: 'Matthew Adams', profileUrl: '' }] },
  { division: 'Lightweight', fighters: [{ name: 'Fabrizio Escarrega', profileUrl: '' }, { name: 'Abe Alsaghir', profileUrl: '' }] },
  { division: 'Flyweight', fighters: [{ name: 'Mridul Saikia', profileUrl: '' }, { name: 'Bilal Hasan', profileUrl: '' }] },
  { division: 'Featherweight', fighters: [{ name: 'Ananias Mulumba', profileUrl: '' }, { name: 'Tom Pagliarulo', profileUrl: '' }] },
  { division: 'Middleweight', fighters: [{ name: 'Joseph Kropschot', profileUrl: '' }, { name: 'Jonathan Kunneman', profileUrl: '' }] }
];

const data = await loadData();
const cache = await loadPortraitCache();
const previous = data.events.filter(event => event.promotion_key === 'dwcs');

let organizationHtml;
try {
  organizationHtml = await get(SHERDOG_ORG);
} catch (error) {
  console.warn(`DWCS organization page unavailable: ${error.message}`);
  process.exit(0);
}

const discovered = discoverSeasonEvents(organizationHtml);
const next = discovered
  .map(item => ({ ...item, date: dateForWeek(item.week) }))
  .filter(item => eventIsCurrent({ date: item.date }))
  .sort((a, b) => a.date.localeCompare(b.date) || a.week - b.week)[0];

if (!next) {
  console.warn('DWCS: no current Season 10 event discovered; preserving existing DWCS data.');
  process.exit(0);
}

let card = [];
try {
  card = parseCard(await get(next.url));
} catch (error) {
  console.warn(`DWCS Week ${next.week} card unavailable: ${error.message}`);
}
const parsedCard = card.length >= 5;
if (next.week === 1 && !parsedCard) card = WEEK_ONE_FALLBACK;
if (!card.length) {
  console.warn(`DWCS Week ${next.week}: no usable bouts; preserving existing DWCS data.`);
  process.exit(0);
}

const profilePortraits = parsedCard ? await resolveProfilePortraits(card) : new Map();
const bouts = card.map((bout, index) => ({
  order: index + 1,
  label: index === 0 ? 'Main Event' : index === 1 ? 'Co-Main Event' : '',
  weight_class: bout.division,
  fighters: bout.fighters.map(entry => {
    const name = typeof entry === 'string' ? entry : entry.name;
    const portrait = profilePortraits.get(name) || portraitFor(name, previous, cache);
    return fighter(name, portrait);
  })
}));

const event = {
  id: `dwcs-season-${SEASON}-week-${next.week}-${next.date}`,
  promotion_key: 'dwcs',
  promotion: 'DWCS',
  title: `Season ${SEASON} · Week ${next.week}`,
  date: next.date,
  date_label: dateLabel(next.date),
  venue: 'Meta APEX · Las Vegas, Nevada',
  broadcast: 'Paramount+',
  official_url: `${UFC_DWCS}#season-${SEASON}-week-${next.week}`,
  source_card_url: next.url,
  updated_label: updatedLabel(),
  sections: [{ kind: 'main', title: 'Fight Card', time: '8:00 PM ET', bouts }]
};

await enrichDwcsOdds(event);
await publishDwcsOdds(event);
await mergePromotion('dwcs', [event], { maxEventDrop: 0, maxBoutDrop: 2 });
