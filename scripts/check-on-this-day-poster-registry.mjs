import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const REGISTRY_PATH = process.argv[3] || process.env.OTD_POSTER_REGISTRY_PATH || 'assets/data/on-this-day-poster-registry.json';
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const eventKey = entry => `${clean(entry?.date)}::${norm(entry?.title)}`;
const failures = [];

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const events = (history.entries || []).filter(entry => entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index' || clean(entry?.imageArtifactType) === 'event-poster' || (clean(entry?.imageSubjectType) === 'event' && tapologyEventUrl(entry?.tapologyUrl || entry?.imageSourceUrl || entry?.sourceUrl)));
const historyByKey = new Map(events.map(entry => [eventKey(entry), entry]));
const records = registry?.records && typeof registry.records === 'object' && !Array.isArray(registry.records) ? registry.records : {};

function tapologyEventUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' && /(^|\.)tapology\.com$/i.test(url.hostname) && /\/fightcenter\/events\//i.test(url.pathname);
  } catch { return false; }
}

function tapologyPosterUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' && /(^|\.)images\.tapology\.com$/i.test(url.hostname) && /\/poster_images\//i.test(url.pathname);
  } catch { return false; }
}

function numericId(value, kind) {
  try {
    const pathname = new URL(value).pathname;
    return kind === 'event' ? /\/events\/(\d+)(?:-|\/|$)/i.exec(pathname)?.[1] || '' : /\/poster_images\/(\d+)\//i.exec(pathname)?.[1] || '';
  } catch { return ''; }
}

function sameIdentity(record, entry) {
  if (clean(record?.date) !== clean(entry?.date) || norm(record?.title) !== norm(entry?.title)) return false;
  const dateMatch = clean(record?.dateMatch) || (clean(record?.eventDate) === clean(entry?.date) ? 'exact' : '');
  if (dateMatch === 'exact') return clean(record?.eventDate) === clean(entry?.date);
  if (dateMatch !== 'timezone-adjacent' || Number(record?.titleScore) < 96) return false;
  const left = Date.parse(`${clean(record?.eventDate)}T00:00:00Z`);
  const right = Date.parse(`${clean(entry?.date)}T00:00:00Z`);
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) === 86400000;
}

for (const [key, record] of Object.entries(records)) {
  const entry = historyByKey.get(key);
  if (!entry) {
    failures.push(`${key}: registry record has no matching event in history`);
    continue;
  }
  if (clean(record?.key) !== key) failures.push(`${key}: record key is inconsistent`);
  if (!sameIdentity(record, entry)) failures.push(`${key}: record date/title identity does not match history`);
  if (!tapologyEventUrl(record?.eventUrl)) failures.push(`${key}: eventUrl is not an exact Tapology event page`);

  if (record?.status === 'verified') {
    if (!tapologyPosterUrl(record?.originPosterUrl)) failures.push(`${key}: originPosterUrl is not a Tapology poster asset`);
    if (!/^https:\/\/raw\.githubusercontent\.com\/MatlockFT\/Matlock\/otd-poster-cache\//i.test(clean(record?.posterUrl))) failures.push(`${key}: posterUrl is not in the immutable poster cache`);
    if (!/^[a-f0-9]{64}$/.test(clean(record?.sha256))) failures.push(`${key}: SHA-256 fingerprint is missing or malformed`);
    if (Number(record?.width) < 240 || Number(record?.height) < 240) failures.push(`${key}: poster dimensions are too small`);
    if (Number(record?.bytes) < 10000) failures.push(`${key}: poster byte count is too small`);
    if (Number(record?.titleScore) < 86) failures.push(`${key}: title match score is below the acceptance threshold`);
    const eventId = numericId(record?.eventUrl, 'event');
    const posterId = numericId(record?.originPosterUrl, 'poster');
    if (eventId && eventId !== posterId) failures.push(`${key}: Tapology event ID and poster asset ID do not match`);

    if (entry?.imageUrl !== record.posterUrl) failures.push(`${key}: history does not use the registry's cached poster URL`);
    if (clean(entry?.imagePosterSha256) !== clean(record.sha256)) failures.push(`${key}: history SHA-256 does not match the registry`);
    if (clean(entry?.imageTapologyRegistryKey) !== key) failures.push(`${key}: history is not bound to this registry record`);
    if (clean(entry?.imageTapologyPageUrl) !== clean(record.eventUrl)) failures.push(`${key}: history Tapology page differs from registry`);
    if (entry?.imagePosterVerified !== true || clean(entry?.imageArtifactType) !== 'event-poster' || clean(entry?.imageSourceType) !== 'tapology-event-poster') failures.push(`${key}: history poster verification metadata is incomplete`);
  } else if (record?.status === 'verified-unavailable') {
    const hasOtherTrustedPoster = entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster' && clean(entry?.imageSourceType) !== 'tapology-event-poster';
    if (!hasOtherTrustedPoster) {
      if (entry?.imagePosterUnavailableVerified !== true) failures.push(`${key}: verified no-poster state is not applied to history`);
      if (clean(entry?.imageSourceType) !== 'verified-no-poster' || clean(entry?.imageArtifactType) !== 'event-poster-unavailable') failures.push(`${key}: no-poster metadata is incomplete`);
      if (clean(entry?.imageUrl)) failures.push(`${key}: a substitute image is present despite the verified no-poster state`);
    }
  } else {
    failures.push(`${key}: unsupported registry status ${clean(record?.status) || '(missing)'}`);
  }
}

for (const entry of events) {
  if (clean(entry?.imageSourceType) !== 'tapology-event-poster') continue;
  const key = eventKey(entry);
  const record = records[key];
  if (record?.status !== 'verified') failures.push(`${key}: Tapology poster is published without a verified registry record`);
  else if (clean(entry?.imagePosterSha256) !== clean(record?.sha256) || clean(entry?.imageUrl) !== clean(record?.posterUrl)) failures.push(`${key}: published Tapology poster differs from its registry record`);
}

if (failures.length) {
  console.error(`On This Day poster-registry QA failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const values = Object.values(records);
const verified = values.filter(record => record?.status === 'verified').length;
const unavailable = values.filter(record => record?.status === 'verified-unavailable').length;
console.log(`On This Day poster-registry QA passed: ${verified} byte-verified posters and ${unavailable} exact events verified without a published poster.`);
