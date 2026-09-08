import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const CONTENT_CACHE_PATH = process.argv[3] || "assets/data/on-this-day-content-cache.json";
const IMAGE_CACHE_PATH = process.argv[4] || "assets/data/on-this-day-image-cache.json";
const PANCRASE_CACHE_PATH = process.argv[5] || "assets/data/on-this-day-pancrase-cache.json";

const USER_AGENT = "MMA-Matlock-OnThisDay-Pancrase/1.0 (+https://mmamatlock.com/on-this-day/)";
const REQUEST_TIMEOUT_MS = 20000;
const REQUEST_ATTEMPTS = 3;
const ENRICH_LIMIT = Math.max(1, Number(process.env.OTD_PANCRASE_ENRICH_LIMIT || 24));
const CONTENT_STRATEGY_VERSION = 2;
const IMAGE_STRATEGY_VERSION = 4;
const PANCRASE_STRATEGY_VERSION = 1;
const MISS_RECHECK_DAYS = 365;
const FIGHTER_RECHECK_DAYS = 365;
const COMMONS_SEARCH_LIMIT = 12;
const THUMB_WIDTH = 1200;

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const normalized = value => clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readJson(path, fallback) {
    try {
        return JSON.parse(await fs.readFile(path, "utf8"));
    } catch (error) {
        if (error?.code === "ENOENT") return fallback;
        throw error;
    }
}

function recordAgeDays(record) {
    const checked = Date.parse(record?.checkedAt || "");
    if (!Number.isFinite(checked)) return Infinity;
    return (Date.now() - checked) / 86400000;
}

async function requestJson(url) {
    let lastError;
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, {
                redirect: "follow",
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { "user-agent": USER_AGENT, accept: "application/json" }
            });
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            return await response.json();
        } catch (error) {
            lastError = error;
            if (attempt < REQUEST_ATTEMPTS) await sleep(900 * attempt);
        }
    }
    throw lastError || new Error(`Request failed: ${url}`);
}

function sniffCharset(bytes, contentType) {
    const header = /charset\s*=\s*["']?([^;"'\s]+)/i.exec(contentType || "")?.[1] || "";
    if (header) return header;
    const prefix = new TextDecoder("latin1").decode(bytes.slice(0, 4096));
    return /charset\s*=\s*["']?([^;"'\s/>]+)/i.exec(prefix)?.[1] || "utf-8";
}

function charsetLabel(value) {
    const label = String(value || "").toLowerCase().replace(/[_\s]+/g, "-");
    if (/shift-?jis|sjis|windows-31j|ms932/.test(label)) return "shift_jis";
    if (/euc-?jp/.test(label)) return "euc-jp";
    return "utf-8";
}

async function requestHtml(url) {
    let lastError;
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, {
                redirect: "follow",
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" }
            });
            if (response.status === 404) return "";
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            const charset = charsetLabel(sniffCharset(bytes, response.headers.get("content-type")));
            return new TextDecoder(charset).decode(bytes);
        } catch (error) {
            lastError = error;
            if (attempt < REQUEST_ATTEMPTS) await sleep(700 * attempt);
        }
    }
    throw lastError || new Error(`Request failed: ${url}`);
}

function decodeHtml(value) {
    const named = new Map([
        ["nbsp", " "], ["amp", "&"], ["quot", "\""], ["apos", "'"],
        ["lt", "<"], ["gt", ">"], ["ndash", "–"], ["mdash", "—"]
    ]);
    return String(value || "")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&([a-z]+);/gi, (match, name) => named.get(name.toLowerCase()) ?? match);
}

function stripHtml(value) {
    return clean(decodeHtml(String(value || "")
        .replace(/<br\s*\/?\s*>/gi, " ")
        .replace(/<[^>]+>/g, " ")));
}

function pancraseResultUrl(entry) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(entry?.date || ""));
    if (!match) return "";
    return `https://www.pancrase.co.jp/data/result/${match[1]}/${match[2]}${match[3]}.html`;
}

function mainEventSegment(html) {
    const text = String(html || "");
    const start = text.search(/メインイベント|main\s*event/i);
    if (start < 0) return "";
    const tail = text.slice(start, start + 24000);
    const afterLead = tail.slice(120);
    const stop = afterLead.search(/セミファイナル|semi\s*final|第\s*(?:\d+|[一二三四五六七八九十]+)\s*試合/i);
    return stop >= 0 ? tail.slice(0, stop + 120) : tail;
}

