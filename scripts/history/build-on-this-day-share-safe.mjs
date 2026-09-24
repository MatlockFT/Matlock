import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const WINDOW_DAYS = Math.max(0, Number(process.env.OTD_SHARE_WINDOW_DAYS || 2));
const MAX_PER_DAY = Math.max(1, Number(process.env.OTD_SHARE_MAX_PER_DAY || 12));
const OUTPUT_DIR = process.env.OTD_SHARE_OUTPUT_DIR || '.cache/on-this-day/share';
const MANIFEST_PATH = process.env.OTD_SHARE_MANIFEST_PATH || 'assets/data/on-this-day-share-manifest.json';
const CURATED_SOURCES_PATH = process.env.OTD_SHARE_SOURCES_PATH || 'assets/data/on-this-day-share-sources.json';
const PUBLIC_BASE = process.env.OTD_SHARE_PUBLIC_BASE || 'https://raw.githubusercontent.com/MatlockFT/Matlock/otd-share-cache';
const TEXTURE_PATH = process.env.OTD_SHARE_TEXTURE_PATH || 'assets/textures/otd-xerox-paper-v1.webp';
const FINGERPRINT_VERSION = 1;
const REUSE_MARKER = path.join(OUTPUT_DIR, '.reuse-complete');
const FORMAT_NAMES = ['post', 'story', 'social'];
const RENDER_INPUT_FILES = [
  'scripts/history/build-on-this-day-share-safe.mjs',
  'scripts/history/build-on-this-day-share-images.mjs',
  'scripts/media/share-card-composition.mjs',
  'scripts/media/share-title-layout.mjs',
  'assets/share-gobold.mjs',
  TEXTURE_PATH,
  'assets/textures/otd-gaffer-tape-v1.png',
  'package-lock.json'
];

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const http = value => /^https:\/\//i.test(clean(value));
const monthDay = value => String(value || '').slice(5);
const slug = value => clean(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 90) || 'entry';
const entryAnchor = entry => `otd-${String(entry?.date || '').replace(/-/g, '')}-${slug(entry?.title)}`;

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

function targetMonthDays(radius) {
  const now = new Date();
  const center = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days = [];
  for (let offset = -radius; offset <= radius; offset += 1) {
    const date = new Date(center);
    date.setUTCDate(date.getUTCDate() + offset);
    days.push(`${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`);
  }
  return days;
}

function selectEntries(entries) {
  const targets = new Set(targetMonthDays(WINDOW_DAYS));
  const groups = new Map();
  for (const entry of entries) {
    if (!targets.has(monthDay(entry?.date)) || !clean(entry?.title)) continue;
    const key = monthDay(entry.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  const picked = [];
  for (const key of targets) {
    const group = groups.get(key) || [];
    group.sort((a, b) =>
      Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) ||
      Number(b.weight || 0) - Number(a.weight || 0) ||
      String(b.date || '').localeCompare(String(a.date || '')) ||
      String(a.title || '').localeCompare(String(b.title || ''))
    );
    picked.push(...group.slice(0, MAX_PER_DAY));
  }
  return picked;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (key === 'generatedAt' || key === 'updatedAt' || /(?:Resolved|Checked|Fetched|Verified|Updated)At$/.test(key)) continue;
    output[key] = canonicalize(value[key]);
  }
  return output;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function digestFile(filePath) {
  return sha256(await fs.readFile(filePath));
}

async function readJsonMaybe(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function utcDayKey() {
  return new Date().toISOString().slice(0, 10);
}

function reusableManifest(manifest, fingerprint, selectedEntries) {
  if (!manifest || manifest.inputFingerprintVersion !== FINGERPRINT_VERSION || manifest.inputFingerprint !== fingerprint) return false;
  const expectedIds = [...new Set(selectedEntries.map(entryAnchor))].sort();
  const records = manifest.entries && typeof manifest.entries === 'object' ? manifest.entries : {};
  const actualIds = Object.keys(records).sort();
  if (expectedIds.length !== selectedEntries.length || actualIds.length !== expectedIds.length) return false;
  for (let index = 0; index < expectedIds.length; index += 1) {
    if (expectedIds[index] !== actualIds[index]) return false;
    const formats = records[expectedIds[index]]?.formats || {};
    if (!FORMAT_NAMES.every(name => /^https:\/\//i.test(clean(formats[name])))) return false;
  }
  return true;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(history) ? history : history.entries;
if (!Array.isArray(entries)) throw new Error(`${HISTORY_PATH} does not contain an entries array.`);

const safeEntries = entries.map(stripUnsafeCurrentPoster);
const safeHistory = Array.isArray(history) ? safeEntries : { ...history, entries: safeEntries };
const selectedEntries = selectEntries(safeEntries);
const curatedSources = await readJsonMaybe(CURATED_SOURCES_PATH, {});
const renderInputDigests = {};
for (const filePath of [...new Set(RENDER_INPUT_FILES)]) renderInputDigests[filePath] = await digestFile(filePath);

const fingerprintPayload = canonicalize({
  version: FINGERPRINT_VERSION,
  day: utcDayKey(),
  windowDays: WINDOW_DAYS,
  maxPerDay: MAX_PER_DAY,
  publicBase: PUBLIC_BASE,
  selectedEntries,
  curatedSources,
  renderInputDigests
});
const inputFingerprint = sha256(JSON.stringify(fingerprintPayload));
const previousManifest = await readJsonMaybe(MANIFEST_PATH, null);

const blocked = entries.filter(entry => isEvent(entry) && distance(entry) <= WINDOW_DAYS && !verifiedEventPoster(entry)).length;
console.log(`OTD share safety gate: ${blocked} current-window event image(s) withheld because the actual poster is not verified.`);

if (reusableManifest(previousManifest, inputFingerprint, selectedEntries)) {
  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(REUSE_MARKER, `${inputFingerprint}\n`, 'utf8');
  console.log(`OTD share cache reuse: ${selectedEntries.length} entries / ${selectedEntries.length * FORMAT_NAMES.length} images unchanged; renderer skipped.`);
} else {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'otd-share-safe-'));
  const tempHistory = path.join(tempDir, 'on-this-day.json');
  try {
    await fs.writeFile(tempHistory, `${JSON.stringify(safeHistory, null, 2)}\n`, 'utf8');
    const result = spawnSync(process.execPath, ['scripts/history/build-on-this-day-share-images.mjs', tempHistory], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit'
    });
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0) {
      process.exitCode = result.status ?? 1;
    } else {
      const manifest = await readJsonMaybe(MANIFEST_PATH, null);
      if (!manifest || !manifest.entries) throw new Error('Share renderer completed without a valid manifest.');
      manifest.inputFingerprintVersion = FINGERPRINT_VERSION;
      manifest.inputFingerprint = inputFingerprint;
      manifest.inputFingerprintDay = utcDayKey();
      await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      console.log(`OTD share fingerprint seeded: ${inputFingerprint.slice(0, 12)} for ${selectedEntries.length} entries.`);
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}
