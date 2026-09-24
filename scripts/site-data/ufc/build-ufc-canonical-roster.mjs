import fs from "node:fs/promises";
import {
    cleanText,
    nameFromSlug,
    normalizeFighterName,
    sanitizeFighter,
    slugFromUrl
} from "./ufc-roster-identity.mjs";

function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state", "/tmp/ufc-roster-state.json");
const publicPath = argument("--public", "/tmp/ufc-roster-latest.json");
const selfTest = process.argv.includes("--self-test");
const REGISTRY_VERSION = 1;

function normalizeUrl(value) {
    try {
        const url = new URL(cleanText(value));
        if (!/^https?:$/.test(url.protocol)) return "";
        if (!/(^|\.)ufc\.com$/i.test(url.hostname)) return "";
        if (!/^\/athlete\/[^/?#]+\/?$/i.test(url.pathname)) return "";
        url.protocol = "https:";
        url.hostname = "www.ufc.com";
        url.search = "";
        url.hash = "";
        url.pathname = url.pathname.replace(/\/$/, "");
        return url.toString();
    } catch {
        return "";
    }
}

class UnionFind {
    constructor() {
        this.parent = new Map();
    }

    add(value) {
        if (value && !this.parent.has(value)) this.parent.set(value, value);
    }

    find(value) {
        this.add(value);
        const parent = this.parent.get(value);
        if (parent === value) return value;
        const root = this.find(parent);
        this.parent.set(value, root);
        return root;
    }

    union(a, b) {
        if (!a || !b) return;
        const rootA = this.find(a);
        const rootB = this.find(b);
        if (rootA !== rootB) this.parent.set(rootB, rootA);
    }
}

function urlsFromRecord(item) {
    return [
        normalizeUrl(item?.canonicalUrl),
        normalizeUrl(item?.url),
        ...(Array.isArray(item?.profileAliases) ? item.profileAliases.map(normalizeUrl) : []),
        ...(Array.isArray(item?.activeProfileUrls) ? item.activeProfileUrls.map(normalizeUrl) : [])
    ].filter(Boolean);
}

function metadataScore(item) {
    let score = 0;
    if (cleanText(item?.name)) score += 10;
    if (cleanText(item?.division)) score += 4;
    if (cleanText(item?.record)) score += 4;
    if (cleanText(item?.status)) score += 3;
    if (cleanText(item?.image)) score += 2;
    if (cleanText(item?.description)) score += 1;
    if (Array.isArray(item?.profileAliases) && item.profileAliases.length) score += 40;
    if (cleanText(item?.fighterId)) score += 80;
    if (cleanText(item?.canonicalUrl)) score += 20;
    return score;
}

function recordLists(state, publicData) {
    return [
        state?.additions,
        state?.reactivations,
        state?.removals,
        state?.pendingActiveAdditions,
        state?.pendingRemovals,
        publicData?.additions,
        publicData?.reactivations,
        publicData?.removals,
        state?.canonicalFighters
    ].flatMap(list => Array.isArray(list) ? list : []);
}

function suffixPairKey(url) {
    const slug = slugFromUrl(url).toLowerCase();
    const parts = slug.split("-").filter(Boolean);
    const suffixes = new Set(["jr", "sr", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);
    const suffix = suffixes.has(parts.at(-1)) ? parts.pop() : "";
    return { base: parts.join("-"), suffix };
}

function canonicalize(state, publicData) {
    const union = new UnionFind();
    const activeProfiles = (Array.isArray(state?.activeProfiles) ? state.activeProfiles : [])
        .map(normalizeUrl)
        .filter(Boolean);
    const activeSet = new Set(activeProfiles);
    const records = recordLists(state, publicData);

    for (const url of activeProfiles) union.add(url);

    for (const record of records) {
        const urls = urlsFromRecord(record);
        urls.forEach(url => union.add(url));
        if (urls.length > 1) {
            const [first, ...rest] = urls;
            rest.forEach(url => union.union(first, url));
        }
    }

    const groups = new Map();
    for (const url of union.parent.keys()) {
        const root = union.find(url);
        if (!groups.has(root)) groups.set(root, new Set());
        groups.get(root).add(url);
    }

    const priorRegistry = Array.isArray(state?.canonicalFighters) ? state.canonicalFighters : [];
    const registry = [];
    const urlToFighterId = new Map();

    for (const urlsSet of groups.values()) {
        const urls = [...urlsSet].sort();
        const matchingPrior = priorRegistry.filter(item => urlsFromRecord(item).some(url => urlsSet.has(url)));
        const priorIds = [...new Set(matchingPrior.map(item => cleanText(item?.fighterId)).filter(Boolean))];
        if (priorIds.length > 1) {
            throw new Error(`Canonical registry conflict: ${urls.join(", ")} maps to multiple fighter IDs (${priorIds.join(", ")}).`);
        }

        const candidates = records
            .filter(item => urlsFromRecord(item).some(url => urlsSet.has(url)))
            .map(item => sanitizeFighter(item))
            .sort((a, b) => metadataScore(b) - metadataScore(a));

        const priorPrimary = matchingPrior.find(item => urlsSet.has(normalizeUrl(item?.canonicalUrl)));
        const evidencePrimary = candidates.find(item => {
            const url = normalizeUrl(item?.url || item?.canonicalUrl);
            return url && urlsSet.has(url) && Array.isArray(item?.profileAliases) && item.profileAliases.length;
        });
        const scoredPrimary = candidates.find(item => urlsSet.has(normalizeUrl(item?.url || item?.canonicalUrl)));
        const preferredUrl = normalizeUrl(priorPrimary?.canonicalUrl)
            || normalizeUrl(evidencePrimary?.url)
            || normalizeUrl(scoredPrimary?.url || scoredPrimary?.canonicalUrl)
            || (urls.find(url => activeSet.has(url)) || urls[0]);
        const slug = slugFromUrl(preferredUrl);
        const chosenName = normalizeFighterName(
            priorPrimary?.name || evidencePrimary?.name || scoredPrimary?.name || ""
        ) || nameFromSlug(slug);
        const fighterId = priorIds[0] || `ufc:${slug}`;
        const activeProfileUrls = urls.filter(url => activeSet.has(url));
        const profileAliases = urls.filter(url => url !== preferredUrl);

        const entry = {
            fighterId,
            name: chosenName,
            canonicalUrl: preferredUrl,
            ...(profileAliases.length ? { profileAliases } : {}),
            active: activeProfileUrls.length > 0,
            ...(activeProfileUrls.length ? { activeProfileUrls } : {})
        };

        const best = candidates[0] || {};
        for (const field of ["division", "record", "status"]) {
            if (cleanText(best?.[field])) entry[field] = best[field];
        }

        registry.push(entry);
        urls.forEach(url => urlToFighterId.set(url, fighterId));
    }

    registry.sort((a, b) => a.fighterId.localeCompare(b.fighterId));
    const activeFighterIds = [...new Set(activeProfiles.map(url => urlToFighterId.get(url)).filter(Boolean))].sort();

    function attachFighterIds(items) {
        return (Array.isArray(items) ? items : []).map(item => {
            const urls = urlsFromRecord(item);
            const fighterId = urls.map(url => urlToFighterId.get(url)).find(Boolean) || cleanText(item?.fighterId);
            return fighterId ? { ...item, fighterId } : item;
        });
    }

    for (const field of ["additions", "reactivations", "removals", "pendingActiveAdditions", "pendingRemovals"]) {
        if (Array.isArray(state?.[field])) state[field] = attachFighterIds(state[field]);
    }
    for (const field of ["additions", "reactivations", "removals"]) {
        if (Array.isArray(publicData?.[field])) publicData[field] = attachFighterIds(publicData[field]);
    }

    const suspiciousActivePairs = [];
    const byBase = new Map();
    for (const url of activeProfiles) {
        const info = suffixPairKey(url);
        if (!info.base) continue;
        if (!byBase.has(info.base)) byBase.set(info.base, []);
        byBase.get(info.base).push({ url, ...info, fighterId: urlToFighterId.get(url) || "" });
    }
    for (const [base, values] of byBase) {
        if (values.length < 2) continue;
        for (let i = 0; i < values.length; i += 1) {
            for (let j = i + 1; j < values.length; j += 1) {
                const a = values[i];
                const b = values[j];
                const bareSuffixPair = Boolean(a.suffix) !== Boolean(b.suffix);
                if (bareSuffixPair && a.fighterId && b.fighterId && a.fighterId !== b.fighterId) {
                    suspiciousActivePairs.push({ base, urls: [a.url, b.url] });
                }
            }
        }
    }

    const aliasGroups = registry.filter(item => (item.profileAliases?.length || 0) > 0);
    const identityAudit = {
        registryVersion: REGISTRY_VERSION,
        rawActiveProfileCount: activeProfiles.length,
        canonicalActiveCount: activeFighterIds.length,
        collapsedActiveProfiles: activeProfiles.length - activeFighterIds.length,
        canonicalRegistryCount: registry.length,
        aliasGroupCount: aliasGroups.length,
        suspiciousActivePairCount: suspiciousActivePairs.length,
        suspiciousActivePairs: suspiciousActivePairs.slice(0, 50)
    };

    state.version = Math.max(Number(state.version || 0), 12);
    state.canonicalRegistryVersion = REGISTRY_VERSION;
    state.activeProfileCount = activeProfiles.length;
    state.activeCount = activeFighterIds.length;
    state.activeFighterIds = activeFighterIds;
    state.canonicalFighters = registry;
    state.identityAudit = identityAudit;

    publicData.version = Math.max(Number(publicData.version || 0), 12);
    publicData.activeProfileCount = activeProfiles.length;
    publicData.activeCount = activeFighterIds.length;
    publicData.identityAudit = {
        registryVersion: REGISTRY_VERSION,
        rawActiveProfileCount: identityAudit.rawActiveProfileCount,
        canonicalActiveCount: identityAudit.canonicalActiveCount,
        collapsedActiveProfiles: identityAudit.collapsedActiveProfiles,
        aliasGroupCount: identityAudit.aliasGroupCount,
        suspiciousActivePairCount: identityAudit.suspiciousActivePairCount
    };

    return { state, publicData, identityAudit };
}

function runSelfTest() {
    const state = {
        activeProfiles: [
            "https://www.ufc.com/athlete/sean-king",
            "https://www.ufc.com/athlete/sean-king-iii",
            "https://www.ufc.com/athlete/jane-doe",
            "https://www.ufc.com/athlete/john-smith",
            "https://www.ufc.com/athlete/john-smith-jr"
        ],
        additions: [{
            name: "Sean King III",
            slug: "sean-king-iii",
            url: "https://www.ufc.com/athlete/sean-king-iii",
            profileAliases: ["https://www.ufc.com/athlete/sean-king"],
            eventId: "sean-added",
            detectedAt: "2026-09-08T00:00:00.000Z"
        }]
    };
    const publicData = { additions: [...state.additions], removals: [] };
    const result = canonicalize(state, publicData);
    if (result.state.activeProfileCount !== 5) throw new Error("Self-test raw active profile count failed.");
    if (result.state.activeCount !== 4) throw new Error(`Self-test canonical count failed: ${result.state.activeCount}`);
    const sean = result.state.canonicalFighters.find(item => item.canonicalUrl.endsWith("/sean-king-iii"));
    if (!sean || sean.name !== "Sean King III") throw new Error("Self-test Sean King canonical identity failed.");
    if (!sean.profileAliases?.some(url => url.endsWith("/sean-king"))) throw new Error("Self-test Sean King alias retention failed.");
    if (result.state.additions[0].fighterId !== sean.fighterId) throw new Error("Self-test event migration to fighterId failed.");
    if (result.identityAudit.suspiciousActivePairCount !== 1) throw new Error("Self-test suspicious bare/suffix pair audit failed.");
    console.log("Canonical UFC fighter registry self-test passed.");
}

if (selfTest) {
    runSelfTest();
    process.exit(0);
}

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
const publicData = JSON.parse(await fs.readFile(publicPath, "utf8"));
const result = canonicalize(state, publicData);

await fs.writeFile(statePath, `${JSON.stringify(result.state, null, 2)}\n`);
await fs.writeFile(publicPath, `${JSON.stringify(result.publicData, null, 2)}\n`);

console.log(
    `Canonical UFC roster: ${result.identityAudit.rawActiveProfileCount} source profiles -> ` +
    `${result.identityAudit.canonicalActiveCount} unique fighters ` +
    `(${result.identityAudit.collapsedActiveProfiles} duplicate/alias profile${result.identityAudit.collapsedActiveProfiles === 1 ? "" : "s"} collapsed).`
);
console.log(
    `Canonical registry: ${result.identityAudit.canonicalRegistryCount} identities, ` +
    `${result.identityAudit.aliasGroupCount} alias group(s), ` +
    `${result.identityAudit.suspiciousActivePairCount} unresolved bare/suffix pair(s) flagged for review.`
);
