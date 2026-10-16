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

async function main() {
  try {
    const eventsData = await readJson(path.join(ROOT, '_data/upcoming_events.json'));
    const regionalData = await readJson(path.join(ROOT, '_data/upcoming_events_regional.json'));
    const overrides = await readJson(path.join(ROOT, '_data/fighter_portrait_overrides.json')) || {};
    const events = [
      ...(Array.isArray(eventsData?.events) ? eventsData.events : []),
      ...(Array.isArray(regionalData?.events) ? regionalData.events : [])
    ].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
    const event = events[0];
    const section = event?.sections?.find(item => item?.kind === 'main' && Array.isArray(item?.bouts) && item.bouts.length);
    const fighter = section?.bouts?.[0]?.fighters?.[0];
    const sourceUrl = normalizeSource(fighter?.image);
    if (!event?.id || !event?.date || !fighter?.name || !/^https:\/\//i.test(sourceUrl) || overrides[fighter.name]?.mode === 'fallback') {
      console.warn('Fight Card Picker LCP portrait cache skipped: no usable first-bout portrait is configured.');
      return;
    }

    const existing = await readJson(MANIFEST_PATH);
    if (existing?.event_id === event.id && existing?.fighter_name === fighter.name &&
        existing?.source_url === sourceUrl && typeof existing.image_url === 'string') {
      const existingFile = path.join(ROOT, existing.image_url.replace(/^\/+/, ''));
      const stat = await fs.stat(existingFile).catch(() => null);
      if (stat && stat.size >= MIN_BYTES) {
        console.log('Fight Card Picker LCP portrait already cached locally for ' + fighter.name + '.');
        return;
      }
    }

    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; MatlockSiteAssetCache/1.0; +https://mmamatlock.com/)',
        'referer': 'https://www.ufc.com/',
        'accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5'
      }
    });
    if (!response.ok) throw new Error('UFC image server returned HTTP ' + response.status);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_BYTES) throw new Error('Portrait exceeds the 4 MiB cache limit');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) throw new Error('Downloaded portrait has an invalid size');
    const format = imageFormat(bytes);
    if (!format) throw new Error('Downloaded portrait is not a supported raster image');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fileName = PREFIX + sha256.slice(0, 12) + format.ext;
    const imageUrl = '/assets/data/' + fileName;
    await fs.mkdir(ASSETS_DIR, { recursive: true });
    await atomicWrite(path.join(ASSETS_DIR, fileName), bytes);
    const manifest = {
      event_id: event.id,
      event_date: event.date,
      event_title: event.title || '',
      fighter_name: fighter.name,
      source_url: sourceUrl,
      image_url: imageUrl,
      mime_type: format.mime,
      sha256,
      bytes: bytes.length
    };
    await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
    await atomicWrite(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    await pruneOldAssets();
    console.log('Cached Fight Card Picker LCP portrait locally: ' + event.date + ' ' + fighter.name + ' -> ' + imageUrl + ' (' + bytes.length + ' bytes).');
  } catch (error) {
    console.warn('Fight Card Picker local portrait cache skipped; remote image remains the fallback. ' + String(error?.message || error));
  }
}

await main();
