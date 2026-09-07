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
        let left = Math.max(8, Math.min(centerX - width / 2, stageRect.width - width - 8));
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
