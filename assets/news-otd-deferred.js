(() => {
    const sentinel = document.querySelector("[data-news-otd-sentinel]");
    const section = document.querySelector("[data-on-this-day][data-history-script-url]");
    if (!section) return;

    let loaded = false;
    let observer = null;

    function loadHistory() {
        if (loaded) return;
        loaded = true;
        observer?.disconnect();
        sentinel?.remove();

        const script = document.createElement("script");
        script.src = section.dataset.historyScriptUrl;
        script.defer = true;
        document.body.append(script);
    }

    if (sentinel && "IntersectionObserver" in window) {
        observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) loadHistory();
        }, {
            rootMargin: "120px 0px"
        });
        observer.observe(sentinel);
        return;
    }

    window.addEventListener("scroll", loadHistory, {
        once: true,
        passive: true
    });
})();
