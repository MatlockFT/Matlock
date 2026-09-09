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

function boutKey(names = []) {
  return names.map(name => norm(name)).filter(Boolean).sort().join('|');
}

function currentBoutKey(bout) {
  return boutKey((bout?.fighters || []).map(item => item?.name));
}

function ensureVerifiedBouts(event, override, data, cache) {
  const specs = Array.isArray(override?.verified_bouts) ? override.verified_bouts : [];
  if (!specs.length) return false;

  const mainSection = (event.sections || []).find(section => section.kind === 'main');
  if (!mainSection) {
    console.warn(`Verified-card override skipped: ${override.event_id} has no main section.`);
    return false;
  }

  const parsed = specs.map(spec => ({
    fighters: Array.isArray(spec?.fighters) ? spec.fighters.map(name => String(name || '').trim()) : [],
    weight_class: String(spec?.weight_class || '').trim()
  }));
  const keys = parsed.map(spec => boutKey(spec.fighters));
  if (
    parsed.some(spec => spec.fighters.length !== 2 || spec.fighters.some(name => !name))
    || keys.some(key => !key)
    || new Set(keys).size !== keys.length
  ) {
    console.warn(`Verified-card override skipped: ${override.event_id} has invalid or duplicate verified bouts.`);
    return false;
  }

  const allBouts = (event.sections || []).flatMap(section => section.bouts || []);
  const byKey = new Map(allBouts.map(bout => [currentBoutKey(bout), bout]));
  let changed = false;

  for (let index = 0; index < parsed.length; index += 1) {
    const spec = parsed[index];
    const key = keys[index];
    const existing = byKey.get(key);
    if (existing) {
      if (spec.weight_class && existing.weight_class !== spec.weight_class) {
        existing.weight_class = spec.weight_class;
        changed = true;
      }
      continue;
    }

    const created = {
      order: allBouts.length + 1,
      label: '',
      weight_class: spec.weight_class || 'Weight class TBA',
      fighters: spec.fighters.map(name => fighter(name, portraitFor(name, data.events, cache)))
    };
    mainSection.bouts.push(created);
    allBouts.push(created);
    byKey.set(key, created);
    changed = true;
  }

  return changed;
}

function applyCardLayoutOverride(event, override) {
  const verifiedBouts = Array.isArray(override?.verified_bouts) ? override.verified_bouts : [];
  const sequence = Array.isArray(override?.bout_sequence) && override.bout_sequence.length
    ? override.bout_sequence
    : verifiedBouts.map(spec => spec?.fighters).filter(Array.isArray);
  if (!sequence.length) return false;

  const mainCount = Number(override.main_count);
  if (!Number.isInteger(mainCount) || mainCount < 1 || mainCount > sequence.length) {
    console.warn(`Layout override skipped: ${override.event_id} has invalid main_count.`);
    return false;
  }

  const mainSection = (event.sections || []).find(section => section.kind === 'main');
  if (!mainSection) {
    console.warn(`Layout override skipped: ${override.event_id} is missing a main section.`);
    return false;
  }

  const allBouts = (event.sections || []).flatMap(section => section.bouts || []);
  const byKey = new Map();
  for (const bout of allBouts) {
    const key = currentBoutKey(bout);
    if (!key || byKey.has(key)) {
      console.warn(`Layout override skipped: ${override.event_id} has duplicate or invalid bout identities.`);
      return false;
    }
    byKey.set(key, bout);
  }

  const targetKeys = sequence.map(pair => boutKey(Array.isArray(pair) ? pair : []));
  if (targetKeys.some(key => !key || !byKey.has(key)) || new Set(targetKeys).size !== targetKeys.length) {
    console.warn(`Layout override skipped: ${override.event_id} no longer matches the verified bout sequence.`);
    return false;
  }

  if (targetKeys.length !== allBouts.length) {
    console.warn(`Layout override skipped: ${override.event_id} bout count changed since verification.`);
    return false;
  }

  let prelimSection = (event.sections || []).find(section => section.kind === 'prelims');
  if (mainCount < sequence.length && !prelimSection) {
    prelimSection = {
      kind: 'prelims',
      title: override.prelim_title || 'Prelims',
      time: override.prelim_time || '',
      bouts: []
    };
    event.sections.push(prelimSection);
  }

  const currentKeys = allBouts.map(currentBoutKey);
  const currentMainCount = (mainSection.bouts || []).length;
  const currentPrelimCount = (prelimSection?.bouts || []).length;
  const alreadyApplied = currentMainCount === mainCount
    && currentPrelimCount === sequence.length - mainCount
    && currentKeys.length === targetKeys.length
    && currentKeys.every((key, index) => key === targetKeys[index]);
  if (alreadyApplied) return false;

  const ordered = targetKeys.map(key => byKey.get(key));
  ordered.forEach((bout, index) => {
    bout.order = index + 1;
    bout.label = index === 0 ? 'Main Event' : index === 1 ? 'Co-Main Event' : '';
  });

  mainSection.bouts = ordered.slice(0, mainCount);
  if (prelimSection) prelimSection.bouts = ordered.slice(mainCount);
  event.updated_label = updatedLabel();
  return true;
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
  if (!override?.event_id) continue;
  if (override.expires_after && today > override.expires_after) continue;

  const event = (data.events || []).find(item => item.id === override.event_id);
  if (!event) continue;

  let changed = ensureVerifiedBouts(event, override, data, cache);
  if (applyCardLayoutOverride(event, override)) changed = true;

  if (Number.isInteger(override?.bout_order)) {
    const bout = (event.sections || [])
      .flatMap(section => section.bouts || [])
      .find(item => item.order === override.bout_order);
    if (!bout) {
      console.warn(`Override skipped: ${override.event_id} bout ${override.bout_order} not found.`);
    } else {
      const currentNames = (bout.fighters || []).map(item => item.name);
      const expected = Array.isArray(override.expected_fighters) ? override.expected_fighters : [];
      const targetNames = Array.isArray(override.fighters) ? override.fighters : [];

      if (expected.length && !sameNames(currentNames, expected) && !sameNames(currentNames, targetNames)) {
        console.warn(`Override skipped: ${override.event_id} bout ${override.bout_order} no longer matches expected fighters.`);
      } else if (targetNames.length !== 2) {
        console.warn(`Override skipped: ${override.event_id} bout ${override.bout_order} must provide exactly two fighters.`);
      } else {
        const alreadyApplied = sameNames(currentNames, targetNames)
          && (!override.weight_class || bout.weight_class === override.weight_class);
        if (!alreadyApplied) {
          const previousFighters = Array.isArray(bout.fighters) ? bout.fighters : [];
          bout.fighters = targetNames.map(name => {
            const existing = previousFighters.find(item => norm(item.name) === norm(name));
            if (existing) return existing;
            return fighter(name, portraitFor(name, data.events, cache));
          });
          if (override.weight_class) bout.weight_class = override.weight_class;
          event.updated_label = updatedLabel();
          changed = true;
        }
      }
    }
  }

  if (changed) applied += 1;
}

if (applied) {
  data.generated_at = new Date().toISOString();
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Applied ${applied} verified upcoming-event override(s).`);
} else {
  console.log('No upcoming-event overrides needed.');
}
