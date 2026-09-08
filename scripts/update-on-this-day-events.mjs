import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const SOURCES_PATH = process.argv[3] || "assets/data/on-this-day-event-sources.json";
const USER_AGENT = "MMA-Matlock-OnThisDay/1.0 (+https://matlockfighttalk.com/on-this-day/)";
const GENERATED_BY = "wikipedia-event-index";
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 25000;
const IMAGE_BATCH_SIZE = 40;
const IMAGE_THUMB_WIDTH = 1200;

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const slug = value => clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "event";

async function readJson(path) {
    return JSON.parse(await fs.readFile(path, "utf8"));
}

async function requestJson(url) {
    let lastError;
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, {
                redirect: "follow",
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
                await new Promise(resolve => setTimeout(resolve, 800 * attempt));
            }
        }
    }
    throw lastError || new Error(`Request failed: ${url}`);
}

function decodeHtml(value) {
    const named = new Map([
        ["nbsp", " "],
        ["amp", "&"],
        ["quot", "\""],
        ["apos", "'"],
        ["lt", "<"],
        ["gt", ">"],
        ["ndash", "–"],
        ["mdash", "—"],
        ["rsquo", "’"],
        ["lsquo", "‘"],
        ["rdquo", "”"],
        ["ldquo", "“"]
    ]);

    return String(value || "")
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&([a-z]+);/gi, (match, name) => named.get(name.toLowerCase()) ?? match);
}

function textFromHtml(value) {
    return clean(decodeHtml(String(value || "")
        .replace(/<sup\b[\s\S]*?<\/sup>/gi, " ")
        .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
        .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
        .replace(/<br\s*\/?\s*>/gi, " ")
        .replace(/<[^>]+>/g, " ")));
}

function validDate(year, month, day) {
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
        year >= 1990 &&
        year <= new Date().getUTCFullYear() &&
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() === month - 1 &&
        parsed.getUTCDate() === day
    );
}

