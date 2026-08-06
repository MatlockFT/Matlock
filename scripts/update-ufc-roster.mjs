import fs from "node:fs/promises";

const UFC_ORIGIN = "https://www.ufc.com";
const ATHLETES_URL = `${UFC_ORIGIN}/athletes/all`;
const AJAX_URL = `${UFC_ORIGIN}/views/ajax?_wrapper_format=drupal_ajax`;
const USER_AGENT =
    "Mozilla/5.0 (compatible; MMAMatlockRosterMonitor/1.0; +https://matlockfighttalk.com/)";

function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state");
const outputStatePath = argument("--output-state", "/tmp/ufc-roster-state.json");
const outputPublicPath = argument("--output-public", "/tmp/ufc-roster-latest.json");

function normalizeUrl(value) {
    try {
        const url = new URL(value, UFC_ORIGIN);
        if (url.hostname !== "www.ufc.com" && url.hostname !== "ufc.com") return null;
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
    const urls = new Set();
    const patterns = [
        /href=["']([^"']*\/athlete\/[^"'?#/]+\/?(?:\?[^"']*)?)["']/gi,
        /https?:\\?\/\\?\/(?:www\\?\.)?ufc\\?\.com\\?\/athlete\\?\/[^"'<>\\\s?]+/gi,
        /https?:\/\/(?:www\.)?ufc\.com\/athlete\/[^"'<>\s?]+/gi
    ];

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const raw = (match[1] || match[0])
                .replaceAll("\\/", "/")
                .replace(/\\u0026/g, "&");
            const normalized = normalizeUrl(raw);
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

async function collectFromDirectory() {
    const collected = new Set();
    const first = await request(ATHLETES_URL);
    const firstText = await first.text();
    for (const url of extractAthleteUrls(firstText)) collected.add(url);

    let duplicatePages = 0;

    for (let page = 1; page < 400; page += 1) {
        const body = new URLSearchParams({
            view_name: "all_athletes",
            view_display_id: "page",
            view_path: "/athletes/all",
            page: String(page),
            pager_element: "0"
        });

        let response;
        try {
            response = await request(AJAX_URL, {
                method: "POST",
                headers: {
                    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "x-requested-with": "XMLHttpRequest",
                    referer: ATHLETES_URL
                },
                body
            });
        } catch (error) {
            console.warn(`Drupal pagination stopped at page ${page}: ${error.message}`);
            break;
        }

        const text = await response.text();
        const found = extractAthleteUrls(text);
        let added = 0;
        for (const url of found) {
            if (!collected.has(url)) {
                collected.add(url);
                added += 1;
            }
        }

        if (found.size === 0 || added === 0) {
            duplicatePages += 1;
        } else {
            duplicatePages = 0;
        }

        if (duplicatePages >= 3) break;
    }

    return collected;
}

function extractLocs(xml) {
    return [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)].map(match =>
        decodeHtml(match[1].trim())
    );
}

async function collectFromSitemaps() {
    const athleteUrls = new Set();
    const queue = [
        `${UFC_ORIGIN}/sitemap.xml`,
        `${UFC_ORIGIN}/sitemap_index.xml`
    ];
    const visited = new Set();

    while (queue.length && visited.size < 100) {
        const url = queue.shift();
        if (!url || visited.has(url)) continue;
        visited.add(url);

        let text;
        try {
            text = await (await request(url)).text();
        } catch {
            continue;
        }

        for (const loc of extractLocs(text)) {
            const athlete = normalizeUrl(loc);
            if (athlete) {
                athleteUrls.add(athlete);
                continue;
            }

            if (/sitemap/i.test(loc) && /^https?:\/\//i.test(loc) && !visited.has(loc)) {
                queue.push(loc);
            }
        }
    }

    return athleteUrls;
}

async function collectCurrentProfiles() {
    let directory = new Set();
    let sitemap = new Set();

    try {
        directory = await collectFromDirectory();
    } catch (error) {
        console.warn(`Directory collection failed: ${error.message}`);
    }

    try {
        sitemap = await collectFromSitemaps();
    } catch (error) {
        console.warn(`Sitemap collection failed: ${error.message}`);
    }

    const combined = new Set([...directory, ...sitemap]);
    if (combined.size < 500) {
        throw new Error(`Only found ${combined.size} UFC athlete profiles; refusing to publish an incomplete snapshot.`);
    }

    console.log(`Collected ${combined.size} athlete profiles (${directory.size} directory, ${sitemap.size} sitemap).`);
    return combined;
}

function textFromMeta(html, property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
        `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
        "i"
    );
    return decodeHtml(html.match(pattern)?.[1] || "").trim();
}

function matchText(html, patterns) {
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match?.[1]) return stripTags(match[1]);
    }
    return "";
}

async function fighterDetails(url) {
    const html = await (await request(url)).text();
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    const title = textFromMeta(html, "og:title") || matchText(html, [/<h1[^>]*>([\s\S]*?)<\/h1>/i]);
    const name = title.replace(/\s*\|\s*UFC.*$/i, "").replace(/\s*-\s*UFC.*$/i, "").trim() || slug.replaceAll("-", " ");
    const image = textFromMeta(html, "og:image");
    const description = textFromMeta(html, "description");
    const status = matchText(html, [
        /(?:Status|Fighter Status)[\s\S]{0,500}?<[^>]*>(Active|Not Fighting|Inactive|Retired)<\/[^>]+>/i,
        /\b(Status|Fighter Status)\b[\s\S]{0,250}?\b(Active|Not Fighting|Inactive|Retired)\b/i
    ]).replace(/^Status\s*/i, "");
    const division = matchText(html, [
        /(?:Division|Weight Class)[\s\S]{0,500}?<[^>]*>([^<>]{3,40})<\/[^>]+>/i,
        /\b(Flyweight|Bantamweight|Featherweight|Lightweight|Welterweight|Middleweight|Light Heavyweight|Heavyweight|Women'?s Strawweight|Women'?s Flyweight|Women'?s Bantamweight|Women'?s Featherweight)\b/i
    ]);
    const record = matchText(html, [
        /(?:Record|W-L-D)[\s\S]{0,350}?\b(\d+\s*-\s*\d+(?:\s*-\s*\d+)?)\b/i,
        /\b(\d+\s*-\s*\d+\s*-\s*\d+)\b/i
    ]);

    return {
        name,
        slug,
        url,
        image: image || "",
        division: division || "",
        record: record || "",
        status: status || "",
        description: description || ""
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

const previous = await readState();
const profiles = await collectCurrentProfiles();
const now = new Date().toISOString();
const sortedProfiles = [...profiles].sort();

let additions = Array.isArray(previous?.additions) ? previous.additions : [];
let newlyDetected = [];

if (Array.isArray(previous?.profiles) && previous.profiles.length >= 500) {
    const previousProfiles = new Set(previous.profiles);
    const newUrls = sortedProfiles.filter(url => !previousProfiles.has(url));

    for (const url of newUrls) {
        try {
            const details = await fighterDetails(url);
            const normalizedStatus = details.status.toLowerCase();
            const likelyActive = !normalizedStatus || normalizedStatus === "active";

            if (!likelyActive) {
                console.log(`Skipping ${details.name}: UFC status is ${details.status}.`);
                continue;
            }

            const addition = {
                ...details,
                detectedAt: now
            };
            additions.unshift(addition);
            newlyDetected.push(addition);
        } catch (error) {
            console.warn(`Could not inspect new profile ${url}: ${error.message}`);
        }
    }
} else {
    console.log("No usable previous snapshot. Creating baseline without backfilling historical fighters.");
}

const seen = new Set();
additions = additions.filter(item => {
    if (!item?.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
}).slice(0, 250);

const state = {
    version: 1,
    checkedAt: now,
    profiles: sortedProfiles,
    additions
};

const publicData = {
    version: 1,
    generatedAt: now,
    trackingStartedAt: previous?.trackingStartedAt || now,
    methodology: "New UFC athlete profiles are detected by comparing UFC.com athlete-directory and sitemap snapshots. New profiles are checked against the UFC profile status when available.",
    additions: additions.slice(0, 10)
};
state.trackingStartedAt = publicData.trackingStartedAt;

await fs.writeFile(outputStatePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(outputPublicPath, `${JSON.stringify(publicData, null, 2)}\n`);

console.log(`Detected ${newlyDetected.length} new active UFC profile(s) this run.`);
for (const fighter of newlyDetected) console.log(`+ ${fighter.name} — ${fighter.url}`);
