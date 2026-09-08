import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const CACHE_PATH = process.argv[3] || "assets/data/on-this-day-image-cache.json";
const VERIFY_LIMIT = Math.max(1, Number(process.env.OTD_IMAGE_VERIFY_LIMIT || 100));
const USER_AGENT = "MMA-Matlock-OnThisDay-Image-Verify/1.0 (+https://mmamatlock.com/on-this-day/)";
const REQUEST_TIMEOUT_MS = 20000;
const REQUEST_ATTEMPTS = 3;
const THUMB_WIDTH = 1200;
const STRATEGY_VERSION = 6;

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const normalized = value => clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const words = value => normalized(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);

const STOP_WORDS = new Set([
    "the", "and", "with", "from", "into", "versus", "took", "place",
    "ufc", "mma", "fight", "night", "champion", "champions", "championship",
    "championships", "fighting", "event", "live", "final", "finals", "ultimate"
]);

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
            if (attempt < REQUEST_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, 700 * attempt));
            }
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

function eventName(entry) {
    return clean(String(entry?.title || "").replace(/\s+took place$/i, ""));
}

function numberedEvent(entry) {
    return normalized(eventName(entry)).match(
        /\b(?:ufc|wec|bellator|pfl|rizin|one|pride|pancrase)\s*(?:fight\s*night\s*)?(\d{1,4})\b/i
    )?.[1] || "";
}

function meaningfulTokens(entry) {
    return [...new Set(
        words(eventName(entry)).filter(token =>
            token.length >= 3 &&
            /[a-z]/.test(token) &&
            !STOP_WORDS.has(token)
        )
    )].slice(0, 14);
}

function candidateEvidence(fileTitle, entry) {
    const filename = normalized(String(fileTitle || "").replace(/^File:/i, ""));
    const filenameWordsList = words(filename.replace(/\.(?:jpe?g|png|webp|gif|tiff?)$/i, ""));
    const filenameWords = new Set(filenameWordsList);
    const promotion = promotionKey(entry?.promotion);
    const eventNumber = numberedEvent(entry);
    const tokenMatches = meaningfulTokens(entry).filter(token => filenameWords.has(token));
    const posterish = /\bposter\b|promotional|\bpromo\b|fight[ _-]?card|event[ _-]?card|official[ _-]?art|key[ _-]?art/i.test(filename);
    const promotionMatch = Boolean(promotion && filenameWords.has(promotion));
    const numberMatch = Boolean(eventNumber && filenameWords.has(eventNumber));
    const allowedKeyWords = new Set([
        promotion,
        eventNumber,
        "poster",
        "promo",
        "promotional",
        "official",
        "art",
        "card",
        "event",
        "fight",
        "image"
    ].filter(Boolean));
    const eventKeyOnly = Boolean(
        promotionMatch &&
        numberMatch &&
        filenameWordsList.length &&
        filenameWordsList.every(word => allowedKeyWords.has(word))
    );

    return {
        filename,
        tokenMatches,
        posterish,
        promotionMatch,
        numberMatch,
        eventKeyOnly
    };
}

