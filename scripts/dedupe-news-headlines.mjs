import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(process.argv[2] || "assets/data/mma-news.json");
const data = JSON.parse(await readFile(source, "utf8"));

const clean = value => String(value || "").replace(/\s+/g, " ").trim();
const normalizedTitle = value => clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

if (!Array.isArray(data.stories)) {
    throw new Error("News snapshot is missing stories");
}

const seen = new Set();
const topTitle = normalizedTitle(data.topStory?.title);
if (topTitle) seen.add(topTitle);

const before = data.stories.length;
data.stories = data.stories.filter(story => {
    const key = normalizedTitle(story?.title);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
});

if (data.stories.length < 12) {
    throw new Error(`Headline dedupe left only ${data.stories.length} stories; refusing to publish`);
}

await writeFile(source, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Headline dedupe removed ${before - data.stories.length} duplicate${before - data.stories.length === 1 ? "" : "s"}.`);
