import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const CACHE_PATH = process.argv[3] || "assets/data/on-this-day-image-cache.json";
const USER_AGENT = "MMA-Matlock-OnThisDay-Images/1.1 (+https://matlockfighttalk.com/on-this-day/)";
const REQUEST_TIMEOUT_MS = 20000;
const REQUEST_ATTEMPTS = 3;
const ENRICH_LIMIT = Math.max(1, Number(process.env.OTD_IMAGE_ENRICH_LIMIT || 180));
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.OTD_IMAGE_CONCURRENCY || 4)));
const STRATEGY_VERSION = 3;
const POSTER_RECHECK_DAYS = 365;
const FALLBACK_RECHECK_DAYS = 120;
const FAILED_RECHECK_DAYS = 14;
const THUMB_WIDTH = 1200;
const IMAGE_PAGE_LIMIT = 3;

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const normalized = value => clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

async function readJson(path, fallback) {
    try {
        return JSON.parse(await fs.readFile(path, "utf8"));
    } catch (error) {
        if (error?.code === "ENOENT") return fallback;
        throw error;
    }
}

async function requestJson(url) {
    let lastError;
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: {
                    "user-agent": USER_AGENT,
                    accept: "application/json"
                }
            });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            return await response.json();
        } catch (error) {
            lastError = error;
            if (attempt < REQUEST_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 650 * attempt));
        }
    }
    throw lastError || new Error(`Request failed: ${url}`);
}

function wikipediaTitle(entry) {
    if (entry?.wikipediaTitle) return clean(entry.wikipediaTitle);
    try {
        const url = new URL(String(entry?.sourceUrl || ""));
        if (url.hostname.toLowerCase() !== "en.wikipedia.org" || !url.pathname.startsWith("/wiki/")) return "";
        return clean(decodeURIComponent(url.pathname.slice(6)).replace(/_/g, " "));
    } catch {
        return "";
    }
}

function eventName(entry) {
    return clean(String(entry?.title || "").replace(/\s+took place$/i, ""));
}

function mmddOrdinal(value) {
    const match = /^(?:\d{4}-)?(\d{2})-(\d{2})$/.exec(String(value || "").slice(-5));
    if (!match) return 999;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const date = new Date(Date.UTC(2024, month - 1, day));
    const start = new Date(Date.UTC(2024, 0, 1));
    return Math.round((date - start) / 86400000);
}

function todayOrdinal() {
    const now = new Date();
    return mmddOrdinal(`${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`);
}

function cyclicDistance(entry) {
    const a = mmddOrdinal(entry?.date?.slice(5));
    const b = todayOrdinal();
    const direct = Math.abs(a - b);
    return Math.min(direct, 366 - direct);
}

const STOP_WORDS = new Set([
    "the", "and", "with", "from", "into", "versus", "vs", "took", "place",
    "ufc", "mma", "fight", "night", "championship", "championships", "fighting",
    "event", "live", "final", "finals"
]);

function meaningfulTokens(entry) {
    const tokens = normalized(eventName(entry))
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter(token => token.length >= 3 && !STOP_WORDS.has(token));
    return [...new Set(tokens)].slice(0, 12);
}

function numberedEvent(entry) {
    return normalized(eventName(entry)).match(/\b(?:ufc|wec|bellator|pfl|rizin|one|pride)\s*(?:fight\s*night\s*)?(\d{1,4})\b/i)?.[1] || "";
}

function candidateScore(fileTitle, entry) {
    const filename = normalized(String(fileTitle || "").replace(/^File:/i, ""));
    if (!filename || /\.svg(?:$|\?)/i.test(filename)) return -1000;
    if (!/\.(?:jpe?g|png|webp|gif|tiff?)$/i.test(filename)) return -500;

    let score = 0;
    if (/\bposter\b|promotional|promotion\b|promo\b|fight[ _-]?card|event[ _-]?card|official[ _-]?art/i.test(filename)) score += 120;
    if (/cover|key[ _-]?art|programme|program\b/i.test(filename)) score += 70;

    const eventNumber = numberedEvent(entry);
    if (eventNumber && new RegExp(`(?:^|[^0-9])${eventNumber}(?:[^0-9]|$)`).test(filename)) score += 65;

    let tokenMatches = 0;
    for (const token of meaningfulTokens(entry)) {
        if (filename.includes(token)) tokenMatches += 1;
    }
    score += Math.min(tokenMatches, 6) * 11;
    if (tokenMatches >= 2) score += 18;

    const promotion = normalized(entry?.promotion || "").replace(/[^a-z0-9]+/g, " ").trim();
    if (promotion && filename.includes(promotion)) score += 20;

    if (/\b(?:logo|flag|map|icon|symbol|seal|coat[ _-]?of[ _-]?arms|wikidata|commons|location|venue|arena|ticket|sponsor)\b/i.test(filename)) score -= 110;
    if (/headshot|portrait|weigh[ _-]?in|press[ _-]?conference|interview/i.test(filename)) score -= 35;
    if (/screenshot|screen[ _-]?shot|broadcast/i.test(filename)) score -= 24;

    return score;
}

