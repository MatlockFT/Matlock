import { dateLabel, eventIsCurrent, fighter, loadData, loadPortraitCache, mergePromotion, portraitFor, updatedLabel } from './upcoming-events-data.mjs';

const SHERDOG_ORG = 'https://www.sherdog.com/organizations/Dana-Whites-Contender-Series-12411';
const UFC_DWCS = 'https://www.ufc.com/dwcs';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockDWCSUpdater/1.0; +https://matlockfighttalk.com/)';
const SEASON = 10;
const FIRST_DATE = new Date('2026-08-11T12:00:00Z');

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
      const url = new URL(match[1], 'https://www.sherdog.com');
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

  const names = [];
  const seen = new Set();
  const fighterLink = /<a\b[^>]*href=["'][^"']*\/fighter\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of region.matchAll(fighterLink)) {
    const name = text(match[1]);
    const key = name.toLowerCase();
    if (!saneName(name) || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
    if (names.length >= 10) break;
  }

  const plain = text(region);
  const weightRx = /\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Strawweight|Catchweight)\b/gi;
  const weights = [...plain.matchAll(weightRx)].map(match => normalizeWeight(match[1]));

  const pairCount = Math.min(5, Math.floor(names.length / 2), weights.length);
  const bouts = [];
  for (let i = 0; i < pairCount; i += 1) {
    const left = names[i * 2];
    const right = names[(i * 2) + 1];
    if (!saneName(left) || !saneName(right)) continue;
    bouts.push({ division: weights[i] || 'Weight class TBA', fighters: [left, right] });
  }
  return bouts;
}

const WEEK_ONE_FALLBACK = [
  { division: 'Heavyweight', fighters: ['Anthony Wint', 'Matthew Adams'] },
  { division: 'Lightweight', fighters: ['Fabrizio Escarrega', 'Abe Alsaghir'] },
  { division: 'Flyweight', fighters: ['Mridul Saikia', 'Bilal Hasan'] },
  { division: 'Featherweight', fighters: ['Ananias Mulumba', 'Tom Pagliarulo'] },
  { division: 'Middleweight', fighters: ['Joseph Kropschot', 'Jonathan Kunneman'] }
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
if (next.week === 1 && card.length < 5) card = WEEK_ONE_FALLBACK;
if (!card.length) {
  console.warn(`DWCS Week ${next.week}: no usable bouts; preserving existing DWCS data.`);
  process.exit(0);
}

const bouts = card.map((bout, index) => ({
  order: index + 1,
  label: index === 0 ? 'Main Event' : index === 1 ? 'Co-Main Event' : '',
  weight_class: bout.division,
  fighters: bout.fighters.map(name => fighter(name, portraitFor(name, previous, cache)))
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

await mergePromotion('dwcs', [event], { maxEventDrop: 0, maxBoutDrop: 2 });
