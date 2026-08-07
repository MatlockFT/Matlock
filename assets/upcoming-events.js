(() => {
    document.querySelectorAll("[data-fighter-photo]").forEach(image => {
        const frame = image.closest(".fighter-photo");
        if (!frame) return;

        const showFallback = () => {
            frame.classList.add("photo-missing");
            image.remove();
        };

        image.addEventListener("error", showFallback, { once: true });

        if (image.complete && image.naturalWidth === 0) {
            showFallback();
        }
    });
})();
