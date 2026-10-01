(() => {
  const app = document.querySelector('[data-mfc-control]');
  const panel = app?.querySelector('[data-workspace-panel="news"]');
  if (!panel) return;
  const list = panel.querySelector('[data-news-list]');
  const status = panel.querySelector('[data-news-status]');
  const search = panel.querySelector('[data-news-search]');
  const kind = panel.querySelector('[data-news-kind]');
  const source = panel.querySelector('[data-news-source]');
  const unused = panel.querySelector('[data-news-unused]');
  const refresh = panel.querySelector('[data-news-refresh]');
  const more = panel.querySelector('[data-news-more]');
  const dialog = app.querySelector('[data-news-preview]');
  const liveBase = 'https://raw.githubusercontent.com/MatlockFT/Matlock/live-news-data/';
  const feeds = [
    { name: 'Articles', key: 'articles', kind: 'article', file: 'mma-news.json', fallback: true, items: data => [data.topStory, ...(data.stories || [])].filter(Boolean) },
    { name: 'Japanese MMA', key: 'japan', kind: 'article', file: 'japan-mma-news.json', fallback: false, items: data => data.stories || [] },
    { name: 'Videos', key: 'videos', kind: 'video', file: 'broadcast-news-videos.json', fallback: true, items: data => data.videos || [] }
  ];
  let entries = [], loaded = false, loading = false, limit = 24, lastRefresh = 0;
  const safeUrl = value => {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
  };
  const validVideo = item => /^[A-Za-z0-9_-]{11}$/.test(item.id || '') && Number(item.duration) > 180
    && Number(item.duration) <= 86400 && !/\/shorts\/|#shorts\b/i.test((item.url || '') + ' ' + (item.title || ''))
    && item.url === 'https://www.youtube.com/watch?v=' + item.id;
  function draft() { return window.matlockBroadcastNews?.snapshot() || { program: [], ticker: [] }; }
  function used(item, target) {
    const snapshot = draft();
    return target === 'ticker' ? snapshot.ticker.includes(item.title + ' — ' + item.source)
      : snapshot.program.some(row => row.sourceUrl === item.url || row.mediaUrl === item.url);
  }
  function button(label, click, disabled = false) {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'mfc-button mfc-button-small';
    node.textContent = label; node.disabled = disabled; node.addEventListener('click', click); return node;
  }
  function preview(item) {
    dialog.querySelector('[data-news-preview-title]').textContent = item.title;
    const iframe = document.createElement('iframe');
    iframe.title = item.title; iframe.allow = 'autoplay; encrypted-media; fullscreen; picture-in-picture'; iframe.allowFullscreen = true;
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    iframe.src = 'https://www.youtube-nocookie.com/embed/' + item.id + '?playsinline=1&rel=0';
    dialog.querySelector('[data-news-preview-body]').replaceChildren(iframe); dialog.showModal();
  }
  function render() {
    const query = search.value.trim().toLowerCase();
    const filtered = entries.filter(item => (kind.value === 'all' || item.kind === kind.value)
      && (!source.value || item.source === source.value)
      && (!query || (item.title + ' ' + (item.originalTitle || '') + ' ' + item.source + ' ' + (item.excerpt || '') + ' ' + (item.originalExcerpt || '')).toLowerCase().includes(query))
      && (!unused.checked || !used(item, 'program')));
    list.replaceChildren();
    panel.querySelector('[data-news-results]').textContent = filtered.length + ' matching items';
    app.querySelector('[data-workspace-count="news"]').textContent = String(entries.length);
    for (const item of filtered.slice(0, limit)) {
      const card = document.createElement('article'); card.className = 'mfc-news-card'; card.dataset.newsId = item.id;
      const thumb = safeUrl(item.kind === 'video' ? item.thumbnail : item.image);
      if (thumb) {
        const img = document.createElement('img'); img.src = thumb; img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
        img.addEventListener('error', () => img.remove()); card.append(img);
      }
      const content = document.createElement('div'); content.className = 'mfc-news-card-content';
      const meta = document.createElement('p'); meta.className = 'mfc-news-meta';
      const stamp = Date.parse(item.publishedAt);
      const date = Number.isFinite(stamp) ? new Date(stamp).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : item.publishedText || 'Date unavailable';
      const japanLabel = item.language === 'ja'
        ? 'JP · ' + (item.translation?.mode === 'literal-machine' ? 'literal MT · ' : 'original · ')
        : '';
      meta.textContent = japanLabel + (item.kind === 'video' ? 'YouTube · ' + Math.floor(item.duration / 60) + ':' + String(item.duration % 60).padStart(2, '0') + ' · ' : 'Article · ')
        + item.source + ' · ' + date + (item.publishedAtEstimated ? ' (approx.)' : '') + (item.cached ? ' · cached' : '');
      const heading = document.createElement('h3'); heading.textContent = item.title;
      content.append(meta, heading);
      if (item.language === 'ja' && item.originalTitle && item.originalTitle !== item.title) {
        const original = document.createElement('p');
        original.className = 'mfc-news-original';
        original.lang = 'ja';
        original.textContent = item.originalTitle;
        content.append(original);
      }
      if (item.excerpt && item.kind === 'article') { const p = document.createElement('p'); p.textContent = item.excerpt.slice(0, 220); content.append(p); }
      const actions = document.createElement('div'); actions.className = 'mfc-news-actions';
      const inDraft = used(item, 'program');
      actions.append(button(inDraft ? 'In draft' : item.kind === 'video' ? 'Add video' : 'Add headline', () => {
        if (window.matlockBroadcastNews?.add(item, 'program')) render();
      }, inDraft));
      if (item.kind === 'article') actions.append(button(used(item, 'ticker') ? 'In ticker' : 'Add to ticker', () => {
        if (window.matlockBroadcastNews?.add(item, 'ticker')) render();
      }, used(item, 'ticker')));
      else actions.append(button('Preview video', () => preview(item)));
      const link = document.createElement('a'); link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      link.textContent = item.kind === 'video' ? 'Watch on YouTube ↗' : 'Read article ↗'; actions.append(link);
      content.append(actions); card.append(content); list.append(card);
    }
    if (loaded && !filtered.length) { const empty = document.createElement('p'); empty.className = 'mfc-empty'; empty.textContent = entries.length ? 'No matches. Try another search or source.' : 'No news available. Try Refresh shortly.'; list.append(empty); }
    more.hidden = filtered.length <= limit; more.textContent = 'Show more (' + Math.max(0, filtered.length - limit) + ')';
  }
  async function fetchJson(url) {
    const response = await fetch(url + '?t=' + Date.now(), { cache: 'no-store', signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json(); if (!data.generatedAt || data.version !== 1) throw new Error('Invalid snapshot'); return data;
  }
  async function load() {
    if (loading) return;
    loading = true; refresh.disabled = true; status.textContent = 'Refreshing articles, Japanese MMA and YouTube videos…';
    const results = await Promise.allSettled(feeds.map(async feed => {
      let data, fallback = false;
      try {
        data = await fetchJson(liveBase + feed.file);
      } catch (error) {
        if (!feed.fallback) throw error;
        data = await fetchJson('/assets/data/' + feed.file);
        fallback = true;
      }
      const age = Date.now() - Date.parse(data.generatedAt);
      const rows = feed.items(data).filter(item => item.title && safeUrl(item.url) && (feed.kind !== 'video' || validVideo(item)));
      return { feed, data, fallback, age, rows };
    }));
    const notices = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const { feed, data, fallback, age, rows } = result.value;
        entries = entries.filter(item => item.pool !== feed.key);
        entries.push(...rows.map(item => ({ ...item, pool: feed.key, kind: feed.kind, source: String(item.source || 'MMA news') })));
        notices.push(feed.name + ': ' + rows.length + ' · updated ' + new Date(data.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
          + (fallback ? ' · saved fallback' : '') + (age > 3600000 ? ' · older snapshot' : ''));
        const unavailable = (data.sources || []).filter(source => source.status === 'unavailable' || source.status === 'cached');
        if (unavailable.length) notices.push('Some sources could not refresh: ' + unavailable.map(source => source.name).join(', '));
      } else notices.push(feeds[index].name + ' unavailable. Keeping previously loaded items; try Refresh.');
    });
    entries = [...new Map(entries.map(item => [item.url, item])).values()];
    entries.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
    const selectedSource = source.value;
    source.replaceChildren(new Option('All sources', ''));
    [...new Set(entries.map(item => item.source))].sort().forEach(value => source.add(new Option(value, value)));
    if ([...source.options].some(option => option.value === selectedSource)) source.value = selectedSource;
    loaded = true; loading = false; lastRefresh = Date.now(); refresh.disabled = false; status.textContent = notices.join(' • '); render();
  }
  [search, kind, source, unused].forEach(input => input.addEventListener('input', () => { limit = 24; render(); }));
  refresh.addEventListener('click', load); more.addEventListener('click', () => { limit += 24; render(); });
  dialog.addEventListener('close', () => dialog.querySelector('[data-news-preview-body]').replaceChildren());
  dialog.querySelector('[data-news-preview-close]').addEventListener('click', () => dialog.close());
  app.addEventListener('matlock-broadcast-draft-change', () => { if (!panel.hidden) render(); });
  new MutationObserver(() => { if (!panel.hidden) { if (!loaded || Date.now() - lastRefresh > 300000) load(); else render(); } }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  setInterval(() => { if (!panel.hidden && !document.hidden && Date.now() - lastRefresh > 300000) load(); }, 30000);
  if (!panel.hidden) load();
})();
