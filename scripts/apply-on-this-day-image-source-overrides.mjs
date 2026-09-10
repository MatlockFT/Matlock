import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const OVERRIDES_PATH = process.argv[3] || 'assets/data/on-this-day-image-source-overrides.json';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 MMA-Matlock-OTD/1.3';
const REQUEST_TIMEOUT_MS = 20000;
const REQUEST_ATTEMPTS = 3;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const trustedEventPosterTypes = new Set([
  'tapology-event-poster',
  'official-promotion-event-poster',
  'wikipedia-event-poster',
  'archived-promotion-event-poster',
  'verified-manual-event-poster'
]);
const trustedTapologyBindings = new Set([
  'direct-event-page',
  'bing-image-exact-event-page',
  'manual-exact-event-page',
  'legacy-filename-exact'
]);

function isEvent(entry) {
  return entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index';
}

function trustedEventPosterSource(entry) {
  const type = clean(entry?.imageSourceType);
  if (!trustedEventPosterTypes.has(type)) return false;
  if (type === 'tapology-event-poster') {
    return trustedTapologyBindings.has(clean(entry?.imageTapologyBinding)) && /^https:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\//i.test(clean(entry?.imageTapologyPageUrl));
  }
  if (type === 'verified-manual-event-poster') return entry?.imageManualVisualVerified === true;
  return true;
}

function applyPosterVerification(entry) {
  if (!isEvent(entry)) return;
  const canVerify = clean(entry?.imageSubjectType) === 'event' &&
    trustedEventPosterSource(entry) &&
    /^https:\/\//i.test(clean(entry?.imageUrl)) &&
    Number(entry?.imageConfidence || 0) >= 0.9;

  if (canVerify) {
    entry.imageArtifactType = 'event-poster';
    entry.imagePosterVerified = true;
    return;
  }

  // Source-page images, Wikipedia lead images, official event photos and
  // fighter/editorial fallbacks may still be useful archive imagery, but they
  // are never allowed to self-certify as the actual event poster.
  entry.imagePosterVerified = false;
  if (/^https:\/\//i.test(clean(entry?.imageUrl))) entry.imageArtifactType = 'event-fallback';
}

function decodeHtml(value) {
  return clean(String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/'));
}

function absoluteUrl(value, base) {
  try { return new URL(decodeHtml(value), base).href; }
  catch { return ''; }
}

function usableImage(value) {
  const url = clean(value);
  if (!/^https:\/\//i.test(url)) return false;
  if (/\.svg(?:\?|$)/i.test(url)) return false;
  return !/(?:favicon|sprite|placeholder|default[_-]?(?:image|avatar)|site[_-]?logo|tapology[_-]?logo|ufc[_-]?logo)/i.test(url);
}

async function fetchHtml(url) {
  let lastError;
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          'cache-control': 'no-cache'
        }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return { html: await response.text(), finalUrl: response.url || url };
    } catch (error) {
      lastError = error;
      if (attempt < REQUEST_ATTEMPTS) await sleep(900 * attempt);
    }
  }
  throw lastError || new Error(`Unable to fetch ${url}`);
}

