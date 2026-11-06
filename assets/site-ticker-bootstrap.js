(() => {
    let started = false;
    const bootstrapSrc = document.currentScript?.src || "";
    const assetQuery = bootstrapSrc.includes("?") ? bootstrapSrc.slice(bootstrapSrc.indexOf("?")) : "";

    const loadTicker = () => {
        if (started) return;
        started = true;

        const script = document.createElement("script");
        script.src = `/assets/site-ticker.js${assetQuery}`;
        script.async = true;
        script.dataset.siteTickerRuntime = "";
        document.body.appendChild(script);
    };

    const primeTicker = () => loadTicker();
    window.addEventListener("pointermove", primeTicker, { once: true, passive: true });
    window.addEventListener("pointerdown", primeTicker, { once: true, passive: true });
    window.addEventListener("scroll", primeTicker, { once: true, passive: true });
    document.addEventListener("keydown", primeTicker, { once: true });

    const scheduleFallback = () => {
        window.setTimeout(() => {
            if (started) return;
            if ("requestIdleCallback" in window) {
                window.requestIdleCallback(loadTicker, { timeout: 1200 });
            } else {
                loadTicker();
            }
        }, 8000);
    };

    if (document.readyState === "complete") scheduleFallback();
    else window.addEventListener("load", scheduleFallback, { once: true });
})();
