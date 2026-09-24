import fs from "node:fs/promises";
import {
    GENERIC_FIGHTER_NAMES,
    likelySameFighter,
    normalizeFighterName
} from "./ufc-roster-identity.mjs";

const publicPath = process.argv[2] || "/tmp/ufc-roster-latest.json";
const statePath = process.argv[3] || "/tmp/ufc-roster-state.json";
const [publicData, state] = await Promise.all([
    fs.readFile(publicPath, "utf8").then(JSON.parse),
    fs.readFile(statePath, "utf8").then(JSON.parse)
]);

const failures = [];
const warnings = [];
const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const urlKey = value => {
    try {
        const url = new URL(clean(value));
        if (url.protocol !== "https:" && url.protocol !== "http:") return "";
        url.hash = "";
        return url.toString().replace(/\/$/, "").toLowerCase();
    } catch {
        return "";
    }
};

function validateName(fighter, label) {
    const name = clean(fighter?.name);
    if (!name) {
        failures.push(`${label} has no fighter name`);
        return;
    }
    if (GENERIC_FIGHTER_NAMES.has(name.toLowerCase())) {
        failures.push(`${label} has generic page title instead of fighter name: ${name}`);
    }
    const roman = name.match(/\b(ii|iii|iv|v|vi|vii|viii|ix|x)$/i)?.[1] || "";
    if (roman && roman !== roman.toUpperCase()) {
        failures.push(`${label} has incorrectly cased Roman-numeral suffix: ${name}`);
    }
    if (!normalizeFighterName(name)) failures.push(`${label} fighter name cannot be normalized: ${name}`);
}

function validateIdentityCollisions(items, type) {
    for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
            if (clean(items[i]?.fighterId) && clean(items[i]?.fighterId) === clean(items[j]?.fighterId)) {
                failures.push(`${type}[${j}] repeats fighterId from ${type}[${i}]: ${items[i].fighterId}`);
            } else if (likelySameFighter(items[i], items[j])) {
                failures.push(
                    `${type}[${j}] appears to duplicate ${type}[${i}] by fighter identity: ` +
                    `${clean(items[i]?.name) || items[i]?.url} / ${clean(items[j]?.name) || items[j]?.url}`
                );
            }
        }
    }
}

function validateEventList(items, type) {
    if (!Array.isArray(items)) {
        failures.push(`${type} must be an array`);
        return new Map();
    }

    const urls = new Map();
    const eventIds = new Set();
    const fighterIds = new Map();
    for (const [index, fighter] of items.entries()) {
        const label = `${type}[${index}]`;
        const url = urlKey(fighter?.url);
        if (!url) failures.push(`${label} has no valid fighter URL`);
        else if (urls.has(url)) failures.push(`${label} repeats fighter URL already seen at ${urls.get(url)}`);
        else urls.set(url, label);

        const fighterId = clean(fighter?.fighterId);
        if (!fighterId) failures.push(`${label} has no canonical fighterId`);
        else if (fighterIds.has(fighterId)) failures.push(`${label} repeats fighterId already seen at ${fighterIds.get(fighterId)}`);
        else fighterIds.set(fighterId, label);

        validateName(fighter, label);

        if (fighter?.eventType && fighter.eventType !== (type === "additions" ? "added" : "removed")) {
            failures.push(`${label} has wrong eventType ${fighter.eventType}`);
        }
        if (!clean(fighter?.eventId)) failures.push(`${label} has no eventId`);
        else if (eventIds.has(fighter.eventId)) failures.push(`${label} duplicates eventId ${fighter.eventId}`);
        else eventIds.add(fighter.eventId);

        if (!Number.isFinite(Date.parse(fighter?.detectedAt || fighter?.confirmedActiveAt || fighter?.confirmedInactiveAt || ""))) {
            failures.push(`${label} has no valid detection/confirmation timestamp`);
        }

        if (type === "additions") {
            if (fighter?.entryClass !== "newcomer") failures.push(`${label} is not classified as newcomer`);
            if (!fighter?.competitionCheckedAt) failures.push(`${label} has no prior-competition verification timestamp`);
            if (fighter?.priorUfcCompetition !== false) failures.push(`${label} was not verified as having no prior UFC competition`);
        }

        if (type === "removals") {
            if (fighter?.confirmationSource !== "ufc-active-absence-confirmed") failures.push(`${label} was not confirmed by the sustained Active-absence rule`);
            if (clean(fighter?.status).toLowerCase() === "active") failures.push(`${label} still reports Active status`);
            if (Number(fighter?.missingSnapshots || 0) < 3) failures.push(`${label} has fewer than three missing Active snapshots`);
        }
    }

    validateIdentityCollisions(items, type);
    return { urls, fighterIds };
}

if (!Number.isFinite(Date.parse(publicData?.generatedAt))) failures.push("public generatedAt is invalid");
if (!Number.isInteger(publicData?.activeCount) || publicData.activeCount < 500) failures.push(`implausible public activeCount: ${publicData?.activeCount}`);
if (!Number.isInteger(state?.activeCount) || state.activeCount < 500) failures.push(`implausible state activeCount: ${state?.activeCount}`);
if (publicData?.activeCount !== state?.activeCount) failures.push(`public/state activeCount disagreement: ${publicData?.activeCount} vs ${state?.activeCount}`);

