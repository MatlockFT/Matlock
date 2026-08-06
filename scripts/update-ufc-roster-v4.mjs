import fs from "node:fs/promises";

const CANONICAL_ORIGIN = "https://www.ufc.com";
const ORIGINS = ["https://www.ufc.com", "https://kr.ufc.com", "https://jp.ufc.com"];
const USER_AGENT = "Mozilla/5.0 (compatible; MMAMatlockRosterMonitor/4.0; +https://matlockfighttalk.com/)";
const MAX_PAGES = 80;

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
    return decodeHtml(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
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
    if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
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

function findViewDomId(html) {
    const decoded = decodeHtml(html);
    const patterns = [
        /js-view-dom-id-([a-f0-9]{20,})/i,
        /data-view-dom-id=["']([^"']+)["']/i,
        /["']view_dom_id["']\s*:\s*["']([^"']+)["']/i,
        /view_dom_id=([a-f0-9]{20,})/i
    ];
    for (const pattern of patterns) {
        const match = decoded.match(pattern);
        if (match?.[1]) return match[1];
    }
    return "";
}

async function getViewContext(origin) {
    const url = `${origin}/athletes/all`;
    const html = await (await request(url)).text();
    const viewDomId = findViewDomId(html);
    console.log(`View context ${origin}: dom_id=${viewDomId || "not-found"}, first-page profiles=${extractAthleteUrls(html).size}`);
    return { viewDomId };
}

async function collectDirectGenderSplit(origin) {
    const collected = new Set();
    for (const gender of ["1", "2"]) {
        let duplicatePages = 0;
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const params = new URLSearchParams({
                "filters[0]": "status:23",
                gender,
                page: String(page)
            });
            const url = `${origin}/athletes/all?${params}`;
            const text = await (await request(url)).text();
            const found = extractAthleteUrls(text);
            const added = addFound(collected, found);
            if (page < 2 || added === 0) {
                console.log(`Direct ${origin} gender=${gender} page=${page}: found=${found.size} new=${added} total=${collected.size}`);
            }
            duplicatePages = found.size === 0 || added === 0 ? duplicatePages + 1 : 0;
            if (duplicatePages >= 2) break;
        }
    }
    return collected;
}

function ajaxUrl(origin, context, page, gender, mode) {
    const url = new URL(`${origin}/views/ajax`);
    const params = url.searchParams;
    params.set("view_name", "all_athletes");
    params.set("view_display_id", "page");
    params.set("view_args", "");
    params.set("view_path", "/athletes/all");
    params.set("view_base_path", "");
    if (context.viewDomId) params.set("view_dom_id", context.viewDomId);
    params.set("pager_element", "0");
    params.set("gender", gender);
    params.set("search", "");
    params.set("page", String(page));
    params.set("_drupal_ajax", "1");
    params.set("ajax_page_state[theme]", "ufc");
    params.set("ajax_page_state[theme_token]", "");
    params.set("_wrapper_format", "drupal_ajax");

    if (mode.includes("filters-query")) params.set("filters[0]", "status:23");
    if (mode.includes("f-query")) params.set("f[0]", "status:23");
    if (mode.includes("status-query")) params.set("status", "23");
    if (mode.includes("filters-viewpath")) {
        params.set("view_path", "/athletes/all?filters%5B0%5D=status%3A23");
    }
    if (mode.includes("f-viewpath")) {
        params.set("view_path", "/athletes/all?f%5B0%5D=status%3A23");
    }
    if (mode.includes("filters-both")) {
        params.set("filters[0]", "status:23");
        params.set("view_path", "/athletes/all?filters%5B0%5D=status%3A23");
    }
    if (mode.includes("f-both")) {
        params.set("f[0]", "status:23");
        params.set("view_path", "/athletes/all?f%5B0%5D=status%3A23");
    }
    return url.toString();
}

async function collectAjaxGet(origin, context, mode) {
    const collected = new Set();
    for (const gender of ["1", "2"]) {
        let duplicatePages = 0;
        for (let page = 0; page < MAX_PAGES; page += 1) {
            const url = ajaxUrl(origin, context, page, gender, mode);
            const text = await (
                await request(url, {
                    headers: {
                        "x-requested-with": "XMLHttpRequest",
                        referer: `${origin}/athletes/all?filters%5B0%5D=status%3A23&gender=${gender}`
                    }
                })
            ).text();
            const found = extractAthleteUrls(text);
            const added = addFound(collected, found);
            if (page < 2 || added === 0) {
                console.log(`AJAX GET ${origin} ${mode} gender=${gender} page=${page}: found=${found.size} new=${added} total=${collected.size} bytes=${text.length}`);
            }
            duplicatePages = found.size === 0 || added === 0 ? duplicatePages + 1 : 0;
            if (duplicatePages >= 2) break;
        }
    }
    return collected;
}

const KNOWN_ACTIVE = [
    "https://www.ufc.com/athlete/islam-makhachev",
    "https://www.ufc.com/athlete/tom-aspinall"
];
const KNOWN_INACTIVE = ["https://www.ufc.com/athlete/muhammad-mokaev"];

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
    const ajaxModes = [
        "filters-query",
        "f-query",
        "status-query",
        "filters-viewpath",
        "f-viewpath",
        "filters-both",
        "f-both"
    ];

    for (const origin of ORIGINS) {
        try {
            const direct = await collectDirectGenderSplit(origin);
            const check = validation(direct);
            attempts.push({ origin, mode: "direct-gender-split", ...check });
            console.log(`Active-roster probe ${origin} / direct-gender-split: ${direct.size}; valid=${check.ok}`);
            if (check.ok) return { profiles: direct, source: `${origin}/athletes/all`, mode: "direct-gender-split", attempts };
        } catch (error) {
            attempts.push({ origin, mode: "direct-gender-split", error: error.message });
            console.warn(`Direct gender split failed for ${origin}: ${error.message}`);
        }

        let context;
        try {
            context = await getViewContext(origin);
        } catch (error) {
            attempts.push({ origin, mode: "view-context", error: error.message });
            continue;
        }

        for (const mode of ajaxModes) {
            try {
                const set = await collectAjaxGet(origin, context, mode);
                const check = validation(set);
                attempts.push({ origin, mode, ...check, viewDomId: context.viewDomId || null });
                console.log(`Active-roster probe ${origin} / ${mode}: ${set.size}; valid=${check.ok}`);
                if (check.ok) {
                    return {
                        profiles: set,
                        source: `${origin}/views/ajax`,
                        mode,
                        viewDomId: context.viewDomId || null,
                        attempts
                    };
                }
            } catch (error) {
                attempts.push({ origin, mode, error: error.message, viewDomId: context.viewDomId || null });
                console.warn(`AJAX GET ${origin} / ${mode} failed: ${error.message}`);
            }
        }
    }

    throw new Error(`Could not validate UFC active-only roster. Attempts: ${JSON.stringify(attempts)}`);
}

function textFromMeta(html, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
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
    const name = stripTags(title).replace(/\s*\|\s*UFC.*$/i, "").replace(/\s*-\s*UFC.*$/i, "").trim() || slug.replaceAll("-", " ");
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
const previousActive = Array.isArray(previous?.activeProfiles) && previous.activeProfiles.length >= 300 ? previous.activeProfiles : null;

if (previousActive) {
    const delta = Math.abs(previousActive.length - activeProfiles.length);
    const allowedDelta = Math.max(30, Math.ceil(previousActive.length * 0.1));
    if (delta > allowedDelta) throw new Error(`Active roster count changed from ${previousActive.length} to ${activeProfiles.length}; refusing unsafe snapshot.`);
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
        let details;
        try { details = await fighterDetails(url); }
        catch { details = { name: new URL(url).pathname.split("/").filter(Boolean).at(-1).replaceAll("-", " "), url, status: "Active" }; }
        const item = { ...details, detectedAt: now };
        additions.unshift(item);
        newlyAdded.push(item);
    }

    for (const url of removedUrls) {
        let details;
        try { details = await fighterDetails(url); }
        catch { details = { name: new URL(url).pathname.split("/").filter(Boolean).at(-1).replaceAll("-", " "), url }; }
        const item = { ...details, detectedAt: now };
        removals.unshift(item);
        newlyRemoved.push(item);
    }
} else {
    console.log(`Established direct active-roster baseline with ${activeProfiles.length} fighters; no historical changes backfilled.`);
}

additions = uniqueHistory(additions);
removals = uniqueHistory(removals);
const trackingStartedAt = previous?.trackingStartedAt || now;

const state = {
    version: 4,
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
    version: 4,
    generatedAt: now,
    trackingStartedAt,
    activeCount: activeProfiles.length,
    activeRosterSource: activeResult.source,
    activeRosterMode: activeResult.mode,
    methodology: "The tracker snapshots UFC's active-athlete data and compares the active set with the previous snapshot. Detection time is the first tracker run that observed the roster change, not a contract-signing timestamp.",
    additions: additions.slice(0, 10),
    removals: removals.slice(0, 10),
    changesThisRun: { added: newlyAdded.length, removed: newlyRemoved.length }
};

await fs.writeFile(outputStatePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(outputPublicPath, `${JSON.stringify(publicData, null, 2)}\n`);

console.log(`Validated active UFC roster: ${activeProfiles.length} fighters via ${activeResult.source} (${activeResult.mode}).`);
console.log(`Detected ${newlyAdded.length} addition(s) and ${newlyRemoved.length} removal(s) this run.`);
for (const fighter of newlyAdded) console.log(`+ ${fighter.name} — ${fighter.url}`);
for (const fighter of newlyRemoved) console.log(`- ${fighter.name} — ${fighter.url}`);
