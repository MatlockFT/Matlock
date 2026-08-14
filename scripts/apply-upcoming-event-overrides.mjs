import fs from 'node:fs/promises';
import {
  DATA_PATH,
  fighter,
  loadData,
  loadPortraitCache,
  norm,
  portraitFor,
  updatedLabel
} from './upcoming-events-data.mjs';

const OVERRIDES_PATH = '_data/upcoming_events_overrides.json';

async function loadOverrides() {
  try {
    const parsed = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8'));
    return Array.isArray(parsed.overrides) ? parsed.overrides : [];
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw new Error(`Could not read ${OVERRIDES_PATH}: ${error.message}`);
  }
}

function sameNames(actual = [], expected = []) {
  if (actual.length !== expected.length) return false;
  return actual.every((name, index) => norm(name) === norm(expected[index]));
}

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
}).format(new Date());

const data = await loadData();
const cache = await loadPortraitCache();
const overrides = await loadOverrides();
let applied = 0;

for (const override of overrides) {
  if (!override?.event_id || !Number.isInteger(override?.bout_order)) continue;
  if (override.expires_after && today > override.expires_after) continue;

  const event = (data.events || []).find(item => item.id === override.event_id);
  if (!event) continue;

  const bout = (event.sections || [])
    .flatMap(section => section.bouts || [])
    .find(item => item.order === override.bout_order);
  if (!bout) {
    console.warn(`Override skipped: ${override.event_id} bout ${override.bout_order} not found.`);
    continue;
  }

  const currentNames = (bout.fighters || []).map(item => item.name);
  const expected = Array.isArray(override.expected_fighters) ? override.expected_fighters : [];
  const targetNames = Array.isArray(override.fighters) ? override.fighters : [];

  if (expected.length && !sameNames(currentNames, expected) && !sameNames(currentNames, targetNames)) {
    console.warn(`Override skipped: ${override.event_id} bout ${override.bout_order} no longer matches expected fighters.`);
    continue;
  }
  if (targetNames.length !== 2) {
    console.warn(`Override skipped: ${override.event_id} bout ${override.bout_order} must provide exactly two fighters.`);
    continue;
  }

  const alreadyApplied = sameNames(currentNames, targetNames)
    && (!override.weight_class || bout.weight_class === override.weight_class);
  if (alreadyApplied) continue;

  const previousFighters = Array.isArray(bout.fighters) ? bout.fighters : [];
  bout.fighters = targetNames.map(name => {
    const existing = previousFighters.find(item => norm(item.name) === norm(name));
    if (existing) return existing;
    return fighter(name, portraitFor(name, data.events, cache));
  });
  if (override.weight_class) bout.weight_class = override.weight_class;
  event.updated_label = updatedLabel();
  applied += 1;
}

if (applied) {
  data.generated_at = new Date().toISOString();
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Applied ${applied} verified upcoming-event override(s).`);
} else {
  console.log('No upcoming-event overrides needed.');
}
