/* Event Map interaction enhancements.
   Consolidates pointer, detail, popover, near-me and hover-stability behavior
   that previously loaded as separate patch files. */

(() => {
    const page = document.querySelector('[data-event-map]');
    const svg = page?.querySelector('[data-map-svg]');
    if (!svg) return;

    let pressedMarker = null;
    let startX = 0;
    let startY = 0;
    let moved = false;
    let suppressClickUntil = 0;

    const markerFrom = target => target instanceof Element
        ? target.closest('.event-map-pin-group')
        : null;

    const activateMarker = marker => {
        if (!marker?.isConnected) return;
        try { marker.focus({ preventScroll: true }); } catch (_) { marker.focus(); }
        marker.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            bubbles: false,
            cancelable: true
        }));
    };

    svg.addEventListener('pointerdown', event => {
        const marker = markerFrom(event.target);
        if (!marker) return;

        pressedMarker = marker;
        startX = event.clientX;
        startY = event.clientY;
        moved = false;

        event.stopPropagation();
    }, true);

    svg.addEventListener('pointermove', event => {
        if (!pressedMarker) return;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > 8) moved = true;
    }, true);

    svg.addEventListener('pointerup', event => {
        if (!pressedMarker) return;

        const marker = markerFrom(event.target);
        const shouldActivate = !moved && marker === pressedMarker;
        const selectedMarker = pressedMarker;
        pressedMarker = null;
        moved = false;

        event.preventDefault();
        event.stopPropagation();
        suppressClickUntil = performance.now() + 700;

        if (shouldActivate) activateMarker(selectedMarker);
    }, true);

    svg.addEventListener('pointercancel', () => {
        pressedMarker = null;
        moved = false;
    }, true);

    svg.addEventListener('click', event => {
        const marker = markerFrom(event.target);
        if (!marker) return;

        event.preventDefault();
        event.stopPropagation();

        if (performance.now() > suppressClickUntil) activateMarker(marker);
    }, true);
})();

