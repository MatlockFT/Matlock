import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const CLI_ARGS = process.argv.slice(2);
const POSITIONAL_ARGS = CLI_ARGS.filter(value => !value.startsWith('--'));
const HISTORY_PATH = POSITIONAL_ARGS[0] || 'assets/data/on-this-day.json';
const OVERRIDES_PATH = POSITIONAL_ARGS[1] || 'assets/data/on-this-day-image-source-overrides.json';
const CACHE_PATH = POSITIONAL_ARGS[2] || 'assets/data/on-this-day-image-cache.json';
const REGISTRY_PATH = process.env.OTD_POSTER_REGISTRY_PATH || 'assets/data/on-this-day-poster-registry.json';
const OUTPUT_DIR = process.env.OTD_POSTER_OUTPUT_DIR || '.otd-poster-cache';
const PUBLIC_BASE = String(process.env.OTD_POSTER_PUBLIC_BASE || 'https://raw.githubusercontent.com/MatlockFT/Matlock/otd-poster-cache').replace(/\/+$/, '');
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const LIMIT = Math.max(1, Number(process.env.OTD_TAPOLOGY_POSTER_LIMIT || 24));
const WINDOW_DAYS = Math.max(0, Number(process.env.OTD_CURRENT_WINDOW_DAYS || 2));
const REFRESH = CLI_ARGS.includes('--refresh') || process.env.OTD_POSTER_REFRESH === '1';
const APPLY_ONLY = CLI_ARGS.includes('--apply-only') || process.env.OTD_POSTER_APPLY_ONLY === '1';
const REQUEST_TIMEOUT_MS = 45000;
const USER_AGENT = 'MMA-Matlock-Verified-Poster-Registry/1.0 (+https://mmamatlock.com/on-this-day/)';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isEvent = entry => entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index' || clean(entry?.imageArtifactType) === 'event-poster' || (clean(entry?.imageSubjectType) === 'event' && tapologyEventUrl(entry?.tapologyUrl || entry?.imageSourceUrl || entry?.sourceUrl));
const eventKey = entry => `${clean(entry?.date)}::${norm(entry?.title)}`;

function tapologyEventUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' && /(^|\.)tapology\.com$/i.test(url.hostname) && /\/fightcenter\/events\//i.test(url.pathname);
  } catch { return false; }
}

function tapologyPosterUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'https:' && /(^|\.)images\.tapology\.com$/i.test(url.hostname) && /\/poster_images\//i.test(url.pathname);
  } catch { return false; }
}

function promotionKey(value) {
  const text = norm(typeof value === 'object' ? `${value?.promotion || ''} ${value?.title || ''}` : value);
  if (/\bufc\b/.test(text) || text.includes('ultimate fighting')) return 'ufc';
  if (/\bwec\b/.test(text) || text.includes('world extreme cagefighting')) return 'wec';
  if (text.includes('strikeforce')) return 'strikeforce';
  if (text.includes('bellator')) return 'bellator';
  if (text.includes('pride')) return 'pride';
  if (text.includes('pancrase')) return 'pancrase';
  if (text.includes('rizin')) return 'rizin';
  if (/\bpfl\b/.test(text) || text.includes('professional fighters league')) return 'pfl';
  if (text === 'one' || text.includes('one championship')) return 'one';
  return '';
}

function eventNumber(value) {
  return norm(value).match(/\b(?:ufc|wec|bellator|pride|pancrase|rizin|pfl|one)\s*(?:fight\s*night\s*)?(\d{1,3})\b/)?.[1] || '';
}

function titleTokens(value) {
  const stop = new Set(['the','and','with','from','into','versus','vs','fight','fighting','night','event','championship','championships','mma','fc','ufc','wec','bellator','pride','pancrase','rizin','pfl','one','strikeforce','took','place']);
  return [...new Set(norm(value).split(' ').filter(token => token.length >= 2 && !stop.has(token)))];
}

