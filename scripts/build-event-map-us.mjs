import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const MAJOR_PATH = '_data/upcoming_events.json';
const REGIONAL_PATH = '_data/event_map_regional.json';
const OUTPUT_PATH = '_data/event_map_us.json';

const STATE_ENTRIES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming']
];
const STATE_BY_CODE = new Map(STATE_ENTRIES);
const STATE_BY_NAME = new Map(STATE_ENTRIES.map(([code, name]) => [name.toLowerCase(), code]));
const US_COUNTRIES = new Set(['us','usa','u s','u s a','united states','united states of america']);

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

function normalizeState(value) {
  const text = clean(value).replace(/\d{5}(?:-\d{4})?$/, '').trim();
  const code = text.toUpperCase();
  if (STATE_BY_CODE.has(code)) return code;
  return STATE_BY_NAME.get(text.toLowerCase()) || '';
}

function countryIsForeign(event) {
  const value = norm(event.country || event.country_code || event.countryCode);
  return Boolean(value && !US_COUNTRIES.has(value));
}

function parseLocationSegment(segment) {
  const text = clean(segment).replace(/\s+\|\s+/g, ', ');
  if (!text) return null;

  const parts = text.split(',').map(clean).filter(Boolean);
  if (parts.length >= 2) {
    const tail = norm(parts.at(-1));
    if (US_COUNTRIES.has(tail) && parts.length >= 3) parts.pop();
    const state = normalizeState(parts.at(-1));
    if (state) {
      const city = clean(parts.at(-2));
      if (city && !/^\d+$/.test(city) && !STATE_BY_NAME.has(city.toLowerCase())) {
        return { city, state };
      }
    }
  }

  for (const [code, name] of STATE_ENTRIES) {
    const fullName = name.replace(/ /g, '\\s+');
    const fullMatch = text.match(new RegExp(`^(.+?)\\s+${fullName}(?:\\s+(?:USA|United\\s+States))?$`, 'i'));
    if (fullMatch) {
      const city = clean(fullMatch[1]).replace(/[·|,-]+$/, '').trim();
      if (city && city.length <= 64) return { city, state: code };
    }
  }

  return null;
}

export function trustedUsLocation(event) {
  if (!event || countryIsForeign(event)) return null;

  const explicitState = normalizeState(event.state || event.state_code || event.stateCode);
  const explicitCity = clean(event.city);
  if (explicitState && explicitCity) {
    return {
      city: explicitCity,
      state: explicitState,
      source: 'structured',
      confidence: 'verified-structured'
    };
  }

  const candidates = [];
  if (clean(event.location)) candidates.push({ source: 'location', value: clean(event.location) });
  if (clean(event.venue)) {
    const venueParts = String(event.venue).split(/[·|]/).map(clean).filter(Boolean);
    for (let index = venueParts.length - 1; index >= 0; index -= 1) {
      candidates.push({ source: 'venue', value: venueParts[index] });
    }
    candidates.push({ source: 'venue', value: clean(event.venue) });
  }

  // Deliberately never inspect event.title. Event titles contain ordinary words
  // such as "in", "or", "me" and "ok" that collide with U.S. postal codes.
  for (const candidate of candidates) {
    const parsed = parseLocationSegment(candidate.value);
    if (!parsed) continue;
    return {
      ...parsed,
      source: candidate.source,
      confidence: candidate.source === 'location' ? 'verified-location' : 'parsed-venue'
    };
  }

  return null;
}

