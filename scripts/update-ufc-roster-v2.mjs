import fs from "node:fs/promises";

const UFC_ORIGIN = "https://www.ufc.com";
const ATHLETES_URL = `${UFC_ORIGIN}/athletes/all`;
const AJAX_URL = `${UFC_ORIGIN}/views/ajax?_wrapper_format=drupal_ajax`;
const USER_AGENT =
    "Mozilla/5.0 (compatible; MMAMatlockRosterMonitor/2.0; +https://matlockfighttalk.com/)";
const CANDIDATE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CANDIDATE_CHECK_LIMIT = 50;

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
    const firstText = await (await request(ATHLETES_URL)).text();
    for (const url of extractAthleteUrls(firstText)) collected.add(url);

    let duplicatePages = 0;

    for (let page = 1; page < 400; page += 1) {
        const body = new URLSearchParams({
            view_name: "all_athletes",
            view_display_id: "page",
            view_path: "/athletes/all",
            page: String(page),
            pager_element: "0",
            gender: "All"
        });

        let text;
        try {
            text = await (
                await request(AJAX_URL, {
                    method: "POST",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "x-requested-with": "XMLHttpRequest",
                        referer: ATHLETES_URL
                    },
                    body
                })
            ).text();
        } catch (error) {
            console.warn(`Drupal pagination stopped at page ${page}: ${error.message}`);
            break;
        }

        const found = extractAthleteUrls(text);
        let added = 0;
        for (const url of found) {
            if (!collected.has(url)) {
                collected.add(url);
                added += 1;
            }
        }

        duplicatePages = found.size === 0 || added === 0 ? duplicatePages + 1 : 0;
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
    const queue = [`${UFC_ORIGIN}/sitemap.xml`, `${UFC_ORIGIN}/sitemap_index.xml`];
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
            } else if (/sitemap/i.test(loc) && /^https?:\/\//i.test(loc) && !visited.has(loc)) {
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
        throw new Error(
            `Only found ${combined.size} UFC athlete profiles; refusing to publish an incomplete snapshot.`
        );
    }

    console.log(
        `Collected ${combined.size} athlete profiles (${directory.size} directory, ${sitemap.size} sitemap).`
    );
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

function normalizeStatus(value = "") {
    const status = value.trim().toLowerCase();
    if (status === "active") return "Active";
    if (status === "not fighting") return "Not Fighting";
    if (status === "inactive") return "Inactive";
    if (status === "retired") return "Retired";
    return "";
}

function extractStatus(html) {
    const plain = stripTags(html);
    const explicit = plain.match(
        /\b(?:Fighter\s+)?Status\s*(Active|Not Fighting|Inactive|Retired)\b/i
    );
    if (explicit?.[1]) return normalizeStatus(explicit[1]);

    const nearInfo = plain.match(
        /\bInfo\b[\s\S]{0,1000}?\b(Active|Not Fighting|Inactive|Retired)\b/i
    );
    return normalizeStatus(nearInfo?.[1] || "");
}

function firstMatch(text, patterns) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1].trim();
    }
    return "";
}

async function fighterDetails(url) {
    const html = await (await request(url)).text();
    const plain = stripTags(html);
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
    const title =
        textFromMeta(html, "og:title") ||
        firstMatch(html, [/<h1[^>]*>([\s\S]*?)<\/h1>/i]).replace(/<[^>]+>/g, " ");
    const name =
        decodeHtml(title)
            .replace(/\s*\|\s*UFC.*$/i, "")
            .replace(/\s*-\s*UFC.*$/i, "")
            .replace(/\s+/g, " ")
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
        status: extractStatus(html),
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

function uniqueByUrl(items) {
    const seen = new Set();
    return items.filter(item => {
        if (!item?.url || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    });
}

const previous = await readState();
const profiles = await collectCurrentProfiles();
const now = new Date().toISOString();
const nowMs = Date.now();
const sortedProfiles = [...profiles].sort();

let additions = Array.isArray(previous?.additions) ? previous.additions : [];
let candidates = Array.isArray(previous?.candidates) ? previous.candidates : [];
const newlyDetected = [];

if (Array.isArray(previous?.profiles) && previous.profiles.length >= 500) {
    const previousProfiles = new Set(previous.profiles);
    const candidateUrls = new Set(candidates.map(item => item.url));

    for (const url of sortedProfiles) {
        if (!previousProfiles.has(url) && !candidateUrls.has(url)) {
            candidates.push({
                url,
                firstDetectedAt: now,
                lastCheckedAt: "",
                lastStatus: "",
                attempts: 0
            });
            candidateUrls.add(url);
        }
    }
} else {
    console.log("No usable previous snapshot. Creating baseline without backfilling historical fighters.");
}

const currentProfileSet = new Set(sortedProfiles);
candidates = uniqueByUrl(candidates)
    .filter(candidate => currentProfileSet.has(candidate.url))
    .filter(candidate => {
        const firstSeen = Date.parse(candidate.firstDetectedAt || now);
        return Number.isNaN(firstSeen) || nowMs - firstSeen <= CANDIDATE_MAX_AGE_MS;
    });

const toCheck = [...candidates]
    .sort((a, b) => Date.parse(a.lastCheckedAt || 0) - Date.parse(b.lastCheckedAt || 0))
    .slice(0, CANDIDATE_CHECK_LIMIT);
const checkedUrls = new Set(toCheck.map(item => item.url));
const remainingCandidates = candidates.filter(item => !checkedUrls.has(item.url));

for (const candidate of toCheck) {
    try {
        const details = await fighterDetails(candidate.url);
        if (details.status === "Active") {
            const addition = {
                ...details,
                detectedAt: candidate.firstDetectedAt || now,
                confirmedActiveAt: now
            };
            additions.unshift(addition);
            newlyDetected.push(addition);
            continue;
        }

        remainingCandidates.push({
            ...candidate,
            lastCheckedAt: now,
            lastStatus: details.status || "Unknown",
            attempts: Number(candidate.attempts || 0) + 1
        });
        console.log(
            `Candidate ${details.name}: status ${details.status || "Unknown"}; keeping for recheck.`
        );
    } catch (error) {
        remainingCandidates.push({
            ...candidate,
            lastCheckedAt: now,
            attempts: Number(candidate.attempts || 0) + 1
        });
        console.warn(`Could not inspect candidate ${candidate.url}: ${error.message}`);
    }
}

additions = uniqueByUrl(additions).slice(0, 250);
candidates = uniqueByUrl(remainingCandidates).slice(0, 250);

const trackingStartedAt = previous?.trackingStartedAt || now;
const state = {
    version: 2,
    checkedAt: now,
    trackingStartedAt,
    profiles: sortedProfiles,
    additions,
    candidates
};

const publicData = {
    version: 2,
    generatedAt: now,
    trackingStartedAt,
    methodology:
        "UFC.com athlete-directory and sitemap snapshots are compared for new athlete profiles. New profiles are held until the fighter's UFC profile explicitly reports Status: Active.",
    additions: additions.slice(0, 10)
};

await fs.writeFile(outputStatePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(outputPublicPath, `${JSON.stringify(publicData, null, 2)}\n`);

console.log(`Confirmed ${newlyDetected.length} new active UFC roster addition(s) this run.`);
console.log(`${candidates.length} candidate profile(s) awaiting Active status.`);
for (const fighter of newlyDetected) {
    console.log(`+ ${fighter.name} — ${fighter.url}`);
}
