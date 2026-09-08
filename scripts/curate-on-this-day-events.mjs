import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const CURATION_VERSION = 2;
const GENERATED_BY = "wikipedia-event-index";
const TARGET_PROMOTIONS = new Set(["pancrase", "bellator", "rizin", "pride"]);

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
    if (normalized.includes("pancrase")) return "pancrase";
    if (normalized === "pfl" || normalized.includes("professional fighters league")) return "pfl";
    if (normalized.includes("rizin")) return "rizin";
    if (normalized === "one" || normalized.includes("one championship")) return "one";
    if (normalized.includes("strikeforce")) return "strikeforce";
    return normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function eventName(entry) {
    return clean(String(entry?.title || "").replace(/\s+took place$/i, ""));
}

function normalizeMatchup(value) {
    return clean(value)
        .replace(/\bversus\b/gi, "vs.")
        .replace(/\bvs\b(?!\.)/gi, "vs.")
        .replace(/[.;:,]+$/g, "")
        .trim();
}

function matchupFromTitle(entry) {
    const name = eventName(entry);
    const colon = name.indexOf(":");
    if (colon < 0) return "";
    const subtitle = clean(name.slice(colon + 1));
    if (!/\b(?:vs\.?|versus)\b/i.test(subtitle)) return "";
    return normalizeMatchup(subtitle);
}

function tournamentContext(entry, promotion) {
    const title = eventName(entry);
    if (promotion === "pancrase" && /neo[- ]?blood\s+tournament/i.test(title)) {
        return "Part of Pancrase's Neo-Blood Tournament.";
    }
    if ((promotion === "pride" || promotion === "rizin") && /grand\s+prix/i.test(title)) {
        const label = promotion === "pride" ? "PRIDE" : "RIZIN";
        return `Part of ${label}'s Grand Prix tournament.`;
    }
    return "";
}

function enrichGeneratedDetail(entry) {
    if (entry?.generatedBy !== GENERATED_BY) return false;
    const promotion = promotionKey(entry?.promotion);
    if (!TARGET_PROMOTIONS.has(promotion)) return false;

    const original = normalizeDetail(entry.detail || "");
    const parts = [];
    const mainEvent = normalizeMatchup(entry.mainEvent || matchupFromTitle(entry));
    if (mainEvent && !original.toLowerCase().includes(mainEvent.toLowerCase())) {
        parts.push(`Headlined by ${mainEvent}.`);
    }

    const tournament = tournamentContext(entry, promotion);
    if (tournament && !original.toLowerCase().includes(tournament.toLowerCase())) parts.push(tournament);
    if (original) parts.push(original);

    const enriched = normalizeDetail(parts.join(" "));
    if (!enriched || enriched === original) return false;
    entry.detail = enriched.slice(0, 320);
    return true;
}

function significanceBoost(entry) {
    if (entry?.generatedBy !== GENERATED_BY) return 0;
    const promotion = promotionKey(entry?.promotion);
    if (!TARGET_PROMOTIONS.has(promotion)) return 0;

    const title = eventName(entry);
    let boost = 0;
    if (entry.mainEvent || matchupFromTitle(entry)) boost += 7;
    if (/grand\s+prix\s+(?:final|finals)|final\s+conflict/i.test(title)) boost += 10;
    else if (/grand\s+prix|neo[- ]?blood\s+tournament|tournament\s+final/i.test(title)) boost += 7;
    if (/\bshockwave\b|\bdynamite!?\b/i.test(title)) boost += 5;
    if ((promotion === "pride" || promotion === "rizin") && /-12-31$/.test(String(entry.date || ""))) boost += 4;
    return Math.min(boost, 14);
}

function applySignificanceBoost(entry) {
    if (entry?.generatedBy !== GENERATED_BY) return false;
    const previousBoost = Number(entry.curationWeightBoost || 0);
    const baseWeight = Math.max(0, Number(entry.weight || 0) - previousBoost);
    const boost = significanceBoost(entry);
    if (!boost) {
        delete entry.curationWeightBoost;
        entry.weight = baseWeight;
        return previousBoost !== 0;
    }
    entry.curationWeightBoost = boost;
    entry.weight = baseWeight + boost;
    return boost !== previousBoost;
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

let enrichedDetails = 0;
let boostedEntries = 0;
for (const entry of entries) {
    if (enrichGeneratedDetail(entry)) enrichedDetails += 1;
    if (applySignificanceBoost(entry)) boostedEntries += 1;
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
    enrichedDetails,
    boostedEntries,
    suppressedGenericEvents
};

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
console.log(`On This Day curation: ${normalizedDetails} details normalized, ${enrichedDetails} targeted details enriched, ${boostedEntries} targeted events re-ranked, ${suppressedGenericEvents} redundant generic events suppressed.`);
