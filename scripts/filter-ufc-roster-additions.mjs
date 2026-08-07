import fs from "node:fs/promises";

const USER_AGENT =
    "Mozilla/5.0 (compatible; MMAMatlockRosterCompetitionCheck/1.0; +https://matlockfighttalk.com/)";
const REQUEST_ATTEMPTS = 3;
const REQUEST_TIMEOUT_MS = 30000;
const EVENT_HISTORY_LIMIT = 1000;

function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state", "/tmp/ufc-roster-state.json");
const publicPath = argument("--public", "/tmp/ufc-roster-latest.json");
const backfillPath = argument("--backfill", "assets/ufc-roster-backfill.json");

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

function normalizeUrl(value) {
    try {
        const url = new URL(value);
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

function firstMatch(text, patterns) {
    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match?.[1]) return match[1].trim();
    }
    return "";
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

function parseDateLabel(value) {
    if (!value) return "";
    const normalized = value.replace(/\b([A-Za-z]{3})\.\s+/g, "$1 ");
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString();
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
    const date = "\\(\\s*\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\s*\\)";
    const event =
        "(?:UFC\\s+\\d{1,3}|UFC\\s+Fight Night(?:\\s+[^()]*)?|UFC\\s+on\\s+(?:ESPN|ABC|FOX|FX|FUEL|Versus)(?:\\s+[^()]*)?)";
    const pattern = new RegExp(
        `\\b(${event}\\s*${date}.{0,240}?\\b${resultVerb}\\b.{0,180})`,
        "i"
    );
    return firstMatch(plain, [pattern]);
}

function inspectProfileText(html) {
    const plain = stripTags(html);
    const octagonDebut = firstMatch(plain, [
        /\bOctagon Debut\s+([A-Za-z]{3,9}\.?\s+\d{1,2},\s+\d{4})\b/i
    ]);

    return {
        octagonDebut,
        octagonDebutAt: parseDateLabel(octagonDebut),
        completedUfcResultEvidence: completedUfcResultEvidence(plain)
    };
}

function classifyCompetition(profile, observedAt) {
    if (profile.completedUfcResultEvidence) {
        return {
            priorUfcCompetition: true,
            evidence: profile.completedUfcResultEvidence.slice(0, 320)
        };
    }

    const debutDay = dayNumber(profile.octagonDebutAt);
    const observedDay = dayNumber(observedAt);
    if (debutDay !== null && observedDay !== null && debutDay < observedDay) {
        return {
            priorUfcCompetition: true,
            evidence: `Octagon Debut ${profile.octagonDebut}`
        };
    }

    return {
        priorUfcCompetition: false,
        evidence: profile.octagonDebut
            ? `Octagon Debut ${profile.octagonDebut}`
            : "No prior UFC competition found on UFC profile"
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

async function inspectEntry(url, observedAt) {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) throw new Error(`Invalid UFC athlete URL: ${url}`);
    const html = await requestText(normalizedUrl);
    const profile = inspectProfileText(html);
    return {
        ...profile,
        ...classifyCompetition(profile, observedAt)
    };
}

const [stateRaw, publicRaw, backfillRaw] = await Promise.all([
    fs.readFile(statePath, "utf8"),
    fs.readFile(publicPath, "utf8"),
    fs.readFile(backfillPath, "utf8")
]);

const state = JSON.parse(stateRaw);
const publicData = JSON.parse(publicRaw);
const backfill = JSON.parse(backfillRaw);
const now = new Date().toISOString();

let additions = Array.isArray(state.additions) ? state.additions : [];
let reactivations = Array.isArray(state.reactivations) ? state.reactivations : [];
const retainedAdditions = [];
const newlyReclassified = [];

for (const addition of additions) {
    if (
        addition?.entryClass === "newcomer" &&
        addition?.competitionCheckedAt &&
        addition?.priorUfcCompetition === false
    ) {
        retainedAdditions.push(addition);
        continue;
    }

    try {
        const check = await inspectEntry(
            addition.url,
            addition.detectedAt || addition.confirmedActiveAt || now
        );
        const checked = {
            ...addition,
            octagonDebut: check.octagonDebut || addition.octagonDebut || "",
            octagonDebutAt: check.octagonDebutAt || addition.octagonDebutAt || "",
            competitionCheckedAt: now,
            competitionEvidence: check.evidence,
            priorUfcCompetition: check.priorUfcCompetition
        };

        if (check.priorUfcCompetition) {
            const reactivation = {
                ...checked,
                eventId: `${addition.url}|reactivated|${addition.detectedAt || addition.confirmedActiveAt || now}`,
                eventType: "reactivated",
                entryClass: "reactivation"
            };
            reactivations.unshift(reactivation);
            newlyReclassified.push(reactivation);
            console.log(
                `REACTIVATION ${reactivation.name || reactivation.url} — ${check.evidence}`
            );
        } else {
            retainedAdditions.push({
                ...checked,
                entryClass: "newcomer"
            });
            console.log(`NEWCOMER ${checked.name || checked.url} — ${check.evidence}`);
        }
    } catch (error) {
        retainedAdditions.push({
            ...addition,
            competitionCheckError: error.message
        });
        console.warn(
            `Competition cross-check failed for ${addition.name || addition.url}: ${error.message}. Holding it off the public additions list until a later run can verify it.`
        );
    }
}

additions = uniqueByEvent(retainedAdditions);
reactivations = uniqueByEvent(reactivations);

const backfillChecks =
    state.backfillCompetitionChecks && typeof state.backfillCompetitionChecks === "object"
        ? { ...state.backfillCompetitionChecks }
        : {};

for (const fighter of Array.isArray(backfill?.fighters) ? backfill.fighters : []) {
    const url = normalizeUrl(fighter?.url);
    if (!url || backfillChecks[url]?.checkedAt) continue;

    try {
        const check = await inspectEntry(url, fighter.profilePublishedAt || now);
        backfillChecks[url] = {
            checkedAt: now,
            eligible: !check.priorUfcCompetition,
            priorUfcCompetition: check.priorUfcCompetition,
            octagonDebut: check.octagonDebut,
            octagonDebutAt: check.octagonDebutAt,
            evidence: check.evidence
        };
        console.log(
            `BACKFILL ${backfillChecks[url].eligible ? "KEEP" : "DROP"} ${fighter.name || url} — ${check.evidence}`
        );
    } catch (error) {
        backfillChecks[url] = {
            checkedAt: "",
            eligible: false,
            error: error.message
        };
        console.warn(
            `Backfill competition cross-check failed for ${fighter.name || url}: ${error.message}`
        );
    }
}

const verifiedPublicAdditions = additions
    .filter(
        item =>
            item?.entryClass === "newcomer" &&
            item?.competitionCheckedAt &&
            item?.priorUfcCompetition === false
    )
    .slice(0, 10);

const eligibleBackfillUrls = new Set(
    Object.entries(backfillChecks)
        .filter(([, check]) => check?.checkedAt && check?.eligible === true)
        .map(([url]) => url)
);

const existingActiveBackfillUrls = Array.isArray(publicData.activeBackfillUrls)
    ? publicData.activeBackfillUrls
    : [];

publicData.activeBackfillUrls = existingActiveBackfillUrls.filter(url =>
    eligibleBackfillUrls.has(normalizeUrl(url) || "")
);

const generatedAt = publicData.generatedAt;
const confirmedThisRun = item => item?.confirmedActiveAt && item.confirmedActiveAt === generatedAt;
publicData.changesThisRun = {
    added: verifiedPublicAdditions.filter(confirmedThisRun).length,
    reactivated: reactivations.filter(confirmedThisRun).length,
    removed: Number(publicData?.changesThisRun?.removed || 0)
};

state.version = Math.max(Number(state.version || 0), 8);
state.additions = additions;
state.reactivations = reactivations;
state.backfillCompetitionChecks = backfillChecks;

publicData.version = Math.max(Number(publicData.version || 0), 8);
publicData.additions = verifiedPublicAdditions;
publicData.reactivations = reactivations.slice(0, 10);
publicData.methodology =
    "Compares UFC.com's hidden Active athlete collection between verified snapshots. Before an entrant appears in Roll Call, the tracker cross-checks the UFC profile for prior UFC competition using completed UFC fight-history text and the Octagon Debut field. Fighters with evidence of prior UFC competition are classified as reactivations and omitted from recent additions. Detection time is when this tracker first observed the roster-list change, not a contract-signing timestamp.";

await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
await fs.writeFile(publicPath, `${JSON.stringify(publicData, null, 2)}\n`);

console.log(
    `Competition cross-check complete: ${verifiedPublicAdditions.length} verified newcomer addition(s), ${reactivations.length} reactivation event(s), ${newlyReclassified.length} newly reclassified this run.`
);