function titleScore(candidate, expected) {
  const left = norm(candidate);
  const right = norm(expected);
  if (!left || !right) return 0;
  if (left === right) return 100;

  const expectedPromo = promotionKey(expected);
  const candidatePromo = promotionKey(candidate);
  if (expectedPromo && candidatePromo && expectedPromo !== candidatePromo) return 0;

  const expectedNumber = eventNumber(expected);
  const candidateNumber = eventNumber(candidate);
  if (expectedNumber) {
    if (!candidateNumber || candidateNumber !== expectedNumber) return 0;
    return left.includes(right) || right.includes(left) ? 99 : 96;
  }

  if (left.includes(right) || right.includes(left)) return 96;
  const expectedTokens = titleTokens(expected);
  const candidateTokens = new Set(titleTokens(candidate));
  if (!expectedTokens.length) return 0;
  const matched = expectedTokens.filter(token => candidateTokens.has(token)).length;
  const ratio = matched / expectedTokens.length;
  if (expectedTokens.length >= 3 && ratio === 1) return 94;
  if (expectedTokens.length >= 3 && ratio >= 0.8) return 88;
  if (expectedTokens.length === 2 && matched === 2) return 86;
  if (expectedTokens.length === 1 && matched === 1 && (!expectedPromo || expectedPromo === candidatePromo)) return 86;
  return 0;
}

function dateMatchKind(actual, expected, score, actualTitle, expectedTitleValue) {
  if (actual === expected) return 'exact';
  const left = Date.parse(`${actual}T00:00:00Z`);
  const right = Date.parse(`${expected}T00:00:00Z`);
  const expectedNumber = eventNumber(expectedTitleValue);
  const actualNumber = eventNumber(actualTitle);
  const exactNumberedEvent = expectedNumber && actualNumber === expectedNumber && promotionKey(actualTitle) === promotionKey(expectedTitleValue);
  if (Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) === 86400000 && score >= 96 && exactNumberedEvent) return 'timezone-adjacent';
  return '';
}

function isoDate(value) {
  const text = clean(value);
  let match = /\b((?:19|20)\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})\b/.exec(text);
  if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  match = /\b(\d{1,2})[.\-/](\d{1,2})[.\-/]((?:19|20)\d{2})\b/.exec(text);
  if (match) return `${match[3]}-${String(match[1]).padStart(2, '0')}-${String(match[2]).padStart(2, '0')}`;
  const months = { jan:'01',january:'01',feb:'02',february:'02',mar:'03',march:'03',apr:'04',april:'04',may:'05',jun:'06',june:'06',jul:'07',july:'07',aug:'08',august:'08',sep:'09',sept:'09',september:'09',oct:'10',october:'10',nov:'11',november:'11',dec:'12',december:'12' };
  match = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/i.exec(text);
  return match ? `${match[3]}-${months[match[1].toLowerCase()]}-${String(match[2]).padStart(2, '0')}` : '';
}

function readerUrl(url) {
  return `https://r.jina.ai/${url}`;
}

