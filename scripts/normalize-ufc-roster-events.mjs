import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
    dedupeFighterEvents,
    nameFromSlug,
    sanitizeFighter
} from "./ufc-roster-identity.mjs";

// Finalization is a publication gate: normalized roster data must pass the validator before release.
function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state", "/tmp/ufc-roster-state.json");
const publicPath = argument("--public", "/tmp/ufc-roster-latest.json");
const finalizePublic = process.argv.includes("--finalize-public");
const selfTest = process.argv.includes("--self-test");
const EVENT_HISTORY_LIMIT = 1000;

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

function normalizeList(items, limit = EVENT_HISTORY_LIMIT) {
    return dedupeFighterEvents(items, { limit, rank });
}

function runSelfTest() {
    const fallback = sanitizeFighter({
        name: "Search results",
        slug: "sean-king-iii",
        url: "https://www.ufc.com/athlete/sean-king-iii"
    });
    if (fallback.name !== "Sean King III") {
        throw new Error(`Roman-numeral fallback failed: ${fallback.name}`);
    }
    if (nameFromSlug("john-doe-iv") !== "John Doe IV") {
        throw new Error("Roman-numeral slug formatting failed.");
    }

    const duplicate = normalizeList([
        {
            name: "Sean King",
            slug: "sean-king",
            url: "https://www.ufc.com/athlete/sean-king",
            image: "",
            division: "",
            record: "",
            status: "",
            description: "",
            eventId: "old",
            eventType: "added",
            detectedAt: "2026-09-04T00:00:00.000Z",
            confirmedActiveAt: "2026-09-04T00:00:00.000Z",
            competitionCheckedAt: "2026-09-04T00:05:00.000Z",
            priorUfcCompetition: false,
            entryClass: "newcomer"
        },
        {
            name: "Search results",
            slug: "sean-king-iii",
            url: "https://www.ufc.com/athlete/sean-king-iii",
            image: "",
            division: "",
            record: "",
            status: "",
            description: "",
            eventId: "new",
            eventType: "added",
            detectedAt: "2026-09-08T00:00:00.000Z",
            confirmedActiveAt: "2026-09-08T00:00:00.000Z",
            competitionCheckedAt: "2026-09-08T00:05:00.000Z",
            priorUfcCompetition: false,
            entryClass: "newcomer"
        }
    ]);

    if (duplicate.length !== 1) {
        throw new Error(`Expected Sean King alias pair to collapse to one entry; got ${duplicate.length}.`);
    }
    if (duplicate[0].name !== "Sean King III") {
        throw new Error(`Expected canonical Sean King III name; got ${duplicate[0].name}.`);
    }
    if (duplicate[0].url !== "https://www.ufc.com/athlete/sean-king-iii") {
        throw new Error(`Expected suffixed canonical URL; got ${duplicate[0].url}.`);
    }
    if (!duplicate[0].profileAliases?.includes("https://www.ufc.com/athlete/sean-king")) {
        throw new Error("Expected old Sean King profile URL to be retained as an alias.");
    }

    const distinct = normalizeList([
        {
            name: "John Smith Jr.",
            slug: "john-smith-jr",
            url: "https://www.ufc.com/athlete/john-smith-jr",
            eventId: "jr",
            detectedAt: "2026-01-01T00:00:00.000Z"
        },
        {
            name: "John Smith III",
            slug: "john-smith-iii",
            url: "https://www.ufc.com/athlete/john-smith-iii",
            eventId: "iii",
            detectedAt: "2026-01-01T00:00:00.000Z"
        }
    ]);
    if (distinct.length !== 2) {
        throw new Error("Explicitly suffixed fighters must not be collapsed together.");
    }

    console.log("UFC roster identity normalization self-test passed.");
}

if (selfTest) {
    runSelfTest();
    process.exit(0);
}

const state = JSON.parse(await fs.readFile(statePath, "utf8"));
const publicData = JSON.parse(await fs.readFile(publicPath, "utf8"));
const beforeAdditions = Array.isArray(state.additions) ? state.additions.length : 0;
const beforeReactivations = Array.isArray(state.reactivations) ? state.reactivations.length : 0;
const beforeRemovals = Array.isArray(state.removals) ? state.removals.length : 0;

state.additions = normalizeList(state.additions);
state.reactivations = normalizeList(state.reactivations);
state.removals = normalizeList(state.removals);

const removedAdditions = beforeAdditions - state.additions.length;
const removedReactivations = beforeReactivations - state.reactivations.length;
const removedRemovals = beforeRemovals - state.removals.length;
state.version = Math.max(Number(state.version || 0), 12);

if (finalizePublic) {
    const verified = state.additions
        .filter(
            item =>
                item?.entryClass === "newcomer" &&
                item?.competitionCheckedAt &&
                item?.priorUfcCompetition === false
        )
        .slice(0, 10);

    publicData.version = Math.max(Number(publicData.version || 0), 12);
    publicData.additions = verified;
    publicData.reactivations = normalizeList(state.reactivations, 10);
    publicData.removals = normalizeList(state.removals, 10);
    publicData.methodology =
        "Tracks UFC.com's hidden Active athlete collection and official UFC event cards, then resolves profile URLs through a persistent canonical fighter registry before publication. The public Active total counts unique canonical fighter identities, while activeProfileCount preserves UFC.com's raw Active-profile count for diagnostics. TUF, Dana White's Contender Series, Road to UFC, and other developmental or qualifying pages are not treated as roster confirmation. Entrants are cross-checked for prior standard UFC competition before appearing as newcomers. Renamed and duplicate UFC athlete URLs remain attached to the same fighter ID as aliases. Detection time is when this tracker first confirmed the roster change, not a contract-signing timestamp.";

    const generatedAt = publicData.generatedAt;
    const confirmedThisRun = item =>
        item?.confirmedActiveAt && item.confirmedActiveAt === generatedAt;

    publicData.changesThisRun = {
        added: verified.filter(confirmedThisRun).length,
        reactivated: publicData.reactivations.filter(confirmedThisRun).length,
        removed: Number(publicData?.changesThisRun?.removed || 0)
    };
}

await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(publicPath, `${JSON.stringify(publicData, null, 2)}\n`);

if (finalizePublic) {
    const validatorPath = fileURLToPath(new URL("./validate-ufc-roster-output.mjs", import.meta.url));
    execFileSync(process.execPath, [validatorPath, publicPath, statePath], { stdio: "inherit" });
}

console.log(
    `${finalizePublic ? "Finalized" : "Normalized"} UFC roster event history; removed ` +
        `${removedAdditions} duplicate newcomer, ${removedReactivations} duplicate reactivation, ` +
        `and ${removedRemovals} duplicate departure event(s).`
);
