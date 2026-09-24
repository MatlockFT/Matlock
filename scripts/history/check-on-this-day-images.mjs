import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const WINDOW_DAYS = Math.max(0, Number(process.env.OTD_CURRENT_WINDOW_DAYS || 2));
const data = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(data?.entries) ? data.entries : [];
const failures = [];
const warnings = [];

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const http = value => /^https:\/\//i.test(clean(value));

function ordinal(mmdd) {
  const match = /^(\d{2})-(\d{2})$/.exec(mmdd);
  if (!match) return 999;
  const date = new Date(Date.UTC(2024, Number(match[1]) - 1, Number(match[2])));
  return Math.round((date - Date.UTC(2024, 0, 1)) / 86400000);
}

function localMMDD() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('month')}-${get('day')}`;
}

function distance(entry) {
  const a = ordinal(String(entry?.date || '').slice(5));
  const b = ordinal(localMMDD());
  const direct = Math.abs(a - b);
  return Math.min(direct, 366 - direct);
}

function isEvent(entry) {
  return entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index' || clean(entry?.imageArtifactType) === 'event-poster' || (clean(entry?.imageSubjectType) === 'event' && /^https:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\//i.test(clean(entry?.tapologyUrl || entry?.imageSourceUrl || entry?.sourceUrl)));
}

function label(entry) {
  return `${entry?.date || 'unknown'} ${clean(entry?.title) || '(untitled)'}`;
}

const trustedPosterTypes = new Set([
  'tapology-event-poster',
  'official-promotion-event-poster',
  'wikipedia-event-poster',
  'archived-promotion-event-poster',
  'verified-manual-event-poster'
]);

function verifiedEventPoster(entry) {
  if (!isEvent(entry) || !http(entry?.imageUrl) || entry?.imagePosterVerified !== true) return false;
  if (clean(entry?.imageArtifactType) !== 'event-poster' || clean(entry?.imageSubjectType) !== 'event' || Number(entry?.imageConfidence || 0) < 0.9) return false;
  const type = clean(entry?.imageSourceType);
  if (!trustedPosterTypes.has(type)) return false;
  if (type === 'tapology-event-poster') {
    if (clean(entry?.imageTapologyBinding) !== 'direct-event-page') return false;
    if (!/^https:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\//i.test(clean(entry?.imageTapologyPageUrl))) return false;
    if (!/^https:\/\/raw\.githubusercontent\.com\/MatlockFT\/Matlock\/otd-poster-cache\//i.test(clean(entry?.imageUrl))) return false;
    if (!/^[a-f0-9]{64}$/.test(clean(entry?.imagePosterSha256))) return false;
    if (!clean(entry?.imageTapologyRegistryKey)) return false;
  }
  if (type === 'verified-manual-event-poster' && entry?.imageManualVisualVerified !== true) return false;
  return true;
}

function verifiedNoPoster(entry) {
  return isEvent(entry)
    && !clean(entry?.imageUrl)
    && entry?.imagePosterUnavailableVerified === true
    && clean(entry?.imageSourceType) === 'verified-no-poster'
    && clean(entry?.imageArtifactType) === 'event-poster-unavailable'
    && clean(entry?.imageSubjectType) === 'event'
    && Number(entry?.imageConfidence) === 1
    && /^https:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\//i.test(clean(entry?.tapologyUrl || entry?.imageSourceUrl));
}

const forbiddenEventImageTypes = new Set([
  'event-article','official-promotion-event-image','official-promotion-fighter-fallback','promotion-or-media-headshot','fighter-fallback','related-fighter-fallback','wikipedia-fighter-fallback','wikipedia-event-image','wikipedia-page-artwork','commons-event-image','wikimedia-commons-search','source-page','existing-image'
]);

for (const entry of entries) {
  const current = distance(entry) <= WINDOW_DAYS;
  const birthday = entry?.kind === 'birthday';
  const event = isEvent(entry);
  const hasImage = http(entry?.imageUrl);
  const hasPoster = verifiedEventPoster(entry);
  const noPoster = verifiedNoPoster(entry);

  if (current && event && !hasPoster && !noPoster) failures.push(`current-window event is neither backed by a verified poster nor an exact verified no-poster state: ${label(entry)}`);
  else if (current && !event && !hasImage) failures.push(`current-window entry has no image: ${label(entry)}`);
  if (birthday && !hasImage) failures.push(`birthday entry has no image: ${label(entry)}`);

  if (!current && event && !hasPoster && !noPoster) warnings.push(`archive event still needs exact poster verification: ${label(entry)}`);
  else if (!current && !birthday && !event && !hasImage) warnings.push(`archive entry still unresolved: ${label(entry)}`);

  if (hasImage) {
    for (const field of ['imageCredit','imageSourceUrl','imageSourceType','imageConfidence','imageSubjectType','imageMatchReason']) {
      if (entry?.[field] === undefined || entry?.[field] === null || clean(entry[field]) === '') failures.push(`${label(entry)} missing ${field}`);
    }
    if (entry.imageSourceUrl && !http(entry.imageSourceUrl)) failures.push(`${label(entry)} imageSourceUrl must be https`);
    const confidence = Number(entry.imageConfidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) failures.push(`${label(entry)} imageConfidence must be between 0 and 1`);
    if (!['event','fighter','moment'].includes(entry.imageSubjectType)) failures.push(`${label(entry)} imageSubjectType is invalid`);
  }

  if (event && hasImage && clean(entry?.imageSourceType) === 'tapology-event-poster' && !hasPoster) {
    const message = `Tapology event poster lacks its exact registry binding: ${label(entry)}`;
    if (current) failures.push(message); else warnings.push(message);
  }
  if (event && hasImage && clean(entry?.imageSourceType) === 'verified-manual-event-poster' && entry?.imageManualVisualVerified !== true) {
    const message = `manual event poster lacks visual-verification flag: ${label(entry)}`;
    if (current) failures.push(message); else warnings.push(message);
  }
  if (event && hasImage && forbiddenEventImageTypes.has(clean(entry?.imageSourceType))) {
    const message = `event is using a non-poster image source: ${label(entry)} (${clean(entry.imageSourceType)})`;
    if (current) failures.push(message); else warnings.push(message);
  }
  if (event && hasImage && clean(entry?.imageSubjectType) === 'fighter') {
    const message = `event is using a fighter image instead of the event poster: ${label(entry)}`;
    if (current) failures.push(message); else warnings.push(message);
  }
  if (event && entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) !== 'event-poster') failures.push(`event poster verification metadata is inconsistent: ${label(entry)}`);
  if (event && entry?.imageFallbackExactAvailable === true && !hasPoster) failures.push(`event uses a fallback even though an exact event poster is cached: ${label(entry)}`);
}

if (warnings.length) {
  console.warn(`On This Day image QA warnings (${warnings.length}):`);
  for (const warning of warnings.slice(0, 80)) console.warn(`- ${warning}`);
  if (warnings.length > 80) console.warn(`- ...and ${warnings.length - 80} more archive warnings`);
}
if (failures.length) {
  console.error(`On This Day image QA failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const current = entries.filter(entry => distance(entry) <= WINDOW_DAYS);
const currentEvents = current.filter(isEvent);
const currentPosters = currentEvents.filter(verifiedEventPoster);
const currentUnavailable = currentEvents.filter(verifiedNoPoster);
const birthdays = entries.filter(entry => entry?.kind === 'birthday');
const verifiedPosters = entries.filter(verifiedEventPoster);
console.log(`On This Day image QA passed: ${current.length} current-window entries, ${currentPosters.length} verified event posters, ${currentUnavailable.length} exact events verified without a poster, and ${birthdays.length} birthdays passed strict image checks.`);
console.log(`Verified event-poster coverage: ${verifiedPosters.length}/${entries.filter(isEvent).length}.`);
