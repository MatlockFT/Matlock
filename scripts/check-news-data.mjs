import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(process.argv[2] || "assets/data/mma-news.json");
const data = JSON.parse(await readFile(source, "utf8"));
const failures = [];
const warnings = [];
const now = Date.now();
const MAX_FUTURE_SKEW = 20 * 60 * 1000;
const MAX_STORY_AGE = 15 * 24 * 60 * 60 * 1000;

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const normalizedTitle = value => clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

function httpUrl(value) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol);
    } catch {
        return false;
    }
}

function canonicalUrl(value) {
    try {
        const url = new URL(value);
        url.hash = "";
        for (const key of [...url.searchParams.keys()]) {
            if (/^(?:utm_|fbclid|gclid|ref$|ref_src$)/i.test(key)) url.searchParams.delete(key);
        }
        return url.toString().replace(/\/$/, "").toLowerCase();
    } catch {
        return "";
    }
}

if (!Number.isFinite(Date.parse(data.generatedAt))) {
    failures.push("generatedAt must be a valid date");
} else if (Date.parse(data.generatedAt) > now + MAX_FUTURE_SKEW) {
    failures.push("generatedAt is implausibly far in the future");
}

if (!Number.isInteger(data.sourceCount) || data.sourceCount < 4) {
    failures.push("sourceCount must be at least 4");
}
if (!Array.isArray(data.sources)) {
    failures.push("sources must be an array");
} else {
    if (data.sources.length !== data.sourceCount) failures.push(`sourceCount says ${data.sourceCount} but ${data.sources.length} source records exist`);
    const sourceNames = new Set();
    for (const [index, feed] of data.sources.entries()) {
        if (!clean(feed?.name)) failures.push(`sources[${index}] is missing name`);
        else if (sourceNames.has(clean(feed.name).toLowerCase())) failures.push(`sources[${index}] duplicates source ${feed.name}`);
        else sourceNames.add(clean(feed.name).toLowerCase());
        if (!httpUrl(feed?.url)) failures.push(`sources[${index}] has invalid URL`);
        if (!Number.isInteger(feed?.storyCount) || feed.storyCount < 1) warnings.push(`sources[${index}] has no positive storyCount`);
    }
}

if (!data.topStory?.title || !data.topStory?.url) {
    failures.push("topStory must include a title and URL");
}

if (!Array.isArray(data.stories) || data.stories.length < 12) {
    failures.push("stories must include at least 12 entries");
}
if (Array.isArray(data.stories) && data.stories.length > 60) {
    failures.push("stories exceeds the intended 60-item latest-feed cap");
}

const stories = [data.topStory, ...(data.stories || [])].filter(Boolean);
const seenIds = new Map();
const seenUrls = new Map();
const seenTitles = new Map();
let imageCount = 0;
let multiSourceCount = 0;

for (const [index, story] of stories.entries()) {
    const label = index === 0 ? "topStory" : `stories[${index - 1}]`;
    if (!story.title || !story.source || !story.publishedAt) {
        failures.push(`incomplete story: ${story.id || label}`);
    }
    if (!story.id) failures.push(`${label} is missing id`);
    else if (seenIds.has(story.id)) failures.push(`${label} duplicates id from ${seenIds.get(story.id)}`);
    else seenIds.set(story.id, label);

    if (!httpUrl(story.url)) failures.push(`invalid story URL: ${story.url}`);
    const urlKey = canonicalUrl(story.url);
    if (urlKey) {
        if (seenUrls.has(urlKey)) failures.push(`${label} duplicates URL from ${seenUrls.get(urlKey)}`);
        else seenUrls.set(urlKey, label);
    }

    const titleKey = normalizedTitle(story.title);
    if (!titleKey) failures.push(`${label} has an empty normalized title`);
    else if (seenTitles.has(titleKey)) failures.push(`${label} duplicates normalized headline from ${seenTitles.get(titleKey)}`);
    else seenTitles.set(titleKey, label);

    if (clean(story.title).length > 170) warnings.push(`${label} headline is unusually long (${clean(story.title).length} chars)`);
    if (/\s+[,.!?;:]/.test(clean(story.title))) failures.push(`${label} headline contains spacing before punctuation`);

    const published = Date.parse(story.publishedAt);
    if (!Number.isFinite(published)) failures.push(`${label} has invalid publishedAt`);
    else {
        if (published > now + MAX_FUTURE_SKEW) failures.push(`${label} is implausibly future-dated`);
        if (published < now - MAX_STORY_AGE) failures.push(`${label} is older than the feed age ceiling`);
    }

    if (story.image) {
        imageCount += 1;
        if (!httpUrl(story.image)) failures.push(`${label} has invalid image URL`);
    }
    if (story.sourceUrl && !httpUrl(story.sourceUrl)) failures.push(`${label} has invalid sourceUrl`);

    const coverageCount = Number(story.coverageCount || 1);
    if (!Number.isInteger(coverageCount) || coverageCount < 1) failures.push(`${label} has invalid coverageCount`);
    const related = Array.isArray(story.relatedSources) ? story.relatedSources : [];
    const uniqueRelated = new Set(related.map(clean).filter(Boolean));
    if (uniqueRelated.size !== related.length) failures.push(`${label} repeats a related source`);
    if (uniqueRelated.has(clean(story.source))) failures.push(`${label} includes its primary source in relatedSources`);
    if (coverageCount !== uniqueRelated.size + 1) failures.push(`${label} coverageCount disagrees with relatedSources`);
    if (coverageCount > 1) multiSourceCount += 1;
}

if (stories.length) {
    const imageRate = imageCount / stories.length;
    if (imageRate < 0.7) warnings.push(`story image coverage is only ${(imageRate * 100).toFixed(1)}%`);
}

const topAgeHours = data.topStory?.publishedAt
    ? Math.max(0, now - Date.parse(data.topStory.publishedAt)) / 3600000
    : 0;
if (Number.isFinite(topAgeHours) && topAgeHours > 72) warnings.push(`top story is ${topAgeHours.toFixed(1)} hours old`);

if (warnings.length > 0) {
    console.warn("MMA news quality warnings:");
    warnings.forEach(warning => console.warn(`- ${warning}`));
}
if (failures.length > 0) {
    console.error("Invalid MMA news data:");
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
}

console.log(`Validated ${stories.length} stories from ${data.sourceCount} sources.`);
console.log(`News quality: ${imageCount}/${stories.length} stories have images; ${multiSourceCount} story clusters have multi-source coverage.`);
