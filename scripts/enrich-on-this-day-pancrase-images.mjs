import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const LIMIT = Math.max(1, Number(process.env.OTD_PANCRASE_IMAGE_LIMIT || 80));
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const REQUEST_TIMEOUT_MS = 18000;
const USER_AGENT = 'MMA-Matlock-OnThisDay-PancrasePosters/2.0 (+https://mmamatlock.com/on-this-day/)';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function attr(tag, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${safe}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return clean(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function absoluteUrl(value, base) {
  try { return new URL(value, base).href; }
  catch { return ''; }
}

function usableImage(url) {
  if (!/^https:\/\//i.test(clean(url))) return false;
  if (/\.svg(?:\?|$)/i.test(url)) return false;
  return !/(?:logo|banner|bnr|button|spacer|arrow|icon|favicon|header|footer|menu|nav)[_./-]/i.test(url);
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'ja,en-US;q=0.8,en;q=0.7'
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return { html: await response.text(), finalUrl: response.url || url };
}

function pancraseEntry(entry) {
  if (!(entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index')) return false;
  return /pancrase/i.test(`${entry?.promotion || ''} ${entry?.title || ''}`);
}

function eventNumber(entry) {
  return norm(entry?.title).match(/\bpancrase\s*(\d{2,4})\b/)?.[1] || '';
}

function officialResultUrl(entry) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(entry?.date));
  if (!match) return '';
  return `https://www.pancrase.co.jp/data/result/${match[1]}/${match[2]}${match[3]}.html`;
}

function scorePoster(tag, url, entry) {
  const alt = clean(attr(tag, 'alt'));
  const title = clean(attr(tag, 'title'));
  const raw = `${alt} ${title} ${url}`.toLowerCase();
  const number = eventNumber(entry);
  let score = 0;

  if (/\/(?:main|p\d+(?:ma|tn))\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url)) score += 150;
  if (/pancrase/i.test(raw)) score += 70;
  if (number && new RegExp(`(?:^|[^0-9])${number}(?:[^0-9]|$)`).test(raw)) score += 90;
  if (/poster|key.?art|event|大会|ポスター/i.test(raw)) score += 50;
  if (/\/data\/result\/|\/tour\//i.test(url)) score += 20;
  const width = Number(attr(tag, 'width')) || 0;
  const height = Number(attr(tag, 'height')) || 0;
  if (width >= 300 || height >= 300) score += 10;
  if (/fighter|headshot|profile|face/i.test(raw)) score -= 100;
  if (/logo|banner|bnr|button|spacer|arrow|icon|header|footer|menu|nav/i.test(raw)) score -= 250;
  return { score, alt };
}

function exactPoster(html, pageUrl, entry) {
  const ranked = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-original');
    const url = absoluteUrl(src, pageUrl);
    if (!usableImage(url)) continue;
    const { score, alt } = scorePoster(tag, url, entry);
    ranked.push({ url, alt, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 120 ? ranked[0] : null;
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
const entries = Array.isArray(history?.entries) ? history.entries : [];
const nowIso = new Date().toISOString();

const targets = entries
  .filter(pancraseEntry)
  .filter(entry => !(entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster' && /^https:\/\//i.test(clean(entry?.imageUrl))))
  .sort((a, b) => distance(a) - distance(b) || Number(b?.weight || 0) - Number(a?.weight || 0))
  .slice(0, LIMIT);

let resolved = 0;
let missed = 0;
let failed = 0;

for (const entry of targets) {
  const sourceUrl = officialResultUrl(entry);
  if (!sourceUrl) { missed += 1; continue; }
  try {
    const { html, finalUrl } = await fetchHtml(sourceUrl);
    const poster = exactPoster(html, finalUrl, entry);
    if (!poster) {
      missed += 1;
      await sleep(120);
      continue;
    }

    entry.imageUrl = poster.url;
    entry.imageAlt = poster.alt || `${clean(entry.title)} event poster`;
    entry.imageCredit = 'Pancrase';
    entry.imageSourceUrl = finalUrl;
    entry.imageSourceType = 'official-promotion-event-poster';
    entry.imageConfidence = 0.99;
    entry.imageSubjectType = 'event';
    entry.imageArtifactType = 'event-poster';
    entry.imagePosterVerified = true;
    entry.imageMatchReason = 'Exact official Pancrase event page supplied the event poster/key art.';
    entry.imageResolvedAt = nowIso;
    entry.imageStatus = 'resolved';
    entry.imageExactMatch = true;
    delete entry.imageUnresolved;
    resolved += 1;
  } catch (error) {
    failed += 1;
    console.warn(`${entry.date} ${entry.title}: ${clean(error?.message || error)}`);
  }
  await sleep(120);
}

history.pancraseImageResolverVersion = 2;
history.pancraseImageResolverUpdatedAt = nowIso;
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
console.log(`Pancrase poster enrichment: ${targets.length} reviewed; ${resolved} verified event posters, ${missed} without poster art, ${failed} failed. Fighter-photo fallbacks are disabled for event entries.`);
