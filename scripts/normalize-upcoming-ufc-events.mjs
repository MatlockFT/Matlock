import fs from 'node:fs/promises';
import { DATA_PATH } from './upcoming-events-data.mjs';

const LEGACY = new Map([
  ['https://www.ufc.com/event/ufc-330', {
    id: 'ufc-330-2026-08-15',
    promotion: 'UFC 330',
    title: 'Makhachev vs Machado Garry',
    venue: 'Xfinity Mobile Arena · Philadelphia, Pennsylvania',
    times: { early: '5:00 PM ET', prelims: '7:00 PM ET', main: '9:00 PM ET' }
  }],
  ['https://www.ufc.com/event/ufc-fight-night-august-22-2026', {
    id: 'ufc-fight-night-sacramento-2026-08-22',
    promotion: 'UFC Fight Night',
    title: 'Hernandez vs Rodrigues',
    venue: 'Golden 1 Center · Sacramento, California',
    times: { prelims: '5:00 PM ET', main: '8:00 PM ET' }
  }]
]);

const compound = new Set(['da','de','del','della','do','dos','du','machado','saint','van','von']);

function shortName(name='') {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || '';
  const penultimate = parts.at(-2).toLowerCase();
  return compound.has(penultimate) ? parts.slice(-2).join(' ') : parts.at(-1);
}

function mainEventTitle(event) {
  const main = (event.sections || []).find(section => section.kind === 'main');
  const bout = (main?.bouts || []).find(item => item.label === 'Main Event') || main?.bouts?.[0];
  const fighters = bout?.fighters || [];
  if (fighters.length !== 2) return '';
  const left = shortName(fighters[0]?.name);
  const right = shortName(fighters[1]?.name);
  return left && right ? `${left} vs ${right}` : '';
}

function setSectionTimes(event, times={}) {
  for (const section of event.sections || []) {
    if (times[section.kind]) section.time = times[section.kind];
  }
}

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
let changed = 0;

for (const event of data.events || []) {
  if (event.promotion_key !== 'ufc') continue;

  const known = LEGACY.get(event.official_url);
  if (known) {
    for (const field of ['id','promotion','title','venue']) {
      if (known[field] && event[field] !== known[field]) {
        event[field] = known[field];
        changed++;
      }
    }
    const before = JSON.stringify((event.sections || []).map(section => [section.kind, section.time]));
    setSectionTimes(event, known.times);
    const after = JSON.stringify((event.sections || []).map(section => [section.kind, section.time]));
    if (before !== after) changed++;
    continue;
  }

  if (!event.title || /^Fight Card$/i.test(event.title)) {
    const derived = mainEventTitle(event);
    if (derived && event.title !== derived) {
      event.title = derived;
      changed++;
    }
  }
}

if (changed) {
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log(`Normalized UFC event metadata with ${changed} correction(s).`);
} else {
  console.log('UFC event metadata already normalized.');
}
