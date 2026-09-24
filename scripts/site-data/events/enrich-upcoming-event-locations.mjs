import fs from 'node:fs/promises';
import { enrichLocationMetadata, normalizeState } from './event-location-utils.mjs';

const DATA_PATH = '_data/upcoming_events.json';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockLocationEnricher/1.0; +https://mmamatlock.com/event-map/)';
const CONCURRENCY = Math.max(1, Number(process.env.EVENT_LOCATION_CONCURRENCY || 3));
const TIMEOUT_MS = 20000;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const decode = value => String(value || '')
  .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, 'utf8'));
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

function jsonLdNodes(html) {
  const nodes = [];
  const push = value => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(push);
    if (typeof value !== 'object') return;
    if (Array.isArray(value['@graph'])) value['@graph'].forEach(push);
    nodes.push(value);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { push(JSON.parse(decode(match[1]).trim())); } catch {}
  }
  return nodes;
}

function nodeType(node) {
  return Array.isArray(node?.['@type']) ? node['@type'].join(' ') : clean(node?.['@type']);
}

function datePart(value) {
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? '' : new Date(parsed).toISOString().slice(0, 10);
}

function eventNode(html, event) {
  const candidates = jsonLdNodes(html).filter(node => /\b(?:Event|SportsEvent)\b/i.test(nodeType(node)));
  if (!candidates.length) return null;
  const exact = candidates.find(node => datePart(node.startDate) === event.date);
  return exact || candidates[0];
}

function countryValue(value) {
  if (typeof value === 'string') return clean(value);
  if (value && typeof value === 'object') return clean(value.name || value.addressCountry || value.identifier);
  return '';
}

function officialLocationFromNode(node) {
  if (!node) return null;
  const rawLocation = Array.isArray(node.location) ? node.location[0] : node.location;
  if (!rawLocation) return null;
  if (typeof rawLocation === 'string') return { venue: clean(rawLocation) };

  const address = typeof rawLocation.address === 'object' && rawLocation.address ? rawLocation.address : {};
  const geo = typeof rawLocation.geo === 'object' && rawLocation.geo ? rawLocation.geo : {};
  const state = normalizeState(address.addressRegion);
  const city = clean(address.addressLocality);
  const country = countryValue(address.addressCountry);
  const latitude = Number(geo.latitude);
  const longitude = Number(geo.longitude);
  const out = {
    venue: clean(rawLocation.name),
    city,
    state,
    country,
    latitude: Number.isFinite(latitude) ? latitude : undefined,
    longitude: Number.isFinite(longitude) ? longitude : undefined
  };
  return Object.values(out).some(value => value !== '' && value !== undefined) ? out : null;
}

function applyOfficialLocation(event, official) {
  if (!official) return event;
  const next = { ...event };
  if (official.venue && (!clean(next.venue) || /^venue tba$/i.test(clean(next.venue)))) next.venue = official.venue;
  if (official.city) next.city = official.city;
  if (official.state) {
    next.state = official.state;
    next.state_code = official.state;
  }
  if (official.country) next.country = official.country;
  if (Number.isFinite(official.latitude) && Number.isFinite(official.longitude)) {
    next.latitude = official.latitude;
    next.longitude = official.longitude;
    next.location_precision = 'venue';
  } else if (official.city && official.state) {
    next.location_precision = 'city';
  } else if (official.city || official.country) {
    next.location_precision = 'structured';
  }
  if (official.city && official.state) next.location = `${official.city}, ${official.state}`;
  next.location_source = 'official-jsonld';
  return next;
}

function locationSignature(event) {
  return JSON.stringify({
    venue: clean(event.venue), location: clean(event.location), city: clean(event.city),
    state: clean(event.state || event.state_code), country: clean(event.country),
    latitude: Number.isFinite(Number(event.latitude)) ? Number(event.latitude) : null,
    longitude: Number.isFinite(Number(event.longitude)) ? Number(event.longitude) : null,
    location_source: clean(event.location_source), location_precision: clean(event.location_precision)
  });
}

async function enrichOne(event) {
  let next = { ...event };
  const url = clean(event.official_url);
  if (/^https?:\/\//i.test(url)) {
    try {
      const html = await fetchHtml(url);
      next = applyOfficialLocation(next, officialLocationFromNode(eventNode(html, event)));
    } catch (error) {
      console.warn(`Location source unavailable for ${event.id}: ${clean(error?.message || error)}`);
    }
  }
  return enrichLocationMetadata(next);
}

const data = await readJson(DATA_PATH);
if (!Array.isArray(data.events)) throw new Error(`${DATA_PATH}: events must be an array`);

const results = new Array(data.events.length);
let cursor = 0;
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= data.events.length) return;
    results[index] = await enrichOne(data.events[index]);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, data.events.length || 1) }, worker));

let changed = 0;
for (let index = 0; index < data.events.length; index += 1) {
  if (locationSignature(data.events[index]) !== locationSignature(results[index])) changed += 1;
}

if (changed) {
  data.events = results;
  await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}
console.log(`Upcoming event location enrichment: ${changed}/${data.events.length} event(s) improved or normalized.`);
