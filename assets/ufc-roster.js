(() => {
    const page = document.querySelector("[data-ufc-roster]");
    if (!page) return;

    const list = page.querySelector("[data-roster-list]");
    const removalsList = page.querySelector("[data-roster-removals]");
    const removalsSection = page.querySelector("[data-roster-removals-section]");
    const status = page.querySelector("[data-roster-status]");
    const liveStatus = page.querySelector("[data-roster-live-status]");
    const activeCount = page.querySelector("[data-roster-active-count]");
    const addCount = page.querySelector("[data-roster-add-count]");
    const removeCount = page.querySelector("[data-roster-remove-count]");
    const feedUrl = page.dataset.feedUrl;
    const backfillUrl = page.dataset.backfillUrl;
    const refreshInterval = Number(page.dataset.refreshInterval) || 300000;

    const GENERIC_FIGHTER_NAMES = new Set([
        "search results", "search", "athletes", "all athletes", "ufc",
        "page not found", "not found", "access denied", "error"
    ]);

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function formatDate(value, includeYear = true) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Unknown";
        return date.toLocaleDateString([], {
            month: "short",
            day: "numeric",
            ...(includeYear ? { year: "numeric" } : {})
        });
    }

    function formatCheckedAt(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Checked recently";
        const now = new Date();
        const sameDay = date.toDateString() === now.toDateString();
        return sameDay
            ? `Checked ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
            : `Checked ${formatDate(value, false)}`;
    }

    function setLiveState(state, text) {
        if (liveStatus) liveStatus.dataset.state = state;
        if (status) status.textContent = text;
    }

    function fighterSlug(fighter) {
        if (fighter?.slug) return String(fighter.slug);
        try {
            return new URL(fighter?.url || "", window.location.href)
                .pathname.split("/").filter(Boolean).at(-1) || "";
        } catch {
            return "";
        }
    }

    function nameFromSlug(slug) {
        return String(slug || "").split("-").filter(Boolean)
            .map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    }

    function fighterDisplayName(fighter) {
        const candidate = String(fighter?.name || "").replace(/\s+/g, " ").trim();
        if (candidate && !GENERIC_FIGHTER_NAMES.has(candidate.toLowerCase())) return candidate;
        return nameFromSlug(fighterSlug(fighter)) || "Unknown fighter";
    }

    function initials(name) {
        return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2)
            .map(part => part[0]?.toUpperCase() || "").join("") || "?";
    }

    function fighterMedia(fighter) {
        const name = fighterDisplayName(fighter);
        const link = element("a", "ufc-roster-photo", initials(name));
        link.href = fighter.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", `Open ${name} on UFC.com`);

        if (fighter.image) {
            const image = document.createElement("img");
            image.src = fighter.image;
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("error", () => image.remove(), { once: true });
            link.append(image);
        }
        return link;
    }

    function fighterCard(fighter, index, eventType = "added") {
        const removed = eventType === "removed";
        const article = element("article", `ufc-roster-card${removed ? " ufc-roster-card--removed" : ""}`);
        const body = element("div", "ufc-roster-card-body");
        const meta = element("div", "ufc-roster-card-meta");
        meta.append(
            element("span", "ufc-roster-rank", String(index + 1).padStart(2, "0")),
            element("span", "ufc-roster-event-pill", removed ? "Departed" : "Added")
        );
        if (fighter.division) meta.append(element("span", "ufc-roster-division", fighter.division));

        const heading = element("h3", "ufc-roster-name");
        const link = element("a", "", fighterDisplayName(fighter));
        link.href = fighter.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        heading.append(link);
        body.append(meta, heading);

        if (fighter.record) body.append(element("p", "ufc-roster-details", fighter.record));

        const dateValue = fighter.initialBackfill
            ? fighter.profilePublishedAt
            : fighter.detectedAt || fighter.confirmedActiveAt;
        const dateLabel = fighter.initialBackfill ? "Profile published" : removed ? "Detected out" : "First detected";
        if (dateValue) body.append(element("p", "ufc-roster-detected", `${dateLabel} · ${formatDate(dateValue)}`));

        if (fighter.status && !removed) {
            body.append(element("span", "ufc-roster-status-pill", fighter.status));
        }

        article.append(fighterMedia(fighter), body);
        return article;
    }

    function combinedAdditions(data, backfill) {
        const live = Array.isArray(data.additions) ? data.additions : [];
        const seen = new Set(live.map(item => item?.url).filter(Boolean));
        const activeBackfillUrls = Array.isArray(data.activeBackfillUrls)
            ? new Set(data.activeBackfillUrls)
            : null;
        const filler = (Array.isArray(backfill) ? backfill : []).filter(item => {
            if (!item?.url || seen.has(item.url)) return false;
            if (activeBackfillUrls && !activeBackfillUrls.has(item.url)) return false;
            seen.add(item.url);
            return true;
        });
        return [...live, ...filler].slice(0, 10);
    }

    function renderStats(data, additions, removals) {
        if (activeCount) activeCount.textContent = Number.isFinite(Number(data.activeCount))
            ? Number(data.activeCount).toLocaleString()
            : "—";
        if (addCount) addCount.textContent = String(additions.length);
        if (removeCount) removeCount.textContent = String(removals.length);
    }

    function render(data, backfill = []) {
        const additions = combinedAdditions(data, backfill);
        const removals = (Array.isArray(data.removals) ? data.removals : []).slice(0, 6);

        list.replaceChildren();
        list.setAttribute("aria-busy", "false");

        if (!additions.length) {
            list.append(element("div", "ufc-roster-empty", "No recent active-roster additions detected."));
        } else {
            additions.forEach((fighter, index) => list.append(fighterCard(fighter, index, "added")));
        }

        if (removalsList && removalsSection) {
            removalsList.replaceChildren(...removals.map((fighter, index) => fighterCard(fighter, index, "removed")));
            removalsSection.hidden = removals.length === 0;
        }

        renderStats(data, additions, removals);
        setLiveState("ready", formatCheckedAt(data.generatedAt));
    }

    async function loadBackfill() {
        if (!backfillUrl) return [];
        try {
            const response = await fetch(backfillUrl, { cache: "no-store", headers: { accept: "application/json" } });
            if (!response.ok) return [];
            const data = await response.json();
            return Array.isArray(data.fighters) ? data.fighters : [];
        } catch {
            return [];
        }
    }

    async function refresh() {
        setLiveState("loading", "Checking roster…");
        try {
            const url = new URL(feedUrl);
            url.searchParams.set("update", String(Math.floor(Date.now() / refreshInterval)));
            const response = await fetch(url, {
                cache: "no-store",
                headers: { accept: "application/vnd.github+json" }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const release = await response.json();
            const data = JSON.parse(release.body || "{}");
            if (!data.generatedAt || !Array.isArray(data.additions)) throw new Error("Roster data is incomplete");
            const backfill = data.additions.length < 10 ? await loadBackfill() : [];
            render(data, backfill);
        } catch {
            list.setAttribute("aria-busy", "false");
            list.replaceChildren(element("div", "ufc-roster-empty", "Roster data is temporarily unavailable."));
            setLiveState("error", "Tracker unavailable");
        }
    }

    refresh();
    window.setInterval(refresh, refreshInterval);
})();
