(() => {
    const newsPage = document.querySelector("[data-news-feed]");

    if (!newsPage) return;

    const timeline = newsPage.querySelector("[data-news-timeline]");
    const refreshButton = newsPage.querySelector("[data-news-refresh]");
    const status = newsPage.querySelector("[data-news-status]");
    const lastUpdated = newsPage.querySelector("[data-news-last-updated]");
    const fallback = newsPage.querySelector("[data-news-fallback]");
    const refreshInterval =
        Number(newsPage.dataset.refreshInterval) || 5 * 60 * 1000;
    const listUrl =
        "https://x.com/MMAMATLOCK/lists/2081967792681849282?ref_src=twsrc%5Etfw";
    let lastRefreshTime = 0;
    let refreshTimer;
    let renderCheckTimer;

    function timelineLink() {
        const link = document.createElement("a");
        link.className = "twitter-timeline";
        link.dataset.theme = "dark";
        link.dataset.dnt = "true";
        link.dataset.height = "900";
        link.href = listUrl;
        link.textContent = "An X List by MMA Matlock";

        return link;
    }

    function setStatus(message, state = "loading") {
        if (!status) return;

        status.textContent = message;
        status.dataset.state = state;
    }

    function updateRefreshTime() {
        const refreshedAt = new Date();
        lastRefreshTime = refreshedAt.getTime();

        if (lastUpdated) {
            lastUpdated.dateTime = refreshedAt.toISOString();
            lastUpdated.textContent = refreshedAt.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit"
            });
        }
    }

    function setRefreshComplete() {
        updateRefreshTime();
        timeline?.setAttribute("aria-busy", "false");
        timeline?.removeAttribute("hidden");

        if (fallback) fallback.hidden = true;

        setStatus("Live feed loaded", "ready");

        if (refreshButton) refreshButton.disabled = false;
    }

    function setFeedUnavailable() {
        updateRefreshTime();
        timeline?.setAttribute("aria-busy", "false");
        timeline?.setAttribute("hidden", "");

        if (fallback) fallback.hidden = false;

        setStatus(
            "X embed unavailable — open the live list directly",
            "error"
        );

        if (refreshButton) refreshButton.disabled = false;
    }

    function waitForTimeline() {
        window.clearTimeout(renderCheckTimer);
        let checksRemaining = 20;

        function check() {
            const frame = timeline?.querySelector("iframe");

            if (frame && frame.getBoundingClientRect().height >= 100) {
                setRefreshComplete();
                return;
            }

            checksRemaining -= 1;

            if (checksRemaining <= 0) {
                setFeedUnavailable();
                return;
            }

            renderCheckTimer = window.setTimeout(check, 250);
        }

        check();
    }

    function loadXWidgets() {
        return new Promise((resolve, reject) => {
            const existingScript = document.getElementById("x-widgets-script");
            const loadingTimeout = window.setTimeout(
                () => reject(new Error("X embed timed out")),
                10000
            );
            const finishLoading = () => {
                window.clearTimeout(loadingTimeout);
                resolve();
            };
            const stopLoading = error => {
                window.clearTimeout(loadingTimeout);
                reject(error);
            };

            existingScript?.remove();

            const script = document.createElement("script");
            script.id = "x-widgets-script";
            script.src = "https://platform.x.com/widgets.js";
            script.async = true;
            script.charset = "utf-8";
            script.addEventListener("load", finishLoading, { once: true });
            script.addEventListener("error", stopLoading, { once: true });
            document.head.append(script);
        });
    }

    async function refreshFeed() {
        window.clearTimeout(renderCheckTimer);
        timeline?.setAttribute("aria-busy", "true");
        timeline?.removeAttribute("hidden");
        timeline?.replaceChildren(timelineLink());

        if (fallback) fallback.hidden = true;

        setStatus(lastRefreshTime ? "Refreshing live feed…" : "Loading live feed…");

        if (refreshButton) refreshButton.disabled = true;

        try {
            await loadXWidgets();
            window.twttr?.widgets?.load?.(timeline);
            waitForTimeline();
        } catch {
            setFeedUnavailable();
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
        window.clearTimeout(renderCheckTimer);
    });
})();
