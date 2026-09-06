import fs from 'node:fs/promises';

const DATA_PATH = '_data/event_map_regional.json';
const MAJOR_PATH = '_data/upcoming_events.json';
const UA = 'Mozilla/5.0 (compatible; MatlockFightTalk-EventMap/1.0; +https://matlockfighttalk.com/event-map/)';
const TODAY = new Date().toISOString().slice(0, 10);

const SOURCES = [
  {
    key: 'fury',
    name: 'Fury Fighting Championship',
    promotion: 'Fury FC',
    url: 'https://www.furyfc.tv/events',
    level: 'regional',
    parser: parseFury
  },
  {
    key: 'cffc',
    name: 'Cage Fury Fighting Championships',
    promotion: 'CFFC',
    url: 'https://cffc.tv/',
    level: 'professional',
    broadcast: 'UFC Fight Pass',
    parser: parseCffc
  },
  {
    key: '559',
    name: '559 Fights',
    promotion: '559 Fights',
    url: 'https://www.559fights.com/',
    level: 'pro-am',
    broadcast: 'UFC Fight Pass',
    parser: parse559
  },
  {
    key: 'peak',
    name: 'Peak Fighting Championship',
    promotion: 'Peak Fighting',
    url: 'https://www.peakfighting.com/',
    level: 'pro-am',
    parser: parsePeak
  }
];

const STATE_NAMES = new Map([
  ['alabama', 'AL'], ['alaska', 'AK'], ['arizona', 'AZ'], ['arkansas', 'AR'], ['california', 'CA'],
  ['colorado', 'CO'], ['connecticut', 'CT'], ['delaware', 'DE'], ['district of columbia', 'DC'], ['florida', 'FL'],
  ['georgia', 'GA'], ['hawaii', 'HI'], ['idaho', 'ID'], ['illinois', 'IL'], ['indiana', 'IN'], ['iowa', 'IA'],
  ['kansas', 'KS'], ['kentucky', 'KY'], ['louisiana', 'LA'], ['maine', 'ME'], ['maryland', 'MD'],
  ['massachusetts', 'MA'], ['michigan', 'MI'], ['minnesota', 'MN'], ['mississippi', 'MS'], ['missouri', 'MO'],
  ['montana', 'MT'], ['nebraska', 'NE'], ['nevada', 'NV'], ['new hampshire', 'NH'], ['new jersey', 'NJ'],
  ['new mexico', 'NM'], ['new york', 'NY'], ['north carolina', 'NC'], ['north dakota', 'ND'], ['ohio', 'OH'],
  ['oklahoma', 'OK'], ['oregon', 'OR'], ['pennsylvania', 'PA'], ['rhode island', 'RI'], ['south carolina', 'SC'],
  ['south dakota', 'SD'], ['tennessee', 'TN'], ['texas', 'TX'], ['utah', 'UT'], ['vermont', 'VT'],
  ['virginia', 'VA'], ['washington', 'WA'], ['west virginia', 'WV'], ['wisconsin', 'WI'], ['wyoming', 'WY']
]);

const STATE_CODES = new Set([...STATE_NAMES.values()]);
const KNOWN_COORDS = new Map([
  ['houston|TX', [29.7604, -95.3698]],
  ['rockford|IL', [42.2711, -89.0940]],
  ['porterville|CA', [36.0652, -119.0168]],
  ['minot|ND', [48.2330, -101.2963]],
  ['wichita falls|TX', [33.9137, -98.4934]],
  ['midland|TX', [31.9973, -102.0779]],
  ['dallas|TX', [32.7767, -96.7970]],
  ['austin|TX', [30.2672, -97.7431]],
  ['san antonio|TX', [29.4241, -98.4936]],
  ['philadelphia|PA', [39.9526, -75.1652]],
  ['atlantic city|NJ', [39.3643, -74.4229]],
  ['tampa|FL', [27.9506, -82.4572]],
  ['orlando|FL', [28.5383, -81.3792]],
  ['miami|FL', [25.7617, -80.1918]],
  ['las vegas|NV', [36.1699, -115.1398]],
  ['fresno|CA', [36.7378, -119.7871]],
  ['sacramento|CA', [38.5816, -121.4944]],
  ['los angeles|CA', [34.0522, -118.2437]]
]);

