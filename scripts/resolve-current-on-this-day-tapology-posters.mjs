import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OVERRIDES_PATH = process.argv[3] || 'assets/data/on-this-day-image-source-overrides.json';
const CACHE_PATH = process.argv[4] || 'assets/data/on-this-day-image-cache.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const WINDOW_DAYS = Math.max(0, Number(process.env.OTD_CURRENT_WINDOW_DAYS || 2));

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const isEvent = entry => entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index' || clean(entry?.imageSubjectType) === 'event';

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
  const direct = Math.abs(ordinal(String(entry?.date || '').slice(5)) - ordinal(localMMDD()));
  return Math.min(direct, 366 - direct);
}

function key(entry) {
  return clean(entry?.autoKey) || `${clean(entry?.date)}::${clean(entry?.title).toLowerCase()}`;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(history) ? history : history.entries;
if (!Array.isArray(entries)) throw new Error(`${HISTORY_PATH} does not contain an entries array.`);

const currentEvents = entries.filter(entry => isEvent(entry) && distance(entry) <= WINDOW_DAYS);
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'otd-tapology-current-'));
const tempHistoryPath = path.join(tempDir, 'on-this-day-current.json');
const scopedHistory = Array.isArray(history)
  ? currentEvents
  : { ...history, entries: currentEvents };

await fs.writeFile(tempHistoryPath, `${JSON.stringify(scopedHistory, null, 2)}\n`, 'utf8');

console.log(`Current-window Tapology scope: ${currentEvents.length} event(s) within ±${WINDOW_DAYS} day(s); archive events are excluded from this fast pass.`);

const result = spawnSync(process.execPath, [
  'scripts/resolve-on-this-day-tapology-posters.mjs',
  tempHistoryPath,
  OVERRIDES_PATH,
  CACHE_PATH
], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    OTD_TAPOLOGY_POSTER_LIMIT: String(Math.max(1, currentEvents.length))
  },
  stdio: 'inherit'
});

if (result.error) {
  await fs.rm(tempDir, { recursive: true, force: true });
  throw result.error;
}
if ((result.status ?? 1) !== 0) {
  await fs.rm(tempDir, { recursive: true, force: true });
  process.exitCode = result.status ?? 1;
} else {
  const resolvedHistory = JSON.parse(await fs.readFile(tempHistoryPath, 'utf8'));
  const resolvedEntries = Array.isArray(resolvedHistory) ? resolvedHistory : resolvedHistory.entries;
  const resolvedByKey = new Map((resolvedEntries || []).map(entry => [key(entry), entry]));
  const mergedEntries = entries.map(entry => resolvedByKey.get(key(entry)) || entry);
  const mergedHistory = Array.isArray(history) ? mergedEntries : { ...history, entries: mergedEntries };
  await fs.writeFile(HISTORY_PATH, `${JSON.stringify(mergedHistory, null, 2)}\n`, 'utf8');
  console.log(`Current-window Tapology merge complete: ${resolvedByKey.size} scoped event record(s) merged; no archive event was probed by the fast pass.`);
  await fs.rm(tempDir, { recursive: true, force: true });
}
