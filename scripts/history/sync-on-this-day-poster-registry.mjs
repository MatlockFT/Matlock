import fs from 'node:fs/promises';

const CLI_ARGS = process.argv.slice(2);
const MODE = CLI_ARGS.includes('--capture') ? 'capture' : 'restore';
const POSITIONAL_ARGS = CLI_ARGS.filter(value => !value.startsWith('--'));
const HISTORY_PATH = POSITIONAL_ARGS[0] || 'assets/data/on-this-day.json';
const REGISTRY_PATH = POSITIONAL_ARGS[1] || process.env.OTD_POSTER_REGISTRY_PATH || 'assets/data/on-this-day-poster-registry.json';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const eventKey = entry => `${clean(entry?.date)}::${norm(entry?.title)}`;
const https = value => /^https:\/\//i.test(clean(value));

const trustedPosterTypes = new Set([
  'tapology-event-poster',
  'wikipedia-event-poster',
  'official-promotion-event-poster',
  'archived-promotion-event-poster',
  'verified-manual-event-poster'
]);

function isEvent(entry) {
  return entry?.kind === 'event' ||
    entry?.generatedBy === 'wikipedia-event-index' ||
    clean(entry?.imageArtifactType) === 'event-poster';
}

function inferRecordSourceType(record) {
  const explicit = clean(record?.sourceType);
  if (trustedPosterTypes.has(explicit)) return explicit;
  if (/tapology\.com\/poster_images\//i.test(clean(record?.originPosterUrl)) ||
      /tapology\.com\/fightcenter\/events\//i.test(clean(record?.eventUrl))) {
    return 'tapology-event-poster';
  }
  return '';
}

function defaultCredit(type) {
  if (type === 'tapology-event-poster') return 'Tapology';
  if (type === 'wikipedia-event-poster') return 'Wikipedia / Wikimedia Commons';
  return 'Source';
}

function validPosterRecord(record) {
  const type = inferRecordSourceType(record);
  if (record?.status !== 'verified' || !trustedPosterTypes.has(type) || !https(record?.posterUrl)) return false;
  if (type === 'verified-manual-event-poster' && record?.manualVisualVerified !== true) return false;
  return Number(record?.confidence ?? (type === 'tapology-event-poster' ? 1 : 0.95)) >= 0.9;
}

function applyRecord(entry, record) {
  const type = inferRecordSourceType(record);
  if (!validPosterRecord(record)) return false;

  entry.imageUrl = clean(record.posterUrl);
  entry.imageAlt = clean(record.alt) || `${clean(entry.title)} event poster`;
  entry.imageCredit = clean(record.credit) || defaultCredit(type);
  entry.imageSourceUrl = clean(record.sourceUrl || record.eventUrl || record.posterUrl);
  entry.imageSourceType = type;
  entry.imageConfidence = Number(record.confidence ?? (type === 'tapology-event-poster' ? 1 : 0.95));
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = true;
  entry.imageExactMatch = true;
  entry.imageStatus = 'resolved';
  entry.imageResolvedAt = clean(record.verifiedAt || record.checkedAt) || new Date().toISOString();
  delete entry.imageUnresolved;
  delete entry.imagePosterUnavailableVerified;

  if (type === 'verified-manual-event-poster') entry.imageManualVisualVerified = true;
  else delete entry.imageManualVisualVerified;

  if (type === 'tapology-event-poster') {
    entry.tapologyUrl = clean(record.eventUrl || entry.tapologyUrl);
    entry.imageTapologyBinding = 'direct-event-page';
    entry.imageTapologyPageUrl = clean(record.eventUrl || record.sourceUrl);
    entry.imageTapologyRegistryKey = clean(record.key || eventKey(entry));
    entry.imageTapologyVerificationVersion = 1;
    if (clean(record.sha256)) entry.imagePosterSha256 = clean(record.sha256);
    if (Number(record.width)) entry.imageWidth = Number(record.width);
    if (Number(record.height)) entry.imageHeight = Number(record.height);
  } else {
    delete entry.imageTapologyBinding;
    delete entry.imageTapologyPageUrl;
    delete entry.imageTapologyRegistryKey;
    delete entry.imagePosterSha256;
  }

  return true;
}

