import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const CACHE_PATH = process.argv[3] || 'assets/data/on-this-day-image-cache.json';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const https = value => /^https:\/\//i.test(clean(value));

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
const entries = Array.isArray(history?.entries) ? history.entries : [];
const records = cache?.entries && typeof cache.entries === 'object' && !Array.isArray(cache.entries)
  ? cache.entries
  : {};

let exactPosters = 0;
let metadataBackfilled = 0;

for (const entry of entries) {
  const key = clean(entry?.autoKey || entry?.birthdayKey);
  const record = key ? records[key] : null;
  if (!record || typeof record !== 'object') continue;

  const exactPoster = entry?.kind === 'event' &&
    https(record.imageUrl) &&
    record.artworkType === 'poster' &&
    ['poster-candidate', 'commons-event-image', 'wikipedia-event-image'].includes(clean(record.status));

  if (exactPoster) {
    entry.imageUrl = record.imageUrl;
    entry.imageAlt = clean(record.imageAlt) || `${clean(entry.title)} event poster`;
    entry.imageCredit = clean(record.imageCredit) || clean(entry.imageCredit) || 'Source';
    entry.imageSourceUrl = clean(record.imageSourceUrl) || clean(entry.sourceUrl) || record.imageUrl;
    entry.imageSourceType = clean(record.sourceType) || 'cached-event-poster';
    entry.imageConfidence = Math.max(0.95, Number(record.imageConfidence || 0));
    entry.imageSubjectType = 'event';
    entry.imageMatchReason = 'Exact event poster already exists in the verified image cache; preferred over all fighter fallbacks.';
    entry.imageStatus = 'resolved';
    entry.imageExactMatch = true;
    delete entry.imageUnresolved;
    exactPosters += 1;
    continue;
  }

  if (!https(entry?.imageUrl)) continue;

  if (!clean(entry.imageSourceUrl)) {
    entry.imageSourceUrl = clean(record.imageSourceUrl) || clean(entry.sourceUrl) || entry.imageUrl;
    metadataBackfilled += 1;
  }
  if (!clean(entry.imageSourceType)) entry.imageSourceType = clean(record.sourceType) || 'existing-image';
  if (!Number.isFinite(Number(entry.imageConfidence))) entry.imageConfidence = Number(record.imageConfidence || 0.7);
  if (!clean(entry.imageSubjectType)) {
    entry.imageSubjectType = entry.kind === 'event' ? 'event' : entry.kind === 'birthday' ? 'fighter' : 'moment';
  }
  if (!clean(entry.imageMatchReason)) entry.imageMatchReason = 'Existing resolved image retained with cached provenance metadata.';
  if (!clean(entry.imageCredit)) entry.imageCredit = clean(record.imageCredit) || clean(entry.source) || 'Source';
  entry.imageStatus = 'resolved';
}

history.imageCacheApplicationVersion = 1;
history.imageCacheAppliedAt = new Date().toISOString();
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

console.log(`On This Day cache bridge: ${exactPosters} exact event poster(s) protected; ${metadataBackfilled} existing image record(s) received source metadata.`);
