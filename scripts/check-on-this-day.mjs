import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve("assets/data/on-this-day.json");
const pageFile = resolve("on-this-day.html");
const data = JSON.parse(await readFile(file, "utf8"));
const page = await readFile(pageFile, "utf8");
const entries = Array.isArray(data?.entries) ? data.entries : [];
const allowedKinds = new Set([
    "fight",
    "event",
    "signing",
    "debut",
    "title",
    "incident",
    "news",
    "death",
    "birthday"
]);
const failures = [];
const seen = new Set();
const birthdayKeys = new Set();
const eventKeys = new Set();

if (!Number.isInteger(data?.version) || data.version < 1) {
    failures.push("version must be a positive integer");
}

if (!entries.length) {
    failures.push("entries must contain at least one historical record");
}

if (!page.includes("/assets/on-this-day-stable.js")) {
    failures.push("on-this-day.html must load the stable On This Day renderer");
}
if (page.includes("/assets/on-this-day-full.js") || page.includes("/assets/on-this-day-media-adaptive.js")) {
    failures.push("on-this-day.html must not load deprecated On This Day runtimes");
}
const pageScriptRefs = [...page.matchAll(/^\s*-\s+\/assets\/on-this-day[^\s]*\.js\s*$/gm)].map(match => match[0]);
if (pageScriptRefs.length !== 1) {
    failures.push(`on-this-day.html must declare exactly one On This Day page runtime (found ${pageScriptRefs.length})`);
}

for (const [index, entry] of entries.entries()) {
    const prefix = `entries[${index}]`;
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entry?.date || "");

    if (!dateMatch) {
        failures.push(`${prefix}.date must use YYYY-MM-DD`);
    } else {
        const year = Number(dateMatch[1]);
        const month = Number(dateMatch[2]);
        const day = Number(dateMatch[3]);
        const parsed = new Date(Date.UTC(year, month - 1, day));
        if (
            parsed.getUTCFullYear() !== year ||
            parsed.getUTCMonth() !== month - 1 ||
            parsed.getUTCDate() !== day
        ) {
            failures.push(`${prefix}.date is not a real calendar date`);
        }
    }

    if (!allowedKinds.has(entry?.kind)) failures.push(`${prefix}.kind is invalid`);
    if (typeof entry?.title !== "string" || !entry.title.trim()) failures.push(`${prefix}.title is required`);

    if (entry?.kind === "birthday") {
        if (typeof entry?.fighter !== "string" || !entry.fighter.trim()) failures.push(`${prefix}.fighter is required for birthday entries`);
        if (typeof entry?.birthdayKey !== "string" || !entry.birthdayKey.trim()) {
            failures.push(`${prefix}.birthdayKey is required for birthday entries`);
        } else if (birthdayKeys.has(entry.birthdayKey)) {
            failures.push(`${prefix}.birthdayKey duplicates another fighter birthday`);
        } else {
            birthdayKeys.add(entry.birthdayKey);
        }
    }

    if (entry?.generatedBy === "wikipedia-event-index") {
        if (entry?.kind !== "event") failures.push(`${prefix} generated event archive entries must use kind=event`);
        if (typeof entry?.autoKey !== "string" || !entry.autoKey.trim()) {
            failures.push(`${prefix}.autoKey is required for generated event entries`);
        } else if (eventKeys.has(entry.autoKey)) {
            failures.push(`${prefix}.autoKey duplicates another generated event`);
        } else {
            eventKeys.add(entry.autoKey);
        }
        if (typeof entry?.promotion !== "string" || !entry.promotion.trim()) failures.push(`${prefix}.promotion is required for generated event entries`);
    }

    if (entry?.detail && entry.detail.length > 240) failures.push(`${prefix}.detail must stay concise (240 characters max)`);
    if (entry?.detail && /\s+[,.!?;:]/.test(entry.detail)) failures.push(`${prefix}.detail contains spacing before punctuation`);
    if (entry?.detail && /\.\.$/.test(entry.detail)) failures.push(`${prefix}.detail ends with duplicate punctuation`);

    if (entry?.sourceUrl && !/^https:\/\//i.test(entry.sourceUrl)) failures.push(`${prefix}.sourceUrl must be https`);
    if (entry?.imageUrl && !/^https:\/\//i.test(entry.imageUrl)) failures.push(`${prefix}.imageUrl must be https`);
    if (entry?.imageUrl && (typeof entry.imageAlt !== "string" || !entry.imageAlt.trim())) failures.push(`${prefix}.imageAlt is required when imageUrl is present`);
    if (entry?.imageCredit && typeof entry.imageCredit !== "string") failures.push(`${prefix}.imageCredit must be a string`);
    if (entry?.imagePosition && !/^\d{1,3}%\s+\d{1,3}%$/.test(entry.imagePosition)) failures.push(`${prefix}.imagePosition must look like "50% 40%"`);

    const entryKey = `${entry?.date || ""}::${entry?.title || ""}`.toLowerCase();
    if (seen.has(entryKey)) failures.push(`${prefix} duplicates an existing date/title`);
    seen.add(entryKey);
}

const birthdayCount = entries.filter(entry => entry?.kind === "birthday").length;
if (data?.birthdayCount !== undefined && Number(data.birthdayCount) !== birthdayCount) {
    failures.push(`birthdayCount says ${data.birthdayCount} but ${birthdayCount} birthday entries exist`);
}

const eventArchiveCount = entries.filter(entry => entry?.generatedBy === "wikipedia-event-index").length;
if (data?.eventArchiveCount !== undefined && Number(data.eventArchiveCount) !== eventArchiveCount) {
    failures.push(`eventArchiveCount says ${data.eventArchiveCount} but ${eventArchiveCount} generated event entries exist`);
}

if (data?.eventArchiveSources !== undefined) {
    if (!data.eventArchiveSources || typeof data.eventArchiveSources !== "object" || Array.isArray(data.eventArchiveSources)) {
        failures.push("eventArchiveSources must be an object when present");
    } else {
        const sourceTotal = Object.values(data.eventArchiveSources).reduce((total, value) => total + Number(value || 0), 0);
        if (sourceTotal !== eventArchiveCount) failures.push(`eventArchiveSources total ${sourceTotal} does not match ${eventArchiveCount} generated events`);
    }
}

const imageRegressionTitles = [
    "UFC 228: Woodley vs. Till took place",
    "UFC 75: Champion vs. Champion took place"
];
for (const title of imageRegressionTitles) {
    const entry = entries.find(item => item?.title === title);
    if (!entry) failures.push(`regression fixture missing: ${title}`);
    else if (!entry.imageUrl) failures.push(`regression fixture lost its image: ${title}`);
}

if (data?.curationVersion !== undefined && Number(data.curationVersion) < 1) {
    failures.push("curationVersion must be at least 1 when present");
}

if (failures.length) {
    console.error("On This Day validation failed:\n- " + failures.join("\n- "));
    process.exit(1);
}

console.log(`On This Day data valid: ${entries.length} entries (${eventArchiveCount} auto events, ${birthdayCount} birthdays)`);
console.log("On This Day runtime regression checks passed: one stable renderer, representative event images intact.");
