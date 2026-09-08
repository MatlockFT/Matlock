import fs from "node:fs/promises";

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

function validateEventList(items, type) {
    if (!Array.isArray(items)) {
        failures.push(`${type} must be an array`);
        return new Map();
    }

    const urls = new Map();
    const eventIds = new Set();
    for (const [index, fighter] of items.entries()) {
        const label = `${type}[${index}]`;
        const url = urlKey(fighter?.url);
        if (!url) failures.push(`${label} has no valid fighter URL`);
        else if (urls.has(url)) warnings.push(`${label} repeats fighter URL already seen at ${urls.get(url)}`);
        else urls.set(url, label);

        if (!clean(fighter?.name)) failures.push(`${label} has no fighter name`);
        if (fighter?.eventType && fighter.eventType !== (type === "additions" ? "added" : "removed")) {
            failures.push(`${label} has wrong eventType ${fighter.eventType}`);
        }
        if (!clean(fighter?.eventId)) failures.push(`${label} has no eventId`);
        else if (eventIds.has(fighter.eventId)) failures.push(`${label} duplicates eventId ${fighter.eventId}`);
        else eventIds.add(fighter.eventId);

        if (!Number.isFinite(Date.parse(fighter?.detectedAt || fighter?.confirmedActiveAt || fighter?.confirmedInactiveAt || ""))) {
            failures.push(`${label} has no valid detection/confirmation timestamp`);
        }

        if (type === "removals") {
            if (fighter?.confirmationSource !== "ufc-active-absence-confirmed") {
                failures.push(`${label} was not confirmed by the sustained Active-absence rule`);
            }
            if (clean(fighter?.status).toLowerCase() === "active") {
                failures.push(`${label} still reports Active status`);
            }
            if (Number(fighter?.missingSnapshots || 0) < 3) {
                failures.push(`${label} has fewer than three missing Active snapshots`);
            }
        }
    }
    return urls;
}

if (!Number.isFinite(Date.parse(publicData?.generatedAt))) failures.push("public generatedAt is invalid");
if (!Number.isInteger(publicData?.activeCount) || publicData.activeCount < 500) failures.push(`implausible public activeCount: ${publicData?.activeCount}`);
if (!Number.isInteger(state?.activeCount) || state.activeCount < 500) failures.push(`implausible state activeCount: ${state?.activeCount}`);
if (publicData?.activeCount !== state?.activeCount) failures.push(`public/state activeCount disagreement: ${publicData?.activeCount} vs ${state?.activeCount}`);
if (!Array.isArray(state?.activeProfiles) || state.activeProfiles.length !== state.activeCount) failures.push("state activeProfiles length does not match activeCount");

const additions = validateEventList(publicData?.additions, "additions");
const removals = validateEventList(publicData?.removals, "removals");
for (const [url, label] of additions) {
    if (removals.has(url)) failures.push(`${label} is simultaneously published as an addition and removal`);
}

const activeSet = new Set((state?.activeProfiles || []).map(urlKey).filter(Boolean));
for (const [url, label] of removals) {
    if (activeSet.has(url)) failures.push(`${label} is still present in the current UFC Active collection`);
}

const pendingRemovals = Array.isArray(state?.pendingRemovals) ? state.pendingRemovals : [];
for (const [index, candidate] of pendingRemovals.entries()) {
    const label = `pendingRemovals[${index}]`;
    if (!urlKey(candidate?.url)) failures.push(`${label} has invalid URL`);
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

console.log(`UFC roster output valid: ${publicData.activeCount} active, ${publicData.additions.length} recent additions, ${publicData.removals.length} confirmed departures, ${pendingRemovals.length} pending departures.`);
