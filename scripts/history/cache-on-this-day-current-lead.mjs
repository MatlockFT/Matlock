import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const LEADS_PATH = path.join(ROOT, 'assets/data/on-this-day-leads.json');
const MANIFEST_PATH = path.join(ROOT, '_data/on_this_day_current_lead.json');
const ASSETS_DIR = path.join(ROOT, 'assets/data');
const PREFIX = 'on-this-day-current-lead-';
const MAX_BYTES = 4 * 1024 * 1024;
const MIN_BYTES = 512;

function todayKey() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const month = parts.find(part => part.type === 'month')?.value;
  const day = parts.find(part => part.type === 'day')?.value;
  return month && day ? month + '-' + day : '';
}

function imageFormat(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mime: 'image/png', ext: '.png' };
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return { mime: 'image/gif', ext: '.gif' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp' && ['avif', 'avis'].includes(bytes.subarray(8, 12).toString('ascii'))) return { mime: 'image/avif', ext: '.avif' };
  return null;
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
    const dateKey = todayKey();
    const sourceData = await readJson(LEADS_PATH);
    const sourceUrl = sourceData?.leads?.[dateKey];
    if (!dateKey || typeof sourceUrl !== 'string' || !/^https:\/\//i.test(sourceUrl)) {
      console.warn('On This Day lead cache skipped: no verified HTTPS lead for ' + dateKey + '.');
      return;
    }

    const existing = await readJson(MANIFEST_PATH);
    if (existing?.date_key === dateKey && existing?.source_url === sourceUrl && typeof existing.image_url === 'string') {
      const existingFile = path.join(ROOT, existing.image_url.replace(/^\/+/, ''));
      const stat = await fs.stat(existingFile).catch(() => null);
      if (stat && stat.size >= MIN_BYTES) {
        console.log('On This Day current lead already cached locally for ' + dateKey + '.');
        return;
      }
    }

    const response = await fetch(sourceUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; MatlockSiteAssetCache/1.0; +https://mmamatlock.com/)',
        'accept': 'image/avif,image/webp,image/png,image/jpeg,image/gif,image/*;q=0.8,*/*;q=0.5'
      }
    });
    if (!response.ok) throw new Error('Image server returned HTTP ' + response.status);
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength > MAX_BYTES) throw new Error('Lead image exceeds the 4 MiB cache limit');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) throw new Error('Downloaded lead image has an invalid size');
    const format = imageFormat(bytes);
    if (!format) throw new Error('Downloaded lead is not a supported raster image');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const fileName = PREFIX + sha256.slice(0, 12) + format.ext;
    const imageUrl = '/assets/data/' + fileName;
    await fs.mkdir(ASSETS_DIR, { recursive: true });
    await atomicWrite(path.join(ASSETS_DIR, fileName), bytes);

    const manifest = {
      date_key: dateKey,
      source_url: sourceUrl,
      image_url: imageUrl,
      mime_type: format.mime,
      sha256,
      bytes: bytes.length
    };
    await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
    await atomicWrite(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
    await pruneOldAssets();
    console.log('Cached On This Day lead locally: ' + dateKey + ' -> ' + imageUrl + ' (' + bytes.length + ' bytes).');
  } catch (error) {
    console.warn('On This Day local lead cache skipped; remote image remains the fallback. ' + String(error?.message || error));
  }
}

await main();
