import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const file = resolve("assets/data/on-this-day.json");
const data = JSON.parse(await readFile(file, "utf8"));
const entries = Array.isArray(data?.entries) ? data.entries : [];
const allowedKinds = new Set([
    "fight",
    "signing",
    "debut",
    "title",
    "incident",
    "news",
    "death"
]);
const failures = [];
const seen = new Set();

if (!Number.isInteger(data?.version) || data.version < 1) {
    failures.push("version must be a positive integer");
}

if (!entries.length) {
    failures.push("entries must contain at least one historical record");
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

    if (!allowedKinds.has(entry?.kind)) {
        failures.push(`${prefix}.kind is invalid`);
    }

    if (typeof entry?.title !== "string" || !entry.title.trim()) {
        failures.push(`${prefix}.title is required`);
    }

    if (entry?.detail && entry.detail.length > 240) {
        failures.push(`${prefix}.detail must stay concise (240 characters max)`);
    }

    if (entry?.sourceUrl && !/^https:\/\//i.test(entry.sourceUrl)) {
        failures.push(`${prefix}.sourceUrl must be https`);
    }

    if (entry?.imageUrl && !/^https:\/\//i.test(entry.imageUrl)) {
        failures.push(`${prefix}.imageUrl must be https`);
    }

    if (entry?.imageUrl && (typeof entry.imageAlt !== "string" || !entry.imageAlt.trim())) {
        failures.push(`${prefix}.imageAlt is required when imageUrl is present`);
    }

    if (entry?.imageCredit && typeof entry.imageCredit !== "string") {
        failures.push(`${prefix}.imageCredit must be a string`);
    }

    if (entry?.imagePosition && !/^\d{1,3}%\s+\d{1,3}%$/.test(entry.imagePosition)) {
        failures.push(`${prefix}.imagePosition must look like "50% 40%"`);
    }

    const key = `${entry?.date || ""}::${entry?.title || ""}`.toLowerCase();
    if (seen.has(key)) failures.push(`${prefix} duplicates an existing date/title`);
    seen.add(key);
}

if (failures.length) {
    console.error("On This Day validation failed:\n- " + failures.join("\n- "));
    process.exit(1);
}

console.log(`On This Day data valid: ${entries.length} entries`);
