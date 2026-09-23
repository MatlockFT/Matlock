(() => {
  const root = document.querySelector('[data-globe-home]');
  if (!root) return;

  const newsList = root.querySelector('[data-v3-news-list]');
  const trendingRail = root.querySelector('[data-v3-trending]');
  const historyBox = root.querySelector('[data-v3-history]');

  const setupStickyShell = () => {
    const header = document.querySelector('.site-header');
    const navigation = document.querySelector('.site-navigation');
    if (!header || !navigation || document.querySelector('[data-v3-sticky-shell]')) return;

    const shell = el('div', 'v3-sticky-shell');
    shell.dataset.v3StickyShell = '';
    header.insertAdjacentElement('beforebegin', shell);
    shell.append(navigation);

    header.querySelector('.site-live-strip-reserve')?.remove();

    const syncRailHeight = () => {
      // Keep the deferred ticker row reserved until it mounts.
      const height = Math.max(80, Math.ceil(shell.getBoundingClientRect().height));
      document.documentElement.style.setProperty('--v3-fixed-rail-height', `${height}px`);
    };

    const adoptTicker = () => {
      const ticker = document.querySelector('.site-live-strip');
      if (ticker && ticker.parentElement !== shell) shell.prepend(ticker);
      syncRailHeight();
    };

    const observer = new MutationObserver(adoptTicker);
    observer.observe(document.body, { childList: true, subtree: true });

    const sizeObserver = new ResizeObserver(syncRailHeight);
    sizeObserver.observe(shell);

    window.addEventListener('resize', syncRailHeight, { passive: true });
    adoptTicker();
    requestAnimationFrame(syncRailHeight);
  };

  const setupThemeTransition = () => {
    const toggle = document.querySelector('[data-theme-toggle]');
    if (!toggle) return;

    let cleanupTimer = 0;
    toggle.addEventListener('click', () => {
      const html = document.documentElement;
      html.classList.add('v3-theme-transitioning');
      window.clearTimeout(cleanupTimer);
      cleanupTimer = window.setTimeout(() => {
        html.classList.remove('v3-theme-transitioning');
      }, 420);
    }, { capture: true });
  };

  const liveNewsUrl = root.dataset.newsUrl;
  const fallbackNewsUrl = root.dataset.newsFallbackUrl;
  const historyUrl = root.dataset.historyUrl;
  const historyRuntimeBase = root.dataset.historyRuntimeBase;
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

  const renderTrending = stories => {
    if (!trendingRail) return;
    trendingRail.replaceChildren();

    const items = stories.slice(0, 5);
    items.forEach((story, index) => {
      const link = el('a', '', story.title);
      link.href = story.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.title = story.title;
      link.textContent = story.title;
      trendingRail.append(link);
      if (index < items.length - 1) {
        trendingRail.append(el('span', 'v3-trending-separator', '•'));
      }
    });
  };

  const renderNews = data => {
    if (!newsList) return;
    const stories = newsStories(data);
    renderTrending(stories);
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

    const card = el('article', 'v3-history-feature-card');
    const historyHref = `/on-this-day/?date=${encodeURIComponent(
      key || String(entry.date || '').slice(5)
    )}`;

    const imageLink = el('a', 'v3-history-feature-image');\n    imageLink.href = historyHref;\n\n    const renderHistoryPlaceholder = () => {\n      imageLink.classList.add('v3-history-feature-image--fallback');\n      imageLink.replaceChildren(\n        el('span', 'v3-history-feature-fallback', (entry.promotion || 'MMA') + ' / HISTORY')\n      );\n    };\n\n    if (/^https:\/\//i.test(String(entry.imageUrl || ''))) {\n      const image = document.createElement('img');\n      image.src = entry.imageUrl;\n      image.alt = entry.imageAlt || entry.title || 'MMA history image';\n      image.loading = 'lazy';\n      image.decoding = 'async';\n      image.referrerPolicy = 'no-referrer';\n      image.addEventListener('error', renderHistoryPlaceholder, { once: true });\n      imageLink.append(image);\n    } else {\n      renderHistoryPlaceholder();\n    }\n    card.append(imageLink);\n\n    const copy = el('div', 'v3-history-feature-copy');
    const year = String(entry.date || '').slice(0, 4);
    copy.append(el('span', 'v3-history-feature-year', year || 'On this day'));
    copy.append(el('h3', 'v3-history-feature-title', entry.title || 'MMA history'));

    const detail = entry.detail || entry.description || '';
    if (detail) copy.append(el('p', 'v3-history-feature-text', detail));

    const link = el('a', 'v3-history-feature-link', 'Open the archive →');
    link.href = historyHref;
    copy.append(link);
    card.append(copy);
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


  const start = () => {
    setupStickyShell();
    setupThemeTransition();
    loadNews();
    window.setTimeout(loadHistory, 100);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
