import fs from "node:fs/promises";

const UFC_ORIGIN = "https://www.ufc.com";
const EVENTS_URL = `${UFC_ORIGIN}/events`;
const USER_AGENT =
    "Mozilla/5.0 (compatible; MMAMatlockEventCardMonitor/1.0; +https://matlockfighttalk.com/)";
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const MIN_EVENT_COUNT = 2;
const MIN_TOTAL_ATHLETES = 20;
const MAX_EVENT_PAGES = 20;
const MAX_FUTURE_DAYS = 180;
const NEAR_EVENT_DAYS = 7;

function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state", "/tmp/ufc-roster-state.json");
const publicPath = argument("--public", "/tmp/ufc-roster-latest.json");
const previousPath = argument("--previous", "/tmp/ufc-roster/ufc-roster-state.json");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function decodeHtml(value = "") {
    return value
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#039;|&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
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

function textFromMeta(html, property) {
    for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
        const attributes = {};
        for (const attribute of tag[0].matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi)) {
            attributes[attribute[1].toLowerCase()] = decodeHtml(attribute[3]);
        }
        if (
            (attributes.property || attributes.name || "").toLowerCase() ===
            property.toLowerCase()
        ) {
            return (attributes.content || "").trim();
        }
    }
    return "";
}

function firstMatch(text, patterns) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1].trim();
    }
    return "";
}

