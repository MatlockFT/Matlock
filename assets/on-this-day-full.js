(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    if (!widget) return;

    const REFERENCE_YEAR = 2024;
    const IMAGE_WIDTH = 720;
    const PILL_IMAGE_WIDTH = 360;
    const SESSION_KEY = "mma-matlock:otd:last-date";
    const IMAGE_FAILURE_TTL_MS = 15 * 60 * 1000;
    const FILTER_THRESHOLD = 6;
    const formatLong = new Intl.DateTimeFormat([], { month: "long", day: "numeric" });
    const formatShort = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });
    const formatWeekday = new Intl.DateTimeFormat([], { weekday: "short" });
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const wikipediaCache = new Map();
    const resolvedImageCache = new WeakMap();
    const pendingMedia = new WeakMap();
    const failedImageUntil = new Map();
    const kindOrder = new Map([
        ["fight", 0], ["title", 1], ["signing", 2], ["debut", 3],
        ["incident", 4], ["event", 5], ["news", 6], ["death", 7], ["birthday", 8]
    ]);

    const list = widget.querySelector("[data-otd-list]");
    const dateDisplay = widget.querySelector("[data-otd-date]");
    const dateInput = widget.querySelector("[data-otd-input]");
    const previous = widget.querySelector("[data-otd-prev]");
    const next = widget.querySelector("[data-otd-next]");
    const todayButton = widget.querySelector("[data-otd-today]");
    const shareButton = widget.querySelector("[data-otd-share]");
    const randomButton = widget.querySelector("[data-otd-random]");
    const count = widget.querySelector("[data-otd-count]");
    const weekStrip = widget.querySelector("[data-otd-week]");
    const filterBar = widget.querySelector("[data-otd-filters]");
    if (!list || !dateDisplay) return;

    const mediaObserver = "IntersectionObserver" in window
        ? new IntersectionObserver(records => {
            for (const record of records) {
                if (!record.isIntersecting) continue;
                const load = pendingMedia.get(record.target);
                if (!load) continue;
                pendingMedia.delete(record.target);
                mediaObserver.unobserve(record.target);
                load();
            }
        }, { rootMargin: "420px 0px" })
        : null;

    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    const externalLink = (url, className, text) => {
        const link = el("a", className, text);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        return link;
    };

    const motionAllowed = () =>
        !document.documentElement.classList.contains("reduce-motion") && !reduceMotion?.matches;

    const localToday = () => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    };

    const keyForDate = date =>
        `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

    const dateForMonthDay = (month, day, year = new Date().getFullYear()) => {
        const candidate = new Date(year, month - 1, day);
        if (candidate.getMonth() === month - 1 && candidate.getDate() === day) return candidate;
        const fallback = new Date(REFERENCE_YEAR, month - 1, day);
        return fallback.getMonth() === month - 1 && fallback.getDate() === day ? fallback : null;
    };

    const parseKey = value => {
        const match = /^(\d{2})-(\d{2})$/.exec(value || "");
        return match ? dateForMonthDay(Number(match[1]), Number(match[2])) : null;
    };

    const readSessionDate = () => {
        try {
            return parseKey(sessionStorage.getItem(SESSION_KEY));
        } catch {
            return null;
        }
    };

    const saveSessionDate = date => {
        try {
            sessionStorage.setItem(SESSION_KEY, keyForDate(date));
        } catch {}
    };

    const entryYear = entry => entry.date?.slice(0, 4) || "";
    const kindLabel = kind => ({
        fight: "Fight", event: "Event", signing: "Signing", debut: "Debut",
        title: "Title", incident: "Incident", news: "News", death: "In memoriam",
        birthday: "Birthday"
    })[kind] || "Note";

    function ageLabel(entry) {
        const year = Number(entryYear(entry));
        if (!year) return "";
        const age = new Date().getFullYear() - year;
        if (age <= 0) return "This year";
        if (entry.kind === "birthday") return `Born ${age} ${age === 1 ? "year" : "years"} ago`;
        return `${age} ${age === 1 ? "year" : "years"} ago`;
    }

    function compareEntries(first, second) {
        const kindDifference = (kindOrder.get(first.kind) ?? 99) - (kindOrder.get(second.kind) ?? 99);
        if (kindDifference) return kindDifference;
        const weightDifference = (second.weight || 0) - (first.weight || 0);
        if (weightDifference) return weightDifference;
        return second.date.localeCompare(first.date);
    }

    function buildDayIndex(entries) {
        const index = new Map();
        for (const entry of entries) {
            const key = entry.date?.slice(5);
            if (!/^\d{2}-\d{2}$/.test(key || "")) continue;
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(entry);
        }
        for (const bucket of index.values()) bucket.sort(compareEntries);
        return index;
    }

    const wikipediaTitle = entry => {
        if (entry?.wikipediaTitle) return String(entry.wikipediaTitle).trim();
        if (!entry?.sourceUrl) return "";
        try {
            const url = new URL(entry.sourceUrl);
            if (url.hostname.toLowerCase() !== "en.wikipedia.org" || !url.pathname.startsWith("/wiki/")) return "";
            return decodeURIComponent(url.pathname.slice(6)).replace(/_/g, " ").trim();
        } catch {
            return "";
        }
    };

    const optimizedWikimediaUrl = (value, width) => {
        const url = String(value || "");
        if (!/^https:\/\/upload\.wikimedia\.org\//i.test(url)) return url;
        return url.replace(/\/(\d+)px-([^/]+)$/i, `/${width}px-$2`);
    };

    const imageCanRetry = url => {
        const until = failedImageUntil.get(url) || 0;
        if (!until) return true;
        if (Date.now() >= until) {
            failedImageUntil.delete(url);
            return true;
        }
        return false;
    };

    async function fetchWikipediaImage(entry) {
        const title = wikipediaTitle(entry);
        if (!title) return null;
        const cacheKey = title.toLowerCase();
        if (wikipediaCache.has(cacheKey)) return wikipediaCache.get(cacheKey);

        const pending = (async () => {
            try {
                const url = new URL("https://en.wikipedia.org/w/api.php");
                url.searchParams.set("action", "query");
                url.searchParams.set("format", "json");
                url.searchParams.set("formatversion", "2");
                url.searchParams.set("origin", "*");
                url.searchParams.set("redirects", "1");
                url.searchParams.set("prop", "pageimages");
                url.searchParams.set("piprop", "thumbnail|original|name");
                url.searchParams.set("pilicense", "any");
                url.searchParams.set("pithumbsize", String(IMAGE_WIDTH));
                url.searchParams.set("titles", title);
                const response = await fetch(url, { cache: "force-cache" });
                if (!response.ok) return null;
                const data = await response.json();
                const page = Array.isArray(data?.query?.pages) ? data.query.pages[0] : null;
                const imageUrl = page?.thumbnail?.source || page?.original?.source || "";
                if (!/^https:\/\//i.test(imageUrl)) return null;
                return {
                    url: imageUrl,
                    alt: entry.imageAlt || `${entry.title?.replace(/\s+took place$/i, "") || title} image`,
                    credit: entry.imageCredit || "Wikipedia"
                };
            } catch {
                return null;
            }
        })();

        wikipediaCache.set(cacheKey, pending);
        return pending;
    }

    async function resolveEntryImage(entry) {
        if (resolvedImageCache.has(entry)) return resolvedImageCache.get(entry);
        const pending = entry?.imageUrl
            ? Promise.resolve({ url: entry.imageUrl, alt: entry.imageAlt || "", credit: entry.imageCredit || "" })
            : fetchWikipediaImage(entry);
        resolvedImageCache.set(entry, pending);
        return pending;
    }

    function preloadImage(candidate, entry, { priority = false, decorative = false, targetWidth = IMAGE_WIDTH } = {}) {
        return new Promise((resolve, reject) => {
            if (!candidate?.url) return reject(new Error("No image URL"));
            const src = optimizedWikimediaUrl(candidate.url, targetWidth);
            if (!imageCanRetry(src)) return reject(new Error("Image retry cooldown"));

            const image = document.createElement("img");
            image.alt = decorative ? "" : (candidate.alt || entry.imageAlt || "");
            image.loading = "eager";
            image.fetchPriority = priority ? "high" : "low";
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            if (entry.imagePosition) image.style.objectPosition = entry.imagePosition;
            image.addEventListener("load", () => {
                failedImageUntil.delete(src);
                resolve(image);
            }, { once: true });
            image.addEventListener("error", () => {
                failedImageUntil.set(src, Date.now() + IMAGE_FAILURE_TTL_MS);
                reject(new Error("Image failed"));
            }, { once: true });
            image.src = src;
        });
    }

    async function bestLoadedImage(entry, options = {}) {
        const stored = await resolveEntryImage(entry);
        if (stored) {
            try {
                return { image: await preloadImage(stored, entry, options), credit: stored.credit || "" };
            } catch {}
        }
        const live = await fetchWikipediaImage(entry);
        if (!live || live.url === stored?.url) return null;
        try {
            return { image: await preloadImage(live, entry, options), credit: live.credit || "" };
        } catch {
            return null;
        }
    }

    function mediaBlock(entry, priority = false) {
        const media = el("div", "otd-entry-media is-fallback is-image-loading");
        media.replaceChildren(
            el("span", "otd-media-year", entryYear(entry)),
            el("span", "otd-media-promotion", entry.promotion || kindLabel(entry.kind))
        );

        const load = () => {
            bestLoadedImage(entry, { priority, targetWidth: IMAGE_WIDTH }).then(result => {
                if (!result?.image || !media.isConnected) return;
                media.classList.remove("is-fallback", "is-image-loading");
                media.classList.add("is-image-ready");
                media.replaceChildren(result.image);
                if (result.credit) media.append(el("span", "otd-media-credit", result.credit));
            }).catch(() => media.classList.remove("is-image-loading"));
        };

        if (priority || !mediaObserver) load();
        else {
            pendingMedia.set(media, load);
            mediaObserver.observe(media);
        }
        return media;
    }

    function attachPillImage(button, entry, immediate = false) {
        if (!entry) return;
        const media = el("span", "otd-day-pill-image");
        media.setAttribute("aria-hidden", "true");
        button.prepend(media);

        const load = () => {
            if (!button.isConnected) return;
            bestLoadedImage(entry, { decorative: true, targetWidth: PILL_IMAGE_WIDTH }).then(result => {
                if (!result?.image || !button.isConnected) return;
                media.replaceChildren(result.image);
                button.classList.add("has-image");
            });
        };

        if (immediate || !("requestIdleCallback" in window)) load();
        else window.requestIdleCallback(load, { timeout: 1100 });
    }

    function animateNode(node, keyframes, options) {
        if (!node || !motionAllowed() || typeof node.animate !== "function") return;
        node.animate(keyframes, options);
    }

    const queryDate = parseKey(new URLSearchParams(location.search).get("date"));
    let dayIndex = new Map();
    let activeDate = queryDate || readSessionDate() || localToday();
    let activeFilter = "all";
    let renderedWeekKey = "";
    let prefetchHandle = null;

    const entriesForDate = date => dayIndex.get(keyForDate(date)) || [];

    function updateUrl() {
        const url = new URL(location.href);
        const key = keyForDate(activeDate);
        if (key === keyForDate(localToday())) url.searchParams.delete("date");
        else url.searchParams.set("date", key);
        history.replaceState({}, "", url);
        saveSessionDate(activeDate);
    }

    function updateWeekSelection() {
        if (!weekStrip) return;
        const activeKey = keyForDate(activeDate);
        const todayKey = keyForDate(localToday());
        for (const button of weekStrip.querySelectorAll(".otd-day-pill")) {
            const isActive = button.dataset.date === activeKey;
            const isToday = button.dataset.date === todayKey;
            button.classList.toggle("is-active", isActive);
            button.classList.toggle("is-today", isToday);
            button.setAttribute("aria-pressed", String(isActive));
            if (isToday) button.setAttribute("aria-current", "date");
            else button.removeAttribute("aria-current");
        }
    }

    function renderWeek() {
        if (!weekStrip) return;
        const start = new Date(activeDate);
        start.setDate(start.getDate() - start.getDay());
        const signature = `${start.getFullYear()}-${keyForDate(start)}`;
        if (signature === renderedWeekKey) return updateWeekSelection();
        renderedWeekKey = signature;

        const activeKey = keyForDate(activeDate);
        const todayKey = keyForDate(localToday());
        const buttons = [];

        for (let index = 0; index < 7; index += 1) {
            const date = new Date(start);
            date.setDate(start.getDate() + index);
            const matching = entriesForDate(date);
            const historyCount = matching.filter(entry => entry.kind !== "birthday").length;
            const birthdayCount = matching.length - historyCount;
            const dateKey = keyForDate(date);

            const button = el("button", "otd-day-pill");
            button.type = "button";
            button.dataset.date = dateKey;
            button.style.setProperty("--otd-order", String(index));
            button.classList.toggle("is-active", dateKey === activeKey);
            button.classList.toggle("is-today", dateKey === todayKey);
            button.setAttribute("aria-pressed", String(dateKey === activeKey));
            if (dateKey === todayKey) button.setAttribute("aria-current", "date");
            button.setAttribute("aria-label", `${formatLong.format(date)}: ${historyCount} history ${historyCount === 1 ? "entry" : "entries"}, ${birthdayCount} ${birthdayCount === 1 ? "birthday" : "birthdays"}`);
            button.append(
                el("span", "otd-day-pill-weekday", formatWeekday.format(date)),
                el("span", "otd-day-pill-date", String(date.getDate()))
            );

            if (dateKey === todayKey) button.append(el("span", "otd-day-pill-today", "Today"));

            const summary = el("span", "otd-day-pill-summary");
            summary.append(el("span", "otd-day-pill-total", String(matching.length)));
            const types = [];
            if (historyCount) types.push(`${historyCount}H`);
            if (birthdayCount) types.push(`${birthdayCount}B`);
            summary.append(el("span", "otd-day-pill-types", types.join(" · ") || "—"));
            button.append(summary);

            const representative = matching.find(entry => entry.kind !== "birthday" && (entry.imageUrl || wikipediaTitle(entry)))
                || matching.find(entry => entry.imageUrl || wikipediaTitle(entry));
            attachPillImage(button, representative, dateKey === activeKey);
            buttons.push(button);
        }

        weekStrip.replaceChildren(...buttons);
        if (motionAllowed()) {
            weekStrip.classList.remove("is-entering");
            requestAnimationFrame(() => weekStrip.classList.add("is-entering"));
        }
    }

    function renderFilters(matching) {
        if (!filterBar) return;
        const kinds = [...new Set(matching.map(entry => entry.kind).filter(Boolean))]
            .sort((a, b) => (kindOrder.get(a) ?? 99) - (kindOrder.get(b) ?? 99));
        const shouldShow = matching.length >= FILTER_THRESHOLD && kinds.length > 1;

        if (!shouldShow) {
            activeFilter = "all";
            filterBar.hidden = true;
            filterBar.replaceChildren();
            return;
        }

        if (activeFilter !== "all" && !kinds.includes(activeFilter)) activeFilter = "all";
        const controls = ["all", ...kinds].map(kind => {
            const total = kind === "all" ? matching.length : matching.filter(entry => entry.kind === kind).length;
            const label = kind === "all" ? "All" : kindLabel(kind);
            const button = el("button", "otd-filter-button", `${label} ${total}`);
            button.type = "button";
            button.dataset.otdFilter = kind;
            const isActive = kind === activeFilter;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", String(isActive));
            return button;
        });
        filterBar.replaceChildren(...controls);
        filterBar.hidden = false;
    }

    function nearestDateWithEntries(direction) {
        for (let distance = 1; distance <= 366; distance += 1) {
            const date = new Date(activeDate);
            date.setDate(date.getDate() + (distance * direction));
            if (entriesForDate(date).length) return date;
        }
        return null;
    }

    function renderEmptyState() {
        const empty = el("div", "otd-empty");
        empty.append(
            el("strong", "", "Nothing logged for this date yet."),
            el("span", "", "Jump to the nearest day with MMA history, or keep browsing above.")
        );

        const jumps = el("div", "otd-empty-jumps");
        const before = nearestDateWithEntries(-1);
        const after = nearestDateWithEntries(1);

        for (const [date, arrow] of [[before, "←"], [after, "→"]]) {
            if (!date) continue;
            const entries = entriesForDate(date);
            const button = el("button", "otd-empty-jump", `${arrow} ${formatShort.format(date)} · ${entries.length}`);
            button.type = "button";
            button.dataset.otdJump = keyForDate(date);
            button.setAttribute("aria-label", `Go to ${formatLong.format(date)}, ${entries.length} ${entries.length === 1 ? "entry" : "entries"}`);
            jumps.append(button);
        }

        if (jumps.childElementCount) empty.append(jumps);
        return empty;
    }

    function openRowSource(row) {
        const url = row?.dataset?.sourceUrl;
        if (!url) return;
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (opened) opened.opener = null;
    }

    function render(animate = true) {
        const matching = entriesForDate(activeDate);
        renderFilters(matching);
        const visible = activeFilter === "all"
            ? matching
            : matching.filter(entry => entry.kind === activeFilter);

        dateDisplay.textContent = formatLong.format(activeDate);
        dateDisplay.setAttribute("datetime", `${activeDate.getFullYear()}-${keyForDate(activeDate)}`);
        if (dateInput) dateInput.value = `${REFERENCE_YEAR}-${keyForDate(activeDate)}`;
        if (count) {
            count.textContent = activeFilter === "all"
                ? (matching.length ? `${matching.length} ${matching.length === 1 ? "entry" : "entries"}` : "No entries yet")
                : `${visible.length} of ${matching.length}`;
        }
        renderWeek();
        list.setAttribute("aria-busy", "true");

        if (!matching.length) {
            list.replaceChildren(renderEmptyState());
        } else if (!visible.length) {
            const empty = el("div", "otd-empty");
            empty.append(el("strong", "", "No entries match this filter."));
            list.replaceChildren(empty);
        } else {
            const items = visible.map((entry, index) => {
                const item = el("article", `otd-entry otd-entry--${entry.kind || "note"}${index === 0 ? " otd-entry--lead" : ""}`);
                item.style.setProperty("--otd-order", String(index));
                if (entry.sourceUrl) {
                    item.classList.add("is-clickable");
                    item.dataset.sourceUrl = entry.sourceUrl;
                    item.tabIndex = 0;
                    item.setAttribute("role", "link");
                    item.setAttribute("aria-label", `Open source for ${entry.title}`);
                }

                const year = el("div", "otd-entry-year", entryYear(entry));
                const body = el("div", "otd-entry-body");
                const meta = el("div", "otd-entry-meta");
                const age = ageLabel(entry);
                if (age) meta.append(el("span", "otd-age", age));
                if (entry.promotion) meta.append(el("span", "otd-promotion", entry.promotion));
                meta.append(el("span", `otd-kind otd-kind--${entry.kind || "note"}`, kindLabel(entry.kind)));
                body.append(meta, el("h2", "otd-entry-title", entry.title));
                if (entry.detail) body.append(el("p", "otd-entry-detail", entry.detail));
                if (entry.sourceUrl) body.append(externalLink(entry.sourceUrl, "otd-entry-source", `${entry.source || "Source"} ↗`));
                item.append(year, mediaBlock(entry, index === 0), body);
                return item;
            });
            list.replaceChildren(...items);
        }

        list.setAttribute("aria-busy", "false");
        if (animate) {
            animateNode(dateDisplay, [{ opacity: .45, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 220, easing: "cubic-bezier(.2,.75,.25,1)" });
            animateNode(list, [{ opacity: .45, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 240, easing: "cubic-bezier(.2,.75,.25,1)" });
        }

        scheduleAdjacentPrefetch();
    }

    function renderWithTransition() {
        if (motionAllowed() && typeof document.startViewTransition === "function") {
            document.startViewTransition(() => render(false));
        } else {
            render(true);
        }
    }

    function maybeResetScroll(wasDeep) {
        if (!wasDeep) return;
        requestAnimationFrame(() => {
            list.scrollIntoView({ behavior: motionAllowed() ? "smooth" : "auto", block: "start" });
        });
    }

    function setActiveDate(date) {
        const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        if (keyForDate(nextDate) === keyForDate(activeDate)) return;
        const wasDeep = list.getBoundingClientRect().top < 0;
        activeDate = nextDate;
        activeFilter = "all";
        updateUrl();
        renderWithTransition();
        maybeResetScroll(wasDeep);
    }

    function shiftDay(amount) {
        const date = new Date(activeDate);
        date.setDate(date.getDate() + amount);
        setActiveDate(date);
    }

    function scheduleAdjacentPrefetch() {
        const run = () => {
            for (const offset of [-1, 1]) {
                const date = new Date(activeDate);
                date.setDate(date.getDate() + offset);
                const matching = entriesForDate(date);
                const representative = matching.find(entry => entry.imageUrl || wikipediaTitle(entry));
                if (representative) bestLoadedImage(representative, { targetWidth: IMAGE_WIDTH }).catch(() => {});
            }
        };

        if (prefetchHandle !== null && "cancelIdleCallback" in window) window.cancelIdleCallback(prefetchHandle);
        if ("requestIdleCallback" in window) {
            prefetchHandle = window.requestIdleCallback(() => {
                prefetchHandle = null;
                run();
            }, { timeout: 1800 });
        } else {
            window.setTimeout(run, 500);
        }
    }

    function flashButton(button, text) {
        if (!button) return;
        const original = button.dataset.defaultText || button.textContent;
        button.dataset.defaultText = original;
        button.textContent = text;
        window.clearTimeout(Number(button.dataset.resetTimer || 0));
        const timer = window.setTimeout(() => {
            button.textContent = original;
            delete button.dataset.resetTimer;
        }, 1300);
        button.dataset.resetTimer = String(timer);
    }

    async function copyText(value) {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return;
        }
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
    }

    async function shareActiveDate() {
        const url = location.href;
        const data = {
            title: `On This Day in MMA — ${formatLong.format(activeDate)}`,
            url
        };

        if (navigator.share) {
            try {
                await navigator.share(data);
                flashButton(shareButton, "Shared");
                return;
            } catch (error) {
                if (error?.name === "AbortError") return;
            }
        }

        try {
            await copyText(url);
            flashButton(shareButton, "Copied");
        } catch {
            flashButton(shareButton, "Copy failed");
        }
    }

    function randomDay() {
        const currentKey = keyForDate(activeDate);
        const keys = [...dayIndex.keys()].filter(key => key !== currentKey && dayIndex.get(key)?.length);
        if (!keys.length) return;
        const key = keys[Math.floor(Math.random() * keys.length)];
        const date = parseKey(key);
        if (date) setActiveDate(date);
    }

    function openDatePicker() {
        if (!dateInput) return;
        try {
            if (typeof dateInput.showPicker === "function") dateInput.showPicker();
            else {
                dateInput.focus();
                dateInput.click();
            }
        } catch {
            dateInput.focus();
        }
    }

    previous?.addEventListener("click", () => shiftDay(-1));
    next?.addEventListener("click", () => shiftDay(1));
    todayButton?.addEventListener("click", () => setActiveDate(localToday()));
    shareButton?.addEventListener("click", shareActiveDate);
    randomButton?.addEventListener("click", randomDay);
    dateDisplay.addEventListener("dblclick", openDatePicker);

    dateInput?.addEventListener("change", () => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput.value || "");
        if (!match) return;
        const selected = dateForMonthDay(Number(match[2]), Number(match[3]));
        if (selected) setActiveDate(selected);
    });

    filterBar?.addEventListener("click", event => {
        const button = event.target.closest("[data-otd-filter]");
        if (!button || !filterBar.contains(button)) return;
        const filter = button.dataset.otdFilter || "all";
        if (filter === activeFilter) return;
        activeFilter = filter;
        render(true);
    });

    weekStrip?.addEventListener("click", event => {
        const button = event.target.closest(".otd-day-pill");
        const selected = button && weekStrip.contains(button) ? parseKey(button.dataset.date) : null;
        if (selected) setActiveDate(selected);
    });

    weekStrip?.addEventListener("keydown", event => {
        if (!/^Arrow(Left|Right)$/.test(event.key)) return;
        const button = event.target.closest(".otd-day-pill");
        if (!button) return;
        const pills = [...weekStrip.querySelectorAll(".otd-day-pill")];
        const current = pills.indexOf(button);
        const target = pills[current + (event.key === "ArrowRight" ? 1 : -1)];
        if (!target) return;
        event.preventDefault();
        target.focus();
        target.click();
    });

    weekStrip?.addEventListener("wheel", event => {
        if (weekStrip.scrollWidth <= weekStrip.clientWidth) return;
        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
        event.preventDefault();
        weekStrip.scrollLeft += event.deltaY;
    }, { passive: false });

    list.addEventListener("click", event => {
        const jump = event.target.closest("[data-otd-jump]");
        if (jump) {
            const date = parseKey(jump.dataset.otdJump);
            if (date) setActiveDate(date);
            return;
        }

        if (event.target.closest("a, button, input, select, textarea")) return;
        const row = event.target.closest(".otd-entry.is-clickable");
        if (!row || !list.contains(row)) return;
        if (window.getSelection?.().toString().trim()) return;
        openRowSource(row);
    });

    list.addEventListener("keydown", event => {
        const row = event.target.closest(".otd-entry.is-clickable");
        if (!row || event.target !== row || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        openRowSource(row);
    });

    document.addEventListener("keydown", event => {
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        const target = event.target;
        const editable = target?.matches?.("input, textarea, select, [contenteditable='true']");
        if (editable) return;

        if (/^Arrow(Left|Right)$/.test(event.key)) {
            if (target?.closest?.("[data-otd-week]")) return;
            event.preventDefault();
            shiftDay(event.key === "ArrowRight" ? 1 : -1);
            return;
        }

        if (event.key.toLowerCase() === "t") {
            event.preventDefault();
            setActiveDate(localToday());
        }
    });

    async function load() {
        const url = widget.dataset.historyUrl;
        if (!url) return;
        widget.classList.add("is-loading");
        try {
            const response = await fetch(url, { cache: "force-cache" });
            if (!response.ok) throw new Error(`History request failed: ${response.status}`);
            const data = await response.json();
            dayIndex = buildDayIndex(Array.isArray(data?.entries) ? data.entries : []);
            updateUrl();
            render(false);
        } catch {
            list.replaceChildren(el("p", "otd-empty", "History archive unavailable right now."));
        } finally {
            widget.classList.remove("is-loading");
            widget.classList.add("is-ready");
        }
    }

    load();
})();
