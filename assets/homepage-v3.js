(() => {
  const root = document.querySelector('[data-globe-home]');
  if (!root) return;

  const newsList = root.querySelector('[data-v3-news-list]');
  const historyBox = root.querySelector('[data-v3-history]');
  const rosterBox = root.querySelector('[data-v3-roster]');

  const liveNewsUrl = root.dataset.newsUrl;
  const fallbackNewsUrl = root.dataset.newsFallbackUrl;
  const historyUrl = root.dataset.historyUrl;
  const historyRuntimeBase = root.dataset.historyRuntimeBase;
  const rosterUrl = root.dataset.rosterUrl;
  const historyTimeZone = 'America/Chicago';

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const fetchJson = async (url, cache = 'no-store') => {
    const response = await fetch(url, { cache });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  const relativeTime = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const diff = Math.max(0, Date.now() - date.getTime());
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${Math.max(1, minutes)}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
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
      .slice(0, 6);
  };

  const renderNews = data => {
    if (!newsList) return;
    const stories = newsStories(data);
    newsList.replaceChildren();

    if (!stories.length) {
      newsList.append(el('p', 'v3-loading', 'Latest MMA news is temporarily unavailable.'));
      return;
    }

    for (const story of stories) {
      const article = el('article', 'v3-news-item');
      const link = el('a', '', story.title);
      link.href = story.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      const meta = el(
        'span',
        'v3-news-meta',
        [story.source || 'Source', relativeTime(story.publishedAt)].filter(Boolean).join(' · ')
      );

      article.append(link, meta);
      newsList.append(article);
    }
  };

  const loadNews = async () => {
    for (const url of [liveNewsUrl, fallbackNewsUrl].filter(Boolean)) {
      try {
        renderNews(await fetchJson(url));
        return;
      } catch {}
    }
    renderNews({ stories: [] });
  };

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
      return Number(Boolean(b?.imageUrl)) - Number(Boolean(a?.imageUrl));
    })[0] || null;
  };

  const renderHistory = (entry, key) => {
    if (!historyBox) return;
    historyBox.replaceChildren();

    if (!entry) {
      historyBox.append(el('p', 'v3-loading', 'No featured history entry for today.'));
      return;
    }

    const card = el('article', 'v3-history-card');
    const historyHref = `/on-this-day/?date=${encodeURIComponent(
      key || String(entry.date || '').slice(5)
    )}`;

    if (/^https:\/\//i.test(String(entry.imageUrl || ''))) {
      const imageLink = el('a', 'v3-history-image');
      imageLink.href = historyHref;
      const image = document.createElement('img');
      image.src = entry.imageUrl;
      image.alt = entry.imageAlt || entry.title || 'MMA history image';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.referrerPolicy = 'no-referrer';
      image.addEventListener('error', () => imageLink.remove(), { once: true });
      imageLink.append(image);
      card.append(imageLink);
    }

    const year = String(entry.date || '').slice(0, 4);
    card.append(el('span', 'v3-history-year', year || 'On this day'));
    card.append(el('h4', 'v3-history-title', entry.title || 'MMA history'));

    const detail = entry.detail || entry.description || '';
    if (detail) card.append(el('p', 'v3-history-copy', detail));

    const link = el('a', 'v3-history-link', 'Open history →');
    link.href = historyHref;
    card.append(link);
    historyBox.append(card);
  };

  const loadHistory = async () => {
    if (!historyBox || !historyUrl) return;
    const key = currentHistoryKey();

    try {
      const snapshot = await fetchJson(historyUrl);
      if (snapshot?.entry !== undefined && snapshot?.key === key) {
        renderHistory(snapshot.entry, key);
        return;
      }
    } catch {}

    try {
      const month = key.slice(0, 2);
      const runtimeUrl = historyRuntimeBase ? `${historyRuntimeBase}${month}.json` : '';
      const data = await fetchJson(runtimeUrl);
      const entries = Array.isArray(data)
        ? data
        : Array.isArray(data?.entries)
          ? data.entries
          : [];
      renderHistory(latestHistoryEntry(entries, key), key);
    } catch {
      renderHistory(null, key);
    }
  };

  const fighterName = fighter => {
    const name = String(fighter?.name || '').replace(/\s+/g, ' ').trim();
    if (
      name &&
      !/^(search results|search|athletes|all athletes|ufc|page not found|not found)$/i.test(name)
    ) {
      return name;
    }

    const slug = String(fighter?.slug || fighter?.url || '')
      .split('/')
      .filter(Boolean)
      .at(-1) || '';

    return slug
      .split('-')
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ') || 'Recent addition';
  };

  const renderRoster = data => {
    if (!rosterBox) return;
    rosterBox.replaceChildren();

    const addition = Array.isArray(data?.additions) ? data.additions[0] : null;
    const removal = Array.isArray(data?.removals) ? data.removals[0] : null;
    const fighter = addition || removal;

    if (!fighter) {
      rosterBox.append(el('p', 'v3-loading', 'No recent roster movement available.'));
      return;
    }

    const card = el('article', 'v3-roster-card');
    card.append(el('span', 'v3-roster-label', addition ? 'Recent addition' : 'Recent removal'));
    card.append(el('h4', 'v3-roster-name', fighterName(fighter)));

    const details = [fighter.division, fighter.record].filter(Boolean).join(' · ');
    if (details) card.append(el('p', 'v3-roster-meta', details));

    const link = el('a', 'v3-roster-link', 'Open roster →');
    link.href = '/ufc-roster/';
    card.append(link);
    rosterBox.append(card);
  };

  const loadRoster = async () => {
    if (!rosterBox || !rosterUrl) return;
    try {
      const release = await fetchJson(rosterUrl);
      const data = JSON.parse(release?.body || '{}');
      renderRoster(data);
    } catch {
      renderRoster({});
    }
  };

  const start = () => {
    loadNews();
    window.setTimeout(loadHistory, 100);
    window.setTimeout(loadRoster, 200);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
