import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const CACHE_PATH = process.argv[3] || "assets/data/on-this-day-content-cache.json";
const USER_AGENT = "MMA-Matlock-OnThisDay-Content/1.1 (+https://matlockfighttalk.com/on-this-day/)";
const REQUEST_TIMEOUT_MS = 20000;
const REQUEST_ATTEMPTS = 3;
const ENRICH_LIMIT = Math.max(1, Number(process.env.OTD_CONTENT_ENRICH_LIMIT || 160));
const CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.OTD_CONTENT_CONCURRENCY || 4)));
const CONTENT_STRATEGY_VERSION = 1;
const FAILED_RECHECK_DAYS = 30;
const EMPTY_RECHECK_DAYS = 180;

const TARGET_PROMOTIONS = new Set(
    String(process.env.OTD_TARGET_PROMOTIONS || "pancrase,bellator,rizin,pride")
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

function promotionKey(value) {
    const text = normalized(value);
    if (text.includes("pancrase")) return "pancrase";
    if (text.includes("bellator")) return "bellator";
    if (text.includes("rizin")) return "rizin";
    if (text.includes("pride")) return "pride";
    if (text.includes("ultimate fighting") || text === "ufc") return "ufc";
    if (text.includes("strikeforce")) return "strikeforce";
    if (text.includes("world extreme cagefighting") || text === "wec") return "wec";
    if (text.includes("professional fighters league") || text.includes("pfl")) return "pfl";
    return text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
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
        // Keep whatever was already recovered from wikipediaTitle.
    }

    return {
        title: clean(title.replace(/_/g, " ")),
        fragment: clean(fragment.replace(/_/g, " "))
    };
}

function recordAgeDays(record) {
    const checked = Date.parse(record?.checkedAt || "");
    if (!Number.isFinite(checked)) return Infinity;
    return (Date.now() - checked) / 86400000;
}

function needsReview(record) {
    if (!record || Number(record.strategyVersion || 0) < CONTENT_STRATEGY_VERSION) return true;
    const age = recordAgeDays(record);
    if (record.status === "main-event-found") return false;
    if (record.status === "no-main-event") return age >= EMPTY_RECHECK_DAYS;
    return age >= FAILED_RECHECK_DAYS;
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

const sectionsCache = new Map();

async function sectionIndexFor(title, fragment) {
    if (!fragment) return "";
    const key = normalized(title);
    let sections = sectionsCache.get(key);
    if (!sections) {
        const url = new URL("https://en.wikipedia.org/w/api.php");
        url.searchParams.set("action", "parse");
        url.searchParams.set("format", "json");
        url.searchParams.set("formatversion", "2");
        url.searchParams.set("redirects", "1");
        url.searchParams.set("prop", "sections");
        url.searchParams.set("page", title);
        const data = await requestJson(url);
        sections = Array.isArray(data?.parse?.sections) ? data.parse.sections : [];
        sectionsCache.set(key, sections);
    }

    const target = normalized(fragment).replace(/[^a-z0-9]+/g, " ").trim();
    const match = sections.find(section => {
        const anchor = normalized(section?.anchor).replace(/[^a-z0-9]+/g, " ").trim();
        const line = normalized(section?.line).replace(/[^a-z0-9]+/g, " ").trim();
        return anchor === target || line === target;
    });
    return match?.index || "";
}

async function fetchWikitext(title, fragment) {
    const section = await sectionIndexFor(title, fragment);
    if (fragment && !section) return "";
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "parse");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("prop", "wikitext");
    url.searchParams.set("page", title);
    if (section) url.searchParams.set("section", section);
    const data = await requestJson(url);
    return String(data?.parse?.wikitext || "");
}

function stripTemplates(value) {
    let output = String(value || "");
    for (let pass = 0; pass < 4; pass += 1) {
        const next = output.replace(/\{\{[^{}]*\}\}/g, " ");
        if (next === output) break;
        output = next;
    }
    return output;
}

