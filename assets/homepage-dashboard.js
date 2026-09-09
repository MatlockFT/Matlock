(() => {
    const root = document.querySelector('[data-home-dashboard]');
    if (!root) return;

    const newsList = root.querySelector('[data-home-news-list]');
    const otdBody = root.querySelector('[data-home-otd-body]');
    const rosterBody = root.querySelector('[data-home-roster-body]');

    const liveNewsUrl = root.dataset.newsUrl;
    const fallbackNewsUrl = root.dataset.newsFallbackUrl;
    const historyUrl = root.dataset.historyUrl;
    const rosterUrl = root.dataset.rosterUrl;

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
            .slice(0, 4);
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

    function renderOnThisDay(entry, key) {
        if (!otdBody) return;
        otdBody.replaceChildren();
        if (!entry) {
            otdBody.append(sectionLink('History →', '/on-this-day/'));
            return;
        }

        const year = String(entry.date || '').slice(0, 4);
        const label = element('span', 'home-otd-year', year || 'On this day');
        const title = element('h3', 'home-otd-title', entry.title || 'MMA history');
        otdBody.append(label, title);
        const detail = entry.detail || entry.description || '';
        if (detail) otdBody.append(element('p', 'home-otd-copy', detail));
        otdBody.append(sectionLink('History →', `/on-this-day/?date=${encodeURIComponent(key || String(entry.date || '').slice(5))}`));
    }

    async function loadOnThisDay() {
        if (!otdBody || !historyUrl) return;
        try {
            const data = await fetchJson(historyUrl, 'force-cache');
            if (data?.entry !== undefined) {
                renderOnThisDay(data.entry, data.key);
                return;
            }
            const entries = Array.isArray(data) ? data : Array.isArray(data?.entries) ? data.entries : [];
            const now = new Date();
            const key = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const todays = entries
                .filter(entry => String(entry?.date || '').slice(5) === key)
                .sort((a, b) => Number(b?.weight || 0) - Number(a?.weight || 0));
            renderOnThisDay(todays[0], key);
        } catch {
            renderOnThisDay(null, '');
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
        runWhenIdle(loadOnThisDay, 280, 1000);
        runWhenIdle(loadRoster, 480, 1200);
    };

    if (document.readyState === 'complete') startDeferredLoads();
    else window.addEventListener('load', startDeferredLoads, { once: true });
})();