function coordinates(event) {
  const hasLat = event.latitude !== undefined || event.lat !== undefined;
  const hasLon = event.longitude !== undefined || event.lng !== undefined;
  if (!hasLat || !hasLon) return null;
  const latitude = Number(event.latitude ?? event.lat);
  const longitude = Number(event.longitude ?? event.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { invalid: true };
  return { latitude, longitude };
}

function coordinatesInUsBounds(point) {
  if (!point || point.invalid) return !point;
  return point.latitude >= 18 && point.latitude <= 72 && point.longitude >= -180 && point.longitude <= -60;
}

function normalizedMapEvent(event, kind) {
  const location = trustedUsLocation(event);
  if (!location) return { event: null, reason: countryIsForeign(event) ? 'foreign-country' : 'unresolved-us-location' };

  const point = coordinates(event);
  if (point && !coordinatesInUsBounds(point)) return { event: null, reason: 'coordinates-outside-us' };

  return {
    event: {
      ...event,
      city: location.city,
      state: location.state,
      state_code: location.state,
      country: 'US',
      map_location_source: location.source,
      map_location_confidence: location.confidence,
      map_dataset: kind
    },
    reason: ''
  };
}

function quarantineRecord(event, kind, reason) {
  return {
    id: clean(event.id),
    title: clean(event.title),
    date: clean(event.date),
    promotion: clean(event.promotion),
    venue: clean(event.venue),
    location: clean(event.location),
    kind,
    reason
  };
}

export function buildUsDataset(majorDoc, regionalDoc) {
  const events = [];
  const quarantined = [];
  let majorMapped = 0;
  let regionalMapped = 0;

  for (const event of majorDoc.events || []) {
    const result = normalizedMapEvent(event, 'major');
    if (result.event) {
      events.push(result.event);
      majorMapped += 1;
    } else {
      quarantined.push(quarantineRecord(event, 'major', result.reason));
    }
  }

  for (const event of regionalDoc.events || []) {
    const result = normalizedMapEvent(event, 'regional');
    if (result.event) {
      events.push(result.event);
      regionalMapped += 1;
    } else {
      quarantined.push(quarantineRecord(event, 'regional', result.reason));
    }
  }

  events.sort((a, b) => clean(a.date).localeCompare(clean(b.date)) || clean(a.title).localeCompare(clean(b.title)));
  quarantined.sort((a, b) => clean(a.date).localeCompare(clean(b.date)) || clean(a.title).localeCompare(clean(b.title)));

  return {
    schema_version: 1,
    source_major_generated_at: majorDoc.generated_at || null,
    source_regional_updated_at: regionalDoc.updated_at || regionalDoc.generated_at || null,
    major_total: (majorDoc.events || []).length,
    major_mapped: majorMapped,
    regional_total: (regionalDoc.events || []).length,
    regional_mapped: regionalMapped,
    quarantined_count: quarantined.length,
    quarantined,
    events
  };
}

function selfTest() {
  const cases = [
    [
      { title: 'RIZIN LANDMARK 16 in NAGASAKI', venue: '長崎スタジアムシティ HAPPINESS ARENA' },
      null,
      'RIZIN Nagasaki must never become Indiana from the word "in"'
    ],
    [
      { title: 'Event in Paris', venue: 'Accor Arena · Paris, France' },
      null,
      'foreign venue must not become Indiana from title text'
    ],
    [
      { title: 'UFC Fight Night', venue: 'Meta APEX · Las Vegas, Nevada' },
      { city: 'Las Vegas', state: 'NV' },
      'full state name in venue'
    ],
    [
      { title: 'Regional MMA', location: 'Portland, OR' },
      { city: 'Portland', state: 'OR' },
      'postal code in explicit location'
    ],
    [
      { title: 'Anything', city: 'Austin', state: 'TX' },
      { city: 'Austin', state: 'TX' },
      'structured city/state'
    ],
    [
      { title: 'Anything', city: 'Austin', state: 'TX', country: 'Japan' },
      null,
      'foreign country overrides accidental U.S. fields'
    ]
  ];

  let failures = 0;
  for (const [event, expected, label] of cases) {
    const actual = trustedUsLocation(event);
    const compact = actual ? { city: actual.city, state: actual.state } : null;
    if (JSON.stringify(compact) !== JSON.stringify(expected)) {
      failures += 1;
      console.error(`Event Map location self-test failed: ${label}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(compact)}.`);
    }
  }
  if (failures) process.exit(1);
  console.log('Event Map trusted-location self-test passed.');
}

async function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const [majorDoc, regionalDoc] = await Promise.all([readJson(MAJOR_PATH), readJson(REGIONAL_PATH)]);
  const output = buildUsDataset(majorDoc, regionalDoc);
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(
    `Built trusted U.S. Event Map: ${output.major_mapped}/${output.major_total} major + ` +
    `${output.regional_mapped}/${output.regional_total} regional mapped; ${output.quarantined_count} quarantined.`
  );
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
