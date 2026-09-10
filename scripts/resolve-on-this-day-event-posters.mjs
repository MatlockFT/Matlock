import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const LIMIT = Math.max(1, Number(process.env.OTD_EVENT_POSTER_LIMIT || 220));
const REQUEST_TIMEOUT_MS = 18000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 MMA-Matlock-OTD-Posters/2.0';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const http = value => /^https:\/\//i.test(clean(value));
const trustedTapologyBindings = new Set(['direct-event-page','bing-image-exact-event-page','manual-exact-event-page','legacy-filename-exact']);

function isEvent(entry) {
  return entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
}

function eventName(entry) {
  return clean(String(entry?.title || '').replace(/\s+took place$/i, ''));
}

function promotionKey(entry) {
  const text = norm(`${entry?.promotion || ''} ${entry?.title || ''}`);
  if (text.includes('ultimate fighting') || /\bufc\b/.test(text)) return 'ufc';
  if (text.includes('world extreme cagefighting') || /\bwec\b/.test(text)) return 'wec';
  if (text.includes('strikeforce')) return 'strikeforce';
  if (text.includes('bellator')) return 'bellator';
  if (text.includes('pride')) return 'pride';
  if (text.includes('pancrase')) return 'pancrase';
  if (text.includes('rizin')) return 'rizin';
  if (text.includes('professional fighters league') || /\bpfl\b/.test(text)) return 'pfl';
  if (text.includes('one championship')) return 'one';
  return '';
}

function eventNumber(entry) {
  return norm(eventName(entry)).match(/\b(?:ufc|wec|bellator|pfl|rizin|one|pride|pancrase)\s*(?:fight\s*night\s*)?(\d{1,4})\b/)?.[1] || '';
}

function eventTokens(entry) {
  const stop = new Set(['the','and','with','from','into','versus','fight','fighting','night','event','championship','championships']);
  return norm(eventName(entry)).split(' ').filter(token => token.length >= 3 && !stop.has(token));
}

function eventMatch(value, entry) {
  const haystack = norm(value);
  const title = norm(eventName(entry));
  if (!haystack || !title) return false;
  if (haystack.includes(title) || title.includes(haystack)) return true;
  const promo = promotionKey(entry);
  const number = eventNumber(entry);
  if (promo && number && haystack.includes(promo) && new RegExp(`\\b${number}\\b`).test(haystack)) return true;
  const tokens = eventTokens(entry);
  return tokens.length >= 2 && tokens.filter(token => haystack.includes(token)).length >= Math.min(3, tokens.length);
}

function tapologyEventUrl(value) {
  if (!http(value)) return false;
  try {
    const url = new URL(value);
    return /(^|\.)tapology\.com$/i.test(url.hostname) && /\/fightcenter\/events\//i.test(url.pathname);
  } catch { return false; }
}

function exactBoundTapologyPoster(entry) {
  return http(entry?.imageUrl) &&
    clean(entry?.imageSourceType) === 'tapology-event-poster' &&
    entry?.imagePosterVerified === true &&
    clean(entry?.imageArtifactType) === 'event-poster' &&
    trustedTapologyBindings.has(clean(entry?.imageTapologyBinding)) &&
    tapologyEventUrl(entry?.imageTapologyPageUrl);
}

function officialPoster(entry) {
  if (!http(entry?.imageUrl) || clean(entry?.imageSubjectType) !== 'event') return false;
  return ['official-promotion-event-poster','official-promotion-event-image','archived-promotion-event-poster','verified-manual-event-poster'].includes(clean(entry?.imageSourceType));
}

function promoteOfficialPoster(entry) {
  entry.imageSourceType = clean(entry.imageSourceType) === 'official-promotion-event-image'
    ? 'official-promotion-event-poster'
    : clean(entry.imageSourceType);
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = true;
  entry.imageConfidence = Math.max(0.96, Number(entry.imageConfidence || 0.96));
  entry.imageSubjectType = 'event';
  entry.imageStatus = 'resolved';
  entry.imageExactMatch = true;
  delete entry.imageUnresolved;
}

function ordinal(mmdd) {
  const match = /^(\d{2})-(\d{2})$/.exec(mmdd);
  if (!match) return 999;
  const date = new Date(Date.UTC(2024, Number(match[1]) - 1, Number(match[2])));
  return Math.round((date - Date.UTC(2024, 0, 1)) / 86400000);
}

function localMMDD() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value || '';
  return `${get('month')}-${get('day')}`;
}

