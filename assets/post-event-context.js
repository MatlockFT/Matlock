(() => {
    const post = document.querySelector('.post-page');
    const titleNode = post?.querySelector('#post-title');
    if (!post || !titleNode) return;

    const normalize = value => String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    const STOP = new Set([
        'ufc', 'fight', 'night', 'vs', 'v', 'the', 'and', 'at', 'in', 'on',
        'mma', 'breakdown', 'prediction', 'predictions', 'preview', 'results'
    ]);

    const words = value => normalize(value)
        .split(' ')
        .filter(word => word.length > 2 && !STOP.has(word));

    const postTitle = normalize(titleNode.textContent);
    if (!postTitle) return;

    function eventScore(event) {
        const eventText = normalize(`${event?.promotion || ''} ${event?.title || ''}`);
        const eventWords = [...new Set(words(eventText))];
        let score = 0;

        const numbered = String(event?.id || '').match(/\bufc-(\d{2,3})\b/i);
        if (numbered && new RegExp(`\\bufc\\s*${numbered[1]}\\b`, 'i').test(postTitle)) score += 12;

        for (const word of eventWords) {
            if (new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(postTitle)) score += 2;
        }

        if (event?.title && postTitle.includes(normalize(event.title))) score += 8;
        return score;
    }

    function render(event, pickerAvailable) {
        if (!event?.id || post.querySelector('[data-post-event-context]')) return;
        const section = document.createElement('aside');
        section.className = 'post-event-context';
        section.setAttribute('data-post-event-context', '');
        section.setAttribute('aria-label', 'Related live event tools');

        const copy = document.createElement('div');
        const strong = document.createElement('strong');
        strong.textContent = [event.promotion, event.title].filter(Boolean).join(' · ');
        copy.append(strong);

        const actions = document.createElement('div');
        actions.className = 'post-event-context-actions';

        const map = document.createElement('a');
        map.href = `/event-map/?event=${encodeURIComponent(event.id)}`;
        map.textContent = 'Event map';
        actions.append(map);

        if (pickerAvailable) {
            const picks = document.createElement('a');
            picks.href = `/upcoming-events/#${encodeURIComponent(event.id)}`;
            picks.textContent = 'Make picks';
            actions.prepend(picks);
        }

        section.append(copy, actions);
        const anchor = post.querySelector('.post-featured-image') || post.querySelector('.post-header');
        anchor?.insertAdjacentElement('afterend', section);
    }

    fetch('/assets/data/event-map-live.json', { cache: 'force-cache' })
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then(data => {
            const events = Array.isArray(data?.events) ? data.events : [];
            const pickerIds = new Set((data?.picker_event_ids || []).map(String));
            const ranked = events
                .map(event => ({ event, score: eventScore(event) }))
                .filter(item => item.score >= 6)
                .sort((a, b) => b.score - a.score);
            if (!ranked.length) return;
            const best = ranked[0];
            if (ranked[1] && ranked[1].score === best.score && best.score < 10) return;
            const id = String(best.event.id || '');
            render(best.event, pickerIds.has(id));
        })
        .catch(() => {});
})();
