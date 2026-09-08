import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve("assets/data/on-this-day.json");
const pageFile = resolve("on-this-day.html");
const runtimeFile = resolve("assets/on-this-day-stable.js");
const data = JSON.parse(await readFile(file, "utf8"));
const page = await readFile(pageFile, "utf8");
const runtime = await readFile(runtimeFile, "utf8");
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
const warnings = [];
const seen = new Set();
const birthdayKeys = new Set();
const eventKeys = new Set();
const sourceDateKeys = new Map();

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const norm = value => clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function punctuationProblems(value) {
    const text = clean(value);
    return (
        /\s+[,.!?;:]/.test(text) ||
        /[,;:]\s*[,;:]/.test(text) ||
        /\.\s*\.$/.test(text) ||
        /\b(?:U\.S|U\.K)\.\.$/i.test(text)
    );
}

if (!Number.isInteger(data?.version) || data.version < 1) {
    failures.push("version must be a positive integer");
}

if (!entries.length) {
    failures.push("entries must contain at least one historical record");
}

if (!page.includes("/assets/on-this-day-stable.js")) {
    failures.push("on-this-day.html must load the stable On This Day renderer");
}
if (!page.includes("/assets/on-this-day-qol.css")) {
    failures.push("on-this-day.html must load the On This Day QoL stylesheet");
}
if (!page.includes("data-otd-mode-group") || !page.includes("data-otd-sort")) {
    failures.push("on-this-day.html must expose notable/all and sort controls");
}
if (page.includes("/assets/on-this-day-full.js") || page.includes("/assets/on-this-day-media-adaptive.js")) {
    failures.push("on-this-day.html must not load deprecated On This Day runtimes");
}
const pageScriptRefs = [...page.matchAll(/^\s*-\s+\/assets\/on-this-day[^\s]*\.js\s*$/gm)].map(match => match[0]);
if (pageScriptRefs.length !== 1) {
    failures.push(`on-this-day.html must declare exactly one On This Day page runtime (found ${pageScriptRefs.length})`);
}

if (/\bMutationObserver\b/.test(runtime) || /\bIntersectionObserver\b/.test(runtime)) {
    failures.push("stable On This Day runtime must not reintroduce observer-based image/render loops");
}
for (const marker of ["COLLAPSE_LIMIT", "significanceScore", "openLightbox", "dataset.otdEntryLink", "classifyImage"]) {
    if (!runtime.includes(marker)) failures.push(`stable On This Day runtime is missing QoL marker: ${marker}`);
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
    if (entry?.title && punctuationProblems(entry.title)) failures.push(`${prefix}.title contains malformed punctuation`);
    if (entry?.promotion && punctuationProblems(entry.promotion)) failures.push(`${prefix}.promotion contains malformed punctuation`);

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
        if (/\s+took place$/i.test(String(entry?.title || ""))) failures.push(`${prefix}.title must omit the redundant "took place" suffix`);

        const sourceDateKey = `${entry.archiveSource || "unknown"}::${entry.date || ""}::${norm(entry.title)}`;
        if (sourceDateKeys.has(sourceDateKey)) failures.push(`${prefix} duplicates generated source/date/title at ${sourceDateKeys.get(sourceDateKey)}`);
        else sourceDateKeys.set(sourceDateKey, prefix);
    }

    if (entry?.detail && entry.detail.length > 320) failures.push(`${prefix}.detail must stay concise (320 characters max)`);
    if (entry?.detail && punctuationProblems(entry.detail)) failures.push(`${prefix}.detail contains malformed punctuation`);

    if (entry?.sourceUrl && !/^https:\/\//i.test(entry.sourceUrl)) failures.push(`${prefix}.sourceUrl must be https`);
    if (entry?.imageUrl && !/^https:\/\//i.test(entry.imageUrl)) failures.push(`${prefix}.imageUrl must be https`);
    if (entry?.imageUrl && (typeof entry.imageAlt !== "string" || !entry.imageAlt.trim())) failures.push(`${prefix}.imageAlt is required when imageUrl is present`);
    if (entry?.imageAlt && punctuationProblems(entry.imageAlt)) failures.push(`${prefix}.imageAlt contains malformed punctuation`);
    if (entry?.imageCredit && typeof entry.imageCredit !== "string") failures.push(`${prefix}.imageCredit must be a string`);
    if (entry?.imagePosition && !/^\d{1,3}%\s+\d{1,3}%$/.test(entry.imagePosition)) failures.push(`${prefix}.imagePosition must look like "50% 40%"`);

    const entryKey = `${entry?.date || ""}::${norm(entry?.title)}`;
    if (seen.has(entryKey)) failures.push(`${prefix} duplicates an existing normalized date/title`);
    seen.add(entryKey);
}

const birthdayCount = entries.filter(entry => entry?.kind === "birthday").length;
if (data?.birthdayCount !== undefined && Number(data.birthdayCount) !== birthdayCount) {
    failures.push(`birthdayCount says ${data.birthdayCount} but ${birthdayCount} birthday entries exist`);
}

const generatedEntries = entries.filter(entry => entry?.generatedBy === "wikipedia-event-index");
const eventArchiveCount = generatedEntries.length;
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

const normalizedEventTitle = value => String(value || "").replace(/\s+took place$/i, "").trim();
const imageRegressionTitles = [
    "UFC 228: Woodley vs. Till",
    "UFC 75: Champion vs. Champion"
];
for (const title of imageRegressionTitles) {
    const entry = entries.find(item => normalizedEventTitle(item?.title) === title);
    if (!entry) failures.push(`regression fixture missing: ${title}`);
    else if (!entry.imageUrl) failures.push(`regression fixture lost its image: ${title}`);
}

if (data?.curationVersion !== undefined && Number(data.curationVersion) < 1) {
    failures.push("curationVersion must be at least 1 when present");
}

const generatedWithImages = generatedEntries.filter(entry => entry?.imageUrl).length;
const generatedWithDetails = generatedEntries.filter(entry => entry?.detail).length;
if (eventArchiveCount) {
    const imageRate = generatedWithImages / eventArchiveCount;
    const detailRate = generatedWithDetails / eventArchiveCount;
    if (imageRate < 0.35) warnings.push(`generated event image coverage is only ${(imageRate * 100).toFixed(1)}%`);
    if (detailRate < 0.75) warnings.push(`generated event detail coverage is only ${(detailRate * 100).toFixed(1)}%`);
}

if (warnings.length) {
    console.warn("On This Day quality warnings:\n- " + warnings.join("\n- "));
}
if (failures.length) {
    console.error("On This Day validation failed:\n- " + failures.join("\n- "));
    process.exit(1);
}

console.log(`On This Day data valid: ${entries.length} entries (${eventArchiveCount} auto events, ${birthdayCount} birthdays)`);
console.log(`On This Day generated coverage: ${generatedWithImages}/${eventArchiveCount} images, ${generatedWithDetails}/${eventArchiveCount} concise details.`);
console.log("On This Day runtime regression checks passed: one stable renderer, QoL controls present, observer loops absent, representative event images intact.");
