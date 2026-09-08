import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const CACHE_PATH = process.argv[3] || "assets/data/on-this-day-image-cache.json";
const USER_AGENT = "MMA-Matlock-OnThisDay-Images/1.4 (+https://mmamatlock.com/on-this-day/)";
const REQUEST_TIMEOUT_MS = 20000;
const REQUEST_ATTEMPTS = 3;
const ENRICH_LIMIT = Math.max(1, Number(process.env.OTD_IMAGE_ENRICH_LIMIT || 240));
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.OTD_IMAGE_CONCURRENCY || 4)));
const STRATEGY_VERSION = 6;
const POSTER_RECHECK_DAYS = 365;
const FALLBACK_RECHECK_DAYS = 90;
const FAILED_RECHECK_DAYS = 10;
const THUMB_WIDTH = 1200;
const IMAGE_PAGE_LIMIT = 2;
const COMMONS_SEARCH_LIMIT = 18;

const TARGET_PROMOTIONS = new Set(
    String(process.env.OTD_TARGET_PROMOTIONS || "ufc,wec,strikeforce,pfl,one,pancrase,bellator,rizin,pride")
        .split(",")
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
);

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

function promotionKey(value) {
    const text = normalized(value);
    if (text.includes("ultimate fighting") || text === "ufc") return "ufc";
    if (text.includes("world extreme cagefighting") || text === "wec") return "wec";
    if (text.includes("strikeforce")) return "strikeforce";
    if (text.includes("professional fighters league") || text === "pfl") return "pfl";
    if (text.includes("one championship") || text === "one") return "one";
    if (text.includes("pancrase")) return "pancrase";
    if (text.includes("bellator")) return "bellator";
    if (text.includes("rizin")) return "rizin";
    if (text.includes("pride")) return "pride";
    return text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function isTargetPromotion(entry) {
    return TARGET_PROMOTIONS.has(promotionKey(entry?.promotion));
}

function wikipediaReference(entry) {
    let title = clean(entry?.wikipediaTitle || "");
    let fragment = "";

    if (title.includes("#")) {
        const index = title.indexOf("#");
        fragment = title.slice(index + 1);
        title = title.slice(0, index);
    }

    try {
        const url = new URL(String(entry?.sourceUrl || ""));
        if (!title && url.hostname.toLowerCase() === "en.wikipedia.org" && url.pathname.startsWith("/wiki/")) {
            title = decodeURIComponent(url.pathname.slice(6)).replace(/_/g, " ");
        }
        if (!fragment && url.hash) fragment = decodeURIComponent(url.hash.replace(/^#/, "")).replace(/_/g, " ");
    } catch {
        // Keep any reference already recovered from wikipediaTitle.
    }

    return {
        title: clean(title.replace(/_/g, " ")),
        fragment: clean(fragment.replace(/_/g, " "))
    };
}

function wikipediaTitle(entry) {
    const reference = wikipediaReference(entry);
    return reference.fragment ? `${reference.title}#${reference.fragment}` : reference.title;
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
    "the", "and", "with", "from", "into", "versus", "took", "place",
    "ufc", "mma", "fight", "night", "champion", "champions", "championship",
    "championships", "fighting", "event", "live", "final", "finals", "ultimate"
]);

function words(value) {
    return normalized(value)
        .replace(/[^a-z0-9]+/g, " ")
        .split(" ")
        .filter(Boolean);
}

function meaningfulTokens(entry) {
    const tokens = words(eventName(entry))
        .filter(token => token.length >= 3 && !STOP_WORDS.has(token));
    return [...new Set(tokens)].slice(0, 14);
}

function numberedEvent(entry) {
    return normalized(eventName(entry)).match(/\b(?:ufc|wec|bellator|pfl|rizin|one|pride|pancrase)\s*(?:fight\s*night\s*)?(\d{1,4})\b/i)?.[1] || "";
}

function candidateEvidence(fileTitle, entry) {
    const filename = normalized(String(fileTitle || "").replace(/^File:/i, ""));
    const filenameWords = new Set(words(filename.replace(/\.(?:jpe?g|png|webp|gif|tiff?)$/i, "")));
    const bareFilename = [...filenameWords].join(" ");
    const bareEvent = words(eventName(entry)).join(" ");
    const promotion = promotionKey(entry?.promotion);
    const eventNumber = numberedEvent(entry);
    const tokens = meaningfulTokens(entry);
    const tokenMatches = tokens.filter(token => filenameWords.has(token));
    const posterish = /\bposter\b|promotional|\bpromo\b|fight[ _-]?card|event[ _-]?card|official[ _-]?art|key[ _-]?art/i.test(filename);
    const promotionMatch = Boolean(promotion && filenameWords.has(promotion));
    const numberMatch = Boolean(eventNumber && filenameWords.has(eventNumber));
    const fullNameMatch = Boolean(bareEvent && (bareFilename === bareEvent || bareFilename.includes(bareEvent)));

    return {
        filename,
        tokenMatches,
        posterish,
        promotionMatch,
        numberMatch,
        fullNameMatch
    };
}

function candidatePlausible(fileTitle, entry) {
    const evidence = candidateEvidence(fileTitle, entry);
    if (evidence.fullNameMatch) return true;
    if (evidence.posterish && evidence.promotionMatch && (evidence.numberMatch || evidence.tokenMatches.length >= 1)) return true;
    if (evidence.promotionMatch && evidence.tokenMatches.length >= 2) return true;
    if (evidence.promotionMatch && evidence.numberMatch && evidence.tokenMatches.length >= 1) return true;
    return false;
}

function candidateScore(fileTitle, entry) {
    const evidence = candidateEvidence(fileTitle, entry);
    const filename = evidence.filename;
    if (!filename || /\.svg(?:$|\?)/i.test(filename)) return -1000;
    if (!/\.(?:jpe?g|png|webp|gif|tiff?)$/i.test(filename)) return -500;

    let score = 0;
    if (evidence.posterish) score += 120;
    if (/cover|programme|program\b/i.test(filename)) score += 70;
    if (evidence.fullNameMatch) score += 90;
    if (evidence.numberMatch && evidence.promotionMatch) score += 58;
    score += Math.min(evidence.tokenMatches.length, 7) * 18;
    if (evidence.tokenMatches.length >= 2) score += 22;
    if (evidence.tokenMatches.length >= 4) score += 18;
    if (evidence.promotionMatch) score += 28;

    if (/\b(?:logo|flag|map|icon|symbol|seal|coat[ _-]?of[ _-]?arms|wikidata|location|venue|arena|sponsor)\b/i.test(filename)) score -= 130;
    if (/headshot|portrait|weigh[ _-]?in|press[ _-]?conference|interview/i.test(filename)) score -= 48;
    if (/ticket|badge|credential/i.test(filename)) score -= 55;
    if (/screenshot|screen[ _-]?shot|broadcast/i.test(filename)) score -= 26;

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
    if (record.status === "poster-candidate" || record.status === "commons-event-image") return age >= POSTER_RECHECK_DAYS;
    if (record.status === "pageimage-kept" || record.status === "lead-image") return age >= FALLBACK_RECHECK_DAYS;
    return age >= FAILED_RECHECK_DAYS;
}

async function listPageImages(title) {
    if (!title) return [];
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

async function pageLeadImage(title) {
    if (!title) return null;
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("prop", "pageimages");
    url.searchParams.set("piprop", "name|thumbnail|original");
    url.searchParams.set("pithumbsize", String(THUMB_WIDTH));
    url.searchParams.set("pilicense", "any");
    url.searchParams.set("titles", title);

    const data = await requestJson(url);
    const page = Array.isArray(data?.query?.pages) ? data.query.pages[0] : null;
    const source = page?.thumbnail?.source || page?.original?.source || "";
    if (!/^https:\/\//i.test(source)) return null;
    return {
        title: page?.pageimage ? `File:${page.pageimage}` : title,
        url: source,
        width: Number(page?.thumbnail?.width || 0),
        height: Number(page?.thumbnail?.height || 0),
        metadata: {},
        sourceType: "wikipedia-lead-image",
        artworkType: "event-photo",
        score: 90
    };
}

async function imageInfo(fileTitles, apiHost = "en.wikipedia.org") {
    const output = [];
    for (let offset = 0; offset < fileTitles.length; offset += 40) {
        const batch = fileTitles.slice(offset, offset + 40);
        if (!batch.length) continue;
        const url = new URL(`https://${apiHost}/w/api.php`);
        url.searchParams.set("action", "query");
        url.searchParams.set("format", "json");
        url.searchParams.set("formatversion", "2");
        url.searchParams.set("prop", "imageinfo");
        url.searchParams.set("iiprop", "url|size|extmetadata");
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
                height: Number(info?.height || 0),
                metadata: info?.extmetadata || {}
            };
            if (/^https:\/\//i.test(item.url)) output.push(item);
        }
    }
    return output;
}

function stripHtml(value) {
    return clean(String(value || "")
        .replace(/<br\s*\/?\s*>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;|&#160;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;|&apos;/gi, "'"));
}

function commonsCredit(metadata) {
    const artist = stripHtml(metadata?.Artist?.value || metadata?.Credit?.value || "").slice(0, 70);
    const license = stripHtml(metadata?.LicenseShortName?.value || "").slice(0, 40);
    const parts = ["Wikimedia Commons"];
    if (artist && !/unknown|wikimedia commons/i.test(artist)) parts.push(artist);
    if (license) parts.push(license);
    return parts.join(" · ");
}

function dimensionAdjustment(item) {
    const width = item.width;
    const height = item.height;
    if (!width || !height) return 0;
    if (width < 300 || height < 180) return -1000;
    const ratio = width / height;
    if (ratio < 0.28 || ratio > 3.8) return -1000;

    let score = 0;
    const area = width * height;
    if (area >= 1500000) score += 14;
    else if (area >= 750000) score += 8;
    else if (area >= 350000) score += 4;

    if (ratio >= 0.45 && ratio <= 0.82) score += 20;
    else if (ratio > 0.82 && ratio <= 1.2) score += 10;
    else if (ratio > 1.2 && ratio <= 1.9) score += 7;
    else score += 1;
    return score;
}

function artworkType(fileTitle) {
    const filename = normalized(fileTitle);
    if (/\bposter\b|promotional|promo\b|fight[ _-]?card|event[ _-]?card|official[ _-]?art|key[ _-]?art/i.test(filename)) return "poster";
    if (/cover|programme|program\b/i.test(filename)) return "artwork";
    return "event-photo";
}

function rankCandidates(items, entry, sourceType, minimum = 82, requireEvidence = false) {
    return items
        .map(item => ({
            ...item,
            sourceType,
            artworkType: artworkType(item.title),
            score: candidateScore(item.title, entry) + dimensionAdjustment(item)
        }))
        .filter(item => item.score >= minimum)
        .filter(item => !requireEvidence || candidatePlausible(item.title, entry))
        .sort((a, b) => b.score - a.score || (b.width * b.height) - (a.width * a.height));
}

function commonsQueries(entry) {
    const name = eventName(entry).replace(/[\"<>]/g, " ");
    const promotion = clean(entry?.promotion || "");
    const eventNumber = numberedEvent(entry);
    const queries = [];
    if (name) queries.push(`intitle:\"${name}\"`);
    if (eventNumber && promotion) queries.push(`\"${promotion}\" ${eventNumber}`);
    else if (name && promotion) queries.push(`\"${name}\" ${promotion}`);
    return [...new Set(queries)].slice(0, 2);
}

async function searchCommons(entry) {
    const results = new Map();
    for (const query of commonsQueries(entry)) {
        const url = new URL("https://commons.wikimedia.org/w/api.php");
        url.searchParams.set("action", "query");
        url.searchParams.set("format", "json");
        url.searchParams.set("formatversion", "2");
        url.searchParams.set("generator", "search");
        url.searchParams.set("gsrnamespace", "6");
        url.searchParams.set("gsrlimit", String(COMMONS_SEARCH_LIMIT));
        url.searchParams.set("gsrsearch", query);
        url.searchParams.set("prop", "imageinfo");
        url.searchParams.set("iiprop", "url|size|extmetadata");
        url.searchParams.set("iiurlwidth", String(THUMB_WIDTH));

        const data = await requestJson(url);
        for (const page of data?.query?.pages || []) {
            const info = Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null;
            const item = {
                title: page?.title || "",
                url: info?.thumburl || info?.url || "",
                width: Number(info?.width || 0),
                height: Number(info?.height || 0),
                metadata: info?.extmetadata || {}
            };
            if (/^https:\/\//i.test(item.url)) results.set(item.title, item);
        }
        if (results.size >= COMMONS_SEARCH_LIMIT) break;
    }
    return [...results.values()];
}

async function findBetterArtwork(entry) {
    const reference = wikipediaReference(entry);
    const candidates = [];

    if (reference.title) {
        const files = await listPageImages(reference.title);
        const rankedFiles = files
            .map(fileTitle => ({ fileTitle, score: candidateScore(fileTitle, entry) }))
            .filter(item => item.score >= 38)
            .sort((a, b) => b.score - a.score)
            .slice(0, 16);

        if (rankedFiles.length) {
            const info = await imageInfo(rankedFiles.map(item => item.fileTitle));
            candidates.push(...rankCandidates(info, entry, "wikipedia-page-artwork", 80, false));
        }

        if (!entry.imageUrl || !candidates.length) {
            const lead = await pageLeadImage(reference.title);
            if (lead) candidates.push(lead);
        }
    }

    const bestPageCandidate = candidates
        .slice()
        .sort((a, b) => b.score - a.score)[0];
    const shouldSearchCommons = !entry.imageUrl || isTargetPromotion(entry) || !bestPageCandidate || bestPageCandidate.score < 150;
    if (shouldSearchCommons) {
        const commonsItems = await searchCommons(entry);
        candidates.push(...rankCandidates(commonsItems, entry, "wikimedia-commons-search", 84, true));
    }

    candidates.sort((a, b) => {
        const typeRank = { poster: 4, artwork: 3, "event-photo": 1 };
        const sourceRank = {
            "wikipedia-page-artwork": 3,
            "wikipedia-lead-image": 2,
            "wikimedia-commons-search": 1
        };
        return (typeRank[b.artworkType] - typeRank[a.artworkType]) ||
            (sourceRank[b.sourceType] - sourceRank[a.sourceType]) ||
            b.score - a.score ||
            (b.width * b.height) - (a.width * a.height);
    });

    const best = candidates[0] || null;
    if (!best) return null;

    if (entry.imageUrl && best.artworkType === "event-photo" && best.sourceType === "wikipedia-lead-image") return null;
    return best;
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

function clearEntryImage(entry) {
    delete entry.imageUrl;
    delete entry.imageAlt;
    delete entry.imageCredit;
    delete entry.imageFileTitle;
    delete entry.imageWidth;
    delete entry.imageHeight;
    delete entry.imageSourceType;
    delete entry.imageStrategyVersion;
}

function suspectStrategyFiveRecord(entry, record) {
    return Boolean(
        record &&
        Number(record.strategyVersion || 0) === 5 &&
        record.sourceType === "wikimedia-commons-search" &&
        !candidatePlausible(record.imageFileTitle || "", entry)
    );
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

const scrubbedKeys = new Set();
for (const entry of history.entries || []) {
    if (entry?.generatedBy !== "wikipedia-event-index" || !entry?.autoKey) continue;
    const record = cache.entries[entry.autoKey];
    if (!suspectStrategyFiveRecord(entry, record)) continue;
    clearEntryImage(entry);
    delete cache.entries[entry.autoKey];
    scrubbedKeys.add(entry.autoKey);
}

const eligible = (history.entries || [])
    .filter(entry => entry?.generatedBy === "wikipedia-event-index" && entry?.autoKey && wikipediaReference(entry).title)
    .filter(entry => needsReview(cache.entries[entry.autoKey]))
    .sort((a, b) => {
        const scrubDifference = Number(!scrubbedKeys.has(a.autoKey)) - Number(!scrubbedKeys.has(b.autoKey));
        if (scrubDifference) return scrubDifference;
        const dateDifference = cyclicDistance(a) - cyclicDistance(b);
        if (dateDifference) return dateDifference;
        const imageDifference = Number(Boolean(a.imageUrl)) - Number(Boolean(b.imageUrl));
        if (imageDifference) return imageDifference;
        const targetDifference = Number(!isTargetPromotion(a)) - Number(!isTargetPromotion(b));
        if (targetDifference) return targetDifference;
        return Number(b.weight || 0) - Number(a.weight || 0);
    })
    .slice(0, ENRICH_LIMIT);

let improved = 0;
let commonsImproved = 0;
let leadImproved = 0;
let kept = 0;
let failed = 0;
let cursor = 0;
const nowIso = new Date().toISOString();

async function processEntry(entry) {
    try {
        const artwork = await findBetterArtwork(entry);
        if (artwork) {
            const fromCommons = artwork.sourceType === "wikimedia-commons-search";
            const fromLead = artwork.sourceType === "wikipedia-lead-image";
            const status = fromCommons ? "commons-event-image" : fromLead ? "lead-image" : "poster-candidate";
            const credit = fromCommons ? commonsCredit(artwork.metadata) : "Wikipedia";
            cache.entries[entry.autoKey] = {
                strategyVersion: STRATEGY_VERSION,
                status,
                sourceType: artwork.sourceType,
                artworkType: artwork.artworkType,
                checkedAt: nowIso,
                wikipediaTitle: wikipediaTitle(entry),
                imageUrl: artwork.url,
                imageAlt: `${eventName(entry)} event ${artwork.artworkType === "poster" ? "poster" : "image"}`,
                imageCredit: credit,
                imageFileTitle: artwork.title,
                width: artwork.width,
                height: artwork.height,
                score: artwork.score
            };
            improved += 1;
            if (fromCommons) commonsImproved += 1;
            if (fromLead) leadImproved += 1;
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
        await new Promise(resolve => setTimeout(resolve, 80));
    }
}

const workerCount = Math.min(CONCURRENCY, Math.max(eligible.length, 1));
await Promise.all(Array.from({ length: workerCount }, () => worker()));

const applied = applyCache(history, cache);
cache.version = Math.max(Number(cache.version || 1), 3);
cache.strategyVersion = STRATEGY_VERSION;
if (eligible.length || scrubbedKeys.size) cache.updatedAt = nowIso;

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");

const generated = (history.entries || []).filter(entry => entry?.generatedBy === "wikipedia-event-index");
const withImages = generated.filter(entry => entry?.imageUrl).length;
const targetedReviewed = eligible.filter(isTargetPromotion).length;
console.log(`On This Day image enrichment: scrubbed ${scrubbedKeys.size} weak strategy-5 matches; ${eligible.length} reviewed (${targetedReviewed} targeted) with ${workerCount} workers; ${improved} improved (${commonsImproved} Commons, ${leadImproved} Wikipedia lead), ${kept} kept, ${failed} failed.`);
console.log(`Image cache applied to ${applied} generated entries. Generated image coverage now ${withImages}/${generated.length}.`);
