import fs from 'node:fs/promises';

const DATA_PATH = '_data/event_map_regional.json';
const UA = 'Mozilla/5.0 (compatible; MatlockFightTalk-EventMap/1.0; +https://matlockfighttalk.com/event-map/)';
const TODAY = new Date().toISOString().slice(0, 10);

const DISCOVERY_SOURCES = [
  {
    key: 'spectation',
    name: 'Spectation Sports',
    url: 'https://spectationsports.com/',
    loader: loadSpectation
  },
  {
    key: 'nitro',
    name: 'Nitro Tickets',
    url: 'https://www.nitrotickets.com/',
    loader: loadNitro
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

const COORDS = new Map([
  ['plymouth|MA', [41.9584, -70.6673]],
  ['park city|UT', [40.6461, -111.4980]],
  ['prior lake|MN', [44.7133, -93.4227]],
  ['independence|MO', [39.0911, -94.4155]],
  ['billings|MT', [45.7833, -108.5007]],
  ['wichita falls|TX', [33.9137, -98.4934]],
  ['onalaska|WI', [43.8844, -91.2351]],
  ['springfield|MO', [37.2090, -93.2923]],
  ['minneapolis|MN', [44.9778, -93.2650]],
  ['omaha|NE', [41.2565, -95.9345]],
  ['des moines|IA', [41.5868, -93.6250]],
  ['cedar rapids|IA', [41.9779, -91.6656]],
  ['sioux city|IA', [42.4963, -96.4049]],
  ['fargo|ND', [46.8772, -96.7898]],
  ['sioux falls|SD', [43.5446, -96.7311]],
  ['tulsa|OK', [36.1540, -95.9928]],
  ['kansas city|MO', [39.0997, -94.5786]],
  ['st louis|MO', [38.6270, -90.1994]],
  ['milwaukee|WI', [43.0389, -87.9065]],
  ['madison|WI', [43.0722, -89.4008]],
  ['las vegas|NV', [36.1699, -115.1398]],
  ['salt lake city|UT', [40.7608, -111.8910]],
  ['denver|CO', [39.7392, -104.9903]],
  ['phoenix|AZ', [33.4484, -112.0740]],
  ['dallas|TX', [32.7767, -96.7970]],
  ['houston|TX', [29.7604, -95.3698]],
  ['austin|TX', [30.2672, -97.7431]],
  ['san antonio|TX', [29.4241, -98.4936]],
  ['chicago|IL', [41.8781, -87.6298]],
  ['rockford|IL', [42.2711, -89.0940]],
  ['detroit|MI', [42.3314, -83.0458]],
  ['grand rapids|MI', [42.9634, -85.6681]],
  ['new york|NY', [40.7128, -74.0060]],
  ['philadelphia|PA', [39.9526, -75.1652]],
  ['boston|MA', [42.3601, -71.0589]],
  ['atlantic city|NJ', [39.3643, -74.4229]]
]);

const NITRO_MMA_GROUPS = [
  '3 river throwdown',
  'ascendency fighting championship',
  'brave challenge',
  'caged aggression',
  'dynasty combat sports',
  'extreme challenge mma',
  'fight hard mma',
  'fighting alliance championship',
  'fury fight series',
  'ge fights',
  'hammer challenge series',
  'ignite fc',
  'legacy fighting alliance',
  'med city fighting championships',
  'midwest cage championship',
  'midwest championship fighting',
  'missouri border brawl',
  'mokan mma',
  'omaha fight club',
  'shogun challenger series',
  'synergy fc',
  'the fight series',
  'throne mma',
  'titan fc',
  'true rev mma',
  "tuff n' uff",
  'victory fighting championship',
  'vivid fights',
  'way of the warrior',
  'wisconsin fighting championship',
  'world fighting championship'
];

const NITRO_EXCLUDE = /\b(?:boxing|bjj|jiu\s*jitsu|grappling|wrestling|muay\s*thai|kickboxing|slap|podcast|merch|xpo|fund)\b/i;
const MONTHS = new Map([
  ['january', 1], ['february', 2], ['march', 3], ['april', 4], ['may', 5], ['june', 6],
  ['july', 7], ['august', 8], ['september', 9], ['october', 10], ['november', 11], ['december', 12],
  ['jan', 1], ['feb', 2], ['mar', 3], ['apr', 4], ['jun', 6], ['jul', 7], ['aug', 8], ['sep', 9], ['sept', 9], ['oct', 10], ['nov', 11], ['dec', 12]
]);
const MONTH_PATTERN = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DATE_RE = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\b`, 'i');
const DATE_TIME_RE = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\s+(\\d{1,2}:\\d{2}\\s*(?:AM|PM))\\b`, 'i');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

function stripTags(value) {
  return clean(decodeEntities(String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')));
}

function expandedHtml(html) {
  return String(html || '')
    .replace(/\\u003c/gi, '<')
    .replace(/\\u003e/gi, '>')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u0027/gi, "'")
    .replace(/\\u0022/gi, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\\"/g, '"');
}

function htmlLines(html) {
  return decodeEntities(expandedHtml(html))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, match => `\n${stripTags(match)}\n`)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '\n')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|section|article|tr|td|a)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map(clean)
    .filter(Boolean);
}

