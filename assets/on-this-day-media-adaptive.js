(() => {
    const list = document.querySelector('[data-on-this-day][data-mode="full"] [data-otd-list]');
    if (!list) return;

    const MODE_CLASSES = [
        "is-media-poster",
        "is-media-portrait",
        "is-media-square",
        "is-media-landscape",
        "is-media-wide",
        "is-media-fallback"
    ];

    function clearModes(row, media) {
        row?.classList.remove(...MODE_CLASSES);
        media?.classList.remove(
            "otd-entry-media--poster",
            "otd-entry-media--portrait",
            "otd-entry-media--square",
            "otd-entry-media--landscape",
            "otd-entry-media--wide"
        );
    }

    function classifyImage(image) {
        const width = image?.naturalWidth || 0;
        const height = image?.naturalHeight || 0;
        if (!width || !height) return "";

        const ratio = width / height;
        if (ratio <= 0.72) return "poster";
        if (ratio < 0.94) return "portrait";
        if (ratio <= 1.18) return "square";
        if (ratio >= 2.05) return "wide";
        return "landscape";
    }

    function applyMediaMode(media) {
        if (!(media instanceof HTMLElement)) return;
        const row = media.closest(".otd-entry");
        if (!row) return;

        if (media.classList.contains("is-image-ready")) {
            const image = media.querySelector("img");
            if (!image) return;
            if (!image.complete || !image.naturalWidth || !image.naturalHeight) return;

            const mode = classifyImage(image);
            if (!mode) return;

            clearModes(row, media);
            row.classList.add(`is-media-${mode}`);
            media.classList.add(`otd-entry-media--${mode}`);
            row.dataset.mediaMode = mode;
            media.style.setProperty("--otd-media-ratio", String(image.naturalWidth / image.naturalHeight));
            media.style.setProperty("--otd-media-width", String(image.naturalWidth));
            media.style.setProperty("--otd-media-height", String(image.naturalHeight));
            return;
        }

        if (media.classList.contains("is-fallback") && !media.classList.contains("is-image-loading")) {
            clearModes(row, media);
            row.classList.add("is-media-fallback");
            row.dataset.mediaMode = "fallback";
        }
    }

    function scan(node) {
        if (!(node instanceof Element)) return;
        if (node.matches(".otd-entry-media")) applyMediaMode(node);
        node.querySelectorAll?.(".otd-entry-media").forEach(applyMediaMode);
    }

    list.addEventListener("load", event => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement)) return;
        const media = image.closest(".otd-entry-media");
        if (media) applyMediaMode(media);
    }, true);

    const observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === "attributes") {
                applyMediaMode(record.target);
                continue;
            }

            for (const node of record.addedNodes) scan(node);
        }
    });

    observer.observe(list, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class"]
    });

    scan(list);
})();
