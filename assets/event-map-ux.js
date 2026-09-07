(() => {
    const page = document.querySelector('[data-event-map]');
    if (!page) return;

    const stage = page.querySelector('.event-map-stage');
    const svg = page.querySelector('[data-map-svg]');
    const eventList = page.querySelector('[data-event-list]');
    const eventListEmpty = page.querySelector('[data-event-list-empty]');
    const weekButton = page.querySelector('[data-week-view]');
    const rangeButtons = [...page.querySelectorAll('[data-range]')];
    const detailCard = page.querySelector('[data-event-detail-card]');
    const detailTitle = page.querySelector('[data-detail-title]');
    const detailPromotion = page.querySelector('[data-detail-promotion]');
    const detailDate = page.querySelector('[data-detail-date]');
    const detailMatchup = page.querySelector('.event-map-detail-matchup');
    if (!stage || !svg || !eventList || !weekButton) return;

    const DAY_MS = 86400000;
    let weekActive = false;
    let markerObserver = null;
    let resultsObserver = null;
    let detailObserver = null;
    let refreshQueued = false;
    let eventById = new Map();

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const norm = value => clean(value).toLowerCase();

    function eventDate(event) {
        if (event?.dateObject instanceof Date && !Number.isNaN(event.dateObject.getTime())) return event.dateObject;
        const raw = event?.starts_at || event?.date;
        if (!raw) return null;
        const date = event.starts_at ? new Date(raw) : new Date(`${raw}T12:00:00`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function inRollingWeek(event) {
        const date = eventDate(event);
        if (!date) return false;
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const end = new Date(start.getTime() + 7 * DAY_MS);
        return date >= start && date < end;
    }

    function dateKey(event) {
        const date = eventDate(event);
        if (!date) return '9999-TBA';
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function dateHeading(event) {
        const date = eventDate(event);
        if (!date) return 'DATE TBA';
        return date.toLocaleDateString([], {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        }).toUpperCase();
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
            const fighters = (bout.fighters || []).map(item => clean(item?.name || item)).filter(Boolean).slice(0, 2);
            return {
                fighters,
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
            const sourceEvents = cluster.__eventMapWeekSource || cluster.events;
            sourceEvents.forEach(event => {
                if (event?.mapId) next.set(event.mapId, event);
            });
        });
        eventById = next;
    }

    function updateClusterVisual(group, cluster, originalEvents) {
        const subset = weekActive ? originalEvents.filter(inRollingWeek) : originalEvents;
        cluster.events = subset;
        group.hidden = subset.length === 0;
        if (!subset.length) return;

        const isCluster = subset.length > 1;
        group.classList.toggle('event-map-cluster', isCluster);
        group.setAttribute('aria-label', isCluster
            ? `${subset.length} upcoming MMA events. Activate to choose an event.`
            : `${clean(subset[0].promotion) || 'MMA'} ${clean(subset[0].title) || 'event'}, ${shortDate(subset[0])}`);

        const halo = group.querySelector('.event-map-pin-halo');
        const pin = group.querySelector('.event-map-pin');
        if (halo) halo.setAttribute('r', isCluster ? '15' : '11');
        if (pin) pin.setAttribute('r', isCluster ? '10' : '6.5');
        const count = group.querySelector('.event-map-pin-count');
        if (count) {
            count.hidden = !isCluster;
            if (isCluster && count.firstChild) count.firstChild.nodeValue = subset.length > 99 ? '99+' : String(subset.length);
        }
    }

    function applyWeekToMarkers() {
        markerGroups().forEach(group => {
            const cluster = group.__data__;
            if (!cluster || !Array.isArray(cluster.events)) return;
            if (!cluster.__eventMapWeekSource) cluster.__eventMapWeekSource = [...cluster.events];
            updateClusterVisual(group, cluster, cluster.__eventMapWeekSource);
        });
    }

    function regroupResults() {
        if (!eventList) return;
        const buttons = [...eventList.querySelectorAll('.event-map-result')];
        if (!buttons.length) {
            if (eventListEmpty) eventListEmpty.hidden = false;
            return;
        }

        if (resultsObserver) resultsObserver.disconnect();
        const byDay = new Map();
        let visibleCount = 0;

        buttons.forEach(button => {
            const event = eventById.get(button.dataset.eventId);
            const visible = !weekActive || (event && inRollingWeek(event));
            button.hidden = !visible;
            if (!visible) return;
            visibleCount += 1;
            const key = event ? dateKey(event) : '9999-TBA';
            if (!byDay.has(key)) byDay.set(key, { event, buttons: [] });
            byDay.get(key).buttons.push(button);
        });

        const fragment = document.createDocumentFragment();
        [...byDay.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .forEach(([, group]) => {
                const section = document.createElement('section');
                section.className = 'event-map-date-group';
                const heading = document.createElement('h3');
                heading.className = 'event-map-date-heading';
                heading.textContent = group.event ? dateHeading(group.event) : 'DATE TBA';
                const rows = document.createElement('div');
                rows.className = 'event-map-date-rows';
                group.buttons.forEach(button => rows.append(button));
                section.append(heading, rows);
                fragment.append(section);
            });

        eventList.replaceChildren(fragment);
        if (eventListEmpty) eventListEmpty.hidden = visibleCount !== 0;
        if (resultsObserver) resultsObserver.observe(eventList, { childList: true });
    }

    function renderAnnouncedCard() {
        if (!detailCard || detailCard.hidden || !detailMatchup) return;
        let block = detailCard.querySelector('[data-detail-announced-card]');
        const title = norm(detailTitle?.textContent);
        const promotion = norm(detailPromotion?.textContent);
        const dateIso = detailDate?.dateTime ? String(detailDate.dateTime).slice(0, 10) : '';
        const event = [...eventById.values()].find(item =>
            norm(item.title) === title
            && (!promotion || norm(item.promotion) === promotion)
            && (!dateIso || !item.date || item.date === dateIso)
        ) || [...eventById.values()].find(item => norm(item.title) === title);

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
        const width = Math.min(popover.offsetWidth || 260, stageRect.width - 16);
        const height = popover.offsetHeight || 100;
        let left = centerX - width / 2;
        left = Math.max(8, Math.min(left, stageRect.width - width - 8));
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
            applyWeekToMarkers();
            regroupResults();
            renderAnnouncedCard();
        });
    }

    weekButton.addEventListener('click', () => {
        // The core renderer already has a reliable 30-day mode. Use it as the
        // backing dataset, then narrow that rendered view to a rolling 7 days.
        weekButton.dataset.range = '30';
        weekActive = true;
    }, true);
    weekButton.addEventListener('click', () => {
        queueMicrotask(() => {
            weekButton.dataset.range = 'weekend';
            rangeButtons.forEach(button => button.setAttribute('aria-pressed', String(button === weekButton)));
            scheduleRefresh();
        });
    });

    rangeButtons.filter(button => button !== weekButton).forEach(button => {
        button.addEventListener('click', () => {
            weekActive = false;
            hidePopover();
        }, true);
        button.addEventListener('click', scheduleRefresh);
    });

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

    resultsObserver = new MutationObserver(scheduleRefresh);
    resultsObserver.observe(eventList, { childList: true });

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
