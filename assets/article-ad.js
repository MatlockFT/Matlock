(() => {
    const AD_SRC =
        "//peacefulbicycle.com/bkXwV/s.dtGflg0TY/WmcS/GeMmO9Yu/ZMUKl-kFPXT/cI0/N/jrA_1jMXzvMQtgNLzrQx2HMEDpUQziNJww";

    function initArticleAd() {
        const article =
            document.getElementById("article-content");

        if (!article) {
            return;
        }

        const slot =
            article.querySelector("[data-article-ad-slot]");

        const adContent =
            slot?.querySelector("[data-article-ad-content]");

        if (!slot || !adContent) {
            return;
        }

        const articleText =
            article.textContent
                .replace(/\s+/g, " ")
                .trim();

        const substantiveParagraphs =
            Array.from(article.children).filter((element) => {
                if (
                    element === slot ||
                    element.tagName !== "P"
                ) {
                    return false;
                }

                return (
                    element.textContent
                        .replace(/\s+/g, " ")
                        .trim()
                        .length >= 80
                );
            });

        /*
         * Keep short posts ad-free. Longer articles get one
         * in-body placement after the fourth substantive paragraph.
         */
        if (
            articleText.length < 900 ||
            substantiveParagraphs.length < 4
        ) {
            slot.remove();
            return;
        }

        substantiveParagraphs[3].insertAdjacentElement(
            "afterend",
            slot
        );

        slot.hidden = false;

        /*
         * HilltopAds publisher tag. Load only after the slot has
         * a valid in-article position so third-party code cannot
         * determine page placement for us.
         */
        const script =
            document.createElement("script");

        script.settings = {};
        script.src = AD_SRC;
        script.async = true;
        script.referrerPolicy =
            "no-referrer-when-downgrade";

        adContent.appendChild(script);
    }

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            initArticleAd,
            { once: true }
        );
    } else {
        initArticleAd();
    }
})();
