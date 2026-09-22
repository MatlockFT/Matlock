(() => {
    const root = document.documentElement;
    const navigationToggle = document.getElementById("navigation-toggle");
    const navigationList = document.getElementById("navigation-list");
    const navigationPanel = document.getElementById("navigation-panel");
    const navigationClose = document.querySelector("[data-navigation-close]");
    const navigationBackdrop = document.querySelector("[data-navigation-backdrop]");
    const themeToggle = document.querySelector("[data-theme-toggle]");
    const themeLabel = document.querySelector("[data-theme-label]");
    const mobileNavigation = window.matchMedia("(max-width: 850px)");
    const immersiveNavigation = Boolean(document.querySelector("[data-home-flow]"));
    const v3ThemePage = Boolean(document.querySelector("[data-globe-home]"));
    const panelNavigationActive = () => mobileNavigation.matches || immersiveNavigation;
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

    function defaultTheme() {
        return document.querySelector("[data-globe-home]") ? "light" : "dark";
    }

    function dispatchDisplayChange() {
        window.dispatchEvent(new CustomEvent("matlock:preferences", {
            detail: {
                theme: root.dataset.theme || defaultTheme(),
                reducedMotion: systemReducedMotion.matches
            }
        }));
    }

    function syncThemeState(theme) {
        const nextTheme = theme === "light" ? "light" : "dark";
        root.dataset.theme = nextTheme;
        root.classList.toggle("dark-mode", nextTheme === "dark");
        root.classList.toggle("light-mode", nextTheme === "light");

        if (themeToggle) {
            const dark = nextTheme === "dark";
            themeToggle.setAttribute("aria-pressed", String(dark));
            themeToggle.setAttribute(
                "aria-label",
                dark ? "Turn off dark mode" : "Turn on dark mode"
            );
        }

        if (themeLabel) themeLabel.textContent = "Dark";

        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.setAttribute("content", nextTheme === "dark" ? "#080808" : "#ffffff");
        dispatchDisplayChange();
    }

    if (v3ThemePage) {
        const storedTheme = readPreference("matlock-v3-theme");
        syncThemeState(storedTheme || "light");

        themeToggle?.addEventListener("click", () => {
            const nextTheme = root.dataset.theme === "dark" ? "light" : "dark";
            writePreference("matlock-v3-theme", nextTheme);
            syncThemeState(nextTheme);
        });
    } else {
        root.dataset.theme = "dark";
        root.classList.add("dark-mode");
        root.classList.remove("light-mode");
    }

    root.classList.toggle("reduce-motion", systemReducedMotion.matches);
    systemReducedMotion.addEventListener?.("change", event => {
        root.classList.toggle("reduce-motion", event.matches);
        dispatchDisplayChange();
    });

    function setupLiveTickerClock() {
        let track = null;
        let trackObserver = null;
        let insertionObserver = null;
        let phaseFrame = 0;

        function reducedMotion() {
            return systemReducedMotion.matches;
        }

        function durationSeconds() {
            if (!track) return 70;
            const raw = getComputedStyle(track)
                .getPropertyValue("--site-news-duration")
                .trim();
            const parsed = Number.parseFloat(raw);
            return Number.isFinite(parsed) && parsed > 0 ? parsed : 70;
        }

        function syncPhase() {
            phaseFrame = 0;
            if (!track?.isConnected) return;

            if (reducedMotion()) {
                track.style.removeProperty("animation-delay");
                return;
            }

            const duration = durationSeconds();
            const phase = (Date.now() / 1000) % duration;
            track.style.animationDelay = `-${phase.toFixed(3)}s`;
            track.dataset.liveClock = "true";
        }

        function queuePhaseSync() {
            if (phaseFrame) cancelAnimationFrame(phaseFrame);
            phaseFrame = requestAnimationFrame(() => {
                phaseFrame = requestAnimationFrame(syncPhase);
            });
        }

        function bindTrack(nextTrack) {
            if (!nextTrack || nextTrack === track) return;
            track = nextTrack;
            trackObserver?.disconnect();
            trackObserver = new MutationObserver(queuePhaseSync);
            trackObserver.observe(track, {
                childList: true,
                subtree: true
            });

            const viewport = track.closest(".site-news-viewport");
            viewport?.addEventListener("pointerleave", queuePhaseSync, { passive: true });
            viewport?.addEventListener("focusout", queuePhaseSync);
            queuePhaseSync();
        }

        const existingTrack = document.querySelector("[data-news-track]");
        if (existingTrack) {
            bindTrack(existingTrack);
        } else {
            insertionObserver = new MutationObserver(() => {
                const nextTrack = document.querySelector("[data-news-track]");
                if (!nextTrack) return;
                insertionObserver?.disconnect();
                insertionObserver = null;
                bindTrack(nextTrack);
            });
            insertionObserver.observe(document.body, {
                childList: true,
                subtree: true
            });
        }

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) queuePhaseSync();
        });
        window.addEventListener("pageshow", queuePhaseSync);
        window.addEventListener("pagehide", () => {
            trackObserver?.disconnect();
            insertionObserver?.disconnect();
            if (phaseFrame) cancelAnimationFrame(phaseFrame);
        });
    }

    setupLiveTickerClock();

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

        const isOpen = requestedOpen && panelNavigationActive();
        const panelIsHidden = panelNavigationActive() && !isOpen;

        navigationToggle.setAttribute("aria-expanded", String(isOpen));
        navigationToggle.setAttribute(
            "aria-label",
            isOpen ? "Close main navigation" : "Open main navigation"
        );
        if (immersiveNavigation) {
            const toggleLabel = navigationToggle.querySelector(".navigation-toggle-label");
            if (toggleLabel) toggleLabel.textContent = isOpen ? "Close" : "Index";
        }
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
            window.requestAnimationFrame(() => {
                if (immersiveNavigation) {
                    navigationList.querySelector("a[href]")?.focus();
                } else {
                    navigationClose?.focus();
                }
            });
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

    if (immersiveNavigation && navigationList) {
        const previewTitle = document.querySelector("[data-nav-preview-title]");
        const previewCopy = document.querySelector("[data-nav-preview-copy]");
        const defaultTitle = previewTitle?.textContent || "Explore MMA Matlock";
        const defaultCopy = previewCopy?.textContent || "Choose a destination to see what lives there.";

        const setPreview = (label, description) => {
            if (previewTitle) previewTitle.textContent = label || defaultTitle;
            if (previewCopy) previewCopy.textContent = description || defaultCopy;
        };

        navigationList.querySelectorAll("[data-nav-preview-label]").forEach(labelNode => {
            const link = labelNode.closest("a");
            if (!link) return;

            const label = labelNode.dataset.navPreviewLabel || labelNode.textContent.trim();
            const description = labelNode.dataset.navPreviewDescription || defaultCopy;

            link.addEventListener("pointerenter", () => setPreview(label, description));
            link.addEventListener("focus", () => setPreview(label, description));
            link.addEventListener("pointerleave", () => setPreview(defaultTitle, defaultCopy));
        });

        navigationPanel?.addEventListener("mouseleave", () => setPreview(defaultTitle, defaultCopy));
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
