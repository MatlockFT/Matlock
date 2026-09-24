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

const yearOf = entry => Number(String(entry?.date || '').slice(0, 4)) || 0;

function significanceScore(entry) {
    const title = String(entry?.title || '').trim();
    const promotion = String(entry?.promotion || '').trim().toLowerCase();
    let score = Number(entry?.weight || 0) * 10;

    // Homepage history should favor historically important cards, not merely
    // whichever matching event happened most recently.
    if (/^ufc\s+\d+\b/i.test(title)) score += 220;
    else if (/^pride\s+\d+\b/i.test(title)) score += 190;
    else if (/\b(?:grand prix|gp final|final conflict|shockwave)\b/i.test(title)) score += 120;
    else if (/\b(?:title|champion|championship)\b/i.test(title)) score += 80;

    if (/^ufc fight night\b/i.test(title)) score += 60;
    if (promotion === 'ufc') score += 35;
    if (promotion === 'pride') score += 30;
    if (promotion === 'rizin') score += 18;
    if (promotion === 'bellator') score += 14;

    if (hasImage(entry)) score += 25;
    if (entry?.imageStatus === 'resolved') score += 20;

    return score;
}

const best = candidates
    .sort((a, b) => {
        const scoreOrder = significanceScore(b) - significanceScore(a);
        if (scoreOrder) return scoreOrder;

        const imageOrder = Number(hasImage(b)) - Number(hasImage(a));
        if (imageOrder) return imageOrder;

        const resolvedOrder = Number(b?.imageStatus === 'resolved') - Number(a?.imageStatus === 'resolved');
        if (resolvedOrder) return resolvedOrder;

        return yearOf(b) - yearOf(a);
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
