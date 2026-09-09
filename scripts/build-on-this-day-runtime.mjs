import fs from 'node:fs/promises';
import path from 'node:path';

const CHECK_ONLY = process.argv.includes('--check');
const HISTORY_PATH = process.env.OTD_HISTORY_PATH || 'assets/data/on-this-day.json';
const OUTPUT_DIR = 'assets/data/on-this-day-runtime';
const FIELD_NAMES = [
    'date', 'kind', 'promotion', 'title', 'detail', 'source', 'sourceUrl',
    'weight', 'imageUrl', 'imageAlt', 'imageCredit', 'imagePosition'
];

const source = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(source) ? source : source.entries;
if (!Array.isArray(entries)) throw new Error(`${HISTORY_PATH} does not contain an entries array.`);

const compactEntry = entry => Object.fromEntries(
    FIELD_NAMES
        .filter(key => entry[key] !== undefined && entry[key] !== null && entry[key] !== '')
        .map(key => [key, entry[key]])
);

const months = Object.fromEntries(
    Array.from({ length: 12 }, (_, index) => [String(index + 1).padStart(2, '0'), []])
);
for (const entry of entries) {
    const month = String(entry?.date || '').slice(5, 7);
    if (!months[month]) throw new Error(`Invalid On This Day date: ${entry?.date || '(missing)'}`);
    months[month].push(compactEntry(entry));
}

const dates = {};
for (const monthEntries of Object.values(months)) {
    for (const entry of monthEntries) {
        const key = entry.date.slice(5);
        dates[key] = (dates[key] || 0) + 1;
    }
}

const files = new Map();
for (const [month, monthEntries] of Object.entries(months)) {
    const file = `${month}.json`;
    files.set(path.join(OUTPUT_DIR, file), `${JSON.stringify({
        version: 1,
        month,
        entries: monthEntries
    })}\n`);
}
files.set(path.join(OUTPUT_DIR, 'index.json'), `${JSON.stringify({
    version: 1,
    entryCount: entries.length,
    dates,
    months: Object.fromEntries(Object.entries(months).map(([month, monthEntries]) => [month, {
        file: `${month}.json`,
        count: monthEntries.length
    }]))
})}\n`);

let stale = false;
for (const [file, expected] of files) {
    if (CHECK_ONLY) {
        const current = await fs.readFile(file, 'utf8').catch(() => '');
        if (current.replace(/\r\n/g, '\n') !== expected) {
            console.error(`${file} is stale. Run npm run build:history-runtime.`);
            stale = true;
        }
        continue;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, expected);
}

if (stale) process.exitCode = 1;
else if (!CHECK_ONLY) console.log(`Built ${entries.length} runtime entries across 12 monthly shards.`);