(() => {
    const page = document.querySelector('[data-event-map]');
    if (!page) return;

    const detailCard = page.querySelector('[data-event-detail-card]');
    const titleNode = page.querySelector('[data-detail-title]');
    const promotionNode = page.querySelector('[data-detail-promotion]');
    const dateNode = page.querySelector('[data-detail-date]');
    const posterWrap = page.querySelector('[data-detail-poster-wrap]');
    const poster = page.querySelector('[data-detail-poster]');
    const fightersNode = page.querySelector('[data-detail-fighters]');
    const weightNode = page.querySelector('[data-detail-weight]');
    const lockNode = page.querySelector('[data-detail-lock-state]');
    const clusterList = page.querySelector('[data-cluster-list]');
    if (!detailCard || !titleNode || !fightersNode || !weightNode) return;

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const norm = value => clean(value).toLowerCase();
    let events = [];
    let loadPromise = null;

    function titleMatchup(title) {
        const text = clean(title)
            .replace(/\s+-\s+\d{1,2}\/\d{1,2}\s*$/i, '')
            .replace(/\s+\|.*$/, '');
        const afterColon = text.includes(':') ? text.split(':').slice(1).join(':').trim() : text;
        const match = afterColon.match(/^(.{2,70}?)\s+(?:vs\.?|v\.)\s+(.{2,70}?)(?:\s+[–—-]\s+.*)?$/i);
        return match ? [clean(match[1]), clean(match[2])] : null;
    }

    function weightFromText(value) {
        const text = clean(value);
        const match = text.match(/\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Strawweight|Catchweight)\b/i);
        if (!match) return '';
        let weight = match[1].replace(/women'?s/i, "Women's");
        if (/\b(?:title|championship|champion|world title)\b/i.test(text) && !/title/i.test(weight)) weight += ' Championship';
        return weight;
    }

    function mainBout(event) {
        const sections = Array.isArray(event?.sections) ? event.sections : [];
        const bouts = sections.flatMap(section => Array.isArray(section?.bouts) ? section.bouts : []);
        if (bouts.length) {
            const bout = bouts.find(item => /main event/i.test(clean(item?.label)))
                || [...bouts].sort((a, b) => Number(a?.order || 999) - Number(b?.order || 999))[0];
            return {
                fighters: (bout?.fighters || []).map(item => clean(item?.name || item)).filter(Boolean).slice(0, 2),
                weight: clean(bout?.weight_class || bout?.weight || bout?.division) || weightFromText(bout?.label)
            };
        }
        const stored = event?.main_event;
        if (stored && typeof stored === 'object') {
            return {
                fighters: (stored.fighters || []).map(item => clean(item?.name || item)).filter(Boolean).slice(0, 2),
                weight: clean(stored.weight_class || stored.weight || stored.division) || weightFromText(event?.title)
            };
        }
        return {
            fighters: titleMatchup(event?.title) || [],
            weight: clean(event?.weight_class || event?.division) || weightFromText(event?.title)
        };
    }

    function posterUrl(event) {
        return clean(event?.poster || event?.poster_url || event?.image || event?.image_url);
    }

    function findCurrentEvent() {
        const title = norm(titleNode.textContent);
        const promotion = norm(promotionNode?.textContent);
        const dateIso = dateNode?.dateTime ? String(dateNode.dateTime).slice(0, 10) : '';
        if (!title) return null;
        return events.find(event => norm(event.title) === title && (!promotion || norm(event.promotion) === promotion) && (!dateIso || !event.date || event.date === dateIso))
            || events.find(event => norm(event.title) === title && (!dateIso || !event.date || event.date === dateIso))
            || events.find(event => norm(event.title) === title)
            || null;
    }

    function renderPoster(event) {
        if (!posterWrap || !poster) return;
        const url = posterUrl(event);
        if (!url) {
            if (!posterWrap.hidden) posterWrap.hidden = true;
            poster.removeAttribute('src');
            return;
        }
        if (posterWrap.hidden) posterWrap.hidden = false;
        poster.alt = `${clean(event.promotion) || 'MMA'} ${clean(event.title) || 'event'} poster`;
        if (poster.src !== url) poster.src = url;
        poster.onerror = () => {
            posterWrap.hidden = true;
            poster.removeAttribute('src');
        };
    }

    function renderDetails() {
        if (detailCard.hidden || !events.length) return;
        const event = findCurrentEvent();
        if (!event) return;
        const bout = mainBout(event);
        fightersNode.textContent = bout.fighters.length >= 2
            ? `${bout.fighters[0]} vs. ${bout.fighters[1]}`
            : 'Main event not yet listed';
        weightNode.textContent = bout.weight || 'Weight class not yet listed';
        renderPoster(event);
    }

    function enhanceClusterRows() {
        if (!clusterList || !events.length) return;
        clusterList.querySelectorAll('.event-map-cluster-event').forEach(button => {
            if (button.querySelector('.event-map-cluster-matchup')) return;
            const title = clean(button.querySelector('strong')?.textContent);
            const event = events.find(item => norm(item.title) === norm(title));
            if (!event) return;
            const bout = mainBout(event);
            if (bout.fighters.length < 2 && !bout.weight) return;
            const line = document.createElement('span');
            line.className = 'event-map-cluster-matchup';
            const matchup = bout.fighters.length >= 2 ? `${bout.fighters[0]} vs. ${bout.fighters[1]}` : 'Main event TBA';
            line.textContent = `${matchup}${bout.weight ? ` · ${bout.weight}` : ''}`;
            button.append(line);
        });
    }

    function selectedFromUrl() {
        return new URL(window.location.href).searchParams.has('event');
    }

    function updateLockLabel() {
        if (!lockNode) return;
        const locked = selectedFromUrl();
        lockNode.textContent = locked ? 'Selected · details locked' : 'Hover preview · click/tap to lock';
        lockNode.dataset.locked = String(locked);
    }

    function ensureEvents() {
        if (events.length) return Promise.resolve(events);
        if (loadPromise) return loadPromise;
        loadPromise = fetch(page.dataset.eventsUrl, { cache: 'no-store' })
            .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
            .then(data => {
                events = Array.isArray(data?.events) ? data.events : [];
                return events;
            })
            .catch(error => {
                console.warn('Event Map detail enrichment unavailable', error);
                return [];
            });
        return loadPromise;
    }

    function refreshDetails() {
        updateLockLabel();
        if (detailCard.hidden && (!clusterList || !clusterList.children.length)) return;
        ensureEvents().then(() => {
            renderDetails();
            enhanceClusterRows();
        });
    }

    const detailObserver = new MutationObserver(refreshDetails);
    detailObserver.observe(detailCard, { attributes: true, attributeFilter: ['hidden'] });
    detailObserver.observe(titleNode, { childList: true, characterData: true, subtree: true });
    if (promotionNode) detailObserver.observe(promotionNode, { childList: true, characterData: true, subtree: true });
    if (dateNode) detailObserver.observe(dateNode, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['datetime'] });

    if (clusterList) {
        const clusterObserver = new MutationObserver(refreshDetails);
        clusterObserver.observe(clusterList, { childList: true });
    }

    window.addEventListener('popstate', updateLockLabel);
    page.addEventListener('pointerup', () => setTimeout(updateLockLabel, 0), { passive: true });
    page.addEventListener('click', () => setTimeout(updateLockLabel, 0), { passive: true });
    updateLockLabel();
})();

