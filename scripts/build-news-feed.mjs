import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { XMLParser } from "fast-xml-parser";

const FIVE_MINUTES = 5 * 60 * 1000;
const MAX_STORY_AGE = 14 * 24 * 60 * 60 * 1000;
const MAX_ITEMS = 60;
const MINIMUM_HEALTHY_SOURCES = 4;
const MINIMUM_STORIES = 20;
const ARTICLE_IMAGE_CONCURRENCY = 6;
const ARTICLE_IMAGE_TIMEOUT = 12000;

const feeds = [
    {
        name: "MMA Fighting",
        siteUrl: "https://www.mmafighting.com/",
        feedUrl: "https://www.mmafighting.com/rss/current.xml",
        priority: 10
    },
    {
        name: "ESPN MMA",
        siteUrl: "https://www.espn.com/mma/",
        feedUrl: "https://www.espn.com/espn/rss/mma/news",
        priority: 10
    },
    {
        name: "Uncrowned",
        siteUrl: "https://sports.yahoo.com/mma/",
        feedUrl: "https://sports.yahoo.com/mma/rss/",
        priority: 10
    },
    {
        name: "UFC",
        siteUrl: "https://www.ufc.com/news",
        feedUrl: "https://www.ufc.com/rss/news",
        priority: 9
    },
    {
        name: "TMZ Sports",
        siteUrl: "https://www.tmz.com/categories/ufc/",
        feedUrl: "https://www.tmz.com/category/ufc/rss.xml",
        priority: 8,
        filter: "tmz-ufc-only",
        includeExcerpt: false
    },
    {
        name: "Sherdog",
        siteUrl: "https://www.sherdog.com/",
        feedUrl: "https://www.sherdog.com/rss/news.xml",
        priority: 9
    },
    {
        name: "MMAWeekly",
        siteUrl: "https://www.mmaweekly.com/",
        feedUrl: "https://www.mmaweekly.com/feed",
        priority: 8
    },
    {
        name: "MMA Mania",
        siteUrl: "https://www.mmamania.com/",
        feedUrl: "https://www.mmamania.com/rss/current.xml",
        priority: 9
    },
    {
        name: "Bloody Elbow",
        siteUrl: "https://bloodyelbow.com/",
        feedUrl: "https://bloodyelbow.com/feed/",
        priority: 8
    },
    {
        name: "Cageside Press",
        siteUrl: "https://cagesidepress.com/",
        feedUrl: "https://cagesidepress.com/feed/",
        priority: 8
    },
    {
        name: "LowKick MMA",
        siteUrl: "https://www.lowkickmma.com/",
        feedUrl: "https://www.lowkickmma.com/feed/",
        priority: 7
    },
    {
        name: "ONE Championship",
        siteUrl: "https://www.onefc.com/news/",
        feedUrl: "https://www.onefc.com/feed/",
        priority: 7
    },
    {
        name: "Combat Press",
        siteUrl: "https://combatpress.com/",
        feedUrl: "https://combatpress.com/feed/",
        priority: 6
    },
    {
        name: "The Fight Site",
        siteUrl: "https://www.thefight-site.com/",
        feedUrl: "https://www.thefight-site.com/home?format=rss",
        priority: 8
    },
    {
        name: "MMA Prospect Vault",
        siteUrl: "https://mmaprospectvault.com/",
        feedUrl: "https://mmaprospectvault.com/feed/",
        priority: 7
    },
    {
        name: "Phantom Punch",
        siteUrl: "https://phantompunchbreakdowns.substack.com/",
        feedUrl: "https://phantompunchbreakdowns.substack.com/feed",
        priority: 6
    },
    {
        name: "Movement Martials",
        siteUrl: "https://movementmartials.com/",
        feedUrl: "https://movementmartials.com/feed/",
        priority: 6
    },
    {
        name: "Mixing Martial Arts",
        siteUrl: "https://www.mixingmartialarts.com/",
        feedUrl: "https://www.mixingmartialarts.com/feed/",
        priority: 6
    },
    {
        name: "Cage Warriors",
        siteUrl: "https://cagewarriors.com/",
        feedUrl: "https://cagewarriors.com/feed/",
        priority: 6
    },
    {
        name: "Invicta FC",
        siteUrl: "https://invictafc.com/",
        feedUrl: "https://invictafc.com/feed/",
        priority: 5
    },
    {
        name: "LFA",
        siteUrl: "https://www.lfa.com/",
        feedUrl: "https://www.lfa.com/feed/",
        priority: 6
    },
    {
        name: "Combate Global",
        siteUrl: "https://combateglobal.com/",
        feedUrl: "https://combateglobal.com/feed/",
        priority: 5
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

const stopWords = new Set([
    "about",
    "after",
    "again",
    "against",
    "ahead",
    "amid",
    "and",
    "are",
    "at",
    "before",
    "but",
    "by",
    "for",
    "from",
    "has",
    "have",
    "his",
    "how",
    "into",
    "its",
    "mma",
    "more",
    "new",
    "news",
    "not",
    "now",
    "of",
    "on",
    "over",
    "says",
    "the",
    "their",
    "this",
    "to",
    "ufc",
    "video",
    "vs",
    "with"
]);

const tmzMmaSignal =
    /\b(?:ufc|mma|mixed martial arts?|octagon|ultimate fighting championship)\b/i;
const tmzExcludedTopic =
    /\b(?:bikini|cheek of the week|gallery|hot bodies|hotties?|onlyfans|swimsuit)\b/i;

function asArray(value) {
    if (value === undefined || value === null) return [];
    return Array.isArray(value) ? value : [value];
}

function textValue(value) {
    if (typeof value === "string" || typeof value === "number") {
        return String(value).trim();
    }

    if (Array.isArray(value)) {
        return textValue(value[0]);
    }

    if (value && typeof value === "object") {
        return textValue(value["#text"]);
    }

    return "";
}

function decodeEntities(value) {
    return value
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#(\d+);/g, (_, code) =>
            String.fromCodePoint(Number(code))
        )
        .replace(/&#x([\da-f]+);/gi, (_, code) =>
            String.fromCodePoint(Number.parseInt(code, 16))
        );
}

function plainText(value) {
    return decodeEntities(textValue(value))
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function truncate(value, maximumLength) {
    if (value.length <= maximumLength) return value;

    const shortened = value.slice(0, maximumLength + 1);
    const lastSpace = shortened.lastIndexOf(" ");

    return `${shortened.slice(0, Math.max(lastSpace, maximumLength - 24))}…`;
}

function safeUrl(value) {
    const rawValue = decodeEntities(textValue(value))
        .replace(/#0*38;/gi, "&");

    try {
        const url = new URL(rawValue);

        if (!["http:", "https:"].includes(url.protocol)) return "";

        [
            "fbclid",
            "gclid",
            "ref",
            "ref_src",
            "utm_campaign",
            "utm_content",
            "utm_medium",
            "utm_source",
            "utm_term"
        ].forEach(parameter => url.searchParams.delete(parameter));

        return url.toString();
    } catch {
        return "";
    }
}

function resolvedUrl(value, baseUrl) {
    const rawValue = decodeEntities(String(value || "").trim());

    try {
        return safeUrl(new URL(rawValue, baseUrl).toString());
    } catch {
        return "";
    }
}

function tagAttribute(tag, name) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = tag.match(
        new RegExp(
            `(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
            "i"
        )
    );

    return decodeEntities(match?.[1] || match?.[2] || match?.[3] || "");
}

function structuredArticleImage(value, baseUrl) {
    const entries = Array.isArray(value) ? value : [value];

    for (const entry of entries) {
        if (typeof entry === "string") {
            const url = resolvedUrl(entry, baseUrl);
            if (url) return url;
        }

        if (entry && typeof entry === "object") {
            const url = resolvedUrl(
                entry.url || entry.contentUrl || entry["@id"],
                baseUrl
            );
            if (url) return url;
        }
    }

    return "";
}

function articleImageFromHtml(html, baseUrl) {
    const imageKeys = new Set([
        "og:image",
        "og:image:secure_url",
        "twitter:image",
        "twitter:image:src"
    ]);

    for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
        const tag = match[0];
        const key = (
            tagAttribute(tag, "property") ||
            tagAttribute(tag, "name")
        ).toLowerCase();

        if (!imageKeys.has(key)) continue;

        const url = resolvedUrl(tagAttribute(tag, "content"), baseUrl);
        if (url) return url;
    }

    for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
        const tag = match[0];
        const relationships = tagAttribute(tag, "rel")
            .toLowerCase()
            .split(/\s+/);

        if (!relationships.includes("image_src")) continue;

        const url = resolvedUrl(tagAttribute(tag, "href"), baseUrl);
        if (url) return url;
    }

    for (
        const match of html.matchAll(
            /<script\b[^>]*type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi
        )
    ) {
        try {
            const data = JSON.parse(decodeEntities(match[1]));
            const roots = Array.isArray(data) ? data : [data];
            const entries = roots.flatMap(root =>
                Array.isArray(root?.["@graph"]) ? root["@graph"] : [root]
            );

            for (const entry of entries) {
                const types = asArray(entry?.["@type"])
                    .map(type => String(type).toLowerCase());

                if (
                    !types.some(type =>
                        type === "article" ||
                        type.endsWith("article") ||
                        type === "news"
                    )
                ) {
                    continue;
                }

                const url = structuredArticleImage(entry.image, baseUrl);
                if (url) return url;
            }
        } catch {
            // Some publishers include malformed or non-JSON data in this tag.
        }
    }

    return "";
}

async function fetchArticleImage(story) {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        ARTICLE_IMAGE_TIMEOUT
    );

    try {
        const response = await fetch(story.url, {
            headers: {
                accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
                "user-agent": "MMA Matlock News Aggregator/1.0 (+https://matlockfighttalk.com/news/)"
            },
            redirect: "follow",
            signal: controller.signal
        });

        if (!response.ok) return "";

        const contentType = response.headers.get("content-type") || "";
        if (contentType && !contentType.includes("html")) return "";

        return articleImageFromHtml(await response.text(), response.url);
    } catch {
        return "";
    } finally {
        clearTimeout(timeout);
    }
}

async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let nextIndex = 0;

    async function run() {
        while (nextIndex < items.length) {
            const index = nextIndex;
            nextIndex += 1;
            results[index] = await worker(items[index], index);
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(limit, items.length) },
            run
        )
    );

    return results;
}

function itemLink(item) {
    for (const link of asArray(item.link)) {
        if (typeof link === "string") {
            const url = safeUrl(link);
            if (url) return url;
        }

        if (
            link &&
            typeof link === "object" &&
            (!link["@rel"] || link["@rel"] === "alternate")
        ) {
            const url = safeUrl(link["@href"] || link["#text"]);
            if (url) return url;
        }
    }

    return safeUrl(item.guid || item.id);
}

function itemMatchesFeed(feed, item) {
    if (feed.filter !== "tmz-ufc-only") return true;

    const title = plainText(item.title);
    const url = itemLink(item);
    const summary = plainText(
        item.description ||
        item.summary ||
        item["content:encoded"] ||
        item.content
    );
    const combined = `${title} ${url} ${summary}`;
    const headlineAndUrl = `${title} ${url}`;

    return (
        tmzMmaSignal.test(combined) &&
        !tmzExcludedTopic.test(headlineAndUrl)
    );
}

function imageCandidate(value) {
    for (const entry of asArray(value)) {
        if (typeof entry === "string") {
            const url = safeUrl(entry);
            if (url) return url;
        }

        if (entry && typeof entry === "object") {
            const url = safeUrl(
                entry["@url"] ||
                entry["@href"] ||
                entry.url ||
                entry["#text"]
            );

            if (url) return url;
        }
    }

    return "";
}

function itemImage(item) {
    const candidates = [
        item["media:content"],
        item["media:thumbnail"],
        item.enclosure,
        item.image,
        item["itunes:image"]
    ];

    for (const candidate of candidates) {
        const image = imageCandidate(candidate);
        if (image) return image;
    }

    const html = textValue(
        item["content:encoded"] ||
        item.content ||
        item.description ||
        item.summary
    );
    const imageMatch = html.match(
        /<img[^>]+src=["'](https?:\/\/[^"']+)["']/i
    );

    return safeUrl(imageMatch?.[1]);
}

function itemDate(item) {
    const candidates = [
        item.pubDate,
        item.published,
        item.updated,
        item["dc:date"],
        item.date
    ];

    for (const candidate of candidates) {
        const timestamp = Date.parse(textValue(candidate));

        if (Number.isFinite(timestamp)) {
            return new Date(timestamp).toISOString();
        }
    }

    return "";
}

function itemExcerpt(item, title) {
    const source = plainText(
        item.description ||
        item.summary ||
        item["content:encoded"] ||
        item.content
    );

    if (!source || source.toLowerCase() === title.toLowerCase()) return "";
    return truncate(source, 190);
}

function feedItems(parsed) {
    if (parsed?.rss?.channel?.item) {
        return asArray(parsed.rss.channel.item);
    }

    if (parsed?.feed?.entry) {
        return asArray(parsed.feed.entry);
    }

    if (parsed?.["rdf:RDF"]?.item) {
        return asArray(parsed["rdf:RDF"].item);
    }

    return [];
}

async function fetchFeed(feed) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(feed.feedUrl, {
            headers: {
                accept: "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
                "user-agent": "MMA Matlock News Aggregator/1.0 (+https://matlockfighttalk.com/news/)"
            },
            redirect: "follow",
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const xml = await response.text();
        const parsed = parser.parse(xml);
        const cutoff = Date.now() - MAX_STORY_AGE;
        const stories = feedItems(parsed)
            .filter(item => itemMatchesFeed(feed, item))
            .map((item, feedRank) => {
                const title = plainText(item.title);
                const url = itemLink(item);
                const publishedAt = itemDate(item);
                const timestamp = Date.parse(publishedAt);

                if (
                    !title ||
                    !url ||
                    !Number.isFinite(timestamp) ||
                    timestamp < cutoff
                ) {
                    return null;
                }

                return {
                    id: createHash("sha256").update(url).digest("hex").slice(0, 16),
                    title: truncate(title, 160),
                    url,
                    source: feed.name,
                    sourceUrl: feed.siteUrl,
                    publishedAt,
                    excerpt: feed.includeExcerpt === false
                        ? ""
                        : itemExcerpt(item, title),
                    image: itemImage(item),
                    feedRank,
                    sourcePriority: feed.priority
                };
            })
            .filter(Boolean);

        return {
            feed,
            stories
        };
    } finally {
        clearTimeout(timeout);
    }
}

function titleTokens(title) {
    return new Set(
        title
            .toLowerCase()
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-z0-9\s-]/g, " ")
            .split(/[\s-]+/)
            .filter(token =>
                token.length >= 3 &&
                !stopWords.has(token) &&
                !/^\d+$/.test(token)
            )
    );
}

function titlesMatch(first, second) {
    const firstTokens = titleTokens(first);
    const secondTokens = titleTokens(second);

    if (firstTokens.size === 0 || secondTokens.size === 0) return false;

    const intersection = [...firstTokens].filter(token =>
        secondTokens.has(token)
    ).length;
    const union = new Set([...firstTokens, ...secondTokens]).size;
    const similarity = intersection / union;

    return (
        (intersection >= 4 && similarity >= 0.42) ||
        (intersection >= 3 && similarity >= 0.58)
    );
}

function clusterStories(stories) {
    const clusters = [];

    for (const story of stories) {
        const matchingCluster = clusters.find(cluster =>
            titlesMatch(cluster.representative.title, story.title)
        );

        if (matchingCluster) {
            matchingCluster.stories.push(story);

            if (
                story.sourcePriority > matchingCluster.representative.sourcePriority ||
                (
                    story.sourcePriority === matchingCluster.representative.sourcePriority &&
                    story.publishedAt > matchingCluster.representative.publishedAt
                )
            ) {
                matchingCluster.representative = story;
            }
        } else {
            clusters.push({
                representative: story,
                stories: [story]
            });
        }
    }

    return clusters;
}

function publicStory(cluster) {
    const story = cluster.representative;
    const image = story.image ||
        cluster.stories.find(entry => entry.image)?.image ||
        "";
    const excerpt = story.excerpt ||
        cluster.stories.find(entry => entry.excerpt)?.excerpt ||
        "";
    const relatedSources = [
        ...new Set(cluster.stories.map(entry => entry.source))
    ].filter(source => source !== story.source);

    return {
        id: story.id,
        title: story.title,
        url: story.url,
        source: story.source,
        sourceUrl: story.sourceUrl,
        publishedAt: story.publishedAt,
        excerpt,
        image,
        coverageCount: relatedSources.length + 1,
        relatedSources
    };
}

function topStoryScore(cluster) {
    const story = cluster.representative;
    const ageHours =
        Math.max(0, Date.now() - Date.parse(story.publishedAt)) / 3600000;
    const freshness = Math.max(0, 72 - ageHours);
    const coverage = (
        new Set(cluster.stories.map(entry => entry.source)).size - 1
    ) * 55;
    const prominence = Math.max(0, 22 - story.feedRank * 2);

    return freshness + coverage + prominence + story.sourcePriority;
}

function deduplicateUrls(stories) {
    const seen = new Set();

    return stories.filter(story => {
        if (seen.has(story.url)) return false;
        seen.add(story.url);
        return true;
    });
}

function outputPath() {
    return resolve(argumentValue("--output") || "assets/data/mma-news.json");
}

function argumentValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : "";
}

async function previousImageMap() {
    const requested = argumentValue("--previous");
    if (!requested) return new Map();

    try {
        const data = JSON.parse(await readFile(resolve(requested), "utf8"));
        return new Map(
            [data.topStory, ...asArray(data.stories)]
                .filter(story => story?.url && story?.image)
                .map(story => [safeUrl(story.url), safeUrl(story.image)])
                .filter(([url, image]) => url && image)
        );
    } catch {
        console.warn("Previous news snapshot unavailable; fetching missing previews");
        return new Map();
    }
}

async function enrichStoryImages(stories, previousImages) {
    let reused = 0;

    for (const story of stories) {
        if (story.image) continue;

        const previousImage = previousImages.get(safeUrl(story.url));
        if (!previousImage) continue;

        story.image = previousImage;
        reused += 1;
    }

    const missing = stories.filter(story => !story.image);
    const fetched = await mapWithConcurrency(
        missing,
        ARTICLE_IMAGE_CONCURRENCY,
        fetchArticleImage
    );
    let discovered = 0;

    fetched.forEach((image, index) => {
        if (!image) return;
        missing[index].image = image;
        discovered += 1;
    });

    console.log(
        `Article previews: ${reused} reused, ${discovered} discovered, ` +
        `${missing.length - discovered} still using branded fallback`
    );
}

const results = await Promise.allSettled(feeds.map(fetchFeed));
const successful = results
    .filter(result => result.status === "fulfilled")
    .map(result => result.value);
const activeSources = successful.filter(result => result.stories.length > 0);
const failed = results
    .map((result, index) => ({ result, feed: feeds[index] }))
    .filter(({ result }) => result.status === "rejected");

for (const { result, feed } of failed) {
    console.warn(`${feed.name}: ${result.reason?.message || "feed failed"}`);
}

const stories = deduplicateUrls(
    successful
        .flatMap(result => result.stories)
        .sort((first, second) =>
            second.publishedAt.localeCompare(first.publishedAt)
        )
);

if (
    activeSources.length < MINIMUM_HEALTHY_SOURCES ||
    stories.length < MINIMUM_STORIES
) {
    throw new Error(
        `News update stopped: ${activeSources.length} active sources and ${stories.length} usable stories`
    );
}

const clusters = clusterStories(stories);
const rankedClusters = [...clusters].sort(
    (first, second) => topStoryScore(second) - topStoryScore(first)
);
const topCluster = rankedClusters[0];
const topStory = publicStory(topCluster);
const latest = clusters
    .filter(cluster => cluster !== topCluster)
    .sort((first, second) =>
        second.representative.publishedAt.localeCompare(
            first.representative.publishedAt
        )
    )
    .slice(0, MAX_ITEMS)
    .map(publicStory);
const publicStories = [topStory, ...latest];
await enrichStoryImages(publicStories, await previousImageMap());

const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    refreshIntervalMs: FIVE_MINUTES,
    sourceCount: activeSources.length,
    sources: activeSources.map(({ feed, stories: sourceStories }) => ({
        name: feed.name,
        url: feed.siteUrl,
        storyCount: sourceStories.length
    })),
    topStory,
    stories: latest
};

const destination = outputPath();
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`);

console.log(
    `Wrote ${latest.length + 1} stories from ${activeSources.length} sources to ${destination}`
);