function parseDate(value) {
  const match = clean(value).match(DATE_RE);
  if (!match) return '';
  const month = MONTHS.get(match[1].toLowerCase());
  if (!month) return '';
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

function normalizeState(value) {
  const text = clean(value).replace(/\d{5}(?:-\d{4})?$/, '').trim();
  const code = text.toUpperCase();
  if (STATE_CODES.has(code)) return code;
  return STATE_NAMES.get(text.toLowerCase()) || '';
}

function parseCityState(value) {
  const text = clean(value);
  const parts = text.split(',').map(clean).filter(Boolean);
  for (let i = parts.length - 1; i >= 1; i -= 1) {
    const state = normalizeState(parts[i]);
    if (!state) continue;
    const city = clean(parts[i - 1]).replace(/^\|\s*/, '');
    if (city && !/\d/.test(city)) return { city, state };
  }
  const match = text.match(/\b([A-Za-z][A-Za-z .'-]{1,40})\s+([A-Z]{2})\b/);
  if (match && STATE_CODES.has(match[2])) return { city: clean(match[1]), state: match[2] };
  return null;
}

function coordinatesFor(city, state) {
  return COORDS.get(`${clean(city).toLowerCase()}|${state}`) || null;
}

function eventNumber(title) {
  return norm(title).match(/\b(\d{1,4})\b/)?.[1] || '';
}

function promotionFromTitle(title) {
  let base = clean(title).replace(/\s+-\s+prelims?\b.*$/i, '').replace(/:\s+.*$/, '');
  base = base.replace(/\s+(?:#?\d{1,4}|[ivxlcdm]{2,})\b.*$/i, '').trim();
  return base || clean(title).split(/\s+/).slice(0, 3).join(' ');
}

function makeEvent({ sourceKey, sourceLabel, promotion, title, date, city, state, venue = '', url, startsAt = '', level = 'regional' }) {
  const normalizedState = normalizeState(state);
  const normalizedCity = clean(city);
  const normalizedTitle = clean(title);
  if (!normalizedTitle || !date || !normalizedCity || !normalizedState || date < TODAY) return null;
  const coords = coordinatesFor(normalizedCity, normalizedState);
  const event = {
    id: `${sourceKey}-${slug(normalizedTitle)}-${date}`,
    promotion: clean(promotion) || promotionFromTitle(normalizedTitle),
    promotion_key: sourceKey,
    title: normalizedTitle,
    date,
    venue: clean(venue),
    location: `${normalizedCity}, ${normalizedState}`,
    broadcast: '',
    official_url: url,
    regional: true,
    level,
    source_key: sourceKey,
    source_label: sourceLabel
  };
  if (startsAt) event.starts_at = startsAt;
  if (coords) {
    event.latitude = coords[0];
    event.longitude = coords[1];
  }
  return event;
}

function extractAnchors(html) {
  const out = [];
  const rx = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of String(html || '').matchAll(rx)) {
    out.push({ href: decodeEntities(match[1]), text: stripTags(match[2]) });
  }
  return out;
}

function absoluteUrl(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return '';
  }
}

function dedupe(events) {
  const map = new Map();
  for (const event of events.filter(Boolean)) {
    const key = `${event.date}|${norm(event.title)}|${event.location}`;
    const previous = map.get(key);
    if (!previous) map.set(key, event);
    else map.set(key, {
      ...previous,
      ...event,
      venue: event.venue || previous.venue,
      official_url: event.official_url || previous.official_url
    });
  }
  return [...map.values()];
}

function sameEvent(a, b) {
  if (a.date !== b.date) return false;
  const aLoc = norm(a.location);
  const bLoc = norm(b.location);
  const sameLocation = aLoc && bLoc && aLoc === bLoc;
  const aPromotion = norm(a.promotion);
  const bPromotion = norm(b.promotion);
  const promotionMatch = aPromotion && bPromotion && (aPromotion === bPromotion || aPromotion.includes(bPromotion) || bPromotion.includes(aPromotion));
  const aNum = eventNumber(a.title);
  const bNum = eventNumber(b.title);
  const numberMatch = aNum && bNum && aNum === bNum;
  const aTitle = norm(a.title);
  const bTitle = norm(b.title);
  const titleMatch = aTitle === bTitle || aTitle.includes(bTitle) || bTitle.includes(aTitle);
  return (sameLocation && (promotionMatch || numberMatch || titleMatch)) || (promotionMatch && numberMatch);
}

function walkJson(value, visit) {
  if (Array.isArray(value)) return value.forEach(item => walkJson(item, visit));
  if (!value || typeof value !== 'object') return;
  visit(value);
  Object.values(value).forEach(child => walkJson(child, visit));
}

function parseJsonLdEvents(html, sourceKey, sourceLabel, fallbackPromotion, fallbackUrl) {
  const out = [];
  const rx = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || '').matchAll(rx)) {
    try {
      const json = JSON.parse(decodeEntities(match[1]).trim());
      walkJson(json, node => {
        const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (!types.some(type => String(type || '').toLowerCase() === 'event')) return;
        const title = clean(node.name);
        if (!title || NITRO_EXCLUDE.test(title)) return;
        const start = clean(node.startDate);
        const date = /^20\d{2}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : parseDate(start);
        const location = node.location || {};
        const address = location.address || {};
        const city = clean(address.addressLocality || location.addressLocality);
        const state = normalizeState(address.addressRegion || location.addressRegion);
        const url = typeof node.url === 'string' && /^https:\/\//i.test(node.url) ? node.url : fallbackUrl;
        const event = makeEvent({
          sourceKey,
          sourceLabel,
          promotion: fallbackPromotion || promotionFromTitle(title),
          title,
          date,
          city,
          state,
          venue: clean(location.name),
          url,
          startsAt: /^20\d{2}-\d{2}-\d{2}T/.test(start) ? start : ''
        });
        if (event) out.push(event);
      });
    } catch {
      // Ignore malformed JSON-LD.
    }
  }
  return out;
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

function parseSpectationText(html) {
  const out = [];
  const flattened = clean(stripTags(expandedHtml(html)));
  const rx = new RegExp(`\\bupcoming\\b\\s+(.{2,140}?)\\s+(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s+(20\\d{2})\\s+(\\d{1,2}:\\d{2}\\s*(?:AM|PM))\\s*\\|\\s*([A-Za-z][A-Za-z .'-]{1,50}),\\s*([A-Z]{2})\\b`, 'gi');
  for (const match of flattened.matchAll(rx)) {
    const title = clean(match[1]).replace(/^upcoming\s+/i, '');
    const state = normalizeState(match[7]);
    if (!state || /\b(?:boxing|grappling|bjj|jiu jitsu|kickboxing|muay thai)\b/i.test(title)) continue;
    const month = MONTHS.get(match[2].toLowerCase());
    if (!month) continue;
    const date = `${match[4]}-${String(month).padStart(2, '0')}-${String(Number(match[3])).padStart(2, '0')}`;
    out.push(makeEvent({
      sourceKey: 'spectation',
      sourceLabel: 'Spectation Sports',
      promotion: promotionFromTitle(title),
      title,
      date,
      city: match[6],
      state,
      url: 'https://spectationsports.com/events?type=upcoming',
      level: 'professional'
    }));
  }
  return out.filter(Boolean);
}

function parseSpectationLines(html) {
  const lines = htmlLines(html);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const dateMatch = lines[i].match(DATE_TIME_RE);
    if (!dateMatch) continue;
    let title = '';
    for (let j = i - 1; j >= Math.max(0, i - 6); j -= 1) {
      const candidate = clean(lines[j]);
      if (!candidate || /^(?:upcoming|live|previous|events|watch now)$/i.test(candidate)) continue;
      if (DATE_RE.test(candidate) || parseCityState(candidate)) continue;
      title = candidate;
      break;
    }
    if (!title || /\b(?:boxing|grappling|bjj|jiu jitsu|kickboxing|muay thai)\b/i.test(title)) continue;
    let location = null;
    for (let j = i + 1; j <= Math.min(lines.length - 1, i + 5); j += 1) {
      location = parseCityState(lines[j]);
      if (location) break;
    }
    if (!location) continue;
    const date = parseDate(lines[i]);
    out.push(makeEvent({
      sourceKey: 'spectation',
      sourceLabel: 'Spectation Sports',
      promotion: promotionFromTitle(title),
      title,
      date,
      city: location.city,
      state: location.state,
      url: 'https://spectationsports.com/events?type=upcoming',
      level: 'professional'
    }));
  }
  return out.filter(Boolean);
}

async function loadSpectation(source) {
  const html = await fetchHtml(source.url);
  return dedupe([
    ...parseJsonLdEvents(html, source.key, source.name, '', source.url),
    ...parseSpectationText(html),
    ...parseSpectationLines(html)
  ]).filter(event => event.date >= TODAY);
}

function isAllowedNitroGroup(name) {
  const normalized = norm(name);
  if (!normalized || NITRO_EXCLUDE.test(name)) return false;
  return NITRO_MMA_GROUPS.some(group => normalized === norm(group) || normalized.includes(norm(group)) || norm(group).includes(normalized));
}

function titleFromEventPage(html, fallback) {
  const lines = htmlLines(html);
  const heading = lines.find(line => line.length >= 4 && line.length <= 140 && !/^(?:home|events|questions|contact us|sell with us|purchase tickets|resend|copyright)/i.test(line) && !DATE_RE.test(line));
  return clean(fallback || heading);
}

function fallbackNitroEvent(html, groupName, eventUrl, fallbackTitle) {
  const lines = htmlLines(html);
  const title = titleFromEventPage(html, fallbackTitle);
  const dateLine = lines.find(line => DATE_RE.test(line));
  const date = parseDate(dateLine || '');
  let location = null;
  let locationIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const parsed = parseCityState(lines[i]);
    if (parsed) {
      location = parsed;
      locationIndex = i;
      break;
    }
  }
  if (!location || !date) return null;
  let venue = '';
  for (let i = Math.max(0, locationIndex - 4); i < locationIndex; i += 1) {
    const candidate = clean(lines[i]);
    if (!candidate || DATE_RE.test(candidate) || /^(?:venue|location|address|tickets?|purchase tickets?)$/i.test(candidate)) continue;
    venue = candidate;
  }
  return makeEvent({
    sourceKey: 'nitro',
    sourceLabel: 'Nitro Tickets',
    promotion: groupName,
    title,
    date,
    city: location.city,
    state: location.state,
    venue,
    url: eventUrl,
    level: 'regional'
  });
}

async function loadNitro(source) {
  const home = await fetchHtml(source.url);
  const groups = new Map();
  for (const anchor of extractAnchors(home)) {
    if (!isAllowedNitroGroup(anchor.text)) continue;
    const url = absoluteUrl(source.url, anchor.href);
    if (!url || /\/event\//i.test(url)) continue;
    groups.set(url, anchor.text);
  }

  const events = [];
  for (const [groupUrl, groupName] of groups) {
    let groupHtml;
    try {
      groupHtml = await fetchHtml(groupUrl);
    } catch (error) {
      console.warn(`Nitro group ${groupName}: ${error.message}`);
      continue;
    }

    const eventLinks = new Map();
    for (const anchor of extractAnchors(groupHtml)) {
      if (!/\/event\//i.test(anchor.href)) continue;
      const url = absoluteUrl(groupUrl, anchor.href);
      if (!url) continue;
      const title = clean(anchor.text);
      if (title && !/^(?:purchase tickets?|tickets?|view event)$/i.test(title)) {
        const previous = eventLinks.get(url) || '';
        if (title.length > previous.length) eventLinks.set(url, title);
      } else if (!eventLinks.has(url)) {
        eventLinks.set(url, '');
      }
    }

    for (const [eventUrl, fallbackTitle] of eventLinks) {
      let eventHtml;
      try {
        eventHtml = await fetchHtml(eventUrl);
      } catch (error) {
        console.warn(`Nitro event ${eventUrl}: ${error.message}`);
        continue;
      }
      const parsed = parseJsonLdEvents(eventHtml, 'nitro', 'Nitro Tickets', groupName, eventUrl);
      if (parsed.length) events.push(...parsed);
      else {
        const fallback = fallbackNitroEvent(eventHtml, groupName, eventUrl, fallbackTitle);
        if (fallback) events.push(fallback);
      }
      await sleep(120);
    }
    await sleep(180);
  }

  return dedupe(events).filter(event => event.date >= TODAY);
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const current = await readJson(DATA_PATH, { version: 1, sources: [], events: [] });
const discoveryKeys = new Set(DISCOVERY_SOURCES.map(source => source.key));
const baseEvents = (current.events || []).filter(event => !discoveryKeys.has(event.source_key));
const previousBySource = new Map();
for (const event of current.events || []) {
  if (!discoveryKeys.has(event.source_key)) continue;
  if (!previousBySource.has(event.source_key)) previousBySource.set(event.source_key, []);
  previousBySource.get(event.source_key).push(event);
}

const discovered = [];
for (const source of DISCOVERY_SOURCES) {
  let events = [];
  try {
    events = dedupe(await source.loader(source)).filter(event => event.date >= TODAY);
    if (!events.length) throw new Error('No future U.S. MMA events parsed');
    console.log(`${source.name}: ${events.length} future U.S. MMA event(s)`);
  } catch (error) {
    events = (previousBySource.get(source.key) || []).filter(event => event.date >= TODAY);
    console.warn(`${source.name}: ${error.message}; preserving ${events.length} existing event(s)`);
  }
  discovered.push(...events);
}

const merged = [...baseEvents];
for (const event of dedupe(discovered)) {
  const duplicateIndex = merged.findIndex(existing => sameEvent(existing, event));
  if (duplicateIndex === -1) {
    merged.push(event);
    continue;
  }
  if (event.source_key === 'nitro') {
    merged[duplicateIndex] = {
      ...merged[duplicateIndex],
      ticket_url: event.official_url,
      venue: merged[duplicateIndex].venue || event.venue,
      latitude: merged[duplicateIndex].latitude ?? event.latitude,
      longitude: merged[duplicateIndex].longitude ?? event.longitude
    };
  }
}

const sources = [
  ...(current.sources || []).filter(source => !discoveryKeys.has(source.key)),
  ...DISCOVERY_SOURCES.map(({ key, name, url }) => ({ key, name, url }))
];
const output = {
  version: 1,
  sources,
  events: merged.sort((a, b) => a.date.localeCompare(b.date) || a.promotion.localeCompare(b.promotion) || a.title.localeCompare(b.title))
};

await fs.writeFile(DATA_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Event Map discovery merged: ${output.events.length} total regional event(s).`);
