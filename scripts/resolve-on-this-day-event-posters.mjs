import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OVERRIDES_PATH = process.argv[3] || 'assets/data/on-this-day-image-source-overrides.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const LIMIT = Math.max(1, Number(process.env.OTD_EVENT_POSTER_LIMIT || 220));
const REQUEST_TIMEOUT_MS = 18000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 MMA-Matlock-OTD-Posters/1.0';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function decodeHtml(value) {
  return clean(String(value || '')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>'));
}

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
  const stop = new Set(['the','and','with','from','into','versus','vs','fight','fighting','night','event','championship','championships','final','finals']);
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
  const matches = tokens.filter(token => haystack.includes(token));
  return tokens.length >= 2 && matches.length >= Math.min(3, tokens.length);
}

function http(value) {
  return /^https:\/\//i.test(clean(value));
}

function tapologyEventUrl(value) {
  if (!http(value)) return false;
  try {
    const url = new URL(value);
    return /(^|\.)tapology\.com$/i.test(url.hostname) && /\/fightcenter\/events\//i.test(url.pathname);
  } catch { return false; }
}

function tapologyPosterUrl(value) {
  if (!http(value)) return false;
  try {
    const url = new URL(value);
    return /(^|\.)images\.tapology\.com$/i.test(url.hostname) && /\/poster_images\//i.test(url.pathname);
  } catch { return false; }
}

