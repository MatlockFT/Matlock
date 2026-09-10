import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const CACHE_PATH = process.argv[3] || 'assets/data/on-this-day-image-cache.json';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const https = value => /^https:\/\//i.test(clean(value));

function tapologyEventUrl(value) {
  if (!https(value)) return false;
  try {
    const url = new URL(value);
    return /(^|\.)tapology\.com$/i.test(url.hostname) && /\/fightcenter\/events\//i.test(url.pathname);
  } catch { return false; }
}

function tapologyPosterUrl(value) {
  if (!https(value)) return false;
  try {
    const url = new URL(value);
    return /(^|\.)images\.tapology\.com$/i.test(url.hostname) && /\/poster_images\//i.test(url.pathname);
  } catch { return false; }
}

function trustedTapologyRecord(record) {
  return Boolean(
    record &&
    clean(record.sourceType) === 'tapology-event-poster' &&
    clean(record.artworkType) === 'poster' &&
    tapologyPosterUrl(record.imageUrl) &&
    tapologyEventUrl(record.tapologyPageUrl) &&
    ['direct-event-page', 'manual-exact-event-page', 'legacy-filename-exact'].includes(clean(record.tapologyBinding))
  );
}

function verifiedPosterCacheRecord(record) {
  if (!record || !https(record.imageUrl) || clean(record.artworkType) !== 'poster') return false;
  const type = clean(record.sourceType);
  const status = clean(record.status);

  if (type === 'tapology-event-poster') return trustedTapologyRecord(record);
  if (type === 'wikimedia-commons-search') return false;
  if (['wikipedia-page-artwork', 'wikipedia-event-image'].includes(type)) {
    return ['poster-candidate', 'wikipedia-event-image', 'event-key-image'].includes(status);
  }
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

function restoreTapologyPoster(entry, record) {
  if (!trustedTapologyRecord(record)) return false;

  entry.tapologyUrl = record.tapologyPageUrl;
  entry.source = 'Tapology';
  entry.sourceUrl = record.tapologyPageUrl;
  entry.imageUrl = record.imageUrl;
  entry.imageAlt = clean(record.imageAlt) || `${clean(entry.title).replace(/\s+took place$/i, '')} event poster`;
  entry.imageCredit = 'Tapology';
  entry.imageSourceUrl = record.tapologyPageUrl;
  entry.imageSourceType = 'tapology-event-poster';
  entry.imageConfidence = Math.max(0.99, Number(record.imageConfidence || 0));
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = true;
  entry.imageTapologyBinding = clean(record.tapologyBinding) || 'direct-event-page';
  entry.imageTapologyPageUrl = record.tapologyPageUrl;
  entry.imageTapologyDiscovery = clean(record.tapologyDiscovery) || 'cache';
  entry.imageMatchReason = clean(record.imageMatchReason) || 'Restored an exact Tapology poster previously bound to this exact event page.';
  entry.imageResolvedAt = clean(record.checkedAt) || clean(entry.imageResolvedAt) || new Date().toISOString();
  entry.imageStatus = 'resolved';
  entry.imageExactMatch = true;
  entry.imageFallback = false;
  delete entry.imageUnresolved;
  return true;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8'));
const entries = Array.isArray(history?.entries) ? history.entries : [];
const records = cache?.entries && typeof cache.entries === 'object' && !Array.isArray(cache.entries)
  ? cache.entries
  : {};

let tapologyRestored = 0;
let tapologyPagesRestored = 0;
let exactPosters = 0;
let metadataBackfilled = 0;

for (const entry of entries) {
  const key = clean(entry?.autoKey || entry?.birthdayKey);
  const record = key ? records[key] : null;
  if (!record || typeof record !== 'object') continue;

  if (entry?.kind === 'event' && restoreTapologyPoster(entry, record)) {
    tapologyRestored += 1;
    continue;
  }

  if (entry?.kind === 'event' && !tapologyEventUrl(entry?.tapologyUrl) && tapologyEventUrl(record?.tapologyPageUrl)) {
    entry.tapologyUrl = record.tapologyPageUrl;
    tapologyPagesRestored += 1;
  }

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
    entry.imageMatchReason = clean(record.imageMatchReason) || 'Verified exact event poster already exists in the image cache; preferred over non-poster fallbacks.';
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

history.imageCacheApplicationVersion = 3;
history.imageCacheAppliedAt = new Date().toISOString();
history.tapologyExactPosterCacheRestored = tapologyRestored;

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

console.log(`On This Day cache bridge v3: ${tapologyRestored} exact Tapology poster(s) restored with page binding; ${tapologyPagesRestored} Tapology page URL(s) restored; ${exactPosters} other verified event poster(s) protected; ${metadataBackfilled} existing image record(s) received source metadata. Unbound Tapology image URLs are never promoted.`);