async function fetchResponse(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          'user-agent': USER_AGENT,
          'accept-language': 'en-US,en;q=0.9',
          accept: options.binary ? 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.5' : 'text/plain,text/markdown;q=0.9,*/*;q=0.5'
        }
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(350 * attempt);
    }
  }
  throw lastError;
}

async function fetchText(url) {
  return (await fetchResponse(url)).text();
}

function exactOverride(entry, overrides) {
  return overrides.find(item => clean(item?.date) === clean(entry?.date) && norm(item?.title) === norm(entry?.title) && tapologyEventUrl(item?.sourceUrl));
}

function expectedTitle(entry, overrides) {
  return clean(exactOverride(entry, overrides)?.eventTitle || String(entry?.title || '').replace(/\s+took place$/i, ''));
}

function searchUrl(entry, overrides) {
  const url = new URL('https://www.tapology.com/search');
  url.searchParams.set('model[events]', 'eventsSearch');
  url.searchParams.set('search', 'Submit');
  url.searchParams.set('term', expectedTitle(entry, overrides));
  return url.href;
}

function searchCandidates(markdown, entry, overrides) {
  const expected = expectedTitle(entry, overrides);
  const output = [];
  const linkPattern = /\[([^\]]+)\]\((https:\/\/(?:www\.)?tapology\.com\/fightcenter\/events\/[^)]+)\)/i;
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const match = linkPattern.exec(line);
    if (!match) continue;
    const cells = line.split('|').map(clean).filter(Boolean);
    const date = cells.map(isoDate).find(Boolean) || isoDate(line);
    const linkCell = cells.findIndex(cell => cell.includes(match[2]));
    const subtitle = linkCell >= 0 ? clean(cells[linkCell + 1]) : '';
    const label = clean(`${match[1]} ${subtitle}`);
    const score = titleScore(label, expected);
    if (score < 86) continue;
    const dateMatch = dateMatchKind(date, clean(entry?.date), score, label, expected);
    if (!dateMatch) continue;
    output.push({ eventUrl: match[2], label, date, dateMatch, score });
  }
  const unique = [...new Map(output.map(item => [new URL(item.eventUrl).pathname.replace(/\/+$/, ''), item])).values()]
    .sort((a, b) => b.score - a.score);
  if (unique.length > 1 && unique[0].score - unique[1].score < 4) return [];
  return unique;
}

function tapologyPageTitle(markdown) {
  return clean(/^Title:\s*(.+?)(?:\s*\|\s*(?:MMA|Kickboxing|Boxing|Combat Sports).*?Tapology)?\s*$/mi.exec(markdown)?.[1] || '');
}

function tapologyPageDate(markdown) {
  const labelled = /(?:^|\n)[*\-\s]*Date:\s*([^\n]{0,100})/i.exec(markdown)?.[1] || '';
  return isoDate(labelled);
}

function posterCandidates(markdown) {
  const found = new Map();
  const pattern = /!\[([^\]]*)\]\((https:\/\/images\.tapology\.com\/poster_images\/[^)\s]+)\)/gmi;
  for (const match of markdown.matchAll(pattern)) {
    const url = match[2].replace(/&amp;/gi, '&');
    if (!tapologyPosterUrl(url)) continue;
    const key = new URL(url).pathname.replace(/\/(?:original|profile|medium|small)\//i, '/SIZE/');
    const rank = /\/original\//i.test(url) ? 4 : /\/profile\//i.test(url) ? 3 : /\/medium\//i.test(url) ? 2 : 1;
    const current = found.get(key);
    if (!current || rank > current.rank) found.set(key, { url, alt: clean(match[1]).replace(/^Image\s*\d*:\s*/i, ''), rank });
  }
  return [...found.values()].sort((a, b) => b.rank - a.rank);
}

function numericId(value, kind) {
  try {
    const pathname = new URL(value).pathname;
    return kind === 'event' ? /\/events\/(\d+)(?:-|\/|$)/i.exec(pathname)?.[1] || '' : /\/poster_images\/(\d+)\//i.exec(pathname)?.[1] || '';
  } catch { return ''; }
}

function posterBelongsToPage(eventUrl, posterUrl) {
  const eventId = numericId(eventUrl, 'event');
  const posterId = numericId(posterUrl, 'poster');
  return !eventId || Boolean(posterId && eventId === posterId);
}

