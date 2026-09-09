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

function label(entry) { return `${entry?.date || 'unknown'} ${clean(entry?.title) || '(untitled)'}`; }
function exactEventImage(entry) {
  if (entry?.kind !== 'event') return false;
  if (!http(entry?.imageUrl)) return false;
  const type = clean(entry?.imageSourceType);
  const reason = clean(entry?.imageMatchReason).toLowerCase();
  const confidence = Number(entry?.imageConfidence || 0);
  return confidence >= 0.9 && (
    ['official-promotion-page','tapology-event-page','archived-promotion-page'].includes(type) ||
    reason.includes('exact') || /poster|event art/i.test(entry?.imageAlt || '')
  );
}

for (const entry of entries) {
  const current = distance(entry) <= WINDOW_DAYS;
  const birthday = entry?.kind === 'birthday';
  const hasImage = http(entry?.imageUrl);

  if (current && !hasImage) failures.push(`current-window entry has no image: ${label(entry)}`);
  if (birthday && !hasImage) failures.push(`birthday entry has no image: ${label(entry)}`);
  if (!current && !birthday && !hasImage) warnings.push(`archive entry still unresolved: ${label(entry)}`);

  if (hasImage) {
    for (const field of ['imageCredit','imageSourceUrl','imageSourceType','imageConfidence','imageSubjectType','imageMatchReason']) {
      if (entry?.[field] === undefined || entry?.[field] === null || clean(entry[field]) === '') failures.push(`${label(entry)} missing ${field}`);
    }
    if (entry.imageSourceUrl && !http(entry.imageSourceUrl)) failures.push(`${label(entry)} imageSourceUrl must be https`);
    const confidence = Number(entry.imageConfidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) failures.push(`${label(entry)} imageConfidence must be between 0 and 1`);
    if (!['event','fighter','moment'].includes(entry.imageSubjectType)) failures.push(`${label(entry)} imageSubjectType is invalid`);
  }

  if (entry?.kind === 'event' && entry?.imageSourceType === 'existing-image' && Number(entry?.imageConfidence || 0) >= 0.9) {
    warnings.push(`high-confidence event still uses generic existing-image provenance: ${label(entry)}`);
  }

  if (entry?.kind === 'event' && entry?.imageFallbackExactAvailable === true && !exactEventImage(entry)) {
    failures.push(`event uses a fallback even though an exact event image is cached: ${label(entry)}`);
  }
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
const birthdays = entries.filter(entry => entry?.kind === 'birthday');
console.log(`On This Day image QA passed: ${current.length}/${current.length} current-window entries and ${birthdays.length}/${birthdays.length} birthdays have images with provenance metadata.`);
