import fs from 'node:fs/promises';

const HISTORY_PATH = process.argv[2] || 'assets/data/on-this-day.json';
const CACHE_PATH = process.argv[3] || 'assets/data/on-this-day-image-cache.json';
const PORTRAITS_PATH = process.argv[4] || 'assets/fighter-portraits.json';
const USER_AGENT = 'MMA-Matlock-OnThisDay-Resolver/3.0 (+https://mmamatlock.com/on-this-day/)';
const TIME_ZONE = process.env.OTD_TIME_ZONE || 'America/Chicago';
const RESOLVE_LIMIT = Math.max(1, Number(process.env.OTD_IMAGE_RESOLVE_LIMIT || 120));
const REQUEST_TIMEOUT_MS = 18000;
const STRATEGY_VERSION = 8;

const clean = value => String(value || '').replace(/\s+/g, ' ').trim();
const norm = value => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const slug = value => norm(value).replace(/\s+/g, '-') || 'entry';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function readJson(path, fallback) {
  try { return JSON.parse(await fs.readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

async function fetchText(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml' }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function decodeHtml(value) {
  return clean(String(value || '')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>'));
}

function htmlMeta(html, property) {
  const safe = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${safe}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${safe}["'][^>]*>`, 'i')
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return '';
}

function sourceKind(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (host.endsWith('wikipedia.org') || host === 'wikimedia.org' || host.endsWith('wikimedia.org')) return 'wikipedia';
    if (host === 'web.archive.org') return 'archived-source-page';
    if (/^(ufc\.com|bellator\.com|pflmma\.com|onefc\.com|rizinff\.com|pancrase\.co\.jp|wec\.tv|strikeforce\.com)$/.test(host)) return 'official-promotion-page';
    return 'source-page';
  } catch { return 'source-page'; }
}

function sourceCredit(url, fallback = '') {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const labels = {
      'ufc.com': 'UFC', 'bellator.com': 'Bellator', 'pflmma.com': 'PFL', 'onefc.com': 'ONE Championship',
      'rizinff.com': 'RIZIN', 'pancrase.co.jp': 'Pancrase', 'en.wikipedia.org': 'Wikipedia'
    };
    return labels[host] || clean(fallback) || host;
  } catch { return clean(fallback) || 'Source'; }
}

function entryClass(entry) {
  if (entry?.kind === 'birthday') return 'birthday';
  if (entry?.kind === 'event' || entry?.generatedBy === 'wikipedia-event-index') return 'event';
  if (['fight', 'debut', 'title', 'signing', 'death'].includes(entry?.kind)) return 'fighter-history';
  return 'other-moment';
}

function subjectType(entry) {
  const type = entryClass(entry);
  if (type === 'event') return 'event';
  if (type === 'birthday' || type === 'fighter-history') return 'fighter';
  return 'moment';
}

function entryKey(entry) {
  return clean(entry?.autoKey || entry?.birthdayKey || `${entry?.date || 'unknown'}:${entry?.kind || 'note'}:${slug(entry?.title)}`);
}

function fighterName(entry) {
  return clean(entry?.fighter || String(entry?.title || '').replace(/\s+was born$/i, ''));
}

function usableImageUrl(url) {
  if (!/^https:\/\//i.test(clean(url))) return false;
  return !/(?:logo|favicon|sprite|placeholder|default)[._\-/]/i.test(url);
}

function candidateFromPage(pageUrl, html, entry, reason = '') {
  const imageUrl = htmlMeta(html, 'og:image') || htmlMeta(html, 'twitter:image');
  if (!usableImageUrl(imageUrl)) return null;
  const type = sourceKind(pageUrl);
  const base = type === 'official-promotion-page' ? 0.96 : type === 'archived-source-page' ? 0.88 : 0.78;
  return {
    imageUrl,
    imageCredit: sourceCredit(pageUrl, entry?.source),
    imageSourceUrl: pageUrl,
    imageSourceType: type,
    imageConfidence: base,
    imageSubjectType: subjectType(entry),
    imageMatchReason: reason || 'The entry source page supplied its primary image.'
  };
}

async function wikipediaLead(title) {
  if (!title) return null;
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('prop', 'pageimages|info');
  url.searchParams.set('piprop', 'thumbnail|original|name');
  url.searchParams.set('pithumbsize', '1400');
  url.searchParams.set('inprop', 'url');
  url.searchParams.set('titles', title);
  const data = await fetchJson(url);
  const page = data?.query?.pages?.[0];
  const imageUrl = page?.thumbnail?.source || page?.original?.source || '';
  if (!usableImageUrl(imageUrl)) return null;
  return { imageUrl, pageTitle: clean(page?.title || title), pageUrl: clean(page?.fullurl || '') };
}

function wikipediaTitleFromUrl(value) {
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith('wikipedia.org') || !url.pathname.startsWith('/wiki/')) return '';
    return decodeURIComponent(url.pathname.slice(6)).replace(/_/g, ' ');
  } catch { return ''; }
}

async function wikipediaSearchTitle(query) {
  const url = new URL('https://en.wikipedia.org/w/api.php');
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srlimit', '5');
  url.searchParams.set('srsearch', query);
  const data = await fetchJson(url);
  return (data?.query?.search || []).map(item => clean(item?.title)).filter(Boolean);
}

async function resolveWikipedia(entry) {
  const cls = entryClass(entry);
  let title = wikipediaTitleFromUrl(entry?.sourceUrl || '') || clean(entry?.wikipediaTitle || '');
  if (!title) {
    const query = cls === 'birthday' ? fighterName(entry) : clean(entry?.title);
    const results = await wikipediaSearchTitle(query);
    title = results[0] || '';
  }
  const lead = await wikipediaLead(title);
  if (!lead) return null;
  const confidence = cls === 'birthday' ? 0.9 : 0.74;
  return {
    imageUrl: lead.imageUrl,
    imageCredit: 'Wikipedia / Wikimedia Commons',
    imageSourceUrl: lead.pageUrl || entry?.sourceUrl || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
    imageSourceType: 'wikipedia',
    imageConfidence: confidence,
    imageSubjectType: subjectType(entry),
    imageMatchReason: cls === 'birthday' ? 'Exact fighter Wikipedia page supplied the fighter image.' : 'Wikipedia supplied the closest directly related image.'
  };
}

async function resolveDirectSource(entry) {
  const url = clean(entry?.sourceUrl);
  if (!/^https:\/\//i.test(url) || sourceKind(url) === 'wikipedia') return null;
  try {
    const html = await fetchText(url);
    return candidateFromPage(url, html, entry);
  } catch { return null; }
}

function existingCandidate(entry) {
  if (!usableImageUrl(entry?.imageUrl)) return null;
  const inferredType = clean(entry?.imageSourceType) || (String(entry?.imageCredit || '').toLowerCase().includes('wikipedia') ? 'wikipedia' : 'existing-image');
  const cls = entryClass(entry);
  const confidence = Number(entry?.imageConfidence || 0.7);
  return {
    imageUrl: entry.imageUrl,
    imageCredit: clean(entry.imageCredit || entry.source || 'Source'),
    imageSourceUrl: clean(entry.imageSourceUrl || entry.sourceUrl || entry.imageUrl || ''),
    imageSourceType: inferredType,
    imageConfidence: Math.max(0.4, Math.min(0.99, confidence)),
    imageSubjectType: clean(entry.imageSubjectType || subjectType(entry)),
    imageMatchReason: clean(entry.imageMatchReason || 'Previously resolved image retained as the best available match.'),
    entryClass: cls
  };
}

function portraitCandidate(entry, portraits) {
  const name = fighterName(entry);
  const portrait = portraits?.[norm(name)];
  if (!portrait || !usableImageUrl(portrait.url)) return null;
  const source = clean(portrait.source).toLowerCase();
  const official = ['ufc','pfl','rizin','one','bellator','pancrase'].includes(source);
  return {
    imageUrl: portrait.url,
    imageCredit: source.toUpperCase() || 'Promotion',
    imageSourceUrl: clean(portrait.sourceUrl || portrait.url),
    imageSourceType: official ? 'official-athlete-image' : 'promotion-or-media-headshot',
    imageConfidence: official ? 0.97 : 0.82,
    imageSubjectType: 'fighter',
    imageMatchReason: official ? 'Exact fighter matched the official athlete portrait registry.' : 'Exact fighter matched the site portrait registry.'
  };
}

async function resolveEntry(entry, portraits) {
  const cls = entryClass(entry);
  const existing = existingCandidate(entry);

  // Event art is intentionally excluded from this resolver. The dedicated event-poster
  // pipeline applies stricter event/page/filename verification and owns those records.
  if (cls === 'event') return existing;

  if (cls === 'birthday') {
    const portrait = portraitCandidate(entry, portraits);
    if (portrait?.imageSourceType === 'official-athlete-image') return portrait;
    const wiki = await resolveWikipedia(entry).catch(() => null);
    return wiki || portrait || existing;
  }

  const direct = await resolveDirectSource(entry);
  if (direct) return direct;
  const wiki = await resolveWikipedia(entry).catch(() => null);
  return wiki || existing;
}

function applyCandidate(entry, candidate, nowIso) {
  if (!candidate) {
    entry.imageStatus = 'unresolved';
    entry.imageUnresolved = true;
    entry.imageSubjectType = subjectType(entry);
    entry.imageMatchReason = clean(entry.imageMatchReason || 'No sufficiently relevant image has been resolved yet; keep retrying enrichment.');
    return;
  }
  entry.imageUrl = candidate.imageUrl;
  entry.imageAlt ||= entryClass(entry) === 'birthday' ? `${fighterName(entry)} photo` : `${clean(entry.title)} image`;
  entry.imageCredit = candidate.imageCredit;
  entry.imageSourceUrl = candidate.imageSourceUrl;
  entry.imageSourceType = candidate.imageSourceType;
  entry.imageConfidence = Number(candidate.imageConfidence.toFixed(2));
  entry.imageSubjectType = candidate.imageSubjectType;
  entry.imageMatchReason = candidate.imageMatchReason;
  entry.imageResolvedAt = nowIso;
  entry.imageStatus = 'resolved';
  delete entry.imageUnresolved;
}

function dayOrdinal(mmdd) {
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

function cyclicDistance(entry) {
  const a = dayOrdinal(String(entry?.date || '').slice(5));
  const b = dayOrdinal(localMMDD());
  const direct = Math.abs(a - b);
  return Math.min(direct, 366 - direct);
}

const history = await readJson(HISTORY_PATH, { entries: [] });
const cache = await readJson(CACHE_PATH, { version: 1, entries: {} });
const portraits = await readJson(PORTRAITS_PATH, {});
if (!cache.entries || typeof cache.entries !== 'object' || Array.isArray(cache.entries)) cache.entries = {};
const entries = Array.isArray(history?.entries) ? history.entries : [];
const nowIso = new Date().toISOString();

for (const entry of entries) {
  if (entryClass(entry) === 'event') continue;
  const existing = existingCandidate(entry);
  if (existing) applyCandidate(entry, existing, nowIso);
  else {
    entry.imageSubjectType ||= subjectType(entry);
    entry.imageStatus ||= 'unresolved';
    entry.imageUnresolved = true;
  }
}

const eligible = entries
  .filter(entry => {
    const cls = entryClass(entry);
    if (cls === 'event') return false;
    const missing = !usableImageUrl(entry?.imageUrl);
    const weak = Number(entry?.imageConfidence || 0) < (cls === 'birthday' ? 0.88 : 0.72);
    return missing || weak || entry?.imageUnresolved;
  })
  .sort((a, b) => {
    const current = Number(cyclicDistance(a) > 2) - Number(cyclicDistance(b) > 2);
    if (current) return current;
    const birthdays = Number(entryClass(a) !== 'birthday') - Number(entryClass(b) !== 'birthday');
    if (birthdays) return birthdays;
    const missing = Number(Boolean(a.imageUrl)) - Number(Boolean(b.imageUrl));
    if (missing) return missing;
    return Number(b.weight || 0) - Number(a.weight || 0);
  })
  .slice(0, RESOLVE_LIMIT);

let resolved = 0;
let unresolved = 0;
for (const entry of eligible) {
  const candidate = await resolveEntry(entry, portraits).catch(() => existingCandidate(entry));
  applyCandidate(entry, candidate, nowIso);
  const key = entryKey(entry);
  cache.entries[key] = {
    strategyVersion: STRATEGY_VERSION,
    checkedAt: nowIso,
    entryClass: entryClass(entry),
    imageStatus: entry.imageStatus,
    imageUrl: entry.imageUrl || '',
    imageCredit: entry.imageCredit || '',
    imageSourceUrl: entry.imageSourceUrl || '',
    imageSourceType: entry.imageSourceType || '',
    imageConfidence: Number(entry.imageConfidence || 0),
    imageSubjectType: entry.imageSubjectType || subjectType(entry),
    imageMatchReason: entry.imageMatchReason || ''
  };
  if (entry.imageUrl) resolved += 1;
  else unresolved += 1;
  await sleep(120);
}

cache.version = Math.max(4, Number(cache.version || 1));
cache.strategyVersion = STRATEGY_VERSION;
cache.updatedAt = nowIso;
history.imageResolverVersion = STRATEGY_VERSION;
history.imageResolverUpdatedAt = nowIso;
history.imageResolverPolicy = 'non-event-only; event images are exclusively handled by the dedicated verified poster pipeline';

await fs.writeFile(HISTORY_PATH, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
await fs.writeFile(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');

const withImages = entries.filter(entry => usableImageUrl(entry.imageUrl)).length;
console.log(`On This Day non-event image resolver v${STRATEGY_VERSION}: ${eligible.length} reviewed; ${resolved} resolved/retained, ${unresolved} unresolved. Event rows skipped by design.`);
console.log(`Overall OTD image coverage: ${withImages}/${entries.length}. Dedicated event-poster and birthday QA runs separately as publish gates.`);
