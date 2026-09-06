import fs from 'node:fs/promises';

const DATA_PATH = process.argv[2] || '_data/event_map_regional.json';
const STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','DC','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY']);
const failures = [];

let data;
try {
  data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
} catch (error) {
  console.error(`Could not read ${DATA_PATH}: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(data.sources) || !data.sources.length) failures.push('Regional Event Map has no configured sources.');
if (!Array.isArray(data.events)) failures.push('Regional Event Map events must be an array.');

const ids = new Set();
for (const [index, event] of (data.events || []).entries()) {
  const label = `event ${index + 1}`;
  if (!event?.id) failures.push(`${label}: missing id.`);
  else if (ids.has(event.id)) failures.push(`${label}: duplicate id ${event.id}.`);
  else ids.add(event.id);

  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(event.date || ''))) failures.push(`${label}: invalid date.`);
  if (!String(event.promotion || '').trim()) failures.push(`${label}: missing promotion.`);
  if (!String(event.title || '').trim()) failures.push(`${label}: missing title.`);
  if (!String(event.location || '').trim()) failures.push(`${label}: missing location.`);
  if (!String(event.source_key || '').trim()) failures.push(`${label}: missing source_key.`);
  if (!/^https:\/\//i.test(String(event.official_url || ''))) failures.push(`${label}: official_url must use https.`);
  if (event.regional !== true) failures.push(`${label}: regional flag must be true.`);

  const stateMatch = String(event.location || '').match(/,\s*([A-Z]{2})\b/);
  if (!stateMatch || !STATES.has(stateMatch[1])) failures.push(`${label}: location must end with a valid U.S. state code.`);

  const hasLat = event.latitude !== undefined;
  const hasLon = event.longitude !== undefined;
  if (hasLat !== hasLon) failures.push(`${label}: latitude and longitude must be supplied together.`);
  if (hasLat && hasLon) {
    const lat = Number(event.latitude);
    const lon = Number(event.longitude);
    if (!Number.isFinite(lat) || lat < 18 || lat > 72) failures.push(`${label}: latitude is outside expected U.S. bounds.`);
    if (!Number.isFinite(lon) || lon < -180 || lon > -60) failures.push(`${label}: longitude is outside expected U.S. bounds.`);
  }
}

if (failures.length) {
  console.error(`Regional Event Map validation failed with ${failures.length} issue(s):`);
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}

console.log(`Regional Event Map valid: ${(data.events || []).length} event(s) across ${(data.sources || []).length} source(s).`);
