import fs from "node:fs/promises";

const UFC_ORIGIN = "https://www.ufc.com";
const ATHLETES_URL = `${UFC_ORIGIN}/athletes/all`;
const AJAX_URL = `${UFC_ORIGIN}/views/ajax?_wrapper_format=drupal_ajax`;
const ACTIVE_FILTER = "status:23";
const COLLECTOR_ID = "ufc-status23-drupal-post-v1";
const USER_AGENT =
    "Mozilla/5.0 (compatible; MMAMatlockRosterMonitor/5.0; +https://matlockfighttalk.com/)";
const PAGE_CONCURRENCY = 6;
const MAX_PAGES = 160;
const MIN_ACTIVE_PROFILES = 500;
const PENDING_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_CHECK_LIMIT = 40;

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
    return decodeHtml(
        value
            .replace(/<script[\s\S]*?<\/script>/gi, " ")
            .replace(/<style[\s\S]*?<\/style>/gi, " ")
            .replace(/<[^>]*>/g, " ")
    )
        .replace(/\s+/g, " ")
        .trim();
}

function extractAthleteUrls(text) {
    const normalized = text
        .replaceAll("\\/", "/")
        .replace(/\\u002f/gi, "/")
        .replace(/\\u0026/gi, "&")
        .replace(/\\"/g, '"');
    const urls = new Set();

    for (const match of normalized.matchAll(
        /(?:https?:\/\/(?:www\.)?ufc\.com)?(\/athlete\/[a-z0-9][a-z0-9-]*)(?=[/?#"'<>\s\\]|$)/gi
    )) {
        const normalizedUrl = normalizeUrl(match[1]);
        if (normalizedUrl) urls.add(normalizedUrl);
    }

    return urls;
}

function extractReportedAthleteCount(text) {
    const plain = text
        .replace(/\\u003c/gi, "<")
        .replace(/\\u003e/gi, ">")
        .replace(/<[^>]+>/g, " ")
        .replace(/\\n/g, " ")
        .replace(/\s+/g, " ");
    const match = plain.match(/\b(\d{2,5})\s+Athletes\b/i);
    return match ? Number(match[1]) : null;
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
        const preview = (await response.text()).slice(0, 300).replace(/\s+/g, " ");
        throw new Error(`${response.status} ${response.statusText} for ${url}: ${preview}`);
    }

    return response;
}

async function fetchActivePage(page) {
    const url = new URL(AJAX_URL);
    url.searchParams.set("filters[0]", ACTIVE_FILTER);
    url.searchParams.set("page", String(page));

    const body = new URLSearchParams({
        view_name: "all_athletes",
        view_display_id: "page",
        view_path: "/athletes/all",
        pager_element: "0",
        gender: "All",
        page: String(page)
    });

    const text = await (
        await request(url.toString(), {
            method: "POST",
            headers: {
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest",
                referer: `${ATHLETES_URL}?filters%5B0%5D=status%3A23`
            },
            body
        })
    ).text();

    return {
        page,
        urls: extractAthleteUrls(text),
        reportedCount: extractReportedAthleteCount(text)
    };
}

async function collectActiveProfiles() {
    const first = await fetchActivePage(0);
    const collected = new Set(first.urls);
    const reportedCount = first.reportedCount;

    if (first.urls.size === 0) {
        throw new Error("UFC Active view returned no athlete profile URLs on page 0.");
    }

    let emptyRun = 0;

    for (let start = 1; start < MAX_PAGES; start += PAGE_CONCURRENCY) {
        const pageNumbers = Array.from(
            { length: PAGE_CONCURRENCY },
            (_, index) => start + index
        ).filter(page => page < MAX_PAGES);

        const pages = await Promise.all(pageNumbers.map(fetchActivePage));

        for (const result of pages) {
            if (result.urls.size === 0) {
                emptyRun += 1;
            } else {
                emptyRun = 0;
                for (const url of result.urls) collected.add(url);
            }
        }

        if (reportedCount && collected.size >= reportedCount) break;
        if (emptyRun >= 3) break;
    }

    if (collected.size < MIN_ACTIVE_PROFILES) {
        throw new Error(
            `Only found ${collected.size} profiles in UFC's Active collection; refusing to publish an incomplete snapshot.`
        );
    }

    if (reportedCount && collected.size < reportedCount * 0.9) {
        throw new Error(
            `UFC Active view reports ${reportedCount} athletes but only ${collected.size} profile URLs were collected.`
        );
    }

    console.log(
        `Collected ${collected.size} profile URLs from UFC's Active collection` +
            (reportedCount ? ` (view reports ${reportedCount} athletes).` : ".")
    );

    return {
        urls: collected,
        reportedCount
    };
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

function uniqueByUrl(items, limit = 250) {
    const seen = new Set();
    return items
        .filter(item => {
            if (!item?.url || seen.has(item.url)) return false;
            seen.add(item.url);
            return true;
        })
        .slice(0, limit);
}

const previous = await readState();
const activeSnapshot = await collectActiveProfiles();
const now = new Date().toISOString();
const nowMs = Date.now();
const activeProfiles = [...activeSnapshot.urls].sort();
const currentActiveSet = new Set(activeProfiles);

const collectorMatches = previous?.collectorId === COLLECTOR_ID;
const previousActiveProfiles =
    collectorMatches && Array.isArray(previous?.activeProfiles)
        ? previous.activeProfiles
        : null;
const hasActiveBaseline =
    previousActiveProfiles && previousActiveProfiles.length >= MIN_ACTIVE_PROFILES;

let additions = collectorMatches && Array.isArray(previous?.additions) ? previous.additions : [];
let removals = collectorMatches && Array.isArray(previous?.removals) ? previous.removals : [];
let pending =
    collectorMatches && Array.isArray(previous?.pendingActiveAdditions)
        ? previous.pendingActiveAdditions
        : [];
const newlyConfirmed = [];
const newlyRemoved = [];

if (hasActiveBaseline) {
    const previousActiveSet = new Set(previousActiveProfiles);
    const enteredActive = activeProfiles.filter(url => !previousActiveSet.has(url));
    const leftActive = previousActiveProfiles.filter(url => !currentActiveSet.has(url));

    const maximumExpectedChange = Math.max(
        100,
        Math.ceil(previousActiveProfiles.length * 0.2)
    );
    if (
        enteredActive.length > maximumExpectedChange ||
        leftActive.length > maximumExpectedChange
    ) {
        throw new Error(
            `UFC Active collection changed too sharply in one check (+${enteredActive.length}/-${leftActive.length}); refusing to publish until the feed stabilizes.`
        );
    }

    const pendingUrls = new Set(pending.map(item => item.url));
    const alreadyRecorded = new Set(additions.map(item => item.url));

    for (const url of enteredActive) {
        if (pendingUrls.has(url) || alreadyRecorded.has(url)) continue;
        pending.push({
            url,
            firstDetectedAt: now,
            lastCheckedAt: "",
            lastStatus: "",
            attempts: 0
        });
        pendingUrls.add(url);
    }

    for (const url of leftActive) {
        let details;
        try {
            details = await fighterDetails(url);
        } catch {
            const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1);
            details = { name: slug.replaceAll("-", " "), slug, url };
        }
        const removal = { ...details, detectedAt: now };
        removals.unshift(removal);
        newlyRemoved.push(removal);
    }

    console.log(
        `Active roster diff: +${enteredActive.length} entered, -${leftActive.length} left.`
    );
} else {
    console.log(
        collectorMatches
            ? "No usable Active-roster baseline found. Creating one without backfilling existing UFC fighters."
            : "Collector changed to the verified UFC Active feed. Establishing a fresh baseline without backfilling changes."
    );
}

pending = uniqueByUrl(pending)
    .filter(item => currentActiveSet.has(item.url))
    .filter(item => {
        const firstDetected = Date.parse(item.firstDetectedAt || now);
        return Number.isNaN(firstDetected) || nowMs - firstDetected <= PENDING_MAX_AGE_MS;
    });

const toCheck = [...pending]
    .sort((a, b) => Date.parse(a.lastCheckedAt || 0) - Date.parse(b.lastCheckedAt || 0))
    .slice(0, PENDING_CHECK_LIMIT);
const checkedUrls = new Set(toCheck.map(item => item.url));
const remainingPending = pending.filter(item => !checkedUrls.has(item.url));

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
            newlyConfirmed.push(addition);
            continue;
        }

        remainingPending.push({
            ...candidate,
            lastCheckedAt: now,
            lastStatus: details.status || "Unknown",
            attempts: Number(candidate.attempts || 0) + 1
        });
        console.warn(
            `Active-collection candidate ${details.name} currently reports profile status ${details.status || "Unknown"}; keeping for recheck.`
        );
    } catch (error) {
        remainingPending.push({
            ...candidate,
            lastCheckedAt: now,
            attempts: Number(candidate.attempts || 0) + 1
        });
        console.warn(`Could not inspect ${candidate.url}: ${error.message}`);
    }
}

