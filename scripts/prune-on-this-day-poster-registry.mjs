import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const REGISTRY_PATH = process.argv[3] || 'assets/data/on-this-day-poster-registry.json';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const eventKey = entry => `${clean(entry?.date)}::${norm(entry?.title)}`;

function tapologyEventUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' && /(^|\.)tapology\.com$/i.test(url.hostname) && /\/fightcenter\/events\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function isPublishedEvent(entry) {
  return entry?.kind === 'event' ||
    entry?.generatedBy === 'wikipedia-event-index' ||
    clean(entry?.imageArtifactType) === 'event-poster' ||
    (clean(entry?.imageSubjectType) === 'event' && tapologyEventUrl(entry?.tapologyUrl || entry?.imageSourceUrl || entry?.sourceUrl));
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(history) ? history : history.entries;
if (!Array.isArray(entries)) throw new Error(`${HISTORY_PATH} does not contain an entries array.`);

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8').catch(() => '{"version":1,"records":{}}'));
registry.records = registry.records && typeof registry.records === 'object' && !Array.isArray(registry.records)
  ? registry.records
  : {};

// Keep the pruning identity deliberately identical to check-on-this-day-poster-registry.mjs.
// A historical moment may share a date/title with an old registry record without being a
// publishable event row; those records must not survive merely because the text still exists.
const publishedKeys = new Set(entries.filter(isPublishedEvent).map(eventKey));
let removed = 0;
for (const key of Object.keys(registry.records)) {
  if (publishedKeys.has(key)) continue;
  delete registry.records[key];
  removed += 1;
}

if (removed) {
  registry.updatedAt = new Date().toISOString();
  await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
}

console.log(`On This Day poster registry prune: ${removed} stale record(s) removed; ${Object.keys(registry.records).length} active event record(s) retained.`);
