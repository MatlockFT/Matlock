import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const CACHE_PATH = process.argv[3] || 'assets/data/on-this-day-image-cache.json';
const REQUEST_TIMEOUT_MS = 18000;
const USER_AGENT = 'MMA-Matlock-OnThisDay-TrustedImages/1.0 (+https://mmamatlock.com/on-this-day/)';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const TRUSTED_HOSTS = [
  'tapology.com',
  'sherdog.com',
  'wikipedia.org',
  'wikimedia.org',
  'ufc.com',
  'bellator.com',
  'pflmma.com',
  'onefc.com',
  'rizinff.com',
  'pancrase.co.jp',
  'web.archive.org'
];

const TRUSTED_SOURCE_TYPES = new Set([
  'tapology-event-page',
  'tapology-bout-page',
  'wikipedia',
  'wikipedia-page-artwork',
  'wikipedia-lead-image',
  'wikimedia-commons',
  'official-promotion-page',
  'official-promotion-event-image',
  'official-promotion-fighter-fallback',
  'archived-promotion-page',
  'event-article'
]);

const PRIDE_FALSE_POSITIVE = /\b(?:gay\s+pride|pride\s+flag|pride\s+month|pride\s+parade|pride\s+festival|rainbow\s+flag|lgbtq?|queer|pride\s+pantry|food\s+pantry|grocery|supermarket)\b/i;

function hostOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); }
  catch { return ''; }
}

function trustedHost(value) {
  const host = hostOf(value);
  return TRUSTED_HOSTS.some(allowed => host === allowed || host.endsWith(`.${allowed}`));
}

function isEvent(entry) {
  return entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
}

function promotionKey(entry) {
  const value = norm(entry?.promotion || entry?.title || '');
  if (value.includes('pride')) return 'pride';
  if (value.includes('bellator')) return 'bellator';
  if (value.includes('pancrase')) return 'pancrase';
  if (value.includes('ufc') || value.includes('ultimate fighting')) return 'ufc';
  if (value.includes('rizin')) return 'rizin';
  if (value.includes('strikeforce')) return 'strikeforce';
  if (value.includes('wec') || value.includes('world extreme cagefighting')) return 'wec';
  if (value.includes('pfl') || value.includes('professional fighters league')) return 'pfl';
  if (value.includes('one championship')) return 'one';
  return value.split(' ')[0] || '';
}

function eventName(entry) {
  return clean(String(entry?.title || '').replace(/\s+took place$/i, ''));
}

function eventTokens(entry) {
  const stop = new Set(['the','and','with','from','into','event','fight','fighting','championships','championship','final','finals','pride']);
  return norm(eventName(entry)).split(' ').filter(token => token.length >= 3 && !stop.has(token));
}

function exactMmaEvidence(entry) {
  const haystack = norm([
    entry?.imageFileTitle,
    entry?.imageAlt,
    entry?.imageMatchReason,
    entry?.imageSourceUrl,
    entry?.sourceUrl
  ].filter(Boolean).join(' '));
  if (!haystack) return false;
  const promo = promotionKey(entry);
  const tokens = eventTokens(entry);
  if (promo && haystack.includes(promo)) {
    if (!tokens.length) return true;
    if (tokens.some(token => haystack.includes(token))) return true;
  }
  return tokens.length >= 2 && tokens.filter(token => haystack.includes(token)).length >= 2;
}

function badPrideImage(entry) {
  if (promotionKey(entry) !== 'pride') return false;
  const descriptor = [entry?.imageFileTitle, entry?.imageAlt, entry?.imageCredit, entry?.imageUrl, entry?.imageSourceUrl].filter(Boolean).join(' ');
  if (PRIDE_FALSE_POSITIVE.test(descriptor)) return true;

  const type = clean(entry?.imageSourceType);
  if (type === 'wikimedia-commons-search') return true;
  if (type === 'existing-image' || type === 'source-page') return !trustedHost(entry?.imageSourceUrl || entry?.sourceUrl || '');

  if ((type === 'wikipedia-page-artwork' || type === 'wikipedia-lead-image') && !/wikipedia\.org/i.test(String(entry?.sourceUrl || entry?.imageSourceUrl || ''))) {
    return true;
  }

  if (!TRUSTED_SOURCE_TYPES.has(type) && !trustedHost(entry?.imageSourceUrl || entry?.sourceUrl || '')) return true;
  if (type === 'wikimedia-commons' && !exactMmaEvidence(entry)) return true;
  return false;
}