function distance(entry) {
  const a = ordinal(String(entry?.date || '').slice(5));
  const b = ordinal(localMMDD());
  const direct = Math.abs(a - b);
  return Math.min(direct, 366 - direct);
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

function wikipediaTitleFromEntry(entry) {
  const direct = clean(entry?.wikipediaTitle || '').split('#')[0];
  if (direct && direct !== '') return direct;
  for (const value of [entry?.archiveSourceUrl, entry?.originalSourceUrl, entry?.imageSourceUrl]) {
    try {
      const url = new URL(value);
      if (!url.hostname.endsWith('wikipedia.org') || !url.pathname.startsWith('/wiki/')) continue;
      return decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ');
    } catch {}
  }
  return '';
}

function posterEvidence(fileName, width, height, entry) {
  const file = norm(fileName);
  const vertical = width > 0 && height > 0 && width / height <= 1.05;
  if (/\bposter\b|\bevent art\b|\bkey art\b/.test(file)) return true;
  if (file && eventMatch(file, entry)) return true;
  return vertical;
}

async function resolveWikipediaPoster(entry) {
  const title = wikipediaTitleFromEntry(entry);
  if (!title) return null;
  try {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    url.searchParams.set('redirects', '1');
    url.searchParams.set('prop', 'pageimages|info');
    url.searchParams.set('piprop', 'name|thumbnail|original');
    url.searchParams.set('pithumbsize', '1400');
    url.searchParams.set('inprop', 'url');
    url.searchParams.set('titles', title);
    const data = await fetchJson(url);
    const page = data?.query?.pages?.[0];
    const pageTitle = clean(page?.title || title);
    const fileName = clean(page?.pageimage || '');
    const imageUrl = page?.thumbnail?.source || page?.original?.source || '';
    const width = Number(page?.thumbnail?.width || 0);
    const height = Number(page?.thumbnail?.height || 0);
    if (!http(imageUrl) || !eventMatch(pageTitle, entry) || !posterEvidence(fileName, width, height, entry)) return null;
    return {
      imageUrl,
      imageAlt: `${eventName(entry)} event poster`,
      imageCredit: 'Wikipedia / Wikimedia Commons',
      imageSourceUrl: clean(page?.fullurl || ''),
      imageSourceType: 'wikipedia-event-poster',
      imageConfidence: 0.93,
      imageSubjectType: 'event',
      imageArtifactType: 'event-poster',
      imagePosterVerified: true,
      imageMatchReason: 'Exact Wikipedia MMA event page supplied poster/key art after exact-bound Tapology resolution was unavailable.'
    };
  } catch { return null; }
}

function applyPoster(entry, poster, nowIso) {
  Object.assign(entry, poster);
  entry.imageResolvedAt = nowIso;
  entry.imageStatus = 'resolved';
  entry.imageExactMatch = true;
  delete entry.imageUnresolved;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const events = (history.entries || []).filter(isEvent);
const nowIso = new Date().toISOString();
const targets = events
  .sort((a, b) => {
    const current = Number(distance(a) > 2) - Number(distance(b) > 2);
    if (current) return current;
    const verifiedA = Number(exactBoundTapologyPoster(a) || officialPoster(a));
    const verifiedB = Number(exactBoundTapologyPoster(b) || officialPoster(b));
    if (verifiedA !== verifiedB) return verifiedA - verifiedB;
    const missing = Number(http(a?.imageUrl)) - Number(http(b?.imageUrl));
    if (missing) return missing;
    return Number(b?.weight || 0) - Number(a?.weight || 0);
  })
  .slice(0, LIMIT);

let tapologyRetained = 0;
let officialRetained = 0;
let wikipediaResolved = 0;
let fallbackPreserved = 0;
let unresolved = 0;

for (const entry of targets) {
  if (exactBoundTapologyPoster(entry)) {
    tapologyRetained += 1;
    continue;
  }
  if (officialPoster(entry)) {
    promoteOfficialPoster(entry);
    officialRetained += 1;
    continue;
  }

  const wikipedia = await resolveWikipediaPoster(entry);
  if (wikipedia) {
    applyPoster(entry, wikipedia, nowIso);
    wikipediaResolved += 1;
  } else if (http(entry?.imageUrl)) {
    // Keep a trusted/relevant fallback visible in the archive. Do not label it
    // as a verified poster and do not erase it merely because poster backfill
    // has not succeeded yet.
    entry.imagePosterVerified = false;
    entry.imageFallback = true;
    if (clean(entry?.imageArtifactType) === 'event-poster') entry.imageArtifactType = 'event-fallback';
    fallbackPreserved += 1;
  } else {
    entry.imagePosterVerified = false;
    entry.imageStatus = 'unresolved';
    unresolved += 1;
  }
  await sleep(80);
}

history.eventPosterResolverVersion = 2;
history.eventPosterResolverUpdatedAt = nowIso;
history.eventPosterPriority = ['tapology-exact-bound', 'official-promotion', 'wikipedia-exact-event', 'stored-relevant-fallback'];
history.eventPosterSearchPolicy = 'no-unbound-image-search';
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

const verified = events.filter(entry => exactBoundTapologyPoster(entry) || (entry?.imagePosterVerified === true && http(entry?.imageUrl))).length;
console.log(`OTD event-poster resolver v2: ${targets.length} reviewed; ${tapologyRetained} exact-bound Tapology, ${officialRetained} official, ${wikipediaResolved} Wikipedia, ${fallbackPreserved} stored fallbacks preserved, ${unresolved} unresolved.`);
console.log(`Verified event-poster coverage after safe pass: ${verified}/${events.length}. No unbound Tapology image search is used here.`);
