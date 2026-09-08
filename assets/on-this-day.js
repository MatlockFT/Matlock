(() => {
    const widgets = [...document.querySelectorAll("[data-on-this-day]")];
    if (!widgets.length) return;

    // Leap-year reference keeps Feb. 29 available while the archive itself
    // intentionally matches month/day across every historical year.
    const REFERENCE_YEAR = 2024;
    const kindOrder = new Map([
        ["fight", 0],
        ["title", 1],
        ["signing", 2],
        ["debut", 3],
        ["incident", 4],
        ["event", 5],
        ["news", 6],
        ["death", 7],
        ["birthday", 8]
    ]);

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function externalLink(url, className, text) {
        const link = element("a", className, text);
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        return link;
    }

    function localToday() {
        const now = new Date();
        return new Date(REFERENCE_YEAR, now.getMonth(), now.getDate());
    }

    function keyForDate(date) {
        return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function parseKey(value) {
        const match = /^(\d{2})-(\d{2})$/.exec(value || "");
        if (!match) return null;

        const month = Number(match[1]);
        const day = Number(match[2]);
        const date = new Date(REFERENCE_YEAR, month - 1, day);

        if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        return date;
    }

    function displayDate(date, long = false) {
        return new Intl.DateTimeFormat([], long
            ? { month: "long", day: "numeric" }
            : { month: "short", day: "numeric" }
        ).format(date);
    }

    function weekdayLabel(date) {
        return new Intl.DateTimeFormat([], { weekday: "short" }).format(date);
    }

    function entriesForDate(entries, date) {
        const key = keyForDate(date);
        return entries
            .filter(entry => entry.date?.slice(5) === key)
            .sort((first, second) => {
                const kindDifference = (kindOrder.get(first.kind) ?? 99) - (kindOrder.get(second.kind) ?? 99);
                if (kindDifference) return kindDifference;

                const weightDifference = (second.weight || 0) - (first.weight || 0);
                if (weightDifference) return weightDifference;

                return second.date.localeCompare(first.date);
            });
    }

    function compactEntries(entries, date, limit = 4) {
        const ordered = entriesForDate(entries, date);
        const birthdays = ordered.filter(entry => entry.kind === "birthday");
        const nonBirthdays = ordered.filter(entry => entry.kind !== "birthday");
        const picked = [];
        const years = new Set();

        // Prioritize historical moments and era variety, but reserve one slot for
        // a fighter birthday when the date has one so birthdays do not disappear
        // behind four fight cards on busy dates.
        for (const entry of nonBirthdays) {
            const year = entryYear(entry);
            if (years.has(year)) continue;
            picked.push(entry);
            years.add(year);
            if (picked.length === limit) break;
        }

        if (birthdays.length && !picked.some(entry => entry.kind === "birthday")) {
            if (picked.length >= limit) picked[picked.length - 1] = birthdays[0];
            else picked.push(birthdays[0]);
        }

        for (const entry of ordered) {
            if (picked.includes(entry)) continue;
            picked.push(entry);
            if (picked.length === limit) break;
        }

        return picked.slice(0, limit);
    }

    function entryYear(entry) {
        return entry.date?.slice(0, 4) || "";
    }

    function ageLabel(entry) {
        const year = Number(entryYear(entry));
        if (!year) return "";
        const age = new Date().getFullYear() - year;
        if (age <= 0) return "This year";
        if (entry.kind === "birthday") return `Born ${age} ${age === 1 ? "year" : "years"} ago`;
        return `${age} ${age === 1 ? "year" : "years"} ago`;
    }

    function kindLabel(kind) {
        const labels = {
            fight: "Fight",
            event: "Event",
            signing: "Signing",
            debut: "Debut",
            title: "Title",
            incident: "Incident",
            news: "News",
            death: "In memoriam",
            birthday: "Birthday"
        };
        return labels[kind] || "Note";
    }

    function mediaBlock(entry, compact = false, priority = false) {
        const media = element("div", compact ? "otd-compact-media" : "otd-entry-media");
        media.dataset.year = entryYear(entry);
        media.dataset.promotion = entry.promotion || kindLabel(entry.kind);

        const fallback = () => {
            media.classList.add("is-fallback");
            media.replaceChildren(
                element("span", "otd-media-year", entryYear(entry)),
                element("span", "otd-media-promotion", entry.promotion || kindLabel(entry.kind))
            );
        };

        if (!entry.imageUrl) {
            fallback();
            return media;
        }

        const image = document.createElement("img");
        image.src = entry.imageUrl;
        image.alt = entry.imageAlt || "";
        image.loading = priority ? "eager" : "lazy";
        if (priority) image.fetchPriority = "high";
        image.decoding = "async";
        image.referrerPolicy = "no-referrer";
        if (entry.imagePosition) image.style.objectPosition = entry.imagePosition;
        image.addEventListener("error", fallback, { once: true });
        media.append(image);

        if (entry.imageCredit) {
            media.append(element("span", "otd-media-credit", entry.imageCredit));
        }

        return media;
    }

    function renderCompact(widget, entries) {
        const date = localToday();
        const matching = compactEntries(entries, date, 4);
        const dateNode = widget.querySelector("[data-otd-date]");
        const list = widget.querySelector("[data-otd-list]");

        if (dateNode) dateNode.textContent = displayDate(date);
        if (!list) return;

        if (!matching.length) {
            widget.hidden = true;
            return;
        }

        const cards = matching.map((entry, index) => {
            const card = element("article", `otd-compact-item${index === 0 ? " otd-compact-item--lead" : ""}`);
            const copy = element("div", "otd-compact-copy");
            const meta = element("div", "otd-compact-meta");
            meta.append(
                element("span", "otd-year", entryYear(entry)),
                element("span", `otd-kind otd-kind--${entry.kind || "note"}`, kindLabel(entry.kind))
            );

            const title = element("h3", "otd-compact-item-title");
            if (entry.sourceUrl) {
                title.append(externalLink(entry.sourceUrl, "", entry.title));
            } else {
                title.textContent = entry.title;
            }

            copy.append(meta, title);
            card.append(mediaBlock(entry, true, index === 0), copy);
            return card;
        });

        list.replaceChildren(...cards);
        widget.hidden = false;
    }

    function renderFull(widget, entries) {
        const list = widget.querySelector("[data-otd-list]");
        const dateDisplay = widget.querySelector("[data-otd-date]");
        const dateInput = widget.querySelector("[data-otd-input]");
        const previous = widget.querySelector("[data-otd-prev]");
        const next = widget.querySelector("[data-otd-next]");
        const todayButton = widget.querySelector("[data-otd-today]");
        const count = widget.querySelector("[data-otd-count]");
        const weekStrip = widget.querySelector("[data-otd-week]");

        if (!list || !dateDisplay) return;

        const queryDate = parseKey(new URLSearchParams(window.location.search).get("date"));
        let activeDate = queryDate || localToday();

        function updateUrl() {
            const url = new URL(window.location.href);
            const key = keyForDate(activeDate);
            if (key === keyForDate(localToday())) {
                url.searchParams.delete("date");
            } else {
                url.searchParams.set("date", key);
            }
            window.history.replaceState({}, "", url);
        }

        function setActiveDate(date) {
            activeDate = new Date(REFERENCE_YEAR, date.getMonth(), date.getDate());
            updateUrl();
            render();
        }

        function renderWeek() {
            if (!weekStrip) return;

            const start = new Date(activeDate);
            start.setDate(start.getDate() - start.getDay());
            const todayKey = keyForDate(localToday());
            const activeKey = keyForDate(activeDate);
            const buttons = [];

            for (let index = 0; index < 7; index += 1) {
                const date = new Date(start);
                date.setDate(start.getDate() + index);
                const matching = entriesForDate(entries, date);
                const historyCount = matching.filter(entry => entry.kind !== "birthday").length;
                const birthdayCount = matching.length - historyCount;
                const dateKey = keyForDate(date);

                const button = element("button", "otd-day-pill");
                button.type = "button";
                button.dataset.date = dateKey;
                button.classList.toggle("is-active", dateKey === activeKey);
                button.classList.toggle("is-today", dateKey === todayKey);
                button.setAttribute("aria-pressed", String(dateKey === activeKey));
                if (dateKey === todayKey) button.setAttribute("aria-current", "date");
                button.setAttribute(
                    "aria-label",
                    `${displayDate(date, true)}: ${historyCount} history ${historyCount === 1 ? "entry" : "entries"}, ${birthdayCount} ${birthdayCount === 1 ? "birthday" : "birthdays"}`
                );

                button.append(
                    element("span", "otd-day-pill-weekday", weekdayLabel(date)),
                    element("span", "otd-day-pill-date", String(date.getDate()))
                );

                const summary = element("span", "otd-day-pill-summary");
                summary.append(element("span", "otd-day-pill-total", String(matching.length)));
                const types = [];
                if (historyCount) types.push(`${historyCount}H`);
                if (birthdayCount) types.push(`${birthdayCount}B`);
                summary.append(element("span", "otd-day-pill-types", types.join(" · ") || "—"));
                button.append(summary);

                button.addEventListener("click", () => setActiveDate(date));
                buttons.push(button);
            }

            weekStrip.replaceChildren(...buttons);
        }

        function render() {
            const matching = entriesForDate(entries, activeDate);
            dateDisplay.textContent = displayDate(activeDate, true);
            dateDisplay.setAttribute("datetime", keyForDate(activeDate));

            if (dateInput) {
                dateInput.value = `${REFERENCE_YEAR}-${keyForDate(activeDate)}`;
            }

            if (count) {
                count.textContent = matching.length
                    ? `${matching.length} ${matching.length === 1 ? "entry" : "entries"}`
                    : "No entries yet";
            }

            renderWeek();

            if (!matching.length) {
                const empty = element("div", "otd-empty");
                empty.append(
                    element("strong", "", "Nothing logged for this date yet."),
                    element("span", "", "Use the week rail or calendar to keep browsing.")
                );
                list.replaceChildren(empty);
                return;
            }

            const items = matching.map((entry, index) => {
                const item = element("article", `otd-entry otd-entry--${entry.kind || "note"}${index === 0 ? " otd-entry--lead" : ""}`);
                const year = element("div", "otd-entry-year", entryYear(entry));
                const body = element("div", "otd-entry-body");
                const meta = element("div", "otd-entry-meta");
                meta.append(
                    element("span", `otd-kind otd-kind--${entry.kind || "note"}`, kindLabel(entry.kind))
                );
                if (entry.promotion) meta.append(element("span", "otd-promotion", entry.promotion));

                const age = ageLabel(entry);
                if (age) meta.append(element("span", "otd-age", age));

                const title = element("h2", "otd-entry-title", entry.title);
                body.append(meta, title);

                if (entry.detail) body.append(element("p", "otd-entry-detail", entry.detail));
                if (entry.sourceUrl) {
                    body.append(externalLink(entry.sourceUrl, "otd-entry-source", `${entry.source || "Source"} ↗`));
                }

                item.append(year, mediaBlock(entry, false, index === 0), body);
                return item;
            });

            list.replaceChildren(...items);
        }

        function shiftDay(amount) {
            const nextDate = new Date(activeDate);
            nextDate.setDate(nextDate.getDate() + amount);
            setActiveDate(nextDate);
        }

        previous?.addEventListener("click", () => shiftDay(-1));
        next?.addEventListener("click", () => shiftDay(1));
        todayButton?.addEventListener("click", () => setActiveDate(localToday()));
        dateInput?.addEventListener("change", () => {
            const selected = new Date(`${dateInput.value}T12:00:00`);
            if (Number.isNaN(selected.getTime())) return;
            setActiveDate(selected);
        });

        render();
    }

    async function loadWidget(widget) {
        const url = widget.dataset.historyUrl;
        if (!url) return;

        try {
            const response = await fetch(url, { cache: "no-store" });
            if (!response.ok) throw new Error(`History request failed: ${response.status}`);
            const data = await response.json();
            const entries = Array.isArray(data?.entries) ? data.entries : [];

            if (widget.dataset.mode === "compact") renderCompact(widget, entries);
            else renderFull(widget, entries);
        } catch {
            if (widget.dataset.mode === "compact") {
                widget.hidden = true;
                return;
            }

            const list = widget.querySelector("[data-otd-list]");
            if (list) {
                list.replaceChildren(element("p", "otd-empty", "History archive unavailable right now."));
            }
        }
    }

    widgets.forEach(loadWidget);
})();
