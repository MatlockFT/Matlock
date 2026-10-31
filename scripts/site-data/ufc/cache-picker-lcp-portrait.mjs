import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const ASSETS_DIR = path.join(ROOT, 'assets/data');
const MANIFEST_PATH = path.join(ROOT, '_data/picker_lcp_portrait.json');
const PREFIX = 'picker-lcp-portrait-';
const MAX_BYTES = 4 * 1024 * 1024;
const MIN_BYTES = 512;

function imageFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', ext: '.png' };
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return { mime: 'image/gif', ext: '.gif' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii'))) return { mime: 'image/avif', ext: '.avif' };
  return null;
}

function normalizeSource(value) {
  return String(value || '').replace(/^https:\/\/ufc\.com\//i, 'https://www.ufc.com/');
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; }
}

async function atomicWrite(file, bytes) {
  const temp = file + '.tmp-' + process.pid;
  await fs.writeFile(temp, bytes);
  await fs.rename(temp, file);
}

async function pruneOldAssets(keep = 7) {
  const names = (await fs.readdir(ASSETS_DIR)).filter(name => name.startsWith(PREFIX));
  const files = await Promise.all(names.map(async name => {
    const full = path.join(ASSETS_DIR, name);
    const stat = await fs.stat(full).catch(() => null);
    return stat ? { full, time: stat.mtimeMs } : null;
  }));
  const ordered = files.filter(Boolean).sort((a, b) => b.time - a.time);
  await Promise.all(ordered.slice(keep).map(file => fs.unlink(file.full).catch(() => {})));
}


async function cachePortrait(fighter, event, previous) {
  const sourceUrl = normalizeSource(fighter?.image);
  if (!fighter?.name || !/^https:\/\//i.test(sourceUrl)) return null;
  const matches = previous?.fighter_name === fighter.name && previous?.source_url === sourceUrl;
  if (matches && previous?.image_url) {
    const existingFile = path.join(ROOT, previous.image_url.replace(/^\/+/, ''));
    const stat = await fs.stat(existingFile).catch(() => null);
    if (stat && stat.size >= MIN_BYTES && stat.size <= MAX_BYTES) return previous;
  }

  try {
    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; MatlockSiteAssetCache/1.0; +https://mmamatlock.com/)',
        referer: 'https://www.ufc.com/',
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5'
      }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_BYTES) throw new Error('Portrait exceeds 4 MiB limit');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) throw new Error('Invalid downloaded portrait size');
    const format = imageFormat(bytes);
    if (!format) throw new Error('Unsupported image format');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fileName = PREFIX + sha256.slice(0, 12) + format.ext;
    const imageUrl = '/assets/data/' + fileName;
    await fs.mkdir(ASSETS_DIR, { recursive: true });
    await atomicWrite(path.join(ASSETS_DIR, fileName), bytes);
    console.log('Cached featured fighter portrait locally: ' + fighter.name + ' -> ' + imageUrl);
    return {
      fighter_name: fighter.name,
      source_url: sourceUrl,
      image_url: imageUrl,
      mime_type: format.mime,
      sha256,
      bytes: bytes.length
    };
  } catch (error) {
    console.warn('Portrait cache unavailable for ' + fighter.name + ': ' + String(error?.message || error));
    return null;
  }
}

async function main() {
  const eventsData = await readJson(path.join(ROOT, '_data/upcoming_events.json'));
  const regionalData = await readJson(path.join(ROOT, '_data/upcoming_events_regional.json'));
  const overrides = await readJson(path.join(ROOT, '_data/fighter_portrait_overrides.json')) || {};
  const events = [
    ...(Array.isArray(eventsData?.events) ? eventsData.events : []),
    ...(Array.isArray(regionalData?.events) ? regionalData.events : [])
  ].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
  const event = events[0];
  const section = event?.sections?.find(item => item?.kind === 'main' && Array.isArray(item?.bouts) && item.bouts.length);
  const fighters = section?.bouts?.[0]?.fighters?.slice(0, 2) || [];
  if (!event?.id || !event?.date || !fighters.length) {
    console.warn('Fight Card Picker LCP portrait cache skipped: no main event portrait configured.');
    return;
  }

  const existing = await readJson(MANIFEST_PATH);
  const previousPortraits = existing?.event_id === event.id
    ? (Array.isArray(existing.portraits) && existing.portraits.length ? existing.portraits : [existing])
    : [];
  const portraits = [];
  for (const fighter of fighters) {
    if (overrides[fighter?.name]?.mode === 'fallback') continue;
    const previous = previousPortraits.find(item => item?.fighter_name === fighter?.name);
    const portrait = await cachePortrait(fighter, event, previous);
    if (portrait) portraits.push(portrait);
  }
  if (!portraits.length) {
    console.warn('No featured fighter portrait could be cached. Existing cache is unchanged.');
    return;
  }

  // Preserve the previous top-level fields for old templates and QA tools.
  const first = portraits[0];
  const manifest = {
    event_id: event.id, event_date: event.date, event_title: event.title || '',
    ...first, portraits
  };
  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await atomicWrite(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  await pruneOldAssets();
  console.log('Featured matchup portrait cache: ' + portraits.length + '/' + fighters.length + ' locally available.');
}

await main();
