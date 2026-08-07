(() => {
    const page = document.querySelector("[data-ufc-roster]");
    if (!page) return;

    const list = page.querySelector("[data-roster-list]");
    const status = page.querySelector("[data-roster-status]");
    const refreshButton = page.querySelector("[data-roster-refresh]");
    const feedUrl = page.dataset.feedUrl;
    const backfillUrl = page.dataset.backfillUrl;
    const refreshInterval = Number(page.dataset.refreshInterval) || 300000;

    function element(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function formatDate(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Unknown";
        return date.toLocaleString([], {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit"
        });
    }

    function fighterCard(fighter, index) {
        const article = element("article", "ufc-roster-card");
        const rank = element("div", "ufc-roster-rank", String(index + 1).padStart(2, "0"));
        const body = element("div", "ufc-roster-card-body");
        const heading = element("h2", "ufc-roster-name");
        const link = element("a", "", fighter.name || "Unknown fighter");
        link.href = fighter.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        heading.append(link);

        const details = [fighter.division, fighter.record]
            .filter(Boolean)
            .join(" · ");
        if (details) body.append(element("p", "ufc-roster-details", details));

        const dateLabel = fighter.initialBackfill ? "UFC profile published" : "First detected";
        const dateValue = fighter.initialBackfill
            ? fighter.profilePublishedAt
            : fighter.detectedAt;
        const detected = element(
            "p",
            "ufc-roster-detected",
            `${dateLabel}: ${formatDate(dateValue)}`
        );
        body.prepend(heading);
        body.append(detected);

        if (fighter.initialBackfill) {
            body.append(element("span", "ufc-roster-status-pill", "Initial backfill"));
        }

        if (fighter.status) {
            body.append(element("span", "ufc-roster-status-pill", `UFC status: ${fighter.status}`));
        }

        article.append(rank, body);

        if (fighter.image) {
            const imageLink = document.createElement("a");
            imageLink.className = "ufc-roster-photo";
            imageLink.href = fighter.url;
            imageLink.target = "_blank";
            imageLink.rel = "noopener noreferrer";
            const image = document.createElement("img");
            image.src = fighter.image;
            image.alt = "";
            image.loading = "lazy";
            image.decoding = "async";
            image.referrerPolicy = "no-referrer";
            image.addEventListener("error", () => imageLink.remove(), { once: true });
            imageLink.append(image);
            article.append(imageLink);
        }

        return article;
    }

    function combinedAdditions(data, backfill) {
        const live = Array.isArray(data.additions) ? data.additions : [];
        const seen = new Set(live.map(item => item?.url).filter(Boolean));
        const filler = (Array.isArray(backfill) ? backfill : []).filter(item => {
            if (!item?.url || seen.has(item.url)) return false;
            seen.add(item.url);
            return true;
        });
        return [...live, ...filler].slice(0, 10);
    }

    function render(data, backfill = []) {
        const additions = combinedAdditions(data, backfill);
        list.replaceChildren();
        list.setAttribute("aria-busy", "false");

        if (!additions.length) {
            const empty = element(
                "div",
                "ufc-roster-empty",
                "Tracking is active. No new active-roster additions have been detected since this tracker started."
            );
            list.append(empty);
        } else {
            additions.forEach((fighter, index) => list.append(fighterCard(fighter, index)));
        }

        const count = Number(data.activeCount);
        const countText = Number.isFinite(count) && count > 0
            ? ` · ${count.toLocaleString()} active fighters`
            : "";
        status.textContent = `Last checked ${formatDate(data.generatedAt)}${countText}`;
    }

    async function loadBackfill() {
        if (!backfillUrl) return [];
        try {
            const response = await fetch(backfillUrl, {
                cache: "no-store",
                headers: { accept: "application/json" }
            });
            if (!response.ok) return [];
            const data = await response.json();
            return Array.isArray(data.fighters) ? data.fighters : [];
        } catch {
            return [];
        }
    }

    async function refresh() {
        status.textContent = "Checking UFC roster data…";
        if (refreshButton) refreshButton.disabled = true;

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
            if (!data.generatedAt || !Array.isArray(data.additions)) {
                throw new Error("Roster data is incomplete");
            }

            const backfill = data.additions.length < 10 ? await loadBackfill() : [];
            render(data, backfill);
        } catch {
            list.setAttribute("aria-busy", "false");
            list.replaceChildren(
                element(
                    "div",
                    "ufc-roster-empty",
                    "Roster data is not available yet. The tracker may still be creating its first baseline snapshot."
                )
            );
            status.textContent = "Roster tracker unavailable";
        } finally {
            if (refreshButton) refreshButton.disabled = false;
        }
    }

    refreshButton?.addEventListener("click", refresh);
    refresh();
    window.setInterval(refresh, refreshInterval);
})();
