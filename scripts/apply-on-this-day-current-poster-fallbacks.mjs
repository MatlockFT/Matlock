import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const FALLBACKS_PATH = process.argv[3] || 'assets/data/on-this-day-current-poster-fallbacks.json';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 MMA-Matlock-OTD-PosterFallbacks/2.0';
const REQUEST_TIMEOUT_MS = 20000;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const http = value => /^https:\/\//i.test(clean(value));

function decodeHtml(value) {
  return clean(String(value || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'));
}

function absoluteUrl(value, base) {
  try { return new URL(decodeHtml(value), base).href; }
  catch { return ''; }
}

function usableImage(value) {
  const url = clean(value);
  if (!http(url) || /\.svg(?:\?|$)/i.test(url)) return false;
  return !/(?:favicon|sprite|placeholder|default[_-]?(?:image|avatar)|site[_-]?logo|ufc[_-]?logo|wikipedia-wordmark|wikimedia-button|download.*app|flag[_-])/i.test(url);
}

function attr(tag, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${safe}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function titleTokens(title) {
  return norm(title).split(' ').filter(token => token.length >= 3 && !['the','and','versus','event','champion','championship'].includes(token));
}

function pageImageCandidates(html, base, title) {
  const candidates = [];
  const tokens = titleTokens(title);
  const seen = new Set();
  const wikipedia = /(?:wikipedia|wikimedia)\.org/i.test(base);
  const add = (url, score, evidence, tokenMatches = 0, posterish = false) => {
    url = absoluteUrl(url, base);
    if (!usableImage(url) || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, score, evidence, tokenMatches, posterish });
  };

  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = clean(attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (!['og:image','og:image:url','twitter:image','twitter:image:src'].includes(key)) continue;
    add(attr(tag, 'content'), wikipedia ? 110 : 20, key, 0, wikipedia);
  }

  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const alt = clean(attr(tag, 'alt'));
    const titleAttr = clean(attr(tag, 'title'));
    const classId = `${attr(tag, 'class')} ${attr(tag, 'id')}`;
    const text = norm(`${alt} ${titleAttr}`);
    let url = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'data-lazy-src');
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    if (srcset) {
      const parts = srcset.split(',').map(part => part.trim()).filter(Boolean);
      if (parts.length) url = parts.at(-1).split(/\s+/)[0] || url;
    }
    const tokenMatches = tokens.filter(token => text.includes(token)).length;
    const posterish = /poster|event|fight\s*card|key\s*art/i.test(`${alt} ${titleAttr} ${classId}`);
    let score = 10 + tokenMatches * 22;
    if (posterish) score += 35;
    const width = Number(attr(tag, 'width')) || 0;
    const height = Number(attr(tag, 'height')) || 0;
    if (width >= 500 || height >= 500) score += 10;
    add(url, score, `${alt} ${titleAttr}`.trim(), tokenMatches, posterish);
  }

  return candidates.sort((a, b) => b.score - a.score);
}

async function resolveImage(rule) {
  if (usableImage(rule?.imageUrl)) return { imageUrl: clean(rule.imageUrl), sourceUrl: clean(rule.sourceUrl) };
  const sourceUrl = clean(rule?.sourceUrl);
  if (!http(sourceUrl)) throw new Error('missing HTTPS source URL');
  const response = await fetch(sourceUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9'
    }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const finalUrl = response.url || sourceUrl;
  const html = await response.text();
  const candidates = pageImageCandidates(html, finalUrl, rule?.evidenceTitle || rule?.title);
  if (!candidates.length) throw new Error('source page did not expose a usable event image');

  const wikipedia = /(?:wikipedia|wikimedia)\.org/i.test(finalUrl);
  const tokens = titleTokens(rule?.evidenceTitle || rule?.title);
  const candidate = wikipedia
    ? candidates[0]
    : candidates.find(item => item.posterish && item.tokenMatches >= Math.min(2, tokens.length)) || candidates.find(item => item.tokenMatches >= Math.min(3, tokens.length));
  if (!candidate) throw new Error('source page had images, but none had enough exact event-title/poster evidence');
  return { imageUrl: candidate.url, sourceUrl: finalUrl };
}

function findEntry(entries, rule) {
  return entries.find(entry => clean(entry?.date) === clean(rule?.date) && norm(entry?.title) === norm(rule?.title));
}

function validTapologyBinding(entry) {
  return clean(entry?.imageSourceType) !== 'tapology-event-poster' || ['direct-event-page','bing-image-exact-event-page','manual-exact-event-page','legacy-filename-exact'].includes(clean(entry?.imageTapologyBinding));
}

function alreadyVerified(entry) {
  return http(entry?.imageUrl) && entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster' && clean(entry?.imageSubjectType) === 'event' && Number(entry?.imageConfidence || 0) >= 0.9 && validTapologyBinding(entry);
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const config = JSON.parse(await fs.readFile(FALLBACKS_PATH, 'utf8'));
const entries = Array.isArray(history?.entries) ? history.entries : [];
const rules = Array.isArray(config?.entries) ? config.entries : [];
const nowIso = new Date().toISOString();

let applied = 0;
let retained = 0;
const failures = [];

for (const rule of rules) {
  const entry = findEntry(entries, rule);
  const label = `${clean(rule?.date)} ${clean(rule?.title)}`;
  if (!entry) {
    failures.push(`${label}: entry not found`);
    continue;
  }
  if (alreadyVerified(entry)) {
    retained += 1;
    continue;
  }
  try {
    const resolved = await resolveImage(rule);
    const confidence = Math.max(0.9, Math.min(1, Number(rule?.confidence || 0.95)));
    entry.imageUrl = resolved.imageUrl;
    entry.imageAlt = `${clean(entry.title)} event poster`;
    entry.imageCredit = clean(rule?.credit) || 'Source';
    entry.imageSourceUrl = resolved.sourceUrl || clean(rule?.sourceUrl);
    entry.imageSourceType = clean(rule?.sourceType) || 'verified-manual-event-poster';
    entry.imageConfidence = confidence;
    entry.imageSubjectType = 'event';
    entry.imageArtifactType = 'event-poster';
    entry.imagePosterVerified = true;
    entry.imageExactMatch = true;
    entry.imageFallback = true;
    entry.imageMatchReason = clean(rule?.matchReason) || 'Verified exact event-poster fallback applied after higher-priority Tapology poster discovery failed.';
    entry.imageResolvedAt = nowIso;
    entry.imageStatus = 'resolved';
    delete entry.imageUnresolved;
    delete entry.imageTapologyBinding;
    delete entry.imageTapologyPageUrl;
    applied += 1;
  } catch (error) {
    failures.push(`${label}: ${clean(error?.message || error)}`);
  }
}

history.currentPosterFallbackVersion = Number(config?.version || 1);
history.currentPosterFallbackUpdatedAt = nowIso;
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

console.log(`Current-window verified poster fallbacks: ${applied} applied, ${retained} already verified, ${failures.length} unresolved.`);
if (failures.length) console.warn(failures.map(item => `- ${item}`).join('\n'));
