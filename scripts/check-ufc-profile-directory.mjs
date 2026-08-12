import fs from "node:fs/promises";

const UFC_ORIGIN = "https://www.ufc.com";
const ATHLETES_URL = `${UFC_ORIGIN}/athletes/all`;
const AJAX_URL = `${UFC_ORIGIN}/views/ajax?_wrapper_format=drupal_ajax`;
const SENSOR_ID = "ufc-all-athletes-drupal-post-v1";
const USER_AGENT =
    "Mozilla/5.0 (compatible; MMAMatlockProfileDirectoryMonitor/1.1; +https://matlockfighttalk.com/)";
const PAGE_CONCURRENCY = 8;
const MAX_PAGES = 360;
const MIN_DIRECTORY_PROFILES = 2000;
const MAX_REPORTED_GAP = 30;
const MAX_EVENT_CHANGE = 250;
const DISCOVERY_HISTORY_LIMIT = 500;
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;

function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state", "/tmp/ufc-roster-state.json");
const publicPath = argument("--public", "/tmp/ufc-roster-latest.json");
const previousPath = argument("--previous", "/tmp/ufc-roster/ufc-roster-state.json");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function normalizeUrl(value) {
    try {
        const url = new URL(value, UFC_ORIGIN);
        if (!["ufc.com", "www.ufc.com"].includes(url.hostname)) return null;
        if (!/^\/athlete\/[^/?#]+\/?$/.test(url.pathname)) return null;
        return `https://www.ufc.com${url.pathname.replace(/\/$/, "")}`;
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
        const url = normalizeUrl(match[1]);
        if (url) urls.add(url);
    }
    return urls;
}

function reportedCount(text) {
    const plain = text
        .replace(/\\u003c/gi, "<")
        .replace(/\\u003e/gi, ">")
        .replace(/<[^>]+>/g, " ")
        .replace(/\\n/g, " ")
        .replace(/\s+/g, " ");
    const match = plain.match(/\b(\d{2,5})\s+Athletes\b/i);
    return match ? Number(match[1]) : null;
}

function meta(html, property) {
    for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attrs = {};
        for (const item of tag[0].matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi)) {
            attrs[item[1].toLowerCase()] = decodeHtml(item[3]);
        }
        if ((attrs.property || attrs.name || "").toLowerCase() === property.toLowerCase()) {
            return (attrs.content || "").trim();
        }
    }
    return "";
}

async function request(url, options = {}) {
    let lastError;
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, {
                redirect: "follow",
                ...options,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: {
                    "user-agent": USER_AGENT,
                    accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
                    ...(options.headers || {})
                }
            });
            if (response.ok) return response;
            const preview = (await response.text()).slice(0, 300).replace(/\s+/g, " ");
            lastError = new Error(`${response.status} ${response.statusText} for ${url}: ${preview}`);
        } catch (error) {
            lastError = error;
        }
        if (attempt < REQUEST_ATTEMPTS) await sleep(750 * attempt);
    }
    throw lastError || new Error(`Request failed for ${url}`);
}

async function fetchPage(page) {
    const url = new URL(AJAX_URL);
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
                referer: ATHLETES_URL
            },
            body
        })
    ).text();
    return { urls: extractAthleteUrls(text), reportedCount: reportedCount(text) };
}

async function collectProfiles() {
    const first = await fetchPage(0);
    if (!first.urls.size) throw new Error("UFC athlete directory returned no profile URLs on page 0.");
    const urls = new Set(first.urls);
    const count = first.reportedCount;
    let emptyRun = 0;

    for (let start = 1; start < MAX_PAGES; start += PAGE_CONCURRENCY) {
        const numbers = Array.from({ length: PAGE_CONCURRENCY }, (_, i) => start + i)
            .filter(page => page < MAX_PAGES);
        const pages = await Promise.all(numbers.map(fetchPage));
        for (const page of pages) {
            if (!page.urls.size) emptyRun += 1;
            else {
                emptyRun = 0;
                for (const url of page.urls) urls.add(url);
            }
        }
        if (count && urls.size >= count) break;
        if (emptyRun >= 3) break;
    }

    if (urls.size < MIN_DIRECTORY_PROFILES) {
        throw new Error(`Only found ${urls.size} profiles in UFC's unfiltered athlete directory.`);
    }
    if (count && count - urls.size > MAX_REPORTED_GAP) {
        throw new Error(`UFC directory reports ${count} athletes but only ${urls.size} profile URLs were collected (gap ${count - urls.size}).`);
    }
    return { urls, reportedCount: count };
}

function slugFromUrl(url) {
    try {
        return new URL(url).pathname.split("/").filter(Boolean).at(-1) || "";
    } catch {
        return "";
    }
}

