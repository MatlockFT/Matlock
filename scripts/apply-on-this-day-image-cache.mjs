import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const CACHE_PATH = process.argv[3] || 'assets/data/on-this-day-image-cache.json';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const https = value => /^https:\/\//i.test(clean(value));

function verifiedPosterCacheRecord(record) {
  if (!record || !https(record.imageUrl) || clean(record.artworkType) !== 'poster') return false;
  const type = clean(record.sourceType);
  const status = clean(record.status);

  if (type === 'wikimedia-commons-search') return false;
  if (['wikipedia-page-artwork', 'wikipedia-event-image'].includes(type)) {
    return ['poster-candidate', 'wikipedia-event-image'].includes(status);
  }
  if (type === 'tapology-event-poster') return true;
  if (['official-promotion-event-image', 'official-promotion-event-poster'].includes(type)) return true;
  return false;
}

function normalizedPosterSourceType(record) {
  const type = clean(record?.sourceType);
  if (type === 'tapology-event-poster') return 'tapology-event-poster';
  if (['official-promotion-event-image', 'official-promotion-event-poster'].includes(type)) return 'official-promotion-event-poster';
  if (['wikipedia-page-artwork', 'wikipedia-event-image'].includes(type)) return 'wikipedia-event-poster';
  return 'verified-manual-event-poster';
}

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

  const exactPoster = entry?.kind === 'event' && verifiedPosterCacheRecord(record);

  if (exactPoster) {
    entry.imageUrl = record.imageUrl;
    entry.imageAlt = clean(record.imageAlt) || `${clean(entry.title)} event poster`;
    entry.imageCredit = clean(record.imageCredit) || clean(entry.imageCredit) || 'Source';
    entry.imageSourceUrl = clean(record.imageSourceUrl) || clean(entry.sourceUrl) || record.imageUrl;
    entry.imageSourceType = normalizedPosterSourceType(record);
    entry.imageConfidence = Math.max(0.95, Number(record.imageConfidence || 0));
    entry.imageSubjectType = 'event';
    entry.imageArtifactType = 'event-poster';
    entry.imagePosterVerified = true;
    entry.imageMatchReason = 'Verified exact event poster already exists in the image cache; preferred over non-poster fallbacks.';
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

history.imageCacheApplicationVersion = 2;
history.imageCacheAppliedAt = new Date().toISOString();
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

console.log(`On This Day cache bridge: ${exactPosters} verified event poster(s) protected; ${metadataBackfilled} existing image record(s) received source metadata. Broad Commons search matches are never promoted to verified posters.`);
