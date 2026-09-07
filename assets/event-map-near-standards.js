(() => {
    const page = document.querySelector('[data-event-map]');
    if (!page) return;

    const button = page.querySelector('[data-near-me]');
    const status = page.querySelector('[data-near-status]');
    const eventList = page.querySelector('[data-event-list]');
    const rangeButtons = [...page.querySelectorAll('[data-range]')];
    if (!button || !status || !eventList) return;

    const RADIUS_MILES = 250;
    let permissionState = 'unknown';
    let attempted = false;
    let syncing = false;
    let permissionHandle = null;

    if (!status.id) status.id = 'event-map-near-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');

    button.setAttribute('aria-describedby', status.id);
    button.setAttribute(
        'aria-label',
        `Find MMA events within ${RADIUS_MILES} miles using my device location`
    );
    button.title = 'Uses your device location only after you tap. No continuous tracking.';

    const visibleResultButtons = () => [...eventList.querySelectorAll('.event-map-result')]
        .filter(node => !node.hidden && node.offsetParent !== null);

    function nearestDistance(rows) {
        const distances = rows
            .map(row => {
                const text = row.querySelector('.event-map-result-distance')?.textContent || '';
                const value = Number.parseFloat(text.replace(/[^0-9.]/g, ''));
                return Number.isFinite(value) ? value : null;
            })
            .filter(Number.isFinite);
        return distances.length ? Math.min(...distances) : null;
    }

    function activeStatus() {
        const rows = visibleResultButtons();
        const nearest = nearestDistance(rows);
        if (!rows.length) return `No mapped events within ${RADIUS_MILES} mi`;
        const count = `${rows.length} event${rows.length === 1 ? '' : 's'} within ${RADIUS_MILES} mi`;
        return Number.isFinite(nearest) ? `${count} · nearest ${Math.round(nearest)} mi` : count;
    }

    function normalizeInactiveStatus(raw) {
        const text = String(raw || '').trim().toLowerCase();
        if (!text) return '';
        if (text.includes('requesting location')) return 'Finding nearby events…';
        if (text.includes('permission denied')) return 'Location blocked in browser settings';
        if (text.includes('could not determine')) return 'Location unavailable · tap Near Me to retry';
        if (text.includes('not available in this browser')) return 'Location is not supported in this browser';
        if (text.includes('location saved')) return 'Location ready for this visit';
        if (text.includes('location active')) return activeStatus();
        return raw;
    }

    function sync() {
        if (syncing) return;
        syncing = true;
        try {
            const active = button.getAttribute('aria-pressed') === 'true';
            const busy = button.disabled || /requesting location/i.test(status.textContent || '');
            button.setAttribute('aria-busy', String(busy));
            button.dataset.permission = permissionState;

            let next = status.textContent || '';
            if (busy) {
                next = 'Finding nearby events…';
            } else if (active) {
                next = activeStatus();
                button.setAttribute(
                    'aria-label',
                    `Near Me on. Showing events within ${RADIUS_MILES} miles. Activate to turn off.`
                );
            } else {
                next = normalizeInactiveStatus(next);
                if (attempted && permissionState === 'denied') {
                    next = 'Location blocked in browser settings';
                }
                button.setAttribute(
                    'aria-label',
                    `Find MMA events within ${RADIUS_MILES} miles using my device location`
                );
            }

            if (status.textContent !== next) status.textContent = next;
        } finally {
            syncing = false;
        }
    }

    async function readPermission() {
        if (!navigator.permissions?.query) return;
        try {
            permissionHandle = await navigator.permissions.query({ name: 'geolocation' });
            permissionState = permissionHandle.state || 'unknown';
            button.dataset.permission = permissionState;
            permissionHandle.addEventListener?.('change', () => {
                permissionState = permissionHandle.state || 'unknown';
                sync();
            });
        } catch (_) {
            permissionState = 'unknown';
        }
    }

    button.addEventListener('click', () => {
        attempted = true;
        queueMicrotask(sync);
        requestAnimationFrame(sync);
    });

    rangeButtons.forEach(range => {
        range.addEventListener('click', () => requestAnimationFrame(sync));
    });

    const stateObserver = new MutationObserver(() => queueMicrotask(sync));
    stateObserver.observe(button, {
        attributes: true,
        attributeFilter: ['aria-pressed', 'disabled']
    });
    stateObserver.observe(status, {
        childList: true,
        characterData: true,
        subtree: true
    });

    const resultsObserver = new MutationObserver(() => {
        if (button.getAttribute('aria-pressed') === 'true') requestAnimationFrame(sync);
    });
    resultsObserver.observe(eventList, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden']
    });

    if (!window.isSecureContext || !('geolocation' in navigator)) {
        button.disabled = true;
        button.setAttribute('aria-disabled', 'true');
        status.textContent = !window.isSecureContext
            ? 'Near Me requires a secure connection'
            : 'Location is not supported in this browser';
    }

    readPermission().finally(sync);
})();
