import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

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

function normalizedEventPage(value) {
  try {
    const url = new URL(value);
    if (!tapologyEventUrl(url.href)) return '';
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return ''; }
}

function sameExactEventPage(a, b) {
  const left = normalizedEventPage(a);
  const right = normalizedEventPage(b);
  return Boolean(left && right && left === right);
}

function eventIdentity(value) {
  const text = norm(value);
  const match = text.match(/\b(ufc|wec|bellator|pride|pancrase|rizin|pfl|one)\s*(?:fight\s*night\s*)?(\d{1,4})\b/);
  return match ? { promotion: match[1], number: match[2] } : null;
}

function posterFilename(entry) {
  try { return decodeURIComponent(new URL(entry.imageUrl).pathname.split('/').pop() || ''); }
  catch { return ''; }
}

function posterIdentity(entry) {
  return eventIdentity(posterFilename(entry));
}

function distinctiveTokens(value) {
  const stop = new Set(['the','and','vs','event','poster','fc','championship','championships']);
  return norm(value).split(' ').filter(token => token.length >= 3 && !stop.has(token));
}

function legacyFilenameExact(entry) {
  const expected = eventIdentity(entry?.title);
  const actual = posterIdentity(entry);
  if (expected && actual) return expected.promotion === actual.promotion && expected.number === actual.number;
  if (expected && !actual) return false;

  const filename = norm(posterFilename(entry));
  const tokens = distinctiveTokens(entry?.title);
  if (!filename || tokens.length < 2) return false;
  const important = tokens.filter(token => !['pride','pancrase','bellator','rizin'].includes(token));
  const required = important.length >= 2 ? important : tokens;
  return required.every(token => filename.includes(token));
}

function clearPoster(entry, reason) {
  delete entry.imageUrl;
  delete entry.imageAlt;
  delete entry.imageCredit;
  delete entry.imageResolvedAt;
  delete entry.imageTapologyBinding;
  delete entry.imageTapologyPageUrl;
  entry.imageSourceUrl = tapologyEventUrl(entry.tapologyUrl) ? entry.tapologyUrl : tapologyEventUrl(entry.sourceUrl) ? entry.sourceUrl : '';
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
const trustedBindings = new Set(['direct-event-page','bing-image-exact-event-page','manual-exact-event-page','legacy-filename-exact']);
let rejected = 0;
let checked = 0;
let legacyPromoted = 0;

for (const entry of entries) {
  if (!isEvent(entry) || !tapologyPosterUrl(entry?.imageUrl)) continue;
  checked += 1;

  const exactPage = [entry?.imageTapologyPageUrl, entry?.tapologyUrl, entry?.imageSourceUrl, entry?.sourceUrl].find(tapologyEventUrl) || '';
  if (!exactPage) {
    clearPoster(entry, 'Rejected a Tapology poster because no exact Tapology event page is attached to it.');
    rejected += 1;
    continue;
  }

  const expected = eventIdentity(entry?.title);
  const actual = posterIdentity(entry);
  if (expected && actual && (expected.promotion !== actual.promotion || expected.number !== actual.number)) {
    clearPoster(entry, `Rejected a mismatched Tapology poster: ${entry.title} cannot use artwork whose filename identifies ${actual.promotion.toUpperCase()} ${actual.number}.`);
    rejected += 1;
    continue;
  }

  const binding = clean(entry?.imageTapologyBinding);
  if (trustedBindings.has(binding) && entry?.imageTapologyPageUrl && sameExactEventPage(entry.imageTapologyPageUrl, exactPage)) continue;

  if (legacyFilenameExact(entry)) {
    entry.imageTapologyBinding = 'legacy-filename-exact';
    entry.imageTapologyPageUrl = exactPage;
    entry.imageSourceUrl = exactPage;
    entry.imagePosterVerified = true;
    entry.imageArtifactType = 'event-poster';
    entry.imageSubjectType = 'event';
    entry.imageConfidence = Math.max(0.97, Number(entry.imageConfidence || 0));
    entry.imageMatchReason = 'Legacy Tapology poster retained because its filename explicitly identifies the exact event and an exact Tapology event page is attached.';
    legacyPromoted += 1;
    continue;
  }

  clearPoster(entry, 'Rejected a legacy Tapology poster because the image was never cryptographically/source-bound to the exact event page and its filename does not independently identify the event.');
  rejected += 1;
}

history.tapologyPosterSanitizerVersion = 3;
history.tapologyPosterSanitizedAt = new Date().toISOString();
history.tapologyPosterBindingPolicy = 'exact-event-page-only';
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
console.log(`Tapology poster sanitizer v3: ${checked} checked; ${legacyPromoted} legacy filename-exact posters retained; ${rejected} unbound/mismatched posters rejected.`);
