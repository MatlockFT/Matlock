import fs from 'node:fs/promises';

const SOURCE = '_data/fighter_portraits.json';
const TARGET = 'assets/fighter-portraits.json';

const raw = await fs.readFile(SOURCE, 'utf8');
const parsed = JSON.parse(raw);
const normalized = JSON.stringify(
    Object.fromEntries(Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b))),
    null,
    2
) + '\n';

let current = '';
try { current = await fs.readFile(TARGET, 'utf8'); } catch {}

if (current !== normalized) {
    await fs.writeFile(TARGET, normalized);
    console.log(`Published ${Object.keys(parsed).length} fighter portraits.`);
} else {
    console.log('Public fighter portrait cache already current.');
}
