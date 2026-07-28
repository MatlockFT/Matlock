(() => {
    const newsPage = document.querySelector("[data-news-feed]");

    if (!newsPage) return;

    const storyRail = newsPage.querySelector("[data-news-story-list]");
    const status = newsPage.querySelector("[data-news-status]");
    const sourceSummary = newsPage.querySelector(
        "[data-news-source-summary]"
    );
    const counter = newsPage.querySelector("[data-news-counter]");
    const refreshButton = newsPage.querySelector("[data-news-refresh]");
    const previousButton = newsPage.querySelector("[data-news-previous]");
    const nextButton = newsPage.querySelector("[data-news-next]");
    const remoteFeedUrl = newsPage.dataset.feedUrl;
    const fallbackFeedUrl = newsPage.dataset.fallbackUrl;
    const refreshInterval =
        Number(newsPage.dataset.refreshInterval) || 5 * 60 * 1000;
    let lastRefreshTime = 0;
    let refreshTimer;
    let scrollFrame;
    let deckIndex = 0;
    let deckAnimating = false;
    let dragState = null;
    let suppressClickUntil = 0;
    const deckLayout = window.matchMedia("(max-width: 760px)");
    const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    );

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
        const elapsedSeconds = Math.round(
            (date.getTime() - Date.now()) / 1000
        );
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
        const date = new Date(story.publishedAt);
        const time = element(
            "time",
            "news-card-time",
            formatPublishedDate(story.publishedAt)
        );
        time.dateTime = date.toISOString();
        time.title = date.toLocaleString();

        return time;
    }

    function addPlaceholder(media, story) {
        if (media.querySelector(".news-card-placeholder")) return;

        media.classList.add("news-card-media--empty");
        media.append(
            element(
                "span",
                "news-card-placeholder",
                story.source
            )
        );
    }

    function storyMedia(story, index) {
        const media = element("div", "news-card-media");

        if (story.image) {
            const image = document.createElement("img");
            image.src = story.image;
            image.alt = "";
            image.loading = index < 2 ? "eager" : "lazy";
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            image.addEventListener(
                "error",
                () => {
                    image.remove();
                    addPlaceholder(media, story);
                },
                { once: true }
            );
            media.append(image);
        } else {
            addPlaceholder(media, story);
        }

        const meta = element("div", "news-card-meta");

        if (index === 0) {
            meta.append(
                element("span", "news-card-top-label", "Top story")
            );
        }

        meta.append(
            externalLink(
                story.sourceUrl,
                "news-card-source",
                story.source
            ),
            storyTime(story)
        );

        if (story.coverageCount > 1) {
            meta.append(
                element(
                    "span",
                    "news-card-coverage",
                    `${story.coverageCount} sources`
                )
            );
        }

        const heading = element(
            index === 0 ? "h2" : "h3",
            "news-card-headline"
        );
        heading.append(externalLink(story.url, "", story.title));

        const overlay = element("div", "news-card-overlay");
        overlay.append(meta, heading);
        media.append(overlay);

        return media;
    }

    function renderStory(story, index) {
        const article = element(
            "article",
            index === 0
                ? "news-card news-card--top"
                : "news-card"
        );
        article.dataset.storyId = story.id;
        article.setAttribute("role", "listitem");

        const body = element("div", "news-card-body");
        const excerpt = story.excerpt ||
            "Open the full story for the latest details.";
        body.append(element("p", "news-card-excerpt", excerpt));

        if (story.relatedSources?.length) {
            body.append(
                element(
                    "p",
                    "news-card-related",
                    `Also reported by ${story.relatedSources.join(", ")}`
                )
            );
        }

        body.append(
            externalLink(story.url, "news-card-read", "Read full story")
        );
        article.append(storyMedia(story, index), body);

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

    function currentCard() {
        const cards = [...storyRail.querySelectorAll(".news-card")];

        if (cards.length === 0) return null;
        if (deckLayout.matches) return cards[deckIndex] || cards[0];

        const scrollPadding =
            Number.parseFloat(
                window.getComputedStyle(storyRail).scrollPaddingLeft
            ) || 0;
        const snapLine =
            storyRail.getBoundingClientRect().left + scrollPadding;

        return cards.reduce((closest, card) => {
            const rect = card.getBoundingClientRect();
            const distance = Math.abs(rect.left - snapLine);

            if (!closest || distance < closest.distance) {
                return { card, distance };
            }

            return closest;
        }, null)?.card;
    }

    function updateRailState() {
        const cards = [...storyRail.querySelectorAll(".news-card")];
        const activeCard = currentCard();
        const activeIndex = Math.max(0, cards.indexOf(activeCard));

        counter.textContent = cards.length
            ? `${activeIndex + 1} / ${cards.length}`
            : "0 / 0";
        previousButton.disabled = activeIndex <= 0;
        nextButton.disabled =
            cards.length === 0 || activeIndex >= cards.length - 1;
    }

    function updateDeckState() {
        const cards = [...storyRail.querySelectorAll(".news-card")];

        if (!deckLayout.matches || cards.length === 0) return;

        deckIndex = (
            (deckIndex % cards.length) + cards.length
        ) % cards.length;

        cards.forEach((card, index) => {
            const position = (
                index - deckIndex + cards.length
            ) % cards.length;
            const isVisible = position < 3;
            const isActive = position === 0;

            card.dataset.deckPosition = isVisible
                ? String(position)
                : "hidden";
            card.setAttribute("aria-hidden", String(!isActive));
            card.inert = !isActive;
        });

        updateRailState();
    }

    function resetDeckCard(card) {
        if (!card) return;

        card.classList.remove(
            "is-deck-dragging",
            "is-deck-leaving-left",
            "is-deck-leaving-right"
        );
        card.style.removeProperty("--deck-drag-x");
        card.style.removeProperty("--deck-drag-rotation");
    }

    function animateDeck(direction) {
        const cards = [...storyRail.querySelectorAll(".news-card")];
        const activeCard = cards[deckIndex];

        if (
            !deckLayout.matches ||
            !activeCard ||
            cards.length < 2 ||
            deckAnimating
        ) {
            return;
        }

        deckAnimating = true;
        resetDeckCard(activeCard);
        activeCard.classList.add(
            direction > 0
                ? "is-deck-leaving-left"
                : "is-deck-leaving-right"
        );

        window.setTimeout(
            () => {
                resetDeckCard(activeCard);
                deckIndex = (
                    deckIndex + direction + cards.length
                ) % cards.length;
                deckAnimating = false;
                updateDeckState();
            },
            reducedMotion.matches ? 0 : 320
        );
    }

    function resetDeckLayout() {
        const cards = [...storyRail.querySelectorAll(".news-card")];

        cards.forEach(card => {
            resetDeckCard(card);
            delete card.dataset.deckPosition;
            card.removeAttribute("aria-hidden");
            card.inert = false;
        });
    }

    function syncLayout() {
        if (deckLayout.matches) {
            updateDeckState();
            return;
        }

        const cards = [...storyRail.querySelectorAll(".news-card")];
        resetDeckLayout();
        moveToCard(cards[deckIndex] || cards[0], "auto");
        updateRailState();
    }

    function storyOffset(card) {
        const scrollPadding =
            Number.parseFloat(
                window.getComputedStyle(storyRail).scrollPaddingLeft
            ) || 0;

        return Math.max(
            0,
            card.getBoundingClientRect().left -
            storyRail.getBoundingClientRect().left +
            storyRail.scrollLeft -
            scrollPadding
        );
    }

    function moveToCard(card, behavior = "smooth") {
        if (!card) return;

        if (deckLayout.matches) {
            const cards = [...storyRail.querySelectorAll(".news-card")];
            const requestedIndex = cards.indexOf(card);

            if (requestedIndex >= 0) deckIndex = requestedIndex;
            updateDeckState();
            return;
        }

        storyRail.scrollTo({
            left: storyOffset(card),
            behavior
        });
    }

    function moveBy(direction) {
        if (deckLayout.matches) {
            animateDeck(direction);
            return;
        }

        const cards = [...storyRail.querySelectorAll(".news-card")];
        const activeIndex = Math.max(0, cards.indexOf(currentCard()));
        const nextIndex = Math.min(
            cards.length - 1,
            Math.max(0, activeIndex + direction)
        );

        moveToCard(cards[nextIndex]);
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
        const previousStoryId = currentCard()?.dataset.storyId;
        const stories = [data.topStory, ...data.stories];
        const cards = stories.map(renderStory);
        storyRail.replaceChildren(...cards);
        storyRail.setAttribute("aria-busy", "false");
        sourceSummary.textContent =
            `${data.sourceCount} active sources · automatic updates`;
        setStatus(data, fallbackUsed);
        lastRefreshTime = Date.now();

        const preservedCard = previousStoryId
            ? storyRail.querySelector(
                `[data-story-id="${CSS.escape(previousStoryId)}"]`
            )
            : null;

        deckIndex = Math.max(
            0,
            cards.indexOf(preservedCard || cards[0])
        );
        moveToCard(preservedCard || cards[0], "auto");
        updateRailState();
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

        if (!response.ok) {
            throw new Error(`News request failed: ${response.status}`);
        }

        const responseData = await response.json();
        const data =
            typeof responseData.body === "string" &&
            responseData.tag_name
                ? JSON.parse(responseData.body)
                : responseData;

        if (!validateFeed(data)) {
            throw new Error("News response was incomplete");
        }

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

    function scheduleRefresh() {
        window.clearInterval(refreshTimer);
        refreshTimer = window.setInterval(refreshFeed, refreshInterval);
    }

    previousButton.addEventListener("click", () => moveBy(-1));
    nextButton.addEventListener("click", () => moveBy(1));

    storyRail.addEventListener("keydown", event => {
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveBy(-1);
        }

        if (event.key === "ArrowRight") {
            event.preventDefault();
            moveBy(1);
        }
    });

    storyRail.addEventListener(
        "scroll",
        () => {
            window.cancelAnimationFrame(scrollFrame);
            scrollFrame = window.requestAnimationFrame(updateRailState);
        },
        { passive: true }
    );

    storyRail.addEventListener("pointerdown", event => {
        if (
            !deckLayout.matches ||
            deckAnimating ||
            event.pointerType === "mouse" && event.button !== 0
        ) {
            return;
        }

        const activeCard = currentCard();
        if (!activeCard || !event.target.closest(".news-card")) return;

        dragState = {
            card: activeCard,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startedAt: performance.now(),
            deltaX: 0,
            dragging: false
        };
        activeCard.setPointerCapture?.(event.pointerId);
    });

    storyRail.addEventListener("pointermove", event => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;

        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;

        if (
            !dragState.dragging &&
            Math.abs(deltaY) > Math.abs(deltaX)
        ) {
            resetDeckCard(dragState.card);
            dragState = null;
            return;
        }

        if (Math.abs(deltaX) < 6 && !dragState.dragging) return;

        dragState.dragging = true;
        dragState.deltaX = deltaX;
        dragState.card.classList.add("is-deck-dragging");
        dragState.card.style.setProperty(
            "--deck-drag-x",
            `${deltaX}px`
        );
        dragState.card.style.setProperty(
            "--deck-drag-rotation",
            `${Math.max(-9, Math.min(9, deltaX / 24))}deg`
        );
    });

    function finishDeckDrag(event) {
        if (!dragState || event.pointerId !== dragState.pointerId) return;

        const {
            card,
            deltaX,
            dragging,
            startedAt
        } = dragState;
        const velocity =
            Math.abs(deltaX) /
            Math.max(1, performance.now() - startedAt);
        const shouldMove =
            dragging && (Math.abs(deltaX) >= 70 || velocity >= 0.45);
        dragState = null;

        if (dragging) suppressClickUntil = Date.now() + 450;

        if (shouldMove) {
            resetDeckCard(card);
            animateDeck(deltaX < 0 ? 1 : -1);
        } else {
            resetDeckCard(card);
        }
    }

    storyRail.addEventListener("pointerup", finishDeckDrag);
    storyRail.addEventListener("pointercancel", finishDeckDrag);
    storyRail.addEventListener(
        "click",
        event => {
            if (Date.now() < suppressClickUntil) {
                event.preventDefault();
                event.stopPropagation();
            }
        },
        true
    );

    window.addEventListener("resize", syncLayout);
    deckLayout.addEventListener?.("change", syncLayout);

    if (refreshButton) {
        refreshButton.addEventListener("click", refreshFeed);
    }

    refreshFeed();
    scheduleRefresh();
})();
