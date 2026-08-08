(() => {
    const typographyStylesheet = document.createElement("link");
    typographyStylesheet.rel = "stylesheet";
    typographyStylesheet.href = "/assets/typography-fixes.css?v=1";
    document.head.appendChild(typographyStylesheet);

    const navigationToggle = document.getElementById("navigation-toggle");
    const navigationList = document.getElementById("navigation-list");
    const navigationPanel = document.getElementById("navigation-panel");
    const navigationClose = document.querySelector(
        "[data-navigation-close]"
    );
    const navigationBackdrop = document.querySelector(
        "[data-navigation-backdrop]"
    );
    const mobileNavigation = window.matchMedia("(max-width: 850px)");
    const pageRegions = [
        document.querySelector(".logo-banner"),
        document.querySelector(".site-main"),
        document.querySelector(".site-footer")
    ].filter(Boolean);
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
        navigationPanel.setAttribute(
            "aria-hidden",
            String(panelIsHidden)
        );
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

        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (
            !event.shiftKey &&
            document.activeElement === last
        ) {
            event.preventDefault();
            last.focus();
        }
    }

    if (navigationToggle && navigationList && navigationPanel) {
        navigationToggle.addEventListener("click", () => {
            setNavigationState(
                navigationToggle.getAttribute("aria-expanded") !== "true"
            );
        });

        navigationClose?.addEventListener(
            "click",
            () => setNavigationState(false, true)
        );
        navigationBackdrop?.addEventListener(
            "click",
            () => setNavigationState(false, true)
        );

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

        mobileNavigation.addEventListener(
            "change",
            () => setNavigationState(false)
        );
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

    const upcomingEventsList = document.querySelector(".upcoming-events-list");
    if (upcomingEventsList) {
        const cards = [...upcomingEventsList.querySelectorAll(":scope > .upcoming-event-card")];
        cards
            .sort((a, b) => {
                const aDate = a.querySelector("time[datetime]")?.getAttribute("datetime") || "9999-12-31";
                const bDate = b.querySelector("time[datetime]")?.getAttribute("datetime") || "9999-12-31";
                return aDate.localeCompare(bDate);
            })
            .forEach(card => upcomingEventsList.appendChild(card));

        const normalizeFighterName = value => (value || "")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase()
            .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();

        const applyPortraitFraming = image => {
            if (!image?.naturalWidth || !image?.naturalHeight) return;

            const ratio = image.naturalWidth / image.naturalHeight;
            const framing = image.dataset.portraitFraming || "standard";
            const source = image.dataset.portraitSource || "";
            const src = image.currentSrc || image.src || "";
            const standardEspn = source === "espn" || /a\.espncdn\.com\/i\/headshots\/mma\/players\/full\//i.test(src);

            const restoreStandardCrop = () => {
                image.style.removeProperty("object-fit");
                image.style.removeProperty("object-position");
                image.style.removeProperty("transform");
                image.style.removeProperty("transform-origin");
            };

            if (framing === "standard" && standardEspn) {
                restoreStandardCrop();
                return;
            }

            const extremeRatio = ratio < 0.46 || ratio > 1.75;
            if (framing === "safe" || extremeRatio) {
                image.style.objectFit = "contain";
                image.style.objectPosition = "50% 12%";
                image.style.transform = extremeRatio ? "scale(1.02)" : "scale(1.08)";
                image.style.transformOrigin = "50% 18%";
                return;
            }

            restoreStandardCrop();
        };

        const preparePortrait = image => {
            const frame = image.closest(".fighter-photo");
            if (!frame) return;
            const fail = () => {
                frame.classList.add("photo-missing");
                image.remove();
            };
            const ready = () => {
                frame.classList.remove("photo-missing");
                applyPortraitFraming(image);
            };
            image.addEventListener("load", ready, { once: true });
            image.addEventListener("error", fail, { once: true });
            if (image.complete) {
                if (image.naturalWidth > 0) ready();
                else fail();
            }
        };

        fetch("/assets/fighter-portraits.json", { cache: "no-cache" })
            .then(response => response.ok ? response.json() : Promise.reject())
            .then(portraits => {
                upcomingEventsList.querySelectorAll(".fighter").forEach(fighter => {
                    const name = fighter.querySelector(".fighter-name")?.textContent?.trim();
                    const key = normalizeFighterName(name);
                    const hit = portraits[key];
                    const frame = fighter.querySelector(".fighter-photo");
                    if (!hit?.url || !frame) return;

                    let image = frame.querySelector("img[data-fighter-photo]");
                    if (!image) {
                        image = document.createElement("img");
                        image.setAttribute("data-fighter-photo", "");
                        image.alt = name || "Fighter portrait";
                        image.loading = fighter.closest(".bout-card-featured") ? "eager" : "lazy";
                        image.decoding = "async";
                        image.referrerPolicy = "no-referrer";
                        frame.appendChild(image);
                    }

                    if (!image.src || frame.classList.contains("photo-missing")) {
                        image.src = hit.url;
                    }
                    image.dataset.portraitSource = hit.source || "cache";
                    image.dataset.portraitFraming = hit.framing || "standard";
                    preparePortrait(image);
                });
            })
            .catch(() => {});

        upcomingEventsList.querySelectorAll("img[data-fighter-photo]").forEach(preparePortrait);

        // upcoming-events.js injects its legacy zine background with !important after
        // the static page CSS loads. Apply the final portrait surface after the window
        // load event so the intended gripboard/chalkboard treatment wins both on-screen
        // and when html2canvas captures the card for JPEG export.
        window.addEventListener("load", () => {
            const portraitStyle = document.createElement("style");
            portraitStyle.dataset.portraitBackground = "gripboard-v2";
            portraitStyle.textContent = `
                body .upcoming-events-page .upcoming-event-card .fighter-photo {
                    background:
                        linear-gradient(rgba(5,5,5,.08), rgba(0,0,0,.18)),
                        url('/assets/fighter-gripboard.svg') center / cover no-repeat,
                        #090909 !important;
                }

                body .upcoming-events-page .upcoming-event-card .fighter-photo::before {
                    z-index: 0 !important;
                    background:
                        radial-gradient(ellipse at 22% 31%, rgba(225,225,225,.045), transparent 31%),
                        radial-gradient(ellipse at 77% 72%, rgba(205,205,205,.028), transparent 36%),
                        linear-gradient(166deg, transparent 0 29%, rgba(235,235,235,.018) 29.4% 29.8%, transparent 30.2% 72%, rgba(220,220,220,.014) 72.4% 72.8%, transparent 73.2%) !important;
                    opacity: .68 !important;
                }

                body .upcoming-events-page .upcoming-event-card .fighter-photo::after {
                    position: absolute !important;
                    inset: auto 0 0 !important;
                    z-index: 2 !important;
                    height: 22% !important;
                    background: linear-gradient(to top, rgba(0,0,0,.42), transparent) !important;
                    opacity: 1 !important;
                }
            `;
            document.head.appendChild(portraitStyle);
        }, { once: true });
    }
})();