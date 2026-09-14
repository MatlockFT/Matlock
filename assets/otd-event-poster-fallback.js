(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    const list = widget?.querySelector('[data-otd-list]');
    if (!widget || !list || list.dataset.otdEventPosterFallbackBooted === '1') return;
    list.dataset.otdEventPosterFallbackBooted = '1';

    const make = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    };

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

    function decorate(row) {
        if (!row?.classList?.contains('otd-entry--event')) return;
        const media = row.querySelector('.otd-entry-media.is-fallback');
        if (!media || media.dataset.eventPosterFallback === '1') return;

        const title = clean(row.querySelector('.otd-entry-title')?.textContent) || 'MMA Event';
        const promotion = clean(row.querySelector('.otd-promotion')?.textContent) || 'MMA';
        const year = clean(row.querySelector('.otd-entry-year')?.textContent);
        const day = clean(widget.querySelector('[data-otd-date]')?.textContent);
        const dateLine = clean([day, year].filter(Boolean).join(' · '));

        const kicker = make('span', 'otd-event-poster-kicker', promotion);
        const titleNode = make('strong', 'otd-event-poster-title', title);
        const footer = make('span', 'otd-event-poster-footer');
        footer.append(
            make('span', 'otd-event-poster-date', dateLine || year || 'Archive'),
            make('span', 'otd-event-poster-status', 'Original poster pending')
        );

        media.replaceChildren(kicker, titleNode, footer);
        media.dataset.eventPosterFallback = '1';
        media.classList.add('is-event-poster-fallback');
        media.setAttribute('role', 'img');
        media.setAttribute('aria-label', `Archive event card for ${title}. Original event poster is still being sourced.`);
        row.classList.add('has-event-poster-fallback');
    }

    function scan() {
        for (const row of list.querySelectorAll('.otd-entry--event')) decorate(row);
    }

    let queued = false;
    const queueScan = () => {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            scan();
        });
    };

    const observer = new MutationObserver(queueScan);
    observer.observe(list, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });

    scan();
})();
