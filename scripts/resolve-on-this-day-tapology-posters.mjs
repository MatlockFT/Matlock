import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OVERRIDES_PATH = process.argv[3] || 'assets/data/on-this-day-image-source-overrides.json';
const CACHE_PATH = process.argv[4] || 'assets/data/on-this-day-image-cache.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const LIMIT = Math.max(1, Number(process.env.OTD_TAPOLOGY_POSTER_LIMIT || 320));
const REQUEST_TIMEOUT_MS = 20000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 MMA-Matlock-OTD-TapologyPosters/4.0';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const http = value => /^https:\/\//i.test(clean(value));

function isEvent(entry) {
  return entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function textFromHtml(value) {
  return clean(decodeEntities(String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

function decodeUrlish(value) {
  let output = decodeEntities(String(value || '')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/\\u002f/gi, '/')
    .replace(/\\\//g, '/'));
  try { output = decodeURIComponent(output); } catch {}
  return output;
}

function attr(tag, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${safe}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function absoluteUrl(value, base) {
  try { return new URL(decodeUrlish(value), base).href; }
  catch { return ''; }
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

function normalizedEventPage(value) {
  try {
    const url = new URL(value);
    if (!tapologyEventUrl(url.href)) return '';
    return `${url.hostname.toLowerCase().replace(/^www\./, '')}${url.pathname.replace(/\/+$/, '')}`;
  } catch { return ''; }
}

function sameExactEventPage(a, b) {
  const left = normalizedEventPage(a);
  const right = normalizedEventPage(b);
  return Boolean(left && right && left === right);
}

function exactOverride(entry, overrides) {
  return overrides.find(item =>
    clean(item?.date) === clean(entry?.date) &&
    norm(item?.title) === norm(entry?.title) &&
    tapologyEventUrl(item?.sourceUrl)
  );
}

function eventName(entry, overrides = []) {
  const override = exactOverride(entry, overrides);
  return clean(override?.eventTitle || String(entry?.title || '').replace(/\s+took place$/i, ''));
}

function promotionKey(value) {
  const text = norm(typeof value === 'object' ? `${value?.promotion || ''} ${value?.title || ''}` : value);
  if (text.includes('ultimate fighting') || /\bufc\b/.test(text)) return 'ufc';
  if (text.includes('world extreme cagefighting') || /\bwec\b/.test(text)) return 'wec';
  if (text.includes('strikeforce')) return 'strikeforce';
  if (text.includes('bellator')) return 'bellator';
  if (text.includes('pride')) return 'pride';
  if (text.includes('pancrase')) return 'pancrase';
  if (text.includes('rizin')) return 'rizin';
  if (text.includes('professional fighters league') || /\bpfl\b/.test(text)) return 'pfl';
  if (text === 'one' || text.includes('one championship')) return 'one';
  return '';
}

function eventNumber(value) {
  const text = norm(typeof value === 'object' ? eventName(value) : value);
  return text.match(/\b(?:ufc|wec|bellator|pride|pancrase|rizin|pfl|one)\s*(?:fight\s*night\s*)?(\d{1,4})\b/)?.[1] || '';
}

function eventTokens(value) {
  const stop = new Set([
    'the','and','with','from','into','versus','fight','fighting','night','event','championship','championships',
    'mma','fc','ufc','wec','bellator','pride','pancrase','rizin','pfl','one','strikeforce','took','place'
  ]);
  return norm(value).split(' ').filter(token => token.length >= 2 && !stop.has(token));
}

function titleScore(candidate, entry, overrides = []) {
  const expected = eventName(entry, overrides);
  const left = norm(candidate);
  const right = norm(expected);
  if (!left || !right) return 0;
  if (left === right) return 100;

  const expectedPromo = promotionKey(entry);
  const candidatePromo = promotionKey(candidate);
  const expectedNumber = eventNumber(expected);
  const candidateNumber = eventNumber(candidate);

  if (expectedNumber) {
    if (!candidateNumber || candidateNumber !== expectedNumber) return 0;
    if (expectedPromo && candidatePromo && expectedPromo !== candidatePromo) return 0;
    return 98;
  }

  if (left.includes(right) || right.includes(left)) return 94;

  const expectedTokens = [...new Set(eventTokens(expected))];
  const candidateTokens = new Set(eventTokens(candidate));
  if (!expectedTokens.length) return 0;
  const matched = expectedTokens.filter(token => candidateTokens.has(token)).length;
  const ratio = matched / expectedTokens.length;

  if (expectedPromo && candidatePromo && expectedPromo !== candidatePromo) return 0;
  if (expectedTokens.length >= 3 && ratio >= 0.8) return 88;
  if (expectedTokens.length >= 2 && matched >= 2 && ratio >= 0.67) return 82;
  return 0;
}

function isoFromTapologyDate(value) {
  const text = clean(value);
  let match = /\b((?:19|20)\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/.exec(text);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;

  match = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/]((?:19|20)\d{2})\b/.exec(text);
  if (match) return `${match[3]}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;

  const months = {
    jan:'01', january:'01', feb:'02', february:'02', mar:'03', march:'03', apr:'04', april:'04',
    may:'05', jun:'06', june:'06', jul:'07', july:'07', aug:'08', august:'08', sep:'09', sept:'09',
    september:'09', oct:'10', october:'10', nov:'11', november:'11', dec:'12', december:'12'
  };
  match = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/i.exec(text);
  if (match) return `${match[3]}-${months[match[1].toLowerCase()]}-${String(match[2]).padStart(2, '0')}`;
  return '';
}

async function fetchText(url, accept = 'text/html,application/xhtml+xml') {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept,
      'accept-language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return { html: await response.text(), finalUrl: response.url || url };
}

function htmlTitle(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = clean(attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (key === 'og:title' && attr(tag, 'content')) return attr(tag, 'content');
  }
  return decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
}

function pageEventName(html) {
  return clean(htmlTitle(html)
    .replace(/\|\s*(?:MMA|Kickboxing|Boxing|Combat Sports)[^|]*\|\s*Tapology.*$/i, '')
    .replace(/\|\s*Tapology.*$/i, ''));
}

function pageEventDate(html) {
  const text = textFromHtml(html);
  const labelled = /(?:^|\s)Date:\s*([^|]{0,80})/i.exec(text)?.[1] || '';
  return isoFromTapologyDate(labelled) || isoFromTapologyDate(text);
}

function pageMatchesEntry(html, entry, overrides = []) {
  const pageName = pageEventName(html);
  const score = titleScore(pageName, entry, overrides);
  if (score < 82) return false;
  const date = pageEventDate(html);
  const expectedDate = clean(entry?.date);
  if (!date || !expectedDate || date !== expectedDate) return false;
  return true;
}

function posterUrlsFromTapologyHtml(html, pageUrl, entry, overrides = []) {
  const found = new Map();
  const expected = norm(eventName(entry, overrides));

  const add = (raw, bonus = 0, evidence = '') => {
    const url = absoluteUrl(raw, pageUrl);
    if (!tapologyPosterUrl(url)) return;
    let score = 100 + bonus;
    if (/\/original\//i.test(url)) score += 80;
    if (/\/profile\//i.test(url)) score += 60;
    if (/\/medium\//i.test(url)) score += 35;
    const filename = norm(url.split('/').pop()?.split('?')[0] || '');
    if (expected && filename && (filename.includes(expected) || expected.includes(filename))) score += 40;
    const current = found.get(url);
    if (!current || score > current.score) found.set(url, { url, score, evidence });
  };

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = clean(attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (['og:image', 'twitter:image', 'twitter:image:src'].includes(key)) {
      add(attr(tag, 'content'), key === 'og:image' ? 300 : 260, key);
    }
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const alt = clean(attr(tag, 'alt'));
    const bonus = /\bposter\b/i.test(alt) ? 240 : titleScore(alt, entry, overrides) >= 82 ? 220 : 0;
    for (const name of ['src','data-src','data-original','data-lazy-src']) add(attr(tag, name), bonus, alt || name);
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    for (const part of String(srcset || '').split(',')) add(part.trim().split(/\s+/)[0] || '', bonus, alt || 'srcset');
  }

  const decoded = decodeUrlish(html);
  for (const match of decoded.matchAll(/https?:\/\/images\.tapology\.com\/poster_images\/[^"'<>\\s)&]+/gi)) {
    add(match[0], 0, 'page-poster-image');
  }

  return [...found.values()].sort((a, b) => b.score - a.score);
}

function tapologySearchUrl(term) {
  const url = new URL('https://www.tapology.com/search');
  url.searchParams.set('model[events]', 'eventsSearch');
  url.searchParams.set('search', 'Submit');
  url.searchParams.set('term', term);
  return url.href;
}

function searchCandidates(html, entry, overrides = []) {
  const rows = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];
  const candidates = [];

  for (const row of rows) {
    const anchor = (row.match(/<a\b[^>]*href=["'][^"']*\/fightcenter\/events\/[^"']+["'][^>]*>[\s\S]*?<\/a>/gi) || [])[0];
    if (!anchor) continue;
    const href = attr(anchor, 'href');
    const pageUrl = absoluteUrl(href, 'https://www.tapology.com/');
    if (!tapologyEventUrl(pageUrl)) continue;

    const anchorTitle = textFromHtml(anchor);
    const rowText = textFromHtml(row);
    const date = isoFromTapologyDate(rowText);
    const score = Math.max(titleScore(anchorTitle, entry, overrides), titleScore(rowText, entry, overrides));
    if (!date || date !== clean(entry?.date) || score < 82) continue;
    candidates.push({ pageUrl, title: anchorTitle, rowText, date, score });
  }

  const byPage = new Map();
  for (const candidate of candidates) {
    const key = normalizedEventPage(candidate.pageUrl);
    const current = byPage.get(key);
    if (!current || candidate.score > current.score) byPage.set(key, candidate);
  }
  return [...byPage.values()].sort((a, b) => b.score - a.score);
}

function searchTerms(entry, overrides = []) {
  const terms = [];
  const add = value => {
    const term = clean(value).replace(/["<>]/g, ' ');
    if (term && !terms.some(existing => norm(existing) === norm(term))) terms.push(term);
  };
  const name = eventName(entry, overrides);
  add(name);

  const promo = promotionKey(entry);
  const number = eventNumber(name);
  if (promo && number) {
    const label = { ufc:'UFC', wec:'WEC', bellator:'Bellator', pride:'Pride', pancrase:'Pancrase', rizin:'RIZIN', pfl:'PFL', one:'ONE' }[promo] || promo.toUpperCase();
    add(`${label} ${number}`);
  }

  add(entry?.wikipediaTitle);
  if (entry?.mainEvent) add(`${name} ${entry.mainEvent}`);
  return terms.slice(0, 4);
}

async function verifiedPage(pageUrl, entry, overrides = []) {
  if (!tapologyEventUrl(pageUrl)) return null;
  try {
    const { html, finalUrl } = await fetchText(pageUrl);
    if (!tapologyEventUrl(finalUrl) || !pageMatchesEntry(html, entry, overrides)) return null;
    return { html, pageUrl: finalUrl };
  } catch {
    return null;
  }
}

async function discoverFromTapologySearch(entry, overrides = []) {
  for (const term of searchTerms(entry, overrides)) {
    try {
      const { html } = await fetchText(tapologySearchUrl(term));
      const candidates = searchCandidates(html, entry, overrides);
      for (const candidate of candidates.slice(0, 4)) {
        const verified = await verifiedPage(candidate.pageUrl, entry, overrides);
        if (verified) return { ...verified, discovery: 'tapology-event-search' };
      }
    } catch {}
    await sleep(110);
  }
  return null;
}

async function bingWebSearch(query) {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '20');
  return (await fetchText(url)).html;
}

function tapologyEventUrlsFromSearch(html) {
  const output = [];
  const decoded = decodeUrlish(html);
  for (const match of decoded.matchAll(/https?:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\/[^"'<>\\s)&]+/gi)) {
    const url = match[0].replace(/[.,;]+$/, '');
    if (tapologyEventUrl(url)) output.push(url);
  }
  return [...new Set(output)];
}

async function discoverFromBing(entry, overrides = []) {
  const title = eventName(entry, overrides).replace(/["<>]/g, ' ');
  const year = String(entry?.date || '').slice(0, 4);
  for (const query of [`site:tapology.com/fightcenter/events "${title}"`, `site:tapology.com/fightcenter/events "${title}" ${year}`]) {
    try {
      const html = await bingWebSearch(query);
      for (const pageUrl of tapologyEventUrlsFromSearch(html).slice(0, 8)) {
        const verified = await verifiedPage(pageUrl, entry, overrides);
        if (verified) return { ...verified, discovery: 'bing-event-search-verified' };
      }
    } catch {}
    await sleep(110);
  }
  return null;
}

function cacheKey(entry) {
  return clean(entry?.autoKey || entry?.birthdayKey || `${clean(entry?.date)}::${norm(entry?.title)}`);
}

function trustedCacheRecord(record) {
  return record &&
    clean(record?.sourceType) === 'tapology-event-poster' &&
    clean(record?.artworkType) === 'poster' &&
    tapologyPosterUrl(record?.imageUrl) &&
    tapologyEventUrl(record?.tapologyPageUrl) &&
    ['direct-event-page','manual-exact-event-page','legacy-filename-exact'].includes(clean(record?.tapologyBinding));
}

function hasTrustedBinding(entry) {
  return tapologyPosterUrl(entry?.imageUrl) &&
    clean(entry?.imageSourceType) === 'tapology-event-poster' &&
    entry?.imagePosterVerified === true &&
    clean(entry?.imageArtifactType) === 'event-poster' &&
    ['direct-event-page','manual-exact-event-page','legacy-filename-exact'].includes(clean(entry?.imageTapologyBinding)) &&
    tapologyEventUrl(entry?.imageTapologyPageUrl);
}

function restoreCachedTapology(entry, record) {
  if (!trustedCacheRecord(record)) return false;
  entry.tapologyUrl = record.tapologyPageUrl;
  entry.source = 'Tapology';
  entry.sourceUrl = record.tapologyPageUrl;
  entry.imageUrl = record.imageUrl;
  entry.imageAlt = clean(record.imageAlt) || `${clean(entry?.title)} event poster`;
  entry.imageCredit = 'Tapology';
  entry.imageSourceUrl = record.tapologyPageUrl;
  entry.imageSourceType = 'tapology-event-poster';
  entry.imageConfidence = Math.max(0.99, Number(record.imageConfidence || 0));
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = true;
  entry.imageTapologyBinding = record.tapologyBinding;
  entry.imageTapologyPageUrl = record.tapologyPageUrl;
  entry.imageTapologyDiscovery = clean(record.tapologyDiscovery) || 'cache';
  entry.imageMatchReason = clean(record.imageMatchReason) || 'Restored an exact Tapology event poster previously bound to this event page.';
  entry.imageResolvedAt = clean(record.checkedAt) || new Date().toISOString();
  entry.imageStatus = 'resolved';
  entry.imageExactMatch = true;
  delete entry.imageUnresolved;
  return true;
}

function applyTapologyPoster(entry, result, nowIso, overrides = []) {
  const imageUrl = result.poster.url;
  entry.tapologyUrl = result.pageUrl;
  entry.source = 'Tapology';
  entry.sourceUrl = result.pageUrl;
  entry.imageUrl = imageUrl;
  entry.imageAlt = `${eventName(entry, overrides)} event poster`;
  entry.imageCredit = 'Tapology';
  entry.imageSourceUrl = result.pageUrl;
  entry.imageSourceType = 'tapology-event-poster';
  entry.imageConfidence = 1;
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = true;
  entry.imageTapologyBinding = 'direct-event-page';
  entry.imageTapologyPageUrl = result.pageUrl;
  entry.imageTapologyDiscovery = result.discovery;
  entry.imageMatchReason = `The exact Tapology event page was verified against the event title and date, then directly supplied this poster image (${result.poster.evidence || 'event page'}).`;
  entry.imageResolvedAt = nowIso;
  entry.imageStatus = 'resolved';
  entry.imageExactMatch = true;
  delete entry.imageUnresolved;
}

function upsertCachePoster(cache, entry, result, nowIso, overrides = []) {
  const key = cacheKey(entry);
  if (!key) return;
  cache.entries ||= {};
  cache.entries[key] = {
    ...(cache.entries[key] || {}),
    strategyVersion: 8,
    checkedAt: nowIso,
    entryClass: 'event',
    imageStatus: 'resolved',
    imageUrl: result.poster.url,
    imageAlt: `${eventName(entry, overrides)} event poster`,
    imageCredit: 'Tapology',
    imageSourceUrl: result.pageUrl,
    imageSourceType: 'tapology-event-poster',
    imageConfidence: 1,
    imageSubjectType: 'event',
    imageMatchReason: entry.imageMatchReason,
    status: 'exact-bound-poster',
    sourceType: 'tapology-event-poster',
    artworkType: 'poster',
    tapologyPageUrl: result.pageUrl,
    tapologyBinding: 'direct-event-page',
    tapologyDiscovery: result.discovery,
    tapologyEventTitle: pageEventName(result.html) || eventName(entry, overrides),
    tapologyEventDate: pageEventDate(result.html) || clean(entry?.date)
  };
}

function noteCachePage(cache, entry, pageUrl, status, nowIso) {
  const key = cacheKey(entry);
  if (!key || !tapologyEventUrl(pageUrl)) return;
  cache.entries ||= {};
  cache.entries[key] = {
    ...(cache.entries[key] || {}),
    strategyVersion: 8,
    checkedAt: nowIso,
    entryClass: 'event',
    tapologyPageUrl: pageUrl,
    tapologyStatus: status
  };
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

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
let overrideData = { entries: [] };
try { overrideData = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8')); } catch {}
const overrides = Array.isArray(overrideData?.entries) ? overrideData.entries : [];

let cache = { version: 4, updatedAt: '', entries: {} };
try { cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8')); } catch {}
if (!cache || typeof cache !== 'object') cache = { version: 4, updatedAt: '', entries: {} };
if (!cache.entries || typeof cache.entries !== 'object' || Array.isArray(cache.entries)) cache.entries = {};

const events = (history.entries || []).filter(entry => isEvent(entry) || Boolean(exactOverride(entry, overrides)));
const nowIso = new Date().toISOString();

let cacheRestored = 0;
for (const entry of events) {
  const record = cache.entries[cacheKey(entry)];
  if (!hasTrustedBinding(entry) && restoreCachedTapology(entry, record)) cacheRestored += 1;
  if (!entry.tapologyUrl && tapologyEventUrl(record?.tapologyPageUrl)) entry.tapologyUrl = record.tapologyPageUrl;
}

const targets = events
  .filter(entry => !hasTrustedBinding(entry))
  .sort((a, b) => {
    const current = Number(distance(a) > 2) - Number(distance(b) > 2);
    if (current) return current;

    const knownA = Number(!(tapologyEventUrl(a?.tapologyUrl) || tapologyEventUrl(cache.entries[cacheKey(a)]?.tapologyPageUrl) || exactOverride(a, overrides)));
    const knownB = Number(!(tapologyEventUrl(b?.tapologyUrl) || tapologyEventUrl(cache.entries[cacheKey(b)]?.tapologyPageUrl) || exactOverride(b, overrides)));
    if (knownA !== knownB) return knownA - knownB;

    const tapologyImageA = Number(!tapologyPosterUrl(a?.imageUrl));
    const tapologyImageB = Number(!tapologyPosterUrl(b?.imageUrl));
    if (tapologyImageA !== tapologyImageB) return tapologyImageA - tapologyImageB;

    const missingA = Number(http(a?.imageUrl));
    const missingB = Number(http(b?.imageUrl));
    if (missingA !== missingB) return missingA - missingB;

    return Number(b?.weight || 0) - Number(a?.weight || 0);
  })
  .slice(0, LIMIT);

let resolved = 0;
let directSearch = 0;
let bingFallback = 0;
let pageOnly = 0;
let unresolved = 0;

for (const entry of targets) {
  let page = null;
  const knownUrls = [
    exactOverride(entry, overrides)?.sourceUrl,
    entry?.tapologyUrl,
    cache.entries[cacheKey(entry)]?.tapologyPageUrl,
    entry?.imageTapologyPageUrl,
    entry?.imageSourceUrl,
    entry?.sourceUrl
  ].filter(tapologyEventUrl);

  for (const known of [...new Set(knownUrls.map(clean))]) {
    page = await verifiedPage(known, entry, overrides);
    if (page) {
      page.discovery = exactOverride(entry, overrides)?.sourceUrl === known ? 'manual-exact-event-page' : 'stored-exact-event-page';
      break;
    }
  }

  if (!page) {
    page = await discoverFromTapologySearch(entry, overrides);
    if (page) directSearch += 1;
  }
  if (!page) {
    page = await discoverFromBing(entry, overrides);
    if (page) bingFallback += 1;
  }

  if (page) {
    entry.tapologyUrl = page.pageUrl;
    const posters = posterUrlsFromTapologyHtml(page.html, page.pageUrl, entry, overrides);
    const poster = posters[0] || null;
    if (poster) {
      const result = { ...page, poster };
      applyTapologyPoster(entry, result, nowIso, overrides);
      upsertCachePoster(cache, entry, result, nowIso, overrides);
      resolved += 1;
    } else {
      noteCachePage(cache, entry, page.pageUrl, 'exact-page-no-poster', nowIso);
      pageOnly += 1;
    }
  } else {
    unresolved += 1;
  }

  await sleep(120);
}

cache.version = Math.max(Number(cache.version || 1), 5);
cache.updatedAt = nowIso;
history.tapologyPosterResolverVersion = 4;
history.tapologyPosterResolverUpdatedAt = nowIso;
history.tapologyPosterBindingPolicy = 'exact-event-page-title-and-date-verified';
history.tapologyPosterDiscoveryPolicy = 'Tapology event-category search first; verified exact event page required; Bing only as a page-discovery fallback; poster bytes must come from that verified Tapology page.';
history.tapologyPosterCacheRestored = cacheRestored;

await Promise.all([
  fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8'),
  fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8')
]);

console.log(`Tapology poster pass v4: ${cacheRestored} restored from exact cache; ${targets.length} reviewed; ${resolved} newly exact-bound posters (${directSearch} Tapology-search discoveries, ${bingFallback} Bing-discovered verified pages), ${pageOnly} exact pages with no poster, ${unresolved} unresolved.`);
