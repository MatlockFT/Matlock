(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    if (!widget || widget.dataset.otdStableBooted === "1") return;
    widget.dataset.otdStableBooted = "1";

    const REFERENCE_YEAR = 2024;
    const SESSION_KEY = "mma-matlock:otd:last-date";
    const SHORTCUT_HINT_KEY = "mma-matlock:otd:shortcut-hint-seen";
    const FILTER_THRESHOLD = 6;
    const COLLAPSE_LIMIT = 8;

    const kindOrder = new Map([
        ["fight", 0], ["title", 1], ["signing", 2], ["debut", 3],
        ["incident", 4], ["event", 5], ["news", 6], ["death", 7], ["birthday", 8]
    ]);

    const kindBonus = new Map([
        ["title", 12], ["fight", 10], ["incident", 8], ["debut", 7],
        ["signing", 6], ["death", 5], ["news", 4], ["birthday", 2], ["event", 0]
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
    const dock = widget.querySelector("[data-otd-dock]");
    const modeGroup = widget.querySelector("[data-otd-mode-group]");
    const modeButtons = [...widget.querySelectorAll("[data-otd-mode]")];
    const sortSelect = widget.querySelector("[data-otd-sort]");
    const shortcutHint = widget.querySelector("[data-otd-shortcut-hint]");
    if (!list || !dateDisplay) return;

    const formatLong = new Intl.DateTimeFormat([], { month: "long", day: "numeric" });
    const formatShort = new Intl.DateTimeFormat([], { month: "short", day: "numeric" });
    const formatWeekday = new Intl.DateTimeFormat([], { weekday: "short" });
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
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
        try { return parseKey(sessionStorage.getItem(SESSION_KEY)); }
        catch { return null; }
    };

    const saveSessionDate = date => {
        try { sessionStorage.setItem(SESSION_KEY, keyForDate(date)); }
        catch {}
    };

    const entryYear = entry => entry.date?.slice(0, 4) || "";

    const kindLabel = kind => ({
        fight: "Fight", event: "Event", signing: "Signing", debut: "Debut",
        title: "Title", incident: "Incident", news: "News", death: "In memoriam",
        birthday: "Birthday"
    })[kind] || "Note";

    const slug = value => String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 90) || "entry";

    const entryAnchor = entry => `otd-${String(entry?.date || "").replace(/-/g, "")}-${slug(entry?.title)}`;

    function ageLabel(entry) {
        const year = Number(entryYear(entry));
        if (!year) return "";
        const age = new Date().getFullYear() - year;
        if (age <= 0) return "This year";
        if (entry.kind === "birthday") return `Born ${age} ${age === 1 ? "year" : "years"} ago`;
        return `${age} ${age === 1 ? "year" : "years"} ago`;
    }

    function significanceScore(entry) {
        return Number(entry?.weight || 0) + (kindBonus.get(entry?.kind) || 0);
    }

    function compareNotable(a, b) {
        const scoreDiff = significanceScore(b) - significanceScore(a);
        if (scoreDiff) return scoreDiff;
        const kindDiff = (kindOrder.get(a.kind) ?? 99) - (kindOrder.get(b.kind) ?? 99);
        if (kindDiff) return kindDiff;
        return String(b.date || "").localeCompare(String(a.date || ""));
    }

    function sortEntries(entries, mode) {
        const copy = [...entries];
        if (mode === "newest") {
            return copy.sort((a, b) =>
                String(b.date || "").localeCompare(String(a.date || "")) ||
                compareNotable(a, b)
            );
        }
        if (mode === "oldest") {
            return copy.sort((a, b) =>
                String(a.date || "").localeCompare(String(b.date || "")) ||
                compareNotable(a, b)
            );
        }
        return copy.sort(compareNotable);
    }

    function notableSubset(entries) {
        if (entries.length <= FILTER_THRESHOLD) return [...entries];
        const total = Math.min(6, Math.max(3, Math.ceil(entries.length * 0.4)));
        return [...entries].sort(compareNotable).slice(0, total);
    }

    function buildDayIndex(entries) {
        const index = new Map();
        for (const entry of entries) {
            const key = entry?.date?.slice(5);
            if (!/^\d{2}-\d{2}$/.test(key || "")) continue;
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(entry);
        }
        return index;
    }

    function classifyImage(image) {
        const w = image.naturalWidth || 0;
        const h = image.naturalHeight || 0;
        if (!w || !h) return "landscape";
        const ratio = w / h;
        if (ratio <= 0.72) return "poster";
        if (ratio < 0.94) return "portrait";
        if (ratio <= 1.18) return "square";
        if (ratio >= 2.05) return "wide";
        return "landscape";
    }

    function applyImageMode(row, media, image) {
        if (!row || !media || !image?.naturalWidth || row.dataset.mediaModeApplied === "1") return;
        const mode = classifyImage(image);
        row.classList.remove("is-media-fallback");
        row.classList.add(`is-media-${mode}`);
        media.classList.add(`otd-entry-media--${mode}`);
        row.dataset.mediaMode = mode;
        row.dataset.mediaModeApplied = "1";
    }

    function markFallback(row, media) {
        if (!row || !media) return;
        media.classList.remove("is-image-loading", "is-image-ready");
        media.classList.add("is-fallback");
        media.removeAttribute("role");
        media.removeAttribute("tabindex");
        media.removeAttribute("aria-label");
        row.classList.add("is-media-fallback");
        row.dataset.mediaMode = "fallback";
        row.dataset.mediaModeApplied = "1";
    }

    function mediaBlock(entry, row, priority = false) {
        const media = el("div", "otd-entry-media");
        if (!entry?.imageUrl) {
            media.classList.add("is-fallback");
            media.append(
                el("span", "otd-media-year", entryYear(entry)),
                el("span", "otd-media-promotion", entry.promotion || kindLabel(entry.kind))
            );
            markFallback(row, media);
            return media;
        }

        media.classList.add("is-image-loading");
        const image = document.createElement("img");
        image.alt = entry.imageAlt || `${entry.title || "MMA history"} image`;
        image.loading = priority ? "eager" : "lazy";
        image.decoding = "async";
        image.fetchPriority = priority ? "high" : "auto";
        if (entry.imagePosition) image.style.objectPosition = entry.imagePosition;

        let settled = false;
        const ready = () => {
            if (settled || !image.naturalWidth) return;
            settled = true;
            media.classList.remove("is-image-loading", "is-fallback");
            media.classList.add("is-image-ready");
            media.tabIndex = 0;
            media.setAttribute("role", "button");
            media.setAttribute("aria-label", `View full image for ${entry.title || "this entry"}`);
            media.dataset.lightboxSrc = image.currentSrc || image.src;
            media.dataset.lightboxAlt = image.alt;
            media.dataset.lightboxCredit = entry.imageCredit || "";
            applyImageMode(row, media, image);
        };

        const failed = () => {
            if (settled) return;
            settled = true;
            media.replaceChildren(
                el("span", "otd-media-year", entryYear(entry)),
                el("span", "otd-media-promotion", entry.promotion || kindLabel(entry.kind))
            );
            markFallback(row, media);
        };

        image.addEventListener("load", ready, { once: true });
        image.addEventListener("error", failed, { once: true });
        media.append(image);
        if (entry.imageCredit) media.append(el("span", "otd-media-credit", entry.imageCredit));
        image.src = String(entry.imageUrl);
        if (image.complete) queueMicrotask(() => image.naturalWidth ? ready() : failed());
        return media;
    }

    function attachPillImage(button, entry) {
        if (!entry?.imageUrl) return;
        const media = el("span", "otd-day-pill-image");
        media.setAttribute("aria-hidden", "true");
        const image = document.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.addEventListener("load", () => button.classList.add("has-image"), { once: true });
        image.addEventListener("error", () => media.remove(), { once: true });
        media.append(image);
        button.prepend(media);
        image.src = String(entry.imageUrl);
    }

    let lightbox = null;
    let lightboxImage = null;
    let lightboxCaption = null;
    let lightboxClose = null;
    let lightboxReturnFocus = null;

    function ensureLightbox() {
        if (lightbox) return;
        lightbox = el("div", "otd-lightbox");
        lightbox.hidden = true;
        lightbox.setAttribute("role", "dialog");
        lightbox.setAttribute("aria-modal", "true");
        lightbox.setAttribute("aria-label", "Full-size event artwork");

        const figure = el("figure", "otd-lightbox-figure");
        lightboxImage = el("img", "otd-lightbox-image");
        lightboxCaption = el("figcaption", "otd-lightbox-caption");
        lightboxClose = el("button", "otd-lightbox-close", "×");
        lightboxClose.type = "button";
        lightboxClose.setAttribute("aria-label", "Close image");
        figure.append(lightboxImage, lightboxCaption);
        lightbox.append(figure, lightboxClose);
        document.body.append(lightbox);

        lightboxClose.addEventListener("click", closeLightbox);
        lightbox.addEventListener("click", event => {
            if (event.target === lightbox) closeLightbox();
        });
    }

    function openLightbox(media) {
        const src = media?.dataset?.lightboxSrc;
        if (!src) return;
        ensureLightbox();
        lightboxReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : media;
        lightboxImage.src = src;
        lightboxImage.alt = media.dataset.lightboxAlt || "";
        lightboxCaption.textContent = media.dataset.lightboxCredit || "";
        lightboxCaption.hidden = !lightboxCaption.textContent;
        lightbox.hidden = false;
        document.documentElement.classList.add("otd-lightbox-open");
        lightboxClose.focus({ preventScroll: true });
    }

    function closeLightbox() {
        if (!lightbox || lightbox.hidden) return;
        lightbox.hidden = true;
        document.documentElement.classList.remove("otd-lightbox-open");
        lightboxImage.removeAttribute("src");
        lightboxReturnFocus?.focus?.({ preventScroll: true });
        lightboxReturnFocus = null;
    }

    const queryDate = parseKey(new URLSearchParams(location.search).get("date"));
    let dayIndex = new Map();
    let availableDateCounts = new Map();
    let historyIndex = null;
    const monthRequests = new Map();
    let fullArchiveLoaded = false;
    let navigationToken = 0;
    let activeDate = queryDate || readSessionDate() || localToday();
    let activeFilter = "all";
    let activeMode = "all";
    let activeSort = "notable";
    let expanded = false;
    let renderedWeekKey = "";
    let hashScrollPending = Boolean(location.hash);

    const entriesForDate = date => dayIndex.get(keyForDate(date)) || [];

    function mergeEntries(entries) {
        const incoming = buildDayIndex(entries);
        for (const [key, values] of incoming) dayIndex.set(key, values);
    }

    function monthKeysForWeek(date) {
        const start = new Date(date);
        start.setDate(start.getDate() - start.getDay());
        const months = new Set([String(date.getMonth() + 1).padStart(2, "0")]);
        for (let offset = 0; offset < 7; offset += 1) {
            const current = new Date(start);
            current.setDate(start.getDate() + offset);
            months.add(String(current.getMonth() + 1).padStart(2, "0"));
        }
        return [...months];
    }

    async function loadMonth(month) {
        if (fullArchiveLoaded || monthRequests.has(month)) return monthRequests.get(month);
        const descriptor = historyIndex?.months?.[month];
        if (!descriptor?.file) throw new Error(`History index is missing month ${month}.`);
        const indexUrl = new URL(widget.dataset.historyIndexUrl, location.href);
        const url = new URL(descriptor.file, indexUrl);
        url.search = indexUrl.search;
        const request = fetch(url, { cache: "default" })
            .then(response => {
                if (!response.ok) throw new Error(`History month request failed: ${response.status}`);
                return response.json();
            })
            .then(data => mergeEntries(Array.isArray(data?.entries) ? data.entries : []));
        monthRequests.set(month, request);
        try {
            await request;
        } catch (error) {
            monthRequests.delete(month);
            throw error;
        }
    }

    const ensureVisibleMonths = date => Promise.all(monthKeysForWeek(date).map(loadMonth));

    async function loadFullArchive() {
        if (fullArchiveLoaded) return;
        const url = widget.dataset.historyFallbackUrl;
        if (!url) throw new Error("History fallback URL is missing.");
        const response = await fetch(url, { cache: "default" });
        if (!response.ok) throw new Error(`History fallback request failed: ${response.status}`);
        const data = await response.json();
        const entries = Array.isArray(data?.entries) ? data.entries : [];
        dayIndex = buildDayIndex(entries);
        availableDateCounts = new Map([...dayIndex].map(([key, values]) => [key, values.length]));
        fullArchiveLoaded = true;
    }

    function updateUrl(clearHash = true) {
        const url = new URL(location.href);
        const key = keyForDate(activeDate);
        if (key === keyForDate(localToday())) url.searchParams.delete("date");
        else url.searchParams.set("date", key);
        if (clearHash) url.hash = "";
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
        if (signature === renderedWeekKey) {
            updateWeekSelection();
            return;
        }
        renderedWeekKey = signature;

        const todayKey = keyForDate(localToday());
        const buttons = [];
        for (let i = 0; i < 7; i += 1) {
            const date = new Date(start);
            date.setDate(start.getDate() + i);
            const matching = entriesForDate(date);
            const historyCount = matching.filter(entry => entry.kind !== "birthday").length;
            const birthdayCount = matching.length - historyCount;
            const dateKey = keyForDate(date);
            const button = el("button", "otd-day-pill");
            button.type = "button";
            button.dataset.date = dateKey;
            button.style.setProperty("--otd-order", String(i));
            button.classList.toggle("is-active", dateKey === keyForDate(activeDate));
            button.classList.toggle("is-today", dateKey === todayKey);
            button.setAttribute("aria-pressed", String(dateKey === keyForDate(activeDate)));
            if (dateKey === todayKey) button.setAttribute("aria-current", "date");
            button.setAttribute("aria-label", `${formatLong.format(date)}: ${historyCount} history entries, ${birthdayCount} birthdays`);
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

            const representative = [...matching]
                .filter(entry => entry.imageUrl)
                .sort(compareNotable)[0];
            attachPillImage(button, representative);
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

        if (matching.length < FILTER_THRESHOLD || kinds.length < 2) {
            activeFilter = "all";
            filterBar.hidden = true;
            filterBar.replaceChildren();
            return;
        }

        if (activeFilter !== "all" && !kinds.includes(activeFilter)) activeFilter = "all";
        const buttons = ["all", ...kinds].map(kind => {
            const total = kind === "all" ? matching.length : matching.filter(entry => entry.kind === kind).length;
            const button = el("button", "otd-filter-button", `${kind === "all" ? "All" : kindLabel(kind)} ${total}`);
            button.type = "button";
            button.dataset.otdFilter = kind;
            const selected = kind === activeFilter;
            button.classList.toggle("is-active", selected);
            button.setAttribute("aria-pressed", String(selected));
            return button;
        });

        filterBar.replaceChildren(...buttons);
        filterBar.hidden = false;
    }

    function renderModeControls(matching) {
        if (modeGroup) {
            const busy = matching.length > FILTER_THRESHOLD;
            modeGroup.hidden = !busy;
            if (!busy) activeMode = "all";
        }

        for (const button of modeButtons) {
            const selected = button.dataset.otdMode === activeMode;
            button.classList.toggle("is-active", selected);
            button.setAttribute("aria-pressed", String(selected));
        }

        if (sortSelect && sortSelect.value !== activeSort) sortSelect.value = activeSort;
    }

    function nearestDateWithEntries(direction) {
        for (let distance = 1; distance <= 366; distance += 1) {
            const date = new Date(activeDate);
            date.setDate(date.getDate() + distance * direction);
            if (availableDateCounts.get(keyForDate(date))) return date;
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
        for (const [date, arrow] of [[nearestDateWithEntries(-1), "←"], [nearestDateWithEntries(1), "→"]]) {
            if (!date) continue;
            const total = availableDateCounts.get(keyForDate(date)) || entriesForDate(date).length;
            const button = el("button", "otd-empty-jump", `${arrow} ${formatShort.format(date)} · ${total}`);
            button.type = "button";
            button.dataset.otdJump = keyForDate(date);
            jumps.append(button);
        }
        if (jumps.childElementCount) empty.append(jumps);
        return empty;
    }

    const externalLink = (url, className, text) => {
        const link = el("a", className, text);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        return link;
    };

    function entryShareUrl(entry) {
        const url = new URL(location.href);
        url.searchParams.set("date", String(entry.date || "").slice(5));
        url.hash = entryAnchor(entry);
        return url.href;
    }

    function buildRow(entry, index) {
        const row = el("article", `otd-entry otd-entry--${entry.kind || "note"}${index === 0 ? " otd-entry--lead" : ""}`);
        row.id = entryAnchor(entry);
        row.style.setProperty("--otd-order", String(index));

        if (entry.sourceUrl) {
            row.classList.add("is-clickable");
            row.dataset.sourceUrl = entry.sourceUrl;
            row.tabIndex = 0;
            row.setAttribute("role", "link");
            row.setAttribute("aria-label", `Open source for ${entry.title}`);
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

        const actions = el("div", "otd-entry-actions");
        if (entry.sourceUrl) actions.append(externalLink(entry.sourceUrl, "otd-entry-source", `${entry.source || "Source"} ↗`));

        const linkButton = el("button", "otd-entry-link", "Link");
        linkButton.type = "button";
        linkButton.dataset.otdEntryLink = entryShareUrl(entry);
        linkButton.setAttribute("aria-label", `Share link to ${entry.title}`);
        actions.append(linkButton);
        body.append(actions);

        const media = mediaBlock(entry, row, index === 0);
        row.append(year, media, body);

        if (location.hash === `#${row.id}`) row.classList.add("is-targeted");
        return row;
    }

    function render(animate = true) {
        const matching = entriesForDate(activeDate);
        renderFilters(matching);
        renderModeControls(matching);

        let pool = activeFilter === "all"
            ? [...matching]
            : matching.filter(entry => entry.kind === activeFilter);

        const filteredTotal = pool.length;
        if (activeMode === "notable") pool = notableSubset(pool);
        const modeTotal = pool.length;
        const ordered = sortEntries(pool, activeSort);
        if (hashScrollPending && location.hash) expanded = true;
        const displayed = expanded || ordered.length <= COLLAPSE_LIMIT
            ? ordered
            : ordered.slice(0, COLLAPSE_LIMIT);

        dateDisplay.textContent = formatLong.format(activeDate);
        dateDisplay.setAttribute("datetime", `${activeDate.getFullYear()}-${keyForDate(activeDate)}`);
        if (dateInput) dateInput.value = `${REFERENCE_YEAR}-${keyForDate(activeDate)}`;
        if (todayButton) todayButton.hidden = keyForDate(activeDate) === keyForDate(localToday());

        if (count) {
            if (!matching.length) count.textContent = "No entries yet";
            else if (activeMode === "notable") count.textContent = `${modeTotal} notable of ${filteredTotal}`;
            else if (activeFilter !== "all") count.textContent = `${filteredTotal} of ${matching.length}`;
            else count.textContent = `${matching.length} ${matching.length === 1 ? "entry" : "entries"}`;
        }

        renderWeek();
        list.setAttribute("aria-busy", "true");

        if (!matching.length) {
            list.replaceChildren(renderEmptyState());
        } else if (!ordered.length) {
            const empty = el("div", "otd-empty");
            empty.append(el("strong", "", "No entries match this view."));
            list.replaceChildren(empty);
        } else {
            const children = displayed.map(buildRow);

            if (ordered.length > COLLAPSE_LIMIT) {
                const wrap = el("div", "otd-show-more-wrap");
                const remaining = Math.max(0, ordered.length - COLLAPSE_LIMIT);
                const button = el("button", "otd-show-more", expanded ? "Show fewer" : `Show ${remaining} more`);
                button.type = "button";
                button.dataset.otdMore = expanded ? "less" : "more";
                wrap.append(button);
                children.push(wrap);
            }

            list.replaceChildren(...children);
        }

        list.setAttribute("aria-busy", "false");

        if (hashScrollPending && location.hash) {
            requestAnimationFrame(() => {
                const target = document.getElementById(location.hash.slice(1));
                if (target) {
                    target.classList.add("is-targeted");
                    target.scrollIntoView({ block: "center", behavior: "auto" });
                }
                hashScrollPending = false;
            });
        }

        if (animate && motionAllowed() && typeof list.animate === "function") {
            list.animate(
                [{ opacity: 0.58, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }],
                { duration: 180, easing: "ease-out" }
            );
        }
    }

    async function setActiveDate(date) {
        const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        if (keyForDate(nextDate) === keyForDate(activeDate)) return;
        const token = ++navigationToken;
        const wasDeep = list.getBoundingClientRect().top < 0;
        activeDate = nextDate;
        activeFilter = "all";
        activeMode = "all";
        expanded = false;
        hashScrollPending = false;
        updateUrl(true);
        widget.classList.add("is-loading");
        try {
            await ensureVisibleMonths(activeDate);
        } catch (error) {
            console.warn("Monthly history shard unavailable; using the full archive.", error);
            try {
                await loadFullArchive();
            } catch (fallbackError) {
                console.error("On This Day failed to load the selected date", fallbackError);
                if (token === navigationToken) widget.classList.remove("is-loading");
                return;
            }
        }
        if (token !== navigationToken) return;
        renderedWeekKey = "";
        render(true);
        widget.classList.remove("is-loading");
        if (wasDeep) requestAnimationFrame(() => list.scrollIntoView({ behavior: "auto", block: "start" }));
    }

    function shiftDay(amount) {
        const date = new Date(activeDate);
        date.setDate(date.getDate() + amount);
        setActiveDate(date);
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
        }, 1200);
        button.dataset.resetTimer = String(timer);
    }

    async function copyText(value) {
        if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value);
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.readOnly = true;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.append(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
    }

    async function shareActiveDate() {
        const url = new URL(location.href);
        url.hash = "";
        const data = { title: `On This Day in MMA — ${formatLong.format(activeDate)}`, url: url.href };
        if (navigator.share) {
            try {
                await navigator.share(data);
                flashButton(shareButton, "Shared");
                return;
            } catch (error) {
                if (error?.name === "AbortError") return;
            }
        }
        try { await copyText(url.href); flashButton(shareButton, "Copied"); }
        catch { flashButton(shareButton, "Copy failed"); }
    }

    async function shareEntry(button) {
        const url = button?.dataset?.otdEntryLink;
        if (!url) return;
        if (navigator.share) {
            try {
                await navigator.share({ title: "On This Day in MMA", url });
                flashButton(button, "Shared");
                return;
            } catch (error) {
                if (error?.name === "AbortError") return;
            }
        }
        try { await copyText(url); flashButton(button, "Copied"); }
        catch { flashButton(button, "Failed"); }
    }

    function randomDay() {
        const current = keyForDate(activeDate);
        const keys = [...availableDateCounts.keys()].filter(key => key !== current && availableDateCounts.get(key));
        if (!keys.length) return;
        const date = parseKey(keys[Math.floor(Math.random() * keys.length)]);
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

    function openRowSource(row) {
        const url = row?.dataset?.sourceUrl;
        if (!url) return;
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (opened) opened.opener = null;
    }

    function maybeShowShortcutHint() {
        if (!shortcutHint) return;
        let seen = false;
        try { seen = localStorage.getItem(SHORTCUT_HINT_KEY) === "1"; }
        catch {}
        if (seen) return;

        shortcutHint.hidden = false;
        try { localStorage.setItem(SHORTCUT_HINT_KEY, "1"); }
        catch {}
        window.setTimeout(() => {
            shortcutHint.hidden = true;
        }, 8000);
    }

    let dockScrollFrame = 0;
    function updateDockCompact() {
        dockScrollFrame = 0;
        if (!dock) return;
        dock.classList.toggle("is-compact", list.getBoundingClientRect().top < 135);
    }

    function scheduleDockCompact() {
        if (dockScrollFrame) return;
        dockScrollFrame = requestAnimationFrame(updateDockCompact);
    }

    previous?.addEventListener("click", () => shiftDay(-1));
    next?.addEventListener("click", () => shiftDay(1));
    todayButton?.addEventListener("click", () => setActiveDate(localToday()));
    shareButton?.addEventListener("click", shareActiveDate);
    randomButton?.addEventListener("click", randomDay);
    dateDisplay.addEventListener("click", openDatePicker);

    dateInput?.addEventListener("change", () => {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput.value || "");
        if (!match) return;
        const selected = dateForMonthDay(Number(match[2]), Number(match[3]));
        if (selected) setActiveDate(selected);
    });

    filterBar?.addEventListener("click", event => {
        const button = event.target.closest("[data-otd-filter]");
        if (!button || !filterBar.contains(button)) return;
        const nextFilter = button.dataset.otdFilter || "all";
        if (nextFilter === activeFilter) return;
        activeFilter = nextFilter;
        expanded = false;
        render(true);
    });

    modeGroup?.addEventListener("click", event => {
        const button = event.target.closest("[data-otd-mode]");
        if (!button || !modeGroup.contains(button)) return;
        const nextMode = button.dataset.otdMode === "notable" ? "notable" : "all";
        if (nextMode === activeMode) return;
        activeMode = nextMode;
        expanded = false;
        render(true);
    });

    sortSelect?.addEventListener("change", () => {
        activeSort = ["newest", "oldest"].includes(sortSelect.value) ? sortSelect.value : "notable";
        expanded = false;
        render(true);
    });

    weekStrip?.addEventListener("click", event => {
        const button = event.target.closest(".otd-day-pill");
        const date = button && weekStrip.contains(button) ? parseKey(button.dataset.date) : null;
        if (date) setActiveDate(date);
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
        const more = event.target.closest("[data-otd-more]");
        if (more) {
            expanded = more.dataset.otdMore === "more";
            render(true);
            if (!expanded) requestAnimationFrame(() => list.scrollIntoView({ block: "start", behavior: "auto" }));
            return;
        }

        const entryLink = event.target.closest("[data-otd-entry-link]");
        if (entryLink) {
            event.preventDefault();
            event.stopPropagation();
            shareEntry(entryLink);
            return;
        }

        const media = event.target.closest(".otd-entry-media.is-image-ready");
        if (media && list.contains(media)) {
            event.preventDefault();
            event.stopPropagation();
            openLightbox(media);
            return;
        }

        const jump = event.target.closest("[data-otd-jump]");
        if (jump) {
            const date = parseKey(jump.dataset.otdJump);
            if (date) setActiveDate(date);
            return;
        }

        if (event.target.closest("a, button, input, select, textarea")) return;
        const row = event.target.closest(".otd-entry.is-clickable");
        if (!row || !list.contains(row) || window.getSelection?.().toString().trim()) return;
        openRowSource(row);
    });

    list.addEventListener("keydown", event => {
        const media = event.target.closest(".otd-entry-media.is-image-ready");
        if (media && event.target === media && ["Enter", " "].includes(event.key)) {
            event.preventDefault();
            openLightbox(media);
            return;
        }

        const row = event.target.closest(".otd-entry.is-clickable");
        if (!row || event.target !== row || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        openRowSource(row);
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && lightbox && !lightbox.hidden) {
            event.preventDefault();
            closeLightbox();
            return;
        }
        if (lightbox && !lightbox.hidden) return;
        if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
        if (event.target?.matches?.("input, textarea, select, [contenteditable='true']")) return;

        if (/^Arrow(Left|Right)$/.test(event.key)) {
            if (event.target?.closest?.("[data-otd-week]")) return;
            event.preventDefault();
            shiftDay(event.key === "ArrowRight" ? 1 : -1);
        } else if (event.key.toLowerCase() === "t") {
            event.preventDefault();
            setActiveDate(localToday());
        }
    });

    window.addEventListener("scroll", scheduleDockCompact, { passive: true });
    window.addEventListener("resize", scheduleDockCompact, { passive: true });

    async function load() {
        const url = widget.dataset.historyIndexUrl;
        if (!url) return;
        widget.classList.add("is-loading");

        try {
            const response = await fetch(url, { cache: "default" });
            if (!response.ok) throw new Error(`History index request failed: ${response.status}`);
            const data = await response.json();
            if (!data?.months || !data?.dates) throw new Error("History index is invalid.");
            historyIndex = data;
            availableDateCounts = new Map(Object.entries(data.dates).map(([key, value]) => [key, Number(value) || 0]));
            await ensureVisibleMonths(activeDate);
            updateUrl(false);
            render(false);
            maybeShowShortcutHint();
            scheduleDockCompact();
        } catch (error) {
            console.warn("Optimized On This Day archive failed to load; using the full archive.", error);
            try {
                await loadFullArchive();
                updateUrl(false);
                render(false);
                maybeShowShortcutHint();
                scheduleDockCompact();
            } catch (fallbackError) {
                console.error("On This Day failed to load", fallbackError);
                list.replaceChildren(el("p", "otd-empty", "History archive unavailable right now."));
            }
        } finally {
            widget.classList.remove("is-loading");
            widget.classList.add("is-ready");
        }
    }

    load();
})();