function recordAgeDays(record) {
    const checked = Date.parse(record?.checkedAt || "");
    if (!Number.isFinite(checked)) return Infinity;
    return (Date.now() - checked) / 86400000;
}

function needsReview(record) {
    if (!record || Number(record.strategyVersion || 0) < STRATEGY_VERSION) return true;
    const age = recordAgeDays(record);
    if (record.status === "poster-candidate") return age >= POSTER_RECHECK_DAYS;
    if (record.status === "pageimage-kept") return age >= FALLBACK_RECHECK_DAYS;
    return age >= FAILED_RECHECK_DAYS;
}

async function listPageImages(title) {
    const images = new Set();
    let imcontinue = "";

    for (let pageNumber = 0; pageNumber < IMAGE_PAGE_LIMIT; pageNumber += 1) {
        const url = new URL("https://en.wikipedia.org/w/api.php");
        url.searchParams.set("action", "query");
        url.searchParams.set("format", "json");
        url.searchParams.set("formatversion", "2");
        url.searchParams.set("redirects", "1");
        url.searchParams.set("prop", "images");
        url.searchParams.set("imlimit", "100");
        url.searchParams.set("titles", title);
        if (imcontinue) url.searchParams.set("imcontinue", imcontinue);

        const data = await requestJson(url);
        const page = Array.isArray(data?.query?.pages) ? data.query.pages[0] : null;
        for (const item of page?.images || []) {
            if (item?.title) images.add(item.title);
        }

        imcontinue = data?.continue?.imcontinue || "";
        if (!imcontinue) break;
    }

    return [...images];
}

