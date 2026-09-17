(() => {
    const section = document.querySelector('[data-sumo-event-map]');
    if (!section) return;

    const svgNode = section.querySelector('[data-sumo-map-svg]');
    const loading = section.querySelector('[data-sumo-map-loading]');
    const detailTitle = section.querySelector('[data-sumo-detail-title]');
    const detailDates = section.querySelector('[data-sumo-detail-dates]');
    const detailVenue = section.querySelector('[data-sumo-detail-venue]');
    const detailCity = section.querySelector('[data-sumo-detail-city]');
    const detailSource = section.querySelector('[data-sumo-detail-source]');
    const list = section.querySelector('[data-sumo-event-list]');
    const empty = section.querySelector('[data-sumo-empty]');
    const rangeButtons = [...document.querySelectorAll('[data-event-map] [data-range]')];
    const eventsUrl = section.dataset.eventsUrl;

    if (!svgNode || !eventsUrl) return;

    const WIDTH = 720;
    const HEIGHT = 440;
    const DAY_MS = 86400000;
    let d3;
    let projection;
    let pinLayer;
    let allEvents = [];
    let visibleEvents = [];
    let selectedId = '';

    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();

    function localDay(date = new Date()) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function parseDay(value) {
        if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
        const [year, month, day] = value.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    function eventRange() {
        const pressed = rangeButtons.find(button => button.getAttribute('aria-pressed') === 'true');
        return pressed?.dataset.range || new URLSearchParams(window.location.search).get('range') || 'week';
    }

    function withinRange(event) {
        const start = parseDay(event.date);
        if (!start) return false;
        const range = eventRange();
        if (range === 'all') return start >= localDay();
        const days = range === '30' ? 30 : 7;
        const today = localDay();
        const end = new Date(today.getTime() + days * DAY_MS);
        return start >= today && start < end;
    }

    function formatSingleDay(date) {
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatDateRange(event) {
        const start = parseDay(event.date);
        const end = parseDay(event.end_date);
        if (!start) return 'Date TBA';
        if (!end) return formatSingleDay(start);
        if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
            return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
        }
        return `${formatSingleDay(start)} – ${formatSingleDay(end)}`;
    }

    function locationLabel(event) {
        return [normalize(event.city), normalize(event.country)].filter(Boolean).join(', ');
    }

    function venueKey(event) {
        return `${Number(event.latitude).toFixed(4)}|${Number(event.longitude).toFixed(4)}`;
    }

    function groupedVenues(events) {
        const venues = new Map();
        events.forEach(event => {
            const latitude = Number(event.latitude);
            const longitude = Number(event.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            const key = venueKey(event);
            if (!venues.has(key)) {
                venues.set(key, { key, latitude, longitude, events: [] });
            }
            venues.get(key).events.push(event);
        });
        return [...venues.values()];
    }

    function renderDetail(event) {
        if (!event) {
            detailTitle.textContent = 'No Grand Sumo tournament in this range';
            detailDates.textContent = '';
            detailVenue.textContent = '';
            detailCity.textContent = '';
            detailSource.hidden = true;
            return;
        }
        selectedId = event.id;
        detailTitle.textContent = normalize(event.title) || 'Grand Sumo Tournament';
        detailDates.textContent = formatDateRange(event);
        detailVenue.textContent = normalize(event.venue);
        detailCity.textContent = locationLabel(event);
        detailSource.hidden = !event.official_url;
        detailSource.href = event.official_url || '#';
        renderPinSelection();
        renderListSelection();
    }

    function renderPinSelection() {
        if (!pinLayer) return;
        pinLayer.selectAll('.event-map-sumo-pin')
            .attr('data-selected', venue => String(venue.events.some(event => event.id === selectedId)));
    }

    function renderListSelection() {
        list.querySelectorAll('[data-sumo-event-id]').forEach(button => {
            button.dataset.selected = String(button.dataset.sumoEventId === selectedId);
        });
    }

    function selectVenue(venue) {
        const event = [...venue.events].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
        if (event) renderDetail(event);
    }

    function renderPins() {
        pinLayer.selectAll('*').remove();
        const venues = groupedVenues(visibleEvents);
        const groups = pinLayer.selectAll('g.event-map-sumo-pin')
            .data(venues, venue => venue.key)
            .join('g')
            .attr('class', 'event-map-sumo-pin')
            .attr('tabindex', 0)
            .attr('role', 'button')
            .attr('aria-label', venue => {
                const first = venue.events[0];
                return `${normalize(first.venue)}, ${venue.events.length} upcoming Grand Sumo tournament${venue.events.length === 1 ? '' : 's'}`;
            })
            .attr('transform', venue => {
                const point = projection([venue.longitude, venue.latitude]);
                return `translate(${point[0]},${point[1]})`;
            })
            .attr('data-selected', venue => String(venue.events.some(event => event.id === selectedId)));

        groups.append('circle')
            .attr('class', 'event-map-sumo-pin-halo')
            .attr('r', 16);
        groups.append('circle')
            .attr('class', 'event-map-sumo-pin-core')
            .attr('r', 7);
        groups.filter(venue => venue.events.length > 1)
            .append('text')
            .attr('class', 'event-map-sumo-pin-count')
            .attr('y', .5)
            .text(venue => venue.events.length);
        groups.append('title').text(venue => {
            const first = venue.events[0];
            return `${normalize(first.venue)} · ${venue.events.length} upcoming tournament${venue.events.length === 1 ? '' : 's'}`;
        });

        groups.on('click', (_, venue) => selectVenue(venue));
        groups.on('keydown', (event, venue) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            selectVenue(venue);
        });
    }

    function makeEventButton(event) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'event-map-sumo-event';
        button.dataset.sumoEventId = event.id;
        button.dataset.selected = String(event.id === selectedId);

        const title = document.createElement('strong');
        title.textContent = normalize(event.title) || 'Grand Sumo Tournament';
        const meta = document.createElement('span');
        meta.textContent = `${formatDateRange(event)} · ${normalize(event.city)}`;
        button.append(title, meta);
        button.addEventListener('click', () => renderDetail(event));
        return button;
    }

    function renderList() {
        list.replaceChildren();
        if (!visibleEvents.length) {
            empty.hidden = false;
            const next = allEvents[0];
            empty.textContent = next
                ? `No tournament begins in this range. Next: ${formatDateRange(next)} in ${normalize(next.city)}.`
                : 'No upcoming Grand Sumo tournaments are currently listed.';
            return;
        }
        empty.hidden = true;
        visibleEvents.forEach(event => list.append(makeEventButton(event)));
    }

    function refreshRange() {
        visibleEvents = allEvents.filter(withinRange);
        if (!visibleEvents.some(event => event.id === selectedId)) {
            selectedId = visibleEvents[0]?.id || '';
        }
        renderPins();
        renderList();
        renderDetail(visibleEvents.find(event => event.id === selectedId) || allEvents[0] || null);
    }

    async function init() {
        try {
            const [d3Module, topoModule, world, eventData] = await Promise.all([
                import('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm'),
                import('https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm'),
                fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json').then(response => {
                    if (!response.ok) throw new Error('Japan map boundary request failed');
                    return response.json();
                }),
                fetch(eventsUrl, { cache: 'no-store' }).then(response => {
                    if (!response.ok) throw new Error('Event feed request failed');
                    return response.json();
                })
            ]);

            d3 = d3Module;
            const countries = topoModule.feature(world, world.objects.countries).features;
            const japan = countries.find(feature => String(feature.id) === '392');
            if (!japan) throw new Error('Japan map feature not found');

            projection = d3.geoMercator().fitExtent([[34, 26], [WIDTH - 34, HEIGHT - 26]], japan);
            const path = d3.geoPath(projection);
            const svg = d3.select(svgNode);
            svg.append('path')
                .datum(japan)
                .attr('class', 'event-map-sumo-land')
                .attr('d', path);
            pinLayer = svg.append('g').attr('class', 'event-map-sumo-pins');

            const today = localDay();
            allEvents = (Array.isArray(eventData?.events) ? eventData.events : [])
                .filter(event => event?.promotion_key === 'sumo' || String(event?.sport || '').toLowerCase() === 'sumo')
                .filter(event => {
                    const date = parseDay(event.date);
                    return date && date >= today;
                })
                .sort((a, b) => String(a.date).localeCompare(String(b.date)));

            rangeButtons.forEach(button => button.addEventListener('click', () => setTimeout(refreshRange, 0)));
            window.addEventListener('popstate', refreshRange);
            refreshRange();
            loading.hidden = true;
        } catch (error) {
            loading.textContent = 'Grand Sumo map is temporarily unavailable.';
            console.error('Grand Sumo event map failed to initialize', error);
        }
    }

    init();
})();
