import fs from 'node:fs/promises';
import { enrichLocationMetadata, explicitForeignCountry, locationMismatch, normalizeState } from './event-location-utils.mjs';

const MAJOR_PATH = '_data/upcoming_events.json';
const REGIONAL_PATH = '_data/event_map_regional.json';
const MAP_PATH = '_data/event_map_us.json';
const REPORT_PATH = '_data/event_map_location_report.json';
const CHECK_ONLY = process.argv.includes('--check');

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const readJson = path => fs.readFile(path, 'utf8').then(JSON.parse);

const [majorDoc, regionalDoc, mapDoc] = await Promise.all([
  readJson(MAJOR_PATH), readJson(REGIONAL_PATH), readJson(MAP_PATH)
]);

const sourceEvents = [
  ...(majorDoc.events || []).map(event => ({ ...event, dataset: 'major' })),
  ...(regionalDoc.events || []).map(event => ({ ...event, dataset: 'regional' }))
];

const precision = { venue: 0, 'source-coordinates': 0, city: 0, structured: 0, unresolved: 0 };
const unresolved = [];
const suspicious = [];

for (const source of sourceEvents) {
  const event = enrichLocationMetadata(source);
  const country = clean(event.country).toUpperCase();
  const state = normalizeState(event.state || event.state_code);
  const city = clean(event.city);
  const hasCoords = Number.isFinite(Number(event.latitude)) && Number.isFinite(Number(event.longitude));
  let level = clean(event.location_precision);
  if (!level) level = hasCoords ? 'source-coordinates' : city && state ? 'structured' : 'unresolved';
  if (!(level in precision)) level = 'structured';
  precision[level] += 1;

  if (!explicitForeignCountry(event) && (!city || !state)) {
    unresolved.push({ id: clean(event.id), title: clean(event.title), date: clean(event.date), promotion: clean(event.promotion), venue: clean(event.venue), dataset: source.dataset });
  }

  const mismatch = locationMismatch(source);
  if (mismatch) {
    suspicious.push({
      id: clean(source.id), title: clean(source.title), date: clean(source.date), promotion: clean(source.promotion),
      venue: clean(source.venue), dataset: source.dataset, miles_from_registered_venue: mismatch.miles,
      expected_city: mismatch.expected_city, expected_state: mismatch.expected_state
    });
  }

  if (country === 'US' && (!city || !state)) {
    suspicious.push({ id: clean(source.id), title: clean(source.title), date: clean(source.date), promotion: clean(source.promotion), venue: clean(source.venue), dataset: source.dataset, issue: 'US event missing trusted city/state' });
  }
}

const mapped = mapDoc.events || [];
const mappedPrecision = {};
for (const event of mapped) {
  const key = clean(event.location_precision || event.map_location_precision || event.map_location_confidence || 'unspecified');
  mappedPrecision[key] = (mappedPrecision[key] || 0) + 1;
  const mismatch = locationMismatch(event);
  if (mismatch && !suspicious.some(item => item.id === event.id)) {
    suspicious.push({ id: clean(event.id), title: clean(event.title), date: clean(event.date), promotion: clean(event.promotion), venue: clean(event.venue), dataset: 'map', miles_from_registered_venue: mismatch.miles, expected_city: mismatch.expected_city, expected_state: mismatch.expected_state });
  }
}

const report = {
  schema_version: 1,
  source_totals: { major: majorDoc.events?.length || 0, regional: regionalDoc.events?.length || 0 },
  map_totals: { mapped: mapped.length, quarantined: mapDoc.quarantined_count || 0 },
  source_precision: precision,
  mapped_precision: mappedPrecision,
  unresolved_count: unresolved.length,
  unresolved,
  suspicious_count: suspicious.length,
  suspicious,
  quarantined: mapDoc.quarantined || []
};

if (!CHECK_ONLY) await fs.writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(
  `Event Map location quality: ${mapped.length} mapped, ${mapDoc.quarantined_count || 0} quarantined, ` +
  `${unresolved.length} unresolved source location(s), ${suspicious.length} suspicious coordinate/location mismatch(es).`
);
console.log(`Precision: ${Object.entries(precision).map(([key, value]) => `${key}=${value}`).join(', ')}.`);

if (suspicious.length) {
  console.error('Suspicious Event Map location records:');
  suspicious.forEach(item => console.error(`- ${item.id}: ${item.issue || `${item.miles_from_registered_venue} mi from ${item.expected_city}, ${item.expected_state}`}`));
  process.exit(1);
}
