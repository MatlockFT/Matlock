(() => {
    const page = document.querySelector("[data-event-map]");
    if (!page) return;

    const svgNode = page.querySelector("[data-map-svg]");
    const loading = page.querySelector("[data-map-loading]");
    const eventCount = page.querySelector("[data-event-count]");
    const stateFilter = page.querySelector("[data-state-filter]");
    const promotionFilter = page.querySelector("[data-promotion-filter]");
    const searchInput = page.querySelector("[data-event-search]");
    const rangeButtons = [...page.querySelectorAll("[data-range]")];
    const resetButton = page.querySelector("[data-map-reset]");
    const zoomInButton = page.querySelector("[data-map-zoom-in]");
    const zoomOutButton = page.querySelector("[data-map-zoom-out]");
    const detailEmpty = page.querySelector("[data-event-detail-empty]");
    const detailCard = page.querySelector("[data-event-detail-card]");
    const detailPromotion = page.querySelector("[data-detail-promotion]");
    const detailDate = page.querySelector("[data-detail-date]");
    const detailTitle = page.querySelector("[data-detail-title]");
    const detailLocation = page.querySelector("[data-detail-location]");
    const detailVenue = page.querySelector("[data-detail-venue]");
    const detailBroadcast = page.querySelector("[data-detail-broadcast]");
    const detailSource = page.querySelector("[data-detail-source]");

    const WIDTH = 960;
    const HEIGHT = 600;
    const SOON_MS = 7 * 24 * 60 * 60 * 1000;
    const eventsUrl = page.dataset.eventsUrl;

    const STATES = {
        AL: ["Alabama", "01"], AK: ["Alaska", "02"], AZ: ["Arizona", "04"], AR: ["Arkansas", "05"],
        CA: ["California", "06"], CO: ["Colorado", "08"], CT: ["Connecticut", "09"], DE: ["Delaware", "10"],
        DC: ["District of Columbia", "11"], FL: ["Florida", "12"], GA: ["Georgia", "13"], HI: ["Hawaii", "15"],
        ID: ["Idaho", "16"], IL: ["Illinois", "17"], IN: ["Indiana", "18"], IA: ["Iowa", "19"],
        KS: ["Kansas", "20"], KY: ["Kentucky", "21"], LA: ["Louisiana", "22"], ME: ["Maine", "23"],
        MD: ["Maryland", "24"], MA: ["Massachusetts", "25"], MI: ["Michigan", "26"], MN: ["Minnesota", "27"],
        MS: ["Mississippi", "28"], MO: ["Missouri", "29"], MT: ["Montana", "30"], NE: ["Nebraska", "31"],
        NV: ["Nevada", "32"], NH: ["New Hampshire", "33"], NJ: ["New Jersey", "34"], NM: ["New Mexico", "35"],
        NY: ["New York", "36"], NC: ["North Carolina", "37"], ND: ["North Dakota", "38"], OH: ["Ohio", "39"],
        OK: ["Oklahoma", "40"], OR: ["Oregon", "41"], PA: ["Pennsylvania", "42"], RI: ["Rhode Island", "44"],
        SC: ["South Carolina", "45"], SD: ["South Dakota", "46"], TN: ["Tennessee", "47"], TX: ["Texas", "48"],
        UT: ["Utah", "49"], VT: ["Vermont", "50"], VA: ["Virginia", "51"], WA: ["Washington", "53"],
        WV: ["West Virginia", "54"], WI: ["Wisconsin", "55"], WY: ["Wyoming", "56"]
    };

    const STATE_BY_NAME = new Map();
    const STATE_BY_FIPS = new Map();
    Object.entries(STATES).forEach(([code, [name, fips]]) => {
        STATE_BY_NAME.set(name.toLowerCase(), code);
        STATE_BY_NAME.set(code.toLowerCase(), code);
        STATE_BY_FIPS.set(String(Number(fips)), code);
        STATE_BY_FIPS.set(fips, code);
    });

    const CITY_COORDS = {
        "las vegas|NV": [-115.1398, 36.1699], "los angeles|CA": [-118.2437, 34.0522],
        "anaheim|CA": [-117.9143, 33.8366], "inglewood|CA": [-118.3531, 33.9617],
        "san diego|CA": [-117.1611, 32.7157], "san jose|CA": [-121.8863, 37.3382],
        "sacramento|CA": [-121.4944, 38.5816], "fresno|CA": [-119.7871, 36.7378],
        "san francisco|CA": [-122.4194, 37.7749], "oakland|CA": [-122.2711, 37.8044],
        "new york|NY": [-74.0060, 40.7128], "brooklyn|NY": [-73.9442, 40.6782],
        "buffalo|NY": [-78.8784, 42.8864], "rochester|NY": [-77.6109, 43.1566],
        "albany|NY": [-73.7562, 42.6526], "newark|NJ": [-74.1724, 40.7357],
        "atlantic city|NJ": [-74.4229, 39.3643], "philadelphia|PA": [-75.1652, 39.9526],
        "pittsburgh|PA": [-79.9959, 40.4406], "chicago|IL": [-87.6298, 41.8781],
        "rosemont|IL": [-87.8556, 41.9953], "austin|TX": [-97.7431, 30.2672],
        "dallas|TX": [-96.7970, 32.7767], "fort worth|TX": [-97.3308, 32.7555],
        "arlington|TX": [-97.1081, 32.7357], "houston|TX": [-95.3698, 29.7604],
        "san antonio|TX": [-98.4936, 29.4241], "el paso|TX": [-106.4850, 31.7619],
        "laredo|TX": [-99.5075, 27.5306], "corpus christi|TX": [-97.3964, 27.8006],
        "denver|CO": [-104.9903, 39.7392], "broomfield|CO": [-105.0867, 39.9205],
        "phoenix|AZ": [-112.0740, 33.4484], "glendale|AZ": [-112.18599, 33.5387],
        "scottsdale|AZ": [-111.9261, 33.4942], "tucson|AZ": [-110.9747, 32.2226],
        "miami|FL": [-80.1918, 25.7617], "sunrise|FL": [-80.2566, 26.1669],
        "tampa|FL": [-82.4572, 27.9506], "orlando|FL": [-81.3792, 28.5383],
        "jacksonville|FL": [-81.6557, 30.3322], "fort lauderdale|FL": [-80.1373, 26.1224],
        "hollywood|FL": [-80.1495, 26.0112], "atlanta|GA": [-84.3880, 33.7490],
        "duluth|GA": [-84.1446, 34.0029], "nashville|TN": [-86.7816, 36.1627],
        "memphis|TN": [-90.0490, 35.1495], "louisville|KY": [-85.7585, 38.2527],
        "indianapolis|IN": [-86.1581, 39.7684], "milwaukee|WI": [-87.9065, 43.0389],
        "minneapolis|MN": [-93.2650, 44.9778], "st paul|MN": [-93.08996, 44.9537],
        "kansas city|MO": [-94.5786, 39.0997], "st louis|MO": [-90.1994, 38.6270],
        "springfield|MO": [-93.2923, 37.20896], "oklahoma city|OK": [-97.5164, 35.4676],
        "tulsa|OK": [-95.9928, 36.1540], "new orleans|LA": [-90.0715, 29.9511],
        "bossier city|LA": [-93.7321, 32.51599], "albuquerque|NM": [-106.6504, 35.0844],
        "salt lake city|UT": [-111.8910, 40.7608], "sandy|UT": [-111.8841, 40.56498],
        "seattle|WA": [-122.3321, 47.6062], "tacoma|WA": [-122.4443, 47.2529],
        "portland|OR": [-122.6765, 45.5231], "boston|MA": [-71.0589, 42.3601],
        "worcester|MA": [-71.8023, 42.2626], "unccasville|CT": [-72.1098, 41.4334],
        "uncasville|CT": [-72.1098, 41.4334], "hartford|CT": [-72.6851, 41.7637],
        "mashantucket|CT": [-71.9737, 41.4643], "washington|DC": [-77.0369, 38.9072],
        "baltimore|MD": [-76.6122, 39.2904], "norfolk|VA": [-76.2859, 36.8508],
        "richmond|VA": [-77.4360, 37.5407], "virginia beach|VA": [-75.9780, 36.8529],
        "raleigh|NC": [-78.6382, 35.7796], "charlotte|NC": [-80.8431, 35.2271],
        "greensboro|NC": [-79.7920, 36.0726], "charleston|SC": [-79.9311, 32.7765],
        "myrtle beach|SC": [-78.8867, 33.6891], "omaha|NE": [-95.9345, 41.2565],
        "lincoln|NE": [-96.7026, 40.8136], "sioux falls|SD": [-96.7311, 43.5446],
        "boise|ID": [-116.2023, 43.6150], "honolulu|HI": [-157.8583, 21.3069],
        "anchorage|AK": [-149.9003, 61.2181], "detroit|MI": [-83.0458, 42.3314],
        "grand rapids|MI": [-85.6681, 42.9634], "cleveland|OH": [-81.6944, 41.4993],
        "columbus|OH": [-82.9988, 39.9612], "cincinnati|OH": [-84.5120, 39.1031],
        "birmingham|AL": [-86.8025, 33.5207], "mobile|AL": [-88.0399, 30.6954],
        "biloxi|MS": [-88.8853, 30.3960], "jackson|MS": [-90.1848, 32.2988],
        "little rock|AR": [-92.2896, 34.7465], "fayetteville|AR": [-94.1574, 36.0626],
        "wichita|KS": [-97.3301, 37.6872], "topeka|KS": [-95.6770, 39.0473]
    };

    let d3;
    let topojson;
    let projection;
    let geoPath;
    let root;
    let stateLayer;
    let markerLayer;
    let zoomBehavior;
    let currentTransform = null;
    let stateFeatures = [];
    let stateFeatureByCode = new Map();
    let allEvents = [];
    let filteredEvents = [];
    let currentRange = "all";
    let selectedEventId = "";

    function normalizeText(value) {
        return String(value || "").replace(/\s+/g, " ").trim();
    }

    function eventDate(event) {
        const value = event.starts_at || event.date;
        if (!value) return null;
        const date = event.starts_at ? new Date(value) : new Date(`${value}T12:00:00Z`);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function parseLocation(event) {
        const source = [event.venue, event.location, event.title].filter(Boolean).join(" · ");
        const lower = source.toLowerCase();
        let stateCode = "";
        let matchedStateName = "";

        for (const [code, [name]] of Object.entries(STATES)) {
            const namePattern = new RegExp(`(?:,|·|\\s)\\s*${name.replace(/ /g, "\\s+")}\\b`, "i");
            const codePattern = new RegExp(`(?:,|·|\\s)\\s*${code}\\b`, "i");
            if (namePattern.test(source) || codePattern.test(source)) {
                stateCode = code;
                matchedStateName = name;
                break;
            }
        }

        if (!stateCode) return null;

        const pieces = source.split("·").map(part => part.trim()).filter(Boolean);
        const locationPiece = [...pieces].reverse().find(part => {
            const l = part.toLowerCase();
            return l.includes(matchedStateName.toLowerCase()) || new RegExp(`\\b${stateCode.toLowerCase()}\\b`).test(l);
        }) || source;

        let city = normalizeText(locationPiece.split(",")[0]);
        if (!city || city.toLowerCase() === matchedStateName.toLowerCase()) city = "";
        city = city.replace(/\b(?:usa|united states)\b/ig, "").trim();

        return { city, stateCode, stateName: STATES[stateCode][0], raw: source };
    }

    function stateCentroid(code) {
        const feature = stateFeatureByCode.get(code);
        if (!feature) return null;
        const point = geoPath.centroid(feature);
        return Number.isFinite(point[0]) && Number.isFinite(point[1]) ? point : null;
    }

    function locateEvent(event, index) {
        const location = parseLocation(event);
        if (!location) return null;

        const cityKey = `${location.city.toLowerCase()}|${location.stateCode}`;
        const coordinates = CITY_COORDS[cityKey];
        let point = coordinates ? projection(coordinates) : null;
        let precision = "city";

        if (!point || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
            point = stateCentroid(location.stateCode);
            precision = "state";
        }

        if (!point) return null;

        return {
            ...event,
            mapId: event.id || `event-${index}`,
            dateObject: eventDate(event),
            city: location.city,
            stateCode: location.stateCode,
            stateName: location.stateName,
            locationPrecision: precision,
            x: point[0],
            y: point[1]
        };
    }

    function dateLabel(event) {
        if (!event.dateObject) return "Date TBA";
        return event.dateObject.toLocaleDateString([], {
            month: "short",
            day: "numeric",
            year: "numeric"
        });
    }

    function isThisWeekend(date) {
        if (!date) return false;
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const day = today.getDay();
        const daysSinceFriday = (day + 2) % 7;
        const inCurrentWeekend = day === 5 || day === 6 || day === 0;
        const friday = new Date(today);
        friday.setDate(today.getDate() + (inCurrentWeekend ? -daysSinceFriday : (5 - day + 7) % 7));
        const monday = new Date(friday);
        monday.setDate(friday.getDate() + 3);
        return date >= friday && date < monday;
    }

    function matchesRange(event) {
        if (!event.dateObject || currentRange === "all") return true;
        if (currentRange === "weekend") return isThisWeekend(event.dateObject);
        if (currentRange === "30") {
            const diff = event.dateObject.getTime() - Date.now();
            return diff >= -86400000 && diff <= 30 * 86400000;
        }
        return true;
    }

    function applyFilters() {
        const state = stateFilter.value;
        const promotion = promotionFilter.value;
        const query = searchInput.value.trim().toLowerCase();

        filteredEvents = allEvents.filter(event => {
            if (!matchesRange(event)) return false;
            if (state && event.stateCode !== state) return false;
            if (promotion && normalizeText(event.promotion) !== promotion) return false;
            if (query) {
                const haystack = [
                    event.promotion,
                    event.title,
                    event.venue,
                    event.broadcast,
                    event.city,
                    event.stateName
                ].join(" ").toLowerCase();
                if (!haystack.includes(query)) return false;
            }
            return true;
        });

        eventCount.textContent = String(filteredEvents.length);
        renderStateActivity();
        renderMarkers();
    }

    function populateFilters() {
        const states = [...new Set(allEvents.map(event => event.stateCode))]
            .sort((a, b) => STATES[a][0].localeCompare(STATES[b][0]));
        const promotions = [...new Set(allEvents.map(event => normalizeText(event.promotion)).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b));

        stateFilter.replaceChildren(new Option("All states", ""));
        states.forEach(code => stateFilter.append(new Option(STATES[code][0], code)));

        promotionFilter.replaceChildren(new Option("All promotions", ""));
        promotions.forEach(name => promotionFilter.append(new Option(name, name)));
    }

    function renderStateActivity() {
        const active = new Set(filteredEvents.map(event => event.stateCode));
        stateLayer.selectAll(".event-map-state")
            .attr("data-has-events", feature => String(active.has(STATE_BY_FIPS.get(String(feature.id)))));
    }

    function clusterEvents(events) {
        const scale = currentTransform?.k || 1;
        const threshold = 26 / scale;
        const clusters = [];

        events.forEach(event => {
            let cluster = clusters.find(candidate =>
                Math.hypot(event.x - candidate.x, event.y - candidate.y) <= threshold
            );

            if (!cluster) {
                cluster = { x: event.x, y: event.y, events: [] };
                clusters.push(cluster);
            }

            cluster.events.push(event);
            cluster.x = cluster.events.reduce((sum, item) => sum + item.x, 0) / cluster.events.length;
            cluster.y = cluster.events.reduce((sum, item) => sum + item.y, 0) / cluster.events.length;
        });

        return clusters;
    }

    function showEventDetail(event) {
        selectedEventId = event.mapId;
        detailEmpty.hidden = true;
        detailCard.hidden = false;
        detailPromotion.textContent = normalizeText(event.promotion) || "MMA";
        detailDate.textContent = dateLabel(event);
        detailDate.dateTime = event.dateObject?.toISOString() || "";
        detailTitle.textContent = normalizeText(event.title) || normalizeText(event.promotion) || "MMA event";
        detailLocation.textContent = [event.city, event.stateCode].filter(Boolean).join(", ") || event.stateName;
        detailVenue.textContent = normalizeText(event.venue) || "Venue not yet listed";
        detailBroadcast.textContent = event.broadcast ? `Watch: ${normalizeText(event.broadcast)}` : "Broadcast information not yet listed";
        detailSource.href = event.official_url || "/upcoming-events/";
        detailSource.textContent = event.official_url ? "Event source" : "Fight Card Picker";
        markerLayer.selectAll(".event-map-pin-group")
            .attr("data-selected", cluster => String(cluster.events.some(item => item.mapId === selectedEventId)));
    }

    function showClusterDetail(cluster) {
        detailEmpty.hidden = true;
        detailCard.hidden = false;
        const first = cluster.events[0];
        detailPromotion.textContent = "EVENT CLUSTER";
        detailDate.textContent = `${cluster.events.length} events`;
        detailDate.removeAttribute("datetime");
        detailTitle.textContent = `${cluster.events.length} events near ${first.city || first.stateName}`;
        detailLocation.textContent = cluster.events
            .slice(0, 6)
            .map(event => `${dateLabel(event)} · ${normalizeText(event.promotion)}`)
            .join(" • ");
        detailVenue.textContent = cluster.events
            .slice(0, 6)
            .map(event => normalizeText(event.title))
            .filter(Boolean)
            .join(" • ");
        detailBroadcast.textContent = cluster.events.length > 6 ? `Plus ${cluster.events.length - 6} more events in this cluster.` : "Zoom in to separate nearby event pins.";
        detailSource.href = "/upcoming-events/";
        detailSource.textContent = "Open Fight Card Picker";
    }

    function zoomToPoint(x, y, factor = 2) {
        const nextScale = Math.min(8, Math.max((currentTransform?.k || 1) * factor, 1));
        const transform = d3.zoomIdentity
            .translate(WIDTH / 2, HEIGHT / 2)
            .scale(nextScale)
            .translate(-x, -y);
        d3.select(svgNode).transition().duration(260).call(zoomBehavior.transform, transform);
    }

    function renderMarkers() {
        const clusters = clusterEvents(filteredEvents);
        const scale = currentTransform?.k || 1;

        markerLayer.selectAll("*").remove();

        const groups = markerLayer.selectAll("g.event-map-pin-group")
            .data(clusters, cluster => cluster.events.map(event => event.mapId).join("|"))
            .join("g")
            .attr("class", cluster => `event-map-pin-group${cluster.events.length > 1 ? " event-map-cluster" : ""}`)
            .attr("tabindex", 0)
            .attr("role", "button")
            .attr("aria-label", cluster => {
                if (cluster.events.length > 1) return `${cluster.events.length} upcoming MMA events`; 
                const event = cluster.events[0];
                return `${normalizeText(event.promotion)} ${normalizeText(event.title)}, ${dateLabel(event)}`;
            })
            .attr("data-soon", cluster => String(cluster.events.some(event => event.dateObject && event.dateObject.getTime() - Date.now() <= SOON_MS)))
            .attr("data-selected", cluster => String(cluster.events.some(event => event.mapId === selectedEventId)))
            .attr("transform", cluster => `translate(${cluster.x},${cluster.y}) scale(${1 / scale})`);

        groups.append("circle")
            .attr("class", "event-map-pin-halo")
            .attr("r", cluster => cluster.events.length > 1 ? 15 : 11);

        groups.append("circle")
            .attr("class", "event-map-pin")
            .attr("r", cluster => cluster.events.length > 1 ? 10 : 6.5);

        groups.filter(cluster => cluster.events.length > 1)
            .append("text")
            .attr("class", "event-map-pin-count")
            .text(cluster => cluster.events.length > 99 ? "99+" : cluster.events.length);

        groups.append("title").text(cluster => {
            if (cluster.events.length > 1) return `${cluster.events.length} events near ${cluster.events[0].city || cluster.events[0].stateName}`;
            const event = cluster.events[0];
            return `${normalizeText(event.promotion)} · ${normalizeText(event.title)} · ${dateLabel(event)}`;
        });

        groups
            .on("mouseenter", (_, cluster) => {
                if (cluster.events.length === 1 && !selectedEventId) showEventDetail(cluster.events[0]);
            })
            .on("click", (event, cluster) => {
                event.stopPropagation();
                if (cluster.events.length > 1 && (currentTransform?.k || 1) < 4) {
                    zoomToPoint(cluster.x, cluster.y, 2);
                } else if (cluster.events.length > 1) {
                    showClusterDetail(cluster);
                } else {
                    showEventDetail(cluster.events[0]);
                }
            })
            .on("keydown", (event, cluster) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                if (cluster.events.length > 1 && (currentTransform?.k || 1) < 4) zoomToPoint(cluster.x, cluster.y, 2);
                else if (cluster.events.length > 1) showClusterDetail(cluster);
                else showEventDetail(cluster.events[0]);
            });
    }

    function resetMap() {
        stateFilter.value = "";
        promotionFilter.value = "";
        searchInput.value = "";
        currentRange = "all";
        selectedEventId = "";
        rangeButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.range === "all")));
        d3.select(svgNode).transition().duration(240).call(zoomBehavior.transform, d3.zoomIdentity);
        detailCard.hidden = true;
        detailEmpty.hidden = false;
        applyFilters();
    }

    function bindControls() {
        stateFilter.addEventListener("change", applyFilters);
        promotionFilter.addEventListener("change", applyFilters);
        searchInput.addEventListener("input", applyFilters);

        rangeButtons.forEach(button => {
            button.addEventListener("click", () => {
                currentRange = button.dataset.range;
                rangeButtons.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
                applyFilters();
            });
        });

        resetButton.addEventListener("click", resetMap);
        zoomInButton.addEventListener("click", () => d3.select(svgNode).transition().duration(180).call(zoomBehavior.scaleBy, 1.5));
        zoomOutButton.addEventListener("click", () => d3.select(svgNode).transition().duration(180).call(zoomBehavior.scaleBy, 1 / 1.5));
    }

    async function init() {
        try {
            const [d3Module, topoModule, us, eventData] = await Promise.all([
                import("https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm"),
                import("https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm"),
                fetch("https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json").then(response => {
                    if (!response.ok) throw new Error("Map boundary request failed");
                    return response.json();
                }),
                fetch(eventsUrl, { cache: "no-store" }).then(response => {
                    if (!response.ok) throw new Error("Event feed request failed");
                    return response.json();
                })
            ]);

            d3 = d3Module;
            topojson = topoModule;
            stateFeatures = topojson.feature(us, us.objects.states).features;
            stateFeatureByCode = new Map(stateFeatures.map(feature => [STATE_BY_FIPS.get(String(feature.id)), feature]).filter(([code]) => code));

            const featureCollection = { type: "FeatureCollection", features: stateFeatures };
            projection = d3.geoAlbersUsa().fitExtent([[24, 24], [WIDTH - 24, HEIGHT - 24]], featureCollection);
            geoPath = d3.geoPath(projection);

            const svg = d3.select(svgNode);
            root = svg.append("g").attr("class", "event-map-root");
            stateLayer = root.append("g").attr("class", "event-map-states");
            markerLayer = root.append("g").attr("class", "event-map-markers");

            stateLayer.selectAll("path")
                .data(stateFeatures)
                .join("path")
                .attr("class", "event-map-state")
                .attr("d", geoPath)
                .attr("data-state", feature => STATE_BY_FIPS.get(String(feature.id)) || "")
                .on("click", (event, feature) => {
                    event.stopPropagation();
                    const bounds = geoPath.bounds(feature);
                    const dx = bounds[1][0] - bounds[0][0];
                    const dy = bounds[1][1] - bounds[0][1];
                    const x = (bounds[0][0] + bounds[1][0]) / 2;
                    const y = (bounds[0][1] + bounds[1][1]) / 2;
                    const scale = Math.max(1, Math.min(8, .78 / Math.max(dx / WIDTH, dy / HEIGHT)));
                    const transform = d3.zoomIdentity.translate(WIDTH / 2, HEIGHT / 2).scale(scale).translate(-x, -y);
                    d3.select(svgNode).transition().duration(260).call(zoomBehavior.transform, transform);
                });

            zoomBehavior = d3.zoom()
                .scaleExtent([1, 8])
                .translateExtent([[-80, -80], [WIDTH + 80, HEIGHT + 80]])
                .on("zoom", event => {
                    currentTransform = event.transform;
                    root.attr("transform", currentTransform);
                    markerLayer.selectAll(".event-map-pin-group")
                        .attr("transform", cluster => `translate(${cluster.x},${cluster.y}) scale(${1 / currentTransform.k})`);
                })
                .on("end", renderMarkers);

            svg.call(zoomBehavior).on("dblclick.zoom", null);
            currentTransform = d3.zoomIdentity;

            const rawEvents = Array.isArray(eventData?.events) ? eventData.events : [];
            allEvents = rawEvents.map(locateEvent).filter(Boolean).sort((a, b) => (a.dateObject || 0) - (b.dateObject || 0));
            populateFilters();
            bindControls();
            applyFilters();

            loading.hidden = true;
        } catch (error) {
            loading.textContent = "Event Map is temporarily unavailable.";
            console.error("Event Map failed to initialize", error);
        }
    }

    init();
})();
