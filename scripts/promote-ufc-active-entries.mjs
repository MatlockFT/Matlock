import fs from "node:fs/promises";

const UFC_ORIGIN = "https://www.ufc.com";
const USER_AGENT =
    "Mozilla/5.0 (compatible; MMAMatlockRosterPromoter/1.0; +https://matlockfighttalk.com/)";
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const EVENT_HISTORY_LIMIT = 1000;

function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state", "/tmp/ufc-roster-state.json");
const publicPath = argument("--public", "/tmp/ufc-roster-latest.json");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

async function requestText(url) {
    let lastError;

    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(url, {
                redirect: "follow",
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                headers: {
                    "user-agent": USER_AGENT,
                    accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8"
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

function slugFromUrl(url) {
    try {
        return new URL(url).pathname.split("/").filter(Boolean).at(-1) || "";
    } catch {
        return "";
    }
}

function nameFromSlug(slug) {
    return String(slug || "")
        .split("-")
        .filter(Boolean)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

async function fighterDetails(url) {
    const html = await requestText(url);
    const plain = stripTags(html);
    const slug = slugFromUrl(url);
    const title =
        textFromMeta(html, "og:title") ||
        firstMatch(html, [/<h1[^>]*>([\s\S]*?)<\/h1>/i]).replace(/<[^>]+>/g, " ");
    const name =
        decodeHtml(title)
            .replace(/\s*\|\s*UFC.*$/i, "")
            .replace(/\s*-\s*UFC.*$/i, "")
            .replace(/\s+/g, " ")
            .trim() || nameFromSlug(slug);
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

function uniqueByEvent(items, limit = EVENT_HISTORY_LIMIT) {
    const seen = new Set();
    return items
        .filter(item => {
            if (!item?.url) return false;
            const key =
                item.eventId ||
                `${item.url}|${item.eventType || "legacy"}|${item.detectedAt || item.confirmedActiveAt || ""}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, limit);
}

const [stateRaw, publicRaw] = await Promise.all([
    fs.readFile(statePath, "utf8"),
    fs.readFile(publicPath, "utf8")
]);

const state = JSON.parse(stateRaw);
const publicData = JSON.parse(publicRaw);
const pending = Array.isArray(state.pendingActiveAdditions)
    ? state.pendingActiveAdditions
    : [];
const activeSet = new Set(Array.isArray(state.activeProfiles) ? state.activeProfiles : []);
let additions = Array.isArray(state.additions) ? state.additions : [];
const existingAdditionUrls = new Set(additions.map(item => item?.url).filter(Boolean));
const seenProfileUrls = new Set(
    Array.isArray(state.seenProfileUrls) ? state.seenProfileUrls : []
);
const retainedPending = [];
const promoted = [];
const checkedAt = new Date().toISOString();

for (const candidate of pending) {
    if (!candidate?.url || !activeSet.has(candidate.url)) continue;
    if (existingAdditionUrls.has(candidate.url)) continue;

    const detectedAt = candidate.firstDetectedAt || publicData.generatedAt || checkedAt;
    let details;
    let profileCheckError = "";

    try {
        details = await fighterDetails(candidate.url);
    } catch (error) {
        const slug = slugFromUrl(candidate.url);
        details = {
            name: nameFromSlug(slug),
            slug,
            url: candidate.url,
            image: "",
            division: "",
            record: "",
            status: "",
            description: ""
        };
        profileCheckError = String(error?.message || error);
    }

    const addition = {
        ...details,
        eventId: `${candidate.url}|added|${detectedAt}`,
        eventType: "added",
        returning: seenProfileUrls.has(candidate.url),
        detectedAt,
        confirmedActiveAt: detectedAt,
        activeCollectionDetectedAt: detectedAt,
        confirmationSource: "ufc-active-collection",
        profileStatusLastCheckedAt: checkedAt,
        profileStatusConfirmedAt: details.status === "Active" ? checkedAt : "",
        profileStatusReported: details.status || "Unknown",
        ...(profileCheckError ? { profileCheckError } : {})
    };

    additions.unshift(addition);
    promoted.push(addition);
    existingAdditionUrls.add(candidate.url);
    seenProfileUrls.add(candidate.url);

    console.log(
        `ACTIVE ENTRY ${addition.name || addition.url} — profile status ${addition.profileStatusReported}`
    );
}

for (const candidate of pending) {
    if (!candidate?.url) continue;
    if (!activeSet.has(candidate.url)) continue;
    if (!existingAdditionUrls.has(candidate.url)) retainedPending.push(candidate);
}

state.version = Math.max(Number(state.version || 0), 10);
state.additions = uniqueByEvent(additions);
state.pendingActiveAdditions = retainedPending;
state.seenProfileUrls = [...seenProfileUrls].sort();
state.activeEntryPromotion = {
    checkedAt,
    promotedCount: promoted.length,
    rule: "Entering UFC.com's status:23 Active collection is the roster-entry signal; profile Status is enrichment, not a publication gate."
};

publicData.version = Math.max(Number(publicData.version || 0), 10);
publicData.activeEntryPromotion = state.activeEntryPromotion;
if (promoted.length) {
    publicData.additions = uniqueByEvent([
        ...promoted,
        ...(Array.isArray(publicData.additions) ? publicData.additions : [])
    ]).slice(0, 10);
}

await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(publicPath, `${JSON.stringify(publicData, null, 2)}\n`);

console.log(
    `Promoted ${promoted.length} UFC Active-collection entrant(s) without waiting for profile Status: Active.`
);
