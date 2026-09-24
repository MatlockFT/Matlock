import fs from "node:fs/promises";

const HISTORY_PATH = process.argv[2] || "assets/data/on-this-day.json";
const GENERATED_BY = "wikipedia-event-index";
const TITLE_SUFFIX = /\s+took place\s*$/i;

const history = JSON.parse(await fs.readFile(HISTORY_PATH, "utf8"));
const entries = Array.isArray(history?.entries) ? history.entries : [];
let changed = 0;

for (const entry of entries) {
    if (entry?.generatedBy !== GENERATED_BY || typeof entry?.title !== "string") continue;
    const title = entry.title.replace(TITLE_SUFFIX, "").trim();
    if (title && title !== entry.title) {
        entry.title = title;
        changed += 1;
    }

    if (typeof entry.imageAlt === "string") {
        entry.imageAlt = entry.imageAlt
            .replace(/\s+took place(?=\s+(?:event\s+)?(?:image|artwork|poster)\b)/i, "")
            .trim();
    }
}

history.eventTitleStyleVersion = 1;
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, "utf8");
console.log(`On This Day titles normalized: ${changed} generated event titles no longer end with \"took place\".`);
