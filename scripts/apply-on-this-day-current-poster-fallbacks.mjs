import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const FALLBACKS_PATH = process.argv[3] || 'assets/data/on-this-day-current-poster-fallbacks.json';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const http = value => /^https:\/\//i.test(clean(value));

function usableImage(value) {
  const url = clean(value);
  if (!http(url) || /\.svg(?:\?|$)/i.test(url)) return false;
  return !/(?:favicon|sprite|placeholder|default[_-]?(?:image|avatar)|site[_-]?logo|ufc[_-]?logo|wikipedia-wordmark|wikimedia-button|flag[_-])/i.test(url);
}

function findEntry(entries, rule) {
  return entries.find(entry => clean(entry?.date) === clean(rule?.date) && norm(entry?.title) === norm(rule?.title));
}

function validTapologyBinding(entry) {
  return clean(entry?.imageSourceType) !== 'tapology-event-poster' || [
    'direct-event-page',
    'bing-image-exact-event-page',
    'manual-exact-event-page',
    'legacy-filename-exact'
  ].includes(clean(entry?.imageTapologyBinding));
}

function manualVerificationValid(entry) {
  return clean(entry?.imageSourceType) !== 'verified-manual-event-poster' || entry?.imageManualVisualVerified === true;
}

function alreadyVerified(entry) {
  return http(entry?.imageUrl) &&
    entry?.imagePosterVerified === true &&
    clean(entry?.imageArtifactType) === 'event-poster' &&
    clean(entry?.imageSubjectType) === 'event' &&
    Number(entry?.imageConfidence || 0) >= 0.9 &&
    validTapologyBinding(entry) &&
    manualVerificationValid(entry);
}

function validateRule(rule) {
  const type = clean(rule?.sourceType);
  if (!clean(rule?.date) || !clean(rule?.title)) return 'missing date/title';
  if (!http(rule?.sourceUrl)) return 'missing HTTPS source URL';
  if (!usableImage(rule?.imageUrl)) return 'missing deterministic direct imageUrl';
  if (!['official-promotion-event-poster','wikipedia-event-poster','archived-promotion-event-poster','verified-manual-event-poster'].includes(type)) {
    return `unsupported sourceType ${type || '(missing)'}`;
  }
  if (Number(rule?.confidence || 0) < 0.9) return 'confidence must be at least 0.9';
  if (type === 'verified-manual-event-poster' && rule?.manualVisualVerified !== true) {
    return 'manual poster requires manualVisualVerified=true';
  }
  if (type === 'wikipedia-event-poster') {
    try {
      const host = new URL(rule.imageUrl).hostname.toLowerCase();
      if (!host.endsWith('wikimedia.org')) return 'Wikipedia poster imageUrl must come from Wikimedia';
    } catch { return 'invalid Wikipedia poster imageUrl'; }
  }
  return '';
}

function clearInvalidManualPoster(entry) {
  delete entry.imageUrl;
  delete entry.imageAlt;
  delete entry.imageCredit;
  delete entry.imageResolvedAt;
  delete entry.imageManualVisualVerified;
  delete entry.imageTapologyBinding;
  delete entry.imageTapologyPageUrl;
  entry.imageSourceUrl = '';
  entry.imageSourceType = 'manual-poster-rejected';
  entry.imageConfidence = 0;
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = false;
  entry.imageExactMatch = false;
  entry.imageFallback = false;
  entry.imageStatus = 'unresolved';
  entry.imageUnresolved = true;
  entry.imageMatchReason = 'Removed a previously certified manual poster because no explicit visual-verification flag proves that the image is the actual event poster.';
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const config = JSON.parse(await fs.readFile(FALLBACKS_PATH, 'utf8'));
const entries = Array.isArray(history?.entries) ? history.entries : [];
const rules = Array.isArray(config?.entries) ? config.entries : [];
const nowIso = new Date().toISOString();

let applied = 0;
let retained = 0;
let purged = 0;
const failures = [];

for (const entry of entries) {
  if (clean(entry?.imageSourceType) === 'verified-manual-event-poster' && entry?.imageManualVisualVerified !== true) {
    clearInvalidManualPoster(entry);
    purged += 1;
  }
}

for (const rule of rules) {
  const label = `${clean(rule?.date)} ${clean(rule?.title)}`;
  const ruleError = validateRule(rule);
  if (ruleError) {
    failures.push(`${label}: ${ruleError}`);
    continue;
  }

  const entry = findEntry(entries, rule);
  if (!entry) {
    failures.push(`${label}: entry not found`);
    continue;
  }

  if (alreadyVerified(entry)) {
    retained += 1;
    continue;
  }

  const confidence = Math.max(0.9, Math.min(1, Number(rule?.confidence || 0.95)));
  entry.imageUrl = clean(rule.imageUrl);
  entry.imageAlt = `${clean(entry.title)} event poster`;
  entry.imageCredit = clean(rule?.credit) || 'Source';
  entry.imageSourceUrl = clean(rule.sourceUrl);
  entry.imageSourceType = clean(rule.sourceType);
  entry.imageConfidence = confidence;
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = true;
  entry.imageExactMatch = true;
  entry.imageFallback = true;
  entry.imageMatchReason = clean(rule?.matchReason) || 'Deterministic direct event-poster fallback applied after higher-priority Tapology poster discovery failed.';
  entry.imageResolvedAt = nowIso;
  entry.imageStatus = 'resolved';
  delete entry.imageUnresolved;
  delete entry.imageTapologyBinding;
  delete entry.imageTapologyPageUrl;

  if (rule?.sourceType === 'verified-manual-event-poster') entry.imageManualVisualVerified = true;
  else delete entry.imageManualVisualVerified;

  applied += 1;
}

history.currentPosterFallbackVersion = Number(config?.version || 1);
history.currentPosterFallbackUpdatedAt = nowIso;
history.currentPosterFallbackPolicy = 'direct-image-only';
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

console.log(`Current-window deterministic poster fallbacks: ${applied} applied, ${retained} already verified, ${purged} unverified manual poster(s) purged, ${failures.length} rejected/unresolved.`);
if (failures.length) console.warn(failures.map(item => `- ${item}`).join('\n'));
