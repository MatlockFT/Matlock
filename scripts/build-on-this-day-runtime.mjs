import fs from 'node:fs/promises';
import path from 'node:path';

const CHECK_ONLY = process.argv.includes('--check');
const HISTORY_PATH = process.env.OTD_HISTORY_PATH || 'assets/data/on-this-day.json';
const OUTPUT_DIR = 'assets/data/on-this-day-runtime';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const WINDOW_DAYS = Math.max(0, Number(process.env.OTD_CURRENT_WINDOW_DAYS || 2));
const FIELD_NAMES = [
    'date', 'kind', 'promotion', 'title', 'detail', 'source', 'sourceUrl',
    'weight', 'imageUrl', 'imageAlt', 'imageCredit', 'imagePosition',
    'imageSourceUrl', 'imageSourceType', 'imageConfidence', 'imageSubjectType',
    'imageMatchReason', 'imageStatus', 'imageArtifactType', 'imagePosterVerified',
    'imageFallback', 'imageExactMatch', 'imageTapologyBinding', 'imageTapologyPageUrl',
    'imageManualVisualVerified'
];

const source = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const entries = Array.isArray(source) ? source : source.entries;
if (!Array.isArray(entries)) throw new Error(`${HISTORY_PATH} does not contain an entries array.`);

const isEvent = entry => entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
const hasHttpsImage = entry => typeof entry?.imageUrl === 'string' && /^https:\/\//i.test(entry.imageUrl);
const trustedTapologyBindings = new Set(['direct-event-page','bing-image-exact-event-page','manual-exact-event-page','legacy-filename-exact']);
const trustedPosterTypes = new Set([
    'tapology-event-poster',
    'official-promotion-event-poster',
    'wikipedia-event-poster',
    'archived-promotion-event-poster',
    'verified-manual-event-poster'
]);

function ordinal(mmdd) {
    const match = /^(\d{2})-(\d{2})$/.exec(mmdd);
    if (!match) return 999;
    const date = new Date(Date.UTC(2024, Number(match[1]) - 1, Number(match[2])));
    return Math.round((date - Date.UTC(2024, 0, 1)) / 86400000);
}

function localMMDD() {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type)?.value || '';
    return `${get('month')}-${get('day')}`;
}

function distance(entry) {
    const a = ordinal(String(entry?.date || '').slice(5));
    const b = ordinal(localMMDD());
    const direct = Math.abs(a - b);
    return Math.min(direct, 366 - direct);
}

const verifiedEventPoster = entry => {
    if (!isEvent(entry) || entry?.imagePosterVerified !== true || entry?.imageArtifactType !== 'event-poster' || !hasHttpsImage(entry)) return false;
    if (!trustedPosterTypes.has(entry?.imageSourceType)) return false;
    if (entry?.imageSourceType === 'tapology-event-poster') {
        return trustedTapologyBindings.has(entry?.imageTapologyBinding) && /^https:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\//i.test(entry?.imageTapologyPageUrl || '');
    }
    if (entry?.imageSourceType === 'verified-manual-event-poster') return entry?.imageManualVisualVerified === true;
    return true;
};

function removeVisibleImage(compact) {
    compact.imageStatus = 'unresolved';
    compact.imagePosterVerified = false;
    delete compact.imageUrl;
    delete compact.imageAlt;
    delete compact.imageCredit;
    delete compact.imagePosition;
    delete compact.imageFallback;
}

const compactEntry = entry => {
    const compact = Object.fromEntries(
        FIELD_NAMES
            .filter(key => entry[key] !== undefined && entry[key] !== null && entry[key] !== '')
            .map(key => [key, entry[key]])
    );

    if (isEvent(entry)) {
        // Never let the browser invent a live Wikipedia image for an event.
        compact.wikipediaTitle = ' ';

        if (!verifiedEventPoster(entry)) {
            compact.imagePosterVerified = false;
            if (distance(entry) <= WINDOW_DAYS) {
                // The visible/current window is correctness-first: if the
                // actual poster is not verified, show text rather than a
                // related, editorial, fighter, or historically stale image.
                removeVisibleImage(compact);
            } else if (hasHttpsImage(entry)) {
                // Deep archive may retain a stored relevant fallback while an
                // exact poster is still being backfilled. It is never labeled
                // or surfaced as a verified event poster.
                compact.imageArtifactType = 'event-fallback';
                compact.imageFallback = true;
            } else {
                removeVisibleImage(compact);
            }
        }
    }

    return compact;
};

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
else if (!CHECK_ONLY) console.log(`Built ${entries.length} runtime entries across 12 monthly shards. Current-window events expose only verified posters; archive fallbacks remain separate and unverified.`);
