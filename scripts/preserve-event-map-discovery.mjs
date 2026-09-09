import fs from 'node:fs/promises';

const CURRENT_PATH = '_data/event_map_regional.json';
const SNAPSHOT_PATH = process.argv[2] || '/tmp/event-map-regional-before.json';
const TODAY = new Date().toISOString().slice(0, 10);
const DIRECT_SOURCE_KEYS = new Set(['fury', 'cffc', '559', 'peak']);

const clean = value => String(value || '').trim();
const eventKey = event => [
  clean(event.source_key || event.promotion_key),
  clean(event.date),
  clean(event.id || `${event.promotion || ''}|${event.title || ''}|${event.location || ''}`)
].join('|').toLowerCase();

async function readJson(path, fallback) {
  try {
    return JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

const [current, snapshot] = await Promise.all([
  readJson(CURRENT_PATH, { version: 1, sources: [], events: [] }),
  readJson(SNAPSHOT_PATH, { version: 1, sources: [], events: [] })
]);

const preserved = (snapshot.events || []).filter(event => {
  const sourceKey = clean(event.source_key || event.promotion_key);
  return sourceKey && !DIRECT_SOURCE_KEYS.has(sourceKey) && clean(event.date) >= TODAY;
});

const events = [...(current.events || [])];
const keys = new Set(events.map(eventKey));
for (const event of preserved) {
  const key = eventKey(event);
  if (keys.has(key)) continue;
  keys.add(key);
  events.push(event);
}

events.sort((a, b) =>
  clean(a.date).localeCompare(clean(b.date)) ||
  clean(a.promotion).localeCompare(clean(b.promotion)) ||
  clean(a.title).localeCompare(clean(b.title))
);

const sourceMap = new Map();
for (const source of [...(snapshot.sources || []), ...(current.sources || [])]) {
  if (!source?.key) continue;
  sourceMap.set(source.key, source);
}

const output = {
  version: current.version || snapshot.version || 1,
  sources: [...sourceMap.values()],
  events
};

await fs.writeFile(CURRENT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Preserved ${preserved.length} discovery event(s) across direct-source refresh.`);