function cleanWikiValue(value) {
    let output = String(value || "")
        .replace(/<!--[^]*?-->/g, " ")
        .replace(/<ref\b[^>]*>[^]*?<\/ref>/gi, " ")
        .replace(/<ref\b[^>]*\/>/gi, " ")
        .replace(/<br\s*\/?\s*>/gi, " vs. ")
        .replace(/&nbsp;|&#160;/gi, " ");

    output = stripTemplates(output)
        .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
        .replace(/\[\[([^\]]+)\]\]/g, "$1")
        .replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, "$1")
        .replace(/'''?/g, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s*\|\s*/g, " ")
        .replace(/\s+([,.;:!?])/g, "$1");

    output = clean(output);
    if (!output || output.length < 5 || output.length > 180) return "";
    if (/\{\{|\}\}|\[\[|\]\]/.test(output)) return "";
    return output;
}

function extractField(wikitext, names) {
    for (const name of names) {
        const pattern = new RegExp(`^\\|\\s*${name}\\s*=\\s*(.+)$`, "im");
        const match = pattern.exec(wikitext);
        if (!match) continue;
        const value = cleanWikiValue(match[1]);
        if (value) return value;
    }
    return "";
}

function matchupFromTitle(entry) {
    const name = clean(String(entry?.title || "").replace(/\s+took place$/i, ""));
    const colon = name.indexOf(":");
    if (colon < 0) return "";
    const subtitle = clean(name.slice(colon + 1));
    if (!/\b(?:vs\.?|versus)\b/i.test(subtitle)) return "";
    return subtitle.replace(/\bversus\b/gi, "vs.").replace(/\bvs\b(?!\.)/gi, "vs.");
}

async function findMainEvent(entry) {
    const fromTitle = matchupFromTitle(entry);
    if (fromTitle) return { mainEvent: fromTitle, sourceType: "event-title" };

    const reference = wikipediaReference(entry);
    if (!reference.title) return null;
    const wikitext = await fetchWikitext(reference.title, reference.fragment);
    if (!wikitext) return null;

    const mainEvent = extractField(wikitext, [
        "main_event",
        "main event",
        "mainevent",
        "main_bout",
        "main bout"
    ]);
    if (!mainEvent) return null;
    return { mainEvent, sourceType: "wikipedia-structured" };
}

function applyRecord(entry, record) {
    if (!record) return false;
    entry.contentStrategyVersion = Number(record.strategyVersion || CONTENT_STRATEGY_VERSION);
    entry.contentCheckedAt = record.checkedAt || "";
    entry.contentStatus = record.status || "";
    entry.contentSourceType = record.sourceType || "";
    if (record.mainEvent) entry.mainEvent = record.mainEvent;
    else delete entry.mainEvent;
    if (record.error) entry.contentError = record.error;
    else delete entry.contentError;
    return Boolean(record.mainEvent);
}

const history = await readJson(HISTORY_PATH, { entries: [] });
const cache = await readJson(CACHE_PATH, { version: 1, strategyVersion: CONTENT_STRATEGY_VERSION, updatedAt: null, entries: {} });
if (!cache.entries || typeof cache.entries !== "object" || Array.isArray(cache.entries)) cache.entries = {};

const generatedTargets = (history.entries || [])
    .filter(entry => entry?.generatedBy === "wikipedia-event-index" && entry?.autoKey)
    .filter(entry => TARGET_PROMOTIONS.has(promotionKey(entry?.promotion)));

let applied = 0;
for (const entry of generatedTargets) {
    if (applyRecord(entry, cache.entries[entry.autoKey])) applied += 1;
}

const eligible = generatedTargets
    .filter(entry => wikipediaReference(entry).title || matchupFromTitle(entry))
    .filter(entry => needsReview(cache.entries[entry.autoKey]))
    .sort((a, b) => {
        const titleMatch = Number(Boolean(matchupFromTitle(b))) - Number(Boolean(matchupFromTitle(a)));
        if (titleMatch) return titleMatch;
        const cachedMain = Number(Boolean(cache.entries[a.autoKey]?.mainEvent)) - Number(Boolean(cache.entries[b.autoKey]?.mainEvent));
        if (cachedMain) return cachedMain;
        return Number(b.weight || 0) - Number(a.weight || 0) || String(a.date || "").localeCompare(String(b.date || ""));
    })
    .slice(0, ENRICH_LIMIT);

let found = 0;
let empty = 0;
let failed = 0;
let cursor = 0;
const checkedAt = new Date().toISOString();

async function processEntry(entry) {
    try {
        const result = await findMainEvent(entry);
        cache.entries[entry.autoKey] = {
            strategyVersion: CONTENT_STRATEGY_VERSION,
            checkedAt,
            status: result?.mainEvent ? "main-event-found" : "no-main-event",
            sourceType: result?.sourceType || "wikipedia-structured",
            wikipediaTitle: wikipediaReference(entry).title,
            ...(result?.mainEvent ? { mainEvent: result.mainEvent } : {})
        };
        if (result?.mainEvent) found += 1;
        else empty += 1;
    } catch (error) {
        cache.entries[entry.autoKey] = {
            strategyVersion: CONTENT_STRATEGY_VERSION,
            checkedAt,
            status: "check-failed",
            sourceType: "wikipedia-structured",
            wikipediaTitle: wikipediaReference(entry).title,
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
        await new Promise(resolve => setTimeout(resolve, 60));
    }
}

const workerCount = Math.min(CONCURRENCY, Math.max(eligible.length, 1));
await Promise.all(Array.from({ length: workerCount }, () => worker()));

for (const entry of generatedTargets) applyRecord(entry, cache.entries[entry.autoKey]);
cache.version = Math.max(Number(cache.version || 1), 1);
cache.strategyVersion = CONTENT_STRATEGY_VERSION;
if (eligible.length) cache.updatedAt = checkedAt;
history.contentEnrichmentVersion = CONTENT_STRATEGY_VERSION;
history.contentEnrichmentUpdatedAt = cache.updatedAt;

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, "utf8");

console.log(`On This Day targeted content enrichment: ${eligible.length} reviewed across ${[...TARGET_PROMOTIONS].join(", ")}; ${found} main events found, ${empty} without structured main-event data, ${failed} checks failed.`);
console.log(`Content cache applied ${applied} existing main-event records before review; ${generatedTargets.filter(entry => entry.mainEvent).length}/${generatedTargets.length} targeted events now carry main-event context.`);
