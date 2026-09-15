import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('assets/data/matchmaker');
const cacheDir = process.env.MATCHMAKER_CACHE || path.resolve('.cache/matchmaker');
const checkedAt = new Date().toISOString();

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function attr(tag, name) {
  return decodeHtml(
    tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]+)"`, 'i'))?.[1]
    || tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']+)'`, 'i'))?.[1]
    || ''
  );
}

function firstSrcsetUrl(value = '') {
  return decodeHtml(value).split(',').map(item => item.trim().split(/\s+/)[0]).find(Boolean) || '';
}

function normalizePortraitUrl(value = '') {
  let raw = decodeHtml(value).trim();
  if (!raw) return null;
  if (raw.includes(',')) raw = firstSrcsetUrl(raw);
  raw = raw.split(/\s+/)[0];
  if (raw.startsWith('//')) raw = `https:${raw}`;
  else if (raw.startsWith('/')) raw = `https://www.ufc.com${raw}`;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    const trustedHost = /(^|\.)ufc\.com$/i.test(url.hostname) || url.hostname === 'dmxg5wxfqgb4u.cloudfront.net';
    const athletePortrait = /athlete_bio_full_body/i.test(url.pathname);
    if (!trustedHost && !athletePortrait) return null;
    if (/silhouette|placeholder|default[-_ ]?(?:fighter|athlete)|no[-_ ]?image/i.test(url.href)) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function extractOfficialPortrait(html = '') {
  const imageTags = [...String(html).matchAll(/<img\b[^>]*>/gi)].map(match => match[0]);
  const heroTags = imageTags.filter(tag => /hero-profile__image/i.test(attr(tag, 'class')));

  for (const tag of heroTags) {
    for (const name of ['src', 'data-src', 'data-lazy-src', 'srcset', 'data-srcset']) {
      const candidate = normalizePortraitUrl(attr(tag, name));
      if (candidate) return candidate;
    }
  }

  const fullBody = String(html).match(/(?:https?:)?\/\/[^"'\s<]+athlete_bio_full_body[^"'\s<]+|\/images\/styles\/athlete_bio_full_body\/[^"'\s<]+/i)?.[0];
  const fullBodyUrl = normalizePortraitUrl(fullBody || '');
  if (fullBodyUrl) return fullBodyUrl;

  for (const meta of String(html).match(/<meta\b[^>]*>/gi) || []) {
    const property = attr(meta, 'property') || attr(meta, 'name');
    if (!/^(?:og:image|twitter:image)$/i.test(property)) continue;
    const candidate = normalizePortraitUrl(attr(meta, 'content'));
    if (candidate && /athlete_bio_full_body/i.test(candidate)) return candidate;
  }

  return null;
}

async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return fallback; }
}

async function getProfileHtml(url) {
  await fs.mkdir(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, `${Buffer.from(url).toString('base64url')}.json`);
  const cached = await readJson(cacheFile, null);
  if (cached?.body) return cached.body;

  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MMAMatlockMatchmaker/1.0; +https://matlockfighttalk.com/)' },
        signal: AbortSignal.timeout(25000)
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      const body = await response.text();
      await fs.writeFile(cacheFile, JSON.stringify({ at: Date.now(), body }));
      return body;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  }));
  return results;
}