async function exactPage(entry, overrides) {
  const known = [
    exactOverride(entry, overrides)?.sourceUrl,
    entry?.imageTapologyPageUrl,
    entry?.tapologyUrl,
    entry?.imageSourceUrl,
    entry?.sourceUrl
  ].filter(tapologyEventUrl);

  const knownUrl = [...new Set(known.map(clean))][0] || '';
  const search = await fetchText(readerUrl(searchUrl(entry, overrides)));
  const searched = searchCandidates(search, entry, overrides);
  const knownPath = knownUrl ? new URL(knownUrl).pathname.replace(/\/+$/, '') : '';
  const searchMatch = knownPath ? searched.find(item => new URL(item.eventUrl).pathname.replace(/\/+$/, '') === knownPath) : searched[0];
  const eventUrl = searchMatch?.eventUrl || '';
  if (!eventUrl) return { status: 'unresolved', reason: 'Tapology search did not return one unique title-and-date match.' };

  const markdown = await fetchText(readerUrl(eventUrl));
  const eventTitle = tapologyPageTitle(markdown);
  const eventDate = tapologyPageDate(markdown) || searchMatch.date;
  const score = titleScore(eventTitle, expectedTitle(entry, overrides));
  const dateMatch = dateMatchKind(eventDate, clean(entry?.date), score, eventTitle, expectedTitle(entry, overrides));
  if (!dateMatch || score < 86) {
    return { status: 'rejected', eventUrl, reason: `Exact-page identity failed (title score ${score}, date ${eventDate || 'missing'}).` };
  }

  const posters = posterCandidates(markdown).filter(item => posterBelongsToPage(eventUrl, item.url));
  if (posters.length > 1) return { status: 'rejected', eventUrl, eventTitle, eventDate, reason: 'The exact event page exposed multiple different poster assets.' };
  if (!posters.length) return { status: 'verified-unavailable', eventUrl, eventTitle, eventDate, dateMatch, titleScore: score, reason: 'The exact Tapology event page was verified by title and date but exposes no event poster.' };
  return { status: 'candidate', eventUrl, eventTitle, eventDate, dateMatch, titleScore: score, poster: posters[0] };
}

function extensionFor(format, contentType, url) {
  if (format === 'jpeg' || /jpe?g/i.test(contentType)) return 'jpg';
  if (format === 'png' || /png/i.test(contentType)) return 'png';
  if (format === 'webp' || /webp/i.test(contentType)) return 'webp';
  if (format === 'gif' || /gif/i.test(contentType)) return 'gif';
  const extension = path.extname(new URL(url).pathname).replace('.', '').toLowerCase();
  return ['jpg','jpeg','png','webp','gif'].includes(extension) ? extension.replace('jpeg', 'jpg') : 'jpg';
}

function slug(value) {
  return norm(value).replace(/\s+/g, '-').slice(0, 96).replace(/^-+|-+$/g, '') || 'event';
}