function normalizeAthleteUrl(value) {
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

function normalizeEventUrl(value) {
    try {
        const url = new URL(value, UFC_ORIGIN);
        if (url.hostname !== "www.ufc.com" && url.hostname !== "ufc.com") return null;
        if (!/^\/event\/[^/?#]+\/?$/.test(url.pathname)) return null;
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

function isStandardUfcEventUrl(value) {
    try {
        const pathname = new URL(value).pathname.toLowerCase();
        if (
            pathname.includes("contender") ||
            pathname.includes("dwcs") ||
            pathname.includes("ultimate-fighter") ||
            pathname.includes("road-to-ufc") ||
            pathname.includes("fight-pass")
        ) {
            return false;
        }
        return /^\/event\/(?:ufc-|noche-ufc|ufc-noche)/.test(pathname);
    } catch {
        return false;
    }
}

async function requestText(url, options = {}) {
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

            if (response.ok) return response.text();

            const preview = (await response.text()).slice(0, 250).replace(/\s+/g, " ");
            lastError = new Error(
                `${response.status} ${response.statusText} for ${url}: ${preview}`
            );
        } catch (error) {
            lastError = error;
        }

        if (attempt < REQUEST_ATTEMPTS) await sleep(750 * attempt);
    }

    throw lastError || new Error(`Request failed for ${url}`);
}

async function readJson(path, optional = false) {
    try {
        return JSON.parse(await fs.readFile(path, "utf8"));
    } catch (error) {
        if (optional && error?.code === "ENOENT") return null;
        throw error;
    }
}

async function writeJson(path, value) {
    await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function extractEventUrls(html) {
    const decoded = decodeHtml(html).replaceAll("\\/", "/");
    const urls = new Set();

    for (const match of decoded.matchAll(/(?:href\s*=\s*["'])?((?:https?:\/\/(?:www\.)?ufc\.com)?\/event\/[a-z0-9][a-z0-9-]*)(?=[?#["'<>\s\\]|$)/gi)) {
        const normalized = normalizeEventUrl(match[1]);
        if (normalized && isStandardUfcEventUrl(normalized)) urls.add(normalized);
    }

    return urls;
}

function extractAthleteUrls(html) {
    const decoded = decodeHtml(html).replaceAll("\\/", "/");
    const urls = new Set();

    for (const match of decoded.matchAll(/(?:https?:\/\/(?:www\.)?ufc\.com)?(\/athlete\/[a-z0-9][a-z0-9-]*)(?=[/?#["'<>\s\\]|$)/gi)) {
        const normalized = normalizeAthleteUrl(match[1]);
        if (normalized) urls.add(normalized);
    }

    return [...urls].sort();
}

const MONTHS = new Map([
    ["jan", 0], ["january", 0],
    ["feb", 1], ["february", 1],
    ["mar", 2], ["march", 2],
    ["apr", 3], ["april", 3],
    ["may", 4],
    ["jun", 5], ["june", 5],
    ["jul", 6], ["july", 6],
    ["aug", 7], ["august", 7],
    ["sep", 8], ["sept", 8], ["september", 8],
    ["oct", 9], ["october", 9],
    ["nov", 10], ["november", 10],
    ["dec", 11], ["december", 11]
]);

function inferCalendarDate(monthName, day, year = null) {
    const month = MONTHS.get(String(monthName || "").toLowerCase());
    if (month === undefined) return "";
    const now = new Date();
    const selectedYear = year || now.getUTCFullYear();
    let date = new Date(Date.UTC(selectedYear, month, Number(day), 12));

    if (!year) {
        const deltaDays = (date.getTime() - now.getTime()) / 86400000;
        if (deltaDays < -180) date = new Date(Date.UTC(selectedYear + 1, month, Number(day), 12));
        if (deltaDays > 300) date = new Date(Date.UTC(selectedYear - 1, month, Number(day), 12));
    }

    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function eventStartAt(html, eventUrl) {
    const pathname = new URL(eventUrl).pathname;
    const urlDate = pathname.match(
        /(january|february|march|april|may|june|july|august|september|october|november|december)-(\d{1,2})-(\d{4})/i
    );
    if (urlDate) return inferCalendarDate(urlDate[1], urlDate[2], Number(urlDate[3]));

    const startDate = html.match(/["']startDate["']\s*:\s*["']([^"']+)["']/i);
    if (startDate?.[1]) {
        const parsed = Date.parse(decodeHtml(startDate[1]));
        if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
    }

    const plain = stripTags(html);
    const visibleDate = plain.match(
        /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+(\d{1,2})\b/i
    );
    return visibleDate ? inferCalendarDate(visibleDate[1], visibleDate[2]) : "";
}

function eventTitle(html, url) {
    const meta = textFromMeta(html, "og:title");
    const heading = firstMatch(html, [/<h1[^>]*>([\s\S]*?)<\/h1>/i]);
    const cleanedHeading = stripTags(heading);
    return (
        meta
            .replace(/\s*\|\s*UFC.*$/i, "")
            .trim() ||
        cleanedHeading ||
        new URL(url).pathname.split("/").filter(Boolean).at(-1).replaceAll("-", " ")
    );
}

function parseDateLabel(value) {
    if (!value) return "";
    const normalized = value.replace(/\b([A-Za-z]{3})\.\s+/g, "$1 ");
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
}

function parseSlashDate(value) {
    const match = String(value || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!match) return "";
    const month = Number(match[1]);
    const day = Number(match[2]);
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function dayNumber(value) {
    const parsed = Date.parse(value || "");
    if (Number.isNaN(parsed)) return null;
    const date = new Date(parsed);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function completedUfcResultEvidence(plain) {
    const resultVerb =
        "(?:won|lost|defeated|submitted|knocked out|stopped|was submitted|was knocked out)";
    const event =
        "(?:UFC\\s+\\d{1,3}|UFC\\s+Fight Night(?:\\s+[^()]*)?|UFC\\s+on\\s+(?:ESPN|ABC|FOX|FX|FUEL|Versus)(?:\\s+[^()]*)?)";
    const pattern = new RegExp(
        `\\b(${event}\\s*\\(\\s*(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})\\s*\\).{0,240}?\\b${resultVerb}\\b.{0,180})`,
        "i"
    );
    const match = plain.match(pattern);
    if (!match?.[1]) return null;
    return {
        text: match[1].trim(),
        occurredAt: parseSlashDate(match[2])
    };
}

function profileCompetition(html, observedAt) {
    const plain = stripTags(html);
    const octagonDebut = firstMatch(plain, [
        /\bOctagon Debut\s+([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4})\b/i
    ]);
    const octagonDebutAt = parseDateLabel(octagonDebut);
    const completedResult = completedUfcResultEvidence(plain);
    const observedDay = dayNumber(observedAt);
    const resultDay = dayNumber(completedResult?.occurredAt);
    const debutDay = dayNumber(octagonDebutAt);

    if (
        completedResult &&
        observedDay !== null &&
        resultDay !== null &&
        resultDay < observedDay
    ) {
        return {
            priorUfcCompetition: true,
            evidence: completedResult.text.slice(0, 320),
            octagonDebut,
            octagonDebutAt
        };
    }

    if (debutDay !== null && observedDay !== null && debutDay < observedDay) {
        return {
            priorUfcCompetition: true,
            evidence: `Octagon Debut ${octagonDebut}`,
            octagonDebut,
            octagonDebutAt
        };
    }

    return {
        priorUfcCompetition: false,
        evidence: octagonDebut
            ? `Octagon Debut ${octagonDebut}`
            : "No prior standard UFC competition found on UFC profile",
        octagonDebut,
        octagonDebutAt
    };
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

async function fighterDetails(url, observedAt) {
    const html = await requestText(url);
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
        description: textFromMeta(html, "description") || "",
        competition: profileCompetition(html, observedAt)
    };
}

function daysFromNow(value) {
    const parsed = Date.parse(value || "");
    if (Number.isNaN(parsed)) return null;
    return (parsed - Date.now()) / 86400000;
}

function eventSnapshotMap(value) {
    const map = new Map();
    for (const event of Array.isArray(value) ? value : []) {
        if (!event?.url) continue;
        map.set(event.url, new Set(Array.isArray(event.athletes) ? event.athletes : []));
    }
    return map;
}

function knownNewcomerUrls(state, publicData) {
    const urls = new Set();
    for (const item of Array.isArray(state?.additions) ? state.additions : []) {
        if (item?.url) urls.add(item.url);
    }
    for (const item of Array.isArray(publicData?.additions) ? publicData.additions : []) {
        if (item?.url) urls.add(item.url);
    }
    for (const url of Array.isArray(publicData?.activeBackfillUrls) ? publicData.activeBackfillUrls : []) {
        const normalized = normalizeAthleteUrl(url);
        if (normalized) urls.add(normalized);
    }
    return urls;
}

function preservePreviousMonitor(state, previous, checkedAt, error) {
    if (previous?.eventCardMonitor) state.eventCardMonitor = previous.eventCardMonitor;
    state.eventCardLastAttempt = {
        checkedAt,
        outcome: "error",
        message: String(error?.message || error).slice(0, 500)
    };
}

const checkedAt = new Date().toISOString();
const state = await readJson(statePath);
const publicData = await readJson(publicPath);
const previous = await readJson(previousPath, true);

try {
    const eventsHtml = await requestText(EVENTS_URL);
    const eventUrls = [...extractEventUrls(eventsHtml)].slice(0, MAX_EVENT_PAGES);

    if (eventUrls.length < MIN_EVENT_COUNT) {
        throw new Error(`Only found ${eventUrls.length} standard UFC event URL(s) on UFC's events page.`);
    }

    const events = [];

    for (const url of eventUrls) {
        const html = await requestText(url);
        const startAt = eventStartAt(html, url);
        const delta = daysFromNow(startAt);
        if (delta !== null && (delta < -2 || delta > MAX_FUTURE_DAYS)) continue;

        const athletes = extractAthleteUrls(html);
        if (athletes.length < 2) continue;

        events.push({
            url,
            title: eventTitle(html, url),
            startAt,
            athletes
        });
    }

    const totalAthletes = events.reduce((sum, event) => sum + event.athletes.length, 0);
    if (events.length < MIN_EVENT_COUNT || totalAthletes < MIN_TOTAL_ATHLETES) {
        throw new Error(
            `Parsed only ${events.length} upcoming standard UFC event(s) and ${totalAthletes} athlete slots; refusing to replace the previous event-card snapshot.`
        );
    }

    const previousMap = eventSnapshotMap(previous?.eventCardMonitor?.events);
    const hasBaseline = previousMap.size >= MIN_EVENT_COUNT;
    const knownUrls = knownNewcomerUrls(state, publicData);
    const generatedAt = publicData.generatedAt || checkedAt;
    const candidates = [];

    for (const event of events) {
        const previousAthletes = previousMap.get(event.url) || new Set();
        const deltaDays = daysFromNow(event.startAt);
        const nearEvent = deltaDays !== null && deltaDays >= -1 && deltaDays <= NEAR_EVENT_DAYS;

        for (const url of event.athletes) {
            if (knownUrls.has(url)) continue;
            if (hasBaseline && !nearEvent && previousAthletes.has(url)) continue;
            candidates.push({ url, event });
        }
    }

    let additions = Array.isArray(state.additions) ? state.additions : [];
    const confirmed = [];

    for (const candidate of candidates) {
        if (knownUrls.has(candidate.url)) continue;

        try {
            const details = await fighterDetails(candidate.url, checkedAt);
            if (details.competition.priorUfcCompetition) continue;

            const addition = {
                name: details.name,
                slug: details.slug,
                url: details.url,
                image: details.image,
                division: details.division,
                record: details.record,
                status: details.status,
                description: details.description,
                octagonDebut: details.competition.octagonDebut,
                octagonDebutAt: details.competition.octagonDebutAt,
                eventId: `${details.url}|event-card|${candidate.event.url}`,
                eventType: "added",
                returning: false,
                detectedAt: checkedAt,
                confirmedActiveAt: generatedAt,
                confirmationSource: "official-ufc-event-card",
                eventCardUrl: candidate.event.url,
                eventCardTitle: candidate.event.title,
                eventCardStartAt: candidate.event.startAt
            };

            additions.unshift(addition);
            knownUrls.add(details.url);
            confirmed.push(addition);
            console.log(
                `EVENT-CARD NEWCOMER ${addition.name} — ${candidate.event.title} — ${addition.url}`
            );
        } catch (error) {
            console.warn(
                `Could not inspect event-card candidate ${candidate.url}: ${error.message}`
            );
        }
    }

    state.version = Math.max(Number(state.version || 0), 9);
    state.additions = additions;
    state.eventCardMonitor = {
        source: EVENTS_URL,
        checkedAt,
        baselineEstablishedAt:
            previous?.eventCardMonitor?.baselineEstablishedAt || checkedAt,
        eventCount: events.length,
        athleteSlotCount: totalAthletes,
        events
    };
    state.eventCardLastAttempt = {
        checkedAt,
        outcome: "success",
        eventCount: events.length,
        athleteSlotCount: totalAthletes,
        newcomerCount: confirmed.length
    };

    await writeJson(statePath, state);

    console.log(
        `Official UFC event-card cross-check: ${events.length} event(s), ${totalAthletes} athlete slots, ${confirmed.length} first-time UFC newcomer(s) confirmed this run.`
    );
} catch (error) {
    preservePreviousMonitor(state, previous, checkedAt, error);
    await writeJson(statePath, state);
    console.warn(
        `Official UFC event-card cross-check unavailable; primary roster publication will continue: ${error.message}`
    );
}
