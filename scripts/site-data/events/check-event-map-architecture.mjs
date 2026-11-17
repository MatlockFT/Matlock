import fs from 'node:fs/promises';

const core = await fs.readFile('assets/event-map-regions.js', 'utf8');
const deferred = await fs.readFile('assets/event-map-deferred.js', 'utf8');
const enhancements = await fs.readFile('assets/event-map-enhancements.js', 'utf8');
const html = await fs.readFile('event-map.html', 'utf8');
const failures = [];
const regionalFeed = await fs.readFile('assets/data/event-map-regions-live.json', 'utf8');
const canadaData = JSON.parse(await fs.readFile('_data/canada_mma_events.json', 'utf8'));

function requireText(text, needle, message) {
  if (!text.includes(needle)) failures.push(message);
}
function forbid(text, needle, message) {
  if (text.includes(needle)) failures.push(message);
}

requireText(core, "window.addEventListener('popstate', restoreHistorySelection)", 'Core must restore event selection on browser back/forward.');
requireText(core, "window.history.pushState", 'Committed Event Map selections must create history entries.');
requireText(core, "selectEvent(cluster.events[0], { scroll: false })", 'Single-pin map taps must keep the mobile map in place for repeated exploration.');
requireText(core, '.clickDistance(8)', 'Map zoom must suppress accidental click-after-drag selection.');
requireText(core, '.tapDistance(12)', 'Map zoom must use a touch tap-distance threshold.');
requireText(core, 'setTimeout(renderMarkers, 0)', 'Input-driven zoom end must not replace a marker before its native click commits.');
requireText(core, '!desktopHover.matches || selectedEventId || selectedClusterKey', 'Touch focus must not masquerade as a committed mobile pin selection.');
requireText(core, "detailPanel.dataset.hoverPreview", 'Core must own hover-preview state.');
// The standalone Fight Card Picker was retired. Event Map must remain independent.
forbid(core, 'pickerIdFor(event)', 'Event Map must not depend on retired Fight Card Picker IDs.');
requireText(core, "renderPoster(event)", 'Core must own poster rendering and stale-request protection.');
forbid(enhancements, 'pressedPointerId', 'Enhancements must not install a second marker activation controller.');
forbid(enhancements, "fetch(page.dataset.eventsUrl", 'Enhancements must not fetch the Event Map feed a second time.');
forbid(deferred, 'event-map-detail.js', 'Retired duplicate detail controller must not be deferred.');
forbid(html, '/assets/event-map-detail.js', 'Retired duplicate detail controller must not be loaded by the page.');
requireText(html, '/assets/event-map-regions.js', 'Event Map must load the shared regional engine.');
requireText(html, 'data-country-filter', 'Country filter must be available.');
requireText(html, 'data-region="south-america"', 'South America must be a supported region.');
requireText(html, 'data-map-view="events"', 'Mobile list/map switching must be available.');
forbid(html, 'data-japan-event-map', 'Japan must not load as a second stacked map.');
forbid(html, 'data-mexico-event-map', 'Mexico must not load as a third stacked map.');
requireText(core, 'function rebuildMap(', 'Regional map must rebuild geographic projection.');
requireText(core, 'function chooseRegion(', 'One engine must switch continents.');
requireText(core, 'function chooseCountry(', 'One engine must switch country views.');
requireText(core, "REGIONS[currentRegion].countries", 'Region/country filters must remain linked.');
requireText(regionalFeed, 'site.data.canada_mma_events.events', 'Regional feed must read the Canadian MMA calendar.');
requireText(regionalFeed, 'concat: canada_events', 'Canadian events must be included in the shared map feed.');
requireText(core, "canada: { name: 'Canada'", 'Country selection must support Canada.');
requireText(core, "event.countrySlug === 'canada'", 'Canadian events should display their province.');
requireText(core, "'British Columbia': 'America/Vancouver'", 'Canadian local-day filtering must respect Pacific time.');
if (!Array.isArray(canadaData.events) || canadaData.events.length < 10) {
  failures.push('Canada MMA map must have at least ten verified scheduled cards.');
} else {
  const ids = new Set();
  for (const event of canadaData.events) {
    if (!event.id || ids.has(event.id)) failures.push('Canadian event IDs must be present and unique.');
    ids.add(event.id);
    if (event.country !== 'Canada' || event.sport !== 'MMA') {
      failures.push('Canadian calendar may only contain Canadian MMA events.');
    }
    if (!/^20\d{2}-\d{2}-\d{2}$/.test(event.date || '')) {
      failures.push('Canadian MMA event must have a valid ISO date.');
    }
    if (!event.city || !event.state || !event.promotion || !event.venue) {
      failures.push('Canadian events require a promotion, city, province and venue.');
    }
    if (typeof event.latitude !== 'number' || typeof event.longitude !== 'number'
        || event.latitude < 41 || event.latitude > 84
        || event.longitude < -142 || event.longitude > -52) {
      failures.push('Canadian MMA event must have plausible city coordinates.');
    }
    if (!/^https:\/\//.test(event.source_url || '')) {
      failures.push('Canadian MMA events must link to an event source.');
    }
  }
}


// The Africa region must render the continent itself, not just countries
// that currently have MMA event feeds. World Atlas uses ISO numeric IDs.
const geoConfig = core.match(/const CONTINENT_GEO_IDS\s*=\s*\{([\s\S]*?)\n\s{4}\};/)?.[1] || '';
const africaConfig = geoConfig.match(/africa:\s*\[([\s\S]*?)\]/)?.[1] || '';
const africaCodes = [...africaConfig.matchAll(/'(\d{3})'/g)].map(match => match[1]);
const expectedAfrica = [
  '012','024','072','108','120','132','140','148','174','178','180',
  '204','226','231','232','262','266','270','288','324','384','404',
  '426','430','434','450','454','466','478','480','504','508','516',
  '562','566','624','646','678','686','690','694','706','710','716',
  '728','729','732','748','768','788','800','818','834','854','894'
];
if (africaCodes.length !== expectedAfrica.length
    || new Set(africaCodes).size !== expectedAfrica.length
    || expectedAfrica.some(code => !africaCodes.includes(code))) {
  failures.push('Africa map must contain all 54 national boundaries and Western Sahara.');
}



if (failures.length) {
  console.error(`Event Map architecture check failed (${failures.length}):`);
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log('Event Map architecture check passed: one shared map, region/country history, drag-safe pins, mobile list switching.');