const rawProfileCount = Array.isArray(state?.activeProfiles) ? state.activeProfiles.length : 0;
if (!Number.isInteger(state?.activeProfileCount) || state.activeProfileCount !== rawProfileCount) {
    failures.push(`state activeProfileCount does not match activeProfiles length: ${state?.activeProfileCount} vs ${rawProfileCount}`);
}
if (publicData?.activeProfileCount !== state?.activeProfileCount) {
    failures.push(`public/state activeProfileCount disagreement: ${publicData?.activeProfileCount} vs ${state?.activeProfileCount}`);
}
if (state.activeCount > state.activeProfileCount) failures.push("canonical activeCount cannot exceed raw activeProfileCount");

const activeFighterIds = Array.isArray(state?.activeFighterIds) ? state.activeFighterIds.map(clean).filter(Boolean) : [];
if (new Set(activeFighterIds).size !== activeFighterIds.length) failures.push("state activeFighterIds contains duplicates");
if (activeFighterIds.length !== state.activeCount) failures.push("state activeFighterIds length does not match canonical activeCount");

const registry = Array.isArray(state?.canonicalFighters) ? state.canonicalFighters : [];
if (registry.length < state.activeCount) failures.push("canonical fighter registry is smaller than active canonical roster");
const registryIds = new Set();
const urlOwners = new Map();
for (const [index, fighter] of registry.entries()) {
    const label = `canonicalFighters[${index}]`;
    const fighterId = clean(fighter?.fighterId);
    if (!fighterId) failures.push(`${label} has no fighterId`);
    else if (registryIds.has(fighterId)) failures.push(`${label} duplicates fighterId ${fighterId}`);
    else registryIds.add(fighterId);
    validateName(fighter, label);

    const urls = [fighter?.canonicalUrl, ...(Array.isArray(fighter?.profileAliases) ? fighter.profileAliases : [])]
        .map(urlKey).filter(Boolean);
    for (const url of urls) {
        if (urlOwners.has(url) && urlOwners.get(url) !== fighterId) failures.push(`${label} shares profile URL ${url} with ${urlOwners.get(url)}`);
        else urlOwners.set(url, fighterId);
    }
}
for (const url of (state?.activeProfiles || []).map(urlKey).filter(Boolean)) {
    if (!urlOwners.has(url)) failures.push(`active profile is missing from canonical registry: ${url}`);
}
for (const fighterId of activeFighterIds) {
    if (!registryIds.has(fighterId)) failures.push(`active fighterId missing from canonical registry: ${fighterId}`);
}

const audit = state?.identityAudit || {};
if (audit.rawActiveProfileCount !== state.activeProfileCount) failures.push("identityAudit rawActiveProfileCount disagrees with state");
if (audit.canonicalActiveCount !== state.activeCount) failures.push("identityAudit canonicalActiveCount disagrees with state");
if (audit.collapsedActiveProfiles !== state.activeProfileCount - state.activeCount) failures.push("identityAudit collapsedActiveProfiles is inconsistent");
if (Number(audit.suspiciousActivePairCount || 0) > 0) warnings.push(`${audit.suspiciousActivePairCount} unresolved bare/suffix active profile pair(s) require identity review`);

if (Array.isArray(publicData?.additions) && publicData.additions.length > 10) failures.push("public additions exceeds 10 entries");
const additions = validateEventList(publicData?.additions, "additions");
const removals = validateEventList(publicData?.removals, "removals");
for (const [fighterId, label] of additions.fighterIds) {
    if (removals.fighterIds.has(fighterId)) failures.push(`${label} is simultaneously published as an addition and removal by canonical fighterId`);
}

const activeIdSet = new Set(activeFighterIds);
for (const [fighterId, label] of removals.fighterIds) {
    if (activeIdSet.has(fighterId)) failures.push(`${label} resolves to a fighter still present in the canonical active roster`);
}

const pendingRemovals = Array.isArray(state?.pendingRemovals) ? state.pendingRemovals : [];
for (const [index, candidate] of pendingRemovals.entries()) {
    const label = `pendingRemovals[${index}]`;
    if (!urlKey(candidate?.url)) failures.push(`${label} has invalid URL`);
    if (!clean(candidate?.fighterId)) warnings.push(`${label} has not yet resolved to a canonical fighterId`);
    const misses = Number(candidate?.misses || 0);
    if (!Number.isInteger(misses) || misses < 0) failures.push(`${label} has invalid miss count`);
    if (misses >= 3 && clean(candidate?.lastStatus).toLowerCase() && clean(candidate?.lastStatus).toLowerCase() !== "active") {
        warnings.push(`${label} has ${misses} misses and non-Active status but remains pending; inspect the confirmation path`);
    }
}

if (warnings.length) {
    console.warn("UFC roster output warnings:");
    warnings.forEach(item => console.warn(`- ${item}`));
}
if (failures.length) {
    console.error("UFC roster output validation failed:");
    failures.forEach(item => console.error(`- ${item}`));
    process.exit(1);
}

console.log(
    `UFC roster output valid: ${publicData.activeCount} canonical active fighters from ` +
    `${publicData.activeProfileCount} UFC Active profiles, ${publicData.additions.length} recent additions, ` +
    `${publicData.removals.length} confirmed departures, ${pendingRemovals.length} pending departures.`
);
