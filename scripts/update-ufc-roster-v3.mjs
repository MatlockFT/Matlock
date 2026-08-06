import fs from "node:fs/promises";

const CANONICAL_ORIGIN = "https://www.ufc.com";
const ORIGINS = [
    "https://www.ufc.com",
    "https://kr.ufc.com",
    "https://jp.ufc.com"
];
const ACTIVE_FILTER = "filters%5B0%5D=status%3A23";
const USER_AGENT =
    "Mozilla/5.0 (compatible; MMAMatlockRosterMonitor/3.0; +https://matlockfighttalk.com/)";

function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state");
const outputStatePath = argument("--output-state", "/tmp/ufc-roster-state.json");
const outputPublicPath = argument("--output-public", "/tmp/ufc-roster-latest.json");

function normalizeUrl(value) {
    try {
        const url = new URL(value, CANONICAL_ORIGIN);
        if (!/^\/athlete\/[^/?#]+\/?$/.test(url.pathname)) return null;
        url.protocol = "https:";
        url.hostname = "www.ufc.com";
        url.search = "";
        url.hash = "";
        url.pathname = url.pathname.replace(/\/$/, "");
        return url.toString();
    } catch {
        return null;
    }
}

function decodeHtml(value = "") {
    return value
        .replaceAll("\\/", "/")
        .replace(/\\u0026/g, "&")
        .replace(/\\u003C/g, "<")
        .replace(/\\u003E/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#039;|&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

function stripTags(value = "") {
    return decodeHtml(value.replace(/<[^>]*>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
}

function extractAthleteUrls(text) {
    const decoded = decodeHtml(text);
    const urls = new Set();
    const patterns = [
        /href=["']([^"']*\/athlete\/[^"'?#/]+\/?(?:\?[^"']*)?)["']/gi,
        /https?:\/\/(?:www\.|kr\.|jp\.)?ufc\.com\/athlete\/[^"'<>\s?]+/gi
    ];

    for (const pattern of patterns) {
        for (const match of decoded.matchAll(pattern)) {
            const normalized = normalizeUrl(match[1] || match[0]);
            if (normalized) urls.add(normalized);
        }
    }

    return urls;
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        redirect: "follow",
        ...options,
        headers: {
            "user-agent": USER_AGENT,
            accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            ...(options.headers || {})
        }
    });

    if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText} for ${url}`);
    }

    return response;
}

function addFound(target, found) {
    let added = 0;
    for (const url of found) {
        if (!target.has(url)) {
            target.add(url);
            added += 1;
        }
    }
    return added;
}

async function collectDirectPages(origin) {
    const collected = new Set();
    let emptyPages = 0;

    for (let page = 0; page < 100; page += 1) {
        const url = `${origin}/athletes/all?${ACTIVE_FILTER}&page=${page}`;
        const text = await (await request(url)).text();
        const found = extractAthleteUrls(text);
        const added = addFound(collected, found);

        emptyPages = found.size === 0 || added === 0 ? emptyPages + 1 : 0;
        if (emptyPages >= 2) break;
    }

    return collected;
}

function ajaxSpec(mode, origin, page) {
    const endpoint = `${origin}/views/ajax?_wrapper_format=drupal_ajax`;
    const body = new URLSearchParams({
        view_name: "all_athletes",
        view_display_id: "page",
        view_args: "",
        view_path: "/athletes/all",
        view_base_path: "",
        pager_element: "0",
        gender: "All",
        search: "",
        page: String(page)
    });
    let url = endpoint;

    if (mode === "query" || mode === "query-and-body" || mode === "query-and-view-path") {
        url += `&${ACTIVE_FILTER}`;
    }
    if (mode === "body" || mode === "query-and-body") {
        body.set("filters[0]", "status:23");
    }
    if (mode === "view-path" || mode === "query-and-view-path") {
        body.set("view_path", "/athletes/all?filters%5B0%5D=status%3A23");
    }

    return { url, body };
}

async function collectAjaxPages(origin, mode) {
    const collected = new Set();
    let emptyPages = 0;

    for (let page = 0; page < 100; page += 1) {
        const { url, body } = ajaxSpec(mode, origin, page);
        const text = await (
            await request(url, {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "x-requested-with": "XMLHttpRequest",
                    referer: `${origin}/athletes/all?${ACTIVE_FILTER}`
                },
                body
            })
        ).text();

        const found = extractAthleteUrls(text);
        const added = addFound(collected, found);
        emptyPages = found.size === 0 || added === 0 ? emptyPages + 1 : 0;
        if (emptyPages >= 2) break;
    }

    return collected;
}

const KNOWN_ACTIVE = [
    "https://www.ufc.com/athlete/islam-makhachev",
    "https://www.ufc.com/athlete/tom-aspinall"
];
const KNOWN_INACTIVE = [
    "https://www.ufc.com/athlete/muhammad-mokaev"
];

function validation(set) {
    const count = set.size;
    const activeMissing = KNOWN_ACTIVE.filter(url => !set.has(url));
    const inactivePresent = KNOWN_INACTIVE.filter(url => set.has(url));
    const plausibleCount = count >= 350 && count <= 900;
    return {
        ok: plausibleCount && activeMissing.length === 0 && inactivePresent.length === 0,
        count,
        plausibleCount,
        activeMissing,
        inactivePresent
    };
}

async function collectActiveRoster() {
    const attempts = [];
    const modes = ["direct", "query", "body", "view-path", "query-and-body", "query-and-view-path"];

    for (const origin of ORIGINS) {
        for (const mode of modes) {
            try {
                const set = mode === "direct"
                    ? await collectDirectPages(origin)
                    : await collectAjaxPages(origin, mode);
                const check = validation(set);
                attempts.push({ origin, mode, ...check });
                console.log(
                    `Active-roster probe ${origin} / ${mode}: ${set.size} profiles; valid=${check.ok}`
                );
                if (check.ok) {
                    return {
                        profiles: set,
                        source: `${origin}/athletes/all?filters[0]=status:23`,
                        mode,
                        attempts
                    };
                }
            } catch (error) {
                attempts.push({ origin, mode, error: error.message });
                console.warn(`Active-roster probe ${origin} / ${mode} failed: ${error.message}`);
            }
        }
    }

    throw new Error(`Could not validate UFC active-only roster filter. Attempts: ${JSON.stringify(attempts)}`);
}

function textFromMeta(html, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i"
    );
    return decodeHtml(html.match(pattern)?.[1] || "").trim();
}

function firstMatch(text, patterns) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1].trim();
    }
    return "";
}

function extractStatus(plain) {
    const match = plain.match(/\b(?:Fighter\s+)?Status\s*(Active|Not Fighting|Inactive|Retired)\b/i);
    return match?.[1] || "";
}

async function fighterDetails(url) {
    const html = await (await request(url)).text();
    const plain = stripTags(html);
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    const title = textFromMeta(html, "og:title") || firstMatch(html, [/<h1[^>]*>([\s\S]*?)<\/h1>/i]);
    const name = stripTags(title)
        .replace(/\s*\|\s*UFC.*$/i, "")
        .replace(/\s*-\s*UFC.*$/i, "")
        .trim() || slug.replaceAll("-", " ");
    const division = firstMatch(plain, [
        /\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight))\s+Division\b/i,
        /\b(Flyweight|Bantamweight|Featherweight|Lightweight|Welterweight|Middleweight|Light Heavyweight|Heavyweight)\s+Division\b/i
    ]);
    const record = firstMatch(plain, [/\b(\d+\s*-\s*\d+\s*-\s*\d+)\s*\(W-L-D\)/i]);

    return {
        name,
        slug,
        url,
        image: textFromMeta(html, "og:image") || "",
        division,
        record,
        status: extractStatus(plain) || "Active",
        description: textFromMeta(html, "description") || ""
    };
}

async function readState() {
    if (!statePath) return null;
    try {
        return JSON.parse(await fs.readFile(statePath, "utf8"));
    } catch {
        return null;
    }
}

function uniqueHistory(items, limit = 250) {
    const seen = new Set();
    return items.filter(item => {
        if (!item?.url || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    }).slice(0, limit);
}

const previous = await readState();
const activeResult = await collectActiveRoster();
const activeProfiles = [...activeResult.profiles].sort();
const now = new Date().toISOString();

const previousActive = Array.isArray(previous?.activeProfiles) && previous.activeProfiles.length >= 300
    ? previous.activeProfiles
    : null;

if (previousActive) {
    const delta = Math.abs(previousActive.length - activeProfiles.length);
    const allowedDelta = Math.max(30, Math.ceil(previousActive.length * 0.1));
    if (delta > allowedDelta) {
        throw new Error(
            `Active roster count changed from ${previousActive.length} to ${activeProfiles.length}; refusing unsafe snapshot.`
        );
    }
}

let additions = Array.isArray(previous?.additions) ? previous.additions : [];
let removals = Array.isArray(previous?.removals) ? previous.removals : [];
const newlyAdded = [];
const newlyRemoved = [];

if (previousActive) {
    const oldSet = new Set(previousActive);
    const newSet = new Set(activeProfiles);
    const addedUrls = activeProfiles.filter(url => !oldSet.has(url));
    const removedUrls = previousActive.filter(url => !newSet.has(url));

    for (const url of addedUrls) {
        try {
            const details = await fighterDetails(url);
            const item = { ...details, detectedAt: now };
            additions.unshift(item);
            newlyAdded.push(item);
        } catch (error) {
            console.warn(`Could not load added fighter ${url}: ${error.message}`);
            const item = {
                name: new URL(url).pathname.split("/").filter(Boolean).at(-1).replaceAll("-", " "),
                url,
                status: "Active",
                detectedAt: now
            };
            additions.unshift(item);
            newlyAdded.push(item);
        }
    }

    for (const url of removedUrls) {
        let details;
        try {
            details = await fighterDetails(url);
        } catch {
            details = {
                name: new URL(url).pathname.split("/").filter(Boolean).at(-1).replaceAll("-", " "),
                url
            };
        }
        const item = { ...details, detectedAt: now };
        removals.unshift(item);
        newlyRemoved.push(item);
    }
} else {
    console.log(
        `Established direct active-roster baseline with ${activeProfiles.length} fighters; no historical additions backfilled.`
    );
}

additions = uniqueHistory(additions);
removals = uniqueHistory(removals);

const trackingStartedAt = previous?.trackingStartedAt || now;
const state = {
    version: 3,
    checkedAt: now,
    trackingStartedAt,
    activeCount: activeProfiles.length,
    activeProfiles,
    activeRosterSource: activeResult.source,
    activeRosterMode: activeResult.mode,
    additions,
    removals
};

const publicData = {
    version: 3,
    generatedAt: now,
    trackingStartedAt,
    activeCount: activeProfiles.length,
    activeRosterSource: activeResult.source,
    activeRosterMode: activeResult.mode,
    methodology: "The tracker snapshots UFC's status:23 active-athlete filter and compares the active set with the previous snapshot. Detection time is the first tracker run that observed the roster change, not a contract-signing timestamp.",
    additions: additions.slice(0, 10),
    removals: removals.slice(0, 10),
    changesThisRun: {
        added: newlyAdded.length,
        removed: newlyRemoved.length
    }
};

await fs.writeFile(outputStatePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(outputPublicPath, `${JSON.stringify(publicData, null, 2)}\n`);

console.log(
    `Validated active UFC roster: ${activeProfiles.length} fighters via ${activeResult.source} (${activeResult.mode}).`
);
console.log(`Detected ${newlyAdded.length} addition(s) and ${newlyRemoved.length} removal(s) this run.`);
for (const fighter of newlyAdded) console.log(`+ ${fighter.name} — ${fighter.url}`);
for (const fighter of newlyRemoved) console.log(`- ${fighter.name} — ${fighter.url}`);
