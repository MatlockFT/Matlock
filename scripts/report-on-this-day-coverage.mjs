import { readFile } from "node:fs/promises";

const path = process.argv[2] || "assets/data/on-this-day.json";
const data = JSON.parse(await readFile(path, "utf8"));
const entries = Array.isArray(data?.entries) ? data.entries : [];

const allDays = new Set();
const historyDays = new Set();
const birthdayDays = new Set();
const historical = [];
const generated = [];
const events = [];
const byPromotion = new Map();

const hasImage = entry => typeof entry?.imageUrl === "string" && /^https:\/\//i.test(entry.imageUrl);
const isEvent = entry => entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
const hasVerifiedPoster = entry => isEvent(entry) && hasImage(entry) &&
    entry?.imagePosterVerified === true && entry?.imageArtifactType === 'event-poster';
const promotionName = entry => String(entry?.promotion || "Other").trim() || "Other";

for (const entry of entries) {
    const match = /^\d{4}-(\d{2}-\d{2})$/.exec(String(entry?.date || ""));
    if (!match) continue;
    const day = match[1];
    allDays.add(day);
    if (entry?.kind === "birthday") {
        birthdayDays.add(day);
        continue;
    }

    historyDays.add(day);
    historical.push(entry);
    if (entry?.generatedBy === "wikipedia-event-index") generated.push(entry);
    if (isEvent(entry)) events.push(entry);

    const promotion = promotionName(entry);
    if (!byPromotion.has(promotion)) byPromotion.set(promotion, { total: 0, images: 0, events: 0, posters: 0 });
    const stats = byPromotion.get(promotion);
    stats.total += 1;
    if (hasImage(entry)) stats.images += 1;
    if (isEvent(entry)) {
        stats.events += 1;
        if (hasVerifiedPoster(entry)) stats.posters += 1;
    }
}

const historicalWithImages = historical.filter(hasImage).length;
const generatedWithImages = generated.filter(hasImage).length;
const verifiedPosters = events.filter(hasVerifiedPoster).length;
const pct = (part, total) => total ? `${((part / total) * 100).toFixed(1)}%` : "0.0%";

console.log(`On This Day calendar coverage: ${allDays.size}/366 dates populated.`);
console.log(`Historical happenings: ${historyDays.size}/366 dates.`);
console.log(`Fighter birthdays: ${birthdayDays.size}/366 dates.`);
console.log(`Historical image coverage: ${historicalWithImages}/${historical.length} (${pct(historicalWithImages, historical.length)}).`);
console.log(`Verified event-poster coverage: ${verifiedPosters}/${events.length} (${pct(verifiedPosters, events.length)}).`);
console.log(`Generated entries with any image: ${generatedWithImages}/${generated.length} (${pct(generatedWithImages, generated.length)}).`);
console.log(`Historical fallbacks remaining: ${historical.length - historicalWithImages}.`);

const promotionRows = [...byPromotion.entries()]
    .filter(([, stats]) => stats.total >= 3)
    .sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]));

if (promotionRows.length) {
    console.log("Image coverage by promotion:");
    for (const [promotion, stats] of promotionRows) {
        const posterPart = stats.events ? ` · event posters ${stats.posters}/${stats.events} (${pct(stats.posters, stats.events)})` : '';
        console.log(`- ${promotion}: images ${stats.images}/${stats.total} (${pct(stats.images, stats.total)})${posterPart}`);
    }
}

if (historyDays.size < 300) {
    throw new Error(`Historical event coverage is unexpectedly sparse (${historyDays.size}/366 dates).`);
}

if (events.length && verifiedPosters / events.length < 0.45) {
    console.warn(`Verified event-poster coverage is below the 45% archive backfill target (${verifiedPosters}/${events.length}); continuing so the daily Tapology-first backfill can improve it.`);
}
