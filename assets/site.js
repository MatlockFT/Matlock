(() => {
    const root = document.documentElement;
    const navigationToggle = document.getElementById("navigation-toggle");
    const navigationList = document.getElementById("navigation-list");
    const navigationPanel = document.getElementById("navigation-panel");
    const navigationClose = document.querySelector("[data-navigation-close]");
    const navigationBackdrop = document.querySelector("[data-navigation-backdrop]");
    const readabilityToggle = document.querySelector("[data-readability-toggle]");
    const motionToggle = document.querySelector("[data-motion-toggle]");
    const motionLabel = document.querySelector("[data-motion-label]");
    const mobileNavigation = window.matchMedia("(max-width: 850px)");
    const systemReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pageRegions = [
        document.querySelector(".logo-banner"),
        document.querySelector(".site-main"),
        document.querySelector(".site-footer")
    ].filter(Boolean);
    let lockedScrollPosition = 0;

    function readPreference(key) {
        try {
            return localStorage.getItem(key);
        } catch {
            return null;
        }
    }

    function writePreference(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch {
            // Preferences still work for the current page when storage is unavailable.
        }
    }

    function dispatchPreferenceChange() {
        window.dispatchEvent(new CustomEvent("matlock:preferences", {
            detail: {
                readable: root.classList.contains("readable-mode"),
                reducedMotion: root.classList.contains("reduce-motion")
            }
        }));
    }

    function syncReadabilityState() {
        const readable = readPreference("matlock-readable") === "true";
        root.classList.toggle("readable-mode", readable);

        if (readabilityToggle) {
            readabilityToggle.setAttribute("aria-pressed", String(readable));
            readabilityToggle.setAttribute(
                "aria-label",
                readable ? "Turn off readability mode" : "Turn on readability mode"
            );
        }
    }

    function syncMotionState() {
        const userReduced = readPreference("matlock-reduce-motion") === "true";
        const deviceReduced = systemReducedMotion.matches;
        const reduced = userReduced || deviceReduced;
        root.classList.toggle("reduce-motion", reduced);

        if (motionToggle) {
            motionToggle.setAttribute("aria-pressed", String(reduced));
            motionToggle.disabled = deviceReduced;
            motionToggle.setAttribute(
                "aria-label",
                deviceReduced
                    ? "Motion is reduced by your device settings"
                    : reduced
                        ? "Allow site motion"
                        : "Reduce site motion"
            );
        }

        if (motionLabel) {
            motionLabel.textContent = deviceReduced
                ? "Motion: device"
                : reduced
                    ? "Motion: reduced"
                    : "Motion";
        }
    }

    readabilityToggle?.addEventListener("click", () => {
        const nextValue = !root.classList.contains("readable-mode");
        writePreference("matlock-readable", String(nextValue));
        syncReadabilityState();
        dispatchPreferenceChange();
    });

    motionToggle?.addEventListener("click", () => {
        if (systemReducedMotion.matches) return;
        const nextValue = !root.classList.contains("reduce-motion");
        writePreference("matlock-reduce-motion", String(nextValue));
        syncMotionState();
        dispatchPreferenceChange();
    });

    systemReducedMotion.addEventListener?.("change", () => {
        syncMotionState();
        dispatchPreferenceChange();
    });

    syncReadabilityState();
    syncMotionState();

    function unlockPageScroll() {
        const bodyWasLocked = document.body.style.position === "fixed";
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.right = "";
        document.body.style.left = "";
        document.body.style.width = "";

        if (bodyWasLocked) window.scrollTo(0, lockedScrollPosition);
    }

    function setPageRegionsInert(isInert) {
        pageRegions.forEach(region => {
            region.inert = isInert;
        });
    }

    function setNavigationState(requestedOpen, returnFocus = false) {
        if (!navigationToggle || !navigationList || !navigationPanel) return;

        const isOpen = requestedOpen && mobileNavigation.matches;
        const panelIsHidden = mobileNavigation.matches && !isOpen;

        navigationToggle.setAttribute("aria-expanded", String(isOpen));
        navigationToggle.setAttribute(
            "aria-label",
            isOpen ? "Close main navigation" : "Open main navigation"
        );
        navigationPanel.setAttribute("aria-hidden", String(panelIsHidden));
        navigationPanel.inert = panelIsHidden;
        navigationList.classList.toggle("navigation-list-open", isOpen);
        document.body.classList.toggle("navigation-is-open", isOpen);
        setPageRegionsInert(isOpen);

        if (isOpen) {
            lockedScrollPosition = window.scrollY || window.pageYOffset;
            document.body.style.position = "fixed";
            document.body.style.top = `-${lockedScrollPosition}px`;
            document.body.style.right = "0";
            document.body.style.left = "0";
            document.body.style.width = "100%";
            window.requestAnimationFrame(() => navigationClose?.focus());
        } else {
            unlockPageScroll();
        }

        if (returnFocus) navigationToggle.focus();
    }

    function trapPanelFocus(event) {
        if (
            event.key !== "Tab" ||
            navigationToggle?.getAttribute("aria-expanded") !== "true"
        ) {
            return;
        }

        const focusable = [
            ...navigationPanel.querySelectorAll(
                "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])"
            )
        ].filter(node => !node.inert && node.offsetParent !== null);

        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }

    if (navigationToggle && navigationList && navigationPanel) {
        navigationToggle.addEventListener("click", () => {
            setNavigationState(
                navigationToggle.getAttribute("aria-expanded") !== "true"
            );
        });

        navigationClose?.addEventListener("click", () => {
            setNavigationState(false, true);
        });

        navigationBackdrop?.addEventListener("click", () => {
            setNavigationState(false, true);
        });

        navigationList.querySelectorAll("a").forEach(link => {
            link.addEventListener("click", () => setNavigationState(false));
        });

        document.addEventListener("keydown", event => {
            if (
                event.key === "Escape" &&
                navigationToggle.getAttribute("aria-expanded") === "true"
            ) {
                setNavigationState(false, true);
                return;
            }

            trapPanelFocus(event);
        });

        mobileNavigation.addEventListener("change", () => {
            setNavigationState(false);
        });

        window.addEventListener("pagehide", unlockPageScroll);
        setNavigationState(false);
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
