import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const CURATION_VERSION = 1;
const GENERATED_BY = "wikipedia-event-index";

const clean = value => String(value || "").replace(/\s+/g, " ").trim();

function normalizeDetail(value) {
    return clean(value)
        .replace(/\s+([,.;:!?])/g, "$1")
        .replace(/,\s*,+/g, ",")
        .replace(/\.\s*\.+$/g, ".")
        .replace(/\bU\.S\.\.$/i, "U.S.")
        .replace(/\bU\.K\.\.$/i, "U.K.")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function promotionKey(value) {
    const normalized = clean(value).toLowerCase();
    if (!normalized) return "";
    if (normalized.includes("ultimate fighting") || normalized === "ufc") return "ufc";
    if (normalized.includes("world extreme cagefighting") || normalized === "wec") return "wec";
    if (normalized.includes("bellator")) return "bellator";
    if (normalized.includes("pride")) return "pride";
    if (normalized === "pfl" || normalized.includes("professional fighters league")) return "pfl";
    if (normalized.includes("rizin")) return "rizin";
    if (normalized === "one" || normalized.includes("one championship")) return "one";
    if (normalized.includes("strikeforce")) return "strikeforce";
    return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function eventNumberFromText(value, promotion) {
    const text = clean(value).replace(/[_-]+/g, " ");
    const patterns = {
        ufc: /\bUFC\s+(?:Fight\s+Night\s+)?(\d{1,4})\b/i,
        wec: /\bWEC\s+(\d{1,4})\b/i,
        bellator: /\bBellator(?:\s+MMA)?\s+(\d{1,4})\b/i,
        pride: /\bPRIDE\s+(\d{1,4})\b/i,
        pfl: /\bPFL\s+(\d{1,4})\b/i,
        rizin: /\bRIZIN\s+(\d{1,4})\b/i,
        one: /\bONE\s+(\d{1,4})\b/i
    };
    const match = patterns[promotion]?.exec(text);
    return match?.[1] || "";
}

function eventNumberFromUrl(value, promotion) {
    let text = "";
    try {
        const url = new URL(String(value || ""));
        text = decodeURIComponent(`${url.pathname} ${url.search}`);
    } catch {
        text = String(value || "");
    }

    const patterns = {
        ufc: /\bufc[_\/-](\d{1,4})\b/i,
        wec: /\bwec[_\/-](\d{1,4})\b/i,
        bellator: /\bbellator(?:[_\/-](?:mma))?[_\/-](\d{1,4})\b/i,
        pride: /\bpride[_\/-](\d{1,4})\b/i,
        pfl: /\bpfl[_\/-](\d{1,4})\b/i,
        rizin: /\brizin[_\/-](\d{1,4})\b/i,
        one: /\bone[_\/-](\d{1,4})\b/i
    };
    return patterns[promotion]?.exec(text)?.[1] || "";
}

function eventIdentity(entry) {
    const promotion = promotionKey(entry?.promotion);
    if (!promotion) return "";
    const number = eventNumberFromText(entry?.title, promotion)
        || eventNumberFromUrl(entry?.sourceUrl, promotion)
        || eventNumberFromText(entry?.detail, promotion);
    return number ? `${promotion}:${number}` : "";
}

function isStrongCuratedMoment(entry) {
    if (!entry || entry.generatedBy === GENERATED_BY) return false;
    if (!["fight", "title", "signing", "debut", "incident", "news"].includes(entry.kind)) return false;
    return Number(entry.weight || 0) >= 78;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, "utf8"));
const entries = Array.isArray(history?.entries) ? history.entries : [];

let normalizedDetails = 0;
for (const entry of entries) {
    if (!entry?.detail) continue;
    const normalized = normalizeDetail(entry.detail);
    if (normalized && normalized !== entry.detail) {
        entry.detail = normalized;
        normalizedDetails += 1;
    }
}

const strongMomentKeys = new Map();
for (const entry of entries) {
    if (!isStrongCuratedMoment(entry)) continue;
    const identity = eventIdentity(entry);
    if (!identity || !entry.date) continue;
    const key = `${entry.date}::${identity}`;
    const existing = strongMomentKeys.get(key);
    if (!existing || Number(entry.weight || 0) > Number(existing.weight || 0)) {
        strongMomentKeys.set(key, entry);
    }
}

let suppressedGenericEvents = 0;
const curatedEntries = entries.filter(entry => {
    if (entry?.generatedBy !== GENERATED_BY) return true;
    const identity = eventIdentity(entry);
    if (!identity || !entry.date) return true;
    const stronger = strongMomentKeys.get(`${entry.date}::${identity}`);
    if (!stronger) return true;
    suppressedGenericEvents += 1;
    return false;
});

const generatedEntries = curatedEntries.filter(entry => entry?.generatedBy === GENERATED_BY);
const sourceCounts = {};
for (const entry of generatedEntries) {
    const source = entry.archiveSource || "unknown";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
}

history.entries = curatedEntries;
history.eventArchiveCount = generatedEntries.length;
history.eventArchiveSources = sourceCounts;
history.curationVersion = CURATION_VERSION;
history.curationSummary = {
    normalizedDetails,
    suppressedGenericEvents
};

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
console.log(`On This Day curation: ${normalizedDetails} details normalized, ${suppressedGenericEvents} redundant generic events suppressed.`);
