import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const LIMIT = Math.max(1, Number(process.env.OTD_EVENT_POSTER_LIMIT || 220));
const REQUEST_TIMEOUT_MS = 7000;
const REQUEST_ATTEMPTS = 1;
const WIKIPEDIA_BATCH_SIZE = 25;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 MMA-Matlock-OTD-Posters/5.0';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const http = value => /^https:\/\//i.test(clean(value));
const trustedTapologyBindings = new Set(['direct-event-page','bing-image-exact-event-page','manual-exact-event-page','legacy-filename-exact']);
const trustedPosterTypes = new Set([
  'official-promotion-event-poster',
  'wikipedia-event-poster',
  'archived-promotion-event-poster',
  'verified-manual-event-poster'
]);

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
  const stop = new Set([
    'the','and','with','from','into','versus','fight','fighting','night','event','championship','championships',
    'ufc','wec','bellator','pride','pancrase','rizin','pfl','one','strikeforce'
  ]);
  return norm(eventName(entry)).split(' ').filter(token => token.length >= 3 && !stop.has(token));
}

function eventMatch(value, entry) {
  const haystack = norm(value);
  const title = norm(eventName(entry));
  if (!haystack || !title) return false;
  if (haystack.includes(title) || title.includes(haystack)) return true;
  const promo = promotionKey(entry);
  const number = eventNumber(entry);
  if (promo && number) {
    const compact = haystack.replace(/\s+/g, '');
    if (compact.includes(`${promo}${number}`)) return true;
    if (haystack.includes(promo) && new RegExp(`\\b${number}\\b`).test(haystack)) return true;
  }
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

function trustedExistingPoster(entry) {
  if (!http(entry?.imageUrl) || clean(entry?.imageSubjectType) !== 'event') return false;
  const type = clean(entry?.imageSourceType);
  if (!trustedPosterTypes.has(type)) return false;
  if (type === 'verified-manual-event-poster' && entry?.imageManualVisualVerified !== true) return false;
  return entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster' && Number(entry?.imageConfidence || 0) >= 0.9;
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
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Unable to fetch ${url}`);
}

function wikipediaTitleFromUrl(value) {
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith('wikipedia.org') || !url.pathname.startsWith('/wiki/')) return '';
    return decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ');
  } catch { return ''; }
}

function deterministicWikipediaTitles(entry) {
  const titles = [];
  const add = value => {
    const title = clean(String(value || '').split('#')[0].replace(/_/g, ' '));
    if (title && !titles.some(existing => norm(existing) === norm(title))) titles.push(title);
  };

  add(entry?.wikipediaTitle);
  for (const value of [entry?.archiveSourceUrl, entry?.originalSourceUrl, entry?.imageSourceUrl]) add(wikipediaTitleFromUrl(value));

  const name = eventName(entry);
  const promo = promotionKey(entry);
  const number = eventNumber(entry);

  if (number && ['ufc','wec','bellator','pride','rizin'].includes(promo)) {
    const label = { ufc: 'UFC', wec: 'WEC', bellator: 'Bellator', pride: 'Pride', rizin: 'Rizin' }[promo];
    add(`${label} ${number}`);
  }

  if (promo !== 'pancrase') add(name);
  return titles.slice(0, 4);
}

function filenamePosterEvidence(fileName, entry) {
  const file = norm(String(fileName || '').replace(/\.(?:jpe?g|png|webp|gif|tiff?)$/i, ''));
  if (!file) return false;

  const promo = promotionKey(entry);
  const number = eventNumber(entry);
  const compactFile = file.replace(/\s+/g, '');
  const compactTitle = norm(eventName(entry)).replace(/\s+/g, '');
  const explicitPoster = /\bposter\b|\bpromotional\b|\bpromo\b|\bevent art\b|\bkey art\b|\bofficial art\b/.test(file);

  if (!number && compactTitle.length >= 12 && compactFile.includes(compactTitle)) return true;

  if (promo && number) {
    const compactKey = `${promo}${number}`;
    const hasExactKey = compactFile.includes(compactKey) || (file.includes(promo) && new RegExp(`\\b${number}\\b`).test(file));
    if (!hasExactKey) return false;
    if (explicitPoster) return true;

    const keyPattern = new RegExp(`${promo}\\s*${number}\\b`, 'i');
    const leftovers = file
      .replace(keyPattern, ' ')
      .split(' ')
      .filter(Boolean)
      .filter(token => !['jpg','jpeg','png','webp','gif','image','official','event','art','key','promo','promotional','poster'].includes(token));
    if (!leftovers.length) return true;
    const allowed = new Set(eventTokens(entry));
    return leftovers.length <= 5 && leftovers.every(token => allowed.has(token) || token === 'vs');
  }

  const tokens = eventTokens(entry);
  const matches = tokens.filter(token => file.includes(token));
  return explicitPoster && tokens.length >= 2 && matches.length >= Math.min(3, tokens.length);
}

function wikipediaPosterFromPage(page, entry) {
  if (!page || page?.missing) return null;
  const pageTitle = clean(page?.title || '');
  const fileName = clean(page?.pageimage || '');
  const imageUrl = page?.thumbnail?.source || page?.original?.source || '';
  if (!http(imageUrl) || !eventMatch(pageTitle, entry) || !filenamePosterEvidence(fileName, entry)) return null;
  return {
    imageUrl,
    imageAlt: `${eventName(entry)} event poster`,
    imageCredit: 'Wikipedia / Wikimedia Commons',
    imageSourceUrl: clean(page?.fullurl || ''),
    imageSourceType: 'wikipedia-event-poster',
    imageConfidence: 0.96,
    imageSubjectType: 'event',
    imageArtifactType: 'event-poster',
    imagePosterVerified: true,
    imageMatchReason: `Exact Wikipedia event page (${pageTitle}) supplied poster/key art whose filename identifies this event.`,
    imageWikipediaTitle: pageTitle,
    imageWikipediaFileTitle: fileName
  };
}

function chunks(values, size) {
  const output = [];
  for (let i = 0; i < values.length; i += size) output.push(values.slice(i, i + size));
  return output;
}

async function resolveWikipediaPostersBatch(entries) {
  const resolved = new Map();
  const titleLists = new Map(entries.map(entry => [entry, deterministicWikipediaTitles(entry)]));
  const maxRounds = Math.max(0, ...entries.map(entry => titleLists.get(entry)?.length || 0));
  let requests = 0;
  let failedRequests = 0;

  for (let round = 0; round < maxRounds; round += 1) {
    const candidates = entries
      .filter(entry => !resolved.has(entry))
      .map(entry => ({ entry, title: titleLists.get(entry)?.[round] || '' }))
      .filter(item => item.title);

    for (const batch of chunks(candidates, WIKIPEDIA_BATCH_SIZE)) {
      const titles = [...new Set(batch.map(item => item.title))];
      if (!titles.length) continue;

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
        url.searchParams.set('titles', titles.join('|'));
        const data = await fetchJson(url);
        requests += 1;
        const pages = Array.isArray(data?.query?.pages) ? data.query.pages : [];

        for (const { entry } of batch) {
          if (resolved.has(entry)) continue;
          for (const page of pages) {
            const poster = wikipediaPosterFromPage(page, entry);
            if (poster) {
              resolved.set(entry, poster);
              break;
            }
          }
        }
      } catch {
        failedRequests += 1;
      }
      await sleep(140);
    }
  }

  return { resolved, requests, failedRequests };
}

function applyPoster(entry, poster, nowIso) {
  Object.assign(entry, poster);
  entry.imageResolvedAt = nowIso;
  entry.imageStatus = 'resolved';
  entry.imageExactMatch = true;
  delete entry.imageUnresolved;
}

function demoteUnprovenPoster(entry) {
  if (!http(entry?.imageUrl)) return;
  if (exactBoundTapologyPoster(entry) || trustedExistingPoster(entry)) return;
  if (entry?.imagePosterVerified === true || clean(entry?.imageArtifactType) === 'event-poster') {
    entry.imagePosterVerified = false;
    entry.imageArtifactType = 'event-fallback';
    entry.imageFallback = true;
    entry.imageExactMatch = false;
  }
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const events = (history.entries || []).filter(isEvent);
const nowIso = new Date().toISOString();

for (const entry of events) demoteUnprovenPoster(entry);

const targets = events
  .sort((a, b) => {
    const current = Number(distance(a) > 2) - Number(distance(b) > 2);
    if (current) return current;
    const verifiedA = Number(exactBoundTapologyPoster(a) || trustedExistingPoster(a));
    const verifiedB = Number(exactBoundTapologyPoster(b) || trustedExistingPoster(b));
    if (verifiedA !== verifiedB) return verifiedA - verifiedB;
    const missing = Number(http(a?.imageUrl)) - Number(http(b?.imageUrl));
    if (missing) return missing;
    return Number(b?.weight || 0) - Number(a?.weight || 0);
  })
  .slice(0, LIMIT);

let tapologyRetained = 0;
let trustedRetained = 0;
let wikipediaResolved = 0;
let fallbackPreserved = 0;
let unresolved = 0;
const wikipediaTargets = [];

for (const entry of targets) {
  if (exactBoundTapologyPoster(entry)) {
    tapologyRetained += 1;
    continue;
  }
  if (trustedExistingPoster(entry)) {
    trustedRetained += 1;
    continue;
  }
  wikipediaTargets.push(entry);
}

const wikipediaBatch = await resolveWikipediaPostersBatch(wikipediaTargets);

for (const entry of wikipediaTargets) {
  const wikipedia = wikipediaBatch.resolved.get(entry);
  if (wikipedia) {
    applyPoster(entry, wikipedia, nowIso);
    wikipediaResolved += 1;
  } else if (http(entry?.imageUrl)) {
    entry.imagePosterVerified = false;
    entry.imageFallback = true;
    entry.imageArtifactType = 'event-fallback';
    fallbackPreserved += 1;
  } else {
    entry.imagePosterVerified = false;
    entry.imageStatus = 'unresolved';
    unresolved += 1;
  }
}

history.eventPosterResolverVersion = 5;
history.eventPosterResolverUpdatedAt = nowIso;
history.eventPosterPriority = ['tapology-exact-bound', 'trusted-explicit-poster', 'wikipedia-exact-event-poster-evidence', 'stored-relevant-fallback'];
history.eventPosterSearchPolicy = 'no-unbound-image-search; no generic event-image promotion; no orientation-only verification; Wikipedia filename must identify event/poster; batched exact-page lookup';
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

const verified = events.filter(entry => exactBoundTapologyPoster(entry) || trustedExistingPoster(entry)).length;
console.log(`OTD event-poster resolver v5: ${targets.length} reviewed; ${tapologyRetained} exact-bound Tapology, ${trustedRetained} trusted existing posters, ${wikipediaResolved} Wikipedia posters, ${fallbackPreserved} stored fallbacks preserved, ${unresolved} unresolved.`);
console.log(`Wikipedia poster recovery used ${wikipediaBatch.requests} successful batched request(s) and ${wikipediaBatch.failedRequests} failed batch(es).`);
console.log(`Verified event-poster coverage after safe pass: ${verified}/${events.length}. Wikipedia fallbacks require an exact event page plus event-identifying poster filename.`);
