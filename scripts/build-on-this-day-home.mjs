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

const hasImage = entry => /^https:\/\//i.test(String(entry?.imageUrl || '').trim());
const todays = entries.filter(entry => String(entry?.date || '').slice(5) === key);
const events = todays.filter(entry => entry?.kind === 'event');
const candidates = events.length ? events : todays;

const best = candidates
    .sort((a, b) => {
        const dateOrder = String(b?.date || '').localeCompare(String(a?.date || ''));
        if (dateOrder) return dateOrder;
        const imageOrder = Number(hasImage(b)) - Number(hasImage(a));
        if (imageOrder) return imageOrder;
        return Number(b?.weight || 0) - Number(a?.weight || 0);
    })[0] || null;

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
