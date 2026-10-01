import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";

const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_PER_SOURCE = 30;
const TRANSLATE_TIMEOUT = 12000;
const FEED_TIMEOUT = 15000;

const SOURCES = [
  {
    name: "MMAPLANET",
    siteUrl: "https://mmaplanet.jp/",
    feedUrl: "https://mmaplanet.jp/feed"
  },
  {
    name: "Gong Kakutogi",
    siteUrl: "https://gonkaku.jp/",
    feedUrl: "https://gonkaku.jp/feed"
  }
];

const parser = new XMLParser({
  attributeNamePrefix: "@",
  ignoreAttributes: false,
  parseTagValue: false,
  processEntities: true,
  textNodeName: "#text",
  trimValues: true
});

async function loadGlossary() {
  try {
    const data = JSON.parse(
      await readFile(resolve("scripts/news/japan-mma-glossary.json"), "utf8")
    );
    return Object.entries(data)
      .filter(([ja, en]) => ja && en)
      .sort((a, b) => b[0].length - a[0].length);
  } catch {
    return [];
  }
}

const NAME_GLOSSARY = await loadGlossary();

function protectGlossary(value) {
  let text = String(value || "");
  const replacements = [];
  NAME_GLOSSARY.forEach(([ja, en], index) => {
    if (!text.includes(ja)) return;
    const token = `ZXQMMA${index}QXZ`;
    text = text.split(ja).join(token);
    replacements.push([token, en]);
  });
  return { text, replacements };
}

function restoreGlossary(value, replacements) {
  let text = String(value || "");
  for (const [token, english] of replacements || []) {
    text = text.split(token).join(english);
    text = text.split(token.toLowerCase()).join(english);
  }
  return text;
}

const asArray = value => value == null ? [] : Array.isArray(value) ? value : [value];

function textValue(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    return textValue(value["#text"] ?? value.text ?? value.content ?? "");
  }
  return "";
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function plainText(value) {
  return decodeEntities(textValue(value))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return /^https?:$/.test(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function itemLink(item) {
  for (const link of asArray(item.link)) {
    if (typeof link === "string") {
      const url = safeUrl(link);
      if (url) return url;
    }
    if (link && typeof link === "object") {
      const url = safeUrl(link["@href"] || link["@url"] || link["#text"]);
      if (url) return url;
    }
  }
  return safeUrl(item.guid || item.id);
}

function itemDate(item) {
  for (const candidate of [
    item.pubDate,
    item.published,
    item.updated,
    item["dc:date"],
    item.date
  ]) {
    const stamp = Date.parse(textValue(candidate));
    if (Number.isFinite(stamp)) return new Date(Math.min(stamp, Date.now())).toISOString();
  }
  return "";
}

function imageCandidate(value) {
  for (const entry of asArray(value)) {
    if (typeof entry === "string") {
      const url = safeUrl(entry);
      if (url) return url;
    } else if (entry && typeof entry === "object") {
      const url = safeUrl(entry["@url"] || entry.url || entry["@href"] || entry["#text"]);
      if (url) return url;
    }
  }
  return "";
}

function itemImage(item) {
  for (const candidate of [
    item["media:content"],
    item["media:thumbnail"],
    item.enclosure,
    item.image
  ]) {
    const url = imageCandidate(candidate);
    if (url) return url;
  }

  const html = textValue(item["content:encoded"] || item.content || item.description || item.summary);
  const match = html.match(/<img[^>]+src=["'](https?:\/\/[^"']+)["']/i);
  return safeUrl(match?.[1]);
}

function feedItems(parsed) {
  if (parsed?.rss?.channel?.item) return asArray(parsed.rss.channel.item);
  if (parsed?.feed?.entry) return asArray(parsed.feed.entry);
  if (parsed?.["rdf:RDF"]?.item) return asArray(parsed["rdf:RDF"].item);
  return [];
}

function containsJapanese(value) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(value || ""));
}

function normalizedTranslation(value) {
  return String(value || "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

async function googleLiteralTranslate(value) {
  const original = plainText(value);
  if (!original || !containsJapanese(original)) return original;

  const protectedText = protectGlossary(original);
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "ja");
  url.searchParams.set("tl", "en");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", protectedText.text);

  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "application/json,text/plain,*/*"
    },
    signal: AbortSignal.timeout(TRANSLATE_TIMEOUT)
  });

  if (!response.ok) throw new Error(`translation HTTP ${response.status}`);
  const data = await response.json();
  const translated = asArray(data?.[0]).map(part => String(part?.[0] || "")).join("");
  const restored = restoreGlossary(translated, protectedText.replacements);
  return normalizedTranslation(restored) || original;
}