function selfTest() {
  const hero = '<img class="hero-profile__image" src="https://ufc.com/images/styles/athlete_bio_full_body/s3/2026-09/NAIMOV_MUHAMMAD_L.png?itok=test">';
  assert.equal(extractOfficialPortrait(hero), 'https://ufc.com/images/styles/athlete_bio_full_body/s3/2026-09/NAIMOV_MUHAMMAD_L.png?itok=test');

  const reordered = '<img data-src="https://dmxg5wxfqgb4u.cloudfront.net/styles/athlete_bio_full_body/s3/2026-09/TEST.png?itok=x" alt="Test" class="foo hero-profile__image bar">';
  assert.equal(extractOfficialPortrait(reordered), 'https://dmxg5wxfqgb4u.cloudfront.net/styles/athlete_bio_full_body/s3/2026-09/TEST.png?itok=x');

  const srcset = '<img class="hero-profile__image" srcset="/images/styles/athlete_bio_full_body/s3/2026-09/TEST2.png?itok=y 1x, /images/styles/athlete_bio_full_body/s3/2026-09/TEST2_2X.png?itok=z 2x">';
  assert.equal(extractOfficialPortrait(srcset), 'https://www.ufc.com/images/styles/athlete_bio_full_body/s3/2026-09/TEST2.png?itok=y');

  assert.equal(extractOfficialPortrait('<img class="hero-profile__image" src="/images/silhouette.png">'), null);
  assert.equal(extractOfficialPortrait('<meta property="og:image" content="https://www.ufc.com/logo.png">'), null);
  console.log('Official UFC portrait extractor: OK');
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const currentFile = path.join(root, 'current.json');
const data = await readJson(currentFile, null);
if (!data || !Array.isArray(data.fighters) || !Array.isArray(data.events)) throw new Error('Missing Matchmaker current.json');

const participantIds = new Set(data.events.flatMap(event => event.bouts.flatMap(bout => bout.fighters.map(fighter => fighter.id))));
const targets = data.fighters.filter(fighter => fighter.active || participantIds.has(fighter.id));
const portraitById = new Map();
const failures = [];

await mapLimit(targets, 8, async fighter => {
  const source = /^https:\/\/(?:www\.)?ufc\.com\/athlete\//i.test(fighter.source || '')
    ? fighter.source
    : `https://www.ufc.com/athlete/${fighter.id}`;
  try {
    const portrait = extractOfficialPortrait(await getProfileHtml(source));
    if (!portrait) {
      failures.push({ id: fighter.id, name: fighter.name, reason: 'No usable UFC athlete portrait found', source });
      return;
    }
    fighter.image = portrait;
    fighter.imageSource = 'UFC.com athlete profile';
    fighter.imagePage = source;
    fighter.imageCheckedAt = checkedAt;
    portraitById.set(fighter.id, portrait);
  } catch (error) {
    failures.push({ id: fighter.id, name: fighter.name, reason: error.message, source });
  }
});

for (const event of data.events) {
  for (const bout of event.bouts) {
    for (const entry of bout.fighters) {
      const portrait = portraitById.get(entry.id);
      if (portrait) entry.image = portrait;
    }
  }
}

const participantFighters = [...participantIds].map(id => data.fighters.find(fighter => fighter.id === id)).filter(Boolean);
const activeFighters = data.fighters.filter(fighter => fighter.active);
const official = fighter => fighter.imageSource === 'UFC.com athlete profile' && Boolean(fighter.image);
const participantMissing = participantFighters.filter(fighter => !official(fighter));
const activeOfficial = activeFighters.filter(official).length;
const activeRatio = activeFighters.length ? activeOfficial / activeFighters.length : 0;

if (participantMissing.length) {
  throw new Error(`Official UFC portrait coverage missing for displayed fighters: ${participantMissing.map(fighter => fighter.name).join(', ')}`);
}
if (activeFighters.length && activeRatio < 0.9) {
  throw new Error(`Official UFC portrait extraction coverage implausibly low: ${activeOfficial}/${activeFighters.length}`);
}

data.sources ||= {};
data.sources.portraits = {
  source: 'UFC.com',
  urlPattern: 'https://www.ufc.com/athlete/{slug}',
  checkedAt,
  note: 'Official UFC athlete-profile full-body portraits are preferred for Matchmaker fighters.'
};
data.coverage ||= {};
data.coverage.officialUfcPortraits = portraitById.size;
data.coverage.officialUfcActivePortraits = activeOfficial;
data.coverage.officialUfcActivePortraitRatio = Number(activeRatio.toFixed(4));
data.coverage.officialUfcParticipantPortraits = participantFighters.length - participantMissing.length;
data.coverage.officialUfcParticipantPortraitTotal = participantFighters.length;
data.coverage.officialUfcPortraitFailures = failures;

await fs.writeFile(`${currentFile}.tmp`, JSON.stringify(data, null, 2) + '\n');
await fs.rename(`${currentFile}.tmp`, currentFile);
console.log(`Official UFC portraits: ${portraitById.size}/${targets.length} targets; active ${activeOfficial}/${activeFighters.length}; displayed ${participantFighters.length}/${participantFighters.length}.`);
if (failures.length) console.warn(`UFC portrait fallbacks retained for ${failures.length} fighters: ${failures.map(item => item.name).join(', ')}`);
