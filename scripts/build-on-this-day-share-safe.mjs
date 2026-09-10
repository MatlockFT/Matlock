import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const WINDOW_DAYS = Math.max(0, Number(process.env.OTD_SHARE_WINDOW_DAYS || 2));
const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const http = value => /^https:\/\//i.test(clean(value));

const trustedPosterTypes = new Set([
  'tapology-event-poster',
  'official-promotion-event-poster',
  'wikipedia-event-poster',
  'archived-promotion-event-poster',
  'verified-manual-event-poster'
]);
const trustedTapologyBindings = new Set([
  'direct-event-page',
  'bing-image-exact-event-page',
  'manual-exact-event-page',
  'legacy-filename-exact'
]);

function isEvent(entry) {
  return entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
}

function verifiedEventPoster(entry) {
  if (!isEvent(entry) || !http(entry?.imageUrl)) return false;
  if (entry?.imagePosterVerified !== true || clean(entry?.imageArtifactType) !== 'event-poster') return false;
  if (clean(entry?.imageSubjectType) !== 'event' || Number(entry?.imageConfidence || 0) < 0.9) return false;
  const type = clean(entry?.imageSourceType);
  if (!trustedPosterTypes.has(type)) return false;
  if (type === 'tapology-event-poster') {
    return trustedTapologyBindings.has(clean(entry?.imageTapologyBinding)) &&
      /^https:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\//i.test(clean(entry?.imageTapologyPageUrl));
  }
  if (type === 'verified-manual-event-poster') return entry?.imageManualVisualVerified === true;
  return true;
}

function ordinal(mmdd) {
  const match = /^(\d{2})-(\d{2})$/.exec(mmdd);
  if (!match) return 999;
  const date = new Date(Date.UTC(2024, Number(match[1]) - 1, Number(match[2])));
  return Math.round((date - Date.UTC(2024, 0, 1)) / 86400000);
}

function localMMDD() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('month')}-${get('day')}`;
}

function distance(entry) {
  const a = ordinal(String(entry?.date || '').slice(5));
  const b = ordinal(localMMDD());
  const direct = Math.abs(a - b);
  return Math.min(direct, 366 - direct);
}

function stripUnsafeCurrentPoster(entry) {
  if (!isEvent(entry) || distance(entry) > WINDOW_DAYS || verifiedEventPoster(entry)) return entry;
  const safe = { ...entry };
  delete safe.imageUrl;
  delete safe.imageAlt;
  delete safe.imageCredit;
  delete safe.imagePosition;
  safe.imagePosterVerified = false;
  safe.imageArtifactType = 'event-poster';
  safe.imageStatus = 'unresolved';
  safe.imageFallback = false;
  safe.sharePosterBlocked = true;
  return safe;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(history) ? history : history.entries;
if (!Array.isArray(entries)) throw new Error(`${HISTORY_PATH} does not contain an entries array.`);

const safeHistory = Array.isArray(history)
  ? entries.map(stripUnsafeCurrentPoster)
  : { ...history, entries: entries.map(stripUnsafeCurrentPoster) };

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'otd-share-safe-'));
const tempHistory = path.join(tempDir, 'on-this-day.json');
await fs.writeFile(tempHistory, `${JSON.stringify(safeHistory, null, 2)}\n`, 'utf8');

const blocked = entries.filter(entry => isEvent(entry) && distance(entry) <= WINDOW_DAYS && !verifiedEventPoster(entry)).length;
console.log(`OTD share safety gate: ${blocked} current-window event image(s) withheld because the actual poster is not verified.`);

const result = spawnSync(process.execPath, ['scripts/build-on-this-day-share-images.mjs', tempHistory], {
  cwd: process.cwd(),
  env: process.env,
  stdio: 'inherit'
});

await fs.rm(tempDir, { recursive: true, force: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