function candidatePlausible(fileTitle, entry) {
    const evidence = candidateEvidence(fileTitle, entry);
    if (evidence.eventKeyOnly) return true;
    if (evidence.posterish && evidence.promotionMatch && (evidence.numberMatch || evidence.tokenMatches.length >= 1)) return true;
    if (evidence.promotionMatch && evidence.tokenMatches.length >= 2) return true;
    if (evidence.promotionMatch && evidence.numberMatch && evidence.tokenMatches.length >= 1) return true;
    return false;
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
        if (!fragment && url.hash) {
            fragment = decodeURIComponent(url.hash.replace(/^#/, "")).replace(/_/g, " ");
        }
    } catch {
        // Keep any title already recovered from the entry.
    }

    return {
        title: clean(title.replace(/_/g, " ")),
        fragment: clean(fragment.replace(/_/g, " "))
    };
}

function referenceIsEventSpecific(entry, reference) {
    const promotion = promotionKey(entry?.promotion);
    const eventNumber = numberedEvent(entry);
    if (!promotion || !eventNumber || !reference?.title) return false;
    const referenceWords = new Set(words(reference.title));
    return referenceWords.has(promotion) && referenceWords.has(eventNumber);
}

function mmddOrdinal(value) {
    const match = /^(\d{2})-(\d{2})$/.exec(String(value || "").slice(-5));
    if (!match) return 999;
    const date = new Date(Date.UTC(2024, Number(match[1]) - 1, Number(match[2])));
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

function currentFileTitle(entry, cacheRecord) {
    return clean(entry?.imageFileTitle || cacheRecord?.imageFileTitle || "");
}

function needsRepair(entry, cacheRecord) {
    if (!entry?.imageUrl) return true;
    const sourceType = entry?.imageSourceType || cacheRecord?.sourceType || "";
    if (sourceType === "wikipedia-lead-image") return false;
    const fileTitle = currentFileTitle(entry, cacheRecord);
    if (!fileTitle) return false;
    return !candidatePlausible(fileTitle, entry);
}

async function pageLeadImage(title) {
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
        imageUrl: source,
        imageFileTitle: page?.pageimage ? `File:${page.pageimage}` : "",
        width: Number(page?.thumbnail?.width || 0),
        height: Number(page?.thumbnail?.height || 0)
    };
}

function selfTest() {
    const entry = {
        title: "UFC 228: Woodley vs. Till",
        promotion: "UFC",
        wikipediaTitle: "UFC 228"
    };
    const checks = [
        [candidatePlausible("File:UFC_228.jpg", entry), true, "event-key poster filename"],
        [candidatePlausible("File:UFC 228 poster.jpg", entry), true, "explicit poster filename"],
        [candidatePlausible("File:UFC 228 Woodley Till.jpg", entry), true, "headliner filename"],
        [candidatePlausible("File:Alijamain Sterling at UFC 228.jpg", entry), false, "unrelated fighter image"],
        [candidatePlausible("File:Geoff Neal at UFC 228.jpg", entry), false, "undercard fighter image"],
        [referenceIsEventSpecific(entry, wikipediaReference(entry)), true, "event-specific Wikipedia page"]
    ];
    const failed = checks.filter(([actual, expected]) => actual !== expected);
    if (failed.length) {
        for (const [, , label] of failed) console.error(`Self-test failed: ${label}`);
        process.exit(1);
    }
    console.log("On This Day event-image verifier self-test passed.");
}

if (process.argv.includes("--self-test")) {
    selfTest();
    process.exit(0);
}

const history = await readJson(HISTORY_PATH, { entries: [] });
const cache = await readJson(CACHE_PATH, { version: 1, entries: {} });
if (!cache.entries || typeof cache.entries !== "object" || Array.isArray(cache.entries)) {
    cache.entries = {};
}

const eligible = (history.entries || [])
    .filter(entry => entry?.generatedBy === "wikipedia-event-index" && entry?.autoKey)
    .map(entry => ({ entry, reference: wikipediaReference(entry), cacheRecord: cache.entries[entry.autoKey] }))
    .filter(item => referenceIsEventSpecific(item.entry, item.reference))
    .filter(item => needsRepair(item.entry, item.cacheRecord))
    .sort((a, b) =>
        cyclicDistance(a.entry) - cyclicDistance(b.entry) ||
        Number(Boolean(a.entry.imageUrl)) - Number(Boolean(b.entry.imageUrl)) ||
        Number(b.entry.weight || 0) - Number(a.entry.weight || 0)
    )
    .slice(0, VERIFY_LIMIT);

let repaired = 0;
let missingLead = 0;
let failed = 0;
const nowIso = new Date().toISOString();

for (const { entry, reference, cacheRecord } of eligible) {
    try {
        const lead = await pageLeadImage(reference.title);
        if (!lead?.imageUrl) {
            missingLead += 1;
            continue;
        }

        entry.imageUrl = lead.imageUrl;
        entry.imageAlt = `${eventName(entry)} event poster`;
        entry.imageCredit = "Wikipedia";
        entry.imageSourceType = "wikipedia-lead-image";
        entry.imageStrategyVersion = STRATEGY_VERSION;
        if (lead.imageFileTitle) entry.imageFileTitle = lead.imageFileTitle;
        else delete entry.imageFileTitle;
        if (lead.width) entry.imageWidth = lead.width;
        else delete entry.imageWidth;
        if (lead.height) entry.imageHeight = lead.height;
        else delete entry.imageHeight;

        cache.entries[entry.autoKey] = {
            ...(cacheRecord || {}),
            strategyVersion: STRATEGY_VERSION,
            status: "lead-image",
            sourceType: "wikipedia-lead-image",
            checkedAt: nowIso,
            wikipediaTitle: reference.fragment ? `${reference.title}#${reference.fragment}` : reference.title,
            imageUrl: lead.imageUrl,
            imageAlt: entry.imageAlt,
            imageCredit: "Wikipedia",
            ...(lead.imageFileTitle ? { imageFileTitle: lead.imageFileTitle } : {}),
            ...(lead.width ? { width: lead.width } : {}),
            ...(lead.height ? { height: lead.height } : {})
        };
        repaired += 1;
    } catch (error) {
        failed += 1;
        console.warn(`${entry.title}: ${clean(error?.message || error).slice(0, 160)}`);
    }

    await new Promise(resolve => setTimeout(resolve, 90));
}

if (repaired) {
    cache.updatedAt = nowIso;
    await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
    await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

console.log(`On This Day event-image verification: ${eligible.length} checked, ${repaired} repaired with Wikipedia lead artwork, ${missingLead} without a lead image, ${failed} failed.`);