additions = uniqueByUrl(additions);
removals = uniqueByUrl(removals);
pending = uniqueByUrl(remainingPending);

const trackingStartedAt = collectorMatches ? previous?.trackingStartedAt || now : now;
const state = {
    version: 5,
    collectorId: COLLECTOR_ID,
    checkedAt: now,
    trackingStartedAt,
    activeFilter: ACTIVE_FILTER,
    activeCount: activeProfiles.length,
    activeViewReportedCount: activeSnapshot.reportedCount,
    activeProfiles,
    activeRosterSource: `${UFC_ORIGIN}/views/ajax`,
    activeRosterMode: "status23-query-post",
    additions,
    removals,
    pendingActiveAdditions: pending
};

const publicData = {
    version: 5,
    collectorId: COLLECTOR_ID,
    generatedAt: now,
    trackingStartedAt,
    activeCount: activeProfiles.length,
    activeViewReportedCount: activeSnapshot.reportedCount,
    activeRosterSource: `${UFC_ORIGIN}/views/ajax`,
    activeRosterMode: "status23-query-post",
    methodology:
        "Snapshots UFC.com's hidden Active athlete collection (status:23) and compares it with the previous verified snapshot. New entrants are published only after their UFC profile also reports Status: Active. Detection time is the first tracker run that observed the change, not a contract-signing timestamp.",
    additions: additions.slice(0, 10),
    removals: removals.slice(0, 10),
    changesThisRun: {
        added: newlyConfirmed.length,
        removed: newlyRemoved.length
    }
};

await fs.writeFile(outputStatePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(outputPublicPath, `${JSON.stringify(publicData, null, 2)}\n`);

console.log(
    `Validated active UFC roster: ${activeProfiles.length} fighters via ${UFC_ORIGIN}/views/ajax (status23-query-post).`
);
console.log(`UFC Active view reports ${activeSnapshot.reportedCount ?? "unknown"} athlete records.`);
console.log(`Detected ${newlyConfirmed.length} addition(s) and ${newlyRemoved.length} removal(s) this run.`);
console.log(`${pending.length} Active-roster candidate(s) awaiting profile confirmation.`);
for (const fighter of newlyConfirmed) console.log(`+ ${fighter.name} — ${fighter.url}`);
for (const fighter of newlyRemoved) console.log(`- ${fighter.name} — ${fighter.url}`);
