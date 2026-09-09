(() => {
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

    hydratePortraitSources();

    // The picker runtime is responsible for portrait framing/cropping as well as
    // interaction. It must start on page load; waiting for scroll or pointer input
    // leaves the initial viewport visibly unfinished.
    if (page) loadPickerRuntime().catch(() => {});

    if (page) {
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
})();
