import fs from 'node:fs/promises';

const path = process.argv[2] || '_data/upcoming_events_regional.json';
const failures = [];
const tracking = /(?:piwik|matomo|google-analytics|googletagmanager|doubleclick|analytics|tracking|pixel|beacon|\/collect(?:[/?]|$)|\/track(?:[/?]|$))/i;

let data;
try {
  data = JSON.parse(await fs.readFile(path, 'utf8'));
} catch (error) {
  console.error(`Could not parse ${path}: ${error.message}`);
  process.exit(1);
}

if (data.schema_version !== 1) failures.push('schema_version must be 1.');
if (!Array.isArray(data.events)) failures.push('events must be an array.');

const ids = new Set();
let eventCount = 0;
let boutCount = 0;
let fighterCount = 0;
let portraitCount = 0;

for (const event of data.events || []) {
  eventCount += 1;
  if (!event?.id || !event?.title || !/^20\d{2}-\d{2}-\d{2}$/.test(event.date || '')) failures.push('event missing id/title/date.');
  if (ids.has(event.id)) failures.push(`duplicate event id ${event.id}.`);
  ids.add(event.id);
  if (!event.promotion_key || !event.promotion) failures.push(`${event.id}: missing promotion metadata.`);
  if (!/^https?:\/\//i.test(event.official_url || '')) failures.push(`${event.id}: missing official_url.`);
  if (!Array.isArray(event.sections) || !event.sections.length) failures.push(`${event.id}: no sections.`);

  const orders = new Set();
  for (const section of event.sections || []) {
    if (!section.kind || !section.title) failures.push(`${event.id}: malformed section.`);
    for (const bout of section.bouts || []) {
      boutCount += 1;
      if (!Number.isInteger(bout.order) || bout.order < 1) failures.push(`${event.id}: invalid bout order.`);
      if (orders.has(bout.order)) failures.push(`${event.id}: duplicate bout order ${bout.order}.`);
      orders.add(bout.order);
      if (!Array.isArray(bout.fighters) || bout.fighters.length !== 2) {
        failures.push(`${event.id}: bout ${bout.order} must have two fighters.`);
        continue;
      }
      for (const fighter of bout.fighters) {
        fighterCount += 1;
        const name = String(fighter?.name || '').trim();
        if (!name) failures.push(`${event.id}: bout ${bout.order} has missing fighter name.`);
        const image = String(fighter?.image || '').trim();
        if (image) {
          portraitCount += 1;
          if (!/^https?:\/\//i.test(image) || tracking.test(image)) failures.push(`${event.id}: invalid portrait URL for ${name}.`);
        }
        if (fighter?.image_framing && !/^(standard|safe)$/.test(fighter.image_framing)) failures.push(`${event.id}: invalid image_framing for ${name}.`);
      }
    }
  }
}

for (let i = 1; i < (data.events || []).length; i += 1) {
  if (data.events[i - 1].date > data.events[i].date) failures.push('events are not sorted by date.');
}

if (fighterCount && portraitCount / fighterCount < 0.7) {
  failures.push(`portrait coverage is too low for curated picker cards: ${portraitCount}/${fighterCount}.`);
}

if (failures.length) {
  console.error('Regional Fight Card Picker validation failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Regional Fight Card Picker validation passed: ${eventCount} event(s), ${boutCount} bout(s), ${portraitCount}/${fighterCount} fighter portraits.`);
