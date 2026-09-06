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