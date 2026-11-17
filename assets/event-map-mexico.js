(() => {
    const section = document.querySelector('[data-mexico-event-map]');
    if (!section) return;

    const svgNode = section.querySelector('[data-mexico-map-svg]');
    const loading = section.querySelector('[data-mexico-map-loading]');
    const detailTitle = section.querySelector('[data-mexico-detail-title]');
    const detailDates = section.querySelector('[data-mexico-detail-dates]');
    const detailVenue = section.querySelector('[data-mexico-detail-venue]');
    const detailCity = section.querySelector('[data-mexico-detail-city]');
    const detailSource = section.querySelector('[data-mexico-detail-source]');
    const list = section.querySelector('[data-mexico-event-list]');
    const empty = section.querySelector('[data-mexico-empty]');
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
        // Event dates are announced in JST, not in the visitor's time zone.
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(date);
        const get = type => Number(parts.find(part => part.type === type)?.value || 0);
        return new Date(get('year'), get('month') - 1, get('day'));
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
            detailTitle.textContent = 'No Mexican MMA events in this range';
            selectedId = '';
            renderPinSelection();
            renderListSelection();
            detailDates.textContent = '';
            detailVenue.textContent = '';
            detailCity.textContent = '';
            detailSource.hidden = true;
            return;
        }
        selectedId = event.id;
        detailTitle.textContent = normalize(event.title) || 'Mexican MMA Event';
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
        pinLayer.selectAll('.event-map-mexico-pin')
            .attr('data-selected', venue => String(venue.events.some(event => event.id === selectedId)));
    }

    function renderListSelection() {
        list.querySelectorAll('[data-mexico-event-id]').forEach(button => {
            button.dataset.selected = String(button.dataset.mexicoEventId === selectedId);
        });
    }

    function selectVenue(venue) {
        const event = [...venue.events].sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
        if (event) renderDetail(event);
    }

    function renderPins() {
        pinLayer.selectAll('*').remove();
        const venues = groupedVenues(visibleEvents);
        const groups = pinLayer.selectAll('g.event-map-mexico-pin')
            .data(venues, venue => venue.key)
            .join('g')
            .attr('class', 'event-map-mexico-pin')
            .attr('tabindex', 0)
            .attr('role', 'button')
            .attr('aria-label', venue => {
                const first = venue.events[0];
                return `${normalize(first.venue || first.city)}, ${venue.events.length} upcoming Mexican MMA event${venue.events.length === 1 ? '' : 's'}`;
            })
            .attr('transform', venue => {
                const point = projection([venue.longitude, venue.latitude]);
                return `translate(${point[0]},${point[1]})`;
            })
            .attr('data-selected', venue => String(venue.events.some(event => event.id === selectedId)));

        groups.append('circle')
            .attr('class', 'event-map-mexico-pin-halo')
            .attr('r', 16);
        groups.append('circle')
            .attr('class', 'event-map-mexico-pin-core')
            .attr('r', 7);
        groups.filter(venue => venue.events.length > 1)
            .append('text')
            .attr('class', 'event-map-mexico-pin-count')
            .attr('y', .5)
            .text(venue => venue.events.length);
        groups.append('title').text(venue => {
            const first = venue.events[0];
            return `${normalize(first.venue || first.city)} · ${venue.events.length} upcoming event${venue.events.length === 1 ? '' : 's'}`;
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
        button.className = 'event-map-mexico-event';
        button.dataset.mexicoEventId = event.id;
        button.dataset.selected = String(event.id === selectedId);

        const title = document.createElement('strong');
        title.textContent = normalize(event.title) || 'Mexican MMA Event';
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
                ? `No events in this date range. Next: ${formatDateRange(next)} in ${normalize(next.city)}.`
                : 'No upcoming Mexican MMA events are currently listed.';
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
        renderDetail(visibleEvents.find(event => event.id === selectedId) || null);
    }

    // This dedicated feed contains only confirmed Mexican MMA schedules.
    // A city is required; all plotted coordinates are explicitly marked as city centroids.
    function isMexicoMmaEvent(event) {
        if (!event || !normalize(event.id) || !normalize(event.city)) return false;
        const sport = normalize(event.sport).toLowerCase();
        if (sport && sport !== 'mma' && sport !== 'mixed martial arts') return false;
        if (!/^(mexico|méxico|mx)$/i.test(normalize(event.country))) return false;
        const latitude = Number(event.latitude);
        const longitude = Number(event.longitude);
        return Number.isFinite(latitude) && Number.isFinite(longitude) &&
            latitude >= 14 && latitude <= 33 && longitude >= -118 && longitude <= -86;
    }

    async function init() {
        try {
            const [d3Module, topoModule, world, eventData] = await Promise.all([
                import('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm'),
                import('https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm'),
                fetch('https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json').then(response => {
                    if (!response.ok) throw new Error('Mexico map boundary request failed');
                    return response.json();
                }),
                fetch(eventsUrl, { cache: 'no-store' }).then(response => {
                    if (!response.ok) throw new Error('Event feed request failed');
                    return response.json();
                })
            ]);

            d3 = d3Module;
            const countries = topoModule.feature(world, world.objects.countries).features;
            const mexico = countries.find(feature => String(feature.id) === '484');
            if (!mexico) throw new Error('Mexico map feature not found');

            projection = d3.geoMercator().fitExtent([[34, 26], [WIDTH - 34, HEIGHT - 26]], mexico);
            const path = d3.geoPath(projection);
            const svg = d3.select(svgNode);
            svg.append('path')
                .datum(mexico)
                .attr('class', 'event-map-mexico-land')
                .attr('d', path);
            pinLayer = svg.append('g').attr('class', 'event-map-mexico-pins');

            const today = localDay();
            allEvents = (Array.isArray(eventData?.events) ? eventData.events : [])
                .filter(isMexicoMmaEvent)
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
            loading.textContent = 'Mexican MMA map is temporarily unavailable.';
            console.error('Mexican MMA event map failed to initialize', error);
        }
    }

    init();
})();
