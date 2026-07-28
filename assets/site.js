(() => {
    const navigationToggle = document.getElementById("navigation-toggle");
    const navigationList = document.getElementById("navigation-list");
    let lockedScrollPosition = 0;

    function unlockPageScroll() {
        const bodyWasLocked = document.body.style.position === "fixed";
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.right = "";
        document.body.style.left = "";
        document.body.style.width = "";

        if (bodyWasLocked) {
            window.scrollTo(0, lockedScrollPosition);
        }
    }

    function setNavigationState(isOpen, returnFocus = false) {
        if (!navigationToggle || !navigationList) return;

        navigationToggle.setAttribute("aria-expanded", String(isOpen));
        navigationToggle.setAttribute(
            "aria-label",
            isOpen ? "Close main navigation" : "Open main navigation"
        );
        navigationList.classList.toggle("navigation-list-open", isOpen);
        document.body.classList.toggle("navigation-is-open", isOpen);

        if (isOpen && window.innerWidth <= 850) {
            lockedScrollPosition = window.scrollY || window.pageYOffset;
            document.body.style.position = "fixed";
            document.body.style.top = `-${lockedScrollPosition}px`;
            document.body.style.right = "0";
            document.body.style.left = "0";
            document.body.style.width = "100%";
            requestAnimationFrame(() => navigationList.querySelector("a")?.focus());
        } else {
            unlockPageScroll();
        }

        if (returnFocus) navigationToggle.focus();
    }

    if (navigationToggle && navigationList) {
        navigationToggle.addEventListener("click", () => {
            setNavigationState(
                navigationToggle.getAttribute("aria-expanded") !== "true"
            );
        });

        navigationList.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => setNavigationState(false));
        });

        document.addEventListener("click", event => {
            if (
                navigationToggle.getAttribute("aria-expanded") === "true" &&
                !navigationToggle.contains(event.target) &&
                !navigationList.contains(event.target)
            ) {
                setNavigationState(false);
            }
        });

        document.addEventListener("keydown", event => {
            if (
                event.key === "Escape" &&
                navigationToggle.getAttribute("aria-expanded") === "true"
            ) {
                setNavigationState(false, true);
            }
        });

        window.addEventListener("resize", () => {
            if (window.innerWidth > 850) setNavigationState(false);
        });
        window.addEventListener("pagehide", unlockPageScroll);
    }

    document.querySelectorAll("[data-hide-broken]").forEach(image => {
        const removeBrokenImage = () => {
            const imageShell = image.closest("[data-image-shell]");
            (imageShell || image).remove();
        };

        image.addEventListener("error", removeBrokenImage);
        if (image.complete && image.naturalWidth === 0) removeBrokenImage();
    });
})();