async function imageInfo(fileTitles) {
    const output = [];
    for (let offset = 0; offset < fileTitles.length; offset += 40) {
        const batch = fileTitles.slice(offset, offset + 40);
        if (!batch.length) continue;
        const url = new URL("https://en.wikipedia.org/w/api.php");
        url.searchParams.set("action", "query");
        url.searchParams.set("format", "json");
        url.searchParams.set("formatversion", "2");
        url.searchParams.set("prop", "imageinfo");
        url.searchParams.set("iiprop", "url|size");
        url.searchParams.set("iiurlwidth", String(THUMB_WIDTH));
        url.searchParams.set("titles", batch.join("|"));
        const data = await requestJson(url);
        const pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
        for (const page of pages) {
            const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
            const item = {
                title: page?.title || "",
                url: info?.thumburl || info?.url || "",
                width: Number(info?.width || 0),
                height: Number(info?.height || 0)
            };
            if (/^https:\/\//i.test(item.url)) output.push(item);
        }
    }
    return output;
}

function dimensionAdjustment(item) {
    const width = item.width;
    const height = item.height;
    if (!width || !height || width < 340 || height < 220) return -1000;
    const ratio = width / height;
    if (ratio < 0.34 || ratio > 3.2) return -1000;

    let score = 0;
    const area = width * height;
    if (area >= 1500000) score += 14;
    else if (area >= 750000) score += 8;
    else if (area >= 350000) score += 4;

    if (ratio >= 0.48 && ratio <= 0.82) score += 18;
    else if (ratio > 0.82 && ratio <= 1.2) score += 9;
    else if (ratio > 1.2 && ratio <= 1.9) score += 6;
    else score += 1;
    return score;
}

async function findBetterArtwork(entry) {
    const title = wikipediaTitle(entry);
    if (!title) return null;

    const files = await listPageImages(title);
    const ranked = files
        .map(fileTitle => ({ fileTitle, score: candidateScore(fileTitle, entry) }))
        .filter(item => item.score >= 45)
        .sort((a, b) => b.score - a.score)
        .slice(0, 12);

    if (!ranked.length) return null;
    const info = await imageInfo(ranked.map(item => item.fileTitle));
    const scoreByTitle = new Map(ranked.map(item => [item.fileTitle, item.score]));

    const candidates = info
        .map(item => ({ ...item, score: (scoreByTitle.get(item.title) ?? 0) + dimensionAdjustment(item) }))
        .filter(item => item.score >= 78)
        .sort((a, b) => b.score - a.score || (b.width * b.height) - (a.width * a.height));

    return candidates[0] || null;
}

function cachePageImage(entry, nowIso, status = "pageimage-kept") {
    return {
        strategyVersion: STRATEGY_VERSION,
        status,
        sourceType: entry?.imageSourceType || "wikipedia-pageimage",
        checkedAt: nowIso,
        wikipediaTitle: wikipediaTitle(entry),
        ...(entry?.imageUrl ? { imageUrl: entry.imageUrl } : {}),
        ...(entry?.imageAlt ? { imageAlt: entry.imageAlt } : {}),
        ...(entry?.imageCredit ? { imageCredit: entry.imageCredit } : {}),
        ...(entry?.imageWidth ? { width: entry.imageWidth } : {}),
        ...(entry?.imageHeight ? { height: entry.imageHeight } : {})
    };
}

function applyCache(history, cache) {
    let applied = 0;
    for (const entry of history.entries || []) {
        if (entry?.generatedBy !== "wikipedia-event-index" || !entry?.autoKey) continue;
        const record = cache.entries?.[entry.autoKey];
        if (!record) continue;

        entry.imageStrategyVersion = Number(record.strategyVersion || STRATEGY_VERSION);
        entry.imageSourceType = record.sourceType || "wikipedia-pageimage";
        if (record.imageFileTitle) entry.imageFileTitle = record.imageFileTitle;
        if (record.width) entry.imageWidth = record.width;
        if (record.height) entry.imageHeight = record.height;

        if (record.imageUrl) {
            entry.imageUrl = record.imageUrl;
            entry.imageAlt = record.imageAlt || `${eventName(entry)} event artwork`;
            entry.imageCredit = record.imageCredit || "Wikipedia";
            applied += 1;
        }
    }
    return applied;
}

const history = await readJson(HISTORY_PATH, { entries: [] });
const cache = await readJson(CACHE_PATH, { version: 1, updatedAt: null, entries: {} });
if (!cache.entries || typeof cache.entries !== "object" || Array.isArray(cache.entries)) cache.entries = {};

const eligible = (history.entries || [])
    .filter(entry => entry?.generatedBy === "wikipedia-event-index" && entry?.autoKey && wikipediaTitle(entry))
    .filter(entry => needsReview(cache.entries[entry.autoKey]))
    .sort((a, b) => {
        const imageDifference = Number(Boolean(a.imageUrl)) - Number(Boolean(b.imageUrl));
        if (imageDifference) return imageDifference;
        const dateDifference = cyclicDistance(a) - cyclicDistance(b);
        if (dateDifference) return dateDifference;
        return Number(b.weight || 0) - Number(a.weight || 0);
    })
    .slice(0, ENRICH_LIMIT);

let improved = 0;
let kept = 0;
let failed = 0;
let cursor = 0;
const nowIso = new Date().toISOString();

async function processEntry(entry) {
    try {
        const artwork = await findBetterArtwork(entry);
        if (artwork) {
            cache.entries[entry.autoKey] = {
                strategyVersion: STRATEGY_VERSION,
                status: "poster-candidate",
                sourceType: "wikipedia-poster-candidate",
                checkedAt: nowIso,
                wikipediaTitle: wikipediaTitle(entry),
                imageUrl: artwork.url,
                imageAlt: `${eventName(entry)} event artwork`,
                imageCredit: "Wikipedia",
                imageFileTitle: artwork.title,
                width: artwork.width,
                height: artwork.height,
                score: artwork.score
            };
            improved += 1;
        } else {
            cache.entries[entry.autoKey] = cachePageImage(entry, nowIso, entry.imageUrl ? "pageimage-kept" : "no-image-found");
            kept += 1;
        }
    } catch (error) {
        cache.entries[entry.autoKey] = {
            ...cachePageImage(entry, nowIso, "check-failed"),
            error: clean(error?.message || error).slice(0, 180)
        };
        failed += 1;
    }
}

async function worker() {
    while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= eligible.length) return;
        await processEntry(eligible[index]);
        await new Promise(resolve => setTimeout(resolve, 70));
    }
}

const workerCount = Math.min(CONCURRENCY, Math.max(eligible.length, 1));
await Promise.all(Array.from({ length: workerCount }, () => worker()));

const applied = applyCache(history, cache);
cache.version = Math.max(Number(cache.version || 1), 2);
cache.strategyVersion = STRATEGY_VERSION;
if (eligible.length) cache.updatedAt = nowIso;

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");

const generated = (history.entries || []).filter(entry => entry?.generatedBy === "wikipedia-event-index");
const withImages = generated.filter(entry => entry?.imageUrl).length;
console.log(`On This Day image enrichment: ${eligible.length} reviewed with ${workerCount} workers; ${improved} better artwork, ${kept} page images/fallbacks kept, ${failed} checks failed.`);
console.log(`Image cache applied to ${applied} generated entries. Generated image coverage now ${withImages}/${generated.length}.`);
