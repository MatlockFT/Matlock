const ROMAN_SUFFIXES = new Set(["ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);
const GENERATIONAL_SUFFIXES = new Set(["jr", "sr", ...ROMAN_SUFFIXES]);

export const GENERIC_FIGHTER_NAMES = new Set([
    "search results",
    "search",
    "athletes",
    "all athletes",
    "ufc",
    "page not found",
    "not found",
    "access denied",
    "error"
]);

export function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

export function slugFromUrl(value) {
    try {
        return new URL(value).pathname.split("/").filter(Boolean).at(-1) || "";
    } catch {
        return "";
    }
}

export function slugFromItem(item) {
    return cleanText(item?.slug) || slugFromUrl(item?.url);
}

function formatNameToken(token) {
    const lower = String(token || "").toLowerCase();
    if (ROMAN_SUFFIXES.has(lower)) return lower.toUpperCase();
    if (lower === "jr") return "Jr.";
    if (lower === "sr") return "Sr.";
    return lower ? lower.charAt(0).toUpperCase() + lower.slice(1) : "";
}

export function nameFromSlug(slug) {
    return String(slug || "")
        .split("-")
        .filter(Boolean)
        .map(formatNameToken)
        .join(" ");
}

export function normalizeFighterName(value) {
    const candidate = cleanText(value);
    if (!candidate || GENERIC_FIGHTER_NAMES.has(candidate.toLowerCase())) return "";

    const parts = candidate.split(" ");
    const lastIndex = parts.length - 1;
    const last = parts[lastIndex]?.replace(/\.$/, "").toLowerCase();
    if (ROMAN_SUFFIXES.has(last)) parts[lastIndex] = last.toUpperCase();
    if (last === "jr") parts[lastIndex] = "Jr.";
    if (last === "sr") parts[lastIndex] = "Sr.";
    return parts.join(" ");
}

export function sanitizeFighter(item) {
    if (!item || typeof item !== "object") return item;
    const slug = slugFromItem(item);
    const name = normalizeFighterName(item.name) || nameFromSlug(slug);
    return {
        ...item,
        ...(slug ? { slug } : {}),
        ...(name ? { name } : {})
    };
}

function suffixInfo(slug) {
    const parts = String(slug || "").toLowerCase().split("-").filter(Boolean);
    const suffix = GENERATIONAL_SUFFIXES.has(parts.at(-1)) ? parts.at(-1) : "";
    return {
        suffix,
        base: suffix ? parts.slice(0, -1).join("-") : parts.join("-")
    };
}

function baseNameKey(item) {
    const name = normalizeFighterName(item?.name) || nameFromSlug(slugFromItem(item));
    const parts = cleanText(name).split(" ").filter(Boolean);
    const last = parts.at(-1)?.replace(/\.$/, "").toLowerCase();
    if (GENERATIONAL_SUFFIXES.has(last)) parts.pop();
    return parts
        .join(" ")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/gi, " ")
        .trim()
        .toLowerCase();
}

function weakProfile(item) {
    const populated = [item?.image, item?.division, item?.record, item?.status, item?.description]
        .map(cleanText)
        .filter(Boolean).length;
    return populated <= 1;
}

function aliasUrls(item) {
    return new Set([
        cleanText(item?.url),
        ...(Array.isArray(item?.profileAliases) ? item.profileAliases.map(cleanText) : [])
    ].filter(Boolean));
}

export function likelySameFighter(a, b) {
    const aUrl = cleanText(a?.url).toLowerCase();
    const bUrl = cleanText(b?.url).toLowerCase();
    if (aUrl && bUrl && aUrl === bUrl) return true;

    const aAliases = aliasUrls(a);
    const bAliases = aliasUrls(b);
    if ([...aAliases].some(url => bAliases.has(url))) return true;

    const aSlug = slugFromItem(a).toLowerCase();
    const bSlug = slugFromItem(b).toLowerCase();
    if (!aSlug || !bSlug) return false;
    if (aSlug === bSlug) return true;

    const aInfo = suffixInfo(aSlug);
    const bInfo = suffixInfo(bSlug);
    if (!aInfo.base || aInfo.base !== bInfo.base) return false;

    // Only auto-collapse a bare/suffixed slug pair. Two explicit suffixes may be different people.
    if (Boolean(aInfo.suffix) === Boolean(bInfo.suffix)) return false;
    if (baseNameKey(a) !== baseNameKey(b)) return false;

    if (cleanText(a?.eventCardUrl) && cleanText(a?.eventCardUrl) === cleanText(b?.eventCardUrl)) {
        return true;
    }
    if (cleanText(a?.octagonDebutAt) && cleanText(a?.octagonDebutAt) === cleanText(b?.octagonDebutAt)) {
        return true;
    }

    // UFC occasionally leaves an old weak profile beside a newly suffixed replacement.
    // Weak-profile aliasing repairs that case without collapsing two fully populated profiles.
    return weakProfile(a) || weakProfile(b);
}

function metadataScore(item) {
    return [item?.image, item?.division, item?.record, item?.status, item?.description]
        .map(cleanText)
        .filter(Boolean).length;
}

function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function hasGenerationalSuffix(item) {
    return Boolean(suffixInfo(slugFromItem(item)).suffix);
}

function choosePrimary(a, b, rank) {
    const aRank = Number(rank(a) || 0);
    const bRank = Number(rank(b) || 0);
    if (aRank !== bRank) return aRank > bRank ? a : b;

    if (likelySameFighter(a, b) && hasGenerationalSuffix(a) !== hasGenerationalSuffix(b)) {
        return hasGenerationalSuffix(a) ? a : b;
    }

    const aScore = metadataScore(a);
    const bScore = metadataScore(b);
    if (aScore !== bScore) return aScore > bScore ? a : b;

    const aTime = timestamp(a?.detectedAt || a?.confirmedActiveAt || a?.confirmedInactiveAt);
    const bTime = timestamp(b?.detectedAt || b?.confirmedActiveAt || b?.confirmedInactiveAt);
    return aTime <= bTime ? a : b;
}

function earliestIso(...values) {
    const valid = values
        .map(value => ({ value, time: Date.parse(value || "") }))
        .filter(item => Number.isFinite(item.time))
        .sort((a, b) => a.time - b.time);
    return valid[0]?.value || "";
}

export function mergeFighterRecords(a, b, rank = () => 0) {
    const primary = choosePrimary(a, b, rank);
    const secondary = primary === a ? b : a;
    const merged = { ...secondary, ...primary };

    for (const field of ["image", "division", "record", "status", "description", "octagonDebut", "octagonDebutAt"]) {
        if (!cleanText(merged[field]) && cleanText(secondary?.[field])) merged[field] = secondary[field];
    }

    const aliases = new Set([
        ...aliasUrls(a),
        ...aliasUrls(b)
    ]);
    aliases.delete(cleanText(merged.url));
    if (aliases.size) merged.profileAliases = [...aliases].sort();
    else delete merged.profileAliases;

    const detectedAt = earliestIso(a?.detectedAt, b?.detectedAt);
    if (detectedAt) merged.detectedAt = detectedAt;
    const confirmedActiveAt = earliestIso(a?.confirmedActiveAt, b?.confirmedActiveAt);
    if (confirmedActiveAt) merged.confirmedActiveAt = confirmedActiveAt;
    const confirmedInactiveAt = earliestIso(a?.confirmedInactiveAt, b?.confirmedInactiveAt);
    if (confirmedInactiveAt) merged.confirmedInactiveAt = confirmedInactiveAt;

    return sanitizeFighter(merged);
}

export function dedupeFighterEvents(items, { limit = 1000, rank = () => 0 } = {}) {
    const output = [];

    for (const raw of Array.isArray(items) ? items : []) {
        const item = sanitizeFighter(raw);
        const index = output.findIndex(existing => likelySameFighter(existing, item));
        if (index >= 0) output[index] = mergeFighterRecords(output[index], item, rank);
        else output.push(item);
    }

    return output
        .sort(
            (a, b) =>
                timestamp(b?.detectedAt || b?.confirmedActiveAt || b?.confirmedInactiveAt) -
                timestamp(a?.detectedAt || a?.confirmedActiveAt || a?.confirmedInactiveAt)
        )
        .slice(0, limit);
}
