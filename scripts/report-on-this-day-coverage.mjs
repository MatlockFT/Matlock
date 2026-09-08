import { readFile } from "node:fs/promises";

const path = process.argv[2] || "assets/data/on-this-day.json";
const data = JSON.parse(await readFile(path, "utf8"));
const entries = Array.isArray(data?.entries) ? data.entries : [];

const allDays = new Set();
const historyDays = new Set();
const birthdayDays = new Set();

for (const entry of entries) {
    const match = /^\d{4}-(\d{2}-\d{2})$/.exec(String(entry?.date || ""));
    if (!match) continue;
    const day = match[1];
    allDays.add(day);
    if (entry?.kind === "birthday") birthdayDays.add(day);
    else historyDays.add(day);
}

console.log(`On This Day calendar coverage: ${allDays.size}/366 dates populated.`);
console.log(`Historical happenings: ${historyDays.size}/366 dates.`);
console.log(`Fighter birthdays: ${birthdayDays.size}/366 dates.`);

if (historyDays.size < 300) {
    throw new Error(`Historical event coverage is unexpectedly sparse (${historyDays.size}/366 dates).`);
}