function isoDate(year, month, day) {
    if (!validDate(year, month, day)) return "";
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTHS = new Map([
    ["january", 1], ["jan", 1],
    ["february", 2], ["feb", 2],
    ["march", 3], ["mar", 3],
    ["april", 4], ["apr", 4],
    ["may", 5],
    ["june", 6], ["jun", 6],
    ["july", 7], ["jul", 7],
    ["august", 8], ["aug", 8],
    ["september", 9], ["sep", 9], ["sept", 9],
    ["october", 10], ["oct", 10],
    ["november", 11], ["nov", 11],
    ["december", 12], ["dec", 12]
]);

function dateFromCell(cellHtml) {
    const html = String(cellHtml || "");
    const text = textFromHtml(html);

    const machinePatterns = [
        /data-sort-value=["'][^"']*?(\d{4})-(\d{2})-(\d{2})/i,
        /datetime=["'](\d{4})-(\d{2})-(\d{2})/i,
        /\b(\d{4})-(\d{2})-(\d{2})\b/
    ];

    for (const pattern of machinePatterns) {
        const match = pattern.exec(html);
        if (!match) continue;
        const date = isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
        if (date) return date;
    }

    const monthFirst = new RegExp(`\\b(${[...MONTHS.keys()].join("|")})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(\\d{4})\\b`, "i").exec(text);
    if (monthFirst) {
        const date = isoDate(Number(monthFirst[3]), MONTHS.get(monthFirst[1].toLowerCase()), Number(monthFirst[2]));
        if (date) return date;
    }

    const dayFirst = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${[...MONTHS.keys()].join("|")})\\.?[,]?\\s+(\\d{4})\\b`, "i").exec(text);
    if (dayFirst) {
        const date = isoDate(Number(dayFirst[3]), MONTHS.get(dayFirst[2].toLowerCase()), Number(dayFirst[1]));
        if (date) return date;
    }

    return "";
}

function wikipediaPageUrl(page) {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(clean(page).replace(/ /g, "_"))}`;
}

function sourceLink(cellHtml, fallbackPage) {
    const match = /href=["']([^"']+)["']/i.exec(String(cellHtml || ""));
    if (!match) return wikipediaPageUrl(fallbackPage);

    const href = decodeHtml(match[1]);
    if (/^https:\/\/en\.wikipedia\.org\/wiki\//i.test(href)) return href;
    if (/^\/wiki\//i.test(href)) return `https://en.wikipedia.org${href}`;
    if (/^\.\//.test(href)) return `https://en.wikipedia.org/wiki/${href.slice(2)}`;
    return wikipediaPageUrl(fallbackPage);
}

function wikipediaTitleFromHref(href) {
    const decoded = decodeHtml(href);
    let path = "";

    if (/^https:\/\/en\.wikipedia\.org\/wiki\//i.test(decoded)) {
        try {
            path = new URL(decoded).pathname.replace(/^\/wiki\//i, "");
        } catch {
            return "";
        }
    } else if (/^\/wiki\//i.test(decoded)) {
        path = decoded.replace(/^\/wiki\//i, "");
    } else if (/^\.\//.test(decoded)) {
        path = decoded.slice(2);
    } else {
        return "";
    }

    try {
        return clean(decodeURIComponent(path).replace(/_/g, " "));
    } catch {
        return clean(path.replace(/_/g, " "));
    }
}

function wikipediaTitleFromCell(cellHtml) {
    for (const match of String(cellHtml || "").matchAll(/href=["']([^"']+)["']/gi)) {
        const title = wikipediaTitleFromHref(match[1]);
        if (title) return title;
    }
    return "";
}

function wikipediaTitleFromUrl(value) {
    try {
        const parsed = new URL(String(value || ""));
        if (parsed.hostname.toLowerCase() !== "en.wikipedia.org") return "";
        if (!/^\/wiki\//i.test(parsed.pathname)) return "";
        return wikipediaTitleFromHref(parsed.href);
    } catch {
        return "";
    }
}

function tableRows(html) {
    return String(html || "").match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
}

function cellsForRow(rowHtml) {
    return String(rowHtml || "").match(/<t[dh]\b[^>]*>[\s\S]*?<\/t[dh]>/gi) || [];
}

function conciseDetail(venue, location) {
    if (venue && location) return clean(`Held at ${venue} in ${location}.`).slice(0, 240);
    if (venue) return clean(`Held at ${venue}.`).slice(0, 240);
    if (location) return clean(`Held in ${location}.`).slice(0, 240);
    return "";
}

function looksLikeEventTitle(title) {
    if (!title || title.length < 3 || title.length > 150) return false;
    if (/^(event|date|venue|location|attendance|source|broadcast|#|no\.?|number)$/i.test(title)) return false;
    return /[a-z]/i.test(title);
}

function copyStoredImage(entry, stored) {
    if (!stored?.imageUrl) return false;
    entry.imageUrl = stored.imageUrl;
    entry.imageAlt = stored.imageAlt || `${entry.title.replace(/\s+took place$/i, "")} event image`;
    if (stored.imageCredit) entry.imageCredit = stored.imageCredit;
    if (stored.imagePosition) entry.imagePosition = stored.imagePosition;
    if (!entry.wikipediaTitle && stored.wikipediaTitle) entry.wikipediaTitle = stored.wikipediaTitle;
    return true;
}

function resolvedTitle(title, aliases) {
    let current = title;
    for (let index = 0; index < 6; index += 1) {
        const next = aliases.get(current);
        if (!next || next === current) break;
        current = next;
    }
    return current;
}

async function hydrateWikipediaImages(entries, previousEntries) {
    const previousByKey = new Map(
        previousEntries
            .filter(entry => entry?.generatedBy === GENERATED_BY && entry?.autoKey)
            .map(entry => [entry.autoKey, entry])
    );

    const pending = [];
    let reused = 0;

    for (const entry of entries) {
        if (copyStoredImage(entry, previousByKey.get(entry.autoKey))) {
            reused += 1;
            continue;
        }

        const wikipediaTitle = entry.wikipediaTitle || wikipediaTitleFromUrl(entry.sourceUrl);
        if (!wikipediaTitle) continue;
        entry.wikipediaTitle = wikipediaTitle;
        pending.push({ entry, title: wikipediaTitle });
    }

    let fetched = 0;
    for (let offset = 0; offset < pending.length; offset += IMAGE_BATCH_SIZE) {
        const batch = pending.slice(offset, offset + IMAGE_BATCH_SIZE);
        const url = new URL("https://en.wikipedia.org/w/api.php");
        url.searchParams.set("action", "query");
        url.searchParams.set("format", "json");
        url.searchParams.set("formatversion", "2");
        url.searchParams.set("redirects", "1");
        url.searchParams.set("prop", "pageimages");
        url.searchParams.set("piprop", "thumbnail|original|name");
        url.searchParams.set("pilicense", "any");
        url.searchParams.set("pithumbsize", String(IMAGE_THUMB_WIDTH));
        url.searchParams.set("titles", batch.map(item => item.title).join("|"));

        let data;
        try {
            data = await requestJson(url);
        } catch (error) {
            console.warn(`Wikipedia image batch ${Math.floor(offset / IMAGE_BATCH_SIZE) + 1} failed: ${error.message}`);
            continue;
        }

        const aliases = new Map();
        for (const item of data?.query?.normalized || []) aliases.set(item.from, item.to);
        for (const item of data?.query?.redirects || []) aliases.set(item.from, item.to);

        const pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];
        const pagesByTitle = new Map(pages.map(page => [clean(page?.title).toLowerCase(), page]));

        for (const item of batch) {
            const finalTitle = resolvedTitle(item.title, aliases);
            const page = pagesByTitle.get(clean(finalTitle).toLowerCase()) || pagesByTitle.get(clean(item.title).toLowerCase());
            const imageUrl = page?.thumbnail?.source || page?.original?.source || "";
            if (!/^https:\/\//i.test(imageUrl)) continue;

            item.entry.imageUrl = imageUrl;
            item.entry.imageAlt = `${item.entry.title.replace(/\s+took place$/i, "")} event image`;
            item.entry.imageCredit = "Wikipedia";
            fetched += 1;
        }
    }

    console.log(`On This Day images: ${reused} reused, ${fetched} fetched, ${entries.length - reused - fetched} without a Wikipedia image.`);
}

function eventRowsFromHtml(html, source) {
    const entries = [];
    const seen = new Set();
    const today = new Date();
    const todayIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;

    for (const row of tableRows(html)) {
        const rowText = textFromHtml(row);
        if (/\bcancell?ed\b/i.test(rowText)) continue;

        const cells = cellsForRow(row);
        if (cells.length < 3) continue;

        const eventCellIndex = Number.isInteger(source.eventCell) ? source.eventCell : 1;
        const dateCellIndex = Number.isInteger(source.dateCell) ? source.dateCell : 2;
        if (!cells[eventCellIndex] || !cells[dateCellIndex]) continue;

        const eventTitle = textFromHtml(cells[eventCellIndex]);
        if (!looksLikeEventTitle(eventTitle)) continue;

        const date = dateFromCell(cells[dateCellIndex]);
        if (!date || date > todayIso) continue;

        const venue = textFromHtml(cells[Number.isInteger(source.venueCell) ? source.venueCell : 3]);
        const location = textFromHtml(cells[Number.isInteger(source.locationCell) ? source.locationCell : 4]);
        const autoKey = `${source.id}:${date}:${slug(eventTitle)}`;
        if (seen.has(autoKey)) continue;
        seen.add(autoKey);

        const entry = {
            date,
            kind: "event",
            promotion: source.promotion,
            title: `${eventTitle} took place`,
            source: "Wikipedia",
            sourceUrl: sourceLink(cells[eventCellIndex], source.page),
            autoKey,
            archiveSource: source.id,
            generatedBy: GENERATED_BY,
            weight: Number(source.weight || 40)
        };

        const wikipediaTitle = wikipediaTitleFromCell(cells[eventCellIndex]);
        if (wikipediaTitle) entry.wikipediaTitle = wikipediaTitle;

        const detail = conciseDetail(venue, location);
        if (detail) entry.detail = detail;
        entries.push(entry);
    }

    return entries;
}

async function fetchSource(source) {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.searchParams.set("action", "parse");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("prop", "text");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("page", source.page);

    const data = await requestJson(url);
    const html = data?.parse?.text;
    if (typeof html !== "string" || html.length < 1000) {
        throw new Error(`${source.id}: Wikipedia returned no usable HTML for ${source.page}`);
    }

    const entries = eventRowsFromHtml(html, source);
    const minimum = Number(source.minimumEvents || 1);
    if (entries.length < minimum) {
        throw new Error(`${source.id}: parsed ${entries.length} events; expected at least ${minimum}`);
    }

    return entries;
}

const history = await readJson(HISTORY_PATH);
const sourceData = await readJson(SOURCES_PATH);
const sources = Array.isArray(sourceData?.sources) ? sourceData.sources : [];

if (sources.length < 4) throw new Error(`Event source registry is unexpectedly small (${sources.length} sources).`);

const generated = [];
for (const source of sources) {
    const sourceEntries = await fetchSource(source);
    generated.push(...sourceEntries);
    console.log(`${source.id}: ${sourceEntries.length} historical events`);
}

const uniqueGenerated = [];
const generatedKeys = new Set();
const dateTitles = new Set();
for (const entry of generated) {
    const dateTitle = `${entry.date}::${entry.title}`.toLowerCase();
    if (generatedKeys.has(entry.autoKey) || dateTitles.has(dateTitle)) continue;
    generatedKeys.add(entry.autoKey);
    dateTitles.add(dateTitle);
    uniqueGenerated.push(entry);
}

uniqueGenerated.sort((first, second) => first.date.localeCompare(second.date) || first.title.localeCompare(second.title));
await hydrateWikipediaImages(uniqueGenerated, history.entries || []);

const minimumTotal = sources.reduce((total, source) => total + Number(source.minimumEvents || 0), 0);
if (uniqueGenerated.length < minimumTotal) {
    throw new Error(`Only parsed ${uniqueGenerated.length} unique historical events; refusing to replace the event archive.`);
}

const sourceCounts = Object.fromEntries(sources.map(source => [source.id, 0]));
for (const entry of uniqueGenerated) {
    if (entry.archiveSource in sourceCounts) sourceCounts[entry.archiveSource] += 1;
}

const preserved = (history.entries || []).filter(entry => entry?.generatedBy !== GENERATED_BY);
const output = {
    ...history,
    version: Math.max(Number(history.version || 1), 4),
    eventArchiveVersion: Number(sourceData.version || 1),
    eventArchiveCount: uniqueGenerated.length,
    eventArchiveSources: sourceCounts,
    entries: [...preserved, ...uniqueGenerated]
};

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`On This Day event archive refreshed: ${uniqueGenerated.length} events across ${sources.length} sources.`);