function compactTapologyEvidence(record) {
  if (!record || !clean(record.eventUrl)) return undefined;
  return {
    status: clean(record.status),
    eventTitle: clean(record.eventTitle),
    eventDate: clean(record.eventDate),
    dateMatch: clean(record.dateMatch),
    eventUrl: clean(record.eventUrl),
    titleScore: Number(record.titleScore || 0),
    checkedAt: clean(record.checkedAt || record.verifiedAt),
    reason: clean(record.reason)
  };
}

function captureRecord(entry, existing) {
  const type = clean(entry?.imageSourceType);
  if (!trustedPosterTypes.has(type) ||
      entry?.imagePosterVerified !== true ||
      clean(entry?.imageArtifactType) !== 'event-poster' ||
      !https(entry?.imageUrl) ||
      Number(entry?.imageConfidence || 0) < 0.9) {
    return existing;
  }

  if (type === 'tapology-event-poster') {
    return {
      ...(existing || {}),
      key: eventKey(entry),
      status: 'verified',
      sourceType: type,
      date: clean(entry.date),
      title: clean(entry.title),
      sourceUrl: clean(entry.imageSourceUrl || entry.imageTapologyPageUrl || existing?.eventUrl),
      posterUrl: clean(entry.imageUrl),
      credit: clean(entry.imageCredit) || 'Tapology',
      confidence: 1,
      alt: clean(entry.imageAlt),
      verifiedAt: clean(entry.imageResolvedAt || existing?.verifiedAt) || new Date().toISOString()
    };
  }

  const evidence = existing?.tapologyEvidence || compactTapologyEvidence(
    inferRecordSourceType(existing) === 'tapology-event-poster' || existing?.status === 'verified-unavailable'
      ? existing
      : null
  );

  const record = {
    key: eventKey(entry),
    status: 'verified',
    sourceType: type,
    date: clean(entry.date),
    title: clean(entry.title),
    sourceUrl: clean(entry.imageSourceUrl),
    posterUrl: clean(entry.imageUrl),
    credit: clean(entry.imageCredit) || defaultCredit(type),
    confidence: Number(entry.imageConfidence || 0.95),
    alt: clean(entry.imageAlt),
    verifiedAt: clean(entry.imageResolvedAt) || new Date().toISOString()
  };
  if (type === 'verified-manual-event-poster') record.manualVisualVerified = entry?.imageManualVisualVerified === true;
  if (Number(entry?.imageWidth)) record.width = Number(entry.imageWidth);
  if (Number(entry?.imageHeight)) record.height = Number(entry.imageHeight);
  if (evidence) record.tapologyEvidence = evidence;
  return record;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(history?.entries) ? history.entries : [];
const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8').catch(() => '{"version":2,"records":{}}'));
registry.version = Math.max(2, Number(registry.version || 1));
registry.records = registry.records && typeof registry.records === 'object' && !Array.isArray(registry.records)
  ? registry.records
  : {};
registry.policy = 'One event-poster registry. Restore verified assignments first; new unresolved events resolve in source priority order: Tapology, Wikipedia/Wikimedia, official/archive/manual fallback.';

let restored = 0;
let captured = 0;

if (MODE === 'restore') {
  for (const entry of entries.filter(isEvent)) {
    const record = registry.records[eventKey(entry)];
    if (applyRecord(entry, record)) {
      restored += 1;
      continue;
    }
    if (record?.status === 'verified-unavailable' && clean(record?.eventUrl)) {
      entry.tapologyUrl = clean(record.eventUrl);
    }
  }
  history.posterRegistryVersion = 2;
  history.posterRegistryPolicy = registry.policy;
  await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  if (Number(registry.version || 0) < 2) registry.version = 2;
  await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  console.log(`Event-poster registry restore: ${restored} verified poster assignment(s) restored.`);
} else {
  for (const entry of entries.filter(isEvent)) {
    const key = eventKey(entry);
    const before = JSON.stringify(registry.records[key] || null);
    const next = captureRecord(entry, registry.records[key]);
    if (next) registry.records[key] = next;
    if (JSON.stringify(registry.records[key] || null) !== before) captured += 1;
  }
  registry.updatedAt = new Date().toISOString();
  history.posterRegistryVersion = 2;
  history.posterRegistryPolicy = registry.policy;
  await Promise.all([
    fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8'),
    fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  ]);
  console.log(`Event-poster registry capture: ${captured} record(s) updated; ${Object.keys(registry.records).length} total record(s).`);
}
