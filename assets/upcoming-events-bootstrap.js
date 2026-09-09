(() => {
    let started = false;
    let runtimeLoaded = false;
    let runtimePromise = null;
    const bootstrapSrc = document.currentScript?.src || "";
    const assetQuery = bootstrapSrc.includes("?") ? bootstrapSrc.slice(bootstrapSrc.indexOf("?")) : "";
    const page = document.querySelector(".upcoming-events-page");

    const normalizeDownloadLabel = () => {
        document
            .querySelectorAll(".prediction-button:not(.prediction-button-clear)")
            .forEach(button => { button.textContent = "Download Picks"; });
    };

    const loadPortrait = image => {
        const src = image.dataset.fighterSrc;
        if (!src) return;
        delete image.dataset.originalProbe;
        image.src = src;
        delete image.dataset.fighterSrc;
    };

    const hydratePortraitSources = () => {
        const images = [...document.querySelectorAll("img[data-fighter-src]")];
        if (!images.length) return;

        if (!("IntersectionObserver" in window)) {
            images.forEach(loadPortrait);
            return;
        }

        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                observer.unobserve(entry.target);
                loadPortrait(entry.target);
            });
        }, { rootMargin: "600px 0px", threshold: 0.01 });

        images.forEach(image => observer.observe(image));
    };

    const loadPickerRuntime = () => {
        if (runtimePromise) return runtimePromise;
        started = true;

        runtimePromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = `/assets/upcoming-events.js${assetQuery}`;
            script.async = true;
            script.dataset.upcomingEventsRuntime = "";
            script.addEventListener("load", () => {
                runtimeLoaded = true;
                normalizeDownloadLabel();
                resolve();
            }, { once: true });
            script.addEventListener("error", reject, { once: true });
            document.body.appendChild(script);
        });

        return runtimePromise;
    };

    const primeRuntime = () => {
        loadPickerRuntime().catch(() => {});
    };

    hydratePortraitSources();

    if (page) {
        page.addEventListener("pointermove", primeRuntime, { once: true, passive: true });
        page.addEventListener("pointerdown", primeRuntime, { once: true, passive: true });
        page.addEventListener("focusin", primeRuntime, { once: true });
        window.addEventListener("scroll", primeRuntime, { once: true, passive: true });

        page.addEventListener("click", event => {
            if (runtimeLoaded) return;
            const fighter = event.target.closest?.(".fighter");
            if (!fighter || !page.contains(fighter)) return;

            event.preventDefault();
            event.stopImmediatePropagation();
            loadPickerRuntime()
                .then(() => fighter.click())
                .catch(() => {});
        }, true);
    }

    const scheduleFallback = () => {
        window.setTimeout(() => {
            if (started) return;
            if ("requestIdleCallback" in window) {
                window.requestIdleCallback(primeRuntime, { timeout: 1200 });
            } else {
                primeRuntime();
            }
        }, 8000);
    };

    if (document.readyState === "complete") scheduleFallback();
    else window.addEventListener("load", scheduleFallback, { once: true });
})();
