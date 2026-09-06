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

    function titleMatchup(title) {
        const text = clean(title)
            .replace(/\s+-\s+\d{1,2}\/\d{1,2}\s*$/i, '')
            .replace(/\s+\|.*$/, '');
        const afterColon = text.includes(':') ? text.split(':').slice(1).join(':').trim() : text;
        const match = afterColon.match(/^(.{2,70}?)\s+(?:vs\.?|v\.)\s+(.{2,70}?)(?:\s+[–—-]\s+.*)?$/i);
        if (!match) return null;
        return [clean(match[1]), clean(match[2])];
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
            const fighters = (bout?.fighters || []).map(item => clean(item?.name || item)).filter(Boolean).slice(0, 2);
            return {
                fighters,
                weight: clean(bout?.weight_class || bout?.weight || bout?.division) || weightFromText(bout?.label)
            };
        }

        const stored = event?.main_event;
        if (stored && typeof stored === 'object') {
            const fighters = (stored.fighters || []).map(item => clean(item?.name || item)).filter(Boolean).slice(0, 2);
            return {
                fighters,
                weight: clean(stored.weight_class || stored.weight || stored.division) || weightFromText(event?.title)
            };
        }

        const inferred = titleMatchup(event?.title);
        return {
            fighters: inferred || [],
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
        const url = posterUrl(event);
        if (!posterWrap || !poster) return;
        if (!url) {
            posterWrap.hidden = true;
            poster.removeAttribute('src');
            return;
        }
        posterWrap.hidden = false;
        poster.alt = `${clean(event.promotion) || 'MMA'} ${clean(event.title) || 'event'} poster`;
        poster.src = url;
        poster.onerror = () => {
            posterWrap.hidden = true;
            poster.removeAttribute('src');
        };
    }

    function renderDetails() {
        if (detailCard.hidden) return;
        const event = findCurrentEvent();
        if (!event) {
            fightersNode.textContent = 'Main event not yet listed';
            weightNode.textContent = 'Weight class not yet listed';
            if (posterWrap) posterWrap.hidden = true;
            return;
        }
        const bout = mainBout(event);
        fightersNode.textContent = bout.fighters.length >= 2
            ? `${bout.fighters[0]} vs. ${bout.fighters[1]}`
            : 'Main event not yet listed';
        weightNode.textContent = bout.weight || 'Weight class not yet listed';
        renderPoster(event);
    }

    function enhanceClusterRows() {
        if (!clusterList) return;
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
        if (selectedFromUrl()) {
            lockNode.textContent = 'Selected · details locked';
            lockNode.dataset.locked = 'true';
        } else {
            lockNode.textContent = 'Hover preview · click/tap to lock';
            lockNode.dataset.locked = 'false';
        }
    }

    const observer = new MutationObserver(() => {
        renderDetails();
        enhanceClusterRows();
        updateLockLabel();
    });
    observer.observe(page, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });

    window.addEventListener('popstate', updateLockLabel);
    page.addEventListener('pointerup', () => setTimeout(updateLockLabel, 0));
    page.addEventListener('click', () => setTimeout(updateLockLabel, 0));

    fetch(page.dataset.eventsUrl, { cache: 'no-store' })
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then(data => {
            events = Array.isArray(data?.events) ? data.events : [];
            renderDetails();
            enhanceClusterRows();
            updateLockLabel();
        })
        .catch(error => console.warn('Event Map detail enrichment unavailable', error));
})();
