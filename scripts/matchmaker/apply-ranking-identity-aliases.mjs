import fs from 'node:fs/promises';
import path from 'node:path';
import { slug } from './sources/ufc.mjs';

const DATA_PATH = path.resolve('assets/data/matchmaker/current.json');
const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
const fighters = new Map((data.fighters || []).map(fighter => [fighter.id, fighter]));
const claimed = new Map();

for (const fighter of data.fighters || []) {
  claimed.set(fighter.id, fighter.id);
  for (const alias of fighter.aliases || []) {
    const normalized = slug(alias);
    if (!normalized) continue;
    const owner = claimed.get(normalized);
    if (owner && owner !== fighter.id) throw new Error(`Existing fighter alias collision: ${normalized} belongs to ${owner} and ${fighter.id}`);
    claimed.set(normalized, fighter.id);
  }
}

let added = 0;
for (const ranking of data.rankingsCurrent || []) {
  const fighter = fighters.get(ranking.id);
  if (!fighter || !ranking.name) continue;
  const alias = slug(ranking.name);
  if (!alias || alias === fighter.id || (fighter.aliases || []).includes(alias)) continue;
  const owner = claimed.get(alias);
  if (owner && owner !== fighter.id) throw new Error(`UFC rankings identity alias collision: ${ranking.name} (${alias}) maps to ${fighter.id}, already claimed by ${owner}`);
  fighter.aliases = [...new Set([...(fighter.aliases || []), alias])];
  claimed.set(alias, fighter.id);
  added++;
}

const tmp = `${DATA_PATH}.ranking-aliases.tmp`;
await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
await fs.rename(tmp, DATA_PATH);
console.log(`Official UFC rankings identity aliases applied: ${added}.`);