async function verifyPosterBytes(entry, candidate) {
  const response = await fetchResponse(candidate.poster.url, { binary: true });
  const contentType = clean(response.headers.get('content-type')).toLowerCase();
  if (!contentType.startsWith('image/')) throw new Error(`Poster response is ${contentType || 'not an image'}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 10000 || buffer.length > 12 * 1024 * 1024) throw new Error(`Poster byte length ${buffer.length} is outside the safe range.`);
  const metadata = await sharp(buffer, { animated: false }).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (width < 240 || height < 240) throw new Error(`Poster dimensions ${width}x${height} are too small.`);
  const ratio = width / height;
  if (ratio < 0.3 || ratio > 1.8) throw new Error(`Poster aspect ratio ${ratio.toFixed(2)} is implausible.`);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const extension = extensionFor(metadata.format, contentType, candidate.poster.url);
  const file = `${clean(entry.date)}-${slug(entry.title)}-${sha256.slice(0, 16)}.${extension}`;
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(path.join(OUTPUT_DIR, file), buffer);
  return { buffer, sha256, width, height, format: clean(metadata.format) || extension, bytes: buffer.length, file, publicUrl: `${PUBLIC_BASE}/${encodeURIComponent(file)}` };
}

const trustedPosterTypes = new Set(['tapology-event-poster','official-promotion-event-poster','wikipedia-event-poster','archived-promotion-event-poster','verified-manual-event-poster']);
function trustedExistingPoster(entry) {
  return /^https:\/\//i.test(clean(entry?.imageUrl)) && entry?.imagePosterVerified === true && clean(entry?.imageArtifactType) === 'event-poster' && clean(entry?.imageSubjectType) === 'event' && Number(entry?.imageConfidence || 0) >= 0.9 && trustedPosterTypes.has(clean(entry?.imageSourceType));
}

function validVerifiedRecord(record) {
  return record?.status === 'verified' && tapologyEventUrl(record?.eventUrl) && tapologyPosterUrl(record?.originPosterUrl) && /^https:\/\/raw\.githubusercontent\.com\/MatlockFT\/Matlock\/otd-poster-cache\//i.test(clean(record?.posterUrl)) && /^[a-f0-9]{64}$/.test(clean(record?.sha256)) && Number(record?.width) >= 240 && Number(record?.height) >= 240;
}

function applyVerified(entry, record) {
  entry.tapologyUrl = record.eventUrl;
  entry.imageUrl = record.posterUrl;
  entry.imageAlt = `${clean(entry.title)} event poster`;
  entry.imageCredit = 'Tapology';
  entry.imageSourceUrl = record.eventUrl;
  entry.imageSourceType = 'tapology-event-poster';
  entry.imageConfidence = 1;
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster';
  entry.imagePosterVerified = true;
  entry.imageTapologyBinding = 'direct-event-page';
  entry.imageTapologyPageUrl = record.eventUrl;
  entry.imageTapologyDiscovery = record.discovery;
  entry.imageTapologyRegistryKey = record.key;
  entry.imageTapologyVerificationVersion = 1;
  entry.imagePosterSha256 = record.sha256;
  entry.imageWidth = record.width;
  entry.imageHeight = record.height;
  entry.imageMatchReason = 'The Tapology event page matched the archive title and exact date; its event-bound poster bytes were dimension-checked, SHA-256 pinned, and mirrored to the immutable poster cache.';
  entry.imageResolvedAt = record.verifiedAt;
  entry.imageStatus = 'resolved';
  entry.imageExactMatch = true;
  delete entry.imageUnresolved;
  delete entry.imagePosterUnavailableVerified;
}

function clearUnverifiedImage(entry) {
  if (trustedExistingPoster(entry) && clean(entry?.imageSourceType) !== 'tapology-event-poster') return;
  for (const key of ['imageUrl','imageAlt','imageCredit','imageFileTitle','imageWidth','imageHeight','imagePosition','imageResolvedAt','imagePosterSha256']) delete entry[key];
  entry.imageSourceUrl = entry.tapologyUrl || '';
  entry.imageSourceType = 'verified-no-poster';
  entry.imageConfidence = 1;
  entry.imageSubjectType = 'event';
  entry.imageArtifactType = 'event-poster-unavailable';
  entry.imagePosterVerified = false;
  entry.imagePosterUnavailableVerified = true;
  entry.imageStatus = 'unresolved';
  entry.imageExactMatch = true;
  entry.imageMatchReason = 'The exact Tapology event page matched this event by title and date but did not publish a poster. No substitute image is used.';
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
  const direct = Math.abs(ordinal(String(entry?.date || '').slice(5)) - ordinal(localMMDD()));
  return Math.min(direct, 366 - direct);
}

const history = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
const overrides = JSON.parse(await fs.readFile(OVERRIDES_PATH, 'utf8').catch(() => '{"entries":[]}'))?.entries || [];
const cache = JSON.parse(await fs.readFile(CACHE_PATH, 'utf8').catch(() => '{"version":5,"entries":{}}'));
const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8').catch(() => '{"version":1,"records":{}}'));
registry.version = 1;
registry.records = registry.records && typeof registry.records === 'object' && !Array.isArray(registry.records) ? registry.records : {};
cache.entries = cache.entries && typeof cache.entries === 'object' && !Array.isArray(cache.entries) ? cache.entries : {};
for (const record of Object.values(registry.records)) {
  if (!record.dateMatch && clean(record.eventDate) === clean(record.date)) record.dateMatch = 'exact';
}

const events = (history.entries || []).filter(entry => isEvent(entry) || Boolean(exactOverride(entry, overrides)));
let restored = 0;
for (const entry of events) {
  const record = registry.records[eventKey(entry)];
  if (validVerifiedRecord(record)) {
    applyVerified(entry, record);
    restored += 1;
  } else if (record?.status === 'verified-unavailable' && record.eventUrl && record.eventDate === entry.date && titleScore(record.eventTitle, entry.title) >= 86) {
    entry.tapologyUrl = record.eventUrl;
    clearUnverifiedImage(entry);
  }
}

const targets = (APPLY_ONLY ? [] : events
  .filter(entry => {
    const record = registry.records[eventKey(entry)];
    if (REFRESH) return Boolean(record || tapologyEventUrl(entry?.tapologyUrl) || exactOverride(entry, overrides));
    if (validVerifiedRecord(record) || record?.status === 'verified-unavailable') return false;
    return !trustedExistingPoster(entry) || clean(entry?.imageSourceType) === 'tapology-event-poster';
  })
  .sort((a, b) => {
    const current = Number(distance(a) > WINDOW_DAYS) - Number(distance(b) > WINDOW_DAYS);
    if (current) return current;
    const knownA = Number(!(tapologyEventUrl(a?.tapologyUrl) || exactOverride(a, overrides)));
    const knownB = Number(!(tapologyEventUrl(b?.tapologyUrl) || exactOverride(b, overrides)));
    if (knownA !== knownB) return knownA - knownB;
    const hasImage = Number(Boolean(a?.imageUrl)) - Number(Boolean(b?.imageUrl));
    if (hasImage) return hasImage;
    return String(a.date).localeCompare(String(b.date));
  })
  .slice(0, LIMIT));

let verified = 0;
let unavailable = 0;
let rejected = 0;
let unresolved = 0;
const failures = [];

for (const entry of targets) {
  const key = eventKey(entry);
  try {
    const page = await exactPage(entry, overrides);
    if (page.status === 'candidate') {
      let image;
      try {
        image = await verifyPosterBytes(entry, page);
      } catch (error) {
        const reason = clean(error?.message);
        if (/^Poster (?:dimensions|aspect ratio|byte length)/i.test(reason)) {
          const now = new Date().toISOString();
          registry.records[key] = { key, status: 'verified-unavailable', date: entry.date, title: entry.title, eventTitle: page.eventTitle, eventDate: page.eventDate, dateMatch: page.dateMatch, eventUrl: page.eventUrl, titleScore: page.titleScore, rejectedAssetUrl: page.poster.url, transport: 'tapology-via-public-reader-v1', checkedAt: now, reason: `The exact event page was verified, but its only poster asset was unusable: ${reason}` };
          entry.tapologyUrl = page.eventUrl;
          clearUnverifiedImage(entry);
          unavailable += 1;
          continue;
        }
        throw error;
      }
      const existing = registry.records[key];
      if (existing?.status === 'verified' && existing.sha256 && existing.sha256 !== image.sha256 && !REFRESH) {
        registry.records[key] = { ...existing, lastCandidateSha256: image.sha256, lastCandidateUrl: page.poster.url, lastCheckedAt: new Date().toISOString(), candidateStatus: 'quarantined-content-change' };
        rejected += 1;
        failures.push(`${entry.date} ${entry.title}: poster bytes changed and were quarantined`);
        continue;
      }
      const now = new Date().toISOString();
      const record = {
        key,
        status: 'verified',
        date: entry.date,
        title: entry.title,
        eventTitle: page.eventTitle,
        eventDate: page.eventDate,
        dateMatch: page.dateMatch,
        eventUrl: page.eventUrl,
        originPosterUrl: page.poster.url,
        posterUrl: image.publicUrl,
        sha256: image.sha256,
        width: image.width,
        height: image.height,
        bytes: image.bytes,
        format: image.format,
        alt: page.poster.alt,
        titleScore: page.titleScore,
        eventIdBound: Boolean(numericId(page.eventUrl, 'event')),
        discovery: tapologyEventUrl(entry?.tapologyUrl) || exactOverride(entry, overrides) ? 'stored-or-curated-exact-event-page' : 'tapology-search-unique-title-date',
        transport: 'tapology-via-public-reader-v1',
        verifiedAt: now
      };
      registry.records[key] = record;
      applyVerified(entry, record);
      const cacheKey = clean(entry?.autoKey || key);
      cache.entries[cacheKey] = { ...(cache.entries[cacheKey] || {}), checkedAt: now, imageStatus: 'resolved', imageUrl: record.posterUrl, imageAlt: entry.imageAlt, imageCredit: 'Tapology', imageSourceUrl: record.eventUrl, imageSourceType: 'tapology-event-poster', imageConfidence: 1, imageSubjectType: 'event', imageMatchReason: entry.imageMatchReason, artworkType: 'poster', sourceType: 'tapology-event-poster', tapologyPageUrl: record.eventUrl, tapologyBinding: 'direct-event-page', posterSha256: record.sha256, posterRegistryKey: key };
      verified += 1;
    } else if (page.status === 'verified-unavailable') {
      const now = new Date().toISOString();
      registry.records[key] = { key, status: 'verified-unavailable', date: entry.date, title: entry.title, eventTitle: page.eventTitle, eventDate: page.eventDate, dateMatch: page.dateMatch, eventUrl: page.eventUrl, titleScore: page.titleScore, transport: 'tapology-via-public-reader-v1', checkedAt: now, reason: page.reason };
      entry.tapologyUrl = page.eventUrl;
      clearUnverifiedImage(entry);
      unavailable += 1;
    } else if (page.status === 'rejected') {
      rejected += 1;
      failures.push(`${entry.date} ${entry.title}: ${page.reason}`);
    } else {
      unresolved += 1;
      failures.push(`${entry.date} ${entry.title}: ${page.reason || 'no unique exact Tapology match'}`);
    }
  } catch (error) {
    unresolved += 1;
    failures.push(`${entry.date} ${entry.title}: ${clean(error?.message) || 'request failed'}`);
  }
  await sleep(160);
}

const nowIso = APPLY_ONLY ? clean(registry.updatedAt) || new Date().toISOString() : new Date().toISOString();
if (!APPLY_ONLY) registry.updatedAt = nowIso;
registry.policy = 'Exact Tapology title and date; unique search result; event-bound poster path; image bytes dimension-checked and SHA-256 pinned; verified bytes mirrored to otd-poster-cache; failures preserve last known-good records.';
history.tapologyPosterResolverVersion = 5;
history.tapologyPosterResolverUpdatedAt = nowIso;
history.tapologyPosterBindingPolicy = 'verified-registry-only';
history.tapologyPosterDiscoveryPolicy = registry.policy;
if (!APPLY_ONLY) cache.updatedAt = nowIso;

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
if (!APPLY_ONLY) {
  await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
  await Promise.all([
    fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8'),
    fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  ]);
}

console.log(`Tapology verified-poster registry v1: ${restored} restored; ${targets.length} reviewed; ${verified} verified and cached, ${unavailable} exact pages with no poster, ${rejected} rejected, ${unresolved} unresolved.`);
if (failures.length) {
  console.warn('Poster candidates left unchanged:');
  for (const failure of failures.slice(0, 30)) console.warn(`- ${failure}`);
}
