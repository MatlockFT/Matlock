import fs from 'node:fs/promises';
import { trustedUsLocation } from './build-event-map-us.mjs';

const MAP_PATH = '_data/event_map_us.json';
const MAJOR_PATH = '_data/upcoming_events.json';
const REGIONAL_PATH = '_data/event_map_regional.json';

const STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']);
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const failures = [];

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

const [mapDoc, majorDoc, regionalDoc] = await Promise.all([
  readJson(MAP_PATH),
  readJson(MAJOR_PATH),
  readJson(REGIONAL_PATH)
]);

if (!Array.isArray(mapDoc.events)) failures.push('event_map_us.json: events must be an array.');
if (!Array.isArray(mapDoc.quarantined)) failures.push('event_map_us.json: quarantined must be an array.');

const ids = new Set();
for (const [index, event] of (mapDoc.events || []).entries()) {
  const label = `mapped:${event.id || event.title || index}`;
  const id = clean(event.id);
  if (!id) failures.push(`${label}: missing id.`);
  else if (ids.has(id)) failures.push(`${label}: duplicate id.`);
  else ids.add(id);

  if (!clean(event.city)) failures.push(`${label}: missing trusted city.`);
  const state = clean(event.state || event.state_code).toUpperCase();
  if (!STATES.has(state)) failures.push(`${label}: missing/invalid trusted U.S. state.`);
  if (clean(event.country).toUpperCase() !== 'US') failures.push(`${label}: mapped event must be explicitly country=US.`);
  if (!clean(event.map_location_source)) failures.push(`${label}: missing map_location_source.`);
  if (!clean(event.map_location_confidence)) failures.push(`${label}: missing map_location_confidence.`);

  const hasLat = event.latitude !== undefined || event.lat !== undefined;
  const hasLon = event.longitude !== undefined || event.lng !== undefined;
  if (hasLat !== hasLon) failures.push(`${label}: latitude/longitude must be supplied together.`);
  if (hasLat && hasLon) {
    const lat = Number(event.latitude ?? event.lat);
    const lon = Number(event.longitude ?? event.lng);
    if (!Number.isFinite(lat) || lat < 18 || lat > 72) failures.push(`${label}: latitude outside broad U.S. bounds.`);
    if (!Number.isFinite(lon) || lon < -180 || lon > -60) failures.push(`${label}: longitude outside broad U.S. bounds.`);
  }
}

const sourceRegionalIds = new Set((regionalDoc.events || []).map(event => clean(event.id)).filter(Boolean));
const mappedRegionalIds = new Set((mapDoc.events || []).filter(event => event.map_dataset === 'regional').map(event => clean(event.id)).filter(Boolean));
for (const id of sourceRegionalIds) {
  if (!mappedRegionalIds.has(id)) failures.push(`regional:${id}: trusted U.S. builder quarantined a regional event; fix its location source instead of silently dropping it.`);
}

const nagasaki = (majorDoc.events || []).find(event => /RIZIN\s+LANDMARK\s+16\s+in\s+NAGASAKI/i.test(clean(event.title)));
if (nagasaki) {
  const parsed = trustedUsLocation(nagasaki);
  if (parsed) failures.push(`RIZIN Nagasaki regression: parsed as ${parsed.city}, ${parsed.state}. Foreign event titles must never create U.S. pins.`);
  if (ids.has(clean(nagasaki.id))) failures.push('RIZIN Nagasaki regression: foreign event is present in the U.S. map dataset.');
}

const mappedMajor = (mapDoc.events || []).filter(event => event.map_dataset === 'major').length;
const mappedRegional = (mapDoc.events || []).filter(event => event.map_dataset === 'regional').length;
if (mappedMajor !== Number(mapDoc.major_mapped || 0)) failures.push('event_map_us.json: major_mapped count does not match events.');
if (mappedRegional !== Number(mapDoc.regional_mapped || 0)) failures.push('event_map_us.json: regional_mapped count does not match events.');
if ((mapDoc.quarantined || []).length !== Number(mapDoc.quarantined_count || 0)) failures.push('event_map_us.json: quarantined_count does not match records.');

if (failures.length) {
  console.error(`Trusted U.S. Event Map validation failed (${failures.length}):`);
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(
  `Trusted U.S. Event Map passed: ${mapDoc.events.length} mapped events ` +
  `(${mappedMajor} major + ${mappedRegional} regional), ${mapDoc.quarantined_count || 0} quarantined major/foreign events.`
);
