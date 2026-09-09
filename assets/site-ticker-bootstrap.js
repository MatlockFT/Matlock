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

    // Start automatically after the first paint. The ticker should never depend on
    // a scroll, pointer or keyboard event to become alive.
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => requestAnimationFrame(loadTicker), { once: true });
    } else {
        requestAnimationFrame(loadTicker);
    }
})();
