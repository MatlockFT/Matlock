(() => {
  const DATA_URL = '/assets/data/fighter-histories.json';
  const ROOT_SELECTORS = ['#article-content', '[data-preview-content]'];
  const enhanced = new WeakSet();
  let dataPromise = null;
  let activeTrigger = null;
  let closeTimer = 0;
  let panel = null;
  let currentEntry = null;

  const escapeHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  function loadData() {
    if (!dataPromise) {
      dataPromise = fetch(DATA_URL, { cache: 'no-store', headers: { Accept: 'application/json' } })
        .then(response => {
          if (!response.ok) throw new Error('Fighter history data unavailable.');
          return response.json();
        })
        .then(payload => payload?.fighters || {})
        .catch(() => ({}));
    }
    return dataPromise;
  }

  function ensurePanel() {
    if (panel?.isConnected) return panel;

    panel = document.createElement('aside');
    panel.className = 'fighter-history-popover';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Fighter career timeline');
    panel.innerHTML = [
      '<div class="fighter-history-popover-head">',
        '<div>',
          '<span class="fighter-history-kicker">CAREER TIMELINE</span>',
          '<strong data-fighter-history-name></strong>',
          '<small data-fighter-history-record></small>',
        '</div>',
        '<button type="button" class="fighter-history-close" data-fighter-history-close aria-label="Close career timeline">×</button>',
      '</div>',
      '<div class="fighter-history-popover-body">',
        '<ol class="fighter-history-list" data-fighter-history-list></ol>',
        '<section class="fighter-history-detail" data-fighter-history-detail aria-live="polite">',
          '<span class="fighter-history-detail-date" data-fighter-history-detail-date></span>',
          '<h4 data-fighter-history-detail-title>Career detail</h4>',
          '<p data-fighter-history-detail-copy>Hover or tap a timeline item to read more.</p>',
          '<a data-fighter-history-source hidden target="_blank" rel="noopener noreferrer">Source ↗</a>',
        '</section>',
      '</div>'
    ].join('');

    document.body.appendChild(panel);

    panel.addEventListener('mouseenter', cancelClose);
    panel.addEventListener('mouseleave', scheduleClose);
    panel.querySelector('[data-fighter-history-close]')?.addEventListener('click', closePanel);

    panel.addEventListener('pointerover', event => {
      const item = event.target.closest('[data-fighter-history-item]');
      if (!item || !panel.contains(item)) return;
      selectItem(Number(item.dataset.fighterHistoryItem || 0), false);
    });

    panel.addEventListener('focusin', event => {
      const item = event.target.closest('[data-fighter-history-item]');
      if (!item || !panel.contains(item)) return;
      selectItem(Number(item.dataset.fighterHistoryItem || 0), false);
    });

    panel.addEventListener('click', event => {
      const item = event.target.closest('[data-fighter-history-item]');
      if (!item || !panel.contains(item)) return;
      event.preventDefault();
      selectItem(Number(item.dataset.fighterHistoryItem || 0), true);
    });

    return panel;
  }

  function renderPanel(entry) {
    const shell = ensurePanel();
    currentEntry = entry;

    shell.querySelector('[data-fighter-history-name]').textContent = entry.name || '';
    shell.querySelector('[data-fighter-history-record]').textContent = entry.record ? entry.record + ' professional record' : '';

    const list = shell.querySelector('[data-fighter-history-list]');
    list.innerHTML = (entry.items || []).map((item, index) => {
      const kind = escapeHtml(item.kind || 'note');
      return '<li>' +
        '<button type="button" class="fighter-history-item" data-fighter-history-item="' + index + '" data-kind="' + kind + '">' +
          '<span class="fighter-history-dot" aria-hidden="true"></span>' +
          '<span class="fighter-history-item-copy">' +
            '<span class="fighter-history-date">' + escapeHtml(item.date || '') + '</span>' +
            '<strong>' + escapeHtml(item.label || '') + '</strong>' +
          '</span>' +
        '</button>' +
      '</li>';
    }).join('');

    selectItem(0, false);
  }

  function selectItem(index, lock) {
    if (!currentEntry || !panel) return;
    const item = currentEntry.items?.[index];
    if (!item) return;

    panel.querySelectorAll('[data-fighter-history-item]').forEach((node, nodeIndex) => {
      const selected = nodeIndex === index;
      node.classList.toggle('is-active', selected);
      node.setAttribute('aria-current', selected ? 'true' : 'false');
    });

    panel.querySelector('[data-fighter-history-detail-date]').textContent = item.date || '';
    panel.querySelector('[data-fighter-history-detail-title]').textContent = item.label || '';
    panel.querySelector('[data-fighter-history-detail-copy]').textContent = item.detail || '';

    const source = panel.querySelector('[data-fighter-history-source]');
    if (item.source) {
      source.href = item.source;
      source.textContent = (item.sourceLabel || 'Source') + ' ↗';
      source.hidden = false;
    } else {
      source.hidden = true;
      source.removeAttribute('href');
    }

    if (lock) {
      const target = panel.querySelector('[data-fighter-history-detail]');
      if (window.matchMedia('(max-width: 720px)').matches) target?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function positionPanel(trigger) {
    if (!panel || panel.hidden || !trigger?.isConnected) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const width = Math.min(760, window.innerWidth - margin * 2);
    panel.style.width = width + 'px';

    panel.style.left = margin + 'px';
    panel.style.top = margin + 'px';

    const measured = panel.getBoundingClientRect();
    let left = Math.max(margin, Math.min(rect.left, window.innerWidth - measured.width - margin));
    let top = rect.bottom + gap;

    if (top + measured.height > window.innerHeight - margin && rect.top - measured.height - gap >= margin) {
      top = rect.top - measured.height - gap;
    } else {
      top = Math.max(margin, Math.min(top, window.innerHeight - measured.height - margin));
    }

    panel.style.left = Math.round(left) + 'px';
    panel.style.top = Math.round(top) + 'px';
  }

  function cancelClose() {
    window.clearTimeout(closeTimer);
    closeTimer = 0;
  }

  function scheduleClose() {
    cancelClose();
    closeTimer = window.setTimeout(closePanel, 180);
  }

  function openPanel(trigger, entry) {
    cancelClose();
    activeTrigger = trigger;
    renderPanel(entry);
    panel.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => positionPanel(trigger));
  }

  function closePanel() {
    cancelClose();
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    activeTrigger = null;
    currentEntry = null;
    if (panel) panel.hidden = true;
  }

  function makeTrigger(strong, entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fighter-history-trigger';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', (entry.name || strong.textContent.trim()) + ' career timeline');
    button.innerHTML = strong.innerHTML;

    strong.replaceWith(button);
    enhanced.add(button);

    button.addEventListener('mouseenter', () => openPanel(button, entry));
    button.addEventListener('mouseleave', scheduleClose);
    button.addEventListener('focus', () => openPanel(button, entry));
    button.addEventListener('blur', scheduleClose);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!panel?.hidden && activeTrigger === button) closePanel();
      else openPanel(button, entry);
    });
  }

  async function enhance(root) {
    if (!root?.isConnected) return;
    const fighters = await loadData();
    if (!root?.isConnected) return;

    root.querySelectorAll('p > strong, p strong').forEach(strong => {
      if (strong.closest('.fighter-history-trigger') || enhanced.has(strong)) return;
      const name = strong.textContent.trim();
      const entry = fighters[name];
      if (!entry) return;
      makeTrigger(strong, entry);
    });
  }

  function watchRoot(root) {
    if (!root || root.dataset.fighterHistoryWatched === 'true') return;
    root.dataset.fighterHistoryWatched = 'true';
    enhance(root);

    const observer = new MutationObserver(() => {
      window.clearTimeout(root._fighterHistoryTimer);
      root._fighterHistoryTimer = window.setTimeout(() => enhance(root), 40);
    });
    observer.observe(root, { childList: true, subtree: true });
  }

  function discoverRoots() {
    ROOT_SELECTORS.forEach(selector => document.querySelectorAll(selector).forEach(watchRoot));
  }

  document.addEventListener('DOMContentLoaded', discoverRoots);
  window.addEventListener('resize', () => {
    if (activeTrigger && panel && !panel.hidden) positionPanel(activeTrigger);
  });
  window.addEventListener('scroll', () => {
    if (activeTrigger && panel && !panel.hidden) positionPanel(activeTrigger);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
  });
  document.addEventListener('click', event => {
    if (panel?.hidden) return;
    if (panel?.contains(event.target) || event.target.closest?.('.fighter-history-trigger')) return;
    closePanel();
  });
  window.addEventListener('matlock-live:content', discoverRoots);
  discoverRoots();
})();
