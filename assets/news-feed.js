(() => {
    const newsPage = document.querySelector("[data-news-feed]");

    if (!newsPage) return;

    const topStoryContainer = newsPage.querySelector("[data-news-top-story]");
    const storyList = newsPage.querySelector("[data-news-story-list]");
    const status = newsPage.querySelector("[data-news-status]");
    const sourceSummary = newsPage.querySelector("[data-news-source-summary]");
    const refreshButton = newsPage.querySelector("[data-news-refresh]");
    const remoteFeedUrl = newsPage.dataset.feedUrl;
    const fallbackFeedUrl = newsPage.dataset.fallbackUrl;
    const refreshInterval =
        Number(newsPage.dataset.refreshInterval) || 5 * 60 * 1000;
    let lastRefreshTime = 0;
    let refreshTimer;

    function element(tagName, className, text) {
        const node = document.createElement(tagName);

        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;

        return node;
    }

    function externalLink(url, className, text) {
        const link = element("a", className, text);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";

        return link;
    }

    function formatPublishedDate(value) {
        const date = new Date(value);
        const elapsedSeconds = Math.round((date.getTime() - Date.now()) / 1000);
        const relativeTime = new Intl.RelativeTimeFormat([], {
            numeric: "auto"
        });
        const ranges = [
            ["year", 31536000],
            ["month", 2592000],
            ["week", 604800],
            ["day", 86400],
            ["hour", 3600],
            ["minute", 60]
        ];

        for (const [unit, seconds] of ranges) {
            if (Math.abs(elapsedSeconds) >= seconds || unit === "minute") {
                return relativeTime.format(
                    Math.round(elapsedSeconds / seconds),
                    unit
                );
            }
        }

        return "just now";
    }

    function storyTime(story) {
        const time = element(
            "time",
            "news-story-time",
            formatPublishedDate(story.publishedAt)
        );
        const date = new Date(story.publishedAt);
        time.dateTime = date.toISOString();
        time.title = date.toLocaleString();

        return time;
    }

    function storyMeta(story) {
        const meta = element("div", "news-story-meta");
        meta.append(
            externalLink(
                story.sourceUrl,
                "news-story-source",
                story.source
            ),
            storyTime(story)
        );

        if (story.coverageCount > 1) {
            meta.append(
                element(
                    "span",
                    "news-coverage-count",
                    `${story.coverageCount} sources`
                )
            );
        }

        return meta;
    }

    function storyImage(story, className) {
        if (!story.image) return null;

        const imageShell = element("div", className);
        const image = document.createElement("img");
        image.src = story.image;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => imageShell.remove(), {
            once: true
        });
        imageShell.append(image);

        return imageShell;
    }

    function renderTopStory(story) {
        const article = element("article", "news-top-card");
        const copy = element("div", "news-top-copy");
        const title = element("h2", "news-top-headline");
        const titleLink = externalLink(story.url, "", story.title);
        title.append(titleLink);
        copy.append(storyMeta(story), title);

        if (story.excerpt) {
            copy.append(element("p", "news-top-excerpt", story.excerpt));
        }

        const action = externalLink(story.url, "primary-button", "Read story");
        copy.append(action);

        if (story.relatedSources?.length) {
            const coverage = element("p", "news-related-sources");
            coverage.append(
                element("strong", "", "Also covered by "),
                document.createTextNode(story.relatedSources.join(", "))
            );
            copy.append(coverage);
        }

        article.append(copy);

        const image = storyImage(story, "news-top-image");
        if (image) article.append(image);

        topStoryContainer.replaceChildren(article);
        topStoryContainer.classList.remove("news-loading-card");
        topStoryContainer.setAttribute("aria-busy", "false");
    }

    function renderStory(story) {
        const article = element("article", "news-story-card");
        const image = storyImage(story, "news-story-image");
        const copy = element("div", "news-story-copy");
        const title = element("h3");
        title.append(externalLink(story.url, "", story.title));
        copy.append(storyMeta(story), title);

        if (story.excerpt) {
            copy.append(element("p", "news-story-excerpt", story.excerpt));
        }

        if (image) article.append(image);
        article.append(copy);

        return article;
    }

    function validateFeed(data) {
        return Boolean(
            data &&
            data.topStory?.title &&
            data.topStory?.url &&
            Array.isArray(data.stories) &&
            data.stories.length > 0
        );
    }

    function setStatus(data, fallbackUsed = false) {
        const generatedAt = new Date(data.generatedAt);
        const today = new Date();
        const sameDay =
            generatedAt.getFullYear() === today.getFullYear() &&
            generatedAt.getMonth() === today.getMonth() &&
            generatedAt.getDate() === today.getDate();
        const time = sameDay
            ? generatedAt.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit"
            })
            : generatedAt.toLocaleString([], {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit"
            });
        status.textContent = fallbackUsed
            ? `Showing the last published update from ${time}`
            : `Updated ${time}`;
        status.dataset.state = fallbackUsed ? "stale" : "ready";
    }

    function renderFeed(data, fallbackUsed = false) {
        renderTopStory(data.topStory);
        storyList.replaceChildren(...data.stories.map(renderStory));
        storyList.setAttribute("aria-busy", "false");
        sourceSummary.textContent =
            `${data.sourceCount} sources · refreshed every five minutes`;
        setStatus(data, fallbackUsed);
        lastRefreshTime = Date.now();
    }

    async function fetchJson(url, useCacheBucket = false) {
        const requestUrl = new URL(url, window.location.href);

        if (useCacheBucket) {
            requestUrl.searchParams.set(
                "update",
                String(Math.floor(Date.now() / refreshInterval))
            );
        }

        const response = await fetch(requestUrl, {
            cache: "no-store",
            headers: {
                accept: "application/json"
            }
        });

        if (!response.ok) throw new Error(`News request failed: ${response.status}`);

        const responseData = await response.json();
        const data =
            typeof responseData.body === "string" && responseData.tag_name
                ? JSON.parse(responseData.body)
                : responseData;

        if (!validateFeed(data)) throw new Error("News response was incomplete");
        return data;
    }

    async function refreshFeed() {
        status.textContent = lastRefreshTime
            ? "Checking for new stories…"
            : "Loading the latest stories…";
        status.dataset.state = "loading";

        if (refreshButton) refreshButton.disabled = true;

        try {
            const data = await fetchJson(remoteFeedUrl, true);
            renderFeed(data);
        } catch {
            try {
                const fallback = await fetchJson(fallbackFeedUrl);
                renderFeed(fallback, true);
            } catch {
                status.textContent =
                    "The news feed is temporarily unavailable. Please try again.";
                status.dataset.state = "error";
            }
        } finally {
            if (refreshButton) refreshButton.disabled = false;
        }
    }

    refreshButton?.addEventListener("click", refreshFeed);

    document.addEventListener("visibilitychange", () => {
        const refreshIsDue =
            Date.now() - lastRefreshTime >= refreshInterval;

        if (!document.hidden && refreshIsDue) refreshFeed();
    });

    refreshFeed();

    refreshTimer = window.setInterval(() => {
        if (!document.hidden) refreshFeed();
    }, refreshInterval);

    window.addEventListener("pagehide", () => {
        window.clearInterval(refreshTimer);
    });
})();
