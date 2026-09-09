import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function isEvent(entry) {
  return entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
}

function tapologyEventUrl(value) {
  try {
    const url = new URL(clean(value));
    return /(^|\.)tapology\.com$/i.test(url.hostname) && /\/fightcenter\/events\//i.test(url.pathname);
  } catch { return false; }
}

function tapologyPosterUrl(value) {
  try {
    const url = new URL(clean(value));
    return /(^|\.)images\.tapology\.com$/i.test(url.hostname) && /\/poster_images\//i.test(url.pathname);
  } catch { return false; }
}

function eventIdentity(value) {
  const text = norm(value);
  const match = text.match(/\b(ufc|wec|bellator|pride|pancrase|rizin|pfl|one)\s*(?:fight\s*night\s*)?(\d{1,4})\b/);
  return match ? { promotion: match[1], number: match[2] } : null;
}

function posterIdentity(imageUrl) {
  try {
    const url = new URL(imageUrl);
    const filename = decodeURIComponent(url.pathname.split('/').pop() || '');
    return eventIdentity(filename);
  } catch { return null; }
}

function tapologyEventId(pageUrl) {
  try {
    const url = new URL(pageUrl);
    const slug = url.pathname.split('/').filter(Boolean).pop() || '';
    const match = slug.match(/^(\d+)(?:-|$)/);
    return match?.[1] || '';
  } catch { return ''; }
}

function tapologyPosterId(imageUrl) {
  try {
    const url = new URL(imageUrl);
    const match = url.pathname.match(/\/poster_images\/(\d+)\//i);
    return match?.[1] || '';
  } catch { return ''; }
}

function clearPoster(entry, reason) {
  delete entry.imageUrl;
  delete entry.imageAlt;
  delete entry.imageCredit;
  delete entry.imageResolvedAt;
  entry.imageSourceUrl = tapologyEventUrl(entry.tapologyUrl) ? entry.tapologyUrl : '';
  entry.imageSourceType = 'tapology-poster-rejected';
  entry.imageConfidence = 0;
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = false;
  entry.imageExactMatch = false;
  entry.imageStatus = 'unresolved';
  entry.imageUnresolved = true;
  entry.imageMatchReason = reason;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(history?.entries) ? history.entries : [];
let rejected = 0;
let checked = 0;

for (const entry of entries) {
  if (!isEvent(entry) || !tapologyPosterUrl(entry?.imageUrl)) continue;
  checked += 1;

  const exactPage = [entry?.tapologyUrl, entry?.imageSourceUrl, entry?.sourceUrl].find(tapologyEventUrl) || '';
  if (!exactPage) {
    clearPoster(entry, 'Rejected a Tapology poster candidate that was not bound to an exact Tapology event page.');
    rejected += 1;
    continue;
  }

  const expected = eventIdentity(entry?.title);
  const actual = posterIdentity(entry?.imageUrl);
  if (expected && actual && expected.promotion === actual.promotion && expected.number !== actual.number) {
    clearPoster(entry, `Rejected a mismatched Tapology poster: ${entry.title} cannot use artwork whose filename identifies ${actual.promotion.toUpperCase()} ${actual.number}.`);
    rejected += 1;
    continue;
  }

  const pageId = tapologyEventId(exactPage);
  const posterId = tapologyPosterId(entry.imageUrl);
  if (pageId && posterId && pageId !== posterId) {
    clearPoster(entry, `Rejected a mismatched Tapology poster: event-page ID ${pageId} does not match poster-image ID ${posterId}.`);
    rejected += 1;
  }
}

history.tapologyPosterSanitizerVersion = 1;
history.tapologyPosterSanitizedAt = new Date().toISOString();
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
console.log(`Tapology poster sanitizer: ${checked} poster(s) checked; ${rejected} mismatched/unbound poster(s) rejected.`);