function nameFromSlug(slug) {
    return slug.split("-").filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

async function discoveryDetails(url) {
    const slug = slugFromUrl(url);
    try {
        const html = await (await request(url)).text();
        const title = decodeHtml(meta(html, "og:title"))
            .replace(/\s*\|\s*UFC.*$/i, "")
            .replace(/\s*-\s*UFC.*$/i, "")
            .replace(/\s+/g, " ").trim();
        return { name: title || nameFromSlug(slug), slug, url, image: meta(html, "og:image") || "" };
    } catch (error) {
        return { name: nameFromSlug(slug), slug, url, image: "", detailError: String(error?.message || error) };
    }
}

async function readJson(path, optional = false) {
    try {
        return JSON.parse(await fs.readFile(path, "utf8"));
    } catch (error) {
        if (optional && error?.code === "ENOENT") return null;
        throw error;
    }
}

function uniqueDiscoveries(items) {
    const seen = new Set();
    return items.filter(item => {
        if (!item?.url || seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    }).slice(0, DISCOVERY_HISTORY_LIMIT);
}

const checkedAt = new Date().toISOString();
const state = await readJson(statePath);
const publicData = await readJson(publicPath);
const previous = await readJson(previousPath, true);

try {
    const snapshot = await collectProfiles();
    const profiles = [...snapshot.urls].sort();
    const previousProfiles =
        previous?.profileDirectoryCollectorId === SENSOR_ID &&
        Array.isArray(previous?.profileDirectoryProfiles) &&
        previous.profileDirectoryProfiles.length >= MIN_DIRECTORY_PROFILES
            ? previous.profileDirectoryProfiles
            : null;
    let discoveries =
        previous?.profileDirectoryCollectorId === SENSOR_ID && Array.isArray(previous?.profileDiscoveries)
            ? previous.profileDiscoveries
            : [];
    const newThisRun = [];
    let baselineEstablishedAt =
        previous?.profileDirectoryCollectorId === SENSOR_ID
            ? previous?.profileDirectoryBaselineEstablishedAt || checkedAt
            : checkedAt;

    if (previousProfiles) {
        const previousSet = new Set(previousProfiles);
        const entered = profiles.filter(url => !previousSet.has(url));
        const left = previousProfiles.filter(url => !snapshot.urls.has(url));
        if (entered.length > MAX_EVENT_CHANGE || left.length > MAX_EVENT_CHANGE) {
            throw new Error(`UFC profile directory changed too sharply in one check (+${entered.length}/-${left.length}).`);
        }
        for (const url of entered) {
            const discovery = {
                ...(await discoveryDetails(url)),
                signalType: "profile-created",
                detectedAt: checkedAt,
                source: ATHLETES_URL
            };
            discoveries.unshift(discovery);
            newThisRun.push(discovery);
            console.log(`PROFILE CREATED ${discovery.name || discovery.url} — ${discovery.url}`);
        }
    } else {
        baselineEstablishedAt = checkedAt;
        console.log(`Established UFC profile-directory baseline with ${profiles.length} profiles; no historical discoveries emitted.`);
    }

    discoveries = uniqueDiscoveries(discoveries);
    Object.assign(state, {
        version: Math.max(Number(state.version || 0), 10),
        profileDirectoryCollectorId: SENSOR_ID,
        profileDirectoryCheckedAt: checkedAt,
        profileDirectoryBaselineEstablishedAt: baselineEstablishedAt,
        profileDirectoryCount: profiles.length,
        profileDirectoryReportedCount: snapshot.reportedCount,
        profileDirectoryProfiles: profiles,
        profileDiscoveries: discoveries,
        profileDirectoryLastAttempt: {
            checkedAt,
            outcome: "success",
            count: profiles.length,
            reportedCount: snapshot.reportedCount,
            newProfiles: newThisRun.length
        }
    });
    publicData.version = Math.max(Number(publicData.version || 0), 10);
    publicData.profileDirectory = {
        collectorId: SENSOR_ID,
        source: ATHLETES_URL,
        mode: "unfiltered-athlete-directory",
        checkedAt,
        baselineEstablishedAt,
        count: profiles.length,
        reportedCount: snapshot.reportedCount,
        newProfilesThisRun: newThisRun.length,
        discoveries: discoveries.slice(0, 10),
        note: "Profile creation is an early-warning signal only. A new UFC profile is not automatically treated as a roster signing."
    };
    console.log(`UFC profile-directory sensor: ${profiles.length} profiles, ${newThisRun.length} new profile(s) this run.`);
} catch (error) {
    if (previous?.profileDirectoryCollectorId === SENSOR_ID) {
        Object.assign(state, {
            profileDirectoryCollectorId: SENSOR_ID,
            profileDirectoryCheckedAt: previous.profileDirectoryCheckedAt || "",
            profileDirectoryBaselineEstablishedAt: previous.profileDirectoryBaselineEstablishedAt || "",
            profileDirectoryCount: previous.profileDirectoryCount || 0,
            profileDirectoryReportedCount: previous.profileDirectoryReportedCount ?? null,
            profileDirectoryProfiles: Array.isArray(previous.profileDirectoryProfiles) ? previous.profileDirectoryProfiles : [],
            profileDiscoveries: Array.isArray(previous.profileDiscoveries) ? previous.profileDiscoveries : []
        });
    }
    state.profileDirectoryLastAttempt = {
        checkedAt,
        outcome: "error",
        message: String(error?.message || error).slice(0, 500)
    };
    publicData.profileDirectory = {
        collectorId: SENSOR_ID,
        source: ATHLETES_URL,
        mode: "unfiltered-athlete-directory",
        checkedAt: previous?.profileDirectoryCheckedAt || "",
        baselineEstablishedAt: previous?.profileDirectoryBaselineEstablishedAt || "",
        count: previous?.profileDirectoryCount || 0,
        reportedCount: previous?.profileDirectoryReportedCount ?? null,
        newProfilesThisRun: 0,
        discoveries: Array.isArray(previous?.profileDiscoveries) ? previous.profileDiscoveries.slice(0, 10) : [],
        lastAttempt: state.profileDirectoryLastAttempt,
        note: "Profile creation is an early-warning signal only. A new UFC profile is not automatically treated as a roster signing."
    };
    console.warn(`UFC profile-directory sensor unavailable; preserved prior baseline: ${error.message}`);
}

await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(publicPath, `${JSON.stringify(publicData, null, 2)}\n`);