function posterishFilename(value, entry) {
  const text = norm(value);
  if (!text) return false;
  if (/\bposter\b|\bkey art\b|\bevent art\b|promotional/.test(text)) return true;
  return eventMatch(text, entry);
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

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return { html: await response.text(), finalUrl: response.url || url };
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

function attr(tag, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${safe}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function htmlTitle(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = clean(attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (key !== 'og:title') continue;
    const content = attr(tag, 'content');
    if (content) return content;
  }
  return decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
}

function absoluteUrl(value, base) {
  try { return new URL(decodeHtml(value), base).href; }
  catch { return ''; }
}

function tapologyPosterCandidates(html, pageUrl) {
  const found = new Map();
  const add = raw => {
    const url = absoluteUrl(raw, pageUrl);
    if (!tapologyPosterUrl(url)) return;
    let score = 100;
    if (/\/original\//i.test(url)) score += 80;
    if (/\/profile\//i.test(url)) score += 60;
    if (/\/medium\//i.test(url)) score += 35;
    if (/\/small\//i.test(url)) score += 10;
    found.set(url, Math.max(found.get(url) || 0, score));
  };

  for (const tag of html.match(/<(?:img|a|meta|source)\b[^>]*>/gi) || []) {
    for (const name of ['src','href','content','data-src','data-original','data-lazy-src']) add(attr(tag, name));
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    for (const part of String(srcset || '').split(',')) add(part.trim().split(/\s+/)[0] || '');
  }

  for (const match of html.matchAll(/(?:https?:)?\\?\/\\?\/images\.tapology\.com\\?\/poster_images\\?\/[^"'<>\s)]+/gi)) {
    add(match[0].replace(/\\\//g, '/'));
  }

  return [...found.entries()]
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score);
}

function ddgUrls(html) {
  const output = [];
  for (const match of html.matchAll(/href=["']([^"']+)["']/gi)) {
    let href = decodeHtml(match[1]);
    try {
      if (href.startsWith('//')) href = `https:${href}`;
      const parsed = new URL(href, 'https://html.duckduckgo.com');
      if (parsed.hostname.includes('duckduckgo.com') && parsed.searchParams.get('uddg')) href = decodeURIComponent(parsed.searchParams.get('uddg'));
      if (http(href) && !href.includes('duckduckgo.com')) output.push(href);
    } catch {}
  }
  return [...new Set(output)];
}

async function searchWeb(query) {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query);
  return (await fetchText(url)).html;
}

async function discoverTapologyPages(entry) {
  const name = eventName(entry).replace(/["<>]/g, ' ');
  const year = String(entry?.date || '').slice(0, 4);
  const queries = [
    `site:tapology.com/fightcenter/events "${name}"`,
    `site:tapology.com/fightcenter/events "${name}" ${year}`
  ];
  const output = [];
  for (const query of queries) {
    try {
      const html = await searchWeb(query);
      for (const url of ddgUrls(html)) if (tapologyEventUrl(url)) output.push(url);
    } catch {}
  }
  return [...new Set(output)].slice(0, 6);
}

async function discoverTapologyPosterImage(entry) {
  const name = eventName(entry).replace(/["<>]/g, ' ');
  try {
    const html = await searchWeb(`site:images.tapology.com/poster_images "${name}"`);
    const candidates = [];
    for (const match of html.matchAll(/https?:\/\/images\.tapology\.com\/poster_images\/[^"'<>\s&)]+/gi)) {
      const url = decodeHtml(match[0]);
      if (!tapologyPosterUrl(url)) continue;
      if (!posterishFilename(url, entry)) continue;
      candidates.push(url);
    }
    return [...new Set(candidates)][0] || '';
  } catch { return ''; }
}

function overrideFor(entry, overrides) {
  return overrides.find(item => clean(item?.date) === clean(entry?.date) && norm(item?.title) === norm(entry?.title));
}

async function resolveTapologyPoster(entry, overrides) {
  const known = [];
  const override = overrideFor(entry, overrides);
  for (const value of [override?.sourceUrl, entry?.imageSourceUrl, entry?.sourceUrl]) {
    if (tapologyEventUrl(value)) known.push(value);
  }
  known.push(...await discoverTapologyPages(entry));

  for (const pageUrl of [...new Set(known)]) {
    try {
      const { html, finalUrl } = await fetchText(pageUrl);
      if (!eventMatch(htmlTitle(html), entry)) continue;
      const poster = tapologyPosterCandidates(html, finalUrl)[0];
      if (!poster) continue;
      return {
        imageUrl: poster.url,
        imageAlt: `${eventName(entry)} event poster`,
        imageCredit: 'Tapology',
        imageSourceUrl: finalUrl,
        imageSourceType: 'tapology-event-poster',
        imageConfidence: 0.99,
        imageSubjectType: 'event',
        imageArtifactType: 'event-poster',
        imagePosterVerified: true,
        imageMatchReason: 'Exact Tapology event page supplied the event poster.'
      };
    } catch {}
    await sleep(80);
  }

  const indexedPoster = await discoverTapologyPosterImage(entry);
  if (indexedPoster) {
    return {
      imageUrl: indexedPoster,
      imageAlt: `${eventName(entry)} event poster`,
      imageCredit: 'Tapology',
      imageSourceUrl: known[0] || `https://www.tapology.com/search?term=${encodeURIComponent(eventName(entry))}`,
      imageSourceType: 'tapology-event-poster',
      imageConfidence: 0.96,
      imageSubjectType: 'event',
      imageArtifactType: 'event-poster',
      imagePosterVerified: true,
      imageMatchReason: 'Exact-title discovery on Tapology’s poster image host resolved the event poster.'
    };
  }
  return null;
}

function trustedExistingPoster(entry) {
  if (!http(entry?.imageUrl)) return null;
  if (entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster') return {
    imageUrl: entry.imageUrl,
    imageAlt: clean(entry.imageAlt) || `${eventName(entry)} event poster`,
    imageCredit: clean(entry.imageCredit || entry.source || 'Source'),
    imageSourceUrl: clean(entry.imageSourceUrl || entry.sourceUrl || entry.imageUrl),
    imageSourceType: clean(entry.imageSourceType || 'verified-event-poster'),
    imageConfidence: Math.max(0.9, Number(entry.imageConfidence || 0.9)),
    imageSubjectType: 'event',
    imageArtifactType: 'event-poster',
    imagePosterVerified: true,
    imageMatchReason: clean(entry.imageMatchReason || 'Previously verified exact event poster retained.')
  };

  if (tapologyPosterUrl(entry.imageUrl)) return {
    imageUrl: entry.imageUrl,
    imageAlt: clean(entry.imageAlt) || `${eventName(entry)} event poster`,
    imageCredit: 'Tapology',
    imageSourceUrl: clean(entry.imageSourceUrl || entry.sourceUrl || entry.imageUrl),
    imageSourceType: 'tapology-event-poster',
    imageConfidence: Math.max(0.96, Number(entry.imageConfidence || 0.96)),
    imageSubjectType: 'event',
    imageArtifactType: 'event-poster',
    imagePosterVerified: true,
    imageMatchReason: 'Tapology poster-image URL confirms this is event poster artwork.'
  };

  if (clean(entry?.imageSourceType) === 'official-promotion-event-image' && clean(entry?.imageSubjectType) === 'event') return {
    imageUrl: entry.imageUrl,
    imageAlt: clean(entry.imageAlt) || `${eventName(entry)} event poster`,
    imageCredit: clean(entry.imageCredit || entry.promotion || 'Promotion'),
    imageSourceUrl: clean(entry.imageSourceUrl || entry.sourceUrl || entry.imageUrl),
    imageSourceType: 'official-promotion-event-poster',
    imageConfidence: Math.max(0.96, Number(entry.imageConfidence || 0.96)),
    imageSubjectType: 'event',
    imageArtifactType: 'event-poster',
    imagePosterVerified: true,
    imageMatchReason: clean(entry.imageMatchReason || 'Exact official promotion event page supplied the event poster/key art.')
  };

  return null;
}

function wikipediaTitleFromEntry(entry) {
  const direct = clean(entry?.wikipediaTitle || '').split('#')[0];
  if (direct) return direct;
  for (const value of [entry?.sourceUrl, entry?.imageSourceUrl]) {
    try {
      const url = new URL(value);
      if (!url.hostname.endsWith('wikipedia.org') || !url.pathname.startsWith('/wiki/')) continue;
      return decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ');
    } catch {}
  }
  return '';
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
    if (!http(imageUrl) || !eventMatch(pageTitle, entry)) return null;
    const vertical = width > 0 && height > 0 && width / height <= 1.05;
    if (!posterishFilename(fileName, entry) && !vertical) return null;
    return {
      imageUrl,
      imageAlt: `${eventName(entry)} event poster`,
      imageCredit: 'Wikipedia / Wikimedia Commons',
      imageSourceUrl: clean(page?.fullurl || entry?.sourceUrl || ''),
      imageSourceType: 'wikipedia-event-poster',
      imageConfidence: 0.93,
      imageSubjectType: 'event',
      imageArtifactType: 'event-poster',
      imagePosterVerified: true,
      imageMatchReason: 'Exact Wikipedia MMA event page supplied poster/key art rather than a generic event image.'
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

function clearNonPoster(entry, reason) {
  delete entry.imageUrl;
  delete entry.imageAlt;
  delete entry.imageCredit;
  delete entry.imageFileTitle;
  delete entry.imageWidth;
  delete entry.imageHeight;
  delete entry.imagePosition;
  delete entry.imageResolvedAt;
  entry.imageSourceUrl = '';
  entry.imageSourceType = 'event-poster-required';
  entry.imageConfidence = 0;
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = false;
  entry.imageMatchReason = reason;
  entry.imageStatus = 'unresolved';
  entry.imageUnresolved = true;
  entry.imageExactMatch = false;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
let overrideData = { entries: [] };
try { overrideData = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8')); } catch {}
const overrides = Array.isArray(overrideData?.entries) ? overrideData.entries : [];
const events = (history.entries || []).filter(isEvent);
const nowIso = new Date().toISOString();

const clearlyWrongTypes = new Set([
  'event-article',
  'official-promotion-fighter-fallback',
  'promotion-or-media-headshot',
  'fighter-fallback',
  'wikimedia-commons-search',
  'source-page',
  'existing-image'
]);

let preScrubbed = 0;
for (const entry of events) {
  if (!http(entry?.imageUrl)) continue;
  if (entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster') continue;
  if (tapologyPosterUrl(entry.imageUrl)) continue;
  if (clearlyWrongTypes.has(clean(entry?.imageSourceType)) || clean(entry?.imageSubjectType) === 'fighter') {
    clearNonPoster(entry, 'Removed a non-poster event image. Event entries require the actual event poster/key art; editorial thumbnails and fighter photos are not accepted.');
    preScrubbed += 1;
  }
}

const targets = events
  .sort((a, b) => {
    const current = Number(distance(a) > 2) - Number(distance(b) > 2);
    if (current) return current;
    const tapology = Number(clean(a?.imageSourceType) === 'tapology-event-poster') - Number(clean(b?.imageSourceType) === 'tapology-event-poster');
    if (tapology) return tapology;
    const missing = Number(http(a?.imageUrl)) - Number(http(b?.imageUrl));
    if (missing) return missing;
    return Number(b?.weight || 0) - Number(a?.weight || 0);
  })
  .slice(0, LIMIT);

let tapologyResolved = 0;
let retained = 0;
let wikipediaResolved = 0;
let unresolved = 0;

for (const entry of targets) {
  let poster = await resolveTapologyPoster(entry, overrides).catch(() => null);
  if (poster) tapologyResolved += 1;

  if (!poster) {
    poster = trustedExistingPoster(entry);
    if (poster) retained += 1;
  }

  if (!poster) {
    poster = await resolveWikipediaPoster(entry);
    if (poster) wikipediaResolved += 1;
  }

  if (poster) applyPoster(entry, poster, nowIso);
  else {
    clearNonPoster(entry, 'No verified event poster has been resolved yet. Keep retrying Tapology first, then exact official/Wikipedia poster sources.');
    unresolved += 1;
  }
  await sleep(100);
}

history.eventPosterResolverVersion = 1;
history.eventPosterResolverUpdatedAt = nowIso;
history.eventPosterPriority = ['tapology', 'official-promotion', 'wikipedia', 'verified-manual-fallback'];
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

const verified = events.filter(entry => entry?.imagePosterVerified === true && http(entry?.imageUrl)).length;
console.log(`OTD event-poster resolver: ${targets.length} reviewed; ${tapologyResolved} Tapology posters, ${retained} trusted existing posters, ${wikipediaResolved} Wikipedia posters, ${unresolved} unresolved.`);
console.log(`Removed ${preScrubbed} clearly non-poster event images. Verified event-poster coverage: ${verified}/${events.length}.`);
