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

    function articleVideoIcon(kind) {
        if (kind === "play") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"></path></svg>';
        if (kind === "pause") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"></path></svg>';
        if (kind === "sound") return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm11.5 3a3.5 3.5 0 0 0-1.5-2.87v5.74A3.5 3.5 0 0 0 15.5 12zm0-6.18v2.06A5.5 5.5 0 0 1 18 12a5.5 5.5 0 0 1-2.5 4.12v2.06A7.5 7.5 0 0 0 20 12a7.5 7.5 0 0 0-4.5-6.18z"></path></svg>';
        return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zm12.6 3 2.2-2.2-1.4-1.4-2.2 2.2L13 8.4 11.6 9.8l2.2 2.2-2.2 2.2 1.4 1.4 2.2-2.2 2.2 2.2 1.4-1.4z"></path></svg>';
    }

    function setupArticleVideos() {
        const figures = [...document.querySelectorAll(".post-body figure.article-inline-video")];
        if (!figures.length) return;

        const visibilityObserver = "IntersectionObserver" in window
            ? new IntersectionObserver(entries => {
                entries.forEach(entry => {
                    const figure = entry.target;
                    const video = figure.querySelector("video");
                    if (!video || figure.dataset.videoManualPause === "true") return;
                    if (entry.isIntersecting && entry.intersectionRatio >= 0.18 && !systemReducedMotion.matches) {
                        video.play().catch(() => {});
                    } else if (!entry.isIntersecting || entry.intersectionRatio < 0.08) {
                        video.pause();
                    }
                });
            }, { threshold: [0, 0.08, 0.18, 0.6] })
            : null;

        figures.forEach(figure => {
            const video = figure.querySelector("video");
            if (!video || figure.dataset.videoUi === "ready") return;
            figure.dataset.videoUi = "ready";

            let stage = figure.querySelector(".article-inline-video-stage");
            if (!stage) {
                stage = document.createElement("div");
                stage.className = "article-inline-video-stage";
                video.before(stage);
                stage.appendChild(video);
            }

            video.controls = false;
            video.removeAttribute("controls");
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            video.defaultMuted = true;
            video.playsInline = true;
            video.setAttribute("autoplay", "");
            video.setAttribute("loop", "");
            video.setAttribute("muted", "");
            video.setAttribute("playsinline", "");
            video.tabIndex = 0;
            video.setAttribute("aria-keyshortcuts", "Space Enter M");

            const controls = document.createElement("div");
            controls.className = "article-inline-video-controls";
            controls.innerHTML = `
                <button type="button" class="article-inline-video-control" data-video-play aria-label="Pause video" title="Pause">${articleVideoIcon("pause")}</button>
                <button type="button" class="article-inline-video-control" data-video-sound aria-label="Turn sound on" title="Sound on">${articleVideoIcon("muted")}</button>
            `;
            stage.appendChild(controls);

            const playButton = controls.querySelector("[data-video-play]");
            const soundButton = controls.querySelector("[data-video-sound]");

            const sync = () => {
                const paused = video.paused;
                figure.classList.toggle("is-paused", paused);
                figure.classList.toggle("is-muted", video.muted);
                playButton.innerHTML = articleVideoIcon(paused ? "play" : "pause");
                playButton.setAttribute("aria-label", paused ? "Play video" : "Pause video");
                playButton.title = paused ? "Play" : "Pause";
                soundButton.innerHTML = articleVideoIcon(video.muted ? "muted" : "sound");
                soundButton.setAttribute("aria-label", video.muted ? "Turn sound on" : "Mute video");
                soundButton.title = video.muted ? "Sound on" : "Mute";
            };

            const togglePlay = (manual = true) => {
                if (video.paused) {
                    if (manual) figure.dataset.videoManualPause = "false";
                    video.play().catch(() => {});
                } else {
                    if (manual) figure.dataset.videoManualPause = "true";
                    video.pause();
                }
            };

            playButton.addEventListener("click", event => {
                event.stopPropagation();
                togglePlay();
            });
            soundButton.addEventListener("click", event => {
                event.stopPropagation();
                video.muted = !video.muted;
                if (video.paused && figure.dataset.videoManualPause !== "true") video.play().catch(() => {});
                sync();
            });
            video.addEventListener("click", () => togglePlay());
            video.addEventListener("play", sync);
            video.addEventListener("pause", sync);
            video.addEventListener("volumechange", sync);
            video.addEventListener("keydown", event => {
                if (event.key === " " || event.key === "Enter") {
                    event.preventDefault();
                    togglePlay();
                } else if (event.key.toLowerCase() === "m") {
                    event.preventDefault();
                    video.muted = !video.muted;
                    sync();
                }
            });

            if (systemReducedMotion.matches) {
                figure.dataset.videoManualPause = "true";
                video.pause();
            } else {
                figure.dataset.videoManualPause = "false";
                video.play().catch(() => {});
            }

            visibilityObserver?.observe(figure);
            sync();
        });

        systemReducedMotion.addEventListener?.("change", event => {
            figures.forEach(figure => {
                const video = figure.querySelector("video");
                if (!video) return;
                if (event.matches) {
                    figure.dataset.videoManualPause = "true";
                    video.pause();
                }
            });
        });
    }

    setupArticleVideos();
})();
