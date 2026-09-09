import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OVERRIDES_PATH = process.argv[3] || 'assets/data/on-this-day-image-source-overrides.json';
const nowIso = new Date().toISOString();
const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(history?.entries) ? history.entries : [];
let overrideData = { entries: [] };
try { overrideData = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8')); } catch {}
const overrides = Array.isArray(overrideData?.entries) ? overrideData.entries : [];
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const https = value => /^https:\/\//i.test(clean(value));

function isEvent(entry) {
  return entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
}

function tapologyEventUrl(value) {
  if (!https(value)) return false;
  try {
    const url = new URL(value);
    return /(^|\.)tapology\.com$/i.test(url.hostname) && /\/fightcenter\/events\//i.test(url.pathname);
  } catch { return false; }
}

function exactTapologyReference(entry) {
  for (const value of [entry?.tapologyUrl, entry?.imageSourceUrl, entry?.sourceUrl]) {
    if (tapologyEventUrl(value)) return clean(value);
  }
  const override = overrides.find(item =>
    clean(item?.date) === clean(entry?.date) &&
    norm(item?.title) === norm(entry?.title) &&
    tapologyEventUrl(item?.sourceUrl)
  );
  return clean(override?.sourceUrl);
}

function normalizePublicEventSource(entry) {
  if (!isEvent(entry)) return false;
  const previousSource = clean(entry?.source);
  const previousUrl = clean(entry?.sourceUrl);
  if (previousUrl && !tapologyEventUrl(previousUrl) && !clean(entry?.archiveSourceUrl)) {
    entry.archiveSource = previousSource || 'Archive source';
    entry.archiveSourceUrl = previousUrl;
  }

  const exact = exactTapologyReference(entry);
  const fallback = `https://www.tapology.com/search?term=${encodeURIComponent(clean(entry?.title || 'MMA event'))}`;
  const target = exact || fallback;
  let changed = false;
  if (entry.source !== 'Tapology') { entry.source = 'Tapology'; changed = true; }
  if (entry.sourceUrl !== target) { entry.sourceUrl = target; changed = true; }
  if (exact && entry.tapologyUrl !== exact) { entry.tapologyUrl = exact; changed = true; }
  return changed;
}

function subjectType(entry) {
  if (entry?.kind === 'event') return 'event';
  if (entry?.kind === 'birthday' || ['fight', 'debut', 'title', 'signing', 'death'].includes(entry?.kind)) return 'fighter';
  return 'moment';
}

function sourceType(entry) {
  const credit = clean(entry?.imageCredit).toLowerCase();
  const sourceUrl = clean(entry?.imageSourceUrl || entry?.sourceUrl);
  if (/tapology\.com/i.test(sourceUrl)) return entry?.kind === 'event' ? 'tapology-event-page' : 'tapology-source-page';
  if (/ufc\.com/i.test(sourceUrl)) return entry?.kind === 'birthday' ? 'official-athlete-or-fighter-page' : 'official-promotion-page';
  if (/wikipedia|wikimedia/i.test(`${credit} ${sourceUrl}`)) return 'wikipedia';
  return 'existing-image';
}

let normalized = 0;
let eventSourcesNormalized = 0;
for (const entry of entries) {
  if (normalizePublicEventSource(entry)) eventSourcesNormalized += 1;
  if (!https(entry?.imageUrl)) continue;
  let changed = false;

  if (!clean(entry.imageCredit)) {
    entry.imageCredit = clean(entry.source) || 'Source';
    changed = true;
  }
  if (!https(entry.imageSourceUrl)) {
    entry.imageSourceUrl = https(entry.sourceUrl) ? entry.sourceUrl : entry.imageUrl;
    changed = true;
  }
  if (!clean(entry.imageSourceType)) {
    entry.imageSourceType = sourceType(entry);
    changed = true;
  }
  const confidence = Number(entry.imageConfidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    entry.imageConfidence = entry.imageExactMatch === true ? 0.95 : 0.7;
    changed = true;
  }
  if (!['event', 'fighter', 'moment'].includes(clean(entry.imageSubjectType))) {
    entry.imageSubjectType = subjectType(entry);
    changed = true;
  }
  if (!clean(entry.imageMatchReason)) {
    entry.imageMatchReason = entry.imageExactMatch === true
      ? 'Exact verified image retained with normalized provenance metadata.'
      : 'Existing relevant image retained with normalized provenance metadata.';
    changed = true;
  }
  if (!clean(entry.imageStatus)) {
    entry.imageStatus = 'resolved';
    changed = true;
  }
  if (!clean(entry.imageResolvedAt)) {
    entry.imageResolvedAt = nowIso;
    changed = true;
  }
  if (entry.imageUnresolved) {
    delete entry.imageUnresolved;
    changed = true;
  }

  if (changed) normalized += 1;
}

history.imageMetadataVersion = 2;
history.imageMetadataFinalizedAt = nowIso;
history.publicEventReferencePolicy = 'tapology';
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
console.log(`On This Day image metadata finalizer: ${normalized} image record(s) normalized; ${eventSourcesNormalized} public event source link(s) switched to Tapology.`);
