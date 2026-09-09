import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OUTPUT_PATH = process.argv[3] || 'assets/data/on-this-day-home.json';
const TIME_ZONE = process.env.OTD_HOME_TIME_ZONE || 'America/Chicago';

const data = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(data) ? data : Array.isArray(data?.entries) ? data.entries : [];

const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
        timeZone: TIME_ZONE,
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value])
);
const key = `${parts.month}-${parts.day}`;

const kindBonus = new Map([
    ['title', 12], ['fight', 10], ['incident', 8], ['debut', 7],
    ['signing', 6], ['death', 5], ['news', 4], ['birthday', 2], ['event', 0]
]);
const hasImage = entry => /^https:\/\//i.test(String(entry?.imageUrl || '').trim());
const score = entry => Number(entry?.weight || 0) + (kindBonus.get(entry?.kind) || 0) + (hasImage(entry) ? 1000 : 0);

const best = entries
    .filter(entry => String(entry?.date || '').slice(5) === key)
    .sort((a, b) => score(b) - score(a))[0] || null;

const compactEntry = best ? {
    date: best.date,
    kind: best.kind,
    promotion: best.promotion || '',
    title: best.title || '',
    detail: best.detail || best.description || '',
    source: best.source || '',
    sourceUrl: best.sourceUrl || '',
    weight: Number(best.weight || 0),
    imageUrl: best.imageUrl || '',
    imageAlt: best.imageAlt || best.title || 'MMA history image',
    imageCredit: best.imageCredit || '',
    imageSourceUrl: best.imageSourceUrl || best.sourceUrl || '',
    imageSourceType: best.imageSourceType || '',
    imageConfidence: Number.isFinite(Number(best.imageConfidence)) ? Number(best.imageConfidence) : null,
    imageSubjectType: best.imageSubjectType || '',
    imageMatchReason: best.imageMatchReason || '',
    imageStatus: best.imageStatus || (hasImage(best) ? 'resolved' : 'unresolved')
} : null;

const output = {
    version: 2,
    generatedAt: new Date().toISOString(),
    timeZone: TIME_ZONE,
    key,
    entry: compactEntry
};

await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Homepage On This Day snapshot: ${key}${compactEntry ? ` · ${compactEntry.title}` : ' · no entry'}`);
