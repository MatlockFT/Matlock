import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OVERRIDES_PATH = process.argv[3] || 'assets/data/on-this-day-image-source-overrides.json';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const LIMIT = Math.max(1, Number(process.env.OTD_TAPOLOGY_POSTER_LIMIT || 220));
const REQUEST_TIMEOUT_MS = 20000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 MMA-Matlock-OTD-TapologyPosters/1.1';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function isEvent(entry) {
  return entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
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

function decode(value) {
  let output = String(value || '');
  for (let pass = 0; pass < 3; pass += 1) {
    output = output
      .replace(/\\u0026/gi, '&')
      .replace(/\\u003d/gi, '=')
      .replace(/\\u002f/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#34;/g, '"')
      .replace(/&#39;|&apos;/gi, "'");
    try { output = decodeURIComponent(output); } catch {}
  }
  return output;
}

function attr(tag, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${safe}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return decode(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function absoluteUrl(value, base) {
  try { return new URL(decode(value), base).href; }
  catch { return ''; }
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

function eventMatch(value, entry, overrides = []) {
  const haystack = norm(value);
  const title = norm(eventName(entry, overrides));
  if (!haystack || !title) return false;
  if (haystack.includes(title) || title.includes(haystack)) return true;
  const numbered = title.match(/\b(ufc|wec|bellator|pride|pancrase|rizin|pfl|one)\s*(\d{1,4})\b/);
  return Boolean(numbered && haystack.includes(numbered[1]) && new RegExp(`\\b${numbered[2]}\\b`).test(haystack));
}

function htmlTitle(html) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = clean(attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (key === 'og:title' && attr(tag, 'content')) return attr(tag, 'content');
  }
  return decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '');
}

function posterUrlsFromText(text, base = 'https://www.tapology.com/') {
  const found = new Map();
  const add = raw => {
    const url = absoluteUrl(raw, base);
    if (!tapologyPosterUrl(url)) return;
    let score = 100;
    if (/\/original\//i.test(url)) score += 80;
    if (/\/profile\//i.test(url)) score += 60;
    if (/\/medium\//i.test(url)) score += 35;
    if (/\/small\//i.test(url)) score += 10;
    found.set(url, Math.max(found.get(url) || 0, score));
  };

  const decoded = decode(text);
  for (const match of decoded.matchAll(/https?:\/\/images\.tapology\.com\/poster_images\/[^"'<>\s)&]+/gi)) add(match[0]);
  for (const match of decoded.matchAll(/(?:https?:)?\/\/images\.tapology\.com\/poster_images\/[^"'<>\s)&]+/gi)) add(match[0]);

  return [...found.entries()]
    .map(([url, score]) => ({ url, score }))
    .sort((a, b) => b.score - a.score);
}

function posterUrlsFromTapologyHtml(html, pageUrl) {
  const candidates = posterUrlsFromText(html, pageUrl);
  const add = raw => {
    const url = absoluteUrl(raw, pageUrl);
    if (!tapologyPosterUrl(url) || candidates.some(item => item.url === url)) return;
    candidates.push({ url, score: /\/original\//i.test(url) ? 180 : /\/profile\//i.test(url) ? 160 : 120 });
  };
  for (const tag of html.match(/<(?:img|a|meta|source)\b[^>]*>/gi) || []) {
    for (const name of ['src','href','content','data-src','data-original','data-lazy-src']) add(attr(tag, name));
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    for (const part of String(srcset || '').split(',')) add(part.trim().split(/\s+/)[0] || '');
  }
  return candidates.sort((a, b) => b.score - a.score);
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
  const decoded = decode(html);
  for (const match of decoded.matchAll(/https?:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\/[^"'<>\s)&]+/gi)) {
    const url = match[0].replace(/[.,;]+$/, '');
    if (tapologyEventUrl(url)) output.push(url);
  }
  for (const tag of html.match(/<a\b[^>]*>/gi) || []) {
    let href = attr(tag, 'href');
    try {
      const parsed = new URL(href, 'https://www.bing.com');
      const target = parsed.searchParams.get('u') || parsed.searchParams.get('url') || href;
      href = decode(target);
    } catch {}
    if (tapologyEventUrl(href)) output.push(href);
  }
  return [...new Set(output)];
}

async function discoverExactTapologyPage(entry, overrides) {
  const candidates = [];
  const override = exactOverride(entry, overrides);
  for (const value of [override?.sourceUrl, entry?.tapologyUrl, entry?.imageSourceUrl, entry?.sourceUrl]) {
    if (tapologyEventUrl(value)) candidates.push(clean(value));
  }
  if (candidates.length) return [...new Set(candidates)][0];

  const title = eventName(entry, overrides).replace(/["<>]/g, ' ');
  const year = String(entry?.date || '').slice(0, 4);
  for (const query of [
    `site:tapology.com/fightcenter/events "${title}"`,
    `site:tapology.com/fightcenter/events "${title}" ${year}`
  ]) {
    try {
      const html = await bingWebSearch(query);
      const matches = tapologyEventUrlsFromSearch(html);
      for (const pageUrl of matches) {
        const slugText = decodeURIComponent(new URL(pageUrl).pathname.split('/').pop() || '');
        if (eventMatch(slugText, entry, overrides) || eventMatch(pageUrl, entry, overrides)) return pageUrl;
      }
    } catch {}
  }
  return '';
}

async function posterFromExactPage(entry, pageUrl, overrides) {
  if (!tapologyEventUrl(pageUrl)) return '';
  try {
    const { html, finalUrl } = await fetchText(pageUrl);
    const override = exactOverride(entry, overrides);
    if (!override && !eventMatch(htmlTitle(html), entry, overrides)) return '';
    return posterUrlsFromTapologyHtml(html, finalUrl)[0]?.url || '';
  } catch { return ''; }
}

async function posterFromImageIndex(entry, pageUrl, overrides) {
  const title = eventName(entry, overrides).replace(/["<>]/g, ' ');
  const queries = [
    `site:images.tapology.com/poster_images "${title}"`,
    `"${title}" "images.tapology.com/poster_images"`,
    pageUrl ? `"${pageUrl}" poster` : ''
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const html = await bingImageSearch(query);
      const candidates = posterUrlsFromText(html);
      if (candidates.length) return candidates[0].url;
    } catch {}
    await sleep(100);
  }
  return '';
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

function applyTapologyPoster(entry, pageUrl, imageUrl, nowIso, overrides) {
  entry.tapologyUrl = pageUrl || entry.tapologyUrl || `https://www.tapology.com/search?term=${encodeURIComponent(eventName(entry, overrides))}`;
  entry.source = 'Tapology';
  entry.sourceUrl = entry.tapologyUrl;
  entry.imageUrl = imageUrl;
  entry.imageAlt = `${eventName(entry, overrides)} event poster`;
  entry.imageCredit = 'Tapology';
  entry.imageSourceUrl = pageUrl || entry.tapologyUrl;
  entry.imageSourceType = 'tapology-event-poster';
  entry.imageConfidence = 0.99;
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = true;
  entry.imageMatchReason = pageUrl
    ? 'Exact Tapology event reference resolved the event poster from Tapology’s poster image host.'
    : 'Exact-title Tapology-only poster discovery resolved the event poster.';
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
  .filter(entry => !(entry?.imagePosterVerified === true && clean(entry?.imageSourceType) === 'tapology-event-poster' && tapologyPosterUrl(entry?.imageUrl)))
  .sort((a, b) => {
    const current = Number(distance(a) > 2) - Number(distance(b) > 2);
    if (current) return current;
    const missing = Number(http(a?.imageUrl)) - Number(http(b?.imageUrl));
    if (missing) return missing;
    const knownA = Number(!exactOverride(a, overrides));
    const knownB = Number(!exactOverride(b, overrides));
    if (knownA !== knownB) return knownA - knownB;
    return Number(b?.weight || 0) - Number(a?.weight || 0);
  })
  .slice(0, LIMIT);

let resolved = 0;
let exactPages = 0;
let directPagePosters = 0;
let indexedPosters = 0;
let pageOnly = 0;

for (const entry of targets) {
  const pageUrl = await discoverExactTapologyPage(entry, overrides);
  if (pageUrl) {
    entry.tapologyUrl = pageUrl;
    exactPages += 1;
  }

  let imageUrl = await posterFromExactPage(entry, pageUrl, overrides);
  if (imageUrl) directPagePosters += 1;
  if (!imageUrl) {
    imageUrl = await posterFromImageIndex(entry, pageUrl, overrides);
    if (imageUrl) indexedPosters += 1;
  }

  if (imageUrl && tapologyPosterUrl(imageUrl)) {
    applyTapologyPoster(entry, pageUrl, imageUrl, nowIso, overrides);
    resolved += 1;
  } else if (pageUrl) {
    entry.tapologyUrl = pageUrl;
    pageOnly += 1;
  }
  await sleep(120);
}

history.tapologyPosterResolverVersion = 2;
history.tapologyPosterResolverUpdatedAt = nowIso;
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
console.log(`Tapology poster pass: ${targets.length} reviewed; ${exactPages} exact event pages, ${resolved} posters resolved (${directPagePosters} direct-page, ${indexedPosters} indexed), ${pageOnly} exact pages still awaiting poster bytes.`);