function likelyFighterName(value) {
    const name = clean(decodeHtml(value).replace(/<[^>]+>/g, " "));
    if (name.length < 2 || name.length > 70) return "";
    if (!/[A-Za-z\u3040-\u30ff\u3400-\u9fff]/.test(name)) return "";
    if (/pancrase|パンクラス|logo|ロゴ|banner|バナー|main\s*event|メインイベント|ranking|ランキング|title|タイトル|belt|ベルト|spacer|arrow/i.test(name)) return "";
    return name.replace(/^[○×△◎●◇◆□■☆★\s]+|[○×△◎●◇◆□■☆★\s]+$/g, "").trim();
}

function fighterNamesFromOfficialPage(html) {
    const segment = mainEventSegment(html);
    if (!segment) return [];
    const names = [];
    for (const match of segment.matchAll(/<img\b[^>]*\balt\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
        const name = likelyFighterName(match[1]);
        if (!name || names.includes(name)) continue;
        names.push(name);
        if (names.length === 2) return names;
    }
    return names;
}

function fighterRecordFresh(record) {
    return record && recordAgeDays(record) < FIGHTER_RECHECK_DAYS;
}

async function resolveEnglishName(name, fighterCache, checkedAt) {
    const key = normalized(name);
    const existing = fighterCache[key];
    if (fighterRecordFresh(existing)) return existing.englishName || name;

    if (/^[\x00-\x7F\s.'’-]+$/.test(name)) {
        fighterCache[key] = { checkedAt, status: "latin-name", englishName: name };
        return name;
    }

    try {
        const searchUrl = new URL("https://www.wikidata.org/w/api.php");
        searchUrl.searchParams.set("action", "wbsearchentities");
        searchUrl.searchParams.set("format", "json");
        searchUrl.searchParams.set("language", "ja");
        searchUrl.searchParams.set("uselang", "en");
        searchUrl.searchParams.set("type", "item");
        searchUrl.searchParams.set("limit", "5");
        searchUrl.searchParams.set("search", name);
        const searchData = await requestJson(searchUrl);
        const results = Array.isArray(searchData?.search) ? searchData.search : [];
        const candidate = results.find(item => /fighter|mixed martial|martial artist|wrestler|kickbox|boxer|grappler/i.test(item?.description || item?.display?.description?.value || "")) || results[0];
        if (!candidate?.id) throw new Error("No Wikidata match");

        await sleep(140);
        const entityUrl = new URL("https://www.wikidata.org/w/api.php");
        entityUrl.searchParams.set("action", "wbgetentities");
        entityUrl.searchParams.set("format", "json");
        entityUrl.searchParams.set("ids", candidate.id);
        entityUrl.searchParams.set("props", "labels|sitelinks");
        entityUrl.searchParams.set("languages", "en");
        entityUrl.searchParams.set("sitefilter", "enwiki");
        const entityData = await requestJson(entityUrl);
        const entity = entityData?.entities?.[candidate.id] || {};
        const englishName = clean(entity?.sitelinks?.enwiki?.title || entity?.labels?.en?.value || candidate?.label || "");
        fighterCache[key] = { checkedAt, status: englishName ? "resolved" : "unresolved", wikidataId: candidate.id, ...(englishName ? { englishName } : {}) };
        return englishName || name;
    } catch (error) {
        fighterCache[key] = { checkedAt, status: "unresolved", error: clean(error?.message || error).slice(0, 140) };
        return name;
    }
}

function commonsCredit(metadata) {
    const artist = stripHtml(metadata?.Artist?.value || metadata?.Credit?.value || "").slice(0, 70);
    const license = stripHtml(metadata?.LicenseShortName?.value || "").slice(0, 40);
    const parts = ["Wikimedia Commons"];
    if (artist && !/unknown|wikimedia commons/i.test(artist)) parts.push(artist);
    if (license) parts.push(license);
    return parts.join(" · ");
}

function fighterImageScore(item, fighterName) {
    const filename = normalized(String(item?.title || "").replace(/^File:/i, ""));
    if (!filename || /\.svg(?:$|\?)/i.test(filename)) return -1000;
    const width = Number(item?.width || 0);
    const height = Number(item?.height || 0);
    if (width < 320 || height < 260) return -1000;
    const ratio = width / height;
    if (ratio < 0.38 || ratio > 2.4) return -1000;

    const target = normalized(fighterName).replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ").trim();
    const tokens = target.split(" ").filter(token => token.length >= 2);
    let score = 0;
    if (target && filename.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ").includes(target)) score += 95;
    for (const token of tokens) if (filename.includes(token)) score += 22;
    if (tokens.length >= 2 && tokens.every(token => filename.includes(token))) score += 28;
    if (ratio >= 0.5 && ratio <= 1.15) score += 18;
    else if (ratio <= 1.6) score += 8;
    if (/portrait|headshot|weigh|press|fight|mma/i.test(filename)) score += 7;
    if (/logo|banner|poster|program|programme|card|arena|venue|belt|flag|map|icon/i.test(filename)) score -= 55;
    return score;
}

async function searchCommonsForFighter(fighterName) {
    if (!fighterName) return null;
    const queries = [`intitle:\"${fighterName.replace(/[\"<>]/g, " ")}\"`, fighterName].filter(Boolean);
    const candidates = new Map();

    for (const query of queries) {
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
            if (/^https:\/\//i.test(item.url)) candidates.set(item.title, item);
        }
        if (candidates.size) break;
        await sleep(140);
    }

    return [...candidates.values()]
        .map(item => ({ ...item, score: fighterImageScore(item, fighterName) }))
        .filter(item => item.score >= 78)
        .sort((a, b) => b.score - a.score || (b.width * b.height) - (a.width * a.height))[0] || null;
}

async function bestHeadlinerImage(names) {
    for (const name of names) {
        const candidate = await searchCommonsForFighter(name);
        if (candidate) return { ...candidate, fighterName: name };
        await sleep(160);
    }
    return null;
}

function pancraseRecordFresh(record) {
    if (!record) return false;
    if (record.strategyVersion !== PANCRASE_STRATEGY_VERSION) return false;
    if (record.status === "main-event-found") return true;
    return recordAgeDays(record) < MISS_RECHECK_DAYS;
}

const history = await readJson(HISTORY_PATH, { entries: [] });
const contentCache = await readJson(CONTENT_CACHE_PATH, { version: 1, entries: {} });
const imageCache = await readJson(IMAGE_CACHE_PATH, { version: 2, entries: {} });
const pancraseCache = await readJson(PANCRASE_CACHE_PATH, { version: 1, strategyVersion: PANCRASE_STRATEGY_VERSION, updatedAt: null, fighters: {}, entries: {} });
if (!contentCache.entries || typeof contentCache.entries !== "object") contentCache.entries = {};
if (!imageCache.entries || typeof imageCache.entries !== "object") imageCache.entries = {};
if (!pancraseCache.entries || typeof pancraseCache.entries !== "object") pancraseCache.entries = {};
if (!pancraseCache.fighters || typeof pancraseCache.fighters !== "object") pancraseCache.fighters = {};

const generated = (history.entries || []).filter(entry => entry?.generatedBy === "wikipedia-event-index" && /^pancrase$/i.test(clean(entry?.promotion)) && entry?.autoKey);
const eligible = generated
    .filter(entry => !pancraseRecordFresh(pancraseCache.entries[entry.autoKey]?.content))
    .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0) || String(a.date || "").localeCompare(String(b.date || "")))
    .slice(0, ENRICH_LIMIT);

let found = 0;
let translated = 0;
let imageFound = 0;
let missingPage = 0;
let noMainEvent = 0;
let failed = 0;
const checkedAt = new Date().toISOString();

for (const entry of eligible) {
    const url = pancraseResultUrl(entry);
    const state = pancraseCache.entries[entry.autoKey] || {};
    try {
        const html = await requestHtml(url);
        if (!html) {
            state.content = { strategyVersion: PANCRASE_STRATEGY_VERSION, checkedAt, status: "official-page-missing", sourceUrl: url };
            missingPage += 1;
            pancraseCache.entries[entry.autoKey] = state;
            await sleep(120);
            continue;
        }

        const rawNames = fighterNamesFromOfficialPage(html);
        if (rawNames.length < 2) {
            state.content = { strategyVersion: PANCRASE_STRATEGY_VERSION, checkedAt, status: "no-main-event", sourceUrl: url };
            noMainEvent += 1;
            pancraseCache.entries[entry.autoKey] = state;
            await sleep(120);
            continue;
        }

        const englishNames = [];
        for (const rawName of rawNames.slice(0, 2)) {
            const englishName = await resolveEnglishName(rawName, pancraseCache.fighters, checkedAt);
            if (englishName !== rawName) translated += 1;
            englishNames.push(englishName);
            await sleep(120);
        }
        const mainEvent = `${englishNames[0]} vs. ${englishNames[1]}`;
        entry.mainEvent = mainEvent;
        entry.contentStrategyVersion = CONTENT_STRATEGY_VERSION;
        entry.contentCheckedAt = checkedAt;
        entry.contentStatus = "main-event-found";
        entry.contentSourceType = "pancrase-official";
        entry.contentSourceUrl = url;
        contentCache.entries[entry.autoKey] = {
            strategyVersion: CONTENT_STRATEGY_VERSION,
            checkedAt,
            status: "main-event-found",
            sourceType: "pancrase-official",
            wikipediaTitle: clean(entry?.wikipediaTitle || ""),
            sourceUrl: url,
            mainEvent
        };
        state.content = { strategyVersion: PANCRASE_STRATEGY_VERSION, checkedAt, status: "main-event-found", sourceUrl: url, rawNames, englishNames, mainEvent };
        found += 1;

        if (!entry.imageUrl && !pancraseRecordFresh(state.image)) {
            const artwork = await bestHeadlinerImage(englishNames);
            if (artwork) {
                const imageCredit = commonsCredit(artwork.metadata);
                const imageAlt = `${englishNames.join(" vs. ")} headliner photo`;
                entry.imageUrl = artwork.url;
                entry.imageAlt = imageAlt;
                entry.imageCredit = imageCredit;
                entry.imageSourceType = "wikimedia-commons-headliner";
                entry.imageFileTitle = artwork.title;
                entry.imageWidth = artwork.width;
                entry.imageHeight = artwork.height;
                imageCache.entries[entry.autoKey] = {
                    strategyVersion: IMAGE_STRATEGY_VERSION,
                    status: "commons-headliner-image",
                    sourceType: "wikimedia-commons-headliner",
                    artworkType: "headliner-photo",
                    checkedAt,
                    wikipediaTitle: clean(entry?.wikipediaTitle || ""),
                    imageUrl: artwork.url,
                    imageAlt,
                    imageCredit,
                    imageFileTitle: artwork.title,
                    width: artwork.width,
                    height: artwork.height,
                    score: artwork.score
                };
                state.image = { strategyVersion: PANCRASE_STRATEGY_VERSION, checkedAt, status: "commons-headliner-image", fighterName: artwork.fighterName, imageFileTitle: artwork.title };
                imageFound += 1;
            } else {
                state.image = { strategyVersion: PANCRASE_STRATEGY_VERSION, checkedAt, status: "no-headliner-image" };
            }
        }

        pancraseCache.entries[entry.autoKey] = state;
    } catch (error) {
        state.content = {
            strategyVersion: PANCRASE_STRATEGY_VERSION,
            checkedAt,
            status: "check-failed",
            sourceUrl: url,
            error: clean(error?.message || error).slice(0, 180)
        };
        pancraseCache.entries[entry.autoKey] = state;
        failed += 1;
    }
    await sleep(180);
}

contentCache.version = Math.max(Number(contentCache.version || 1), 1);
contentCache.strategyVersion = Math.max(Number(contentCache.strategyVersion || 1), CONTENT_STRATEGY_VERSION);
if (eligible.length) contentCache.updatedAt = checkedAt;
imageCache.version = Math.max(Number(imageCache.version || 1), 2);
imageCache.strategyVersion = Math.max(Number(imageCache.strategyVersion || 1), IMAGE_STRATEGY_VERSION);
if (eligible.length) imageCache.updatedAt = checkedAt;
pancraseCache.version = Math.max(Number(pancraseCache.version || 1), 1);
pancraseCache.strategyVersion = PANCRASE_STRATEGY_VERSION;
if (eligible.length) pancraseCache.updatedAt = checkedAt;
history.pancraseEnrichmentVersion = PANCRASE_STRATEGY_VERSION;
history.pancraseEnrichmentUpdatedAt = pancraseCache.updatedAt;

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
await fs.writeFile(CONTENT_CACHE_PATH, `${JSON.stringify(contentCache, null, 2)}\n`, "utf8");
await fs.writeFile(IMAGE_CACHE_PATH, `${JSON.stringify(imageCache, null, 2)}\n`, "utf8");
await fs.writeFile(PANCRASE_CACHE_PATH, `${JSON.stringify(pancraseCache, null, 2)}\n`, "utf8");

console.log(`Pancrase official enrichment: ${eligible.length} reviewed; ${found} main events found, ${translated} fighter names translated, ${imageFound} Commons headliner images added, ${missingPage} official pages missing, ${noMainEvent} pages without a parsed main event, ${failed} checks failed.`);
console.log(`Pancrase main-event coverage is now ${generated.filter(entry => entry.mainEvent).length}/${generated.length}.`);
