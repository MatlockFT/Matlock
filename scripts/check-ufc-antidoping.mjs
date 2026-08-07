import fs from "node:fs/promises";

const SOURCE_URL = "https://ufcantidoping.com/tests";
const USER_AGENT =
    "Mozilla/5.0 (compatible; MMAMatlockRosterMonitor/8.0; +https://matlockfighttalk.com/)";
const REQUEST_TIMEOUT_MS = 30000;
const REQUEST_ATTEMPTS = 3;
const MIN_ENTRIES = 400;
const MAX_SIGNAL_HISTORY = 500;

function argument(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : fallback;
}

const statePath = argument("--state", "/tmp/ufc-roster-state.json");
const previousPath = argument("--previous", "/tmp/ufc-roster/ufc-roster-state.json");

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function decodeHtml(value = "") {
    return value
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#039;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">");
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

function normalizeName(value = "") {
    return value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

async function readJson(path, optional = false) {
    try {
        return JSON.parse(await fs.readFile(path, "utf8"));
    } catch (error) {
        if (optional && error?.code === "ENOENT") return null;
        throw error;
    }
}

async function writeJson(path, value) {
    await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function request(url) {
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

            if (response.ok) return response;

            lastError = new Error(`${response.status} ${response.statusText} for ${url}`);
        } catch (error) {
            lastError = error;
        }

        if (attempt < REQUEST_ATTEMPTS) await sleep(750 * attempt);
    }

    throw lastError || new Error(`Request failed for ${url}`);
}

function parseTestHistory(html) {
    const entries = [];
    const seen = new Set();

    for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
            .map(match => stripTags(match[1]));

        if (cells.length < 3) continue;

        const year = Number.parseInt(cells[0], 10);
        const testSessions = Number.parseInt(cells.at(-1), 10);
        const athlete = cells[1]?.trim() || "";

        if (!Number.isInteger(year) || year < 2000 || year > 2100) continue;
        if (!athlete || !Number.isInteger(testSessions) || testSessions < 0) continue;

        const normalizedName = normalizeName(athlete);
        if (!normalizedName) continue;

        const key = `${year}|${normalizedName}`;
        if (seen.has(key)) continue;
        seen.add(key);

        entries.push({
            key,
            year,
            athlete,
            normalizedName,
            testSessions
        });
    }

    entries.sort((a, b) => a.key.localeCompare(b.key));

    if (entries.length < MIN_ENTRIES) {
        throw new Error(
            `Parsed only ${entries.length} UFC anti-doping test-history entries; refusing to replace the previous baseline.`
        );
    }

    const plain = stripTags(html);
    const updatedMatch = plain.match(
        /Last updated:\s*([A-Z][a-z]{2}\s+\d{1,2}\s+\d{4},\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*[A-Z]{2,5})/i
    );

    return {
        entries,
        sourceUpdatedAt: updatedMatch?.[1]?.trim() || ""
    };
}

function preservePreviousAntiDoping(state, previous, checkedAt, error) {
    if (previous?.antiDoping) {
        state.antiDoping = previous.antiDoping;
    }

    state.antiDopingLastAttempt = {
        checkedAt,
        outcome: "error",
        message: String(error?.message || error).slice(0, 500)
    };
}

const checkedAt = new Date().toISOString();
const state = await readJson(statePath);
const previous = await readJson(previousPath, true);

try {
    const html = await (await request(SOURCE_URL)).text();
    const parsed = parseTestHistory(html);
    const previousEntries = Array.isArray(previous?.antiDoping?.entries)
        ? previous.antiDoping.entries
        : [];
    const hasBaseline = previousEntries.length >= MIN_ENTRIES;
    const previousKeys = new Set(previousEntries.map(entry => entry?.key).filter(Boolean));
    const added = hasBaseline
        ? parsed.entries.filter(entry => !previousKeys.has(entry.key))
        : [];

    const signals = new Map();
    for (const signal of Array.isArray(previous?.antiDoping?.signals)
        ? previous.antiDoping.signals
        : []) {
        if (signal?.key) signals.set(signal.key, signal);
    }

    for (const entry of added) {
        const existing = signals.get(entry.key);
        signals.set(entry.key, {
            ...(existing || {}),
            key: entry.key,
            year: entry.year,
            athlete: entry.athlete,
            normalizedName: entry.normalizedName,
            testSessions: entry.testSessions,
            firstDetectedAt: existing?.firstDetectedAt || checkedAt,
            lastSeenAt: checkedAt,
            signal: "new-ufc-antidoping-test-history-entry"
        });
    }

    const currentEntriesByKey = new Map(parsed.entries.map(entry => [entry.key, entry]));
    for (const [key, signal] of signals) {
        const current = currentEntriesByKey.get(key);
        if (!current) continue;
        signals.set(key, {
            ...signal,
            athlete: current.athlete,
            testSessions: current.testSessions,
            lastSeenAt: checkedAt
        });
    }

    const signalHistory = [...signals.values()]
        .sort((a, b) => String(b.firstDetectedAt || "").localeCompare(String(a.firstDetectedAt || "")))
        .slice(0, MAX_SIGNAL_HISTORY);

    state.antiDoping = {
        source: SOURCE_URL,
        checkedAt,
        sourceUpdatedAt: parsed.sourceUpdatedAt,
        baselineEstablishedAt:
            previous?.antiDoping?.baselineEstablishedAt || checkedAt,
        athleteCount: parsed.entries.length,
        entries: parsed.entries,
        newEntriesThisRun: added,
        signals: signalHistory
    };

    state.antiDopingLastAttempt = {
        checkedAt,
        outcome: "success",
        athleteCount: parsed.entries.length,
        newEntryCount: added.length
    };

    await writeJson(statePath, state);

    if (!hasBaseline) {
        console.log(
            `Established UFC anti-doping baseline with ${parsed.entries.length} test-history entries.`
        );
    } else {
        console.log(
            `UFC anti-doping cross-check: ${parsed.entries.length} entries, ${added.length} new name(s) since previous snapshot.`
        );
        for (const entry of added) {
            console.log(
                `Anti-doping signal: ${entry.athlete} (${entry.year}, ${entry.testSessions} test session${entry.testSessions === 1 ? "" : "s"}).`
            );
        }
    }
} catch (error) {
    preservePreviousAntiDoping(state, previous, checkedAt, error);
    await writeJson(statePath, state);
    console.warn(
        `UFC anti-doping cross-check unavailable; main roster publication will continue: ${error.message}`
    );
}
