(() => {
    const root = document.querySelector('[data-home-dashboard]');
    if (!root) return;

    const newsList = root.querySelector('[data-home-news-list]');
    const otdBody = root.querySelector('[data-home-otd-body]');
    const rosterBody = root.querySelector('[data-home-roster-body]');

    const liveNewsUrl = root.dataset.newsUrl;
    const fallbackNewsUrl = root.dataset.newsFallbackUrl;
    const historyUrl = root.dataset.historyUrl;
    const historyRuntimeBase = root.dataset.historyRuntimeBase;
    const rosterUrl = root.dataset.rosterUrl;
    const historyTimeZone = 'America/Chicago';

    const element = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    const safeJson = async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    };

    const fetchJson = async (url, cache = 'no-store') => {
        if (!url) throw new Error('Missing URL');
        return safeJson(await fetch(url, { cache }));
    };

    const formatSource = story => story?.source || 'Source';

    const relativeTime = value => {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        const diff = Date.now() - date.getTime();
        const minutes = Math.max(0, Math.floor(diff / 60000));
        if (minutes < 60) return `${Math.max(1, minutes)}m`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h`;
        return `${Math.floor(hours / 24)}d`;
    };

    const newsStories = data => {
        const seen = new Set();
        return [data?.topStory, ...(data?.stories || [])]
            .filter(story => story?.title && story?.url)
            .filter(story => {
                const key = story.id || story.url;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            })
            .slice(0, 3);
    };

    const sectionLink = (label, href) => {
        const link = element('a', 'home-side-link', label);
        link.href = href;
        return link;
    };

    function renderNews(data) {
        if (!newsList) return;
        const stories = newsStories(data);
        newsList.replaceChildren();

        if (!stories.length) {
            newsList.append(sectionLink('News →', '/news/'));
            return;
        }

        for (const story of stories) {
            const row = element('article', 'home-news-item');
            const link = element('a', '', story.title);
            link.href = story.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const meta = element('span', '', [formatSource(story), relativeTime(story.publishedAt)].filter(Boolean).join(' · '));
            row.append(link, meta);
            newsList.append(row);
        }
    }

    async function loadNews() {
        if (!newsList) return;
        for (const url of [liveNewsUrl, fallbackNewsUrl].filter(Boolean)) {
            try {
                renderNews(await fetchJson(url));
                return;
            } catch {}
        }
        renderNews({ stories: [] });
    }

    const currentHistoryKey = () => {
        const parts = Object.fromEntries(
            new Intl.DateTimeFormat('en-US', {
                timeZone: historyTimeZone,
                month: '2-digit',
                day: '2-digit'
            })
                .formatToParts(new Date())
                .filter(part => part.type !== 'literal')
                .map(part => [part.type, part.value])
        );
        return `${parts.month}-${parts.day}`;
    };

    const latestHistoryEntry = (entries, key) => {
        const todays = entries.filter(entry => String(entry?.date || '').slice(5) === key);
        const events = todays.filter(entry => entry?.kind === 'event');
        const candidates = events.length ? events : todays;
        return candidates.sort((a, b) => {
            const dateOrder = String(b?.date || '').localeCompare(String(a?.date || ''));
            if (dateOrder) return dateOrder;
            const imageOrder = Number(Boolean(b?.imageUrl)) - Number(Boolean(a?.imageUrl));
            if (imageOrder) return imageOrder;
            return Number(b?.weight || 0) - Number(a?.weight || 0);
        })[0] || null;
    };

    function renderOnThisDay(entry, key) {
        if (!otdBody) return;
        otdBody.replaceChildren();
        if (!entry) {
            otdBody.append(sectionLink('History →', '/on-this-day/'));
            return;
        }

        const historyHref = `/on-this-day/?date=${encodeURIComponent(key || String(entry.date || '').slice(5))}`;
        if (/^https:\/\//i.test(String(entry.imageUrl || ''))) {
            const imageLink = element('a', 'home-otd-image');
            imageLink.href = historyHref;
            imageLink.setAttribute('aria-label', `Open ${entry.title || 'this MMA history entry'}`);
            const image = document.createElement('img');
            image.src = entry.imageUrl;
            image.alt = entry.imageAlt || entry.title || 'MMA history image';
            image.loading = 'lazy';
            image.decoding = 'async';
            image.referrerPolicy = 'no-referrer';
            image.addEventListener('error', () => imageLink.remove(), { once: true });
            imageLink.append(image);
            otdBody.append(imageLink);
        }

        const copy = element('div', 'home-otd-copyblock');
        const year = String(entry.date || '').slice(0, 4);
        const label = element('span', 'home-otd-year', year || 'On this day');
        const title = element('h3', 'home-otd-title', entry.title || 'MMA history');
        copy.append(label, title);
        const detail = entry.detail || entry.description || '';
        if (detail) copy.append(element('p', 'home-otd-copy', detail));
        copy.append(sectionLink('History →', historyHref));
        otdBody.append(copy);
    }

    async function loadOnThisDay() {
        if (!otdBody || !historyUrl) return;
        const key = currentHistoryKey();

        try {
            const snapshot = await fetchJson(historyUrl, 'no-store');
            if (snapshot?.entry !== undefined && snapshot?.key === key) {
                renderOnThisDay(snapshot.entry, key);
                return;
            }
        } catch {}

        try {
            const month = key.slice(0, 2);
            const runtimeUrl = historyRuntimeBase ? `${historyRuntimeBase}${month}.json` : '';
            const data = await fetchJson(runtimeUrl, 'no-store');
            const entries = Array.isArray(data) ? data : Array.isArray(data?.entries) ? data.entries : [];
            renderOnThisDay(latestHistoryEntry(entries, key), key);
        } catch {
            renderOnThisDay(null, key);
        }
    }

    const fighterName = fighter => {
        const name = String(fighter?.name || '').replace(/\s+/g, ' ').trim();
        if (name && !/^(search results|search|athletes|all athletes|ufc|page not found|not found)$/i.test(name)) return name;
        const slug = String(fighter?.slug || fighter?.url || '')
            .split('/')
            .filter(Boolean)
            .at(-1) || '';
        return slug.split('-').filter(Boolean).map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') || 'Recent addition';
    };

    function renderRoster(data) {
        if (!rosterBody) return;
        rosterBody.replaceChildren();
        const addition = Array.isArray(data?.additions) ? data.additions[0] : null;
        if (addition) {
            rosterBody.append(element('h3', 'home-roster-name', fighterName(addition)));
            const details = [addition.division, addition.record].filter(Boolean).join(' · ');
            if (details) rosterBody.append(element('p', 'home-roster-meta', details));
        }
        rosterBody.append(sectionLink('Roster →', '/ufc-roster/'));
    }

    async function loadRoster() {
        if (!rosterBody || !rosterUrl) return;
        try {
            const release = await fetchJson(rosterUrl);
            const data = JSON.parse(release?.body || '{}');
            renderRoster(data);
        } catch {
            renderRoster({ additions: [] });
        }
    }

    const runWhenIdle = (task, delay, timeout = 900) => {
        window.setTimeout(() => {
            if ('requestIdleCallback' in window) {
                window.requestIdleCallback(() => task(), { timeout });
            } else {
                task();
            }
        }, delay);
    };

    const startDeferredLoads = () => {
        runWhenIdle(loadNews, 0, 650);
        runWhenIdle(loadOnThisDay, 180, 900);
        runWhenIdle(loadRoster, 360, 1100);
    };

    if (document.readyState === 'complete') startDeferredLoads();
    else window.addEventListener('load', startDeferredLoads, { once: true });
})();