function clearImage(entry, reason) {
  delete entry.imageUrl;
  delete entry.imageAlt;
  delete entry.imageCredit;
  delete entry.imageFileTitle;
  delete entry.imageWidth;
  delete entry.imageHeight;
  delete entry.imagePosition;
  delete entry.imageResolvedAt;
  entry.imageStatus = 'unresolved';
  entry.imageUnresolved = true;
  entry.imageConfidence = 0;
  entry.imageSubjectType = 'event';
  entry.imageSourceType = 'trusted-source-required';
  entry.imageSourceUrl = '';
  entry.imageMatchReason = reason;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function wikipediaTitleFromUrl(value) {
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith('wikipedia.org') || !url.pathname.startsWith('/wiki/')) return '';
    return decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ');
  } catch { return ''; }
}

function pageMatchesEntry(pageTitle, entry) {
  const page = norm(pageTitle);
  const title = norm(eventName(entry));
  if (!page || !title) return false;
  if (page.includes(title) || title.includes(page)) return true;
  const tokens = eventTokens(entry);
  return tokens.length >= 2 && tokens.filter(token => page.includes(token)).length >= Math.min(3, tokens.length);
}

async function exactWikipediaLead(entry) {
  const title = wikipediaTitleFromUrl(entry?.sourceUrl || '') || clean(entry?.wikipediaTitle || '').split('#')[0];
  if (!title) return null;

  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'pageimages|info');
  url.searchParams.set('piprop', 'thumbnail|original|name');
  url.searchParams.set('pithumbsize', '1400');
  url.searchParams.set('inprop', 'url');
  url.searchParams.set('titles', title);

  const data = await fetchJson(url);
  const page = data?.query?.pages?.[0];
  const imageUrl = page?.thumbnail?.source || page?.original?.source || '';
  const pageTitle = clean(page?.title || title);
  if (!/^https:\/\//i.test(imageUrl) || !pageMatchesEntry(pageTitle, entry)) return null;

  return {
    imageUrl,
    imageAlt: `${eventName(entry)} event image`,
    imageCredit: 'Wikipedia / Wikimedia Commons',
    imageSourceUrl: clean(page?.fullurl || entry?.sourceUrl || ''),
    imageSourceType: 'wikipedia',
    imageConfidence: 0.9,
    imageSubjectType: 'event',
    imageMatchReason: 'Exact Wikipedia MMA event page supplied its lead image.'
  };
}

function applyCandidate(entry, candidate) {
  Object.assign(entry, candidate);
  entry.imageStatus = 'resolved';
  entry.imageUnresolved = false;
  entry.imageResolvedAt = new Date().toISOString();
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
let cache = { version: 1, entries: {} };
try { cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8')); } catch {}
if (!cache.entries || typeof cache.entries !== 'object' || Array.isArray(cache.entries)) cache.entries = {};

let scrubbed = 0;
let repaired = 0;
const touched = [];

for (const entry of history.entries || []) {
  if (!isEvent(entry)) continue;
  if (!badPrideImage(entry)) continue;

  const key = clean(entry?.autoKey || '');
  clearImage(entry, 'Rejected an ambiguous PRIDE image. Historical event images must come from an exact trusted MMA source, not a broad image-search match.');
  if (key && cache.entries[key]) delete cache.entries[key];
  scrubbed += 1;
  touched.push(`${entry.date} ${entry.title}`);

  try {
    const candidate = await exactWikipediaLead(entry);
    if (candidate) {
      applyCandidate(entry, candidate);
      repaired += 1;
    }
  } catch {}
}

history.trustedEventImageGateVersion = 1;
history.trustedEventImageGateUpdatedAt = new Date().toISOString();
cache.trustedEventImageGateVersion = 1;
cache.trustedEventImageGateUpdatedAt = history.trustedEventImageGateUpdatedAt;

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');

console.log(`Trusted MMA event-image gate: ${scrubbed} PRIDE false/ambiguous matches removed; ${repaired} repaired from exact Wikipedia event pages.`);
if (touched.length) console.log(`Scrubbed PRIDE entries: ${touched.slice(0, 30).join(' | ')}`);
