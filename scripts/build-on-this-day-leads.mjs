import fs from 'node:fs/promises';

const INPUT_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OUTPUT_PATH = process.argv[3] || 'assets/data/on-this-day-leads.json';
const COLLAPSE_LIMIT = 8;

const kindOrder = new Map([
    ['fight', 0], ['title', 1], ['signing', 2], ['debut', 3],
    ['incident', 4], ['event', 5], ['news', 6], ['death', 7], ['birthday', 8]
]);

const kindBonus = new Map([
    ['title', 12], ['fight', 10], ['incident', 8], ['debut', 7],
    ['signing', 6], ['death', 5], ['news', 4], ['birthday', 2], ['event', 0]
]);

const significanceScore = entry => Number(entry?.weight || 0) + (kindBonus.get(entry?.kind) || 0);

const compareNotable = (a, b) => {
    const scoreDiff = significanceScore(b) - significanceScore(a);
    if (scoreDiff) return scoreDiff;
    const kindDiff = (kindOrder.get(a?.kind) ?? 99) - (kindOrder.get(b?.kind) ?? 99);
    if (kindDiff) return kindDiff;
    return String(b?.date || '').localeCompare(String(a?.date || ''));
};

const data = JSON.parse(await fs.readFile(INPUT_PATH, 'utf8'));
const entries = Array.isArray(data?.entries) ? data.entries : [];
const byDay = new Map();

for (const entry of entries) {
    const key = String(entry?.date || '').slice(5);
    if (!/^\d{2}-\d{2}$/.test(key)) continue;
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(entry);
}

const leads = {};
for (const [key, matching] of [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const displayed = [...matching].sort(compareNotable).slice(0, COLLAPSE_LIMIT);
    const firstImage = displayed.find(entry => typeof entry?.imageUrl === 'string' && entry.imageUrl.trim());
    if (firstImage) leads[key] = firstImage.imageUrl.trim();
}

const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    leads
};

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(`Wrote ${Object.keys(leads).length} On This Day lead-image hints to ${OUTPUT_PATH}`);