function attr(tag, name) {
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${safe}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function metaImage(html, base) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = clean(attr(tag, 'property') || attr(tag, 'name')).toLowerCase();
    if (!['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key)) continue;
    const url = absoluteUrl(attr(tag, 'content'), base);
    if (usableImage(url)) return url;
  }
  return '';
}

function imageCandidates(html, base, needles = []) {
  const ranked = [];
  const normalizedNeedles = needles.map(norm).filter(Boolean);
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const alt = norm(attr(tag, 'alt'));
    const title = norm(attr(tag, 'title'));
    const text = `${alt} ${title}`.trim();
    let url = attr(tag, 'src') || attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'data-lazy-src');
    const srcset = attr(tag, 'srcset') || attr(tag, 'data-srcset');
    if (srcset) {
      const parts = srcset.split(',').map(part => part.trim()).filter(Boolean);
      if (parts.length) url = parts.at(-1).split(/\s+/)[0] || url;
    }
    url = absoluteUrl(url, base);
    if (!usableImage(url)) continue;

    let score = 0;
    if (normalizedNeedles.some(needle => text.includes(needle) || needle.includes(text))) score += 100;
    for (const needle of normalizedNeedles) {
      const tokens = needle.split(' ').filter(token => token.length >= 3);
      score += tokens.filter(token => text.includes(token)).length * 10;
    }
    if (/poster|event|fighter|athlete|hero|profile/i.test(`${attr(tag, 'class')} ${attr(tag, 'id')}`)) score += 15;
    const width = Number(attr(tag, 'width')) || 0;
    const height = Number(attr(tag, 'height')) || 0;
    if (width >= 400 || height >= 400) score += 5;
    ranked.push({ url, score });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

function findEntry(entries, override) {
  if (clean(override?.birthdayKey)) return entries.find(entry => clean(entry?.birthdayKey) === clean(override.birthdayKey));
  return entries.find(entry => clean(entry?.date) === clean(override?.date) && norm(entry?.title) === norm(override?.title));
}

function entryNeedles(entry, override) {
  const needles = [entry?.fighter, entry?.title, override?.title, override?.eventTitle].map(clean).filter(Boolean);
  if (entry?.kind === 'birthday') needles.push(String(entry.title || '').replace(/\s+was born$/i, ''));
  if (entry?.kind === 'event') needles.push(String(entry.title || '').replace(/^Pancrase:\s*/i, 'Pancrase '));
  return [...new Set(needles)];
}

async function resolveFromSource(imageUrl, sourceUrl, entry, override) {
  let resolvedImage = clean(imageUrl);
  let finalSourceUrl = clean(sourceUrl);
  if (usableImage(resolvedImage)) return { imageUrl: resolvedImage, sourceUrl: finalSourceUrl };
  if (!/^https:\/\//i.test(finalSourceUrl)) throw new Error('missing HTTPS source URL');
  const { html, finalUrl } = await fetchHtml(finalSourceUrl);
  finalSourceUrl = finalUrl || finalSourceUrl;
  resolvedImage = metaImage(html, finalSourceUrl);
  if (!usableImage(resolvedImage)) {
    resolvedImage = imageCandidates(html, finalSourceUrl, entryNeedles(entry, override))[0]?.url || '';
  }
  if (!usableImage(resolvedImage)) throw new Error('source page did not expose a usable primary image');
  return { imageUrl: resolvedImage, sourceUrl: finalSourceUrl };
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const overridesData = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8'));
const entries = Array.isArray(history?.entries) ? history.entries : [];
const overrides = Array.isArray(overridesData?.entries) ? overridesData.entries : [];
const nowIso = new Date().toISOString();

let applied = 0;
let retained = 0;
let fallbackApplied = 0;
let posterMetadataRepaired = 0;
const failures = [];

for (const override of overrides) {
  const entry = findEntry(entries, override);
  const label = clean(override?.birthdayKey || `${override?.date} ${override?.title}`);
  if (!entry) {
    failures.push(`${label}: entry not found`);
    continue;
  }

  const primaryConfidence = Math.max(0, Math.min(1, Number(override?.confidence || 0.95)));
  const existingConfidence = Number(entry?.imageConfidence || 0);
  if (/^https:\/\//i.test(clean(entry?.imageUrl)) && existingConfidence >= primaryConfidence && entry?.imageExactMatch === true) {
    const before = entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster';
    applyPosterVerification(entry);
    const after = entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster';
    if (!before && after) posterMetadataRepaired += 1;
    retained += 1;
    continue;
  }

  let result;
  let usedFallback = false;
  let primaryError = '';
  try {
    result = await resolveFromSource(override?.imageUrl, override?.sourceUrl, entry, override);
  } catch (error) {
    primaryError = clean(error?.message || error);
    if (clean(override?.fallbackImageUrl) || clean(override?.fallbackSourceUrl)) {
      try {
        result = await resolveFromSource(override?.fallbackImageUrl, override?.fallbackSourceUrl, entry, override);
        usedFallback = true;
      } catch (fallbackError) {
        failures.push(`${label}: primary ${primaryError}; fallback ${clean(fallbackError?.message || fallbackError)}`);
      }
    } else {
      failures.push(`${label}: ${primaryError}`);
    }
  }

  if (result?.imageUrl) {
    const confidence = usedFallback
      ? Math.max(0, Math.min(1, Number(override?.fallbackConfidence || 0.8)))
      : primaryConfidence;
    entry.imageUrl = result.imageUrl;
    entry.imageAlt = clean((usedFallback ? override?.fallbackImageAlt : override?.imageAlt)) || (entry?.kind === 'event'
      ? `${clean(entry.title)} event image`
      : entry?.kind === 'birthday'
        ? `${clean(entry.fighter || String(entry.title).replace(/\s+was born$/i, ''))} photo`
        : `${clean(entry.title)} image`);
    entry.imageCredit = clean(usedFallback ? override?.fallbackCredit : override?.credit) || clean(entry?.imageCredit || entry?.source || 'Source');
    entry.imageSourceUrl = result.sourceUrl || (usedFallback ? override?.fallbackSourceUrl : override?.sourceUrl);
    entry.imageSourceType = clean(usedFallback ? override?.fallbackSourceType : override?.sourceType) || 'verified-source-page';
    entry.imageConfidence = confidence;
    entry.imageSubjectType = clean(usedFallback ? override?.fallbackSubjectType : override?.subjectType) || (entry?.kind === 'event' ? 'event' : entry?.kind === 'birthday' ? 'fighter' : 'moment');
    entry.imageMatchReason = clean(usedFallback ? override?.fallbackMatchReason : override?.matchReason) || 'Verified source override matched this exact On This Day entry.';
    entry.imageResolvedAt = nowIso;
    entry.imageStatus = 'resolved';
    entry.imageExactMatch = !usedFallback && confidence >= 0.95;
    entry.imageFallback = usedFallback;
    applyPosterVerification(entry);
    if (usedFallback) {
      entry.imagePrimarySourceUrl = clean(override?.sourceUrl);
      entry.imagePrimaryFailureReason = primaryError;
      fallbackApplied += 1;
    } else {
      delete entry.imagePrimarySourceUrl;
      delete entry.imagePrimaryFailureReason;
      delete entry.imageFallback;
    }
    delete entry.imageUnresolved;
    applied += 1;
  }
  await sleep(120);
}

history.imageSourceOverrideVersion = Number(overridesData?.version || 1);
history.imageSourceOverridesAppliedAt = nowIso;
await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');

console.log(`On This Day verified source overrides: ${applied} applied (${fallbackApplied} fallback), ${retained} already protected, ${posterMetadataRepaired} poster metadata repaired, ${failures.length} unresolved.`);
if (failures.length) console.warn(failures.map(item => `- ${item}`).join('\n'));