const MONTHS = new Map([
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
  ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['novemeber', 11], ['december', 12],
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['jun', 6], ['jul', 7], ['aug', 8], ['sep', 9], ['sept', 9], ['oct', 10], ['nov', 11], ['dec', 12]
]);

const MONTH_PATTERN = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember|emeber)?|Dec(?:ember)?)';
const DATE_RE = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`, 'i');
const DATE_WITHOUT_YEAR_RE = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const norm = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const slug = value => norm(value).replace(/\s+/g, '-').slice(0, 90) || 'event';

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function htmlLines(html) {
  const text = decodeEntities(String(html || ''))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr|td|a)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '\n');
  return text.split(/\n+/).map(clean).filter(Boolean);
}

function parseDate(value) {
  const text = clean(value);
  let match = text.match(DATE_RE);
  if (match) {
    const month = MONTHS.get(match[1].toLowerCase());
    if (!month) return '';
    return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  }

  match = text.match(DATE_WITHOUT_YEAR_RE);
  if (!match) return '';
  const month = MONTHS.get(match[1].toLowerCase());
  if (!month) return '';
  const now = new Date();
  let year = now.getUTCFullYear();
  let candidate = `${year}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  const candidateTime = new Date(`${candidate}T12:00:00Z`).getTime();
  if (candidateTime < Date.now() - 45 * 86400000) {
    year += 1;
    candidate = `${year}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
  }
  return candidate;
}

function normalizeState(value) {
  const text = clean(value).replace(/\d{5}(?:-\d{4})?$/, '').trim();
  const code = text.toUpperCase();
  if (STATE_CODES.has(code)) return code;
  return STATE_NAMES.get(text.toLowerCase()) || '';
}

function parseCityState(line) {
  const text = clean(line).replace(/\s+\|\s+/g, ', ');
  const parts = text.split(',').map(clean).filter(Boolean);

  for (let index = parts.length - 1; index >= 1; index -= 1) {
    const stateMatch = parts[index].match(/^([A-Za-z ]{2,22}|[A-Za-z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
    if (!stateMatch) continue;
    const state = normalizeState(stateMatch[1]);
    if (!state) continue;
    const city = clean(parts[index - 1]);
    if (city && !/\d/.test(city)) return { city, state };
  }

  const short = text.match(/\b([A-Za-z][A-Za-z .'-]{1,40})\s+([A-Z]{2})\b/);
  if (short && STATE_CODES.has(short[2])) return { city: clean(short[1]), state: short[2] };
  return null;
}

function coordinatesFor(city, state) {
  return KNOWN_COORDS.get(`${clean(city).toLowerCase()}|${state}`) || null;
}

function sourceEvent(config, values) {
  const date = values.date || '';
  const title = clean(values.title);
  const city = clean(values.city);
  const state = normalizeState(values.state);
  if (!date || !title || !city || !state) return null;

  const coords = coordinatesFor(city, state);
  const event = {
    id: values.id || `${config.key}-${slug(title)}-${date}`,
    promotion: config.promotion,
    promotion_key: config.key,
    title,
    date,
    venue: clean(values.venue),
    location: `${city}, ${state}`,
    broadcast: clean(values.broadcast || config.broadcast || ''),
    official_url: values.official_url || config.url,
    regional: true,
    level: values.level || config.level || 'regional',
    source_key: config.key,
    source_label: config.name
  };
  if (values.starts_at) event.starts_at = values.starts_at;
  if (coords) {
    event.latitude = coords[0];
    event.longitude = coords[1];
  }
  return event;
}

function headingBlocks(lines, headingRx) {
  const starts = [];
  lines.forEach((line, index) => {
    const match = line.match(headingRx);
    if (match) starts.push({ index, heading: clean(match[0]) });
  });
  return starts.map((entry, index) => ({
    heading: entry.heading,
    lines: lines.slice(entry.index, starts[index + 1]?.index ?? Math.min(lines.length, entry.index + 80))
  }));
}

function blockDate(lines) {
  for (const line of lines) {
    const date = parseDate(line);
    if (date) return date;
  }
  return '';
}

function blockLocation(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const parsed = parseCityState(lines[index]);
    if (parsed) return { ...parsed, lineIndex: index, raw: lines[index] };
  }
  return null;
}

function nearbyVenue(lines, locationIndex) {
  if (!Number.isInteger(locationIndex)) return '';
  for (let index = locationIndex - 1; index >= Math.max(0, locationIndex - 4); index -= 1) {
    const line = clean(lines[index]);
    if (!line || DATE_RE.test(line) || DATE_WITHOUT_YEAR_RE.test(line)) continue;
    if (/^(?:directions|tickets?|buy tickets?|watch|stream|event info|details?|learn more|card|fight card)$/i.test(line)) continue;
    if (/\b(?:vs\.?|v\.)\b/i.test(line)) continue;
    return line.replace(/\s*\|\s*.*$/, '').trim();
  }
  return '';
}

function parseFury(html, config) {
  const lines = htmlLines(html);
  const blocks = headingBlocks(lines, /\bFURY\s+(?:FC|AS|AMATEUR SERIES|CHALLENGER SERIES|STRIKING SERIES)\s+\d+\b/i);
  return blocks.map(block => {
    const date = blockDate(block.lines);
    const location = blockLocation(block.lines);
    if (!date || !location) return null;
    let level = config.level;
    if (/\b(?:AS|AMATEUR SERIES)\b/i.test(block.heading)) level = 'amateur';
    if (/\bFC\b/i.test(block.heading)) level = 'professional';
    return sourceEvent(config, {
      title: block.heading.replace(/AMATEUR SERIES/i, 'AS'),
      date,
      city: location.city,
      state: location.state,
      venue: nearbyVenue(block.lines, location.lineIndex),
      level
    });
  }).filter(Boolean);
}

function parseCffc(html, config) {
  const lines = htmlLines(html);
  const blocks = headingBlocks(lines, /\bCFFC(?:\s+NEXTGEN)?\s+\d+\b/i);
  return blocks.map(block => {
    if (block.lines.some(line => /\b(?:BJJ|grappling)\b/i.test(line))) return null;
    const date = blockDate(block.lines);
    const location = blockLocation(block.lines);
    if (!date || !location) return null;
    const matchup = block.lines.find(line => /\b(?:vs\.?|v\.)\b/i.test(line));
    return sourceEvent(config, {
      title: matchup && !block.heading.includes(':') ? `${block.heading}: ${matchup}` : block.heading,
      date,
      city: location.city,
      state: location.state,
      venue: nearbyVenue(block.lines, location.lineIndex)
    });
  }).filter(Boolean);
}

function parse559(html, config) {
  const lines = htmlLines(html);
  const blocks = headingBlocks(lines, /\b559\s+Fights\s+\d+\b/i);
  return blocks.map(block => {
    const date = blockDate(block.lines);
    const location = blockLocation(block.lines);
    if (!date || !location) return null;
    return sourceEvent(config, {
      title: block.heading,
      date,
      city: location.city,
      state: location.state,
      venue: nearbyVenue(block.lines, location.lineIndex)
    });
  }).filter(Boolean);
}

function parsePeak(html, config) {
  const lines = htmlLines(html);
  const blocks = headingBlocks(lines, /\bPFC\s+\d+\b/i);
  return blocks.map(block => {
    const date = blockDate(block.lines);
    const location = blockLocation(block.lines);
    if (!date || !location) return null;
    const matchup = block.lines.find(line => /\b(?:vs\.?|v\.)\b/i.test(line));
    const locationLine = block.lines[location.lineIndex] || '';
    const venueFromPipe = locationLine.includes('|') ? clean(locationLine.split('|')[0]) : '';
    return sourceEvent(config, {
      title: matchup ? `${block.heading}: ${matchup}` : block.heading,
      date,
      city: location.city,
      state: location.state,
      venue: venueFromPipe || nearbyVenue(block.lines, location.lineIndex)
    });
  }).filter(Boolean);
}

function walkJson(value, visit) {
  if (Array.isArray(value)) return value.forEach(item => walkJson(item, visit));
  if (!value || typeof value !== 'object') return;
  visit(value);
  Object.values(value).forEach(child => walkJson(child, visit));
}

function parseJsonLd(html, config) {
  const out = [];
  const rx = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(rx)) {
    try {
      const json = JSON.parse(decodeEntities(match[1]).trim());
      walkJson(json, node => {
        const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (!types.some(type => String(type || '').toLowerCase() === 'event')) return;
        const title = clean(node.name);
        if (!title || /\b(?:bjj|grappling)\b/i.test(title)) return;
        const start = clean(node.startDate);
        const date = /^20\d{2}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : parseDate(start);
        const location = node.location || {};
        const address = location.address || {};
        const city = clean(address.addressLocality || location.addressLocality);
        const state = normalizeState(address.addressRegion || location.addressRegion);
        if (!date || !city || !state) return;
        out.push(sourceEvent(config, {
          title,
          date,
          starts_at: /^20\d{2}-\d{2}-\d{2}T/.test(start) ? start : '',
          city,
          state,
          venue: clean(location.name),
          official_url: typeof node.url === 'string' && /^https:\/\//i.test(node.url) ? node.url : config.url
        }));
      });
    } catch {
      // Ignore malformed or unrelated JSON-LD blocks.
    }
  }
  return out.filter(Boolean);
}

function eventNumber(title) {
  return norm(title).match(/\b(\d{1,4})\b/)?.[1] || '';
}

function dedupe(events) {
  const map = new Map();
  for (const event of events.filter(Boolean)) {
    const number = eventNumber(event.title);
    const key = `${event.source_key}|${event.date}|${number || norm(event.title)}|${event.location}`;
    const previous = map.get(key);
    if (!previous) {
      map.set(key, event);
      continue;
    }
    const title = event.title.length > previous.title.length ? event.title : previous.title;
    map.set(key, {
      ...previous,
      ...event,
      title,
      venue: event.venue || previous.venue,
      broadcast: event.broadcast || previous.broadcast,
      official_url: event.official_url || previous.official_url
    });
  }
  return [...map.values()];
}

function majorFingerprint(event) {
  return `${event.date || ''}|${norm(event.promotion)}|${eventNumber(event.title) || norm(event.title)}`;
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const current = await readJson(DATA_PATH, { version: 1, sources: [], events: [] });
const majors = await readJson(MAJOR_PATH, { events: [] });
const previousBySource = new Map();
for (const event of current.events || []) {
  const key = event.source_key || event.promotion_key || '';
  if (!previousBySource.has(key)) previousBySource.set(key, []);
  previousBySource.get(key).push(event);
}

const collected = [];
for (const source of SOURCES) {
  let events = [];
  try {
    const html = await fetchHtml(source.url);
    events = dedupe([
      ...source.parser(html, source),
      ...parseJsonLd(html, source)
    ]).filter(event => event.date >= TODAY);
    if (!events.length) throw new Error('No future MMA events parsed');
    console.log(`${source.name}: ${events.length} future event(s)`);
  } catch (error) {
    events = (previousBySource.get(source.key) || []).filter(event => event.date >= TODAY);
    console.warn(`${source.name}: ${error.message}; preserving ${events.length} existing future event(s)`);
  }
  collected.push(...events);
  await sleep(400);
}

const majorKeys = new Set((majors.events || []).map(majorFingerprint));
const nextEvents = dedupe(collected)
  .filter(event => !majorKeys.has(majorFingerprint(event)))
  .sort((a, b) => a.date.localeCompare(b.date) || a.promotion.localeCompare(b.promotion) || a.title.localeCompare(b.title));

const currentComparable = JSON.stringify((current.events || []).map(event => ({ ...event })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
const nextComparable = JSON.stringify(nextEvents.map(event => ({ ...event })).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));

if (currentComparable === nextComparable) {
  console.log(`Regional Event Map unchanged: ${nextEvents.length} event(s).`);
  process.exit(0);
}

const output = {
  version: 1,
  sources: SOURCES.map(({ key, name, url }) => ({ key, name, url })),
  events: nextEvents
};
await fs.writeFile(DATA_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Regional Event Map updated: ${nextEvents.length} event(s).`);
