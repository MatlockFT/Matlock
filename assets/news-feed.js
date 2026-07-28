(() => {
    const newsPage = document.querySelector("[data-news-feed]");

    if (!newsPage) return;

    const timeline = newsPage.querySelector("[data-news-timeline]");
    const refreshButton = newsPage.querySelector("[data-news-refresh]");
    const status = newsPage.querySelector("[data-news-status]");
    const lastUpdated = newsPage.querySelector("[data-news-last-updated]");
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

    function setRefreshComplete() {
        const refreshedAt = new Date();
        lastRefreshTime = refreshedAt.getTime();
        timeline?.setAttribute("aria-busy", "false");

        if (lastUpdated) {
            lastUpdated.dateTime = refreshedAt.toISOString();
            lastUpdated.textContent = refreshedAt.toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit"
            });
        }

        setStatus("Live feed loaded", "ready");

        if (refreshButton) refreshButton.disabled = false;
    }

    function waitForTimeline() {
        window.clearTimeout(renderCheckTimer);
        let checksRemaining = 40;

        function check() {
            if (timeline?.querySelector("iframe")) {
                setRefreshComplete();
                return;
            }

            checksRemaining -= 1;

            if (checksRemaining <= 0) {
                timeline?.setAttribute("aria-busy", "false");
                setStatus(
                    "Live embed unavailable — open the list on X",
                    "error"
                );

                if (refreshButton) refreshButton.disabled = false;
                return;
            }

            renderCheckTimer = window.setTimeout(check, 250);
        }

        check();
    }

    function loadXWidgets() {
        if (window.twttr?.widgets) {
            return Promise.resolve(window.twttr);
        }

        return new Promise((resolve, reject) => {
            const existingScript = document.getElementById("x-widgets-script");
            const loadingTimeout = window.setTimeout(
                () => reject(new Error("X embed timed out")),
                10000
            );
            const finishLoading = widgets => {
                window.clearTimeout(loadingTimeout);
                resolve(widgets);
            };
            const stopLoading = error => {
                window.clearTimeout(loadingTimeout);
                reject(error);
            };

            window.twttr = window.twttr || {
                _e: [],
                ready(callback) {
                    this._e.push(callback);
                }
            };

            window.twttr.ready(finishLoading);

            if (existingScript) {
                existingScript.addEventListener("error", stopLoading, {
                    once: true
                });
                return;
            }

            const script = document.createElement("script");
            script.id = "x-widgets-script";
            script.src = "https://platform.x.com/widgets.js";
            script.async = true;
            script.charset = "utf-8";
            script.addEventListener("error", stopLoading, { once: true });
            document.head.append(script);
        });
    }

    async function refreshFeed() {
        window.clearTimeout(renderCheckTimer);
        timeline?.setAttribute("aria-busy", "true");
        timeline?.replaceChildren(timelineLink());
        setStatus(lastRefreshTime ? "Refreshing live feed…" : "Loading live feed…");

        if (refreshButton) refreshButton.disabled = true;

        try {
            const widgets = await loadXWidgets();
            widgets.widgets.load(timeline);
            waitForTimeline();
        } catch {
            timeline?.setAttribute("aria-busy", "false");
            setStatus(
                "Live embed unavailable — open the list on X",
                "error"
            );

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
        window.clearTimeout(renderCheckTimer);
    });
})();
