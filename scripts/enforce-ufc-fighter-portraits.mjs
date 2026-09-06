import fs from 'node:fs/promises';
import { DATA_PATH, norm } from './upcoming-events-data.mjs';

const CACHE_PATH = '_data/fighter_portraits.json';
const UFC = 'https://www.ufc.com';
const UA = 'Mozilla/5.0 (compatible; MMAMatlockUfcPortraits/1.0; +https://matlockfighttalk.com/)';
const TIMEOUT = 16000;
const tracking = /(?:piwik|matomo|google-analytics|googletagmanager|doubleclick|analytics|tracking|pixel|beacon|\/collect(?:[/?]|$)|\/track(?:[/?]|$))/i;
const badPortrait = /(?:\/articles?\/|\/news\/|\/galleries?\/|\/thumbnails?\/|(?:^|[\/_-])(?:banner|sponsor|poster|promo|placeholder|logo|flag)(?:[\/_-]|$))/i;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function fetchText(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: {
          'user-agent': UA,
          'accept-language': 'en-US,en;q=0.9',
          accept: 'text/html,application/xhtml+xml,*/*'
        }
      });
      if (response.ok) return response.text();
      last = new Error(`${response.status} ${url}`);
    } catch (error) {
      last = error;
    }
    if (attempt === 0) await sleep(300);
  }
  throw last;
}

async function imageWorks(url) {
  if (!/^https?:\/\//i.test(url || '') || tracking.test(url) || badPortrait.test(url)) return false;
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { 'user-agent': UA, accept: 'image/*,*/*;q=0.8' }
    });
    if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
      response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT),
        headers: { 'user-agent': UA, accept: 'image/*,*/*;q=0.8', range: 'bytes=0-2047' }
      });
    }
    if (!response.ok && response.status !== 206) return false;
    const type = (response.headers.get('content-type') || '').toLowerCase();
    return type.startsWith('image/') || /\.(?:png|jpe?g|webp)(?:\?|$)/i.test(response.url);
  } catch {
    return false;
  }
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
    .replace(/&#(\d+);/g, (_, x) => String.fromCodePoint(Number(x)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtml(value = '') {
  return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function attrs(tag) {
  const out = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/gi)) out[match[1].toLowerCase()] = decodeHtml(match[3]);
  return out;
}

function slug(name) {
  return norm(name).replace(/\s+/g, '-');
}

function nameMatch(candidate, requested) {
  const value = norm(candidate || '');
  return !!value && (value === requested || value.startsWith(`${requested} `) || requested.startsWith(`${value} `));
}

