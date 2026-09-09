import fs from 'node:fs/promises';

const DATA_PATH = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : '_data/event_map_regional.json';
const UA = 'Mozilla/5.0 (compatible; MMAMatlock-EventMap/1.0; +https://mmamatlock.com/event-map/)';
const BAD_POSTER_RE = /(?:tribe-loading|loading(?:[-_.]|$)|spinner|preloader|placeholder|blank(?:[-_.]|$)|transparent(?:[-_.]|$)|favicon|(?:^|[/_.-])logo(?:[/_.-]|$)|\.gif(?:[?#]|$))/i;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function attr(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function absoluteUrl(base, raw) {
  try {
    const url = new URL(decodeEntities(raw), base);
    return /^https?:$/i.test(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function isBadPoster(value) {
  const text = clean(value);
  if (!text || BAD_POSTER_RE.test(text)) return true;
  try {
    const url = new URL(text);
    return !/^https?:$/i.test(url.protocol);
  } catch {
    return true;
  }
}

function imageValues(value) {
  if (!value) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(imageValues);
  if (typeof value === 'object') return [value.url, value.contentUrl, value['@id']].filter(Boolean);
  return [];
}

function jsonLdPosterCandidates(html, base) {
  const candidates = [];
  for (const match of String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const root = JSON.parse(decodeEntities(match[1]).trim());
      const queue = Array.isArray(root) ? [...root] : [root];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== 'object') continue;
        const types = (Array.isArray(node['@type']) ? node['@type'] : [node['@type']])
          .map(type => clean(type).toLowerCase());
        if (types.includes('event')) {
          for (const raw of imageValues(node.image)) {
            const url = absoluteUrl(base, raw);
            if (url && !isBadPoster(url)) candidates.push(url);
          }
        }
        if (Array.isArray(node['@graph'])) queue.push(...node['@graph']);
      }
    } catch {
      // Ignore malformed third-party JSON-LD.
    }
  }
  return candidates;
}

function imgPosterCandidates(html, base) {
  const candidates = [];
  for (const tag of String(html || '').match(/<img\b[^>]*>/gi) || []) {
    const label = `${attr(tag, 'alt')} ${attr(tag, 'title')} ${attr(tag, 'class')}`;
    const sources = [
      ['data-src', 320],
      ['data-lazy-src', 315],
      ['data-original', 310],
      ['data-srcset', 300],
      ['srcset', 290],
      ['src', 220]
    ];

    for (const [name, baseScore] of sources) {
      const rawValue = attr(tag, name);
      if (!rawValue) continue;
      const raw = /srcset/i.test(name)
        ? rawValue.split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean).pop()
        : rawValue;
      const url = absoluteUrl(base, raw);
      if (!url || isBadPoster(url)) continue;
      const haystack = `${label} ${url}`;
      if (!/poster|fight|event|bout|card/i.test(haystack)) continue;
      if (/seating|avatar|sponsor|advert|icon/i.test(haystack)) continue;
      const relevance = /poster/i.test(haystack) ? 50 : /fight|bout|card/i.test(haystack) ? 30 : 10;
      candidates.push({ url, score: baseScore + relevance });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).map(candidate => candidate.url);
}

function metaPosterCandidates(html, base) {
  const candidates = [];
  for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
    const key = attr(tag, 'property') || attr(tag, 'name');
    if (!/^(?:og:image(?::url)?|twitter:image(?::src)?)$/i.test(key)) continue;
    const url = absoluteUrl(base, attr(tag, 'content'));
    if (url && !isBadPoster(url)) candidates.push(url);
  }
  return candidates;
}

function bestPosterFromHtml(html, base) {
  return [
    ...jsonLdPosterCandidates(html, base),
    ...imgPosterCandidates(html, base),
    ...metaPosterCandidates(html, base)
  ][0] || '';
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20000),
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function sanitize() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  const events = Array.isArray(data.events) ? data.events : [];
  let repaired = 0;
  let removed = 0;

  for (const event of events) {
    const current = clean(event.poster_url);
    if (!current || !isBadPoster(current)) continue;

    let replacement = '';
    const officialUrl = clean(event.official_url || event.url || event.source_url);
    if (officialUrl) {
      try {
        const html = await fetchHtml(officialUrl);
        replacement = bestPosterFromHtml(html, officialUrl);
      } catch (error) {
        console.warn(`Poster refresh failed for ${event.id || event.title}: ${error.message}`);
      }
    }

    if (replacement) {
      event.poster_url = replacement;
      repaired += 1;
      console.log(`Repaired poster: ${event.id || event.title} -> ${replacement}`);
    } else {
      delete event.poster_url;
      removed += 1;
      console.log(`Removed unusable poster: ${event.id || event.title}`);
    }
  }

  const next = `${JSON.stringify(data, null, 2)}\n`;
  if (next !== raw) await fs.writeFile(DATA_PATH, next);
  console.log(`Event Map poster sanitation complete: ${repaired} repaired, ${removed} removed.`);
}

function selfTest() {
  const lazyHtml = '<img class="tribe-events-calendar-list__event-featured-image" src="/wp-content/plugins/the-events-calendar/src/resources/images/tribe-loading.gif" data-src="/uploads/lfa-242-poster.jpg" alt="LFA 242 Event Poster">';
  const lazy = bestPosterFromHtml(lazyHtml, 'https://www.lfa.test/event/lfa-242/');
  if (lazy !== 'https://www.lfa.test/uploads/lfa-242-poster.jpg') throw new Error(`Lazy-image priority failed: ${lazy}`);

  const ldHtml = '<script type="application/ld+json">{"@type":"Event","image":"/uploads/official-event.webp"}</script><img data-src="/uploads/secondary-poster.jpg" alt="Fight poster">';
  const ld = bestPosterFromHtml(ldHtml, 'https://example.test/event/1');
  if (ld !== 'https://example.test/uploads/official-event.webp') throw new Error(`JSON-LD priority failed: ${ld}`);

  if (!isBadPoster('https://example.test/tribe-loading.gif')) throw new Error('Loading GIF was not rejected.');
  if (isBadPoster('https://example.test/uploads/event-poster.webp')) throw new Error('Usable poster was rejected.');
  console.log('Event Map poster sanitizer self-test passed.');
}

if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  await sanitize();
}
