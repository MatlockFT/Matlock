import fs from 'node:fs/promises';

const FILES = {
  major: '_data/upcoming_events.json',
  regional: '_data/event_map_regional.json',
  pickerRegional: '_data/upcoming_events_regional.json'
};

const STATES = new Map(Object.entries({
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'
}));

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const failures = [];
const warnings = [];
const qualityCounts = {
  missingCoordinates: 0,
  missingPoster: 0,
  missingMainEvent: 0,
  stale: 0
};

async function loadDoc(path) {
  const data = JSON.parse(await fs.readFile(path, 'utf8'));
  if (!Array.isArray(data.events)) throw new Error(`${path}: events must be an array`);
  return data;
}

function canonicalPromotion(value) {
  const text = norm(value);
  if (/^(ultimate fighting championship|ufc)\b/.test(text)) return 'ufc';
  if (/^(dana whites contender series|dwcs)\b/.test(text)) return 'dwcs';
  if (/^(legacy fighting alliance|lfa)\b/.test(text)) return 'lfa';
  if (/^(professional fighters league|pfl)\b/.test(text)) return 'pfl';
  if (/^(cage fury fighting championships|cffc)\b/.test(text)) return 'cffc';
  if (/^rizin\b/.test(text)) return 'rizin';
  if (/^(one championship|one)\b/.test(text)) return 'one';
  return text.replace(/\b\d+\b.*$/, '').trim();
}

function validHttp(value) {
  if (!clean(value)) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function normalizedUrl(value) {
  if (!validHttp(value) || !clean(value)) return '';
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return '';
  }
}

function locationHasState(event) {
  const explicit = clean(event.state || event.state_code).toUpperCase();
  if (STATES.has(explicit)) return true;
  const source = `${clean(event.location)} ${clean(event.venue)}`;
  for (const [code, name] of STATES) {
    if (new RegExp(`(?:,|\\b)\\s*${code}\\b`, 'i').test(source)) return true;
    if (new RegExp(`\\b${name.replace(/ /g, '\\s+')}\\b`, 'i').test(source)) return true;
  }
  return false;
}

function eventDate(value) {
  const match = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(clean(value));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) return null;
  return parsed;
}

function coordinateCheck(event, label) {
  const hasLat = event.latitude !== undefined || event.lat !== undefined;
  const hasLon = event.longitude !== undefined || event.lng !== undefined;
  if (hasLat !== hasLon) failures.push(`${label}: latitude/longitude must be supplied together.`);
  if (!hasLat || !hasLon) {
    qualityCounts.missingCoordinates += 1;
    return;
  }
  const lat = Number(event.latitude ?? event.lat);
  const lon = Number(event.longitude ?? event.lng);
  if (!Number.isFinite(lat) || lat < 18 || lat > 72) failures.push(`${label}: latitude outside expected U.S. bounds.`);
  if (!Number.isFinite(lon) || lon < -180 || lon > -60) failures.push(`${label}: longitude outside expected U.S. bounds.`);
}

function fighterName(value) {
  if (typeof value === 'string') return clean(value);
  if (value && typeof value === 'object') return clean(value.name || value.fighter || value.label);
  return '';
}

function mainEventCheck(event, label) {
  const fighters = event?.main_event?.fighters;
  if (fighters === undefined || fighters === null) {
    qualityCounts.missingMainEvent += 1;
    return;
  }
  if (!Array.isArray(fighters)) {
    failures.push(`${label}: main_event.fighters must be an array when present.`);
    return;
  }
  const names = fighters.map(fighterName).filter(Boolean);
  if (names.length !== fighters.length) failures.push(`${label}: main_event contains an unnamed fighter.`);
  if (names.length === 1) warnings.push(`${label}: main_event contains only one fighter.`);
  if (names.length > 2) warnings.push(`${label}: main_event contains ${names.length} fighters; expected a head-to-head matchup.`);
  if (names.length >= 2 && norm(names[0]) === norm(names[1])) failures.push(`${label}: main_event lists the same fighter twice.`);
}

function placeholderText(value) {
  return /^(?:tba|tbd|unknown|n\/?a|none|null|undefined|-+)$/i.test(clean(value));
}

const [majorDoc, regionalDoc, pickerRegionalDoc] = await Promise.all([
  loadDoc(FILES.major), loadDoc(FILES.regional), loadDoc(FILES.pickerRegional)
]);
const major = majorDoc.events;
const regional = regionalDoc.events;
const pickerRegional = pickerRegionalDoc.events;
const mapEvents = [...major, ...regional];

const sourceKeys = new Set();
for (const [index, source] of (regionalDoc.sources || []).entries()) {
  const key = clean(source?.key);
  const label = `regional-source:${key || index}`;
  if (!key) failures.push(`${label}: missing source key.`);
  else if (sourceKeys.has(key)) failures.push(`${label}: duplicate source key.`);
  else sourceKeys.add(key);
  if (!clean(source?.name)) failures.push(`${label}: missing source name.`);
  if (!validHttp(source?.url) || !clean(source?.url)) failures.push(`${label}: source URL must be a valid HTTP(S) URL.`);
}
if (!sourceKeys.size) failures.push('regional data must declare at least one source.');

const today = new Date();
today.setHours(0, 0, 0, 0);
const staleCutoff = new Date(today);
staleCutoff.setDate(staleCutoff.getDate() - 2);
const futureCeiling = new Date(today);
futureCeiling.setFullYear(futureCeiling.getFullYear() + 3);