async function previousMap(url) {
  if (!url) return new Map();
  try {
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return new Map();
    const data = await response.json();
    return new Map(
      asArray(data.stories)
        .filter(item => item?.url)
        .map(item => [safeUrl(item.url), item])
        .filter(([url]) => url)
    );
  } catch {
    return new Map();
  }
}

async function translateStory(story, previous) {
  const cached = previous.get(story.url);
  if (
    cached?.originalTitle === story.originalTitle &&
    cached?.title &&
    cached?.translation?.language === "ja"
  ) {
    return {
      ...story,
      title: cached.title,
      excerpt: cached.originalExcerpt === story.originalExcerpt
        ? cached.excerpt || ""
        : story.excerpt,
      translation: cached.translation
    };
  }

  let title = story.originalTitle;
  let excerpt = story.originalExcerpt;
  let translated = false;

  try {
    title = await googleLiteralTranslate(story.originalTitle);
    translated = title !== story.originalTitle;
  } catch {}

  if (story.originalExcerpt) {
    try {
      excerpt = await googleLiteralTranslate(story.originalExcerpt);
    } catch {
      excerpt = story.originalExcerpt;
    }
  }

  return {
    ...story,
    title,
    excerpt,
    translation: {
      language: "ja",
      mode: translated ? "literal-machine+mma-glossary" : "original-fallback",
      originalPreserved: true,
      glossaryProtected: translated
    }
  };
}

async function fetchSource(source, previous) {
  const response = await fetch(source.feedUrl, {
    headers: {
      accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      "accept-language": "ja,en-US;q=0.7,en;q=0.5",
      "user-agent": "MMA Matlock Japan News/1.0 (+https://mmamatlock.com/)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(FEED_TIMEOUT)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const parsed = parser.parse(await response.text());
  const cutoff = Date.now() - MAX_AGE_MS;
  const raw = feedItems(parsed)
    .map((item, rank) => {
      const originalTitle = plainText(item.title);
      const url = itemLink(item);
      const publishedAt = itemDate(item);
      const stamp = Date.parse(publishedAt);
      if (!originalTitle || !url || !Number.isFinite(stamp) || stamp < cutoff) return null;

      const originalExcerpt = plainText(
        item.description || item.summary || item["content:encoded"] || item.content
      ).slice(0, 360);

      return {
        id: createHash("sha256").update(url).digest("hex").slice(0, 16),
        title: originalTitle,
        originalTitle,
        url,
        source: source.name,
        sourceUrl: source.siteUrl,
        publishedAt,
        excerpt: originalExcerpt,
        originalExcerpt,
        image: itemImage(item),
        language: "ja",
        feedRank: rank
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PER_SOURCE);

  const translated = [];
  for (const story of raw) translated.push(await translateStory(story, previous));
  return translated;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const previous = await previousMap(argumentValue("--previous-url"));
const results = await Promise.allSettled(SOURCES.map(source => fetchSource(source, previous)));
const sources = [];
const stories = [];

results.forEach((result, index) => {
  const source = SOURCES[index];
  if (result.status === "fulfilled") {
    sources.push({
      name: source.name,
      url: source.siteUrl,
      storyCount: result.value.length,
      status: "ok"
    });
    stories.push(...result.value);
  } else {
    sources.push({
      name: source.name,
      url: source.siteUrl,
      storyCount: 0,
      status: "unavailable"
    });
    console.warn(`${source.name}: ${result.reason?.message || "feed failed"}`);
  }
});

stories.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  language: "ja",
  translationPolicy: "Literal English machine translation with a Japanese MMA proper-name glossary applied before translation. The original Japanese title and excerpt are preserved on every item. If translation fails, the original Japanese is shown rather than guessed.",
  sources,
  stories
};

const destination = resolve(argumentValue("--output") || "assets/data/japan-mma-news.json");
await writeFile(destination, JSON.stringify(output, null, 2) + "\n");
console.log(`Wrote ${stories.length} Japanese MMA stories from ${sources.filter(s => s.status === "ok").length} sources to ${destination}`);
