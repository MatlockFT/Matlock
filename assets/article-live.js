(() => {
  const article = document.querySelector('.post-page-v3[data-writer-source-path]');
  const body = document.getElementById('article-content');
  if (!article || !body) return;

  const FEED = 'https://raw.githubusercontent.com/MatlockFT/Matlock/main/assets/uploads/runtime/live-writer.json';
  const sourcePath = String(article.dataset.writerSourcePath || '');
  const pagePath = location.pathname;
  const titleNode = document.getElementById('post-title');
  const descriptionNode = article.querySelector('.post-description');
  const originalTitle = titleNode?.textContent || '';
  const originalDescription = descriptionNode?.textContent || '';
  let lastVersion = -1;
  let timer = 0;
  let stopped = false;
  let liveApplied = false;
  let badge = null;

  function sameArticle(live) {
    if (!live) return false;
    return live.sourcePath === sourcePath || live.publicPath === pagePath;
  }

  function ensureBadge() {
    if (badge?.isConnected) return badge;
    badge = document.createElement('div');
    badge.className = 'article-live-state';
    badge.hidden = true;
    badge.innerHTML = '<span class="article-live-state-dot" aria-hidden="true"></span><strong data-article-live-label>LIVE</strong><span data-article-live-meta></span>';
    body.before(badge);
    return badge;
  }

  function formatTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(date);
  }

  function unwrap(node) {
    const parent = node.parentNode;
    if (!parent) return;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    node.remove();
  }

  function cleanHtml(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html || '');

    template.content.querySelectorAll('script, object, embed, .writer-preview-block-tools, .writer-tale-crop-controls, .writer-media-resize-handle, .article-inline-video-controls, .article-inline-video-fallback, canvas.matlock-portrait-canvas').forEach(node => node.remove());
    template.content.querySelectorAll('.writer-preview-html-shell, .writer-preview-table-shell').forEach(unwrap);

    template.content.querySelectorAll('.writer-embed').forEach(node => {
      node.classList.remove('writer-embed');
      node.classList.add('article-embed', 'article-video-embed');
      node.removeAttribute('data-writer-embed-src');
    });

    template.content.querySelectorAll('.writer-x-embed').forEach(node => {
      node.classList.remove('writer-x-embed');
      node.classList.add('article-embed', 'article-x-embed');
      node.removeAttribute('data-writer-x-url');
    });

    template.content.querySelectorAll('img[data-writer-source]').forEach(img => {
      const source = img.getAttribute('data-writer-source');
      if (source) img.setAttribute('src', source);
      img.removeAttribute('data-writer-source');
      img.removeAttribute('data-writer-retry-attempt');
    });

    template.content.querySelectorAll('*').forEach(node => {
      node.removeAttribute('contenteditable');
      node.removeAttribute('spellcheck');
      node.removeAttribute('data-writer-video-ui');
      node.removeAttribute('data-writer-table-index');
      node.removeAttribute('data-editable-portrait');
      node.removeAttribute('data-tale-portrait-editing');
      for (const attr of [...node.attributes]) {
        if (/^on/i.test(attr.name)) node.removeAttribute(attr.name);
        if ((attr.name === 'href' || attr.name === 'src') && /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name);
      }
    });

    return template.innerHTML.trim();
  }

  function childKey(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
    if (node.id) return 'id:' + node.id;
    if (node.matches('[data-writer-block]')) return 'block:' + (node.getAttribute('data-writer-block') || '') + ':' + (node.getAttribute('data-writer-config') || '');
    if (node.matches('figure.article-inline-image, figure.article-inline-video')) {
      return 'media:' + (node.getAttribute('data-writer-media-id') || node.querySelector('img,video,source')?.getAttribute('src') || '');
    }
    if (node.matches('.article-embed')) {
      return 'embed:' + (node.querySelector('iframe,a')?.getAttribute('src') || node.querySelector('iframe,a')?.getAttribute('href') || node.textContent || '');
    }
    if (/^H[1-6]$/.test(node.tagName)) return 'heading:' + (node.textContent || '').trim();
    return '';
  }

  function patchBody(html) {
    const template = document.createElement('template');
    template.innerHTML = cleanHtml(html);
    const nextNodes = [...template.content.children];
    let cursor = body.firstElementChild;

    for (const next of nextNodes) {
      if (!cursor) {
        body.appendChild(next);
        continue;
      }

      if (cursor.outerHTML === next.outerHTML) {
        cursor = cursor.nextElementSibling;
        continue;
      }

      const nextKey = childKey(next);
      if (nextKey) {
        let match = cursor;
        while (match && childKey(match) !== nextKey) match = match.nextElementSibling;
        if (match) {
          if (match.outerHTML !== next.outerHTML) match.replaceWith(next);
          else body.insertBefore(match, cursor);
          cursor = next.nextElementSibling || match.nextElementSibling;
          continue;
        }
      }

      const old = cursor;
      cursor = old.nextElementSibling;
      old.replaceWith(next);
    }

    while (cursor) {
      const next = cursor.nextElementSibling;
      cursor.remove();
      cursor = next;
    }
  }

  function loadXWidgets() {
    const container = body;
    if (!container.querySelector('.twitter-tweet')) return;
    const render = () => window.twttr?.widgets?.load?.(container);
    if (window.twttr?.widgets) {
      render();
      return;
    }
    let script = document.querySelector('script[src="https://platform.x.com/widgets.js"]');
    if (!script) {
      script = document.createElement('script');
      script.src = 'https://platform.x.com/widgets.js';
      script.async = true;
      script.charset = 'utf-8';
      document.body.appendChild(script);
    }
    script.addEventListener('load', render, { once: true });
  }

  function refreshLinks() {
    body.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href') || '';
      if (href.startsWith('#')) {
        link.removeAttribute('target');
        link.removeAttribute('rel');
        return;
      }
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    });
  }

  function render(live) {
    const relevant = sameArticle(live) && (live.active || live.hold);
    if (!relevant) {
      if (liveApplied && sameArticle(live) && !live.active && !live.hold) {
        location.reload();
        return;
      }
      return;
    }

    const version = Number(live.version || 0);
    if (version !== lastVersion) {
      lastVersion = version;
      patchBody(live.html || '');
      liveApplied = true;

      if (titleNode && live.title) titleNode.textContent = live.title;
      if (descriptionNode && typeof live.description === 'string') {
        descriptionNode.textContent = live.description;
        descriptionNode.hidden = !live.description;
      }

      window.MatlockPortraitCrop?.hydrate?.(body);
      loadXWidgets();
      refreshLinks();
      window.dispatchEvent(new CustomEvent('matlock-live:content', { detail: { version, sourcePath, publicPath: pagePath } }));
    }

    const state = ensureBadge();
    const label = state.querySelector('[data-article-live-label]');
    const meta = state.querySelector('[data-article-live-meta]');
    state.hidden = false;
    state.dataset.state = live.active ? 'live' : 'ended';
    label.textContent = live.active ? 'LIVE UPDATES' : 'LIVE COVERAGE ENDED';
    const time = formatTime(live.updatedAt);
    meta.textContent = live.active
      ? (time ? 'Updating automatically · Last change ' + time : 'Updating automatically')
      : (time ? 'Last live update ' + time + ' · Final article pending' : 'Final article pending');
  }

  function nextDelay(live) {
    if (document.hidden) return 12000;
    if (sameArticle(live) && live.active) return 2500;
    if (sameArticle(live) && live.hold) return 5000;
    return 12000;
  }

  async function poll() {
    if (stopped) return;
    let live = null;
    try {
      const response = await fetch(FEED + '?live=' + Date.now(), {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
        headers: { Accept: 'application/json' }
      });
      if (!response.ok) throw new Error('Live feed unavailable.');
      live = await response.json();
      render(live);
    } catch {
      // Published article remains usable if the live transport is temporarily unavailable.
    } finally {
      window.clearTimeout(timer);
      timer = window.setTimeout(poll, nextDelay(live));
    }
  }

  document.addEventListener('visibilitychange', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(poll, document.hidden ? 3000 : 50);
  });

  window.addEventListener('beforeunload', () => {
    stopped = true;
    window.clearTimeout(timer);
  });

  poll();
})();