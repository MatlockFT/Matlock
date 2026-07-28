import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(process.argv[2] || "assets/data/mma-news.json");
const data = JSON.parse(await readFile(source, "utf8"));
const failures = [];

if (!Number.isFinite(Date.parse(data.generatedAt))) {
    failures.push("generatedAt must be a valid date");
}

if (!Number.isInteger(data.sourceCount) || data.sourceCount < 4) {
    failures.push("sourceCount must be at least 4");
}

if (!data.topStory?.title || !data.topStory?.url) {
    failures.push("topStory must include a title and URL");
}

if (!Array.isArray(data.stories) || data.stories.length < 12) {
    failures.push("stories must include at least 12 entries");
}

for (const story of [data.topStory, ...(data.stories || [])]) {
    if (!story) continue;

    if (!story.title || !story.source || !story.publishedAt) {
        failures.push(`incomplete story: ${story.id || "unknown"}`);
    }

    try {
        const url = new URL(story.url);

        if (!["http:", "https:"].includes(url.protocol)) {
            failures.push(`invalid story URL: ${story.url}`);
        }
    } catch {
        failures.push(`invalid story URL: ${story.url}`);
    }
}

if (failures.length > 0) {
    console.error("Invalid MMA news data:");
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
}

console.log(
    `Validated ${data.stories.length + 1} stories from ${data.sourceCount} sources.`
);
