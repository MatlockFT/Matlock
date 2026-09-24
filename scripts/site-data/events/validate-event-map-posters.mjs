import fs from 'node:fs/promises';

const DATA_PATH = process.argv[2] || '_data/event_map_regional.json';
const BAD_POSTER_RE = /(?:tribe-loading|loading(?:[-_.]|$)|spinner|preloader|placeholder|blank(?:[-_.]|$)|transparent(?:[-_.]|$)|favicon|(?:^|[/_.-])logo(?:[/_.-]|$)|\.gif(?:[?#]|$))/i;
const failures = [];

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const events = Array.isArray(data.events) ? data.events : [];

for (const event of events) {
  const raw = String(event.poster_url || '').trim();
  if (!raw) continue;

  let validUrl = false;
  try {
    const url = new URL(raw);
    validUrl = /^https?:$/i.test(url.protocol);
  } catch {
    validUrl = false;
  }

  if (!validUrl) failures.push(`${event.id || event.title}: invalid poster URL ${raw}`);
  if (BAD_POSTER_RE.test(raw)) failures.push(`${event.id || event.title}: placeholder/loading poster ${raw}`);
}

if (failures.length) {
  console.error(`Event Map poster validation failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Event Map poster validation passed for ${events.length} events.`);
