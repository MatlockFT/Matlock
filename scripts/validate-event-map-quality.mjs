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

async function load(path) {
  const data = JSON.parse(await fs.readFile(path, 'utf8'));
  if (!Array.isArray(data.events)) throw new Error(`${path}: events must be an array`);
  return data.events;
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

function coordinateCheck(event, label) {
  const hasLat = event.latitude !== undefined || event.lat !== undefined;
  const hasLon = event.longitude !== undefined || event.lng !== undefined;
  if (hasLat !== hasLon) failures.push(`${label}: latitude/longitude must be supplied together.`);
  if (!hasLat || !hasLon) return;
  const lat = Number(event.latitude ?? event.lat);
  const lon = Number(event.longitude ?? event.lng);
  if (!Number.isFinite(lat) || lat < 18 || lat > 72) failures.push(`${label}: latitude outside expected U.S. bounds.`);
  if (!Number.isFinite(lon) || lon < -180 || lon > -60) failures.push(`${label}: longitude outside expected U.S. bounds.`);
}

const [major, regional, pickerRegional] = await Promise.all([
  load(FILES.major), load(FILES.regional), load(FILES.pickerRegional)
]);
const mapEvents = [...major, ...regional];
const today = new Date();
today.setHours(0, 0, 0, 0);
const staleCutoff = new Date(today);
staleCutoff.setDate(staleCutoff.getDate() - 2);

const ids = new Map();
const semantic = new Map();
for (const [index, event] of mapEvents.entries()) {
  const source = index < major.length ? 'major' : 'regional';
  const label = `${source}:${event.id || event.title || index}`;
  const id = clean(event.id);
  if (!id) failures.push(`${label}: missing id.`);
  else if (ids.has(id)) failures.push(`${label}: duplicate map id also used by ${ids.get(id)}.`);
  else ids.set(id, label);

  if (!/^20\d{2}-\d{2}-\d{2}$/.test(clean(event.date))) failures.push(`${label}: invalid or missing YYYY-MM-DD date.`);
  else {
    const date = new Date(`${event.date}T12:00:00`);
    if (!Number.isNaN(date.getTime()) && date < staleCutoff) warnings.push(`${label}: event is more than two days in the past and should be pruned.`);
  }
  if (!clean(event.promotion)) failures.push(`${label}: missing promotion.`);
  if (!clean(event.title)) failures.push(`${label}: missing title.`);
  if (source === 'regional' && !locationHasState(event)) failures.push(`${label}: location/venue has no recognizable U.S. state.`);
  if (!validHttp(event.official_url)) failures.push(`${label}: invalid official_url.`);
  if (!validHttp(event.ticket_url)) failures.push(`${label}: invalid ticket_url.`);
  coordinateCheck(event, label);

  const semanticKey = [clean(event.date), canonicalPromotion(event.promotion), norm(event.title), norm(event.location || event.venue)].join('|');
  if (semanticKey.replaceAll('|', '')) {
    if (semantic.has(semanticKey) && semantic.get(semanticKey) !== id) {
      failures.push(`${label}: semantic duplicate of ${semantic.get(semanticKey)} (same date/promotion/title/location).`);
    } else semantic.set(semanticKey, id || label);
  }

  const fighters = event?.main_event?.fighters;
  if (Array.isArray(fighters) && fighters.length === 1) warnings.push(`${label}: main_event contains only one fighter.`);
}

const mapRegionalIds = new Set(regional.map(event => clean(event.id)).filter(Boolean));
for (const event of pickerRegional) {
  const id = clean(event.id);
  if (id && !mapRegionalIds.has(id)) failures.push(`picker-regional:${id}: appears in Fight Card Picker but is missing from Event Map regional data.`);
}

if (warnings.length) {
  console.warn(`Event Map quality warnings (${warnings.length}):`);
  warnings.forEach(item => console.warn(`- ${item}`));
}
if (failures.length) {
  console.error(`Event Map quality validation failed (${failures.length}):`);
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log(`Event Map quality passed: ${mapEvents.length} mapped events (${major.length} major + ${regional.length} regional), ${pickerRegional.length} curated regional picker events.`);
