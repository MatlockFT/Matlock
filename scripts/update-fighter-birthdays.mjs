import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const SEEDS_PATH = process.argv[3] || "assets/data/fighter-birthday-seeds.json";
const PORTRAITS_PATH = process.argv[4] || "assets/fighter-portraits.json";
const USER_AGENT = "MMA-Matlock-BirthdayArchive/1.0 (+https://mmamatlock.com/on-this-day/)";
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 20000;
const WIKIPEDIA_BATCH = 40;
const WIKIDATA_BATCH = 45;

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const key = value => clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const slug = value => key(value).replace(/\s+/g, "-") || "fighter";
const chunks = (items, size) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));

async function readJson(path, fallback = null) {
    try {
        return JSON.parse(await fs.readFile(path, "utf8"));
    } catch (error) {
        if (fallback !== null && error?.code === "ENOENT") return fallback;
        throw error;
    }
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
            if (attempt < REQUEST_ATTEMPTS) await new Promise(resolve => setTimeout(resolve, 600 * attempt));
        }
    }
    throw lastError || new Error(`Request failed: ${url}`);
}

function aliasMapFromQuery(query = {}) {
    const aliases = new Map();
    for (const item of query.normalized || []) aliases.set(key(item.from), item.to);
    for (const item of query.redirects || []) aliases.set(key(item.from), item.to);
    return aliases;
}

function resolveAlias(value, aliases) {
    let current = clean(value);
    const visited = new Set();
    for (let index = 0; index < 8; index += 1) {
        const currentKey = key(current);
        if (!currentKey || visited.has(currentKey)) break;
        visited.add(currentKey);
        const next = aliases.get(currentKey);
        if (!next) break;
        current = next;
    }
    return current;
}

async function resolveWikipedia(seeds) {
    const resolved = new Map();

    for (const batch of chunks(seeds, WIKIPEDIA_BATCH)) {
        const url = new URL("https://en.wikipedia.org/w/api.php");
        url.searchParams.set("action", "query");
        url.searchParams.set("format", "json");
        url.searchParams.set("formatversion", "2");
        url.searchParams.set("redirects", "1");
        url.searchParams.set("prop", "pageprops");
        url.searchParams.set("titles", batch.map(item => item.wikipedia).join("|"));

        const data = await requestJson(url);
        const aliases = aliasMapFromQuery(data?.query);
        const pages = new Map((data?.query?.pages || []).filter(page => !page.missing).map(page => [key(page.title), page]));

        for (const seed of batch) {
            const target = resolveAlias(seed.wikipedia, aliases);
            const page = pages.get(key(target)) || pages.get(key(seed.wikipedia)) || pages.get(key(seed.name));
            const qid = clean(page?.pageprops?.wikibase_item);
            if (!page || !/^Q\d+$/.test(qid)) continue;
            resolved.set(slug(seed.name), {
                seed,
                qid,
                pageTitle: page.title
            });
        }
    }

    return resolved;
}

async function loadBirthClaims(records) {
    const birthByQid = new Map();
    const qids = [...new Set([...records.values()].map(item => item.qid))];

    for (const batch of chunks(qids, WIKIDATA_BATCH)) {
        const url = new URL("https://www.wikidata.org/w/api.php");
        url.searchParams.set("action", "wbgetentities");
        url.searchParams.set("format", "json");
        url.searchParams.set("props", "claims");
        url.searchParams.set("ids", batch.join("|"));
        const data = await requestJson(url);

        for (const [qid, entity] of Object.entries(data?.entities || {})) {
            const claims = (entity?.claims?.P569 || []).filter(claim => claim?.rank !== "deprecated");
            claims.sort((first, second) => (second.rank === "preferred") - (first.rank === "preferred"));
            for (const claim of claims) {
                const value = claim?.mainsnak?.datavalue?.value;
                if (!value || Number(value.precision || 0) < 11) continue;
                const match = /^\+?(\d{4,})-(\d{2})-(\d{2})T/.exec(value.time || "");
                if (!match) continue;
                const year = Number(match[1]);
                const month = Number(match[2]);
                const day = Number(match[3]);
                const date = new Date(Date.UTC(year, month - 1, day));
                if (
                    year < 1900 ||
                    year > new Date().getUTCFullYear() ||
                    date.getUTCFullYear() !== year ||
                    date.getUTCMonth() !== month - 1 ||
                    date.getUTCDate() !== day
                ) continue;
                birthByQid.set(qid, `${String(year).padStart(4, "0")}-${match[2]}-${match[3]}`);
                break;
            }
        }
    }

    return birthByQid;
}