function profileMatches(html, name) {
  const requested = norm(name);
  const candidates = [
    decodeHtml((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').split('|')[0],
    decodeHtml((html.match(/<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i) || [])[1] || '').split('|')[0],
    stripHtml((html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '')
  ];
  return candidates.some(candidate => nameMatch(candidate, requested));
}

function profileLinksFromEvent(html) {
  const out = new Map();
  for (const match of html.matchAll(/<a\b[^>]*href=["']((?:https?:\/\/(?:www\.)?ufc\.com)?\/athlete\/[a-z0-9][a-z0-9-]*\/?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = stripHtml(match[2]);
    const key = norm(label);
    if (!key || key.length > 80) continue;
    try {
      const url = new URL(match[1], UFC);
      url.protocol = 'https:';
      url.hostname = 'www.ufc.com';
      url.search = '';
      url.hash = '';
      out.set(key, url.toString().replace(/\/$/, ''));
    } catch {}
  }
  return out;
}

function candidateUrls(html, name) {
  const requested = norm(name);
  const tokens = requested.split(/\s+/).filter(token => token.length > 2);
  const scored = new Map();

  const add = (raw, label = '', extra = 0) => {
    if (!raw) return;
    const decoded = decodeHtml(raw).trim();
    let url;
    try { url = new URL(decoded, UFC).toString(); } catch { return; }
    if (tracking.test(url) || badPortrait.test(url)) return;

    const haystack = norm(`${label} ${decodeURIComponent(url)}`);
    let score = extra;
    if (/athlete_bio_full_body/i.test(url)) score += 1400;
    else if (/athlete[_-]?bio/i.test(url)) score += 1000;
    else if (/fighter|athlete|profile/i.test(url)) score += 350;
    if (nameMatch(label, requested)) score += 900;
    else if (tokens.length > 1 && tokens.every(token => haystack.includes(token))) score += 450;
    if (/full[_-]?body|bodyshot|headshot|portrait/i.test(url)) score += 250;
    if (!/\.(?:png|jpe?g|webp)(?:\?|$)/i.test(url)) score -= 150;

    if (score < 700) return;
    const current = scored.get(url);
    if (!current || score > current.score) scored.set(url, { url, score });
  };

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const label = a.alt || a.title || a['aria-label'] || '';
    for (const raw of [a.src, a['data-src'], a['data-lazy-src'], a['data-original']]) add(raw, label);
    for (const srcset of [a.srcset, a['data-srcset']]) {
      for (const part of String(srcset || '').split(',')) add(part.trim().split(/\s+/)[0], label, 50);
    }
  }

  for (const match of html.matchAll(/<(?:source)\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    for (const srcset of [a.srcset, a['data-srcset']]) {
      for (const part of String(srcset || '').split(',')) add(part.trim().split(/\s+/)[0], '', 25);
    }
  }

  const decodedHtml = decodeHtml(html);
  for (const match of decodedHtml.matchAll(/https?:\/\/[^"'<>\s]+athlete_bio_full_body[^"'<>\s]+/gi)) add(match[0], '', 1600);

  return [...scored.values()].sort((a, b) => b.score - a.score).map(candidate => candidate.url);
}

async function resolveOfficialPortrait(name, profileUrl) {
  const urls = [profileUrl, `${UFC}/athlete/${slug(name)}`].filter(Boolean);
  for (const url of [...new Set(urls)]) {
    try {
      const html = await fetchText(url);
      if (!profileMatches(html, name)) continue;
      for (const image of candidateUrls(html, name)) {
        if (await imageWorks(image)) return { image, profile: url };
      }
    } catch {}
  }
  return null;
}

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
let cache = {};
try { cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8')); } catch {}
delete cache[''];

const ufcEvents = (data.events || []).filter(event => event.promotion_key === 'ufc');
const eventProfiles = new Map();
for (const event of ufcEvents) {
  let profiles = new Map();
  if (event.official_url) {
    try { profiles = profileLinksFromEvent(await fetchText(event.official_url)); }
    catch (error) { console.warn(`Could not read UFC event page ${event.official_url}: ${error.message}`); }
  }
  eventProfiles.set(event.id, profiles);
}

let changedData = false;
let changedCache = false;
let resolved = 0;
let cleared = 0;
let kept = 0;
let unresolved = 0;

for (const event of ufcEvents) {
  const profiles = eventProfiles.get(event.id) || new Map();
  for (const section of event.sections || []) {
    for (const bout of section.bouts || []) {
      for (const person of bout.fighters || []) {
        const key = norm(person.name);
        if (!key) continue;

        const currentIsOfficial = person.image && person.image_source === 'ufc';
        if (currentIsOfficial && await imageWorks(person.image)) {
          const cached = cache[key];
          if (!cached?.url || cached.url !== person.image || cached.source !== 'ufc') {
            cache[key] = { url: person.image, source: 'ufc', framing: person.image_framing || 'safe' };
            changedCache = true;
          }
          kept++;
          continue;
        }

        if (person.image || person.image_source || person.image_framing) {
          person.image = '';
          person.image_source = '';
          person.image_framing = '';
          changedData = true;
          cleared++;
        }
        if (cache[key]?.url && cache[key]?.source !== 'ufc') {
          delete cache[key];
          changedCache = true;
        }

        let profileUrl = profiles.get(key) || '';
        if (!profileUrl) {
          for (const [label, url] of profiles) {
            if (nameMatch(label, key)) { profileUrl = url; break; }
          }
        }

        const official = await resolveOfficialPortrait(person.name, profileUrl);
        if (!official) {
          const cached = cache[key];
          if (cached?.url && cached.source === 'ufc' && await imageWorks(cached.url)) {
            person.image = cached.url;
            person.image_source = 'ufc';
            person.image_framing = cached.framing || 'safe';
            changedData = true;
            kept++;
          } else {
            if (cached?.url) { delete cache[key]; changedCache = true; }
            unresolved++;
            console.warn(`UFC portrait unresolved: ${person.name}`);
          }
          continue;
        }

        person.image = official.image;
        person.image_source = 'ufc';
        person.image_framing = 'safe';
        cache[key] = { url: official.image, source: 'ufc', framing: 'safe' };
        changedData = true;
        changedCache = true;
        resolved++;
        console.log(`Resolved UFC portrait: ${person.name} <- ${official.profile}`);
      }
    }
  }
}

// Safety net: a single UFC image must never represent two different fighters on
// the same event. If UFC markup changes and our parser becomes ambiguous, blank
// the conflicting portraits instead of silently showing the wrong person.
for (const event of ufcEvents) {
  const byUrl = new Map();
  for (const section of event.sections || []) for (const bout of section.bouts || []) for (const person of bout.fighters || []) {
    if (!person.image) continue;
    if (!byUrl.has(person.image)) byUrl.set(person.image, []);
    byUrl.get(person.image).push(person);
  }
  for (const people of byUrl.values()) {
    const names = new Set(people.map(person => norm(person.name)).filter(Boolean));
    if (names.size < 2) continue;
    for (const person of people) {
      const key = norm(person.name);
      const badUrl = person.image;
      person.image = '';
      person.image_source = '';
      person.image_framing = '';
      changedData = true;
      if (cache[key]?.url === badUrl) { delete cache[key]; changedCache = true; }
      console.warn(`Cleared ambiguous UFC portrait assignment for ${person.name}.`);
    }
  }
}

if (changedCache) {
  const sorted = Object.fromEntries(Object.entries(cache).sort(([a], [b]) => a.localeCompare(b)));
  await fs.writeFile(CACHE_PATH, JSON.stringify(sorted, null, 2) + '\n');
}
if (changedData) await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2) + '\n');

console.log(`UFC portrait enforcement complete: ${resolved} resolved from UFC.com, ${kept} kept, ${cleared} external/stale assignment(s) cleared, ${unresolved} unresolved.`);
