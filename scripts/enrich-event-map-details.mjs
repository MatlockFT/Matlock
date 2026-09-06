import fs from 'node:fs/promises';

const DATA_PATH = process.argv[2] || '_data/event_map_regional.json';
const UA = 'Mozilla/5.0 (compatible; MatlockFightTalk-EventMap/1.0; +https://matlockfighttalk.com/event-map/)';
const TODAY = new Date().toISOString().slice(0, 10);

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

function absoluteUrl(base, value) {
  try {
    const url = new URL(decodeEntities(value), base);
    if (!/^https?:$/i.test(url.protocol)) return '';
    return url.href.replace(/^http:/i, 'https:');
  } catch {
    return '';
  }
}

function attr(tag, name) {
  const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match ? decodeEntities(match[1]) : '';
}

function walkJson(value, visit) {
  if (Array.isArray(value)) return value.forEach(item => walkJson(item, visit));
  if (!value || typeof value !== 'object') return;
  visit(value);
  Object.values(value).forEach(child => walkJson(child, visit));
}

function jsonLdPoster(html, base) {
  const rx = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of String(html || '').matchAll(rx)) {
    try {
      const json = JSON.parse(decodeEntities(match[1]).trim());
      let found = '';
      walkJson(json, node => {
        if (found) return;
        const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (!types.some(type => String(type || '').toLowerCase() === 'event')) return;
        const image = Array.isArray(node.image) ? node.image[0] : node.image;
        const value = typeof image === 'string' ? image : image?.url || image?.contentUrl;
        found = absoluteUrl(base, value || '');
      });
      if (found) return found;
    } catch {
      // Ignore malformed JSON-LD.
    }
  }
  return '';
}

function eventPosterImg(html, base) {
  const tags = String(html || '').match(/<img\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const label = `${attr(tag, 'alt')} ${attr(tag, 'title')}`;
    const src = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-lazy-src');
    if (!src) continue;
    if (!/event\s*poster|fight\s*poster|poster/i.test(label) && !/poster/i.test(src)) continue;
    if (/logo|seating|stream/i.test(label)) continue;
    const url = absoluteUrl(base, src);
    if (url) return url;
  }
  return '';
}

function ogPoster(html, base) {
  const tags = String(html || '').match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const property = attr(tag, 'property') || attr(tag, 'name');
    if (!/^og:image(?::url)?$/i.test(property)) continue;
    const url = absoluteUrl(base, attr(tag, 'content'));
    if (url && !/logo|favicon/i.test(url)) return url;
  }
  return '';
}

function titleMatchup(title) {
  const text = clean(title)
    .replace(/\s+-\s+\d{1,2}\/\d{1,2}\s*$/i, '')
    .replace(/\s+\|.*$/, '');
  const afterColon = text.includes(':') ? text.split(':').slice(1).join(':').trim() : text;
  const match = afterColon.match(/^(.{2,70}?)\s+(?:vs\.?|v\.)\s+(.{2,70}?)(?:\s+[–—-]\s+.*)?$/i);
  if (!match) return null;
  return [clean(match[1]), clean(match[2])];
}

function weightFromText(value) {
  const text = clean(value);
  const match = text.match(/\b(Women'?s\s+(?:Strawweight|Flyweight|Bantamweight|Featherweight)|Light Heavyweight|Heavyweight|Middleweight|Welterweight|Lightweight|Featherweight|Bantamweight|Flyweight|Strawweight|Catchweight)\b/i);
  if (!match) return '';
  let weight = match[1].replace(/women'?s/i, "Women's");
  if (/\b(?:title|championship|champion|world title)\b/i.test(text)) weight += ' Championship';
  return weight;
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(18000),
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

const data = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
let posterCount = 0;
let matchupCount = 0;

for (const event of data.events || []) {
  if (!event?.date || event.date < TODAY) continue;

  const inferred = titleMatchup(event.title);
  const inferredWeight = weightFromText(event.title);
  if (inferred && !event.main_event) {
    event.main_event = { fighters: inferred };
    if (inferredWeight) event.main_event.weight_class = inferredWeight;
    matchupCount += 1;
  } else if (event.main_event && inferredWeight && !event.main_event.weight_class) {
    event.main_event.weight_class = inferredWeight;
  }

  const url = clean(event.official_url);
  const isNitro = event.source_key === 'nitro' || /nitrotickets\.com\/event\//i.test(url);
  if (!isNitro || !/^https:\/\//i.test(url)) continue;

  try {
    const html = await fetchHtml(url);
    const poster = eventPosterImg(html, url) || jsonLdPoster(html, url) || ogPoster(html, url);
    if (poster && poster !== event.poster_url) {
      event.poster_url = poster;
      posterCount += 1;
    }
  } catch (error) {
    console.warn(`Event detail enrichment skipped for ${event.title}: ${error.message}`);
  }
}

await fs.writeFile(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`Event Map details enriched: ${posterCount} poster update(s), ${matchupCount} title-derived main event(s).`);