function wikipediaUrl(title) {
    return `https://en.wikipedia.org/wiki/${encodeURIComponent(clean(title).replace(/ /g, "_"))}`;
}

function portraitFor(name, portraits) {
    const portrait = portraits?.[key(name)];
    if (!portrait || !/^https:\/\//i.test(clean(portrait.url))) return null;
    return portrait;
}

function birthdayEntry(record, birthDate, portraits) {
    const portrait = portraitFor(record.seed.name, portraits);
    const entry = {
        date: birthDate,
        kind: "birthday",
        title: `${record.seed.name} was born`,
        source: "Wikipedia / Wikidata",
        sourceUrl: wikipediaUrl(record.pageTitle),
        birthdayKey: slug(record.seed.name),
        fighter: record.seed.name,
        weight: 18
    };

    if (portrait) {
        entry.imageUrl = portrait.url;
        entry.imageAlt = `${record.seed.name} portrait`;
        entry.imageCredit = clean(portrait.source || "").toUpperCase();
        entry.imagePosition = portrait.framing === "safe" ? "50% 18%" : "50% 50%";
    }

    return entry;
}

const history = await readJson(HISTORY_PATH);
const seedsData = await readJson(SEEDS_PATH);
const portraits = await readJson(PORTRAITS_PATH, {});
const seeds = Array.isArray(seedsData?.fighters) ? seedsData.fighters.filter(item => clean(item?.name) && clean(item?.wikipedia)) : [];

if (seeds.length < 25) throw new Error(`Birthday registry is unexpectedly small (${seeds.length} fighters).`);

const wikipedia = await resolveWikipedia(seeds);
const birthClaims = await loadBirthClaims(wikipedia);
const previousBirthdays = new Map(
    (history.entries || [])
        .filter(entry => entry?.kind === "birthday")
        .map(entry => [clean(entry.birthdayKey) || slug(String(entry.title || "").replace(/\s+was born$/i, "")), entry])
);

const birthdayEntries = [];
const unresolved = [];

for (const seed of seeds) {
    const seedKey = slug(seed.name);
    const record = wikipedia.get(seedKey);
    const birthDate = record ? birthClaims.get(record.qid) : "";
    if (record && birthDate) {
        birthdayEntries.push(birthdayEntry(record, birthDate, portraits));
        continue;
    }

    const previous = previousBirthdays.get(seedKey);
    if (previous) birthdayEntries.push(previous);
    else unresolved.push(seed.name);
}

const minimumResolved = Math.max(25, Math.floor(seeds.length * 0.75));
if (birthdayEntries.length < minimumResolved) {
    throw new Error(`Only resolved ${birthdayEntries.length}/${seeds.length} fighter birthdays; refusing to replace the archive.`);
}

birthdayEntries.sort((first, second) => first.date.localeCompare(second.date) || first.title.localeCompare(second.title));
const curated = (history.entries || []).filter(entry => entry?.kind !== "birthday");
const output = {
    ...history,
    version: Math.max(Number(history.version || 1), 3),
    birthdayRegistryVersion: Number(seedsData.version || 1),
    birthdayCount: birthdayEntries.length,
    entries: [...curated, ...birthdayEntries]
};

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`Fighter birthdays refreshed: ${birthdayEntries.length}/${seeds.length} seeded fighters.`);
if (unresolved.length) console.warn(`No verified day-level birth date for: ${unresolved.join(", ")}`);
