(() => {
    let started = false;
    const bootstrapSrc = document.currentScript?.src || "";
    const assetQuery = bootstrapSrc.includes("?") ? bootstrapSrc.slice(bootstrapSrc.indexOf("?")) : "";

    const normalizeDownloadLabel = () => {
        document
            .querySelectorAll(".prediction-button:not(.prediction-button-clear)")
            .forEach(button => { button.textContent = "Download Picks"; });
    };

    const loadPickerRuntime = () => {
        if (started) return;
        started = true;

        const script = document.createElement("script");
        script.src = `/assets/upcoming-events.js${assetQuery}`;
        script.async = true;
        script.dataset.upcomingEventsRuntime = "";
        script.addEventListener("load", normalizeDownloadLabel, { once: true });
        document.body.appendChild(script);
    };

    const schedule = () => {
        if ("requestIdleCallback" in window) {
            window.requestIdleCallback(loadPickerRuntime, { timeout: 900 });
        } else {
            window.setTimeout(loadPickerRuntime, 300);
        }
    };

    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });
})();
