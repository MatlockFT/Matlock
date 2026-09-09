import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[3] || process.env.OTD_HISTORY_PATH || 'assets/data/on-this-day.json';
const SNAPSHOT_PATH = process.env.OTD_EVENT_FALLBACK_SNAPSHOT || '.otd-event-fallback-snapshot.json';
const MODE = String(process.argv[2] || '').toLowerCase();
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const http = value => /^https:\/\//i.test(clean(value));
const isEvent = entry => entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
const keyFor = entry => clean(entry?.autoKey) || `${clean(entry?.date)}::${norm(entry?.title)}`;
const verifiedPoster = entry => isEvent(entry) && http(entry?.imageUrl) && entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster';

const IMAGE_FIELDS = [
  'imageUrl', 'imageAlt', 'imageCredit', 'imagePosition', 'imageSourceUrl',
  'imageSourceType', 'imageConfidence', 'imageSubjectType', 'imageMatchReason',
  'imageStatus', 'imageArtifactType', 'imageFallback', 'imageExactMatch',
  'imageResolvedAt', 'imageFileTitle', 'imageWidth', 'imageHeight'
];

function snapshotImage(entry) {
  return Object.fromEntries(IMAGE_FIELDS
    .filter(field => entry?.[field] !== undefined && entry?.[field] !== null && entry?.[field] !== '')
    .map(field => [field, entry[field]]));
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(history?.entries) ? history.entries : [];

if (MODE === 'snapshot') {
  const fallbacks = {};
  for (const entry of entries) {
    if (!isEvent(entry) || !http(entry?.imageUrl) || verifiedPoster(entry)) continue;
    fallbacks[keyFor(entry)] = snapshotImage(entry);
  }
  await fs.writeFile(SNAPSHOT_PATH, `${JSON.stringify({ version: 1, createdAt: new Date().toISOString(), fallbacks }, null, 2)}\n`, 'utf8');
  console.log(`Snapshotted ${Object.keys(fallbacks).length} stored OTD event fallback image(s).`);
  process.exit(0);
}

if (MODE !== 'restore') {
  throw new Error('Usage: node scripts/preserve-on-this-day-event-fallbacks.mjs snapshot|restore [history-path]');
}

let snapshot = { fallbacks: {} };
try { snapshot = JSON.parse(await fs.readFile(SNAPSHOT_PATH, 'utf8')); }
catch { throw new Error(`Missing event fallback snapshot: ${SNAPSHOT_PATH}`); }

let restored = 0;
let skippedPoster = 0;
let skippedExisting = 0;
for (const entry of entries) {
  if (!isEvent(entry)) continue;
  const fallback = snapshot?.fallbacks?.[keyFor(entry)];
  if (!fallback || !http(fallback?.imageUrl)) continue;
  if (verifiedPoster(entry)) {
    skippedPoster += 1;
    continue;
  }
  if (http(entry?.imageUrl) && clean(entry?.imageSourceType) !== 'event-poster-required') {
    skippedExisting += 1;
    continue;
  }

  for (const field of IMAGE_FIELDS) delete entry[field];
  Object.assign(entry, fallback);
  entry.imageArtifactType = 'event-fallback';
  entry.imagePosterVerified = false;
  entry.imageFallback = true;
  entry.imageExactMatch = false;
  entry.imageStatus = 'resolved-fallback';
  entry.imagePosterStatus = 'unresolved';
  delete entry.imageUnresolved;
  restored += 1;
}

history.eventFallbackPreserverVersion = 1;
history.eventFallbackPreservedAt = new Date().toISOString();
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
console.log(`Restored ${restored} OTD event fallback image(s); ${skippedPoster} replaced by verified posters, ${skippedExisting} already had another resolved image.`);