const ids = new Map();
const semantic = new Map();
const looseSemantic = new Map();
const officialUrls = new Map();
for (const [index, event] of mapEvents.entries()) {
  const source = index < major.length ? 'major' : 'regional';
  const label = `${source}:${event.id || event.title || index}`;
  const id = clean(event.id);
  if (!id) failures.push(`${label}: missing id.`);
  else if (ids.has(id)) failures.push(`${label}: duplicate map id also used by ${ids.get(id)}.`);
  else ids.set(id, label);

  const parsedDate = eventDate(event.date);
  if (!parsedDate) failures.push(`${label}: invalid or missing real YYYY-MM-DD date.`);
  else {
    if (parsedDate < staleCutoff) {
      qualityCounts.stale += 1;
      warnings.push(`${label}: event is more than two days in the past and should be pruned.`);
    }
    if (parsedDate > futureCeiling) warnings.push(`${label}: event is more than three years away; verify the parsed year.`);
  }

  if (!clean(event.promotion) || placeholderText(event.promotion)) failures.push(`${label}: missing/placeholder promotion.`);
  if (!clean(event.title) || placeholderText(event.title)) failures.push(`${label}: missing/placeholder title.`);
  if (clean(event.title).length > 180) warnings.push(`${label}: title is unusually long (${clean(event.title).length} chars).`);
  if (source === 'regional') {
    if (!locationHasState(event)) failures.push(`${label}: location/venue has no recognizable U.S. state.`);
    if (!clean(event.source_key)) failures.push(`${label}: missing source_key.`);
    else if (!sourceKeys.has(clean(event.source_key))) failures.push(`${label}: source_key ${event.source_key} is not declared in regional sources.`);
    if (!clean(event.source_label)) warnings.push(`${label}: missing source_label.`);
    if (!clean(event.location) || placeholderText(event.location)) failures.push(`${label}: regional event needs a usable location.`);
  }

  for (const [field, value] of [['official_url', event.official_url], ['ticket_url', event.ticket_url], ['poster_url', event.poster_url]]) {
    if (!validHttp(value)) failures.push(`${label}: invalid ${field}.`);
  }
  if (!clean(event.poster_url)) qualityCounts.missingPoster += 1;

  const officialKey = normalizedUrl(event.official_url);
  if (officialKey) {
    const prior = officialUrls.get(officialKey);
    if (prior && prior.date === clean(event.date) && prior.id !== id && norm(prior.title) === norm(event.title)) {
      failures.push(`${label}: duplicates ${prior.id} via the same official URL/date/title.`);
    } else if (!prior) {
      officialUrls.set(officialKey, { id, date: clean(event.date), title: event.title });
    }
  }

  coordinateCheck(event, label);
  mainEventCheck(event, label);

  const semanticKey = [clean(event.date), canonicalPromotion(event.promotion), norm(event.title), norm(event.location || event.venue)].join('|');
  if (semanticKey.replaceAll('|', '')) {
    if (semantic.has(semanticKey) && semantic.get(semanticKey) !== id) {
      failures.push(`${label}: semantic duplicate of ${semantic.get(semanticKey)} (same date/promotion/title/location).`);
    } else semantic.set(semanticKey, id || label);
  }

  const looseKey = [clean(event.date), canonicalPromotion(event.promotion), norm(event.title)].join('|');
  if (looseKey.replaceAll('|', '')) {
    if (looseSemantic.has(looseKey) && looseSemantic.get(looseKey) !== id) {
      warnings.push(`${label}: possible duplicate of ${looseSemantic.get(looseKey)} (same date/promotion/title; location differs or is missing).`);
    } else looseSemantic.set(looseKey, id || label);
  }
}

const mapRegionalById = new Map(regional.map(event => [clean(event.id), event]).filter(([id]) => id));
for (const event of pickerRegional) {
  const id = clean(event.id);
  if (!id) {
    failures.push('picker-regional: event is missing id.');
    continue;
  }
  const mapped = mapRegionalById.get(id);
  if (!mapped) {
    failures.push(`picker-regional:${id}: appears in Fight Card Picker but is missing from Event Map regional data.`);
    continue;
  }
  if (clean(mapped.date) !== clean(event.date)) failures.push(`picker-regional:${id}: date disagrees with Event Map regional data.`);
  if (canonicalPromotion(mapped.promotion) !== canonicalPromotion(event.promotion)) failures.push(`picker-regional:${id}: promotion disagrees with Event Map regional data.`);
  if (norm(mapped.title) !== norm(event.title)) warnings.push(`picker-regional:${id}: title differs from Event Map regional data.`);
}

console.log(
  `Event Map completeness: ${qualityCounts.missingCoordinates}/${mapEvents.length} without coordinates, ` +
  `${qualityCounts.missingPoster}/${mapEvents.length} without posters, ` +
  `${qualityCounts.missingMainEvent}/${mapEvents.length} without a listed main event, ` +
  `${qualityCounts.stale} stale.`
);

if (warnings.length) {
  console.warn(`Event Map quality warnings (${warnings.length}):`);
  warnings.forEach(item => console.warn(`- ${item}`));
}
if (failures.length) {
  console.error(`Event Map quality validation failed (${failures.length}):`);
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log(`Event Map quality passed: ${mapEvents.length} mapped events (${major.length} major + ${regional.length} regional), ${pickerRegional.length} curated regional picker events, ${sourceKeys.size} regional sources.`);
