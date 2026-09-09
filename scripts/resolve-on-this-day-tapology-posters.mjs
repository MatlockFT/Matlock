import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OVERRIDES_PATH = process.argv[3] || 'assets/data/on-this-day-image-source-overrides.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const LIMIT = Math.max(1, Number(process.env.OTD_TAPOLOGY_POSTER_LIMIT || 220));
const REQUEST_TIMEOUT_MS = 20000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 MMA-Matlock-OTD-TapologyPosters/2.0';
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
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function decodeUrlish(value) {
  let output = decodeEntities(String(value || '').replace(/\\u0026/gi, '&').replace(/\\u003d/gi, '=').replace(/\\u002f/gi, '/').replace(/\\\//g, '/'));
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
  return overrides.find(item => clean(item?.date) === clean(entry?.date) && norm(item?.title) === norm(entry?.title) && tapologyEventUrl(item?.sourceUrl));
}

function eventName(entry, overrides = []) {
  const override = exactOverride(entry, overrides);
  return clean(override?.eventTitle || String(entry?.title || '').replace(/\s+took place$/i, ''));
}

function eventMatch(value, entry, overrides = []) {
  const haystack = norm(value);
  const title = norm(eventName(entry, overrides));
  if (!haystack || !title) return false;
  if (haystack.includes(title) || title.includes(haystack)) return true;
  const numbered = title.match(/\b(ufc|wec|bellator|pride|pancrase|rizin|pfl|one)\s*(?:fight\s*night\s*)?(\d{1,4})\b/);
  return Boolean(numbered && haystack.includes(numbered[1]) && new RegExp(`\\b${numbered[2]}\\b`).test(haystack));
}

async function fetchText(url, accept = 'text/html,application/xhtml+xml') {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept, 'accept-language': 'en-US,en;q=0.9' }
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

function posterUrlsFromTapologyHtml(html, pageUrl) {
  const found = new Map();
  const add = raw => {
    const url = absoluteUrl(raw, pageUrl);
    if (!tapologyPosterUrl(url)) return;
    let score = 100;
    if (/\/original\//i.test(url)) score += 80;
    if (/\/profile\//i.test(url)) score += 60;
    if (/\/medium\//i.test(url)) score += 35;
    found.set(url, Math.max(found.get(url) || 0, score));
  };
  const decoded = decodeUrlish(html);
  for (const match of decoded.matchAll(/https?:\/\/images\.tapology\.com\/poster_images\/[^"'<>\s)&]+/gi)) add(match[0]);
  for (const tag of html.match(/<(?:img|a|meta|source)\b[^>]*>/gi) || []) {
    for (const name of ['src','href','content','data-src','data-original','data-lazy-src']) add(attr(tag, name));
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    for (const part of String(srcset || '').split(',')) add(part.trim().split(/\s+/)[0] || '');
  }
  return [...found.entries()].map(([url, score]) => ({ url, score })).sort((a, b) => b.score - a.score);
}

async function bingWebSearch(query) {
  const url = new URL('https://www.bing.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', '20');
  return (await fetchText(url)).html;
}

async function bingImageSearch(query) {
  const url = new URL('https://www.bing.com/images/search');
  url.searchParams.set('q', query);
  url.searchParams.set('form', 'HDRSC3');
  url.searchParams.set('first', '1');
  return (await fetchText(url)).html;
}

function tapologyEventUrlsFromSearch(html) {
  const output = [];
  const decoded = decodeUrlish(html);
  for (const match of decoded.matchAll(/https?:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\/[^"'<>\s)&]+/gi)) {
    const url = match[0].replace(/[.,;]+$/, '');
    if (tapologyEventUrl(url)) output.push(url);
  }
  return [...new Set(output)];
}

function bingImageRecords(html) {
  const records = [];
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    const raw = attr(tag, 'm');
    if (!raw || !raw.includes('murl')) continue;
    try {
      const data = JSON.parse(decodeEntities(raw));
      const imageUrl = decodeUrlish(data?.murl || '');
      const pageUrl = decodeUrlish(data?.purl || data?.surl || '');
      if (tapologyPosterUrl(imageUrl) && tapologyEventUrl(pageUrl)) records.push({ imageUrl, pageUrl, title: clean(data?.t || data?.desc || '') });
    } catch {}
  }
  return records;
}

async function discoverExactTapologyPage(entry, overrides) {
  const known = [exactOverride(entry, overrides)?.sourceUrl, entry?.tapologyUrl, entry?.imageTapologyPageUrl, entry?.imageSourceUrl, entry?.sourceUrl].filter(tapologyEventUrl);
  if (known.length) return [...new Set(known.map(clean))][0];

  const title = eventName(entry, overrides).replace(/["<>]/g, ' ');
  const year = String(entry?.date || '').slice(0, 4);
  for (const query of [`site:tapology.com/fightcenter/events "${title}"`, `site:tapology.com/fightcenter/events "${title}" ${year}`]) {
    try {
      const html = await bingWebSearch(query);
      for (const pageUrl of tapologyEventUrlsFromSearch(html)) {
        const slug = decodeUrlish(new URL(pageUrl).pathname.split('/').pop() || '');
        if (eventMatch(slug, entry, overrides)) return pageUrl;
      }
    } catch {}
  }
  return '';
}

async function posterFromExactPage(entry, pageUrl, overrides) {
  if (!tapologyEventUrl(pageUrl)) return null;
  try {
    const { html, finalUrl } = await fetchText(pageUrl);
    const override = exactOverride(entry, overrides);
    if (!override && !eventMatch(htmlTitle(html), entry, overrides)) return null;
    const imageUrl = posterUrlsFromTapologyHtml(html, finalUrl)[0]?.url || '';
    return tapologyPosterUrl(imageUrl) ? { imageUrl, pageUrl: finalUrl, binding: 'direct-event-page' } : null;
  } catch { return null; }
}

async function posterFromBoundImageIndex(entry, pageUrl, overrides) {
  if (!tapologyEventUrl(pageUrl)) return null;
  const title = eventName(entry, overrides).replace(/["<>]/g, ' ');
  const queries = [`"${pageUrl}" "${title}"`, `site:tapology.com/fightcenter/events "${title}" poster`];
  for (const query of queries) {
    try {
      const html = await bingImageSearch(query);
      const records = bingImageRecords(html)
        .filter(record => sameExactEventPage(record.pageUrl, pageUrl))
        .filter(record => !record.title || eventMatch(record.title, entry, overrides) || eventMatch(record.pageUrl, entry, overrides));
      if (records.length) return { imageUrl: records[0].imageUrl, pageUrl, binding: 'bing-image-exact-event-page' };
    } catch {}
    await sleep(100);
  }
  return null;
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

function hasTrustedBinding(entry) {
  return tapologyPosterUrl(entry?.imageUrl) && ['direct-event-page','bing-image-exact-event-page','legacy-filename-exact','manual-exact-event-page'].includes(clean(entry?.imageTapologyBinding)) && tapologyEventUrl(entry?.imageTapologyPageUrl);
}

function applyTapologyPoster(entry, result, nowIso, overrides) {
  entry.tapologyUrl = result.pageUrl;
  entry.source = 'Tapology';
  entry.sourceUrl = result.pageUrl;
  entry.imageUrl = result.imageUrl;
  entry.imageAlt = `${eventName(entry, overrides)} event poster`;
  entry.imageCredit = 'Tapology';
  entry.imageSourceUrl = result.pageUrl;
  entry.imageSourceType = 'tapology-event-poster';
  entry.imageConfidence = result.binding === 'direct-event-page' ? 1 : 0.99;
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = true;
  entry.imageTapologyBinding = result.binding;
  entry.imageTapologyPageUrl = result.pageUrl;
  entry.imageMatchReason = result.binding === 'direct-event-page'
    ? 'The exact Tapology event page directly supplied this poster image.'
    : 'Bing image metadata bound this Tapology poster image to the exact Tapology event page; no unbound image-search result was accepted.';
  entry.imageResolvedAt = nowIso;
  entry.imageStatus = 'resolved';
  entry.imageExactMatch = true;
  delete entry.imageUnresolved;
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
let overrideData = { entries: [] };
try { overrideData = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8')); } catch {}
const overrides = Array.isArray(overrideData?.entries) ? overrideData.entries : [];
const events = (history.entries || []).filter(entry => isEvent(entry) || Boolean(exactOverride(entry, overrides)));
const nowIso = new Date().toISOString();

const targets = events
  .filter(entry => !hasTrustedBinding(entry))
  .sort((a, b) => {
    const current = Number(distance(a) > 2) - Number(distance(b) > 2);
    if (current) return current;
    const knownA = Number(!exactOverride(a, overrides));
    const knownB = Number(!exactOverride(b, overrides));
    if (knownA !== knownB) return knownA - knownB;
    const missing = Number(http(a?.imageUrl)) - Number(http(b?.imageUrl));
    if (missing) return missing;
    return Number(b?.weight || 0) - Number(a?.weight || 0);
  })
  .slice(0, LIMIT);

let resolved = 0;
let direct = 0;
let boundIndex = 0;
let pageOnly = 0;

for (const entry of targets) {
  const pageUrl = await discoverExactTapologyPage(entry, overrides);
  if (pageUrl) entry.tapologyUrl = pageUrl;
  let result = await posterFromExactPage(entry, pageUrl, overrides);
  if (result) direct += 1;
  if (!result) {
    result = await posterFromBoundImageIndex(entry, pageUrl, overrides);
    if (result) boundIndex += 1;
  }
  if (result) {
    applyTapologyPoster(entry, result, nowIso, overrides);
    resolved += 1;
  } else if (pageUrl) {
    pageOnly += 1;
  }
  await sleep(120);
}

history.tapologyPosterResolverVersion = 3;
history.tapologyPosterResolverUpdatedAt = nowIso;
history.tapologyPosterBindingPolicy = 'exact-event-page-only';
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
console.log(`Tapology poster pass v3: ${targets.length} reviewed; ${resolved} exact-bound posters (${direct} direct-page, ${boundIndex} exact-page-index), ${pageOnly} exact pages awaiting poster bytes.`);