(() => {
    const page = document.querySelector('[data-event-map]');
    if (!page) return;

    const stage = page.querySelector('.event-map-stage');
    const svg = page.querySelector('[data-map-svg]');
    const detailCard = page.querySelector('[data-event-detail-card]');
    const detailTitle = page.querySelector('[data-detail-title]');
    const detailPromotion = page.querySelector('[data-detail-promotion]');
    const detailDate = page.querySelector('[data-detail-date]');
    const detailMatchup = page.querySelector('.event-map-detail-matchup');
    if (!stage || !svg) return;

    let markerObserver = null;
    let detailObserver = null;
    let refreshQueued = false;
    let eventById = new Map();

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const norm = value => clean(value).toLowerCase();

    function eventDate(event) {
        if (event?.calendarDay instanceof Date && !Number.isNaN(event.calendarDay.getTime())) return event.calendarDay;
        if (event?.dateObject instanceof Date && !Number.isNaN(event.dateObject.getTime())) return event.dateObject;
        const raw = event?.starts_at || event?.date;
        if (!raw) return null;
        const date = event.starts_at ? new Date(raw) : new Date(`${raw}T12:00:00`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function shortDate(event) {
        const date = eventDate(event);
        if (!date) return 'DATE TBA';
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase();
    }

    function titleMatchup(title) {
        const text = clean(title).replace(/\s+\|.*$/, '');
        const afterColon = text.includes(':') ? text.split(':').slice(1).join(':').trim() : text;
        const match = afterColon.match(/^(.{2,70}?)\s+(?:vs\.?|v\.)\s+(.{2,70}?)(?:\s+[–—-]\s+.*)?$/i);
        return match ? [clean(match[1]), clean(match[2])] : [];
    }

    function mainInfo(event) {
        const sections = Array.isArray(event?.sections) ? event.sections : [];
        const bouts = sections.flatMap(section => Array.isArray(section?.bouts) ? section.bouts : []);
        const bout = bouts.find(item => /main event/i.test(clean(item?.label))) || bouts[0];
        if (bout) {
            return {
                fighters: (bout.fighters || []).map(item => clean(item?.name || item)).filter(Boolean).slice(0, 2),
                weight: clean(bout.weight_class || bout.weight || bout.division || bout.label)
            };
        }
        if (event?.main_event && typeof event.main_event === 'object') {
            return {
                fighters: (event.main_event.fighters || []).map(item => clean(item?.name || item)).filter(Boolean).slice(0, 2),
                weight: clean(event.main_event.weight_class || event.main_event.weight || event.main_event.division)
            };
        }
        return {
            fighters: titleMatchup(event?.title),
            weight: clean(event?.weight_class || event?.division)
        };
    }

    function markerGroups() {
        return [...svg.querySelectorAll('.event-map-pin-group')];
    }

    function rebuildEventIndex() {
        const next = new Map();
        markerGroups().forEach(group => {
            const cluster = group.__data__;
            if (!cluster || !Array.isArray(cluster.events)) return;
            cluster.events.forEach(event => {
                if (event?.mapId) next.set(event.mapId, event);
                if (event?.id) next.set(event.id, event);
            });
        });
        eventById = next;
    }

    function findDetailEvent() {
        if (!detailCard || detailCard.hidden) return null;
        const title = norm(detailTitle?.textContent);
        const promotion = norm(detailPromotion?.textContent);
        const dateIso = detailDate?.dateTime ? String(detailDate.dateTime).slice(0, 10) : '';
        if (!title) return null;
        return [...new Set(eventById.values())].find(item =>
            norm(item.title) === title
            && (!promotion || norm(item.promotion) === promotion)
            && (!dateIso || !item.date || item.date === dateIso)
        ) || [...new Set(eventById.values())].find(item => norm(item.title) === title) || null;
    }

    function renderAnnouncedCard() {
        if (!detailCard || detailCard.hidden || !detailMatchup) return;
        let block = detailCard.querySelector('[data-detail-announced-card]');
        const event = findDetailEvent();
        if (!event) {
            if (block) block.hidden = true;
            return;
        }

        const sections = Array.isArray(event.sections) ? event.sections : [];
        const bouts = sections.flatMap(section => Array.isArray(section?.bouts) ? section.bouts : []).slice(0, 5);
        if (!bouts.length) {
            if (block) block.hidden = true;
            return;
        }

        if (!block) {
            block = document.createElement('section');
            block.className = 'event-map-detail-card-list';
            block.dataset.detailAnnouncedCard = '';
            detailMatchup.insertAdjacentElement('afterend', block);
        }
        block.hidden = false;
        block.replaceChildren();

        const label = document.createElement('p');
        label.className = 'event-map-detail-card-list-label';
        label.textContent = 'Announced card';
        block.append(label);

        bouts.forEach(bout => {
            const fighters = (bout?.fighters || []).map(item => clean(item?.name || item)).filter(Boolean).slice(0, 2);
            if (fighters.length < 2) return;
            const row = document.createElement('div');
            row.className = 'event-map-detail-bout-row';
            const matchup = document.createElement('strong');
            matchup.textContent = `${fighters[0]} vs. ${fighters[1]}`;
            const weight = document.createElement('span');
            weight.textContent = clean(bout.weight_class || bout.weight || bout.division || bout.label) || 'Division TBA';
            row.append(matchup, weight);
            block.append(row);
        });
    }

    const popover = document.createElement('div');
    popover.className = 'event-map-popover';
    popover.hidden = true;
    popover.setAttribute('aria-hidden', 'true');
    stage.append(popover);

    function positionPopover(group) {
        const stageRect = stage.getBoundingClientRect();
        const pinRect = group.getBoundingClientRect();
        const centerX = pinRect.left - stageRect.left + pinRect.width / 2;
        const pinTop = pinRect.top - stageRect.top;
        const pinBottom = pinRect.bottom - stageRect.top;
        const width = Math.min(popover.offsetWidth || 260, Math.max(180, stageRect.width - 16));
        const height = popover.offsetHeight || 100;
        const left = Math.max(8, Math.min(centerX - width / 2, stageRect.width - width - 8));
        let top = pinTop - height - 12;
        if (top < 8) top = pinBottom + 12;
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    }

    function showPopover(group) {
        if (!group || group.hidden) return;
        const cluster = group.__data__;
        if (!cluster || !Array.isArray(cluster.events) || !cluster.events.length) return;
        const events = [...cluster.events].sort((a, b) => (eventDate(a)?.getTime() || Infinity) - (eventDate(b)?.getTime() || Infinity));
        popover.replaceChildren();

        if (events.length > 1) {
            const label = document.createElement('span');
            label.className = 'event-map-popover-label';
            label.textContent = `${events.length} EVENTS`;
            const title = document.createElement('strong');
            title.textContent = `Near ${events[0].city || events[0].stateName || 'this location'}`;
            popover.append(label, title);
            events.slice(0, 3).forEach(event => {
                const row = document.createElement('span');
                row.className = 'event-map-popover-row';
                row.textContent = `${shortDate(event)} · ${clean(event.title) || clean(event.promotion) || 'MMA event'}`;
                popover.append(row);
            });
        } else {
            const event = events[0];
            const info = mainInfo(event);
            const label = document.createElement('span');
            label.className = 'event-map-popover-label';
            label.textContent = clean(event.promotion) || 'MMA';
            const title = document.createElement('strong');
            title.textContent = clean(event.title) || clean(event.promotion) || 'MMA event';
            popover.append(label, title);
            if (info.fighters.length >= 2) {
                const matchup = document.createElement('span');
                matchup.className = 'event-map-popover-matchup';
                matchup.textContent = `${info.fighters[0]} vs. ${info.fighters[1]}${info.weight ? ` · ${info.weight}` : ''}`;
                popover.append(matchup);
            }
            const meta = document.createElement('span');
            meta.className = 'event-map-popover-meta';
            meta.textContent = `${shortDate(event)} · ${[event.city, event.stateCode].filter(Boolean).join(', ')}`;
            popover.append(meta);
        }

        popover.hidden = false;
        popover.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => positionPopover(group));
    }

    function hidePopover() {
        popover.hidden = true;
        popover.setAttribute('aria-hidden', 'true');
    }

    function groupFromTarget(target) {
        return target instanceof Element ? target.closest('.event-map-pin-group') : null;
    }

    function scheduleRefresh() {
        if (refreshQueued) return;
        refreshQueued = true;
        requestAnimationFrame(() => {
            refreshQueued = false;
            rebuildEventIndex();
            renderAnnouncedCard();
        });
    }

    stage.addEventListener('pointerover', event => {
        const group = groupFromTarget(event.target);
        if (!group) return;
        if (event.relatedTarget instanceof Node && group.contains(event.relatedTarget)) return;
        showPopover(group);
    });
    stage.addEventListener('pointerout', event => {
        const group = groupFromTarget(event.target);
        if (!group) return;
        if (event.relatedTarget instanceof Node && group.contains(event.relatedTarget)) return;
        hidePopover();
    });
    stage.addEventListener('focusin', event => {
        const group = groupFromTarget(event.target);
        if (group) showPopover(group);
    });
    stage.addEventListener('focusout', event => {
        const group = groupFromTarget(event.target);
        if (group) hidePopover();
    });
    stage.addEventListener('wheel', hidePopover, { passive: true });
    stage.addEventListener('pointerdown', event => {
        if (!groupFromTarget(event.target)) hidePopover();
    }, { passive: true });

    function attachMarkerObserver() {
        const layer = svg.querySelector('.event-map-markers');
        if (!layer) {
            requestAnimationFrame(attachMarkerObserver);
            return;
        }
        markerObserver = new MutationObserver(scheduleRefresh);
        markerObserver.observe(layer, { childList: true });
        scheduleRefresh();
    }
    attachMarkerObserver();

    if (detailCard && detailTitle) {
        detailObserver = new MutationObserver(scheduleRefresh);
        detailObserver.observe(detailCard, { attributes: true, attributeFilter: ['hidden'] });
        detailObserver.observe(detailTitle, { childList: true, characterData: true, subtree: true });
        if (detailPromotion) detailObserver.observe(detailPromotion, { childList: true, characterData: true, subtree: true });
        if (detailDate) detailObserver.observe(detailDate, { attributes: true, attributeFilter: ['datetime'], childList: true });
    }
})();

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

(() => {
    const page = document.querySelector('[data-event-map]');
    const svg = page?.querySelector('[data-map-svg]');
    const detail = page?.querySelector('[data-event-detail]');
    const detailCard = page?.querySelector('[data-event-detail-card]');
    const clusterCard = page?.querySelector('[data-cluster-card]');
    const eventList = page?.querySelector('[data-event-list]');
    if (!page || !svg || !detail || !detailCard || !clusterCard) return;

    const desktopHover = window.matchMedia('(min-width: 821px) and (hover: hover) and (pointer: fine)');
    let locked = new URLSearchParams(window.location.search).has('event');

    const markerFrom = target => target instanceof Element
        ? target.closest('.event-map-pin-group')
        : null;

    const setPreview = active => {
        if (!desktopHover.matches) active = false;
        detail.dataset.hoverPreview = active ? 'true' : 'false';
    };

    const cardsAreHidden = () => detailCard.hidden && clusterCard.hidden;

    const markLocked = () => {
        locked = true;
        setPreview(false);
    };

    svg.addEventListener('pointerover', event => {
        const marker = markerFrom(event.target);
        if (!marker) return;
        if (event.relatedTarget instanceof Node && marker.contains(event.relatedTarget)) return;
        if (!locked) setPreview(true);
    }, true);

    svg.addEventListener('pointerout', event => {
        const marker = markerFrom(event.target);
        if (!marker) return;
        if (event.relatedTarget instanceof Node && marker.contains(event.relatedTarget)) return;
        if (!locked) setPreview(false);
    }, true);

    svg.addEventListener('focusin', event => {
        if (!markerFrom(event.target) || locked) return;
        setPreview(true);
    }, true);

    svg.addEventListener('focusout', event => {
        if (!markerFrom(event.target) || locked) return;
        setPreview(false);
    }, true);

    svg.addEventListener('pointerup', event => {
        if (!markerFrom(event.target)) return;
        queueMicrotask(markLocked);
    }, true);

    svg.addEventListener('keydown', event => {
        if (!markerFrom(event.target)) return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        queueMicrotask(markLocked);
    }, true);

    eventList?.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest('.event-map-result')) return;
        queueMicrotask(markLocked);
    }, true);

    detail.addEventListener('click', event => {
        if (!(event.target instanceof Element)) return;
        if (!event.target.closest('.event-map-cluster-event')) return;
        queueMicrotask(markLocked);
    }, true);

    const observer = new MutationObserver(() => {
        if (cardsAreHidden()) {
            locked = false;
            setPreview(false);
            return;
        }
        if (new URLSearchParams(window.location.search).has('event')) locked = true;
    });
    observer.observe(detailCard, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(clusterCard, { attributes: true, attributeFilter: ['hidden'] });

    desktopHover.addEventListener?.('change', () => setPreview(false));
    setPreview(false);
})();
