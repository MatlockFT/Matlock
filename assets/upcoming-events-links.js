(() => {
    const page = document.querySelector('.upcoming-events-page[data-event-map-url]');
    if (!page) return;

    const links = [...page.querySelectorAll('[data-picker-map-link][data-event-id]')];
    if (!links.length) return;

    fetch(page.dataset.eventMapUrl, { cache: 'force-cache' })
        .then(response => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then(data => {
            const eventIds = new Set();
            for (const event of data?.events || []) {
                if (event?.id) eventIds.add(String(event.id));
            }
            for (const id of data?.picker_event_ids || []) {
                if (id) eventIds.add(String(id));
            }

            links.forEach(link => {
                const id = link.dataset.eventId;
                if (!id || !eventIds.has(id)) return;
                link.href = `/event-map/?event=${encodeURIComponent(id)}`;
                link.hidden = false;
            });
        })
        .catch(() => {});
})();
