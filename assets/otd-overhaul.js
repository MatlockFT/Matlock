(() => {
    const widget = document.querySelector('[data-on-this-day][data-mode="full"]');
    const list = widget?.querySelector('[data-otd-list]');
    if (!widget || !list || widget.dataset.otdOverhaulBooted === '1') return;
    widget.dataset.otdOverhaulBooted = '1';

    const stripLinkArrow = value => String(value || '')
        .replace(/\s*[↗→]+\s*$/u, '')
        .replace(/\s+/g, ' ')
        .trim();

    function decorateRow(row) {
        if (!(row instanceof HTMLElement) || !row.matches('.otd-entry')) return;

        row.classList.remove('is-clickable');
        row.removeAttribute('tabindex');
        row.removeAttribute('role');
        row.removeAttribute('aria-label');
        delete row.dataset.sourceUrl;

        const title = row.querySelector('.otd-entry-title')?.textContent?.trim() || 'this moment';
        const actions = row.querySelector('.otd-entry-actions');
        if (!actions) return;

        const source = actions.querySelector('.otd-entry-source');
        if (source) {
            const cleaned = stripLinkArrow(source.textContent) || 'Source';
            if (source.textContent !== cleaned) source.textContent = cleaned;
            source.setAttribute('aria-label', `Open ${cleaned} source for ${title}`);
        }

        actions.querySelectorAll('.otd-entry-link').forEach(node => node.remove());

        let share = actions.querySelector('[data-otd-share-entry]');
        if (!share) {
            share = document.createElement('button');
            share.type = 'button';
            share.className = 'otd-entry-share';
            share.dataset.otdShareEntry = '';
            share.textContent = 'Share';
            actions.append(share);
        }
        share.setAttribute('aria-label', `Create a share card for ${title}`);
        actions.classList.add('is-overhauled');
    }

    function decorateAll() {
        list.querySelectorAll('.otd-entry').forEach(decorateRow);
    }

    function openShareForRow(row, button) {
        const media = row?.querySelector('.otd-entry-media');
        if (!media) return;

        const wasReady = media.classList.contains('is-image-ready');
        if (!wasReady) media.classList.add('is-image-ready');

        media.dispatchEvent(new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window
        }));

        if (!wasReady) queueMicrotask(() => media.classList.remove('is-image-ready'));
        button?.blur?.();
    }

    list.addEventListener('click', event => {
        const button = event.target.closest('[data-otd-share-entry]');
        if (!button || !list.contains(button)) return;
        event.preventDefault();
        event.stopPropagation();
        openShareForRow(button.closest('.otd-entry'), button);
    });

    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
            queued = false;
            decorateAll();
        });
    });
    observer.observe(list, { childList: true });

    decorateAll();
})();
