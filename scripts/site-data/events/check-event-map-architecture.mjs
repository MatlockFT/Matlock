import fs from 'node:fs/promises';

const core = await fs.readFile('assets/event-map-regions.js', 'utf8');
const deferred = await fs.readFile('assets/event-map-deferred.js', 'utf8');
const enhancements = await fs.readFile('assets/event-map-enhancements.js', 'utf8');
const html = await fs.readFile('event-map.html', 'utf8');
const failures = [];

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


if (failures.length) {
  console.error(`Event Map architecture check failed (${failures.length}):`);
  failures.forEach(item => console.error(`- ${item}`));
  process.exit(1);
}
console.log('Event Map architecture check passed: one shared map, region/country history, drag-safe pins, mobile list switching.');
