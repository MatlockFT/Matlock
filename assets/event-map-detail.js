(() => {
    const page = document.querySelector('[data-event-map]');
    if (!page) return;

    const detailCard = page.querySelector('[data-event-detail-card]');
    const titleNode = page.querySelector('[data-detail-title]');
    const promotionNode = page.querySelector('[data-detail-promotion]');
    const dateNode = page.querySelector('[data-detail-date]');
    const fightersNode = page.querySelector('[data-detail-fighters]');
    const weightNode = page.querySelector('[data-detail-weight]');
    const posterWrap = page.querySelector('[data-detail-poster-wrap]');
    const posterNode = page.querySelector('[data-detail-poster]');
    const pickerLink = page.querySelector('[data-detail-picker]');

    if (!detailCard || !titleNode || !weightNode || !posterWrap || !posterNode || !pickerLink) return;

    const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
    const norm = value => clean(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    let events = [];
    let pickerEvents = [];
    let overrides = {};
    let loadPromise = null;
    let posterRequest = 0;

    function canonicalPromotion(value) {
        const text = norm(value);
        if (/^(ultimate fighting championship|ufc)\b/.test(text)) return 'ufc';
        if (/^(legacy fighting alliance|lfa)\b/.test(text)) return 'lfa';
        if (/^(cage fury fighting championships|cffc)\b/.test(text)) return 'cffc';
        if (/^(professional fighters league|pfl)\b/.test(text)) return 'pfl';
        if (/^rizin\b/.test(text)) return 'rizin';
        if (/^(one championship|one)\b/.test(text)) return 'one';
        if (/^(dana whites contender series|dwcs)\b/.test(text)) return 'dwcs';
        return text.replace(/\b\d+\b.*$/, '').trim();
    }

    function eventNumber(value) {
        return norm(value).match(/\b(\d{1,4})\b/)?.[1] || '';
    }

    function mergedEvent(event) {
        if (!event) return null;
        const override = overrides[event.id] || {};
        return {
            ...event,
            ...override,
            main_event: override.main_event
                ? { ...(event.main_event || {}), ...override.main_event }
                : event.main_event
        };
    }

    function findCurrentEvent() {
        const title = norm(titleNode.textContent);
        const promotion = canonicalPromotion(promotionNode?.textContent);
        const dateIso = dateNode?.dateTime ? String(dateNode.dateTime).slice(0, 10) : '';
        if (!title) return null;

        const exact = events.find(event =>
            norm(event.title) === title
            && (!promotion || canonicalPromotion(event.promotion) === promotion)
            && (!dateIso || !event.date || event.date === dateIso)
        );
        if (exact) return mergedEvent(exact);

        const titleAndDate = events.find(event =>
            norm(event.title) === title
            && (!dateIso || !event.date || event.date === dateIso)
        );
        if (titleAndDate) return mergedEvent(titleAndDate);

        return mergedEvent(events.find(event => norm(event.title) === title) || null);
    }

    function tidyWeight() {
        const value = clean(weightNode.textContent);
        const missing = !value || /^(?:weight\s*class\s*)?(?:not\s+(?:yet\s+)?listed|tba|unknown|n\/?a)$/i.test(value);

        if (missing) {
            weightNode.hidden = true;
            if (value) weightNode.textContent = '';
            return;
        }

        weightNode.hidden = false;
    }

    function usablePoster(url) {
        const value = clean(url);
        if (!/^https?:\/\//i.test(value)) return '';
        if (/(?:tribe[-_]?loading|loading(?:[-_.]|$)|spinner|preloader|placeholder|blank\.gif|transparent\.gif|favicon|logo(?:[-_.]|$))/i.test(value)) return '';
        return value;
    }

    function hidePoster() {
        posterRequest += 1;
        posterWrap.hidden = true;
        posterWrap.dataset.posterReady = 'false';
        posterNode.removeAttribute('src');
        posterNode.alt = '';
    }

    function renderPoster(event) {
        const requestId = ++posterRequest;
        posterWrap.hidden = true;
        posterWrap.dataset.posterReady = 'false';
        posterNode.removeAttribute('src');
        posterNode.alt = '';

        const url = usablePoster(event?.poster || event?.poster_url || event?.image || event?.image_url);
        if (!url) return;

        const probe = new Image();
        probe.decoding = 'async';
        probe.referrerPolicy = 'no-referrer';
        probe.onload = () => {
            if (requestId !== posterRequest) return;
            if (probe.naturalWidth < 180 || probe.naturalHeight < 120) return;

            posterNode.src = url;
            posterNode.alt = `${clean(event.promotion) || 'MMA'} ${clean(event.title) || 'event'} poster`;
            posterWrap.dataset.posterReady = 'true';
            posterWrap.hidden = false;
        };
        probe.onerror = () => {
            if (requestId === posterRequest) hidePoster();
        };
        probe.src = url;
    }

    function pickerIdFor(event) {
        if (!event || !pickerEvents.length) return '';

        const direct = pickerEvents.find(item => item.id === event.id || item.id === event.mapId);
        if (direct) return direct.id;

        const title = norm(event.title);
        const date = clean(event.date);
        const promotion = canonicalPromotion(event.promotion);
        const number = eventNumber(event.title);

        const exact = pickerEvents.find(item =>
            norm(item.title) === title
            && (!date || item.date === date)
        );
        if (exact) return exact.id;

        const samePromotionDate = pickerEvents.filter(item =>
            (!date || item.date === date)
            && (!promotion || canonicalPromotion(item.promotion) === promotion)
        );

        if (number) {
            const numbered = samePromotionDate.find(item => eventNumber(item.title) === number);
            if (numbered) return numbered.id;
        }

        return samePromotionDate.length === 1 ? samePromotionDate[0].id : '';
    }

    function renderPicker(event) {
        const pickerId = pickerIdFor(event);
        pickerLink.hidden = !pickerId;
        if (!pickerId) {
            pickerLink.href = '/upcoming-events/';
            return;
        }

        const encoded = encodeURIComponent(pickerId);
        pickerLink.href = `/upcoming-events/?event=${encoded}#${encoded}`;
    }

    function render() {
        tidyWeight();

        if (detailCard.hidden) {
            hidePoster();
            pickerLink.hidden = true;
            return;
        }

        if (!events.length) return;
        const event = findCurrentEvent();
        if (!event) {
            hidePoster();
            pickerLink.hidden = true;
            return;
        }

        const overrideBout = event.main_event;
        if (overrideBout?.fighters?.length >= 2 && fightersNode) {
            fightersNode.textContent = `${clean(overrideBout.fighters[0]?.name || overrideBout.fighters[0])} vs. ${clean(overrideBout.fighters[1]?.name || overrideBout.fighters[1])}`;
        }
        if (overrideBout?.weight_class) {
            weightNode.textContent = clean(overrideBout.weight_class);
        }
        tidyWeight();
        renderPoster(event);
        renderPicker(event);
    }

    function ensureData() {
        if (loadPromise) return loadPromise;
        loadPromise = fetch(page.dataset.eventsUrl, { cache: 'no-store' })
            .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
            .then(data => {
                events = Array.isArray(data?.events) ? data.events : [];
                pickerEvents = Array.isArray(data?.picker_events) ? data.picker_events : [];
                overrides = data?.event_overrides && typeof data.event_overrides === 'object'
                    ? data.event_overrides
                    : {};
                return data;
            })
            .catch(error => {
                console.warn('Event Map detail controller unavailable', error);
                return null;
            });
        return loadPromise;
    }

    let queued = false;
    function queueRender() {
        if (queued) return;
        queued = true;
        queueMicrotask(() => {
            queued = false;
            if (detailCard.hidden) {
                render();
                return;
            }
            ensureData().then(render);
        });
    }

    const observer = new MutationObserver(queueRender);
    observer.observe(detailCard, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(titleNode, { childList: true, characterData: true, subtree: true });
    if (promotionNode) observer.observe(promotionNode, { childList: true, characterData: true, subtree: true });
    if (dateNode) observer.observe(dateNode, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['datetime']
    });

    tidyWeight();
    if (!detailCard.hidden) queueRender();
})();