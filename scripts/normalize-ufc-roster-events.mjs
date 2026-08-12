import fs from "node:fs/promises";

function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state", "/tmp/ufc-roster-state.json");
const publicPath = argument("--public", "/tmp/ufc-roster-latest.json");
const finalizePublic = process.argv.includes("--finalize-public");

const GENERIC_FIGHTER_NAMES = new Set([
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

function timestamp(value) {
    const parsed = Date.parse(value || "");
    return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
}

function slugFromItem(item) {
    if (item?.slug) return String(item.slug);

    try {
        return new URL(item?.url || "")
            .pathname
            .split("/")
            .filter(Boolean)
            .at(-1) || "";
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

function sanitizeFighterName(item) {
    if (!item || typeof item !== "object") return item;

    const candidate = String(item.name || "")
        .replace(/\s+/g, " ")
        .trim();

    if (
        candidate &&
        !GENERIC_FIGHTER_NAMES.has(candidate.toLowerCase())
    ) {
        return item;
    }

    const fallback = nameFromSlug(slugFromItem(item));
    return fallback ? { ...item, name: fallback } : item;
}

function rank(item) {
    if (
        item?.entryClass === "newcomer" &&
        item?.competitionCheckedAt &&
        item?.priorUfcCompetition === false
    ) {
        return 40;
    }
    if (item?.confirmationSource === "official-ufc-event-card") return 30;
    if (item?.competitionCheckedAt) return 20;
    return 10;
}

function prefer(a, b) {
    const aRank = rank(a);
    const bRank = rank(b);
    if (aRank !== bRank) return aRank > bRank ? a : b;

    const aTime = timestamp(a?.detectedAt || a?.confirmedActiveAt);
    const bTime = timestamp(b?.detectedAt || b?.confirmedActiveAt);
    return aTime <= bTime ? a : b;
}

function dedupeAdditions(items) {
    const byUrl = new Map();
    const withoutUrl = [];

    for (const item of Array.isArray(items) ? items : []) {
        if (!item?.url) {
            withoutUrl.push(item);
            continue;
        }
        const existing = byUrl.get(item.url);
        byUrl.set(item.url, existing ? prefer(existing, item) : item);
    }

    return [...byUrl.values(), ...withoutUrl].sort(
        (a, b) => timestamp(b?.detectedAt || b?.confirmedActiveAt) - timestamp(a?.detectedAt || a?.confirmedActiveAt)
    );
}

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
const publicData = JSON.parse(await fs.readFile(publicPath, "utf8"));
const before = Array.isArray(state.additions) ? state.additions.length : 0;
const normalizedAdditions = (Array.isArray(state.additions) ? state.additions : [])
    .map(sanitizeFighterName);
state.additions = dedupeAdditions(normalizedAdditions);
const removedDuplicates = before - state.additions.length;
state.version = Math.max(Number(state.version || 0), 9);

if (finalizePublic) {
    const verified = state.additions
        .filter(
            item =>
                item?.entryClass === "newcomer" &&
                item?.competitionCheckedAt &&
                item?.priorUfcCompetition === false
        )
        .slice(0, 10);

    publicData.version = Math.max(Number(publicData.version || 0), 9);
    publicData.additions = verified;
    publicData.methodology =
        "Tracks UFC.com's hidden Active athlete collection and also cross-checks official standard UFC event cards for first-time UFC fighters whose athlete profile may have existed earlier. TUF, Dana White's Contender Series, Road to UFC, and other developmental or qualifying pages are not treated as roster confirmation. Entrants are cross-checked for prior standard UFC competition before appearing as newcomers. Detection time is when this tracker first confirmed the roster change, not a contract-signing timestamp.";

    const generatedAt = publicData.generatedAt;
    const confirmedThisRun = item =>
        item?.confirmedActiveAt && item.confirmedActiveAt === generatedAt;

    publicData.changesThisRun = {
        added: verified.filter(confirmedThisRun).length,
        reactivated: (Array.isArray(publicData.reactivations) ? publicData.reactivations : []).filter(confirmedThisRun).length,
        removed: Number(publicData?.changesThisRun?.removed || 0)
    };
}

await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(publicPath, `${JSON.stringify(publicData, null, 2)}\n`);

console.log(
    `${finalizePublic ? "Finalized" : "Normalized"} UFC roster event history; removed ${removedDuplicates} duplicate newcomer event(s).`
);
