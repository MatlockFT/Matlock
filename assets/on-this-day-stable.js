(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    if (!widget || widget.dataset.otdStableBooted === "1") return;
    widget.dataset.otdStableBooted = "1";

    const REFERENCE_YEAR = 2024;
    const SESSION_KEY = "mma-matlock:otd:last-date";
    const FILTER_THRESHOLD = 6;
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

    function ageLabel(entry) {
        const year = Number(entryYear(entry));
        if (!year) return "";
        const age = new Date().getFullYear() - year;
        if (age <= 0) return "This year";
        if (entry.kind === "birthday") return `Born ${age} ${age === 1 ? "year" : "years"} ago`;
        return `${age} ${age === 1 ? "year" : "years"} ago`;
    }

    function compareEntries(a, b) {
        const kindDiff = (kindOrder.get(a.kind) ?? 99) - (kindOrder.get(b.kind) ?? 99);
        if (kindDiff) return kindDiff;
        const weightDiff = (b.weight || 0) - (a.weight || 0);
        if (weightDiff) return weightDiff;
        return String(b.date || "").localeCompare(String(a.date || ""));
    }

    function buildDayIndex(entries) {
        const index = new Map();
        for (const entry of entries) {
            const key = entry?.date?.slice(5);
            if (!/^\d{2}-\d{2}$/.test(key || "")) continue;
            if (!index.has(key)) index.set(key, []);
            index.get(key).push(entry);
        }
        for (const bucket of index.values()) bucket.sort(compareEntries);
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

    const queryDate = parseKey(new URLSearchParams(location.search).get("date"));
    let dayIndex = new Map();
    let activeDate = queryDate || readSessionDate() || localToday();
    let activeFilter = "all";
    let renderedWeekKey = "";

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
            const representative = matching.find(entry => entry.kind !== "birthday" && entry.imageUrl)
                || matching.find(entry => entry.imageUrl);
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

    function nearestDateWithEntries(direction) {
        for (let distance = 1; distance <= 366; distance += 1) {
            const date = new Date(activeDate);
            date.setDate(date.getDate() + distance * direction);
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
        for (const [date, arrow] of [[nearestDateWithEntries(-1), "←"], [nearestDateWithEntries(1), "→"]]) {
            if (!date) continue;
            const total = entriesForDate(date).length;
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

    function render(animate = true) {
        const matching = entriesForDate(activeDate);
        renderFilters(matching);
        const visible = activeFilter === "all" ? matching : matching.filter(entry => entry.kind === activeFilter);

        dateDisplay.textContent = formatLong.format(activeDate);
        dateDisplay.setAttribute("datetime", `${activeDate.getFullYear()}-${keyForDate(activeDate)}`);
        if (dateInput) dateInput.value = `${REFERENCE_YEAR}-${keyForDate(activeDate)}`;
        if (count) count.textContent = activeFilter === "all"
            ? (matching.length ? `${matching.length} ${matching.length === 1 ? "entry" : "entries"}` : "No entries yet")
            : `${visible.length} of ${matching.length}`;

        renderWeek();
        list.setAttribute("aria-busy", "true");
        if (!matching.length) {
            list.replaceChildren(renderEmptyState());
        } else if (!visible.length) {
            const empty = el("div", "otd-empty");
            empty.append(el("strong", "", "No entries match this filter."));
            list.replaceChildren(empty);
        } else {
            const rows = visible.map((entry, index) => {
                const row = el("article", `otd-entry otd-entry--${entry.kind || "note"}${index === 0 ? " otd-entry--lead" : ""}`);
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
                if (entry.sourceUrl) body.append(externalLink(entry.sourceUrl, "otd-entry-source", `${entry.source || "Source"} ↗`));
                const media = mediaBlock(entry, row, index === 0);
                row.append(year, media, body);
                return row;
            });
            list.replaceChildren(...rows);
        }
        list.setAttribute("aria-busy", "false");

        if (animate && motionAllowed() && typeof list.animate === "function") {
            list.animate(
                [{ opacity: 0.58, transform: "translateY(5px)" }, { opacity: 1, transform: "translateY(0)" }],
                { duration: 180, easing: "ease-out" }
            );
        }
    }

    function setActiveDate(date) {
        const nextDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        if (keyForDate(nextDate) === keyForDate(activeDate)) return;
        const wasDeep = list.getBoundingClientRect().top < 0;
        activeDate = nextDate;
        activeFilter = "all";
        updateUrl();
        render(true);
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
        const data = { title: `On This Day in MMA — ${formatLong.format(activeDate)}`, url: location.href };
        if (navigator.share) {
            try { await navigator.share(data); flashButton(shareButton, "Shared"); return; }
            catch (error) { if (error?.name === "AbortError") return; }
        }
        try { await copyText(location.href); flashButton(shareButton, "Copied"); }
        catch { flashButton(shareButton, "Copy failed"); }
    }

    function randomDay() {
        const current = keyForDate(activeDate);
        const keys = [...dayIndex.keys()].filter(key => key !== current && dayIndex.get(key)?.length);
        if (!keys.length) return;
        const date = parseKey(keys[Math.floor(Math.random() * keys.length)]);
        if (date) setActiveDate(date);
    }

    function openDatePicker() {
        if (!dateInput) return;
        try {
            if (typeof dateInput.showPicker === "function") dateInput.showPicker();
            else { dateInput.focus(); dateInput.click(); }
        } catch { dateInput.focus(); }
    }

    function openRowSource(row) {
        const url = row?.dataset?.sourceUrl;
        if (!url) return;
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (opened) opened.opener = null;
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
        const nextFilter = button.dataset.otdFilter || "all";
        if (nextFilter === activeFilter) return;
        activeFilter = nextFilter;
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
        const row = event.target.closest(".otd-entry.is-clickable");
        if (!row || event.target !== row || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        openRowSource(row);
    });

    document.addEventListener("keydown", event => {
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

    async function load() {
        const url = widget.dataset.historyUrl;
        if (!url) return;
        widget.classList.add("is-loading");
        try {
            const response = await fetch(url, { cache: "default" });
            if (!response.ok) throw new Error(`History request failed: ${response.status}`);
            const data = await response.json();
            dayIndex = buildDayIndex(Array.isArray(data?.entries) ? data.entries : []);
            updateUrl();
            render(false);
        } catch (error) {
            console.error("On This Day failed to load", error);
            list.replaceChildren(el("p", "otd-empty", "History archive unavailable right now."));
        } finally {
            widget.classList.remove("is-loading");
            widget.classList.add("is-ready");
        }
    }

    load();
})();
