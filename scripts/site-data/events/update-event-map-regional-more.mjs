import fs from 'node:fs/promises';

const DATA_PATH = '_data/event_map_regional.json';
const TODAY = new Date().toISOString().slice(0, 10);
const MAX_DATE = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);
const UA = 'Mozilla/5.0 (compatible; MMAMatlock-EventMap/1.0; +https://mmamatlock.com/event-map/)';

const SOURCES = [
  { key: 'cfc_southeast', name: 'Cage Fighting Championships', url: 'https://www.cfcfights.com/' },
  { key: 'sherdog_discovery', name: 'Sherdog regional discovery', url: 'https://www.sherdog.com/events' }
];

const STATE_NAMES = new Map([
  ['alabama','AL'],['alaska','AK'],['arizona','AZ'],['arkansas','AR'],['california','CA'],['colorado','CO'],['connecticut','CT'],['delaware','DE'],['district of columbia','DC'],['florida','FL'],['georgia','GA'],['hawaii','HI'],['idaho','ID'],['illinois','IL'],['indiana','IN'],['iowa','IA'],['kansas','KS'],['kentucky','KY'],['louisiana','LA'],['maine','ME'],['maryland','MD'],['massachusetts','MA'],['michigan','MI'],['minnesota','MN'],['mississippi','MS'],['missouri','MO'],['montana','MT'],['nebraska','NE'],['nevada','NV'],['new hampshire','NH'],['new jersey','NJ'],['new mexico','NM'],['new york','NY'],['north carolina','NC'],['north dakota','ND'],['ohio','OH'],['oklahoma','OK'],['oregon','OR'],['pennsylvania','PA'],['rhode island','RI'],['south carolina','SC'],['south dakota','SD'],['tennessee','TN'],['texas','TX'],['utah','UT'],['vermont','VT'],['virginia','VA'],['washington','WA'],['west virginia','WV'],['wisconsin','WI'],['wyoming','WY']
]);
const STATE_CODES = new Set([...STATE_NAMES.values()]);
const COORDS = new Map([
  ['huntsville|AL',[34.7304,-86.5861]],['jackson|MS',[32.2988,-90.1848]],['atlantic city|NJ',[39.3643,-74.4229]],['ralston|NE',[41.2053,-96.0422]],['davenport|IA',[41.5236,-90.5776]],['kansas city|MO',[39.0997,-94.5786]],['st charles|MO',[38.7881,-90.4812]],['auburn|WA',[47.3073,-122.2285]],['suquamish|WA',[47.7315,-122.5526]],['kissimmee|FL',[28.2920,-81.4076]],['new york|NY',[40.7128,-74.0060]],['long island city|NY',[40.7447,-73.9485]],['bossier city|LA',[32.5160,-93.7321]],['wichita falls|TX',[33.9137,-98.4934]],['pelham|AL',[33.2857,-86.8099]],['tulsa|OK',[36.1540,-95.9928]],['las vegas|NV',[36.1699,-115.1398]],['phoenix|AZ',[33.4484,-112.0740]]
]);

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = value => norm(value).replace(/\s+/g, '-').slice(0, 90) || 'event';

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
function stripTags(value) {
  return clean(decodeEntities(String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}
function absoluteUrl(base, href) { try { return new URL(decodeEntities(href), base).href; } catch { return ''; } }
function anchors(html, base) {
  const out = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    out.push({ url: absoluteUrl(base, m[1]), text: stripTags(m[2]) });
  }
  return out;
}
function tableRows(html) {
  const rows = [];
  for (const m of String(html || '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [];
    for (const c of m[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)) cells.push(stripTags(c[1]));
    if (cells.length) rows.push({ html: m[1], cells });
  }
  return rows;
}
function parseDate(value) {
  const text = clean(value);
  let m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)?\w*\s*(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s+(20\d{2})\b/i);
  if (!m) return '';
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,sept:9,oct:10,nov:11,dec:12 };
  const month = months[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith('sept') ? 4 : 3)];
  return month ? `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[2])).padStart(2, '0')}` : '';
}
function normalizeState(value) {
  const text = clean(value); const code = text.toUpperCase();
  return STATE_CODES.has(code) ? code : (STATE_NAMES.get(text.toLowerCase()) || '');
}
function coords(city, state) { return COORDS.get(`${clean(city).toLowerCase()}|${state}`) || null; }
function parseUsLocation(text) {
  const parts = clean(text).split(',').map(clean).filter(Boolean);
  let stateIndex = -1; let state = '';
  for (let i = 0; i < parts.length; i += 1) {
    state = normalizeState(parts[i]);
    if (state) { stateIndex = i; break; }
  }
  if (stateIndex < 1) return null;
  const city = parts[stateIndex - 1];
  const venue = parts.slice(0, stateIndex - 1).join(', ');
  return { city, state, venue };
}
function titleMatchup(value) {
  const text = clean(value);
  const m = text.match(/(?:^|:\s*)([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+){0,3})\s+(?:vs\.?|v\.)\s+([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’.-]+){0,3})\b/i);
  return m ? [clean(m[1]), clean(m[2])] : null;
}
function eventNumber(value) { return norm(value).match(/\b(\d{1,4})\b/)?.[1] || ''; }
function canonicalPromotion(value) {
  const n = norm(value);
  if (/^(legacy fighting alliance|lfa)\b/.test(n)) return 'lfa';
  if (/^(cage fury fighting championships|cffc)\b/.test(n)) return 'cffc';
  if (/^(fighting alliance championship|fac)\b/.test(n)) return 'fac';
  if (/^(peak fighting championship|pfc)\b/.test(n)) return 'pfc';
  if (/^(shamrock fighting championships|shamrock fc)\b/.test(n)) return 'shamrock fc';
  if (/^(ring of combat|roc)\b/.test(n)) return 'ring of combat';
  if (/^cage fighting championships\b/.test(n)) return 'cage fighting championships';
  if (/^caged aggression\b/.test(n)) return 'caged aggression';
  if (/^combat night\b/.test(n)) return 'combat night';
  if (/^(dynasty combat sports|dcs)\b/.test(n)) return 'dynasty combat sports';
  if (/^(flex fight series|flex fights)\b/.test(n)) return 'flex fight series';
  if (/^(american kombat alliance|aka)\b/.test(n)) return 'american kombat alliance';
  return n.replace(/\b\d+\b.*$/, '').trim();
}
function promotionFromTitle(value) {
  const text = clean(value);
  const explicit = [
    [/^CFFC\b/i,'CFFC'],[/^LFA\b/i,'LFA'],[/^FAC\b/i,'FAC'],[/^PFC\b/i,'Peak Fighting Championship'],
    [/^ROC\b/i,'Ring of Combat'],[/^Ring of Combat\b/i,'Ring of Combat'],[/^Shamrock FC\b/i,'Shamrock FC'],
    [/^Caged Aggression\b/i,'Caged Aggression'],[/^Combat Night\b/i,'Combat Night'],[/^DCS\b/i,'Dynasty Combat Sports'],
    [/^Flex Fight Series\b/i,'Flex Fight Series'],[/^AKA\b/i,'American Kombat Alliance']
  ];
  for (const [re, name] of explicit) if (re.test(text)) return name;
  return text.replace(/\s+\d+\b.*$/, '').split(':')[0].trim() || 'Regional MMA';
}
function sourcePriority(event) {
  if (event.source_key === 'sherdog_discovery') return 15;
  if (event.source_key === 'nitro') return 60;
  if (event.source_key === 'spectation') return 70;
  if (/commission|camomma/i.test(event.source_key || '')) return 45;
  return 100;
}
function sameEvent(a, b) {
  if (a.date !== b.date) return false;
  const pa = canonicalPromotion(a.promotion || a.title), pb = canonicalPromotion(b.promotion || b.title);
  if (pa && pb && pa === pb) return true;
  const na = eventNumber(a.title), nb = eventNumber(b.title);
  const aCity = norm(a.location).split(' ').slice(0, 3).join(' '), bCity = norm(b.location).split(' ').slice(0, 3).join(' ');
  return Boolean(na && nb && na === nb && aCity && aCity === bCity);
}
function mergeEvents(existing, incoming) {
  const incomingWins = sourcePriority(incoming) >= sourcePriority(existing);
  const primary = incomingWins ? incoming : existing;
  const secondary = incomingWins ? existing : incoming;
  const nitroTicket = [existing, incoming].find(e => e.source_key === 'nitro' && e.official_url)?.official_url || '';
  return {
    ...secondary, ...primary,
    venue: primary.venue || secondary.venue,
    broadcast: primary.broadcast || secondary.broadcast,
    latitude: primary.latitude ?? secondary.latitude,
    longitude: primary.longitude ?? secondary.longitude,
    main_event: primary.main_event || secondary.main_event,
    poster_url: primary.poster_url || secondary.poster_url,
    ticket_url: primary.ticket_url || secondary.ticket_url || nitroTicket || undefined
  };
}
async function fetchHtml(url) {
  const response = await fetch(url, { redirect:'follow', signal:AbortSignal.timeout(20000), headers:{ 'user-agent':UA, accept:'text/html,application/xhtml+xml' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
async function readJson(path, fallback) { try { return JSON.parse(await fs.readFile(path, 'utf8')); } catch { return fallback; } }

async function loadCfcSoutheast(source) {
  const html = await fetchHtml(source.url); const text = stripTags(html); const out = [];
  const scheduleRe = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*[–—-]\s*([A-Za-z .'-]+?),\s*([A-Z]{2})\b/gi;
  for (const m of text.matchAll(scheduleRe)) {
    const date = parseDate(`${m[1]} ${m[2]}, ${new Date().getUTCFullYear()}`);
    if (!date || date < TODAY || date > MAX_DATE) continue;
    const city = clean(m[3]); const state = normalizeState(m[4]);
    let title = `Cage Fighting Championships — ${city}`;
    if (date === '2026-09-26') title = 'CFC 12 – Fall Brawl';
    const event = {
      id: `cfc-southeast-${slug(title)}-${date}`,
      promotion: 'Cage Fighting Championships', promotion_key: source.key, title, date,
      venue: date === '2026-09-26' ? 'Von Braun Center South Hall' : '',
      location: `${city}, ${state}`, broadcast: '', official_url: source.url,
      regional: true, level: 'pro-am', source_key: source.key, source_label: source.name
    };
    const point = coords(city, state); if (point) { event.latitude = point[0]; event.longitude = point[1]; }
    out.push(event);
  }
  return out;
}

async function loadSherdog(source) {
  const html = await fetchHtml(source.url); const out = [];
  for (const row of tableRows(html)) {
    const joined = row.cells.join(' | ');
    if (!/United States/i.test(joined)) continue;
    const date = row.cells.map(parseDate).find(Boolean) || parseDate(joined);
    if (!date || date < TODAY || date > MAX_DATE) continue;
    const locationCell = [...row.cells].reverse().find(cell => /United States/i.test(cell));
    const location = parseUsLocation(locationCell || '');
    if (!location) continue;
    const dateIndex = row.cells.findIndex(cell => parseDate(cell));
    const locationIndex = row.cells.indexOf(locationCell);
    const titleCells = row.cells.slice(Math.max(0, dateIndex + 1), locationIndex).map(clean).filter(Boolean);
    if (!titleCells.length) continue;
    const first = titleCells[0]; const second = titleCells[1] || '';
    let title = first;
    if (second && norm(second) !== norm(first) && !norm(first).includes(norm(second))) title = `${first}: ${second}`;
    if (/\b(?:UFC|PFL|Professional Fighters League|ONE Championship|BKFC|Bellator)\b/i.test(title)) continue;
    const eventLink = anchors(row.html, source.url).find(a => /sherdog\.com\/events\//i.test(a.url));
    const promotion = promotionFromTitle(first);
    const event = {
      id: `sherdog-${slug(title)}-${date}-${slug(location.city)}`,
      promotion, promotion_key: source.key, title, date,
      venue: location.venue, location: `${location.city}, ${location.state}`,
      broadcast: '', official_url: eventLink?.url || source.url,
      regional: true, level: 'regional', source_key: source.key, source_label: source.name
    };
    const point = coords(location.city, location.state); if (point) { event.latitude = point[0]; event.longitude = point[1]; }
    const matchup = titleMatchup(title); if (matchup) event.main_event = { fighters: matchup };
    out.push(event);
  }
  return out;
}

async function repairTuffNUff(events) {
  const event = events.find(e => e.source_key === 'tuff_n_uff' && /Tuff[- ]N[- ]Uff\s+157/i.test(e.title || ''));
  if (!event?.official_url) return;
  try {
    const html = await fetchHtml(event.official_url); const text = stripTags(html);
    const match = text.match(/TUFF[- ]N[- ]UFF\s+157\s*:\s*([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3})\s+vs\.?\s+([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,3})/i);
    if (!match) return;
    event.title = `Tuff-N-Uff 157: ${clean(match[1])} vs. ${clean(match[2])}`;
    event.main_event = { fighters: [clean(match[1]), clean(match[2])] };
    if (/World Flyweight Championship showdown/i.test(text)) event.main_event.weight_class = 'Flyweight Championship';
  } catch (error) {
    console.warn(`Tuff-N-Uff detail repair: ${error.message}`);
  }
}

const current = await readJson(DATA_PATH, { version:1, sources:[], events:[] });
const managed = new Set(SOURCES.map(s => s.key));
const previousBySource = new Map();
for (const event of current.events || []) {
  if (!managed.has(event.source_key)) continue;
  if (!previousBySource.has(event.source_key)) previousBySource.set(event.source_key, []);
  previousBySource.get(event.source_key).push(event);
}
let merged = (current.events || []).filter(e => !managed.has(e.source_key) && e.date >= TODAY);

for (const source of SOURCES) {
  let events = [];
  try {
    events = source.key === 'cfc_southeast' ? await loadCfcSoutheast(source) : await loadSherdog(source);
    events = events.filter(e => e.date >= TODAY && e.date <= MAX_DATE);
    if (!events.length) throw new Error('No future U.S. MMA events parsed');
    console.log(`${source.name}: ${events.length} future event(s)`);
  } catch (error) {
    events = (previousBySource.get(source.key) || []).filter(e => e.date >= TODAY);
    console.warn(`${source.name}: ${error.message}; preserving ${events.length} existing event(s)`);
  }
  for (const event of events) {
    const index = merged.findIndex(existing => sameEvent(existing, event));
    if (index === -1) merged.push(event);
    else merged[index] = mergeEvents(merged[index], event);
  }
}

await repairTuffNUff(merged);
const sources = [
  ...(current.sources || []).filter(s => !managed.has(s.key)),
  ...SOURCES.map(({ key, name, url }) => ({ key, name, url }))
];
const output = {
  version: 1,
  sources,
  events: merged.sort((a, b) => a.date.localeCompare(b.date) || clean(a.promotion).localeCompare(clean(b.promotion)) || clean(a.title).localeCompare(clean(b.title)))
};
await fs.writeFile(DATA_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Broader regional discovery merged: ${output.events.length} total regional event(s).`);
