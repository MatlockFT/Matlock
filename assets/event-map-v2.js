(() => {
    const page = document.querySelector('[data-event-map]');
    if (!page) return;

    const svgNode = page.querySelector('[data-map-svg]');
    const loading = page.querySelector('[data-map-loading]');
    const eventCount = page.querySelector('[data-event-count]');
    const stateFilter = page.querySelector('[data-state-filter]');
    const promotionFilter = page.querySelector('[data-promotion-filter]');
    const levelFilter = page.querySelector('[data-level-filter]');
    const searchInput = page.querySelector('[data-event-search]');
    const rangeButtons = [...page.querySelectorAll('[data-range]')];
    const resetButton = page.querySelector('[data-map-reset]');
    const nearButton = page.querySelector('[data-near-me]');
    const radiusFilter = page.querySelector('[data-radius-filter]');
    const nearStatus = page.querySelector('[data-near-status]');
    const zoomInButton = page.querySelector('[data-map-zoom-in]');
    const zoomOutButton = page.querySelector('[data-map-zoom-out]');
    const detailPanel = page.querySelector('[data-event-detail]');
    const detailEmpty = page.querySelector('[data-event-detail-empty]');
    const detailCard = page.querySelector('[data-event-detail-card]');
    const detailPromotion = page.querySelector('[data-detail-promotion]');
    const detailDate = page.querySelector('[data-detail-date]');
    const detailTitle = page.querySelector('[data-detail-title]');
    const detailFighters = page.querySelector('[data-detail-fighters]');
    const detailWeight = page.querySelector('[data-detail-weight]');
    const detailPosterWrap = page.querySelector('[data-detail-poster-wrap]');
    const detailPoster = page.querySelector('[data-detail-poster]');
    const detailLock = page.querySelector('[data-detail-lock-state]');
    const detailLocation = page.querySelector('[data-detail-location]');
    const detailDistance = page.querySelector('[data-detail-distance]');
    const detailVenue = page.querySelector('[data-detail-venue]');
    const detailBroadcast = page.querySelector('[data-detail-broadcast]');
    const detailTickets = page.querySelector('[data-detail-tickets]');
    const detailSource = page.querySelector('[data-detail-source]');
    const detailCalendar = page.querySelector('[data-detail-calendar]');
    const detailShare = page.querySelector('[data-detail-share]');
    const detailPicker = page.querySelector('[data-detail-picker]');
    const clusterCard = page.querySelector('[data-cluster-card]');
    const clusterCount = page.querySelector('[data-cluster-count]');
    const clusterTitle = page.querySelector('[data-cluster-title]');
    const clusterList = page.querySelector('[data-cluster-list]');
    const summaryCount = page.querySelector('[data-summary-count]');
    const summaryNext = page.querySelector('[data-summary-next]');
    const summaryNear = page.querySelector('[data-summary-near]');
    const resultsCount = page.querySelector('[data-results-count]');
    const eventList = page.querySelector('[data-event-list]');
    const eventListEmpty = page.querySelector('[data-event-list-empty]');

    const WIDTH = 960;
    const HEIGHT = 600;
    const DAY_MS = 86400000;
    const SOON_MS = 7 * DAY_MS;
    const DEFAULT_RADIUS = 250;
    const eventsUrl = page.dataset.eventsUrl;

    const STATES = {
        AL: ['Alabama', '01'], AK: ['Alaska', '02'], AZ: ['Arizona', '04'], AR: ['Arkansas', '05'],
        CA: ['California', '06'], CO: ['Colorado', '08'], CT: ['Connecticut', '09'], DE: ['Delaware', '10'],
        DC: ['District of Columbia', '11'], FL: ['Florida', '12'], GA: ['Georgia', '13'], HI: ['Hawaii', '15'],
        ID: ['Idaho', '16'], IL: ['Illinois', '17'], IN: ['Indiana', '18'], IA: ['Iowa', '19'],
        KS: ['Kansas', '20'], KY: ['Kentucky', '21'], LA: ['Louisiana', '22'], ME: ['Maine', '23'],
        MD: ['Maryland', '24'], MA: ['Massachusetts', '25'], MI: ['Michigan', '26'], MN: ['Minnesota', '27'],
        MS: ['Mississippi', '28'], MO: ['Missouri', '29'], MT: ['Montana', '30'], NE: ['Nebraska', '31'],
        NV: ['Nevada', '32'], NH: ['New Hampshire', '33'], NJ: ['New Jersey', '34'], NM: ['New Mexico', '35'],
        NY: ['New York', '36'], NC: ['North Carolina', '37'], ND: ['North Dakota', '38'], OH: ['Ohio', '39'],
        OK: ['Oklahoma', '40'], OR: ['Oregon', '41'], PA: ['Pennsylvania', '42'], RI: ['Rhode Island', '44'],
        SC: ['South Carolina', '45'], SD: ['South Dakota', '46'], TN: ['Tennessee', '47'], TX: ['Texas', '48'],
        UT: ['Utah', '49'], VT: ['Vermont', '50'], VA: ['Virginia', '51'], WA: ['Washington', '53'],
        WV: ['West Virginia', '54'], WI: ['Wisconsin', '55'], WY: ['Wyoming', '56']
    };

    const STATE_BY_FIPS = new Map();
    Object.entries(STATES).forEach(([code, [, fips]]) => {
        STATE_BY_FIPS.set(String(Number(fips)), code);
        STATE_BY_FIPS.set(fips, code);
    });

    const CITY_COORDS = {
        'las vegas|NV': [-115.1398, 36.1699], 'los angeles|CA': [-118.2437, 34.0522],
        'anaheim|CA': [-117.9143, 33.8366], 'inglewood|CA': [-118.3531, 33.9617],
        'san diego|CA': [-117.1611, 32.7157], 'san jose|CA': [-121.8863, 37.3382],
        'sacramento|CA': [-121.4944, 38.5816], 'fresno|CA': [-119.7871, 36.7378],
        'porterville|CA': [-119.0168, 36.0652], 'pleasanton|CA': [-121.8747, 37.6624],
        'twentynine palms|CA': [-116.0542, 34.1356], 'commerce|CA': [-118.1598, 34.0006],
        'san francisco|CA': [-122.4194, 37.7749], 'oakland|CA': [-122.2711, 37.8044],
        'new york|NY': [-74.0060, 40.7128], 'brooklyn|NY': [-73.9442, 40.6782],
        'long island city|NY': [-73.9485, 40.7447], 'buffalo|NY': [-78.8784, 42.8864],
        'rochester|NY': [-77.6109, 43.1566], 'albany|NY': [-73.7562, 42.6526],
        'newark|NJ': [-74.1724, 40.7357], 'atlantic city|NJ': [-74.4229, 39.3643],
        'philadelphia|PA': [-75.1652, 39.9526], 'pittsburgh|PA': [-79.9959, 40.4406],
        'chicago|IL': [-87.6298, 41.8781], 'rosemont|IL': [-87.8556, 41.9953],
        'rockford|IL': [-89.0940, 42.2711], 'aurora|IL': [-88.3201, 41.7606],
        'austin|TX': [-97.7431, 30.2672], 'dallas|TX': [-96.7970, 32.7767],
        'fort worth|TX': [-97.3308, 32.7555], 'arlington|TX': [-97.1081, 32.7357],
        'houston|TX': [-95.3698, 29.7604], 'san antonio|TX': [-98.4936, 29.4241],
        'el paso|TX': [-106.4850, 31.7619], 'laredo|TX': [-99.5075, 27.5306],
        'corpus christi|TX': [-97.3964, 27.8006], 'wichita falls|TX': [-98.4934, 33.9137],
        'midland|TX': [-102.0779, 31.9973], 'denver|CO': [-104.9903, 39.7392],
        'broomfield|CO': [-105.0867, 39.9205], 'pueblo|CO': [-104.6091, 38.2544],
        'phoenix|AZ': [-112.0740, 33.4484], 'glendale|AZ': [-112.1860, 33.5387],
        'scottsdale|AZ': [-111.9261, 33.4942], 'tucson|AZ': [-110.9747, 32.2226],
        'miami|FL': [-80.1918, 25.7617], 'sunrise|FL': [-80.2566, 26.1669],
        'tampa|FL': [-82.4572, 27.9506], 'orlando|FL': [-81.3792, 28.5383],
        'jacksonville|FL': [-81.6557, 30.3322], 'fort lauderdale|FL': [-80.1373, 26.1224],
        'hollywood|FL': [-80.1495, 26.0112], 'valrico|FL': [-82.2529, 27.9378],
        'atlanta|GA': [-84.3880, 33.7490], 'duluth|GA': [-84.1446, 34.0029],
        'nashville|TN': [-86.7816, 36.1627], 'memphis|TN': [-90.0490, 35.1495],
        'louisville|KY': [-85.7585, 38.2527], 'newport|KY': [-84.4958, 39.0914],
        'indianapolis|IN': [-86.1581, 39.7684], 'hobart|IN': [-87.2525, 41.5323],
        'milwaukee|WI': [-87.9065, 43.0389], 'onalaska|WI': [-91.2352, 43.8844],
        'minneapolis|MN': [-93.2650, 44.9778], 'st paul|MN': [-93.0900, 44.9537],
        'prior lake|MN': [-93.4227, 44.7133], 'kansas city|MO': [-94.5786, 39.0997],
        'st louis|MO': [-90.1994, 38.6270], 'springfield|MO': [-93.2923, 37.2090],
        'lake ozark|MO': [-92.6388, 38.1986], 'st charles|MO': [-90.4812, 38.7881],
        'oklahoma city|OK': [-97.5164, 35.4676], 'tulsa|OK': [-95.9928, 36.1540],
        'new orleans|LA': [-90.0715, 29.9511], 'bossier city|LA': [-93.7321, 32.5160],
        'albuquerque|NM': [-106.6504, 35.0844], 'alamogordo|NM': [-105.9603, 32.8995],
        'salt lake city|UT': [-111.8910, 40.7608], 'sandy|UT': [-111.8841, 40.5650],
        'park city|UT': [-111.4979, 40.6461], 'seattle|WA': [-122.3321, 47.6062],
        'tacoma|WA': [-122.4443, 47.2529], 'portland|OR': [-122.6765, 45.5231],
        'boston|MA': [-71.0589, 42.3601], 'worcester|MA': [-71.8023, 42.2626],
        'plymouth|MA': [-70.6673, 41.9584], 'uncasville|CT': [-72.1098, 41.4334],
        'hartford|CT': [-72.6851, 41.7637], 'mashantucket|CT': [-71.9737, 41.4643],
        'washington|DC': [-77.0369, 38.9072], 'baltimore|MD': [-76.6122, 39.2904],
        'parkville|MD': [-76.5397, 39.3773], 'gaithersburg|MD': [-77.2014, 39.1434],
        'norfolk|VA': [-76.2859, 36.8508], 'richmond|VA': [-77.4360, 37.5407],
        'virginia beach|VA': [-75.9780, 36.8529], 'raleigh|NC': [-78.6382, 35.7796],
        'charlotte|NC': [-80.8431, 35.2271], 'greensboro|NC': [-79.7920, 36.0726],
        'fayetteville|NC': [-78.8784, 35.0527], 'charleston|SC': [-79.9311, 32.7765],
        'myrtle beach|SC': [-78.8867, 33.6891], 'omaha|NE': [-95.9345, 41.2565],
        'ralston|NE': [-96.0422, 41.2053], 'lincoln|NE': [-96.7026, 40.8136],
        'sioux falls|SD': [-96.7311, 43.5446], 'boise|ID': [-116.2023, 43.6150],
        'honolulu|HI': [-157.8583, 21.3069], 'anchorage|AK': [-149.9003, 61.2181],
        'minot|ND': [-101.2963, 48.2330], 'detroit|MI': [-83.0458, 42.3314],
        'grand rapids|MI': [-85.6681, 42.9634], 'cleveland|OH': [-81.6944, 41.4993],
        'columbus|OH': [-82.9988, 39.9612], 'cincinnati|OH': [-84.5120, 39.1031],
        'youngstown|OH': [-80.6495, 41.0998], 'akron|OH': [-81.5190, 41.0814],
        'birmingham|AL': [-86.8025, 33.5207], 'mobile|AL': [-88.0399, 30.6954],
        'biloxi|MS': [-88.8853, 30.3960], 'jackson|MS': [-90.1848, 32.2988],
        'little rock|AR': [-92.2896, 34.7465], 'fayetteville|AR': [-94.1574, 36.0626],
        'wichita|KS': [-97.3301, 37.6872], 'topeka|KS': [-95.6770, 39.0473],
        'kansas city|KS': [-94.6275, 39.1142], 'laughlin|NV': [-114.5730, 35.1678],
        'waterloo|IA': [-92.3426, 42.4928], 'ankeny|IA': [-93.6001, 41.7318],
        'rumford|ME': [-70.5509, 44.5537], 'airway heights|WA': [-117.5933, 47.6446]
    };

    let d3;
    let topojson;
    let projection;
    let geoPath;
    let root;
    let stateLayer;
    let markerLayer;
    let zoomBehavior;
    let currentTransform;
    let stateFeatures = [];
    let stateFeatureByCode = new Map();
    let allEvents = [];
    let filteredEvents = [];
    let pickerEventIds = new Set();
    let pickerEvents = [];
    let eventOverrides = {};
    let currentRange = 'all';
    let selectedEventId = '';
    let selectedClusterKey = '';
    let currentDetailEvent = null;
    let userLocation = null;
    let nearMeActive = false;
    let currentRadius = DEFAULT_RADIUS;
    let calendarObjectUrl = '';
    let initialEventId = '';
    let posterRequest = 0;

    const desktopHover = window.matchMedia('(min-width: 821px) and (hover: hover) and (pointer: fine)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');
    const normalizeText = value => String(value || '').replace(/\s+/g, ' ').trim();
    const clamp = (min, value, max) => Math.min(max, Math.max(min, value));

    function localDay(date = new Date()) {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    }

    function addCalendarDays(date, amount) {
        const next = new Date(date);
        next.setDate(next.getDate() + amount);
        return next;
    }

    function eventDate(event) {
        if (event.starts_at) {
            const precise = new Date(event.starts_at);
            if (!Number.isNaN(precise.getTime())) return precise;
        }
        if (!event.date) return null;
        const date = new Date(`${event.date}T12:00:00`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function eventCalendarDay(event) {
        if (event.date && /^20\d{2}-\d{2}-\d{2}$/.test(event.date)) {
            const [year, month, day] = event.date.split('-').map(Number);
            return new Date(year, month - 1, day);
        }
        const date = eventDate(event);
        return date ? localDay(date) : null;
    }

    function parseLocation(event) {
        const explicitState = normalizeText(event.state || event.state_code).toUpperCase();
        if (STATES[explicitState] && event.city) {
            return { city: normalizeText(event.city), stateCode: explicitState, stateName: STATES[explicitState][0] };
        }

        const source = [event.location, event.venue, event.title].filter(Boolean).join(' · ');
        let stateCode = '';
        let stateName = '';
        for (const [code, [name]] of Object.entries(STATES)) {
            const namePattern = new RegExp(`(?:,|·|\\s)\\s*${name.replace(/ /g, '\\s+')}\\b`, 'i');
            const codePattern = new RegExp(`(?:,|·|\\s)\\s*${code}\\b`, 'i');
            if (namePattern.test(source) || codePattern.test(source)) {
                stateCode = code;
                stateName = name;
                break;
            }
        }
        if (!stateCode) return null;

        const pieces = source.split('·').map(part => part.trim()).filter(Boolean);
        const locationPiece = pieces.find(part => {
            const lower = part.toLowerCase();
            return lower.includes(stateName.toLowerCase()) || new RegExp(`\\b${stateCode.toLowerCase()}\\b`).test(lower);
        }) || source;
        let city = normalizeText(locationPiece.split(',')[0]);
        if (!city || city.toLowerCase() === stateName.toLowerCase()) city = '';
        city = city.replace(/\b(?:usa|united states)\b/ig, '').trim();
        return { city, stateCode, stateName };
    }

    function stateCentroid(code) {
        const feature = stateFeatureByCode.get(code);
        if (!feature) return null;
        const point = geoPath.centroid(feature);
        return Number.isFinite(point[0]) && Number.isFinite(point[1]) ? point : null;
    }

    function levelCategory(event) {
        const level = normalizeText(event.level).toLowerCase();
        if (level.includes('pro-am') || level.includes('pro/am') || level.includes('pro am')) return 'pro-am';
        if (level.includes('amateur')) return 'amateur';
        if (level.includes('professional') || level === 'pro') return 'professional';
        if (event.regional === true) return 'regional';
        return 'professional';
    }

    function levelLabel(event) {
        const level = levelCategory(event);
        if (level === 'professional') return 'Pro';
        if (level === 'pro-am') return 'Pro / Am';
        if (level === 'amateur') return 'Amateur';
        return 'Regional';
    }

    function locateEvent(event, index) {
        const location = parseLocation(event);
        if (!location) return null;

        const longitude = Number(event.longitude ?? event.lng);
        const latitude = Number(event.latitude ?? event.lat);
        const hasSourceCoordinates = Number.isFinite(longitude) && Number.isFinite(latitude);
        const cityKey = `${location.city.toLowerCase()}|${location.stateCode}`;
        const cityCoordinates = CITY_COORDS[cityKey];
        const coordinates = hasSourceCoordinates ? [longitude, latitude] : cityCoordinates;
        let point = coordinates ? projection(coordinates) : null;
        let precision = hasSourceCoordinates ? 'source' : 'city';

        if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
            point = stateCentroid(location.stateCode);
            precision = 'state';
        }
        if (!point) return null;

        return {
            ...event,
            mapId: event.id || `event-${index}`,
            dateObject: eventDate(event),
            calendarDay: eventCalendarDay(event),
            city: location.city,
            stateCode: location.stateCode,
            stateName: location.stateName,
            locationPrecision: precision,
            levelCategory: levelCategory(event),
            geoLongitude: coordinates ? coordinates[0] : null,
            geoLatitude: coordinates ? coordinates[1] : null,
            distanceMiles: null,
            x: point[0],
            y: point[1]
        };
    }

    function canonicalPromotion(value) {
        const text = normalizeText(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
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
        return normalizeText(value).match(/\b(\d{1,4})\b/)?.[1] || '';
    }

    function mergedEvent(event) {
        if (!event) return null;
        const override = eventOverrides[event.id] || eventOverrides[event.mapId] || {};
        return {
  ...event,
  ...override,
  mapId: event.mapId,
  id: event.id,
  x: event.x,
  y: event.y,
  calendarDay: event.calendarDay,
  dateObject: event.dateObject,
  distanceMiles: event.distanceMiles,
  main_event: override.main_event
      ? { ...(event.main_event || {}), ...override.main_event }
      : event.main_event
        };
    }

    function titleMatchup(title) {
        const text = normalizeText(title)
  .replace(/\s+-\s+\d{1,2}\/\d{1,2}\s*$/i, '')
  .replace(/\s+\|.*$/, '');
        const afterColon = text.includes(':') ? text.split(':').slice(1).join(':').trim() : text;
        const match = afterColon.match(/^(.{2,70}?)\s+(?:vs\.?|v\.)\s+(.{2,70}?)(?:\s+[–—-]\s+.*)?$/i);
        return match ? [normalizeText(match[1]), normalizeText(match[2])] : [];
    }

    function weightFromText(value) {
        const text = normalizeText(value);
        const match = text.match(/\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Strawweight|Catchweight)\b/i);
        if (!match) return '';
        let weight = match[1].replace(/women'?s/i, "Women's");
        if (/\b(?:title|championship|champion|world title)\b/i.test(text) && !/title|championship/i.test(weight)) {
  weight += ' Championship';
        }
        return weight;
    }

    function mainInfo(event) {
        const sections = Array.isArray(event?.sections) ? event.sections : [];
        const bouts = sections.flatMap(section => Array.isArray(section?.bouts) ? section.bouts : []);
        if (bouts.length) {
  const bout = bouts.find(item => /main event/i.test(normalizeText(item?.label)))
      || [...bouts].sort((a, b) => Number(a?.order || 999) - Number(b?.order || 999))[0];
  return {
      fighters: (bout?.fighters || []).map(item => normalizeText(item?.name || item)).filter(Boolean).slice(0, 2),
      weight: normalizeText(bout?.weight_class || bout?.weight || bout?.division) || weightFromText(bout?.label)
  };
        }
        const stored = event?.main_event;
        if (stored && typeof stored === 'object') {
  return {
      fighters: (stored.fighters || []).map(item => normalizeText(item?.name || item)).filter(Boolean).slice(0, 2),
      weight: normalizeText(stored.weight_class || stored.weight || stored.division) || weightFromText(event?.title)
  };
        }
        return {
  fighters: titleMatchup(event?.title),
  weight: normalizeText(event?.weight_class || event?.division) || weightFromText(event?.title)
        };
    }

    function usablePoster(url) {
        const value = normalizeText(url);
        if (!/^https?:\/\//i.test(value)) return '';
        if (/(?:tribe[-_]?loading|loading(?:[-_.]|$)|spinner|preloader|placeholder|blank\.gif|transparent\.gif|favicon|logo(?:[-_.]|$))/i.test(value)) return '';
        return value;
    }

    function hidePoster() {
        posterRequest += 1;
        if (!detailPosterWrap || !detailPoster) return;
        detailPosterWrap.hidden = true;
        detailPosterWrap.dataset.posterReady = 'false';
        detailPoster.removeAttribute('src');
        detailPoster.alt = '';
    }

    function renderPoster(event) {
        if (!detailPosterWrap || !detailPoster) return;
        const requestId = ++posterRequest;
        detailPosterWrap.hidden = true;
        detailPosterWrap.dataset.posterReady = 'false';
        detailPoster.removeAttribute('src');
        detailPoster.alt = '';

        const url = usablePoster(event?.poster || event?.poster_url || event?.image || event?.image_url);
        if (!url) return;

        const probe = new Image();
        probe.decoding = 'async';
        probe.referrerPolicy = 'no-referrer';
        probe.onload = () => {
  if (requestId !== posterRequest) return;
  if (probe.naturalWidth < 180 || probe.naturalHeight < 120) return;
  detailPoster.src = url;
  detailPoster.alt = `${normalizeText(event.promotion) || 'MMA'} ${normalizeText(event.title) || 'event'} poster`;
  detailPosterWrap.dataset.posterReady = 'true';
  detailPosterWrap.hidden = false;
        };
        probe.onerror = () => {
  if (requestId === posterRequest) hidePoster();
        };
        probe.src = url;
    }

    function pickerIdFor(event) {
        if (!event) return '';
        const direct = pickerEvents.find(item => item.id === event.id || item.id === event.mapId);
        if (direct) return direct.id;

        const title = normalizeText(event.title).toLowerCase();
        const date = normalizeText(event.date);
        const promotion = canonicalPromotion(event.promotion);
        const number = eventNumber(event.title);
        const exact = pickerEvents.find(item =>
  normalizeText(item.title).toLowerCase() === title
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

    function setHoverPreview(active) {
        if (!detailPanel) return;
        detailPanel.dataset.hoverPreview = String(Boolean(active && desktopHover.matches && !selectedEventId && !selectedClusterKey));
    }

    function updateDetailLock() {
        if (!detailLock) return;
        const locked = Boolean(selectedEventId || selectedClusterKey);
        detailLock.textContent = locked ? 'Selected · details locked' : 'Hover preview · click/tap to lock';
        detailLock.dataset.locked = String(locked);
    }

    function dateLabel(event) {
        const date = event.calendarDay || event.dateObject;
        if (!date) return 'Date TBA';
        return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function shortDateLabel(event) {
        const date = event.calendarDay || event.dateObject;
        if (!date) return 'TBA';
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }

    function dateHeading(event) {
        const date = event.calendarDay || event.dateObject;
        if (!date) return 'DATE TBA';
        return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
    }

    function dateKey(event) {
        if (event.date) return event.date;
        const date = event.calendarDay || event.dateObject;
        if (!date) return '9999-TBA';
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    function isFuture(event) {
        if (!event.calendarDay) return true;
        return event.calendarDay >= localDay();
    }

    function matchesRange(event) {
        if (currentRange === 'all') return true;
        if (!event.calendarDay) return false;
        const start = localDay();
        const span = currentRange === 'week' ? 7 : currentRange === '30' ? 30 : null;
        if (!span) return true;
        const end = addCalendarDays(start, span);
        return event.calendarDay >= start && event.calendarDay < end;
    }

    function haversineMiles(lat1, lon1, lat2, lon2) {
        const toRad = value => value * Math.PI / 180;
        const earthRadiusMiles = 3958.7613;
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2
            + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return 2 * earthRadiusMiles * Math.asin(Math.sqrt(a));
    }

    function computeDistances() {
        if (!userLocation) return;
        allEvents.forEach(event => {
            if (!Number.isFinite(event.geoLatitude) || !Number.isFinite(event.geoLongitude)) {
                event.distanceMiles = null;
                return;
            }
            event.distanceMiles = haversineMiles(
                userLocation.latitude,
                userLocation.longitude,
                event.geoLatitude,
                event.geoLongitude
            );
        });
    }

    function populateCompatibilityFilters() {
        const stateCodes = [...new Set(allEvents.map(event => event.stateCode))]
            .sort((a, b) => STATES[a][0].localeCompare(STATES[b][0]));
        const promotions = [...new Set(allEvents.map(event => normalizeText(event.promotion)).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));
        stateFilter?.replaceChildren(new Option('All states', ''));
        stateCodes.forEach(code => stateFilter?.append(new Option(STATES[code][0], code)));
        promotionFilter?.replaceChildren(new Option('All promotions', ''));
        promotions.forEach(name => promotionFilter?.append(new Option(name, name)));
    }

    function normalizedRange(value) {
        if (value === 'weekend') return 'week';
        return ['week', '30', 'all'].includes(value) ? value : 'all';
    }

    function applyUrlState() {
        const params = new URLSearchParams(window.location.search);
        currentRange = normalizedRange(params.get('range'));
        initialEventId = params.get('event') || '';
        rangeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === currentRange)));
    }

    function eventMapHistoryState() {
        return {
  ...(window.history.state || {}),
  eventMap: {
      range: currentRange,
      event: selectedEventId,
      cluster: selectedClusterKey
  }
        };
    }

    function syncUrl({ mode = 'replace' } = {}) {
        const url = new URL(window.location.href);
        const params = url.searchParams;
        ['range', 'state', 'promotion', 'level', 'q', 'radius', 'event'].forEach(key => params.delete(key));
        if (currentRange !== 'all') params.set('range', currentRange);
        if (selectedEventId) params.set('event', selectedEventId);
        const target = `${url.pathname}${params.toString() ? `?${params}` : ''}${url.hash}`;
        const previous = window.history.state?.eventMap || {};
        const selectionChanged = previous.event !== selectedEventId
  || previous.cluster !== selectedClusterKey
  || previous.range !== currentRange;
        const state = eventMapHistoryState();
        if (mode === 'push' && selectionChanged) window.history.pushState(state, '', target);
        else window.history.replaceState(state, '', target);
    }

    function clusterFromKey(key) {
        const ids = new Set(String(key || '').split('|').filter(Boolean));
        if (ids.size < 2) return null;
        const events = filteredEvents.filter(event => ids.has(event.mapId));
        if (events.length < 2) return null;
        return {
  events,
  x: events.reduce((sum, event) => sum + event.x, 0) / events.length,
  y: events.reduce((sum, event) => sum + event.y, 0) / events.length
        };
    }

    function restoreHistorySelection() {
        const params = new URLSearchParams(window.location.search);
        currentRange = normalizedRange(params.get('range'));
        selectedEventId = params.get('event') || '';
        selectedClusterKey = selectedEventId ? '' : String(window.history.state?.eventMap?.cluster || '');
        rangeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === currentRange)));
        applyFilters({ sync: false });

        const event = selectedEventId
  ? filteredEvents.find(item => item.mapId === selectedEventId)
  : null;
        if (event) {
  renderEventDetail(event);
        } else if (selectedClusterKey) {
  const cluster = clusterFromKey(selectedClusterKey);
  if (cluster) renderClusterDetail(cluster);
  else {
      selectedClusterKey = '';
      showEmptyDetail();
  }
        } else {
  showEmptyDetail();
        }
        renderSelectedState();
        renderResultSelectedState();
        setHoverPreview(false);
    }

    function renderStateActivity() {
        const activeStates = new Set(filteredEvents.map(event => event.stateCode));
        stateLayer.selectAll('.event-map-state')
            .attr('data-has-events', feature => String(activeStates.has(STATE_BY_FIPS.get(String(feature.id)))));
    }

    function displayOrder(events) {
        return [...events].sort((a, b) => {
            const aTime = a.calendarDay?.getTime() ?? Infinity;
            const bTime = b.calendarDay?.getTime() ?? Infinity;
            if (aTime !== bTime) return aTime - bTime;
            if (nearMeActive) {
                const aDistance = Number.isFinite(a.distanceMiles) ? a.distanceMiles : Infinity;
                const bDistance = Number.isFinite(b.distanceMiles) ? b.distanceMiles : Infinity;
                if (aDistance !== bDistance) return aDistance - bDistance;
            }
            return normalizeText(a.title).localeCompare(normalizeText(b.title));
        });
    }

    function updateCompatibilitySummary() {
        if (summaryCount) summaryCount.textContent = String(filteredEvents.length);
        const dated = displayOrder(filteredEvents).filter(event => event.calendarDay);
        if (summaryNext) {
            summaryNext.textContent = dated[0]
                ? `Next: ${normalizeText(dated[0].promotion) || 'MMA'} · ${shortDateLabel(dated[0])} · ${dated[0].city || dated[0].stateCode}`
                : 'Next event unavailable';
        }
        if (summaryNear) {
            if (nearMeActive) {
                const nearest = filteredEvents
                    .filter(event => Number.isFinite(event.distanceMiles))
                    .sort((a, b) => a.distanceMiles - b.distanceMiles)[0];
                summaryNear.hidden = false;
                summaryNear.textContent = nearest
                    ? `${filteredEvents.length} within ${currentRadius} mi · nearest ${Math.round(nearest.distanceMiles)} mi away`
                    : `No precisely located events within ${currentRadius} mi`;
            } else {
                summaryNear.hidden = true;
                summaryNear.textContent = '';
            }
        }
    }

    function applyFilters({ sync = true } = {}) {
        currentRadius = Number(radiusFilter?.value) || DEFAULT_RADIUS;
        filteredEvents = allEvents.filter(event => {
            if (!matchesRange(event)) return false;
            if (nearMeActive && (!Number.isFinite(event.distanceMiles) || event.distanceMiles > currentRadius)) return false;
            return true;
        });

        if (eventCount) eventCount.textContent = String(filteredEvents.length);
        if (selectedEventId && !filteredEvents.some(event => event.mapId === selectedEventId)) {
            selectedEventId = '';
            selectedClusterKey = '';
            showEmptyDetail();
        }
        renderStateActivity();
        renderMarkers();
        renderResults();
        updateCompatibilitySummary();
        if (sync) syncUrl();
    }

    function clusterEvents(events) {
        const scale = currentTransform?.k || 1;
        const threshold = 26 / scale;
        const cellSize = Math.max(threshold, 1);
        const cells = new Map();
        const clusters = [];

        const cellKey = (x, y) => `${x}|${y}`;
        events.forEach(event => {
            const cx = Math.floor(event.x / cellSize);
            const cy = Math.floor(event.y / cellSize);
            let cluster = null;
            for (let dx = -1; dx <= 1 && !cluster; dx += 1) {
                for (let dy = -1; dy <= 1 && !cluster; dy += 1) {
                    const candidates = cells.get(cellKey(cx + dx, cy + dy)) || [];
                    cluster = candidates.find(candidate => Math.hypot(event.x - candidate.x, event.y - candidate.y) <= threshold) || null;
                }
            }
            if (!cluster) {
                cluster = { x: event.x, y: event.y, events: [] };
                clusters.push(cluster);
                const key = cellKey(cx, cy);
                const bucket = cells.get(key) || [];
                bucket.push(cluster);
                cells.set(key, bucket);
            }
            cluster.events.push(event);
            const count = cluster.events.length;
            cluster.x += (event.x - cluster.x) / count;
            cluster.y += (event.y - cluster.y) / count;
        });
        return clusters;
    }

    function clusterKey(cluster) {
        return cluster.events.map(event => event.mapId).sort().join('|');
    }

    function showEmptyDetail() {
        detailCard.hidden = true;
        clusterCard.hidden = true;
        detailEmpty.hidden = false;
        currentDetailEvent = null;
        hidePoster();
        setHoverPreview(false);
        updateDetailLock();
    }

    function escapeIcs(value) {
        return String(value || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    }

    function calendarHref(event) {
        if (calendarObjectUrl) URL.revokeObjectURL(calendarObjectUrl);
        const day = event.calendarDay || localDay();
        const start = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
        const endDay = addCalendarDays(day, 1);
        const end = `${endDay.getFullYear()}${String(endDay.getMonth() + 1).padStart(2, '0')}${String(endDay.getDate()).padStart(2, '0')}`;
        const summary = normalizeText(event.title) || normalizeText(event.promotion) || 'MMA event';
        const location = [normalizeText(event.venue), event.city, event.stateCode].filter(Boolean).join(', ');
        const lines = [
            'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MMA Matlock//Event Map//EN', 'BEGIN:VEVENT',
            `UID:${escapeIcs(event.mapId)}@mmamatlock.com`, `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`,
            `SUMMARY:${escapeIcs(summary)}`, `LOCATION:${escapeIcs(location)}`,
            event.official_url ? `URL:${event.official_url}` : '', 'END:VEVENT', 'END:VCALENDAR'
        ].filter(Boolean).join('\r\n');
        calendarObjectUrl = URL.createObjectURL(new Blob([lines], { type: 'text/calendar;charset=utf-8' }));
        return calendarObjectUrl;
    }

    function renderEventDetail(sourceEvent) {
        const event = mergedEvent(sourceEvent);
        if (!event) return;
        detailEmpty.hidden = true;
        clusterCard.hidden = true;
        detailCard.hidden = false;
        currentDetailEvent = event;
        detailPromotion.textContent = normalizeText(event.promotion) || 'MMA';
        detailDate.textContent = dateLabel(event);
        detailDate.dateTime = event.date || event.dateObject?.toISOString() || '';
        detailTitle.textContent = normalizeText(event.title) || normalizeText(event.promotion) || 'MMA event';

        const info = mainInfo(event);
        if (detailFighters) {
  detailFighters.textContent = info.fighters.length >= 2
      ? `${info.fighters[0]} vs. ${info.fighters[1]}`
      : 'Main event not yet listed';
        }
        if (detailWeight) {
  detailWeight.textContent = info.weight || '';
  detailWeight.hidden = !info.weight;
        }
        renderPoster(event);

        detailLocation.textContent = [event.city, event.stateCode].filter(Boolean).join(', ') || event.stateName;
        if (Number.isFinite(event.distanceMiles)) {
  detailDistance.hidden = false;
  detailDistance.textContent = `${Math.round(event.distanceMiles)} mi away`;
        } else {
  detailDistance.hidden = true;
  detailDistance.textContent = '';
        }
        const precisionNote = event.locationPrecision === 'state' ? ' · approximate state placement' : '';
        detailVenue.textContent = `${normalizeText(event.venue) || 'Venue not yet listed'}${precisionNote}`;
        detailBroadcast.textContent = event.broadcast ? `Watch: ${normalizeText(event.broadcast)}` : `${levelLabel(event)} event`;

        const sourceUrl = event.official_url || '';
        const ticketUrl = event.ticket_url || ((event.source_key === 'nitro' || /nitrotickets\.com/i.test(sourceUrl)) ? sourceUrl : '');
        detailTickets.hidden = !ticketUrl;
        detailTickets.href = ticketUrl || '#';
        detailSource.hidden = !sourceUrl || sourceUrl === ticketUrl;
        detailSource.href = sourceUrl || '#';
        detailSource.textContent = event.regional ? 'Official event page' : 'Event page';
        detailCalendar.href = calendarHref(event);
        detailCalendar.download = `${normalizeText(event.title || event.promotion || 'mma-event').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mma-event'}.ics`;

        const pickerId = pickerIdFor(event);
        detailPicker.hidden = !pickerId;
        const encodedPickerId = encodeURIComponent(pickerId);
        detailPicker.href = pickerId ? `/upcoming-events/?event=${encodedPickerId}#${encodedPickerId}` : '/upcoming-events/';
        updateDetailLock();
    }

    function renderClusterDetail(cluster) {
        detailEmpty.hidden = true;
        detailCard.hidden = true;
        clusterCard.hidden = false;
        currentDetailEvent = null;
        const ordered = displayOrder(cluster.events);
        const first = ordered[0];
        clusterCount.textContent = `${ordered.length} events`;
        clusterTitle.textContent = `Events near ${first.city || first.stateName}`;
        clusterList.replaceChildren();
        ordered.forEach(event => {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'event-map-cluster-event';
  const title = document.createElement('strong');
  title.textContent = normalizeText(event.title) || normalizeText(event.promotion) || 'MMA event';
  const meta = document.createElement('span');
  const distance = Number.isFinite(event.distanceMiles) ? ` · ${Math.round(event.distanceMiles)} mi` : '';
  meta.textContent = `${shortDateLabel(event)} · ${normalizeText(event.promotion) || 'MMA'}${distance}`;
  button.append(title, meta);

  const info = mainInfo(mergedEvent(event));
  if (info.fighters.length >= 2 || info.weight) {
      const matchup = document.createElement('span');
      matchup.className = 'event-map-cluster-matchup';
      const fighters = info.fighters.length >= 2 ? `${info.fighters[0]} vs. ${info.fighters[1]}` : 'Main event TBA';
      matchup.textContent = `${fighters}${info.weight ? ` · ${info.weight}` : ''}`;
      button.append(matchup);
  }

  button.addEventListener('click', () => selectEvent(event, { zoom: true, scroll: false }));
  clusterList.append(button);
        });
        hidePoster();
        updateDetailLock();
    }

    function scrollDetailOnMobile({ smooth = true } = {}) {
        if (!window.matchMedia('(max-width: 820px)').matches) return;
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        detailPanel.scrollIntoView({
            behavior: smooth && !reduceMotion ? 'smooth' : 'auto',
            block: 'start'
        });
    }

    function selectEvent(event, { zoom = false, scroll = true, history = 'push' } = {}) {
        const changed = selectedEventId !== event.mapId || Boolean(selectedClusterKey);
        selectedEventId = event.mapId;
        selectedClusterKey = '';
        setHoverPreview(false);
        renderEventDetail(event);
        renderSelectedState();
        renderResultSelectedState();
        syncUrl({ mode: changed ? history : 'replace' });
        if (zoom) zoomToPoint(event.x, event.y, Math.max(currentTransform?.k || 1, 3.2));
        if (scroll) scrollDetailOnMobile();
    }

    function selectCluster(cluster, { scroll = true, history = 'push' } = {}) {
        const nextKey = clusterKey(cluster);
        const changed = selectedClusterKey !== nextKey || Boolean(selectedEventId);
        selectedEventId = '';
        selectedClusterKey = nextKey;
        setHoverPreview(false);
        renderClusterDetail(cluster);
        renderSelectedState();
        renderResultSelectedState();
        syncUrl({ mode: changed ? history : 'replace' });
        if (scroll) scrollDetailOnMobile({ smooth: false });
    }

    function previewEvent(event) {
        if (selectedEventId || selectedClusterKey) return;
        setHoverPreview(true);
        renderEventDetail(event);
    }

    function previewCluster(cluster) {
        if (selectedEventId || selectedClusterKey) return;
        setHoverPreview(true);
        renderClusterDetail(cluster);
    }

    function restoreSelectedDetail() {
        setHoverPreview(false);
        const selected = filteredEvents.find(event => event.mapId === selectedEventId);
        if (selected) return renderEventDetail(selected);
        if (selectedClusterKey) {
  const cluster = clusterFromKey(selectedClusterKey);
  if (cluster) return renderClusterDetail(cluster);
        }
        showEmptyDetail();
    }

    function renderSelectedState() {
        const clusterIds = selectedClusterKey
  ? new Set(selectedClusterKey.split('|').filter(Boolean))
  : null;
        markerLayer.selectAll('.event-map-pin-group')
  .attr('data-selected', cluster => String(
      cluster.events.some(event => event.mapId === selectedEventId)
      || Boolean(clusterIds && cluster.events.some(event => clusterIds.has(event.mapId)))
  ));
    }

    function renderResultSelectedState() {
        eventList.querySelectorAll('.event-map-result').forEach(button => {
            button.dataset.selected = String(button.dataset.eventId === selectedEventId);
        });
    }

    function zoomToPoint(x, y, targetScale = 3.2) {
        const nextScale = clamp(1, targetScale, 8);
        const transform = d3.zoomIdentity.translate(WIDTH / 2, HEIGHT / 2).scale(nextScale).translate(-x, -y);
        d3.select(svgNode).transition().duration(260).call(zoomBehavior.transform, transform);
    }

    function zoomToEvents(events) {
        if (!events.length) return;
        if (events.length === 1) return zoomToPoint(events[0].x, events[0].y, 4);
        const xs = events.map(event => event.x);
        const ys = events.map(event => event.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
        const dx = Math.max(maxX - minX, 40), dy = Math.max(maxY - minY, 40);
        const x = (minX + maxX) / 2, y = (minY + maxY) / 2;
        const scale = clamp(1, 0.72 / Math.max(dx / WIDTH, dy / HEIGHT), 6);
        const transform = d3.zoomIdentity.translate(WIDTH / 2, HEIGHT / 2).scale(scale).translate(-x, -y);
        d3.select(svgNode).transition().duration(280).call(zoomBehavior.transform, transform);
    }

    function zoomToState(code) {
        const feature = stateFeatureByCode.get(code);
        if (!feature) return;
        const bounds = geoPath.bounds(feature);
        const dx = bounds[1][0] - bounds[0][0], dy = bounds[1][1] - bounds[0][1];
        const x = (bounds[0][0] + bounds[1][0]) / 2, y = (bounds[0][1] + bounds[1][1]) / 2;
        const scale = clamp(1, 0.78 / Math.max(dx / WIDTH, dy / HEIGHT), 8);
        const transform = d3.zoomIdentity.translate(WIDTH / 2, HEIGHT / 2).scale(scale).translate(-x, -y);
        d3.select(svgNode).transition().duration(260).call(zoomBehavior.transform, transform);
    }

    function renderMarkers() {
        const clusters = clusterEvents(filteredEvents);
        const scale = currentTransform?.k || 1;
        markerLayer.selectAll('*').remove();
        const groups = markerLayer.selectAll('g.event-map-pin-group')
            .data(clusters, clusterKey)
            .join('g')
            .attr('class', cluster => `event-map-pin-group${cluster.events.length > 1 ? ' event-map-cluster' : ''}`)
            .attr('tabindex', 0)
            .attr('role', 'button')
            .attr('aria-label', cluster => {
                if (cluster.events.length > 1) return `${cluster.events.length} upcoming MMA events. Activate to choose an event.`;
                const event = cluster.events[0];
                return `${normalizeText(event.promotion)} ${normalizeText(event.title)}, ${dateLabel(event)}`;
            })
            .attr('data-level', cluster => cluster.events.length > 1 ? 'cluster' : cluster.events[0].levelCategory)
            .attr('data-soon', cluster => String(cluster.events.some(event => {
                if (!event.calendarDay) return false;
                const difference = event.calendarDay.getTime() - localDay().getTime();
                return difference >= 0 && difference < SOON_MS;
            })))
            .attr('data-selected', cluster => {
      const clusterIds = selectedClusterKey
          ? new Set(selectedClusterKey.split('|').filter(Boolean))
          : null;
      return String(
          cluster.events.some(event => event.mapId === selectedEventId)
          || Boolean(clusterIds && cluster.events.some(event => clusterIds.has(event.mapId)))
      );
  })
  .attr('transform', cluster => `translate(${cluster.x},${cluster.y}) scale(${1 / scale})`);

        groups.append('circle').attr('class', 'event-map-pin-halo').attr('r', cluster => {
  if (coarsePointer.matches) return cluster.events.length > 1 ? 21 : 18;
  return cluster.events.length > 1 ? 15 : 11;
        });
        groups.append('circle').attr('class', 'event-map-pin').attr('r', cluster => cluster.events.length > 1 ? 10 : 6.5);
        groups.filter(cluster => cluster.events.length > 1)
            .append('text').attr('class', 'event-map-pin-count')
            .text(cluster => cluster.events.length > 99 ? '99+' : cluster.events.length);
        groups.append('title').text(cluster => {
            if (cluster.events.length > 1) return `${cluster.events.length} events near ${cluster.events[0].city || cluster.events[0].stateName} — click to choose`;
            const event = cluster.events[0];
            return `${normalizeText(event.promotion)} · ${normalizeText(event.title)} · ${dateLabel(event)}`;
        });

        groups
  .on('mouseenter', (_, cluster) => {
      if (!desktopHover.matches || selectedEventId || selectedClusterKey) return;
      cluster.events.length > 1 ? previewCluster(cluster) : previewEvent(cluster.events[0]);
  })
  .on('mouseleave', () => {
      if (!desktopHover.matches) return;
      restoreSelectedDetail();
  })
  .on('focus', (_, cluster) => {
      if (selectedEventId || selectedClusterKey) return;
      cluster.events.length > 1 ? previewCluster(cluster) : previewEvent(cluster.events[0]);
  })
  .on('blur', restoreSelectedDetail)
  .on('click', (event, cluster) => {
      event.stopPropagation();
      cluster.events.length > 1
          ? selectCluster(cluster)
          : selectEvent(cluster.events[0], { scroll: false });
  })
  .on('keydown', (event, cluster) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      cluster.events.length > 1
          ? selectCluster(cluster)
          : selectEvent(cluster.events[0], { scroll: false });
  });
    }

    function makeResultButton(event) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'event-map-result';
        button.dataset.eventId = event.mapId;
        button.dataset.selected = String(event.mapId === selectedEventId);

        const date = document.createElement('span');
        date.className = 'event-map-result-date';
        date.textContent = shortDateLabel(event);
        const copy = document.createElement('span');
        copy.className = 'event-map-result-copy';
        const title = document.createElement('strong');
        title.textContent = normalizeText(event.title) || normalizeText(event.promotion) || 'MMA event';
        const meta = document.createElement('span');
        meta.className = 'event-map-result-meta';
        meta.textContent = `${normalizeText(event.promotion) || 'MMA'} · ${[event.city, event.stateCode].filter(Boolean).join(', ')} · ${levelLabel(event)}`;
        copy.append(title, meta);
        button.append(date, copy);
        if (Number.isFinite(event.distanceMiles)) {
            const distance = document.createElement('span');
            distance.className = 'event-map-result-distance';
            distance.textContent = `${Math.round(event.distanceMiles)} mi`;
            button.append(distance);
        }
        button.addEventListener('click', () => selectEvent(event, { zoom: true }));
        return button;
    }

    function renderResults() {
        const ordered = displayOrder(filteredEvents);
        if (resultsCount) resultsCount.textContent = String(ordered.length);
        eventList.replaceChildren();
        eventListEmpty.hidden = ordered.length !== 0;
        if (!ordered.length) return;

        const groups = new Map();
        ordered.forEach(event => {
            const key = dateKey(event);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(event);
        });

        const fragment = document.createDocumentFragment();
        [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).forEach(([, events]) => {
            const section = document.createElement('section');
            section.className = 'event-map-date-group';
            const heading = document.createElement('h3');
            heading.className = 'event-map-date-heading';
            heading.textContent = dateHeading(events[0]);
            const rows = document.createElement('div');
            rows.className = 'event-map-date-rows';
            events.forEach(event => rows.append(makeResultButton(event)));
            section.append(heading, rows);
            fragment.append(section);
        });
        eventList.append(fragment);
    }

    function resetMap() {
        currentRange = 'all';
        currentRadius = DEFAULT_RADIUS;
        if (radiusFilter) {
            radiusFilter.value = String(DEFAULT_RADIUS);
            radiusFilter.disabled = true;
        }
        nearMeActive = false;
        nearButton.setAttribute('aria-pressed', 'false');
        nearStatus.textContent = '';
        selectedEventId = '';
        selectedClusterKey = '';
        rangeButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.range === 'all')));
        d3.select(svgNode).transition().duration(240).call(zoomBehavior.transform, d3.zoomIdentity);
        showEmptyDetail();
        applyFilters();
    }

    function setNearMode(enabled) {
        nearMeActive = enabled;
        nearButton.setAttribute('aria-pressed', String(enabled));
        if (radiusFilter) radiusFilter.disabled = !enabled;
        if (!enabled) nearStatus.textContent = userLocation ? 'Location saved for this visit' : '';
    }

    function activateNearMe() {
        if (nearMeActive) {
            setNearMode(false);
            applyFilters();
            return;
        }
        if (userLocation) {
            setNearMode(true);
            computeDistances();
            applyFilters();
            zoomToEvents(filteredEvents);
            return;
        }
        if (!('geolocation' in navigator)) {
            nearStatus.textContent = 'Location is not available in this browser';
            return;
        }
        nearStatus.textContent = 'Requesting location…';
        nearButton.disabled = true;
        navigator.geolocation.getCurrentPosition(
            position => {
                nearButton.disabled = false;
                userLocation = { latitude: position.coords.latitude, longitude: position.coords.longitude };
                computeDistances();
                setNearMode(true);
                nearStatus.textContent = 'Location active';
                applyFilters();
                zoomToEvents(filteredEvents);
            },
            error => {
                nearButton.disabled = false;
                setNearMode(false);
                nearStatus.textContent = error.code === 1 ? 'Location permission denied' : 'Could not determine location';
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
    }

    function bindControls() {
        nearButton.addEventListener('click', activateNearMe);
        rangeButtons.forEach(button => {
            button.addEventListener('click', () => {
                currentRange = button.dataset.range;
                rangeButtons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
                applyFilters();
                if (nearMeActive) zoomToEvents(filteredEvents);
            });
        });
        resetButton?.addEventListener('click', resetMap);
        zoomInButton.addEventListener('click', () => d3.select(svgNode).transition().duration(180).call(zoomBehavior.scaleBy, 1.5));
        zoomOutButton.addEventListener('click', () => d3.select(svgNode).transition().duration(180).call(zoomBehavior.scaleBy, 1 / 1.5));
        detailShare.addEventListener('click', async () => {
            if (!currentDetailEvent) return;
            const event = currentDetailEvent;
            const url = new URL(window.location.href);
            url.searchParams.set('event', event.mapId);
            const payload = {
                title: normalizeText(event.title) || normalizeText(event.promotion) || 'MMA event',
                text: `${dateLabel(event)} · ${[event.city, event.stateCode].filter(Boolean).join(', ')}`,
                url: url.toString()
            };
            try {
                if (navigator.share) await navigator.share(payload);
                else if (navigator.clipboard) {
                    await navigator.clipboard.writeText(payload.url);
                    const original = detailShare.textContent;
                    detailShare.textContent = 'Link copied';
                    setTimeout(() => { detailShare.textContent = original; }, 1400);
                }
            } catch (error) {
                if (error?.name !== 'AbortError') console.warn('Event share failed', error);
            }
        });
    }

    async function init() {
        try {
            const [d3Module, topoModule, us, eventData] = await Promise.all([
                import('https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm'),
                import('https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm'),
                fetch('https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json').then(response => {
                    if (!response.ok) throw new Error('Map boundary request failed');
                    return response.json();
                }),
                fetch(eventsUrl, { cache: 'no-store' }).then(response => {
                    if (!response.ok) throw new Error('Event feed request failed');
                    return response.json();
                })
            ]);

            d3 = d3Module;
            topojson = topoModule;
            pickerEventIds = new Set(Array.isArray(eventData?.picker_event_ids) ? eventData.picker_event_ids : []);
            pickerEvents = Array.isArray(eventData?.picker_events) ? eventData.picker_events : [];
            eventOverrides = eventData?.event_overrides && typeof eventData.event_overrides === 'object'
                ? eventData.event_overrides
                : {};
            stateFeatures = topojson.feature(us, us.objects.states).features;
            stateFeatureByCode = new Map(
                stateFeatures.map(feature => [STATE_BY_FIPS.get(String(feature.id)), feature]).filter(([code]) => code)
            );
            const featureCollection = { type: 'FeatureCollection', features: stateFeatures };
            projection = d3.geoAlbersUsa().fitExtent([[24, 24], [WIDTH - 24, HEIGHT - 24]], featureCollection);
            geoPath = d3.geoPath(projection);

            const svg = d3.select(svgNode);
            root = svg.append('g').attr('class', 'event-map-root');
            stateLayer = root.append('g').attr('class', 'event-map-states');
            markerLayer = root.append('g').attr('class', 'event-map-markers');

            zoomBehavior = d3.zoom()
                .scaleExtent([1, 8])
                .translateExtent([[-80, -80], [WIDTH + 80, HEIGHT + 80]])
                .clickDistance(8)
                .tapDistance(12)
                .on('zoom', event => {
                    currentTransform = event.transform;
                    root.attr('transform', currentTransform);
                    markerLayer.selectAll('.event-map-pin-group')
                        .attr('transform', cluster => `translate(${cluster.x},${cluster.y}) scale(${1 / currentTransform.k})`);
                })
                .on('end', renderMarkers);

            stateLayer.selectAll('path')
                .data(stateFeatures)
                .join('path')
                .attr('class', 'event-map-state')
                .attr('d', geoPath)
                .attr('data-state', feature => STATE_BY_FIPS.get(String(feature.id)) || '')
                .on('click', (event, feature) => {
                    event.stopPropagation();
                    const code = STATE_BY_FIPS.get(String(feature.id));
                    if (code) zoomToState(code);
                });

            svg.call(zoomBehavior).on('dblclick.zoom', null);
            currentTransform = d3.zoomIdentity;

            const rawEvents = Array.isArray(eventData?.events) ? eventData.events : [];
            allEvents = rawEvents.map(locateEvent).filter(Boolean).filter(isFuture)
                .sort((a, b) => (a.calendarDay?.getTime() ?? Infinity) - (b.calendarDay?.getTime() ?? Infinity));

            populateCompatibilityFilters();
            applyUrlState();
            bindControls();
            applyFilters({ sync: false });

            if (initialEventId) {
                const initialEvent = filteredEvents.find(event => event.mapId === initialEventId)
                    || allEvents.find(event => event.mapId === initialEventId);
                if (initialEvent) selectEvent(initialEvent, { zoom: true, scroll: false, history: 'replace' });
            } else {
                syncUrl({ mode: 'replace' });
            }
            loading.hidden = true;
        } catch (error) {
            loading.textContent = 'Event Map is temporarily unavailable.';
            console.error('Event Map failed to initialize', error);
        }
    }

    window.addEventListener('popstate', restoreHistorySelection);

    window.addEventListener('beforeunload', () => {
        if (calendarObjectUrl) URL.revokeObjectURL(calendarObjectUrl);
    });

    init();
})();
