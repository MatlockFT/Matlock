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

    const fetchJson = async url => {
        if (!url) throw new Error('Missing URL');
        return safeJson(await fetch(url, { cache: 'no-store' }));
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

    function renderNews(data) {
        if (!newsList) return;
        const stories = newsStories(data);
        newsList.replaceChildren();

        if (!stories.length) {
            newsList.append(element('p', 'home-dashboard-loading', 'Latest headlines are available on the News page.'));
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

    const historyEntries = data => {
        if (Array.isArray(data)) return data;
        if (Array.isArray(data?.entries)) return data.entries;
        if (Array.isArray(data?.history)) return data.history;
        return [];
    };

    const kindBonus = new Map([
        ['title', 12], ['fight', 10], ['incident', 8], ['debut', 7],
        ['signing', 6], ['death', 5], ['news', 4], ['birthday', 2], ['event', 0]
    ]);

    const historyScore = entry => Number(entry?.weight || 0) + (kindBonus.get(entry?.kind) || 0);

    function renderOnThisDay(entry) {
        if (!otdBody) return;
        otdBody.replaceChildren();
        if (!entry) {
            otdBody.append(element('p', 'home-dashboard-loading', 'Browse the MMA history archive by date.'));
            return;
        }

        const year = String(entry.date || '').slice(0, 4);
        const label = element('span', 'home-otd-year', year || 'On this day');
        const title = element('h3', 'home-otd-title', entry.title || 'MMA history');
        otdBody.append(label, title);
        if (entry.description) otdBody.append(element('p', 'home-otd-copy', entry.description));
        const link = element('a', 'home-side-link', 'Open the day →');
        const now = new Date();
        const key = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        link.href = `/on-this-day/?date=${key}`;
        otdBody.append(link);
    }

    async function loadOnThisDay() {
        if (!otdBody || !historyUrl) return;
        try {
            const entries = historyEntries(await fetchJson(historyUrl));
            const now = new Date();
            const key = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const todays = entries
                .filter(entry => String(entry?.date || '').slice(5) === key)
                .sort((a, b) => historyScore(b) - historyScore(a));
            renderOnThisDay(todays[0]);
        } catch {
            renderOnThisDay(null);
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
        if (!addition) {
            rosterBody.append(element('p', 'home-dashboard-loading', 'The UFC roster tracker is active.'));
        } else {
            rosterBody.append(
                element('span', 'home-roster-label', 'Recent roster addition'),
                element('h3', 'home-roster-name', fighterName(addition))
            );
            const details = [addition.division, addition.record].filter(Boolean).join(' · ');
            if (details) rosterBody.append(element('p', 'home-roster-meta', details));
        }
        const link = element('a', 'home-side-link', 'Open roster tracker →');
        link.href = '/ufc-roster/';
        rosterBody.append(link);
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

    loadNews();
    loadOnThisDay();
    loadRoster();
})();
