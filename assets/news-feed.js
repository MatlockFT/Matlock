(() => {
    const newsPage = document.querySelector("[data-news-feed]");
    if (!newsPage) return;

    const leadGrid = newsPage.querySelector("[data-news-lead-grid]");
    const topStorySlot = newsPage.querySelector("[data-news-top-story]");
    const latestList = newsPage.querySelector("[data-news-latest-list]");
    const moreList = newsPage.querySelector("[data-news-more-list]");
    const status = newsPage.querySelector("[data-news-status]");
    const liveStatus = newsPage.querySelector(".news-live-status");
    const summary = newsPage.querySelector("[data-news-summary]");
    const refreshButton = newsPage.querySelector("[data-news-refresh]");
    const sourceFilter = newsPage.querySelector("[data-news-source-filter]");
    const showMoreButton = newsPage.querySelector("[data-news-show-more]");
    const remoteFeedUrl = newsPage.dataset.feedUrl;
    const fallbackFeedUrl = newsPage.dataset.fallbackUrl;
    const refreshInterval = Number(newsPage.dataset.refreshInterval) || 300000;
    const LATEST_COUNT = 4;
    const MORE_INCREMENT = 6;
    const BOXING_SIGNAL = /\b(?:boxing|boxer|pugilist|wbc|wba|ibf|wbo|the ring|ring magazine|canelo|saul alvarez|tyson fury|oleksandr usyk|anthony joshua|terence crawford|gervonta davis|ryan garcia|naoya inoue|devin haney|shakur stevenson|teofimo lopez|dmitry bivol|artur beterbiev|jai opetai?a|jaron ennis|sebastian fundora|david benavidez|caleb plant|katie taylor|claressa shields|amanda serrano)\b/i;

    let refreshTimer = 0;
    let allStories = [];
    let moreVisibleCount = MORE_INCREMENT;
    let selectedSource = "all";

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

    function safeDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function relativeTime(value) {
        const date = safeDate(value);
        if (!date) return "Recently";

        const elapsedSeconds = Math.round((date.getTime() - Date.now()) / 1000);
        const relative = new Intl.RelativeTimeFormat([], { numeric: "auto" });
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
                return relative.format(Math.round(elapsedSeconds / seconds), unit);
            }
        }

        return "just now";
    }

    function timeChip(story) {
        const date = safeDate(story.publishedAt);
        const time = element("time", "news-time-chip", relativeTime(story.publishedAt));

        if (date) {
            time.dateTime = date.toISOString();
            time.title = date.toLocaleString();
        }

        return time;
    }

    function sourceChip(story) {
        if (story.sourceUrl) {
            return externalLink(story.sourceUrl, "news-source-chip", story.source || "Source");
        }

        return element("span", "news-source-chip", story.source || "Source");
    }

    function coverageChip(story) {
        if (!(story.coverageCount > 1)) return null;
        return element("span", "news-coverage-chip", `${story.coverageCount} sources`);
    }

    function appendMeta(container, story, includeTopLabel = false) {
        if (includeTopLabel) {
            container.append(element("span", "news-top-label", "Top story"));
        }

        container.append(sourceChip(story), timeChip(story));
        const coverage = coverageChip(story);
        if (coverage) container.append(coverage);
    }

    function addImage(container, story, className, eager = false) {
        if (!story.image) return false;

        const image = document.createElement("img");
        image.src = story.image;
        image.alt = "";
        image.loading = eager ? "eager" : "lazy";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        image.addEventListener("error", () => {
            image.remove();
            container.classList.add(`${className}--empty`);
            container.dataset.source = story.source || "MMA";
        }, { once: true });
        container.append(image);
        return true;
    }

    function isBoxingStory(story) {
        const title = story?.title || "";
        const excerpt = story?.excerpt || "";
        const url = story?.url || "";
        return BOXING_SIGNAL.test(`${title} ${excerpt}`) || /\/boxing(?:\/|[-?])/i.test(url);
    }

    function prioritizeMmaLead(stories) {
        if (stories.length < 2 || !isBoxingStory(stories[0])) return stories;

        const mmaIndex = stories.findIndex((story, index) => index > 0 && !isBoxingStory(story));
        if (mmaIndex < 1) return stories;

        const ordered = [...stories];
        const [mmaLead] = ordered.splice(mmaIndex, 1);
        ordered.unshift(mmaLead);
        return ordered;
    }

    function renderTopStory(story) {
        const article = element("article", "news-lead-card");
        article.dataset.storyId = story.id || story.url;

        const media = element("div", "news-lead-media");
        if (!addImage(media, story, "news-lead-media", true)) {
            media.append(element("span", "news-lead-placeholder", story.source || "MMA News"));
        }

        const content = element("div", "news-lead-content");
        const meta = element("div", "news-lead-meta");
        appendMeta(meta, story, true);

        const heading = element("h2");
        heading.append(externalLink(story.url, "", story.title));

        content.append(meta, heading);
        article.append(media, content);
        return article;
    }

    function renderLatestStory(story) {
        const article = element("article", "news-latest-row");
        article.dataset.storyId = story.id || story.url;

        const thumb = element("div", "news-latest-thumb");
        if (!addImage(thumb, story, "news-latest-thumb")) {
            thumb.classList.add("news-latest-thumb--empty");
            thumb.dataset.source = story.source || "MMA";
        }

        const copy = element("div", "news-latest-copy");
        const meta = element("div", "news-latest-meta");
        meta.append(
            element("span", "", story.source || "Source"),
            element("span", "", relativeTime(story.publishedAt))
        );

        const title = element("h4", "news-latest-title");
        title.append(externalLink(story.url, "", story.title));
        copy.append(meta, title);
        article.append(thumb, copy);
        return article;
    }

    function renderMoreStory(story) {
        const article = element("article", "news-card");
        article.dataset.storyId = story.id || story.url;

        const media = element("div", "news-card-media");
        if (!addImage(media, story, "news-card-media")) {
            media.append(element("span", "news-card-placeholder", story.source || "MMA News"));
        }

        const body = element("div", "news-card-body");
        const meta = element("div", "news-card-meta");
        appendMeta(meta, story);

        const title = element("h3");
        title.append(externalLink(story.url, "", story.title));
        body.append(meta, title);
        article.append(media, body);
        return article;
    }

    function uniqueStories(data) {
        const seen = new Set();
        const stories = [data.topStory, ...(data.stories || [])].filter(story => {
            if (!story?.title || !story?.url) return false;
            const key = story.id || story.url;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return prioritizeMmaLead(stories);
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

    function updateSummary() {
        const sourceCount = new Set(allStories.map(story => story.source).filter(Boolean)).size;
        summary.textContent = `${allStories.length} stories · ${sourceCount} sources`;
    }

    function updateSourceFilter() {
        const previous = selectedSource;
        const sources = [...new Set(
            allStories.slice(1 + LATEST_COUNT).map(story => story.source).filter(Boolean)
        )].sort((a, b) => a.localeCompare(b));

        const options = [element("option", "", "All sources")];
        options[0].value = "all";

        sources.forEach(source => {
            const option = element("option", "", source);
            option.value = source;
            options.push(option);
        });

        sourceFilter.replaceChildren(...options);
        selectedSource = sources.includes(previous) ? previous : "all";
        sourceFilter.value = selectedSource;
    }

    function filteredMoreStories() {
        const stories = allStories.slice(1 + LATEST_COUNT);
        if (selectedSource === "all") return stories;
        return stories.filter(story => story.source === selectedSource);
    }

    function renderMoreStories() {
        const stories = filteredMoreStories();
        const visibleStories = stories.slice(0, moreVisibleCount);

        if (!visibleStories.length) {
            moreList.replaceChildren(
                element("p", "news-empty", "No additional stories match this source right now.")
            );
        } else {
            moreList.replaceChildren(...visibleStories.map(renderMoreStory));
        }

        moreList.setAttribute("aria-busy", "false");
        showMoreButton.hidden = stories.length <= visibleStories.length;
        showMoreButton.textContent = `Show more stories${stories.length > visibleStories.length ? ` (${stories.length - visibleStories.length})` : ""}`;
    }

    function setStatus(data, fallbackUsed = false) {
        const generatedAt = safeDate(data.generatedAt);
        let timeLabel = "recently";

        if (generatedAt) {
            const today = new Date();
            const sameDay = generatedAt.toDateString() === today.toDateString();
            timeLabel = sameDay
                ? generatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : generatedAt.toLocaleString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit"
                });
        }

        status.textContent = fallbackUsed
            ? `Last published update · ${timeLabel}`
            : `Updated ${timeLabel}`;
        status.dataset.state = fallbackUsed ? "stale" : "ready";
        liveStatus.dataset.state = fallbackUsed ? "stale" : "ready";
    }

    function renderFeed(data, fallbackUsed = false) {
        allStories = uniqueStories(data);
        moreVisibleCount = MORE_INCREMENT;

        const topStory = allStories[0];
        const latestStories = allStories.slice(1, 1 + LATEST_COUNT);

        topStorySlot.replaceChildren(renderTopStory(topStory));
        latestList.replaceChildren(...latestStories.map(renderLatestStory));
        leadGrid.setAttribute("aria-busy", "false");
        updateSummary();
        updateSourceFilter();
        renderMoreStories();
        setStatus(data, fallbackUsed);
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
            headers: { accept: "application/json" }
        });

        if (!response.ok) {
            throw new Error(`News request failed: ${response.status}`);
        }

        const responseData = await response.json();
        const data = typeof responseData.body === "string" && responseData.tag_name
            ? JSON.parse(responseData.body)
            : responseData;

        if (!validateFeed(data)) {
            throw new Error("News response was incomplete");
        }

        return data;
    }

    async function refreshFeed() {
        status.textContent = allStories.length
            ? "Checking for new stories…"
            : "Loading the latest stories…";
        status.dataset.state = "loading";
        liveStatus.dataset.state = "loading";
        refreshButton.disabled = true;

        try {
            const data = await fetchJson(remoteFeedUrl, true);
            renderFeed(data);
        } catch {
            try {
                const fallback = await fetchJson(fallbackFeedUrl);
                renderFeed(fallback, true);
            } catch {
                status.textContent = "News feed temporarily unavailable · Try refresh";
                status.dataset.state = "error";
                liveStatus.dataset.state = "error";
                leadGrid.setAttribute("aria-busy", "false");
                moreList.setAttribute("aria-busy", "false");

                if (!allStories.length) {
                    topStorySlot.replaceChildren(
                        element("p", "news-empty", "The latest MMA stories could not be loaded. Use Refresh to try again.")
                    );
                    latestList.replaceChildren();
                    moreList.replaceChildren();
                    summary.textContent = "Feed unavailable";
                }
            }
        } finally {
            refreshButton.disabled = false;
        }
    }

    sourceFilter.addEventListener("change", () => {
        selectedSource = sourceFilter.value;
        moreVisibleCount = MORE_INCREMENT;
        renderMoreStories();
    });

    showMoreButton.addEventListener("click", () => {
        moreVisibleCount += MORE_INCREMENT;
        renderMoreStories();
    });

    refreshButton.addEventListener("click", refreshFeed);

    window.addEventListener("matlock:preferences", event => {
        if (event.detail?.reducedMotion) {
            newsPage.querySelectorAll(".news-loading-card, .news-loading-row").forEach(node => {
                node.style.animation = "none";
            });
        }
    });

    refreshFeed();
    refreshTimer = window.setInterval(refreshFeed, refreshInterval);
    window.addEventListener("pagehide", () => window.clearInterval(refreshTimer));
})();
